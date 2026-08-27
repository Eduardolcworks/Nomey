# Punto de entrada — F4.C · App shell y navegación

> **Para empezar F4.C en una sesión nueva.** Es un documento operativo, no un
> historial: dice qué hay, qué no se toca y qué hay que producir. El **porqué**
> de cada decisión vive donde se tomó —los ADR, el plan de fase, los comentarios
> del código— y no se copia aquí.
>
> Escrito al cerrar F4.B.

---

## 1 · De dónde se parte

**Base: `main`.** F4.A y F4.B están cerradas y mergeadas. No hay trabajo en
vuelo.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento. Con eso basta. El
resto se consulta **bajo demanda**, según el protocolo de
[`project-context.md`](../runbooks/project-context.md).

**No hace falta releer** los ADR, las migraciones, `src/domain/`, los tests de
dominio ni el handoff de la Fase 3. F4 no toca el backend.

---

## 2 · Qué superficies existen ya

| Dónde                | Qué hay                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `src/ui/theme/`      | Paleta dark-only, 13 roles tipográficos, tokens de glass y de profundidad   |
| `src/ui/components/` | Solo `ThemedText` y `ThemedView`                                            |
| `src/lib/i18n/`      | Catálogos `es-ES` y `en`, resolución de locale, `t()`, preferencia          |
| `src/lib/format/`    | Importe, número, porcentaje y fecha, localizados y exactos                  |
| `src/app/`           | `_layout.tsx` con un `Stack` desnudo, e `index.tsx` con la pantalla técnica |

**Lo que hay que usar, siempre:**

```ts
const { t } = useTranslation();   // texto  -> catálogo activo
const format = useFormat();       // cifras -> región del dispositivo
const theme = useTheme();         // color  -> token, nunca un hex
<ThemedText variant="amountRow">  // tamaño -> rol, nunca un número
```

---

## 3 · Qué NO se reabre

Decidido, validado en iPhone, y fuera de discusión salvo defecto material:

- **Dark-only**, `#FDC506` como acento minoritario, y ningún color fuera de
  `src/ui/theme/`.
- **La escala tipográfica** y su eje de pesos: `700` es de los importes.
- **Los dos locales separados** y sus tipos marcados.
- **La exactitud monetaria**: los dígitos salen del `bigint`, y ninguna ruta
  convierte un importe a `number`.
- **La derivación de patrones por sondas**, sin `formatToParts`.
- **El icono y el splash**, ya integrados desde los originales de marca.
- Todo lo cerrado en la Fase 3: modelo, `api`, RLS, writer.

---

## 4 · Limitaciones reales de Hermes

**El `Intl` de Hermes no es el de Node**, y Vitest corre sobre Node. En iOS:

- **`Intl.NumberFormat.prototype.formatToParts` no existe.** Llamarlo revienta
  la app antes de pintar. `src/lib/format` no lo usa; no lo reintroduzcas.
- **`signDisplay` se ignora**, no falla. Es peor: el `+` desaparece en silencio.
- Lo mismo con `notation: 'compact'` y `compactDisplay`.

> **Nada que se ejecute en el dispositivo se da por verificado porque pase en
> Vitest.** Si F4.C necesita una API de `Intl` nueva, se comprueba antes su
> soporte real. Así llegó el único crash de F4.B a un iPhone.

---

## 5 · Idioma y formato, en una pantalla

- `useTranslation()` → **catálogo**. Cualquier `es-*` da español, cualquier
  `en-*` inglés, y un idioma no soportado cae a `es-ES`.
- `useFormat()` → **región real del dispositivo**, compuesta desde
  `languageCode` + script + `regionCode`. **La preferencia de idioma no la
  mueve.**
- La preferencia tiene tres estados —Automático, Español, English—, existe como
  API y **no tiene UI ni persistencia**. F4.C no la construye.
- **La región nunca cambia la moneda de un importe**, ni su escala ni su valor.

**Toda UI nueva pasa por ahí.** Hay un test que falla si una pantalla incrusta
una cadena visible, un símbolo monetario o una fecha escrita a mano — incluida
una etiqueta «provisional».

---

## 6 · Dirección visual

Vinculante y ya aprobada: [`design-direction.md`](../product/design-direction.md).
F4 la convierte en tokens; **no la redefine**.

**Glass y neumorfismo empiezan a consumirse en F4.C**, y hasta ahora nadie ha
usado esos tokens: su render en dispositivo está sin verificar. El primer
consumidor es la barra de navegación.

- El tinte del glass **no baja de `MinGlassTintAlpha`** — suelo de legibilidad
  medido, no valor estético.
- `expo-glass-effect` **no degrada, desaparece**: en Android y en iOS anterior a
  26, `GlassView` es un `View` normal, sin tinte ni blur. La superficie se pinta
  con los tokens propios; `GlassView` va encima como mejora.
- La profundidad **refuerza** una affordance, nunca la sostiene sola.

---

## 7 · Navegación — provisional, no congelada

Cerrado conceptualmente: `Grupos` y `Ajustes` son secciones propias · Personal y
Pareja son contextos distintos · **el Modo Pareja no se implementa** y la
arquitectura debe admitirlo después sin rehacer la navegación raíz · `+` es una
**acción destacada, no una pestaña** · no se finge ninguna funcionalidad futura.

Hipótesis inicial a probar, sin acoplarse a ella:

```
barra inferior:   Inicio | Grupos | + | Ajustes
dentro de Inicio: selector  Personal | Pareja
```

> **La navegación se cierra viéndola en un iPhone real.** F4.C debe permitir
> cambiar etiquetas, la posición del selector y el número o la disposición de
> destinos **sin rehacer el router** — lo que no autoriza varias
> implementaciones simultáneas ni una abstracción que soporte cualquier
> navegación imaginable.

Si mostrar `Pareja` activa induce a creer que existe, puede quedar **preparado y
deshabilitado**.

---

## 8 · Alcance de F4.C

**Dentro:** árbol de rutas con `expo-router` y `typedRoutes` · barra inferior ·
cabeceras · safe areas y status bar · jerarquía de cada sección · **sustituir la
pantalla técnica como home**.

**Fuera:** primitives reutilizables y estados de carga/vacío/error (F4.D) ·
wireframes detallados (F4.D) · Auth y sesión (F5) · funcionalidad económica ·
backend y llamadas a `api.*` · Modo Pareja funcional · UI de Ajustes y
persistencia del idioma.

---

## 9 · La pantalla técnica de F4.B

`src/app/index.tsx` es **temporal**, y **F4.C debe sustituirla como home**.
Muestra la preferencia de idioma, el idioma y la región del sistema, el catálogo
activo, el formato regional, importes de muestra, la paleta y el informe de
`Intl`.

Puede eliminarse, o quedar accesible solo en desarrollo. Lo que **no** se
elimina es la evidencia automática: los tests de `tests/lib/` cubren lo mismo
sin depender de que alguien mire una pantalla. Si desaparece la pantalla,
`src/lib/format/intl-report.ts` se conserva o se retira **con** ella; no se
queda sin consumidor y sin borrar.

---

## 10 · Validación obligatoria antes de cerrar F4.C

`npm test` · `npm run verify` · `git diff --check`, y además:

> **Probarlo en un iPhone real con Expo Go antes de dar el bloque por cerrado.**
> El desarrollo es desde Windows, así que `npx expo run:ios` no está disponible
> y la comprobación se hace con `npx expo start`.

Se mira: que las secciones navegan, que las etiquetas salen en los dos idiomas,
y que el glass mantiene contraste sobre contenido claro y oscuro.

**Sigue pendiente de la primera build iOS propia**, y no bloquea: icono nativo
en el Springboard, máscara final, splash nativo y la transición previa a que
cargue el JS. Expo Go usa los suyos.

---

## 11 · Deuda conocida

Registrada, **no** para resolver en F4.C:

| Deuda                                            | Dónde se resuelve             |
| ------------------------------------------------ | ----------------------------- |
| Persistencia de la preferencia de idioma         | Con la UI de Ajustes          |
| Selector de idioma visible                       | Con la UI de Ajustes          |
| Plurales en i18n                                 | Cuando aparezca el primer uso |
| Icono y splash nativos, sin ver                  | Primera build iOS propia      |
| Tabla de `Intl` sin revisar fila a fila          | Cuando aporte algo revisarla  |
| Tokens de glass y táctiles sin render verificado | **F4.C**, al consumirlos      |

**Ajena a la Fase 4:** `src/domain/effects/debt.ts` guarda un byte NUL literal
como separador de clave compuesta. La lógica es correcta —es el único byte que
no puede aparecer en un UUID—, pero al ir crudo hace que `grep` y ripgrep salten
el archivo entero en silencio. Se arregla escribiendo ese byte como un escape
en el template literal, en su propia rama y sin tocar la lógica de deuda.
