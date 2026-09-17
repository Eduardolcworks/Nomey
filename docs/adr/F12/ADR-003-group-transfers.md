# F12/ADR-003 — Transferencias dentro de un Grupo

- **Estado:** Aceptado (2026-09-17)
- **Fecha:** 2026-09-17
- **Alcance:** cómo un miembro de un Grupo propone enviar dinero a otro
  participante **del mismo grupo**, cómo el receptor la acepta, y qué operación
  nace entonces: una `settlement_by_transfer` que mueve valor entre los dos
  Modos Personales **y** modifica algebraicamente la deuda entre esos dos
  participantes en ese grupo, con el importe completo, pudiendo cruzar cero.
  Fija la clase, la elegibilidad, el binding de identidades, la invalidación
  por salida del grupo, el sobrepago, los efectos, la atomicidad, la moneda y
  la irreversibilidad. Supera de forma **acotada** la regla de sobrepago de
  `data-model.md` §3.
- **No cubre:** la solicitud de pago por enlace (F12/ADR-004); el username y
  su resolución (F12/ADR-001); la transferencia desde el Personal, que este
  ADR **hereda** de [F12/ADR-002](ADR-002-two-will-user-transfers.md) y no
  redefine; el pago declarado «Saldado» (`group_payment`, F09/ADR-007), que
  **no cambia**; la liquidación sólo deuda (`record_debt_settlement`), que
  **no cambia**; la retirada técnica de `api.settle_participant` (tarea de
  cierre de F12); avisos concretos y enlaces.
- **Hereda de F12/ADR-002, sin redefinir:** el principio de dos voluntades
  (§1–§3), la propuesta dirigida y su inmutabilidad (§6), el concepto en la
  propuesta (§7), el ciclo de vida y sus estados visibles (§8–§9), el
  invariante de concurrencia (§10), la autoría (§12), el invariante 14
  precisado (§13), las partes por versión (§14), pendiente sin saldo (§15), la
  irreversibilidad (§16), las devoluciones (§17), el presupuesto anti-spam
  (§18), la moneda fija (§20) y la fecha de aceptación (§21).
- **Supera**, sólo para la clase `settlement_by_transfer` nacida de una
  propuesta aceptada: `data-model.md` §3, «Una liquidación no puede
  sobrepagar» (decisión de producto 2026-08-20), en sus dos frases —«una
  liquidación nunca supera el importe pendiente» y «un sobrepago no convierte
  la deuda en otra de dirección contraria»— (§9, §12); el contrato heredado
  de F3 de `api.record_settlement_by_transfer` (migraciones `20260826205500`,
  `20260829120500`, `20260911120000`, `20260912150000`): sólo el deudor,
  tope `SETTLEMENT_EXCEEDS_DEBT`, corrección por versión, alta unilateral;
  y `data-model.md` §4.6 y §8 en su forma (de «ordenada por A» a propuesta +
  aceptación).
- **No supera** `data-model.md` §3 para `group_payment`, `record_debt_settlement`,
  `participant_settlement` ni para las correcciones y anulaciones de gastos
  («la corrección de un gasto tampoco puede sobrepasarlo»): todo eso sigue
  exactamente igual, incluidas las guardas `SETTLEMENT_EXCEEDS_DEBT` y
  `PAYMENT_NOT_APPLICABLE`.
- **Precisa** [F01/ADR-001](../F01/ADR-001-accounting-model.md) §10 como
  F12/ADR-002 (dos voluntades cuando no hay declaración unilateral que
  proteger), y aclara por qué F09/ADR-007 «Alternativas» sigue siendo
  correcto (§8).
- **Conserva** [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) §5–§6 (ambos
  extremos activos ahora, sea cual sea la fecha), [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)
  íntegro (C1–C8: «Saldado», anulación, salida a neto cero, novación),
  [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md),
  [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md) y
  [F10/ADR-002](../F10/ADR-002-permanent-identity.md) / [F10/ADR-003](../F10/ADR-003-active-and-historical-link.md)
  (el vínculo participante ↔ cuenta es permanente; salir lo termina; volver
  lo reactiva con el mismo participante), [F03/ADR-009](../F03/ADR-009-participant-identity.md)
  (los efectos nombran participantes), [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md)
  §9 y §11 (proyección canónica; bloqueos antes de leer; el cerrojo de
  identidad de rango 1 de la migración `20260912150000`), [F06/ADR-002](../F06/ADR-002-version-content-and-time.md)
  (sin concepto en la versión) y [F11/ADR-001](../F11/ADR-001-fx-rate-resolution.md)
  §4 (`settlement_by_transfer` no convierte).

## Contexto

### Lo que hay, medido (2026-09-17, `main` en `e83988e`)

**La deuda de un grupo ya es algebraica.** Un gasto escribe efectos de deuda
`+importe` con `(deudor, acreedor)`; toda liquidación escribe `−importe` sobre
el mismo par y dirección. `sec.net_debt(scope, d, c)` suma `+` en `d→c` y `−`
en `c→d` sobre `core.current_effect`; su comentario de catálogo dice:
«**Negativo = se liquidó más de lo debido**». `sec.pending_debt` es
`greatest(net, 0)`. `api.group_pending_pair` enumera **ambas direcciones** y
publica la positiva: un par `Aitor→Eduardo` con neto −2 **aflora como
`Eduardo→Aitor 2`** («un crédito del otro lado y aflora invertido», migración
`20260912170000`). Los netos por persona (`api.group_balance`,
`sec.group_positions_text`, `api.group_summary`, `api.claimed_dimension`)
son Σ(como acreedor) − Σ(como deudor): un `settlement −80` sobre
`Aitor→Eduardo` deja a Aitor con +80 y a Eduardo con −80 respecto a antes.
F09/ADR-007 C4 convirtió el par invertido en un estado legítimo del modelo —al
anular un pago apoyado en una novación— y Pagos sugeridos lo cierra por
caminos. **Nada de esto se inventa aquí.**

**Los tres writers de deuda, tal como están:**

|                                | `record_group_payment` («Saldado», F9)                                                                         | `record_settlement_by_transfer` (F3)                  | `record_debt_settlement` (F3)     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| Efectos                        | `transfer` ∓X en los dos Personales (o sólo en el que existe, C7) + `settlement` por par o camino + `novation` | `transfer` ∓N + `settlement` −N en el **par directo** | sólo `settlement` −N, par directo |
| Quién                          | pagador **o** receptor vinculado; sin exigir membresía                                                         | **sólo el deudor** (medido, `NOT_AUTHORIZED`)         | cualquier miembro                 |
| Voluntades                     | una (declaración); la otra parte puede anular                                                                  | una                                                   | una                               |
| Sobrepago                      | `PAYMENT_NOT_APPLICABLE` (`net(pagador) ≤ −X ∧ net(receptor) ≥ +X`)                                            | `SETTLEMENT_EXCEEDS_DEBT`                             | `SETTLEMENT_EXCEEDS_DEBT`         |
| Ambos activos ahora            | sí                                                                                                             | sí (`assert_participant_active`)                      | sí                                |
| Rango 1 (cerrojo de identidad) | sí                                                                                                             | sí (`20260912150000`)                                 | sí                                |
| Editable                       | no (`PAYMENT_NOT_EDITABLE`)                                                                                    | **sí** (medido)                                       | sí                                |
| Anulable                       | por las partes (`payment_detail`)                                                                              | por nadie (membresía en los dos Personales)           | por miembros                      |
| Partes persistidas             | `payment_detail`, `payment_allocation`                                                                         | no                                                    | no                                |
| CAS de netos                   | sí (`SETTLEMENT_STALE`)                                                                                        | no                                                    | no                                |
| Concepto                       | no                                                                                                             | no                                                    | no                                |
| UI                             | sí                                                                                                             | no                                                    | no                                |

**La guarda por delta de correcciones** (`20260914150000`) ya convive con
pares negativos: sólo rehúsa una corrección o anulación de gasto que deje el
neto del par «por debajo de cero **y** peor que la versión vigente». Un par
en negativo no rompe nada; sólo impide empeorarlo desde el gasto.

**La salida de un grupo** (`api.leave_group`, cuerpo vivo `20260918120000`)
exige neto cero, nova los pares vivos, cierra la presencia, inserta
`core.group_departure (scope_id, participant_id, user_id, left_at, …)`
—insert-only— y termina el vínculo (F10/ADR-003). No lee ninguna otra
relación. La reincorporación (`redeem_invitation` con `rejoin`) reactiva el
**mismo** vínculo y abre un periodo desde hoy; la salida registrada no se
borra.

### Por qué una transferencia de grupo, y por qué no basta «Saldado»

«Saldado» (F09/ADR-007) es una **declaración de una parte** de que un pago
ocurrió fuera, acotada a lo que la deuda sostiene, descompuesta por caminos y
anulable por la otra parte. Sirve para cerrar lo que Pagos sugeridos propone.
No sirve para lo que el producto pide ahora: que dos personas de un grupo
**acuerden** un movimiento de valor entre sus Personales que además ajuste su
relación de deuda **por el importe entero**, aunque supere lo pendiente o no
haya nada pendiente. Eso exige dos voluntades, un par directo, y aceptar que
la deuda cruce cero, tres cosas que «Saldado» no puede ni debe hacer.

Y la clase para eso ya existe: `settlement_by_transfer` es, desde F3,
«transferencia + liquidación en una operación» (F01/ADR-001 §3, escenario
4.6), con la forma física exacta que hace falta. Lo que le faltaba era el
contrato de dos voluntades y quitarle el tope.

## Decisión

### §1 · Objetivo

> Dentro de un Grupo, un miembro puede **proponer** enviar N a otro
> participante del mismo grupo. Sólo cuando el receptor **acepta** nace **una**
> operación `settlement_by_transfer` que, atómicamente, escribe `transfer −N`
> en el Personal del emisor, `transfer +N` en el del receptor y `settlement
−N` sobre el par (emisor → receptor) en ese grupo.

### §2 · Dos voluntades (hereda F12/ADR-002 §3)

| Voluntad    | Quién | Qué autoriza                                                                                                      |
| ----------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| **Primera** | A     | La salida de **su** Personal; destinatario, grupo, participantes, importe, moneda y concepto **fijos**            |
| **Segunda** | B     | La entrada en **su** Personal, la modificación de la relación de deuda A↔B **en ese grupo**, y la materialización |

Antes de la segunda no existe `settlement_by_transfer`, ni efectos, ni cambio
en ningún Personal ni en la deuda. La propuesta es intención, no ledger.

### §3 · Selección del receptor

```
Grupo → + → Transferencia → participante del grupo → importe
      → concepto opcional → Enviar propuesta
```

**No** se escribe un `@username`: sólo se elige entre los participantes
elegibles (§5) **de ese grupo**. Quedan fuera: usuarios externos, contactos,
búsqueda global, participantes sin cuenta y uno mismo.

### §4 · Identidad fijada al crear

La propuesta persiste internamente `created_by` (uid de A), `target_user_id`
(uid de B), el grupo, `sender_participant_id` y `receiver_participant_id`
—los participantes **vinculados** a esos dos uids en ese grupo en el momento de
crear—. Después, cambiar o reutilizar un username no cambia nada, y nunca se
vuelve a resolver un texto para decidir quién acepta (F12/ADR-001 §1,
F12/ADR-002 §4). Como el vínculo participante ↔ cuenta es **permanente**
(F10/ADR-002) y una salida lo termina sin borrarlo ni reasignarlo
(F10/ADR-003), los cuatro ids describen la misma pareja de personas para
siempre.

### §5 · Elegibilidad, al crear y al aceptar

«Participante elegible» es exactamente lo que F9/F10 ya definen, sin semántica
nueva de presencia:

- **activo**: con periodo de presencia abierto (`valid_until` nulo) —el mismo
  `sec.assert_participant_active` de las dos liquidaciones, F09/ADR-003 §6:
  «ambos extremos activos **ahora**, sea cual sea la fecha»—;
- **con cuenta vinculada** (`core.participant_user_link` activo, F10/ADR-003) y
  cuyo vínculo corresponde al uid persistido;
- del **mismo grupo**;
- **no retirado** (F09/ADR-005) y **no origen fusionado** (`PARTICIPANT_MERGED`,
  F09/ADR-009 y F10/ADR-004);
- **no anónimo** (JWT sin `is_anonymous`), como en F12/ADR-002 §5.

Se comprueba **dos veces**: al crear la propuesta y al aceptarla, ambas bajo el
cerrojo de identidad de rango 1 del grupo (`sec.lock_participant_claims`,
`20260912150000`), que es donde el modelo lee y cambia membresía, vínculo y
presencia. Rechazos: `PARTICIPANT_INACTIVE · 422`, `PARTICIPANT_RETIRED`,
`PARTICIPANT_MERGED`, `NOT_AUTHORIZED · 403` (no miembro, participante ajeno
al grupo o no vinculado), `PAYLOAD_INVALID · 400` (a uno mismo),
`USERNAME_REQUIRED · 409` y `USERNAME_GUEST_NOT_ALLOWED · 409` (F12/ADR-001
§7–§8: sin username reclamado no se opera entre usuarios).

### §6 · Salida del grupo con propuesta pendiente

> Si el emisor o el receptor **salen del grupo** mientras la propuesta sigue
> **`pending`**, la propuesta queda **terminalmente invalidada**. No revive
> aunque esa persona vuelva. Una salida **posterior a un estado terminal** no
> cambia nada: una propuesta `accepted`, `declined`, `cancelled · creator` o
> `expired` sigue exactamente así aunque cualquiera de los dos salga después.

Se **deriva**, sin acoplar `leave_group` a nada, con esta condición exacta:

> **`cancelled · departure`** ⇔ la propuesta **no tiene ninguna marca
> terminal** (`accepted_operation_id`, `declined_at` y `cancelled_at` nulos)
> **y** existe una fila en `core.group_departure` de `sender_participant_id` o
> de `receiver_participant_id` en ese grupo con
> **`proposal.created_at < left_at < proposal.expires_at`**.

Es decir: la salida sólo cuenta si ocurrió **en la ventana en la que la
propuesta estaba pendiente** —después de crearse, antes de caducar y sin que
nadie la hubiera terminado antes—. Las salidas son insert-only y no se borran
al volver, así que la condición es monótona y terminal.

**Precedencia de derivación** (la primera que se cumpla decide):

1. `accepted` ⇔ `accepted_operation_id ≠ null`;
2. `declined` ⇔ `declined_at ≠ null`;
3. `cancelled · creator` ⇔ `cancelled_at ≠ null`;
4. `cancelled · departure` ⇔ la condición de arriba;
5. `expired` ⇔ `now() ≥ expires_at`;
6. `pending` en otro caso.

Las marcas explícitas van **antes** que la salida porque son irreversibles y
sólo pueden haberse escrito **mientras no había salida en la ventana**: las
tres transiciones que escriben una marca —aceptar, rechazar, cancelar—
comprueban esa misma condición **bajo el cerrojo de identidad del grupo
(rango 1)**, el que `leave_group` también toma, y se rehúsan con
`PROPOSAL_CANCELLED` si ya hay una salida en la ventana. Así **salir y
terminar una propuesta se serializan**: el primero en confirmar decide, y el
segundo ve el estado que dejó el primero. La salida, por su parte, no lee
propuestas: exige neto cero y, si una aceptación entró antes, ese neto ya
incluye el `settlement`.

En la interfaz se presenta como **`cancelled` con motivo `departure`**, frente
a `creator` cuando la canceló el emisor. No se introduce un estado
`invalidated`: el motivo es un atributo de presentación derivado, y el emisor
lo necesita («Aitor salió del grupo» no es «Aitor rechazó»).

La transferencia desde el Personal (F12/ADR-002) no tiene contexto que
perder y no cambia.

### §7 · La clase contable: `settlement_by_transfer`

La operación materializada es de clase **`settlement_by_transfer`**, la que
F3 escribió para el escenario 4.6 y F01/ADR-001 §3 nombra («una misma
operación puede contener ambas —"pagar deuda mediante transferencia"—»).
Representa exactamente lo que hace falta: `transfer −N`, `transfer +N` y
`settlement −N` sobre el par directo, en una operación. Lo que este ADR le
cambia es el contrato, no la forma.

Por qué **no** las otras:

- **No es `group_payment`.** Es una declaración de una parte, acotada por
  netos, descompuesta por caminos y novación, y anulable por la otra parte.
  Reutilizarla obligaría a un writer con dos autorizaciones, dos reglas de
  tope y dos políticas de anulación. Y el producto la conserva tal cual (§8).
- **No es `internal_transfer`.** No toca deuda. Quien vea el `settlement` en
  el grupo debe poder interpretarlo como lo que es (F03/ADR-010 §2: la clase
  es lo que da sentido al efecto propio), y una transferencia personal con
  «un efecto de grupo pegado» rompería «una función por clase» (F03/ADR-006
  §1) o la visibilidad de clase.
- **No es `record_debt_settlement`.** Sólo deuda, sin caja; es el escenario
  4.5, que F9 dejó sin superficie y este ADR no toca.

### §8 · Diferencia con `group_payment` («Saldado»), y por qué conviven

|                | **Saldado** (`group_payment`, F09/ADR-007)                      | **Transferencia de grupo** (`settlement_by_transfer`, este ADR) |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Naturaleza     | Declaración de **una** parte de un pago hecho fuera             | **Dos voluntades**: propuesta + aceptación                      |
| Quién          | Pagador o receptor                                              | Propone el emisor; acepta el receptor                           |
| Deuda          | Reduce lo que el grafo sostiene: par directo, caminos, novación | `settlement −N` sobre el **par directo**, siempre               |
| Tope           | `PAYMENT_NOT_APPLICABLE` si excede los netos                    | **Sin tope**: importe completo, puede cruzar cero               |
| Reversibilidad | Anulable por las partes (remedio a una declaración unilateral)  | **Irreversible** (las dos partes consintieron)                  |
| Desde dónde    | Pagos sugeridos y Saldos                                        | `Grupo → + → Transferencia`, **no** desde Pagos sugeridos (§26) |

**Nada cambia en `group_payment`.** Y F09/ADR-007 «Alternativas» —que
rechazó «reutilizar `record_settlement_by_transfer`» para el pago declarado
porque «mezcla la transferencia ordenada de F12 con el hecho declarado»—
**sigue siendo correcto**: F9 no quiso usar esta clase para un flujo
unilateral y declarativo, y F12 la usa para su propósito propio, con dos
voluntades. Son dos capacidades distintas del grupo, y las dos existen.

### §9 · Sobrepago algebraico

> La transferencia de grupo aceptada aplica el **importe completo** a la
> relación de deuda: un único efecto `settlement −N` sobre el par
> `(sender_participant_id → receiver_participant_id)`. **No** `min(N, deuda)`,
> **no** partir en «78 saldados + 2 de otra cosa».

El neto del par hace el resto con la convención existente: si queda negativo,
las lecturas lo publican en la dirección contraria (§«Lo que hay, medido»).

### §10 · Ejemplo contractual principal

Aitor debe 78 a Eduardo. Aitor propone 80 a Eduardo; Eduardo acepta.

```
Personal Aitor      transfer   −80
Personal Eduardo    transfer   +80
Grupo               settlement −80   sobre (Aitor → Eduardo)

net_debt(Aitor, Eduardo):  78 − 80 = −2
api.group_pending_pair:    Eduardo → Aitor · 2
Saldos:                    Aitor +2 · Eduardo −2
```

**Eduardo debe 2 a Aitor en ese grupo.** Es correcto: los dos lo aceptaron.

### §11 · Otros casos

| Antes         | Transferencia A → B | `settlement` | `net_debt(A, B)` | Resultado visible |
| ------------- | ------------------- | ------------ | ---------------- | ----------------- |
| A debe 20 a B | 5                   | −5           | 15               | A debe 15 a B     |
| A debe 20 a B | 30                  | −30          | −10              | **B debe 10 a A** |
| A y B a cero  | 15                  | −15          | −15              | **B debe 15 a A** |
| B debe 10 a A | 5 (A → B)           | −5 sobre A→B | −15              | B debe 15 a A     |

La última fila muestra que la dirección del `settlement` es siempre la de la
transferencia (emisor → receptor) y el neto del par absorbe la deuda previa en
cualquier sentido: todo es una suma.

### §12 · Supersesión acotada de `data-model.md` §3

`data-model.md` §3 («Una liquidación no puede sobrepagar», decisión de
producto 2026-08-20) dice: «Una liquidación nunca supera el importe pendiente
de esa deuda… Un sobrepago **no convierte la deuda en otra de dirección
contraria**… Confundirlos haría que una obligación inexistente apareciera de
la nada.»

**Este ADR supera esa regla únicamente para `settlement_by_transfer` cuando
nace de una propuesta aceptada por ambas partes.** El motivo escrito de la
regla es de **unilateralidad**: una sola persona no debe poder crear una
obligación inversa. Aquí la obligación inversa no aparece de la nada: la crean
**dos** voluntades explícitas sobre importe, dirección, participantes y grupo.
Desaparece la causa, desaparece la regla, sólo ahí.

**Sigue vigente, sin cambios**, para: `group_payment` (`PAYMENT_NOT_APPLICABLE`),
`record_debt_settlement` y `participant_settlement` (`SETTLEMENT_EXCEEDS_DEBT`),
y para las **correcciones y anulaciones de gastos** («la corrección de un
gasto tampoco puede sobrepasarlo», guarda por delta de `20260914150000`).

### §13 · Efectos

Al aceptar, **una** operación, **una** versión `record`, exactamente tres
efectos:

| Ámbito                | Clase contable | Dimensión                    | Importe |
| --------------------- | -------------- | ---------------------------- | ------- |
| Personal del emisor   | `transfer`     | saldo                        | −N      |
| Personal del receptor | `transfer`     | saldo                        | +N      |
| Grupo                 | `settlement`   | deuda, par emisor → receptor | −N      |

Sin `expense`, sin `income`, sin `split`, sin categoría, sin `novation` (la
novación es de la descomposición por caminos de F09/ADR-007 y de la salida a
cero; aquí el par es directo y no hay nada que reasignar). Sin efecto
económico: nadie gastó ni ingresó.

**Medido que el modelo interpreta bien el signo:** `net_debt` negativo,
`pending_debt` a cero, `group_pending_pair` invertido, netos por persona por
suma, `claimed_dimension` (deudor negativo, acreedor positivo) y la guarda por
delta. Es el mismo estado que F09/ADR-007 C4 ya produce y lee.

### §14 · Atomicidad

> **Invariante:** al aceptar, o se escriben los tres efectos, las partes y
> `accepted_operation_id`, o no se escribe nada. **Nunca** existen Personales
> movidos sin deuda, deuda movida sin Personales, una propuesta `accepted` sin
> operación, una operación de esta vía sin propuesta `accepted`, ni dos
> operaciones para una propuesta.

Mecanismos: una única transacción; `accepted_operation_id` **único**; bloqueo
de la fila de la propuesta antes de leer nada; orden de cerrojos **clave de
idempotencia → fila de la propuesta → cerrojo de identidad del grupo (rango 1)
→ ámbitos (grupo y los dos Personales, en el orden global ascendente)**. Es
el orden que ya siguen las liquidaciones de F9, con la propuesta delante del
rango 1, y ninguna función toma un ámbito antes que una propuesta: sin ciclo
posible.

### §15 · Autoría (hereda F12/ADR-002 §12)

`proposal.created_by = A`, `target_user_id = B`, `operation.created_by =
operation_version.created_by = B`: B **registró** la operación; **no** es el
emisor. Los roles económicos A → B viven en las partes, en
`sender_participant_id` / `receiver_participant_id` y en los efectos. Ninguna
vista deriva emisor o receptor de `created_by`; las policies `created_by =
actor` siguen intactas.

### §16 · Partes persistidas

La versión de registro persiste, por ids internos y en relación propia: el
Personal de salida, el de entrada, el grupo, `sender_participant_id` y
`receiver_participant_id`. Nunca username ni `public_name`. Con ello, y con
F12/ADR-001 §13 (`uid → identidad pública actual`), las lecturas responden sin
ambigüedad:

```
Aitor:    «Enviaste 80 € a Eduardo»
Eduardo:  «Recibiste 80 € de Aitor»
Grupo:    «Transferencia · Aitor → Eduardo · 80 €»
```

y Saldos y Deudas se actualizan en el acto, de modo que sea evidente que la
transferencia afectó a la deuda.

### §17 · Ciclo de vida

```
pending ──► accepted              receptor; terminal
   ├────► declined                receptor; persistido; terminal
   ├────► cancelled · creator     emisor, mientras pending; terminal
   ├────► cancelled · departure   derivado de una salida posterior (§6); terminal; no revive
   └────► expired                 7 días; terminal
```

`pending` no tiene efectos. Estado derivado, como en F12/ADR-002 §8, con la
precedencia de §6: **ninguna transición terminal puede ser reemplazada por
otra**, y una salida sólo invalida lo que seguía pendiente en su momento
lógico.

### §18 · Concurrencia

| Caso                              | Invariante                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aceptar vs cancelar (creador)     | Misma fila bloqueada; el primero decide; el otro `PROPOSAL_ACCEPTED` / `PROPOSAL_CANCELLED`                                                                                                                                                                                                       |
| Aceptar vs rechazar               | Ídem                                                                                                                                                                                                                                                                                              |
| **Aceptar vs salida**             | Ambas toman el rango 1: serializadas. Aceptación primero → `accepted`, y una salida posterior no lo cambia (el neto que la salida evalúa ya incluye el `settlement`). Salida primero, con la propuesta pendiente → `cancelled · departure`, y la aceptación posterior recibe `PROPOSAL_CANCELLED` |
| **Rechazar o cancelar vs salida** | Misma regla: rechazar y cancelar toman el rango 1 y comprueban la ventana. Terminan primero → `declined` / `cancelled · creator`, intocables después. Salida primero → `cancelled · departure`, y el rechazo o la cancelación posteriores reciben `PROPOSAL_CANCELLED`                            |
| **Caducada, y después salida**    | `expired`: la salida cae fuera de la ventana (`left_at ≥ expires_at`) y no invalida nada                                                                                                                                                                                                          |
| Doble aceptación                  | Dos claves: el segundo espera, ve `accepted`, `PROPOSAL_ACCEPTED`; **una** operación                                                                                                                                                                                                              |
| Dos dispositivos del receptor     | Ídem                                                                                                                                                                                                                                                                                              |
| Retry                             | Misma clave: replay (`already_processed`), sin segunda escritura                                                                                                                                                                                                                                  |
| Caduca durante la aceptación      | Comprobación bajo bloqueo: `PROPOSAL_EXPIRED`; nada escrito                                                                                                                                                                                                                                       |

### §19 · TTL

**7 días**, fijo, sin prórroga. Expirada → otra propuesta.

### §20 · Anti-spam (hereda F12/ADR-002 §18)

- **3 `pending` por `(created_by, target_user_id, grupo)`**; las propuestas
  desde el Personal no cuentan aquí ni al revés. `PROPOSAL_LIMIT_PER_TARGET · 409`.
- **10 propuestas creadas / 60 minutos por emisor, presupuesto compartido**
  con las del Personal. `PROPOSAL_RATE_LIMITED · 429`. Un solo contador.
- Los rechazos no frenan. Sin bloqueo social.

### §21 · Pendiente y saldo

Mientras `pending`: ni Personales, ni deuda, ni reserva, ni bloqueo, ni
efectos. Al aceptar se ejecuta **aunque el Personal del emisor quede
negativo**: sin validación de fondos (F12/ADR-002 §15).

### §22 · Moneda

Los tres efectos comparten moneda por estructura: el `settlement` lleva la
base del grupo (FK compuesta `effect (scope, currency) → scope (id, base)`), y
cada `transfer` la base de su Personal. Por tanto la propuesta **fija al
crear** la moneda como la **base del grupo**, y la aceptación exige que la
base del Personal del emisor **y** la del receptor coincidan con ella; si no,
`CURRENCY_CONVERSION_UNSUPPORTED · 422`, sin escribir. Es la misma triple
negativa que `record_settlement_by_transfer` ya tiene, y la limitación que
F11 dejó escrita como conocida («liquidar entre bases distintas sigue sin
poderse»). **No se abre ninguna conversión**; F11/ADR-001 §4 conserva su
autoridad.

### §23 · Fecha efectiva

La de la **aceptación** (fecha de servidor). Nunca una fecha elegida al
proponer: además de que la operación no existe antes, una fecha retroactiva
permitiría esquivar la elegibilidad de presencia (§5). Con esto, la
elegibilidad por fecha (F03/ADR-009 §7) y «ambos activos ahora» (F09/ADR-003
§6) coinciden en el mismo instante.

### §24 · Concepto

Opcional, **sólo en la propuesta**; no se copia a `operation_version`
(F06/ADR-002). El contrato heredado de `settlement_by_transfer` **no tenía
concepto** (payload medido: sin `concept`), así que no hay semántica
incompatible que superar. Las vistas del grupo y de los Personales lo enseñan
como contexto derivado de la propuesta aceptada.

### §25 · Irreversibilidad (hereda F12/ADR-002 §16)

La `settlement_by_transfer` materializada es **no editable, no corregible por
versión y no anulable**: una única versión `record`. Corrección →
`TRANSFER_NOT_EDITABLE · 422`; anulación por cualquiera →
`OPERATION_NOT_ANNULLABLE · 422`, con respaldo en `sec.persist_version`.
Compensar es otra operación (otra propuesta aceptada, o un «Saldado» si
procede). Esto supera el contrato de F3, que admitía corrección (medido).

**Consecuencia sobre el gasto original, que ya existe hoy y conviene decir:**
tras un sobrepago, el par queda en negativo, y la guarda por delta rehúsa
**reducir o anular** el gasto que lo sostenía por ese par
(`SETTLEMENT_EXCEEDS_DEBT`), como ya ocurre con cualquier par totalmente
liquidado. Subirlo o cambiar sólo concepto y categoría sigue permitido.

### §26 · Relación con Pagos sugeridos

La transferencia de grupo se ofrece **sólo** desde `Grupo → + →
Transferencia`. Pagos sugeridos sigue orientado a «Saldado» (`group_payment`)
y no la propone. No se mezclan las dos experiencias.

### §27 · `record_debt_settlement`

Sigue con su contrato (sólo deuda, cualquier miembro, tope
`SETTLEMENT_EXCEEDS_DEBT`), sin UI en F12 y sin redefinición aquí.

### §28 · `api.settle_participant`

Su retirada técnica (F09/ADR-007 «Decisiones cerradas y pendientes» §4) sigue
siendo tarea del cierre de F12. Este ADR no la hace; sólo anota que
`leave-and-settle.sql` y `retire-participant.sql` cambiarán entonces.

### §29 · Capacidades de un Grupo tras F12

**Gasto** (economía compartida) · **Saldado** (`group_payment`, declaración
bajo F09/ADR-007) · **Transferencia** (propuesta de dos voluntades →
`settlement_by_transfer`, Personales + deuda algebraica). Nada más: sin
solicitud de dinero dentro del grupo, bote común, préstamos, pagos
programados ni transferencias múltiples.

### §30 · Supersesiones y precisiones, exactamente

| Fuente                                                                                     | Tipo                    | Qué                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-model.md` §3 «Una liquidación no puede sobrepagar»                                   | **supersesión acotada** | Sólo para `settlement_by_transfer` nacida de propuesta aceptada; intacta para todo lo demás                                                                                   |
| `data-model.md` §4.6                                                                       | supersesión de forma    | De «ordenada por A» a propuesta + aceptación; sin tope; mismos tres efectos                                                                                                   |
| `data-model.md` §8, fila «Pagar deuda mediante transferencia»                              | supersesión de forma    | Dos voluntades; propone el deudor o cualquier miembro elegible; acepta el receptor                                                                                            |
| F01/ADR-001 §10                                                                            | precisión               | Como F12/ADR-002: dos voluntades donde no hay ámbito que dé derecho unilateral **sobre el Personal ajeno**; la deuda del grupo sigue siendo inmediata para gastos y «Saldado» |
| Invariante 14                                                                              | herencia                | F12/ADR-002 §13                                                                                                                                                               |
| Contrato F3 de `api.record_settlement_by_transfer`                                         | supersesión             | Sin «sólo el deudor», sin tope, sin corrección, sin alta unilateral; nace de una propuesta                                                                                    |
| F09/ADR-007 «Alternativas» (no reutilizar `settlement_by_transfer` para el pago declarado) | conservado              | Correcto entonces y ahora: F9 no la quiso para un flujo unilateral; F12 la usa para el suyo (§8)                                                                              |
| F09/ADR-003 §6, F09/ADR-008, F10/ADR-003                                                   | conservados             | Ambos activos ahora; obligación del salido intocable; salir termina el vínculo; volver no revive la propuesta                                                                 |

## Alternativas consideradas

- **Reutilizar `group_payment` con una bandera «aceptada».** Rechazada: dos
  autorizaciones, dos topes y dos políticas de anulación en un writer; y el
  producto conserva «Saldado» tal cual.
- **`internal_transfer` más un efecto de deuda.** Rechazada: la clase visible
  en el grupo tiene que decir «liquidación», y rompería una función por
  clase.
- **Clase nueva (`group_transfer`).** Rechazada: `settlement_by_transfer` es
  exactamente esa forma desde F3, con vectores; una clase nueva duplicaría
  vocabulario.
- **Tope `min(N, pendiente)` o dividir en «saldado + puro».** Rechazadas: la
  decisión de producto es algebraica; dividir crearía un `original_amount` que
  el grupo no puede publicar sin exponer el exceso (medido en la apertura de
  F12: un miembro lee el importe de la versión por cualquier vista `api` que
  lo publique).
- **Descomponer por caminos como «Saldado».** Rechazada: el producto pide
  ajustar la relación **entre esos dos**; los caminos son de la declaración.
- **Ofrecerla desde Pagos sugeridos.** Rechazada por producto: dos mecanismos
  para un mismo botón confundirían.
- **Mantener la propuesta viva tras una salida y permitir aceptar al volver.**
  Rechazada: una intención hecha en un contexto no debe revivir cuando el
  contexto se rompió; y se deriva sin tocar `leave_group`.
- **Actualizar propuestas desde `leave_group`.** Rechazada: acoplamiento
  innecesario; el historial de salidas ya dice todo.
- **Estado `invalidated`.** Rechazada: `cancelled · departure` lo expresa sin
  ampliar la máquina de estados.
- **Fecha efectiva elegida al proponer.** Rechazada: la operación no existe
  aún, y abriría un atajo a la elegibilidad por fecha.
- **Aplicar el sobrepago también a `group_payment` o `debt_settlement`.**
  Rechazada: allí sigue habiendo una sola voluntad, y la regla de §3 protege
  exactamente eso.

## Consecuencias

### A favor

- Dos personas de un grupo pueden acordar un movimiento de valor que ajuste su
  relación por el importe entero, sin inventar «obligaciones de la nada»:
  las crean las dos.
- No hay clase, convención de signo ni lectura nueva: todo lo que publica
  deuda ya interpreta el par negativo.
- «Saldado» y Pagos sugeridos no cambian ni una línea.
- La invalidación por salida no acopla nada: se deriva de un hecho que ya se
  escribe.

### En contra

- **Dos formas de reducir una deuda en un grupo** («Saldado» y
  «Transferencia»), con reglas distintas. La UI las separa por punto de
  entrada; explicar la diferencia es coste de producto.
- **Tras un sobrepago, el gasto original no puede reducirse ni anularse por
  ese par** mientras el neto siga negativo (guarda por delta). Es la regla de
  §3 para gastos, no un efecto nuevo, pero se notará más.
- **Bases monetarias distintas siguen bloqueando** la transferencia de grupo,
  como bloquean «Saldado»: F11 lo dejó fuera y aquí no se abre.
- **Sin remedio unilateral**: un error aceptado se compensa con otra
  operación acordada.
- **Una propuesta puede morir por la salida de la otra parte**, y el emisor la
  verá cancelada por un motivo que no controla.
- Cambio de contrato de F3 en `record_settlement_by_transfer`: reescribir
  las secciones de `authoritative-writer-debt.sql` que ejercitan el tope
  (`SETTLEMENT_EXCEEDS_DEBT` de esta clase), la corrección y el alta directa;
  el escenario 4.6 de `tests/vectors/scenarios.json` conserva sus efectos y
  cambia su origen.

### Evidencia que exige este ADR al implementarse

1. Crear una propuesta de grupo no crea operación, versión ni efecto; ni
   Saldos ni Deudas cambian.
2. Sólo participantes **activos y vinculados** del grupo pueden crear y
   recibir: externos, fantasmas, retirados, orígenes fusionados y anónimos
   rechazados con su código; a uno mismo `PAYLOAD_INVALID`.
3. Tope de pareja por grupo: tres `pending` permitidas, la cuarta
   `PROPOSAL_LIMIT_PER_TARGET`; independiente del tope Personal.
4. Presupuesto **compartido**: nueve propuestas de grupo más una del Personal
   agotan la hora; la siguiente `PROPOSAL_RATE_LIMITED`.
5. Salida del **emisor** y salida del **receptor** con la propuesta pendiente
   invalidan; se lee como `cancelled · departure`; **volver** (`rejoin`) no
   revive; aceptar, rechazar o cancelar después → `PROPOSAL_CANCELLED`. Y la
   precedencia: una salida **posterior** a `accepted`, `declined`,
   `cancelled · creator` o `expired` **no cambia** ese estado (seis casos
   medidos: accept → departure, departure → accept, decline → departure,
   departure → decline, cancel → departure, expired → departure).
6. Sólo `target_user_id` acepta o rechaza; sólo `created_by` cancela.
7. Carreras con dos sesiones reales: aceptar vs cancelar, aceptar vs rechazar,
   **aceptar vs `leave_group`**, **rechazar vs `leave_group`** y **cancelar vs
   `leave_group`** (los dos órdenes cada una), doble aceptación, retry: una
   única transición terminal, a lo sumo una operación, y el estado final es el
   del primero en confirmar.
8. TTL 7 días; aceptar una caducada `PROPOSAL_EXPIRED`.
9. La aceptación produce **exactamente** `transfer −N`, `transfer +N` y
   `settlement −N` sobre `(sender → receiver)`, una versión, todo atómico;
   `accepted_operation_id` único.
10. Álgebra, medida en `net_debt`, `group_pending_pair`, `group_balance` y
    `claimed_dimension`: 78 + 80 → `Eduardo→Aitor 2`; 20 + 5 → 15; 20 + 30 →
    inversa 10; 0 + N → inversa N; deuda previa inversa + transferencia → suma.
11. `group_payment` sigue rehusando el exceso (`PAYMENT_NOT_APPLICABLE`);
    `record_debt_settlement` sigue rehusando (`SETTLEMENT_EXCEEDS_DEBT`); la
    guarda por delta sigue rehusando reducir o anular el gasto de un par en
    negativo.
12. `operation.created_by = operation_version.created_by = target_user_id`;
    partes: Personal de `created_by` de la propuesta como salida, del
    aceptante como entrada, `sender/receiver_participant_id` correctos.
13. Pendiente no cambia saldos ni deuda; aceptar con el emisor en negativo se
    ejecuta.
14. Base del grupo ≠ base de un Personal → `CURRENCY_CONVERSION_UNSUPPORTED`,
    sin escritura.
15. Corrección → `TRANSFER_NOT_EDITABLE`; anulación por emisor y por receptor
    → `OPERATION_NOT_ANNULLABLE`; una sola versión.
16. Lecturas: «Enviaste/Recibiste» y la fila del grupo derivadas de partes y
    efectos, nunca de `created_by`; tras un cambio de username de una parte,
    las filas muestran el handle nuevo.
17. `group-identity-lock.sql` enumera el writer y el comando de creación entre
    las funciones que toman el rango 1 antes de leer identidad.
18. Frontera HTTP con JWT real: crear, aceptar, rechazar, cancelar, salida e
    invalidación, replay y los rechazos de §5, §22 y §25; ninguna respuesta
    publica `uid` ni `scope_id` ajenos.

## Documentación que este ADR obliga a reconciliar

- `docs/architecture/data-model.md`: §3 (nota de supersesión acotada), §4.6
  (propuesta + aceptación, sin tope), §8 (fila «Pagar deuda mediante
  transferencia»), §11 invariante 14 (herencia de F12/ADR-002).
- `docs/adr/F01/README.md`: nota sobre F01/ADR-001 §10 (junto a la de
  F12/ADR-002).
- `docs/adr/F09/README.md`: nota en F09/ADR-007 («Alternativas» sigue
  vigente; `settlement_by_transfer` es ahora la transferencia de grupo de
  F12; «writer de F11» era una expectativa, no una decisión).
- `docs/adr/F03/README.md`: contrato heredado de `record_settlement_by_transfer`
  superado.
- `docs/product/roadmap.md`, Fase 12: capacidad «Transferir dentro del grupo»
  y criterio 1 (4.6 pasa a propuesta + aceptación).
- `docs/product/glossary.md`: «Transferencia de grupo», «Propuesta de
  transferencia».
- `docs/adr/F12/README.md`: línea de alcance.
- `AGENTS.md` §2/§3 y `docs/PROJECT_STATE.md` al cerrar el bloque que lo
  implemente.
