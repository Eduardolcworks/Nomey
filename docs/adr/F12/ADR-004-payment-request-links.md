# F12/ADR-004 — Solicitudes de pago mediante enlace

- **Estado:** Aceptado (2026-09-17)
- **Fecha:** 2026-09-17
- **Alcance:** cómo un usuario crea desde su Modo Personal una **solicitud de
  pago** con importe fijo y concepto opcional, la comparte como **enlace opaco
  al portador**, y cómo quien lo abre la **paga**, materializando una
  `internal_transfer` del pagador al solicitante. Fija la naturaleza de la
  solicitud, quién crea y quién paga, la capability, el ciclo de vida, la
  concurrencia, la materialización, la autoría, las partes, la
  irreversibilidad, la moneda, la previsualización, la privacidad y el
  anti-abuso.
- **No cubre:** la propuesta de envío desde el Personal ni la transferencia
  dentro de un grupo ([F12/ADR-002](ADR-002-two-will-user-transfers.md),
  [F12/ADR-003](ADR-003-group-transfers.md)); `settlement_by_transfer`;
  contactos, teléfono, Open Banking ni dinero bancario real; el deep link
  definitivo y los Universal Links (F8.B); los avisos concretos.
- **Hereda de [F12/ADR-001](ADR-001-username-public-account-identity.md):** la
  identidad pública (`public_name` + `@handle`), la lectura de la identidad actual por `uid` (§13) y la condición «cuenta con username reclamado» para operar.
- **Hereda de [F12/ADR-002](ADR-002-two-will-user-transfers.md):** las dos
  voluntades (§3), la materialización como `internal_transfer` sin grupo ni
  deuda (§11), la autoría (§12), la precisión del invariante 14 (§13), las
  partes por versión (§14), pendiente sin saldo (§15), la irreversibilidad
  (§16), las devoluciones (§17), la moneda (§20) y la fecha de aceptación
  (§21). No los redefine.
- **Se apoya en** [F09/ADR-004](../F09/ADR-004-group-invitations.md) —la
  capability opaca al portador: token de 32 bytes, sólo su hash, caducidad,
  revocación por el creador, previsualización frenada por cuenta que devuelve
  estado y no excepción— como precedente directo, y en
  [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md) (comandos
  de provisioning idempotentes por clave).
- **No supera ningún ADR aceptado**: la capacidad no existía. Precisa dónde
  encaja (§30).

## Contexto

### Lo que hay, medido (2026-09-17, `main` en `e83988e`)

- **No existe nada parecido a una solicitud de pago.** El único mecanismo de
  «enlace que otra persona abre» es la invitación de grupo: `core.group_invitation`
  con `token_hash bytea unique` (SHA-256 de un token de 32 bytes en base64url,
  `sec.new_invitation_token`), `expires_at` (7 días por defecto, 1–30),
  `revoked_at`; enlace `<esquema>://join?t=<token>`; `+native-intent.tsx`
  retira `join` del router; `invitation-arrival.ts` retiene el token **en
  memoria** hasta que haya sesión y se monten las pestañas («sobrevive al
  inicio de sesión»; si la app se reinicia se pide otro); `sec.resolve_invitation`
  es definer, exige sesión, devuelve estado en vez de lanzar y frena a 20
  fallos / 10 minutos por cuenta (`core.invitation_attempt`, poda perezosa).
- **No hay Universal Links**: un esquema `nomey://` sin app instalada no abre
  nada; el enlace HTTPS pulsable desde WhatsApp e instalación limpia son de
  F8.B (roadmap).
- **`api.record_internal_transfer`** es el writer de la clase; su contrato
  heredado y su nuevo contrato están medidos y fijados en F12/ADR-002.
- **`Share.share`** ya se usa para compartir un grupo (`share-group-window.tsx`).
- **Una cuenta anónima** tiene `uid` y Personal pero ni email ni username
  (F12/ADR-001, contexto).

### Por qué una solicitud, y por qué al portador

La propuesta de envío (F12/ADR-002) resuelve «quiero enviarte». Falta la
inversa, «te pido», y la dirección de producto (2026-09-17) la quiere **sin
elegir antes a quién**: crear el importe, obtener un enlace y compartirlo por
donde sea. Eso es una capability al portador, y es segura porque **quien la
posee sólo puede autorizar una salida de su propio Personal**; no obtiene
ningún poder sobre nadie. Si Ana la reenvía a Pablo y Pablo paga, Pablo pagó
voluntariamente y Eduardo cobró: ningún libro ajeno se tocó sin su dueño.

## Decisión

### §1 · Objetivo

```
Personal → Solicitar dinero → importe → concepto opcional → compartir enlace
Quien abre: «Eduardo Álvarez · @eduardo te solicita 25,00 €» · «Cena»
            [Pagar 25,00 €]  [Cancelar]
```

Crear la solicitud **no crea ningún efecto financiero**. Sólo al pulsar Pagar
se materializa una `internal_transfer` del pagador al solicitante.

### §2 · Naturaleza

`payment_request` es una **entidad de intención**. No es deuda, gasto,
ingreso, transferencia, liquidación ni operación pendiente del ledger.
Mientras está `pending`: no cambia ningún Disponible, no crea efectos, no toca
ningún grupo ni deuda, no cuenta en estadísticas.

### §3 · Capability al portador

> El enlace es una **capability al portador**: no está ligada a ningún
> destinatario. La paga quien la posea y cumpla §5.

Ana puede reenviarla a Pablo; si Pablo paga primero, Pablo es el pagador,
Eduardo recibe, la solicitud queda consumida y Ana encuentra «ya pagada». Es
correcto: el poseedor sólo autoriza una salida **de su propio** Personal.

### §4 · Creador

Cuenta normal, username reclamado, Personal existente, no anónima
(`USERNAME_REQUIRED · 409`, `GUEST_NOT_ALLOWED · 403`). La solicitud persiste
`created_by = uid` del solicitante; **nunca** el username como autoridad. Al
mostrarla se resuelve `uid → identidad pública actual` (F12/ADR-001 §13): si
Eduardo cambia de username después, la solicitud sigue siendo suya y el
enlace enseña su handle nuevo.

### §5 · Quién puede pagar

| Quién                                 | Resultado                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuenta normal con username y Personal | Paga                                                                                                                                           |
| Cuenta normal en el gate de username  | `USERNAME_REQUIRED · 409`; la app conserva el enlace y continúa tras el gate                                                                   |
| Invitado (anónimo)                    | `GUEST_NOT_ALLOWED · 403`: no paga, no crea, no recibe por esta capacidad; la app conserva el enlace y continúa tras convertirse (mismo `uid`) |
| Sin sesión                            | La app **conserva la intención**, pasa por entrar o registrarse y retoma la solicitud si sigue válida (§25)                                    |
| Sin Nomey                             | Instala, se registra y vuelve a abrir el enlace si sigue válido. **No existe** transferencia pendiente hacia una cuenta inexistente            |
| El propio creador                     | `PAYMENT_REQUEST_OWN · 422` (§6)                                                                                                               |

### §6 · Auto-pago

El creador no puede pagar su propia solicitud. La previsualización devuelve
`own`, la interfaz dice «No puedes pagar tu propia solicitud» y ofrece
cancelarla; un intento de pago responde `PAYMENT_REQUEST_OWN · 422` sin
escribir.

### §7 · Importe y moneda

Fijados al crear e **inmutables**: importe entero exacto en unidad mínima,
`> 0`; moneda = **base del Personal del creador** en ese momento. No hay pago
parcial, sobrepago ni saldo pendiente: 25 se pagan con 25. Otro importe → otra
solicitud. Al pagar, el writer toma importe y moneda **de la solicitud**; el
cliente los manda como los enseñó y una discrepancia es
`PAYMENT_REQUEST_AMOUNT_MISMATCH · 409` (sólo posible por un cliente viejo o
manipulado, porque no hay edición). Si la base del Personal del pagador es
otra —o la del creador cambió, lo que sólo cabe sin efectos—,
`CURRENCY_CONVERSION_UNSUPPORTED · 422` (F11/ADR-001 §4). No se abre FX.

### §8 · Concepto

Opcional («Cena», «Hotel», «Entradas»), canonicalizado como el concepto de
movimiento. Vive **sólo** en la solicitud; no se copia a la operación ni a la
versión (F06/ADR-002). Las vistas lo enseñan como contexto derivado por
`paid_operation_id` (§16).

### §9 · Una sola utilización

> Cada solicitud se paga **una** vez. El primer pago válido la deja `paid` y
> materializa **una** `internal_transfer`; cualquier intento posterior recibe
> `PAYMENT_REQUEST_ALREADY_PAID · 409`. Nunca vuelve a `pending`.

### §10 · Ciclo de vida

```
pending ──► paid         primer pago válido; terminal
   ├────► cancelled     sólo el creador, mientras pending; terminal
   └────► expired       7 días; terminal
```

**No existe `declined`.** Quien abre el enlace y pulsa «Cancelar» sólo cierra
la pantalla: no cambia nada en el servidor, no avisa al creador, y la
solicitud sigue `pending` para ese mismo enlace o para otra persona. Es la
diferencia con la propuesta dirigida (§27): aquí no hay un destinatario que
deba responder.

Estado derivado: `paid` ⇔ `paid_operation_id ≠ null`; `cancelled` ⇔
`cancelled_at`; `expired` ⇔ ninguna de las anteriores y `now() ≥ expires_at`;
`pending` en otro caso. Ningún estado terminal se reemplaza.

### §11 · TTL

**7 días**, fijo, sin prórroga; expirada → otra. Cubre el ciclo real de un
chat, el registro y la confirmación de correo de quien no tiene Nomey, evita
capabilities al portador vivas indefinidamente, y coincide con el valor por
defecto de las invitaciones.

### §12 · Pago y materialización

Ana paga → **una** `internal_transfer`: `transfer −25` en el Personal de Ana,
`transfer +25` en el de Eduardo. Sin grupo, sin liquidación, sin deuda, sin
gasto ni ingreso, sin categoría. **Atómico con `pending → paid`**: nunca una
transferencia sin solicitud `paid`, nunca una solicitud `paid` sin
transferencia.

Orden dentro de la transacción, sobre el writer de la clase
(`api.record_internal_transfer` con la solicitud como origen; F03/ADR-006 §1,
una función por clase): forma → intención canónica (la solicitud, por su hash)
→ **clave de idempotencia del pagador** → bloqueo de la fila de la solicitud →
`pending`, no caducada, `created_by ≠ actor` → Personal del creador
(`owner_user_id = created_by`; `RECIPIENT_WITHOUT_PERSONAL_SCOPE · 422` si no
existe) y del pagador → `assert_no_conversion` en los dos →
`lock_scopes([from, to])` → `balances_before` → `persist_version` → dos
efectos `transfer` → partes → `observe_balances` → `paid_operation_id` +
`paid_at` → aviso (fuera de este ADR). Orden de cerrojos: clave → solicitud →
ámbitos; ninguna función toma un ámbito antes que una solicitud.

### §13 · Autoría

Hereda F12/ADR-002 §12: `payment_request.created_by = Eduardo`;
`operation.created_by = operation_version.created_by = Ana`, que
**registró y materializó**. `created_by` no significa receptor. Los roles
económicos Ana → Eduardo viven en las partes (§15). Ninguna vista deriva
emisor o receptor de `created_by`; las policies `created_by = actor` siguen
intactas.

### §14 · Dos voluntades

| Voluntad    | Quién   | Qué autoriza                                                               |
| ----------- | ------- | -------------------------------------------------------------------------- |
| **Primera** | Eduardo | La futura **entrada** en **su** Personal; importe, moneda y concepto fijos |
| **Segunda** | Ana     | La **salida** de **su** Personal, y la materialización                     |

Sólo con ambas nace la `internal_transfer`. Simetría con F12/ADR-002:

```
Propuesta de envío:  A quiere enviar  → B acepta → A → B
Solicitud de pago:   B quiere recibir → A paga   → A → B
```

En las dos, la **segunda** voluntad materializa; y en las dos, quien pone el
dinero es quien lo autoriza desde su propio Personal (invariante 14
precisado, F12/ADR-002 §13): en la solicitud, el pagador **es** el actor, así
que la autorización es la ordinaria del writer.

### §15 · Partes persistidas

La `internal_transfer` resultante usa la relación de partes de F12/ADR-002
§14: Personal de salida (pagador) y de entrada (solicitante), por ids
internos; nunca username ni `public_name`. La lectura resuelve
`uid → identidad pública actual` (F12/ADR-001 §13).

### §16 · Relación solicitud → transferencia

`payment_request.paid_operation_id`, **única**, escrita atómicamente al pagar,
apuntando a la operación. De ahí:

- **Solicitante:** «+25 € · Solicitud · Cena · pagado por Ana García
  @anagarcia». El pagador es el titular del Personal de salida según las
  partes; aunque aquí coincida con `created_by`, la vista no lo deriva de ahí.
- **Pagador:** «−25 € · Pago a Eduardo Álvarez @eduardo · Cena».

El concepto llega por la relación; nada se copia a la operación. Lecturas por
definers acotados: el creador lee **sus** solicitudes; el pagador lee la
solicitud ligada a una operación **suya**. Ninguno ve el Personal del otro.

### §17 · Identidad mostrada

Antes de pagar: `public_name`, `@handle`, importe, moneda y concepto del
creador **actual**. Nunca `uid`, `scope_id`, email ni el id interno de la
solicitud (el cliente opera con el token). Un cambio de username del creador
no rompe el enlace: apunta a un `uid`.

### §18 · Token y capability

- **Opaco**, de entropía suficiente para hacer impracticable la enumeración
  (el precedente usa 32 bytes aleatorios de `gen_random_bytes`, 256 bits, en
  base64url).
- **No contiene** `uid`, `scope_id`, email ni username; el servidor resuelve
  `token → solicitud`.
- **Persistencia autoritativa por hash** (SHA-256), nunca en claro: ni la base
  ni los logs conocen el token; el enlace y, si algún día se representa, el
  QR llevan la misma cadena. Es exactamente el contrato de `core.group_invitation`
  (F09/ADR-004), y no hay razón para apartarse de él.
- El token viaja en el **cuerpo** de los RPC (POST), no en una URL de Nomey;
  en el enlace de la app va como parámetro del esquema, como `join?t=`.
- **Sin rotación**: se cancela y se crea otra. **Una sola utilización** (§9).
  **Caducidad** (§11).
- La forma final del deep link (esquema por variante hoy; HTTPS y Universal
  Links en F8.B) no se fija aquí.

### §19 · Replay y concurrencia

> **Invariante:** para una solicitud existe **a lo sumo una transición
> terminal** y **a lo sumo una operación**. Pagar y cancelar compiten sobre la
> misma fila y se serializan por su bloqueo; la operación queda ligada por
> `paid_operation_id` único; el pago es idempotente por la clave del pagador.

| Caso                                   | Resultado                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dos usuarios pagan a la vez            | Claves distintas: el primero en tomar el bloqueo paga; el segundo ve `paid` → `PAYMENT_REQUEST_ALREADY_PAID`                                                  |
| Dos dispositivos del mismo usuario     | Ídem: una operación                                                                                                                                           |
| Doble tap                              | Una `client_operation_id` por confirmación: replay, misma operación                                                                                           |
| Retry tras timeout                     | Misma clave: `already_processed`                                                                                                                              |
| Creador cancela mientras alguien paga  | Misma fila: el primero decide; pago primero → `paid` y la cancelación `ALREADY_PAID`; cancelación primero → `cancelled` y el pago `PAYMENT_REQUEST_CANCELLED` |
| Caduca entre previsualizar y confirmar | Comprobación bajo bloqueo al materializar: `PAYMENT_REQUEST_EXPIRED`; nada escrito                                                                            |

### §20 · Irreversibilidad posterior

La `internal_transfer` generada hereda F12/ADR-002 §16: irreversible, no
editable, no anulable. Por tanto una solicitud `paid` **queda `paid` para
siempre**: una compensación posterior es otra transferencia (otra propuesta u
otra solicitud), no reabre la solicitud ni permite reutilizar el enlace. Para
cobrar de nuevo → nueva solicitud.

### §21 · Cancelación del creador

Sólo `created_by`, sólo mientras `pending`; comando de provisioning
idempotente por clave; toma el mismo bloqueo de fila que el pago. Después, el
enlace ya no puede pagarse.

| Intento              | Resultado                                                 |
| -------------------- | --------------------------------------------------------- |
| Cancelar `pending`   | `cancelled`, terminal                                     |
| Cancelar `paid`      | `PAYMENT_REQUEST_ALREADY_PAID · 409`, nada cambia         |
| Cancelar `expired`   | Sin escritura; responde el estado `expired` (idempotente) |
| Cancelar `cancelled` | Sin escritura; responde `cancelled` (idempotente)         |
| Cancelar ajena       | `NOT_AUTHORIZED · 403`                                    |

### §22 · Pendiente y saldo

Mientras `pending` no reserva dinero de nadie, no altera el saldo del creador
ni bloquea nada. Al pagar se ejecuta **aunque el Personal del pagador quede
negativo**: sin validación de fondos (F12/ADR-002 §15).

### §23 · Anti-abuso: qué hace falta, medido contra el riesgo real

Al **crear** una solicitud no hay destinatario: el enlace se comparte fuera de
Nomey. No existe, por tanto, spam directo hacia otro `uid` en la creación, y
el tope por pareja y el presupuesto de F12/ADR-002 §18 **no aplican**.

Riesgos que sí existen, y qué los cubre:

| Riesgo                                                     | Cobertura                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enumeración de tokens                                      | 256 bits de entropía + hash: impracticable. Además el freno de previsualización (§24)                                                                                                                                                                                                          |
| Reutilización o reenvío del enlace                         | Una sola utilización (§9) y caducidad (§11)                                                                                                                                                                                                                                                    |
| Capabilities al portador **vivas** acumulándose por cuenta | **Tope de solicitudes `pending` propias**: una cuenta no puede tener más de un número pequeño de solicitudes vivas a la vez (propuesto: **20**); `PAYMENT_REQUEST_LIMIT · 409`. Acota la superficie de tokens válidos por cuenta y obliga a cancelar o dejar caducar antes de crear más        |
| Crecimiento de almacenamiento por bucle crear/cancelar     | **Es un riesgo genérico de todo RPC de escritura de Nomey** —también de invitaciones, categorías y gastos—, no de esta capacidad, y el repositorio no tiene rate limiting en Kong ni PostgREST. No se resuelve aquí con un límite ad hoc; queda registrado para el endurecimiento global (F18) |

**Decisión:** no hay rate limit de creación específico ni presupuesto
compartido con las propuestas; sí el **tope de pendientes propias**, cuyo
motivo es de seguridad (menos capabilities vivas), no de spam. Los intentos
rechazados no escriben nada.

### §24 · Previsualización

`preview_payment_request(token)`, definer de `postgres`, **exige sesión**
(como `resolve_invitation`), devuelve **estado y no excepción**, y en `ok`
publica **sólo**: `public_name` y `@handle` del creador (actuales), importe,
moneda, concepto y el estado. Nunca ids internos.

| Estado      | Cuándo                                                            |
| ----------- | ----------------------------------------------------------------- |
| `ok`        | `pending`, y el actor no es el creador                            |
| `own`       | `pending`, y el actor es el creador (la pantalla ofrece cancelar) |
| `paid`      | Ya pagada                                                         |
| `cancelled` | Cancelada por el creador                                          |
| `expired`   | Caducada                                                          |
| `invalid`   | El token no corresponde a ninguna solicitud                       |
| `throttled` | El actor superó el freno                                          |

**Freno:** el precedente de las invitaciones, tal cual: **20 previsualizaciones
fallidas (`invalid`) por cuenta en 10 minutos**, apunte de actor y momento sin
el token, poda perezosa > 1 día. Se frenan sólo los fallos porque, con 256
bits de entropía, el acierto no es un oráculo útil y la solicitud está hecha
para que quien la tenga la abra sin fricción.

### §25 · Sin sesión y enlace

Requisitos de producto, sin fijar aquí la infraestructura:

- El enlace debe **sobrevivir conceptualmente** al flujo de entrar o
  registrarse: quien lo abre sin sesión lo retiene, se autentica, pasa por
  el gate de username si toca, y Nomey retoma la solicitud si sigue válida.
- El precedente (`invitation-arrival.ts`) retiene la intención **en memoria**
  y se pierde si el sistema mata la app durante la confirmación de correo; la
  solicitud vive 7 días, así que reabrir el enlace basta. Persistirla es una
  mejora de implementación, no de contrato.
- **Dependencia declarada con F8.B**: enlace HTTPS pulsable desde mensajería,
  Universal Links y App Links, e instalación limpia desde el enlace. Hasta
  entonces, el texto compartido dice cómo instalar Nomey.

### §26 · Privacidad

Poseer el enlace permite previsualizar la solicitud: es parte de la
capability, y el reenvío está aceptado. La previsualización expone únicamente
lo necesario para decidir si pagar (§24) y **nunca** email, `uid`, id del
Personal, historial, grupos ni ninguna otra información del creador. El
`@handle` sí se publica: es lo que permite al pagador verificar **a quién**
paga, que un nombre no garantiza (F12/ADR-001 §10).

### §27 · Diferencia con la propuesta de envío

|                         | **Solicitud de pago** (este ADR)                    | **Propuesta de envío** (F12/ADR-002)     |
| ----------------------- | --------------------------------------------------- | ---------------------------------------- |
| Quién crea la intención | quien quiere **recibir**                            | quien quiere **enviar**                  |
| Destinatario            | **al portador**, sin `target_user_id`               | **dirigida**, `target_user_id` fijo      |
| Quién materializa       | cualquiera con el enlace, pagando desde su Personal | el receptor concreto, aceptando          |
| `declined`              | no existe                                           | sí, persistido                           |
| Operación               | `internal_transfer`                                 | `internal_transfer`                      |
| Anti-abuso              | tope de pendientes propias                          | tope por pareja + presupuesto por emisor |

No se fusionan semánticamente aunque compartan infraestructura (§29).

### §28 · Diferencia con Grupo

Sólo Personal: sin `group_id`, sin participantes, sin deuda, sin
`settlement`. **No se introduce** ninguna solicitud dentro de un grupo; las
deudas de grupo siguen sus flujos (F09/ADR-007, F12/ADR-003).

### §29 · Entidad propia

`payment_request` es una **relación propia**, no una fila de una tabla
genérica de intenciones junto a las propuestas. Motivos: capability al
portador frente a destinatario fijo (columnas y autorización distintas);
ciclo de vida distinto (sin `declined`); token y su hash (que una propuesta
no tiene); lecturas distintas (creador y pagador, frente a emisor y receptor
concretos); efecto final sin contexto. Una tabla con `kind` y columnas nulas
según el valor es la forma que F01/ADR-001 descartó. Se comparten **helpers de
`sec`** —generación y hash del token, derivación de estado, freno, patrón de
consumo único— no el contrato ni la tabla.

### §30 · Dónde encaja, sin superar nada

- **Roadmap, Fase 12**: capacidad «Solicitar dinero mediante enlace» junto a
  «Transferir a otro usuario» y «Transferir dentro del grupo»; criterio de
  cierre propio (§31).
- **Glosario**: «Solicitud de pago», «Enlace de solicitud».
- **`data-model.md`**: la solicitud como **intención no contable** (junto a
  invitación y propuesta), fuera del modelo de operaciones y efectos; §4.8
  como operación materializada, sin cambio adicional al de F12/ADR-002.
- **F12/ADR-002**: la operación resultante y su contrato.
- **F09/ADR-004**: precedente de capability opaca, citado.
- **F8.B**: enlaces HTTPS e instalación; runbook de enlaces cuando exista.
- **No se tocan** `data-model.md` §4.6, §4.8 más allá de lo ya fijado, el
  sobrepago ni `settlement_by_transfer`.

## Alternativas consideradas

- **Solicitud dirigida a un `@username`.** Rechazada por producto: obliga a
  elegir antes a quién, y no añade seguridad (el poseedor sólo gasta lo suyo).
- **Solicitud reutilizable** (varios pagos hasta cancelar). Rechazada: un
  enlace en un chat pagado dos veces por dos personas es el error que «una
  sola utilización» evita; para varios cobros, varias solicitudes.
- **Importe abierto o pago parcial.** Rechazadas: reintroducen saldo
  pendiente, conciliación y estados intermedios; otra cantidad es otra
  solicitud.
- **`declined` en servidor.** Rechazada: no hay destinatario que responda; sólo
  añadiría un aviso con coste social y una superficie más.
- **Sin caducidad hasta cancelar.** Rechazada: capabilities al portador vivas
  indefinidamente; 24 h es corto para quien tiene que registrarse; 30 días
  es largo para un enlace olvidado en un chat.
- **Token en claro en base.** Rechazada: el precedente de invitaciones guarda
  sólo el hash y no hay razón para bajar el listón.
- **Reabrir la solicitud si la transferencia se «devuelve».** Rechazada: la
  transferencia es irreversible y una devolución es otra operación; la
  solicitud consumida no se reutiliza.
- **Presupuesto de creación compartido con las propuestas o rate limit
  propio.** Rechazado: no hay receptor al crear; el riesgo real es el número
  de capabilities vivas, cubierto por el tope de pendientes; el crecimiento
  por bucle es genérico de todo RPC y va a F18.
- **Tabla genérica `transfer_intent`.** Rechazada (§29).
- **Solicitud dentro de un grupo.** Fuera por decisión de producto.

## Consecuencias

### A favor

- Cobrar es compartir un enlace, sin elegir destinatario ni conocer ningún
  identificador; y quien paga lo hace con dos voluntades explícitas y desde
  su propio Personal.
- Ningún libro ajeno se toca sin su dueño; ninguna capability da poder sobre
  nadie.
- Se reutiliza el patrón de invitaciones (token, hash, caducidad,
  previsualización frenada) y el writer de F12/ADR-002; no hay clase nueva.
- El histórico de ambas partes explica el pago con el concepto sin copiarlo a
  la operación.

### En contra

- **El reenvío es posible por diseño**: puede pagar quien no era el previsto;
  acotado a un pago y 7 días, y voluntario.
- **Suplantación por nombre público**: cualquiera puede crear una solicitud
  como «Eduardo Álvarez»; la defensa es el `@handle` en pantalla.
- **Sin `declined`**: el creador no sabe si alguien la abrió y no pagó.
- **Sin Nomey no hay pago**: hasta F8.B el enlace no instala nada y la
  intención puede perderse si la app muere durante el registro; se reabre.
- **Bases monetarias distintas bloquean el pago** (F11).
- **Sin límite de creación**: el bucle crear/cancelar crece en base como
  cualquier otro RPC; registrado para F18, no resuelto aquí.
- Un tope de 20 pendientes puede molestar a quien cobra a muchas personas a la
  vez; el número es una decisión de producto y puede subirse sin cambiar el
  contrato.

### Evidencia que exige este ADR al implementarse

1. Crear una solicitud no crea operación, versión ni efecto; ningún saldo
   cambia.
2. Creador normal permitido; anónimo `GUEST_NOT_ALLOWED`; sin username
   `USERNAME_REQUIRED`.
3. Previsualización con token válido → `ok` con exactamente `public_name`,
   `@handle`, importe, moneda, concepto y estado; token inválido → `invalid`
   sin ningún id; `own` para el creador; 20 fallos / 10 min → `throttled`;
   apunte sin token.
4. Cuenta en el gate no paga (`USERNAME_REQUIRED`); anónimo no paga
   (`GUEST_NOT_ALLOWED`); el creador no paga la suya (`PAYMENT_REQUEST_OWN`).
5. Importe y moneda inmutables: un pago con otro importe
   `PAYMENT_REQUEST_AMOUNT_MISMATCH`; no existe edición.
6. Concepto sólo en la solicitud; `operation_version` sin concepto; las vistas
   de ambas partes lo muestran por `paid_operation_id`.
7. TTL 7 días; pagar una caducada `PAYMENT_REQUEST_EXPIRED`, sin escritura.
8. El creador cancela una `pending`; un tercero `NOT_AUTHORIZED`; cancelar
   `paid` `ALREADY_PAID`; cancelar `expired`/`cancelled` idempotente.
9. Carreras con dos sesiones reales: dos usuarios pagan a la vez, doble tap,
   retry, cancelar vs pagar (los dos órdenes), caducidad vs pago: una única
   transición terminal, a lo sumo una operación, `paid_operation_id` único.
10. La operación es exactamente `transfer −N` (Personal del pagador) y
    `transfer +N` (Personal del creador); `operation.created_by =
operation_version.created_by = pagador`; partes correctas; sin efecto de
    grupo ni económico.
11. Tras una transferencia posterior de vuelta, la solicitud sigue `paid` y el
    enlace responde `paid`.
12. La `internal_transfer` resultante: corrección `TRANSFER_NOT_EDITABLE`;
    anulación por cualquiera `OPERATION_NOT_ANNULLABLE`.
13. Bases distintas → `CURRENCY_CONVERSION_UNSUPPORTED`, sin escritura.
14. Cambio de username del creador tras crear: el enlace sigue resolviendo a
    la misma cuenta y muestra el handle nuevo.
15. Tope de pendientes propias: la vigésimo primera `PAYMENT_REQUEST_LIMIT`;
    cancelar o caducar una libera el hueco.
16. Frontera HTTP con JWT real: crear, previsualizar, pagar, cancelar, replay,
    y los rechazos de §5–§7; ninguna respuesta publica `uid`, `scope_id` ni
    email; el token nunca aparece en una URL de Nomey ni en los logs de base.
17. Sin sesión: el enlace retenido se retoma tras entrar (patrón de
    invitaciones), medido en dispositivo.

## Documentación que este ADR obliga a reconciliar

- `docs/product/roadmap.md`, Fase 12: capacidad y criterio de cierre.
- `docs/adr/F12/README.md`: línea de alcance de la fase.
- `docs/product/glossary.md`: «Solicitud de pago», «Enlace de solicitud».
- `docs/architecture/data-model.md`: la solicitud como intención no contable.
- `docs/adr/F09/README.md`: nota en F09/ADR-004 como precedente reutilizado.
- Roadmap F8.B / runbook de enlaces: la solicitud como segundo consumidor de
  Universal Links, junto a la invitación.
- `docs/PROJECT_STATE.md` y `AGENTS.md` «Current state» al cerrar el bloque
  que lo implemente.
