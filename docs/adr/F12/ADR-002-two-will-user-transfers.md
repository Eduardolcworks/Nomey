# F12/ADR-002 — Transferencias entre usuarios con dos voluntades

- **Estado:** Aceptado (2026-09-17)
- **Fecha:** 2026-09-17
- **Alcance:** cómo nace una `internal_transfer` entre los Modos Personales de
  dos usuarios cuando el emisor la inicia desde su Personal: una **propuesta
  dirigida** que el receptor **acepta**, y sólo entonces la operación
  financiera. Fija qué es la propuesta, quién puede crearla y recibirla, su
  ciclo de vida, la concurrencia, la materialización, la autoría, las partes
  económicas, la irreversibilidad, las devoluciones, el freno anti-spam, la
  moneda y la fecha efectiva. Precisa el invariante 14 y supera el contrato
  heredado de F3 para esta clase.
- **No cubre:** la transferencia dentro de un grupo, `settlement_by_transfer`,
  el sobrepago de deuda y la salida de un grupo con propuesta pendiente
  (F12/ADR-003); la solicitud de pago por enlace (F12/ADR-004); los avisos
  concretos y los enlaces; el username y su resolución
  ([F12/ADR-001](ADR-001-username-public-account-identity.md), que se consume
  tal cual).
- **Precisa** [F01/ADR-001](../F01/ADR-001-accounting-model.md) §10 y el
  invariante 14 de `data-model.md` §11 (§13 de este ADR): para una
  transferencia entre usuarios sin ámbito compartido, «originar» la salida es
  **autorizarla** mediante una propuesta, y la operación sólo existe cuando el
  receptor la acepta. No toca los efectos inmediatos dentro de un grupo o del
  Modo Pareja, que siguen exactamente como F01/ADR-001 §10 los fija.
- **Supera** el contrato heredado de F3 de `api.record_internal_transfer`
  (migraciones `20260826200047` y `20260829120500`) en tres puntos: la
  transferencia deja de ser inmediata y unilateral, deja de admitir corrección
  por versión (`operation_id` + `expected_version_id`), y deja de tomar
  `to_scope_id` del payload (§11, §16). Y `data-model.md` §4.8 en su forma
  («A registra una transferencia… efectos inmediatos»): el escenario pasa a
  propuesta + aceptación, con los mismos efectos finales.
- **Conserva** [F06/ADR-002](../F06/ADR-002-version-content-and-time.md) (una
  transferencia no lleva concepto ni categoría; nada se inventa), el
  significado de `operation.created_by` y `operation_version.created_by`
  (F03/ADR-010 §2, `data-model.md` §7: el actor que escribió la fila), las
  policies del writer de la migración `20260825131652` (`created_by = actor`, sin relajar), [F03/ADR-007](../F03/ADR-007-client-operation-idempotency.md)
  y [F03/ADR-008](../F03/ADR-008-operation-version-model.md) §13 (clave antes
  de autorizar y del CAS), [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md)
  §9 y §11 (proyección canónica; bloqueos antes de leer), [F06/ADR-004](../F06/ADR-004-balance-target-and-serialization.md)
  (serialización del saldo y observación), [F10/ADR-005](../F10/ADR-005-personal-start.md)
  (`sec.counts_in_personal`: una transferencia no tiene efecto de grupo y
  siempre cuenta) y [F11/ADR-001](../F11/ADR-001-fx-rate-resolution.md) §4
  (`internal_transfer` no convierte).
- **Se apoya en** [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md)
  (comandos de provisioning idempotentes por clave), [F09/ADR-004](../F09/ADR-004-group-invitations.md)
  (freno por cuenta en base; estado en vez de excepción) y [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)
  (partes persistidas por versión en `core.payment_detail`, para no depender
  de efectos superados).

## Contexto

### El contrato heredado, medido (2026-09-17, `main` en `e83988e`)

`api.record_internal_transfer(payload)` existe desde F3 y nadie lo llama desde
la app. Medido contra la función real, en una transacción con `ROLLBACK`:

- Payload: `from_scope_id`, `to_scope_id`, `amount`, `currency_definition_id`,
  `effective_date`, y opcionalmente `operation_id` + `expected_version_id`.
  Autoriza con `sec.assert_owned_personal_scope(from, actor)` y
  `sec.assert_personal_scope(to)`: **cualquier Personal ajeno vale como
  destino** si se conoce su id.
- Un alta A → B escribe **de inmediato** `transfer` −N en el Personal de A y
  +N en el de B. B no interviene. El Disponible de A bajó 2500 sin comprobar
  fondos.
- **Admite corrección**: A cambió el importe de 25,00 a 30,00 (versión 2), y
  con ello el +N del Personal de B, sin que B interviniera.
- **Nadie puede anularla**: `api.annul_operation` exige membresía en todos los
  ámbitos que la versión alcanza —los dos Personales— y responde
  `NOT_AUTHORIZED` a A y a B.
- No aparece en `api.personal_operation` (lista blanca de cinco clases), ni de
  A ni de B, aunque mueva sus saldos.
- El cliente no tiene ninguna forma de conocer `to_scope_id`: ninguna vista de
  `api` publica el Personal ni el `user_id` de otra cuenta (F03/ADR-009 §1).

Ese contrato era coherente cuando se escribió: sin username, el único modo de
alcanzar el Personal de otra persona era compartir un grupo, y el modelo daba
por supuesta esa relación.

### Lo que dice el modelo, y el supuesto que el username rompe

F01/ADR-001 §10: «**Quien envía puede declarar que ha enviado valor propio.**
Quien recibe no puede declarar unilateralmente que otro le ha enviado valor».
Y: «Todo efecto es inmediato, atribuible, notificable y **corregible**», con la
corrección como quinta capa de protección. Sus «Riesgos que el modelo no
cierra» lo dicen sin rodeos: Nomey es «una herramienta colaborativa de
registro financiero **entre personas que se conocen**», y la confirmación
previa «se consideró… y se descartó» **para los ámbitos compartidos**.

`data-model.md` §4.8: «Nomey registra un movimiento financiero **dentro de su
propio modelo**. No es ejecución bancaria.» F09/ADR-007 §2: «Nomey registra
declaraciones: no verifica que el dinero se haya enviado.»

Dos hechos, juntos, cambian el análisis para la transferencia global:

1. **Nomey no mueve dinero.** Una `internal_transfer` es una declaración. Con
   el contrato heredado, A podría escribir `+500` en el Personal de B sin que
   fuera de Nomey ocurriese nada, y el coste para A sería cero: su Personal es
   igual de ficticio.
2. **El username hace global el alcance** (F12/ADR-001 §11). Cualquier cuenta
   puede nombrar a cualquier otra. El supuesto «entre personas que se
   conocen» desaparece, y con él la justificación de que un efecto unilateral
   sobre el Personal ajeno sea aceptable.

Lo que una escritura unilateral e inmediata permitiría, sin coste ni
verificación: filas y avisos a discreción en el Personal de otra persona
(0,01 € × mil), un Disponible ajeno inflado con dinero que no existe, un
histórico ajeno con «recibido de» que nunca ocurrió, y —lo más grave— la
siguiente reconciliación por saldo objetivo de la víctima (F06/ADR-004)
absorbiendo en un ajuste −N un dato falso que se vuelve permanente. La única
defensa del modelo heredado, la corrección por el afectado, obligaría a la
víctima a actuar una vez por cada fila.

Un receptor cuya única salida fuera «devolver» un movimiento que nunca existió
estaría ensuciando **su** histórico para limpiar lo que otro ensució.

### Por qué dos voluntades, y por qué no confirmación previa

Exigir que el receptor acepte **no** contradice lo que F01/ADR-001 §10
rechazó: el ADR descartó la confirmación previa de **efectos** —«efectos
pendientes, estados de autorización»— dentro de ámbitos compartidos, donde la
relación ya existe y quien registra tiene derecho. Aquí no hay ámbito
compartido ni derecho previo, y **no hay efectos pendientes**: la propuesta no
es una operación, no toca ningún libro, y la transferencia, cuando nace, nace
completa e inmediata. Es la misma estructura que la invitación de grupo
(F09/ADR-004): una capability no contable que alguien acepta.

Y tiene precedente exacto en el propio modelo: «un reparto final ejecutado es
inmutable: se compensa, no se edita» (F01/ADR-001 §9; `data-model.md` §7),
reservado a lo que las dos partes acordaron.

## Decisión

### §1 · Principio

> **Una `internal_transfer` entre dos usuarios sólo existe cuando las dos
> partes han expresado su voluntad.** El emisor autoriza la salida de su
> Personal al crear una propuesta; el receptor autoriza la entrada en el suyo
> al aceptarla. Antes de la segunda voluntad no hay operación, efectos, saldo
> ni deuda: sólo una propuesta, que no es un hecho contable.

### §2 · Flujo de producto

```
Personal → + → Transferencia → buscar @username → destinatario
        → importe → concepto opcional → Enviar     (crea la PROPUESTA)

Receptor: «Eduardo Álvarez · @eduardo quiere enviarte 25,00 €» · «Cena»
          [Aceptar]  [Rechazar]                     (Aceptar materializa)
```

«Enviar» no envía nada: crea una propuesta dirigida. Sólo «Aceptar» crea la
operación.

### §3 · Las dos voluntades

| Voluntad    | Quién | Qué autoriza                                                                             | Cómo queda registrada                         |
| ----------- | ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Primera** | A     | La salida de **su** Personal, con destinatario, importe, moneda y concepto **fijos**     | La propuesta: `created_by`, `created_at`      |
| **Segunda** | B     | La entrada en **su** Personal, y dispara la materialización de exactamente esa propuesta | `target_user_id`, `accepted_at`, la operación |

Sólo con las dos: `transfer` −N en el Personal de A, `transfer` +N en el de B.

### §4 · Descubrimiento y binding de identidad

A busca **exactamente** `@ana` con `resolve_username` (F12/ADR-001 §11, con su
freno §12). Al crear la propuesta el servidor resuelve el handle **una sola
vez**, bajo su transacción, y persiste `target_user_id = uid_B`. Desde ese
instante:

- el username **no es autoridad** del destinatario: Ana puede pasar de `@ana`
  a `@anagarcia`, y la propuesta sigue siendo para Ana;
- **jamás** se vuelve a resolver el handle para decidir quién acepta;
- si `@ana` lo obtiene otra persona en el futuro, ninguna propuesta antigua la
  nombra.

Dirección, como en F12/ADR-001 §1: `username → uid` al crear; `uid →
identidad pública actual` al leer; nunca `username histórico → uid`.

### §5 · Quién puede crear y recibir

| Requisito                       | Emisor | Receptor |
| ------------------------------- | ------ | -------- |
| Cuenta normal (no anónima)      | sí     | sí       |
| Username **reclamado y activo** | sí     | sí       |
| Modo Personal existente         | sí     | sí       |
| Distinto del otro               | sí     | sí       |

Rechazos al crear: `USERNAME_REQUIRED · 409` (emisor sin handle definitivo),
`USERNAME_GUEST_NOT_ALLOWED · 409` (JWT con `is_anonymous`), `RECIPIENT_NOT_FOUND · 404`
(inexistente, reserva sin reclamar, retenido, anónimo: los mismos casos que
`not_found` del resolver, sin distinguirlos), `RECIPIENT_WITHOUT_PERSONAL_SCOPE · 422`,
`PAYLOAD_INVALID · 400` (a uno mismo). **No existe** una propuesta hacia una
cuenta que todavía no existe.

### §6 · La propuesta

Una entidad de **intención**, no una operación. Conceptualmente persiste:

| Dato                                         | Qué es                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `created_by`                                 | `uid` del emisor: quien propone y autoriza la salida                     |
| `target_user_id`                             | `uid` del receptor, resuelto una vez (§4)                                |
| `amount`                                     | Entero exacto en unidad mínima; `> 0`                                    |
| `currency_definition_id`                     | La base del Personal del emisor al crear (§20)                           |
| `concept`                                    | Opcional; canonicalizado como el concepto de movimiento (recorte, NFC)   |
| `created_at`, `expires_at`                   | `expires_at = created_at + 7 días`                                       |
| `accepted_at`, `cancelled_at`, `declined_at` | Marcas de transición; a lo sumo una no nula                              |
| `accepted_operation_id`                      | La `internal_transfer` que la materializó; **única**; nula hasta aceptar |
| `client_command_id`                          | Idempotencia de la creación (`core.provisioning_command`, F09/ADR-002)   |

**Importe, moneda, destinatario y concepto son inmutables.** No hay edición:
otro importe o concepto es otra propuesta. Los nombres físicos y los `CHECK`
los fija la migración; el estado es **derivado** (§8), no una columna.

### §7 · Concepto

El concepto vive **sólo en la propuesta**. `internal_transfer` conserva su
contrato: sin concepto y sin categoría (F06/ADR-002: «ninguna clase inventa
nada»). Las vistas de Personal enseñan el concepto como **contexto derivado**
de la propuesta que produjo la transferencia (por `accepted_operation_id`),
igual que hoy `api.personal_operation` deriva grupo y contraparte de un
`group_payment` sin que la versión los lleve. **No se copia a
`operation_version`.**

### §8 · Ciclo de vida

```
pending ──► accepted   sólo target_user_id; materializa la transferencia
   ├────► cancelled    sólo created_by, mientras pending
   ├────► declined     sólo target_user_id; sin motivo obligatorio
   └────► expired      now() ≥ expires_at (7 días, fijo, sin prórroga)
```

Todos terminales; **ninguna propuesta vuelve a `pending`**. `declined` se
persiste en servidor porque la propuesta es dirigida: desaparece de la bandeja
del receptor, el emisor deja de esperar y puede ver «Rechazada». Expirada o
rechazada → se crea otra.

Estado derivado: `accepted` ⇔ `accepted_operation_id ≠ null`; `cancelled` ⇔
`cancelled_at`; `declined` ⇔ `declined_at`; `expired` ⇔ ninguna de las
anteriores y `now() ≥ expires_at`; `pending` ⇔ el resto.

### §9 · Estados visibles

- **Emisor:** Pendiente · Aceptada · Rechazada · Cancelada · Caducada, con
  importe, concepto, fecha y destinatario (`uid → identidad pública actual`,
  F12/ADR-001 §13); puede cancelar mientras Pendiente.
- **Receptor:** sólo las `pending`, con Aceptar y Rechazar.
- **Las propuestas no son movimientos**: nunca aparecen entre ellos ni suman
  en nada. Tras `accepted`, la transferencia sí es un movimiento en los dos
  Personales.

### §10 · Concurrencia

> **Invariante:** para una propuesta existe **a lo sumo una transición
> terminal** y **a lo sumo una operación**. Aceptar, cancelar y rechazar
> compiten sobre la misma fila y se serializan por su bloqueo; la operación
> queda ligada por `accepted_operation_id` **único**.

| Caso                                 | Resultado                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| A cancela mientras B acepta          | El primero en tomar el bloqueo decide; el otro recibe `PROPOSAL_CANCELLED` o `PROPOSAL_ACCEPTED` |
| B rechaza mientras A cancela         | Ídem; ninguna escribe dos veces                                                                  |
| Doble tap en Aceptar                 | Una `client_operation_id` por confirmación: replay, misma operación (F03/ADR-007)                |
| Dos dispositivos de B                | Dos claves: el segundo espera el bloqueo, ve `accepted`, `PROPOSAL_ACCEPTED`; una operación      |
| Retry tras timeout                   | El cliente conserva la clave hasta respuesta terminal: replay `already_processed`                |
| Caduca entre previsualizar y aceptar | La comprobación es bajo bloqueo, al aceptar: `PROPOSAL_EXPIRED`; nada escrito                    |

Orden de cerrojos al aceptar: **clave de idempotencia → fila de la propuesta →
ámbitos** (Personales, en el orden global ascendente de F03/ADR-010 §11).
Ninguna otra función toma un ámbito antes que una propuesta, así que no hay
ciclo posible; cancelar y rechazar sólo toman la fila.

### §11 · Materialización

La acepta B con **una** llamada al writer de la clase,
`api.record_internal_transfer`, cuyo payload de esta vía es la referencia a la
propuesta y la clave de idempotencia. **El servidor toma de la propuesta** —no
del payload— emisor, receptor, importe y moneda. Orden, dentro de una
transacción:

1. forma del payload → intención canónica (la propuesta) → clave de
   idempotencia (`sec.begin_command`; replay → sobre);
2. bloqueo de la fila de la propuesta → `pending`, no caducada,
   `target_user_id = actor`, `created_by ≠ actor`;
3. Personal del emisor (`owner_user_id = created_by`) y del receptor
   (`owner_user_id = actor`); `assert_no_conversion` en los dos (§20);
4. `lock_scopes([from, to])` → `balances_before` → `persist_version` → dos
   efectos `transfer` (−N en `from`, +N en `to`) → partes (§14) →
   `observe_balances`;
5. `accepted_operation_id` + `accepted_at`; aviso (fuera de este ADR).

Sin grupo, sin deuda, sin efecto económico. **Todo o nada**, incluida la
transición a `accepted`.

### §12 · Autoría

Contrato ya vigente, sin cambios: `operation.created_by` y
`operation_version.created_by` son **el actor autenticado que escribió esa
fila**. No significan emisor, receptor, pagador ni acreedor (`data-model.md`
§7: «cada versión queda atribuida a quien la crea»; F09/ADR-007: el receptor
que declara un pago es `created_by`, y el pagador vive en `payment_detail`).

Por tanto: `proposal.created_by = A`, `target_user_id = B`,
`operation.created_by = B`, `operation_version.created_by = B`. **Es
correcto**, y las policies `created_by = sec.request_actor_id()` de
`operation`, `operation_version`, `client_command` y de todo lo que cuelga
de la versión **no se relajan**. Es la segunda barrera de E16 y sigue
mordiendo.

Los roles económicos A → B viven **exclusivamente** en las partes de la
versión (§14) y en los efectos. Ninguna vista ni texto deriva «Enviaste» o
«Recibiste» de `created_by`; una guarda lo afirma sobre las vistas nuevas.

### §13 · El invariante 14, precisado

Invariante 14: «Una transferencia interna directa entre usuarios solo puede
originarla el propietario del Modo Personal que constituye el extremo de
salida. El destinatario no puede originar una salida en el Modo Personal del
remitente.»

> **Precisión:** para una transferencia de dos voluntades, **originar** la
> salida es **autorizarla**: A la origina al crear una propuesta que fija su
> Personal como extremo de salida, el importe, la moneda y el destinatario. B
> **no fabrica una salida ajena**: sólo puede materializar **exactamente** una
> propuesta previamente autorizada por A y dirigida a B.

El writer sustituye, en esta vía, `sec.assert_owned_personal_scope(from,
actor)` por la autorización derivada de la propuesta: `from` es el Personal
del `created_by` de la propuesta, y el actor es su `target_user_id`. No es un
bypass: es una autorización **más estricta** —sin propuesta no hay `from`;
con ella, no hay parámetro libre que cambiar—. La regla de F01/ADR-001 §10
(«Sin esta restricción existiría una primitiva directa de apropiación:
bastaría registrar "B me transfirió 500 €" para vaciar el ámbito de B») se
cumple con más fuerza: B no puede registrar nada que A no haya escrito antes.

### §14 · Partes de la transferencia

Cada versión de registro de una `internal_transfer` persiste sus partes en
una relación propia (patrón `core.payment_detail`, F09/ADR-007 C1): el
Personal de salida y el de entrada, por identificadores internos. De ellos se
derivan los `uid` (`scope.owner_user_id`) y, con F12/ADR-001 §13, la
identidad pública **actual** de cada parte.

Sirve para: las vistas de ambos Personales («Enviaste 25 € a Ana»,
«Recibiste 25 € de Eduardo»), la identidad histórica por `uid`, la auditoría
(propuesta: quién autorizó y cuándo; `accepted_at`: quién aceptó y cuándo;
`created_by`: quién escribió), y para **no depender de efectos superados**
(F03/ADR-010 §9: ninguna vista lee `core.effect`). **No se persisten** ni
username ni `public_name`.

### §15 · Pendiente y saldo

Mientras `pending`: no modifica el Disponible, no reserva ni bloquea dinero,
no crea deuda, no escribe efectos. El emisor sigue registrando movimientos
con normalidad; su saldo puede cambiar antes de que B acepte. Al aceptar, la
transferencia se ejecuta **aunque el Personal de A quede negativo**: no
existe validación de fondos suficientes (el writer heredado tampoco la tiene,
medido), Nomey admite Disponible negativo y el ajuste por saldo objetivo es la
reconciliación. Nomey no es un banco.

### §16 · Irreversibilidad

> Una `internal_transfer` materializada es **irreversible**: no editable, no
> corregible por versión, no anulable. Tiene **exactamente una versión
> `record`**, para siempre.

- Corrección (`operation_id` + `expected_version_id`): `TRANSFER_NOT_EDITABLE · 422`.
- Anulación (`api.annul_operation`), por cualquiera de las dos partes:
  `OPERATION_NOT_ANNULLABLE · 422`, con respaldo en `sec.persist_version`
  (patrón `departure_novation`).

Esto **supera** el contrato heredado de F3, que admitía corrección unilateral
del importe (medido). Motivo: las dos partes consintieron exactamente ese
hecho; reescribirlo o deshacerlo sería que una de ellas alterase el Personal
de la otra sin su voluntad, que es lo que este ADR elimina. La quinta capa de
F01/ADR-001 §10 («corrección») se satisface como **compensación** (invariante
11: «corregir es versionar **o compensar**»), como ya ocurre con el reparto
final del Modo Pareja.

### §17 · Devoluciones y errores

- **Antes de aceptar:** el creador cancela, el receptor rechaza. La pantalla
  de confirmación —nombre público y handle del destinatario, importe— es la
  ventana de A para no equivocarse.
- **Después de aceptar:** no hay undo. «Quería 30 y envié 25» → nueva
  transferencia de 5. «Envié 30 y quería 25» → B devuelve 5 con una nueva
  propuesta B → A (o, en F12/ADR-004, respondiendo a una solicitud de A).
- Una devolución es una `internal_transfer` **normal**: sin clase especial,
  sin marca, sin edición de la original, sin enlace obligatorio a ella. El
  histórico dice la verdad: `25 A → B` y `5 B → A`.
- **Sin «deshacer durante 5 segundos»**: sería honesto sólo como retraso en el
  cliente antes de enviar el comando, y un retraso no durable (las
  transferencias no van por la cola de F7) haría creer que se envió lo que no
  se envió. **Sin estados financieros pendientes.**

### §18 · Anti-spam

Una propuesta no toca ningún saldo, pero puede molestar. Tres reglas, y
ninguna más:

| Regla                 | Valor                                                                                                                       | Error                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Pendientes por pareja | **3** `pending` por `(created_by, target_user_id)`                                                                          | `PROPOSAL_LIMIT_PER_TARGET · 409` |
| Creación por emisor   | **10 propuestas creadas / 60 minutos**, presupuesto **compartido** con las de grupo (F12/ADR-003)                           | `PROPOSAL_RATE_LIMITED · 429`     |
| Rechazos              | **No frenan.** Ignorar es el control del receptor: con tres pendientes sin tocar, el emisor queda bloqueado hacia él 7 días | —                                 |

Los intentos rechazados antes de crear (tope de pareja, destinatario
inválido) **no consumen** cuota. El freno se persiste por cuenta y momento,
patrón `core.invitation_attempt` (F09/ADR-004), con poda perezosa. **Sin
bloqueo social en F12.**

### §19 · El resolver

Este ADR consume `resolve_username` tal como F12/ADR-001 lo define (§11, §12)
y **no redefine** reglas de handle, freno, cambio ni identidad histórica. La
propuesta persiste `uid`, nunca handle.

### §20 · Moneda

La moneda de la propuesta se fija al crear y **es la base del Personal del
emisor**. Al aceptar, si la base del Personal del receptor es otra —o si la
del emisor cambió, lo que sólo es posible sin efectos— el writer rehúsa con
`CURRENCY_CONVERSION_UNSUPPORTED · 422` (F11/ADR-001 §4: `internal_transfer`
no convierte). La previsualización enseña la moneda para que el rechazo sea
comprensible. **No se abre ninguna conversión aquí**; F11 conserva su
autoridad.

### §21 · Fecha efectiva

La transferencia no existe al proponer; su fecha efectiva y su instante son
**los de la aceptación** (fecha de servidor), nunca una fecha elegida al crear
la propuesta. Con `sec.counts_in_personal` (F10/ADR-005), una transferencia
sin efecto de grupo **siempre cuenta** en el Personal, también con `fresh`.

### §22 · Relación con la solicitud de pago

Sólo la simetría, que F12/ADR-004 desarrollará con su propio contrato:

```
Propuesta de envío:   A quiere enviar  → B acepta → A → B
Solicitud de pago:    B quiere recibir → A paga   → A → B
```

Ambas expresan dos voluntades y terminan en la misma clase; difieren en quién
crea la intención, quién ejecuta, y en que la solicitud es al portador y la
propuesta es dirigida.

### §23 · Relación con la transferencia de grupo

F12/ADR-003 añadirá el contexto de grupo, los participantes, la clase
`settlement_by_transfer`, el efecto sobre la deuda con sobrepago algebraico y
la invalidación por salida del grupo. Comparte de este ADR: la propuesta
dirigida (§6, §8, §10), las dos voluntades (§3), la autoría y las partes (§12,
§14), la irreversibilidad (§16), la fecha de aceptación (§21) y el presupuesto
anti-spam (§18).

### §24 · Supersesiones y precisiones, exactamente

| Fuente                                                          | Qué cambia                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01/ADR-001 §10                                                 | **Precisado**: la transferencia entre usuarios sin ámbito compartido exige dos voluntades, porque el username elimina el supuesto de relación previa. Los efectos inmediatos dentro de un grupo o del Modo Pareja no cambian |
| `data-model.md` §11, invariante 14                              | **Precisado**: «originar» = autorizar la salida propia mediante una propuesta; el receptor materializa                                                                                                                       |
| `data-model.md` §4.8 y §8 (fila «Transferencia entre usuarios») | **Superados en su forma**: de «A registra… efectos inmediatos» a propuesta + aceptación; efectos finales idénticos; sigue sin deuda y sin estadísticas                                                                       |
| Contrato heredado de F3 de `api.record_internal_transfer`       | **Superado**: sin corrección por versión, sin `to_scope_id` en el payload, sin escritura unilateral; la vía de propuesta es la única                                                                                         |
| `data-model.md` §7 (autoría por versión), F03/ADR-010 §2        | **Conservados y aplicados**: `created_by` = quien escribió; ninguna superficie lo interpreta como rol económico — queda **prohibido** expresamente                                                                           |
| F06/ADR-002                                                     | **Conservado**: la transferencia no lleva concepto; el concepto vive en la propuesta                                                                                                                                         |

Nada de §4.6 ni del sobrepago de grupo se toca aquí.

## Alternativas consideradas

- **Transferencia directa e inmediata** (contrato heredado, con o sin
  anulación por el receptor). Rechazada: permite a cualquier cuenta escribir
  en el Personal de cualquier otra sin coste ni consentimiento; la anulación
  por el afectado sólo mitiga y lo convierte en vigilante permanente de su
  propio libro.
- **Registro sólo del emisor** (`external_transfer` en A; B, si quiere, anota
  la suya). Rechazada como producto: es lo que F01/ADR-001 §10 ya ofrece como
  alternativa, y no crea ningún hecho compartido.
- **Transferencia directa sólo entre personas con relación previa** (grupo
  compartido, transferencia anterior). Rechazada: reintroduce la dependencia
  de Grupos que la dirección de producto descartó y sigue escribiendo sin
  consentimiento.
- **Ligar previsualización y destinatario** con `expected_public_name` o una
  resolución opaca con TTL. Rechazadas: el nombre no es identidad; el handle
  no puede cambiar de persona entre previsualizar y confirmar (F12/ADR-001
  §9); el `uid` persistido en la propuesta lo cubre todo.
- **`operation.created_by = A`** (originador económico) con B como actor.
  Rechazada: rompería la definición única de `created_by`, diez policies del
  writer y la propiedad de la clave de idempotencia; las partes ya llevan los
  roles económicos.
- **Anulación por las partes**, como el pago declarado de F09/ADR-007.
  Rechazada: allí es el remedio a una declaración **unilateral** que puede
  ser falsa; aquí no hay declaración unilateral que reparar, y una anulación
  sería de nuevo alterar el Personal ajeno sin su voluntad.
- **Ventana de deshacer** tras aceptar. Rechazada: o finge un estado
  pendiente sobre efectos ya aplicados, o es un retraso no durable en el
  cliente.
- **Concepto copiado a la versión**. Rechazada: supera F06/ADR-002 en un punto
  sin necesidad; el contexto derivado da lo mismo.
- **Frenar por rechazos** (N `declined` → bloqueo). Rechazada: castigaría el
  gesto de corrección («te equivocaste de importe»), y el tope de pendientes ya
  da el control al receptor.
- **Una entidad genérica de intención** con `kind` para propuesta, grupo y
  solicitud. Rechazada por la apertura de F12: los invariantes son
  estructuralmente distintos (dirigida frente a al portador; con o sin ámbito
  y participantes; con o sin `declined`); se comparte infraestructura en
  `sec`, no la tabla.

## Consecuencias

### A favor

- **Nadie escribe en un Personal ajeno sin el consentimiento de su dueño**, y
  el abuso a coste cero desaparece de raíz: una propuesta no aceptada no toca
  nada.
- La transferencia, cuando existe, es un hecho **acordado**, y por eso puede
  ser irreversible sin quitarle a nadie una defensa.
- Ninguna policy se relaja; la autorización por propuesta es más estricta que
  la heredada.
- El histórico es literal: cada transferencia es una fila estable, nunca
  tachada ni reescrita; una devolución es otra fila.
- Se reutiliza lo que ya hay: comandos de provisioning, freno en base,
  partes por versión, resolver de F12/ADR-001.

### En contra

- **Un toque más para el receptor**: nada llega hasta que abre Nomey y
  acepta. Una propuesta ignorada caduca a los 7 días y el emisor lo ve como
  «Caducada».
- **Sin remedio unilateral a un error**: un envío al destinatario equivocado
  sólo se arregla con la cooperación del receptor (una propuesta de vuelta).
  Nomey no adjudica (principio de F10).
- **Dinero no solicitado sigue siendo posible**, pero sólo como propuesta:
  ruido acotado por el tope de tres pendientes y el freno por emisor, sin
  efecto sobre saldo ni histórico.
- **Cambio de contrato de F3** en `record_internal_transfer`: sin producción
  ni cliente que lo usara, el coste es reescribir la parte de
  `authoritative-writer.sql` que ejercita la corrección y el alta directa.
- El emisor puede quedar en negativo al aceptarse una propuesta antigua; es
  coherente con el modelo (Disponible negativo, ajuste por objetivo) y hay
  que enseñarlo, no impedirlo.
- Dos avisos y dos gestos para «te pago 30 y redondeo a 50» (una propuesta de
  30 y otra de 20, o una de 50 sin deuda de por medio).

### Evidencia que exige este ADR al implementarse

1. Crear una propuesta **no** crea operación, versión ni efecto; el
   Disponible de A y de B no cambia.
2. Tope de pareja: tres `pending` permitidas, la cuarta
   `PROPOSAL_LIMIT_PER_TARGET`; una aceptada, rechazada, cancelada o caducada
   deja de contar.
3. Freno por emisor: la undécima en una hora `PROPOSAL_RATE_LIMITED`;
   compartido con las de grupo; los rechazos previos a crear no consumen.
4. Emisor anónimo y receptor anónimo rehusados; emisor sin handle definitivo
   rehusado; receptor con reserva sin reclamar o retenido `RECIPIENT_NOT_FOUND`;
   a uno mismo `PAYLOAD_INVALID`.
5. El handle se resuelve **una vez**: tras cambiar el receptor de username, la
   propuesta sigue siendo suya y sólo él puede aceptarla; tras liberar y
   reutilizar el handle por otra cuenta, esa cuenta no ve la propuesta.
6. Sólo `target_user_id` acepta o rechaza; sólo `created_by` cancela; un
   tercero recibe `NOT_AUTHORIZED` en las tres.
7. Carreras con dos sesiones reales: aceptar frente a cancelar, aceptar
   frente a rechazar, doble aceptación (dos claves), retry con la misma clave:
   una única transición terminal y **a lo sumo una operación**.
8. Caducidad a los 7 días; aceptar una caducada `PROPOSAL_EXPIRED`; ninguna
   terminal vuelve a `pending`.
9. `accepted` ⇔ existe exactamente una `internal_transfer` con esa
   `accepted_operation_id`; `operation.created_by = operation_version.created_by
= target_user_id`; las partes dicen `from` = Personal de `created_by` de la
   propuesta y `to` = Personal del aceptante.
10. Policies `created_by = sec.request_actor_id()` intactas (guarda de
    catálogo sobre `operation`, `operation_version`, `client_command`,
    `effect` y las relaciones de detalle).
11. Aceptar con el Personal del emisor en negativo se ejecuta; el Disponible
    cae por debajo de cero.
12. Bases distintas → `CURRENCY_CONVERSION_UNSUPPORTED`, sin escritura.
13. Corrección de una `internal_transfer` → `TRANSFER_NOT_EDITABLE`;
    anulación por el emisor y por el receptor → `OPERATION_NOT_ANNULLABLE`;
    la clase tiene una sola versión.
14. Vistas de Personal: «Enviaste/Recibiste» derivadas de las partes; tras un
    cambio de username de la contraparte, la fila muestra el handle nuevo; una
    guarda afirma que ninguna vista nueva usa `created_by` como rol.
15. Frontera HTTP con JWT real: crear, aceptar, rechazar, cancelar, replay y
    los rechazos de §5, §16 y §20; ninguna respuesta publica `uid` ni
    `scope_id` ajenos.
16. `sec.counts_in_personal` con `fresh`: la transferencia aceptada después
    del corte cuenta en ambos Personales.

## Documentación que este ADR obliga a reconciliar

- `docs/architecture/data-model.md`: §4.8 (propuesta + aceptación), §8 (fila
  «Transferencia entre usuarios»: dos voluntades), §11 invariante 14
  (precisión) y una nota en §12 sobre `created_by`; **no** §4.6 ni §3.
- `docs/adr/F01/README.md`: nota de precisión sobre F01/ADR-001 §10 (el ADR
  aceptado no se edita).
- `docs/adr/F03/README.md`: nota sobre el contrato heredado de
  `record_internal_transfer` superado en esta clase.
- `docs/product/roadmap.md`, Fase 12: capacidad «Transferir a otro usuario
  mediante propuesta + aceptación» y criterios de cierre.
- `docs/product/glossary.md`: «Propuesta de transferencia».
- `docs/adr/F12/README.md`: línea de alcance de la fase.
- `AGENTS.md` §2/§3 y «Current state», y `docs/PROJECT_STATE.md`, al cerrar el
  bloque que lo implemente (nueve writers de clase: uno cambia de contrato).
