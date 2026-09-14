# F9 · Nota de continuidad (2026-09-09)

> **Qué es esto.** El seguimiento de trabajo de la Fase 9, empezado como nota
> de continuidad y **conservado al cerrar la fase (2026-09-14) como su registro
> de evidencia**: el roadmap (Fase 9, «Estado de cierre») y `PROJECT_STATE.md`
> lo citan. **No es un handoff** —F9 no tiene uno— y no sustituye a
> `PROJECT_STATE.md`, que manda sobre el estado actual. Lo que dice de
> «pendiente» o «sin validar» describe el momento en que se escribió; el estado
> final está en el cierre del roadmap.

## Lo que está implementado Y validado

Validado significa: comprobado contra el stack real, o contra la suite, y con la
evidencia dentro del repositorio.

- **Compartir grupo y Únete a un grupo, aprobados visualmente en dos iPhone
  (2026-09-10):** QR, «Pegar enlace», «Soy nuevo» y reclamación de un
  participante (F09/ADR-004). Backend en `supabase/checks/group-invitations.sql`
  (A–F).

- **La guarda de sobreliquidación ya no bloquea deudas cruzadas.**
  `20260908150000_settlement_guard_scope.sql`. Era un defecto de dominio de
  aplicación, no de aritmética: `sec.net_debt` es el neto **con signo** de las
  dos direcciones, así que con cero liquidaciones la condición degeneraba en «el
  neto de A hacia B no puede ser negativo», que no es invariante de nada. Ahora
  sólo se pregunta en pares **con** liquidaciones. Secciones H8/H9 del check:
  cambio de pagador, exclusión de participante y anulación pasan; una
  sobreliquidación real sigue rechazándose sin escritura parcial.
- **El vector `4.7-liquidar-con-participante-sin-usuario`.** Consulta demasiado
  amplia: contaba los ámbitos con caja filtrando **sólo por fecha**, así que en
  una base poblada un gasto real del mismo día entraba en la cuenta. Acotado al
  universo del escenario. `authoritative-writer-debt` entero en verde, J y K
  incluidas.
- **Importe anterior y saldos.**
  `20260908160000_group_previous_amount_and_balances.sql`: `previous_amount` en
  `api.group_operation` y la vista `api.group_balance`. Probado en vivo sobre el
  grupo de pruebas: las cuatro posiciones **suman exactamente cero**.
- **Cliente**: importe anterior tachado con el criterio de Inicio —sólo si
  cambió—, «Editado» cuando hay más de una versión, pestaña Saldos, y el
  marcador vacío `GROUP_BALANCES` retirado. `npm run verify` limpio y
  **110 ficheros / 3207 pruebas**.

## Lo que está implementado y NO validado (2026-09-10, tarde)

- **F09/ADR-003: salir de un grupo y «Saldado».** Migración
  `20260911120000_leave_group_and_settle_participant.sql`, aplicada a la base
  local **por partes** (el archivo se fue afinando con la base ya migrada:
  una reconstrucción desde cero es lo que CI comprobará). Check
  `supabase/checks/leave-and-settle.sql` en verde de la A a la J, con fixtures y
  rollback. Cliente: «Salir del grupo» en el menú de la tarjeta con su
  confirmación; «Inactivo» y «Saldado» en Saldos, con la confirmación de pares;
  inactivos no propuestos ni elegibles fuera de fecha en el alta; retirados
  fuera de listas y contador; la campana lee `api.group_notice` y suma sus no
  leídos al indicador. **Nada de esto se ha visto en el iPhone todavía.**
- **La sección I de `group-expense-flow.sql` pasa por fin**, sobre la relación
  única de avisos. El fallo que la mantenía en rojo —las políticas llamaban a
  `sec.request_actor_id()`, que `authenticated` no puede ejecutar; medido en
  E23— quedó corregido con la consolidación en `core.group_notice`.
- **Dos guardias de catálogo tenían una excepción sin nombrar:**
  `api.group_operation.total_order` es `bigint` por decisión de
  `20260908130000` (sólo ordena y acota), y las guardias A9/A7 de
  `canonical-attribution.sql` y `read-surface.sql` fallaban desde entonces sin
  que nadie las hubiera vuelto a correr. Ahora lo exceptúan **por nombre**;
  `participant_count` pasó a `integer`. `canonical-attribution.sql` sigue
  sin poder pasar en local porque cuenta efectos de toda la base (fixtures de
  CI), no por el cambio.

- **F09/ADR-004: «Únete a un grupo».** Migración
  `20260911150000_group_invitations.sql` (aplicada en local por partes), check
  `supabase/checks/group-invitations.sql` en verde de la A a la E. Cliente: la
  hoja del `+` con «Escanear QR» (`expo-camera`, aprobada y añadida) e
  «Introducir enlace» con el avión; «¿Quién eres?»; unión real. **Sin ver en el
  móvil todavía.** **Compartir grupo** (icono de la cabecera): ventana `SheetWindow` con el
  nombre, un QR pintado con `toqr` (declarado; sin SVG) y «Enviar invitación»
  por la hoja nativa (`Share.share`). Una invitación por grupo y sesión, en
  memoria hasta caducar (decisión del cliente, documentada en
  `use-group-invitation.ts`); abrir la app de nuevo emite otra. Abrir el enlace
  desde fuera de la app (deep link) sigue sin hacerse; en Expo Go el esquema
  `nomey-dev://` no es abrible desde fuera, pero el QR y «Pegar enlace» sí lo
  leen. La invitación de prueba también se puede emitir con
  `scripts/dev-invitation.sh`.
- **Tres ajustes de UI (2026-09-10, noche).** (1) Deslizar un movimiento del
  grupo descubre la papelera de Inicio: la misma pieza (`SwipeToDelete`),
  misma dirección, misma confirmación (`askDelete`) y la anulación
  autoritativa con sus barreras de servidor; deslizar no elimina, y sólo una
  fila queda abierta a la vez (registro de módulo en la pieza, que alcanza
  también a Inicio). (2) Deslizar una tarjeta de Grupos descubre «Salir del
  grupo» con el símbolo de salida —misma pieza, `icon` como prop—, la misma
  confirmación del menú y el comando de F09/ADR-003; un grupo pendiente no lo
  ofrece, ni por menú ni por gesto. (3) **El punto de la campana dice «hay
  algo que no has visto»**: `incidents.unseen > 0 || notices.unread > 0`.
  Entrar en la campana marca una vez por fuente, sólo si la fuente se mostró
  bien: avisos por `api.mark_group_notices_seen(p_newest)` (migración
  `20260912100000`, check `group-notices-seen.sql` A–E: antiguos fuera de
  página incluidos, un aviso posterior a la frontera queda fuera aunque la
  llamada llegue tarde, aislamiento por actor y por membresía, nada se borra);
  incidencias por un conjunto de claves por actor en `catalogue_cache`
  (`incident-seen.ts`), separando visto de resuelto. Los avisos nuevos al
  entrar conservan «Nuevo» durante la visita. **Sin ver en el iPhone
  todavía**: la coexistencia del gesto con el menú nativo de la tarjeta
  (SwiftUI `ContextMenu`) y con el scroll es lo primero que hay que mirar.
  **Aprobado visualmente en el iPhone (2026-09-11).**
- **Repartos «Por partes» y «Cantidad» (2026-09-11).** «Por partes»: el campo
  de partes pasa a un control `[−] 2x [+]` sin teclado, mínimo una parte (el
  − se apaga en 1; para excluir está el tick), sin tope por arriba porque el
  contrato sólo fija el suelo (`adjustShares`/`sharesOf`). «Cantidad»: el
  mapa `amounts` del borrador pasa a significar **fijado a mano**; quien
  participa y no figura va en automático y recibe el restante del total
  repartido igualmente con `allocateByLargestRemainder` (exportada ahora del
  dominio; pagador primero en el desempate). 30 → 10/10/10 → 20/5/5 → 20/7/3.
  Nada se corrige en silencio: fijadas que superan el total se conservan y se
  enseña el exceso con las automáticas pendientes (`amountsMismatch`); un
  restante que deja a alguien en cero, o un cero fijado, bloquea
  (`amountsZero`); un campo fijado vacío o roto deja todo pendiente
  (`amountsIncomplete`). «Repartir igualmente» vacía el mapa. Desmarcar suelta
  la cuota; volver a marcar entra en automático. Al editar, `draftOf` carga
  todos los importes declarados como fijados, así que guardar sin tocar
  conserva el reparto; cambiar de método conserva los dos mapas (partes e
  importes fijados), como antes. Al servidor viaja `exact_amounts` con el
  reparto final resuelto: el contrato no cambia. Pruebas en
  `tests/lib/shared-expense.test.ts` (secuencia, total, selección,
  restablecer, exceso, cero, incompleto, JPY/BHD, edición, payload) y
  `tests/lib/split-amount-field.test.ts` (el campo como secuencia de eventos).
  **Sin ver en el iPhone todavía.**
- **«Pagos sugeridos» en Saldos (2026-09-11).** Oblongo amarillo bajo la lista
  que despliega una propuesta `quien paga → quien cobra · importe` sobre los
  MISMOS saldos de `api.group_balance` (conjunto entero, sin filtros),
  derivada de cada lectura (sólo con la tarjeta abierta): sin persistencia ni
  totales propios. Dos algoritmos en `features/groups/suggested-payments.ts`,
  elegidos por personas CON saldo: hasta 14, el **mínimo exacto** por
  programación dinámica sobre máscaras (O(n·2^n) tiempo, O(2^n) memoria;
  sumas enteras en `BigInt64Array`, sin coma flotante, cota de 64 bits
  calculada en bigint; medido en node: mediana 1,0 ms, peor 4,7 ms en
  n = 14; en el iPhone, pendiente) y la pantalla dice «Número mínimo de transferencias»; por encima,
  el voraz (mayor deudor → mayor acreedor) y dice «Propuesta de pagos», sin
  prometer mínimo (contraejemplo: 8, 7, 5 contra 12, 8 → voraz 4, mínimo 3).
  Los dos: conservación exacta, ningún pago a uno mismo, cero o negativo,
  determinismo. Vive en la feature y no en `domain/` a propósito:
  F01/ADR-001 no fija algoritmo normativo y el README del dominio lo sigue diciendo;
  registrar esos pagos exigiría decidirlo (una sugerencia puede unir a dos
  personas sin deuda directa). F09/ADR-003: si alguien inactivo tiene saldo, no hay
  propuesta y se le nombra (su tratamiento sigue siendo «Saldado»); saldos que
  no cuadran → no disponible. Sólo propone: sin botones de registro. Pruebas:
  invariantes sobre casos y 300 posiciones generadas
  (`tests/lib/suggested-payments.test.ts`), estructura
  (`tests/infra/suggested-payments-surface.test.ts`). **Sin ver en el iPhone
  todavía.**
- **El desglose de Gastos de Personal explica su total (2026-09-11).** Causa:
  reutilizaba `api.personal_operation` (caja), así que omitía las cuotas de
  gastos pagados por otros y enseñaba lo adelantado en los pagados por mí. El
  total y el diagrama ya eran la cuota económica (`personal_statistics` con
  `sec.my_shared_expense_shares`). Migración `20260912120000`:
  `sec.my_shared_expense_share_row` (definer reducido, SOBRE la misma función
  que suma el total, sin membresía por F09/ADR-003 §4: nombre y emoji del grupo,
  concepto, categoría, pagador contextual, total, cuota, divisa del grupo) y
  `api.personal_expense_share(p_from, p_to)` (invoker, `begin atomic`). Check
  `personal-expense-breakdown.sql` A–F verde (4×25 + 10 = 110 en cinco filas;
  Restaurante/Viajes a medias 10/10 y diagrama 11000/2000; mi pago sigue como
  20 de caja una vez; lo ajeno fuera; corrección, anulación, intervalo;
  reconciliación exacta por categoría; aislamiento; historial tras salir).
  Cliente: `home.shares` (todas las páginas, en la misma ventana quieta que
  las estadísticas), `expenseLines` mezcla gastos personales proyectados y
  cuotas en el orden de la lista, `ShareRow` (emoji · grupo · categoría ·
  cuota; desplegada: concepto, pagado por, importe total, fecha; sin acciones).
  Movimientos recientes, Disponible, Deudas y el grupo no cambian. Punto F11:
  cada cuota lleva su divisa y se formatea en ella; la suma multimoneda del
  total sigue siendo el punto abierto de `personal_statistics`. **Sin ver en
  el iPhone todavía.**
- **Quién tiene cuenta, en Saldos (2026-09-11).** Migración `20260912130000`:
  `sec.participant_is_linked(uuid)` (definer reducido, booleano, guardia de
  membresía) e `is_linked` al final de `api.group_participant`. Sólo el hecho,
  nunca la cuenta; no es `is_self` ni se deduce de nombre o presencia. Check
  `group-invitations.sql` G (creador y «Soy nuevo» sí; declarado no; quien
  salió sí pero inactivo; sin columnas de usuario; ajeno no lee). Cliente:
  `GroupBalanceRow` con borde amarillo (`accent`, 1,5, dentro del círculo de 32) sólo con cuenta Y activo, y «Con cuenta» en la etiqueta accesible; el
  inactivo conserva su tratamiento. **Sin ver en el iPhone todavía.**
- **Retirar a un participante sin cuenta, «¿Eres [nombre]?» y «Saldado» en la
  fila (2026-09-11).** Migración `20260912140000`: **ampliación explícita de
  F09/ADR-003 §6, formalizada en [F09/ADR-005](../adr/F09/ADR-005-retire-unlinked-participant.md)**
  —no es conducta del contrato anterior—: `api.retire_participant` retira a un participante
  ACTIVO y SIN cuenta por cualquier miembro (cierra su presencia hoy y
  delega en `sec.retire_participant_core`, extraído de «Saldado», que queda
  igual: pares CAS, un efecto por par, sin caja, retiro, aviso).
  `PARTICIPANT_LINKED` bajo un cerrojo consultivo por ámbito
  (`sec.lock_participant_claims`) que `api.redeem_invitation` toma también:
  reclamar y retirar se serializan (medido con dos sesiones reales,
  `scripts/retire-claim-race.sh`). Sin borrado físico: «Eliminar» (sin
  historial) y «Retirar» (con él) son la misma retirada; `has_history` en
  `api.group_participant`. Check `retire-participant.sql` A–F. Cliente: menú
  nativo al tocar (`ActionMenu`, nuevo en `ui/`) sólo sobre sin cuenta y
  activo; confirmación con los pares y su resolución sin dinero en Personal;
  «¿Eres [nombre]?» antes de reclamar; «Saldado» compacto en la fila
  (`ActionButton size="compact"`). **Sin ver en el iPhone todavía.**
- **Contrato de «Me equivoqué de participante» (2026-09-11): NO implementado;
  [F09/ADR-006](../adr/F09/ADR-006-unclaim-participant.md), Propuesto.** Evidencia
  medida con rollback en `supabase/checks/unclaim-evidence.sql` (A–H): una
  desvinculación simulada sólo deja incoherencia cuando hay **caja vigente
  en el Personal de la cuenta por una operación del grupo** (pagadora de un
  gasto ajeno, liquidación por transferencia); participar en gastos de otros,
  liquidaciones sin caja, la propia autoría (conservada en `created_by`) y la
  caja de versiones corregidas o anuladas no bloquean. Concurrencia con dos
  sesiones reales (`scripts/unclaim-race-evidence.sh`): gasto→unclaim
  serializa y rehúsa; **unclaim→gasto expone que `record_group_expense` y
  `record_settlement_by_transfer` derivan el ámbito de caja del pagador ANTES
  de `sec.lock_scopes` y no lo releen** (la misma ventana deja hoy un gasto
  sin caja si el pagador se reclama en vuelo): releerlo tras el bloqueo es
  condición previa del ADR y toca writers compartidos con F11. Sin migración,
  sin mutación, sin acción en pantalla; sólo «¿Eres [nombre]?» en el cliente.
- **El cerrojo de identidad del grupo (2026-09-11).** Migración
  `20260912150000`: cierra el hallazgo anterior con un protocolo común —clave
  de idempotencia → `sec.lock_participant_claims(grupo)` → `sec.lock_scopes` →
  `sec.lock_and_cas`— que toman reclamar (ya lo tomaba), retirar y «Saldado»
  (orden invertido: antes fila y luego cerrojo), salir (no tomaba nada) y los
  dos writers que resuelven un Personal por vínculo (`record_group_expense`,
  `record_settlement_by_transfer`: el cerrojo antes de `assert_member` y de
  `participant_personal_scope`). Recreación con `create or replace`:
  propietarios y grants intactos. **F11: son los dos writers que toca; la
  guarda `supabase/checks/group-identity-lock.sql` (A–G, en CI) lee el
  catálogo y falla si cualquier función resuelve un Personal por vínculo sin
  el cerrojo delante** (verificado contra el cuerpo anterior). Sin
  interbloqueo por rango creciente, no por el caso de un grupo; el provisioner
  sigue sin tocar filas de ámbito. `scripts/unclaim-race-evidence.sh` (en CI):
  ocho carreras con dos sesiones reales —reclamar/rectificar/transferencia/
  salir contra los writers, en las dos direcciones, espera medida—, cada
  resultado igual a un orden serial, sin caja perdida ni atribuida a una
  cuenta desvinculada; rectificar sigue simulada. Checks afectados en verde:
  `authoritative-writer-debt`, `group-expense-flow`, `leave-and-settle`,
  `group-invitations`, `retire-participant`, `unclaim-evidence`;
  `retire-claim-race`, `balance-concurrency`, `provisioning-concurrency`.
  **Hallazgo aparte, previo a esta tanda:** `scripts/writer-debt-concurrency.sh`
  (y su envoltorio de CI `writer-debt-isolation.sh`) fallan desde que el gasto
  de grupo exige `concept` y `category_id` (`20260908120000`): sus payloads no
  los llevan. Corregido en la tanda siguiente.
- **«Me equivoqué de participante», implementado (2026-09-12).**
  [F09/ADR-006](../adr/F09/ADR-006-unclaim-participant.md) **Aceptado**; migración
  `20260912160000`: `participant_user_link.claim_command_id` (FK compuesta a
  `provisioning_command`; `redeem` la escribe; relleno sólo inequívoco: en
  local 3 de 20 vínculos), `core.participant_unclaim` insert-only,
  `sec.unclaim_blocking_operations` (definer de postgres, sólo provisioner:
  clase, concepto, importe como texto, fecha), `sec.raise_boundary` con
  `details` (medido por HTTP con JWT real: `details` llega como texto JSON),
  `api.unclaim_participant` del provisioner (clave → cerrojo → membresía →
  vínculo con procedencia → caja → hecho; sólo el cerrojo, sin filas: E6),
  `api.group_participant.claim_command_id` sólo sobre la fila propia.
  Cliente: menú en la fila «Tú» con procedencia → confirmación →
  `useUnclaimParticipant`; bloqueo con la lista descrita (concepto o
  «Transferencia», importe, fecha); tras el éxito, `publishGroupRecorded`,
  salida de la pantalla y vuelta a «¿Quién eres?» por `arriveInvitation`
  con el token recordado en memoria (`rememberRedeemedInvitation`; sin él,
  se pide una nueva). Evidencia: `unclaim-evidence.sql` A–M+F contra la
  función real (bloqueo con la operación; permisos e aislamiento del
  provisioner; reintento tras reclamación posterior → resultado original;
  comando nuevo contra la superada → `CLAIM_SUPERSEDED`; procedencia ausente
  y ambigua; historial/efectos/presencia intactos 308/71/10/1/2 → iguales;
  Personal sin nada del grupo y sin acceso; invitación caducada tras
  rectificar → `expired` sin revertir); ocho carreras con la función real;
  `writer-debt-concurrency.sh` reparado (payloads con `concept`/`category_id`
  y limpieza de avisos; aserciones originales, verde dos veces). **Migración
  íntegra desde cero en una base aislada** (`supabase start` con otro
  `project_id` y puertos, luego `db reset`): 38 migraciones; descubrió y se
  corrigió un grant no versionado (`select on core.membership to
nomey_provisioner`, ahora en `20260910130000`). Desde cero siguen en rojo
  cuatro checks anteriores a esta tanda, cuyas expectativas no se
  actualizaron con F09/ADR-001/034: `participant-identity` A6c,
  `split-conversion` A4/A4b, `personal-provisioning` B2/B2b y
  `canonical-attribution` E (espera deuda sin membresía, contra F09/ADR-003 §3;
  además sus `format()` llevan `%` en vez de `%s`). **Sin ver en el iPhone
  todavía.**
- **Pagos registrados, salida sólo a cero y obligación intocable del salido:
  IMPLEMENTADOS (2026-09-12).**
  [F09/ADR-007](../adr/F09/ADR-007-group-payments-and-exit-without-debt.md) v3 y
  [F09/ADR-008](../adr/F09/ADR-008-departed-obligation-immutable.md), los dos
  **Aceptados**, en la migración `20260912170000_group_payments_and_departed.sql`:
  `core.payment_detail` (RLS desde el nacimiento), `sec.pending_pairs` (las
  dos direcciones), `sec.decompose_payment` (par directo → caminos más cortos
  → novación; arrays, no tablas temporales: bajo el writer una temporal de la
  sesión da `permission denied`), `api.record_group_payment` (sólo alta,
  `expected_positions` → `SETTLEMENT_STALE`, `PAYMENT_NOT_EDITABLE`,
  `PAYMENT_NOT_APPLICABLE`, caja `transfer` en los dos Personales, deuda
  `settlement`/`novation`, aviso `payment`), `api.annul_operation` recreado
  (rango 1; autorización por partes para `group_payment` sin membresía; para
  esa clase sin guarda de sobreliquidación y retirados por neto cero; aviso
  `payment_annulled`), `api.record_debt_settlement` con rango 1,
  `api.leave_group` → `LEAVE_BLOCKED_DEBT` con `details.pairs`
  (`sec.pending_pairs_of`, provisioner), `api.group_pending_pair` en ambas
  direcciones, `sec.departed_effects_of_version` (acotada al grupo de la
  versión) y `sec.assert_departed_unchanged` en `record_group_expense` (alta
  **y** corrección: **la alta retro-fechada que nombre a quien salió se
  rehúsa entera, sin clave ni versión**; punto cerrado) y en `annul_operation`
  (clases distintas de pago); C6: `sec.my_reopened_debt()` en
  `api.claimed_dimension`, `api.my_group_payment()`, `api.group_payment`
  (con `version_id`), `api.personal_operation` con `group_payment` y
  `payment_counterpart`, avisos `payment`/`payment_annulled` legibles por el
  destinatario sin membresía (`api.group_notice` ya no une con
  `group_profile`). **Evidencia contra las funciones reales, sin
  simulaciones** (`lib/group-payment-sim.sql` eliminada;
  `lib/group-payment-helpers.sql` sólo lee y envuelve):
  `group-payments-evidence.sql` A–J, `departed-obligation-evidence.sql` A–J
  (I alta retro-fechada sin escrituras parciales; J alta y corrección entre
  activos), `group-identity-lock.sql` con diez funciones y siete definer del
  writer, `group-payment-race-evidence.sh` (5 carreras; una salida rehusada
  aborta y no retiene el cerrojo, el reintento a cero sale),
  `departed-obligation-race-evidence.sh` (6: salir frente a alta, corrección
  y anulación en los dos órdenes; espera 1,9–2,0 s), todo en CI. Checks
  adaptados: `balance-and-annulment` (8 observan, 9 bloquean),
  `authoritative-writer(-debt)` (nueve `record_*`), `leave-and-settle` (la
  salida con pares se rehúsa; el estado de F09/ADR-003 se siembra como
  **heredado** para seguir midiendo `settle_participant`; F1 responde
  `DEPARTED_OBLIGATION_CHANGED`; el último miembro retira a Marta antes de
  salir), `group-invitations` (Ana paga antes de salir);
  `writer-debt-concurrency.sh` toma el rango 1 en su bloqueo manual (sin él,
  interbloqueo con el writer de deuda, que ya lo toma). **Desde cero en un
  stack aislado** (`NomeyIso`, 39 migraciones): 20 checks y 7 scripts de
  concurrencia en verde, sin residuos; siguen rojos los cuatro anteriores
  (`participant-identity` A6c, `split-conversion` A4/A4b,
  `personal-provisioning` B2/B2b, `canonical-attribution` E). **Cliente:**
  `payment-service.ts`, `use-record-payment.ts` (clave por intención con la
  foto de netos; `stale`/`notApplicable`/`offline`), Pagos sugeridos «Los
  míos»/«Todos» con «Saldado» compacto sobre las propuestas propias
  (confirmación, foto literal, relectura al escribir o caducar),
  `group-payment-row.tsx` (sin lápiz; «Eliminar pago» para las dos partes;
  `NOT_AUTHORIZED` explicado) bajo «Pagos registrados» delante de los gastos
  y fuera de los filtros, `useAnnulExpense` sobre `Annullable`, Personal con
  clase `payment` (título «Pago a/de {contraparte}», grupo debajo, sin
  edición, eliminable con texto propio), salida bloqueada → «Ir al grupo»,
  «Saldado» retirado de las filas inactivas (`useSettleParticipant` sin uso
  en pantalla), avisos `payment`/`payment_annulled` en la campana, i18n
  es/en, `database.ts` regenerado; `npm run verify` y los tests tocados en
  verde (`group-payments-surface` nuevo). Pendiente: revocar `execute` de
  `settle_participant` cuando la base no tenga inactivos con pares; F11
  recrea `annul_operation`, `record_debt_settlement`, `claimed_dimension` y
  `personal_operation` desde el cuerpo vivo. Base local: 6 grupos con
  inactivos con cuenta y pares (vía antigua), sin tocar.
- **Cierre funcional de F09/ADR-007/039 y estado de validación (2026-09-12,
  bloque acotado).**
  - **Entorno, aclarado.** La migración `20260912170000` se aplicó en DOS
    bases: `supabase_db_NomeyIso` (aislada, desde cero, ya parada y sin
    volumen) y `supabase_db_Nomey` (la local de desarrollo, con datos
    reales: 50 operaciones, 291 efectos, 17 grupos), esta última por `psql`
    con el mismo contenido del fichero. La migración no tiene DML sobre
    filas existentes (sólo DDL y funciones); las evidencias corren en
    rollback y los scripts de carreras retiran sus fixtures (residuo 0). **El
    registro `supabase_migrations.schema_migrations` de la base local tiene
    18 entradas (hasta `20260901120000`)**: las 21 migraciones de F9 se
    aplicaron por `psql` a lo largo de la fase y no están registradas; un
    `migration up` futuro las reintentaría (**resuelto en la última tanda:
    registro reconciliado, 41 registradas; ver el runbook**). La app que sirve
    Metro apunta a `192.168.8.105:54321` (Kong de `supabase_db_Nomey`); ese
    backend tiene las funciones y vistas nuevas y PostgREST las resuelve
    (probado por HTTP: `record_group_payment`, `group_payment`,
    `group_payment_allocation` responden 401/42501 con la clave publicable,
    frente al 404 `PGRST205` de un objeto inexistente).
  - **Implementado.** `core.payment_allocation` (lo que cada pago cerró o
    reasignó, persistido con su versión al registrar; RLS; escrito en
    `record_group_payment`), `api.group_payment_allocation` (miembros),
    detalle del pago al desplegar (declarante; «Cerró» / «Había cerrado
    (vuelve a estar pendiente)» con «X dejó de deber Y a Z» y novaciones
    marcadas «nueva»), pagos anulados listados en el grupo tachados y sin
    papelera; `fetchPaymentAllocation` por fila al desplegar; i18n es/en;
    `database.ts` regenerado. La misma delta (tabla, función recreada, vista)
    aplicada por `psql` a la base local; `record_group_payment` conserva su
    propietario `nomey_writer`.
  - **Verificado automáticamente.** `group-payments-evidence.sql` (B4c/B4d:
    la asignación coincide con la descomposición y con los efectos; J10b/J10c:
    anulado, sigue contando lo que cerró y `api.group_payment` lo marca),
    `group-identity-lock.sql`, `npm run verify`, `group-payments-surface`,
    `group-movements-surface`, `leave-and-settle-surface`. **No repetido en
    este bloque:** la batería completa ni el arranque desde cero con la
    migración ampliada.
  - **Visto en dispositivo.** Nada. No hay iPhone alcanzable desde esta
    máquina (ningún dispositivo Apple por USB; Metro en pie no es acceso). El
    Android conectado (`2201116PG`) tiene la build de desarrollo del
    2026-09-04, anterior a `expo-clipboard`: incompatible con el bundle
    actual; la build no está autorizada y Expo Go no se usa para esto.
  - **Pendiente de prueba manual** (guía:
    [`docs/runbooks/f9-pagos-revision-manual.md`](../runbooks/f9-pagos-revision-manual.md);
    base local limpiada el 2026-09-13 con copia previa, quedan las dos cuentas
    con su Personal; «Saldado» sólo se ofrece entre partes con cuenta, C7): «Los
    míos»/«Todos» y confirmación de «Saldado»; registro y saldos; pago en
    ambos Personales con contraparte y sin edición; desplegable con el
    detalle; anulación por una parte; salida bloqueada y salida a cero;
    anulación tras salir, aviso y deuda reabierta acotada; propuesta
    desactualizada (`SETTLEMENT_STALE`) y relectura.
  - **Sin tocar, a propósito:** `execute` de `settle_participant`, los seis
    grupos con inactivos y pares, y los cuatro checks anteriores que siguen
    rojos desde cero.
- **Correcciones tras la prueba manual en iPhone (2026-09-13).** Base local
  limpiada antes (copia en el scratchpad); grupo «Prueba» con Eduardo y
  Aitor conservado para diagnosticar (no se tocó).
  - **Implementado.** (1) El pago lleva `effective_time` del reloj local,
    fijado con la clave de idempotencia → ordena con la fecha. (2) Ingresos
    de Inicio lista los pagos recibidos (clase conservada, fuera del total).
    (3) El desplegable del pago no repite «A → B»: la deuda directa va en una
    frase con su importe («Cerró su deuda directa: 10,00 €» / «Había
    cerrado…») y sólo se listan las demás obligaciones. (4) Salir: primero
    `check` (mis pares, `api.group_pending_pair` + `is_self`); con
    pendientes se dice sin preguntar; sin ellos se confirma y `leave`
    **devuelve** el resultado (`LeaveOutcome`) —leerlo de `failure` en el
    mismo `then` daba el valor anterior: por eso el error genérico y luego
    el bloqueo—; una deuda aparecida entre medias vuelve como `blockedDebt`.
    (5) Deudas de Inicio suma `api.my_reopened_debt()` (nuevo, definer) a
    las posiciones por membresía; `useGroups` lo lee con las posiciones. (6)
    **Causa real** del «no admite un gasto con esta fecha»: Aitor reclamó,
    salió a cero **el mismo día** de la cena y su presencia quedó vacía
    (`[13, 13)`, F09/ADR-003 §5), así que `PARTICIPANT_NOT_ELIGIBLE` tapaba a
    F09/ADR-008 hasta para el concepto; `sec.participant_kept_in_version`: en una
    corrección, quien ya constaba en la versión corregida en su misma fecha no
    repite la elegibilidad; mover la fecha, altas y nombres nuevos siguen
    exigiéndola. (7) Anular devolvía `DEPARTED_OBLIGATION_CHANGED` (comprobado
    con una sonda en rollback sobre los datos reales) y el cliente lo mostraba
    como genérico: mensajes propios «No puedes anular/modificar este gasto
    porque afecta a las obligaciones de un participante que ya salió del
    grupo»; `PARTICIPANT_RETIRED` y `SETTLEMENT_EXCEEDS_DEBT` conservan los
    suyos; fecha, autorización y versión no se atribuyen a esta causa.
  - **Verificado automáticamente.** Sondas en rollback sobre «Prueba»:
    concepto → OK, importe 30 → `DEPARTED_OBLIGATION_CHANGED`, anular →
    `DEPARTED_OBLIGATION_CHANGED` (la guarda económica de Cena **sí** se
    alcanza ahora). `departed-obligation-evidence.sql` **K** (el escenario
    del dispositivo: mismo día; concepto sí, importe y anulación
    `DEPARTED…`, con el pago vigente manda `SETTLEMENT_EXCEEDS_DEBT`, fecha
    `NOT_ELIGIBLE`), `group-payments-evidence.sql` J12
    (`api.my_reopened_debt()` = −1000 para quien salió; B4 acotado al grupo
    del fixture), `leave-and-settle`, `group-identity-lock`, `npm run
verify`, tests `group-payments-surface`, `personal-home-surface`,
    `groups-list-surface`, `leave-and-settle-surface`,
    `edit-group-surface`, `unclaim-participant-surface`,
    `group-movements-surface`, `group-expense-surface`. Delta aplicada por
    `psql` a la base local (helper, dos writers recreados —siguen de
    `nomey_writer`—, `api.my_reopened_debt`); tipos regenerados. **No
    repetido:** batería completa ni arranque desde cero.
  - **Visto en dispositivo (por el propietario, antes de estas
    correcciones):** salida a cero, registro y anulación del pago entre
    miembros, detalle histórico básico, alta y edición de un gasto sólo entre
    activos.
  - **Deudas de Aitor seguía en blanco tras «recargar» (2026-09-13): causa
    concreta.** Metro se había arrancado con `CI=1` («Metro is running in CI
    mode, reloads are disabled»): sin vigilante de ficheros, servía el bundle
    del arranque (11:05), anterior a todas las correcciones; el iPhone nunca
    pidió `rpc/my_reopened_debt` (Kong sólo registra `group_summary` y
    `group_profile`). Corrección: Metro reiniciado en modo normal (`npm start
-- --lan --dev-client`, sin `CI`); los módulos que sirve ahora llevan
    `fetchReopenedDebt`/`groups.reopened`/`deleteDeparted` (comprobado
    pidiéndolos a Metro). **Recorrido verificado por HTTP como Aitor** (JWT
    firmado con el secreto local, PostgREST real, sin credenciales en logs):
    `personal_scope` EUR; `group_summary` `[]`; `group_profile` `[]`;
    `rpc/my_reopened_debt` → `[{EUR, "-1000"}]`; `claimed_dimension` deuda
    `-1000` (misma cifra por otra lectura, que la tarjeta NO suma: Deudas =
    `group_summary` + `my_reopened_debt`); `personal_statistics`
    `expense_total` 1000 (su cuota de Cena, intacta); `group_participant`
    `[]` (sin membresía). Cliente: sin grupos `positionAcross([])` es un
    cero conocido, no una salida anticipada; `debtSnapshot` suma −1000 →
    −10,00 €; `reopened === null` (sin lectura o error) → «—», nunca cero;
    el estado va con el `actorId` (`Owned`), así que al alternar cuentas no
    se hereda; se relee con el foco y con `group-events`
    (`tests/lib/home-debt-reopened.test.ts`). **Migraciones:** los cuerpos
    vivos de `record_group_expense`, `record_group_payment`,
    `annul_operation`, `leave_group`, `my_reopened_debt` (api y sec) y
    `participant_kept_in_version`, `core.payment_allocation` y
    `api.group_payment.version_id` coinciden con
    `20260912170000_group_payments_and_departed.sql` (comparación
    automática); nada se reaplicó. **Confirmación visual pendiente.**
  - **Bloque de seis ajustes (2026-09-13, tarde).** Base con «Prueba» y «Prueba
    2» intacta (0 escrituras fuera de rollback/fixtures).
    1. **Pagos fuera de Ingresos** — implementado: la lista y el total de
       Ingresos vuelven a ser sólo ingresos; en Movimientos, «Pago recibido de
       {nombre}» / «Pago realizado a {nombre}», con orden, contraparte,
       efectos y anulación. Verificado: `group-payments-surface`.
    2. **Saldar lo reabierto con quien salió** — implementado en servidor
       (migración `20260913120000_reopened_pair_payment.sql`:
       `sec.participant_departed`, `sec.reopened_pair_cap`,
       `record_group_payment` con la excepción, `api.group_reopened_pair`)
       y cliente (`fetchReopenedPairs` con los saldos; `suggestionOf` los
       toma como pagos fijos marcados `reopened`, descontados antes del
       algoritmo; «Saldado» sigue las reglas de siempre). F09/ADR-007 actualizado
       (permisos y excepción 2). Verificado desde cero en `NomeyIso` (40
       migraciones): `reopened-pair-payment.sql` A–E, `group-payments-evidence`
       (D0 adaptado a la excepción; J1/J3 cuentan el pago de D0),
       `departed-obligation-evidence`, `leave-and-settle`,
       `group-identity-lock`, `balance-and-annulment`,
       `authoritative-writer-debt`, las dos carreras (que destaparon un hueco
       real: sus limpiezas no borraban `payment_allocation`; corregido);
       tests `suggested-payments` (escenario «Prueba»). **Aplicada a la base
       local por `psql` (fichero entero; `record_group_payment` sigue de
       `nomey_writer`), no registrada en `schema_migrations` como el resto
       de F9.** Por HTTP como Eduardo: `rpc/group_reopened_pair` de «Prueba» →
       Aitor → Eduardo 1000. CI: paso nuevo.
    3. **Punto de avisos** — causa: el grupo pintaba
       `AppTopBar alerts={incidents.unresolved > 0}`, sin los avisos; ahora
       `incidents.unseen > 0 || notices.unread > 0` con `useGroupNotices`,
       el mismo estado que las pestañas. Entrar/salir de un grupo **no** marca
       nada leído (a propósito): el punto lo apaga la campana
       (`mark_group_notices_seen`) o abrir un aviso; si quedan sin leer, el
       punto se queda, en todas las pantallas, sin reiniciar (el hook relee con
       `publishNoticesSeen`).
    4. **Cabecera fija al abrir un grupo** — `group/[id]` pasa a
       `animation: 'fade'` (`Motion.screen.duration`): las dos pantallas
       pintan la misma barra en el mismo sitio y con el mismo punto, así que
       al fundirse la barra se ve quieta y sólo el contenido transiciona;
       igual al volver. Navegación y gesto de retroceso intactos; el resto de
       transiciones no se toca. Sin ver en dispositivo.
    5. **«Soy nuevo» en amarillo** — borde e icono con `theme.accent` en vez
       de `joinAccent` (morado, que sigue en el emblema y en la hoja de
       acciones). Sin ver en dispositivo.
    6. **Pagos sugeridos** — sin selector: las propias sin rótulo; un
       `ActionButton` compacto «Todos» / «Sólo los míos» con
       `accessibilityState.expanded` (prop nueva `expanded`) despliega y
       pliega las ajenas, detrás de las propias y sin duplicar; «Saldado» sólo
       en las propias (con la excepción 2). Verificado:
       `group-payments-surface`, `suggested-payments-surface`.
    - **Dispositivos:** un iPhone y un Android (Expo Go, elección del
      propietario) están conectados a Metro y al backend; no los manejo. Una
      captura del Android (Inicio de Aitor, Deudas −20,00 €, punto en la
      campana) es lo único visto; **ninguno de los seis ajustes está visto en
      dispositivo**. Sin build.
    - Metro en modo normal (sin `CI`), sirviendo los módulos nuevos
      (comprobado pidiéndolos); durante dos guardados intermedios los
      dispositivos recibieron un error transitorio (`notices`, `fade`) ya
      corregido: recargar.
  - **Fantasmas y campana (2026-09-13, tarde).** Migración
    `20260913130000_ghost_payments_and_notices_seen.sql`, aplicada entera a la
    base local por `psql` (estado real comprobado antes: registro en 18,
    `20260913120000` presente, `20260913130000` ausente; `record_group_payment`
    sigue de `nomey_writer`; sin reaplicar nada). **Registrado:** 41 desde la reconciliación de la última tanda (antes 18).
    1. **Pagos con participantes sin cuenta.** `record_group_payment` exige al
       menos un Personal: la caja va sólo al que existe; sin Personal ni aviso
       inventados; el pago y su detalle con las dos identidades; registra la
       parte con cuenta (única con vínculo); dos sin cuenta → nadie. Cliente:
       «Saldado» con al menos una parte con cuenta. F09/ADR-007 C7 reescrito, con
       la preparación de F10 (identificador estable, sin `user_id` inventado,
       incorporación de caja idempotente sin duplicar ni perder anulaciones).
       Verificado desde cero (`NomeyIso`, 41): `ghost-payments.sql` A–F
       (usuario→fantasma, fantasma→usuario, tercero y dos fantasmas rechazados,
       anulación con reversión exacta y replay, coherencia con la reclamación
       por vínculo, campana de quien salió); `reopened-pair-payment`,
       `group-payments-evidence`, `departed-obligation`,
       `group-notices-seen`, `leave-and-settle`, `identity-lock`,
       `unclaim`, `retire` y las dos carreras. CI: paso nuevo.
    2. **Punto de la campana.** Causa: `api.mark_group_notices_seen` y
       `api.mark_group_notice_read` sólo marcaban avisos de grupos **con
       membresía**; los de pago que llegan a quien salió (legibles por
       destinatario) nunca pasaban a leídos y `notices.unread` seguía > 0 —en
       la base: Aitor, fuera de «Prueba», con dos avisos de pago sin leer—.
       `incidents.unseen` era cero. Corrección: las dos funciones marcan lo
       mismo que la lectura deja ver (membresía **o** aviso de pago dirigido a
       mí). Los hooks de cabecera comparten estado por `publishNoticesSeen`
       (las tres instancias releen); nada se oculta en local; un aviso que
       llegue después de abrir la campana queda pendiente (`ghost-payments`
       F8/F9). Sin ver en dispositivo: los avisos de Aitor siguen sin leer en
       la base hasta que abra la campana.
  - **Bloque de cierre (2026-09-13, noche).**
    - **Visto en dispositivo (por el propietario):** pagos usuario→fantasma y
      fantasma→usuario (deuda cerrada, caja sólo en el Personal existente,
      gasto y renta intactos); anulación del pago recibido del fantasma (deuda
      restaurada, caja revertida); punto de la campana de Android apagándose
      al abrirla; «Todos» despliega/pliega las propuestas ajenas sin
      duplicar ni ofrecer «Saldado». Ya confirmados antes: deuda reabierta
      visible, concepto editable y bloqueos de Cena con mensajes, desplegable
      sin repetición, bloqueo directo de salida, orden del pago, anulación
      desde Personal, saldar lo reabierto con Aitor fuera, salida a cero de
      Eduardo, cabecera fija, «Soy nuevo» amarillo.
    - **Desplegable del pago simplificado (decisión):** sin «Cerró» / «Había
      cerrado» / «Y además» ni listas de obligaciones; queda «Declarado por»,
      el estado anulado y la papelera de las partes; sin lápiz. Sólo
      presentación: `core.payment_allocation`, `api.group_payment_allocation`,
      los checks (B4c/B4d, J10b) y los efectos no cambian. El lector de cliente
      `fetchPaymentAllocation` y sus textos se retiran; F09/ADR-007 §1 actualizado;
      `group-payments-surface` reescrito. Sin ver en dispositivo.
    - **Errores en `group-form.tsx:474` (`ParticipantField`):** no
      reproducidos ni diagnosticados. Lo que hay: tres entradas `ERROR` de
      Metro **sin texto** (bytes comprobados: la línea está vacía), con un
      marco de código en el `createElement` del `map` de participantes y la
      pila de creación del elemento (`GroupForm` → `SheetWindow` →
      `GroupWindow` → `EditGroupScreen`) —la forma de la pila de propietario
      de React 19—, durante la edición de participantes fantasma. Lectura
      estática sin hallazgo: las claves son UUID estables, `register` no
      devuelve nada, `ParticipantField` no lee `key` ni `ref`. **Evidencia
      que falta:** el texto del aviso. No puedo reproducirlo desde aquí: el
      Xiaomi rechaza `adb shell input` (`INJECT_EVENTS`; hace falta activar
      «Depuración USB (ajustes de seguridad)» en MIUI) y el buffer de
      `logcat` ya no contenía el momento. **Paso para capturarlo:** con el
      Android conectado, `adb logcat -s ReactNativeJS:*` (queda uno
      capturando en el scratchpad, `android-reactnativejs.log`) y repetir
      Modificar grupo → escribir un nombre en el hueco → cancelar; el texto
      completo del `console.error` aparece ahí (o en el LogBox del propio
      teléfono al tocar el aviso). Sin texto no se toca nada.
    - **Migraciones:** diagnóstico y procedimiento en
      [`docs/runbooks/migraciones-reconciliacion-local.md`](../runbooks/migraciones-reconciliacion-local.md):
      18 registradas / 41 aplicadas; huella completa de `api`/`sec`/`core`
      (funciones con cuerpo, vistas, columnas, policies, grants, constraints)
      de la base viva frente a un arranque desde cero con las 41: **sin
      diferencias funcionales** (sólo espacio en blanco en `sec.is_me` y
      `sec.my_claim_command_id`); `scripts/migration-audit.mjs` y
      `scripts/schema-fingerprint.sql` (sólo lectura). Propuesta: `migration
repair --local --status applied` de las 23 versiones tras repetir la
      huella; nada ejecutado.
    - Verificado: `npm run verify`, `group-payments-surface`, `phase-blocks`.
      Metro sin `CI`, sirviendo el módulo de la fila actualizado.
  - **Cierre (2026-09-13, última tanda).**
    - **Visto en dispositivo (por el propietario):** Android · Modificar grupo
      → escribir un participante → cancelar sin guardar: sin cambios
      persistidos ni aviso visible. Pago anulado desplegado: presentación
      simplificada correcta (sin cadenas ni «Había cerrado»), sin editar ni
      volver a eliminar.
    - **Errores en `group-form.tsx:474`: no reproducidos.** El `logcat`
      (`ReactNativeJS`) capturado durante esa prueba sólo contiene la carga
      del bundle (15:35); el buffer del dispositivo tampoco tiene ningún
      `console.error`. Queda como incidencia **no reproducida**, con la
      evidencia disponible (tres `ERROR` sin texto en Metro, marco en el
      `createElement` del `map` de participantes, pila de creación de React
      19). Sin nueva evidencia no se investiga más; la captura se ha parado.
    - **Registro de migraciones reconciliado (Opción A del runbook):** huella
      funcional repetida contra un arranque desde cero con las 41 (sin
      diferencias funcionales), copia del registro (dump + tabla
      `supabase_migrations.schema_migrations_backup_20260913`), `migration
repair --local --status applied` de las 23 versiones, comprobación:
      **41 registradas = 41 ficheros**, `migration up --local` sin nada
      pendiente, esquema idéntico antes/después, datos intactos. Ningún SQL
      reejecutado; sin `db reset`. Desde ahora las migraciones nuevas se
      aplican con `migration up --local`.
    - Metro sin `CI`, sirviendo el cliente actual.
  - **Salida bloqueada «con todo saldado» y asociación de fantasmas
    (2026-09-14).** Metro reabierto en la IP nueva (`172.20.10.6`, `.env`
    actualizado; Kong vuelto a arrancar tras el reinicio).
    - **Causa del bloqueo (sólo lectura, datos intactos):** «Prueba 2». Aitor
      y Edu tienen **neto cero** en Saldos pero pares vivos: Aitor>Luis 100,
      Aitor>Edu 300, Ana>Aitor 400, Edu>Luis 300 (Ana y Luis sin cuenta,
      Ana −1100 / Luis +1100). Se sale por pares (F09/ADR-007 C5), no por neto:
      `leave_group` responde `LEAVE_BLOCKED_DEBT` con esos pares —bloqueo
      **legítimo**—. El hueco era de interfaz: Pagos sugeridos reparte NETOS
      (mínimo de transferencias) y proponía sólo Ana→Luis, sin nombrar a
      Aitor/Edu («Ninguna propuesta te nombra»), y el aviso de salida no
      decía qué pares. Corregido sin tocar guardas: el aviso de salida lista
      los pares con nombre e importe («Debes 1,00 € a Luis», «Ana te debe
      4,00 €») y Pagos sugeridos, cuando la propuesta no me nombra pero tengo
      pares, los enseña tal cual con «Saldado» (par directo; con fantasmas
      vale desde 20260913130000). Verificado: `group-payments-surface`,
      `npm run verify`. Sin ver en dispositivo. Los pares Ana↔Luis (dos sin
      cuenta) no bloquean a nadie con cuenta y se resuelven retirando
      (F09/ADR-005).
    - **Asociar un fantasma a mi cuenta:** diseño en
      [F09/ADR-009](../adr/F09/ADR-009-associate-ghost-to-own-account.md)
      (Propuesto): fusión de LECTURA por `core.participant_merge`, sin
      reescribir hechos. Decidido después (abajo): se incorpora también la
      caja histórica.
  - **Salir a cero y asociar con historial completo: contrato y evidencia
    aislada (2026-09-14, tarde).** Dos decisiones de producto: (1) asociar un
    fantasma incorpora su historial económico completo, caja incluida; (2)
    quien queda a **neto cero** puede salir aunque conserve pares, y sus
    pares se reasignan sin dinero (Aitor>Edu 3 y Edu>Luis 3 → Aitor>Luis 3).
    - **Contrato:** [F09/ADR-007 §C8](../adr/F09/ADR-007-group-payments-and-exit-without-debt.md)
      (novación de salida: operación `departure_novation` del writer,
      atómica e idempotente con la salida, sólo deuda, no anulable; salir
      exige neto cero, no cero pares) y
      [F09/ADR-009](../adr/F09/ADR-009-associate-ghost-to-own-account.md) (cuota y
      deuda por lectura —la resolución canónica vive en
      `core.current_effect`—, caja por escritura una vez completando las
      versiones vigentes; reversión por anular/corregir). Lo que garantiza la
      novación sobre el número de transferencias está dicho en C8: no cambia
      ningún neto, así que no cambia la propuesta; **no** se afirma mínimo
      global sobre las obligaciones vigentes.
    - **Migraciones APLICADAS a la base local de desarrollo (2026-09-14,
      autorizado):** `20260914120000_departure_novation.sql` (A) y
      `20260914130000_associate_participant.sql` (B), con
      `migration up --local` tras verificar el destino (socket local,
      `Nomey`, sin proyecto remoto enlazado), guardar copia recuperable
      (`pg_dump -Fc` de `core`, `sec`, `api`, `auth` y
      `supabase_migrations` en el scratchpad de la sesión,
      `backup-pre-A-B-20260913-1759.dump`, y la tabla
      `supabase_migrations.schema_migrations_backup_20260914`) y superar la
      validación aislada. Registro: **43 registradas = 43 ficheros**,
      `migration-audit` sin objetos ausentes. Datos manuales intactos (15
      operaciones, 67 efectos, 5 grupos; ninguna fusión). Tipos regenerados
      (`gen types --local --schema api`, Prettier). Los dos checks nuevos
      también pasan contra la base local (en rollback). El nombre de las dos
      migraciones no colisiona con `origin/main`.
    - **Decisión visual cerrada (F09/ADR-009):** tras asociar, el nombre actual de
      la cuenta en todo, histórico incluido; ids y «Declarado por» intactos.
    - **Evidencia (pila aislada `NomeyIso`, levantada desde cero con 41 + A +
      B; todo en rollback salvo el script de carrera, que limpia):**
      `supabase/checks/departure-novation.sql` (A–E: el ejemplo, cadena con
      importes distintos y segunda salida sobre pares novados, ciclo
      compensado, pagos/anulaciones/correcciones después, C6),
      `supabase/checks/associate-participant.sql` (A–D: dos identidades con
      actividad, caja una vez, cuota por lectura, vistas, replay y rechazos,
      correcciones y anulaciones que derivan y revierten la caja, combinación
      con la novación sin doble cómputo) y
      `scripts/associate-race-evidence.sh` (cuatro carreras con dos sesiones;
      `NOMEY_DB_CONTAINER=supabase_db_NomeyIso`). La suite completa de
      checks pasa con A+B salvo los cuatro antiguos ya pendientes (iguales).
      Los dos checks nuevos **no** se ejecutan contra la base local mientras
      los borradores no estén aplicados.
    - **Hallazgo previo, medido de paso:**
      `sec.assert_correction_leaves_no_oversettled_debt` neta las dos
      direcciones del par: con un par pagado del todo y deuda inversa
      posterior, corregir sólo el concepto se rehúsa
      (`SETTLEMENT_EXCEEDS_DEBT`). Sin fusión ni novación (sonda:
      `scratchpad/probe-x1.sql`). Pendiente de F9; no tocado.
    - **Cliente (hecho, sin ver en dispositivo):** fuera el listado de «pares
      propios» de Pagos sugeridos (`myPairs`, `group.suggestOwnPairs`,
      `fetchMyPendingPairsNamed`); la comprobación previa de salida lee **mi
      neto** (`fetchMyNetPosition`, `api.group_balance` fila propia) y el
      aviso dice «Te queda por pagar/cobrar X» + «Se sale con el saldo a
      cero…»; el servidor sigue decidiendo (`blockedDebt` tardío relee el
      neto). «Asociar a mi cuenta» en el menú al tocar un participante sin
      cuenta y activo, sólo con identidad propia (`useAssociateParticipant`,
      clave por intención, `PARTICIPANT_LINKED/MERGED/RETIRED` → «Ya no se
      puede asociar»), con confirmación que explica que se asumen gastos,
      pagos y pendientes y que no se deshace; al completarse se releen
      participantes y movimientos y `publishGroupRecorded` refresca Grupos,
      Inicio y avisos. El origen fusionado (`mergedInto`) no se lista ni se
      elige (`listed`); el mapa de nombres de la pantalla resuelve su id al
      nombre del destino, así que repartos, gastos, pagos y avisos enseñan el
      nombre actual sin duplicar personas. En una corrección de un gasto que
      nombraba al origen, su cuota se conserva sin fila propia (como con un
      retirado). Verificado: `npm run verify`, `associate-participant-surface`
      (nuevo), `group-payments-surface`, `group-expense-surface`,
      `suggested-payments-surface`, `leave-and-settle-surface`,
      `groups-list-surface`, `unclaim-participant-surface`,
      `personal-home-surface`, `shared-expense`, `suggested-payments`. La
      batería completa (`--maxWorkers=1`) deja dos ficheros en rojo **ajenos
      a este bloque**: `greeting-source` (`groups.whoHint`/`whoNewHint`
      contienen «tu nombre», del bloque de invitaciones) e `i18n-usage`
      (cinco claves `group.settle*` huérfanas desde que «Saldado» sobre
      inactivos salió de la pantalla; su destino depende de la revisión
      pendiente de `settle_participant`). Metro sin `CI` sirve el cliente
      nuevo (comprobado módulo a módulo: `use-membership`, `group/[id]`,
      `groups`, `suggested-payments-card`).
    - **Visto en dispositivo (por el propietario, 2026-09-14):** salir con
      neto cero y pares compensados completó la salida; en un grupo nuevo,
      asociar un fantasma con gastos a una cuenta funcionó y los importes
      cuadraron. **No confirmado:** la presentación del nombre y la ausencia
      de duplicados en selecciones nuevas, porque el «+» del grupo no abrió
      en el iPhone al intentar continuar.
  - **El «+» tras asociar, y volver a entrar tras salir (2026-09-14, noche).**
    - **«+» que no abre en el iPhone: NO reproducido; causa no demostrada.**
      Lo comprobado: (1) datos, por HTTP con el JWT de Aitor contra la base
      local (`group_profile`, `group_summary`, `my_reopened_debt`,
      `group_participant` con `merged_into_participant_id`, `group_balance`,
      `group_operation`, `group_pending_pair`, `category`): todo 200 y
      coherente, sin caché de esquema desfasada; (2) los módulos de la ruta
      (`group-expense`, `shared-expense-window`, `shared-expense-form`)
      empaquetan sin errores; (3) el registro del dev server no tiene ningún
      `client_log` de error del iPhone tras la asociación (16:54Z); (4) en
      el emulador Pixel 7 (Expo Go, cliente actual, cuentas desechables
      `diag-*@example.test`, tres grupos: asociado por SQL, asociado desde la
      propia pantalla, y fantasma con el MISMO nombre que la cuenta, como en
      «Prueba»): el «+» abre en los tres casos, incluso justo después de
      asociar desde la pantalla; el formulario lista al usuario UNA vez
      («Bruno (Tú)»), el origen fusionado no se ofrece, Movimientos dice
      «Pagado por Bruno» sobre el gasto que pagó el fantasma, y un gasto nuevo
      (3000 a medias) queda con reparto Tamara/Bruno una vez y caja −3000 una
      vez en el Personal de Bruno (verificado en la base). Capturas en el
      scratchpad de la sesión (`diag-03…17.png`). Ningún cambio de código por
      esto. **Siguiente paso:** repetir en el iPhone con Metro conectado (el
      `client_log` recogería el error, si lo hay); si persiste, la diferencia
      es de plataforma (menú contextual SwiftUI de la fila de saldos +
      `Alert` + `router.push`), no de datos.
    - **Volver a entrar tras salir: contrato e implementación**
      ([F09/ADR-010](../adr/F09/ADR-010-rejoin-after-departure.md), Aceptado).
      Migración `20260914140000_rejoin_after_departure.sql`: `preview_invitation`
      → `rejoin` + `previous_participant`; `redeem_invitation` con
      `choice = 'rejoin'` (membresía + periodo desde hoy, o el de hoy
      reabierto si salió hoy; `REJOIN_REQUIRED` si con vínculo elige otra
      cosa; `REJOIN_NOT_AVAILABLE` si nunca estuvo); y
      `api.group_profile.participant_count` sin orígenes fusionados (la
      tarjeta de «Prueba» decía 3 con dos identidades). **Verificada en
      aislamiento** (pila desde cero con 41 + A + B + C):
      `supabase/checks/rejoin-after-departure.sql` (A–E: salir y volver con la
      huella del grupo idéntica y la novación intacta; repetir el enlace;
      claim/new con vínculo; rejoin sin vínculo; revocado y caducado; hueco de
      ausencia real sin reparto retroactivo; identidad fusionada que vuelve
      como su destino sin caja repetida; C6 fuera por la excepción y dentro
      como miembro, una sola vez) y `scripts/rejoin-race-evidence.sh` (tres
      carreras). `group-invitations.sql` §E adaptado; el resto de checks
      afectados pasan. **NO aplicada a la base local** (43 registradas; la 44ª
      queda pendiente de `migration up --local` cuando se autorice; con ella,
      regenerar `database.ts` no hace falta: no cambia la superficie tipada).
    - **Cliente (hecho, sin ver en dispositivo):** `previewInvitation` lee
      `rejoin` (y `rejoin_pending` del servidor anterior como `rejoin`) con
      `previousParticipant`; «¿Quién eres?» ofrece una sola opción «Volver a
      entrar como {nombre}» → `redeem({kind: 'rejoin'})`; `REJOIN_REQUIRED`
      se explica como el bloqueo anterior. Contra la base local sin la
      migración, el servidor sigue respondiendo `REJOIN_NOT_AVAILABLE` (texto
      «Vuelve a entrar con tu identidad de entonces»): por eso la prueba
      manual de volver espera a aplicar C.
    - **Datos desechables en la base local** (cuentas `diag-t1/t2-…@example.test`,
      grupos «Diag asociado», «Diag sin asociar», «Diag mismo nombre»):
      retirados al terminar; los grupos manuales y las dos cuentas no se han
      tocado.
    - **Nueva evidencia manual (2026-09-14, noche): el «+» funciona en el
      iPhone con Eduardo y no con Aitor**, y con Aitor abre en Inicio y en otro
      grupo pero no en el grupo donde asoció al fantasma. **Causa, medida con
      instrumentación temporal (`[diag:+]`, ya retirada):** la ruta
      `group-expense` montaba, su `useGroups` publicaba «1 grupo» (después
      «2») que no era el pedido, y ejecutaba `router.back()` en el mismo
      segundo, antes de que `fetchGroups` respondiera. Esa lista inicial es
      la **proyección local de la cola** (las creaciones de grupo hechas en
      ese aparato), que llega antes que el servidor: un grupo al que se
      entró por invitación no está en la cola, así que con una creación
      local pendiente de retirar la guarda `group === undefined &&
groups.length > 0` se cumplía y la ventana nunca abría. Encaja con
      todo lo observado: Edu abre los grupos que creó él; Aitor abre el que
      creó (`01fab583…`, local) y no el que se le invitó; en el emulador, sin
      cola local, nunca falló; los datos y el HTTP eran correctos. No tiene
      que ver con la asociación: coincidía con ella porque fue el único grupo
      de Aitor por invitación. **Corregido:** la ruta espera a `loading` de
      `useGroups` (`if (!loading && group === undefined) router.back()`),
      como ya hacían `edit-group` y `share-group`; sin retardos ni reinicios.
      Test: `group-expense-surface` («sólo se deshace cuando la lista remota
      ya se leyó»). `npm run verify` limpio; Metro sirve el cambio.
      **Visto en dispositivo (por el propietario, 2026-09-14): el «+» abre en
      ese grupo con Aitor en el iPhone.**
    - **Migración de reincorporación APLICADA a la base local (2026-09-14,
      autorizado):** `20260914140000_rejoin_after_departure.sql` con
      `migration up --local` tras verificar el destino (socket local,
      `Nomey`, sin proyecto remoto), copia recuperable (`pg_dump -Fc` en el
      scratchpad, `backup-pre-C-20260913-2016.dump`, y la tabla
      `supabase_migrations.schema_migrations_backup_20260914b`) y confirmar
      que era la única pendiente. Registro: **44 = 44**; `migration-audit`
      sin objetos ausentes; datos intactos (8 grupos, 18 operaciones, 1
      fusión). Comprobado con las funciones reales en una transacción
      deshecha: como Aitor (fuera de «Rgrgttg», invitación válida creada por
      Edu y descartada con el rollback) `preview_invitation` responde
      `{state: 'rejoin', previous_participant: {…, display_name: 'Aitor'}}`.
      Los checks `rejoin-after-departure` y `group-invitations` pasan contra
      la base local (rollback). Metro sin `CI` sirve el cliente con «Volver a
      entrar como {nombre}». Ningún usuario reincorporado por mí.
      **Visto en dispositivo (por el propietario, 2026-09-14): la
      reincorporación funciona en el iPhone: vuelve con su identidad,
      conserva el historial, no duplica participante ni altera el
      Disponible.** La base queda con 44 migraciones aplicadas y registradas. Nota: las identidades que Aitor dejó hoy tienen el
      periodo `[hoy, hoy)`; al volver hoy, la migración reabre ese periodo en
      vez de crear otro (grano día).
  - **Cierre de F9, primer bloque: los fallos automáticos pendientes
    (2026-09-14).** Cada uno clasificado y resuelto en aislamiento (pila
    `NomeyIso` desde cero con 45 migraciones); datos manuales intactos.
    - **`SETTLEMENT_EXCEEDS_DEBT` al corregir sólo el concepto — defecto de
      implementación.** Las guardas de sobreliquidación (correcciones y
      anulaciones) exigían `S ≤ E + delta` como condición absoluta del
      estado y miraban el par en la dirección de la versión, no en la de las
      liquidaciones; con un par liquidado y un gasto cruzado posterior, toda
      corrección (incluso el concepto) y la anulación del cruzado se
      rehusaban. **Migración
      `20260914150000_oversettlement_guard_delta.sql`** (`sec.settled_net`,
      `sec.oversettled_after`, las dos guardas recreadas): se orienta el par
      por sus liquidaciones y sólo se rehúsa lo que empeora el neto por
      debajo de cero; la semántica neteada (20260908150000) y el ejemplo
      canónico se conservan. Evidencia `supabase/checks/oversettlement-delta.sql`
      (concepto y subida permitidos; bajada y anular el liquidado rehusados;
      anular el cruzado permitido; 5000/4000→3000 rehusado, →4000 permitido;
      sin liquidaciones nada bloquea). **Pendiente de aplicar a la base local**
      (45ª; `migration up --local` cuando se autorice; no cambia la
      superficie tipada).
    - **`participant-identity` A6c — expectativa desfasada.** Nació en F5
      («nadie escribe vínculo ni periodos»); desde F9 lo hacen los comandos
      de los ADR aceptados. Ahora afirma exactamente esas escrituras
      (provisioner: INSERT/DELETE del vínculo, INSERT de periodos; columna
      `valid_until` para provisioner y writer) y ninguna otra. De paso, C5
      (periodo vacío) pasaba a positivo desde F09/ADR-003 §5.
    - **`split-conversion` A4/A4b — expectativa desfasada.** El reparto
      declarado se abrió a los miembros en 20260908140000 (vistas
      `security_invoker`). Ahora afirma exactamente `SELECT` de
      `authenticated` sobre `split` y `split_participant` con policy
      `sec.is_member(scope_id)`, nada sobre `frozen_conversion`, ninguna
      escritura.
    - **`personal-provisioning` B2/B2b — expectativa desfasada.** El
      provisioner sigue sin tocar el libro; escribe identidad exactamente
      como fijan F09/ADR-001/035/037/041 (participante INSERT; vínculo
      INSERT/DELETE; periodo INSERT y `valid_until`), no borra ámbitos y sí
      retira membresías (F09/ADR-003/037). Afirmado así.
    - **`canonical-attribution` E — dos cosas:** un `%` sin `s` en cuatro
      `format()` (defecto del check, que ocultaba el fallo real) y la
      expectativa desfasada de que la deuda se atribuye sin membresía: desde
      F09/ADR-003 (20260911120000 §3) la deuda exige vínculo Y membresía (lo
      reabierto llega por C6). E y G2 afirman ahora la cuota sin membresía y
      la deuda con ella, con las fechas originales.
    - **`greeting-source` — regla demasiado amplia.** Prohibía «tu nombre» en
      todo el catálogo; en «¿Quién eres?» (`groups.whoHint`, `whoNewHint`)
      es literal, no un placeholder. Se acota a `home.*`, que es donde un
      saludo puede fingir; los textos no cambian.
    - **`i18n-usage` — cinco claves `group.settle*` huérfanas.** Eran los
      textos del diálogo de «Saldado» sobre quien salió, retirado de la
      pantalla por F09/ADR-007 v3 («`api.settle_participant` queda sin UI para el
      estado heredado»). La revisión pendiente de `settle_participant` es de
      permisos del servidor, no de esa UI: se retiran las cinco claves; el
      hook `useSettleParticipant` y el servicio quedan hasta esa revisión.
    - Suite SQL completa sobre la pila aislada con las 45 y batería
      `vitest` completa: en verde (resultados en el checkpoint).
  - **Cierre de F9, segundo bloque (2026-09-14, noche).**
    - **Guarda de sobreliquidación APLICADA a la base local (autorizado):**
      `20260914150000_oversettlement_guard_delta.sql` con `migration up
--local` tras verificar destino (socket local, `Nomey`, sin remoto),
      copia recuperable (`backup-pre-D-20260913-2100.dump` en el scratchpad
      y tabla `schema_migrations_backup_20260914c`) y que era la única
      pendiente. **45 = 45**, `migration-audit` limpio; datos intactos (8
      grupos, 18 operaciones, 77 efectos, 1 fusión). Evidencia dirigida contra
      la base local en rollback: `oversettlement-delta`,
      `group-payments-evidence`, `departed-obligation-evidence`,
      `balance-and-annulment`: OK.
    - **Cabecera que se desplaza al volver del grupo — causa y corrección.**
      `animation: 'fade'` decide la entrada y la vuelta por la flecha
      (react-native-screens anima el pop con la animación de la pantalla que
      se va: `RNSScreenStackAnimator`, operación pop → `fromVC`), pero en
      iOS el **deslizamiento de retroceso** usa la transición interactiva
      nativa del sistema —el deslizamiento— salvo que se le diga que use la
      misma: `customAnimationOnSwipe` (`RNSScreenStack
gestureRecognizerShouldBegin`), que en la pila de expo-router es
      `animationMatchesGesture`. Añadido a `group/[id]`; gestos, controles
      y estética intactos. **Pendiente de nueva validación en el iPhone**
      (volver con la flecha y con el gesto).
    - **Punto de notificaciones distinto entre cabeceras — sin causa
      demostrada; una corrección de código y instrumentación temporal.** Las
      dos cabeceras calculan lo mismo (`incidents.unseen > 0 ||
notices.unread > 0`) con los mismos hooks; el servidor no tiene avisos
      sin leer para ninguna de las dos cuentas (`group_notice` como Aitor y
      como Edu, por HTTP: 0), así que la diferencia sólo puede venir de las
      **incidencias** (cola local) o de una lectura en vuelo antigua. En
      `useIncidents` había una: dos recargas concurrentes (la del montaje y
      la que dispara «vistos») escribían el estado en el orden en que
      RESOLVÍAN, no en el que se pidieron, así que una marca de vistos ya
      superada podía volver a encender el punto en una instancia y no en
      otra. **Corregido** (número de secuencia: sólo la última recarga
      emitida escribe). `useGroupNotices` ya descartaba la respuesta
      superada (limpieza del efecto). Como no puedo afirmar que fuera lo
      observado, queda **instrumentación temporal** `[diag:dot]` (cuentas,
      sin datos personales) en la barra de pestañas, en el grupo y en la
      campana; **se retira al cerrar**. Ni se oculta el punto ni se marca
      nada leído.
    - **`api.settle_participant`, revisado.** Definer de `nomey_writer`;
      `EXECUTE` para `authenticated`; comparte `sec.retire_participant_core`
      con `api.retire_participant` (flujo vigente: retirar a un participante
      sin cuenta, F09/ADR-005). Cliente: `useSettleParticipant` /
      `sendSettleParticipant` existen y **ninguna pantalla los usa** desde
      F09/ADR-007 v3 (con la salida a cero no hay a quién ofrecer «Saldado»; C6 y
      la excepción 2 cubren lo reabierto). Estado heredado en la base local:
      **ningún** participante salido con pares pendientes. Contrato: F09/ADR-003
      §4 lo creó; F09/ADR-007 no lo retira expresamente (lo deja «sin UI para el
      estado heredado»). **Sin revocar:** retirar el `EXECUTE` no bloquearía
      ningún flujo vigente hoy, pero decidirlo —y borrar el hook— es un
      cambio de contrato de F09/ADR-003 §4 que conviene fijar con el cierre; se
      deja documentado, no hecho.
    - **Criterios de cierre de F9 (roadmap), contrastados:**

      | Criterio                                   | Qué exige                                                           | Contrato vigente                                                                                                                                                                                                                                                                                                   | Evidencia automática                                                                                                              | Evidencia manual                                                                                   | Falta                                                                                                                                                                                                                                                            |
      | ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
      | 4.2 gasto de grupo por el pagador          | caja −total al pagador, cuota a cada uno, deuda a favor del pagador | F01/ADR-001/011/013, F03/ADR-006 (writer), F09/ADR-001                                                                                                                                                                                                                                                             | `authoritative-writer-debt` (vectores), `group-expense-flow`, `personal-statistics` M1                                            | visto en iPhone repetidamente (altas en «Prueba», «Prueba 2»)                                      | —                                                                                                                                                                                                                                                                |
      | 4.3 el mismo gasto por otro miembro        | efectos idénticos; sólo cambia la autoría (`created_by`)            | F03/ADR-006 (pagador del payload, caja por vínculo), F03/ADR-008                                                                                                                                                                                                                                                   | `authoritative-writer-debt` E1 (corrección cross-author), altas con pagador ≠ autor en `group-payments-evidence`/`ghost-payments` | pagador sin cuenta registrado por Edu: visto; **otro miembro con cuenta como pagador: no anotado** | una prueba manual: Edu registra un gasto pagado por Aitor y ambos Personales cuadran                                                                                                                                                                             |
      | 4.4 quien no paga                          | cuota económica sin caja                                            | F03/ADR-013, F06/ADR-008                                                                                                                                                                                                                                                                                           | `personal-statistics` M2, `canonical-attribution` E                                                                               | «Tu gasto» sin caja visto en emulador; en iPhone «los importes cuadraron» tras asociar             | anotar explícitamente en el iPhone: Disponible sin cambio y Gastos con la cuota                                                                                                                                                                                  |
      | 4.5 marcar deuda saldada, sólo deuda       | liquidación sin efecto de caja                                      | **sustituido de hecho por F09/ADR-007 v3**: «Saldado» es `group_payment` (caja en los dos Personales + deuda, clase `transfer`, nunca ingreso); `record_debt_settlement` (sólo deuda) sigue existiendo sin UI (`shared-expense-form` modo transferencia); C8 reasigna deuda sin caja al salir, pero no es «saldar» | `group-payments-evidence`, `departure-novation`                                                                                   | «Saldado» y salida a cero vistos en iPhone                                                         | **decisión de producto:** ¿se mantiene un «saldar sin dinero» (p. ej. «me lo ha perdonado» / se pagó fuera y no quiero caja)? Si sí, es una acción distinta sobre `record_debt_settlement`; si no, F09/ADR-007 sustituye 4.5 y `data-model.md` §4.5 debe decirlo |
      | inv. 9 gasto económico de todos            | cada participante lleva su cuota                                    | F01/ADR-001 §3, F03/ADR-013                                                                                                                                                                                                                                                                                        | `personal-statistics` M1–M4, `authoritative-writer` vectores                                                                      | sí (Gastos de cada uno en iPhone)                                                                  | —                                                                                                                                                                                                                                                                |
      | inv. 10 no depende de quién registra       | mismo resultado con otro autor                                      | F03/ADR-006 §1, F03/ADR-008                                                                                                                                                                                                                                                                                        | `authoritative-writer-debt` E1 (autoría por versión, efectos iguales)                                                             | parcial (ver 4.3)                                                                                  | la misma prueba manual que 4.3                                                                                                                                                                                                                                   |
      | inv. 15 atribución + notificación          | toda operación con efectos sobre otro queda atribuida y notifica    | F03/ADR-008 (autoría), 20260908170000 (avisos: **sólo ediciones**), F09/ADR-003 §7, F09/ADR-007 C6                                                                                                                                                                                                                 | `group-notices-seen`, `group-payments-evidence` (pago/anulación)                                                                  | campana vista en los dos móviles                                                                   | **el ALTA de un gasto no notifica** (decisión explícita de 20260908170000: «un alta no notifica nada») y la reincorporación tampoco; contrasta con la letra del invariante: decisión de producto (notificar altas y vueltas, con qué `kind`)                     |
      | 5 reparto determinista en dos dispositivos | mismo resto en dos aparatos                                         | F01/ADR-001 §5, F03/ADR-006 (vectores compartidos)                                                                                                                                                                                                                                                                 | 22/22 vectores idénticos dominio/servidor (`authoritative-writer` G)                                                              | **pendiente** (prueba con dos móviles, junto con la propuesta desactualizada)                      | la prueba manual                                                                                                                                                                                                                                                 |

      **Resuelto el 2026-09-14** (bloques siguientes): 4.3/inv. 10, 4.4 y 5
      validados manualmente; 4.5 sustituido por F09/ADR-007 §2; inv. 15 fijado por
      decisión de producto — **sin avisos por alta ni reincorporación**.

  - **«Saldado» en «Prueba» (4be4f1a4…): «No se ha podido registrar el
    pago» — diagnosticado y corregido (2026-09-13, noche).**
    - **El intento, leído:** cinco `POST /rest/v1/rpc/record_group_payment`
      → **409** desde el iPhone (Kong, 19:14:01–19:15:07 UTC), todos
      `SETTLEMENT_STALE` en el log de Postgres, con detalle `positions`
      `481c…:1000 7508…:0 f4ec…:-2000` (los dos primeros) y `…:2000 …` (los
      tres últimos; entre medias entró el gasto de 20 € de las 19:14:33, la
      única escritura de ese cuarto de hora). `7508…` es el origen fusionado
      («Aitor» fantasma → `f4ec…`). **Nada persistió:** cero comandos
      `group_payment`, seis operaciones en el grupo (todas `group_expense`),
      efectos intactos; el CAS levanta antes de escribir y la transacción
      entera se deshace (la clave se reclama antes del CAS, pero cae con
      ella). No se registró ningún pago ni se tocó dato alguno para
      diagnosticarlo.
    - **Causa (servidor):** `sec.group_positions_text` listaba **todos** los
      `core.participant` del ámbito; el cliente manda las filas de
      `api.group_balance`, que desde 20260911120000 no lista retirados y
      desde 20260914130000 §5 tampoco orígenes fusionados. Conjuntos
      distintos → el texto nunca coincide → caducado permanente, releer no
      cambia nada. **No era una propuesta desactualizada.** Reproducido en la
      pila aislada desde cero: con sólo un retirado sin actividad en el grupo,
      el PRIMER pago con la foto real del cliente ya caduca (`A6:
SETTLEMENT_STALE`). El check no lo veía porque `gp_expected` copiaba el
      texto del servidor (probaba el CAS contra sí mismo).
    - **Corrección (servidor):** migración
      `20260914160000_positions_cas_visible_participants.sql` — el texto se
      calcula con las MISMAS exclusiones que la vista; contrato de F09/ADR-007 C2
      intacto («los netos de `api.group_balance` tal como se enseñaron»). La
      ayuda `gp_expected` lee ahora `api.group_balance`; en
      `associate-participant` B7b/B7c se afirma texto = vista, sin origen ni
      retirado; `group-payments-evidence` B2/B3 (caducado real y replay con
      la misma clave) siguen en verde con la foto real. **Aplicada a la base
      local (46 = 46)** con copia recuperable
      (`backup-pre-E-20260913-2140.dump` y
      `schema_migrations_backup_20260914d`); datos intactos (19
      operaciones, 8 grupos, 1 fusión); leído: el texto coincide con la
      vista en los 8 grupos. Suite SQL completa en la pila aislada con 46
      (reconstruida desde cero): 30/30. Los checks de F9 (novación, asociar,
      reincorporación, guarda delta) quedan además en `ci.yml`; no estaban.
    - **Causa (cliente), distinta:** la pantalla decidía el mensaje con
      `payment.failure` dentro de la clausura del `Alert`, que vale lo de
      ANTES de pulsar: el primer intento salía siempre como fallo genérico
      («No se ha podido registrar el pago») aunque el servidor dijera
      caducado, y los siguientes con el motivo del intento anterior. Igual en
      `retirement.settle`. **Corregido:** `record`/`settle` resuelven el
      resultado de ESE intento (`PaymentOutcome`, `SettleOutcome`, el
      mismo patrón que `leave`) y la pantalla decide con él. Los errores
      siguen distinguidos: caducado (relee y explica), no aplicable, y sin
      respuesta —nuevo texto `group.payOffline`: sin respuesta no se afirma
      «no se ha registrado nada»; la clave se conserva y el reintento la
      reconcilia (`already_processed`)—. Un rechazo del servidor sí respalda
      «no se ha registrado nada»: deshace la transacción entera.
    - `npm run verify` limpio; vitest 130 ficheros / 3737 en verde
      (aislado, un worker). Metro sin `CI` sirve el cliente corregido.
  - **Cierre de F9, contraste final (2026-09-14, noche).**
    - **Validado manualmente por el propietario (iPhone + emulador):**
      «Saldado» en «Prueba» con Eduardo (un solo pago, autor Eduardo, deuda
      reducida; no se repitió con Aitor); cabecera fija al volver con flecha
      y con gesto; abrir Notificaciones desde Inicio deja el punto apagado
      también al entrar al grupo; Eduardo registra un gasto pagado por Aitor
      (pagador correcto, 1 € a cada uno sobre 2 €, Disponible de Eduardo sin
      cambio); ese reparto coincide en iPhone y emulador; confirmación de pago
      abierta en el iPhone, Aitor registra el mismo pago en el emulador y al
      confirmar en el iPhone aparece «Los saldos han cambiado».
    - **El intento desactualizado, leído sin tocar nada:** en Kong, desde la
      corrección, tres `record_group_payment`: 19:55:22 **200** (Eduardo,
      2000; caja −2000 en el Personal de Aitor y +2000 en el de Eduardo, deuda
      −2000; **anulado por Eduardo a las 19:57:52**, versión 2 sin efectos),
      20:05:34 **200** (Aitor, 1900, una versión) y 20:05:50 **409**
      `SETTLEMENT_STALE` con `positions` `481c…:0 f4ec…:0` —los saldos ya
      estaban a cero—. Comandos `group_payment` desde las 19:00: **dos**, los
      de los dos 200; operaciones de pago: dos; la segunda con una sola
      versión. **El intento caducado no creó ningún pago.**
    - **Instrumentación `[diag:dot]` retirada** (barra de pestañas, grupo,
      campana; `useEffect` sobrante de la barra fuera). Sin causa demostrada
      del punto distinto: la corrección de secuencia en `useIncidents` queda,
      y el comportamiento validado es el correcto.
    - **Checks acotados al fixture** (misma afirmación, sin contar lo ajeno):
      `departure-novation` A17 (novaciones del ámbito del fixture) y
      `associate-participant` B0e/B12 (fusiones del ámbito). Antes contaban
      toda la tabla y fallaban sobre la base local con datos reales; con ello
      la evidencia dirigida contra la base local (en rollback) es completa:
      `associate-participant`, `group-payments-evidence`, `ghost-payments`,
      `reopened-pair-payment`, `departed-obligation-evidence`,
      `departure-novation`, `rejoin-after-departure`, `oversettlement-delta`,
      `leave-and-settle`, `retire-participant`, `group-identity-lock`,
      `unclaim-evidence`, `group-notices-seen`: **OK**; datos intactos (23
      operaciones, 8 grupos, 25 avisos, 1 fusión, antes y después).
    - **`api.settle_participant` — permiso revisado y conservado, con
      motivo.** Hechos: definer de `nomey_writer`, `EXECUTE` para
      `authenticated`; **ninguna pantalla lo usa** (`useSettleParticipant` /
      `sendSettleParticipant` exportados y sin consumidor); estado heredado
      en la base local: **ningún** inactivo con pares pendientes (el único par
      pendiente, Ana>Luis 1100 en «Prueba 2», es entre dos fantasmas activos).
      No es necesario para ningún flujo vigente. **Respaldo para revocarlo:**
      F09/ADR-007 «Decisiones cerradas y pendientes» §4 lo deja «pendiente: revocar
      `execute` cuando la base local no tenga inactivos con pares», y esa
      condición ya se cumple. **Por qué no se hace en este bloque:** es un
      cambio de contrato (F09/ADR-003 §4) que arrastra `leave-and-settle.sql`
      (doce llamadas sobre un estado heredado sembrado) y
      `retire-participant.sql`, más retirar el hook y el servicio; conviene
      como cambio propio, con el check reescrito para afirmar el rechazo, no
      como parte del cierre. Mientras tanto el riesgo está acotado: definer
      bajo RLS, exige membresía, participante inactivo, CAS exacto de pares y
      rango 1 (`group-identity-lock` lo cubre).
    - **Criterios de cierre, resueltos documentalmente** en el
      [roadmap](../product/roadmap.md) (Fase 9, «Estado de cierre») y en
      `data-model.md` §4.5/§4.6 (notas a F09/ADR-007): 4.5 sustituido por el pago
      declarado de F09/ADR-007 §2 (la vía «sólo deuda» sigue en el writer sin UI;
      no se añade); 4.6 sigue siendo la transferencia ordenada desde la app de
      F12; la puerta «qué significa notificación» resuelta como campana
      interna (`20260908170000`). **Queda UNA decisión de producto, no
      aprobada:** si el alta de un gasto (y la reincorporación) deben avisar a
      los demás miembros; hoy no avisan (decisión de implementación de
      `20260908170000`, sin ADR) y la letra del invariante 15 y de 4.3 lo
      piden. Ejemplo y opciones en el roadmap.
    - **ParticipantField:** sigue como **no reproducido**, no corregido.
    - **Verificaciones:** `npm run verify` limpio; vitest 130 ficheros /
      3737 en verde (un worker); migraciones **46 = 46** en local (todas en el
      repositorio; la 46ª `20260914160000`); suite SQL 30/30 en la pila
      aislada reconstruida desde cero con las 46 (bloque anterior); los checks
      de F9 en `ci.yml`. Metro sin `CI` sirve el cliente actual.
  - **F9 CERRADA documentalmente (2026-09-14).** Decisión final del
    propietario: **no** se emiten avisos por el alta de un gasto ni por la
    reincorporación; se conservan los existentes. Registrada en
    `data-model.md` (invariante 15, §4 intro, 4.3, 4.10, §8) y en el roadmap
    (Fase 9, «Estado de cierre», criterio 4). `PROJECT_STATE.md` reescrito
    con el alcance real, las 46 migraciones y las verificaciones del último
    checkpoint. Sin cambios de código ni pruebas repetidas: cambio
    exclusivamente documental. **Trasladados fuera del cierre, explícitos:**
    la retirada técnica de `api.settle_participant` (revocar `EXECUTE`,
    retirar hook y servicio, reescribir `leave-and-settle.sql` y
    `retire-participant.sql`) y ParticipantField como **no reproducido**.
    Comprobado que roadmap, estado y este seguimiento coinciden y que ningún
    documento afirma que existan avisos de altas o reincorporaciones.
  - **Pendiente de prueba manual:** los siete puntos corregidos, en el mismo
    grupo «Prueba»: orden del pago en Inicio (un pago nuevo), pago recibido en
    Ingresos, desplegable sin repetición, flujo de salida (bloqueado directo /
    confirmación / bloqueo tardío), Deudas de Aitor −10,00 € (Inicio,
    sin readmisión), corregir el concepto de Cena (permitido) y su importe
    (mensaje «No puedes modificar…»), anular Cena («No puedes anular…»).

## Pendiente

0. **Invitación pulsable desde WhatsApp — aplazado a F8.B, con la build
   propia.** Medido en los dos iPhone: el enlace de Expo Go
   (`exp://<ip>:8081/--/join?t=…`) no aparece pulsable en WhatsApp, y un
   esquema propio (`nomey://…`) tampoco lo sería. El recorrido **no está
   resuelto** y no se da por tal. Lo que ya existe y se conserva: el oyente de
   enlaces en la raíz, la espera del token durante el inicio de sesión, la
   apertura de la hoja de «Únete» con la app abierta o en frío
   (`invitation-arrival.ts`, `use-invitation-link.ts`) y la lectura de
   cualquier forma de enlace (`readInvitation`). Hasta entonces, el producto
   es **QR y «Pegar enlace»**. No se construye ninguna página provisional para
   Expo Go ni se toca el código aprobado.

   **Condiciones para cerrarlo, en este orden:**
   1. Pagar **Apple Developer**: es el momento acordado para retomarlo, y no
      sustituye lo que sigue.
   2. Acordar un **dominio** y alojar en él el enlace HTTPS de invitación
      (`https://<dominio>/join?t=…`) con `apple-app-site-association` y
      `assetlinks.json`; `readInvitation` pasa a aceptar ese dominio e
      `invitationLinkHere` a construirlo.
   3. **Universal Links** en iOS (`associatedDomains` en la configuración
      nativa) y **App Links** en Android (intent filter verificado).
   4. **Build propia** en los dos sistemas: nada de esto funciona en Expo Go.
   5. Validar la apertura del flujo de unión **con la app abierta y cerrada**,
      la **conservación de la invitación durante el inicio de sesión**, y la
      **apertura real desde WhatsApp en iOS y Android**.

1. **Validación en el iPhone** del bloque de F09/ADR-003, con un grupo de prueba:
   salir debiendo y cobrando, «Saldado» con pares y a cero, la campana.
2. **Concurrencia real de «Saldado»** con dos sesiones (dos `settle_participant`
   simultáneos, y uno contra un `record_group_expense` en vuelo), al estilo de
   `scripts/group-concurrency.sh`. El bloqueo es el mismo `sec.lock_scopes` y
   el check cubre la confirmación caducada, pero la carrera no se ha medido.
3. **Reconstrucción desde cero** de la migración en CI (la local se aplicó por
   partes).
4. Lo aplazado por F09/ADR-003 a F10: reincorporación, pago parcial de un inactivo,
   fusión de duplicados.

## Una corrección que conviene no repetir

Di por incompatibles con Expo Go `@expo/ui` y `expo-glass-effect` razonando desde
`expo-dev-client` y el config plugin local. **La documentación de SDK 57 dice
«Included in Expo Go» para los dos.** El plugin `with-local-http.js` es además
`withAndroidManifest`: no toca iOS. La compatibilidad no se deduce de que un
proyecto tenga dev-client; se comprueba módulo a módulo.

## Servicios de Supabase detenidos para aligerar el entorno (2026-09-09)

El flujo vigente —autenticación, lectura y escritura de datos, gastos y avisos
internos de edición— usa exactamente cuatro contenedores: `db`, `auth`
(GoTrue), `rest` (PostgREST) y `kong`. Se conserva además `inbucket`, que no
llega a 25 MB y es la única vía de confirmar un correo si hiciera falta.

Los demás están **detenidos, no eliminados**: sus volúmenes y su configuración
siguen intactos. La comprobación de que sobran es del código, no una impresión:
`src/lib/supabase/bootstrap.ts` deja escrito que Nomey **no usa realtime**, no
hay ninguna llamada a `.storage` ni a `functions.invoke`, y no existe
`supabase/functions/`. `studio` y `pg_meta` sólo sirven al panel, que
[`AGENTS.md`](../../AGENTS.md) prohíbe usar para cambiar el esquema.

| Detenido                         | Para qué era              |
| -------------------------------- | ------------------------- |
| `analytics` (logflare), `vector` | Registro agregado de logs |
| `studio`, `pg_meta`              | Panel de Supabase         |
| `realtime`                       | Suscripciones websocket   |
| `storage`, `imgproxy`            | Ficheros e imágenes       |
| `edge_runtime`                   | Edge Functions            |

**Cómo se arranca sólo lo necesario** (desde Ubuntu, con nvm cargado):

```bash
./scripts/supabase-cli.sh start \
  -x realtime,storage-api,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor
```

**Cómo se recupera el entorno completo:** el mismo comando sin `-x`. Es la vía
soportada por la CLI instalada; no se ha tocado `config.toml`, que está
versionado y describe el entorno de todos, no el ahorro de esta máquina.

> `supabase start` no arrancó Kong por sí solo —dio «already running» y siguió—,
> así que hubo que levantarlo con `docker start supabase_kong_Nomey`. Sus 500 de
> ayer eran de Kong resolviendo el DNS de `supabase_auth_nomey`, no de GoTrue.
