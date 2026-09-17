# F03 — Persistencia y frontera de datos

**Alcance:** Schemas, privilegios, RLS, frontera exacta, escritura autoritativa, idempotencia, versiones, identidad de participantes, proyección canónica y atribución. **Estado de la fase:** Cerrada. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F03/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                           | Título                                                                 | Estado   | Fecha      | Antes   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- | ---------- | ------- |
| [F03/ADR-001](ADR-001-currency-definition-identity.md)        | Identidad física de la definición monetaria                            | Aceptado | 2026-08-23 | ADR-004 |
| [F03/ADR-002](ADR-002-schema-topology.md)                     | Topología de schemas y frontera de la Data API                         | Aceptado | 2026-08-23 | ADR-005 |
| [F03/ADR-003](ADR-003-privilege-model.md)                     | Modelo de privilegios y frontera de lectura `api` → `core`             | Aceptado | 2026-08-24 | ADR-006 |
| [F03/ADR-004](ADR-004-membership-rls.md)                      | Comprobación de membresía y estrategia de RLS                          | Aceptado | 2026-08-24 | ADR-007 |
| [F03/ADR-005](ADR-005-exact-data-boundary.md)                 | Frontera de datos exactos                                              | Aceptado | 2026-08-24 | ADR-008 |
| [F03/ADR-006](ADR-006-authoritative-write-boundary.md)        | Frontera autoritativa de escritura                                     | Aceptado | 2026-08-24 | ADR-009 |
| [F03/ADR-007](ADR-007-client-operation-idempotency.md)        | Idempotencia de las operaciones originadas por el cliente              | Aceptado | 2026-08-24 | ADR-010 |
| [F03/ADR-008](ADR-008-operation-version-model.md)             | Modelo físico de operaciones, versiones y comandos cliente             | Aceptado | 2026-08-24 | ADR-011 |
| [F03/ADR-009](ADR-009-participant-identity.md)                | Identidad de participantes sin cuenta y vínculo con usuarios           | Aceptado | 2026-08-24 | ADR-012 |
| [F03/ADR-010](ADR-010-persisted-vs-derived.md)                | Persistido frente a derivado, reparto contextual y proyección canónica | Aceptado | 2026-08-24 | ADR-013 |
| [F03/ADR-011](ADR-011-data-api-schema-exposure.md)            | Exposición definitiva de schemas de la Data API                        | Aceptado | 2026-08-25 | ADR-014 |
| [F03/ADR-012](ADR-012-frozen-rate-physical-representation.md) | Representación física del tipo de cambio congelado                     | Aceptado | 2026-08-25 | ADR-015 |
| [F03/ADR-013](ADR-013-economic-attribution.md)                | Atribución económica de efectos a un usuario                           | Aceptado | 2026-08-26 | ADR-016 |

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F01/ADR-001](../F01/ADR-001-accounting-model.md) — Modelo contable de Nomey
- [F02/ADR-001](../F02/ADR-001-money-representation.md) — Representación exacta del dinero

## Notas posteriores al cierre de la fase

Los ADR aceptados no se editan; lo que un ADR posterior precisó o superó se
anota aquí, con fecha, citando el ADR que lo hace.

- **F03/ADR-003 — precisado por
  [F12/ADR-001](../F12/ADR-001-username-public-account-identity.md) (Aceptado,
  2026-09-17) en una excepción mínima y controlada.** El rol de Auth
  `supabase_auth_admin`, con el que GoTrue ejecuta el hook
  `before_user_created`, recibe `USAGE` sobre `sec` y `EXECUTE` sobre
  **exactamente una** función `SECURITY DEFINER` de `sec` (owner
  `nomey_provisioner`, `search_path` pinado), la que reserva el username en
  la misma transacción del alta. No es una apertura general de `sec`: el rol
  no ve tablas, no ejecuta nada más y no toca `api` ni `core`; `anon` sigue
  sin `USAGE` sobre `api`; `core` y `sec` siguen fuera de toda superficie
  cliente. Una **guarda de catálogo** exigida por el ADR afirma que
  `supabase_auth_admin` ejecuta una y sólo una función de `sec` y ninguna de
  `api`. Los grants concretos llegan con la migración que implemente el
  hook.
- **F03/ADR-006 y los writers de F3 de `api.record_internal_transfer` y
  `api.record_settlement_by_transfer` — su contrato de F3 queda superado por
  [F12/ADR-002](../F12/ADR-002-two-will-user-transfers.md) y
  [F12/ADR-003](../F12/ADR-003-group-transfers.md) (Aceptados, 2026-09-17).**
  Ambas clases dejan de admitir el alta unilateral e inmediata, la
  corrección por versión (`operation_id` + `expected_version_id`) y —en
  `settlement_by_transfer`— el tope de sobrepago y la restricción «sólo el
  deudor»: nacen de una propuesta aceptada por las dos partes, tienen
  exactamente una versión `record` y no se anulan. El principio de
  F03/ADR-006 —una función pública por clase, payload `jsonb`, writer bajo
  RLS— no cambia; lo que cambia es el contrato de esas dos funciones, que se
  recrean partiendo de su cuerpo vigente cuando se implementen.
