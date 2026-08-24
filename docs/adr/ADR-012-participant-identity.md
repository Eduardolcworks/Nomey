# ADR-012 — Identidad de participantes sin cuenta y vínculo con usuarios

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

`AGENTS.md` §5 fija tres invariantes de producto que no se tocan: **un
participante puede existir sin cuenta**; **vincularlo después a un usuario real
no pierde historial**; y **reclamar un participante exige prueba de
autorización** —un nombre, o un email no verificado, **no** son prueba—. Los
mecanismos quedaban abiertos, y `AGENTS.md` advierte que apuntar las
participaciones al participante es «un candidato fuerte, no un hecho dado».

El caso que lo motiva es cotidiano. Marta crea un grupo y añade a «Carlos», que
no tiene cuenta. Carlos participa en gastos y acumula deuda e historial. Meses
después crea una cuenta y reclama ese participante.

Dos errores hay que evitar, y tienen la misma raíz:

- **Usar `auth.users.id` como identidad del participante** haría **imposible
  representar a Carlos antes de registrarse**.
- **Crear un participante nuevo al registrarse** dejaría «Carlos invitado» y
  «Carlos usuario» como **dos sujetos distintos**, y unirlos exigiría
  **reescribir gastos y efectos históricos** — la migración que
  [`data-model.md`](../architecture/data-model.md) §6 declara innecesaria:
  «no hay migración de datos: los efectos ya apuntaban al participante».

[ADR-011](ADR-011-operation-version-model.md) dejó abierto a qué apuntan los
efectos, y [ADR-007](ADR-007-membership-rls.md) fijó que la autorización por
fila se resuelve por **membresía**. Este ADR decide la identidad.

**El experimento E18** midió que las restricciones del vínculo representan los
invariantes y no solo sus comentarios, y qué cuesta impedir que los periodos de
presencia se solapen. Evidencia en
[`supabase/e18/`](../../supabase/e18/README.md).

## Decisión

### 1. El participante es contextual, no global

Un **participante** representa **al sujeto económico dentro de un ámbito
concreto**. Una cuenta global es `auth.users`; **no son lo mismo y no existen en
el mismo momento**.

- Su **identidad es opaca y estable**.
- **Puede existir sin cuenta**, desde que alguien lo añade.
- El **nombre o alias mostrado no constituye identidad**: es dato de
  presentación de ese ámbito.
- **Participantes de ámbitos distintos nunca se correlacionan automáticamente**
  por nombre, email, teléfono ni alias.

> **La razón de que sea contextual y no global es de privacidad.** Un
> participante global obligaría a responder «¿son el mismo Carlos?» **antes de
> que nadie lo haya demostrado**, y la única forma de responderlo es
> precisamente correlacionar los datos que no deben correlacionarse. Peor aún:
> reclamar un participante global daría acceso al historial de grupos cuya
> existencia el reclamante ni siquiera conocía.
>
> Siendo contextual, la pregunta desaparece: Marta creó _su_ Carlos, Pedro _el
> suyo_, y **el modelo no afirma nada sobre si son la misma persona**. Si lo
> son, Carlos reclama ambos, cada uno con su prueba.

### 2. El vínculo vive en una relación separada

Se adopta una relación separada, conceptualmente `core.participant_user_link`,
**no una columna `user_id` nullable** dentro del participante.

Motivos: mantiene separada la **identidad económica** de la **identidad
autenticable** · permite la **auditabilidad** del claim · **evita reescribir
historia** · permite **expresar correctamente las dos cardinalidades** (§6) · y
**reclamar no modifica el participante** ni las operaciones históricas.

Hay además una asimetría que decide: migrar de una columna a una relación
obligaría a **inventar** cuándo y con qué prueba se establecieron los vínculos
ya existentes — es decir, **fabricar una autorización que nadie dio**. Migrar en
sentido contrario es tirar una tabla.

**No se fijan aquí todos los nombres físicos de columnas** que F10 deba
concretar.

### 3. Los efectos referencian al participante

> **Los efectos contables referencian siempre `participant_id`, nunca
> `user_id`.**

Se aplica a los **impactos económicos**, al **deudor**, al **acreedor** y a
cualquier otra identidad económica equivalente. Es coherente con lo ya
construido: `src/domain/effects/effect.ts` tipa esas dimensiones como
`ParticipantId` y no conoce usuarios.

**Consecuencia, y es la propiedad que se buscaba:** un claim posterior **no
modifica** operaciones · versiones · efectos · deudas históricas ·
`current_version_id` · `client_command`.

> **Reclamar no es una corrección contable y no crea `operation_version`.**
> Obtener una cuenta no cambia ningún hecho contable, y crear una versión por
> ello **falsearía el historial**, haciendo parecer que la operación cambió
> cuando no cambió.

Corolario que el dominio ya soporta: **el pagador de un gasto de Grupo puede no
tener Modo Personal**, y entonces **simplemente no se inserta el efecto de
saldo** — no un ámbito ficticio ni un efecto de importe cero, que sería un hecho
falso y contaría en agregaciones.

### 4. Tres relaciones distintas

| Concepto                 | Qué responde                                                  | ¿Sin cuenta? |
| ------------------------ | ------------------------------------------------------------- | ------------ |
| **Participante**         | Quién es el sujeto económico contextual                       | **Sí**       |
| **Periodo de presencia** | ¿Podía participar económicamente en ese ámbito en la fecha X? | **Sí**       |
| **Membresía de usuario** | ¿Qué puede ver o hacer ahora una cuenta autenticada?          | **No**       |

**No son la misma relación.** Un invitado sin cuenta tiene participante y
periodos, y **no tiene membresía**.

### 5. Temporalidad: periodos separados

La presencia se representa con una relación separada de periodos, con
`participant_id`, `valid_from` y `valid_until` nullable. **Puede haber varios
periodos para un mismo participante**, lo que soporta **entrar → salir →
volver** sin crear una identidad nueva.

Semántica de intervalo **`[valid_from, valid_until)`**: el inicio **incluido**,
el final **excluido**, de modo que **un periodo puede terminar exactamente
cuando empieza otro**; `valid_until` nulo representa un **periodo abierto**.

Invariante: **`valid_until IS NULL OR valid_until > valid_from`**.

**Los solapes se impiden de forma declarativa**, con una restricción de
exclusión equivalente a:

```
EXCLUDE USING gist (participant_id WITH =, period WITH &&)
```

donde `period` representa `[valid_from, valid_until)`.

> **`btree_gist` queda registrada como dependencia explícita del esquema**, no
> como dependencia runtime de la aplicación. E18 midió que sin ella el tipo
> `uuid` **no tiene operator class GiST** —`42704`— y que con ella la exclusión
> rechaza el solape del mismo participante y **acepta** el mismo periodo para
> participantes distintos.
>
> **Preflight obligatorio antes de producción:** verificar que la versión y la
> plataforma de PostgreSQL objetivo ofrecen `btree_gist`. **Si algún entorno
> objetivo no la ofreciera, el mecanismo debe revisarse** — no se sustituye
> ahora preventivamente por validación procedural.

### 6. Cardinalidades del vínculo

Tres invariantes, los tres verificados en E18:

| Invariante                                              | Mecanismo                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Un participante → como máximo un usuario**            | Clave primaria sobre `participant_id`                                  |
| **Un usuario → como máximo un participante por ámbito** | `UNIQUE (scope_id, user_id)`                                           |
| **El ámbito del vínculo no diverge del participante**   | FK compuesta `(participant_id, scope_id) → participant (id, scope_id)` |

Las dos primeras son **independientes**: ninguna implica la otra.

> **Se retira expresamente `UNIQUE (user_id, participant_id)`**, que aparecía en
> el análisis previo. **No imponía el invariante que su comentario declaraba**:
> como `participant_id` ya es clave, ese índice no añade restricción alguna y no
> menciona el ámbito.

**Conflictos, medidos:** un segundo usuario reclamando un participante ya
vinculado → **rechazo** · dos claims concurrentes → **exactamente un ganador** ·
el mismo usuario intentando representar dos participantes del mismo ámbito →
**rechazo** · el mismo usuario vinculado en ámbitos distintos → **permitido**.

**La fusión de participantes duplicados queda fuera de este ADR y de la Fase
3.C.**

### 7. Elegibilidad histórica

> **Un participante solo puede figurar en una operación cuando sea elegible
> según uno de sus periodos válidos y las reglas temporales de esa operación.**

Reclamar una cuenta posteriormente **no crea periodos retroactivos** · **no
modifica los existentes** · **no convierte al usuario en miembro histórico de
fechas anteriores** · **no altera operaciones**.

La validación autoritativa **consulta los periodos del participante**, y **no
reconstruye esa historia a partir de la membresía del usuario**. Son datos
distintos y responden preguntas distintas.

### 8. El claim establece identidad, no acceso

> **`participant_user_link` establece identidad, no autorización del ámbito.**

Vincular un participante con una cuenta **no concede por sí mismo** membresía ·
acceso por RLS · permiso para crear actividad · acceso al contenido del grupo.

**La autorización sigue dependiendo de la membresía** y de las reglas de acceso
que fija ADR-007. El vínculo responde a otra pregunta: _«¿cuáles de estos
efectos son míos en mis finanzas personales?»_.

F10 podrá decidir que un flujo de claim **cree además** una membresía, pero
serán **dos acciones conceptualmente distintas**, aunque se ejecuten en una sola
transacción.

### 9. Seguridad del claim

> **Nadie puede vincular un participante a una cuenta únicamente afirmándolo
> desde el cliente.**

La comprobación del derecho a reclamar es **autoritativa en el servidor**, **no
se basa únicamente en el nombre**, **no se basa en un email o teléfono libre no
verificado**, y debe ser **resistente al secuestro de historial** — reclamar da
acceso a deudas y gastos de terceros dentro de ese ámbito, así que la prueba
tiene que ser al menos tan fuerte como la información que abre.

**El mecanismo concreto pertenece a F10** y no se diseña aquí: ni email, ni SMS,
ni tokens, ni códigos, ni confirmación, ni expiración, ni revocación.

### 10. Auditabilidad mínima

Un vínculo aceptado debe ser **auditable**. Debe poder determinarse al menos:
**cuándo** se estableció · **qué participante y qué cuenta** quedaron
vinculados · **qué actor o proceso autoritativo** lo estableció · y **qué
procedencia o evidencia** justificó el claim, una vez F10 defina su forma.

**Se fija ahora como propiedad universal el instante del vínculo.**

**No se fijan todavía como columnas normativas obligatorias** `proof_kind` ni
`proof_ref`: F10 no ha definido qué constituye la prueba, y fijar sus columnas
prejuzgaría su forma. **Tampoco se inventa aquí una abstracción completa de
principals.**

> **Requisito para F10:** antes de habilitar claims reales en producción debe
> existir una **representación persistente suficiente de la procedencia y la
> evidencia**, de modo que los vínculos nuevos **no nazcan sin trazabilidad**.

### 11. Revocación

**No se diseña aquí el ciclo de vida completo.** Este ADR fija únicamente:

> **El camino normal no reasigna silenciosamente un participante de una cuenta
> a otra.**

Quedan para **F10**: el claim erróneo · la revocación · el _unlink_ · el cambio
o recuperación de cuenta · el historial del vínculo · y la posible reasignación
autorizada. **No se declara que toda revocación deba usar un mecanismo
concreto.**

### 12. Salida y membresía

**Cerrar un periodo de presencia y cerrar una membresía son conceptos
distintos.** Por decisión de producto pueden ocurrir a la vez, pero no son el
mismo dato.

**El participante histórico nunca se elimina** porque termine alguno de los dos:
hay operaciones que lo referencian. La salida y la reentrada se representan
**mediante periodos**.

**El acceso residual para saldar** —`data-model.md` §6— **sigue abierto**: no
existe todavía representación física suficiente, y este ADR no la inventa.

### 13. Frontera autoritativa

La frontera de escritura podrá necesitar: **crear** participantes · **crear y
cerrar** periodos · **crear el vínculo** tras una prueba válida · **consultar la
elegibilidad histórica** · e **impedir los conflictos**, que las restricciones
de §6 le dan estructuralmente.

Se mantienen sin cambios las decisiones previas: writer `NOLOGIN`,
`NOBYPASSRLS`, no propietario de las tablas, sometido a RLS, y **ninguna
política de `core` aplicable a `PUBLIC`** (ADR-011 §15). **Las políticas
concretas no se diseñan aquí.**

## Alternativas consideradas

**A · El participante es el usuario.** Lo más simple, y correcto en un producto
donde todo el mundo tenga cuenta. **Descartada por los invariantes**: haría
imposible representar a alguien antes de registrarse, que es el caso que motiva
toda esta decisión.

**B · Participante independiente con `user_id` nullable en la propia fila.**
Ahorra una tabla y un `JOIN` en la ruta más frecuente. **Descartada** por dos
razones. No registra **el vínculo como hecho** —cuándo, quién lo autorizó, con
qué prueba—, que es exactamente lo que F10 necesitará. Y **no puede expresar
limpiamente la segunda cardinalidad**: impedir que un usuario sea dos
participantes del mismo ámbito exigiría un índice único parcial más frágil, sin
sitio donde registrar la auditoría.

**C · El vínculo como operación versionada.** Coherente con «todo es operación».
**Descartada por desproporción**: el vínculo **no es un hecho contable**, no
produce efectos y no participa en saldos; someterlo a versiones y linaje añade
maquinaria sin ganancia.

**D · Participante global**, con una identidad que aparece en varios ámbitos.
Reclamar una vez enlazaría todo, lo cual es cómodo. **Descartada por
privacidad**, en los términos de §1.

**E · Temporalidad con `joined_at` / `left_at` en el propio participante.**
**Descartada**: solo admite **un** periodo, así que entrar, salir y volver
exigiría una identidad nueva — precisamente lo que este ADR existe para evitar.

**F · Periodos derivados de eventos de entrada y salida.** Correcta y auditable.
**Descartada** porque obliga a reconstruir el periodo en cada comprobación de
elegibilidad, que está en la ruta caliente de toda validación de operación. Es la
misma objeción que ADR-011 hizo a derivar la versión vigente en vez de apuntarla.

**G · Impedir los solapes con validación procedural** en lugar de una
restricción de exclusión. Evita la dependencia de `btree_gist`. **Descartada
como opción por defecto**: traslada al código una garantía que el motor puede
dar, y para ser correcta bajo concurrencia exige serializar. Se conserva como
**revisión obligada** si algún entorno objetivo no ofreciera la extensión (§5).

## Consecuencias

### A favor

- **El esquema admite participantes sin cuenta desde la primera migración**, y
  F10 encuentra el sitio preparado **sin tener que migrar historial**.
- **Reclamar es un cambio de visibilidad, no de datos**: ninguna fila contable
  se toca.
- **Las tres cardinalidades son estructurales**, verificadas contra el motor y
  no contra un comentario.
- **Los ámbitos quedan aislados**: dos invitados con el mismo nombre en grupos
  distintos no se correlacionan por construcción.
- **Entrar, salir y volver** no fragmenta la identidad.

### En contra

- **Un `JOIN` más** en consultas frecuentes, y **una tabla más** con su política
  de RLS. Es el precio de separar identidad económica de identidad autenticable.
- **Una dependencia nueva del esquema**, `btree_gist`, con su preflight en cada
  entorno. Es una extensión estándar de `contrib`, pero es una dependencia real
  y hay que instalarla también en CI.
- **Un usuario acaba con varios vínculos**, uno por ámbito, y cada consulta de
  «¿qué es mío?» tiene que resolverlos.
- **La auditoría del claim queda a medias hasta F10**: el instante y el actor
  existen, la evidencia no, y hay que recordar el requisito antes de habilitar
  claims reales.
- **El acceso residual sigue sin representación**, así que quien salga con saldo
  distinto de cero todavía no tiene un modelo que lo sostenga.

### Riesgo que se mitiga estructuralmente

Que alguien empiece a usar `user_id` en los efectos «porque es más cómodo».
**No hay dónde**: los efectos no tienen columna de usuario.

## Compatibilidad con ADR-011

Verificada punto por punto: los efectos referencian al participante · **el claim
no crea versión** · no cambia efectos · no cambia `current_version_id` · no
cambia `client_command` · **el historial contable permanece idéntico**. Sin
fricción.

## Fuera de alcance

Delegado a **F10**: el mecanismo de prueba del claim · la revocación y el
_unlink_ · el historial del vínculo · la fusión de participantes duplicados.

Delegado a **D11**: la proyección canónica de efectos vigentes deberá resolver
también **qué efectos son «míos»**, que es una pregunta sobre el vínculo y no
sobre la membresía.

**Sigue abierto y no se prejuzga**: el **acceso residual** de quien sale de un
ámbito con saldo pendiente.
