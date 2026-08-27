# Punto de entrada — F4.D · Primitives, estados y wireframes

> **Para empezar F4.D en una sesión nueva.** Operativo, no histórico: qué hay,
> qué no se toca y qué hay que producir. El **porqué** de cada decisión vive
> donde se tomó — los ADR, el plan de fase, los comentarios del código.
>
> Escrito al cerrar F4.C.

---

## 1 · De dónde se parte

**Base: `main`, después del merge de F4.C.** F4.A, F4.B y F4.C están cerradas y
validadas en iPhone físico. No hay trabajo en vuelo.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento. **No hace falta
releer** los ADR, las migraciones, `src/domain/`, la Fase 3 ni los handoffs
anteriores. F4 no toca el backend.

---

## 2 · El shell vigente

```
raíz:      Inicio | Grupos          y nada más
Inicio:    Personal | Pareja        contexto, no destino
global:    +  flotante y contextual, fuera de la barra
           campana y perfil, en la cabecera de ambos destinos
```

| Ruta                     | Qué es                                     |
| ------------------------ | ------------------------------------------ |
| `app/_layout.tsx`        | Stack raíz y `ScopeProvider`               |
| `app/(tabs)/_layout.tsx` | Los dos destinos, con la barra propia      |
| `app/(tabs)/index.tsx`   | Inicio: cabecera, saldo y actividad        |
| `app/(tabs)/groups.tsx`  | Grupos: vacío y «Crear grupo»              |
| `app/add.tsx`            | La superficie del `+`, en modal            |
| `app/notifications.tsx`  | Placeholder, push                          |
| `app/profile.tsx`        | Filas de cuenta, idioma y apariencia; push |
| `app/diagnostics.tsx`    | La pantalla de F4.B, fuera de producto     |

---

## 3 · Qué existe para consumir

| Dónde                      | Qué hay                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `ui/theme/`                | Paleta dark-only, 13 roles tipográficos, `Glass` y `Tactile` |
| `ui/components/`           | `ThemedText`, `ThemedView`, `GlassSurface`                   |
| `features/shell/`          | Cabecera, barra, pulsador de ámbito, geometría del dock      |
| `lib/i18n/`, `lib/format/` | Catálogos, `t()`, y formateo exacto y localizado             |

**Lo que hay que usar, siempre:**

```ts
const { t } = useTranslation();   // texto  -> catálogo activo
const format = useFormat();       // cifras -> región del dispositivo
const theme = useTheme();         // color  -> token, nunca un hex
<ThemedText variant="amountRow">  // tamaño -> rol, nunca un número
<GlassSurface level depth>        // superficie -> material y estado
```

`DOCK_HEIGHT` es la única fuente de la geometría inferior. Una pantalla con
scroll que no la reserve deja su última fila permanentemente tapada.

---

## 4 · Qué NO se reabre

Aprobado en iPhone físico y fuera de discusión salvo defecto material:

- **La navegación raíz**: dos destinos, y Ajustes no es uno de ellos.
- **El `+` como acción contextual** fuera de las tabs, y su tratamiento visual
  final de cristal ámbar tintado — no es un disco amarillo.
- **La cabecera**: marca, firma, saludo, campana y perfil.
- **El pulsador único Personal/Pareja**, con los dos ámbitos visualmente iguales.
- **Los dos pulsadores inferiores independientes** y sus estados.
- **Glass y profundidad táctil** tal como están: el suelo de opacidad es una
  medición y lo comprueba un test.
- Todo lo cerrado en F4.A, F4.B y la Fase 3.

**F4.D trabaja sobre primitives, estados y wireframes. No rediseña el shell.**

---

## 5 · Reglas que siguen vigentes

- **Toda UI nueva pasa por i18n y por `lib/format`.** Hay un test que falla si
  una pantalla incrusta una cadena, un símbolo monetario o una fecha a mano —
  incluida una etiqueta «provisional».
- **`src/ui/` no puede importar de `lib/`.** Un componente que necesite `t()`
  vive en `features/`, no en el design system.
- **Nada suelto en `src/app/`**: expo-router convierte en ruta todo lo que hay.
- **El `Intl` de Hermes no es el de Node.** En iOS no existe `formatToParts` y
  `signDisplay` se ignora. Nada que se ejecute en el dispositivo se da por
  verificado porque pase en Vitest.
- **El color nunca es la única señal** de un estado, y ningún efecto se cobra
  contraste.

---

## 6 · Alcance de F4.D

**Dentro:** las primitives con **un consumidor real** en los wireframes —
`Card`, `Button`, `Chip`, `Toggle`/`Segmented`, `ListRow`, `Amount` — los
estados de **carga, vacío y error**, reutilizables, y los wireframes de las
pantallas principales derivados de `data-model.md` §4.

**Fuera:** rediseñar el shell · Auth y sesión (F5) · funcionalidad económica ·
backend y llamadas a `api.*` · Modo Pareja funcional · Grupos funcionales ·
entrada rápida (F7) · consolidación del design system, que crece en F6 sobre
casos reales.

---

## 7 · Criterio de cierre

Los del roadmap para la fase, más: los tres estados renderizan y **se reutilizan
en más de una pantalla** · cada pantalla principal tiene su vacío y su error ·
ninguna primitive alcanza `lib/` ni `features/`.

Y la validación que ningún test sustituye:

> **Probarlo en un iPhone real con Expo Go antes de dar el bloque por cerrado.**
> El desarrollo es desde Windows, así que se hace con `npx expo start`.

---

## 8 · Deuda abierta

Registrada, **no** para resolver en F4.D:

| Deuda                                    | Dónde se resuelve             |
| ---------------------------------------- | ----------------------------- |
| Persistencia de la preferencia de idioma | Con la UI de Ajustes          |
| Selector de idioma visible               | Con la UI de Ajustes          |
| Plurales en i18n                         | Cuando aparezca el primer uso |
| Icono y splash nativos, sin ver          | Primera build iOS propia      |
| Tabla de `Intl` sin revisar fila a fila  | Cuando aporte algo            |
| Modo Pareja funcional                    | Su fase                       |
| Grupos funcionales y Quick Entry         | F7 y siguientes               |

**Ajena a la Fase 4:** `src/domain/effects/debt.ts` guarda un byte NUL literal
como separador de clave compuesta. La lógica es correcta, pero al ir crudo hace
que `grep` y ripgrep salten el archivo entero en silencio. Se arregla
escribiendo ese byte como un escape, en su propia rama.
