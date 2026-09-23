# F11 — Multimoneda operativa

**Alcance:** Fuente de tipos de cambio con histórico por fecha efectiva, conversión, jerarquía visual del importe original, cambio de moneda base. **Estado de la fase:** Abierta: **F11.A cerrada** (contrato de fuente y resolución, sin implementación); **F11.B y F11.C cerradas**; **F11.D** integra el gasto de grupo sobre F11/ADR-003. El detalle está en
[el roadmap](../../product/roadmap.md).
El estado, el contraste con F9 y las limitaciones conocidas están en
[el seguimiento de F11](../../architecture/phase-11-progress.md), que no es normativo.

Los ADR de esta carpeta se numeran de forma independiente (`F11/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                          | Título                                                         | Estado   | Fecha      | Antes                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------- | -------- | ---------- | ----------------------------------------------- |
| [F11/ADR-001](ADR-001-fx-rate-resolution.md)                 | Resolución autoritativa del tipo de cambio                     | Aceptado | 2026-09-13 | — (borrador de rama `ADR-032`, nunca integrado) |
| [F11/ADR-002](ADR-002-per-currency-daily-rate.md)            | Tipo del día por moneda, fijación única y límite de antigüedad | Aceptado | 2026-09-16 | —                                               |
| [F11/ADR-003](ADR-003-group-expense-conversion-and-split.md) | Conversión y reparto de un gasto de grupo en moneda extranjera | Aceptado | 2026-09-22 | —                                               |

## Decisiones de otras fases que esta fase aplica

La representación del dinero y del tipo congelado ya están decididas; el pago declarado rehúsa la conversión, y F11 no la implementa: F11/ADR-001 deja las liquidaciones fuera de su alcance.

Se citan, no se copian ni se redefinen:

- [F01/ADR-001](../F01/ADR-001-accounting-model.md) — Modelo contable de Nomey
- [F02/ADR-001](../F02/ADR-001-money-representation.md) — Representación exacta del dinero
- [F03/ADR-001](../F03/ADR-001-currency-definition-identity.md) — Identidad física de la definición monetaria
- [F03/ADR-005](../F03/ADR-005-exact-data-boundary.md) — Frontera de datos exactos
- [F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) — Frontera autoritativa de escritura
- [F03/ADR-008](../F03/ADR-008-operation-version-model.md) — Modelo físico de operaciones, versiones y comandos cliente
- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) — Persistido frente a derivado, reparto contextual y proyección canónica
- [F03/ADR-012](../F03/ADR-012-frozen-rate-physical-representation.md) — Representación física del tipo de cambio congelado
- [F06/ADR-002](../F06/ADR-002-version-content-and-time.md) — Contenido no monetario y grano temporal de la versión
- [F07/ADR-001](../F07/ADR-001-offline-command-queue-and-optimistic-projection.md) — Cola de escritura sin conexión, durabilidad de la clave y proyección optimista
- [F07/ADR-002](../F07/ADR-002-incident-labels-and-review-destination.md) — Etiquetas visibles de la incidencia, y a dónde lleva «Revisar»
- [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md) — Modelo de Grupo y contrato de permisos
- [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md) — Pagos registrados en el grupo, su anulación, y salir sin pendientes
- [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md) — Asociar un participante sin cuenta a la propia cuenta (fusión de identidades contextuales)
