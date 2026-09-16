# F05/ADR-003 — La sesión de invitado es una sesión anónima real de Auth, y se convierte en cuenta sin cambiar de identidad

- **Estado:** Aceptado (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** F10.A3 (modo Invitado real). Va en F05 porque decide identidad y
  sesión; F10 la cita.
- **Alcance:** qué es «Entrar como invitado», qué es un invitado para el
  servidor y para la app, cómo un invitado se convierte en cuenta y qué pasa
  cuando un invitado intenta entrar en una cuenta que ya existe.
- **No cubre:** fusionar una identidad de invitado con una cuenta existente
  (declarado no resuelto en §5; tendrá ADR propio si el producto lo pide);
  proveedores externos (Apple, Google: F8.B); la configuración del proyecto
  alojado más allá de nombrarla (§6).
- **Se apoya en** [F05/ADR-001](ADR-001-secure-session-storage.md) (la
  sesión persiste en el dispositivo), [F03/ADR-004](../F03/ADR-004-membership-rls.md)
  (la RLS resuelve por `auth.uid()`), [F03/ADR-009](../F03/ADR-009-participant-identity.md)
  y [F03/ADR-013](../F03/ADR-013-economic-attribution.md) (identidad
  contextual y atribución por vínculo), [F06/ADR-001](../F06/ADR-001-personal-provisioning.md)
  (el Personal se provisiona en el ciclo autenticado) y [F10/ADR-002](../F10/ADR-002-permanent-identity.md)
  (la identidad en el grupo es permanente).

## Contexto

El producto quiere que alguien use Grupos sin crear una cuenta: pulsar
«Entrar como invitado» en Entrar y aterrizar en Grupos, con invitaciones,
participantes, gastos y pagos como cualquier miembro; sin Modo Personal ni
Perfil hasta que cree su cuenta. Y que crear la cuenta **no pierda nada** de
lo hecho como invitado.

Todo el modelo económico está atado a `auth.users.id`: `sec.request_actor_id()`
lo lee del JWT, la RLS y el writer autorizan por él, `core.membership`,
`core.participant_user_link`, `core.scope.owner_user_id`, `core.operation.created_by`
y los comandos lo guardan. Una identidad de invitado «de Nomey» —un id
inventado en el cliente, un bit de estado— no tendría nada de eso; y una que
se sustituyera por otro `auth.users.id` al crear la cuenta dejaría huérfano
todo lo anterior.

Se midió contra el stack local (GoTrue del CLI, `enable_anonymous_sign_ins`):

1. `POST /auth/v1/signup` sin credenciales crea un usuario con
   `is_anonymous = true` y devuelve una sesión cuyo JWT lleva
   `role: authenticated`, `is_anonymous: true` y `sub = auth.users.id`.
2. Con ese JWT, `ensure_personal_scope`, `create_group`,
   `create_group_invitation`, `record_group_expense` y las vistas responden
   como a cualquier miembro. Nada del servidor distingue al invitado.
3. `PUT /auth/v1/user {email, password, data}` sobre esa sesión responde el
   **mismo id**, deja la contraseña puesta, el nombre guardado y el correo en
   `new_email` con un correo de confirmación enviado (`enable_confirmations`;
   para GoTrue es un cambio de correo, aunque no hubiera ninguno).
4. Hasta confirmar, el usuario sigue anónimo y nada se mueve. Al seguir el
   enlace: `email` fijado, `is_anonymous = false`, y **el refresh token que el
   dispositivo ya tenía sigue valiendo** y devuelve la cuenta con el mismo
   `sub`. Entrar después con la contraseña nueva es el mismo id.
5. `POST /token?grant_type=password` desde una sesión anónima **no fusiona
   nada**: emite otro `sub`, y lo del invitado se queda con el primero.

## Decisión

### §1 · Un invitado es una sesión anónima real de Supabase Auth

«Entrar como invitado» ejecuta `supabase.auth.signInAnonymously()` por la capa
de Auth de Nomey (`features/auth`), nunca desde la UI. No existe ningún estado
de invitado propio de la app: **la sesión anónima es la sesión**, se persiste y
se refresca como cualquier otra (F05/ADR-001), y sobrevive a cerrar y reabrir
la app mientras Supabase la conserve. `auth.users.id = actor_id`, el mismo
que hoy.

La app la reconoce por lo que dice el servidor: `user.is_anonymous` (y el
claim `is_anonymous` del JWT). `SessionIdentity` lo publica como
`isAnonymous`; `isGuest(state)` es «signed-in y anónimo». Un invitado
**cuenta como autenticado** para todo lo demás: guards, provisioning, Grupos.

### §2 · Lo que ve un invitado

- **Aterriza en Grupos** (`initialRouteName` de las pestañas cuando la sesión
  es anónima; sin pantalla intermedia ni selector). Grupos es Grupos: los
  mismos flujos que un miembro —invitar, participantes, gastos, pagos,
  salir, volver— con los mismos contratos, porque el servidor no distingue.
- **Inicio** es «Crea tu cuenta», y nada más: nombre (precargado con el que
  dio al entrar), email, contraseña y el botón amarillo «Crear cuenta». **Sin
  login dentro de la sesión de invitado**: ni «Entrar», ni recuperar, ni
  «Entrar como invitado» (ya lo es), ni Apple ni Google (F8.B). La única
  acción de cuenta es convertir ESTE usuario anónimo (§3). El `+` del dock no
  se ofrece en Inicio a un invitado: no hay Modo Personal al que añadir.
- **Perfil** conserva su estructura —arriba un oblongo «CREAR CUENTA» que
  navega a la pestaña Inicio (una sola implementación del formulario; ni
  modal ni ruta), debajo los ajustes que no dependen de una cuenta completa
  (los generales; sin nombre editable, planes ni «Cuenta») y, al final, una
  salida discreta: «Cerrar sesión», porque es una sesión real. La
  confirmación dice lo que cuesta: una sesión anónima no se recupera.
- **El Personal interno existe igual.** `api.ensure_personal_scope` se sigue
  ejecutando en el ciclo autenticado (F06/ADR-001): el modelo económico lo
  necesita para la caja de pagos y liquidaciones. Lo que no existe es la UI
  de Modo Personal hasta que haya cuenta.

### §3 · Convertir Invitado → cuenta conserva el `auth.users.id`

«Crear cuenta» (Inicio, `GuestSignUp`) es `convertGuest`: `supabase.auth.updateUser({
email, password, data })` sobre la sesión anónima. **Nunca `signUp`.** Mismo
usuario, mismo id; por construcción no cambia ninguna fila: memberships,
vínculos, Personal, gastos, pagos, deudas, historia y comandos siguen colgando
del mismo actor. Inicio muestra «Revisa tu correo» con el paso propio de un
invitado, sin navegar, y sobrevive a un reload mientras el servidor espere
(`new_email` en el usuario guardado: presentación, no autoridad).

**La copia del dispositivo se queda vieja, y cómo se descubre.** Medido: tras
seguir el enlace, la sesión GUARDADA (usuario y JWT) sigue diciendo
`is_anonymous: true` —confirmar un correo no re-emite tokens en otros
dispositivos—, mientras `GET /user` con ese mismo token ya responde la cuenta
(`is_anonymous: false`, email fijado; autoritativo, de solo lectura, sin
rotar nada) y el refresh devuelve una sesión cuyo usuario y JWT son la cuenta,
mismo `sub`. Por eso el ciclo de sesión, ante una **conversión pendiente**
(anónimo con `new_email`), pregunta al servidor con `getUser` y, solo cuando
la respuesta es que ya hay cuenta, pide `refreshSession`, que la librería
persiste y anuncia por `onAuthStateChange`. Tres disparadores: **al restaurar
la sesión** (arranque en frío, reload), **al volver al primer plano**, y **un
sondeo cada 15 s mientras siga pendiente y la app esté activa** —nunca
permanente: se detiene en cuanto el servidor dice cuenta o la conversión deja
de estar pendiente—, porque el enlace se sigue fuera de la app, a menudo en
otro dispositivo, sin que ningún `AppState` lo delate. La app pasa a cuenta
normal por el mismo evento que todo lo demás. Sin `router.replace`, sin
segundo mecanismo.

Y `convertGuest` pregunta antes de reenviar: si `getUser` ya dice cuenta,
refresca y no envía nada (reenviar con la copia vieja responde `422
same_password`, medido; se mapea a `authError.guestAlreadyConverted` por si
llegara igualmente).

`email_exists` en la conversión se dice tal cual («ese email ya tiene
cuenta»): `PUT /user` no lo ofusca, y fingir un correo enviado sería una
mentira del cliente.

### §4 · Entrar en una cuenta existente desde un invitado FALLA CERRADO

Ninguna pantalla del estado invitado ofrece entrar en otra cuenta: quien
tiene una debe **cerrar sesión** y usar Entrar. Y si algo llama a `signIn`
igualmente, el servicio comprueba la sesión almacenada y, si es anónima, **no
llama a `signInWithPassword`**: devuelve `authError.guestSignInBlocked`,
conserva la sesión de invitado y explica que crear una cuenta conserva sus
grupos y que para entrar con otra cuenta debe cerrar sesión antes. Es lo medido en §5 del
contexto: el password grant emite otro `sub` y no mueve nada.

### §5 · Lo que NO se decide: fusionar un invitado con una cuenta existente

No existe hoy una forma segura y explícita de fusionar la identidad de un
invitado con una cuenta que ya existe: exigiría cambiar `user_id` en
membresías, vínculos (permanentes, F10/ADR-002, y con un único vínculo activo
por cuenta y grupo, F10/ADR-003: dos vínculos activos en el mismo grupo no
pueden fundirse sin decidir cuál sobrevive), propiedad del Personal (dos
Personales, dos cajas), comandos e idempotencia. Se declara **no resuelto**,
con la limitación visible en el copy, y tendrá ADR propio si el producto lo
pide; no se improvisa una migración de propiedad sin medirla.

### §6 · Configuración

- Local: `supabase/config.toml` → `[auth] enable_anonymous_sign_ins = true`
  (el stack se reinicia para aplicarlo; `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED`).
  El límite `anonymous_users = 30` por hora e IP se deja.
- **Proyecto alojado: NO queda activado por este repositorio.** Hay que
  activar «Allow anonymous sign-ins» en el Dashboard (Authentication →
  Sign In / Providers) o con `supabase config push`. Hasta entonces «Entrar
  como invitado» responde `anonymous_provider_disabled`, que la app muestra
  como «no está disponible ahora mismo».
- La confirmación del correo de conversión usa la plantilla por defecto de
  GoTrue (`{{ .ConfirmationURL }}` → `site_url`); en local abre
  `127.0.0.1:3000`, que no existe, pero la verificación ya ha ocurrido. Una
  plantilla con enlace profundo a la app, como la de recuperación, queda
  como mejora, no como parte de esta decisión.

### §7 · Lo que se retira

La simulación de desarrollo (`guest-preview`: el bit en memoria, la ruta, la
entrada dev de Perfil y sus tests), y la primera puerta de acceso con login
dentro de la sesión (`GuestGate`, rutas `/register` y `/recover`). Una sola
fuente de verdad: la sesión; una sola vía de cuenta: `GuestSignUp`.

## Alternativas consideradas

- **Un estado de invitado propio de la app, sin Auth.** Rechazada: sin
  `auth.users.id` no hay RLS, ni writer, ni membresía; habría que inventar
  una segunda identidad y luego migrarla. Es exactamente lo que se pidió no
  hacer.
- **Convertir con `signUp` y migrar la propiedad.** Rechazada: cambia el id,
  y todo lo económico cuelga de él; el mecanismo correcto de Supabase para un
  anónimo es `updateUser`, medido.
- **Fusionar al entrar en una cuenta existente.** Aplazada (§5): sin regla
  medida para dos vínculos activos en un mismo grupo y dos Personales, sería
  una migración de propiedad a ciegas.
- **Confirmación por enlace profundo.** Aplazada (§6): funciona con la
  plantilla por defecto; el enlace profundo es UX, no identidad.

## Consecuencias

- El servidor no cambia: ni migración, ni función, ni policy. Un invitado es
  `authenticated` con `is_anonymous` en el JWT, y nada lo lee todavía.
- Un invitado que cierra sesión pierde el acceso a lo que hizo; la
  confirmación lo dice. Los grupos que creó siguen existiendo con sus
  invitaciones vivas (F09/ADR-003 §9).
- Evidencia: `scripts/http-boundary-check.sh` §14 (sesión anónima real,
  flujo de grupo con su JWT, conversión con el mismo id antes/durante/después,
  refresh y password grant al mismo id, huella idéntica, y el otro `sub` del
  password grant); `tests/infra/guest-session-surface.test.ts`;
  `tests/lib/session-state.test.ts` y `session-lifecycle.test.ts`.
