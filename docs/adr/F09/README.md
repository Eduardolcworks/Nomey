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
| [F09/ADR-006](ADR-006-unclaim-participant.md)                  | Rectificar una reclamación («Me equivoqué de participante») — **retirada por F10/ADR-002** | Aceptado | 2026-09-11 | ADR-037 |
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

## Notas posteriores al cierre de la fase

Los ADR aceptados no se editan; lo que un ADR posterior o el cierre de la
fase dejó superado o precisado se anota aquí, con fecha, y el ADR que lo
sustituye se cita.

- **F09/ADR-004 §3 — emisión, caducidad y revocación: CONFIRMADO por producto
  el 2026-09-14 tal como está implementado.** Cualquier miembro emite y revoca ·
  multiuso hasta caducar o revocarse · 7 días por defecto, 1–30 · el token se
  enseña una sola vez (`20260911150000`; `group-invitations.sql` B2/B4). La
  cabecera del ADR que dice «pendiente de confirmación» queda resuelta por esta
  nota. Consecuencia registrada en F10.A0: una invitación viva es la única llave
  de un grupo sin miembros.
- **F09/ADR-004 §5 («Reincorporarse sigue en F10») y «Fuera de alcance»
  (reincorporación, compartir la invitación):** superados dentro de F9.
  Compartir grupo (QR y hoja del sistema) se hizo en el bloque siguiente; la
  reincorporación la decide [F09/ADR-010](ADR-010-rejoin-after-departure.md).
  «Deshacer un vínculo erróneo» lo cubre [F09/ADR-006](ADR-006-unclaim-participant.md)
  para la propia reclamación; la revocación por otro **no llegará**: está
  prohibida por principio de producto (F10).
- **F09/ADR-006 — superado en dos puntos por
  [F10/ADR-001](../F10/ADR-001-link-instance-lifecycle.md) (Aceptado,
  2026-09-14):** **§1**, en la identidad y el ancla de la instancia: el CAS y
  el replay se anclan a `link_id`, la procedencia pasa a `origin_command_id` y
  `claim_command_id` deja de ser normativa; la vía deja de limitarse a vínculos
  nacidos de una reclamación y cubre también creador y «Soy nuevo». **§2, caso
  C**, en la regla económica: hoy la rectificación se permite aunque durante el
  vínculo haya nacido deuda nueva que nombra al participante (medido en
  F10.A0: el reclamante se desprende de una deuda nacida después de reclamar y
  vuelve como nuevo); la regla temporal de obligaciones de F10/ADR-001 §2
  bloquea exactamente eso y conserva el caso B (historia anterior a la
  reclamación). El resto de ADR-006 —regla de caja, protocolo de identidad,
  carreras, hecho de baja como patrón— sigue en pie y F10/ADR-001 lo cita.
  **Retirada entera por [F10/ADR-002](../F10/ADR-002-permanent-identity.md)
  (Aceptado, 2026-09-15; migración `20260917120000`):** la identidad en el
  grupo es permanente y no existe ninguna acción de deshacer un vínculo.
  `api.unclaim_participant` —wrapper de compatibilidad durante F10.A2— ya no
  existe, como `claim_command_id`, `sec.my_claim_command_id`,
  `UNCLAIM_BLOCKED_MERGE` y `core.participant_unclaim`; «Me equivoqué» se
  sustituye por la confirmación al reclamar. Lo que sigue en pie de ADR-006 es
  la guarda de caja como conocimiento medido y el protocolo de identidad.
- **F09/ADR-009 — estado:** validado en el iPhone por el propietario el
  2026-09-14 (`PROJECT_STATE.md`), aunque su cabecera diga «sin validar en
  dispositivo». **Guarda de catálogo:** «Consecuencias» cita una guarda
  «ninguna agregación por participante sin `canonical_participant`»; **no
  existe**, y el propio cuerpo explica por qué no hace falta (la resolución vive
  en `core.current_effect`). **Hallazgo (F10.A0):** `sec.payment_counterpart_name`
  publica el nombre crudo del origen fusionado como contraparte de un pago,
  mientras el ADR afirma que se publica por canónico; **anotado, no
  corregido, por [F10/ADR-004](../F10/ADR-004-identity-scope-closure.md)
  (F10.B0)**: el cliente resuelve el nombre por `merged_into_participant_id`
  y la única fusión posible es hacia la identidad del actor. **Superado por
  [F10/ADR-001](../F10/ADR-001-link-instance-lifecycle.md) §4 (Aceptado,
  2026-09-14):** el bloqueo **absoluto** `UNCLAIM_BLOCKED_MERGE` —rehusar
  dejar la identidad por la mera existencia de una fusión— deja de aplicar; una
  fusión previa a la instancia forma parte de su línea base y no bloquea, y una
  fusión durante la instancia bloquea sólo si absorbió atribución económica.
- **F09/ADR-006 y F09/ADR-005 — «pendiente de validación visual en el
  iPhone»:** F9 cerró validada en iPhone y emulador Android (roadmap, Fase 9,
  «Estado de cierre»).
- **F09/ADR-010 — la única opción al volver: superada por
  [F10/ADR-003](../F10/ADR-003-active-and-historical-link.md) (Aceptado,
  2026-09-15).** Salir **termina** el vínculo sin borrarlo (activo → histórico):
  quien salió deja el presente del grupo (Saldos, recuento, lista) y no es ni
  reclamable ni retirable; al volver con invitación ve «Volver a entrar como X»
  **y** los participantes sin cuenta disponibles, y puede elegir cualquiera de
  los dos; `claim` ya no responde `REJOIN_REQUIRED` —sólo `new`, que sigue
  rehusado—. Todo lo demás de F09/ADR-010 (mismo participante al volver, periodo
  desde hoy, C6 una sola vez, serialización) sigue vigente. F09/ADR-003 §8
  («salir conserva el vínculo») sigue cierto: se conserva, y además termina.
