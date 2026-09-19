# F10 — Identidad contextual y ciclo de vida del vínculo

**Alcance:** el ciclo de vida del vínculo entre una cuenta y una identidad
contextual, bajo un principio de producto: **ninguna cuenta adjudica
unilateralmente la identidad de otra**. Identidad permanente en el grupo
(vincularse no se deshace; salir y volver son F9); identidad (`link_id`) y
procedencia (`origin_command_id`) de cada instancia; disputas sin
consentimiento declaradas no resolubles; el cierre de alcance de las cesiones
y fusiones (ninguna entra, F10/ADR-004). **Fuera:** revocación del vínculo
ajeno, expulsión, roles, identidad anónima, recuperación global de cuenta,
soporte administrativo, cesión de identidad entre cuentas
(`identity_handover`), fusión de dos participantes con cuenta y fusión
fantasma ↔ fantasma. **Estado de la fase:** **CERRADA el 2026-09-16** (abierta el
2026-09-14); A0 … C0 cerrados; B1 y B2 no existen. El punto de entrada es el
[handoff](../../architecture/phase-10-handoff.md).
El detalle está en [el roadmap](../../product/roadmap.md) y la
apertura, con las mediciones previas y los insumos de cada ADR, en
[`phase-10-opening.md`](../../architecture/phase-10-opening.md).

Los ADR de esta carpeta se numeran de forma independiente (`F10/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                  | Título                                                                                                                                                                                                                                                                                                               | Estado   | Fecha      | Bloque |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------ |
| [F10/ADR-001](ADR-001-link-instance-lifecycle.md)    | Ciclo de vida de una instancia propia de vínculo cuenta ↔ identidad contextual — **superado en parte** por F10/ADR-002 (§2, §4–§12, §14: la baja); §0, §1, §3 y §13 siguen vigentes                                                                                                                                  | Aceptado | 2026-09-14 | F10.A1 |
| [F10/ADR-002](ADR-002-permanent-identity.md)         | Identidad permanente en el grupo: el vínculo cuenta ↔ participante no se deshace — **precisado** por F10/ADR-003 (§2: salir termina el vínculo; §3: el copy al reclamar)                                                                                                                                             | Aceptado | 2026-09-15 | F10.A3 |
| [F10/ADR-003](ADR-003-active-and-historical-link.md) | Vínculo activo y vínculo histórico: salir termina la identidad en el grupo, volver la reactiva o elige otra (supera la única opción al volver de F09/ADR-010)                                                                                                                                                        | Aceptado | 2026-09-15 | F10.A3 |
| [F10/ADR-004](ADR-004-identity-scope-closure.md)     | Cierre de alcance: sin cesiones, sin fusiones nuevas y sin `identity_handover`; cadenas de fusión prohibidas como invariante — **supera** las referencias a «F10.B0» de ADR-001 (No cubre), ADR-002 (Consecuencias: «única vía prevista») y ADR-003 (Consecuencias)                                                  | Aceptado | 2026-09-16 | F10.B0 |
| [F10/ADR-005](ADR-005-personal-start.md)             | Punto de inicio del Modo Personal tras el Invitado: incluir los movimientos de grupos o empezar desde cero, una sola vez, persistido; `fresh` es un corte por `operation.created_at` que respeta el saldo, el historial, las estadísticas y las cuotas, nunca las deudas (supera en parte F06/ADR-004 y F06/ADR-007) | Aceptado | 2026-09-16 | F10.C0 |

La fase está cerrada y no queda ningún ADR previsto. F10.C0 trajo F10/ADR-005
—una decisión de producto nacida del flujo Invitado → cuenta de A3— y cumplió
los dos cierres que ADR-004 le asignó (migración `20260920120000`: retirar o
saldar a un origen fusionado se rehúsa con `PARTICIPANT_MERGED`; una fusión es
de un salto por trigger de catálogo; `merge-invariants.sql`).

Lo que cada uno recibe como insumo está en `phase-10-opening.md` §5 y §6; el
primero está aceptado sobre esos insumos y las mediciones de F10.A1; el
segundo y el tercero son decisiones de producto tomadas durante el cliente de
A3 (la revisión visual en el iPhone); el cuarto mide §3.3 y §6 sobre el
modelo que dejó A3 y los cierra en negativo. F10/ADR-002 cita «F10/ADR-003»
como el ADR de B0 por anticipación: ese número lo tomó el ciclo de vida del
vínculo (el siguiente libre, sin reservas), y B0 fue F10/ADR-004. Las
referencias hacia delante a «F10.B0» que hacen ADR-001, ADR-002 y ADR-003 se
leen con ADR-004: no hay ninguna vía por la que una identidad cambie de
cuenta, y no hay fusión entre participantes sin cuenta.

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F03/ADR-009](../F03/ADR-009-participant-identity.md) — Identidad de participantes sin cuenta y vínculo con usuarios
- [F03/ADR-013](../F03/ADR-013-economic-attribution.md) — Atribución económica de efectos a un usuario
- [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md) — Modelo de Grupo y contrato de permisos (sin roles)
- [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) — Salir de un Grupo
- [F09/ADR-004](../F09/ADR-004-group-invitations.md) — Invitaciones a un Grupo y unión directa
- [F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md) — Retirar a un participante sin cuenta
- [F09/ADR-006](../F09/ADR-006-unclaim-participant.md) — Rectificar una reclamación (retirada por F10/ADR-002: la identidad es permanente)
- [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md) — La obligación de quien salió es intocable (comparación de atribución por versión, punto de partida del operador que F10/ADR-001 debe definir)
- [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md) — Asociar un participante sin cuenta a la propia cuenta
- [F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md) — Volver a entrar en un grupo tras salir (su única opción al volver, superada por F10/ADR-003)
