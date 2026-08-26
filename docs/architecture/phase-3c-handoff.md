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

Escrito al cerrar **3.B** el 2026-08-20. **Actualizado al migrar el vínculo
participante↔cuenta y los periodos de presencia el 2026-08-25**, con el estado
completo de la fase.

---

## 1 · Estado del repositorio

Checkpoint **durable**: describe qué hay decidido y consolidado, no una foto del
índice de Git. **La verdad del árbol es `git status`**, no esta tabla.

|                            |                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------- |
| **D10**                    | **Cerrado y mergeado a `main`**: ADR-012 y `supabase/e18/`                        |
| **D11**                    | **Cerrado y mergeado a `main`** (`d672246`): ADR-013 y `supabase/e19/`            |
| **E20**                    | **Cerrada y mergeada a `main`** (`afe50ab`): `supabase/e20/` y ADR-013 §10        |
| **Transversales**          | **Cerrados** el 2026-08-25 (§11 bis). Checklist de entrada en §14                 |
| **`main`**                 | Contiene toda la fase 3.C decidida hasta aquí                                     |
| **`src/`**                 | **Intacto.** No se ha tocado en toda la fase 3.C                                  |
| **`supabase/migrations/`** | **Ocho migraciones**. Las dos últimas son las dos mitades del writer autoritativo |
| **`npm test`**             | **116/116** en verde                                                              |
| **`npm run verify`**       | Verde — typecheck de app y tests, lint y formato                                  |
| **E18 · E19 · E20**        | Reproducidos de extremo a extremo contra el stack local, con **teardown limpio**  |

**Cómo comprobarlo en una sesión nueva**, sin depender de esta tabla:

```bash
git log --oneline main..HEAD
git status --porcelain -uall
```

**Las migraciones ya han empezado.** `supabase/migrations/` contiene ocho:

1. **`bootstrap_data_boundary`** — los tres schemas, los revokes explícitos y el
   saneamiento de default privileges (§13 bis);
2. **`operation_version_ledger`** — la espina dorsal del versionado:
   `core.currency_definition`, `core.operation`, `core.operation_version` y
   `core.client_command`, más el rol `nomey_writer` y
   `sec.request_actor_id()`, con RLS y grants desde el nacimiento (§13 ter);
3. **`scope_participant_effect`** — `core.scope`, `core.participant`,
   `core.membership` y `core.effect`, más el helper `sec.is_member(uuid)` y la
   RLS de lectura del cliente que faltaba sobre `operation` y
   `operation_version` (§13 quater);
4. **`participant_identity_periods`** — `core.participant_user_link`,
   `core.participant_period` y la extensión `btree_gist` (§13 quinquies);
5. **`contextual_split_and_conversion`** — `core.split`,
   `core.split_participant` y `core.frozen_conversion` (§13 sexies);
6. **`canonical_projection_and_attribution`** — `core.scope.owner_user_id`,
   `core.current_effect`, `api.personal_effect` y `api.claimed_dimension()`
   (§13 septies);
7. **`authoritative_writer_boundary`** — la infraestructura común del writer y
   **las cuatro clases que no producen deuda** (§13 octies). Es **7a**: la
   primera mitad.
8. **`authoritative_writer_debt`** — **las tres clases que crean o consumen
   deuda**, el protocolo de serialización de ADR-013 §11 y el único
   ensanchamiento de privilegio que quedaba (§13 nonies). Es **7b**.

**Con 7b, el writer autoritativo está completo** y no queda ningún bloque de
implementación abierto en 3.C. Lo que sigue vivo son limitaciones dichas —FX
cross-currency, provisioning— y ninguna de ellas pertenece a esta fase.

> **Con la quinta migración, el inventario de persistido autoritativo de
> ADR-013 §1 quedó COMPLETO**; **con la sexta existe la primera superficie `api`
> real y `src/types/database.ts` generado**; **con la séptima el cliente ya
> puede escribir**, y **con la octava la superficie de escritura son siete
> funciones y ninguna más**.

> **Cambio de etapa.** `supabase/e11`–`e20` eran evidencia desechable sobre
> maquetas y **nunca deben convertirse en migración**. A partir de aquí,
> `supabase/migrations/` es **estado real y versionado**, y
> `supabase/checks/` valida las migraciones de verdad, no una maqueta.

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
| `afe50ab` | 3.C.9 — E20                   |

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
tomada (§10). **Los transversales están cerrados** (§11 bis). **No hay fases
nuevas**; consultar [`product/roadmap.md`](../product/roadmap.md).

**Migrado hasta aquí:** bootstrap (§13 bis) · núcleo de operación y versión
(§13 ter) · ámbito, participante, membresía y efecto (§13 quater) · vínculo con
la cuenta y periodos de presencia (§13 quinquies) · reparto contextual y
conversión congelada (§13 sexies) · proyección canónica y atribución económica
(§13 septies) · **frontera autoritativa de escritura, primera mitad**
(§13 octies) · **segunda mitad, con la deuda serializada** (§13 nonies).

**No queda ningún bloque de implementación de 3.C.** El último fue 7b:

```
record_group_expense · record_debt_settlement · record_settlement_by_transfer
  + protocolo de serializacion de la deuda (ADR-013 §11)
  + UPDATE sobre core.scope, unico ensanchamiento de privilegio del writer
```

**El gate de §11 ter está cerrado** por
[ADR-016](../adr/ADR-016-economic-attribution.md). F10 construirá el claim, las
invitaciones y la fusión **sobre relaciones que ya existen**, no creándolas.

### Las seis puertas de 3.C

El roadmap enumera seis puertas para esta fase. **Todas cerradas**, cada una con
la fuente que lo sostiene:

| Puerta                                    | Estado      | Fuente                                                                                                                                                                                                                                   |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad de la definición monetaria      | **CERRADA** | [ADR-004](../adr/ADR-004-currency-definition-identity.md): `UUID` fijo y sembrado                                                                                                                                                        |
| Esquema expuesto por la Data API          | **CERRADA** | [ADR-005](../adr/ADR-005-schema-topology.md) §2, [ADR-006](../adr/ADR-006-privilege-model.md) §6 y [ADR-014](../adr/ADR-014-data-api-schema-exposure.md): `api` es la superficie; `core`, `sec` y **`public`** quedan fuera de `schemas` |
| Estrategia de `GRANT`                     | **CERRADA** | [ADR-006](../adr/ADR-006-privilege-model.md) §1-§4 y §7, medido en E12 y E13                                                                                                                                                             |
| Membresía en RLS                          | **CERRADA** | [ADR-007](../adr/ADR-007-membership-rls.md): helper reducido `SECURITY DEFINER`, sin claims en el JWT                                                                                                                                    |
| Mecanismo de idempotencia                 | **CERRADA** | [ADR-010](../adr/ADR-010-client-operation-idempotency.md) y [ADR-011](../adr/ADR-011-operation-version-model.md) §5, para el **origen cliente**                                                                                          |
| Frontera textual que cumple T7 de ADR-003 | **CERRADA** | [ADR-008](../adr/ADR-008-exact-data-boundary.md) §1-§2: vista `security_invoker` de `api` que proyecta texto, con test de catálogo                                                                                                       |

> **La puerta del esquema expuesto se completó con
> [ADR-014](../adr/ADR-014-data-api-schema-exposure.md)**, que resolvió el punto
> que ADR-005 §4 dejó abierto: **`public` no se expone**. La lista queda
> `["api", "graphql_public"]`, y `extra_search_path` no cambia. Ver §11.

**La entrada pendiente que el roadmap dejó sin conclusión** —de dónde salen los
privilegios `REFERENCES`, `TRIGGER` y `TRUNCATE` sobre tablas nuevas— **la
respondió E12**: son los default privileges de Supabase sobre `public`, son
ejecutables, y `MAINTAIN` es además invisible para `information_schema`.
ADR-006 §7 fija su saneamiento explícito.

---

## 3 · ADR aceptados

Los dieciséis están en estado `Aceptado`. **Una frase cada uno; el ADR manda.**

| ADR                                                          | Decisión principal                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [002](../adr/ADR-002-accounting-model.md)                    | Modelo centrado en la operación con efectos explícitos, versiones inmutables y frontera de escritura autoritativa en el servidor |
| [003](../adr/ADR-003-money-representation.md)                | Los importes son enteros en unidad mínima con su definición monetaria, y nada monetario cruza JSON como número                   |
| [004](../adr/ADR-004-currency-definition-identity.md)        | La identidad física de una definición monetaria es un `UUID` fijo y sembrado, opaco para el dominio                              |
| [005](../adr/ADR-005-schema-topology.md)                     | `core` para la persistencia, `api` como única superficie expuesta, `sec` para helpers; las tablas contables no se exponen        |
| [006](../adr/ADR-006-privilege-model.md)                     | Privilegio mínimo explícito, saneamiento de defaults, y las lecturas atraviesan vistas `security_invoker`                        |
| [007](../adr/ADR-007-membership-rls.md)                      | La RLS de `core` es la autoridad por fila, con un helper reducido y sin claims de membresía en el JWT                            |
| [008](../adr/ADR-008-exact-data-boundary.md)                 | Los valores exactos salen como texto y entran como JSON `string`, y la frontera debe poder comprobar el tipo JSON original       |
| [009](../adr/ADR-009-authoritative-write-boundary.md)        | Funciones por clase con payload `jsonb`, `SECURITY DEFINER` de un writer de mínimo privilegio sometido a RLS, en una transacción |
| [010](../adr/ADR-010-client-operation-idempotency.md)        | UUID generado y persistido por el cliente, unicidad por actor transversal a clases, comparación solo en servidor                 |
| [011](../adr/ADR-011-operation-version-model.md)             | Operación estable, versiones inmutables, efectos por versión y `client_command` como unidad física de idempotencia               |
| [012](../adr/ADR-012-participant-identity.md)                | Participante contextual por ámbito, vínculo con la cuenta en relación separada, y periodos de presencia                          |
| [013](../adr/ADR-013-persisted-vs-derived.md)                | Solo los hechos se persisten; saldos y deudas se derivan; el reparto es contextual y hay una proyección canónica de vigentes     |
| [014](../adr/ADR-014-data-api-schema-exposure.md)            | `public` no se expone por la Data API; la lista es `["api", "graphql_public"]`                                                   |
| [015](../adr/ADR-015-frozen-rate-physical-representation.md) | El tipo congelado se persiste como `(coefficient, scale)`; supersede solo la prescripción de `NUMERIC` de ADR-003 §4             |

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

> **Ya está instalada**, en el schema `extensions` y en la versión 1.7, desde la
> migración `participant_identity_periods`, que es la que trae
> `core.participant_period`. Lo medido está en §13 quinquies, y **el preflight
> de producción sigue vivo**: la documentación pública de Supabase no la
> enumera, así que su disponibilidad en el proyecto objetivo no está demostrada.

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

### Nada previo a las migraciones

**La lista de abiertos previos a migraciones está vacía.** El último era si
`public` permanecía en `api.schemas`, y lo cerró
[ADR-014](../adr/ADR-014-data-api-schema-exposure.md): **no permanece**.

> **Con una condición de secuencia medida.** El cambio de `config.toml` se
> aplica **en el mismo commit que cree el schema `api`**, no antes: con
> `schemas = ["api", …]` y sin ese schema, PostgREST falla con
> `3F000 schema "api" does not exist`, reintenta y nunca sirve, y
> `supabase start` aborta con el contenedor REST en `503`. Medido el
> 2026-08-25. Hasta entonces la configuración versionada conserva su valor
> actual.

> **Lo que ese experimento NO demuestra.** Midió que la configuración final es
> inválida sin el schema. **No midió** que, desde un clon limpio, Supabase
> aplique la migración que crea `api` **antes** de que PostgREST exija que
> exista. Que ambos cambios viajen en el mismo commit es **necesario**; que ese
> orden sea **suficiente** en el arranque real está **sin verificar**, y es un
> criterio de aceptación de la primera migración, no una decisión pendiente. No
> bloquea empezar.

### Producto y fases posteriores

Regla concreta de **resolución del FX** · mecanismo de **claim** (F10) · prueba,
token, email o SMS · **revocación y unlink** · **fusión** de participantes ·
**acceso residual** tras abandonar un ámbito · **retención y purga** ·
**anulación** de una operación como concepto distinto de la corrección · Modo
Pareja · Open Banking · recurrencias.

**Ninguno bloquea las migraciones**, y todos son **aditivos**: lo que persisten
hoy las relaciones decididas no cambia cuando se resuelvan.

Se les suma uno técnico del mismo tipo, que **ADR-010 dejó expresamente
abierto**: la **idempotencia de recurrencias, importaciones bancarias y
operaciones originadas en backend**. `core.client_command` es la unidad del
**origen cliente** (ADR-011 §5); un origen distinto necesitará su propia
garantía, y añadirla no altera esa relación.

**No inventar respuestas para estos puntos.**

---

## 11 bis · Cierre de los transversales previos a migraciones

Revisión del 2026-08-25, posterior a E20. **No introduce decisiones nuevas**:
comprueba qué estaba ya decidido y retira de la lista de pendientes lo que no lo
está.

### Superficie de lectura que 3.C necesita

**Solo la que exigen sus criterios de cierre.** No se diseña aquí la API de F6,
F9 ni F13.

| Objeto                                                                                  | ¿Ahora? | Fuente                                                                                                        |
| --------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| **Proyección canónica de efectos vigentes**, en `core`, vista simple `security_invoker` | **Sí**  | ADR-013 §9 — ya decidida, con su guarda de catálogo                                                           |
| **Vistas `api` `security_invoker` con cast a texto** sobre lo que el cliente lea        | **Sí**  | ADR-006 §5 · ADR-008 §1-§2 — son la frontera textual, no una comodidad                                        |
| Vistas de saldo, deuda, estadísticas y disponibles                                      | **No**  | Son **derivadas** y se construyen sobre la proyección canónica; su API pertenece a las fases que las consumen |
| Superficies de Grupo y Modo Pareja                                                      | **No**  | Roadmap: llegan en sus fases, por migración                                                                   |

**Lo que debe existir antes de cerrar 3.C es el camino, no el catálogo**: al
menos una vista de `api` que demuestre el camino completo
`core → security_invoker → texto → JSON string`, con su test de catálogo
(ADR-008 §2) y su test de aislamiento (roadmap, cierre 3 y 4).

### Nombres físicos

Los ADR aceptados **ya fijan por uso** estos, y no se renombran:

`core.operation` · `core.operation_version` · `core.effect` ·
`core.client_command` · `core.participant` · `core.participant_user_link`

**Ya migrados y por tanto fijados**: `core.operation`, `core.operation_version`,
`core.client_command`, `core.currency_definition`, `core.scope`,
`core.participant`, `core.membership`, `core.effect`,
`core.participant_user_link`, `core.participant_period`, `core.split`,
`core.split_participant`, `core.frozen_conversion`, el rol `nomey_writer`,
`sec.request_actor_id()` y `sec.is_member(uuid)`.

Queda **un solo** concepto con semántica cerrada y nombre todavía no fijado, que
la migración nombrará: la **proyección canónica** (ADR-013 §9).

> **No se cambia el modelo para conseguir nombres mejores.** Nombrar es trabajo
> de la migración; lo que no puede hacer la migración es **inventar semántica**
> que ningún ADR haya fijado.

### Índices y restricciones

Tres grupos, y solo dos se aplican ahora:

1. **Corrección e invariantes** — el linaje de versiones y el puntero de
   vigencia (ADR-011 §11, las seis constraints medidas en E17) · las tres
   cardinalidades del vínculo participante ↔ usuario (ADR-012, E18) · la
   exclusión de solapes de periodos, que **exige `btree_gist`** (E18, §9) · los
   invariantes de dimensión de `effect` y de reparto (ADR-013 §5 y §8).
2. **Claves únicas, FK y protocolo de bloqueo** — `UNIQUE (operation_id, version_no)`
   como backstop (ADR-011 §12) · `UNIQUE (created_by, client_operation_id)`
   transversal a clases (ADR-010) · las FK compuestas diferibles (ADR-011 §4 y
   §5) · el índice que sostiene el `SELECT … FOR UPDATE` del protocolo de deuda
   (§10 bis).
3. **Rendimiento puro** — **aplazados hasta medir.** No se añade ninguno
   especulativo.

**`btree_gist` va al schema `extensions`**, que es donde este stack ya instala
`pgcrypto`, `uuid-ossp` y `pg_stat_statements`. No es una decisión nueva: es la
convención medida del stack. El preflight de §9 sigue en pie.

### Caché de saldos

**Cerrada, y se retira de todo listado de pendientes.** ADR-013 §1: no hay caché
económica en v1, y saldo, deuda, estadísticas, `Disponible actual` y
`Disponible tras saldar` son **derivados sin excepción**. Una caché posterior
sería **aditiva** y exigiría medición, no previsión.

### Vectores compartidos y correcciones

**El formato de `tests/vectors/` no necesita extenderse antes de migrar**, y
esto corrige el planteamiento de §15.

La razón es que **la vigencia no es una regla de derivación**. `src/domain/`
deriva los efectos de **la intención de una operación**, y no tiene —ni necesita—
noción de versión ni de comando. Una V2 se deriva exactamente igual que
cualquier operación, con sus propias entradas, incluido un tipo heredado. Lo que
ADR-002 §7 obliga a reproducir es **esa derivación**.

Los cuatro casos que §15 reclamaba prueban otra cosa:

| Caso                                          | Qué prueba en realidad             | Dónde va                |
| --------------------------------------------- | ---------------------------------- | ----------------------- |
| V1 histórica · V2 vigente · solo V2 cuenta    | **Vigencia** y proyección canónica | Integración de servidor |
| Replay idempotente que no crea V3             | **Idempotencia** del comando       | Integración de servidor |
| Corrección sobre versión obsoleta → conflicto | **CAS** y concurrencia             | Integración de servidor |

Ninguno es una derivación, así que **ninguno pertenece a los vectores
compartidos**. Se implementan como tests de integración cuando exista la
frontera autoritativa.

### Hallazgos de E20

Todos determinados antes de migrar, sin sonda nueva: actor derivado de la
petición (ADR-009 §3) · writer `NOLOGIN`, no propietario y `NOBYPASSRLS`
(ADR-009 §5) · políticas por comando y por rol, lectura cross-author incluida
(ADR-013 §10) · `WITH CHECK` de `effect` (ADR-013 §10) · `GRANT UPDATE` por
columna sobre el puntero (§10) · `SELECT … FOR UPDATE` y su fallo silencioso
(§10, §10 bis) · `RETURNING` y su política de `SELECT` (§10) · las dos barreras
que no se sustituyen (ADR-009 §6).

**Queda un detalle de implementación, no una decisión:** un `sub` malformado
sale como `22P02` y no como `42501`, así que el helper de producción **valida el
UUID explícitamente** en vez de dejarlo al cast. No hace falta medir nada más.

---

## 11 ter · Una delegación que se quedó sin recoger — CERRADA

> **Cerrada el 2026-08-26 por
> [ADR-016](../adr/ADR-016-economic-attribution.md).** Se conserva el
> planteamiento porque explica **por qué** hizo falta un ADR propio y no bastaba
> con documentarlo aquí. Lo que sigue describe el hueco tal como se encontró.

Detectada el 2026-08-25 al migrar el vínculo participante↔usuario. **No es una
contradicción entre ADR** y no bloqueaba nada de lo ya migrado, pero había que
resolverla antes de la proyección canónica.

[ADR-012](../adr/ADR-012-participant-identity.md), en su «Fuera de alcance»,
delega expresamente:

> Delegado a **D11**: la proyección canónica de efectos vigentes deberá resolver
> también **qué efectos son «míos»**, que es una pregunta sobre el vínculo y no
> sobre la membresía.

**[ADR-013](../adr/ADR-013-persisted-vs-derived.md) es D11, y no la recoge.** No
menciona el vínculo, ni la pregunta, en todo el documento — comprobado por
búsqueda, no por lectura. Su §9 define la proyección canónica **por vigencia**, y
su §10 define la visibilidad **por membresía del ámbito**. Ninguna de las dos
responde «cuáles de estos efectos son míos», que es lo que necesita el Modo
Personal para incorporar el historial de un participante reclamado
(`data-model.md` §6, «reclamación retroactiva»).

**Por qué no bloquea hoy.** La pregunta solo tiene consumidor cuando exista la
proyección canónica **y** haya vínculos, y hoy no hay ninguna de las dos cosas:
`core.participant_user_link` no puede recibir filas todavía. Por eso el bloque
del vínculo no concede lectura de cliente sobre él: conceder ahora sería decidir
por adelantado algo que pertenece a un ADR.

**Qué hay que decidir**, y no se inventa aquí: si «mío» se resuelve por el
vínculo del participante con la cuenta, si eso vive en la proyección canónica o
en una superficie aparte, y qué ocurre con los efectos cuyo participante
económico es nulo, que son precisamente los del Modo Personal.

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

## 13 bis · El bootstrap de migraciones, validado

Ejecutado el 2026-08-25, desde Ubuntu con `./scripts/supabase-cli.sh`.

**Lo que quedó demostrado:**

- **Las migraciones se reconstruyen desde cero.** Dos `db reset` consecutivos,
  **38 s cada uno**, con resultado idéntico y sin intervención manual.
- **El criterio que ADR-014 dejó abierto está verificado.** `supabase start`
  desde frío ejecuta `Starting database → Applying migration → Starting
containers`: **la migración se aplica antes de que PostgREST arranque**, así
  que `api` existe cuando carga su caché de esquema. No se reprodujo el `503`.
- **`public` dejó de estar expuesto**, en comportamiento y no solo en
  configuración: `api` responde `200` y `public`, `core` y `sec` responden
  **`406 PGRST106`**, con PostgREST declarando
  «Only the following schemas are exposed: api, graphql_public».
- **`/mnt/c` es aceptable** para este trabajo: 38 s por reset, 47 s el arranque
  en frío. No se migra el repositorio al filesystem de Linux.

> **Hallazgo operativo que conviene no olvidar: `db reset` no relee
> `config.toml`.** Recrea la base y recarga la caché de esquema, pero **no
> vuelve a renderizar el entorno de los contenedores**. Se midió: tras cambiar
> los schemas expuestos y hacer `db reset`, PostgREST seguía sirviendo la lista
> anterior. Aplicar `config.toml` exige `stop` + `start`.

**Un límite del saneamiento, dicho explícitamente.** ADR-006 §7 se implementa
para el rol **`postgres`**, que es con el que corren las migraciones y, por
tanto, todo lo que Nomey cree. Los default privileges que `supabase_admin`
mantiene sobre `public` **siguen concediendo a los roles cliente** y no se tocan:
son del stack, no de Nomey, y alterarlos desde `postgres` no procede. La segunda
capa sigue siendo ADR-014: `public` ya no tiene ruta HTTP.

---

## 13 ter · El núcleo de operación, versión y comando

Segunda migración real, `operation_version_ledger`. Materializa la **espina
dorsal del versionado**: `core.currency_definition`, `core.operation`,
`core.operation_version` y `core.client_command`, con el rol `nomey_writer`, el
helper `sec.request_actor_id()`, y RLS y grants **en la misma migración**.

**Lo verificado**, con dos `db reset` de **44 s** y resultado idéntico:

- el linaje de versiones rechaza `version_no = 0`, una V1 con predecesor, una V2
  sin predecesor, la autorreferencia y el `version_no` duplicado;
- el **puntero de vigencia** no acepta la versión de otra operación, ni un
  comando puede declarar como resultado una versión de otra operación;
- la **idempotencia estructural** funciona: el mismo actor no reutiliza su
  `client_operation_id` **ni con otra clase**, y otro actor **sí** puede usar el
  mismo UUID;
- la **RLS actúa como segunda barrera** con la frontera funcional aún ausente:
  rechaza atribuir una operación o una versión a otro actor;
- la **corrección cross-author no está bloqueada**: B lee la V1 de A, crea la V2
  atribuida a B y mueve el puntero; y **no** puede devolver la vigencia a una
  versión que no creó;
- el `UPDATE` del writer está acotado **por columna**, no por política.

### Qué protege el linaje, y qué no

**Medido contra la migración real**, no deducido del ADR:

| Propiedad                                            | ¿Estructural hoy?    |
| ---------------------------------------------------- | -------------------- |
| El predecesor pertenece a la **misma operación**     | **Sí**, FK compuesta |
| El puntero de vigencia es de la **misma operación**  | **Sí**, FK compuesta |
| `version_no >= 1`, sin duplicados, V1 sin predecesor | **Sí**               |
| Sin autorreferencia                                  | **Sí**               |
| El predecesor es **exactamente** la versión anterior | **No**               |
| **Ausencia de bifurcación**                          | **No**               |
| Monotonía de `version_no` respecto al predecesor     | **No**               |

Es decir: hoy la base acepta una V3 que supersede a V1 saltándose la V2, y
acepta que **varias versiones supersedan a la misma**. Se comprobó insertándolo.

> **No es un defecto: está reservado.** [ADR-011](../adr/ADR-011-operation-version-model.md)
> §11 lo dice expresamente —«una V4 podría superseder a V2 sin violar
> ninguna… ese invariante pertenece a la frontera autoritativa»— y añade que no
> se simula con una restricción imposible.

**Sobre la bifurcación hay una opción real que no se adopta.** Un
`UNIQUE (operation_id, supersedes_version_id)` la impediría, es barato y se
comprobó que detecta el estado bifurcado. **No se añade** porque cerraría un
escenario que ADR-013 §4 deja expresamente abierto: una **anulación o
revocación** futura podría devolver la vigencia a una versión anterior, y
corregir desde ahí crearía legítimamente una segunda versión que supersede a la
misma. Adoptarlo sería decidir por adelantado algo que pertenece a un ADR.

### Por qué `core.effect` no entra en esta migración

Sus FK normativas exigen **`core.scope` y `core.participant`** —ADR-012 §3 fija
que los efectos referencian **siempre** al participante contextual, y el
participante es contextual **por ámbito**— y su política de lectura de cliente
es la **membresía del ámbito** mediante el helper de ADR-007 §2 (ADR-013 §10),
que necesita la relación de membresía usuario↔ámbito. **Son tres relaciones
más, con su propia RLS: un bloque, no un apéndice de este.**

> **Esas tres relaciones son de la Fase 3.C, no de una fase posterior.** El
> roadmap incluye **«Auth técnico con usuarios reales»** en el alcance de 3.C, y
> la Fase 5 declara como dependencia **«F3.C (Auth técnico y RLS)»** y como
> objetivo _«que la app sepa quién es el usuario, sobre el Auth técnico que ya
> existe desde 3.C»_. Lo que llega en F5 es la **experiencia** de identidad —
> registro, login, recuperación, sesión, rutas protegidas—, **no** la relación
> física que la RLS necesita.

**No hay estado intermedio inválido por esperar al bloque siguiente.** `effect`
simplemente no existe, igual que `operation` no existía antes. Por la misma
razón, `operation` y `operation_version` nacen **sin políticas de lectura de
cliente** —las suyas derivan de los efectos visibles— y **sin grants de
lectura**: con RLS activada y sin política el resultado es **denegación total**,
que es el estado seguro.

### Lo que queda estructural frente a lo que necesita el writer

`core.client_command` da hoy la **unicidad**: `(created_by, client_operation_id)`
transversal a clases. **Eso no es la idempotencia completa.** El _replay_ —
reconocer un comando repetido, devolver el resultado anterior y **no** crear una
V3— es una secuencia que vive en la frontera autoritativa (ADR-011 §13) y se
demuestra con ella, no con una restricción. No se simula aquí.

---

## 13 quater · El ámbito, el participante, la membresía y el efecto

Tercera migración real, `scope_participant_effect`. Cierra el **conjunto mínimo
que `core.effect` necesita para existir con integridad y con RLS**, que es la
razón por la que §13 ter lo dejó fuera. Verificado con **dos `db reset`** de 35 s
y 31 s, resultado idéntico, más un arranque en frío con la topología de CI.

### Decisiones que se tomaron al materializarlo

Ninguna reabre un ADR; todas eligen entre formas que ningún ADR fijaba.

| Punto                                          | Decisión                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Moneda del efecto                              | FK **compuesta** `(scope_id, currency_definition_id) → scope (id, base_currency_definition_id)`            |
| Ciclo de vida de la membresía                  | **Presencia pura**: la fila existe ⇔ la membresía está activa. **No es historial**                         |
| `scope.kind`                                   | Vocabulario **cerrado** por `check (kind in ('personal','group','couple'))`                                |
| FK hacia `auth.users`                          | **Ninguna**, igual que `operation.created_by`: la retención y la purga siguen abiertas                     |
| `scope.created_by`                             | **No existe.** El creador no participa en autorización, propiedad, moneda, efectos ni identidad del ámbito |
| `participant_period` · `participant_user_link` | **Fuera de esta migración**, dentro de 3.C. Con ellas llegará `btree_gist`                                 |

**La FK compuesta de moneda hace dos cosas a la vez**, y por eso se adoptó: un
efecto no puede estar en una moneda distinta de la base de su ámbito (ADR-002
§8), y la moneda base **no puede cambiar mientras existan efectos**, que es la
inmutabilidad «tras la primera operación» del invariante 12 convertida en
estructura. Medido en ambos sentidos: con efectos se rechaza con `23503`, sin
efectos el cambio sigue permitido, tal como exige `data-model.md` §10.

> **La membresía no es un historial y no debe reinterpretarse como tal.** Si
> algún día hace falta el histórico de entradas y salidas, se modela
> conscientemente en su propia relación. Añadir aquí un `until` en silencio
> cambiaría el significado de todas las filas ya escritas.

### `sec.is_member(uuid)`

Cumple los ocho requisitos de ADR-007 §2: `SECURITY DEFINER`, `STABLE`,
`search_path = ''` con referencias cualificadas, `auth.uid()` **interno**, acepta
**solo** el ámbito, devuelve `boolean`, `REVOKE EXECUTE FROM PUBLIC` y `GRANT` a
`authenticated` **sin `USAGE` sobre `sec`**.

Se escribió con cuerpo **`BEGIN ATOMIC`** y se comprobó contra el stack —no se
adoptó por estética—: deja la dependencia de catálogo hacia `core.membership`
que E19 midió que los cuerpos textuales **no** dejan, de modo que la tabla no
puede caer sin `CASCADE` mientras el helper la use.

### Qué quedó medido sobre la frontera de lectura

- **La RLS filtra por FILA, no por operación.** Con una operación cuyos efectos
  caen en el ámbito de A y en el de B, cada uno ve la operación y su versión —
  ADR-013 §2 concede la clase— y **solo su propio efecto**. Es el caso que hace
  utilizable ADR-002 §10.
- **Una operación sin ningún efecto en tus ámbitos es invisible**, con su
  versión.
- **`core.membership` no es legible por el cliente ni a través de una superficie
  de `api`**: falta el `GRANT`, así que el fallo es `42501` y no una lista vacía.
- **El helper no es invocable por nombre** por el rol cliente, contra la
  migración real y no ya sobre una maqueta.
- **Sin JWT no se ve nada**: `auth.uid()` es nulo y no hay membresía que casar.

### Lo que este bloque NO concede, y hay que no olvidar

- **`INSERT` del writer sobre ámbito, participante y membresía.** Ningún ADR fija
  un `WITH CHECK` para esas altas, y un `with check (true)` aparentaría una
  barrera inexistente. Llegan con los comandos que las ejecutan.
- **La `UPDATE` de `core.scope` que el protocolo de deuda necesitará.** Bloquear
  la fila estable de un ámbito (ADR-013 §11, paso 2) exige **dos cosas**, no una:
  la **policy** de `UPDATE` que midió E20 —cuya ausencia devuelve cero filas sin
  error— **y además el privilegio**. La documentación de PostgreSQL es explícita:
  las cláusulas de bloqueo requieren `UPDATE` sobre al menos una columna. Cuando
  llegue, el candidato natural es `GRANT UPDATE (base_currency_definition_id)`,
  porque es una capacidad real del writer y la FK compuesta ya impide ejercerla
  con efectos existentes.
- **Índices de rendimiento.** Las policies de `operation` y `operation_version`
  recorren `core.effect`. Es el grupo 3 de §11 bis: aplazado hasta medir.

### Una incompletitud de la migración anterior, corregida

`core.currency_definition` nació con RLS activada, con `GRANT SELECT` a
`nomey_writer` y **sin ninguna policy**. No rompía nada porque todavía no existe
ninguna función autoritativa, pero en cuanto exista esa lectura habría devuelto
**cero filas sin error** — el mismo modo de fallo silencioso que E20 midió sobre
las versiones. Se añade su policy de `SELECT`.

**Y se añade la comprobación genérica que lo habría detectado**: un `GRANT
SELECT` sobre una tabla de `core` con RLS que no tenga **ninguna** policy de
`SELECT` aplicable a ese mismo rol. La regla se dispara por el **grant**, no por
la tabla, de modo que `membership` y `client_command` —que deliberadamente niegan
la lectura— no la incumplen: sin grant no hay nada que quede inutilizado.

### `auth.uid()` sin GoTrue — resuelto

Era la única incógnita operativa del bloque, porque el job de base de datos de CI
excluye `gotrue` y toda la RLS de lectura del cliente depende de esa función.

**Medido sobre un arranque en frío con la topología exacta de CI** —solo
`postgres`, `kong` y `postgrest`—: `auth.uid()` **existe y funciona**. Viene de
los scripts de inicialización de la imagen `supabase/postgres`, no de GoTrue,
resuelve `request.jwt.claims` simulado y devuelve `NULL` sin claims. `auth.users`
también existe por la misma vía, aunque este bloque no la referencia.

**Consecuencia práctica:** los tests de aislamiento a nivel de base de datos no
necesitan usuarios reales de GoTrue, y CI no cambia de topología.

---

## 13 quinquies · El vínculo con la cuenta y los periodos de presencia

Cuarta migración real, `participant_identity_periods`. Materializa las **dos
relaciones que ADR-012 separa expresamente** de `participant` y de `membership`,
y trae `btree_gist`. Verificado con **dos `db reset`** de 33,7 s y 31,8 s,
resultado idéntico.

Las tres preguntas siguen separadas, y colapsar dos de ellas es el error que
ADR-012 existe para evitar:

| Relación                     | Pregunta                                     |
| ---------------------------- | -------------------------------------------- |
| `core.membership`            | ¿Qué puede ver o hacer **ahora** una cuenta? |
| `core.participant_user_link` | ¿Qué cuenta es esa identidad contextual?     |
| `core.participant_period`    | ¿**Cuándo** era elegible ese participante?   |

### Decisiones tomadas al materializarlo

| Punto                        | Decisión                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Granularidad temporal        | **`date`**, no `timestamptz`                                                            |
| Representación del intervalo | Dos columnas + **expresión** `daterange(valid_from, valid_until, '[)')` en la `EXCLUDE` |
| Clave del periodo            | `primary key (participant_id, valid_from)`                                              |
| Auditoría del vínculo        | Solo `linked_at`. El actor y la procedencia llegan con F10                              |
| Escritura                    | **Ninguna**, para nadie: ni cliente ni writer                                           |
| Lectura del cliente          | **Ninguna**, para ninguna de las dos                                                    |

**La granularidad es `date` porque lo es su único consumidor.** La elegibilidad
se evalúa contra la **fecha efectiva** de una operación (`data-model.md` §7,
ADR-012 §7) y `operation_version.effective_date` es `date`. Comparar una fecha
con un instante introduciría una pregunta de zona horaria que ningún ADR ha
decidido. **Consecuencia aceptada:** dos periodos del mismo participante no
pueden empezar el mismo día, lo cual es indistinguible para la única pregunta
que los periodos responden.

**Se usa la expresión y no una columna generada** para que la forma de la
relación siga siendo exactamente la que ADR-012 §5 describe, sin un tercer sitio
donde el mismo dato pueda decir otra cosa.

### Por qué el vínculo nace con `linked_at` y nada más

ADR-012 §10 exige que un vínculo aceptado permita determinar **cuándo**, **qué
participante y qué cuenta**, **qué actor o proceso autoritativo** lo estableció y
**qué procedencia** lo justificó — pero fija como normativo **solo el instante**,
y advierte de que fijar `proof_kind` y `proof_ref` ahora **prejuzgaría la forma
de la prueba**, que pertenece a F10. Una columna `linked_by uuid` prejuzgaría
igual: §10 dice «actor **o proceso** autoritativo», y no está decidido que el
autor sea siempre una cuenta.

**Añadirlas después no reproduce la asimetría de ADR-012 §2** —que descartó la
columna `user_id` nullable porque migrar obligaría a inventar cuándo y con qué
prueba se establecieron los vínculos existentes— porque **esta relación no puede
recibir ninguna fila todavía**: nadie tiene `INSERT`, ni el cliente ni el writer,
y no existe comando autoritativo que la escriba. No hay historial que inventar
sobre cero filas, y ese vacío es estructural, no una promesa: los checks lo
comprueban.

### Por qué ninguna de las dos es legible por el cliente

No es una omisión; son dos negativas razonadas, y ninguna se concede «por
comodidad»:

- **El vínculo** responde a _«¿cuáles de estos efectos son míos?»_ (ADR-012 §8),
  y ADR-012 delegó esa pregunta en la proyección canónica de **D11** — que
  **ADR-013 no llegó a resolver** (ver §11 ter) y que todavía no existe.
  Exponerlo hoy revelaría además **qué cuenta global** hay detrás de cada
  identidad contextual, y ADR-012 §1 hace del no correlacionar identidades el
  motivo mismo de que el participante sea contextual.
- **Los periodos** son entradas de una **validación autoritativa** (ADR-012 §7),
  no de una pantalla. Nada de lo que existe hoy los lee desde el cliente.

Ambas nacen con RLS y sin policy de cliente: denegación total, el mismo estado
seguro con el que nacieron `operation` y `operation_version`.

### `btree_gist`

Instalada en **`extensions`**, versión **1.7**, que es la convención medida del
stack —allí están ya `pgcrypto`, `uuid-ossp` y `pg_stat_statements`—.

Reproducido contra este stack antes de escribir la migración, no heredado de
E18: sin la extensión, `EXCLUDE USING gist (uuid WITH =, …)` falla con **`42704 ·
data type uuid has no default operator class for access method "gist"`**; con
ella, el solape se rechaza con **`23P01`**, el periodo contiguo se acepta, la
reentrada se acepta, un **segundo periodo abierto** se rechaza y el **mismo
intervalo para otro participante** se acepta.

> **El preflight de producción sigue vivo, y no se cierra desde documentación.**
> La documentación pública de Supabase **no enumera** `btree_gist` entre las
> extensiones que ofrece, así que su disponibilidad en el proyecto objetivo
> **no está demostrada**. Es una extensión estándar de `contrib` y el stack local
> corre la misma familia de imagen, pero eso es una **inferencia**, no una
> medición sobre el destino. El procedimiento concreto está en el runbook, y si
> algún entorno objetivo no la ofreciera, ADR-012 §5 obliga a **revisar** el
> mecanismo, no a sustituirlo preventivamente.

### Lo que las regresiones deliberadas enseñaron

Una de ellas **encontró un fallo real en el propio test**, que es para lo que
existen: comprobar la denegación del cliente con un `select` directo sobre `core`
**no probaba nada** sobre estas dos tablas, porque `authenticated` no tiene
`USAGE` sobre el schema y habría fallado igual con el `GRANT` puesto. La
comprobación pasa por la superficie `security_invoker` de `api`, que es la única
forma de aislar la ausencia de grant.

La otra que conviene recordar: relajar `[)` a `[]` **no la ve el catálogo** —la
restricción de exclusión sigue existiendo— y la detecta la aserción de
comportamiento sobre periodos contiguos. Es exactamente el invariante que
ADR-012 §5 fija.

---

## 13 sexies · El reparto contextual y la conversión congelada

Quinta migración real, `contextual_split_and_conversion`. Cierra los **cuatro
hechos económicos** que faltaban del inventario de ADR-013 §1: la cabecera de
reparto, la intención declarada, el resultado resuelto y las conversiones
congeladas. **Con ella, ese inventario queda completo.**

### La contradicción documental que hubo que resolver

`core.frozen_conversion` obligó a elegir entre dos formas físicas del mismo
número, ambas respaldadas por ADR aceptados:

| Fuente        | Forma                                                     |
| ------------- | --------------------------------------------------------- |
| ADR-003 §4    | «`NUMERIC` es la representación del valor decimal exacto» |
| ADR-013 §6    | se congela «**coeficiente exacto · escala**»              |
| ADR-008 §4    | coeficiente como `string`, escala como entero acotado     |
| `src/domain/` | `ExchangeRate { coefficient: bigint; scale: number }`     |

**Resuelto por [ADR-015](../adr/ADR-015-frozen-rate-physical-representation.md)**,
que supersede **exclusivamente** esa prescripción de ADR-003 §4 y conserva sus
cuatro garantías. No se enmendó ningún ADR aceptado: `docs/adr/README.md` los
declara inmutables, y lo único que se actualiza es la metadata de estado.

`rate_scale` está acotado a **`0..12`**, que es la cota que ADR-003 §4 exigía
declarar y delegaba al esquema. **`12` es el máximo, no una escala fija:** un
tipo de otra magnitud usa otra escala, y magnitud y precisión dependen de ambas
conjuntamente. Los cuatro límites están probados: 0 y 12 aceptadas, −1 y 13
rechazadas, coeficiente 0 y negativo rechazados.

### Qué quedó estructural

| Invariante                                                             | Mecanismo                             |
| ---------------------------------------------------------------------- | ------------------------------------- |
| Un reparto ocurre en **exactamente un ámbito**, uno por versión        | PK `(operation_version_id, scope_id)` |
| Los participantes del reparto **son de ese ámbito**                    | FK compuesta hacia `participant`      |
| El método de una fila **no diverge** del de su cabecera                | FK compuesta hacia `split`            |
| El pagador, si existe, **figura entre los participantes**              | FK compuesta **diferible**            |
| Un participante una sola vez · ordinal único · ordinal ≥ 0             | PK, `UNIQUE`, `CHECK`                 |
| `shares` ↔ peso · `exact_amounts` ↔ importe · declarados **positivos** | `CHECK`                               |
| En `exact_amounts`, **declarado = resuelto**                           | `CHECK`                               |
| El resuelto **no es negativo**, y **cero es válido**                   | `CHECK`                               |
| El destino de la conversión **es la moneda base del ámbito**           | FK compuesta hacia `scope`            |
| El origen **es la moneda del importe original** de esa versión         | FK compuesta **triple**               |
| La fecha resuelta **coincide con la fecha efectiva**                   | la misma FK triple                    |
| `source <> target` · coeficiente > 0 · escala 0..12                    | `CHECK`                               |

La FK triple necesitó añadir
`UNIQUE (id, effective_date, original_currency_definition_id)` a
`core.operation_version`. Es aditivo sobre un superconjunto de su clave
primaria: no restringe nada que antes fuera posible. Es la primera vez que un
bloque toca una tabla de una migración anterior.

### Qué NO quedó estructural, y se dice

> **«Todo reparto contiene al menos un participante» es un invariante de la
> frontera autoritativa, no de las tablas.**

Una cabecera **sin pagador y sin filas** es físicamente insertable: la FK
diferible del pagador solo muerde cuando hay pagador, y ninguna restricción
declarativa puede exigir la existencia de filas hijas. **No se añade un trigger
para simularlo**, por el mismo criterio con el que ADR-011 §11 reservó a la
frontera que el predecesor sea exactamente la versión anterior.

El check lo comprueba **en positivo**: inserta esa cabecera vacía y verifica que
la base la acepta. Si algún día la rechazara, es esta documentación la que
estaría obsoleta.

Tampoco son estructurales, y siguen en el writer: que los declarados de
`exact_amounts` sumen el total · que los resueltos sumen el total · la
elegibilidad del participante en la fecha efectiva.

### Dos redundancias que no lo son

1. **`split_participant.resolved_amount` frente a `effect.economic_amount`.**
   Coinciden en un gasto de grupo y **divergen en el reparto final del Modo
   Pareja**, donde los resueltos se convierten en efectos de **saldo** en dos
   Modos Personales distintos. ADR-013 §1 persiste ambos a propósito, y ADR-002
   §5 da el motivo: se conservan **intención y resultado**.
2. **`declared_amount` frente a `resolved_amount` en `exact_amounts`.** Son
   iguales siempre, y por eso hay un `CHECK` que lo impone. La columna sigue
   existiendo porque esa igualdad es una propiedad **de ese método**, no del
   modelo.

### Lo que no se persiste, y por qué

- **El importe convertido.** Reproducible con un único redondeo desde el importe
  original, el coeficiente, la escala y la escala destino, y ya resuelto en los
  efectos. El check comprueba que **no existe columna** donde ponerlo.
- **Una referencia a catálogo FX.** ADR-013 §6: se congela el valor, no una
  referencia.
- **La procedencia.** Opcional y no autoritativa; fijar su forma prejuzgaría al
  proveedor, que ADR-003 §4 deja fuera de alcance.

### El redondeo no tiene entidad propia

Se reproduce por sus **entradas**, y todas están persistidas:
`rate_coefficient` · `rate_scale` · `payer_participant_id` · `ordinal` ·
`economic_rules_version`. Y `resolved_amount` conserva el resultado.

> **El `ordinal` es la pieza que suele olvidarse.** Es la entrada del paso 5 del
> desempate de ADR-002 §5. Sin él, un replay podría asignar el céntimo sobrante
> a otra persona **y la suma seguiría cuadrando**.

El caso de `data-model.md` §5 está en el check como positivo: 0,01 € con pesos
1·2·2 deja al **pagador resuelto en 0**, y es válido porque lo **declarado** era
positivo.

### Correcciones e idempotencia

Las tres relaciones llevan `operation_version_id` en su clave primaria, así que
**V2 crea las suyas y las de V1 permanecen intactas**, sin ninguna regla añadida.
Heredar el FX es **copiar el valor** congelado a la fila de V2, nunca compartir
una fila mutable con V1 — y el writer no tiene `UPDATE` ni `DELETE`.

El replay **no necesita nada nuevo**: `core.client_command` ya apunta a la
versión, y estas tres relaciones hacen que su resultado sea legible entero **sin
volver a resolver FX ni a redondear**.

### Lo que las regresiones deliberadas enseñaron

Tres aserciones del propio check estaban mal construidas y las descubrió el
propio procedimiento, no una revisión:

- un duplicado de participante fallaba antes por un `CHECK` de `exact_amounts`
  que por la clave primaria;
- varios negativos de conversión chocaban con la clave primaria de un caso
  anterior en vez de con su propia restricción — se resolvió con un ámbito libre
  de conversiones;
- una regresión intentaba insertar un participante de otro ámbito y la rechazaba
  la FK de ámbito, no la constraint que se estaba probando.

**Aislar cada negativo contra la restricción que pretende probar no es
cosmético**: un negativo que pasa por el motivo equivocado es un test que no
prueba nada y que seguirá en verde cuando la garantía real desaparezca.

---

## 13 septies · La proyección canónica y la atribución económica

Sexta migración real, `canonical_projection_and_attribution`. Cierra el gate de
§11 ter y crea **la primera superficie `api` realmente útil para el cliente**,
que es lo que hace que `src/types/database.ts` exista por fin. Verificado con
**dos `db reset`** por la vía canónica.

**La decisión normativa está en
[ADR-016](../adr/ADR-016-economic-attribution.md)**; aquí solo lo físico.

### Las cuatro piezas

|                            | Qué es                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `core.scope.owner_user_id` | **Propiedad durable** del Modo Personal. No es membresía      |
| `core.current_effect`      | **Proyección canónica** de ADR-013 §9. `security_invoker`     |
| `api.personal_effect`      | Atribución **por ámbito**: saldo y económica sin participante |
| `api.claimed_dimension()`  | Atribución **por participante**: frontera privilegiada        |

### La propiedad, en una columna y no en una tabla

`kind = 'personal' ⇔ owner_user_id IS NOT NULL`, más un índice único sobre la
columna. Eso hace **estructurales las tres cardinalidades**: todo `personal`
tiene exactamente un dueño, `group` y `couple` no pueden tenerlo, y un usuario
tiene como máximo un Modo Personal.

Una tabla dedicada habría sido **más débil**: no puede exigir que la fila exista,
así que «todo Modo Personal tiene dueño» habría pasado a ser invariante del
writer. Es el mismo límite que la cabecera de reparto vacía.

> **No es una marcha atrás sobre `scope.created_by`.** Aquella columna se
> descartó porque el creador no participa en autorización, propiedad, moneda,
> efectos ni identidad. La propiedad económica **sí** participa: es portante de
> la atribución del saldo.

### Las dos rutas son disjuntas por construcción

```
por ambito       -> saldo · economica SIN participante   -> api.personal_effect
por participante -> economica CON participante · deuda   -> api.claimed_dimension()
```

Las de ámbito **no nombran participante** y solo aparecen en el Modo Personal;
las de participante **nunca aparecen** en un Modo Personal, porque el dominio
produce ahí `participant: null`. **Cada dimensión tiene exactamente un camino**,
así que no hay doble contabilización. El sexto check lo comprueba en cada
ejecución en vez de confiar en ello.

### Por qué la frontera privilegiada, y por qué en `api`

Medido antes de escribirla: con la RLS actual, un usuario vinculado a un
participante de un grupo del que no es miembro alcanza **cero** efectos. Sin
frontera, la reclamación retroactiva de `data-model.md` §6 no recupera nada.

**Ampliar la RLS de `core.effect` no vale, y se midió la fuga.** Con una policy
de pertenencia por dimensión, quien es **solo el deudor** de una fila mixta
obtiene además el importe económico de un participante ajeno, la identidad del
acreedor y el `scope_id`. No es un defecto de la policy: la RLS acota **filas, no
columnas**, como E20 ya había medido.

**Vive en `api` y no en `sec` por una razón medida:** el rol cliente **no puede
invocar funciones de `sec` por nombre** —`permission denied for schema sec`—
porque ADR-007 §3 le niega el `USAGE` a propósito. Lo que sí puede una vista
`security_invoker` es llamarlas desde su cuerpo; eso también se midió, y responde
la incógnita que quedaba abierta del bloque anterior.

> **La frontera NO puede confiar en la proyección canónica.** Se midió: dentro de
> un `SECURITY DEFINER` cuyo owner es el propietario de las tablas, la proyección
> devuelve **todas** las filas. La guarda de ADR-013 §9 protege el camino de
> lectura normal, **no** el interior de un definer. Por eso el filtro por vínculo
> está en el `WHERE` del cuerpo, antes de proyectar nada.

**Su lista de columnas ES la frontera de privacidad**, y el check la comprueba
contra la firma: nada de `scope_id`, identificadores de participante, efecto,
operación o versión, ni las otras dimensiones de la fila.

### `database.ts`, y lo que demuestra

Generado sobre **`api`**, como fija ADR-008 §7, con la CLI del wrapper. El
resultado confirma el objetivo estructural de ese ADR: **todos los importes
aparecen como `string`**, nunca `number`.

```ts
balance_amount: string | null;
economic_amount: string | null;
amount: string;
```

No es una convención que haya que recordar: en `api` no hay ningún `int8`
alcanzable, y el sexto check lo verifica por catálogo.

### Rendimiento: medido, y sin índices nuevos

- **`auth.uid()` se evalúa una sola vez por consulta**, como `InitPlan`. El
  `(select auth.uid())` funciona.
- **`sec.is_member` se evalúa más de una vez por fila de efecto**, porque las
  policies de `operation` y `operation_version` vuelven a derivar de los
  efectos. Es visible en el plan como subplanes anidados.
- **`core.participant_user_link` se une por su clave primaria** pero se filtra
  por `user_id`, y no hay índice sobre esa columna sola: `UNIQUE (scope_id,
user_id)` no sirve para esa búsqueda.

**No se añade ningún índice**, y el motivo es que **la medición no demuestra
nada**: con una fila por tabla el planificador elige `Seq Scan` por tamaño, no
por falta de índice. Añadirlos ahora sería exactamente lo especulativo que el
grupo 3 de §11 bis aplaza. Los dos puntos de arriba quedan como **los primeros
candidatos a medir** cuando haya volumen.

---

## 13 octies · La frontera autoritativa de escritura · 7a

Séptima migración real y **primera mitad del writer**. Trae la infraestructura
común del protocolo autoritativo y las **cuatro clases que no producen deuda**.
Verificado con **dos `db reset`** por la vía canónica, de 35,3 s y 32,4 s, con
los **siete** checks en verde tras cada uno.

### La costura con 7b no es de tamaño

Es la de **ADR-013 §11**, que decide quién participa en el protocolo de
serialización de la deuda «por qué efectos produce, no por el nombre de la
clase». Ninguna de estas cuatro toca deuda, así que **7a no necesita el lock
sobre `core.scope` ni el ensanchamiento de privilegio que ese lock exige**. Eso
queda aislado en 7b para que se revise solo.

### Una función por clase, y cuántas clases hay

ADR-009 §1 pide «una función pública por clase de operación», y sus **propios
ejemplos** —`record_personal_expense` y `record_group_expense`— **comparten
clase contable**. Eso demuestra que «clase de operación» **no es** la clase
contable de ADR-002 §3, sino el **tipo** de operación de ADR-013 §2, que además
es vocabulario **abierto**. Son dos columnas distintas y el esquema ya las
separa:

| Columna                          | Vocabulario                                             |
| -------------------------------- | ------------------------------------------------------- |
| `core.effect.accounting_class`   | `income · expense · transfer · adjustment · settlement` |
| `core.operation.operation_class` | el **tipo** de operación, abierto                       |

**Los fixtures de los checks anteriores escribían el vocabulario contable en la
columna de la clase de operación.** No violaba ninguna constraint —el
vocabulario es abierto— pero era un precedente engañoso, y **7a lo corrige**.

Los valores van en `snake_case` y se corresponden uno a uno con los `kind` en
`camelCase` de los vectores. **La correspondencia se comprueba en las dos
direcciones** en la sección G del check, porque es la única pieza que vive en
dos sitios.

### Alta y corrección comparten función

La variante la marca el payload —`operation_id` + `expected_version_id`— y la
distingue el `command_type` (`<clase>.create` / `<clase>.correct`), de modo que
reutilizar la clave de un alta para corregir sea **conflicto** y no replay.
Corregir un gasto personal sigue siendo la misma clase de operación, y ADR-013
§7 obliga a derivar la corrección con las reglas vigentes **igual que un alta**:
compartir el cuerpo es lo correcto, y duplicarlo sería la fuente de deriva.

### El orden del protocolo, y por qué no es negociable

```
1 actor · 2 forma · 3 RECLAMO de la clave · 4 replay o conflicto
5 autorizacion actual · 6 lock de la operacion · 7 CAS
8 derivacion · 9 operacion/version/efectos · 10 puntero · 11 retorno
```

**Reclamar antes del CAS** (ADR-011 §13): sin eso, un reintento tardío de una
corrección —después de que otra persona confirmara la suya— fallaría como
edición obsoleta, el cliente concluiría que no se aplicó y podría generar una
intención nueva. Es justo el duplicado que ADR-010 existe para impedir, y el
check lo prueba en D5.

**Autorizar después del reclamo** (ADR-010 §5): el replay debe funcionar aunque
el actor haya perdido la autorización.

**Bloquear antes de comprobar**: si se insertara la versión primero, un
competidor que ya hubiera creado N+1 haría saltar `UNIQUE (operation_id,
version_no)` y el fallo se reportaría como violación de restricción en vez de
como conflicto. Y es lo que **resuelve el invariante que ADR-011 §11 reservó a
la frontera**: `supersedes_version_id` sale de la fila **bloqueada**, así que es
exactamente la vigente anterior.

**El puntero se mueve después de insertar la versión**, porque su `WITH CHECK`
exige que la versión referida esté atribuida al actor y E20 midió que la
subconsulta ve las filas insertadas y aún no confirmadas.

### La única captura de excepción permitida

El `unique_violation` del reclamo. Cualquier otra convertiría un fallo en
escritura parcial. El check comprueba que ninguno de los nueve rechazos de la
sección E deja efectos ni **comandos huérfanos**.

### La canonicalización no reformatea los valores exactos

ADR-011 §8 dice que la canonicalización «no degrada ni **reformatea** los valores
exactos», y redondear `"0050000"` a `"50000"` es reformatear: no pierde
exactitud, pero cambia la representación de precisamente el dato que ADR-003
protege. **El importe entra tal como llegó**, así que dos reintentos que lo
escriban de forma distinta son intenciones **distintas** y producen conflicto.

Es el lado correcto en el que equivocarse: un conflicto es ruidoso, mientras que
ADR-010 §3 llama a devolver el original ante una intención distinta «lo peor de
las tres opciones». Y ADR-010 §1 obliga al cliente a reenviar exactamente la
misma intención.

**Lo que sí converge** son el ámbito, la moneda y la fecha, porque no son
«valores exactos» en el sentido de ADR-003 —son identidades y una fecha— y
normalizarlos es «materializar los defaults semánticos», que es la primera
cláusula del mismo §8. Un UUID en mayúsculas es el mismo replay. Ambas caras
están probadas, en C1c y C1d.

### Owner opuesto al de la frontera de lectura, y es deliberado

|        | Escritura             | `api.claimed_dimension()` |
| ------ | --------------------- | ------------------------- |
| Owner  | **`nomey_writer`**    | `postgres`                |
| Efecto | **sigue bajo la RLS** | **atraviesa la RLS**      |

E16 midió que con un writer no propietario y `NOBYPASSRLS` una policy
`WITH CHECK` **detuvo una escritura que el código habría dejado pasar**.
Unificar los dos owners rompería una de las dos garantías.

Ceder la propiedad tiene la mecánica delicada que ADR-009 registra como coste
medido: el nuevo owner necesita `CREATE` sobre el schema, y **el cambio de
propiedad pierde los `GRANT` explícitos**, así que los grants van después.

### FX: rechazo explícito, no silencio

3.C no resuelve conversión: ADR-009 §8 deja la regla como decisión de producto y
ADR-003 §4 niega autoridad al tipo que aporte el cliente, de modo que el
servidor **no tiene con qué resolverla**. Las cuatro rutas exigen que la moneda
original sea la base de todos los ámbitos alcanzados y, si no, devuelven
**`CURRENCY_CONVERSION_UNSUPPORTED` · 422**.

El código es propio y no `PAYLOAD_INVALID` porque **la intención es válida y el
actor está autorizado**: lo que falta es una capacidad. Reportarlo como payload
inválido haría que el cliente corrigiera algo que no está mal.

### Privilegios retirados

7a **revoca** el `INSERT` del writer sobre `frozen_conversion`, `split` y
`split_participant`: ninguna función los ejercía. El principio «cada privilegio
corresponde a una ruta concreta» **también se aplica hacia atrás**. Los dos
últimos vuelven en 7b; el primero, cuando exista una regla de FX. **Las policies
de `INSERT` no se borran**: son decisiones razonadas de ADR-013 §10 y volverán a
hacer falta intactas.

### La paridad con los vectores, y cómo se ejecuta

ADR-002 §7 obliga a reproducir los vectores **exactamente**, y ADR-009 §1 asume
que el cálculo se escribe por segunda vez porque **la paridad se garantiza con
los vectores, no compartiendo código**.

`psql` corre **dentro** del contenedor y no ve el checkout, así que los vectores
no pueden leerse con `\copy`: viajan por la misma entrada estándar mediante
`scripts/vectors-prelude.sh`. **No añade ninguna dependencia.**

> Se comprobó que muerde: introducir un céntimo de error en el ajuste hizo que
> la sección F fallara contra el escenario 4.11 con «saldo de personal-A = 54998
> y el vector espera 55000».

**Tres escenarios son alcanzables por 7a.** `externalTransfer` **no tiene ningún
vector propio**: su único caso, 4.7, es compuesto y necesita `group_expense` y
`debt_settlement`, así que su vector se ejercita en 7b. Es una limitación real y
está dicha, no rellenada.

### El replay se resuelve antes que la autorización, y está probado

ADR-010 §5 distingue dos casos: una operación **nueva** exige la autorización
actual completa, mientras que una intención **ya procesada** puede devolver su
envelope «aunque el actor haya perdido después el acceso al ámbito». Aplicar la
autorización actual también al replay «rompería la idempotencia».

La sección F del check lo **prueba en vez de inferirlo del orden del código**:
retira la propiedad del Modo Personal que permitió la primera ejecución, repite
la misma clave e intención, y comprueba que el replay sigue devolviendo el mismo
`operation_id` con `already_processed: true`, que no escribe ni una fila, y que
un comando **nuevo** del mismo actor **sí** se rechaza.

> Se comprobó que muerde: al invertir el orden —autorizar antes de reclamar— la
> sección falla con exactamente el síntoma que ADR-010 §5 describe, un
> `NOT_AUTHORIZED` sobre un reintento legítimo.

### Lo que 7a NO puede probar todavía

**La corrección cross-author no es alcanzable.** Es una capacidad real —ADR-013
§10, medida en E20— pero **ninguna de las cuatro clases la ejercita**, porque las
cuatro se anclan a un Modo Personal cuyo dueño es el actor. Aparece con
`group_expense`, en 7b. Lo que sí se comprueba es que el rechazo es de
**autorización** y no de autoría, y que `operation.created_by` es inmutable.

---

## 13 nonies · La frontera autoritativa de escritura · 7b

Octava migración real y **segunda mitad del writer**. Trae las tres clases que
crean o consumen deuda —`record_group_expense`, `record_debt_settlement` y
`record_settlement_by_transfer`—, el protocolo de serialización de ADR-013 §11 y
el único ensanchamiento de privilegio que quedaba pendiente en toda la fase.

**Con ella la superficie de escritura son SIETE funciones de `api` y ninguna
más**, y no queda ningún bloque de implementación abierto en 3.C.

### El lock, medido antes de escribirlo

El handoff anterior anticipaba que bloquear la fila estable de un ámbito exigía
**dos cosas** —el `GRANT UPDATE` por columna y la policy de `UPDATE`— y proponía
estudiar `GRANT UPDATE (base_currency_definition_id)` con una policy
`USING (true) WITH CHECK (false)`. **No se dio por buena: se midió**, en una
transacción desechable contra el stack local, antes de tocar la migración.

| Configuración                   | `SELECT … FOR UPDATE` de `nomey_writer`       |
| ------------------------------- | --------------------------------------------- |
| Sin privilegio y sin policy     | **`42501 permission denied for table scope`** |
| Sin privilegio y **con** policy | **`42501`** — el privilegio manda             |
| **Con** privilegio y sin policy | **0 filas, sin error**                        |
| Con privilegio **y** con policy | La fila, incluida la de un ámbito ajeno       |

Y la capacidad concedida es exactamente esa, ninguna otra:

| Intento del writer                                    | Resultado                                             |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `UPDATE base_currency_definition_id` a **otro** valor | `new row violates row-level security policy`          |
| `UPDATE base_currency_definition_id` **al mismo**     | El mismo rechazo: `WITH CHECK (false)` no admite nada |
| `UPDATE kind` · `UPDATE owner_user_id`                | `42501`, por el `GRANT` **por columna**               |
| `DELETE` · `INSERT`                                   | `42501`                                               |
| Roles cliente                                         | Sin `UPDATE`, y ninguna policy aplicable a `PUBLIC`   |

> **Esto precisa lo que midió E20, no lo contradice.** El fallo **silencioso**
> —cero filas sin error— es el de la **policy** ausente. El del **privilegio**
> ausente es ruidoso. Hacen falta las dos cosas, y por motivos distintos: el
> privilegio abre la puerta y la policy decide qué filas se ven.

`sec.lock_debt_scopes` convierte el silencio en ruido: si el bloqueo devuelve
cero filas **levanta excepción**, porque continuar sería validar y escribir sobre
datos que la transacción cree haber protegido.

### El orden del protocolo, y por qué los ámbitos van antes que la operación

```
1 forma y reparto (solo payload)   4 replay o conflicto
2 actor                            5 autorizacion actual
3 RECLAMO de la clave              6 LOCK de los ambitos de deuda
7 lock de la operacion y CAS       8 leer la deuda
9 validar   10 derivar   11 escribir   12 puntero   13 retorno
```

Los pasos 1-5 y 7 son los de 7a, intactos. Lo nuevo es **6 y 8**:

- **6 antes que 8**, porque ADR-013 §11 dice que invertirlos «reintroduce
  exactamente la carrera»;
- **6 antes que 7**, para que el orden global de adquisición sea el mismo en las
  tres clases y no exista ciclo posible. 7a solo toma el lock de la operación y
  nunca espera por un ámbito, así que tampoco puede cerrar uno con 7b.

**El conjunto bloqueado de una corrección es una unión**: los ámbitos de la
intención nueva **más** los que llevaban deuda en la versión vigente. Sin la
segunda mitad, sacar un ámbito de una corrección lo dejaría fuera del lock justo
cuando su deuda cambia — la «serialización parcial» que ADR-013 §11 declara
equivalente a no serializar nada.

Ese conjunto se calcula desde `expected_version_id` y **no** desde una lectura de
`current_version_id`, de modo que no existe lectura obsoleta: si la vigente ya no
es esa, el CAS del paso 7 rechaza con `VERSION_CONFLICT` y no se escribe nada.

### El ámbito de caja del pagador se DERIVA, y no viaja en el payload

`data-model.md` §4.3 exige que «B pagó 120» registrado por A produzca un −120 en
el Modo Personal **de A**. La pregunta es cómo sabe el servidor cuál es.

La cadena es **participante → cuenta → Modo Personal**, y cada eslabón ya existía:
ADR-012 §2 pone el vínculo en su propia relación, y ADR-016 hace de
`owner_user_id` propiedad durable con un índice único, de modo que una cuenta
tiene **como mucho un** Modo Personal.

> **Aceptar un `payer_scope_id` del cliente habría sido inventar una regla.** Sin
> el vínculo no hay ningún dato con el que comprobar que un ámbito personal es el
> del pagador, y aceptarlo a ciegas dejaría a cualquier miembro colocar un cargo
> de caja falso en el Modo Personal de otro. Derivarlo no concede nada: ADR-012
> §8 dice que el vínculo establece **identidad**, y esto es exactamente una
> pregunta de identidad.

**Devolver `NULL` es un resultado legítimo**: es el pagador sin cuenta de
`data-model.md` §4.7, que el dominio modela con `payerCashMovement` **opcional**.
No se le inventa ningún ámbito.

`record_settlement_by_transfer` usa la misma derivación para los **dos** extremos
—salida del deudor, entrada del acreedor— y por eso su payload **no nombra ningún
ámbito de saldo**. Si el acreedor no tiene Modo Personal la clase no es la que
corresponde: ese caso es transferencia **externa** más liquidación, que son dos
operaciones, y se rechaza con `CREDITOR_WITHOUT_PERSONAL_SCOPE`.

### Autorización de cada clase

| Clase                    | Quién                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| `group_expense`          | **Cualquier integrante** del ámbito. Alta y corrección                          |
| `debt_settlement`        | **Cualquier integrante**: es una afirmación sobre una obligación ya determinada |
| `settlement_by_transfer` | **Solo el deudor**, comprobado por el vínculo (`data-model.md` §4.6)            |

Las dos primeras son «inmediatas» en la tabla de `data-model.md` §8, que no las
restringe a las partes. La tercera **sí** está restringida, y su comprobación es
que la cuenta del actor sea la vinculada al participante deudor: sin eso, quien
recibe podría registrar «me han pagado» y provocar una salida en el Modo Personal
de un tercero, que es la primitiva de apropiación que el invariante 14 impide.

> **Una limitación real, y se dice.** `data-model.md` §7 matiza que corrige
> «cualquier integrante, **sobre operaciones posteriores a su incorporación** o
> anteriores en las que ya figuraba como participante». Esa segunda mitad **no es
> derivable hoy**: `core.membership` es presencia pura y **no es un historial**,
> y usar su `created_at` como fecha de incorporación sería reinterpretar la
> relación exactamente como §13 quater prohíbe. Se implementa «cualquier
> integrante actual», y el matiz temporal queda pendiente de que exista una
> relación que responda esa pregunta.

### Un solo importe en la liquidación por transferencia

`operation_version` lleva **exactamente un** importe original (ADR-013 §3), así
que lo transferido y lo liquidado son el mismo número. No es una simplificación
de conveniencia: transferir más de lo debido **no** es una liquidación mayor —el
exceso es una transferencia entre usuarios, que es otro hecho (`data-model.md`
§3)—, y representarlo exigiría dos importes en una sola versión.

### Elegibilidad: dos lecturas fijadas

ADR-012 §7 dice que «un participante solo puede figurar en una operación cuando
sea elegible según uno de sus periodos válidos». Al implementarlo hubo que
elegir, y ambas elecciones quedan escritas:

- **la fecha es la efectiva de la versión que se escribe**, no el instante de
  escritura. `data-model.md` §7 lo dice para las correcciones —«los válidos en la
  fecha efectiva original»— y el contraste que traza es con el momento de
  corregir;
- **un participante sin ningún periodo no es elegible en ninguna fecha.** La
  ausencia de periodos no es un comodín: es no haber estado nunca.

### Lo que 7b deliberadamente NO valida

> **Una corrección que reduce un gasto por debajo de lo ya liquidado se acepta**,
> y puede dejar la deuda pendiente en negativo.

Participa en el protocolo —toma el lock, de modo que ninguna liquidación
concurrente lee un estado a medias— pero **no gana una validación nueva**. El
motivo es que ningún ADR la fija y el dominio no la modela: `deriveDebtSettlement`
valida al liquidar, no al corregir el gasto que la originó. Añadirla sería
introducir una regla de producto desde una migración.

**Lo que sí garantiza el lock** es que la comprobación y el consumo se
serialicen, que es literalmente el invariante de ADR-013 §11.

### Concurrencia: probada con sesiones simultáneas, no simulada

Una sola sesión de `psql` no tiene concurrencia, así que esto **no puede** vivir
en `supabase/checks/`: una simulación secuencial pasaría también con el lock
quitado. `scripts/writer-debt-concurrency.sh` abre sesiones de verdad, como hizo
E15-C, y CI lo ejecuta al final del job de base de datos.

| Escenario                                         | Resultado medido                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| Dos liquidaciones de 3000 sobre una deuda de 5000 | Una aceptada, una `SETTLEMENT_EXCEEDS_DEBT`, pendiente **2000**       |
| Dos correcciones cruzando los mismos dos ámbitos  | Cinco intentos, **cero deadlocks**                                    |
| Corrección a la baja frente a liquidación         | La liquidación **espera** y se valida contra la deuda ya corregida    |
| Control negativo sin lock                         | Lee **5000** obsoletos: leer antes de bloquear reintroduce la carrera |
| La misma carrera cinco veces                      | Siempre **2000**                                                      |

> **Se comprobó que muerde.** Sustituyendo `sec.lock_debt_scopes` por una función
> vacía reaparece **exactamente el `−1000`** que E15-C midió sin ningún lock, en
> tres de cinco carreras y en el escenario de la corrección. El script sale con
> código distinto de cero.

Escribe filas **confirmadas** —un bloqueo de fila solo existe entre transacciones
distintas—, las retira al terminar y comprueba que no queda ninguna. Por eso va
**después** de los checks: sus recuentos son absolutos.

### La paridad con los vectores

| Vectores         | Cobertura                                |
| ---------------- | ---------------------------------------- |
| `split.json`     | **22 de 22**, contra `sec.resolve_split` |
| `scenarios.json` | **19 de 20**                             |

El que falta es **`gasto-de-grupo-con-tres-monedas`**, y es una limitación real:
exige conversión, y ADR-009 §8 deja la regla de resolución como decisión de
producto pendiente. **No se rellena**: la sección H del check comprueba que ese
caso se **rechaza** con `CURRENCY_CONVERSION_UNSUPPORTED · 422` en vez de
resolverse mal, y el filtro que lo excluye mira la **forma** del vector —lleva
moneda del pagador distinta— y no su identificador, de modo que un escenario
nuevo con FX tampoco se colaría en silencio.

**Cada escenario estrena su propio Grupo**, con sus participantes, su membresía,
su vínculo y su periodo. Dos motivos, y el primero es un error que costó
descubrir:

- **la deuda de un ámbito es acumulada y no se filtra por fecha.** Los saldos sí
  se aíslan por fecha efectiva, que es lo que hacía 7a; la deuda no. Compartir
  Grupo mezclaba escenarios y una validación de sobrepago dejaba de probar nada;
- **el mismo nombre significa cosas distintas según el escenario**: la «M» de 4.4
  tiene Modo Personal y la de 4.7 no. El vector lo dice en su propia forma —lleva
  `payerScope` o no lo lleva— y de ahí sale si el participante se vincula.

Por la misma razón, **cada sección del check tiene su propio Grupo**.

### La corrección cross-author, por fin ejercitada

7a la dejó explícitamente sin probar: sus cuatro clases se anclan a un Modo
Personal cuyo dueño es el actor, así que la capacidad de ADR-013 §10 —medida en
E20— no tenía ruta. Con `record_group_expense` sí la tiene, y la sección E la
comprueba entera: **C corrige la operación que creó A**, sin ser el pagador; la
operación sigue atribuida a A y la V2 queda atribuida a C; `supersedes_version_id`
apunta **exactamente** a la vigente anterior, que es el invariante que ADR-011 §11
reserva a la frontera y que sale de haber leído la fila **bloqueada**.

### Lo que el check tuvo que sembrar como `postgres`

`core.participant`, `core.membership`, `core.participant_user_link` y
`core.participant_period` **no tienen ruta de escritura en 3.C**, ni la ganan
aquí: el provisioning está fuera de alcance y la prueba de autorización del claim
es F10. El check las siembra como `postgres`, que es exactamente lo que hará el
provisioning cuando exista, y la sección A comprueba que **el writer sigue con
solo `SELECT`** sobre las cuatro.

> **Consecuencia práctica que conviene no olvidar:** hoy ninguna de las tres
> clases de 7b es alcanzable de extremo a extremo por un cliente real, porque no
> hay forma de crear un Grupo ni sus participantes. Eso no es un defecto de 7b: es
> el alcance de 3.C.

### Privilegios: dos vuelven, uno no

`INSERT` sobre `core.split` y `core.split_participant` **vuelven**, porque
`record_group_expense` los ejerce. `core.frozen_conversion` **no vuelve**:
ninguna función escribe una conversión mientras el FX cross-currency siga sin
regla de resolución. Se añade `SELECT` sobre `core.current_effect`, que es la
única vía por la que el writer deriva deuda.

### Cinco aserciones anteriores que hubo que actualizar

No es deriva: es que 7b existe. Se actualizan **con su motivo escrito**, nunca
relajándolas a «al menos», porque lo que esos tests protegen es que cada
privilegio corresponda a una ruta concreta y que la superficie sea **enumerable**.

En `authoritative-writer.sql` (7a):

- `A1` pasa de «cuatro funciones `api.record_*`» a **siete**;
- `A4` comprobaba que el writer no tuviera `INSERT` sobre las tres tablas que 7a
  revocó. Ahora comprueba **solo `frozen_conversion`**: las otras dos tienen ruta;
- `A7` comprobaba que el writer **no** tuviera `UPDATE` sobre `core.scope`. Ahora
  comprueba que lo tiene **acotado a una sola columna**; su inocuidad la mide el
  check de 7b, que es donde vive la decisión.

En `split-conversion.sql` (bloque del reparto):

- `A5b` pasa de «cero privilegios distintos de `SELECT`» a **exactamente dos
  `INSERT`**, más una comprobación aparte de que `frozen_conversion` sigue sin él;
- `F1` comprobaba que el writer **no podía** escribir el reparto. Ahora comprueba
  las dos mitades de lo que ese grant significa: **escribe el de su propia
  versión**, y colgar uno de la versión de otro actor lo **detiene el
  `WITH CHECK`** de ADR-013 §10 —no el código—, que es la garantía que E16 midió.

### Un fallo silencioso de CI que apareció al enchufar el check

Al añadir el paso de 7b se revisó el de 7a en los logs reales, y **no estaba
comprobando nada**:

```
./scripts/vectors-prelude.sh: Permission denied
```

`scripts/vectors-prelude.sh` estaba versionado con modo `644`. El paso seguía
dando **verde**, y la cadena de causas es la que conviene recordar: el shell por
defecto de GitHub Actions es `bash -e`, así que el fallo del prólogo mata el
grupo `{ … }` **entero**, el `cat` nunca llega a ejecutarse, `psql` lee EOF y
**sale con 0** habiendo comprobado cero. El estado de una tubería es el de su
**último** comando, no el del primero.

Dos correcciones, y hacen falta las dos:

- **el bit de ejecución**, en `vectors-prelude.sh` y en el script de
  concurrencia;
- **`shell: bash` en los dos pasos**, que es lo que añade `-o pipefail`. Sin él,
  cualquier fallo futuro del prólogo volvería a ser invisible.

Comprobado en ambos sentidos: con el prólogo roto a propósito, el paso pasa de
salir `0` a salir `127`.

> **Es una trampa general de este repositorio, no un detalle de CI.** Un check
> que no se ejecuta y un check que pasa son indistinguibles desde el resumen del
> job. Cuando un paso encadena varios comandos, el verde solo significa algo si
> la tubería propaga el fallo.

### Que el check puede fallar, comprobado

Cuatro regresiones deliberadas, cada una contra la garantía que dice proteger:

| Regresión                                            | Qué la detecta                                              |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| Desempate sin prioridad al pagador                   | `B1b: el pagador se quedo con 333 y el desempate le da 334` |
| Reparto que ignora el método declarado               | El `CHECK` de `exact_amounts` de la propia tabla            |
| `sec.pending_debt` sin excluir la versión superseded | `E4: corregir una liquidacion a la baja fallo`              |
| Sin la policy de `UPDATE` de `core.scope`            | `A5c`, con el motivo de E20 en el mensaje                   |

---

## 14 · Checklist de entrada a las primeras migraciones

**Se cumplió el 2026-08-25** y el bootstrap ya está migrado (§13 bis). Se
conserva como registro de qué estaba cerrado al empezar; nada de ello vuelve a
discutirse sin una contradicción estructural.

**Decisiones que condicionan la forma física — todas cerradas:**

- [x] Representación monetaria e identidad de la definición — ADR-003, ADR-004
- [x] Topología de schemas y superficie expuesta — ADR-005, ADR-006 §6
- [x] Grants por rol y saneamiento de defaults — ADR-006, medido en E12 y E13
- [x] Membresía y RLS de lectura — ADR-007
- [x] Frontera textual de lectura y de escritura — ADR-008
- [x] Frontera autoritativa y atributos del writer — ADR-009
- [x] Idempotencia del origen cliente — ADR-010, ADR-011 §5
- [x] Operación, versión, efecto y linaje — ADR-011, medido en E17
- [x] Identidad de participantes y periodos — ADR-012, medido en E18
- [x] Persistido frente a derivado, reparto y proyección canónica — ADR-013,
      medido en E19
- [x] Políticas del writer por comando y por rol — ADR-013 §10, medido en E20
- [x] Regla de corrección y atribución por versión — ADR-013 §10,
      `data-model.md` §7

**Comprobado en esta revisión y sin trabajo pendiente:**

- [x] Superficie de lectura mínima de 3.C identificada (§11 bis)
- [x] Nombres físicos ya fijados por uso, y los que la migración debe nombrar
- [x] Índices de corrección y de unicidad separados de los de rendimiento
- [x] `btree_gist` va a `extensions`; el preflight de §9 sigue vivo
- [x] Sin caché económica en v1 — retirado de pendientes
- [x] Los vectores compartidos **no** necesitan extenderse

- [x] Exposición definitiva de schemas de la Data API — ADR-014: `public`
      **fuera**; `api` es la superficie y `graphql_public` se conserva

**Abierto que bloquee: ninguno.**

**Al escribir la primera migración, no olvidar:**

- ~~`schemas = ["api", "graphql_public"]` en el mismo commit que cree `api`~~ —
  **hecho y verificado** (§13 bis);
- ~~el test que comprueba que `core` y `sec` no están expuestos (ADR-006 §6)~~ —
  **hecho**: `tests/infra/exposed-schemas.test.ts`, que corre en CI;
- ninguna tabla se crea sin su política RLS **en la misma migración**;
- la guarda de catálogo de la proyección canónica (ADR-013 §9);
- el test de catálogo de la superficie textual (ADR-008 §2);
- el test de aislamiento debe **fallar** al relajar una política a propósito
  (roadmap, cierre 4).

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
- **Un paso de CI en verde no significa que se ejecutara.** `vectors-prelude.sh`
  estuvo versionado con modo `644` y el paso del writer daba verde sin comprobar
  nada: con `bash -e`, el fallo del prólogo mata el grupo, `psql` lee EOF y sale
  con `0`, y **el estado de una tubería es el de su último comando**. La
  corrección es el bit de ejecución **más** `shell: bash`, que añade `pipefail`.
- **Vitest no comprueba tipos.** El typecheck de `tests/` es una invocación
  aparte de `tsc`; `npm run typecheck` ejecuta las dos.
- **La suite debe poder fallar.** El procedimiento de regresión deliberada está
  en [`tests/README.md`](../../tests/README.md).
- **`tests/vectors/scenarios.json` no tiene ningún caso de corrección, y no le
  hace falta.** §11 bis lo revisó: los cuatro casos que se reclamaban prueban
  **vigencia, idempotencia y CAS**, no derivación, así que son **tests de
  integración de servidor** y no vectores compartidos. La derivación de una V2
  ya es expresable con el formato actual, porque es una operación como
  cualquier otra.
