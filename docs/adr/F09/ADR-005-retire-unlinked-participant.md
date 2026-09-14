# F09/ADR-005 — Retirar a un participante sin cuenta

- **Estado:** Aceptado (2026-09-11). Implementado en la migración
  `20260912140000_retire_participant.sql`; pendiente de validación visual en el
  iPhone, que no cambia el contrato.
- **Fecha:** 2026-09-11
- **Identificador anterior:** ADR-036 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Alcance:** que un miembro actual pueda retirar del grupo a un participante
  **activo, declarado por su nombre y sin cuenta**, con o sin historial, y con
  o sin pendientes.
- **Amplía** [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) §6, que fijó «Saldado» sólo
  para quien **salió** del grupo. No es conducta de F09/ADR-003: es una decisión
  nueva, aquí. Todo lo demás de F09/ADR-003 sigue igual: quién sale, qué se conserva
  al salir, qué ve Personal, la irreversibilidad de la retirada.
- **Se apoya en** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (participante
  contextual; el vínculo en su relación), [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md)
  §11 (bloqueo antes de leer deuda), [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md)
  §2 (sin roles) y [F09/ADR-004](../F09/ADR-004-group-invitations.md) (reclamar).

## Contexto

Un grupo se crea con participantes por nombre (F03/ADR-009). Algunos no entrarán
nunca —un nombre equivocado, alguien que al final no vino— y hasta ahora no
había manera de quitarlos: seguían en «Repartir entre», en Saldos y en el
contador. F09/ADR-003 §6 resolvió al participante **que salió**; el que nunca tuvo
cuenta no había salido de ningún sitio.

## Decisión

### 1. Es la misma retirada que «Saldado», con otra guardia

> **Retirar a un participante sin cuenta es la retirada de F09/ADR-003 §6 —pares
> reales bajo bloqueo, confirmados contra lo que se enseñó, un efecto de deuda
> por par si los hay, el registro de retiro, el aviso— precedida de cerrar HOY
> su presencia (`valid_until = current_date`, día excluido, como al salir).**

`api.settle_participant` y `api.retire_participant` delegan en un único
núcleo (`sec.retire_participant_core`); lo que cambia es la guardia: aquél
exige inactivo (`PARTICIPANT_ACTIVE` si no), éste exige **sin cuenta**.

### 2. Sin cuenta se comprueba en el servidor, bajo bloqueo

> **Un vínculo —aunque sea el de quien salió— cierra esta vía
> (`PARTICIPANT_LINKED`, 409). A quien tiene cuenta no se le retira por otra
> persona.** La comprobación va después del bloqueo del ámbito (F03/ADR-010 §11) y
> de un cerrojo consultivo por ámbito (`sec.lock_participant_claims`) que
> `api.redeem_invitation` toma también antes de decidir: reclamar y retirar se
> serializan, y ninguno decide sobre un estado que el otro está cambiando.

No se usa la fila estable del ámbito para reclamar porque al reclamar el actor
todavía no es miembro y el provisioner no puede ver esa fila; un cerrojo
consultivo no lee nada y sirve a los dos roles. Medido con dos sesiones
reales en `scripts/retire-claim-race.sh`, en las dos direcciones.

### 3. Sin borrado físico; «Eliminar» y «Retirar» son la misma operación

> **Nada se borra: ni el participante, ni operaciones, ni efectos, ni
> referencias.** La pantalla dice «Eliminar participante» cuando ningún efecto
> vigente lo nombra (`has_history = false`) y «Retirar participante» cuando sí;
> por debajo es la misma retirada.

Un participante sin historial se retira igual porque la retirada es lo que da
idempotencia (replay por `participant_retirement`), aviso y ausencia de dobles
caminos; un borrado físico no las daría y no aporta nada que la persona vea.

### 4. Las deudas no se cancelan en silencio

> **El cliente enseña los pares pendientes y los manda literales; el servidor
> rehúsa (`SETTLEMENT_STALE`) si no son los reales.** Saldo neto cero con pares
> cruzados sigue siendo pares pendientes. Resolverlos por esta vía es lo mismo
> que «Saldado»: un efecto de deuda por par, **ningún movimiento de dinero en
> Personal**.

### 5. Cualquier miembro actual

Como en F09/ADR-001 §2: no hay roles. Un no miembro recibe `NOT_AUTHORIZED`.

## Alternativas consideradas

- **Borrar físicamente al que no tiene historial.** Descartado: obliga a un
  segundo camino de idempotencia y de avisos, y deja la puerta a borrar «casi
  sin historial». La retirada ya hace todo lo que la persona ve.
- **Serializar con la fila del ámbito también al reclamar.** Descartado por
  medida: exigiría que el provisioner viera grupos de los que el actor no es
  miembro, que `group-provisioning` E6 prohíbe a propósito.

## Consecuencias

- El writer gana `UPDATE (valid_until)` sobre `core.participant_period` con
  una policy que sólo permite cerrar presencias de grupos de los que el actor
  es miembro.
- `api.group_participant` publica `has_history`, por un definer reducido con
  la guardia de membresía, igual que `is_linked`.
- **Orden de los dos bloqueos, corregido el mismo día por la migración
  `20260912150000` (protocolo de identidad del grupo, F09/ADR-006 § Concurrencia):**
  el cerrojo consultivo va **primero**, antes de la membresía, del vínculo y de
  la fila del ámbito; lo que aquí se decide —qué se comprueba y bajo qué
  cerrojo— no cambia. `supabase/checks/group-identity-lock.sql` guarda el orden.
- Evidencia: `supabase/checks/retire-participant.sql` (A–F),
  `scripts/retire-claim-race.sh`, y las secciones G–J de
  `leave-and-settle.sql` sin cambios sobre «Saldado».
