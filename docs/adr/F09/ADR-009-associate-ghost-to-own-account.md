# F09/ADR-009 — Asociar un participante sin cuenta a la propia cuenta (fusión de identidades contextuales)

- **Estado:** Aceptado (2026-09-14). Decisión de producto tomada (el creador
  añadió fantasmas; quien entró con «Soy nuevo» puede pulsar después sobre su
  fantasma y «Asociar a mi cuenta»; **se incorpora el historial económico
  completo del fantasma, caja incluida**; **se muestra el nombre actual de la
  cuenta en todas las superficies, histórico incluido**). Implementado en la
  migración `20260914130000`, aplicada a la base local de desarrollo con
  `migration up --local` (43 registradas = 43 ficheros), y en el cliente;
  demostrado en aislamiento y con dos sesiones reales; **sin validar en
  dispositivo**.
- **Fecha:** 2026-09-14
- **Identificador anterior:** ADR-040 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Toma de F10** el caso mínimo de «fusión participante-a-participante»
  (AGENTS.md §5, delegado a F10) y lo acota: una cuenta que **ya** es miembro
  y ya tiene identidad en el grupo asume un participante **sin cuenta**. No
  decide el resto de F10 (revocación por otro, fusiones entre cuentas,
  identidad anónima).
- **Respeta** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (identidad contextual
  y estable; los efectos nombran participantes, nunca cuentas),
  [F09/ADR-004](../F09/ADR-004-group-invitations.md) (un vínculo por cuenta y ámbito;
  reclamar = vincular con prueba), [F09/ADR-006](../F09/ADR-006-unclaim-participant.md),
  [F03/ADR-008](../F03/ADR-008-operation-version-model.md) (versiones inmutables) y
  [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md).

## Contexto: lo que hay, medido

- `core.participant_user_link` tiene **una fila por participante** (PK) y
  **una por (ámbito, cuenta)** (`participant_user_link_usuario_unico_por_ambito`).
  Una cuenta no puede vincularse a dos participantes del mismo grupo: la
  «asociación» no puede ser un segundo vínculo.
- `redeem_invitation` con `choice = 'claim'` vincula una cuenta **recién
  llegada** a un participante sin vínculo y le da membresía; exige la
  invitación como prueba (F09/ADR-004). Con la cuenta ya dentro no aplica: no hay
  membresía que dar ni identidad libre que tomar.
- Los hechos —`core.split_participant`, `core.effect`, `core.payment_detail`,
  `core.payment_allocation`— nombran al participante por su identificador
  estable. Reescribirlos es reescribir versiones (F03/ADR-008): descartado.
- En la base manual: «Prueba 2» tiene fantasmas («Ana», «Luis», «Juan»
  retirado) y dos cuentas que entraron como nuevas.

## Decisión propuesta: fusión de LECTURA, no de hechos

**«Asociar a mi cuenta» fusiona dos identidades contextuales del mismo
grupo —la mía (`destino`, vinculada) y el fantasma (`origen`, sin
vínculo)— registrando un hecho nuevo, sin tocar ninguna operación:**

```
core.participant_merge (
  source_participant_id  uuid pk   -- el fantasma
  target_participant_id  uuid      -- mi identidad en el grupo
  scope_id               uuid      -- el mismo para los dos (FK compuestas)
  merged_by              uuid      -- la cuenta que lo hizo (= la del destino)
  merge_command_id       uuid      -- la clave del comando (provisioning_command)
  merged_at              timestamptz
)
```

y una resolución **`sec.canonical_participant(id)`** (= destino si `id` es un
origen fusionado; si no, `id`), de un solo salto: un origen no puede ser
destino de otra fusión ni un destino ser origen después.

**Lo que NO cambia:** los repartos, los efectos, los pagos y sus detalles
siguen nombrando al participante que constaba. Procedencia y autoría intactas:
quién registró cada operación, y con qué identidad figuraba, se conserva.

**Lo que cambia, en las lecturas y las guardas que agregan por persona:**

| Superficie                                                                                                                                   | Tratamiento                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.group_participant`                                                                                                                      | el origen deja de listarse (`is_merged`); el nombre mostrado es el del **destino**; sigue resoluble en histórico (repartos) con su nombre                                                       |
| `api.group_balance`, `sec.pending_pairs`, `group_pending_pair`                                                                               | agregan por `canonical_participant`: **un solo neto** y **un solo par** por persona; el par entre origen y destino se anula (deuda con uno mismo)                                               |
| Pagos sugeridos                                                                                                                              | una identidad: sin propuestas «conmigo mismo», sin duplicados                                                                                                                                   |
| `sec.decompose_payment`, `record_group_payment`                                                                                              | trabajan sobre pares canónicos; los efectos nuevos se escriben con el **destino**                                                                                                               |
| guardas de sobreliquidación, salido y retirado                                                                                               | comparan pendientes **canónicos**; F09/ADR-008 no se relaja (la fusión no reabre ni reescribe gastos protegidos)                                                                                |
| `api.leave_group`                                                                                                                            | cero pares **canónicos**: el origen no puede dejarme bloqueado por un par que ya es mío                                                                                                         |
| Personal: `claimed_dimension`, `personal_statistics`, `personal_expense_share`, `personal_operation`, `my_group_payment`, `my_reopened_debt` | «mío» = mi vínculo **y** los orígenes fusionados en mi destino: cuotas, deudas y pagos del fantasma me llegan por lectura, **sin escribir nada**                                                |
| Elegibilidad                                                                                                                                 | el origen no se puede elegir en altas nuevas (`PARTICIPANT_MERGED`); en correcciones, «quien ya constaba» sigue valiendo (`participant_kept_in_version`); ningún periodo se inventa ni se mueve |

**Cuotas donde figuraban los dos.** Un gasto repartido entre «Aitor» (nuevo)
y «Aitor» (fantasma) registró **dos cuotas**; tras la fusión el mismo
consumo se lee como dos cuotas de una persona. No es un error contable: es lo
que se declaró. Si no era lo querido, se corrige el gasto entre activos como
cualquier otro.

**Deudas entre las dos identidades.** Un par origen ↔ destino es una deuda con
uno mismo: la lectura canónica lo elimina (sumaría a ambos lados de la misma
persona). Las liquidaciones que lo tocaron quedan en el historial.

**Pagos.** Vigentes y anulados con el origen como parte pasan a ser míos por
lectura (`payment_detail` conserva el id del origen; la autorización para
anular pasa por `canonical_participant`): puedo anularlos, con las reglas de
siempre.

**Autorización, concurrencia, idempotencia.** Función del provisioner
`api.associate_participant(payload)`: `client_command_id` (idempotente por
`core.provisioning_command`, tipo `group.associate`), rango 1
(`sec.lock_participant_claims`), actor miembro con vínculo en el grupo
(destino = su participante), origen del mismo grupo **sin vínculo, no
retirado, no fusionado, no salido**; si dos cuentas lo intentan a la vez, la
segunda ve el hecho bajo el cerrojo (`PARTICIPANT_LINKED`/`PARTICIPANT_MERGED`).
No hay prueba de invitación: la prueba de identidad es la que ya dio la
membresía (F09/ADR-004) y la autoría del hecho queda registrada; **no se usa el
nombre como prueba de nada**. Irreversible en este bloque (como retirar);
`unclaim` (F09/ADR-006) de un destino con fusión se rehúsa (`UNCLAIM_BLOCKED_MERGE`).

**Confirmación:** «¿Asociar a «Ana» a tu cuenta? Asumirás su historial en
Prueba 2: sus gastos, sus pendientes y sus pagos pasarán a ser tuyos, junto
con lo que ya tienes como «Aitor». No se puede deshacer.»

## La incorporación del historial económico (decidida 2026-09-14)

Tres hechos distintos, tres tratamientos (AGENTS.md §2):

| Hecho               | Qué es                                                        | Cómo llega a mi Personal                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cuota económica** | lo que al fantasma le correspondía gastar (10 € + 5 €)        | **por lectura**: `sec.is_my_participant` resuelve por `canonical_participant`, así que `personal_statistics`, `personal_expense_share` y `claimed_dimension` cuentan sus cuotas como mías, con la fecha y la procedencia del gasto original. Nada se escribe. Los 15 € aparecen como gasto mío; **no** como salida de caja.                                                                             |
| **Caja**            | lo que el fantasma pagó (pagó un gasto) o recibió/pagó (pago) | **por escritura, una vez, atómica con la asociación**: en la **versión vigente** de cada operación en la que el fantasma pagó un gasto (`split.payer`) o fue parte de un pago (`payment_detail`) se **completan** los efectos `transfer` que faltaban en mi Personal (−total del gasto; ∓importe del pago). Misma operación, misma versión, misma fecha, misma autoría: la procedencia es la del hecho. |
| **Deuda**           | lo que sigue pendiente                                        | **por lectura**: los pares se agregan por `canonical_participant`; los pares fantasma↔yo se anulan (deuda con uno mismo).                                                                                                                                                                                                                                                                               |

**Por qué se completan las versiones vigentes y no se crea una operación de
«incorporación».** La caja del pagador de un gasto la deriva el writer del
vínculo (`participant_personal_scope`), al escribir; el fantasma no tenía
vínculo y el efecto simplemente no existió. Completar la versión con el efecto
que le faltaba —y sólo ese— es lo que hace que **todo lo demás funcione sin
cascadas**: una corrección posterior escribe su versión nueva y el writer, que
ya resuelve `participant_personal_scope` por canónico, deriva la caja; una
anulación deja la versión sin efectos, y la caja incorporada desaparece con
ella (**reversión exacta**); `personal_operation` lista el gasto o el pago
con su fecha real, como hoy con quien pagó estando vinculado. Precisa F03/ADR-008:
los **importes, participantes y clases** de una versión son inmutables; sus
efectos de caja se **completan** —nunca se cambian— para un ámbito que no
existía al escribirla. Cada versión completada se observa (F06/ADR-005,
`sec.observe_balances`) bajo los cerrojos de rango 2 del Personal y del grupo.

**Sin duplicidades.** (1) Un gasto que pagó mi identidad «Soy nuevo» ya tiene
su caja: no se toca. (2) Un gasto donde figurábamos los dos tiene dos cuotas y
las dos son mías por lectura: es lo declarado, no un duplicado. (3) Un pago
entre mi identidad y el fantasma: mi caja ya tenía −X (o +X); se completa la
del fantasma (+X o −X) y el par se anula: el dinero fue de mí a mí. (4) La
incorporación es idempotente por construcción: sólo se inserta el efecto
`transfer` si esa versión no lo tiene ya para mi Personal; la asociación
entera es idempotente por `provisioning_command` (`group.associate`). (5) Las
versiones anuladas no se completan (no tienen efectos vigentes).

**Revertir.** No hay «desasociar» en este bloque. La caja incorporada se
revierte exactamente con las mismas puertas que cualquier caja: anular la
operación o corregirla.

## Cómo está hecho en el borrador `20260914130000`, y lo demostrado

**La resolución canónica vive en `core.current_effect`**, la única relación
que lee `core.effect` (F03/ADR-010 §9): la proyección publica
`economic_participant_id`, `debt_debtor_participant_id` y
`debt_creditor_participant_id` ya resueltos por `core.participant_merge`
(tres `left join` por clave primaria), con la misma lista de columnas. Así
**todo lo que agrega por persona** —`sec.pending_pairs`, `api.group_balance`,
`group_pending_pair`, `decompose_payment`, los netos de
`record_group_payment`, `net_debt`/`settled_between` y las guardas de
sobreliquidación, `claimed_dimension`, `my_shared_expense_shares`,
`my_group_expense_context`, `personal_statistics`— atraviesa la fusión sin
cambiar, y la guarda de catálogo prevista («ninguna agregación sin
canónico») deja de hacer falta. Los ids persistidos no cambian:
`core.effect`, `split_participant`, `payment_detail` y
`payment_allocation` siguen diciendo quién figuraba; F09/ADR-008
(`departed_effects_of_version`) y `participant_kept_in_version` leen esos
ids crudos, que es lo correcto para procedencia y elegibilidad.

Lo que sí se recrea, con el cambio mínimo sobre el cuerpo vivo:
`sec.participant_personal_scope` (la caja de correcciones futuras se deriva
del destino), `assert_participant_eligible` y `assert_participant_active`
(`PARTICIPANT_MERGED` en altas nuevas; quien ya constaba sigue valiendo),
`participant_available` (un origen no se reclama ni se retira),
`assert_correction_leaves_no_oversettled_debt` (los pares nuevos, por
canónico), `my_reopened_debt`, `reopened_pair_cap`,
`my_group_payment_context`, `payment_counterpart_name` y la autorización
de anular un pago en `annul_operation` (partes por canónico),
`unclaim_participant` (`UNCLAIM_BLOCKED_MERGE`), `api.group_participant`
(columna `merged_into_participant_id`, al final) y `api.group_balance` (sin
fila de origen).

**La caja histórica** la escribe `sec.incorporate_participant_cash`
(definer de `nomey_writer`, invocable por el provisioner desde
`api.associate_participant`, rango 2 del grupo y del Personal): completa la
versión vigente de cada operación del grupo donde el origen fue
`split.payer` (`expense`, −total) o parte de `payment_detail` (`transfer`,
∓importe), sólo si ese Personal no tiene ya ese efecto en esa versión, y
observa la versión (F06/ADR-005) si el Personal aún no tenía observación de ella.
La segunda barrera (E16) es una policy nueva de inserción para el writer en
`core.effect`: sólo caja, sólo en el Personal del actor, sólo en una versión
vigente, y sólo si un origen fusionado **por ese actor** pagó ese gasto o fue
parte de ese pago. Códigos nuevos: `PARTICIPANT_LINKED`,
`PARTICIPANT_MERGED`, `PARTICIPANT_RETIRED` (409, del comando),
`PARTICIPANT_MERGED` (422, del writer), `UNCLAIM_BLOCKED_MERGE`,
`PERSONAL_SCOPE_MISSING`.

**Lo demostrado (2026-09-14, pila aislada desde cero con las 41 migraciones
más los borradores `20260914120000` y `20260914130000`; nada aplicado a la
base local):** `supabase/checks/associate-participant.sql` (A–D) y
`scripts/associate-race-evidence.sh` (cuatro carreras con dos sesiones
reales, `NOMEY_DB_CONTAINER=supabase_db_NomeyIso`).

- **Dos identidades con actividad** («Aitor», vinculado; «Aitor F», fantasma):
  gastos con las dos, deuda entre ellas, un pago vigente al fantasma, uno
  anulado y uno **entre las dos identidades**. Tras asociar: pares
  `Aitor>Edu:200 Ana>Aitor:300 Luis>Edu:100` (un solo Aitor; el par
  F↔Aitor desaparece; `Aitor F>Edu` y `Aitor>Edu` se suman), netos
  conservados (F 100 + Aitor 0 = Aitor 100; la suma sigue en cero), caja
  incorporada **una vez** en cuatro versiones (−900 y −200 de los gastos que
  pagó F, +300 del pago recibido, +100 del otro lado del pago conmigo mismo;
  el anulado, no; lo que ya tenía caja, intacto): Personal
  `caja=−1000 gasto=900 deuda=100`, con las cuotas de F contadas por
  lectura. El origen aparece con `merged_into_participant_id` y sin fila en
  Saldos, para todos. Replay (doble pulsación) sin nada nuevo; segunda clave y
  otra cuenta, `PARTICIPANT_MERGED`; vinculado, retirado, uno mismo, sin
  identidad: rehusados sin escribir.
- **Después:** un alta nueva que nombra al origen se rehúsa; una corrección
  que lo conserva se permite; corregir el gasto que pagó el fantasma escribe
  su caja nueva **en mi Personal** (−300 sustituye a −200); anularlo (sólo yo,
  que tengo su caja) la retira exactamente; anular el pago que recibió y el
  pago conmigo mismo, igual: la caja incorporada se revierte por las mismas
  puertas y sin residuo.
- **Con la novación de salida:** Edu sale a cero dejando `Aitor>Luis:300`
  (Luis sin cuenta); Ana asocia a Luis: `Aitor>Ana:300`, netos conservados,
  caja del gasto que pagó Luis una vez; la novación sigue sin poder anularse;
  Aitor paga y Ana sale sin pares.
- **Carreras:** dos cuentas sobre el mismo fantasma (la segunda espera al
  cerrojo y ve `PARTICIPANT_MERGED`; una fusión; la caja en un solo
  Personal); doble pulsación con la misma clave (la segunda espera y responde
  `already_processed`; un efecto); asociar frente a un gasto que nombra al
  fantasma, en los dos órdenes (serializados: `PARTICIPANT_MERGED` después, o
  las dos versiones incorporadas si el gasto entró antes).

**Un hallazgo posterior, medido en el iPhone y corregido
(`20260914160000_positions_cas_visible_participants.sql`):** al quitar la
fila del origen de `api.group_balance` este ADR dejó la foto de netos que el
cliente manda al pagar (`expected_positions`, F09/ADR-007 C2: «los netos de
`api.group_balance` tal como se enseñaron») sin el origen, pero
`sec.group_positions_text` —lo que `record_group_payment` compara bajo
cerrojo— seguía listando **todos** los `core.participant` del ámbito, con el
origen a `:0`; en un grupo con una asociación ningún «Saldado» podía dejar de
caducar (`SETTLEMENT_STALE` en cinco intentos, nada escrito). El mismo
desajuste existía desde 20260911120000 para los **retirados**, que la vista
tampoco lista, y el check de pagos no lo vio porque su ayuda reproducía el
texto del servidor en vez de leer la vista. Ahora el texto se calcula sobre el
mismo conjunto que publica la vista y la ayuda manda las filas reales de
`api.group_balance`; el contrato de F09/ADR-007 no cambia.

## El nombre (decidido 2026-09-14)

**Tras asociar, se muestra el nombre actual de la cuenta en todas las
superficies, histórico incluido:** «Aitorrr» asociado a «Aitor» se lee «Aitor»
en participantes, repartos, gastos, pagos, saldos y propuestas. Los ids
originales y la trazabilidad se conservan (los hechos siguen nombrando al
origen por su id; `core.participant_merge` es el hecho de la fusión), y
**«Declarado por» no cambia**: sigue identificando a la cuenta que registró la
operación (`sec.is_me(ov.created_by)`), que no es un participante.

Cómo se hace: las vistas del grupo publican ids, no nombres (`payer_participant_id`,
`participant_id` del reparto, partes del pago), y el cliente los resuelve con
el mapa de nombres de `api.group_participant`, que para un origen fusionado
(`merged_into_participant_id`) devuelve el nombre del destino. En el Personal,
la contraparte de un pago la publica el servidor ya por canónico
(`sec.my_group_payment_context`, `sec.payment_counterpart_name`). El origen
no se lista ni se ofrece en selecciones nuevas (`listed`); en la corrección de
un gasto que lo nombraba, su cuota se conserva (`participant_kept_in_version`)
sin fila propia, como hoy con un retirado. Un gasto donde figuraban las dos
identidades enseña «tu parte» como la suma (`api.group_operation.your_share`).

## Alternativas consideradas

- **Mover el vínculo al fantasma** y dejar «Soy nuevo» como fantasma:
  conserva una identidad pero pierde como propia la actividad hecha desde
  que entré. Descartado por la decisión.
- **Reescribir repartos y efectos** cambiando el id del fantasma por el mío:
  viola F03/ADR-008/ADR-013 y borra la procedencia. Descartado.
- **Dos vínculos por cuenta** en el mismo grupo: rompe F09/ADR-004 (una identidad
  por ámbito) y deja dos filas en saldos y propuestas. Descartado.

## Consecuencias

- Una relación nueva y una resolución canónica que **todas** las lecturas y
  guardas por persona tienen que atravesar: es el coste de no reescribir
  hechos. Se verifica con una guarda de catálogo (ninguna agregación por
  participante sin `canonical_participant`) y con evidencia aislada.
- F11 (multidivisa) toca lecturas compartidas (`claimed_dimension`,
  `personal_operation`): coordinar la recreación desde el cuerpo vivo.
- F10 hereda el hecho: reclamar con invitación y asociar siendo ya miembro
  son dos puertas al mismo vínculo/fusión; la identidad anónima autenticada,
  si llega, usa las mismas relaciones.
