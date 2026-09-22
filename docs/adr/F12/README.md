# F12 — Capacidades compartidas avanzadas

**Alcance:** que el dinero se mueva entre personas **dentro del modelo de
Nomey** con el consentimiento de las dos partes: **identidad pública** de la
cuenta (username único y nombre público, descubrimiento exacto por
`@username`), **transferencia entre usuarios** desde el Personal (propuesta
dirigida + aceptación → `internal_transfer`), **transferencia dentro de un
grupo** (propuesta + aceptación → `settlement_by_transfer`, que mueve los dos
Personales y ajusta la deuda del par por el importe completo, pudiendo cruzar
cero) y **solicitud de pago** por enlace al portador (importe fijo, un solo
uso, 7 días → `internal_transfer`). Nomey no mueve dinero bancario: registra
hechos que las dos partes han querido. **Estado de la fase:** **ABIERTA el
2026-09-17**; **F12.A0 cerrado** (los cuatro ADR aceptados) y **F12.A cerrado
el 2026-09-19** (ADR-001 implementado de extremo a extremo: A1 backend, A2
alta y Auth, A3 cliente); **F12.B en curso** (backend de transferencias y
solicitud): **B1** —la propuesta y la `internal_transfer` de dos voluntades,
`20260926120000`— implementado el 2026-09-19; **B2** —la solicitud de
pago mediante enlace, `20260927120000`— implementado el 2026-09-20; **B3**
—la propuesta dentro de un grupo y la `settlement_by_transfer` de dos
voluntades, `20260928120000`— implementado el 2026-09-20; **F12.C en
curso**: **C1** —las transferencias Personal en el cliente— hecha y validada
en iPhone el 2026-09-20; **C2 —la solicitud de pago en el cliente— rechazada
por decisión de producto el 2026-09-20** (ver abajo: el backend B2 queda, la
UI no); **F12.E (Amigos) abierto el 2026-09-22** con dos ADR propuestos
(ADR-005, ADR-006) y su backend en curso (E.A, `20260930120000`); después
C3, el resto de E (E.B–E.E) y F12.D, que sigue siendo el cierre de la fase
aunque E se ejecute antes. El detalle está en
[el roadmap](../../product/roadmap.md).

**Lo que el alcance original de la fase ya habían cerrado F9 y F10, y no se
reabre:** `shares` y `exact_amounts` (hechos en F3/F9), las correcciones con
elegibilidad en la fecha efectiva (F09/ADR-003 §5, F09/ADR-008), las bajas
con saldo pendiente y el acceso residual (no existen: F09/ADR-007 C5/C8/C6,
F10/ADR-003), el participante histórico (F03/ADR-009, F09/ADR-005,
F10/ADR-003), la identidad contextual y la reincorporación (F10). La
«transferencia ordenada unilateral» que el alcance original describía **no
existe**: toda transferencia entre usuarios exige dos voluntades.

**Fuera de la fase:** contactos del teléfono, teléfono verificado, SMS/OTP,
búsqueda por correo o agenda; transferencias bancarias reales, Open Banking,
tarjeta; bote común, préstamos, adelantos, pagos programados, transferencias
múltiples; solicitudes de dinero dentro de un grupo; transferencias a cuentas
inexistentes; conversión monetaria nueva (F11); Unicode en el username; Modo
Pareja (F13, diferido).

Los ADR de esta carpeta se numeran de forma independiente (`F12/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                        | Título                                                                                                                                                                                                                                                                        | Estado    | Fecha      | Bloque                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | -------------------------------------------------------------- |
| [F12/ADR-001](ADR-001-username-public-account-identity.md) | Username: la identidad pública de una cuenta (precisa F03/ADR-003 en el rol `supabase_auth_admin`). **Implementado en F12.A (A1 `20260921120000`, A2 `20260924120000`, A3 cliente; 2026-09-19)**                                                                              | Aceptado  | 2026-09-17 | F12.A0                                                         |
| [F12/ADR-002](ADR-002-two-will-user-transfers.md)          | Transferencias entre usuarios con dos voluntades (precisa F01/ADR-001 §10 e invariante 14; supera el contrato de F3 de `record_internal_transfer`). **Implementado en F12.B1 (`20260926120000`, 2026-09-19)**                                                                 | Aceptado  | 2026-09-17 | F12.A0                                                         |
| [F12/ADR-003](ADR-003-group-transfers.md)                  | Transferencias dentro de un Grupo: propuesta + aceptación → `settlement_by_transfer`, deuda algebraica (supera de forma acotada `data-model.md` §3 y el contrato de F3 de `record_settlement_by_transfer`)                                                                    | Aceptado  | 2026-09-17 | F12.A0 · implementado en F12.B3 (`20260928120000`, 2026-09-20) |
| [F12/ADR-004](ADR-004-payment-request-links.md)            | Solicitudes de pago mediante enlace: capability al portador, un solo uso, 7 días → `internal_transfer` del pagador al solicitante. **Implementado en F12.B2 (`20260927120000`, 2026-09-20)**                                                                                  | Aceptado  | 2026-09-17 | F12.A0                                                         |
| [F12/ADR-005](ADR-005-friendship-model.md)                 | Amigos: amistad simétrica con dos voluntades (relación canónica `(user_low, user_high)`, solicitud con terminales persistidas, cruzadas sin duplicado, cooldown direccional tras rechazo, topes exactos, sin acceso financiero). **Backend en F12.E.A (`20260930120000`)**    | Propuesto | 2026-09-22 | F12.E                                                          |
| [F12/ADR-006](ADR-006-friend-link.md)                      | El enlace personal de amistad: un código público, opaco y revocable por cuenta (no una credencial), preview sólo para cuentas elegibles, respuesta que reutiliza la solicitud pendiente y `accepted_via_link` en el caso recíproco. **Backend en F12.E.A (`20260930120000`)** | Propuesto | 2026-09-22 | F12.E                                                          |

Qué contrato cubre cada uno, en una línea:

- **ADR-001** — el username como atributo público, único y resoluble de la
  cuenta: persistencia en `core`, sintaxis (`^[a-z](_?[a-z0-9])*$`, 3–20,
  ASCII), 25 reservados exactos y 4 prefijos, reserva en el alta por el hook
  `before_user_created` en la misma transacción de GoTrue, reserva provisional
  de 7 días y `claim`, cambio con cooldown de 30 días y retención de 90,
  `public_name`, resolución exacta frenada a 20 consultas / 10 min, e
  identidad histórica siempre resuelta `uid → identidad actual`.
- **ADR-002** — ninguna `internal_transfer` existe sin dos voluntades: el
  emisor crea una propuesta dirigida (importe, moneda y destinatario fijos;
  sin efectos) y el receptor la acepta; `created_by` es quien materializa,
  emisor y receptor viven en las partes; irreversible, no editable, no
  anulable; devolver es otra transferencia; 3 pendientes por pareja y 10
  propuestas por hora. Precisa el invariante 14 («originar» = autorizar la
  salida propia) y supera el contrato de F3 del writer.
- **ADR-003** — la misma propuesta dentro de un grupo, entre participantes
  activos y vinculados, materializada como `settlement_by_transfer`:
  `transfer ∓N` en los Personales y `settlement −N` sobre el par por el
  importe completo, cruzando cero si toca (78 debidos + 80 transferidos → el
  acreedor debe 2); salir del grupo invalida la propuesta pendiente sin tocar
  `leave_group`; «Saldado» (`group_payment`) no cambia. Supera `data-model.md`
  §3 **sólo** para esta clase con dos voluntades.
- **ADR-004** — la solicitud de pago como capability opaca al portador
  (patrón de la invitación de grupo): importe y moneda fijos, concepto en la
  solicitud, un solo uso, 7 días, sin `declined`, cancelable por el creador,
  previsualización frenada, máximo 20 pendientes propias; pagarla materializa
  una `internal_transfer` del pagador al solicitante, y `paid` es para siempre.
- **ADR-005** — la amistad como relación simétrica y canónica entre dos
  cuentas normales con username definitivo, nacida de dos voluntades:
  solicitud dirigida con terminales persistidas (la caducidad incluida,
  terminalizada bajo el cerrojo de la pareja por el primer comando que la
  toca), una pendiente por pareja en cualquier dirección, cruzadas sin
  duplicado ni amistad automática, cooldown de 7 días sólo tras rechazo y
  sólo de ese emisor hacia ese destinatario, topes exactos, `ended_at` en
  vez de borrado, y ningún acceso financiero.
- **ADR-006** — el enlace personal de amistad: un solo código público,
  opaco y revocable por cuenta (en claro, porque no es una credencial),
  cuyo QR es el mismo enlace; sólo una cuenta normal con username lo
  previsualiza; responderlo reutiliza la solicitud pendiente si la hay y
  resuelve la recíproca como `accepted_via_link`.

Los cuatro primeros son los previstos por la apertura de la fase; ADR-005 y
ADR-006 nacen del bloque F12.E (Amigos, 2026-09-22). Ninguno más está
previsto ni reservado. Un ADR nuevo toma el siguiente número libre al
redactarse.

## Notas posteriores

Los ADR aceptados no se editan; lo que la implementación precisa se anota
aquí, con fecha, y el bloque que lo fija se cita. Ninguna nota cambia el
contrato de producto: acotan cómo se materializa.

- **F12/ADR-001 §2 y §10 — dónde vive `public_name` (F12.A1, 2026-09-17).**
  El nombre público no va «en la misma fila» del handle: vive en una relación
  1:1 con la cuenta, `core.account_identity` (`user_id`, `public_name`,
  `handle_changed_at`), y `core.account_handle` lleva sólo el handle y sus
  marcas. Un handle no guarda instantáneas del nombre, y el cooldown de §9 se
  mide sobre la identidad, no sobre una fila de handle. El historial de
  handles que §2 y §9 exigen conservar vive en un diario insert-only,
  `core.account_handle_event`; la fila viva de una reserva caducada o de una
  retención vencida se desaloja perezosamente (§6, §9) y el diario la
  recuerda. Migración `20260921120000`; `supabase/checks/username.sql` A, D4, E.
- **F12/ADR-001 §7 y §8 — sesión anónima y códigos (F12.A1, 2026-09-17).**
  `api.reserve_username` admite una sesión anónima **sólo para reservar**
  (reserva provisional de 7 días), que es lo que necesita Invitado → cuenta en
  el cliente (F12.A3) sin abrir nada más al invitado; reclamar, cambiar,
  poner nombre y resolver con sesión anónima se rehúsan con
  `NOT_AUTHORIZED · 403`. Una cuenta normal que reserva reclama en el acto.
  Los códigos se acotan: **no existen** `USERNAME_RESERVATION_EXPIRED`,
  `USERNAME_GUEST_NOT_ALLOWED` ni `USERNAME_ALREADY_SET`. Reclamar con la
  reserva caducada o sin reserva responde `USERNAME_REQUIRED · 409` (la app
  enseña el gate en los dos casos); reclamar lo ya definitivo devuelve el
  estado sin error (idempotente por estado); una reserva propia viva se
  sustituye por la nueva. Los códigos de F12.A1 son exactamente
  `USERNAME_INVALID · 400`, `USERNAME_RESERVED · 422`, `USERNAME_TAKEN · 409`,
  `USERNAME_REQUIRED · 409`, `USERNAME_CHANGE_COOLDOWN · 409`
  (`details.available_at`), más `NOT_AUTHORIZED` y `PAYLOAD_INVALID`.
  `username.sql` C, D; `http-boundary-check.sh` §16.
- **F12/ADR-001 §11 y §14 — el resolver exige username propio, y es del
  provisioner (F12.A1, 2026-09-17).** `api.resolve_username` sólo responde a
  una cuenta normal **con handle definitivo** (`USERNAME_REQUIRED · 409` si
  no): quien no puede recibir no pregunta, y el oráculo de existencia queda
  detrás de una cuenta confirmada con identidad pública. Es `SECURITY
DEFINER` de `nomey_provisioner` —no de `postgres` como decía §11— bajo una
  política de `SELECT` con `USING (true)` del provisioner sobre identidades
  y handles, medida: ninguna función nueva de F12 es de `postgres` ni cruza
  RLS por propiedad. `sec.public_identity(uid)` (§13) sigue la misma regla y
  sólo la ejecutan el writer y el provisioner. `username.sql` A2, F, G3.
- **F12/ADR-001 §5 — el hook de alta, tal como quedó (F12.A2, 2026-09-19).**
  `sec.before_user_created(event jsonb)` (migración `20260924120000`) es
  `SECURITY DEFINER` de **`nomey_provisioner`** —no de `postgres`— y fija el
  uid **del evento de GoTrue** como actor (`request.jwt.claims`, local a la
  transacción de GoTrue) para escribir bajo las mismas políticas self-only de
  A1; `supabase_auth_admin` recibe exactamente `USAGE` en `sec` y `EXECUTE`
  sobre esa función (guardado: 1 función de `sec`, 0 de `api`, sin `core`).
  Sólo actúa sobre altas **email/password no anónimas** (`app_metadata.provider
= 'email'`, medido): exige `requested_username` y `display_name`, crea la
  identidad y **reserva** 7 días sin reclamar. Un alta anónima o de otro
  proveedor pasa sin escribir nada (A3 la llevará al gate). Rehúsa
  **devolviendo** `{"error":{"http_code":N,"message":"CÓDIGO"}}` —nunca
  lanzando—, y GoTrue lo entrega como `{"code":N,"error_code":"unknown","msg":"CÓDIGO"}`
  (medido con gotrue v2.195.0): el código viaja sólo en el mensaje y el
  cliente lo mapea por igualdad exacta gateado en `error_code = unknown`.
  Faltar el nombre es `PAYLOAD_INVALID · 400`. La conversión Invitado → cuenta
  no pasa por el hook (`PUT /user` no crea usuario): el cliente reserva antes
  con `api.reserve_username` (§8), y reclamar sigue siendo de A3. Evidencia:
  `username.sql` A3/H, `http-boundary-check.sh` §16,
  `username-signup-race-evidence.sh`.

- **F12/ADR-001 §7, §10, §13 — el cliente, tal como quedó (F12.A3, 2026-09-19).**
  El ciclo autenticado es **una sola RPC por sesión**, `api.claim_username`:
  reserva viva → definitiva; definitiva → estado sin escribir; sin reserva o
  caducada → `USERNAME_REQUIRED`. **Sólo ese veredicto del servidor abre el
  gate** (nombre público precargado con el `display_name` de sesión + username;
  sin «Saltar»; `reserve_username` reclama en el acto), que sustituye a las
  pestañas; un **invitado nunca pregunta ni ve el gate**. Perfil enseña la
  identidad pública de `core` (nombre público y `@username`), edita el nombre
  con `set_public_name` **antes** de la copia en la metadata de Auth (si la
  segunda falla no se deshace la primera: se enseña lo de `core` y se avisa) y
  cambia el handle con `change_username`; el lápiz respeta `can_change_at` y el
  cooldown se enseña con su fecha. Sin historial, retenidos ni uid.
  **Offline first (F07/ADR-001):** un fallo de red **no es** `USERNAME_REQUIRED`;
  la cuenta entra y usa Nomey sin conexión; la última identidad **definitiva**
  confirmada por el servidor se respalda por cuenta en el almacén offline de
  F7 (`account-identity`), **sin ser autoridad** (el servidor la sobreescribe
  siempre y nunca abre el gate); sin respaldo y sin respuesta, un watchdog de
  10 s deja continuar como `unavailable`; al volver al primer plano —el único
  `AppState` listener, el mismo seam que despierta la cola— se vuelve a
  preguntar sólo si sigue sin confirmación; sin polling. Pendiente de validar
  con build instalada: el cold-start completamente offline en iPhone (Expo Go
  - Metro sobre hotspot no permite aislar ese escenario); no bloquea.
    Evidencia: `tests/lib/identity-state.test.ts`,
    `tests/infra/username-gate-surface.test.ts`, `route-guards.test.ts`;
    validación manual en iPhone el 2026-09-19.

- **F12/ADR-002 — la propuesta y la `internal_transfer` de dos voluntades,
  tal como quedaron (F12.B1, `20260926120000`, 2026-09-19).** Sólo la clase
  `internal_transfer`; `record_settlement_by_transfer` conservó su contrato de
  F3 hasta B3 y la solicitud de pago llegó en B2. Precisiones que la
  implementación fija:
  - **El destinatario llega como `handle` y el servidor lo resuelve UNA vez**
    dentro de la transacción (`sec.handle_owner`, sólo del provisioner, nunca
    en `api`); el cliente ni manda ni recibe un uid. **Crear por handle no
    abre un oráculo ilimitado:** el freno es **el mismo del resolver** —un
    único presupuesto de 20 consultas / 10 min por cuenta en
    `core.username_lookup_attempt` (ADR-001 §12), compartido entre
    `api.resolve_username` y `api.create_transfer_proposal`—: `found` y
    `not_found` consumen una consulta en cualquiera de los dos, a uno mismo y
    ya frenado no consumen, y frenado es `RECIPIENT_LOOKUP_THROTTLED · 429`
    aquí y `throttled` en el resolver. Medido: 15 por el resolver + 5 por
    crear = 20 y la 21.ª se frena por cualquiera de los dos
    (`transfer-proposals.sql` B5). La tabla sigue guardando sólo actor e
    instante, nunca el handle buscado. **El ABI público de
    `api.resolve_username` no cambia**: mismos parámetros, misma tabla
    `(state, handle, public_name)`, mismos estados.
  - **«Nadie tiene ese username» es el estado `not_found` (200), no
    `RECIPIENT_NOT_FOUND · 404`.** Medido: una excepción revierte el apunte
    del freno que acaba de escribirse, y sondear inexistentes saldría gratis —
    justo lo que el freno existe para impedir. Es el mismo motivo por el que
    `sec.resolve_invitation` devuelve `invalid` como estado (F09/ADR-004). El
    comando queda persistido con esa intención y su replay es `not_found` sin
    consumir otra consulta.
    `RECIPIENT_WITHOUT_PERSONAL_SCOPE · 422` sí es excepción y por tanto no
    apunta: sólo alcanza a cuentas con handle definitivo y sin Personal, que el
    ciclo autenticado de la app no produce.
  - **Emisor anónimo → `NOT_AUTHORIZED · 403`** (no existe
    `USERNAME_GUEST_NOT_ALLOWED`: es el código de todo comando que exige cuenta
    normal, como `claim_username`). Orden del emisor: normal → handle
    definitivo (`USERNAME_REQUIRED · 409`) → Personal → moneda = base
    (`CURRENCY_CONVERSION_UNSUPPORTED · 422`) → clave de idempotencia
    (`core.provisioning_command`, resultado = Personal del emisor).
  - **El presupuesto (§18) se cuenta sobre las propuestas persistidas de los
    últimos 60 minutos bajo un cerrojo transaccional por emisor**
    (`sec.lock_proposal_budget`, `pg_advisory_xact_lock` con clave propia), no
    sobre una relación de intentos: exacto sin ±1 (medido: 9 + 2 simultáneas →
    10; 11 simultáneas → 10), cancelar no devuelve cuota, lo rehusado antes de
    crear no consume. El tope de pareja (3 `pending`) se comprueba bajo el
    mismo cerrojo y se rehúsa antes que el presupuesto. B3 amplió el cuerpo de
    `sec.assert_proposal_budget` a las propuestas de grupo (véase abajo).
  - **Aceptar**: `api.record_internal_transfer` con el payload
    `{client_operation_id, command_contract_version, proposal_id}`;
    `operation_id` / `expected_version_id` en el payload →
    `TRANSFER_NOT_EDITABLE · 422` **antes de la clave**; los campos de F3
    (`from_scope_id`…) son `PAYLOAD_INVALID`. Orden: clave → fila de la
    propuesta `for update` (policy del writer: sólo las dirigidas al actor;
    una ajena o inexistente son `NOT_AUTHORIZED`) → `pending` no caducada
    (`PROPOSAL_ACCEPTED`, `PROPOSAL_CANCELLED`, `PROPOSAL_DECLINED` o
    `PROPOSAL_EXPIRED`, todos 409) → Personales por `owner_user_id` →
    `assert_no_conversion` ×2 →
    `lock_scopes` → `balances_before` → `persist_version` (fecha y hora del
    servidor, §21) → dos efectos `transfer` → `core.transfer_part` →
    `observe_balances` → `accepted_at` + `accepted_operation_id` (único).
  - **Irreversible por código**: `sec.persist_version` rehúsa cualquier
    versión 2 de la clase (`TRANSFER_NOT_EDITABLE` / `OPERATION_NOT_ANNULLABLE`)
    y `api.annul_operation` rehúsa la clase antes de autorizar por membresía,
    para las dos partes y para un tercero por igual.
  - **Lectura**: `api.my_transfer_proposals` (enviadas: todas con estado;
    recibidas: sólo `pending`) y `api.my_transfers` (dirección desde
    `core.transfer_part`, concepto y contraparte desde la propuesta, sólo el
    ámbito propio; `sec.counts_in_personal`). La contraparte es la identidad
    pública **actual** vía `sec.my_transfer_counterparts()` (definer del
    provisioner, sin parámetros, ejecutable por el cliente; su lista de columnas
    es la frontera). El cliente no tiene privilegio de lectura sobre
    `created_by` ni `target_user_id`. `api.personal_operation` **no** lista la
    clase todavía (lista blanca de F06/ADR-007); `api.personal_balance` ya la
    suma.
  - **Propietarios**: lo de la propuesta es del `nomey_provisioner`; lo
    contable, del `nomey_writer`; `sec.has_personal_scope(uid)` es definer del
    writer (sólo un booleano) porque el provisioner no ve Personales ajenos;
    `sec.persist_version` se recrea y sigue siendo de `postgres`. Nada nuevo de
    `postgres`, sin BYPASSRLS.
  - Evidencia: `supabase/checks/transfer-proposals.sql` (A–H),
    `scripts/transfer-proposal-race-evidence.sh` (7 carreras), frontera HTTP
    §18, y los vectores 4.8 por la vía de dos voluntades en
    `authoritative-writer.sql` (B, E8, G) y `authoritative-writer-debt.sql` (J).

- **F12/ADR-004 — la solicitud de pago mediante enlace, tal como quedó
  (F12.B2, `20260927120000`, 2026-09-20).** `core.payment_request` es una
  relación propia (§29), separada de la propuesta; `record_settlement_by_transfer`
  siguió con su contrato de F3 hasta B3. Precisiones que la implementación fija:
  - **Token al portador, una sola entrega.** Lo genera el servidor
    (`sec.new_invitation_token`, 256 bits base64url) y se persiste sólo su
    sha256 (`sec.invitation_hash`, los helpers genéricos de bearer de
    F09/ADR-004, con EXECUTE del hash también para el writer). El token viaja
    **una vez**, en el cuerpo de la respuesta de `create_payment_request`; el
    **replay** de la misma `client_command_id` devuelve la misma solicitud
    con `token: null` y `already_processed: true`. Un cliente que perdió la
    primera respuesta cancela esa solicitud y crea otra con otra clave. Nada
    se guarda en claro ni cifrado. **El token es el bearer que un cliente
    incorporaría al enlace compartible**: la solicitud existe para
    compartirse; lo que nunca sale de la base es el hash. **Ningún cliente
    lo hace hoy** (decisión de producto del 2026-09-20, abajo).
  - **Anónimo → `NOT_AUTHORIZED · 403`** al crear, previsualizar y pagar (no
    existe `GUEST_NOT_ALLOWED`, como en F12.A y B1). Sin handle definitivo →
    `USERNAME_REQUIRED · 409` al crear y al pagar; previsualizar sólo exige
    sesión normal.
  - **Al pagar, el payload no lleva importe, moneda ni concepto**: el writer
    los toma de la solicitud bloqueada. `PAYMENT_REQUEST_AMOUNT_MISMATCH`
    (§7) **no existe**: no hay nada que comparar, y es más fuerte que
    comparar lo que el cliente reenvía. Los campos de F3 y `amount` son
    `PAYLOAD_INVALID`.
  - **Un solo writer, dos orígenes (XOR).** `api.record_internal_transfer`
    acepta `proposal_id` **o** `payment_request_token`, exactamente uno
    (`PAYLOAD_INVALID` si ninguno o los dos); la vía de B1 no cambia. Orden
    al pagar: forma → XOR → **anónimo (`NOT_AUTHORIZED · 403`) y handle
    definitivo (`USERNAME_REQUIRED · 409`) antes de mirar el token**, de
    modo que quien todavía no puede pagar no distingue si el bearer existe
    (misma respuesta con token válido o inválido) → token → fila por hash
    (`PAYMENT_REQUEST_INVALID · 404`; no frenado: con 256 bits no es oráculo
    útil, §23) → propia (`PAYMENT_REQUEST_OWN · 422`, sin clave) → clave →
    fila `for update` (policy del writer: sólo las ajenas) →
    `PAYMENT_REQUEST_ALREADY_PAID | CANCELLED | EXPIRED · 409` → Personal
    del pagador (from) y del creador (to, `RECIPIENT_WITHOUT_PERSONAL_SCOPE`)
    → `assert_no_conversion` ×2 → `lock_scopes` → `persist_version` (fecha
    del servidor) → efectos → `core.transfer_part` → `observe_balances` →
    `paid_at`, `paid_by`, `paid_operation_id` en la misma transacción.
    Orden de cerrojos: clave → fila → ámbitos; cancelar toma sólo la fila; sin
    ciclo con B1.
  - **`paid_by` es auditoría**, escrita por el writer con `paid_at` y
    `paid_operation_id`, y coincide con `operation.created_by`,
    `operation_version.created_by` y el dueño de `transfer_part.from_scope_id`
    (medido). Los roles económicos siguen saliendo de las partes; ninguna
    vista deriva la dirección de `created_by`.
  - **Previsualización** (`api.preview_payment_request`): definer del
    provisioner, no de `postgres`; estados y nunca excepciones (`ok`, `own`,
    `paid`, `cancelled`, `expired`, `invalid`, `throttled`); en `ok`/`own` publica
    exactamente `amount`, `currency_definition_id`, `concept`,
    `creator_handle` y `creator_public_name` (identidad actual). Freno: **sólo
    los `invalid` apuntan y cuentan** (20 / 10 min, `core.payment_request_attempt`
    con actor e instante, nunca el token); `throttled`, `ok`, `own` y los
    terminales no apuntan. Que `invalid` sea estado y no excepción es lo que
    hace persistir el apunte.
  - **Tope de 20 pendientes propias** (`PAYMENT_REQUEST_LIMIT · 409`),
    contado bajo un cerrojo transaccional por creador
    (`sec.lock_payment_request_cap`): exacto (19 + 2 simultáneas → 20). Sin
    rate limit de creación ni presupuesto compartido con las propuestas
    (§23). Cancelar, caducar o pagar libera hueco.
  - **Cancelar**: sólo `created_by`; `cancelled` y `expired` responden su
    estado con `already_processed: true`; `paid` es
    `PAYMENT_REQUEST_ALREADY_PAID · 409`; ajena o inexistente,
    `NOT_AUTHORIZED · 403`.
  - **Lectura**: `api.my_payment_requests` (sólo las creadas por el actor,
    con estado, `paid_at`, `paid_operation_id` y la identidad actual del
    pagador si se pagó) y `api.my_transfers` ampliada con
    `payment_request_id` y el concepto de la solicitud;
    `sec.my_transfer_counterparts()` cubre propuestas y solicitudes. El
    cliente no tiene privilegio de lectura sobre `token_hash`, `created_by` ni
    `paid_by`.
  - Evidencia: `supabase/checks/payment-requests.sql` (A–H),
    `scripts/payment-request-race-evidence.sh` (7 carreras), frontera HTTP
    §19. **Sin cliente por decisión de producto (2026-09-20):** el enlace
    compartible y su retención sin sesión (evidencia 17 del ADR) no se
    construyen; ver «Solicitudes de pago: sin pantalla», abajo.

- **F12/ADR-003 — la propuesta dentro de un grupo y la
  `settlement_by_transfer` de dos voluntades, tal como quedaron (F12.B3,
  `20260928120000`, 2026-09-20).** Con esto **las tres clases de F12 tienen
  escritor**, y el contrato de F3 de `record_settlement_by_transfer` deja
  de existir en el catálogo. Precisiones que la implementación fija:
  - **Relación propia, `core.group_transfer_proposal`**, separada de la
    propuesta del Personal (§16, §17): creador, receptor (`target_user_id`,
    fijado al crear a partir del vínculo del participante, §4), grupo, los dos
    participantes con FK compuestas al grupo, importe, moneda, concepto,
    `client_command_id` único por creador, caducidad a 7 días y las tres
    marcas terminales (`accepted_operation_id`, `declined_at`,
    `cancelled_at`), a lo sumo una. **Los tres comandos y el writer contable
    pertenecen a `nomey_writer`**, no al provisioner como en B1: crear
    necesita ver los vínculos de los dos participantes bajo la política del
    writer, y así el bloque entero tiene un solo dueño. Para la idempotencia
    de crear, el writer recibe `INSERT`/`SELECT` sobre
    `core.provisioning_command` con una política sólo-propia
    (`created_by = actor`); medido que B1 y B2 no cambian con ese grant.
    Nada nuevo pertenece a `postgres`.
  - **El receptor se elige por participante, nunca por @handle** (§3): un
    participante **activo, vinculado a otra cuenta y del mismo grupo**;
    `PARTICIPANT_NOT_IN_SCOPE`, `PARTICIPANT_INACTIVE`, `PARTICIPANT_MERGED`,
    `PARTICIPANT_NOT_ELIGIBLE` (elegible en la fecha de hoy, F09/ADR-008),
    `NOT_AUTHORIZED` si no está vinculado (un ghost no puede querer), y
    `PAYLOAD_INVALID` si es el propio emisor. **Los dos necesitan username
    definitivo** (§5): el emisor al crear y el receptor al crear y al aceptar
    (`USERNAME_REQUIRED · 409`, comprobado antes que la membresía y antes de
    localizar la fila, como en B1); anónimo → `NOT_AUTHORIZED · 403`. **La
    moneda es la base del grupo**, derivada, y el payload no la lleva; un
    grupo con base distinta del Personal del emisor o del receptor se rehúsa
    con `CURRENCY_CONVERSION_UNSUPPORTED` (§22, F11/ADR-001 §4).
  - **La salida del grupo se deriva, exactamente como §6**: sin marca
    persistida, `cancelled · departure` ⇔ sin marca terminal **y** una fila de
    `core.group_departure` del emisor o del receptor en ese grupo con
    `created_at < left_at < expires_at`; precedencia accepted → declined →
    cancelled·creator → cancelled·departure → expired → pending; volver
    (`redeem_invitation` con `rejoin`) no la revive. Las tres transiciones
    toman **el rango 1 del grupo** (`sec.lock_participant_claims`, el mismo
    que `leave_group` toma primero) antes de leer la salida, así que una
    marca sólo puede escribirse sin salida en la ventana. Se responde
    `PROPOSAL_CANCELLED · 409` con `details.reason = departure | creator`.
    El writer tiene `SELECT` sobre `core.group_departure` con política
    `true`: la salida es un hecho del grupo, no de una cuenta.
  - **El estado sale de un helper con autorización interna**,
    `sec.group_transfer_proposal_state(p_proposal)`: definer del writer que
    toma el actor de `sec.request_actor_id()`, localiza la propuesta **sólo
    si el actor es creador o receptor** (una ajena y un uuid inexistente son
    indistinguibles: cero filas), un anónimo no obtiene nada, y devuelve
    exactamente `state` y `cancel_reason` —ningún dato de la salida, ningún
    uid—. Medido A–E en `group-transfer-proposals.sql` §C, y además que
    `authenticated` no tiene `USAGE` sobre `sec`: el helper sólo es
    alcanzable a través de `api.group_transfer_proposals`, que lo resuelve
    por OID.
  - **Presupuesto compartido** (§20): `sec.assert_proposal_budget(uid)` se
    recreó como definer del provisioner y cuenta `transfer_proposal` **y**
    `group_transfer_proposal` del mismo emisor (`request.jwt`, nunca un uid
    del cliente) bajo el **mismo** cerrojo `nomey.proposal_budget:<uid>`;
    exacto y mixto (7 de grupo + 3 del Personal = 10; una Personal y una de
    grupo simultáneas con 9 previas → entra exactamente una). Tope de pareja:
    3 `pending` por (grupo, emisor, receptor).
  - **Aceptar**: `api.record_settlement_by_transfer` recreada con el payload
    `{client_operation_id, command_contract_version, proposal_id}`; los
    campos de F3 son `PAYLOAD_INVALID · 400` y `operation_id` /
    `expected_version_id` son `TRANSFER_NOT_EDITABLE · 422` antes de la
    clave. Orden: forma → anónimo → handle → clave (`sec.begin_command`,
    canónico `{proposal_id}`) → fila `for update` (sólo `target_user_id =
actor`; el creador y un tercero reciben `NOT_AUTHORIZED · 403`) → rango 1
    → estado (`PROPOSAL_ACCEPTED | DECLINED | CANCELLED | EXPIRED · 409`) →
    membresía y elegibilidad de los dos hoy → vínculos → Personales →
    `assert_no_conversion` ×3 → `lock_scopes` (grupo y los dos Personales,
    orden ascendente global) → `persist_version` (fecha y hora del
    servidor, §23) → **tres efectos**: `balance −N` en el Personal del
    emisor, `balance +N` en el del receptor y `settlement −N` emisor →
    receptor en el grupo, **por el importe íntegro y cruzando el cero** (§9,
    §10: Aitor debe 78, propone 80, Eduardo acepta → Eduardo debe 2; medido
    también 20+5, 15+30, 0+N) → `core.transfer_part` con
    `group_scope_id` y los dos participantes → `observe_balances` → marcas
    de aceptación. `created_by` es el **receptor**; la dirección económica
    sale de las partes y de la propuesta, nunca de `created_by` (§15).
    `SETTLEMENT_EXCEEDS_DEBT` deja de aplicarse **sólo** a esta clase (§12):
    `group_payment` sigue con su tope (`PAYMENT_NOT_APPLICABLE`) y
    `record_debt_settlement` con el suyo, medidos en la misma sección.
  - **`core.transfer_part`** gana `group_scope_id`, `sender_participant_id` y
    `receiver_participant_id`, todo-o-nada por `CHECK` y con FK compuestas al
    grupo; las filas de B1 y B2 quedan a `NULL` sin backfill.
  - **Irreversible en la misma migración** (§25): `sec.persist_version`
    rehúsa una segunda versión de `internal_transfer` **y** de
    `settlement_by_transfer`, y `api.annul_operation` rehúsa las dos con
    `OPERATION_NOT_ANNULLABLE · 422`. Consecuencia medida de §12: en una
    pareja que una transferencia de dos voluntades ha cruzado, la guarda por
    delta de `20260914150000` rehúsa anular la liquidación posterior que
    cerró la pareja (los 2 de vuelta por `record_debt_settlement`) con
    `SETTLEMENT_EXCEEDS_DEBT`, porque reabriría un pendiente negativo; en
    una pareja no cruzada, anular sigue funcionando como en F9.
  - **Cancelar y rechazar** (`api.cancel_group_transfer_proposal`, sólo el
    creador; `api.decline_group_transfer_proposal`, sólo el receptor):
    idempotentes por estado (`already_processed`), `PROPOSAL_ACCEPTED |
DECLINED | CANCELLED | EXPIRED · 409` en los demás, `NOT_AUTHORIZED` para
    la ajena o inexistente. Orden de cerrojos: crear = clave → rango 1 →
    presupuesto; aceptar = clave → fila → rango 1 → ámbitos; cancelar y
    rechazar = fila → rango 1; salir = rango 1 → salida. Sin ciclo con B1,
    B2, `leave_group` ni el writer de deuda.
  - **Lectura**: `api.group_transfer_proposals` (salientes todas; entrantes
    sólo `pending`; identidad por `display_name` del participante, estado y
    motivo del helper, sin uid), `api.group_transfers` (las
    `settlement_by_transfer` de los grupos del actor, `is_sender` /
    `is_receiver`, sin uid ni Personal ajeno) y `api.my_transfers` ampliada
    con `group_scope_id` y `group_transfer_proposal_id` **al final**;
    `sec.my_transfer_counterparts()` cubre los tres orígenes.
    `api.group_operation` no se toca. El cliente sigue sin `USAGE` sobre
    `core`.
  - Evidencia: `supabase/checks/group-transfer-proposals.sql` (A–H, con
    `lib/group-payment-helpers.sql`), `scripts/group-transfer-race-evidence.sh`
    (9 carreras: aceptar vs salir en los dos órdenes, rechazar y cancelar vs
    salir, aceptar vs cancelar, doble aceptación, caducada y salida,
    presupuesto mixto, reincorporación real), frontera HTTP §20,
    `authoritative-writer-debt.sql` (D, J por la vía de dos voluntades),
    `leave-and-settle.sql` (F2) y `group-identity-lock.sql` (los tres
    comandos toman el rango 1 antes de localizar la fila). Pendiente para
    F12.C: la pantalla `Grupo → + → Transferencia → participante`.

- **F12/ADR-002 en el cliente — F12.C1, tal como quedó (2026-09-20, validado
  en iPhone; revisado el mismo día al retirar C2).** Una feature propia,
  `features/transfers`, compuesta por las rutas en tres costuras con
  Personal: el segmento «Transferencia» del `+` (slot de `MovementForm`,
  que le entrega el importe y el concepto de su propio borrador: cambiar de
  Gasto a Transferencia y volver no pierde nada), la actividad de Inicio y
  el centro de pendientes de Notificaciones con su campana. El segmento es
  exactamente importe → concepto → `@username` → «Proponer»: **el único
  destinatario posible es una cuenta por su username.** Precisiones que la
  implementación fija:
  - **Búsqueda exacta por `@username`**, una llamada a `resolve_username` por
    pulsación (nunca por tecla) con los cuatro estados como copy; la regla del
    handle es la de `domain/username`. Confirmación con la identidad pública
    antes de proponer; el botón dice «Proponer» y el estado final «pendiente».
  - **Nada va por la cola de F7 ni se persiste** (§17): clave de comando por
    intención que sólo sobrevive a un fallo de transporte; sin red, fallo
    explícito con reintento y el formulario intacto. Un invitado ve el aviso
    y no llama al servidor.
  - **Notificaciones es el único centro de pendientes, y no es un
    histórico**: sólo pendientes, en las dos direcciones — las entrantes con
    Aceptar y Rechazar, las salientes («Le propusiste enviar 25,00 € a
    Aitor», «Aitor · @aitor») con Cancelar —; lo terminal desaparece (la
    aceptada es un movimiento en Inicio). Una propuesta resuelta desde el
    aparato sale de la lista antes de la recarga autoritativa. La campana
    enciende su punto **sólo con entrantes pendientes** (pendiente, no «no
    visto»: no hay marca de visto en el servidor y abrir Notificaciones no la
    apaga; las salientes nunca la encienden). No hay pantalla `/transfers`
    ni banner en Inicio: los hubo en la primera entrega de C1 y se retiraron
    con C2.
  - **El rechazo es la única terminal que se cuenta al emisor**, como novedad
    informativa: «Aitor rechazó tu propuesta de 25,00 €», sin botones y sin
    nada económico. La fuente es la propia vista (`direction = outgoing`,
    `state = declined`), acotada por `expires_at` porque no publica
    `declined_at`; no hay tabla de avisos nueva. Es la OTRA clase de punto de
    la campana: «no visto», que entrar en Notificaciones apaga, marcando por
    actor sólo los ids de propuesta en el documento opaco de `catalogue_cache`
    (`transfer.declined.seen`, el patrón de `incident.seen`), nunca un
    importe. Lo pendiente no tiene marca y no se apaga por entrar.
  - **La dirección y la contraparte salen de `direction` y
    `counterpart_*` de las vistas, nunca de `created_by`** (§12). En
    Movimientos, `my_transfers` se intercala con `personal_operation`; el
    momento de una transferencia se deriva de `operation_created_at` en el
    reloj del aparato, porque el servidor escribe `localtime` en UTC y un
    movimiento lleva la hora de pared del teléfono (medido: 15:34 frente a
    17:25 el mismo día). Precisión pendiente del backend: fijar ese contrato.
  - **Notificaciones push: diferidas.** No hay `expo-notifications`, token
    ni tabla de dispositivos. Eventos previstos: `proposal_received` (al
    receptor), `proposal_accepted` y `proposal_declined` (al creador);
    `cancelled` y `expired` no notifican; **sin importe ni concepto en el
    payload** (título fijo y navegación; lo económico se ve con sesión). En
    iPhone exige Apple Developer, APNs y una build instalada (F8.B); en
    Android, Firebase/FCM y la build propia. Necesitará migración (dispositivos
    y outbox), un servicio de envío y su ADR. No bloquea F12.C.
  - Evidencia: `tests/lib/transfer-proposal.test.ts`,
    `tests/lib/amount-figure-size.test.ts`,
    `tests/infra/personal-transfers-surface.test.ts`; validación manual en
    iPhone con dos cuentas (proponer, aceptar, rechazar, cancelar, self,
    not_found, offline, foreground).

- **Solicitudes de pago por enlace: sin pantalla (decisión de producto,
  2026-09-20).** F12.C2 se implementó completa en el cliente — crear desde
  el `+`, compartir con la hoja nativa, enlace `pay?t=`, bearer en el
  llavero, previsualizar y pagar, «Mis solicitudes», pegar y escanear — y se
  **rechazó** antes de integrarse: el producto no expone hoy ninguna UI de
  solicitud de pago. Lo que queda:
  - **El backend B2 se conserva íntegro** (`core.payment_request`,
    `create_` / `preview_` / `cancel_payment_request`, la rama
    `payment_request_token` de `record_internal_transfer`,
    `api.my_payment_requests`, la columna `payment_request_id` de
    `api.my_transfers`, sus checks y carreras). F12/ADR-004 sigue aceptado
    y no se reabre: la decisión es de superficie, no de modelo.
  - **El cliente sólo expone transferencias por `@username`**
    (F12/ADR-002). No hay enlace, QR, bearer, `SecureStore` ni
    `Share.share` de solicitudes en `features/transfers`; el parser de
    `my_transfers` lee `payment_request_id` a la defensiva y ninguna fila
    lo enseña (ningún cliente crea esas filas). Los tipos generados sobre
    `api` conservan las funciones de B2 porque existen en el servidor.
  - **Push de transferencias: sigue diferido** (arriba). Reabrir la UI de
    solicitudes exige una decisión de producto nueva, no un ADR: el contrato
    técnico ya está.

- **F12/ADR-005 y ADR-006 — Amigos, backend (F12.E.A, `20260930120000`,
  2026-09-22; pendiente de merge).** Precisiones que la implementación fija:
  - **La caducidad responde el ESTADO `expired`**, no una excepción, en
    aceptar / rechazar / cancelar: el comando acaba de terminalizar la
    pendiente vencida bajo el cerrojo y una excepción revertiría esa marca
    (medido). Las otras terminales ajenas a la transición sí son 409
    (`FRIEND_REQUEST_ACCEPTED | _DECLINED | _CANCELLED`).
  - **La idempotencia de `create_friend_request` vive en la propia
    relación** (`unique (requester_user_id, client_command_id)`), no en
    `core.provisioning_command`, que exige un `result_scope_id` y aquí no
    hay ámbito. Un replay recupera lo persistido sin apuntar; un resultado
    que no persistió (`not_found`, `friends`, `incoming_pending`,
    `cooldown`) se reevalúa con el mismo estado y otro apunte.
  - **Orden global de cerrojos: pareja → cuenta.** `respond_friend_link`
    reverifica el token bajo el cerrojo por cuenta del dueño (el de
    `rotate`), no con `for share`: un `for share` filtrado por la policy
    de UPDATE del provisioner devuelve cero filas sin error (E20).
  - **`core.friend_link_rotation`** (insert-only) existe para que el tope
    de 5 rotaciones / 24 h sea exacto y quede el rastro; es la quinta
    relación, además de las cuatro del contrato.
  - **`resolve_username` no cambia**: `lookup_friend_candidate` replica su
    resolución y su apunte, y añade la relación. Transferencias sigue con
    el suyo.
  - Evidencia: `supabase/checks/friends.sql` (A–L),
    `scripts/friend-request-race-evidence.sh` (A–I), frontera HTTP §21.
    Sin cliente todavía (E.B–E.E).

## Decisiones de otras fases que esta fase aplica

Las transferencias de F12 son distintas del pago declarado de F09/ADR-007 §2:
aquél es una declaración de una parte, acotada por la deuda y anulable; éstas
exigen dos voluntades y son irreversibles. F09/ADR-007 descartó reutilizar
`settlement_by_transfer` para el pago declarado, y sigue siendo correcto: F12
la usa para su propósito propio.

Se citan, no se copian ni se redefinen:

- [F01/ADR-001](../F01/ADR-001-accounting-model.md) — Modelo contable de Nomey (§10 precisado por F12/ADR-002 y F12/ADR-003)
- [F03/ADR-003](../F03/ADR-003-privilege-model.md) — Modelo de privilegios (precisado por F12/ADR-001: una función de `sec` para `supabase_auth_admin`)
- [F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) — Frontera autoritativa de escritura (una función por clase)
- [F03/ADR-009](../F03/ADR-009-participant-identity.md) — Identidad de participantes sin cuenta y vínculo con usuarios
- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) — Persistido frente a derivado; `created_by` como atribución del actor
- [F05/ADR-003](../F05/ADR-003-guest-session.md) — Sesión de Invitado (fuera de todas las capacidades de F12)
- [F06/ADR-002](../F06/ADR-002-version-content-and-time.md) — Una transferencia no lleva concepto ni categoría
- [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md) — Idempotencia por clave del provisioning
- [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) — Salir de un Grupo (ambos extremos activos ahora)
- [F09/ADR-004](../F09/ADR-004-group-invitations.md) — Invitaciones: precedente de capability opaca y de freno por cuenta
- [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md) — Pagos registrados en el grupo, su anulación, y salir sin pendientes
- [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md) — La obligación de quien salió es intocable
- [F10/ADR-002](../F10/ADR-002-permanent-identity.md) y [F10/ADR-003](../F10/ADR-003-active-and-historical-link.md) — Identidad permanente; vínculo activo e histórico
- [F10/ADR-005](../F10/ADR-005-personal-start.md) — `sec.counts_in_personal`: una transferencia sin efecto de grupo siempre cuenta
- [F11/ADR-001](../F11/ADR-001-fx-rate-resolution.md) — Las transferencias y liquidaciones no convierten
