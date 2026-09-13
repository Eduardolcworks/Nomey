# F07 — Entrada rápida, offline y sincronización

**Alcance:** Cola durable de comandos, proyección optimista e incidencias. **Estado de la fase:** Cerrada. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F07/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                                       | Título                                                                         | Estado   | Fecha      | Antes   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ---------- | ------- |
| [F07/ADR-001](ADR-001-offline-command-queue-and-optimistic-projection.md) | Cola de escritura sin conexión, durabilidad de la clave y proyección optimista | Aceptado | 2026-09-03 | ADR-028 |
| [F07/ADR-002](ADR-002-incident-labels-and-review-destination.md)          | Etiquetas visibles de la incidencia, y a dónde lleva «Revisar»                 | Aceptado | 2026-09-04 | ADR-029 |

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F03/ADR-007](../F03/ADR-007-client-operation-idempotency.md) — Idempotencia de las operaciones originadas por el cliente
- [F03/ADR-008](../F03/ADR-008-operation-version-model.md) — Modelo físico de operaciones, versiones y comandos cliente
