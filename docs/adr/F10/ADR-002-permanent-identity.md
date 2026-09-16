# F10/ADR-002 — Identidad permanente en el grupo: el vínculo cuenta ↔ participante no se deshace

- **Estado:** Aceptado (2026-09-15)
- **Fecha:** 2026-09-15
- **Alcance:** qué ocurre con el vínculo entre una cuenta y un participante de
  Grupo una vez creado, sea cual sea su origen —crear el grupo, entrar como
  nuevo o reclamar—: **es permanente dentro de ese grupo**. No existe ninguna
  acción de producto para deshacerlo, ni para el titular ni para nadie. Fija
  también la única salvaguarda que el producto ofrece antes de vincularse: la
  confirmación al reclamar.
- **No cubre:** salir del grupo y volver, que siguen siendo exactamente
  [F09/ADR-003](../F09/ADR-003-leaving-a-group.md), [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)
  C8 y [F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md) y **no se
  reabren aquí**; la cesión consentida de una identidad entre dos cuentas y la
  fusión de dos participantes sin cuenta (F10.B0, `F10/ADR-003`); la
  revocación del vínculo ajeno, la expulsión, los roles, la identidad anónima
  y la recuperación global de cuenta (fuera de F10,
  [`phase-10-opening.md`](../../architecture/phase-10-opening.md) §1).
- **Supera** de [F10/ADR-001](ADR-001-link-instance-lifecycle.md) todo lo
  relativo a **dejar** una instancia propia: **§2** (la regla económica de la
  baja), **§4** (fusiones en la baja), **§5** (qué significa dejar la
  identidad), **§6** (efecto de la baja), **§7** (el hecho
  `core.participant_unlink`), **§8** (seguridad de la baja), **§9** (carreras
  de la baja), **§10** (aviso `identity_released`), **§11–§12** (compatibilidad
  y transición del `unclaim` de F9) y **§14** (códigos `UNLINK_*` y
  `LINK_SUPERSEDED`). Y de [F09/ADR-006](../F09/ADR-006-unclaim-participant.md)
  la acción entera de rectificar una reclamación.
- **Conserva** de F10/ADR-001: **§0** (ninguna cuenta adjudica la identidad de
  otra), **§1** (cada instancia tiene identidad, `link_id`, y procedencia,
  `origin_command_id`), **§3** (la línea base y `S0` se escriben bajo el
  cerrojo al nacer la instancia, ahora como auditoría histórica sin lector de
  producto) y **§13** (disputas sin consentimiento). Y de F09/ADR-006 sólo la
  guarda de caja como conocimiento medido, sin función que la evalúe.
- **Se apoya en** [F03/ADR-009](../F03/ADR-009-participant-identity.md)
  (participante contextual; el vínculo en su relación; los efectos nombran
  participantes), [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) §8 (salir
  conserva el vínculo, que sostiene el Personal), [F09/ADR-004](../F09/ADR-004-group-invitations.md)
  (la invitación autoriza; reclamar = vincular), [F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md)
  (sólo se retira a quien no tiene cuenta) y [F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md)
  (volver es por vínculo, con el mismo participante).

## Contexto

F10/ADR-001 (Aceptado el 2026-09-14) definió cómo una cuenta podía **dejar**
cualquier instancia propia de vínculo bajo una regla económica temporal, y
F10.A2 (migración `20260916120000`, PR #63) la implementó entera en el backend:
evaluador firmado por instancia, `api.unlink_participant`, hecho de baja,
aviso `identity_released`, carreras con dos sesiones reales y frontera HTTP.
F10.A3 empezó el cliente («Dejar mi identidad») y, al verlo como producto, la
decisión cambió antes de publicar ninguna UI:

- Una identidad de grupo que se puede soltar deja al participante «sin cuenta»
  con deudas y pagos vivos, reclamable por cualquiera con invitación: la regla
  económica evitaba el escape contable, pero no que la **identidad** de un
  grupo cambie de manos sin que nadie del grupo lo decida.
- El caso que motivó el `unclaim` de F9 —«reclamé al participante equivocado»—
  se resuelve mejor **antes** de vincular (confirmación explícita y clara) que
  después, con una operación que necesita una regla económica, un hecho, un
  aviso y una UX propia para explicar por qué a veces no se puede.
- Salir del grupo ya existe, ya conserva el vínculo y ya exige la situación
  económica adecuada (neto cero, novación de pares vivos). No hace falta una
  segunda salida.

Sin producción ni consumidores externos, el coste de retirar la superficie de
A2 es una migración; el coste de mantenerla sería dos semánticas vivas.

## Decisión

### §1 · La regla

> **Una vez una cuenta se vincula a un participante de un grupo —creando el
> grupo, entrando como nuevo o reclamando—, ese participante es su identidad
> permanente dentro de ese grupo.**

No existe ninguna acción para deshacerlo: ni `unclaim`, ni `unlink`, ni «Me
equivoqué», ni «Dejar mi identidad», ni ninguna forma de devolver el
participante al estado «sin cuenta». Ni el titular, ni los demás miembros, ni
nadie (§0 de F10/ADR-001 sigue vigente).

### §2 · Salir y volver son F9, sin cambios

Dejar de participar es **«Salir del grupo»** ([F09/ADR-003](../F09/ADR-003-leaving-a-group.md)):
se sale con neto cero y los pares vivos se novan ([F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)
C8), la presencia se cierra, la membresía se borra, **el vínculo se conserva**
y el participante ni es reclamable ni retirable por otros. Volver es
[F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md): el mismo
participante, por el vínculo que nunca se soltó. Este ADR no modifica ninguna
de esas reglas ni sus funciones (`api.leave_group`,
`sec.record_departure_novation`, `api.redeem_invitation` con `rejoin`).

### §3 · La salvaguarda: confirmar antes de reclamar

Reclamar un participante existente pide confirmación en la ventana que ya
existía («¿Eres {name}?», «Volver» / «Sí, soy {name}») y su cuerpo dice, sin
lenguaje técnico, que **al continuar ese participante quedará vinculado a la
cuenta en este grupo de forma permanente**. Crear el grupo y entrar como nuevo
no piden una confirmación adicional: no hay historia ajena que asumir.

### §4 · Estado final del esquema (migración `20260917120000`)

Se retiran, sin editar ninguna migración anterior: `api.unlink_participant`,
`sec.unlink_instance`, `sec.unlink_blocking_attribution`,
`sec.unclaim_blocking_operations`, `api.unclaim_participant`,
`sec.my_claim_command_id`, `sec.my_link_id`, la tabla `core.participant_unlink`
(fail-closed: exige cero filas), el `kind` `identity_released` (fail-closed:
cero avisos), y la columna derivada `participant_user_link.claim_command_id`
con su `CHECK` y su FK; `api.group_participant` deja de publicar
`claim_command_id` y `link_id`; `api.redeem_invitation` deja de escribir la
columna.

Se conservan: `participant_user_link.link_id` (identidad interna de la
instancia) y `origin_command_id` (procedencia), `core.link_baseline` y
`core.link_baseline_subject` con sus escritores bajo el cerrojo en
`create_group` y `redeem_invitation` (auditoría de lo que existía al nacer la
instancia; **este ADR no decide su uso futuro**, lo decidirá quien lo necesite),
`sec.instance_subjects`, `sec.link_baseline_rows`, y las migraciones
`20260915120000` y `20260916120000` tal como se aplicaron.

### §5 · Errores

Ninguno nuevo. Desaparecen `UNLINK_BLOCKED_ATTRIBUTION`, `UNLINK_BLOCKED_CASH`,
`LINK_SUPERSEDED`, `UNCLAIM_BLOCKED_CASH`, `CLAIM_SUPERSEDED`,
`UNCLAIM_NOT_AVAILABLE` y `UNCLAIM_BLOCKED_MERGE`. Una llamada a las funciones
retiradas responde, por PostgREST, que no existen (`PGRST202 · 404`).

## Alternativas consideradas

- **Mantener la baja de F10/ADR-001 con su regla económica.** Rechazada: la
  regla cerraba el escape contable pero no la pérdida de control sobre quién es
  quién en el grupo, y añadía a producto un flujo con cuatro rechazos distintos
  que explicar. La confirmación previa cubre el caso real con una frase.
- **Baja sólo para vínculos nacidos de reclamación (volver a F09/ADR-006).**
  Rechazada por lo mismo, y porque F10.A0 midió que dejaba desprenderse de
  deuda nacida después de reclamar.
- **Conservar `api.unlink_participant` sin UI.** Rechazada: una función
  ejecutable por `authenticated` que contradice el producto es superficie,
  aunque nadie la llame.
- **Retirar también la línea base y `S0`.** Aplazada: exigiría recrear
  `create_group` y `redeem_invitation` sin beneficio inmediato; se conservan
  como auditoría insert-only y se decide sobre ellas cuando haya un uso o un
  motivo para retirarlas.

## Consecuencias

- Quien reclamó al participante equivocado sólo puede **salir del grupo**
  (con neto cero) y, con invitación, entrar de nuevo como otro participante;
  el participante reclamado por error sigue vinculado a su cuenta, saldado o
  no, y nadie más puede reclamarlo ni retirarlo. Es la consecuencia deliberada
  de una identidad permanente, y la confirmación al reclamar existe para que
  sea rara.
- La cesión consentida A → B (F10.B0) es ahora la **única** vía prevista para
  que una identidad cambie de cuenta, y tendrá que decidir qué conserva de la
  instancia (`link_id`, procedencia, línea base) por sí misma.
- El cliente no necesita citar la instancia: `link_id` es interno. Si un día
  hace falta publicarlo, es una decisión de superficie, no de este ADR.
- Evidencia que este ADR deja en pie: `supabase/checks/link-instance.sql`
  (instancia, procedencia, línea base, retirada de la baja),
  `group-identity-lock.sql` (once funciones bajo el cerrojo),
  `scripts/identity-lock-race-evidence.sh` (reclamar contra el writer, dos
  sesiones) y la sección 13 de `scripts/http-boundary-check.sh` (ninguna baja
  en la frontera; la fila propia sin `link_id` ni `claim_command_id`).
