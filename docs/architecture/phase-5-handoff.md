# Punto de entrada — Fase 5 · Identidad y sesión

> **El único punto de entrada vivo de la Fase 5.** Operativo, no histórico: qué
> hay, qué no se toca y qué hay que producir. El **porqué** de cada decisión
> vive donde se tomó — los ADR, el commit, los comentarios del código.

---

## 1 · Dónde está la fase

**La Fase 5 está EN CURSO. F5.A está cerrado y validado en iPhone físico. El
siguiente bloque es F5.B.**

| Bloque   | Qué es                                  | Estado                     |
| -------- | --------------------------------------- | -------------------------- |
| **F5.A** | Frontera con el backend y sesión segura | **Cerrado**, 5/5 en iPhone |
| **F5.B** | Estado de sesión y guardas de ruta      | **Siguiente**              |
| **F5.C** | Registro e inicio de sesión             | Pendiente                  |
| **F5.D** | Cierre de sesión y Perfil               | Pendiente                  |
| **F5.E** | Recuperación de acceso                  | Pendiente                  |
| **F5.F** | Cierre de fase                          | Pendiente                  |

**Nadie puede entrar todavía.** F5.A dejó la frontera técnica y **ninguna
pantalla de autenticación**.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento.

**La Fase 5 sí toca el backend**, a diferencia de la 4: se apoya en el Auth
técnico y la RLS que dejó 3.C. Los sitios donde mirar cuando haga falta son
[`ADR-007`](../adr/ADR-007-membership-rls.md) para la autorización por fila,
[`ADR-017`](../adr/ADR-017-secure-session-storage.md) para el almacenamiento de
sesión, y el runbook de entorno local — no antes, y no todo.

### Lo que dejó F5.A, para consumirlo sin releerlo

```ts
import { supabase } from '@/lib/supabase'; // cliente sobre el schema `api`
await supabase.auth.getSession(); // devuelve null limpio sin sesión
```

La sesión se persiste sola en el llavero. El detalle está en
[`PROJECT_STATE.md`](../PROJECT_STATE.md) §«Frontera de sesión en el cliente» y
en ADR-017; lo único que F5.B necesita saber es que **el cliente no gestiona el
ciclo de vida**: no restaura al arrancar ni refresca al volver a primer plano.
Eso es precisamente lo que hay que construir.

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

| Ruta                     | Qué es                                       |
| ------------------------ | -------------------------------------------- |
| `app/_layout.tsx`        | Stack raíz y `ScopeProvider`                 |
| `app/(tabs)/_layout.tsx` | Los dos destinos, con la barra propia        |
| `app/(tabs)/index.tsx`   | Inicio                                       |
| `app/(tabs)/groups.tsx`  | Grupos                                       |
| `app/add.tsx`            | La superficie del `+`, en modal              |
| `app/notifications.tsx`  | Placeholder                                  |
| `app/profile.tsx`        | Cuenta, idioma y apariencia, aún inertes     |
| `app/diagnostics.tsx`    | `Intl` en el dispositivo. **Solo `__DEV__`** |
| `app/states.tsx`         | Los tres estados comunes. **Solo `__DEV__`** |
| `app/session-probe.tsx`  | La sonda de F5.A. **Solo `__DEV__`**         |

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

### Lo que F5.C tiene que resolver, sin excepción

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

**2 · La primera sesión real.** Es lo que desbloquea el criterio de cierre 2 de
la fase: que la sesión sobreviva al reinicio y se renueve sola.

**3 · La medición del payload real de sesión.**
[ADR-017](../adr/ADR-017-secure-session-storage.md) la exige documentada
**antes de cerrar la Fase 5**. No bloqueaba a F5.A porque no existía ninguna
sesión auténtica que medir, y **no puede cambiar el diseño**: el almacén trocea
siempre, por decisión, y si la cifra resultara caber en un solo chunk la
decisión sigue siendo la misma.

**4 · `flowType`.** F5.A lo dejó sin fijar a propósito: solo afecta a los
enlaces de correo, y su forma la decide quien construya la confirmación y la
recuperación.

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
