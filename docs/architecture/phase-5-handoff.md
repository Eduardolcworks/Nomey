# Punto de entrada — Fase 5 · Identidad y sesión

> **El único punto de entrada vivo de la Fase 5.** Operativo, no histórico: qué
> hay, qué no se toca y qué hay que producir. El **porqué** de cada decisión
> vive donde se tomó — los ADR, el commit, los comentarios del código.

---

## 1 · Dónde está la fase

**La Fase 5 está EN CURSO.** F5.A, F5.B y F5.C1 están cerrados y validados en
iPhone físico. **Ya se puede entrar en Nomey**, pero la fase no cierra.

| Bloque    | Qué es                           | Estado                            |
| --------- | -------------------------------- | --------------------------------- |
| **F5.A**  | Frontera con el backend y sesión | **Cerrado**, 5/5 en iPhone        |
| **F5.B**  | Estado de sesión y guardas       | **Cerrado**, en iPhone            |
| **F5.C1** | Email y contraseña               | **Cerrado**, de extremo a extremo |
| **F5.C2** | Google y Apple                   | **Pendiente** · bloqueo externo   |
| **F5.D**  | Cierre de sesión y Perfil        | Sin empezar                       |
| **F5.E**  | Recuperación de acceso           | Sin empezar                       |
| **F5.F**  | Cierre de fase                   | Sin empezar                       |

**Por qué C está partido en dos.** El requisito de producto creció a mitad del
bloque: Nomey debe permitir entrar con **email y contraseña, Google y Apple**.
Lo primero está hecho y validado; lo segundo no, y no por falta de diseño —
está investigado y decidido en §7— sino porque **no hay Apple Developer Program
disponible**, y una implementación provisional que luego haya que sustituir es
peor que no tenerla.

### Qué puede continuar, y qué no

- **F5.C2 está parcialmente bloqueado por capacidad externa.** Se desbloquea con
  el Apple Developer Program; el resto está resuelto sobre el papel.
- **F5.D y F5.E se pueden evaluar de forma independiente**, porque consumen la
  **misma sesión de Supabase que ya está construida** y no dependen de qué
  proveedor la haya creado. Cerrar sesión es cerrar sesión venga de donde venga.
- **La Fase 5 NO puede cerrarse mientras C2 siga pendiente.** F5.F es lo último.

Qué se hace a continuación es una decisión de producto, y este documento no la
toma.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento.

**La Fase 5 sí toca el backend**, a diferencia de la 4: se apoya en el Auth
técnico y la RLS que dejó 3.C. Los sitios donde mirar cuando haga falta son
[`ADR-007`](../adr/ADR-007-membership-rls.md) para la autorización por fila,
[`ADR-017`](../adr/ADR-017-secure-session-storage.md) para el almacenamiento de
sesión, y el runbook de entorno local — no antes, y no todo.

### Lo que ya está hecho, para consumirlo sin releerlo

```ts
import { supabase } from '@/lib/supabase'; // cliente sobre el schema `api`
import { useSession } from '@/features/session'; // restoring | signed-out | signed-in | unavailable
```

**Ningún bloque siguiente tiene que tocar ninguna de las dos.** Está medido en
dispositivo: `signInWithPassword` provoca el evento y la app cambia de rama sola,
sin `router.replace` en ningún sitio. Lo mismo al revés cuando F5.D añada el
cierre de sesión, y lo mismo para Google y Apple, que también acaban en una
sesión de Supabase.

Tres reglas que **no se deben deshacer** al construir encima:

- **No añadir un `getSession()`.** La restauración sale de `INITIAL_SESSION`, que
  `auth-js` emite solo, también cuando falla. Una segunda fuente reintroduce la
  carrera «restauración lenta pisa un evento nuevo», que hoy no puede ocurrir.
- **No suscribirse otra vez a `onAuthStateChange`.** Hay un único suscriptor, y
  dos son dos respuestas a «quién ha entrado» que pueden discrepar.
- **No copiar el token.** El provider expone `userId`, `email` y `displayName`;
  quien llame a la API usa `supabase`, que lo adjunta y lo refresca él.
- **No tratar `displayName` como identidad.** Es `user_metadata`, editable por el
  propio titular: sirve para saludar y para nada más.

El detalle está en [`PROJECT_STATE.md`](../PROJECT_STATE.md) §«Frontera de sesión
en el cliente» y en [ADR-017](../adr/ADR-017-secure-session-storage.md).

### Decisiones de producto ya cerradas, que no se reabren

- **Email y contraseña.** Sin magic link, sin social, sin anónimo.
- **Confirmación de email OBLIGATORIA**, misma postura en local y en
  producción. Se implementa en F5.C — ver §7.
- **El nombre del usuario es metadata de presentación de Auth**
  (`display_name`). **No** se crea `core.app_user`, ni tabla `profiles`, ni una
  segunda identidad, ni columna de nombre en el dominio económico. La metadata
  sirve para la UI y **nunca** participa en RLS ni en autorización. Avatar,
  fuera de F5.
- **Provisioning del ámbito Personal: FUERA de la Fase 5.** Ver §7.

---

## 2 · El shell vigente

```
raíz:      Inicio | Grupos          y nada más
Inicio:    Personal | Pareja        contexto, no destino
global:    +  flotante y contextual, fuera de la barra
           campana y perfil, en la cabecera de ambos destinos
```

| Ruta                     | Qué es                                                 |
| ------------------------ | ------------------------------------------------------ |
| `app/(auth)/sign-in.tsx` | **Pública.** Superficie provisional; la sustituye F5.C |
| `app/_layout.tsx`        | Sesión, guardas, `ScopeProvider` y el Stack raíz       |
| `app/(tabs)/_layout.tsx` | Los dos destinos, con la barra propia                  |
| `app/(tabs)/index.tsx`   | Inicio                                                 |
| `app/(tabs)/groups.tsx`  | Grupos                                                 |
| `app/add.tsx`            | La superficie del `+`, en modal                        |
| `app/notifications.tsx`  | Placeholder                                            |
| `app/profile.tsx`        | Cuenta, idioma y apariencia, aún inertes               |
| `app/diagnostics.tsx`    | `Intl` en el dispositivo. **Solo `__DEV__`**           |
| `app/states.tsx`         | Los tres estados comunes. **Solo `__DEV__`**           |
| `app/session-probe.tsx`  | La sonda de F5.A. **Solo `__DEV__`**                   |

**Perfil es donde aterrizará la cuenta.** Sus filas ya existen y no hacen nada,
que es exactamente el hueco que la Fase 5 viene a llenar.

---

## 3 · Qué existe para consumir

| Dónde                       | Qué hay                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `ui/theme/`                 | Paleta dark-only, 13 roles tipográficos, `Glass` y `Tactile`               |
| `ui/components/`            | `Icon`, `IconButton`, `ActionButton`, `Section`, `GlassSurface`, `Themed*` |
| `ui/components/`            | `LoadingState`, `EmptyState`, `ErrorState`                                 |
| `features/shell/`           | Cabecera, barra, pulsador de ámbito, geometría del dock                    |
| `lib/i18n/`, `lib/format/`  | Catálogos, `t()`, y formateo exacto y localizado                           |
| `lib/supabase/`, `lib/env/` | **F5.A**: cliente sobre `api`, entorno validado, sesión en el llavero      |
| `features/session/`         | **F5.B**: `useSession()`, los cuatro estados, y las guardas ya puestas     |

```ts
const { t } = useTranslation();   // texto  -> catálogo activo
const format = useFormat();       // cifras -> región del dispositivo
const theme = useTheme();         // color  -> token, nunca un hex
<ThemedText variant="amountRow">  // tamaño -> rol, nunca un número
<LoadingState /> <ErrorState />   // esperar y fallar ya tienen forma
```

**Una sesión que carga y un login que falla ya tienen componente.** No hace
falta inventar la forma de esos dos momentos.

---

## 4 · Qué NO se reabre

Aprobado en iPhone físico y fuera de discusión salvo defecto material:

- **La navegación raíz**: dos destinos, y Ajustes no es uno de ellos.
- **El `+` como acción contextual** fuera de las tabs, y su cristal ámbar.
- **La cabecera, el saludo y el pulsador Personal/Pareja.**
- **Los dos pulsadores inferiores** y sus estados.
- **Glass y profundidad táctil**: el suelo de opacidad es una medición y lo
  comprueba un test.
- **Las primitives y los tres estados comunes.**
- Todo lo cerrado en la Fase 3: modelo, `api`, RLS, writer.
- **Lo cerrado en F5.B**, validado en iPhone: los cuatro estados de sesión, la
  restauración por `INITIAL_SESSION` sin `getSession()`, el watchdog, el
  refresco atado a `AppState`, las guardas con `Stack.Protected` y el gate que
  impide montar cualquier rama mientras se restaura.
- **Lo cerrado en F5.A**, validado en iPhone: SecureStore con
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` y exclusión de backup en Android, el
  almacenamiento troceado con su manifiesto, la configuración del cliente y el
  polyfill de `URL` en un único punto de arranque —
  [ADR-017](../adr/ADR-017-secure-session-storage.md).

---

## 5 · Reglas que siguen vigentes

- **Toda UI nueva pasa por i18n y por `lib/format`.** Un test falla si una
  pantalla incrusta una cadena, un símbolo monetario o una fecha a mano.
- **Ninguna primitive sin consumidor.** Otro test lo comprueba.
- **`src/ui/` no puede importar de `lib/`.** Lo que necesite `t()` vive en
  `features/`.
- **Nada suelto en `src/app/`**: expo-router lo convierte en ruta.
- **El `Intl` de Hermes no es el de Node.** En iOS no existe `formatToParts` y
  `signDisplay` se ignora. Nada que corra en el dispositivo se da por verificado
  porque pase en Vitest.
- **El color nunca es la única señal**, y ningún efecto se cobra contraste.
- **Ninguna credencial de backend en el bundle.** `EXPO_PUBLIC_*` se inlinea y
  es legible por cualquiera que descargue el binario — `AGENTS.md` §7.

---

## 6 · Alcance de la Fase 5

Del roadmap: **registro, inicio de sesión, recuperación, perfil, ciclo de vida
de la sesión sobre almacenamiento seguro y rutas protegidas** — y, añadido
durante la fase como requisito de producto, **entrar con Google y con Apple**.

Cierra cuando un usuario puede registrarse, entrar, salir y recuperar el acceso;
la sesión sobrevive al reinicio y se renueva sola; las rutas protegidas son
inaccesibles sin sesión; y **ninguna credencial de backend está en el bundle**.

**Fuera:** funcionalidad económica —eso es F6 en adelante— · provisioning de
ámbitos y participantes · Modo Pareja · Grupos funcionales · Quick Entry.

**Almacenamiento seguro ya está decidido y construido** —
[ADR-017](../adr/ADR-017-secure-session-storage.md), F5.A—. Cualquier decisión
nueva de la misma clase sigue pasando por ADR antes de escribirse.

**Tres de los cuatro criterios de cierre ya están cumplidos y validados en
dispositivo:** un usuario puede registrarse y entrar —salir y recuperar el
acceso son F5.D y F5.E—, la sesión sobrevive al reinicio y se renueva sola, las
rutas protegidas son inaccesibles sin sesión, y ninguna credencial de backend
está en el bundle.

Lo que impide cerrar la fase no es un criterio del roadmap, sino **el requisito
de producto que creció**: sin Google y Apple, el acceso está incompleto.

---

## 7 · Deuda abierta

### F5.C2 — Google y Apple, lo único que falta del acceso

**Está investigado y decidido; lo que falta es una capacidad externa.** No hay
Apple Developer Program disponible, y una implementación provisional que luego
haya que sustituir es peor que no tenerla. Nada de esto está instalado ni
configurado.

**La dirección, ya elegida:**

- **Apple: autenticación nativa.** `expo-apple-authentication` →
  `identityToken` → `supabase.auth.signInWithIdToken({ provider: 'apple' })`.
  Funciona en Expo Go añadiendo `host.exp.Exponent` a los Client IDs de
  Supabase. Para nativo **no** hacen falta Services ID, signing key ni Team ID.
- **Google: preferencia por autenticación nativa**, que es lo que Supabase
  recomienda hoy para React Native — `@react-native-google-signin/google-signin`
  → `signInWithIdToken`. **No funciona en Expo Go**: exige development build.
- **Los dos acaban en una sesión de Supabase**, así que el cambio de rama lo
  sigue haciendo el provider de F5.B. Sin `router.replace`.
- **Nada de OAuth provisional por navegador.** Obligaría a fijar `flowType:
'pkce'`, y eso cambia también los enlaces de correo de confirmación y
  recuperación — es decir, tocaría F5.C1 ya cerrado y condicionaría F5.E.
- **`flowType` y `detectSessionInUrl` se quedan como están.**
  `signInWithIdToken` no usa ninguno de los dos.

**Nonce de Apple.** Dirección pendiente: **Apple deberá usar nonce si la
implementación final y las APIs reales permiten hacerlo correctamente** — el
crudo a Supabase y su SHA-256 a Apple, lo que añadiría `expo-crypto`. El detalle
técnico no se cierra aquí.

**Identidad, sin cambios.** El proveedor produce un usuario de Supabase y la
identidad interna sigue siendo `auth.users.id` / el `sub` del JWT. **Sin manual
identity linking** — `enable_manual_linking` sigue en `false`. El enlace
automático por email verificado sí opera, así que email/contraseña y Google con
el mismo correo confirmado acaban en la misma cuenta.

**Limitación registrada, sin resolver:** «Hide My Email» de Apple entrega un
relay distinto del email real, así que **puede producir una cuenta separada**.

**Seguridad.** Ningún secreto de proveedor entra en el bundle: los Client ID de
iOS y Android son identificadores públicos; el client secret de Google y la
private key de Apple no hacen falta para el flujo nativo y no deben aparecer
nunca en `EXPO_PUBLIC_*`.

### Lo que F5.C1 cerró, y no se vuelve a abrir

Registro con nombre, email y contraseña · `display_name` en `user_metadata` ·
**confirmación de email obligatoria** (`enable_confirmations = true`) con
`scripts/http-boundary-check.sh` adaptado —alta, confirmación por SQL y
`grant_type=password`, con una aserción nueva que falla si el alta vuelve a
emitir sesión— · login real y transición automática a la rama protegida ·
persistencia y restauración · la UI de auth · la corrección del teclado · el
saludo con el nombre real.

**La medición del payload real está RESUELTA**: 2285 B · 5 chunks · máximo 512 B,
sobre una sesión auténtica en iPhone. Supera el umbral de ~2 KB de Expo, así que
valida el troceado de ADR-017 contra un caso real. La cifra vive en
[`PROJECT_STATE.md`](../PROJECT_STATE.md); **ADR-017 no se modifica**, porque un
ADR aceptado es inmutable.

Captura de correo local: `[local_smtp]`, interfaz en el puerto **54324**.

**Sigue fuera:** el cierre de sesión es **F5.D** y la recuperación de acceso es
**F5.E**.

### Registrada, no para resolver salvo que la fase la toque de frente

| Deuda                                    | Dónde se resuelve                  |
| ---------------------------------------- | ---------------------------------- |
| **Provisioning del ámbito Personal**     | **Fuera de la Fase 5.** Ver abajo  |
| **Timeout de autenticación**             | Deuda abierta. Ver abajo           |
| Persistencia de la preferencia de idioma | **Diferida**, con la UI de Ajustes |
| UI funcional del selector de idioma      | Igual que la anterior              |
| Plurales en i18n                         | Cuando aparezca el primer uso real |
| Icono y splash nativos, sin ver          | Primera build iOS propia           |
| Tabla de `Intl` sin revisar fila a fila  | Cuando aporte algo                 |
| Modo Pareja funcional                    | Su fase                            |
| Grupos funcionales y Quick Entry         | F7 y siguientes                    |

**El timeout de autenticación, y por qué no se ha puesto:** las operaciones de
autenticación dependen hoy del timeout del transporte. Nomey **no** añade un
timeout superficial mientras no pueda abortar de verdad la petición subyacente
sin generar carreras ni resultados ambiguos. Un `Promise.race` dejaría la
petición viva: en un registro, el usuario vería un fallo, reintentaría, y la
primera llamada terminaría después — dos altas y una respuesta que nadie sabe
interpretar. Sin ADR: es una deuda, no una decisión de arquitectura.

**Por qué el idioma sigue diferido aunque F5.D toque Perfil:** la preferencia
**no es un secreto**, así que meterla en SecureStore sería usar el llavero para
lo que no es, y guardarla bien obligaría a una segunda tecnología de
almacenamiento que la Fase 5 no necesita para nada más. Llega con Ajustes, con
su propia decisión de almacenamiento.

**Provisioning, y por qué importa saberlo ahora:** la Fase 5 termina con
cuentas que **no tienen ámbito Personal**. Sin `scope` con `owner_user_id`
**y** su fila de `membership` —las dos, invariante 11— el dueño no ve ni sus
propios efectos, y **F6 no puede abrir sin resolverlo**. Dirección fijada, sin
implementar: una función `api.*` autenticada e idempotente que derive el actor
del JWT. **Ni trigger sobre `auth.users`, ni Edge Function** salvo razón
material que aparezca en F6.

**Ajena a todo lo anterior:** `src/domain/effects/debt.ts` guarda un byte NUL
literal como separador de clave compuesta. La lógica es correcta, pero al ir
crudo hace que `grep` y ripgrep salten el archivo entero en silencio. Se arregla
escribiendo ese byte como un escape, en su propia rama.
