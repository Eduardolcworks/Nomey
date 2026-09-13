# Nota de coordinación con F11 (multimoneda) — ADR por fases y cambios de F9

Fecha: 2026-09-14. Rama: `feat/phase-9-groups-add-selector` (F9 cerrada
documentalmente; **sin integrar**). **Referencia exacta de comparación:**
`main` en `6a5746f` («Merge pull request #56»), que es también el punto de
partida de esta rama (`git merge-base` = `6a5746f`; la rama no tiene commits
propios: todo F9 está en el árbol de trabajo, pendiente de PR).

**Limitación principal:** la rama de F11 **no está disponible aquí**. Nada de
esta nota afirma qué contiene; lo que se dice de F11 sale del roadmap, de
[F09/ADR-007](../adr/F09/ADR-007-group-payments-and-exit-without-debt.md)
(«Archivos y contratos afectados, y F11») y del código de esta rama. Tampoco
se conoce la base de tu rama: se compara contra `main@6a5746f`, y si tu base
es anterior, lo que falta es aún más.

## 1 · La convención nueva de ADR

Los ADR viven en **una carpeta por fase** (`docs/adr/F00` … `F19`) y **cada
fase numera los suyos de forma independiente desde `ADR-001`**. La identidad
completa es **fase y número**: `F09/ADR-007`, nunca «ADR-007». Reglas para
trabajar en paralelo (completas en [`docs/adr/README.md`](../adr/README.md)):

- El ADR se crea en la carpeta de la fase que **origina** la decisión; una
  decisión transversal tiene una sola ubicación y las demás fases la citan.
- Antes de elegir número se consulta el índice de esa fase (`FNN/README.md`).
- Se referencia siempre fase y número; no se renumera nada para insertar.
- Si dos ramas crean el mismo identificador en una fase, se resuelve **antes
  de integrar** y se actualizan las referencias de la que se mueve.
- Un ADR de otra fase se cita; no se copia ni se redefine.

Las migraciones, los checks SQL, el SQL de las sondas y los vectores conservan
la numeración antigua en sus comentarios a propósito; se leen con la tabla de
abajo.

## 2 · Tabla de equivalencias

| Antes   | Título                                                                                     | Ahora           | Ruta                                                                      |
| ------- | ------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------- |
| ADR-001 | Licencia de Nomey y avisos de terceros                                                     | **F00/ADR-001** | `docs/adr/F00/ADR-001-licensing.md`                                       |
| ADR-002 | Modelo contable de Nomey                                                                   | **F01/ADR-001** | `docs/adr/F01/ADR-001-accounting-model.md`                                |
| ADR-003 | Representación exacta del dinero                                                           | **F02/ADR-001** | `docs/adr/F02/ADR-001-money-representation.md`                            |
| ADR-004 | Identidad física de la definición monetaria                                                | **F03/ADR-001** | `docs/adr/F03/ADR-001-currency-definition-identity.md`                    |
| ADR-005 | Topología de schemas y frontera de la Data API                                             | **F03/ADR-002** | `docs/adr/F03/ADR-002-schema-topology.md`                                 |
| ADR-006 | Modelo de privilegios y frontera de lectura `api` → `core`                                 | **F03/ADR-003** | `docs/adr/F03/ADR-003-privilege-model.md`                                 |
| ADR-007 | Comprobación de membresía y estrategia de RLS                                              | **F03/ADR-004** | `docs/adr/F03/ADR-004-membership-rls.md`                                  |
| ADR-008 | Frontera de datos exactos                                                                  | **F03/ADR-005** | `docs/adr/F03/ADR-005-exact-data-boundary.md`                             |
| ADR-009 | Frontera autoritativa de escritura                                                         | **F03/ADR-006** | `docs/adr/F03/ADR-006-authoritative-write-boundary.md`                    |
| ADR-010 | Idempotencia de las operaciones originadas por el cliente                                  | **F03/ADR-007** | `docs/adr/F03/ADR-007-client-operation-idempotency.md`                    |
| ADR-011 | Modelo físico de operaciones, versiones y comandos cliente                                 | **F03/ADR-008** | `docs/adr/F03/ADR-008-operation-version-model.md`                         |
| ADR-012 | Identidad de participantes sin cuenta y vínculo con usuarios                               | **F03/ADR-009** | `docs/adr/F03/ADR-009-participant-identity.md`                            |
| ADR-013 | Persistido frente a derivado, reparto contextual y proyección canónica                     | **F03/ADR-010** | `docs/adr/F03/ADR-010-persisted-vs-derived.md`                            |
| ADR-014 | Exposición definitiva de schemas de la Data API                                            | **F03/ADR-011** | `docs/adr/F03/ADR-011-data-api-schema-exposure.md`                        |
| ADR-015 | Representación física del tipo de cambio congelado                                         | **F03/ADR-012** | `docs/adr/F03/ADR-012-frozen-rate-physical-representation.md`             |
| ADR-016 | Atribución económica de efectos a un usuario                                               | **F03/ADR-013** | `docs/adr/F03/ADR-013-economic-attribution.md`                            |
| ADR-017 | Persistencia segura de la sesión en el dispositivo                                         | **F05/ADR-001** | `docs/adr/F05/ADR-001-secure-session-storage.md`                          |
| ADR-018 | La sesión de recuperación es efímera y no se promociona                                    | **F05/ADR-002** | `docs/adr/F05/ADR-002-ephemeral-recovery-session.md`                      |
| ADR-019 | Provisioning del Modo Personal y siembra del catálogo monetario                            | **F06/ADR-001** | `docs/adr/F06/ADR-001-personal-provisioning.md`                           |
| ADR-020 | Contenido no monetario y grano temporal de la versión                                      | **F06/ADR-002** | `docs/adr/F06/ADR-002-version-content-and-time.md`                        |
| ADR-021 | Catálogo de categorías y su autorización                                                   | **F06/ADR-003** | `docs/adr/F06/ADR-003-category-catalogue.md`                              |
| ADR-022 | Ajuste por saldo objetivo y serialización de la dimensión saldo                            | **F06/ADR-004** | `docs/adr/F06/ADR-004-balance-target-and-serialization.md`                |
| ADR-023 | Observación histórica de saldo                                                             | **F06/ADR-005** | `docs/adr/F06/ADR-005-balance-observation.md`                             |
| ADR-024 | Anulación de una operación                                                                 | **F06/ADR-006** | `docs/adr/F06/ADR-006-annulment.md`                                       |
| ADR-025 | Superficie de lectura del Modo Personal                                                    | **F06/ADR-007** | `docs/adr/F06/ADR-007-personal-read-surface.md`                           |
| ADR-026 | Estadísticas agregadas del Modo Personal                                                   | **F06/ADR-008** | `docs/adr/F06/ADR-008-personal-statistics.md`                             |
| ADR-027 | La categoría es del gasto, y el icono es una clave semántica                               | **F06/ADR-009** | `docs/adr/F06/ADR-009-expense-only-categories.md`                         |
| ADR-028 | Cola de escritura sin conexión, durabilidad de la clave y proyección optimista             | **F07/ADR-001** | `docs/adr/F07/ADR-001-offline-command-queue-and-optimistic-projection.md` |
| ADR-029 | Etiquetas visibles de la incidencia, y a dónde lleva «Revisar»                             | **F07/ADR-002** | `docs/adr/F07/ADR-002-incident-labels-and-review-destination.md`          |
| ADR-030 | Modelo de código nativo: CNG con config plugins                                            | **F08/ADR-001** | `docs/adr/F08/ADR-001-native-code-model.md`                               |
| ADR-031 | Contrato de entornos, variantes y separación de configuración                              | **F08/ADR-002** | `docs/adr/F08/ADR-002-environments-and-variants.md`                       |
| ADR-032 | Modelo de Grupo y contrato de permisos                                                     | **F09/ADR-001** | `docs/adr/F09/ADR-001-group-model-and-permissions.md`                     |
| ADR-033 | Idempotencia por clave del provisioning iniciado por cliente                               | **F09/ADR-002** | `docs/adr/F09/ADR-002-client-provisioning-idempotency.md`                 |
| ADR-034 | Salir de un Grupo, y dar por saldado a quien salió                                         | **F09/ADR-003** | `docs/adr/F09/ADR-003-leaving-a-group.md`                                 |
| ADR-035 | Invitaciones a un Grupo y unión directa                                                    | **F09/ADR-004** | `docs/adr/F09/ADR-004-group-invitations.md`                               |
| ADR-036 | Retirar a un participante sin cuenta                                                       | **F09/ADR-005** | `docs/adr/F09/ADR-005-retire-unlinked-participant.md`                     |
| ADR-037 | Rectificar una reclamación («Me equivoqué de participante»)                                | **F09/ADR-006** | `docs/adr/F09/ADR-006-unclaim-participant.md`                             |
| ADR-038 | Pagos registrados en el grupo, su anulación, y salir sin pendientes                        | **F09/ADR-007** | `docs/adr/F09/ADR-007-group-payments-and-exit-without-debt.md`            |
| ADR-039 | La obligación de quien salió del grupo es intocable                                        | **F09/ADR-008** | `docs/adr/F09/ADR-008-departed-obligation-immutable.md`                   |
| ADR-040 | Asociar un participante sin cuenta a la propia cuenta (fusión de identidades contextuales) | **F09/ADR-009** | `docs/adr/F09/ADR-009-associate-ghost-to-own-account.md`                  |
| ADR-041 | Volver a entrar en un grupo tras salir voluntariamente                                     | **F09/ADR-010** | `docs/adr/F09/ADR-010-rejoin-after-departure.md`                          |

## 3 · Tu borrador de FX

- **No existe ningún ADR-032 de FX en esta rama**: el antiguo ADR-032 es el
  modelo de Grupo (**F09/ADR-001**). Tu borrador **no puede** llevar ese
  identificador ni ninguno de la numeración única.
- Ubícalo en **`docs/adr/F11/`** con **el siguiente número libre en esa
  carpeta en el momento de integrar**. Hoy F11 no tiene ningún ADR, así que
  sería `F11/ADR-001`, **pero no lo des por hecho**: consulta
  `docs/adr/F11/README.md` al integrar; si otro ADR de F11 entró antes, tomas
  el siguiente.
- Título `# F11/ADR-NNN — …`, fila en `F11/README.md` y en el índice general.
  Cita por identidad completa lo ya decidido y no lo redefinas:
  [F02/ADR-001](../adr/F02/ADR-001-money-representation.md) (representación
  exacta; política de selección del tipo dejada abierta),
  [F03/ADR-001](../adr/F03/ADR-001-currency-definition-identity.md) (identidad
  de la definición monetaria),
  [F03/ADR-012](../adr/F03/ADR-012-frozen-rate-physical-representation.md)
  (tipo congelado `(coefficient, scale)`, escala máxima 12; el importe
  convertido no se persiste),
  [F03/ADR-010](../adr/F03/ADR-010-persisted-vs-derived.md) §1
  (`core.frozen_conversion` es hecho persistido) y
  [F09/ADR-007](../adr/F09/ADR-007-group-payments-and-exit-without-debt.md)
  (el pago declarado rehúsa la conversión hasta que exista la regla de FX).

## 4 · Cambios comprobados en nuestra rama (frente a `main@6a5746f`)

**Migraciones.** `main` tiene **18**, la última `20260901120000_expense_only_categories`.
F9 añade **28** (46 en total), en este orden:

```
20260906120000_group_provisioning.sql
20260908120000_group_expense_flow.sql
20260908130000_group_movement_filters.sql
20260908140000_group_split_readable.sql
20260908150000_settlement_guard_scope.sql
20260908160000_group_previous_amount_and_balances.sql
20260908170000_group_edit_notifications.sql
20260909120000_personal_group_expense_row.sql
20260910120000_personal_statistics_shared_share.sql
20260910130000_update_group_profile.sql
20260910140000_group_expense_time_and_default_category.sql
20260910150000_group_last_activity.sql
20260911120000_leave_group_and_settle_participant.sql
20260911150000_group_invitations.sql
20260912100000_group_notices_seen.sql
20260912120000_personal_expense_share_rows.sql
20260912130000_group_participant_is_linked.sql
20260912140000_retire_participant.sql
20260912150000_group_identity_lock.sql
20260912160000_unclaim_participant.sql
20260912170000_group_payments_and_departed.sql
20260913120000_reopened_pair_payment.sql
20260913130000_ghost_payments_and_notices_seen.sql
20260914120000_departure_novation.sql
20260914130000_associate_participant.sql
20260914140000_rejoin_after_departure.sql
20260914150000_oversettlement_guard_delta.sql
20260914160000_positions_cas_visible_participants.sql
```

Las 46 se aplican en la base local y se reconstruyen desde cero en una pila
aislada (suite SQL 30/30). **Ninguna se renombra ni se altera.**

**Funciones compartidas recreadas por F9** (`create or replace` sobre el
cuerpo vivo; la última migración de cada lista es el cuerpo vigente):

| Función                          | En `main`                                            | Recreada por F9 en                                                                                         | Qué añade F9                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.annul_operation`            | `20260829130000`                                     | `20260911120000`, `20260912170000`, `20260914130000` (+ guardas en `20260914150000`)                       | autorización por partes para `group_payment`; retirados por neto cero; rango 1 del cerrojo de identidad; identidades canónicas (F09/ADR-009); guarda de sobreliquidación por delta; aviso interno |
| `api.record_debt_settlement`     | `20260826205500`, `20260829120500`                   | `20260911120000`, `20260912170000`                                                                         | rango 1 del cerrojo; ambos extremos activos                                                                                                                                                       |
| `api.claimed_dimension`          | `20260826144432`                                     | `20260911120000`, `20260912170000`                                                                         | la deuda exige vínculo **y** membresía; excepción C6 (deuda reabierta por anular un pago); resolución canónica                                                                                    |
| `api.personal_operation` (vista) | `20260830120000`, `20260901120000`                   | `20260909120000`, `20260911120000`, `20260912170000`                                                       | fila de gasto de grupo en Personal; clase `group_payment` con contexto (`api.my_group_payment`)                                                                                                   |
| `api.record_group_expense`       | `20260826205500`, `20260829120500`                   | `20260908120000`, `20260908170000`, `20260910140000`, `20260911120000`, `20260912150000`, `20260912170000` | concepto, hora, categoría por defecto, avisos de edición, cerrojo de identidad, guardas por identidad canónica                                                                                    |
| `sec.persist_version`            | `20260826200047`, `20260828210500`, `20260829130000` | `20260914120000`                                                                                           | `OPERATION_NOT_ANNULLABLE` para `departure_novation`                                                                                                                                              |

**Negativa de conversión.** `sec.assert_no_conversion` /
`CURRENCY_CONVERSION_UNSUPPORTED` está hoy en **once** funciones: los nueve
writers de clase, `api.record_group_payment` y
`sec.incorporate_participant_cash` (F09/ADR-009). En el cliente se interpreta
en `src/lib/offline/response.ts`, `src/features/personal/projection.ts`,
`src/features/personal/personal-scope.ts`, `src/features/groups/group-projection.ts`
y `src/features/groups/shared-expense-form.tsx`.

**Ficheros de `main` modificados por F9 que F11 puede tocar:**
`src/types/database.ts` (+488 líneas, generado), `.github/workflows/ci.yml`
(pasos nuevos de checks y carreras), `scripts/vectors-prelude.sh`,
`scripts/writer-debt-concurrency.sh`, `supabase/checks/authoritative-writer.sql`
y `authoritative-writer-debt.sql` (fixtures e identidad canónica),
`src/domain/index.ts` (exporta además `fromMinorUnits`, `toMinorUnits`,
`allocateByLargestRemainder`). **Sin cambios en F9:** `src/domain/money/*`,
`tests/vectors/*.json`, `core.frozen_conversion`, `api.set_personal_base_currency`.

**Contratos y documentos** que F9 fijó y F11 debe leer, no rehacer:
`data-model.md` (invariante 15 fijado el 2026-09-14; §4.5/§4.6 remiten al
pago declarado), `PROJECT_STATE.md` (35 funciones y 17 vistas en `api`; 46
migraciones), F09/ADR-007 (novación, allocation persistida), F09/ADR-009
(identidad canónica en toda lectura por persona), F09/ADR-010.

## 5 · Archivos y funciones que requieren coordinación

Piezas que **las dos fases tocan o pueden tocar**; en ellas la integración se
revisa a mano, sin elegir una versión entera:

- Las seis funciones de la tabla del punto 4, más `sec.assert_no_conversion`
  y sus once llamadas.
- `src/types/database.ts` — se **regenera** sobre el esquema combinado; nunca
  es fuente de verdad ni se fusiona a mano.
- `.github/workflows/ci.yml` — pasos de ambas fases, ninguno se pierde.
- `supabase/checks/authoritative-writer*.sql`, `scripts/vectors-prelude.sh`,
  `scripts/writer-debt-concurrency.sh` — si F11 añade vectores de conversión.
- `src/domain/index.ts`, `src/lib/format/*` — si F11 cambia la jerarquía
  visual del importe original frente al derivado, las pantallas de grupo
  (`net_position` como texto, `currencyScale`) deben seguir cuadrando.
- Documentos generales del punto 8.

## 6 · Conflictos entre ramas aún no comprobados (rama de F11 no disponible)

No puedo confirmar ni descartar ninguno; son los que **hay que comprobar** al
tener las dos ramas:

- Si F11 tiene migraciones con marca **anterior a `20260914160000`** que
  recreen alguna de las funciones de la tabla: al reconstruir desde cero se
  aplicarían **entre** las de F9 y la recreación posterior de F9 pisaría lo de
  F11 (o al revés, según la marca). La marca decide el orden; no basta con que
  «cada rama funcione».
- Si F11 hizo `create or replace` de esas funciones partiendo del cuerpo de
  `main`: revertiría en silencio todo lo de la columna «Qué añade F9».
- Si F11 levanta la negativa de conversión sólo en `record_group_expense` (o
  sólo en Personal) y deja los otros puntos incoherentes, incluidos el pago
  declarado y la caja incorporada, que tienen regla propia (F09/ADR-007 C1–C3,
  F09/ADR-009).
- Si F11 añade columnas de divisa a `api.personal_operation` sin conservar la
  clase `group_payment` y su contexto.
- Si F11 regeneró `database.ts` o editó `ci.yml`, `authoritative-writer*.sql`
  o `vectors-prelude.sh`: conflicto textual que se resuelve por contenido.
- Si F11 replanteó el cambio de moneda base sin citar
  `api.set_personal_base_currency` ni el bloqueo por la primera operación
  (F09/ADR-001).
- El identificador ADR-032 de tu borrador: resuelto por convención
  (`F11/ADR-NNN`), pero las referencias que tu rama haga a «ADR-032» como FX
  hay que cambiarlas una a una.

## 7 · Procedimiento de integración

1. **Incorporar primero la base actual de F9 y la reorganización de ADR a tu
   rama** (rebase o merge desde la rama de F9 una vez integrada en `main`),
   **antes** de validar nada de F11. Actualiza tus referencias a la identidad
   completa con la tabla del punto 2; mueve tu borrador a `docs/adr/F11/`.
2. **Revisar las funciones compartidas completas**, función por función
   (tabla del punto 4): el resultado conserva **todas** las reglas de F9 y
   añade las de FX. No se resuelve un conflicto eligiendo íntegramente una
   versión (`ours`/`theirs`); se parte del cuerpo vivo de F9 y se introduce
   FX sobre él. Lo mismo para `sec.assert_no_conversion` y cada uno de sus
   once puntos de llamada: decisión explícita por función.
3. **Revisar el orden de migraciones de las dos ramas** con la lista del punto
   4: si alguna de F11 tiene marca anterior a una de F9 que recrea la misma
   función, hay que decidir el cuerpo final en una migración **posterior a
   `20260914160000`** (las de F9 no se renombran). Comprobar también que no
   haya dos migraciones con la misma marca.
4. **Validar las dos vías de llegada al esquema:**
   - **desde cero** con el conjunto combinado (pila aislada:
     `supabase db reset --no-seed` sobre las migraciones combinadas), y
   - **actualización** de una copia aislada de una base con F9 aplicada
     (restaurar un `pg_dump` de una base con las 46 en la pila aislada y
     aplicar sólo las de F11 con `migration up`).
5. **Comparar los dos esquemas finales** (`pg_dump --schema-only` de ambas
   pilas y `diff`): deben coincidir en funciones, vistas, grants y policies.
   Una diferencia es un defecto de orden o de recreación, no ruido.
6. **Ejecutar sobre el resultado combinado** las pruebas ya existentes de
   grupos, pagos, asociación, salida/reincorporación y las de FX de F11:
   suite SQL completa (`bootstrap`, `core-ledger`, `scope-effect`,
   `participant-identity`, `split-conversion`, `canonical-attribution`,
   `authoritative-writer`, `authoritative-writer-debt`, `group-provisioning`,
   `group-expense-flow`, `leave-and-settle`, `group-invitations`,
   `group-notices-seen`, `retire-participant`, `unclaim-evidence`,
   `group-payments-evidence`, `departed-obligation-evidence`,
   `reopened-pair-payment`, `ghost-payments`, `departure-novation`,
   `associate-participant`, `rejoin-after-departure`, `oversettlement-delta`,
   `group-identity-lock` y el resto de `supabase/checks/`), las carreras
   (`scripts/*-race-evidence.sh`, `*-concurrency.sh`), `vitest`
   (`--maxWorkers=1`) y `npm run verify`. No se crean pruebas nuevas que
   comparen una implementación consigo misma: la evidencia de compatibilidad
   es que los checks de **cada** fase pasan sobre el esquema **combinado**.
7. **Regenerar `src/types/database.ts` desde ese esquema combinado** y
   revisar el diff resultante; no fusionarlo a mano ni tomarlo de una rama.
8. Manual, en dispositivo, sobre el combinado: un gasto de grupo, un
   «Saldado», una asociación y una salida/reincorporación con la moneda base;
   y los flujos de FX de F11.

## 8 · Documentos generales que las dos fases modifican

| Documento                                                                            | Quién lo toca                                                  | Regla de actualización                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PROJECT_STATE.md`                                                              | la fase que abre o cierra, o que cambia una superficie estable | Sólo estado global (no por tarea). Cada fase edita **sus** frases y la tabla «Dónde estamos»; al integrar se conservan las de las dos fases, nunca se elige una versión entera. F9 ya está escrito; F11 añade lo suyo al cerrar |
| `docs/product/roadmap.md`                                                            | cada fase, **su propia sección**                               | La sección «Fase 9 — Estado de cierre» no la toca F11; F11 escribe en «Fase 11». Conflictos sólo si ambas tocan cabeceras comunes                                                                                               |
| `docs/architecture/data-model.md`                                                    | la fase cuyo ADR cambia el contrato                            | Cambios sólo respaldados por un ADR aceptado. F9 fijó el invariante 15 y §4.5/§4.6 (2026-09-14); F11 toca §10 (moneda, importe y tipo de cambio) con su ADR. Ninguna fase reescribe lo de la otra                               |
| `AGENTS.md`                                                                          | cualquier fase, sólo reglas respaldadas por ADR                | Fusión manual por bloques; «Current state» lo actualiza la fase que cierra                                                                                                                                                      |
| `docs/adr/README.md` y `docs/adr/FNN/README.md`                                      | cada fase, su carpeta y su fila en el índice general           | El índice general recibe una fila por ADR nuevo: al integrar se conservan todas las filas; la tabla de equivalencias no se modifica                                                                                             |
| Handoffs por fase (`docs/architecture/phase-9-progress.md`, el de F11 cuando exista) | sólo su fase                                                   | Nunca se escribe en el handoff de otra fase; las decisiones que afectan a la otra se citan por identidad completa                                                                                                               |

## 9 · Limitaciones conocidas

- **CI verde no demuestra compatibilidad entre fases.** CI reconstruye desde
  cero y pasa los checks de lo que hay en la rama; no ejercita la vía de
  actualización, no compara esquemas y no puede saber si una recreación ha
  pisado reglas de la otra fase salvo que un check las afirme. La
  compatibilidad la demuestran los pasos 4–6 del punto 7 sobre el combinado.
- La rama de F11 no se ha visto: los puntos 5 y 6 son lo que hay que
  comprobar, no un resultado.
- La base de tu rama se desconoce; si es anterior a `main@6a5746f`, la lista
  del punto 4 no es todo lo que te falta.
