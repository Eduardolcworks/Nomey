# F06 — Modo Personal

**Alcance:** Provisioning del ámbito personal, contenido de la versión, categorías, saldo objetivo y observación, anulación, lectura y estadísticas. **Estado de la fase:** Cerrada. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F06/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                        | Título                                                          | Estado   | Fecha      | Antes   |
| ---------------------------------------------------------- | --------------------------------------------------------------- | -------- | ---------- | ------- |
| [F06/ADR-001](ADR-001-personal-provisioning.md)            | Provisioning del Modo Personal y siembra del catálogo monetario | Aceptado | 2026-08-28 | ADR-019 |
| [F06/ADR-002](ADR-002-version-content-and-time.md)         | Contenido no monetario y grano temporal de la versión           | Aceptado | 2026-08-28 | ADR-020 |
| [F06/ADR-003](ADR-003-category-catalogue.md)               | Catálogo de categorías y su autorización                        | Aceptado | 2026-08-28 | ADR-021 |
| [F06/ADR-004](ADR-004-balance-target-and-serialization.md) | Ajuste por saldo objetivo y serialización de la dimensión saldo | Aceptado | 2026-08-29 | ADR-022 |
| [F06/ADR-005](ADR-005-balance-observation.md)              | Observación histórica de saldo                                  | Aceptado | 2026-08-29 | ADR-023 |
| [F06/ADR-006](ADR-006-annulment.md)                        | Anulación de una operación                                      | Aceptado | 2026-08-29 | ADR-024 |
| [F06/ADR-007](ADR-007-personal-read-surface.md)            | Superficie de lectura del Modo Personal                         | Aceptado | 2026-08-30 | ADR-025 |
| [F06/ADR-008](ADR-008-personal-statistics.md)              | Estadísticas agregadas del Modo Personal                        | Aceptado | 2026-08-31 | ADR-026 |
| [F06/ADR-009](ADR-009-expense-only-categories.md)          | La categoría es del gasto, y el icono es una clave semántica    | Aceptado | 2026-09-01 | ADR-027 |

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F01/ADR-001](../F01/ADR-001-accounting-model.md) — Modelo contable de Nomey
- [F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) — Frontera autoritativa de escritura
- [F03/ADR-007](../F03/ADR-007-client-operation-idempotency.md) — Idempotencia de las operaciones originadas por el cliente
- [F03/ADR-008](../F03/ADR-008-operation-version-model.md) — Modelo físico de operaciones, versiones y comandos cliente
- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) — Persistido frente a derivado, reparto contextual y proyección canónica
- [F03/ADR-013](../F03/ADR-013-economic-attribution.md) — Atribución económica de efectos a un usuario
