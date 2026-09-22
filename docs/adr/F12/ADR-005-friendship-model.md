# F12/ADR-005 — Amigos: amistad simétrica con dos voluntades

- **Estado:** Propuesto
- **Fecha:** 2026-09-22
- **Alcance:** qué es una amistad entre dos cuentas de Nomey, cómo nace
  (solicitud dirigida aceptada, o enlace personal aceptado —
  [F12/ADR-006](ADR-006-friend-link.md)), cómo se representa (una relación
  simétrica canónica), su ciclo de vida (activa → terminada, y otra vez),
  el ciclo de la solicitud (pendiente → aceptada | rechazada | cancelada |
  caducada, todas persistidas), las solicitudes cruzadas, quién puede, la
  concurrencia, los topes anti-spam, el cooldown tras un rechazo, la
  auditoría, la privacidad de lo que se publica y lo que la amistad **no**
  concede. Fija el contrato de F12.E.A (backend) y lo que las subfases
  E.B–E.E consumirán.
- **No cubre:** el enlace personal y su QR (F12/ADR-006); la acción social
  desde un participante de grupo (F12.E.D, que precisará este ADR sin
  contradecirlo); el selector de destinatario de Transferencias (F12.E.E);
  los avisos push; el bloqueo de usuarios (diferido).
- **Se apoya en** [F12/ADR-001](ADR-001-username-public-account-identity.md)
  (la identidad pública y su resolución exacta; el freno del resolver §12;
  la identidad actual en toda lectura §13), [F12/ADR-002](ADR-002-two-will-user-transfers.md)
  (la propuesta como intención no contable con estado derivado de marcas,
  el cerrojo por emisor y el presupuesto exacto), [F09/ADR-004](../F09/ADR-004-group-invitations.md)
  (estado en vez de excepción cuando un apunte debe persistir),
  [F10/ADR-003](../F10/ADR-003-active-and-historical-link.md) (instancia
  activa o histórica por `ended_at`, nunca borrado) y
  [F03/ADR-009](../F03/ADR-009-participant-identity.md) §1 (qué cuenta hay
  detrás de una identidad contextual no se publica).
- **Conserva** todo lo económico: ninguna función de escritura contable,
  ninguna vista de ámbitos y ninguna policy de `core.scope`, `core.effect`
  o `core.membership` consulta la amistad (medido en `friends.sql` A4 y L).

## Contexto

Transferencias (F12.C) obliga a escribir un `@username` cada vez. Para que
proponer a la misma persona no exija recordarlo, Nomey necesita una relación
social explícita entre cuentas: **amigos**. El producto la fija así
(decisión 2026-09-22): bilateral, con consentimiento de las dos partes, sin
seguidores, sin acceso a nada financiero, sin efecto sobre grupos ni sobre
movimientos, e independiente del username.

Lo medido en el repositorio antes de diseñar (`main` en `df9657a`):

- La identidad pública ya existe y se resuelve exacta y frenada
  (`api.resolve_username`, 20 consultas / 10 min por cuenta, `found |
not_found | self | throttled`), y **exige handle definitivo del que busca**.
- Las propuestas de transferencia ya modelan «una intención dirigida con
  estado derivado de marcas» (`core.transfer_proposal`), un cerrojo
  transaccional por emisor (`sec.lock_proposal_budget`) y un presupuesto
  exacto contado sobre filas persistidas.
- Las invitaciones y las solicitudes de pago ya modelan «una capability
  opaca al portador» con freno de inválidos y **estados en vez de
  excepciones**, porque una excepción revierte el apunte del freno (medido
  en F9 y en F12.B1).
- El vínculo cuenta ↔ participante ya distingue instancia activa e
  histórica por `ended_at` (F10/ADR-003), sin borrado.
- Ningún comando del provisioner usa `SECURITY DEFINER` de `postgres` ni
  `BYPASSRLS`; `authenticated` no tiene `USAGE` sobre `core`.

## Decisión

### §1 · Qué es una amistad

Una amistad es **una relación simétrica entre dos cuentas normales con
username definitivo**, nacida de **dos voluntades**: una solicitud dirigida
que el destinatario acepta, o el enlace personal de una cuenta que otra
acepta (ADR-006). No es contable: no crea operación, efecto ni ámbito. No
altera grupos, transferencias, deudas ni historial. No concede acceso a
ningún dato financiero (§9). No depende del username: se persiste por uid y
la identidad se resuelve **uid → identidad pública actual** en cada lectura
(F12/ADR-001 §13), así que cambiar de `@handle` no la toca.

### §2 · Representación canónica: `core.friendship`

Una fila por **instancia** de amistad, con la pareja **ordenada** —
`user_low < user_high` — de modo que «A es amigo de B» y «B es amigo de A»
son **la misma fila**, nunca dos registros direccionales.

- `created_at`, `created_by` (quien puso la **segunda** voluntad: el que
  aceptó la solicitud o respondió al enlace), `origin` (`request | link`),
  `origin_request_id` (la solicitud que la produjo; obligatoria con origen
  `request`, opcional con `link` — ver ADR-006 §6).
- **Una activa por pareja**, estructural: índice único parcial
  `(user_low, user_high) where ended_at is null`.
- **Terminar es `ended_at` + `ended_by`**, nunca `delete` (F10/ADR-003):
  la instancia queda como historia y volver a añadirse crea otra fila.
  Cualquiera de los dos puede terminarla.
- Sin FK hacia `core.scope`, `core.operation` ni `core.membership`: no hay
  nada económico que pueda depender de ella ni al revés.

### §3 · La solicitud: `core.friend_request`

Una intención dirigida de `requester` a `target`, con **terminales
persistidas**, todas: `accepted_at`, `declined_at`, `cancelled_at`,
**`expired_at`**. A lo sumo una (`CHECK`). El estado se deriva de las
marcas (`sec.friend_request_state`); `expires_at` (TTL **30 días**) entra
en la derivación **sólo para leer** con honestidad una vencida que ningún
comando ha terminalizado todavía — las vistas no la listan y la relación
no la cuenta como pendiente — pero **ningún escritor confía en él**:

> **Todo comando que toca una pareja empieza por tomar su cerrojo y
> terminalizar lo vencido** (`sec.expire_friend_requests` pone
> `expired_at = now()` y `resolution = expired`). Sólo después lee la
> relación o inserta. Por eso la integridad no necesita ningún cron.

La pareja canónica se persiste como columnas **generadas** (`pair_low`,
`pair_high`) para que el índice parcial de **una pendiente por pareja en
cualquier dirección** sea estructural:

```
unique (pair_low, pair_high)
  where accepted_at is null and declined_at is null
    and cancelled_at is null and expired_at is null
```

Sin `now()` en el índice: una vencida deja de bloquear en cuanto un comando
la terminaliza, y nunca bloquea para siempre. Un comando que encuentra una
solicitud ya caducada **responde el estado `expired`** (200,
`already_processed: true`) y no una excepción: la terminalización que acaba
de escribir tiene que persistir, y una excepción la revertiría (medido).
Las otras terminales ajenas a la transición pedida sí son códigos 409
(`FRIEND_REQUEST_ACCEPTED | _DECLINED | _CANCELLED`), porque no hay nada que
persistir.

Auditoría, sin tabla de eventos: `requester_user_id`, `target_user_id`,
`created_at`, la marca terminal, `resolved_by` (quien ejecutó la
resolución; nulo en la caducidad, que no la ejecuta nadie) y `resolution`
(`accepted | accepted_via_link | declined | cancelled | expired`), que sólo
añade lo que las marcas no distinguen: la aceptación **por el propio
emisor al abrir el enlace del destinatario** (ADR-006 §6). Un `CHECK` exige
que la resolución diga lo mismo que la marca.

### §4 · Solicitudes cruzadas y concurrencia

Toda transición sobre una pareja —crear, aceptar, rechazar, cancelar,
terminar la amistad, responder al enlace, caducar— toma primero el **cerrojo
transaccional canónico de la pareja** (`sec.lock_friend_pair`, advisory
xact sobre la pareja ordenada) y sólo entonces lee. Orden global de
cerrojos: **pareja → cuenta** (`sec.lock_friend_budget`, el de los topes
por emisor y el de la rotación del enlace); ningún comando los toma al
revés, así que no hay ciclo.

Con `A→B` pendiente, si B «envía» a A: **no se inserta una segunda fila**;
`create` responde el estado **`incoming_pending`** con el id de la de A, y
la UI ofrece Aceptar/Rechazar. **Nunca amistad automática** por un comando
cuya intención es «enviar»: aceptar queda explícito y `resolved_by` es
veraz. En la carrera exacta `A→B ∥ B→A`, la segunda espera el cerrojo y
recibe ese estado; el índice parcial hace imposible el duplicado incluso
sin el cerrojo. Medido con sesiones reales
(`scripts/friend-request-race-evidence.sh` A–I): crear cruzado, aceptar
contra cancelar en los dos órdenes, doble aceptación, terminar contra
re-solicitar en los dos órdenes, vencida contra nueva, el tope exacto bajo
dos creaciones simultáneas, rotar contra responder en los dos órdenes, y la
recíproca por enlace contra la aceptación normal. «Aceptar contra eliminar» no figura
porque no es construible: `remove_friend` recibe un `friendship_id` que no
existe hasta que la aceptación confirma, y un id inventado es
`NOT_AUTHORIZED` sin tocar nada.

### §5 · Buscar: una llamada, un apunte

`api.lookup_friend_candidate(handle)` resuelve el `@handle` exacto **como
`resolve_username`** — mismo freno de 20 / 10 min, mismos estados `self |
not_found | throttled`, **mismo apunte, uno** — y añade la relación con el
actor: `none | outgoing_pending | incoming_pending | friends | cooldown`,
con `request_id` cuando hay una pendiente. Publica `handle` y
`public_name`; nunca un uid. Así una búsqueda de Amigos cuenta **una vez**,
no dos, y `resolve_username` (Transferencias) sigue intacto.

`create_friend_request` resuelve el handle otra vez en servidor —el cliente
nunca manda un uid— y por tanto también apunta una vez, igual que
`create_transfer_proposal`.

### §6 · Terminar y volver a empezar

`api.remove_friend(friendship_id)`: cualquiera de los dos, bajo el cerrojo
de la pareja; `ended_at`/`ended_by`; idempotente (ya terminada →
`already_processed`). No toca solicitudes (la que la produjo sigue
`accepted`), ni ámbitos, ni operaciones, ni deudas — medido: los conteos de
`core.operation`, `core.scope`, `core.membership` y `core.effect` no cambian.
Después, cualquiera puede enviar una solicitud nueva **al instante** (sin
cooldown: terminar no es rechazar) y aceptarla crea **otra instancia**.

### §7 · Topes y cooldown

Alineados con los que ya existen, y **exactos** bajo cerrojo:

| Límite                          | Valor                   | Precedente               |
| ------------------------------- | ----------------------- | ------------------------ |
| Solicitudes creadas por emisor  | 10 / 60 min (429)       | propuestas 10 / h        |
| Pendientes salientes por emisor | 30 (409)                | solicitudes de pago 20   |
| Pendientes por pareja           | 1, estructural          | propuestas 3 (contadas)  |
| TTL de la solicitud             | 30 días                 | invitaciones 1–30 días   |
| Cooldown tras **rechazo**       | 7 días, direccional     | TTL de propuestas 7 días |
| Búsquedas (`lookup` y `create`) | 20 / 10 min, compartido | resolver F12/ADR-001 §12 |

El **cooldown es de ese emisor hacia ese destinatario y sólo tras
`declined`**: `create` responde el estado genérico `cooldown`, sin decir
más. No hay cooldown tras `cancelled` (quien se equivocó puede volver a
enviar al instante), ni tras `expired`, ni tras terminar una amistad. **No
impide** que el otro envíe en sentido inverso, ni que el actor acepte el
enlace del otro (ADR-006 §6): el enlace es la voluntad del dueño.

Contar creadas sobre filas persistidas significa que cancelar no devuelve
cuota y que lo rehusado antes de insertar (`not_found`, `friends`,
`incoming_pending`, `cooldown`) no la consume.

### §8 · Quién puede

Para **todo** —buscar, enviar, aceptar, rechazar, cancelar, terminar,
obtener o rotar el enlace, previsualizarlo, responderlo—: **cuenta normal
con username definitivo**. Una sesión anónima recibe `NOT_AUTHORIZED · 403`;
una cuenta normal sin handle definitivo, `USERNAME_REQUIRED · 409`
(`sec.assert_friend_actor`), exactamente como `resolve_username` y
`create_transfer_proposal`. Un destinatario sólo existe si su handle es
definitivo (`sec.handle_owner`); una reserva, un retenido o un inexistente
son `not_found`, sin distinguirlos.

### §9 · Lo que la amistad no concede, y la privacidad

- Ninguna policy ni función económica consulta `core.friend*`; ser amigo
  no abre ningún Personal, grupo, efecto ni deuda (medido por catálogo y
  por HTTP: A, amigo de B, no ve `personal_balance` de B).
- `authenticated` **no tiene ningún grant**, ni de columna, sobre las cinco
  relaciones. Lee sólo por `api.my_friends` y `api.my_friend_requests`
  (vistas `security_invoker` que leen únicamente dos definers reducidos del
  provisioner, `sec.my_friend_rows` y `sec.my_friend_request_rows`,
  filtrados por el actor en su cuerpo y por sus policies). Publican
  `friendship_id` / `request_id`, dirección, `counterpart_handle`,
  `counterpart_public_name` y fechas. **Nunca uid ni correo.**
- Un tercero no puede preguntar por la relación entre otros dos:
  `lookup` y `preview` sólo responden la relación **con el actor**;
  aceptar, rechazar, cancelar y terminar responden `NOT_AUTHORIZED` a quien
  no es parte, sin distinguir ajena de inexistente.
- Las terminales se conservan en la base (cooldown, auditoría) y **no se
  publican**: las vistas listan sólo amigos activos y solicitudes pendientes.

### §10 · Propietarios y roles

Todo es del **provisioner** (`nomey_provisioner`), como las invitaciones,
el username y las propuestas: relaciones de identidad y consentimiento, no
de dinero. Ninguna función nueva es de `postgres`; ninguna gana `BYPASSRLS`;
`security definer` sólo en `api` y en los dos lectores reducidos; el resto
de helpers de `sec` corre como el provisioner bajo sus policies self-only.
La única lectura «de todos» es la del token del enlace (ADR-006 §3), que
nunca sale de una función.

### §11 · Superficie de `api`

| Función / vista                                                                                                       | Qué hace                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `lookup_friend_candidate(p_handle)`                                                                                   | §5                                                                                                                     |
| `create_friend_request({client_command_id, command_contract_version, handle})`                                        | `pending` (nueva o la que ya había) · `not_found` · `friends` · `incoming_pending` · `cooldown`; idempotente por clave |
| `accept_friend_request({request_id})`                                                                                 | destinatario → amistad de origen `request`                                                                             |
| `decline_friend_request({request_id})`                                                                                | destinatario; abre el cooldown del emisor                                                                              |
| `cancel_friend_request({request_id})`                                                                                 | emisor; sin cooldown                                                                                                   |
| `remove_friend({friendship_id})`                                                                                      | cualquiera de los dos; `ended_at`                                                                                      |
| `my_friend_link()` · `rotate_friend_link()` · `preview_friend_link(p_token)` · `respond_friend_link({token, action})` | ADR-006                                                                                                                |
| `my_friends`                                                                                                          | activos: `friendship_id, counterpart_handle, counterpart_public_name, since`                                           |
| `my_friend_requests`                                                                                                  | pendientes: `request_id, direction, counterpart_handle, counterpart_public_name, created_at, expires_at`               |

La idempotencia de `create` es por `(requester, client_command_id)` en la
propia relación y no en `core.provisioning_command`, que exige un
`result_scope_id` y aquí no hay ámbito: un replay recupera lo persistido
sin apuntar; un resultado que no persistió (`not_found`, `friends`,
`cooldown`) se vuelve a evaluar, con el mismo estado.

## Alternativas consideradas

- **Dos filas direccionales («A sigue a B», «B sigue a A»).** Es el modelo
  de seguidores, que el producto rechaza; y obliga a mantener dos filas en
  sincronía para decir un solo hecho.
- **Solicitud efímera + diario de eventos.** Otra tabla y ningún lector que
  la necesite: los timestamps, `resolved_by` y `resolution` bastan para la
  auditoría que se pide (§3), y el cooldown lee las rechazadas persistidas.
- **`expired` derivado sólo de `expires_at`** (como las propuestas). Con un
  índice parcial de «una pendiente por pareja» una vencida bloquearía la
  pareja para siempre, porque el índice no puede depender de `now()`.
  Rechazado a favor de la terminal persistida (§3).
- **Conversión automática en amistad cuando B «envía» con A→B pendiente.**
  Un comando de enviar crearía una amistad y `resolved_by` mentiría.
  Rechazado (§4).
- **Cooldown también tras cancelar.** Castiga al que se equivocó; rechazado.
- **Borrado físico al terminar.** Perdería la instancia y su autoría;
  rechazado a favor de `ended_at` (F10/ADR-003).
- **Reutilizar `resolve_username` + una segunda RPC de estado.** Dos apuntes
  del freno por una búsqueda; rechazado a favor de §5.
- **Bloquear usuarios desde el primer día.** Con topes exactos, cooldown,
  rotación del enlace y aceptación explícita no hay un abuso que lo exija;
  diferido hasta que una prueba lo demuestre.

## Consecuencias

- Una nueva familia de relaciones y funciones bajo el provisioner, con sus
  guardas de catálogo (`friends.sql` A) y nueve carreras con sesiones
  reales en CI.
- La expiración es persistida y perezosa: una vencida puede figurar como
  pendiente **en la base** hasta que un comando toque la pareja; las
  lecturas ya la ocultan. Es una decisión, no un descuido: no hay cron.
- Un replay de `create` cuyo primer resultado no persistió consume otro
  apunte del freno; es el mismo coste que `create_transfer_proposal`.
- `resolution` añade una columna que sólo distingue un caso
  (`accepted_via_link`); es el precio de no falsear `resolved_by`.
- Las terminales se acumulan en `core.friend_request` sin lector de
  producto; si algún día pesan, se podan las de más de 90 días con una
  migración, nunca las rechazadas de los últimos 7 (cooldown).
- Nada del cliente existe todavía: E.B (Perfil, lista, solicitudes,
  Notificaciones y campana), E.C (enlace y QR), E.D (grupos) y E.E
  (Transferencias) consumen este contrato sin cambiarlo.

## Documentación que este ADR obliga a reconciliar

`docs/adr/F12/README.md` (índice y precisiones de E.A), `docs/PROJECT_STATE.md`
(F12.E abierto), `docs/product/roadmap.md` (bloque F12.E), `AGENTS.md`
(sección «Current state» de F12) — todo en la PR de E.A.
