# Punto de entrada — Fase 5 · Identidad y sesión

> **El único punto de entrada vivo de la Fase 5.** Operativo, no histórico: qué
> hay, qué no se toca y qué hay que producir. El **porqué** de cada decisión
> vive donde se tomó — los ADR, el commit, los comentarios del código.

---

## 1 · Dónde está la fase

**La Fase 5 está EN CURSO. F5.A y F5.B están cerrados y validados en iPhone
físico. El siguiente bloque es F5.C.**

| Bloque   | Qué es                                  | Estado                     |
| -------- | --------------------------------------- | -------------------------- |
| **F5.A** | Frontera con el backend y sesión segura | **Cerrado**, 5/5 en iPhone |
| **F5.B** | Estado de sesión y guardas de ruta      | **Cerrado**, en iPhone     |
| **F5.C** | Registro e inicio de sesión             | **Siguiente**              |
| **F5.D** | Cierre de sesión y Perfil               | Pendiente                  |
| **F5.E** | Recuperación de acceso                  | Pendiente                  |
| **F5.F** | Cierre de fase                          | Pendiente                  |

**Nadie puede entrar todavía.** La app ya sabe si hay sesión y protege el árbol
en consecuencia, pero **no hay registro ni login**: el arranque termina en la
rama pública, que es una superficie provisional a la espera de F5.C.

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

**F5.C no tiene que tocar ninguna de las dos.** Un login que llame a
`signInWithPassword` ya provoca el evento que mueve la app a la rama protegida:
el provider está suscrito, y ni el estado ni el enrutado necesitan un empujón
manual. Lo mismo al revés cuando F5.D añada el cierre de sesión.

Tres reglas que **no se deben deshacer** al construir encima:

- **No añadir un `getSession()`.** La restauración sale de `INITIAL_SESSION`, que
  `auth-js` emite solo, también cuando falla. Una segunda fuente reintroduce la
  carrera «restauración lenta pisa un evento nuevo», que hoy no puede ocurrir.
- **No suscribirse otra vez a `onAuthStateChange`.** Hay un único suscriptor, y
  dos son dos respuestas a «quién ha entrado» que pueden discrepar.
- **No copiar el token.** El provider expone `userId` y `email`; quien llame a la
  API usa `supabase`, que lo adjunta y lo refresca él.

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
de la sesión sobre almacenamiento seguro y rutas protegidas.**

Cierra cuando un usuario puede registrarse, entrar, salir y recuperar el acceso;
la sesión sobrevive al reinicio y se renueva sola; las rutas protegidas son
inaccesibles sin sesión; y **ninguna credencial de backend está en el bundle**.

**Fuera:** funcionalidad económica —eso es F6 en adelante— · provisioning de
ámbitos y participantes · Modo Pareja · Grupos funcionales · Quick Entry.

**Almacenamiento seguro ya está decidido y construido** —
[ADR-017](../adr/ADR-017-secure-session-storage.md), F5.A—. Cualquier decisión
nueva de la misma clase sigue pasando por ADR antes de escribirse.

**De los cuatro criterios de cierre, F5.A cumple entero el cuarto** —ninguna
credencial de backend en el bundle, con un test que lo comprueba sobre el
fuente y una validación en tiempo de arranque— y **deja preparado el segundo**:
la sesión se persiste, pero que sobreviva a un reinicio no se puede comprobar
hasta que exista una sesión real, en F5.C.

---

## 7 · Deuda abierta

### Lo que F5.C tiene que construir

**El acceso en sí**, que es lo único que falta para que alguien pueda usar la
app: registro y login con **email y contraseña** —sin magic link, sin social,
sin anónimo—, con el **nombre** guardado como `display_name` en la metadata de
presentación de Auth, y **nada de tabla de usuario ni de perfil**.

Sustituye el cuerpo de `app/(auth)/sign-in.tsx`, que existe justo para eso. No
hace falta mover el estado ni el enrutado: un `signInWithPassword` correcto ya
dispara el evento que cambia de rama.

### Y lo que F5.C tiene que cerrar, sin excepción

**Cuatro cosas, y ninguna es opcional.**

**1 · Confirmación de email obligatoria, y el check HTTP que rompe al activarla.**
Hoy `supabase/config.toml` tiene `enable_confirmations = false`. Ponerlo en
`true` **rompe CI**, y conviene saber exactamente por qué antes de tocarlo:
`scripts/http-boundary-check.sh` da de alta usuarios con `POST /auth/v1/signup`
y **exige que la respuesta traiga `access_token`** (línea 197); con confirmación
activa GoTrue no devuelve sesión, y el check falla con «GoTrue no emitió
sesión». Lo ejecuta `.github/workflows/ci.yml`. **El flag y la adaptación del
check van en el mismo PR**: confirmar el usuario por SQL tras el alta —el script
ya tiene acceso a la base como `postgres`— y pedir el JWT con
`grant_type=password`. No se adelantó a F5.A porque sin registro no hay forma
de ejercitar la confirmación, y romper una verificación de la Fase 3 sin
obtener nada a cambio no es un intercambio.

Hay captura de correo local: `[local_smtp]`, interfaz en el puerto **54324**.
No hace falta SMTP externo. Ojo con `[auth.rate_limit] email_sent = 2` por
hora, cuyo comentario dice que requiere `auth.email.smtp` — habrá que
comprobar si aplica en local.

**2 · La primera sesión real, y todo lo que solo ella puede probar.** Cuatro
cosas quedaron cubiertas por tests estructurales en F5.B y **esperan evidencia de
extremo a extremo**: la transición real `signed-out` → `signed-in`, que el árbol
cambia de rama, que **la sesión sobrevive al reinicio de la app** —criterio 2 del
cierre de la fase— y que la rama protegida se comporta con una sesión auténtica.
No se construyó ningún bypass ni sesión falsa para adelantarlo, y no debe
construirse.

**3 · La medición del payload real de sesión.**
[ADR-017](../adr/ADR-017-secure-session-storage.md) la exige documentada
**antes de cerrar la Fase 5**. No bloqueaba a F5.A porque no existía ninguna
sesión auténtica que medir, y **no puede cambiar el diseño**: el almacén trocea
siempre, por decisión, y si la cifra resultara caber en un solo chunk la
decisión sigue siendo la misma.

**4 · `flowType`, si la implementación real lo pide.** Se dejó sin fijar a
propósito: solo afecta a los enlaces de correo, y su forma la decide quien
construya la confirmación y la recuperación.

**Sigue fuera de F5.C:** el cierre de sesión es **F5.D** y la recuperación de
acceso es **F5.E**.

### Registrada, no para resolver salvo que la fase la toque de frente

| Deuda                                    | Dónde se resuelve                  |
| ---------------------------------------- | ---------------------------------- |
| **Provisioning del ámbito Personal**     | **Fuera de la Fase 5.** Ver abajo  |
| Persistencia de la preferencia de idioma | **Diferida**, con la UI de Ajustes |
| UI funcional del selector de idioma      | Igual que la anterior              |
| Plurales en i18n                         | Cuando aparezca el primer uso real |
| Icono y splash nativos, sin ver          | Primera build iOS propia           |
| Tabla de `Intl` sin revisar fila a fila  | Cuando aporte algo                 |
| Modo Pareja funcional                    | Su fase                            |
| Grupos funcionales y Quick Entry         | F7 y siguientes                    |

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
