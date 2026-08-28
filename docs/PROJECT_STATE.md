# Estado del proyecto

> **Memoria comprimida para una sesión nueva.** Describe **dónde está Nomey
> ahora**, no cómo llegó. No decide nada: si contradice un ADR,
> [`data-model.md`](architecture/data-model.md) o el
> [roadmap](product/roadmap.md), mandan ellos.
>
> **Léelo después de [`AGENTS.md`](../AGENTS.md).** Con esos dos, y la
> documentación específica de la fase en curso cuando exista, basta para empezar;
> el resto se consulta **bajo demanda**.
>
> **Cómo se mantiene:** [`runbooks/project-context.md`](runbooks/project-context.md).
> En una línea: **lo que deja de ser vigente se sustituye o se borra, nunca se
> apila debajo de lo nuevo.**

Actualizado el **2026-08-28**, al cerrar el bloque **F6.B**.

---

## Dónde estamos

|                         |                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------- |
| **Fase en curso**       | **Fase 6 — Modo Personal.** Primer hito enseñable. **F6.A y F6.B cerrados**       |
| **Última fase cerrada** | **Fase 5 — Identidad y sesión** (A · B · C1 · D · E · F), el 2026-08-28           |
| **ADR aceptados**       | ADR-001 … ADR-021                                                                 |
| **Backend**             | Migrado y reconstruible desde cero, con CI verificándolo en cada PR               |
| **App visible**         | Shell navegable, y **Perfil con identidad real**. **Sin funcionalidad económica** |
| **Sesión**              | Email y contraseña, entrar, salir **y recuperar**. **Faltan Google y Apple**      |

**La Fase 6 está abierta.** Su estado, sus decisiones de producto cerradas y las
obligaciones de cada bloque están en
[`phase-6-handoff.md`](architecture/phase-6-handoff.md).

**F6.A cerró la fundación de datos del Modo Personal**, sin pantalla y a
propósito: catálogo monetario sembrado con identidades fijas, un **tercer rol**
`nomey_provisioner`, y las funciones que crean el ámbito con su membresía y
eligen su moneda. La decisión es
[ADR-019](adr/ADR-019-personal-provisioning.md) y la evidencia,
[`supabase/e21/`](../supabase/e21/README.md).

> **Backend sí, app todavía no.** `api.ensure_personal_scope` existe, es segura e
> idempotente, y está verificada por HTTP con JWT real y bajo concurrencia. Pero
> **la aplicación no la invoca en ningún punto de su ciclo autenticado**, así que
> hoy una cuenta recién confirmada **sigue sin Modo Personal** hasta que alguien
> llama a la función. Ese cableado es de **F6.E**, antes de que Inicio consuma el
> ámbito.

**F6.B dio anatomía al movimiento**, también sin pantalla: **concepto**
obligatorio, **categoría** siempre presente con catálogos separados de gasto e
ingreso, **hora efectiva**, y el **ingreso como clase real** —la octava función,
que el modelo contemplaba desde la Fase 1 sin ruta de escritura—. Y cerró la
obligación que dejó F6.A: **una clase ya no puede corregir una operación de
otra**. Las decisiones son
[ADR-020](adr/ADR-020-version-content-and-time.md) y
[ADR-021](adr/ADR-021-category-catalogue.md).

**La Fase 5 está cerrada**, con sus cuatro criterios del roadmap cumplidos y
verificados: se puede registrar, entrar, salir y recuperar el acceso; la sesión
sobrevive al reinicio y se renueva sola; las rutas protegidas son inaccesibles
sin sesión; y ninguna credencial privada de backend viaja en el bundle.

| Bloque    | Qué es                    | Estado                          |
| --------- | ------------------------- | ------------------------------- |
| **F5.A**  | Frontera y almacenamiento | **Cerrado**, validado en iPhone |
| **F5.B**  | Estado de sesión y rutas  | **Cerrado**, validado en iPhone |
| **F5.C1** | Email y contraseña        | **Cerrado**, validado en iPhone |
| **F5.C2** | Google y Apple            | **Diferido**, ver abajo         |
| **F5.D**  | Cierre de sesión y Perfil | **Cerrado**, validado en iPhone |
| **F5.E**  | Recuperación de acceso    | **Cerrado**, validado en iPhone |
| **F5.F**  | Cierre de fase            | **Cerrado**, validado en iPhone |

**Entrar con Google y con Apple queda diferido, y no bloqueó el cierre.** No
forma parte del alcance ni de los cuatro criterios de la Fase 5 en el roadmap:
se añadió como requisito de producto a mitad de fase. Sigue siendo una capacidad
de autenticación pendiente, y lo que la difiere es una dependencia real — el
login nativo de Google no funciona en Expo Go y exige un development build, y
Apple exige el programa de desarrollador. **Las dos capacidades las introduce la
Fase 8**, y se ejecutará cuando existan, sin reabrir la Fase 5.

**F5.F fue el cierre de fase**: verificar los cuatro criterios normativos,
validar la integración completa en un solo recorrido físico, añadir la evidencia
que faltaba sobre credenciales en el bundle, y dejar la documentación de estado
sin contradicciones.

---

## Arquitectura vigente

```
Expo SDK 57 (iOS + Android; web NO es objetivo)

src/app/  ->  src/features/  ->  src/domain/ + src/lib/ + src/ui/
                                  (dominio puro, sin React ni red)

cliente -> Kong -> GoTrue (JWT) -> PostgREST
                                     |
                        lectura      |      escritura
              api.<vista security_invoker>  api.record_*  (SECURITY DEFINER,
                        |                        |         owner nomey_writer)
                  core.current_effect            |
                        |                        v
                     core.*  <----- RLS, que tambien se aplica al writer
```

**Tres schemas.** `core` persiste · `api` es **la única** superficie expuesta ·
`sec` guarda los helpers internos. `public`, `core` y `sec` **no** están en
`api.schemas`; responden `406 PGRST106`.

**Tres owners, y ninguno intercambiable.** El writer contable es `nomey_writer`
—`NOLOGIN`, `NOBYPASSRLS`, no propietario de tablas— de modo que la RLS **sigue
aplicándose a la escritura**: es la segunda barrera, no un adorno.
`api.claimed_dimension()` es `postgres` porque debe **atravesar** la RLS para
recuperar lo reclamado. Y desde F6.A, `nomey_provisioner` —de la misma forma que
el writer— crea ámbitos y membresías, que es lo único que el escritor contable
**no** puede hacer. **Nunca unificar ninguno de los tres.**

---

## Superficie `api` disponible

**Escritura — ocho funciones, y ninguna más.** Una por clase de operación,
payload `jsonb` único, `GRANT EXECUTE` solo a `authenticated`:

```
record_adjustment          record_group_expense
record_personal_expense    record_debt_settlement
record_personal_income     record_settlement_by_transfer
record_external_transfer
record_internal_transfer
```

Alta y corrección **comparten función**: las distingue `operation_id` +
`expected_version_id` en el payload.

**Y una clase no corrige a otra.** La guarda vive en `sec.persist_version`, por
donde pasan las ocho para existir, y usa la clase que cada una ya le pasaba: no
hay parámetro que olvidar ni función que pueda quedarse fuera. Corre **después
del CAS**, así que no es un oráculo de la clase de una operación ajena.
`OPERATION_CLASS_MISMATCH · 422`.

**Provisioning — dos funciones más, de F6.A.** No son clases de operación: no
crean operación, ni versión, ni efecto, y **no usan `core.client_command`**.
Owner `nomey_provisioner`, idempotentes **por estado**:

```
ensure_personal_scope        crea ámbito + membresía, o devuelve el existente
set_personal_base_currency   cambia la moneda si el ámbito nunca tuvo un efecto
```

**Lectura:**

| Objeto                    | Qué da                                                   |
| ------------------------- | -------------------------------------------------------- |
| `api.personal_effect`     | Saldo y económica **sin participante** del Modo Personal |
| `api.claimed_dimension()` | Económica **con participante** y deuda, por vínculo      |
| `api.personal_scope`      | El ámbito del actor, con su moneda base y su escala      |
| `api.currency_definition` | Las 20 definiciones sembradas, para el selector          |
| `api.category`            | Categorías de sistema y **propias**. Ni ve las ajenas    |

**Categorías — tres funciones más, de F6.B.** Tampoco son clases de operación, y
comparten owner con el provisioning porque `nomey_provisioner` es **la frontera
de las escrituras que no son contabilidad**:

```
create_custom_category   rename_custom_category   set_custom_category_active
```

**Errores.** Código propio en el cuerpo y estado HTTP, medidos por la ruta real:
`PAYLOAD_INVALID` 400 · `NOT_AUTHORIZED` 403 · `IDEMPOTENCY_KEY_REUSED` 409 ·
`VERSION_CONFLICT` 409 · `BASE_CURRENCY_LOCKED` 409 · `CATEGORY_NAME_TAKEN` 409 ·
`OPERATION_CLASS_MISMATCH` 422 · `CATEGORY_NOT_USABLE` 422 ·
`CURRENCY_CONVERSION_UNSUPPORTED` 422 · `CURRENCY_NOT_SUPPORTED` 422 ·
`CURRENCY_CODE_AMBIGUOUS` 422 · y los códigos de dominio de
`src/domain/errors.ts`, también 422.

`src/types/database.ts` se **genera** sobre `api` y nunca se escribe a mano.

---

## Frontera de sesión en el cliente

**Lo que existe:** el cliente y el almacenamiento seguro (F5.A), el estado de
sesión con su restauración y las rutas protegidas (F5.B), el acceso con email y
contraseña (F5.C1), **el cierre de sesión con la Cuenta y el Perfil** (F5.D) y
**la recuperación de contraseña** (F5.E). **Lo que no: Google y Apple**, que
están diferidos hasta que existan sus prerrequisitos.

```
lib/env/              las dos EXPO_PUBLIC_, validadas al arrancar
lib/supabase/
├── bootstrap            el polyfill de URL, ANTES de createClient
├── client               db.schema 'api' · persistSession · autoRefreshToken
├── client-options       puro, para poder afirmarlo en un test
├── chunked-storage      troceado y manifiesto. PURO, inyectable
└── session-storage      la ÚNICA que nombra expo-secure-store
features/session/
├── session-state        la unión discriminada y sus predicados. PURO
├── session-lifecycle    suscripción, watchdog y AppState. PURO, inyectable
└── session-provider     el ÚNICO dueño del estado, y el único suscriptor
features/auth/
├── auth-service         signUp, signIn, signOut, forgetLocalSession y
│                        updateDisplayName, y las tres de recuperación.
│                        Lo ÚNICO que llama a supabase.auth
├── auth-errors          código de GoTrue -> clave i18n. PURO
├── credentials          normalización y «¿está vacío?». PURO
├── display-name         iniciales del avatar. PURO, sin React Native
├── submit-guard         un envío a la vez. PURO
├── sign-out-confirmation  el diálogo como dato, no como efecto. PURO
├── account-avatar       el hueco de la foto y su affordance
├── display-name-editor  el nombre y el lápiz que lo cambia
├── auth-screen          el andamio de teclado que comparten las pantallas
├── recovery-link        lee el enlace y rechaza todo lo demás. PURO
├── recovery-arrival     qué hacer cuando un enlace LLEGA. PURO, inyectable
├── recovery-state       la transacción y sus estados. PURO
├── recovery-controller  la transacción, sobre el cliente efímero
└── use-recovery-link    el ÚNICO dueño del deep link: una suscripción
lib/supabase/recovery-client   segunda instancia, en memoria y desechable
```

**Cuatro estados, no un booleano.** `restoring` · `signed-out` · `signed-in` ·
`unavailable`. Un `isAuthenticated: false` no distingue «hemos mirado y no hay
nadie» de «aún no hemos mirado», y esas dos pintan cosas distintas.

```
restoring   ->  NINGUNA rama se monta. El splash sigue puesto
signed-out  ->  (auth)
unavailable ->  (auth), con salida: error recuperable, no callejón
signed-in   ->  (tabs) · add · notifications · profile · account
                y, solo con __DEV__, diagnostics · states · session-probe
```

Lo que conviene no re-descubrir:

- **La frontera de credenciales tiene TRES capas, y ninguna sustituye a las
  otras**: `tests/infra/no-backend-secrets.test.ts` sobre el fuente versionado,
  `src/lib/env/supabase-env.ts` en ejecución, y
  [`scripts/bundle-secrets-check.sh`](../scripts/bundle-secrets-check.sh) sobre
  el artefacto exportado. **La URL pública y la clave publicable SÍ viajan en el
  bundle, y es correcto**: se diseñan para eso. Lo que no puede aparecer es una
  clave `sb_secret_`, un JWT heredado o una clave privada.

- **La identidad interna de Nomey es el `sub` del JWT.** No hay tabla de
  usuario, ni perfil, ni segunda identidad, y no se crea ninguna al añadir
  proveedores: Google y Apple producirán un usuario de Supabase y la identidad
  sigue siendo la misma.
- **La confirmación de correo es obligatoria.** Un alta **no** devuelve sesión;
  hay que confirmar y luego entrar. `scripts/http-boundary-check.sh` lo sabe:
  da de alta, confirma por SQL y pide el JWT con `grant_type=password`, y falla
  si el alta vuelve a emitir sesión.
- **Nada de `router.replace`, ni al entrar ni al salir.** El evento de auth
  mueve el árbol por sí solo, medido en dispositivo. Una navegación imperativa
  sería un segundo mecanismo compitiendo con el primero — y al salir dejaría
  historial: hoy la rama protegida **deja de existir** en vez de quedar tapada,
  así que no se puede volver atrás a Perfil.
- **Cerrar sesión es `signOut({ scope: 'local' })`, explícitamente.** El defecto
  de la librería es `'global'`, que cierra la sesión en **todos** los
  dispositivos; un toque en el móvil no debe echar a nadie de su tablet.
  `'local'` sí revoca en el servidor el refresh token **de este** dispositivo.
- **La purga normal del almacenamiento es de `auth-js`, y no se duplica.**
  `_signOut` borra la sesión a través del adaptador, que aquí es el troceado, y
  cuyo `removeItem` ya purga manifiesto y chunks. Escribir una segunda purga
  «por seguridad» sería reimplementar lo que posee ADR-017.
- **Un error de `signOut` no significa «sigues dentro».** Medido: si falla la
  llamada remota, la librería borra la sesión local **primero** y devuelve el
  error después. Sólo hay un caso que deja dentro —token caducado y refresh
  inalcanzable—, y ahí el refresh token no fue **rechazado** sino no alcanzado,
  así que Nomey no puede demostrar que la sesión esté muerta. Para eso existe
  **«Cerrar sesión solo en este dispositivo»**: explícito, elegido por la
  persona, y con su coste dicho —la sesión sigue viva en el servidor hasta
  caducar—. **Nunca automático.**
- **`ScopeProvider` se resetea al cambiar la identidad**, en render y no en un
  efecto. El evento de salida tira la rama protegida en ese mismo commit, así
  que una limpieza que viviera dentro de ella no llegaría a ejecutarse; el
  provider está por encima del navegador y los hijos pintan ya con el valor
  inicial. La identidad se la pasa `app/_layout.tsx`, único sitio que ve los dos
  providers — `features/` no puede importar `features/`.
- **`display_name` se edita desde Perfil**, y se escribe donde siempre estuvo:
  `user_metadata`, vía `updateUser`. Nadie propaga el cambio a mano — `auth-js`
  guarda la sesión y emite `USER_UPDATED`, el suscriptor único lo mapea, y
  Perfil e Inicio se repintan porque **ya derivaban el nombre de la sesión**.
  La escritura **no es optimista**: el campo sólo se cierra con la respuesta del
  servidor.
- **El teclado de las pantallas de auth no lleva `KeyboardAvoidingView`.** El
  hueco lo hace `automaticallyAdjustKeyboardInsets`, y el contenido **no se
  centra**: centrarlo hacía que la posición de cada campo dependiera de la
  altura del contenedor, y eso realimentaba un bucle de recolocación.
- **El almacenamiento trocea siempre**, y su seguridad es una sola regla: el
  manifiesto se escribe el último y se borra el primero. Una escritura
  interrumpida degrada a _sin sesión_, jamás a media sesión.
  [ADR-017](adr/ADR-017-secure-session-storage.md).
- **React Native 0.86 no cumple el contrato `URL.protocol`** que exige
  `supabase-js`: su `URL` global no tiene setter de `protocol` y el constructor
  del cliente asigna a uno. Lo resuelve `react-native-url-polyfill` en un único
  punto de arranque. Quitarlo rompe la creación del cliente, no solo realtime.
- **No se llama a `getSession()`, y esto no es un olvido.** `auth-js` emite
  `INITIAL_SESSION` a cada suscriptor nuevo por su cuenta, **también cuando la
  restauración falló** —sesión ausente, refresh token muerto o fetch abortado
  llegan como sesión nula, no como cuelgue—. Una sola fuente ordenada, así que
  la carrera «restauración lenta pisa un evento nuevo» **no puede ocurrir**.
  Añadir un `getSession()` en paralelo la reintroduce.
- **Un watchdog de 10 s** cubre el único fallo sin salida: que la respuesta no
  llegue nunca. No es un plazo — la suscripción sigue viva y una respuesta
  tardía manda. `unavailable` cae en la rama **pública**, que es la dirección
  segura.
- **El refresco es de la librería.** `startAutoRefresh`/`stopAutoRefresh` atados
  a `AppState`, un solo listener, idempotente. **Nomey no escribe ningún timer**:
  un segundo bucle es cómo dos clientes compiten por el mismo refresh token.
- **`Stack.Protected` es navegación, no seguridad.** Sin sesión PostgREST
  responde `42501` pinte lo que pinte el cliente; la RLS sigue siendo la única
  frontera de autorización. Un test comprueba que ninguna pantalla queda
  registrada fuera de una guarda.
- **El token no sale del cliente.** El provider expone `userId`, `email` y
  `displayName`, nada más; quien llame a la API usa `supabase`, que adjunta y
  refresca él.
- **`display_name` es `user_metadata`, y solo presentación.** Lo edita el propio
  titular de la cuenta **desde Perfil**, así que **nunca** entra en RLS, ni
  resuelve una membresía o un ámbito, ni sustituye al `sub`. Su forma se valida
  en un único sitio: lo que no sea una cadena no vacía es `null`, y `null`
  significa saludar sin nombre — nunca un placeholder ni una suposición desde el
  email. **Las iniciales del avatar siguen la misma regla** y tampoco salen de
  la dirección: sin nombre se pinta una silueta.

**Validado en iPhone físico**, con `app/session-probe.tsx` bajo `__DEV__` —no es
una feature y no se expone al usuario—: SecureStore disponible, el cliente se crea
bajo Hermes, un arranque sin crash que aterriza en la rama pública **sin que
Inicio ni la barra aparezcan un instante**, y el recorrido completo de
email/contraseña de extremo a extremo, incluida la restauración tras cerrar y
reabrir Expo Go.

**F5.D también está validado en iPhone físico**: Perfil con su cabecera de
identidad, edición del nombre —cancelar, guardar, iniciales que cambian y el
saludo de Inicio actualizado—, el nombre conservado tras recargar, General con
sus tres opciones visibles, Planes y suscripciones, la confirmación de cierre de
sesión, la vuelta automática a la rama pública sin poder retroceder a Perfil, la
sesión ausente tras recargar y tras reabrir Expo Go, y el ámbito de vuelta en
Personal al entrar de nuevo.

**El splash propio no es verificable en Expo Go**, que sustituye el nativo por el
suyo; espera a una build iOS propia. El gate es React puro y sí está comprobado:
aunque el splash fallara, lo que se ve es el fondo de la app, nunca una pantalla.

### La recuperación de acceso, y por qué está fuera de la sesión

La rige **[ADR-018](adr/ADR-018-ephemeral-recovery-session.md)**, y su decisión
es una frontera, no un matiz: **una sesión nacida de un enlace de correo no es
una sesión ordinaria de Nomey, no se persiste y nunca se promociona.**

- **Se canjea con un cliente Auth propio y efímero** — `persistSession: false`,
  `autoRefreshToken: false`, `detectSessionInUrl: false` — que vive en memoria
  y muere con el proceso. **El `SessionProvider` principal no la ve nunca** y
  durante todo el flujo dice `signed-out`, que es literalmente cierto.
- **El deep link tiene un dueño único**: `getInitialURL()` para el arranque y un
  listener `url` para cada entrega posterior. `Linking.useURL()` NO se usa —
  retiene la última URL, y leer un valor retenido no es reaccionar a un evento.
  `app/+native-intent.tsx` impide además que el router trate `/auth/recovery`
  como pantalla: es una intención de autenticación, no un destino.
- **Una sesión ordinaria abierta bloquea el enlace sin canjearlo**, y `restoring`
  no decide nada: esa llegada queda retenida hasta que la sesión resuelve.
  `unavailable` **falla cerrado**. Ningún cambio de sesión canjea por su cuenta.
- **`attempted` impide dos canjes simultáneos del mismo hash**; **`spent` sólo se
  escribe cuando el servidor establece `consumed` o `dead`.** Un fallo no
  resuelto —transporte, 429, 500— no gasta la prueba: **una entrega explícita
  nueva del mismo enlace vuelve a intentarlo**, y ése es el único reintento.
- **Un fallo al guardar la contraseña se queda en el formulario**, en línea y con
  lo escrito intacto, porque para entonces el enlace ya está canjeado y la
  sesión efímera sigue siendo utilizable. Sólo se abandona la recuperación al
  terminar bien o al salir explícitamente.
- **Un recovery interrumpido no se reanuda.** No hay estado que restaurar: la
  app reabre en Entrar y se pide otro enlace.

### El tamaño real de la sesión, medido

**Medición resuelta**, sobre una sesión auténtica en iPhone físico:

```
2285 B  ·  2285 unidades UTF-16  ·  5 chunks  ·  máximo 512 B por chunk
```

**Supera el umbral histórico de ~2 KB que menciona la documentación de Expo**, así
que **el troceado de ADR-017 queda validado contra una sesión real**: una sola
entrada habría estado en riesgo en iOS, y la decisión no era hipotética. Con esto
**la medición que ADR-017 dejaba pendiente está RESUELTA**.

**ADR-017 no se toca.** Un ADR aceptado es inmutable —`docs/adr/README.md`—, y el
estado y la evidencia actuales viven aquí. La decisión que registra sigue siendo
la misma: se trocea siempre, y la cifra la valida en vez de cambiarla.

---

## Invariantes que una fase futura no debe romper

1. **El cliente no escribe efectos.** Envía intención; el servidor deriva. Las
   siete funciones son la única entrada de escritura.
2. **Los importes son enteros exactos en unidad mínima y nunca cruzan JSON como
   número.** Entran como string, salen como texto.
3. **Todo importe lleva su definición monetaria**, cuya identidad es un `UUID`,
   no el código ISO. Dos importes solo se suman si la comparten.
4. **Caja, económica y deuda son tres dimensiones distintas** y no se sustituyen.
   Una liquidación no mueve saldo; un gasto de grupo no es una transferencia.
5. **Los hechos son inmutables.** Corregir crea una versión nueva; solo cuenta la
   vigente, y eso se consulta en `core.current_effect` — **nunca** se
   reimplementa el filtro de vigencia.
6. **Saldos, deudas, estadísticas y disponibles son derivados**, sin caché en v1.
7. **Toda escritura que pueda alterar deuda vigente bloquea los ámbitos
   afectados**, en orden ascendente, **antes** de leer la deuda. Una
   serialización parcial no serializa nada.
8. **Idempotencia por comando**: el UUID lo genera el cliente, la comparación es
   solo del servidor, y el replay se resuelve **antes** de autorizar y del CAS.
9. **Los efectos referencian al participante contextual, nunca al usuario.**
10. **Ninguna tabla de `core` sin RLS**, y ninguna policy aplicable a `PUBLIC`.
11. **Ownership ≠ membresía.** `scope.owner_user_id` es atribución económica
    durable; `core.membership` es autorización actual y es lo que resuelve la
    RLS. Un Modo Personal necesita **las dos** filas.
12. **`core.membership` es presencia, no historial**, y `participant_period` es
    elegibilidad para figurar en una operación, **nunca** autorización.

---

## Limitaciones técnicas vigentes

**El `Intl` de Hermes no es el de Node.** Hermes no empaqueta ICU: toma el
formateador de cada plataforma, así que **iOS no tiene
`Intl.NumberFormat.prototype.formatToParts` y descarta `signDisplay`**. Lo
primero revienta; lo segundo se ignora en silencio, que es peor. `src/lib/format`
solo usa `format()` y deriva la forma del locale con sondas, en una única vía
para todos los runtimes. **Nada que se ejecute en el dispositivo se da por
verificado porque pase en Vitest**, que corre sobre V8.

---

## Decisiones aplazadas relevantes

Ninguna bloqueó el cierre de la Fase 5. El detalle completo, con motivo y
destino de cada una,
está en [`model-coverage.md`](architecture/model-coverage.md).

| Aplazado                                        | Dónde queda                               |
| ----------------------------------------------- | ----------------------------------------- |
| **Google y Apple**, requisito de producto       | Diferido: prerrequisitos en la **Fase 8** |
| **Subida real de la foto de perfil**            | Bloque posterior, con decisión propia     |
| **Timeout de las operaciones de autenticación** | Deuda abierta, sin ADR                    |
| Persistencia de la preferencia de idioma        | Con la UI de Ajustes                      |
| **Resolución autoritativa del FX**              | Decisión de producto — **F11**            |
| **Cambio de divisa base con historia**          | **F11**. Elegirla ya se puede (F6.A)      |
| **Provisioning** de Grupos y participantes      | **F9** y **F10**                          |
| **Modo Pareja** completo, con su `Cierre`       | Su fase                                   |
| Mecanismo de claim, revocación y fusión         | **F10**                                   |
| Notificación                                    | Abierto                                   |
| Acceso residual                                 | Abierto                                   |
| Anulación, distinta de la corrección            | **F6.C**, con ADR propio                  |
| Idempotencia de recurrencias e importaciones    | Abierto                                   |
| Preflight de `btree_gist` en producción         | Antes del primer deploy                   |

> **La foto de perfil, y qué está hecho exactamente:** la **affordance** está
> terminada y aprobada en dispositivo —hueco circular con iniciales o silueta,
> insignia de cámara, e interacción que informa de que todavía no está
> disponible—. **La subida no existe, y eso es una función diferida, no un
> defecto de F5.D.** Hacerla real es un bloque posterior con su propia decisión
> sobre picker, Supabase Storage, bucket y ruta, RLS del bucket, reemplazo y
> borrado, y límites y compresión. Esa solución **no está diseñada** y no se
> improvisa aquí. Lo único ya descartado es meter la imagen en `user_metadata`:
> viajaría dentro del JWT y de la sesión guardada, que mide 2285 B en 5 chunks,
> y rompería el inicio de sesión en vez de sólo el avatar.

> **El timeout de autenticación, dicho entero porque su forma importa:** las
> operaciones de autenticación dependen hoy del timeout del transporte. Nomey
> **no** añade un timeout superficial mientras no pueda abortar de verdad la
> petición subyacente sin generar carreras ni resultados ambiguos. Un
> `Promise.race` dejaría la petición viva: en un registro, el usuario vería un
> fallo, reintentaría, y la primera llamada terminaría después — dos altas y una
> respuesta que nadie sabe interpretar.

> **Lo que sigue sin provisioning, y lo que ya no.** Nada crea todavía un Grupo
> ni un participante, así que `record_group_expense` y las dos liquidaciones no
> son alcanzables de extremo a extremo por un cliente real; los checks siembran
> ese estado como `postgres`. **El Modo Personal ya tiene ruta**: F6.A la
> construyó, y el check HTTP crea el suyo por ella. Lo que falta es que **la app
> la use**, que es F6.E.

---

## Fundación de interfaz

**La Fase 4 cerró en cuatro bloques**, todos validados en iPhone físico:
**F4.A** fundación visual y marca · **F4.B** i18n y formateo · **F4.C** app
shell y navegación · **F4.D** primitives y estados comunes. El detalle está en
[`ux/phase-4-plan.md`](ux/phase-4-plan.md).

**Lo visual.** Nomey es **dark-only**: `app.config.ts` fija
`userInterfaceStyle: 'dark'` y la paleta se resuelve en un único sitio,
`src/ui/theme/use-theme.ts`. El amarillo de marca es `#FDC506`, acento
minoritario. **Ningún color, rol tipográfico ni token de profundidad vive fuera
de `src/ui/theme/`**, y el contraste de la paleta está medido y anotado allí.
Los tokens de **glass y de profundidad táctil tienen consumidores reales** —la
barra, el botón de acción, el pulsador de ámbito, las cards y las sheets— y su
render **está validado en iPhone físico**. El suelo de opacidad del glass lo
comprueba un test.

**Idioma y formato se resuelven por separado, y son tipos distintos** —
`MessageLocale` y `FormatLocale`— para que confundirlos no compile.

- **Catálogo:** `es-ES` y `en`. Cualquier `es-*` va al español, cualquier `en-*`
  al inglés, y un idioma no soportado cae a `es-ES`.
- **Preferencia**, con tres estados —**Automático** (por defecto), Español,
  English—. Existe la API; **no está persistida ni expuesta en UI**, y ambas
  cosas llegan con Ajustes.
- **Formato regional:** sigue **siempre la Region real del dispositivo**, aunque
  el idioma se fuerce. Se **compone** desde `languageCode`, el script cuando
  exista y `regionCode` — nunca desde `languageTag`, que lleva la región del
  idioma y no la del ajuste Region.
- **La Region no toca el dinero.** Un `Money` en EUR sigue siendo EUR en México:
  la definición monetaria manda sobre código, escala y valor; la región solo
  sobre separadores, agrupación, posición del símbolo y convenciones de fecha.
- **La exactitud se conserva.** Los dígitos salen del `bigint`; `Intl` solo
  recibe sondas de magnitud fija.

**El shell vigente.** Dos destinos raíz y nada más: **Inicio** y **Grupos**.

- **`+` es una acción contextual, no navegación**: flota sobre los destinos,
  fuera de la barra, y añade al sitio donde estás — en Inicio al ámbito activo,
  en Grupos a un grupo, sin preseleccionar ninguno.
- **Personal y Pareja son contextos dentro de Inicio**, con un pulsador único y
  el estado por encima de las tabs, así que sobrevive a cambiar de destino.
  Visualmente son equivalentes; lo que falta de Pareja es funcionalidad, y se
  dice donde faltaría.
- **Perfil y Notificaciones cuelgan de la cabecera**, no de la barra, y ambos
  destinos raíz comparten ese grupo de acciones.
- **Crear un grupo no es el `+`**: vive en el contenido de Grupos.

**Glass y profundidad táctil ya tienen consumidores reales** —barra, botón de
acción, pulsador de ámbito, cards y sheets— y se validaron en iPhone físico.
El suelo de opacidad del glass lo comprueba un test.

**Las primitives son pocas y todas tienen consumidor**: `Icon`, `IconButton`,
`ActionButton`, `Section`, `GlassSurface`, `ThemedText` y `ThemedView`, más los
tres estados comunes —**carga, vacío y error**— reutilizables y ya consumidos
por Inicio, Grupos y Notificaciones. Un test falla si alguna deja de tener quien
la use.

**Dos pantallas viven fuera del producto**, alcanzables solo desde Perfil bajo
`__DEV__`: el diagnóstico de `Intl` de F4.B y la vista de estados comunes.
Ninguna es una feature.

**Antes de tocar UI, leer
[`design-direction.md`](product/design-direction.md)**: es la fuente de verdad de
la estética y su regla de accesibilidad es vinculante. F4 la convierte en
tokens; **no la redefine**.

**Pendiente de validar en dispositivo**, sin bloquear a nadie: el icono y el
splash **nativos**, que Expo Go sustituye por los suyos y esperan a la primera
build iOS propia; y la tabla diagnóstica de `Intl`, cuya **validación funcional
sí se hizo** en iPhone —arranque, EUR, JPY, fecha e importe de 21 dígitos— pero
**no fila a fila**.

Fuera de alcance de F4: biblioteca de componentes completa, design system
consolidado y el flujo detallado de entrada rápida, que se diseña en F7 contra
una feature escribible real.

---

## Qué consultar, y cuándo

| Necesitas…                                   | Lee                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Reglas del repositorio y del agente          | [`AGENTS.md`](../AGENTS.md)                                                        |
| Semántica contable y escenarios              | [`architecture/data-model.md`](architecture/data-model.md)                         |
| Dónde vive cada concepto del modelo          | [`architecture/model-coverage.md`](architecture/model-coverage.md)                 |
| Una decisión y su porqué                     | [`adr/README.md`](adr/README.md) — ADR-001 … ADR-016                               |
| Secuencia de fases y criterios de cierre     | [`product/roadmap.md`](product/roadmap.md)                                         |
| Vocabulario                                  | [`product/glossary.md`](product/glossary.md)                                       |
| Estética, antes de cualquier UI              | [`product/design-direction.md`](product/design-direction.md)                       |
| **Continuar la Fase 5**                      | [`architecture/phase-5-handoff.md`](architecture/phase-5-handoff.md)               |
| Cómo quedó la Fase 4, ya cerrada             | [`ux/phase-4-plan.md`](ux/phase-4-plan.md)                                         |
| Cómo se usan i18n y el formateo              | [`src/lib/README.md`](../src/lib/README.md)                                        |
| Levantar el entorno, migrar, ejecutar checks | [`runbooks/local-setup.md`](runbooks/local-setup.md)                               |
| **Por qué** la Fase 3 quedó como quedó       | [`architecture/phase-3c-handoff.md`](architecture/phase-3c-handoff.md) — histórico |

**Evidencia empírica:** `supabase/e11/` … `supabase/e20/`. Son sondas
desechables sobre maquetas y **nunca deben convertirse en migración**.

---

## Comandos

```bash
npm ci
npm test
npm run verify
```

La Supabase CLI se ejecuta **desde Ubuntu (WSL2)** con
`./scripts/supabase-cli.sh`, nunca desde Windows, y **nunca** se instalan
dependencias npm desde WSL sobre este checkout. El motivo está en el runbook.
