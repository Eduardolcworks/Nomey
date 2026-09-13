# F09 — Grupos, gastos compartidos y deudas

**Alcance:** Modelo de Grupo, provisioning, invitaciones, salida, retirada, rectificación, pagos declarados, obligación de quien salió, asociación y reincorporación. **Estado de la fase:** Cerrada el 2026-09-14. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F09/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                            | Título                                                                                     | Estado   | Fecha      | Antes   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- | ---------- | ------- |
| [F09/ADR-001](ADR-001-group-model-and-permissions.md)          | Modelo de Grupo y contrato de permisos                                                     | Aceptado | 2026-09-06 | ADR-032 |
| [F09/ADR-002](ADR-002-client-provisioning-idempotency.md)      | Idempotencia por clave del provisioning iniciado por cliente                               | Aceptado | 2026-09-06 | ADR-033 |
| [F09/ADR-003](ADR-003-leaving-a-group.md)                      | Salir de un Grupo, y dar por saldado a quien salió                                         | Aceptado | 2026-09-10 | ADR-034 |
| [F09/ADR-004](ADR-004-group-invitations.md)                    | Invitaciones a un Grupo y unión directa                                                    | Aceptado | 2026-09-10 | ADR-035 |
| [F09/ADR-005](ADR-005-retire-unlinked-participant.md)          | Retirar a un participante sin cuenta                                                       | Aceptado | 2026-09-11 | ADR-036 |
| [F09/ADR-006](ADR-006-unclaim-participant.md)                  | Rectificar una reclamación («Me equivoqué de participante»)                                | Aceptado | 2026-09-11 | ADR-037 |
| [F09/ADR-007](ADR-007-group-payments-and-exit-without-debt.md) | Pagos registrados en el grupo, su anulación, y salir sin pendientes                        | Aceptado | 2026-09-12 | ADR-038 |
| [F09/ADR-008](ADR-008-departed-obligation-immutable.md)        | La obligación de quien salió del grupo es intocable                                        | Aceptado | 2026-09-12 | ADR-039 |
| [F09/ADR-009](ADR-009-associate-ghost-to-own-account.md)       | Asociar un participante sin cuenta a la propia cuenta (fusión de identidades contextuales) | Aceptado | 2026-09-14 | ADR-040 |
| [F09/ADR-010](ADR-010-rejoin-after-departure.md)               | Volver a entrar en un grupo tras salir voluntariamente                                     | Aceptado | 2026-09-14 | ADR-041 |

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F01/ADR-001](../F01/ADR-001-accounting-model.md) — Modelo contable de Nomey
- [F03/ADR-004](../F03/ADR-004-membership-rls.md) — Comprobación de membresía y estrategia de RLS
- [F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) — Frontera autoritativa de escritura
- [F03/ADR-007](../F03/ADR-007-client-operation-idempotency.md) — Idempotencia de las operaciones originadas por el cliente
- [F03/ADR-008](../F03/ADR-008-operation-version-model.md) — Modelo físico de operaciones, versiones y comandos cliente
- [F03/ADR-009](../F03/ADR-009-participant-identity.md) — Identidad de participantes sin cuenta y vínculo con usuarios
- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) — Persistido frente a derivado, reparto contextual y proyección canónica
- [F03/ADR-013](../F03/ADR-013-economic-attribution.md) — Atribución económica de efectos a un usuario
- [F06/ADR-006](../F06/ADR-006-annulment.md) — Anulación de una operación
- [F07/ADR-001](../F07/ADR-001-offline-command-queue-and-optimistic-projection.md) — Cola de escritura sin conexión, durabilidad de la clave y proyección optimista
