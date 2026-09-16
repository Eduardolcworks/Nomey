# F10/ADR-003 — Vínculo activo y vínculo histórico: salir termina la identidad en el grupo, volver la reactiva o elige otra

- **Estado:** Aceptado (2026-09-15)
- **Fecha:** 2026-09-15
- **Alcance:** qué es, para el grupo, la identidad de una cuenta **después de
  salir**, y qué opciones tiene esa cuenta al **volver** con invitación. Fija
  que el vínculo cuenta ↔ participante tiene dos estados —**activo** e
  **histórico**—, que salir lo termina sin borrarlo, que un participante salido
  **no es** un participante sin cuenta, y que quien ya estuvo vuelve con su
  identidad de entonces **o** como un participante sin cuenta disponible, nunca
  como nuevo. Fija también el copy de la confirmación al reclamar, la
  cronología única de Movimientos y el estado final del esquema (migración
  `20260918120000`).
- **No cubre:** la economía de la salida —neto cero, novación de pares vivos,
  obligación intocable de quien salió—, que sigue siendo exactamente
  [F09/ADR-003](../F09/ADR-003-leaving-a-group.md), [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)
  C8 y [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md); la
  cesión consentida de una identidad entre dos cuentas y la fusión de dos
  participantes sin cuenta (F10.B0, que tomará el siguiente número libre); la
  identidad anónima; la revocación del vínculo ajeno, la expulsión y los roles
  (fuera de F10, [`phase-10-opening.md`](../../architecture/phase-10-opening.md) §1).
- **Supera** de [F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md) la
  **única opción** al volver («Volver a entrar como X», con `claim` y `new`
  rehusados por `REJOIN_REQUIRED`): desde aquí `claim` está abierto y sólo
  `new` se rehúsa. De [F10/ADR-002](ADR-002-permanent-identity.md) precisa
  **§2** («el vínculo se conserva» pasa a «el vínculo se conserva y termina»),
  **§3** (el copy de la confirmación: «mientras formes parte del grupo» en vez
  de «de forma permanente») y la consecuencia que ya anunciaba —quien reclamó
  mal sale y, con invitación, entra como otro participante— que ahora es
  ejecutable. Del cliente de F9, la fila «Inactivo» en Saldos y en la lista de
  participantes para quien salió con cuenta.
- **Conserva** de F10/ADR-002 la regla entera (**§1**: mientras la cuenta forma
  parte del grupo, ese participante es su identidad y no hay acción para
  cambiarla ni soltarla) y **§4–§5**; de F10/ADR-001 **§0**, **§1** (volver **no
  crea instancia**: el mismo `link_id` y la misma procedencia se reactivan) y
  **§3**; de F09/ADR-010 todo lo demás (periodo nuevo desde hoy sin reparto
  retroactivo, C6 una sola vez, serialización por el cerrojo de identidad).
- **Se apoya en** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (el
  vínculo en su relación; los efectos nombran participantes),
  [F03/ADR-013](../F03/ADR-013-economic-attribution.md) (atribución por vínculo,
  sin filtrar por fecha), [F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md)
  (sólo se retira a quien no tiene cuenta) y [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md)
  (asociar va a la identidad propia).

## Contexto

Con la identidad permanente (F10/ADR-002) y el ciclo de F9 sin tocar, la
revisión visual de F10.A3 en el iPhone midió dos cosas del participante que
sale del grupo:

1. **Seguía siendo una fila del presente.** `api.group_balance` lo publicaba y
   Saldos lo pintaba como «Inactivo»; `api.group_profile.participant_count` lo
   contaba; la lista de participantes de «Editar grupo» lo listaba. Para el
   grupo, alguien que se fue seguía «estando», con una palabra encima.
2. **Al volver, sólo podía ser quien fue.** F09/ADR-010 lo decidió así porque
   entonces el vínculo no distinguía «sigo dentro» de «me fui»: un vínculo era
   un vínculo, y sin esa distinción abrir `claim` a quien ya tenía uno era
   abrir la puerta a dos identidades a la vez. F10/ADR-002 acababa de decir en
   sus consecuencias que quien reclamó mal «puede salir y, con invitación,
   entrar de nuevo como otro participante», y el servidor lo rehusaba.

Lo que faltaba era un hecho, no una regla nueva: **el vínculo termina cuando la
cuenta sale**. Con ese hecho, «activo» e «histórico» dejan de inferirse de la
membresía y del periodo abierto, las vistas del presente saben a quién dejar
fuera, y volver puede ofrecer dos caminos sin que ninguno cree una segunda
identidad activa.

Se midieron antes (análisis de 14 puntos, 2026-09-15) los lectores del vínculo:
los de **atribución e historia** —`sec.is_my_participant`,
`sec.participant_personal_scope`, `api.claimed_dimension`,
`sec.departed_effects_of_version`, `sec.my_shared_expense_shares`, los
contextos de gasto y pago, `sec.pending_pairs_of`, `sec.my_reopened_debt`— no
deben distinguir estados: la historia sigue siendo de quien la hizo. Los de
**identidad activa** —`leave_group`, `associate_participant`, `preview` y
`redeem`— sí, y son cuatro.

## Decisión

### §1 · El vínculo tiene dos estados, y salir lo termina

`core.participant_user_link` gana `ended_at timestamptz` y `departure_id uuid
→ core.group_departure`, con `CHECK ((ended_at is null) = (departure_id is
null))`. **Activo** es `ended_at is null`; **histórico**, lo demás.

- `api.leave_group` termina el vínculo activo del actor con la salida que lo
  termina (`ended_at = left_at`), **después** de las guardas y de la novación
  de F9 y **antes** de borrar la membresía. Nada más cambia en esa función.
- **El vínculo no se borra nunca.** Sostiene el Personal de quien salió
  (F09/ADR-003 §8), la atribución de todo lo anterior (F03/ADR-013) y el
  `is_self` de su historia; y sigue siendo un vínculo para
  `sec.participant_available` y `api.retire_participant`: **un participante
  salido no es reclamable ni retirable ni asociable por nadie**. La clave
  primaria (`participant_id`) dice además que un participante tiene a lo sumo
  un vínculo en toda su vida: una identidad histórica **no puede volver a ser
  de otra cuenta**.
- La unicidad `(scope_id, user_id)` pasa a ser **parcial sobre los activos**:
  **una sola identidad activa por cuenta y grupo**; las históricas no cuentan.
  Un índice único sobre `departure_id` dice que una salida termina a lo sumo un
  vínculo. El provisioner puede **actualizar sólo `ended_at` y `departure_id`,
  sólo del vínculo propio** (policy `self_end`); la policy de borrado que
  F09/ADR-006 dejó y F10/ADR-002 volvió huérfana se retira, con su privilegio.
- Relleno: los vínculos de quien ya había salido (sin membresía, sin periodo
  abierto, con salida registrada) quedan terminados por su última salida. Sin
  salida registrada no se inventa ninguna.

### §2 · Participante salido ≠ participante sin cuenta

|               | Sin cuenta                 | Salido (histórico)                                                                      |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| Vínculo       | ninguno                    | terminado                                                                               |
| Presente      | activo, visible, en Saldos | fuera de Saldos, del recuento, de «Editar grupo», de la foto de netos del pago          |
| Historia      | la suya, con su nombre     | la suya, con su nombre, atribuida a su cuenta                                           |
| Reclamable    | sí (`preview` lo lista)    | **no**, por nadie, ni por quien fue                                                     |
| Retirable     | sí (F09/ADR-005)           | **no** (`PARTICIPANT_LINKED`)                                                           |
| Asociable     | sí (F09/ADR-009)           | **no** (`PARTICIPANT_LINKED`)                                                           |
| Gasto fechado | según su presencia         | según su presencia: sigue elegible en un gasto fechado cuando estaba (F09, sin cambios) |

`api.group_participant` **conserva** la fila del salido —los movimientos
anteriores lo nombran— y publica `is_departed` (por `sec.participant_link_ended`,
acotada a miembros como `is_linked`). `api.group_balance`,
`api.group_profile.participant_count` y `sec.group_positions_text` (la foto de
netos que `record_group_payment` compara) dejan fuera a las identidades
históricas, exactamente como a los retirados y a los orígenes fusionados
(`20260914160000`): su neto es cero al salir (C8) y, si un pago anulado se lo
reabre (C6), la suma del ámbito sigue siendo cero y la foto lo detecta en
alguna fila visible; ese par reabierto se sigue leyendo y saldando por la
excepción de F09/ADR-007, con el nombre del salido tomado de
`api.group_participant`.

En el cliente, `listed` no cambia (nombres y edición de gastos anteriores);
`current` = `listed` y no salido decide el recuento de la cabecera y la lista
de «Editar grupo». Saldos no necesita nada: la vista ya no lo publica.

### §3 · Volver: como entonces, o como alguien sin cuenta; nunca como nuevo

`api.preview_invitation`, para quien no es miembro:

- con vínculo histórico en el grupo → `state = 'rejoin'`, `previous_participant`
  = su identidad **más reciente** (por `ended_at`; con más de una salida, la
  última) **y** `participants` = los sin cuenta disponibles;
- sin él → `state = 'join'` y `participants`, como en F9.

`api.redeem_invitation`, con identidad anterior:

- `rejoin` → **reactiva el mismo vínculo** (`ended_at`, `departure_id` a
  nulo; mismo `link_id`, misma procedencia, misma línea base), abre el periodo
  desde hoy y la membresía, como F09/ADR-010;
- `claim` → sigue como cualquier reclamación (§2a de la función, con S0 y
  línea base bajo el cerrojo). La identidad anterior **queda como historia**:
  su vínculo sigue terminado, y con él todo lo de §2;
- `new` → `REJOIN_REQUIRED` (409): «ya estuviste en este grupo: vuelve con tu
  identidad de entonces o elige un participante sin cuenta». Sin escribir.

Sin identidad anterior, `rejoin` → `REJOIN_NOT_AVAILABLE`, y `claim`/`new` como
en F9. Las dos vías de quien ya estuvo son **excluyentes por construcción**: el
índice parcial de §1 impide dos activas. Una cuenta con Aitor histórico y Ana
activa atribuye **las dos historias** a esa cuenta (F03/ADR-013: por vínculo,
activo o no); `associate_participant` asocia siempre a la **activa**.

Cliente («¿Quién eres?»): con `rejoin`, «Volver a entrar como X» arriba, la
lista de participantes sin cuenta debajo, y **sin «Soy nuevo»**; con `join`,
como siempre.

### §4 · La confirmación al reclamar

El cuerpo de «¿Eres {name}?» deja de decir «de forma permanente» y dice lo
que es: **«Sus gastos y deudas anteriores pasarán a tu cuenta. Mientras
formes parte del grupo, este será tu participante: no podrás cambiarlo ni
desvincularte.»** / «Their earlier expenses and debts will move to your
account. While you are in the group, this will be your participant: it can't
be changed or given up.» La ventana y los botones son los de F10/ADR-002 §3.

### §5 · Movimientos es una cronología única

`api.group_payment` publica `effective_time`, y el cliente mezcla gastos y
pagos registrados («Saldado») en **una sola lista** ordenada por el criterio
elegido —fecha y hora reales de la operación, con los sin hora al final del
día en los dos sentidos (F06/ADR-002 §3), o importe— y con el desempate
estable de siempre (alta más reciente, después la identidad de la operación).
Nada se agrupa ni se prioriza por tipo. Los pagos siguen fuera de los filtros
(categoría, pagador e importe hablan de un gasto) y el anulado se lista con su
marca. La mezcla es una hoja pura (`features/groups/group-timeline.ts`).

### §6 · Estado final del esquema (migración `20260918120000`)

Se añade: las dos columnas, el `CHECK`, la FK y los dos índices parciales de
§1; `sec.participant_link_ended(uuid)`; `is_departed` en `api.group_participant`;
`effective_time` en `api.group_payment`; la policy `self_end` y el `GRANT
UPDATE (ended_at, departure_id)`. Se recrean con un cambio cada una:
`api.group_balance`, `api.group_profile`, `sec.group_positions_text`,
`api.leave_group`, `api.preview_invitation`, `api.redeem_invitation`,
`api.associate_participant`. Se retiran: la restricción única total
`(scope_id, user_id)`, la policy `provisioner_self_delete` y el `DELETE` del
provisioner. La migración 49 (`20260917120000`) no se toca.

### §7 · Errores

Ninguno nuevo. `REJOIN_REQUIRED` cambia de significado —de «sólo puedes
volver» a «no puedes entrar como nuevo»— y de mensaje; el cliente ya lo
explicaba y sigue haciéndolo con el texto nuevo. `PARTICIPANT_ALREADY_CLAIMED`
y `PARTICIPANT_LINKED` cubren al salido como cubrían al vinculado.

## Alternativas consideradas

- **Borrar el vínculo al salir y dejar al salido como «sin cuenta».**
  Rechazada: pierde el Personal y la atribución de quien salió
  (F09/ADR-003 §8, F03/ADR-013) y convierte su identidad en reclamable por
  cualquiera, que es exactamente lo que F10/ADR-002 prohíbe.
- **Inferir «histórico» de membresía + periodo abierto sin columna.** Es lo que
  había; rechazada porque no distingue a quien salió de un estado sembrado, no
  permite dos vínculos de la misma cuenta (uno activo, otro histórico) sin
  relajar la unicidad a ciegas, y obliga a cada lector a rehacer la inferencia.
- **Ofrecer al volver todas las identidades históricas de la cuenta.**
  Aplazada: el producto pidió «Volver como X» con una sola; con más de una
  salida se ofrece la última. Ampliar es una decisión de superficie, no de
  modelo.
- **Filtrar al salido en el cliente y no en las vistas.** Rechazada: la foto de
  netos del pago se compara con lo que la vista publica (`20260914160000`); si
  la vista lo listara y el cliente lo escondiera, «Saldado» caducaría siempre.
- **Ocultar al salido también de `api.group_participant`.** Rechazada: los
  gastos, pagos y pares anteriores lo nombran por su id y el cliente resuelve
  los nombres desde esa vista.

## Consecuencias

- Salir deja al grupo **sin** el que se fue: ni fila «Inactivo», ni recuento,
  ni lista. Su nombre sigue en lo que hizo; su Personal y su historia siguen
  atribuidos; nadie puede reclamarlo, retirarlo ni asociarlo.
- Quien reclamó al participante equivocado tiene por fin el camino que
  F10/ADR-002 anunciaba: salir (a cero) y, con invitación, entrar como el
  participante sin cuenta correcto. La identidad equivocada queda como historia
  suya, no vuelve al mercado.
- «Volver como X» sigue sin crear instancia (F10/ADR-001 §1): el mismo
  `link_id`, la misma procedencia, la misma línea base.
- Un par reabierto por C6 con un salido se sigue viendo y saldando por la
  excepción de F09/ADR-007; en Saldos no aparece el salido, y la suma de los
  visibles puede no ser cero mientras ese par exista. Es el mismo caso que ya
  existía con retirados y orígenes; la tarjeta de pares reabiertos lo explica.
- La cesión consentida (F10.B0) decide sobre vínculos **activos**; los
  históricos no se ceden. Su ADR tomará el siguiente número libre (F10/ADR-004).
- Evidencia: `supabase/checks/link-lifecycle.sql` (A–F: estructura; salir;
  volver como X; elegir un fantasma con una sola activa y atribución sumada;
  «nuevo» rehusado y quien nunca estuvo; economía de F9 intacta),
  `rejoin-after-departure.sql` B5/B6 adaptados, `participant-identity.sql` A6/A7/E2
  y `leave-and-settle.sql` A2 al contrato nuevo, `lib/group-payment-helpers.sql`
  leyendo la foto de netos como el actor; `tests/lib/group-timeline.test.ts`;
  `tests/infra/link-lifecycle-surface.test.ts`.
