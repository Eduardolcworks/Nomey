# F10 — Participantes sin cuenta

**Alcance:** el ciclo de vida del vínculo entre una cuenta y una identidad
contextual, bajo un principio de producto: **ninguna cuenta adjudica
unilateralmente la identidad de otra**. Dejar cualquier instancia propia de
vínculo con una regla temporal de obligaciones; identidad (`link_id`) y
procedencia (`origin_command_id`) de cada instancia; cesión consentida atómica
entre dos cuentas del mismo grupo, o su aplazamiento declarado; fusión de dos
participantes sin cuenta, decidida sobre su matriz económica; disputas sin
consentimiento declaradas no resolubles. **Fuera:** revocación del vínculo
ajeno, expulsión, roles, identidad anónima, recuperación global de cuenta,
soporte administrativo. **Estado de la fase:** Abierta el 2026-09-14; F10.A0
cerrado. El detalle está en [el roadmap](../../product/roadmap.md) y la
apertura, con las mediciones previas y los insumos de cada ADR, en
[`phase-10-opening.md`](../../architecture/phase-10-opening.md).

Los ADR de esta carpeta se numeran de forma independiente (`F10/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

Ninguno redactado todavía. Los dos previstos, en este orden:

| ADR             | Tema                                                                                                                                                                                                 | Bloque | Estado    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- |
| **F10/ADR-001** | Principio de no adjudicación · ciclo de vida del vínculo propio (regla temporal de obligaciones, `link_id` y `origin_command_id`, hecho de baja, disputas sin consentimiento, expulsión inexistente) | F10.A1 | Pendiente |
| **F10/ADR-002** | Cesión consentida atómica (`identity_handover`) o su aplazamiento · fusión fantasma ↔ fantasma sobre la matriz económica medida                                                                      | F10.B0 | Pendiente |

Lo que cada uno recibe como insumo está en `phase-10-opening.md` §5 y §6.

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F03/ADR-009](../F03/ADR-009-participant-identity.md) — Identidad de participantes sin cuenta y vínculo con usuarios
- [F03/ADR-013](../F03/ADR-013-economic-attribution.md) — Atribución económica de efectos a un usuario
- [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md) — Modelo de Grupo y contrato de permisos (sin roles)
- [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) — Salir de un Grupo
- [F09/ADR-004](../F09/ADR-004-group-invitations.md) — Invitaciones a un Grupo y unión directa
- [F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md) — Retirar a un participante sin cuenta
- [F09/ADR-006](../F09/ADR-006-unclaim-participant.md) — Rectificar una reclamación (F10/ADR-001 la generaliza y la supera en un punto)
- [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md) — La obligación de quien salió es intocable (patrón de comparación por multiconjunto)
- [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md) — Asociar un participante sin cuenta a la propia cuenta
- [F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md) — Volver a entrar en un grupo tras salir
