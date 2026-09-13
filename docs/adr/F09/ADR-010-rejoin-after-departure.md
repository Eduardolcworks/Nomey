# F09/ADR-010 — Volver a entrar en un grupo tras salir voluntariamente

- **Estado:** Aceptado (2026-09-14). Implementado en la migración
  `20260914140000_rejoin_after_departure.sql` (aplicada a la base local de
  desarrollo con `migration up --local`, 44 registradas = 44 ficheros) y en el
  cliente; **demostrado en aislamiento** (check y dos sesiones reales) y contra
  la base local en rollback; **validado en el iPhone por el propietario
  (2026-09-14)**: vuelve con su identidad, conserva el historial, no duplica
  participante ni altera el Disponible.
- **Fecha:** 2026-09-14
- **Identificador anterior:** ADR-041 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Decide** lo que [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) §8 dejó a F10: la
  reincorporación de una cuenta que salió. **No decide** la revocación por
  otro, las fusiones entre cuentas ni la identidad anónima (siguen en F10), y
  **no toca** la política de retirados
  ([F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md)): un retirado es alguien
  sin cuenta a quien el grupo dio por saldado; esto trata de una cuenta que
  salió por su propia decisión.
- **Respeta** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (la identidad
  contextual es estable; los periodos de presencia dicen cuándo era elegible),
  [F09/ADR-004](../F09/ADR-004-group-invitations.md) (la invitación autoriza),
  [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md) (C6 y C8),
  [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md) y
  [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md).

## Contexto: lo que había

Salir (F09/ADR-003) borra la membresía, cierra el periodo de presencia con el día
de salida excluido y **conserva el vínculo** cuenta↔participante: es lo que
mantiene el Personal de quien salió atribuido a su identidad. Por ese vínculo,
`redeem_invitation` reconocía a quien volvía y **paraba** (`rejoin_pending`,
`REJOIN_NOT_AVAILABLE`): no se fabricaba otro participante para eludir
F09/ADR-003, y reincorporarse quedaba sin decidir.

## Decisión

**Quien salió puede volver a entrar mientras el enlace o QR sea válido y el
grupo admita incorporaciones**, por el mismo flujo de invitación y con **su
identidad de entonces**:

- **La cuenta se reconoce por su vínculo** y recupera su participante
  canónico. El vínculo apunta siempre a la identidad vigente (un destino de
  fusión, nunca un origen): quien asoció a un fantasma vuelve como el destino.
- **Se abre un periodo de presencia desde hoy.** Los periodos anteriores y el
  intervalo de ausencia se conservan tal cual: **no hay participación
  retroactiva** en los gastos fechados en la ausencia
  (`PARTICIPANT_NOT_ELIGIBLE`), y lo que ya lo nombraba se corrige igual que
  antes (`participant_kept_in_version`). El periodo es de grano día: si sale y
  vuelve el mismo día, el periodo de hoy —cerrado en hoy, vacío— se vuelve a
  abrir.
- **Nada más cambia.** Ni participante ni vínculo nuevos; ninguna operación,
  efecto, anulación ni fusión anterior se toca; **las novaciones hechas al
  salir (F09/ADR-007 C8) siguen vigentes** y **no se recrea caja histórica**
  (F09/ADR-009 la incorporó una vez, con la asociación).
- **C6 una sola vez.** La deuda que un pago anulado reabrió a quien salió se
  lee por la excepción (`my_reopened_debt`) **mientras no es miembro**; al
  volver hay membresía, la excepción deja de aplicar por construcción y el
  par se lee como el de cualquier miembro (y se salda por el par directo, no
  por la excepción 2 de F09/ADR-007). Nunca las dos lecturas a la vez.
- **Enlaces revocados o caducados** responden su estado sin escribir, como
  para cualquiera. **Ya dentro**, repetir el enlace no crea otra presencia ni
  nada (`already_member`, como antes).
- **Dos intentos a la vez** se serializan por el cerrojo de identidad del
  grupo (rango 1): el segundo ve la membresía o responde el resultado original
  (misma clave).

## Contrato

- `api.preview_invitation`: estado **`rejoin`** (antes `rejoin_pending`) con
  `previous_participant {participant_id, display_name}`.
- `api.redeem_invitation`: `choice = 'rejoin'`, sin `participant_id` ni
  `display_name`. Con vínculo, `claim` o `new` se rehúsan con
  **`REJOIN_REQUIRED`** (409); sin vínculo, `rejoin` se rehúsa con
  `REJOIN_NOT_AVAILABLE` (409). Respuesta `{state: 'ok', scope_id,
participant_id, rejoined: true}`; ya miembro, `already_member: true`.
- Cliente: «¿Quién eres?» con estado `rejoin` ofrece **una sola opción**,
  «Volver a entrar como {nombre actual}»; ni reclamar a otro ni entrar como
  nuevo. Un cliente anterior contra un servidor nuevo recibe `REJOIN_REQUIRED`
  y lo explica; un cliente nuevo contra un servidor anterior lee
  `rejoin_pending` como `rejoin` y recibe `REJOIN_NOT_AVAILABLE`.
- Aviso a los demás: **no** se emite (no hay `kind` de reincorporación en
  `core.group_notice`); queda como mejora, no como parte de esta decisión.
- De paso, `api.group_profile.participant_count` deja de contar orígenes
  fusionados (medido en «Prueba»: decía 3 con dos identidades vigentes).

## Evidencia

- `supabase/checks/rejoin-after-departure.sql` (A–E, pila aislada desde cero
  con 41 + `20260914120000` + `20260914130000` + `20260914140000`): salir y
  volver (dos periodos con el hueco; huella del grupo idéntica: participantes,
  vínculos, operaciones, efectos, fusiones; la salida registrada; replay);
  repetir el enlace ya dentro; `claim`/`new` con vínculo; `rejoin` sin
  vínculo; revocado y caducado; sin reparto retroactivo con un hueco real y
  corrección de lo anterior; identidad fusionada que vuelve como su destino sin
  caja ni fusión repetidas; C6 fuera (+300 por la excepción) y dentro (0 por la
  excepción, +300 como miembro), saldado después por el par directo.
- `scripts/rejoin-race-evidence.sh`: dos intentos de volver a la vez (otra
  clave: `already_member`; la misma: `already_processed`), y volver frente a
  un gasto de hoy que lo nombra (serializado; entra después y vale).
- `supabase/checks/group-invitations.sql` §E adaptado al contrato nuevo; el
  resto de la suite afectada pasa con las tres migraciones.

## Consecuencias

- F09/ADR-003 §8 queda decidido en su caso voluntario; `REJOIN_NOT_AVAILABLE`
  pasa a significar «no estuviste aquí».
- Al volver, quien salió deja de ser «salido» para F09/ADR-008: sus obligaciones
  anteriores vuelven a poder corregirse como las de cualquier miembro, con las
  guardas de siempre.
