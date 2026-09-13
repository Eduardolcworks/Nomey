# F09/ADR-007 — Pagos registrados en el grupo, su anulación, y salir sin pendientes

- **Estado:** Aceptado (2026-09-12, v3). Política de producto aceptada
  (autoría, anulación tras salir, **sin edición**, salida sin pendientes, UI)
  e **implementada**: migración `20260912170000_group_payments_and_departed.sql`
  (con F09/ADR-008), cliente (Pagos sugeridos «Los míos»/«Todos» con «Saldado»,
  fila de pago en el grupo con «Eliminar pago», fila de pago en Personal con
  contraparte, salida bloqueada → grupo, sin «Saldado» sobre inactivos) y
  evidencia **contra las funciones reales** —sin simulaciones— en local y
  desde cero en un stack aislado, con las carreras en CI.
- **Fecha:** 2026-09-12
- **Identificador anterior:** ADR-038 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Sustituye** de [F09/ADR-003](../F09/ADR-003-leaving-a-group.md): §1 (salir con
  pendientes), §3 en lo que atañe a quien sale con obligaciones (ya no puede),
  §4 «Saldado» como flujo de salida de quien tiene cuenta, y la regla de
  autorización de anulaciones por membresía **para la clase de pago** (§C4).
  **Sustituye** de la v1 el bloqueo `PAYMENT_COUNTERPARTY_LEFT` y de la v2
  la corrección de importe y el sobrepago por edición: **un pago no se
  edita**. **Adelanta desde F12** «pagar deuda mediante
  transferencia» como _pago declarado_; deja en F12 la transferencia ordenada
  desde la app (invariante 14) y el acceso residual general de quien sale.
- **No toca** [F09/ADR-005](../F09/ADR-005-retire-unlinked-participant.md): retirar a un
  participante **sin cuenta** sigue cerrando sus pares sin caja.

## Contexto: lo que hay, medido

- **La deuda es por par** y se netea en las dos direcciones (`sec.net_debt`,
  `sec.pending_debt`, `api.group_pending_pair`); los saldos son el neto por
  persona y **Pagos sugeridos** se calcula sobre ellos, así que una sugerencia
  puede unir a dos personas sin par directo.
- **Hallazgo de lectura:** `api.group_pending_pair` enumera sólo las
  direcciones con filas brutas; un par cuya suma bruta es negativa (un
  par invertido tras anular un pago) **no aflora invertido**. `sec.pending_debt`
  sí lo calcula bien. La vista debe enumerar ambas direcciones (medido en la
  simulación: sección E).
- **`api.record_settlement_by_transfer`** (writer de F11): sólo el deudor
  vinculado, par directo, `SETTLEMENT_EXCEEDS_DEBT`. No se modifica.
- **`api.annul_operation`** exige membresía en **todos** los ámbitos que la
  versión alcanza —los dos Personales de una transferencia—, así que **hoy
  nadie puede anular una transferencia** (medido). No toma el rango 1.
- **`api.leave_group`** (provisioner): sin comprobación de deuda; toma el
  cerrojo de identidad; no lee efectos del grupo ni bloquea su fila (E6).
- **Personal:** `api.personal_operation` no publica transferencias;
  `api.claimed_dimension` publica deuda **sólo con membresía** (F09/ADR-003 §3);
  `personal_statistics` sólo suma efectos económicos.
- **Avisos:** `core.group_notice` se lee sólo con membresía
  (`group_notice_client_select`); `kind ∈ {edit, profile, departure,
settlement}`.
- **Base local:** 0 transferencias, 0 liquidaciones sin caja, 2 «Saldado»;
  inactivos con cuenta y pares pendientes en 6 grupos (§7).

## Decisión (aceptada)

1. **Pagos sugeridos** sobre el grupo completo, filtrados al presentar: por
   omisión las propuestas en las que quien mira paga o cobra (sin rótulo), con
   «Saldado» compacto a la izquierda del importe; un botón pequeño «Todos»
   despliega y pliega las de los demás, sin acciones sobre ellas y sin repetir
   las propias; estado propio si no intervengo, sin afirmar que el grupo está
   saldado.
2. **«Saldado» registra un pago hecho fuera de la app.** Pagador **o**
   receptor; ningún tercero, tampoco por API. «¿Confirmas que [pagador] ha
   pagado [importe] a [receptor]?». Movimiento de transferencia en el grupo
   (pagador → receptor, importe, fecha, autor); obligaciones reducidas;
   Disponible del pagador −X y del receptor +X; Movimientos recientes de
   ambos; sin gasto, ingreso ni diagrama nuevos; aviso al otro. **Nomey
   registra declaraciones: no verifica que el dinero se haya enviado.** Una
   declaración incorrecta afecta a los **dos** Personales, la registre quien
   la registre.
3. **Un pago no se edita.** Ni botón «Editar» ni endpoint: importe, fecha,
   extremos y grupo son inmutables; el servidor rehúsa una corrección directa
   por API (`PAYMENT_NOT_EDITABLE`). Si hay un error, **se anula y se
   registra otro** conforme a las condiciones de alta vigentes —ambos
   activos—: tras una salida **no** hay alta nueva.
4. **Anulación** por pagador o receptor, **aunque uno o ambos hayan salido**;
   nadie más. Anular = versión sin efectos (nunca borrado). Ambos Personales
   según la versión vigente; historial inmutable con autor y momento; aviso
   al otro **aunque ya no sea miembro**. Puede reabrir deuda **sin
   readmitir** a nadie.
5. **Salir exige cero pares pendientes** (por par, a pagar y a cobrar), en
   servidor, bajo el protocolo de concurrencia; si no, motivo y atajo a Pagos
   sugeridos. Desaparece «Saldado» de inactivos como flujo de salida. Salir no
   cancela deuda ni mueve caja.
6. **Acceso mínimo tras salir**, acotado a las transferencias en las que la
   cuenta es pagadora o receptora: consultarlas con su historial, anularlas,
   ver la deuda que reaparezca por esas anulaciones —y sólo ésa—, recibir sus
   avisos. **Sin
   acceso general al grupo ni a gastos.** Vale también si ambos salieron y el
   grupo ya no está en sus listas: la entrada está en el movimiento de
   transferencia de Personal.

## Contrato contable (implementado y medido contra las funciones reales)

### C1. Clase `group_payment`, writer propio, partes persistidas

`api.record_group_payment(payload)` (writer). Payload: `client_operation_id`,
`command_contract_version`, `scope_id`, `currency_definition_id`, `amount`
(texto), `effective_date`, `payer_participant_id`, `receiver_participant_id`,
`expected_positions` (lista de `{participant_id, net}`, los netos de
`api.group_balance` tal como se enseñaron). **Sólo alta**: `operation_id` o
`expected_version_id` en el payload → `PAYMENT_NOT_EDITABLE · 422` (medido:
secciones B y D), y `sec.persist_version` nunca recibe una versión `record`
con número mayor que 1 para esta clase. Las partes se persisten en
**`core.payment_detail`** (`operation_version_id`, `scope_id`,
`payer_participant_id`, `receiver_participant_id`, `declared_by_receiver`):
la autorización de una anulación —incluida la de un pago ya anulado— no puede
depender de efectos vigentes (medido: sección H).

Orden: clave → `sec.lock_participant_claims(G)` → **actor vinculado al pagador
o al receptor** (`NOT_AUTHORIZED` si no; la membresía **no** se exige) →
ambos con Personal → `sec.lock_scopes([G, P_pagador, P_receptor])` → CAS de
netos + aplicabilidad + ambos activos → descomposición → efectos → aviso.

Efectos de una versión: caja `transfer` −X / +X en los dos Personales;
reducciones `settlement` por par; **novación** (`novation`, +y) cuando no hay
camino. Lo que el grafo no sostiene no se registra
(`PAYMENT_NOT_APPLICABLE`). **Ningún efecto económico.** La descomposición
vive en `sec.decompose_payment(scope, payer, receiver, amount)` sobre
`sec.pending_pairs(scope)` (las dos direcciones, neteadas), con arrays y no
tablas temporales: la función corre bajo el writer y una tabla temporal de la
sesión no le pertenece (medido: `permission denied`).

### C2. Alta: CAS sobre los netos, aplicabilidad, un solo pago

Bajo los bloqueos se recalculan los netos; si difieren de
`expected_positions` → `SETTLEMENT_STALE` con los vigentes. Además
`net(pagador) ≤ −X` y `net(receptor) ≥ +X` → si no,
`PAYMENT_NOT_APPLICABLE`. Ambos participantes **activos** en un alta
(`PARTICIPANT_INACTIVE`).

Medido: dos cuentas confirmando el mismo pago con claves distintas, en
secuencia (check B) y simultáneamente (carrera 3): una entra y la otra
caduca; **un solo pago**. Misma clave = replay (`begin_command`).

### C3. Descomposición determinista

Sobre los pares neteados vigentes: (1) par directo; (2) caminos más cortos
primero, cuello de botella descendente, desempate por `uuid`, cada camino
reduce todos sus pares (los intermedios conservan su neto); (3) novación
entre salientes del pagador y entrantes del receptor. Invariantes: netos de
los demás intactos por construcción; ningún par negativo al registrar; caja
exacta bajo el cerrojo de identidad; una versión, sus efectos. Vive en `sec`;
el cliente no la envía ni la muestra. Un participante **sin cuenta** puede ser
intermedio o extremo de una novación (sólo deuda), nunca pagador ni
receptor.

### C4. Anulación: quién, y las dependencias resueltas

- **Quién:** vinculado al pagador o al receptor **de ese pago**
  (`payment_detail`), con o sin membresía. Un miembro ajeno y un no miembro:
  `NOT_AUTHORIZED` (medido: G). La autorización actual de `annul_operation`
  «membresía en todos los ámbitos alcanzados» **no aplica a esta clase**.
- **Uno o ambos fuera:** permitido (medido: C, F). Los pares reabiertos
  nombran a quien salió; no se le readmite (C6, F9); Personal se los muestra
  por la excepción de C6. Registrar de nuevo exige ambos activos (medido: D,
  `PARTICIPANT_INACTIVE`).
- **Pagos posteriores apoyados en una novación:** la guarda actual
  `assert_annulment_leaves_no_oversettled_debt` **bloquea**
  (`SETTLEMENT_EXCEEDS_DEBT`, medido: E). Solución, y se mantiene: **para
  anulaciones de `group_payment` esa guarda no se aplica**; el par consumido
  queda con suma bruta negativa, que **es** el estado verdadero —quien pagó
  una obligación novada que deja de existir tiene un crédito contra quien
  cobró— y las lecturas lo publican invertido (`Bea>Dani`). El pago
  posterior **no se toca** (E9), los netos suman cero y la siguiente
  sugerencia lo cierra por caminos (E10). La guarda **sigue** para
  correcciones y anulaciones de gastos (data-model §3).
- **Un retirado (F09/ADR-005) en el camino de un pago anterior:** la guarda
  actual `assert_no_retired_debt` **bloquea** anular el pago
  (`PARTICIPANT_RETIRED`, medido: I). Solución: para `group_payment`, la
  guarda pasa a ser «ningún retirado queda con **neto distinto de cero** sobre
  los efectos que la anulación revive». Un pago atraviesa a un participante
  siempre en equilibrio —camino o novación—, así que la anulación se admite
  (I5), el retirado queda a cero (I6), y el siguiente pago lo atraviesa de
  nuevo sin escribir nada nuevo con él (I7); quien debe no puede salir (I8).
  Un retirado nunca bloquea por sí mismo la anulación de un pago; una
  anulación de **gasto** que altere su deuda sigue rehusándose.
- **Obligaciones con intermedios:** los intermedios conservan su neto al
  registrar y al anular (B, C, E, I).
- **Lo que sigue bloqueando, y se dice:** `OPERATION_ANNULLED` (lo anulado
  no admite versiones: se registra otro pago, con ambos activos);
  `CURRENCY_CONVERSION_UNSUPPORTED` hasta F11.

### C5. Salir sin pendientes

`api.leave_group`: tras el cerrojo de identidad, si el participante del actor
tiene algún par pendiente en cualquiera de las dos direcciones →
`LEAVE_BLOCKED_DEBT` con los pares. Lectura definer `sec.pending_pairs_of`
(sólo el propio participante, sólo provisioner). **Todo lo que cambia deuda
toma el rango 1**: se añade a `record_debt_settlement` y a `annul_operation`
(ámbitos de grupo); la guarda de catálogo lo vigila (diez funciones). Medido
en las cinco carreras contra las funciones reales: pago → salir (sale a
cero); salir con pares (bloqueado) → pago (**una salida rehusada aborta su
transacción y no retiene el cerrojo**, así que el pago no espera; el
reintento de salir, ya a cero, sale); doble confirmación simultánea (un
pago, la otra `SETTLEMENT_STALE`); anulación → salir (bloqueado por lo
reabierto); salir a cero → anulación (permitida, sin readmisión).

### C6. Personal y acceso mínimo tras salir

- **Deuda reabierta, acotada:** `api.claimed_dimension` (rama de deuda) añade
  a la regla de membresía esta excepción: en los grupos de los que ya no soy
  miembro, **por cada pago mío anulado**, los pares que ese pago había
  reducido y que me nombran, y de cada uno **como mucho lo que ese pago
  redujo**, acotado al pendiente vigente del par. Un pago vigente no reabre
  nada; un par que el pago no tocó no se ve; lo que un par crezca por otras
  causas (una corrección ajena de un gasto) **no** se ve por esta vía
  (medido: C7 → C7c: Ana corrige un gasto tras la salida de Carlos y su
  pendiente pasa de 1000 a 2000, y Carlos sigue viendo −3500, lo que su pago
  cerró; F6–F8: Bea, miembro, no ve nada por la excepción).
- **Los pagos:** `api.my_group_payment()` (definer reducido): mis pagos por
  vínculo —grupo, contraparte, importe, fecha, autor, anulado o no y por
  quién, `expected_version_id`—, sin membresía (medido: F3). Para los
  miembros, la vista `api.group_payment` (con `version_id`, la vigente).
- **Deudas de Inicio:** `api.my_reopened_debt()` (definer) publica la misma
  excepción como cifra por divisa, sin nombrar el grupo, para la tarjeta de
  Inicio: ésta suma posiciones por membresía (`api.group_summary`) y quien
  salió no tiene fila (medido en dispositivo 2026-09-13: los −10 € no
  aparecían).
- **La hora del pago:** el cliente manda `effective_time` (reloj local) con
  el pago, para que ordene con la fecha entre los movimientos del día
  (F06/ADR-002 §3: sin hora ordena al final del día, y el pago aparecía debajo
  de la cena anterior). La hora se fija con la clave de idempotencia: un
  reintento repite las dos.
- **Ingresos de Inicio no lista los pagos** (decisión 2026-09-13): un pago
  recibido vive en Movimientos recientes como «Pago recibido de …» y el hecho
  como «Pago realizado a …», con contraparte, orden, efectos y anulación; ni
  la lista ni el total de Ingresos (renta económica) lo incluyen, y un pago
  hecho no es gasto.
- **Movimientos recientes:** `api.personal_operation` añade `group_payment`
  con contexto (grupo, `payment_counterpart`, signo en `balance_amount`). Una
  versión anulada desaparece de la lista, como un gasto anulado; el historial
  queda en `my_group_payment`. En el cliente la clase es `payment`: sin
  edición, eliminable (misma `annul_operation`), nunca renta.
- **Avisos:** `kind` nuevos `payment` y `payment_annulled`; la policy de
  lectura admite estos `kind` por **destinatario** aunque ya no sea miembro.

### C7. Sin cuenta e inactivos existentes

**Sin cuenta (decisión 2026-09-13, migración `20260913130000`; sustituye la
exigencia anterior de ambos Personales):** un pago **puede cerrar una deuda
con un participante sin cuenta ni Personal**, en las dos direcciones. Lo
registra la parte con cuenta, autorizada y activa —es la única con vínculo,
así que la autorización por las partes no cambia—; entre dos sin cuenta no
hay quien declare (`RECEIVER_WITHOUT_PERSONAL_SCOPE` sólo en ese caso; en
la práctica `NOT_AUTHORIZED` porque nadie es parte). La deuda se cierra
igual; la caja sale o entra **sólo en el Personal que existe**; no se crea
ningún Personal ni se avisa a nadie que no exista; el pago y su detalle
(`payment_detail`, `payment_allocation`) quedan con las **dos identidades de
participante**, que son el identificador estable (F03/ADR-009). Sin efecto
económico: ni renta ni gasto. Idempotencia, CAS, cerrojos, historial,
anulación (sólo la parte con vínculo; reversión exacta de la caja que se
escribió) y el tope de la excepción 2 no cambian. Quien no tiene cuenta puede
seguir siendo intermedio o extremo de una novación y se le sigue pudiendo
retirar (F09/ADR-005). Inactivos con cuenta y pares (legado de F09/ADR-003, 6 grupos
locales): sin tocar datos; `settle_participant` sin UI hasta restaurar; fila
«Salió con pendientes» sin botón; Pagos sugeridos no propone si hay un
inactivo con saldo que ningún par reabierto explique.

**Preparación para F10 (sin implementarlo).** El contrato vigente de invitados
y reclamación (F09/ADR-004, F09/ADR-006) vincula una cuenta a un participante por su
identificador estable (`participant_user_link`), nunca por nombre, y el
historial —gastos, cuotas, deudas— le llega por ese vínculo sin tocar ningún
hecho (F03/ADR-009 §1). Los pagos con un participante sin cuenta siguen la misma
regla: cuando alguien reclame a ese participante, `api.my_group_payment()`
y `api.personal_operation` le mostrarán esos pagos por vínculo, con su estado
(vigente o anulado; medido en `ghost-payments.sql` E). Lo que **no** existe
para ellos es la caja: nunca se escribió un efecto `transfer` en un Personal
que no existía. Cómo incorporarla cuando corresponda es decisión de F10, con
tres límites ya fijados: (1) se identifica por `payment_detail` —los pagos
vigentes en los que el participante reclamado es parte—, nunca por nombre;
(2) los anulados quedan anulados: no se incorpora caja de una versión
`annulment`; (3) sin duplicar: una incorporación es un comando idempotente
por la clave de la reclamación, bajo el cerrojo de identidad, que escribe
efectos de caja en el Personal nuevo referidos a esas operaciones (una
operación propia de ajuste por reclamación, o una versión nueva de cada pago
con `command_type` propio; ambas conservan la atribución del autor original
y la fecha del hecho). No se inventa un `user_id` para nadie: si F10 admite
identidad anónima autenticada (Supabase anonymous sign-in), el vínculo se
crea con ese `uid` mediante la invitación, igual que hoy, y al convertir la
cuenta el `uid` se conserva, así que el vínculo y la caja incorporada no
cambian de dueño.

### C8. Salir a cero: la salida simplifica las obligaciones (ACEPTADO 2026-09-14; migración `20260914120000`, aplicada a la base local; sin validar en dispositivo)

**Lo medido (2026-09-14, «Prueba 2»):** con C5 tal como está implementada
—cero pares por par— alguien con **neto cero** no puede salir si conserva
pares en las dos direcciones (Aitor>Edu 300 y Edu>Luis 300 dejan a Edu a
cero y bloqueado), y Pagos sugeridos —que reparte netos— no le propone nada.
Exigir dos pagos reales para cerrar los pares originales es lo que la
decisión rechaza.

**Decisión de producto:** quien queda a **neto cero** puede salir aunque
conserve pares. Al salir, sus pares se **reasignan** entre los demás sin
dinero: Aitor>Edu 3 y Edu>Luis 3 se convierten en **Aitor>Luis 3**. Ningún
pago se inventa, ninguna caja se mueve, ningún gasto se reescribe, no hay
renta ni gasto.

**Contrato propuesto (novación de salida):**

- **Regla de salida (sustituye a «cero pares» de C5):** se sale con **neto
  cero**; con neto distinto de cero, `LEAVE_BLOCKED_DEBT` con el neto y los
  pares en `details`. El neto se calcula bajo el cerrojo de identidad sobre
  `sec.pending_pairs`.
- **La novación es una operación** de clase `departure_novation`, autoría
  del que sale, escrita por el writer (`sec.record_departure_novation`,
  definer de `nomey_writer` que el provisioner puede invocar), **atómica
  con la salida** e idempotente por la MISMA clave que la salida
  (`client_command_id` de `leave_group` como `client_operation_id` de
  `core.client_command`, clase distinta: sin colisión). Efectos: por cada par
  entrante `D>Yo:a` y saliente `Yo>C:b`, liquidaciones (`settlement`, −) de
  ambos y **novaciones** (`novation`, +) `D>C` por el emparejamiento
  determinista (entrantes y salientes ordenados por identidad, se casa el
  mínimo restante). Con neto cero las sumas coinciden y el que sale queda sin
  pares; los demás conservan **exactamente su neto**. Sin caja, sin efecto
  económico. `core.group_departure.novation_operation_id` guarda la
  procedencia. No se anula (`OPERATION_NOT_ANNULLABLE`).
- **Coherencia:** Saldos (netos) no cambian; Pagos sugeridos —sobre netos—
  sigue proponiendo lo mismo; una propuesta se paga como hoy (par directo o
  camino, C3); las obligaciones vigentes son las reasignadas; salir exige lo
  que Saldos enseña: cero. Ya no hay «cero y ninguna propuesta pero no puedes
  salir». **El listado de «pares propios» añadido el 2026-09-14 en Pagos
  sugeridos se retira** al implementar esto: forzaba pagos redundantes.
- **F09/ADR-008 se conserva:** tras la salida, los gastos que nombraban al
  salido siguen protegidos; la novación no los toca. **C4** (anular un pago
  del que dependen otros): una obligación reasignada por novación de salida
  que luego se paga se comporta como cualquier par: anular ese pago la reabre;
  anular un gasto ORIGINAL que la sostenía sigue rehusado por F09/ADR-008 (nombra
  al salido) o por sobreliquidación. **C6:** la novación no reabre nada ni
  crea deuda con el salido: no entra en `my_reopened_debt`.
- **Sin cuenta:** un fantasma puede ser `D` o `C` de una novación (sólo
  deuda). Quien sale es siempre una cuenta.
- **Número de transferencias:** la salida no cambia ningún neto, así que no
  cambia la propuesta: el mínimo exacto de `proposePayments` (≤ 14 con
  saldo: `n − k`, demostrado por la programación dinámica del cliente) o el
  voraz por encima (≤ `n − 1`, **no** mínimo). Un pago real cierra tantos
  pares como haga falta (C3). **No se afirma** que las obligaciones vigentes
  sean mínimas como grafo: se afirma que los pagos reales necesarios son los
  de la propuesta, y que salir no añade ninguno.

**Lo demostrado (2026-09-14, pila aislada `NomeyIso` levantada desde cero
con las 41 migraciones más el borrador `20260914120000`, no aplicado a la
base local): `supabase/checks/departure-novation.sql`, secciones A–E, contra
las funciones reales llamadas como cada cuenta.**

- **A · el ejemplo.** Aitor>Edu 300 y Edu>Luis 300 (Luis sin cuenta; Edu ya
  le había pagado 100 de 400). Con neto +300, Edu no sale
  (`LEAVE_BLOCKED_DEBT`, `details.net = "300"`, nada escrito). A neto cero
  sale: pares `Aitor>Luis:300`; netos idénticos (Aitor −300, Edu 0, Luis
  +300); una sola operación `departure_novation` con `novation
Aitor>Luis:300`, `settlement Aitor>Edu:−300`, `settlement Edu>Luis:−300` y
  **cero** efectos de caja o económicos; el Personal de Edu (caja −700) y el
  de Aitor no cambian en nada; Movimientos del grupo, Pagos y Movimientos del
  Personal no ganan filas; el replay de la misma salida responde
  `already_processed` sin segunda novación.
- **B · cadena.** Entrantes Aitor 300 y Gus 200 (sin cuenta), salientes Bea
  400 y Luis 100 (sin cuenta), más dos pares ajenos a Edu: la salida de Edu
  produce `Aitor>Bea:300 Gus>Bea:100 Gus>Luis:100`; los ajenos quedan; los
  netos, idénticos. Ana (neto −250) no sale. Bea, a cero con entrantes **ya
  novados**, sale: `Aitor>Luis:300 Gus>Luis:100` (y `Gus>Luis` suma 200).
- **C · ciclo.** Aitor>Edu>Luis>Aitor de 300: al salir Edu el ciclo se
  colapsa (cero pares); Aitor sale sin pares y **sin** novación
  (`novation_operation_id` nulo).
- **D · después.** Los pagos siguen acotados por netos (v3): Aitor (neto −50)
  no paga 300 de golpe; paga 50 (par directo) y Ana 250 por el camino
  Ana>Aitor>Luis (C3), y el par novado se consume. Con esos pagos vigentes,
  anular una novación o el gasto original se rehúsa sin escribir
  (`SETTLEMENT_EXCEEDS_DEBT`); corregir el importe de un original,
  `DEPARTED_OBLIGATION_CHANGED` (F09/ADR-008); sólo el concepto, permitido.
  Anular el pago de Ana reabre lo que cerró (C4). Sin pagos, anular una
  novación lo rehúsa F09/ADR-008 (sus efectos nombran al salido); la guarda de
  clase en `sec.persist_version` queda detrás como respaldo. El gasto que
  pagó el salido con **su** caja sólo lo anularía él (`NOT_AUTHORIZED` para
  los demás), como ya fijaba F09/ADR-008.
- **E · C6.** La novación no entra en `my_reopened_debt` (Edu y Bea, 0);
  anular el pago que Edu hizo antes de salir reabre `Edu>Luis:100` y sólo
  eso (−100 para Edu).

La suite completa de checks y los scripts de carrera existentes pasan sobre
la pila aislada con la migración (salvo los cuatro checks antiguos ya
pendientes, iguales que antes), y los dos checks nuevos también contra la
base local una vez aplicada. **En el cliente** (2026-09-14): el listado de
«pares propios» de Pagos sugeridos se retiró; la comprobación previa de
salida lee **mi neto** (`api.group_balance`, fila propia) y el aviso dice
cuánto queda por pagar o por cobrar; el servidor sigue decidiendo bajo el
cerrojo. **Pendiente:** validar en dispositivo.

**Un hallazgo previo a este bloque, medido de paso y ya resuelto
(migración `20260914150000_oversettlement_guard_delta.sql`):** las dos
guardas de sobreliquidación exigían `S ≤ E + delta` como condición ABSOLUTA
sobre el estado del par y lo examinaban en la dirección en que la versión lo
nombra; cuando un par estaba totalmente pagado y otro gasto creaba deuda en
sentido contrario —un hecho legítimo que las guardas de alta no miran—,
cualquier corrección de ese par, incluso sólo el concepto, y la anulación del
gasto cruzado se rehusaban con `SETTLEMENT_EXCEEDS_DEBT`. Ahora el par se
orienta por sus liquidaciones y sólo se rehúsa lo que la corrección o la
anulación **empeora**: neto por debajo de cero y por debajo del que dejaba la
versión vigente. La semántica neteada y el ejemplo canónico (5000 liquidado
4000 → 3000 rehusado) no cambian. Evidencia:
`supabase/checks/oversettlement-delta.sql`.

## Ejemplo con ambos Personales (check, secciones A–D)

Sierra: G1 Ana 60,00 Ana/Bea · G2 Bea 60,00 Bea/Carlos · G3 Ana 20,00
Ana/Carlos · G4 Bea 10,00 Ana/Bea. Pares neteados: Bea→Ana 25,00 ·
Carlos→Ana 10,00 · Carlos→Bea 30,00. Netos: Ana +35, Bea +5, Carlos −40.

| Paso                                               | Pares                                      | Personal Ana (caja · gasto · deuda) | Personal Carlos                                      |
| -------------------------------------------------- | ------------------------------------------ | ----------------------------------- | ---------------------------------------------------- |
| antes                                              | Bea>Ana 25 · Carlos>Ana 10 · Carlos>Bea 30 | −80,00 · 45,00 · +35,00             | 0 · 40,00 · −40,00                                   |
| Ana registra Carlos→Ana 35 (directo 10, camino 25) | Carlos>Bea 5                               | −45,00 · 45,00 · 0                  | −35,00 · 40,00 · −5,00                               |
| Carlos paga 5 a Bea y **sale** (cero pares)        | —                                          | igual                               | −40,00 · 40,00 · fuera                               |
| Carlos, fuera, **anula** el pago de 35             | Bea>Ana 25 · Carlos>Ana 10 · Carlos>Bea 25 | −80,00 · 45,00 · +35,00             | −5,00 · 40,00 · **reabierta −35,00**, sin readmisión |
| Ana corrige G3 (20 → 40) con Carlos fuera          | … Carlos>Ana 20                            | −100,00 · 55,00 · +45,00            | −5,00 · 50,00 · reabierta **−35,00** (no −45,00)     |

Bea nunca mueve caja y su neto es el que corresponde en cada paso. El gasto
económico de los tres no cambia en ningún paso.

## Permisos

| Acción                                                    | Pagador / receptor (miembro)                               | Pagador / receptor (fuera)  | Miembro ajeno              | No miembro |
| --------------------------------------------------------- | ---------------------------------------------------------- | --------------------------- | -------------------------- | ---------- |
| Registrar                                                 | sí (ambos activos)                                         | no (`PARTICIPANT_INACTIVE`) | no                         | no         |
| Corregir (importe, fecha, extremos)                       | **no** (`PAYMENT_NOT_EDITABLE`)                            | no                          | no                         | no         |
| Anular                                                    | sí                                                         | sí                          | no                         | no         |
| Registrar de nuevo tras anular                            | sí (ambos activos)                                         | no                          | no                         | no         |
| **Saldar un par reabierto con quien salió** (excepción 2) | **sí, sólo la parte activa**, sólo ese par y hasta su tope | no (`NOT_AUTHORIZED`)       | no (`NOT_AUTHORIZED`)      | no         |
| Ver el pago y su historial                                | sí                                                         | sí (`my_group_payment`)     | sí (Movimientos del grupo) | no         |
| Ver la deuda reabierta                                    | por membresía                                              | por la excepción C6         | por membresía              | no         |
| Salir con pares                                           | no                                                         | —                           | —                          | —          |

### Excepción 2 de C6 (2026-09-13): saldar lo reabierto con quien salió

Medido en dispositivo: Aitor salió a cero de «Prueba», Eduardo anuló después
el pago y reapareció Aitor → Eduardo 10 € que **nadie podía cerrar** (registrar
exigía a los dos activos) y que impedía salir a Eduardo. **Decisión:** la
parte que sigue activa puede registrar el pago que salda ese pendiente.
Contrato (migración `20260913120000_reopened_pair_payment.sql`):

- **Sólo pares reabiertos por la anulación de un pago entre esas dos partes**,
  y como mucho lo que ese pago había reducido, acotado al pendiente vigente
  del par (`sec.reopened_pair_cap`: el mismo cálculo que la excepción C6 de
  Personal, por par). Un ciclo pagar → anular → pagar no amplía el tope.
- **El autor es una de las dos partes y está activo**; el salido no registra
  desde fuera (sin membresía) y un miembro ajeno tampoco (`NOT_AUTHORIZED`).
  Con las dos partes fuera no hay quien declare.
- Ambas partes con cuenta y Personal; el pago es **exactamente el par
  directo** (pagador = deudor, receptor = acreedor); un camino o una novación
  con el salido se rehúsa (`PAYMENT_NOT_APPLICABLE`): F09/ADR-008 no se relaja.
- Todo lo demás igual: CAS de netos, clave, cerrojos, historial, aviso al
  salido (por destinatario), caja en los dos Personales, permisos de
  anulación. Sin readmisión.
- **Lectura:** `api.group_reopened_pair(p_scope)` (definer, sólo miembros)
  publica los pares saldables; Pagos sugeridos los enseña como propuestas
  fijas a la parte activa, con «Saldado».

Evidencia: `supabase/checks/reopened-pair-payment.sql` (A–E: salida →
anulación → propuesta a miembros y no al salido → pago por la parte activa →
par a cero, caja, aviso, sin readmisión → salida permitida; rechazos del
salido, de un tercero, por tope, por dirección y sin par; ciclos sin doble
suma; las dos fuera), y D0 de `group-payments-evidence.sql`.

## Evidencia

- `supabase/checks/group-payments-evidence.sql` (A–J, rollback; las ayudas
  `lib/group-payment-helpers.sql` viajan delante por la entrada estándar y
  **sólo leen y envuelven las funciones reales**): B pago por caminos con
  ambos Personales, STALE, replay y corrección rehusada; C pago → salida →
  anulación por quien salió, deuda reabierta acotada frente a una corrección
  ajena; D sin edición y sin alta tras salir; E novación → pago posterior →
  anulación del primero (par invertido, coherente y sin tocar el posterior);
  F ambos fuera, lectura por vínculo y anulación; G terceros; H reintentos y
  `OPERATION_ANNULLED`; I retirado en el camino (se anula y el retirado queda
  en equilibrio); J avisos y Personal.
- `scripts/group-payment-race-evidence.sh`: cinco carreras con dos sesiones
  reales sobre las funciones reales (espera medida 1,9–2,0 s), en CI.
- `supabase/checks/group-identity-lock.sql`: `annul_operation`,
  `record_debt_settlement` y `record_group_payment` toman el rango 1 en el
  orden del protocolo; siete definer del writer.
- `supabase/checks/leave-and-settle.sql` y `group-invitations.sql`,
  adaptados: la salida con pares se rehúsa (`LEAVE_BLOCKED_DEBT`, sin
  escritura, ni la clave); la salida con pendientes de F09/ADR-003 se siembra como
  **estado heredado** para que `settle_participant` siga medido; el último
  miembro retira a quien no tiene cuenta (F09/ADR-005) antes de salir.
- `scripts/writer-debt-concurrency.sh`: el bloqueo manual de la carrera 3
  toma el rango 1 antes de la fila (sin él, la sesión que bloqueaba fuera de
  orden entraba en interbloqueo con el writer de deuda, que ya toma el rango
  1).
- Desde cero en un stack aislado (`NomeyIso`, 39 migraciones): los 20
  checks de esta tanda y los siete scripts de concurrencia, sin residuos.
  Cuatro checks anteriores siguen rojos desde cero por causas ajenas a esta
  tanda (`participant-identity` A6c, `split-conversion` A4/A4b,
  `personal-provisioning` B2/B2b, `canonical-attribution` E).

## Archivos y contratos afectados, y F11

| Pieza                                                                                                                                | Cambio                                                                                                                                                                 | F11                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `api.record_group_payment` (sólo alta), `sec.decompose_payment`, `core.payment_detail`, clase contable `novation`                    | C1–C3                                                                                                                                                                  | usa `sec.assert_no_conversion`; **no** toca `record_settlement_by_transfer` |
| `api.annul_operation`                                                                                                                | autorización por partes para `group_payment`; para esa clase, sin guarda de sobreliquidación y guarda de retirados por **neto cero**; rango 1; aviso                   | writer compartido: recrear desde el cuerpo vivo                             |
| `api.record_debt_settlement`                                                                                                         | sólo añade el rango 1                                                                                                                                                  | writer compartido: una línea                                                |
| `api.leave_group`, `sec.pending_pairs_of`                                                                                            | C5                                                                                                                                                                     | no                                                                          |
| `api.group_pending_pair`                                                                                                             | enumerar las dos direcciones (hallazgo)                                                                                                                                | no                                                                          |
| `api.claimed_dimension`                                                                                                              | excepción C6 (rama de deuda)                                                                                                                                           | lectura compartida por atribución; coordinar                                |
| `api.personal_operation`, `api.my_group_payment` (nueva)                                                                             | clase `group_payment` con contexto; lectura por vínculo                                                                                                                | `personal_operation`: F11 puede añadir divisa; coordinar                    |
| `core.group_notice` (`kind`, policy por destinatario)                                                                                | C6                                                                                                                                                                     | no                                                                          |
| Cliente                                                                                                                              | Pagos sugeridos (Los míos/Todos, «Saldado»), fila de transferencia en el grupo, entrada desde Personal, salida bloqueada → Pagos sugeridos, sin «Saldado» en inactivos | no                                                                          |
| Checks: `group-payments-evidence.sql` contra la función real; `group-identity-lock.sql` (diez funciones con rango 1); carreras en CI | evidencia (hecho)                                                                                                                                                      | no                                                                          |

`record_group_expense`, `record_settlement_by_transfer`, moneda base y
conversión: **sin cambios**.

## Decisiones cerradas y pendientes

1. **Novación**: aceptada e implementada (efectos `novation`). Lo que el
   pago cerró (`settlement`) o reasignó (`novation`) se persiste con la
   versión en **`core.payment_allocation`** —lo que el pago declaró bajo el
   cerrojo, no los saldos de ahora; el mismo criterio que
   `core.split_participant` (F03/ADR-010 §1)— y se publica a los miembros por
   `api.group_payment_allocation`; sus efectos superados no se leen (F03/ADR-010
   §9 / F06/ADR-007). **Presentación (decisión 2026-09-13): el desplegable del
   pago no enseña ese desglose** —ni «Cerró», ni las obligaciones directas,
   encadenadas o reasignadas—: dice «Declarado por» y ofrece anular a las
   partes; pagador, receptor, importe y fecha van en la propia fila. Un pago
   anulado sigue en la lista del grupo, tachado y marcado «Anulado», sin
   papelera. Los datos, los cálculos y los efectos de registro y anulación no
   cambian.
2. **Par invertido al anular un pago del que dependen otros** (C4): aceptado
   e implementado; `api.group_pending_pair` enumera ambas direcciones y
   `payment_detail.declared_by_receiver` distingue quién lo declaró.
3. **Correcciones y anulaciones de gastos que nombran a quien salió**: cerrado
   en [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md) (aceptado e
   implementado), incluidas las altas retro-fechadas.
4. **`settle_participant` en el legado**: conservado sin UI; el check lo sigue
   midiendo sobre un estado heredado sembrado. Revocar `execute` cuando la
   base local no tenga inactivos con pares: pendiente.
5. **Divisa**: rehúsa `CURRENCY_CONVERSION_UNSUPPORTED`; no aproxima.
6. **Límite documentado, no ampliado:** anular un **gasto** cuya caja es de
   otro participante sigue exigiendo membresía en todos los ámbitos
   (`NOT_AUTHORIZED`); sólo el pagador lo anula.

## Alternativas consideradas

- Reutilizar `record_settlement_by_transfer`: mezcla la transferencia
  ordenada de F12 con el hecho declarado y obliga a F11 y a esta tanda a
  recrear el mismo cuerpo. Descartado.
- Bloquear la anulación cuando el otro salió (v1): descartado por decisión.
- Corregir el importe de un pago (v2): descartado por decisión; anular y
  registrar otro conserva las condiciones de alta.
- Reescribir pagos posteriores al anular una novación: descartado por
  decisión; el par invertido conserva cada versión.
- Idempotencia entre aparatos por huella: no distingue un duplicado de un
  segundo pago legítimo. Descartado por el CAS de netos.

## Consecuencias

- Un pago declarado escribe en el Personal del otro; una declaración falsa
  se deshace anulando y registrando otro, con aviso; no se impide.
- Quien salió puede ver reaparecer deuda de ese grupo en su Personal, sin
  acceso al grupo: es lo decidido, y sólo lo que sus propios pagos habían
  cerrado.
- Un par puede quedar invertido al anular un pago del que dependían otros;
  el modelo ya lo lee así y Pagos sugeridos lo cierra.
- Un error en un pago cuesta dos operaciones (anular y registrar), y tras una
  salida sólo la primera es posible.
- `api.record_*` son **nueve** funciones; ocho observan y bloquean saldo
  (`group_payment` mueve la caja de los dos Personales) y las nueve bloquean
  ámbitos: los checks de catálogo se actualizaron a esas cifras a propósito.
- Pendiente de validar en dispositivo: la app no se ha ejercitado con esta
  tanda (Metro en pie; la build de desarrollo Android es anterior y no está
  autorizada).
