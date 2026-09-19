# F12/ADR-001 — Username: la identidad pública de una cuenta

- **Estado:** Aceptado (2026-09-17)
- **Fecha:** 2026-09-17
- **Alcance:** qué es el username de una cuenta Nomey, dónde vive, cómo se
  escribe, cómo se reserva en el alta, cuándo caduca una reserva, cómo se
  cambia, qué nombre público lo acompaña, cómo se resuelve para encontrar a
  otra persona y qué identidad enseña una operación histórica. Es el primer
  ADR de la Fase 12 y deja preparado el **mecanismo de descubrimiento** que
  las transferencias entre usuarios necesitan.
- **No cubre:** el contrato financiero de las transferencias entre usuarios,
  las propuestas de envío y las solicitudes de pago (F12/ADR-002 y
  siguientes); contactos del teléfono, teléfono verificado, SMS, búsqueda por
  correo o agenda (fuera de F12 por decisión de producto, 2026-09-17);
  Unicode en el username (exige otro ADR); el historial de `public_name`.
- **Precisa** [F03/ADR-003](../F03/ADR-003-privilege-model.md) en un punto
  acotado (§5 de este ADR): el rol de Auth `supabase_auth_admin` recibe
  `USAGE` sobre `sec` y `EXECUTE` sobre **una** función, y nada más. No
  contradice ninguna de sus reglas: `anon` sigue sin `USAGE` sobre `api`,
  `core` y `sec` siguen sin ser superficie cliente.
- **Conserva** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (la
  identidad contextual de participante es otra cosa, y no se correlaciona con
  esto), [F10/ADR-002](../F10/ADR-002-permanent-identity.md) (el username no
  cambia ningún vínculo), [F05/ADR-003](../F05/ADR-003-guest-session.md) (el
  Invitado sigue siendo una sesión anónima real, y conserva el `uid` al
  convertirse), [F06/ADR-002](../F06/ADR-002-version-content-and-time.md) (una
  transferencia no lleva nombres ni conceptos), y el significado vigente de
  `operation.created_by` y `operation_version.created_by` (F03/ADR-010 §2,
  `data-model.md` §7: el actor que escribió la fila).
- **Se apoya en** [F03/ADR-002](../F03/ADR-002-schema-topology.md) (tres
  schemas; `api` es la única superficie), [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md)
  (comandos de provisioning idempotentes por clave) y
  [F09/ADR-004](../F09/ADR-004-group-invitations.md) (freno por cuenta en
  base, estado en vez de excepción).

## Contexto

### Lo que hay, medido (2026-09-17, `main` en `e83988e`, 52 migraciones)

**Una cuenta Nomey no tiene hoy ningún identificador público.** Todo lo que la
identifica vive en Auth y nada en tablas propias:

| Dato                | Dónde                        | Estado                                                                                                                                                            |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email               | `auth.users.email`           | Único identificador verificable. Confirmación obligatoria (`enable_confirmations = true`); el alta **no devuelve sesión**                                         |
| Teléfono            | `auth.users.phone`           | No existe: `[auth.sms] enable_signup = false`, sin proveedor. Cero teléfonos                                                                                      |
| Nombre              | `user_metadata.display_name` | Presentación, editable por el titular desde Perfil. **Ninguna función SQL lee `auth.users` ni `raw_user_meta_data`** (medido: cero referencias en 52 migraciones) |
| Identidad interna   | `sub` del JWT                | `sec.request_actor_id()`; el cliente sólo conoce el suyo                                                                                                          |
| Cuenta anónima      | `is_anonymous = true`        | Sin email, sin teléfono, sin fila en `auth.identities`, metadata vacía                                                                                            |
| Invitado convertido | mismo `id`                   | Email confirmado y provider `email`; indistinguible de una cuenta normal salvo por `core.scope.provisioned_as_guest`                                              |

**Lo que otra cuenta puede leer de una cuenta:** sólo nombres contextuales de
participante en grupos compartidos (`core.participant.display_name`, vía
`api.group_participant`, contrapartes de pagos y avisos). Nunca `user_id`,
nunca email, nunca el nombre de Auth. Es la frontera de F03/ADR-009 §1: la
identidad contextual de un ámbito no se correlaciona con nada fuera de él.

**El único mecanismo de «encontrar a alguien» es la invitación de grupo**
(F09/ADR-004): token opaco de 32 bytes, sólo su `sha256` en base, y un freno
por cuenta en `core.invitation_attempt` (20 intentos fallidos en 10 minutos)
dentro de un definer que devuelve estado en vez de lanzar. No existe ninguna
búsqueda por identificador.

**El alta, medida contra GoTrue `v2.195.0`:** `POST /signup` con confirmaciones
activas devuelve el usuario completo —`id`, `email`, `confirmation_sent_at`,
`user_metadata` con lo que viajó en `data`— y **ningún token**. Hasta confirmar
el correo no hay sesión (`400 email_not_confirmed`), y `anon` **no tiene
`USAGE` sobre `api`** (medido en catálogo). El alta es una transacción de
GoTrue: si el correo no puede enviarse, responde `500` y **no crea el usuario**
(`scripts/http-boundary-check.sh` lo reproduce). GoTrue no borra cuentas sin
confirmar. `supabase/config.toml` (CLI 2.115) declara el hook
`[auth.hook.before_user_created]` con `uri = "pg-functions://…"`; su
documentación oficial dice que recibe `user.id`, `user.email`,
`user.is_anonymous`, `user.app_metadata.provider` y `user.user_metadata`, que
«runs immediately before insertion into the database», dentro de la misma
transacción de Auth para funciones Postgres, y que sólo puede **aceptar** (`{}`)
o **rechazar** (`{"error": {"http_code": N, "message": "…"}}`). No modifica al
usuario, se dispara en toda creación (email, OAuth, anónimo) y **no** en
`updateUser`.

**Precedentes propios que este ADR reutiliza:** unicidad con código estable
por `exception when unique_violation` (`create_custom_category` →
`CATEGORY_NAME_TAKEN · 409`); reserva con caducidad y hash
(`core.group_invitation`); comandos de provisioning idempotentes por clave
(`core.provisioning_command`, F09/ADR-002); y la separación, ya vigente, entre
«quién escribió la fila» (`created_by`) y «quién es cada parte» (relaciones
de partes como `core.payment_detail`).

### Por qué hace falta

F12 trae transferencias entre usuarios (F12/ADR-002 y siguientes). Para
enviar dinero a alguien hay que poder **nombrarlo**, y hoy no hay forma de
nombrar a una cuenta fuera de un grupo compartido. La dirección de producto
(2026-09-17) descartó la agenda del teléfono, el teléfono verificado y la
búsqueda por correo: la persona piensa «@eduardo», no en identificadores.

Y el username **no puede** ser una simple etiqueta: es resoluble, único y
reutilizable con el tiempo, así que hay que decidir cómo se reserva, cómo
cambia de dueño y qué enseña el histórico cuando ya no es de quien era.

## Decisión

### §1 · Qué es el username

> **El username es un atributo público, único y resoluble de una cuenta
> Nomey.** Sirve para que otra persona te encuentre. No es la identidad interna
> (`uid`), no es una credencial, no sustituye al correo ni cambia el inicio de
> sesión, y no interviene en ninguna regla contable ni de autorización.

Se presenta siempre con `@` delante (`@eduardo`) y se acompaña del **nombre
público** (`Eduardo Álvarez`, §10). La dirección de resolución es una y
explícita:

- `username → uid` **sólo** cuando una acción busca a alguien (§11): al
  elegir el destinatario de una transferencia. El resultado se persiste como
  `uid`; el texto no se guarda en ninguna operación.
- `uid → identidad pública actual` al leer cualquier histórico (§13).
- **Nunca** `username histórico → uid`.

### §2 · Persistencia: relación propia en `core`

El username vive en **una relación propia de `core`**, escrita sólo por
funciones de Nomey. **No** vive en `user_metadata`: ese campo lo escribe el
propio cliente con `updateUser`, no admite índice único ni RLS, y ninguna
función SQL lo lee hoy ni empezará a leerlo.

Conceptualmente, **una fila por handle**:

| Dato             | Qué es                                                              |
| ---------------- | ------------------------------------------------------------------- |
| `user_id`        | La cuenta. Sin FK a `auth.users`, como todo `core`                  |
| `handle`         | El username normalizado (§3), sin `@`                               |
| `public_name`    | El nombre público que acompaña al handle (§10)                      |
| `reserved_at`    | Cuándo nació la reserva                                             |
| `reserved_until` | Fin de la reserva provisional (§6); nulo una vez reclamado          |
| `claimed_at`     | Cuándo se hizo definitivo (§7); nulo mientras es una reserva        |
| `released_at`    | Cuándo su dueño lo dejó al cambiar (§9); nulo mientras es el activo |
| `held_until`     | Fin de la retención tras un cambio (§9); nulo mientras es el activo |

Dos garantías **estructurales**:

- **Índice único sobre `handle`.** Arbitra reservas, activos y retenidos a la
  vez: un handle tiene, como mucho, una fila viva. La unicidad la decide
  PostgreSQL dentro de la transacción que escribe, nunca una comprobación
  previa.
- **Índice único parcial sobre `user_id` entre las filas no liberadas.** Una
  cuenta tiene **un solo handle activo o reservado**.

Los nombres físicos, los tipos y los `CHECK` los fija la migración. El estado
de una fila es **derivado** de sus marcas (reservada · definitiva · retenida ·
caducada · liberable), no una columna de estado (F03/ADR-010).

Las filas liberadas **se conservan**: son el historial de handles de cada
cuenta —retención, auditoría y soporte—. **No se publican como identidad
histórica en movimientos** (§13).

Escritores: el hook de alta (§5) y comandos de provisioning bajo
`nomey_provisioner` (§7, §8, §9, §10), siempre sobre `user_id =
sec.request_actor_id()`. El cliente lee **su** fila por una vista
`security_invoker` acotada al actor; lo demás sale por el resolver (§11).
**No existe ningún listado.**

### §3 · Sintaxis

| Regla     | Valor                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Alfabeto  | `a–z`, `0–9`, `_`: los tres son _unreserved_ (RFC 3986), así que un handle nunca se codifica en URL, deep link ni QR |
| Longitud  | 3–20                                                                                                                 |
| Forma     | `^[a-z](_?[a-z0-9])*$`: empieza por letra; `_` nunca al principio, nunca al final, nunca doble                       |
| Case      | Insensible. Se almacena **una sola forma, en minúsculas**: `@Eduardo` y `@eduardo` son el mismo handle               |
| `@`       | Sólo presentación. La entrada lo tolera, con espacios exteriores; nunca se almacena                                  |
| Excluidos | `.`, `-`, espacios, tildes, `ñ` y cualquier carácter fuera del alfabeto                                              |

**Pipeline de normalización, en este orden:** NFKC → minúsculas → validar
contra la forma y la longitud → **rechazar** lo que no cumpla. **No se
translitera**: `@eduardo_álvarez` no se convierte en `@eduardo_alvarez`, se
rehúsa con `USERNAME_INVALID`. NFKC sólo pliega formas de compatibilidad
(`ａ` → `a`, `①` → `1`).

Por qué sin `.` ni `-`: el punto crea ambigüedad con dominios y separadores de
ruta y cuasi-duplicados (`ana.lopez` / `analopez`); el guion se confunde
visualmente con el guion bajo. Por qué sin Unicode: los homoglifos (`а`
cirílica frente a `a`) harían que dos handles distintos parecieran el mismo.
**ASCII queda fijado para v1**; ampliar el alfabeto exige un ADR nuevo que
decida la unicidad por esqueleto de confusables (UTS #39), no por igualdad.

La regla vive en **una** función SQL de normalización y validación y en su
gemela en `src/domain/`, sobre un vector compartido (`tests/vectors/username.json`),
como el reparto (F01/ADR-001 §7).

### §4 · Reservados

**Prefijos bloqueados (4):** `nomey`, `admin`, `support`, `soporte`. Todo
handle que empiece por uno de ellos queda reservado.

**Exactos bloqueados (25):**

| Categoría                    | Handles                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Soporte y seguridad          | `help` · `ayuda` · `security` · `seguridad`                                                                      |
| Roles que inducen confianza  | `staff` · `team` · `equipo` · `official` · `oficial` · `verified` · `verificado` · `root` · `system` · `sistema` |
| Rutas e intenciones técnicas | `join` · `pay` · `auth` · `recovery` · `api` · `app`                                                             |
| Estados y valores            | `null` · `anonymous` · `anonimo` · `invitado` · `guest`                                                          |

Total contractual: **25 exactos y 4 prefijos**. Viven en el mismo vector
compartido de §3 y se siembran por migración; añadir uno es cambiar el vector
y la migración, no el código.

Errores de forma y de reserva:

| Código              | HTTP | Cuándo                                              |
| ------------------- | ---- | --------------------------------------------------- |
| `USERNAME_INVALID`  | 400  | No cumple §3 tras normalizar                        |
| `USERNAME_RESERVED` | 422  | Coincide con un exacto o empieza por un prefijo     |
| `USERNAME_TAKEN`    | 409  | Ya tiene una fila viva (reserva, activo o retenido) |

### §5 · Reserva en el alta: el hook `before_user_created`

En un alta normal por correo el formulario pide **Nombre · Username · Email ·
Contraseña**, y el username es **obligatorio**. El cliente lo manda en
`options.data.requested_username` junto al `display_name`.

**La reserva se hace dentro de la misma transacción en que GoTrue crea la
cuenta**, mediante el hook `before_user_created` apuntando a una función
PostgreSQL `SECURITY DEFINER` de `sec`:

1. Recibe el evento con el `uid` **que GoTrue asigna**. El cliente no aporta
   ni decide ningún `uid`.
2. `is_anonymous = true` → `{}`: un Invitado no reserva aquí (§8).
3. `provider ≠ 'email'` (OAuth, F8.B) → `{}`: no hay formulario; la cuenta
   pasará por el gate (§7).
4. `provider = 'email'` sin `requested_username` → rechazo `USERNAME_REQUIRED · 400`.
5. Normaliza (§3); inválido → `USERNAME_INVALID`; reservado → `USERNAME_RESERVED`.
6. Desaloja, si existe, una fila **caducada** con ese handle (§6, §9).
7. Inserta la reserva: `user_id` = el del evento, `handle`, `public_name` =
   `display_name` del alta (§10), `reserved_at = now()`, `reserved_until =
now() + 7 días`. `unique_violation` → rechazo `USERNAME_TAKEN · 409`.
8. `{}`.

Un rechazo del hook hace que **GoTrue no cree la cuenta y no envíe correo**;
una aceptación deja la reserva y la cuenta en la misma transacción, de modo
que si GoTrue falla después (por ejemplo al enviar el correo), la reserva se
deshace con él. Dos altas simultáneas con el mismo handle: la segunda espera
el índice único, recibe `unique_violation` y se rechaza; **una gana, sin
cuenta a medias**.

**Privilegio mínimo, y una precisión a F03/ADR-003.** El hook lo invoca el rol
de Auth `supabase_auth_admin`. Ese rol recibe **`USAGE` sobre `sec` y
`EXECUTE` sobre esa única función**, `SECURITY DEFINER` con `search_path`
pinado y owner `nomey_provisioner` (la frontera de las escrituras que no son
contabilidad, F06/ADR-001). No ve tablas, no ejecuta nada más, no toca `api`
ni `core`. Una guarda de catálogo afirma que `supabase_auth_admin` puede
ejecutar **exactamente una** función de `sec` y ninguna de `api`. F03/ADR-003
no cambia en nada más: `anon` sigue sin `USAGE` sobre `api`; `core` y `sec`
siguen fuera de toda superficie cliente.

**Lo que se descarta, y por qué,** está en «Alternativas»: abrir una función a
`anon`, una Edge Function, un trigger en `auth.users`, o reclamar después de
confirmar.

**Prechequeo público:** no existe. La disponibilidad se conoce al pulsar
«Crear cuenta»: si el handle está cogido, la cuenta **no se crea** y se elige
otro. Un oráculo de disponibilidad sin sesión sería enumeración sin cuenta.

**Cómo llega el error al cliente:** el `http_code` y el `message` los pone
Nomey (`message` lleva el código estable); qué `error_code` acompaña el
rechazo de un hook lo fija GoTrue y se **mide** al implementar (evidencia,
más abajo). `auth-errors.ts` mapea por el código estable.

### §6 · Reserva provisional: 7 días

Una reserva es **provisional** durante **7 días**. Mientras
`claimed_at IS NULL` y `reserved_until >= now()`, el handle está reservado
para ese `uid`: cualquier otro alta o reserva con él recibe `USERNAME_TAKEN`.

> **Caducada ⇔ `claimed_at IS NULL ∧ reserved_until < now()`.**

La caducidad **no depende de `auth.users.email_confirmed_at`** ni de ningún
dato de Auth: una cuenta que confirmó el correo y no volvió a abrir Nomey
deja caducar su reserva igual que una que nunca confirmó. Y caduca **también
para su dueño**: no hay «la recupero si nadie la cogió».

**Desalojo perezoso, sin cron obligatorio:** la fila caducada la retira el
siguiente alta o reserva que quiera ese handle (§5.6), o el propio `claim`
que la encuentra caducada. Mientras nadie la pida, es historia sin efecto.

Si la cuenta vuelve después de caducar: la cuenta **sigue existiendo**, entra
en el **gate de username** (§7) y elige uno disponible; el anterior sólo si
sigue libre.

### §7 · Claim: hacer definitiva la reserva

En el **primer ciclo autenticado con cuenta no anónima** —donde hoy corre
`ensure_personal_scope`— la app llama a `claim_username`, un comando de
provisioning **idempotente por estado**, sólo sobre `user_id =
sec.request_actor_id()`:

| Estado de la fila del actor | Resultado                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ |
| Reserva viva                | `claimed_at = now()`, `reserved_until = null`: **definitiva**                  |
| Ya definitiva               | Nada; responde el estado                                                       |
| Caducada                    | Se retira la fila; `USERNAME_RESERVATION_EXPIRED · 409`; la app enseña el gate |
| Sin fila                    | `USERNAME_REQUIRED · 409`; la app enseña el gate                               |

El **gate** es una pantalla obligatoria antes de las pestañas: «Elige tu
nombre de usuario», con comprobación de disponibilidad por el propio comando
de reserva en sesión (`reserve_username`, §8) y reclamación inmediata. Es el
**respaldo**, no el camino normal: lo ven las cuentas creadas por OAuth, los
Invitados convertidos sin reserva, las reservas caducadas y las cuentas
anteriores a este ADR. Hasta reclamar, la cuenta **no puede** enviar, recibir
ni solicitar dinero (F12/ADR-002 y siguientes lo exigen con
`USERNAME_REQUIRED`).

Un reintento del claim sin red no pierde nada: la reserva sigue viva hasta
`reserved_until`. El caso residual —abrir Nomey con sesión confirmada el día 6
sin red y volver el día 8— pierde la reserva y ve el gate; se acepta y se
explica.

### §8 · Invitado → cuenta

Un Invitado (sesión anónima real, F05/ADR-003) **no tiene username** y no
puede reservarlo mientras sea anónimo: el hook lo acepta sin reserva (§5.2) y
los comandos en sesión rehúsan un JWT con `is_anonymous`
(`USERNAME_GUEST_NOT_ALLOWED · 409`).

Al **convertirse**, el formulario pide también el username. Como la
conversión es `updateUser` sobre la sesión existente —misma cuenta, mismo
`uid`— y el hook **no** se dispara, la reserva se hace **antes** de
`updateUser` con un comando autenticado, `reserve_username`: misma relación,
misma unicidad, misma reserva provisional de 7 días, mismos códigos. Si
`updateUser` falla después, la reserva queda provisional a nombre del mismo
`uid` y caduca por sí sola si la conversión no llega a completarse. Al
confirmarse el correo, la sesión deja de ser anónima y el primer ciclo
autenticado reclama (§7).

`reserve_username` es también el comando del gate (§7): reserva y reclama en
la misma llamada cuando el actor ya no es anónimo.

### §9 · Cambio de username

Permitido, con dos plazos:

- **Cooldown: 30 días** entre cambios. Antes, `USERNAME_CHANGE_COOLDOWN · 409`
  con la fecha en la que vuelve a poder cambiarse.
- **Retención: 90 días.** El handle anterior queda con `released_at = now()`
  y `held_until = now() + 90 días`. Durante la retención **no resuelve** para
  nadie (§11), **no puede pertenecer a otra cuenta**, y **sí puede
  recuperarlo su antiguo dueño**; recuperarlo es un cambio: cuenta para el
  cooldown.

Tras los 90 días el handle queda disponible; el desalojo es perezoso, como
en §6: lo retira quien lo pida (`held_until < now()`).

El cambio lo hace un comando de provisioning sobre la cuenta propia: libera la
fila activa (marcas, no borrado) e inserta la nueva en la misma transacción,
bajo el índice único. Las filas liberadas **no se borran**: son el historial
de la cuenta, insert-only en su significado temporal.

**Riesgo que se acepta, y por qué:** tras 90 días alguien puede registrar un
handle liberado y ponerse el mismo nombre público. Ninguna operación cambia de
dueño por ello (§13); lo que puede ocurrir es que una persona escriba de
memoria un handle antiguo y envíe una propuesta a quien lo tenga hoy. Lo
acotan el cooldown, la retención y la confirmación con nombre público y handle
antes de enviar. Un username inmutable evitaría este riesgo, pero con la
reserva en el alta dejaría fijado para siempre un error de tecleo.

### §10 · Nombre público

Junto al handle existe **`public_name`**, en la misma fila: el nombre con el
que la persona acepta que los demás la vean. Es lo que otra cuenta ve, siempre
junto al handle:

```
Eduardo Álvarez
@eduardo
```

- **Nace del `display_name` del alta** (el hook lo toma del evento; el gate y
  la conversión, del formulario).
- **Perfil lo edita** escribiendo **primero `core`** (comando de
  provisioning sobre la cuenta propia) y **después** la metadata de Auth
  (`updateDisplayName`, que ya existe), para que el saludo propio de Inicio
  —que lee la metadata porque está disponible antes de cualquier RPC— siga
  funcionando. Una deriva entre ambos, si la segunda escritura falla, es
  cosmética y propia; Perfil la reintenta.
- **Ninguna función SQL lee `auth.users.raw_user_meta_data` para resolver el
  nombre de otra persona.** La copia en `core` es la autoritativa para
  terceros.
- `public_name` **no es único, no es identidad, no es un CAS** y puede
  cambiar. Dos personas pueden llamarse igual; lo que las distingue es el
  handle. No se guarda historial de `public_name` en v1.

### §11 · Resolución: exacta, y nada más

Un único mecanismo, `resolve_username(handle)`, definer de `postgres` (patrón
`preview_invitation`), que normaliza la entrada (§3) y responde **estado, no
excepción**:

| Estado      | Cuándo                                                                                                        | Qué devuelve                         |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `found`     | Hay una fila **definitiva y activa** (`claimed_at ≠ null`, `released_at = null`) con ese handle               | `handle` normalizado y `public_name` |
| `not_found` | No existe; o es una reserva sin reclamar; o está retenido; o la cuenta no es elegible (anónima, sin Personal) | Nada más                             |
| `self`      | Es el handle del actor                                                                                        | —                                    |
| `throttled` | El actor superó el freno (§12)                                                                                | —                                    |

**Nunca** devuelve `uid`, `scope_id`, email ni ningún identificador interno. La
lista de columnas de esta función **es** la frontera de privacidad (mismo
principio que `api.claimed_dimension()`, F03/ADR-013).

`not_found` **no distingue** «no existe» de «existe pero no es alcanzable»: no
se confirma la existencia de una cuenta que no puede recibir nada.

**No existen:** autocompletar, búsqueda por prefijo, directorio, búsqueda por
correo, contactos ni teléfono. Son enumeración por diseño y convertirían a
Nomey en un directorio de personas. Encontrar a alguien exige escribir su
handle completo, que es exactamente el gesto «me han dicho su @».

### §12 · Freno del resolver

`resolve_username` es un oráculo de existencia, y se frena con el patrón de
`sec.resolve_invitation` (F09/ADR-004):

- **20 consultas por cuenta en 10 minutos.** Cuentan **todos** los resultados
  salvo `self` y `throttled`: un acierto también revela información.
- Al superarlo, estado `throttled` (sin excepción, para que el apunte quede
  confirmado).
- El apunte guarda **actor y momento**, nunca el handle consultado. Poda
  perezosa de apuntes de más de un día, en la propia función.

Veinte consultas en diez minutos cubren cualquier uso real —resolver a dos o
tres personas antes de enviar— y hacen la enumeración por diccionario
impracticable sin miles de cuentas confirmadas.

### §13 · Identidad histórica: siempre la actual del `uid`

> **Una operación persiste identificadores internos y nunca usernames ni
> nombres.** Al leer cualquier histórico, la identidad pública que se enseña es
> la **actual** del `uid`: `public_name` y `@handle` activos hoy.

Es la postura que el modelo ya tiene para todo lo demás: las operaciones
persisten ids; los nombres se reconstruyen al leer, al valor actual
(`sec.payment_counterpart_name`, `api.group_participant`); «renombrar cambia
lo que muestra el histórico» (F06/ADR-003). Aquí es además la única opción que
cumple el principio de que **cambiar de username no puede reasignar una
operación ni hacer que una antigua parezca de otra persona**:

- Ana paga usando `@ana`; después cambia a `@anagarcia`; más tarde `@ana` lo
  registra otra persona. Toda fila antigua muestra **`Ana García · @anagarcia`**,
  porque resuelve `uid → handle activo`, nunca un texto. La persona que hoy
  tiene `@ana` no aparece en ninguna fila que no sea suya.
- **No se muestra «entonces @ana»** en v1. Un handle histórico visible es un
  identificador vivo que hoy puede apuntar a otra persona: enseñarlo sería
  crear el riesgo que se quiere evitar. El historial de handles (§2, §9)
  existe para retención, auditoría y soporte, y **no se expone en
  movimientos**.
- Sin fila activa (una cuenta en el gate), se enseña `public_name` si existe y
  ningún handle; nunca un handle liberado.

Los roles económicos de una operación —quién envió, quién recibió— viven en
sus relaciones de partes y en sus efectos, no en el username ni en
`created_by` (F03/ADR-010 §2, `data-model.md` §7). Cómo se persisten esas
partes para las transferencias lo fija F12/ADR-002.

### §14 · Lo que este ADR deja preparado, y lo que no decide

Preparado para F12/ADR-002 y siguientes: un mecanismo de descubrimiento
exacto y frenado (§11, §12); la resolución `username → uid` que un writer hace
**una vez**, bajo su transacción, persistiendo el `uid`; la identidad pública
(§10) y su lectura histórica (§13); la condición «cuenta con username
reclamado» como requisito para operar entre usuarios (§7).

No decidido aquí: el contrato financiero de las transferencias, las propuestas
de envío, las solicitudes de pago, sus avisos y sus enlaces.

## Alternativas consideradas

- **Username en `user_metadata`, con o sin trigger de copia a `core`.**
  Rechazada: lo escribiría el cliente sin frontera, sin índice único ni RLS, y
  obligaría a SQL a leer `auth.users`, cosa que ningún ADR ha hecho.
- **Reclamar el username sólo después de confirmar el correo** (sugerencia en
  metadata + gate). Rechazada como camino principal: durante la confirmación
  cualquier otro alta podría coger el handle; incumple «forma parte de crear
  la cuenta». Se conserva como **respaldo** (§7).
- **Función `api` accesible a `anon` para reservar.** Rechazada: sin sesión
  no hay `uid` verificable, así que la función tendría que **confiar en un
  `uid` enviado por el cliente** (cualquiera reservaría para la cuenta de
  otro), y exigiría dar `USAGE` sobre `api` a `anon`, superando F03/ADR-003 y
  regalando un oráculo sin cuenta ni captcha.
- **Reserva previa al alta con capability opaca.** Rechazada: ligarla al `uid`
  exige de nuevo el hook, y la fase previa es acaparamiento a coste cero.
- **Edge Function que sustituya a `signUp`.** Rechazada ahora: introduce
  Deno, secretos de backend, despliegue por entorno (F8, criterio 2
  pendiente) y sortea los límites y el captcha de GoTrue; coste
  desproporcionado para una regla de unicidad.
- **Trigger `before insert` en `auth.users`.** Descartado definitivamente:
  hace lo mismo que el hook sin contrato de errores (un rechazo llega como
  `500 Database error saving new user`) y Supabase desaconseja triggers en el
  schema `auth`.
- **Desalojo condicionado a `email_confirmed_at IS NULL`.** Rechazada: una
  cuenta que confirma y no vuelve bloquearía el handle indefinidamente, y
  haría depender el estado de un dato de Auth.
- **Username inmutable.** Rechazada: con la reserva en el alta, un error de
  tecleo quedaría fijado para siempre; el cambio con cooldown y retención da
  la misma protección contra suplantación inmediata.
- **Reutilizar `display_name` de Auth como nombre público.** Rechazada:
  obligaría a un definer a leer `raw_user_meta_data` de otra cuenta, sin
  ninguna regla nuestra sobre su contenido. Se prefiere una copia acotada en
  `core`, escrita por la frontera.
- **`expected_public_name` o una resolución opaca (`recipient_resolution_id`)
  para ligar previsualización y destinatario.** Rechazadas: el nombre no es
  identidad ni único, y la política de cambio (30 + 90 días) ya impide que un
  handle cambie de persona entre previsualizar y confirmar. El writer resuelve
  el handle activo bajo su transacción (F12/ADR-002).
- **Prefijo, autocompletar o directorio.** Rechazados: enumeración por diseño.
- **Frenar sólo los fallos del resolver**, como la invitación. Rechazada: en
  un oráculo de existencia el acierto también informa.
- **Mostrar el handle de entonces («entonces @ana») en el histórico.**
  Rechazada en v1: enseña un identificador resoluble que puede pertenecer hoy
  a otra persona.

## Consecuencias

### A favor

- Una cuenta puede encontrarse **sin** compartir grupo, sin correo, sin
  teléfono y sin agenda, y el `uid` sigue siendo la única identidad.
- La unicidad es autoritativa y atómica con la creación de la cuenta; no
  existe ninguna ventana en la que un handle reservado pueda perderse por
  carrera.
- Sin `anon` en `api`, sin Edge Functions, sin triggers en `auth`: la frontera
  nueva es un rol de Auth ejecutando una única función de `sec`, guardada en
  catálogo.
- El histórico no cambia de sujeto jamás: resolver por `uid` hace imposible
  que la reutilización de un handle toque una operación antigua.
- El patrón de freno, de reserva con caducidad y de comando idempotente ya
  existe; no se inventa maquinaria.

### En contra

- **La disponibilidad se conoce al pulsar «Crear cuenta»**, no mientras se
  escribe: un handle cogido cuesta un viaje de ida y vuelta. Es el precio de
  no abrir un oráculo sin sesión.
- **`USERNAME_TAKEN` en el alta es un oráculo de existencia**, acotado por los
  límites por IP de GoTrue y sin crear nada; equivalente al oráculo «correo ya
  registrado» que todo alta tiene.
- **Confusables ASCII** (`l`/`1`, `0`/`o`, `rn`/`m`) no se prohíben; la
  defensa es la confirmación con nombre público y handle.
- **Suplantación lenta** tras 90 días de retención: trazada en el historial,
  no impedida.
- **Dos copias del nombre** (metadata para el saludo propio, `core` para los
  demás) con deriva posible y cosmética.
- **Reserva perdida** para quien no abre Nomey con red en 7 días: gate,
  explicado.
- **ASCII permanente en v1** obliga a nombres latinos.
- **Alojado:** el hook se activa en el Dashboard del proyecto; el repositorio
  lo declara en `config.toml`, lo mide en local y CI, y el runbook lo exige
  antes del primer despliegue. Un proyecto alojado sin el hook activo
  **crearía cuentas sin reserva** (irían al gate): no es una brecha, pero sí
  una desviación que la evidencia de despliegue debe detectar.
- Las cuentas de desarrollo existentes (diez en local) verán el gate en su
  siguiente sesión; no hay producción ni datos que migrar.
- `scripts/http-boundary-check.sh` y toda carrera que dé de alta por correo
  deberán enviar `requested_username`.

### Evidencia que exige este ADR al implementarse

Ninguna afirmación de arriba se da por cumplida sin su medida:

1. **Vectores compartidos** (`tests/vectors/username.json`) de sintaxis y
   reservados, consumidos por la función SQL y por `src/domain/`: válidos,
   inválidos por cada regla, NFKC sin transliteración, los 25 exactos y los 4
   prefijos.
2. **Dos `POST /signup` reales y simultáneos** contra GoTrue con el mismo
   handle: una cuenta creada, un `409` sin cuenta ni correo.
3. `@Eduardo` tras `@eduardo` → `USERNAME_TAKEN`.
4. Alta por correo sin `requested_username` → `USERNAME_REQUIRED`, sin cuenta.
5. `signInAnonymously` y un alta con `provider ≠ email` aceptados sin username.
6. Reserva viva durante 7 días; **caducada con el correo confirmado** y sin
   claim: desalojada por otro alta, y la cuenta original entra en el gate.
7. `claim_username` idempotente: dos llamadas, un solo `claimed_at`; sobre una
   reserva caducada, `USERNAME_RESERVATION_EXPIRED`.
8. Conversión de Invitado: reserva antes de `updateUser`; anónimo rehusado
   con `USERNAME_GUEST_NOT_ALLOWED`.
9. Cambio: cooldown de 30 días (`USERNAME_CHANGE_COOLDOWN`), retención de 90
   (el retenido **no resuelve** y no puede reservarlo otro; el dueño sí lo
   recupera); liberado tras 90 días **sí** puede reclamarlo otra cuenta.
10. `resolve_username`: `found` sólo para definitivo y activo; `not_found`
    para reserva, retenido, inexistente y anónimo; `self`; **20/10 min** →
    `throttled`, contando aciertos; apunte sin handle; poda.
11. **El error real que GoTrue devuelve** cuando el hook rechaza (`status`,
    `error_code`, `msg`), medido por HTTP y mapeado en `auth-errors.ts`.
12. **Guarda de catálogo**: `supabase_auth_admin` ejecuta exactamente una
    función de `sec` y ninguna de `api`; `anon` sigue sin `USAGE` sobre
    `api`; ninguna vista de `api` publica `user_id` a partir de un handle.
13. **Identidad histórica**: tras un cambio de handle, las filas anteriores
    de ambas partes muestran el handle nuevo; tras la reutilización por otra
    cuenta, ninguna fila antigua la nombra.
14. Frontera HTTP con JWT real: alta con username, claim, cambio, resolución
    y freno; `personal_operation`/vistas de F12 sin `uid` ni `scope_id`
    ajenos.

## Documentación que este ADR obliga a reconciliar

- **`docs/adr/F03/README.md`**: nota de precisión sobre F03/ADR-003 (el rol
  `supabase_auth_admin` y la única función de `sec` que ejecuta). El ADR
  aceptado no se edita.
- **`docs/product/roadmap.md`**, Fase 12: el username como capacidad de la
  fase y el bloque que lo implementa; los criterios de cierre.
- **`docs/product/glossary.md`**: «Username», «Nombre público»; precisar
  «Usuario» (cuenta) frente a «Participante» y «Usuario vinculado», que no
  cambian.
- **`docs/architecture/data-model.md`**: declarar el username como atributo
  público de la cuenta, fuera del modelo contable (§12 «fuera de este
  documento» o §6, sin tocar la tabla de participantes); nada de 4.6/4.8 aquí.
- **`docs/PROJECT_STATE.md`**: cuando el bloque que lo implemente cierre.
- **`docs/runbooks/local-setup.md`** y el runbook de entornos: activar el hook
  en local y en el proyecto alojado.
- **`AGENTS.md`** §5/§7 no cambian; «Current state» al cerrar el bloque.
