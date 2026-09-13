# F09/ADR-006 — Rectificar una reclamación («Me equivoqué de participante»)

- **Estado:** Aceptado (2026-09-12). Regla funcional aceptada el 2026-09-12
  sobre la evidencia de abajo; concurrencia cerrada por el protocolo de
  identidad (`20260912150000`); implementado en `20260912160000`. Pendiente de
  validación visual en el iPhone, que no cambia el contrato.
- **Fecha:** 2026-09-11
- **Identificador anterior:** ADR-037 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Alcance:** que quien entró en un grupo **reclamando** a un participante sin
  cuenta (F09/ADR-004 `choice = 'claim'`) pueda devolverlo al estado sin cuenta,
  retirar el vínculo y el acceso que esa reclamación creó, y volver a «¿Quién
  eres?» para elegir otro participante o «Soy nuevo».
- **No cubre**: al creador del grupo ni a quien entró como nuevo (su
  participante nació con la cuenta; no hay reclamación que revertir), ni
  cambiar la identidad de otra cuenta, ni «Salir del grupo».
- **Se apoya en** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (el vínculo en su
  relación; los efectos referencian participantes), [F03/ADR-013](../F03/ADR-013-economic-attribution.md)
  (atribución por vínculo), [F09/ADR-003](../F09/ADR-003-leaving-a-group.md),
  [F09/ADR-004](../F09/ADR-004-group-invitations.md) y [F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md)
  (cerrojo reclamar/retirar).

## Contexto

Reclamar es barato de equivocar: una lista de nombres y un toque. Y no es
neutral: desde ese momento la cuenta ve como suyas las cuotas y las deudas
del participante (atribución retroactiva por vínculo), y las escrituras
posteriores de cualquier miembro pueden **apoyarse en el vínculo** para
atribuir caja al Personal de esa cuenta. Revertir sin mirar eso dejaría dinero
huérfano.

## Evidencia (`supabase/checks/unclaim-evidence.sql`, con rollback)

Se mide la cuenta reclamante —caja, filas de caja, cuotas, deuda atribuida,
`your_share`, `is_self`— antes y después de una desvinculación **simulada**
(borrar el vínculo como postgres en un sub-bloque que se deshace) tras cada
clase de escritura posterior a la reclamación:

| Caso                                                                        | Tras desvincular                                                                                                     | Veredicto                            |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| B · reclamar y nada más                                                     | exactamente la foto previa; reclamar no escribió ningún efecto                                                       | permitido                            |
| C · otro registra un gasto en el que la reclamada **participa** (paga otro) | nada en su cuenta; la deuda del pagador contra el participante sigue íntegra                                         | permitido                            |
| D · otro registra un gasto con la reclamada como **pagadora**               | **caja −20,00 y su fila quedan en su Personal**; cuota y deuda desaparecen                                           | **bloquea**                          |
| E1 · ese gasto, **corregido** a otro pagador                                | nada vigente en su Personal (la caja de la versión superada existe en `core.effect` pero ninguna lectura la publica) | permitido                            |
| E2 · ese gasto, **anulado**                                                 | nada vigente                                                                                                         | permitido                            |
| G · liquidación **sin caja** que la nombra (`record_debt_settlement`)       | sigue al participante; la deuda del acreedor no cambia                                                               | permitido                            |
| H · la reclamada **registra** un gasto pagado por otro                      | nada en su cuenta; la versión conserva `created_by` = su cuenta, como la de quien salió (F09/ADR-003)                | permitido, con la autoría conservada |
| F · liquidación **por transferencia** con la reclamada como pagadora        | **caja −1,00 huérfana** en su Personal                                                                               | **bloquea**                          |

Conclusión: **lo único que vuelve incoherente una desvinculación es un efecto
de caja VIGENTE en el Personal de la cuenta cuya operación pertenece al
grupo.** Cuotas y deudas siguen al participante y no se pierden; la autoría
queda en la versión, exactamente como cuando alguien sale del grupo.

### Concurrencia: el hallazgo, y el protocolo que lo cierra

**Hallazgo (medido antes de la migración `20260912150000`, dos sesiones
reales).** Una desvinculación simulada que tomaba la fila del ámbito y después
el cerrojo de reclamar/retirar no bastaba: `api.record_group_expense` resolvía
el Personal de la pagadora por su vínculo **antes** de `sec.lock_scopes`
(necesita saberlo para bloquearlo), esperaba al lock, entraba con el vínculo ya
borrado y **escribía la caja en un Personal que ya no era de la pagadora**.
Ningún orden serial produce ese estado. `record_settlement_by_transfer`
resolvía los dos extremos igual. Releer tras `lock_scopes` tampoco habría
bastado: reclamar sólo tomaba el cerrojo consultivo, así que podía cambiar el
vínculo después de la relectura.

**Corrección hecha — no propuesta — en `20260912150000_group_identity_lock.sql`,
porque afecta hoy a reclamar, retirar y salir aunque rectificar no exista:**
un único cerrojo de identidad por grupo, en el mismo lugar del orden, para
todo el que lea o cambie identidad:

| Rango | Bloqueo                                                                                         | Quién                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | clave de idempotencia (`client_command` / `provisioning_command`)                               | writers, reclamar, salir; retirar y «Saldado» reintentan por lectura bajo 1                                                          |
| 1     | `sec.lock_participant_claims(grupo)`: consultivo, de transacción, **uno** por transacción       | reclamar, **rectificar**, retirar, «Saldado», salir, `record_group_expense`, `record_settlement_by_transfer`                         |
| 2     | `sec.lock_scopes`: filas de ámbito, uuid ascendente, grupo y Personales **ya resueltos bajo 1** | writers, retirar, «Saldado» (rectificar no: es del provisioner y sólo necesita 1, porque toda caja que le importa se escribe bajo 1) |
| 3     | `sec.lock_and_cas`: la fila de la operación                                                     | writers, en correcciones                                                                                                             |

Después de 1, y nunca antes, se lee la membresía del actor, se resuelve un
participante a su Modo Personal, se mira si está disponible o retirado, y se
escribe cualquiera de esas relaciones. Los writers personales y
`record_debt_settlement` no leen identidad por vínculo y siguen en 2–3.

**Sin interbloqueo, demostrado por orden y no por el caso de un grupo:** cada
transacción adquiere en rango estrictamente creciente (0 < 1 < 2 < 3; dentro
de 2, ascendente; en 1 hay un único cerrojo). Si T1 espera un bloqueo L que
tiene T2, todo lo que T1 tiene es de rango menor que L y todo lo que T2 pueda
esperar es de rango mayor; siguiendo un ciclo el rango crece sin fin, luego no
hay ciclo. La clave (0) sólo la espera quien la repite, y quien la tiene la
tomó antes que nada. Las unicidades posteriores (vínculo, retiro, membresía)
sólo chocan entre transacciones del mismo grupo, ya serializadas en 1.
Colisión del hash de 64 bits: dos grupos compartirían cerrojo y se
serializarían de más, nunca de menos; con un cerrojo por transacción no
altera el orden.

**Aislamiento del provisioner conservado:** reclamar y salir toman **sólo** el
cerrojo, ninguna fila de ámbito (E6 de `group-provisioning`: el provisioner
no ve grupos de los que el actor no es miembro).

**Guardas:** `supabase/checks/group-identity-lock.sql` lee los cuerpos vivos
del catálogo y falla si alguna de las seis funciones toma el cerrojo después
de leer identidad o después de las filas, si la clave va después del cerrojo,
si el orden 2 < 3 se rompe, o si **cualquier** función resuelve un Personal
por vínculo sin el cerrojo delante — es lo que vigila las recreaciones de los
dos writers en F11. Verificado que falla contra el cuerpo anterior de
`record_group_expense`.

**Carreras medidas (`scripts/unclaim-race-evidence.sh`, ocho, dos sesiones
reales; la primera retiene sus bloqueos 3 s, la segunda arranca 1 s después y
se mide su espera dentro de la transacción):**

| Carrera                                | Segunda esperó | Resultado                                                                                                  | Orden serial equivalente        |
| -------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1a reclamar → gasto con Ana pagadora   | 2,0 s          | caja −20,00 en el Personal de Ana, vínculo                                                                 | (reclamar, gasto)               |
| 1b gasto con Ana pagadora → reclamar   | 2,0 s          | gasto sin caja (pagadora sin cuenta al escribirse), vínculo después                                        | (gasto, reclamar) — F03/ADR-013 |
| 2a rectificar → gasto con Ana pagadora | 2,0 s          | vínculo y membresía fuera; el gasto entra con Ana sin cuenta; **caja 0**                                   | (rectificar, gasto)             |
| 2b gasto con Ana pagadora → rectificar | 2,0 s          | `UNCLAIM_BLOCKED_CASH`; caja −20,00 sigue atribuida a quien sigue vinculada                                | (gasto, rectificar)             |
| 3a rectificar → transferencia de Ana   | 2,0 s          | la transferencia se rehúsa (`NOT_AUTHORIZED`: ya no es la deudora vinculada); caja 0                       | (rectificar, transferencia)     |
| 3b transferencia de Ana → rectificar   | 2,0 s          | `UNCLAIM_BLOCKED_CASH`; caja −5,00 sigue atribuida                                                         | (transferencia, rectificar)     |
| 4a rectificar → salir                  | 2,0 s          | salir se rehúsa (`NOT_AUTHORIZED`); ninguna salida registrada                                              | (rectificar, salir)             |
| 4b salir → rectificar                  | 2,0 s          | `NOT_MEMBER`: la membresía se lee **bajo** el cerrojo; salida registrada, vínculo conservado (F09/ADR-003) | (salir, rectificar)             |

1b y 2a son «el vínculo cambia entre la resolución y la escritura»: el writer
resuelve bajo el cerrojo y el cambio de vínculo no puede entrar hasta su
commit; se mide que esperó. Sobre 1b: con el cuerpo anterior el estado final
era el mismo (vínculo sin caja), que **sí** coincide con un orden serial; la
frase «deja el gasto sin caja» de la versión previa de este ADR describía un
orden serial válido de F03/ADR-013, no un defecto. El defecto era 2a.

## Decisión

### 0. Condición previa (hecha)

> **El protocolo de identidad de arriba está aplicado y guardado.** Rectificar
> nace dentro de él: toma el cerrojo de identidad del grupo, después las filas,
> y sólo entonces lee membresía, vínculo y caja.

### 1. Quién, sobre qué vínculo, y qué hace cada clave

> **Sólo la propia cuenta, miembro vigente (leída bajo el cerrojo), sobre SU
> vínculo en ese ámbito, y sólo si ese vínculo lo creó una reclamación.** El
> vínculo lleva `claim_command_id` (nuevo, nullable), con FK compuesta
> `(user_id, claim_command_id) → provisioning_command (created_by,
client_command_id)`; lo escribe `redeem` con `choice = 'claim'`; el
> creador y «Soy nuevo» lo dejan nulo. Rectificar recibe `claim_command_id` y
> exige que sea **el del vínculo actual**.

Tres situaciones, tres respuestas distintas, y ninguna toca a otra:

- **Reintento de una rectificación ya completada** (misma
  `client_command_id` del actor): replay por `provisioning_command`, como
  reclamar y salir — la clave se reclama **antes** del cerrojo y de autorizar
  (F09/ADR-002, F03/ADR-007 §5); devuelve el **resultado original**
  (`already_processed: true`) sin leer ni tocar el vínculo actual. Si otra
  cuenta —o la misma— reclamó a ese participante después, esa reclamación
  posterior **no se modifica**: el replay no llega a ella.
- **Comando nuevo contra una reclamación superada** (clave nueva,
  `claim_command_id` distinto del que lleva el vínculo actual, o vínculo
  inexistente): `CLAIM_SUPERSEDED` (409), nada cambia. Incluye el caso «mi
  reclamación antigua»: encontrarla en el historial no basta, tiene que ser la
  que creó el vínculo vigente.
- **Vínculo sin `claim_command_id`:** **no se habilita para rectificar**, ni
  por nombre, ni por fecha, ni por suposición. La migración que añade la
  columna la rellena sólo donde la procedencia es **inequívoca**: exactamente
  un `provisioning_command` del mismo `user_id`, de tipo
  `invitation.redeem`, con `choice = 'claim'` y ese `participant_id` en
  su intención canónica. Es inequívoco porque, sin rectificar, un vínculo sólo
  pudo nacer de esa reclamación o del creador / «Soy nuevo» (sin comando de
  reclamación), y una reclamación fallida deshace su comando; medido en la base
  local: 20 vínculos, 3 con exactamente una reclamación, 17 sin ninguna, 0
  ambiguos. Cero o más de una → nulo, y ese vínculo queda fuera de esta vía.

### 2. Cuándo se permite

> **Se permite si y sólo si, bajo bloqueo, no existe ningún efecto de caja
> vigente en un ámbito personal del actor cuya operación pertenezca al
> grupo** — un gasto pagado como ese participante o una liquidación por
> transferencia hecha como él, medidos en D y F. **Si existe,
> `UNCLAIM_BLOCKED_CASH` (409) con los `operation_id` que lo bloquean, y nada
> cambia.**

No bloquean: participar en gastos de otros, liquidaciones sin caja, y la
propia autoría. No se borran ni se reasignan efectos para hacerla posible.

### 3. Qué hace

En una transacción: bloqueo (§ concurrencia); comprobaciones de §1 y §2;
borrado del vínculo y de la membresía creados por esa reclamación (dos filas,
ambas del actor); registro insert-only `core.participant_unclaim`
(participant_id, scope_id, user_id, claim_command_id, unclaimed_by,
client_command_id). Ninguna presencia se toca (el participante sigue activo,
ahora sin cuenta); ningún efecto se toca; ningún aviso `departure` (no salió:
nunca fue miembro por derecho). Personal del actor: caja intacta (nunca la
movió), cuotas y deudas del participante dejan de atribuirse; lo que ya vio
no se puede des-ver, y la confirmación lo dice.

### 4. Volver a «¿Quién eres?»

La invitación no se consume al reclamar. Tras la rectificación el cliente
reabre «¿Quién eres?» **con el mismo token**; el participante vuelve a estar
disponible (`participant_available`). Si el token caducó o se revocó, se pide
una invitación nueva; `REJOIN_NOT_AVAILABLE` no aplica porque la cuenta ya no
tiene vínculo en el ámbito.

### 5. Mensajes

Bloqueada: «No se puede deshacer: hay dinero registrado en tu Personal como
[nombre] en este grupo.» Debajo, **las operaciones que lo bloquean**, resueltas
por el cliente a partir de los `operation_id` del error contra
`api.group_movement` —todas visibles para el actor: es miembro del grupo—,
cada una con concepto, fecha e importe, sea un gasto pagado o una transferencia.
Sin prometer un procedimiento que la desbloquee: una corrección conserva la
autoría histórica y no es un camino que se pueda ofrecer como tal.

## Ejemplos

- Reclamo a «Luis», veo sus 3,00 € de deuda, me equivoco → **permitido**;
  Luis vuelve a sin cuenta con su deuda; mis Deudas dejan de mostrarla.
- Reclamo a «Luis»; Edu registra una cena en la que Luis participa → **permitido**.
- Reclamo a «Luis»; Edu registra una cena **pagada por Luis** → **bloqueado**
  (`UNCLAIM_BLOCKED_CASH`), hasta que esa cena se corrija a otro pagador o se
  anule; entonces vuelve a ser posible (E1/E2).
- Reclamo a «Luis» y pago 1,00 € por transferencia → **bloqueado**.
- Reclamo a «Luis», me equivoco (permitido), y otra cuenta reclama a «Luis»
  después → mi reintento con la clave antigua es replay; una rectificación
  nueva sobre ese vínculo es de la otra cuenta, no mía (`CLAIM_SUPERSEDED`).
- Salí del grupo → no soy miembro vigente → no aplica.

## Implementación (`20260912160000_unclaim_participant.sql`)

- **Procedencia:** `participant_user_link.claim_command_id` (nullable, FK
  compuesta `(user_id, claim_command_id) → provisioning_command`);
  `redeem_invitation` la escribe al reclamar; relleno de los vínculos
  anteriores sólo con exactamente un comando de reclamación (medido en el
  check, sección L: dos comandos → nulo; uno → recuperado).
- **Hecho:** `core.participant_unclaim`, insert-only, del provisioner.
- **Frontera de caja:** `sec.unclaim_blocking_operations(scope)` (definer de
  postgres, sólo el provisioner la ejecuta) devuelve, de cada operación del
  actor con caja vigente en su Personal y algún efecto en el grupo, lo que ya
  ve como miembro: clase, concepto, importe declarado como texto y fecha.
- **Error con detalles:** `sec.raise_boundary(code, message, status, details)`;
  PostgREST entrega `details` como texto JSON (medido por HTTP con un JWT
  real) y el cliente lo interpreta.
- **`api.unclaim_participant(payload)`**, del provisioner: clave
  (`provisioning_command`, tipo `participant.unclaim`) → cerrojo de identidad
  → membresía vigente (`NOT_AUTHORIZED`) → vínculo propio con esa procedencia
  (`CLAIM_SUPERSEDED` / `UNCLAIM_NOT_AVAILABLE`) → caja
  (`UNCLAIM_BLOCKED_CASH` con `operations`) → hecho, borrado del vínculo y de
  la membresía. Sólo el cerrojo: ninguna fila de ámbito (E6). Toma DELETE
  sobre el vínculo propio (policy `self_delete`), como salir borra su
  membresía.
- **Lectura:** `api.group_participant.claim_command_id` — la procedencia del
  vínculo PROPIO, nula para los demás y para creador / «Soy nuevo». «Procede
  de una reclamación rectificable» es que no sea nula; «puede rectificarse
  ahora» lo decide el servidor.
- **Cliente:** menú al tocar la fila «Tú» de Saldos con procedencia →
  confirmación → `api.unclaim_participant`; bloqueo con la lista descrita
  (concepto o «Transferencia», importe, fecha); tras el éxito, aviso,
  `publishGroupRecorded` (lista, Deudas, avisos; Inicio se refresca al
  volver), salida de la pantalla y, si la invitación con la que se entró
  sigue en memoria (`rememberRedeemedInvitation`), llega como un enlace
  pulsado y abre «Únete» → «¿Quién eres?» (o dice que caducó o se revocó);
  sin ella, se pide una nueva. «Salir del grupo» no interviene; «¿Eres
  [nombre]?» sigue delante de reclamar.
- **Evidencia:** `supabase/checks/unclaim-evidence.sql` (A–M, F) contra la
  función real, con permisos y aislamiento del provisioner, reintento tras
  una reclamación posterior, procedencia ausente y ambigua, historial y
  efectos intactos, Personal y acceso, invitación caducada;
  `scripts/unclaim-race-evidence.sh` con la función real en las ocho
  carreras; migración aplicada íntegra desde cero en una base aislada.

## Consecuencias

- El protocolo de identidad (`20260912150000`) queda guardado en catálogo y
  CI; F11 debe conservar la línea del cerrojo al recrear los dos writers, y
  la guarda lo hace visible.
- El provisioner gana DELETE sobre el vínculo, acotado al propio; el guard
  `leave-and-settle` A2 lo recoge.
- Una reclamación rectificada y vuelta a hacer deja dos hechos y un vínculo
  con procedencia nueva: el historial de identidades de una cuenta en un
  grupo es reconstruible, y nada de lo contable lo nota.
