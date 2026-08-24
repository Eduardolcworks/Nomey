# Traspaso de la Fase 3.C

> ⚠️ **NO NORMATIVO.** Es el documento de **continuidad entre sesiones** de la
> Fase 3.C. No decide nada: las decisiones normativas viven en
> [`docs/adr/`](../adr/README.md), en [`data-model.md`](data-model.md) y en
> [`glossary.md`](../product/glossary.md); la secuencia de fases, en
> [`product/roadmap.md`](../product/roadmap.md). **Si esta nota los contradice,
> mandan ellos.**
>
> Existe para que una sesión nueva reconstruya el estado del proyecto leyendo el
> repositorio, **sin depender de ninguna conversación previa**.

Escrito al cerrar **3.B** el 2026-08-20. **Actualizado al cerrar E20 el
2026-08-24**, con el estado completo de la fase.

---

## 1 · Estado del repositorio

Checkpoint **durable**: describe qué hay decidido y consolidado, no una foto del
índice de Git. **La verdad del árbol es `git status`**, no esta tabla.

|                            |                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------- |
| **D10**                    | **Cerrado y mergeado a `main`**: ADR-012 y `supabase/e18/`                       |
| **D11**                    | **Cerrado y mergeado a `main`** (`d672246`): ADR-013 y `supabase/e19/`           |
| **E20**                    | **Cerrada** en la rama `chore/phase-3c-e20`: `supabase/e20/` y ADR-013 §10       |
| **Rama de trabajo**        | `chore/phase-3c-e20`, abierta desde `d672246`                                    |
| **`main`**                 | **Aún sin E20** mientras su PR no esté revisada y mergeada                       |
| **`src/`**                 | **Intacto.** No se ha tocado en toda la fase 3.C                                 |
| **`supabase/migrations/`** | **No existe.** No se ha autorizado SQL definitivo                                |
| **`npm test`**             | **110/110** en verde                                                             |
| **`npm run verify`**       | Verde — typecheck de app y tests, lint y formato                                 |
| **E18 · E19 · E20**        | Reproducidos de extremo a extremo contra el stack local, con **teardown limpio** |

**Cómo comprobarlo en una sesión nueva**, sin depender de esta tabla:

```bash
git log --oneline main..HEAD
git status --porcelain -uall
```

**D11 ya está en `main`** (merge `d672246`). La rama viva es
`chore/phase-3c-e20`, con **dos commits propios** —uno con `supabase/e20/` y otro
con ADR-013 y la documentación— y un árbol limpio.

**Historial de la fase en `main`**, útil para reconstruir el orden:

| Merge     | Bloque                        |
| --------- | ----------------------------- |
| `9a60c5d` | Análisis inicial de 3.C · E12 |
| `8580ca0` | 3.C.3 — D3/D5 · E13           |
| `f80ccf8` | 3.C.4 — D6 · E14              |
| `dd3fb96` | 3.C.5 — D7/D8 · E15/E16       |
| `d0b6d95` | 3.C.6 — D9 · E17              |
| `bc2b8d7` | 3.C.7 — D10 · E18             |
| `d672246` | 3.C.8 — D11 · E19             |

---

## 2 · Roadmap de la Fase 3.C

**Cerrados:**

| Bloque    | Contenido                                   | Evidencia |
| --------- | ------------------------------------------- | --------- |
| **3.C.1** | D4 — privilegios observados en E11          | E12       |
| **3.C.2** | D1 identidad monetaria · D2 schemas         | —         |
| **3.C.3** | D3 grants · D5 membresía y RLS              | E13       |
| **3.C.4** | D6 frontera de datos exactos                | E14       |
| **3.C.5** | D7 escritura autoritativa · D8 idempotencia | E15 · E16 |
| **3.C.6** | D9 modelo de operaciones y versiones        | E17       |
| **3.C.7** | D10 identidad de participantes              | E18       |
| **3.C.8** | D11 persistido frente a derivado            | E19       |

**E20 está cerrada.** Midió el `WITH CHECK` del writer durante la secuencia
autoritativa, y la decisión humana que dejó abierta —quién puede corregir— está
tomada (§10). **Siguiente: los transversales y la finalización de 3.C** que marca
el roadmap existente. **No hay fases nuevas**; consultar
[`product/roadmap.md`](../product/roadmap.md).

---

## 3 · ADR aceptados

Los trece están en estado `Aceptado`. **Una frase cada uno; el ADR manda.**

| ADR                                                   | Decisión principal                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [002](../adr/ADR-002-accounting-model.md)             | Modelo centrado en la operación con efectos explícitos, versiones inmutables y frontera de escritura autoritativa en el servidor |
| [003](../adr/ADR-003-money-representation.md)         | Los importes son enteros en unidad mínima con su definición monetaria, y nada monetario cruza JSON como número                   |
| [004](../adr/ADR-004-currency-definition-identity.md) | La identidad física de una definición monetaria es un `UUID` fijo y sembrado, opaco para el dominio                              |
| [005](../adr/ADR-005-schema-topology.md)              | `core` para la persistencia, `api` como única superficie expuesta, `sec` para helpers; las tablas contables no se exponen        |
| [006](../adr/ADR-006-privilege-model.md)              | Privilegio mínimo explícito, saneamiento de defaults, y las lecturas atraviesan vistas `security_invoker`                        |
| [007](../adr/ADR-007-membership-rls.md)               | La RLS de `core` es la autoridad por fila, con un helper reducido y sin claims de membresía en el JWT                            |
| [008](../adr/ADR-008-exact-data-boundary.md)          | Los valores exactos salen como texto y entran como JSON `string`, y la frontera debe poder comprobar el tipo JSON original       |
| [009](../adr/ADR-009-authoritative-write-boundary.md) | Funciones por clase con payload `jsonb`, `SECURITY DEFINER` de un writer de mínimo privilegio sometido a RLS, en una transacción |
| [010](../adr/ADR-010-client-operation-idempotency.md) | UUID generado y persistido por el cliente, unicidad por actor transversal a clases, comparación solo en servidor                 |
| [011](../adr/ADR-011-operation-version-model.md)      | Operación estable, versiones inmutables, efectos por versión y `client_command` como unidad física de idempotencia               |
| [012](../adr/ADR-012-participant-identity.md)         | Participante contextual por ámbito, vínculo con la cuenta en relación separada, y periodos de presencia                          |
| [013](../adr/ADR-013-persisted-vs-derived.md)         | Solo los hechos se persisten; saldos y deudas se derivan; el reparto es contextual y hay una proyección canónica de vigentes     |

---

## 4 · Evidencia empírica

**Todas son evidencia reproducible, viven fuera de `supabase/migrations/` y
nunca deben convertirse en migración.** Cada una tiene su `README.md` con el
procedimiento y su teardown.

|                                     | Qué demuestra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [E11](../../supabase/e11/README.md) | PostgreSQL y PostgREST conservan `BIGINT` y `NUMERIC` exactos; **la degradación la produce `JSON.parse`**. Lo determinante es el cast a texto, no el camino de acceso                                                                                                                                                                                                                                                                                                                                                                             |
| [E12](../../supabase/e12/README.md) | Las tablas nuevas de `public` nacen con `TRUNCATE`, `REFERENCES`, `TRIGGER` y `MAINTAIN` para los roles cliente, por default privileges de Supabase; son **ejecutables**; `MAINTAIN` es invisible para `information_schema`; y `PUBLIC` tiene `EXECUTE` sobre toda función nueva                                                                                                                                                                                                                                                                  |
| [E13](../../supabase/e13/README.md) | Una vista `security_invoker` **sí aplica la RLS**; una ejecutada como propietario **no**; el helper funciona con `EXECUTE` sin `USAGE`; y los grants SQL **no abren ruta HTTP** mientras el schema quede fuera de las superficies expuestas **y** de los search paths                                                                                                                                                                                                                                                                             |
| [E14](../../supabase/e14/README.md) | PostgREST **coacciona un número JSON a un parámetro `text`**, así que ese tipo no conserva el tipo JSON original; con `jsonb`, `jsonb_typeof` **sí lo distingue**. La degradación ocurre **dentro del cliente**                                                                                                                                                                                                                                                                                                                                   |
| [E15](../../supabase/e15/README.md) | `RAISE sqlstate 'PGRST'` transporta código propio y estado HTTP sin usar el mensaje humano; `ON CONFLICT` y la captura de `unique_violation` son **ambos** correctos; y **sin serializar, dos liquidaciones concurrentes producen sobrepago**                                                                                                                                                                                                                                                                                                     |
| [E16](../../supabase/e16/README.md) | Un `SECURITY DEFINER` cuyo owner **no** es propietario de la tabla y **no** tiene `BYPASSRLS` **sigue sometido a RLS**, y una política `WITH CHECK` detuvo una escritura indebida. `auth.uid()` no es invocable por ese writer                                                                                                                                                                                                                                                                                                                    |
| [E17](../../supabase/e17/README.md) | El ciclo operación/versión con FK compuesta diferible deja invariante **fuerte al commit**; las seis constraints de linaje funcionan; el comando se reclama antes de su resultado y revierte con él; sin `TO` y `TO PUBLIC` son indistinguibles en catálogo                                                                                                                                                                                                                                                                                       |
| [E18](../../supabase/e18/README.md) | Las tres cardinalidades del vínculo participante ↔ usuario son estructurales; los periodos soportan entrar, salir y volver con una identidad; y la exclusión de solapes **exige `btree_gist`**                                                                                                                                                                                                                                                                                                                                                    |
| [E19](../../supabase/e19/README.md) | La RLS **sobrevive a dos vistas `security_invoker` encadenadas**, y **decide el eslabón más cercano a las tablas**; `pg_depend` registra dependencias **directas, no transitivas**, así que la guarda es estructural para vistas; un cuerpo `BEGIN ATOMIC` **sí** deja dependencias                                                                                                                                                                                                                                                               |
| [E20](../../supabase/e20/README.md) | El `WITH CHECK` de un efecto **ve la versión insertada y aún no confirmada** en su misma transacción, así que existe un predicado no trivial y útil; el aislamiento por ámbito **rechazaría escrituras legítimas**; `SELECT … FOR UPDATE` **exige política de `UPDATE` y su ausencia devuelve 0 filas sin error**; la RLS **no acota columnas**; las políticas de `SELECT` del writer **son portantes de la escritura**; y restringir por atribución la lectura de las versiones **impide corregir la de otro actor**, con `NULL` en vez de error |

---

## 5 · Estado normativo del modelo

Resumen suficiente para no tener que reconstruirlo. **Los ADR mandan.**

### Topología (ADR-005, ADR-006)

`core` persistencia · `api` superficie cliente · `sec` helpers internos ·
`public` sin objetos de dominio. **`core` y `sec` quedan fuera de los schemas
expuestos y del `extra_search_path`** — son dos parámetros distintos y ninguno
sustituye al otro.

### Lectura (ADR-006 §5)

```
core (tipo exacto) → api security_invoker view → texto → JSON string → cliente
```

La **RLS de `core` es la autoridad por fila**.

### Escritura (ADR-009)

Funciones autoritativas en PostgreSQL, **una por clase**, con **payload completo
`jsonb`**, `SECURITY DEFINER`, propiedad de un **writer dedicado** —`NOLOGIN`,
`NOBYPASSRLS`, no propietario de tablas, mínimo privilegio—, `search_path = ''`,
nombres cualificados, `REVOKE EXECUTE FROM PUBLIC` y `GRANT` explícito.

**La RLS sigue aplicando al writer**, así que hay dos barreras: autorización
explícita dentro de la función, y RLS detrás. **Ninguna sustituye a la otra.**

El **actor se deriva de la petición, nunca del payload**, mediante un helper
interno equivalente a `sec.request_actor_id()` que lee `request.jwt.claims`.
`auth.uid()` **no sirve** para el writer de mínimo privilegio.

### Exactitud (ADR-008)

`BIGINT` y `NUMERIC` **nunca cruzan hacia JavaScript como número JSON** · la
superficie `api` los proyecta como **texto** · los valores exactos **entran como
JSON `string`** · la frontera autoritativa **debe poder comprobar el tipo JSON
original** · el tipo de cambio se representa como **`coefficient` (string) +
`scale` (entero acotado)**.

### Idempotencia (ADR-010)

UUID **generado y persistido por el cliente** antes del primer intento ·
unicidad **`(created_by, client_operation_id)` transversal a todas las clases** ·
**comparación exclusivamente en el servidor** · **el cliente no calcula hash** ·
misma clave con misma clase e intención → **replay** · con clase o intención
distinta → **conflicto** · replay mínimo tras pérdida posterior de autorización.

### Persistido frente a derivado (ADR-013)

**Se persiste** un hecho cuando el usuario lo declaró **o** cuando recomputarlo
podría dar otro resultado. **Todo lo demás se deriva**, y **no hay caché
económica en v1**.

Derivados **sin excepción**: saldo · deuda · estadísticas · totales ·
`Disponible actual` · `Disponible tras saldar`.

**`operation`** — identidad · clase · atribución inicial · instante ·
`current_version_id`. **Sin ámbito, sin importe, sin `client_operation_id`.**

**`operation_version`** — `version_no` · `supersedes_version_id` · atribución e
instante de la versión · fecha efectiva · **exactamente un importe original** y
su definición monetaria · versión de reglas económicas. **Sin clase** —la hereda—
**sin ámbito, sin método de reparto y sin pagador.**

**Reparto contextual** — cabecera por `(versión, ámbito)` con ámbito, método y
pagador; filas de participante con ordinal, intención declarada y **resultado
resuelto, ceros incluidos**. La moneda del resultado la determina el ámbito y
**no se duplica**.

**Conversiones** — una por ámbito alcanzado que la requiera, congelada **por
valor**: definiciones origen y destino, coeficiente, escala, **fecha para la que
se resolvió** y procedencia opcional **no autoritativa**.

**`effect`** — cabecera con ámbito, clase, definición monetaria y versión, más
**tres dimensiones independientes**: saldo, económica —con participante
**legítimamente nulo**— y deuda —importe, deudor y acreedor, todos o ninguno—.
**Una sola columna de importe no representa un efecto**: una misma fila puede
llevar dimensiones con signos distintos.

**Vigencia** — `current_version_id` es **estado autoritativo**. Que coincida con
la versión de mayor número es **invariante de integridad**, no una segunda
definición.

**Reglas económicas** — cada versión registra su contrato de derivación. **No
implica** poder reejecutar reglas antiguas. Una corrección usa las **vigentes al
crearla**, conservando la intención no corregida, y **debe poder
previsualizarse**.

---

## 6 · D9 — operación, versión y comando (ADR-011)

**`core.operation`** — identidad estable · **una tabla para todas las clases** ·
`current_version_id` selecciona la versión vigente · **no contiene
`client_operation_id`**.

**`core.operation_version`** — versiones históricas con `version_no` y
`supersedes_version_id` · corregir **crea una versión nueva** · el historial
anterior **no se modifica**.

**`core.effect`** — pertenece a una versión · los efectos históricos
**permanecen** · **solo los de la versión vigente cuentan económicamente**.

**`core.client_command`** — la **unidad física de idempotencia**. Conserva:
actor · `client_operation_id` · `command_type` · `command_contract_version` ·
`canonical_intent` · `result_operation_id` · `result_version_id` · fecha.

Con `UNIQUE (created_by, client_operation_id)` **transversal a clases**,
**INSERT-only** en el camino normal, **solo comandos aceptados**, y **sin hash
en v1**.

**`canonical_intent` está separado del estado autoritativo resuelto**, y la
canonicalización la hace **solo el servidor**.

**Creación:** UUID pregenerados + FK compuestas `DEFERRABLE INITIALLY DEFERRED`.

**Corrección concurrente:** `expected_version_id` · serialización o CAS sobre la
fila de `operation` · `UNIQUE (operation_id, version_no)` como **backstop** ·
**el replay se resuelve antes de comprobar `expected_version_id`**.

**Linaje:** `version_no >= 1` · unicidad por operación y número · primera
versión sin predecesor · siguientes con predecesor · sin autorreferencia ·
predecesor de la misma operación · versión vigente de la misma operación.

> **La frontera autoritativa sigue siendo responsable** de garantizar que el
> predecesor sea **exactamente la versión vigente anterior**. Ninguna constraint
> lo cubre.

---

## 7 · D10 — participantes (ADR-012)

**Participante:** contextual **por `scope`** · identidad **opaca y estable** ·
**puede existir sin cuenta** · el nombre mostrado **no es identidad** ·
participantes de ámbitos distintos **no se correlacionan automáticamente**.

**Efectos:** referencian **siempre `participant_id`**, **nunca `user_id`**.

**Vínculo participante ↔ usuario:** relación separada, con tres invariantes:

- un participante → **como máximo un usuario**;
- un usuario → **como máximo un participante por ámbito**;
- el ámbito del vínculo **debe coincidir** con el del participante.

Forma conceptual: `participant_user_link (participant_id, scope_id, user_id)`
con **PK/UNIQUE sobre el participante**, **`UNIQUE (scope_id, user_id)`** y **FK
compuesta** hacia el participante.

**El claim** establece **identidad** · **no** concede membresía · **no** concede
acceso RLS · **no** crea `operation_version` · **no** modifica efectos ni
historial · es **autoritativo en servidor** y **no basta afirmarlo desde el
cliente**. El **mecanismo concreto de prueba es F10**.

**Auditabilidad fijada ahora:** instante del vínculo · qué participante y qué
cuenta · qué actor o proceso autoritativo lo estableció · y el requisito de
**persistir evidencia y procedencia cuando F10 defina el mecanismo**. **No** se
fijan todavía `proof_kind` ni `proof_ref` como columnas obligatorias.

**Revocación:** abierta para F10. Lo único fijado es que **el camino normal no
reasigna silenciosamente** un participante de una cuenta a otra.

---

## 8 · Periodos de presencia

Tres conceptos **distintos**: **participante** = identidad económica ·
**periodo** = elegibilidad histórica · **membresía de usuario** = autorización y
acceso.

`participant_period (participant_id, valid_from, valid_until nullable)` con
semántica **`[valid_from, valid_until)`**: inicio **incluido**, final
**excluido**, `NULL` = **abierto**, y `valid_until > valid_from` cuando exista.

Permite **entrar → salir → volver** manteniendo **el mismo participante**.

Un claim posterior **no crea periodos retroactivos**, **no modifica los
existentes** y **no crea membresía histórica**.

---

## 9 · `btree_gist`

**Adoptada como dependencia del esquema** —no de la app— para impedir solapes,
con el invariante: **un participante no puede tener dos periodos solapados**.
Conceptualmente `EXCLUDE USING gist (participant_id WITH =, period WITH &&)`.

E18 midió: disponible en el stack local · **no instalada por defecto** ·
necesaria porque `uuid` no tiene operator class GiST · funciona · y el teardown
la retira.

> **Preflight obligatorio antes de producción:** verificar que la plataforma
> PostgreSQL objetivo la ofrece. **Si algún entorno no la ofreciera, el
> mecanismo se revisa** — no se sustituye preventivamente.

---

## 10 · RLS y políticas

- El **writer está sujeto a RLS** (E16).
- Las políticas permisivas se combinan con **`OR` solo entre las aplicables al
  rol actual**. **Una `TO authenticated` y una `TO writer` no se suman.**
- **Ninguna política de `core` debe ser aplicable a `PUBLIC`**, salvo excepción
  explícita y documentada.
- Test conceptual robusto: **`0 = ANY(polroles)`** sobre `pg_policy`.
- E17 midió que **sin `TO` y `TO PUBLIC` son indistinguibles** en catálogo, y
  que PostgreSQL **colapsa `TO public, authenticated` a `PUBLIC`** con un aviso.

### Predicados de `operation` y `operation_version` (ADR-013 §10)

**Lectura del cliente:** el efecto por **membresía del ámbito** con el helper;
la **versión** si existe **al menos un efecto visible de esa versión**; la
**operación** si existe uno de **alguna de sus versiones**. No recursa: el helper
`SECURITY DEFINER` rompe la cadena y los efectos no referencian la operación. **La
visibilidad del historial sale de los efectos históricos**, no solo de los
vigentes.

**Escritura: solo el writer.** Los roles cliente quedan sin grants y **sin
políticas** de escritura. Las políticas del writer van **dirigidas a ese rol**, y
por eso no amplían al cliente.

> **La separación por comando y por rol no es una comodidad.** Un predicado
> derivado de efectos es **insatisfacible** al insertar la operación y la
> versión —todavía no hay efectos— y **las políticas RLS no son diferibles**:
> el recurso de la FK diferida no tiene equivalente. Además, E16 midió que
> **`auth.uid()` no es invocable por el writer**.

**Resuelto por E20 y fijado en ADR-013 §10.** El `WITH CHECK` del writer sobre
los efectos es: **existe una versión, referida por el efecto, atribuida al actor
de la petición**. Es satisfacible dentro de la transacción porque la subconsulta
ve la versión insertada y aún no confirmada. **No** es el aislamiento por
ámbito, que rechazaría escrituras legítimas (ADR-002 §10).

**Ninguna política del writer deriva de la autoría.** La autoría original **no**
concede exclusividad sobre las correcciones: el derecho a corregir es **funcional
y contextual al ámbito**, y se resuelve en la frontera autoritativa. Cada versión
queda atribuida a quien la crea.

Eso alcanza también a la **lectura de las versiones**: construir V2 **exige leer
V1** —`version_no` calculado, FX heredado, intención conservada, reparto
anterior—, y E20 midió que con la lectura restringida por atribución la V1 de
otro actor es **invisible** y la agregación devuelve **`NULL` sin error**.
Conocer el puntero **no sustituye** esa lectura: el identificador es legible
desde la operación mientras la fila de la versión permanece oculta.

**Ampliar la lectura no afloja la escritura.** Con la política de `SELECT` amplia,
el `WITH CHECK` de los efectos **sigue rechazando** que un actor cuelgue efectos
de la versión de otro, y el de las versiones **sigue impidiendo** atribuirse una
versión ajena.

Cuatro precisiones más que E20 midió y que condicionan la migración:

- **`SELECT … FOR UPDATE` exige política de `UPDATE`**, y su ausencia **devuelve
  0 filas sin error** — afecta al paso 2 de §10 bis;
- **la RLS acota filas; `GRANT UPDATE (columna)` acota columnas**;
- las **políticas de `SELECT` del writer son portantes** de las subconsultas de
  `WITH CHECK`;
- **`INSERT … RETURNING` puede exigir política de `SELECT`**.

---

## 10 bis · Serialización de la deuda (ADR-013 §11)

> **Toda escritura autoritativa que pueda crear, modificar o consumir deuda
> vigente de un ámbito participa en el mismo protocolo sobre ese ámbito.** Se
> decide por **qué efectos produce**, no por la clase.

Determinar los ámbitos → **bloquear** sus filas estables → **en orden
determinista** si son varios → **leer la deuda después** → validar → insertar →
mover el puntero → commit.

Entran: crear un gasto que genera deuda · **corregir alterando deuda** ·
**eliminarla mediante una versión nueva** · liquidar parcial o totalmente ·
liquidar mediante transferencia. **No entra** lo que no toca deuda.

**Una serialización parcial no serializa nada:** si solo la liquidación bloquea,
una corrección concurrente produce el mismo sobrepago que E15 midió sin locks.
El advisory lock por par queda como **escalada futura**, no como diseño de v1.

---

## 11 · Deliberadamente ABIERTO

**No tratar nada de esto como decidido.**

### Producto y fases posteriores

Regla concreta de **resolución del FX** · mecanismo de **claim** (F10) · prueba,
token, email o SMS · **revocación y unlink** · **fusión** de participantes ·
**acceso residual** tras abandonar un ámbito · **retención y purga** ·
**anulación** de una operación como concepto distinto de la corrección · Modo
Pareja · Open Banking · recurrencias.

**No inventar respuestas para estos puntos.**

---

## 12 · Riesgos y recordatorios

1. **Nunca volver a poner `client_operation_id` en `operation`.** La unidad de
   idempotencia es el **comando**: con K1 creando y K2/K3 corrigiendo la misma
   operación, una sola casilla no basta para tres comandos.
2. **Nunca volver a introducir un fingerprint calculado por el cliente.** La
   comparación vive **solo en el servidor**.
3. **No usar `user_id` en `effect`.** Los efectos apuntan al participante.
4. **Claim ≠ membresía.** Vincular no concede acceso.
5. **Periodo de participante ≠ membresía de usuario.** Son datos distintos.
6. **No olvidar el filtro de versión vigente.** Es el fallo silencioso más
   probable del modelo. **Nunca se reimplementa a mano**: se consulta la
   proyección canónica de ADR-013 §9, y la guarda de catálogo detecta a quien la
   evita.
7. **La deuda pendiente debe serializarse atómicamente**, y el protocolo de
   ADR-013 §11 **alcanza a toda escritura que pueda alterar deuda vigente**, no
   solo a la liquidación. Una serialización parcial no serializa nada.
8. **La proyección canónica es un límite de privilegio.** Si se crea sin
   `security_invoker`, el camino de lectura pierde la RLS **y sigue devolviendo
   cifras creíbles** (E19).
9. **Nunca poner ámbito en `operation` ni en `operation_version`.** Una
   operación alcanza varios y no hay uno único por clase.
10. **El método de reparto y el pagador no viven en la versión**: una política
    RLS decide filas y **no puede ocultar columnas**.
11. **No usar políticas `PUBLIC` en `core`.**
12. **No asumir que `btree_gist` existe en producción sin preflight.**
13. **[`phase-3c-design.md`](phase-3c-design.md) es NO NORMATIVO**, incluso para
    lo ya aprobado. **Los ADR prevalecen.**

---

## 13 · Qué entregó D11

|                      |                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------- |
| **ADR-013**          | `Aceptado` — persistido frente a derivado, reparto contextual y proyección canónica           |
| **`supabase/e19/`**  | **9 ficheros** de evidencia reproducible, fuera de `migrations/`                              |
| **Documentación**    | `AGENTS.md` · `docs/README.md` · `docs/adr/README.md` · `data-model.md` · los dos de fase 3.C |
| **`npm test`**       | 110/110                                                                                       |
| **`npm run verify`** | Verde                                                                                         |
| **Teardown de E19**  | Limpio: 0 relaciones, 0 schemas, 0 funciones, 0 grants residuales                             |

**Lo que decidió, en una línea cada cosa.** Solo los hechos se persisten y no hay
caché económica en v1 · `operation` y `operation_version` **sin ámbito** · la
clase vive solo en `operation` y **es conocible por quien ve un efecto**, sin que
eso conceda nada más · **el método de reparto y el pagador salen de la versión** a
una cabecera de reparto por `(versión, ámbito)` · un importe original y 0..n
conversiones congeladas **por valor** · versión de reglas económicas como
metadata · proyección canónica `security_invoker` con guarda de catálogo · RLS
separada **por comando y por rol** · protocolo común de serialización de la
deuda.

**Decisiones humanas que lo desbloquearon:** la clase de operación es conocible
desde cualquier efecto visible **sin imponer restricciones a clases futuras**
(Q1), y el reparto final del Modo Pareja **reutiliza `exact_amounts`** sin dejar
de ser conceptualmente un cierre de saldo (Q2).

---

## 14 · Próximo paso exacto

**No empezar los transversales hasta que E20 esté en `main`.** En orden:

1. **comprobar que `supabase/e20/` y la documentación están consolidados** en la
   rama — `git log --oneline main..HEAD` debe mostrar los dos commits y
   `git status` un árbol limpio;
2. si aún no ocurrió: **push** de `chore/phase-3c-e20`, **PR** y **esperar
   revisión y merge**. **Nunca merge sin petición explícita**;
3. **sincronizar `main`** una vez mergeada;
4. después, **transversales y síntesis** de 3.C. **Ya no queda ninguna
   incertidumbre técnica** bloqueando las migraciones.

Antes de implementar hay una deuda concreta ya identificada:
`tests/vectors/scenarios.json` **no tiene ningún caso de corrección** (§15), y
añadirlos exige **extender el formato**, que hoy no tiene noción de versión.

Los mensajes de commit de esta fase explican el **porqué**, no solo el qué.
Conviene mantener ese estilo, con la explicación larga en el ADR, en el README
del experimento y en la PR.

---

## 15 · Trampas conocidas

Cosas que ya costaron una corrección.

- **Los tipos generados por Supabase no son una frontera segura.**
  `supabase gen types typescript` produce `number` para `int8` y `numeric`.
  **`src/types/database.ts` no se escribe a mano** para taparlo; se genera sobre
  `api`, donde esos tipos no son alcanzables.
- **La denegación por RLS es silenciosa.** Una tabla con `GRANT` y RLS sin
  política responde `200 []`. Un `GRANT` ausente responde `401` **sin sesión** y
  **`403` con JWT** — E13 lo midió. Un test que solo compruebe «no veo datos
  ajenos» pasaría con la tabla vacía: hay que comprobar **también el caso
  positivo**.
- **Las FK diferibles rompen el borrado por sentencias sueltas.** Limpiar tablas
  con el puntero de vigencia exige hacerlo **dentro de una transacción**.
- **Ceder la propiedad de un objeto exige ser miembro del rol destino**, y
  `postgres` **no es superusuario** en este stack. E16 y E17 lo midieron.
- **Vitest no comprueba tipos.** El typecheck de `tests/` es una invocación
  aparte de `tsc`; `npm run typecheck` ejecuta las dos.
- **La suite debe poder fallar.** El procedimiento de regresión deliberada está
  en [`tests/README.md`](../../tests/README.md).
- **`tests/vectors/scenarios.json` no tiene ningún caso de corrección.** Hacen
  falta antes de implementar: V1 = 60, V2 = 75, V1 histórica, solo V2 cuenta,
  replay que no crea V3, y corrección obsoleta que da conflicto.
