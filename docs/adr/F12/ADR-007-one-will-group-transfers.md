# F12/ADR-007 — La transferencia de grupo es una declaración de una voluntad

- **Estado:** Aceptado
- **Fecha:** 2026-09-24
- **Fase:** F12 (bloque C3)
- **Supersede:** [F12/ADR-003](ADR-003-group-transfers.md) **en su contrato de
  producto**, no en su implementación: `core.group_transfer_proposal`,
  `core.transfer_part` y los cuatro comandos de B3 se conservan íntegros y sin
  superficie cliente.

---

## Contexto

F12/ADR-003 modeló la transferencia dentro de un grupo como una **propuesta de
dos voluntades**: el emisor propone, el receptor acepta, y sólo la aceptación
crea un `settlement_by_transfer` que mueve la caja de los **dos** Modos
Personales y salda la deuda del par por el importe completo. F12.B3 lo
implementó entero (`20260928120000`), con sus nueve carreras.

Al construir la pantalla (F12.C3) y validarla a mano apareció el problema que
esa decisión no podía resolver:

> Un grupo con **Edu**, **Aitor** y un participante fantasma llamado **Pablo**.
> Al abrir `+ → ⇄ Transferencia`, Pablo **no aparece**. Y como no hay a quién
> marcar, el botón nunca llega a activarse por mucho importe que se escriba.

No era un error de la pantalla: era el contrato. Recibir exigía cuenta
vinculada, username definitivo, Modo Personal y monedas compatibles — porque
**alguien tenía que aceptar** y **había que abonarle su Personal**. Un
participante sin cuenta no puede hacer ninguna de las dos cosas.

Y un grupo con un fantasma es el caso **normal**, no el raro: F03/ADR-009
existe precisamente para que alguien pueda participar en la economía de un
grupo antes de instalar Nomey.

---

## Decisión

**La transferencia de grupo es una declaración unilateral y una operación del
libro del GRUPO.** Quien la registra declara «he transferido X a estas personas
del grupo», y el efecto ocurre al confirmar el servidor.

### 1 · Clase propia: `group_transfer`

No se reutiliza `settlement_by_transfer` ni `group_payment`.

`settlement_by_transfer` **no** porque la irreversibilidad de esa clase está
escrita sobre la clase misma, en `sec.persist_version` y en
`api.annul_operation`, con un argumento que aquí no aplica: «las dos partes
consintieron ESE hecho». Reutilizarla obligaría a relajar esa guarda,
degradándola también para las transferencias Personal, que sí la necesitan.
Además `core.transfer_part` es 1:1 con la versión y no admite N receptores.

`group_payment` **no** porque esa clase significa «pago declarado **acotado por
la deuda**», con su descomposición en caminos, sus novaciones y su tope. Una
transferencia de grupo no tiene tope y puede cruzar cero.

`operation_class` es vocabulario abierto a propósito (`check (<> '')`), así que
la clase nueva no toca el esquema del ledger.

### 2 · El receptor es el PARTICIPANTE, nunca una cuenta

Las condiciones para recibir son las de **nombrar a alguien en un alta del
grupo** (`record_group_expense`) más la de estar presente ahora
(`record_group_payment`):

- pertenece al ámbito;
- es elegible hoy;
- no está retirado;
- no es origen de una fusión;
- no es uno mismo.

Y **ninguna más**: ni cuenta, ni vínculo, ni username, ni Modo Personal, ni
amistad, ni la moneda de ningún Personal ajeno. Un fantasma recibe como
cualquiera, y no se le inventa un Personal.

### 3 · La caja es sólo la del EMISOR

Un único efecto de balance, por el **total**, en el Modo Personal de quien
registra — si lo tiene, con la misma tolerancia al participante sin Personal que
`20260913130000` ya introdujo para los pagos.

**Ningún efecto en el Personal de ningún receptor.** Ésa es la diferencia
entera con `settlement_by_transfer`: allí las dos partes habían consentido;
aquí no, y escribir en la cuenta de otro sin su voluntad es exactamente lo que
F12/ADR-002 §1 prohíbe. Un fantasma, además, no tiene Personal donde escribir.

El débito es **caja, no consumo**: no produce dimensión económica, así que no
aumenta «Gastos» del emisor ni «Ingresos» de nadie (F01/ADR-001 §2, y la regla
de F12.E.E sigue contando sólo `internal_transfer` recibida).

### 4 · Multi-destinatario ATÓMICO

Una intención, una operación, una transacción. El cliente manda el **total** y
la lista de receptores; el servidor reparte, escribe N efectos de `settlement`
y N filas de `core.group_transfer_allocation`. Si un receptor no es elegible o
el importe no reparte, **no se escribe ninguno**.

No hay envío parcial que contar, porque no hay N comandos.

### 5 · El reparto es autoritativo del servidor

Con `sec.allocate_by_largest_remainder` (`20260826205500`), pesos a uno: la
regla canónica de F01/ADR-001 §5, la misma que reparte las cuotas de un gasto y
la que los 22 vectores compartidos comprueban. **No hay una segunda
implementación**: el cliente calcula el mismo reparto sólo para la vista
previa.

**El orden canónico es `(participant.created_at, participant.id)`** — la
entrada al grupo, con el identificador como desempate cuando varios entraron en
la misma transacción. Es el orden que `api.group_transfer_candidates` entrega y
el que el writer aplica, de modo que la unidad menor que sobra se enseña en la
persona que de verdad la recibe. El orden del JSON no decide nada.

Si el total en unidades menores no llega al número de destinatarios, se rehúsa
con `TRANSFER_AMOUNT_TOO_SMALL` **antes** de escribir: una cuota de cero no es
una transferencia.

### 5 bis · La fecha y la hora son las del aparato de quien registra

Como en un gasto compartido y como en un pago declarado: `effective_date` y
`effective_time` llegan en el payload, sembradas por la ruta desde el reloj del
dispositivo (`todayInDeviceCalendar()` y `clockTimeOf`). La hora es opcional —
sin hora no es medianoche, es «no se sabe» (F06/ADR-002 §3).

**No las pone el servidor.** La primera versión heredó de B3
`current_date` / `localtime(0)`, que allí tenía sentido —entre dos voluntades
ningún reloj de nadie es autoritativo— pero aquí no: el servidor corre en UTC,
y se midió sobre datos reales que una transferencia registrada a las 19:39 y
19:40 (Madrid) quedaba escrita como 17:39 y 17:40, por debajo en «Movimientos»
de un gasto registrado a las 18:24. Una declaración unilateral la fecha quien
la declara.

### 6 · El álgebra no cambia

`D_after = D − N` por par, importe completo y **sin tope**: puede cruzar cero y
dejar al acreedor debiendo (F12/ADR-003 §9–§11, que sigue vigente como
descripción del álgebra). `SETTLEMENT_EXCEEDS_DEBT` no aplica a esta clase al
escribir.

### 7 · No se corrige; sí se anula

Lo contrario que B3, y por el motivo que B3 daba: lo que hacía irreversible a
aquella transferencia era que **dos** personas habían consentido el hecho. Una
declaración unilateral no tiene esa propiedad, y se deshace como un pago
declarado (F09/ADR-007): `PAYMENT_NOT_EDITABLE` en espíritu —se anula y se
registra otra— y anulación con la disciplina de F06/ADR-006, una versión **sin
efectos**.

Al anular se aplican las guardas existentes sin añadir ninguna, y la de
sobreliquidación (`sec.assert_annulment_leaves_no_oversettled_debt`) recorre
**todos** los pares de la versión: si deshacer dejaría cualquiera de ellos con
pendiente negativo, no se anula ninguno.

**Quién puede anular sale de la autorización que ya existía**: membresía en
cada ámbito que la versión alcanza. Como la versión toca el Personal del
emisor, en la práctica **sólo el emisor** puede.

### 8 · Ni pendientes, ni notificaciones, ni campana

No hay propuesta, así que no hay nada pendiente que atender: la campana pierde
una fuente, Notificaciones pierde una sección y el `AppState` una salida. Lo
que alguien haya transferido se ve en el histórico de su grupo al releerlo, por
el mismo canal (`groupRecorded`) que ya invalidaba saldos y movimientos.

### 9 · El histórico: una intención, una fila

`api.group_transfer_operation` publica una fila por operación vigente con su
número de receptores, y `api.group_transfer_allocation` el reparto. Partirla en
N filas contaría como N hechos algo que fue uno, y dejaría sin sentido la
anulación. Una anulada desaparece de las dos vistas sin ninguna cláusula que lo
diga: su versión vigente no tiene reparto.

---

## Lo que NO cambia

- **F12.C1, las transferencias Personal**: siguen siendo entre cuentas, de dos
  voluntades, irreversibles y en `api.my_transfers`.
- **«Saldado» (`api.record_group_payment`)**: una voluntad, acotado por la
  deuda, anulable. Sigue siendo otra cosa.
- **`api.group_operation`**: la transferencia no entra ahí. El histórico del
  grupo ya era una mezcla en cliente de varias lecturas.
- **Todo B3**: `core.group_transfer_proposal`, `core.transfer_part`,
  `create_/cancel_/decline_group_transfer_proposal`,
  `api.record_settlement_by_transfer`, `api.group_transfer_proposals`,
  `api.group_transfers`, su check y sus nueve carreras. **Backend dormido sin
  superficie cliente**, igual que las solicitudes de pago de F12.B2.

---

## Alternativas descartadas

**Reutilizar `settlement_by_transfer` vaciándola de `transfer_part`.** Habría
heredado una prohibición cuya única justificación son las dos voluntades que
esta decisión elimina, obligando a relajarla para las transferencias Personal.

**Mantener las dos voluntades y excluir a los fantasmas.** Es el contrato que
se rechazó: deja fuera el caso normal de un grupo y no ofrece ninguna forma de
anotar que alguien pagó a alguien sin cuenta.

**No escribir tampoco la caja del emisor.** Se consideró y se descartó: el
emisor declara **su propia** salida de dinero, que es una voluntad sobre lo
propio, igual que al pagar una cena. Sin ese efecto, su «Disponible» seguiría
mostrando un dinero que ya no tiene y la única forma de cuadrarlo sería un
ajuste manual.

**Un bucle de N operaciones en el cliente.** Se descartó porque el modelo
admite N efectos bajo una versión —`record_group_expense` y
`record_group_payment` ya lo hacen— y porque un bucle cliente no es atómico:
obligaría a contar envíos parciales de algo que la persona pulsó una vez.

---

## Evidencia

- `supabase/migrations/20261006120000_group_transfer_operation.sql`
- `supabase/migrations/20261007120000_group_transfer_candidates.sql`
- `supabase/checks/group-transfer-client.sql` (A–M)
- `supabase/checks/group-transfer-proposals.sql` y
  `scripts/group-transfer-race-evidence.sh`, **verdes sin cambios de
  contrato**: B3 sigue disponible
- `tests/infra/group-transfer-surface.test.ts`
- `tests/domain/split-evenly.test.ts`
