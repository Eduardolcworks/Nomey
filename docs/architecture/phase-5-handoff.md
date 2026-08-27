# Punto de entrada — Fase 5 · Identidad y sesión

> **Para empezar la Fase 5 en una sesión nueva.** Operativo, no histórico: qué
> hay, qué no se toca y qué hay que producir. El **porqué** de cada decisión
> vive donde se tomó — los ADR, el plan de fase, los comentarios del código.
>
> Escrito al cerrar la Fase 4.

---

## 1 · De dónde se parte

**Base: `main`, después del merge de la Fase 4.** Las fases 0 a 4 están
cerradas. No hay trabajo en vuelo.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento.

A diferencia de la Fase 4, **la Fase 5 sí toca el backend**: se apoya en el Auth
técnico y la RLS que dejó 3.C. Cuando llegue el momento de hablar con él, los
sitios donde mirar son [`ADR-007`](../adr/ADR-007-membership-rls.md) para la
autorización por fila y el runbook de entorno local — no antes, y no todo.

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

**Perfil es donde aterrizará la cuenta.** Sus filas ya existen y no hacen nada,
que es exactamente el hueco que la Fase 5 viene a llenar.

---

## 3 · Qué existe para consumir

| Dónde                      | Qué hay                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `ui/theme/`                | Paleta dark-only, 13 roles tipográficos, `Glass` y `Tactile`               |
| `ui/components/`           | `Icon`, `IconButton`, `ActionButton`, `Section`, `GlassSurface`, `Themed*` |
| `ui/components/`           | `LoadingState`, `EmptyState`, `ErrorState`                                 |
| `features/shell/`          | Cabecera, barra, pulsador de ámbito, geometría del dock                    |
| `lib/i18n/`, `lib/format/` | Catálogos, `t()`, y formateo exacto y localizado                           |

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

**Almacenamiento seguro es una decisión de arquitectura**, no un detalle de
implementación: si exige una dependencia nueva o fija cómo persiste la sesión,
pasa por ADR antes de escribirse.

---

## 7 · Deuda abierta

Registrada, **no** para resolver salvo que la Fase 5 la toque de frente:

| Deuda                                    | Dónde se resuelve                                               |
| ---------------------------------------- | --------------------------------------------------------------- |
| Persistencia de la preferencia de idioma | Con la UI de Ajustes — **puede caer en F5**, que ya toca Perfil |
| UI funcional del selector de idioma      | Igual que la anterior                                           |
| Plurales en i18n                         | Cuando aparezca el primer uso real                              |
| Icono y splash nativos, sin ver          | Primera build iOS propia                                        |
| Tabla de `Intl` sin revisar fila a fila  | Cuando aporte algo                                              |
| Modo Pareja funcional                    | Su fase                                                         |
| Grupos funcionales y Quick Entry         | F7 y siguientes                                                 |
| Backend y auth funcionales               | **Esta fase**                                                   |

**Ajena a todo lo anterior:** `src/domain/effects/debt.ts` guarda un byte NUL
literal como separador de clave compuesta. La lógica es correcta, pero al ir
crudo hace que `grep` y ripgrep salten el archivo entero en silencio. Se arregla
escribiendo ese byte como un escape, en su propia rama.
