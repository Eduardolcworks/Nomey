# F12/ADR-006 — El enlace personal de amistad

- **Estado:** Propuesto
- **Fecha:** 2026-09-22
- **Alcance:** el enlace (y su QR) con el que una cuenta invita a cualquiera
  a ser su amigo: su naturaleza (un código público, opaco y revocable, no
  una credencial), su almacenamiento, su formato, quién puede obtenerlo,
  rotarlo, previsualizarlo y responderlo, su semántica exacta en cada
  relación previa, la concurrencia con la rotación, el freno de inválidos y
  lo que el cliente futuro (F12.E.C) hará con él: Compartir y QR como dos
  acciones independientes en Perfil, y una sola pantalla de respuesta.
- **No cubre:** el modelo de amistad y de solicitud
  ([F12/ADR-005](ADR-005-friendship-model.md), que este ADR consume);
  la entrega por HTTPS / Universal Links (F8.B, como la invitación y la
  solicitud de pago); los avisos push.
- **Se apoya en** [F09/ADR-004](../F09/ADR-004-group-invitations.md)
  (token opaco de 32 bytes, llegada en memoria, freno de inválidos con
  estados en vez de excepciones), [F12/ADR-004](ADR-004-payment-request-links.md)
  (capability al portador; lo que se aparta de ella se dice en §3) y
  [F12/ADR-001](ADR-001-username-public-account-identity.md) §13 (la
  identidad se publica **actual**).

## Contexto

Añadir a alguien por `@username` exige saberlo. El producto quiere además
que cada cuenta tenga **un** enlace personal estable — el mismo que su QR —
que pueda compartir tantas veces como quiera, y que abrirlo **equivalga a
recibir su petición de amistad**: quien lo abre ve «A quiere añadirte como
amigo» y **Acepta o Rechaza**; nunca «ver perfil → enviar solicitud»,
porque A ya manifestó su voluntad al compartirlo. Y que el username, que
puede cambiar, **no sea la identidad del enlace**.

Medido en el repositorio: las invitaciones de grupo llegan por
`<scheme>://join?t=<token>` (esquema por variante), con un parser puro, una
llegada retenida en memoria hasta que hay sesión, un único listener raíz
(`Linking.getInitialURL` + `addEventListener`), `+native-intent` que no
navega con el token, un `QrCode` propio sin dependencia, un `QrScanner`
(`expo-camera`) y `Share.share` nativo. Su backend guarda **sólo el hash**
del token y lo entrega una vez; una solicitud de pago, igual. Ambos son
capabilities de un solo tramo de vida; ninguno tiene que volver a
enseñarse en otro aparato.

## Decisión

### §1 · Un enlace por cuenta, estable y revocable

Cada cuenta normal con username definitivo tiene **un** enlace, que **nace
la primera vez que su dueño lo pide** (`api.my_friend_link`, versión 1) y
**no cambia** hasta que el dueño lo **rota** (`api.rotate_friend_link`:
token nuevo, versión + 1, el anterior deja de existir en el mismo instante).
Cambiar de `@username` no lo toca; el enlace nombra a la cuenta por su uid
en servidor, nunca por el handle.

Ni múltiples tokens (más superficie sin necesidad), ni un token de un solo
uso (rompería «compartir muchas veces» y el QR estático), ni un enlace con
el username dentro.

### §2 · Formato

`<scheme>://friend?t=<token>` construido por `Linking.createURL('friend',
{ t })` en el cliente (E.C), con el esquema de la variante, igual que
`join`; `+native-intent` devolverá `null` para `/friend` para que el token
no pise la navegación. HTTPS / Universal Links llegan con F8.B como para
las invitaciones. El QR representa **exactamente** el mismo enlace: un solo
protocolo.

### §3 · Naturaleza y almacenamiento del token — en claro, a propósito

El token es un **código público, opaco y revocable de amistad**
(«public opaque revocable friendship code»), **no una credencial de
autenticación**: su dueño lo comparte deliberadamente, en abierto, y lo
único que concede es **responder a su invitación de amistad** — una
relación social sin acceso a nada financiero (ADR-005 §9) que el receptor
puede rechazar y el dueño puede revocar rotando.

Por eso `core.friend_link` guarda el token **en claro**, apartándose del
patrón hash-only de invitaciones y solicitudes de pago, y la razón es
funcional: el dueño tiene que poder **volver a enseñar el mismo QR en
cualquier aparato** sin retener nada en el teléfono ni rotar a la fuerza
tras una reinstalación. Lo que lo protege:

- 32 bytes aleatorios en base64url (43 caracteres, `sec.new_invitation_token`,
  el mismo generador): alta entropía, no derivable del uid, sin handle, sin
  correo, sin nada económico (`CHECK` de forma).
- **Sólo su dueño lo obtiene** por `api` (`my_friend_link`, policy
  `user_id = actor`). **Nadie lista tokens**: la lectura «de todos» del
  provisioner existe únicamente para convertir un token en su dueño dentro
  de `preview` y `respond`, y el token ajeno nunca sale de una función.
- Rotar lo invalida al instante (§4); 5 rotaciones / 24 h.

### §4 · Rotación y su tope

`rotate_friend_link`: bajo el cerrojo por cuenta (`sec.lock_friend_budget`)
cuenta las rotaciones de las últimas 24 h en `core.friend_link_rotation`
(insert-only, una fila por rotación; la versión 1 no rota) — la sexta es
`FRIEND_LINK_ROTATION_LIMITED · 429` con `retry_at` —, genera el token,
incrementa la versión y anota la rotación. Ese mismo cerrojo es el que
`respond_friend_link` toma antes de reverificar el token, de modo que la
carrera es determinista (§7).

### §5 · Previsualizar: sólo una cuenta elegible resuelve un token

`api.preview_friend_link(p_token)` exige **cuenta normal con username
definitivo** antes de mirar el token: una sesión anónima recibe
`NOT_AUTHORIZED · 403` y una cuenta sin handle `USERNAME_REQUIRED · 409`.
El enlace **no es una api pública de resolución de identidad**: sin sesión
el cliente retiene el token y pide entrar o crear cuenta; un invitado lo
retiene y ve que necesita cuenta; una cuenta sin username pasa primero por
el gate. Sólo entonces se resuelve.

Para una cuenta elegible responde **estados con 200**, nunca excepciones
para lo del token, para que el apunte del inválido persista
(F09/ADR-004): `ok | own | friends | incoming_pending | mutual_pending |
invalid | throttled`, con `handle`, `public_name` (la identidad **actual**
del dueño) y `request_id` cuando hay una solicitud pendiente. Sólo
`invalid` apunta en `core.friend_link_attempt`; **20 inválidos / 10 min**
por cuenta dan `throttled` sin apuntar. Nunca un uid.

### §6 · Responder: semántica exacta

`api.respond_friend_link({token, action: accept | decline})`, con los mismos
requisitos del actor, bajo el **cerrojo de la pareja** (ADR-005 §4) y tras
reverificar el token (§7) y terminalizar lo vencido:

| Relación previa (dueño A, actor B)   | `accept`                                                                                                                           | `decline`                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| ninguna (o B en cooldown hacia A)    | amistad de origen `link`, sin solicitud                                                                                            | `dismissed`: no se persiste nada                              |
| ya amigos                            | `friends`, `already_processed`                                                                                                     | `dismissed`                                                   |
| `A→B` pendiente (`incoming_pending`) | **acepta esa solicitud** (`resolution = accepted`, `resolved_by = B`) → amistad de origen `request`                                | **rechaza esa solicitud** (`declined`; cooldown de A hacia B) |
| `B→A` pendiente (`mutual_pending`)   | **resuelve la propia** con `resolution = accepted_via_link` (`resolved_by = B`) → amistad de origen `link` con `origin_request_id` | `dismissed`; la solicitud de B sigue pendiente                |
| el propio A                          | `own`                                                                                                                              | `own`                                                         |
| token inexistente                    | `invalid` (apunta)                                                                                                                 | `invalid` (apunta)                                            |

El caso recíproco **no se describe como «B acepta su propia solicitud»**:
las dos voluntades ya existían — B pidió, A compartió su enlace — y B ha
pulsado Aceptar sobre el enlace. Se representa con la solicitud resuelta
`accepted_via_link` y la amistad de origen `link` que la referencia: la
auditoría dice exactamente lo que pasó. Sin tabla de eventos.

Rechazar por enlace **sin** solicitud previa no persiste nada: no había
una `friend_request` que rechazar, y A nunca sabrá que B descartó su
enlace. Un cooldown de B hacia A (A rechazó a B hace menos de 7 días) **no
impide** que B acepte el enlace de A: el enlace es la voluntad de A.

### §7 · Concurrencia con la rotación

`respond` lee el token, toma el cerrojo de la pareja, toma el cerrojo por
cuenta **del dueño** y **vuelve a verificar** que el token sigue siendo el
vigente antes de escribir. `rotate` toma ese mismo cerrojo por cuenta.
Medido con sesiones reales: si rotar entra primero, responder espera y
recibe `invalid` (ninguna amistad con un token invalidado); si responder
entra primero, rotar espera, la amistad nace con el token que era válido y
el viejo deja de existir después. No se usa `for share` sobre la fila del
enlace: un `for share` filtrado por la policy de UPDATE del provisioner
(sólo la fila propia) devolvía cero filas sin error (E20).

### §8 · Contrato del cliente (F12.E.C)

- **Perfil**, junto a avatar / nombre público / `@username`, **dos acciones
  compactas e independientes**: **Compartir amistad** abre directamente
  `Share.share` con un texto breve y el enlace («Soy @edu13 en Nomey.
  Añádeme como amigo: <link>» o equivalente localizado, sin nada
  financiero); **QR** abre la pantalla del QR (nombre, `@username`, el
  código, «Escanéame para añadirnos en Nomey», y Regenerar con
  confirmación). No hay una acción intermedia «Enlace de amistad» que
  obligue a entrar primero para elegir después.
- **Abrir un enlace o escanear un QR** pasa por el **mismo** parser y la
  misma llegada (retenida en memoria como la invitación), y abre una sola
  pantalla de respuesta: identidad actual de A, «A quiere añadirte como
  amigo», **[Aceptar] [Rechazar]**; `friends` → «Ya sois amigos»;
  `incoming_pending` → la misma pantalla acepta/rechaza esa solicitud;
  `mutual_pending` → «A ya tiene tu solicitud» → **Confirmar amistad**;
  `own` → «Este es tu enlace de amistad».
- Sin sesión / invitado / sin username: el token se retiene y se resuelve
  sólo cuando la cuenta es elegible (§5). El escáner de QR de grupos se
  generaliza a `ui` con un lector parametrizado: dos consumidores, un
  componente.

## Alternativas consideradas

- **Hash del token + bearer en el llavero del teléfono + rotación forzosa
  al reinstalar** (el patrón de invitaciones y solicitudes de pago). Más
  mecanismo y peor experiencia (el QR cambia en silencio al cambiar de
  aparato) para proteger una capability de valor bajo y revocable.
  Rechazado (§3), y dicho explícitamente para que nadie lo lea como una
  credencial.
- **Token regenerable con versión, múltiples tokens, o de un solo uso.**
  La versión se conserva como auditoría dentro de la opción elegida; los
  otros dos se rechazan (§1).
- **Preview anónimo** (como la solicitud de pago, que sólo exige sesión
  normal). Convertiría el enlace en una api pública de resolución de
  identidad; rechazado (§5).
- **Abrir el enlace = ver perfil + «Enviar solicitud».** Ignora la voluntad
  ya manifestada por A; rechazado.
- **Que el emisor «acepte su propia solicitud» en el caso recíproco.**
  Falsea la semántica; rechazado a favor de `accepted_via_link` (§6).
- **Persistir el rechazo de un enlace sin solicitud previa.** No hay hecho
  que registrar ni lector que lo necesite; rechazado.

## Consecuencias

- Un token en claro en `core.friend_link`, con la justificación y los
  límites de §3 escritos: si algún día el enlace concediera algo más que
  responder a una invitación de amistad, este ADR deja de valer y hay que
  volver al hash.
- La rotación tiene su propio diario insert-only (`friend_link_rotation`)
  para que el tope sea exacto; es una tabla más.
- Un enlace filtrado sólo produce solicitudes que el receptor decide; el
  dueño lo rota y el viejo muere al instante. Con eso y los topes de
  ADR-005 §7 no se introduce bloqueo de usuarios en esta fase.
- Los avisos push del futuro (`friend_request_received`) tienen el hecho
  que emitir —la fila de `core.friend_request`— sin que este ADR construya
  nada de la infraestructura push, que sigue diferida.

## Documentación que este ADR obliga a reconciliar

Las mismas que ADR-005, en la misma PR.
