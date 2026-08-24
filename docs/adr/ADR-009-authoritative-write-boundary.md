# ADR-009 — Frontera autoritativa de escritura

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

[ADR-002](ADR-002-accounting-model.md) §7 decidió lo esencial y no se rediscute:
**el cliente envía intención, no resultado contable**; una función del servidor
valida y genera los efectos **atómicamente**; y **los roles cliente no tienen
permisos de escritura** sobre operaciones ni efectos. Lo que faltaba era cómo se
construye esa función.

Tres decisiones posteriores acotan el terreno:

- **[ADR-006](ADR-006-privilege-model.md)** — privilegio mínimo explícito, y las
  lecturas del cliente atraviesan vistas `security_invoker` con la RLS como
  autoridad por fila.
- **[ADR-007](ADR-007-membership-rls.md)** — la RLS resuelve la pertenencia con
  un helper reducido, y la expulsión surte efecto de inmediato.
- **[ADR-008](ADR-008-exact-data-boundary.md)** §3 — los valores exactos entran
  como JSON `string`, y **la frontera debe poder comprobar que el tipo JSON
  original era `string`**, delegando el mecanismo a esta decisión.

Y dos experimentos cambian premisas que el análisis daba por buenas:

**E14** midió que un parámetro SQL `text` **no conserva el tipo JSON original**,
porque PostgREST coacciona los números; y que con un payload `jsonb`,
`jsonb_typeof` **sí lo distingue**. Evidencia en
[`supabase/e14/`](../../supabase/e14/README.md).

**E15** midió cómo PostgREST mapea errores a HTTP, y demostró que **sin
serializar, dos liquidaciones concurrentes de 20 sobre una deuda de 30 pasan las
dos** y producen un sobrepago que ninguna validación ve. Evidencia en
[`supabase/e15/`](../../supabase/e15/README.md).

**E16** midió la premisa más importante. El análisis afirmaba que «dentro de un
`SECURITY DEFINER` la RLS no protege nada». **Es falso** cuando el owner de la
función no es propietario de la tabla y no tiene `BYPASSRLS`: la RLS sigue
aplicándose, y una política `WITH CHECK` **detuvo una escritura indebida del
propio writer**. Evidencia en [`supabase/e16/`](../../supabase/e16/README.md).

## Decisión

### 1. Dónde vive la ejecución

**La escritura autoritativa ocurre dentro de PostgreSQL**, en funciones de base
de datos. **Una función pública por clase de operación**, no una función
genérica única: `record_personal_expense`, `record_group_expense`,
`record_debt_settlement`, y las demás clases. Los nombres definitivos pueden
esperar a la implementación.

La consecuencia queda asumida y escrita: **el cálculo del reparto se escribe por
segunda vez**, y **la paridad con `src/domain/` se garantiza con los vectores
compartidos, no compartiendo código.** Es exactamente lo que ADR-002 §7 previó.

### 2. Payload

**Cada función recibe la intención completa como un único `jsonb`.**

Motivos, en orden de peso:

- permite **observar el tipo JSON original** antes de convertir, que es lo que
  ADR-008 §3 exige y un parámetro `text` no puede dar **[medido, E14]**;
- mantiene **una sola frontera de validación** en lugar de repartirla;
- mantiene **junta la intención** que la idempotencia debe comparar
  ([ADR-010](ADR-010-client-operation-idempotency.md));
- evita contratos mixtos, que se erosionan cada vez que se añade un campo;
- **conserva el `EXECUTE` granular**, porque sigue habiendo una función por
  clase.

> **El tipado generado de Supabase no es la fuente del contrato de estas
> intenciones.** Deberá documentarse y tiparse explícitamente en la capa
> correspondiente cuando se implemente. Es un coste real de esta forma y no se
> disimula.

### 3. Identidad del actor

**La identidad autoritativa procede de los claims verificados de la petición**,
nunca del payload.

El mecanismo es un helper interno, conceptualmente `sec.request_actor_id()`,
cuya única responsabilidad es: leer `request.jwt.claims` con
`current_setting(..., true)`, tratar correctamente la ausencia y la cadena
vacía, parsear el JSON, extraer `sub`, validarlo como `UUID` y **fallar cerrado**
si no hay identidad válida. Puede comprobar además que el contexto corresponde
al rol autenticado esperado, **sin convertir claims mutables de usuario en
autoridad**.

Propiedades obligatorias: pertenece a `sec` · es **interno** · es `STABLE` · es
**`SECURITY INVOKER`, no `SECURITY DEFINER`**, porque no necesita privilegios
sobre tablas · **no acepta `user_id` como parámetro** · no toca datos · no
interpreta `user_metadata` · **no concede autoridad a ningún `sub` enviado
dentro del payload**.

El writer puede recibir los privilegios internos mínimos para invocarlo. **Los
roles cliente siguen sin `USAGE` sobre `sec`** (ADR-007 §3).

**Por qué el GUC y no `auth.uid()`.** E16 midió que, dentro del
`SECURITY DEFINER` de un writer de mínimo privilegio, `auth.uid()` falla con
`permission denied for schema auth`, y que **`postgres` no puede conceder ese
`USAGE`** porque el schema `auth` pertenece a otro rol. La fuente de identidad
normativa **sigue siendo la identidad de la petición autenticada**; el GUC es el
mecanismo técnico para obtenerla bajo ese writer.

### 4. Seguridad de las funciones

Cada función autoritativa es:

- **`SECURITY DEFINER`**;
- **propiedad de un writer role dedicado** (§5);
- con **`search_path = ''`** y **nombres totalmente cualificados**;
- con **`REVOKE EXECUTE ... FROM PUBLIC`** — obligatorio, porque E12 midió que
  sin él la función es invocable por `anon`;
- con **`GRANT EXECUTE` explícito** solo a los roles autorizados;
- con el actor obtenido según §3, **nunca enviado por el cliente**.

### 5. El writer role

Decisión de principio:

| Atributo                              | Valor                      |
| ------------------------------------- | -------------------------- |
| Rol dedicado                          | **Sí**                     |
| `LOGIN`                               | **No** (`NOLOGIN`)         |
| `BYPASSRLS`                           | **No** (`NOBYPASSRLS`)     |
| ¿Es `postgres` o `service_role`?      | **No**                     |
| ¿Propietario de las tablas de `core`? | **No**                     |
| Privilegios DDL permanentes           | **Ninguno**                |
| Privilegios DML                       | **Los mínimos necesarios** |

### 6. Defensa en profundidad, con su límite

E16 demostró que un `SECURITY DEFINER` cuyo owner **no** es propietario de la
tabla y **no** tiene `BYPASSRLS` **sigue sometido a la RLS**, incluso al
escribir. Por tanto la arquitectura de escritura tiene **dos** capas:

1. **la autorización explícita dentro de la frontera autoritativa**;
2. **la RLS, aplicable también al writer**.

Con dos precisiones que hay que conservar juntas:

> **La RLS no sustituye la autorización de la función.** Es una segunda barrera,
> no la primera.
>
> **Y no vale cualquier política.** E16 midió que **las políticas permisivas se
> combinan con `OR`**: añadir una política para el writer **amplía**, nunca
> restringe.

La forma concreta de las políticas del writer, **incluido si hacen falta
políticas `RESTRICTIVE`**, queda delegada a **D9** junto con el esquema físico.

`FORCE ROW LEVEL SECURITY` queda registrado como **evidencia medida, no como
decisión**: el writer aprobado no es propietario de tablas, así que no aplica
hoy.

### 7. Atomicidad

**Una operación autoritativa se acepta en una sola transacción**, que abarca
conceptualmente: idempotencia · validación de transporte · identidad y
autorización · validación monetaria · validación de dominio · comprobaciones
dependientes del estado actual · derivación de efectos · persistencia.

> **La comprobación y el consumo de la deuda pendiente deben serializarse
> atómicamente.**

No es una precaución teórica: E15 midió que **sin serializar, dos liquidaciones
de 2000 sobre una deuda de 3000 se aceptan ambas** y dejan un pendiente de
**−1000**. Dos mecanismos —bloqueo de una fila estable y `advisory lock` por
clave derivada— lo corrigieron; **elegir cuál pertenece a D9**, porque depende
de qué filas existan.

### 8. Tipo de cambio — qué está decidido y qué no

**Decidido** (ADR-003 §4, invariantes 9 y 27; `data-model.md` §10):

- el FX usado es **autoritativo del servidor**, y el que aporte el cliente **no
  lo es**;
- corresponde al **momento efectivo del hecho**, no al de sincronización;
- **queda fijado y persistido** con la operación;
- **no se actualiza** después.

**No decidido**, y ADR-003 lo deja expresamente fuera de alcance: que exista un
catálogo determinado · proveedor · granularidad · **regla concreta de
selección** · **qué ocurre si no hay tipo exacto para la fecha**.

> **Este ADR no atribuye a la frontera de escritura una resolución automática
> por catálogo.** Es una decisión de producto pendiente, y describirla como
> resuelta sería inventarla.

### 9. Errores

Se mantienen **dos contratos separados**:

- **Errores de dominio** — las reglas que ya pertenecen a `src/domain/`
  conservan **sus códigos existentes**, que son el contrato entre la
  implementación de referencia y la autoritativa.
- **Errores de frontera** — transporte, autenticación y autorización, e
  idempotencia usan **un contrato separado**.

> **Estos conceptos no se añaden a `src/domain/errors.ts`.** `derive.ts` declara
> que la autorización está fuera del dominio, y transporte e idempotencia son
> nociones de servidor que no existen en el cálculo puro.

E15 midió que PostgREST permite transportar **un código propio y un estado HTTP
de forma estructurada**, de modo que el código estable no tenga que viajar en el
campo del mensaje humano. **Queda registrado el principio; no se define aquí una
taxonomía.**

## Alternativas consideradas

**A · Edge Function en TypeScript que importe `src/domain/`.**

Tiene una ventaja real que no conviene rebajar: **elimina por construcción la
duplicación del cálculo**, que ADR-002 aceptó como coste. **Descartada** por dos
razones. Una Edge Function que hable por PostgREST **no tiene transacción de
varias peticiones**, y §7 exige que idempotencia, derivación de deuda,
persistencia y efectos ocurran juntos; acabaría llamando a una función de base
de datos y quedaría como capa HTTP sin ganancia. Y convertiría `src/domain/` en
artefacto desplegado, con despliegues coordinados de servidor y app.

**B · Una única función genérica** `record_operation(intent jsonb)`.

Menos objetos y un solo `GRANT`. **Descartada** porque **un solo `EXECUTE` abre
todas las clases de operación a la vez**: no se podría conceder liquidar sin
conceder transferir.

**C · Parámetros SQL individuales tipados** en lugar de un `jsonb`.

Es la forma más legible y la que mejor tipa. **Descartada** por E14: PostgREST
coacciona un número JSON a un parámetro `text`, así que esta forma **no puede
cumplir ADR-008 §3**. Se pierde ergonomía a cambio de una garantía que sin ella
no existe.

**D · Writer con `BYPASSRLS`, o propietario de las tablas**, confiando solo en
la autorización interna de la función.

Es más simple: no hay que diseñar políticas para el writer ni preocuparse de que
la RLS estorbe. **Descartada** porque E16 midió que la alternativa **no es
teórica**: con un writer no propietario, una política `WITH CHECK` **detuvo una
escritura que el código habría dejado pasar**. Renunciar a esa barrera para
ahorrar diseño de políticas es cambiar seguridad medida por comodidad.

**E · `auth.uid()` como fuente de identidad dentro de las funciones.**

Es lo idiomático en Supabase. **Descartada por imposible** con el writer
aprobado: E16 midió que falla con `permission denied for schema auth` y que
`postgres` **no puede conceder** ese `USAGE`. La alternativa sería dar la
propiedad de las funciones a un rol privilegiado, que es la alternativa D.

## Consecuencias

### A favor

- **Atomicidad real**, incluida la derivación de la deuda pendiente dentro de la
  misma transacción.
- **Superficie de escritura enumerable**, con `EXECUTE` granular por clase.
- **El cliente no puede afirmar un resultado contable**, ni suplantar al actor.
- **Dos barreras y no una**: autorización explícita más RLS aplicable al writer,
  con la segunda **demostrada capaz de detener** una escritura indebida.
- El tipo JSON original es observable, de modo que ADR-008 §3 pasa de obligación
  a mecanismo.

### En contra

- **El reparto se escribe por segunda vez en PL/pgSQL**, incluido el mayor resto
  con desempate al pagador. Es trabajo real, delicado, y se prueba peor que en
  TypeScript. **El único detector de deriva son los vectores.**
- **El `jsonb` sacrifica el tipado generado**: el contrato de la intención hay
  que documentarlo aparte, y una errata en un nombre de campo no la detecta el
  compilador.
- **Depurar un `SECURITY DEFINER` es incómodo**, y más con `search_path = ''`.
- **El writer dedicado tiene coste operativo medido**: ceder la propiedad exige
  ser miembro del rol —`postgres` no es superusuario en este stack—, el nuevo
  owner necesita `CREATE` temporal sobre el schema, y cambiar la propiedad de
  ida y vuelta **pierde los `GRANT` explícitos**. Son observaciones **locales**
  de E16 que alimentarán el runbook, **no reglas portables** a cualquier
  entorno.
- **Sigue siendo el objeto de mayor riesgo del sistema.** Que ahora tenga una
  segunda barrera no lo convierte en inocuo.

## Fuera de alcance

Delegado a **D9**, junto con el esquema físico:

- tablas físicas de operación y versión;
- **políticas concretas del writer**, incluida la posible necesidad de
  `RESTRICTIVE`;
- **grants concretos del writer** sobre las tablas;
- **mecanismo de lock** para serializar la deuda pendiente;
- forma física de los resultados que devuelven las funciones.

Fuera de D9 y **pendiente como decisión de producto**: la **regla concreta de
resolución del FX**.

La idempotencia la fija [ADR-010](ADR-010-client-operation-idempotency.md).
