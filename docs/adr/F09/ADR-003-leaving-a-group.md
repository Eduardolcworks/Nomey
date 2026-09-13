# F09/ADR-003 — Salir de un Grupo, y dar por saldado a quien salió

- **Estado:** Aceptado (2026-09-10), con las tres consecuencias asumidas por
  producto: «Saldado» resuelve TODO lo pendiente, sin pagos parciales en este
  flujo; no se puede deshacer; tras retirarlo no se permiten cambios que
  vuelvan a generar o alterar su deuda. Implementado en la migración
  `20260911120000_leave_group_and_settle_participant.sql`, medido por
  `supabase/checks/leave-and-settle.sql`. **Sustituido en parte por
  [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)** (2026-09-12):
  §1 (ya no se sale con pendientes), §3 en lo que atañe a quien sale con
  obligaciones, §4 «Saldado» como flujo de salida; **precisado por
  [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md)** en §5–§6. El resto
  sigue vigente.
- **Fecha:** 2026-09-10
- **Identificador anterior:** ADR-034 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Alcance:** qué significa que una cuenta salga de un Grupo, qué hecho lo
  representa, qué conserva quien sale, qué conservan los demás, cómo los
  miembros dan por resueltos los pendientes de quien salió («Saldado»), qué
  ocurre con las correcciones posteriores, y qué es un Grupo sin miembros.
- **Reemplaza una frase de [F03/ADR-009](../F03/ADR-009-participant-identity.md) §5**: el
  invariante `valid_until IS NULL OR valid_until > valid_from` pasa a `>=`, para
  que crear y salir el mismo día deje un periodo **vacío** `[hoy, hoy)` en vez
  de inventar un día de presencia, borrar la fila o hacer fallar la salida. La
  exclusión GiST ya trata el rango vacío como no solapado. Todo lo demás de
  F03/ADR-009 sigue en pie. **Precisa [F03/ADR-013](../F03/ADR-013-economic-attribution.md)
  §1**: la dimensión de **deuda** se atribuye por vínculo **y** membresía
  vigente; la económica sigue siendo sólo por vínculo. **Añade una restricción**
  a las dos clases de liquidación —ambos participantes activos ahora— que
  [F03/ADR-009](../F03/ADR-009-participant-identity.md) §7 no contradice: es más estricta,
  no distinta. Y **cierra** F03/ADR-009 §12: **no hay acceso residual**.
- **Añade una clase de operación**, `participant_settlement`, con clase
  contable `settlement` (F01/ADR-001 §3, F03/ADR-010 §2: el vocabulario de
  `operation_class` es abierto a propósito).
- **Se apoya en** [F03/ADR-004](../F03/ADR-004-membership-rls.md) §4,
  [F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) (una función pública por
  clase, dueña `nomey_writer`), [F03/ADR-007](../F03/ADR-007-client-operation-idempotency.md)
  y [F03/ADR-008](../F03/ADR-008-operation-version-model.md) §13 (clave antes del CAS),
  [F03/ADR-009](../F03/ADR-009-participant-identity.md) §4–§5 y §12,
  [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) §11 (bloqueos antes de leer la
  deuda), [F03/ADR-013](../F03/ADR-013-economic-attribution.md) §10,
  [F06/ADR-006](../F06/ADR-006-annulment.md), [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md)
  §2 y [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md).
- **Evidencia:** [`supabase/e23/`](../../../supabase/e23/README.md) mide lo que
  cada lectura de Personal devuelve hoy al quitar la membresía, y lo que la
  frontera acepta al cerrar la presencia.
- **No decide** la reincorporación, la unión por enlace, la reclamación de un
  participante ni la fusión de duplicados: F10.

## Contexto

La decisión de producto del 2026-09-10, confirmada y precisada, sustituye
«Eliminar grupo» por **salir**, y añade **«Saldado»**:

- Salir es posible **con deudas pendientes**, a pagar o a cobrar, sin aprobación
  ni liquidación previa. No se reabre.
- Quien sale conserva sus movimientos anteriores en Personal; la deuda del grupo
  **deja de contarse** en Deudas de Personal; salir no mueve caja ni genera
  ingreso, gasto ni transferencia. **Y nada posterior lo hará**: una acción de
  los miembros sobre ese pendiente no mueve su Disponible, no crea
  transferencia en su Personal, no genera ingreso ni gasto, no reactiva su
  deuda personal.
- El **día de salida queda excluido** de la elegibilidad.
- Los que permanecen conservan historial y saldos; el participante queda
  **inactivo**; reciben aviso.
- En Saldos, un inactivo tiene el botón **«Saldado»**: cualquier miembro actual
  lo pulsa, se resuelven **todos** sus pendientes en el registro del grupo —lo
  que debe y lo que le deben—, desaparece de participantes y de Saldos, los
  demás se actualizan, y su identidad, gastos e historial se conservan. **No es
  la prueba de una transferencia real**: es la declaración de los miembros de
  que esos pendientes quedan resueltos en el registro del grupo.
- Cuando sale el último con membresía, el grupo desaparece de las listas. Nada
  autoriza un borrado físico ni la falsificación de hechos.

### Lo que las lecturas hacen HOY al quitar la membresía, medido (E23)

Escenario: Ana sale debiendo 550; Luis sale cobrando 350; Edu permanece.

| Lectura                                            | Sin membresía                  | Qué significa                                                                                               |
| -------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `api.personal_balance` (Disponible)                | sin cambio                     | La caja está en el ámbito personal; no depende del grupo                                                    |
| `api.personal_operation`, fila del gasto pagado    | **fila sí, contexto no**       | `group_scope_id`, `group_display_name`, `your_share` pasan a `NULL`: son subconsultas bajo la RLS del grupo |
| `api.personal_operation_version` (historial)       | sin cambio                     | Concepto y categoría vienen de la versión, no del grupo                                                     |
| `api.personal_statistics` (cuotas económicas)      | sin cambio                     | `sec.my_shared_expense_shares` es definer y atribuye por vínculo                                            |
| `api.claimed_dimension()`, dimensión **deuda**     | **sin cambio: sigue la deuda** | Definer por vínculo: **atraviesa la RLS**. Positiva y negativa                                              |
| `api.group_profile`, `api.group_summary`           | 0 filas                        | Invisibles por RLS; Deudas de Personal (cliente) deja de sumarlas                                           |
| `core.group_edit_notice` del que salió             | **sigue ahí**                  | El aviso es del destinatario, no de la membresía                                                            |
| `api.group_balance`, `api.group_participant` (Edu) | idénticos                      | Deudas intactas; el participante no desaparece                                                              |

Y con la presencia cerrada (`valid_until = hoy`), visto por un miembro: gasto
nuevo fechado ayer aceptado; hoy y mañana `PARTICIPANT_NOT_ELIGIBLE`; corregir
uno de hace tres días aceptado; una liquidación fechada hoy
`PARTICIPANT_NOT_ELIGIBLE`; quien salió, `NOT_AUTHORIZED` sobre su propio
gasto.

Tres conclusiones: la exclusión de la deuda **no sale sola** de la RLS
(`claimed_dimension` la publica); los movimientos personales sobreviven **sin
contexto**; y las liquidaciones actuales, fechadas dentro del periodo, **sí**
alcanzan a un inactivo —una `settlement_by_transfer` retro-fechada movería su
caja—, así que hace falta una barrera explícita.

## Decisión

### 1. Salir: tres escrituras sobre tres relaciones, ninguna contable

Un comando de provisioning, `api.leave_group(payload)`, ejecutado por
`nomey_provisioner` como `create_group` y `update_group_profile`, que en una
sola transacción:

| Relación                       | Escritura                                                                              | Por qué ésta y no otra                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `core.membership`              | **Borra** la fila `(scope, actor)`                                                     | F03/ADR-004 §4: la fila existe ⇔ activa                                                                             |
| `core.participant_period`      | **Cierra** el periodo abierto del participante vinculado: `valid_until = current_date` | F03/ADR-009 §5 y §12: la salida se representa con periodos. El día de salida queda **excluido** (§5)                |
| `core.group_departure` (nueva) | **Inserta** `(id, scope_id, participant_id, user_id, left_at, command_id)`             | Borrar la membresía pierde el hecho; el aviso y el historial lo necesitan. Insert-only, como `group_profile_change` |
| aviso                          | Una fila por miembro que permanece, `kind = 'departure'` (§7)                          | Quién salió —por nombre contextual, nunca `user_id`— y cuándo                                                       |

**No escribe ningún efecto**, no crea operación, no pasa por `core.client_command`
(F06/ADR-001 §6) y no toma bloqueos: no hay nada contable que serializar. **No toca
`core.participant_user_link`**. **No anula ni modifica ningún gasto ya
registrado**: los hechos quedan como están.

Idempotencia por clave con `core.provisioning_command`, `command_type =
'group.leave'` (F09/ADR-002). Reintento → `replay`; sin membresía →
`NOT_AUTHORIZED`. Orden dentro de la transacción: destinatarios y participante
propio primero, membresía **al final**, porque las políticas del provisioner
pasan por `sec.is_member` del actor.

### 2. Cuatro datos distintos para «se fue» y «se saldó», y no se colapsan

| Dato                             | Dónde                                                            | Qué responde                                       |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Momento real de salida `left_at` | `core.group_departure.left_at` (timestamptz)                     | Cuándo ocurrió; lo que el aviso enseña             |
| Límite exclusivo de elegibilidad | `core.participant_period.valid_until` (date)                     | Hasta qué fecha efectiva puede figurar en un gasto |
| Estado activo `is_active`        | derivado: existe periodo con `valid_until IS NULL`               | Si se le propone por defecto y si puede liquidar   |
| Estado retirado `is_retired`     | `core.participant_retirement` (nueva, una fila por participante) | Si sale de la lista de participantes y de Saldos   |

`api.group_participant` publica, al final, `is_active`, `eligible_until` y
`is_retired`. La presencia llega por un definer **reducido**,
`sec.participant_presence(participant)`, que sólo responde sobre ámbitos de
los que el actor es miembro: el cliente sigue sin alcanzar
`core.participant_period` (guardia A2 de `group-expense-flow.sql`).
`api.group_profile.participant_count` cuenta sólo a los no retirados. Los
pares pendientes que «Saldado» enseña los publica `api.group_pending_pair`,
neteados por par como `sec.net_debt`. **Sigue publicando a los retirados**: los movimientos históricos
necesitan su nombre, y es el cliente quien no los lista. `api.group_balance`
**no** publica a los retirados: Saldos es una lista de posiciones, y la de un
retirado es cero por construcción (§4).

### 3. La deuda sale de Personal por una regla explícita, en las dos superficies

> **Deudas de Personal = suma, por ámbito con membresía vigente del actor, de la
> posición neta de sus participantes vinculados.**

Regla de seguimiento y presentación, igual por signo, sin tocar efectos:

- **El cliente** ya la cumple (Inicio suma `net_position` de `api.group_summary`
  sobre `api.group_profile`, ambas `security_invoker` sobre `sec.is_member`).
  Se documenta como contrato y se comprueba (E23), no se deja como coincidencia.
- **`api.claimed_dimension()`**: sus dos ramas de **deuda** añaden
  `and sec.is_member(e.scope_id)`; la económica no cambia. Es la superficie de
  atribución de Personal y hoy publica la deuda excluida (E23). Precisión de
  F03/ADR-013 §1.
- **`api.personal_balance` no cambia**: el Disponible es la caja del ámbito
  personal (F06/ADR-005), y ni salir ni «Saldado» mueven caja.

### 4. «Saldado»: una operación de la clase `participant_settlement`, y un estado explícito

**La liquidación sin caja existente no basta**, y se ha comprobado por qué:
`record_debt_settlement` resuelve **un par** por operación, exige presencia
abierta en la fecha, y no puede retirar a nadie ni resolver «cero pendiente».
«Saldado» necesita todos los pares a la vez, atómicos, contra cantidades
revisadas, y un estado que retire. **Comando mínimo: `api.settle_participant(payload)`**,
dueña `nomey_writer` (F03/ADR-006), en una transacción:

| Paso                    | Mecanismo                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forma del payload       | `client_operation_id`, `scope_id`, `participant_id`, `expected_pairs: [{debtor_participant_id, creditor_participant_id, amount}]` — exactamente lo que la confirmación enseñó                                                                                                        |
| Idempotencia            | Reclamar la clave en `core.client_command`, `command_type = 'participant_settlement'` (F03/ADR-007, F03/ADR-008 §13). Reintento → `replay`, sin segunda resolución                                                                                                                   |
| Autorización            | `sec.assert_member(scope, actor)`: un miembro actual, cualquiera (F09/ADR-001 §2)                                                                                                                                                                                                    |
| Estado del participante | pertenece al ámbito; **inactivo** (`PARTICIPANT_ACTIVE · 422` si tiene periodo abierto: a un activo se le liquida por las vías normales); **no retirado** (`PARTICIPANT_RETIRED · 409`)                                                                                              |
| Bloqueo                 | `sec.lock_scopes([scope])` **antes** de leer la deuda (F03/ADR-010 §11), el mismo orden global que las siete funciones                                                                                                                                                               |
| Pares pendientes        | Para cada otro participante `q`: `sec.pending_debt(scope, p, q)` y `sec.pending_debt(scope, q, p)`; los `> 0` son los pares. `pending_debt` ya netea el par en las dos direcciones                                                                                                   |
| Cantidades revisadas    | El conjunto calculado bajo bloqueo debe ser **igual** a `expected_pairs` (mismos pares, mismos importes). Si no, `SETTLEMENT_STALE · 409` y no se escribe nada: el cliente relee y vuelve a enseñar                                                                                  |
| Con pares               | `sec.persist_version(actor, op, ver, 1, null, 'participant_settlement', current_date, suma de importes, moneda)` y **un efecto de deuda por par**: `(accounting_class 'settlement', debt_amount = −importe, debtor, creditor)` — la misma forma que escribe `record_debt_settlement` |
| Sin pares               | **Ninguna operación.** Cero pendiente no es una liquidación de importe cero: no hay hecho monetario que registrar                                                                                                                                                                    |
| Retiro                  | `core.participant_retirement (participant_id pk, scope_id, operation_id nullable, retired_by, retired_at, client_command_id)`; insert-only, sin `update` ni `delete` para nadie                                                                                                      |
| Aviso                   | Una fila por miembro que permanece, `kind = 'settlement'`, con el participante y la operación (§7)                                                                                                                                                                                   |
| Caja y gasto económico  | **Ninguno.** Sólo dimensión de deuda. Guardia de catálogo: los efectos de la clase tienen `balance_amount` y `economic_amount` nulos                                                                                                                                                 |

**Suma de posiciones exactamente cero.** Cada gasto deja efectos de deuda que
suman cero por construcción (acreedor +, deudores −), y cada efecto de
resolución cancela un par —`−importe` sobre el mismo `(deudor, acreedor)`—, así
que la suma sigue en cero. Con `SETTLEMENT_EXCEEDS_DEBT` reutilizado por par
—el importe nunca supera el pendiente bajo bloqueo— ningún par queda negativo.
La comprobación lo mide, no lo asume.

**Qué ve cada persona**: nada nuevo en el Personal de quien salió (§3: sin
caja, sin economía, y la deuda excluida por membresía); en el grupo, los pares
con él desaparecen y las posiciones de los demás cambian exactamente en esos
importes; en Inicio, Deudas de cada miembro cambia por la misma vía que
siempre (`group_summary`). No hay ninguna operación en ningún Modo Personal.

### 5. Una sola regla temporal, la vigente, y el día de salida excluido

> Un participante puede figurar en un gasto con fecha efectiva `d` si y sólo si
> tiene un periodo con `valid_from <= d < valid_until` (o `valid_until` nulo).
> F03/ADR-009 §5 y §7; `sec.assert_participant_eligible`, sin cambios.

`leave_group` escribe `valid_until = current_date`. Con salida el 2026-09-10:

| Gasto nuevo con fecha efectiva | Servidor                   | Cliente (`date < eligible_until`)        |
| ------------------------------ | -------------------------- | ---------------------------------------- |
| 2026-09-09                     | elegible                   | seleccionable; **nunca** preseleccionado |
| 2026-09-10 (el día de salida)  | `PARTICIPANT_NOT_ELIGIBLE` | no se ofrece                             |
| 2026-09-11                     | `PARTICIPANT_NOT_ELIGIBLE` | no se ofrece                             |
| Corregir uno del 2026-09-07    | permitido (fecha original) | permitido                                |
| Corregirlo moviéndolo al 09-10 | `PARTICIPANT_NOT_ELIGIBLE` | no se ofrece                             |

E23 mide exactamente estas filas. **Limitación reconocida:** la granularidad es
el día, así que la comida del día de salida **anterior** a salir tampoco puede
incluirle; ese gasto se registra sin él o los miembros lo resuelven fuera. No
se amplía el contrato temporal a horas. Los gastos ya registrados no se tocan
al salir; corregirlos sigue evaluando su fecha efectiva original, y una
corrección que lo saque de su periodo se refusa sin borrar nada.

### 6. Barreras sobre las escrituras posteriores, para que la regla no se pueda eludir

| Escritura                                                 | Con un participante **inactivo**                                                  | Con un participante **retirado**                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_group_expense`, alta fechada dentro de su periodo | permitido (contrato temporal)                                                     | **`PARTICIPANT_RETIRED · 422`**: crearía deuda nueva sobre un pendiente declarado resuelto                                                                    |
| `record_group_expense`, corrección de uno suyo            | permitido si su fecha original sigue dentro                                       | permitido **sólo si no altera ningún efecto de deuda suyo**; si la nueva versión o la vigente lo nombran en deuda con importe distinto, `PARTICIPANT_RETIRED` |
| `annul_operation` de un gasto suyo                        | permitido                                                                         | `PARTICIPANT_RETIRED` si la versión vigente lo nombra en deuda                                                                                                |
| `record_debt_settlement`                                  | **`PARTICIPANT_INACTIVE · 422`** (nueva regla: ambos activos ahora, además de §7) | `PARTICIPANT_INACTIVE`                                                                                                                                        |
| `record_settlement_by_transfer`                           | **`PARTICIPANT_INACTIVE · 422`**, sea cual sea la fecha                           | `PARTICIPANT_INACTIVE`                                                                                                                                        |
| `settle_participant`                                      | es su vía                                                                         | `PARTICIPANT_RETIRED · 409`                                                                                                                                   |
| `update_group_profile`, añadir participantes              | sin cambio                                                                        | sin cambio (un nombre repetido crea un duplicado; §8.d)                                                                                                       |

La fila de `record_settlement_by_transfer` es la que cierra la elusión que E23
hizo visible: hoy una liquidación por transferencia **retro-fechada** pasaría
la elegibilidad y escribiría caja en el Modo Personal de quien salió. **Ambos
extremos deben estar activos ahora**, independientemente de la fecha. Es una
restricción **adicional** a F03/ADR-009 §7, no un reemplazo: la fecha se sigue
comprobando.

**Corrección de un gasto de un retirado, precisado.** Cambiar concepto,
categoría u hora: permitido. Cambiar el importe, el reparto, el pagador o la
fecha de modo que algún efecto de deuda que lo nombre cambie: refusado. La
razón es la política: sus pendientes se declararon resueltos, y reabrirlos
en silencio con una corrección los reactivaría en el registro del grupo. Si
los miembros necesitan corregir de verdad ese gasto, es una decisión que este
ADR no toma (§8.c).

### 7. Avisos: de la membresía, y en una sola relación

Cuatro clases de aviso ya no caben en una tabla por clase. Se propone **una**
relación `core.group_notice (id, recipient_user_id, scope_id, kind, actor_user_id,
subject_id, occurred_at, read_at)` con `kind in ('edit','profile','departure','settlement')`
y `subject_id` apuntando a la versión, el cambio de perfil, la salida o la
operación de resolución según la clase, publicada por `api.group_notice`.
Las dos tablas existentes se **reemplazan** por ella —no hay producción ni
datos que migrar— y sus dos vistas desaparecen.

Política de lectura y de marcado como leído: `sec.is_me(recipient_user_id)`
**y** `sec.is_member(scope_id)`. Sin membresía no hay aviso que abra un grupo
que ya no se puede leer; las filas no se borran.

> Hallazgo de E23: hoy las dos vistas de avisos **no se pueden leer como
> `authenticated`** —`permission denied for function request_actor_id`—, porque
> sus políticas llaman a `sec.request_actor_id()` en vez de a `sec.is_me()`.
> La consolidación lo corrige de paso, y la sección I de
> `group-expense-flow.sql`, que nunca pasó, queda como su prueba.

### 8. Lo que conserva quien sale, y la frontera que lo publica

| Qué                                                  | Cómo se sostiene                                                            | Medido |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| Caja: sus gastos de grupo pagados, en Personal       | El efecto de saldo está en su ámbito personal                               | E23    |
| Su parte económica y sus categorías, en estadísticas | `sec.my_shared_expense_shares`, definer por vínculo                         | E23    |
| Concepto y categoría de cada versión                 | `api.personal_operation_version` lee la versión, no el grupo                | E23    |
| Nombre del grupo y «tu parte» en la fila             | **Nuevo definer reducido `sec.my_group_expense_context()`**, sin parámetros | —      |

El definer devuelve, para el actor, una fila por operación `group_expense`
cuya **versión vigente** deja saldo en un ámbito personal suyo (pagó) o tiene
un efecto económico de un participante vinculado a él (figura en el reparto).
Devuelve **exactamente** `operation_id` · `group_scope_id` · `group_display_name`
· `your_share`. Sin parámetro no hay UUID que sondear. Casos que las pruebas
demuestran: mía antes y después de salir (misma fila); ajena (nada); versión
ajena o antigua (inalcanzable: sólo la vigente, sólo por operación);
corrección posterior a mi salida (la fila sigue la versión vigente); nombre y
categoría del historial (de la versión, E23).

**Lo que NO conserva:** lectura del grupo, corregir, anular, liquidar, avisos.
**Lo que NUNCA recibe después:** caja, transferencia, ingreso, gasto o deuda
por lo que los miembros hagan con su pendiente (§3, §4, §6).

### 9. Un grupo sin miembros activos es un hecho derivado

`activo ⇔ existe alguna fila en core.membership para el ámbito`. Sin estado
escrito (F03/ADR-010). Desaparece de las listas porque nadie pasa `sec.is_member`;
los participantes sin cuenta no lo impiden; todo se conserva (ninguna FK de
`core` tiene `on delete cascade`, comprobado); no se puede reabrir por esta
vía.

## Ejemplos

Grupo «Viaje»: Edu, Ana, Luis con cuenta; Marta sin cuenta. Edu paga 1000 entre
los cuatro (E1); Luis paga 900 entre Edu, Ana y Luis (E2). Posiciones: Edu
+450, Ana −550, Luis +350, Marta −250.

**Ana sale debiendo.** El 10 de septiembre Ana pulsa «Salir». Su membresía
desaparece, su periodo termina el 10 (excluido), queda la salida a las 15:02 y
Edu y Luis reciben «Ana ha salido». Ana: Deudas de Inicio deja de contar
−550; E1 y E2 no están en su Personal (no pagó ninguno), pero sus cuotas —250 y
300— siguen en sus estadísticas de septiembre con su categoría. Edu y Luis:
Saldos sigue diciendo Ana −550, con «Inactivo»; una cena del día 11 no puede
incluirla; una del día 9, sí, si alguien la elige a mano.

**Luis sale cobrando.** Luis pulsa «Salir» el mismo día. Luis: Deudas deja de
contar +350; E2 sigue en su Personal como «Viaje · pagaste 900 · tu parte 300»,
y su Disponible sigue con los −900. Edu: Saldos sigue diciendo Luis +350,
«Inactivo».

**Edu pulsa «Saldado» sobre Ana.** La confirmación enseña los pares: Ana → Edu
250, Ana → Luis 300, y avisa de que Ana se retirará de la lista sin registrar
nada en ningún Personal. Al confirmar: una operación `participant_settlement`
con dos efectos de deuda (−250 Ana→Edu, −300 Ana→Luis); Ana retirada. Edu pasa
de +450 a **+200**; Luis de +350 a **+50**; Ana **0** y fuera de Saldos y de
participantes, con su nombre intacto en E1 y E2; Marta −250. Suma: 0. Ana no
recibe nada: ni aviso, ni caja, ni deuda. Edu y Luis reciben «Edu dio por
saldado a Ana».

**Edu pulsa «Saldado» sobre Luis.** Pares: Edu → Luis 50 (250 de E1 contra 300
de E2, neteados por par), Ana → Luis 300 — pero si Ana ya fue retirada, ese
par ya vale 0 y no aparece. Con Ana retirada antes: un solo par, Edu → Luis 50.
Edu pasa de +200 a **+250**; Luis **0**, retirado; Marta −250. Suma: 0. En el
Personal de Luis no cambia nada: ni fila, ni Disponible.

**Alguien sin pendientes.** Si Luis hubiera salido en paz —posición 0—,
«Saldado» lo retira igual: fila en `participant_retirement` sin operación.

## Alternativas consideradas

**Resolver «Saldado» con N llamadas a `record_debt_settlement`.** Descartada: no
es atómico, cada llamada exige presencia abierta, ninguna retira, y «cero
pendiente» no tiene representación.

**Una liquidación de importe cero para retirar.** Descartada: no hay hecho
monetario; el retiro es un estado, y va en su relación.

**Retirar borrando el participante, el vínculo o los efectos.** Descartada
expresamente: rompe historial, atribución (F03/ADR-013) y los invariantes de
F06/ADR-006.

**Permitir `settlement_by_transfer` con un inactivo si la fecha está dentro
del periodo.** Descartada: E23 muestra que movería caja en el Personal de
quien salió; la política lo prohíbe.

**Guardar el retiro como columna en `core.participant`.** Descartada:
`participant` es identidad (F03/ADR-009 §1); el retiro es un hecho fechado con
actor y operación, y va aparte.

**Mantener una tabla de aviso por clase.** Descartada al llegar a cuatro; ver
§7.

**Exigir liquidar antes de salir; condonar al salir; borrar el vínculo; acceso
residual; `left_at` en `membership`; reutilizar `membership.created_at`;
definer con `version_id`; conservar avisos antiguos degradando el enlace.**
Todas descartadas, por las razones de la segunda redacción, que siguen en pie.

## Consecuencias

### A favor

- Ni salir ni «Saldado» tocan caja ni economía: la contabilidad de Personal
  de quien se fue queda cerrada de verdad, con barrera en servidor.
- La deuda sale de Personal por una regla explícita en las dos superficies.
- «Saldado» es una operación con las siete garantías del writer: clave,
  autorización, bloqueo, CAS de cantidades, forma de efecto conocida,
  historial y aviso.
- El retiro es un estado explícito que no borra nada y que las correcciones
  respetan.

### En contra

- **Quien se fue no se entera de nada** posterior. Deliberado.
- **La comida del día de salida anterior a salir queda fuera.** Deliberado y
  reconocido; el contrato es diario.
- **No hay liquidación parcial de un inactivo**: «Saldado» es todo o nada; un
  pago parcial real de quien se fue no tiene dónde registrarse (§10.a).
- **Corregir un gasto de un retirado que toque su deuda está cerrado** (§6),
  y reabrirlo es una decisión que no está tomada (§10.c).
- **Consolidar los avisos reemplaza dos tablas** recién creadas. Sin datos que
  migrar, el coste es una migración más.

### Invariantes que quedan en la frontera, con guardia

- `leave_group` no escribe efectos ni operaciones; no borra ni actualiza
  `core.participant_user_link`.
- `settle_participant`: efectos sólo con dimensión de deuda; ninguno de saldo
  ni económico; suma de posiciones del ámbito cero antes y después; ningún
  par negativo; sin operación cuando no hay pares.
- `core.participant_retirement` sin `update` ni `delete` para ningún rol.
- Las dos clases de liquidación exigen periodo **abierto** en ambos extremos.
- `record_group_expense` y `annul_operation` refusan alterar efectos de deuda
  de un retirado.
- `sec.my_group_expense_context()` sin parámetros, cuatro columnas exactas.
- `api.group_notice` y su política pasan por `sec.is_me` **y** `sec.is_member`.
- Las dos ramas de deuda de `api.claimed_dimension()` contienen
  `sec.is_member(e.scope_id)`; la económica no.

## 10. Decisiones materiales que aún faltan

- **(a) Pago parcial de un inactivo.** Hoy no tiene vía: `record_debt_settlement`
  exigirá activos y «Saldado» es total. Recomendación: no abrirla ahora;
  si hiciera falta, sería una liquidación sin caja con ambos extremos
  identificados y el inactivo permitido, decidida aparte.
- **(b) Deshacer un «Saldado».** El retiro es insert-only. Recomendación: no
  se deshace; si se corrigió por error, el registro conserva la operación
  de resolución y su autor, y F10 decidirá si la reincorporación reabre algo.
- **(c) Corregir un gasto de un retirado tocando su deuda.** Cerrado en §6.
  Recomendación: mantenerlo cerrado; la alternativa —reabrir su pendiente y
  devolverlo a Saldos— contradice lo que los miembros declararon.
- **(d) Nombre repetido al añadir participantes.** Se desaconseja en pantalla
  mostrando al inactivo; no se impide. Fusión en F10.
- **(e) Reincorporación.** F10, por enlace de invitación.

Lo que **no** está abierto: salir con deuda, sin liquidar y sin aprobación;
día de salida excluido; ningún movimiento personal posterior para quien
salió; «Saldado» como declaración de los miembros, total, sin caja.

## Fuera de alcance

| Tema                                      | Destino                 |
| ----------------------------------------- | ----------------------- |
| Reincorporación, unión por enlace, fusión | F10                     |
| Pago parcial de un inactivo               | decisión aparte (§10.a) |
| Pantalla de notificaciones (la campana)   | paso posterior de F9    |
