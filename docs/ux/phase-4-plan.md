# Fase 4 — plan de ejecución

> **Documento de trabajo, no normativo.** Registra el plan aprobado de la Fase 4
> y las decisiones de producto que la abren. Lo normativo sigue viviendo donde
> ya vivía: el alcance y los criterios de cierre en
> [`roadmap.md`](../product/roadmap.md) §Fase 4, y la estética en
> [`design-direction.md`](../product/design-direction.md), que **este documento
> no redefine**.
>
> Aprobado el 2026-08-27, al abrir la fase. **F4.A y F4.B están cerradas y
> mergeadas; el bloque siguiente es F4.C.** El estado vivo lo lleva
> [`PROJECT_STATE.md`](../PROJECT_STATE.md); esto es el plan, no un registro de
> avance.

---

## 1 · Bloques

Cuatro, con fronteras claras. **No se subdivide más salvo necesidad material.**

| Bloque   | Objetivo                                                                 | Estado        |
| -------- | ------------------------------------------------------------------------ | ------------- |
| **F4.A** | Fundación visual y marca: tokens, tipografía, profundidad, icono, splash | **Cerrado**   |
| **F4.B** | i18n (`es-ES`, `en`) y fundación de formateo localizado                  | **Cerrado**   |
| **F4.C** | App shell y navegación                                                   | **Siguiente** |
| **F4.D** | Primitives mínimos, estados de carga/vacío/error y wireframes            | Pendiente     |

**Dependencias.** F4.A y F4.B pueden solaparse. F4.C exige ambos —y ya los
tiene—. F4.D exige F4.C. **Orden: A → B → C → D**, una rama por bloque.

**Primer hito visualmente útil en iPhone: el cierre de F4.C.** F4.A ya da señal
en dispositivo —fondo, paleta, tipografía y el amarillo real en OLED—, pero no
es todavía una app navegable.

### Qué se puede validar y cuándo

El desarrollo es **desde Windows**, así que `npx expo run:ios` no es una vía
local: exige macOS y Xcode. La validación en iPhone físico se hace con **Expo
Go**, y eso parte la comprobación visual en dos, no la bloquea.

| Validable ya, en Expo Go              | Espera a la primera build iOS propia    |
| ------------------------------------- | --------------------------------------- |
| Fondo dark y comportamiento del tema  | App icon real en el Springboard         |
| Paleta y contraste sobre OLED         | Máscara final del icono                 |
| El amarillo de marca en pantalla real | Splash nativo exacto                    |
| Tipografía y jerarquía                | Transición nativa previa a cargar el JS |
| Status bar y safe area                | Ausencia de destello blanco al arrancar |

**Los assets y la configuración quedan verificados técnicamente** —`npx expo
config` los resuelve, `tests/infra/brand-chrome.test.ts` los ata a sus tokens y
el bundle de iOS se empaqueta—; lo pendiente es **mirarlos**, no comprobarlos.

> **Comprobación pendiente registrada:** icono, splash y arranque nativo se
> revisan en la primera build iOS propia. No se monta EAS, certificados ni
> ninguna infraestructura nueva para adelantarla.

### Criterios de cierre por bloque

Se suman a los cuatro del roadmap, que son los de la fase completa.

- **F4.A** — ningún hex fuera de `src/ui/theme/` · el contraste de la paleta
  está **medido**, no supuesto · la pantalla se revisa en iPhone con Expo Go ·
  icono, splash y arranque nativo quedan como comprobación pendiente de la
  primera build iOS propia, según la tabla anterior.
- **F4.B** — cambiar el idioma del dispositivo cambia la app entera · un importe
  en EUR y otro en JPY se formatean con **su** escala · ninguna cadena literal
  fuera de los catálogos · `Intl` **medido** en Hermes sobre iPhone.
- **F4.C** — la barra inferior navega en iPhone físico · etiquetas en ambos
  idiomas, desde los catálogos · el glass mantiene contraste sobre contenido
  claro y oscuro · **la pantalla técnica de F4.B deja de ser el home**.
- **F4.D** — los tres estados renderizan y se reutilizan en más de una pantalla ·
  cada pantalla principal tiene su vacío y su error · ninguna primitive alcanza
  `lib/` ni `features/`.

---

## 2 · Decisiones cerradas al abrir la fase

**Tema.** Dark-only visible. `app.config.ts` fija `userInterfaceStyle: 'dark'`.
La tabla `light` se conserva como andamiaje **no diseñado ni validado**, para no
bloquear una ampliación futura. La resolución vive en un único sitio,
`src/ui/theme/use-theme.ts`.

**Marca.** El amarillo funcional es **`#FDC506`**, plano y separado de los
brillos y gradientes del logo: el logo es un asset, no un material de interfaz.
Los gradientes **no** se extrapolan a la interfaz. Dos variantes de logo son
reales y ninguna se descarta: **símbolo negro sobre amarillo es la principal**, y
es la que va al app icon porque un icono tiene que encontrarse en una pantalla de
inicio llena; símbolo amarillo sobre negro es la secundaria, y es la del splash,
porque el arranque desemboca en una app oscura. **Nada de esto cambia el
interior**: dark-first, negro dominante, amarillo minoritario.

**Boceto de pantallas** —[`reference/concept-screens.png`](reference/concept-screens.png)—.
Referencia **exclusivamente** de paleta, contraste y proporción cromática. No se
copia layout, navegación, cards, gráficos, botones, tipografía, tamaños,
composición ni jerarquía. F4 construye su propio lenguaje.

**Glass y neumorfismo.** Se reconcilian con `design-direction.md` §5 y §6 sin
modificarla: glass para **superficies que contienen** —cards, paneles, sheets,
barras—; neumorfismo como **matiz táctil de los controles que responden**
—botones, toggles, chips, segmented, tabs, `pressed` y `selected`—. Puede haber
profundidad ligera en reposo. No se aplica ninguno de los dos mecánicamente.

**Prioridad, en este orden:** usabilidad y claridad → jerarquía visual →
identidad → efecto visual.

**i18n.** `expo-localization` más un módulo propio mínimo en `src/lib/i18n/`.
No se añade librería de traducciones salvo necesidad concreta que el módulo no
resuelva. Idiomas iniciales `es-ES` y `en`.

**Formateo.** `src/lib/format/` es responsable de la presentación localizada.
**Nunca** aritmética monetaria, y **nunca** floats para simplificar la UI: los
valores exactos que fijó la Fase 3 son intocables.

---

## 3 · Navegación — dirección provisional, no decisión congelada

**Cerrado conceptualmente:** `Grupos` es sección propia · `Ajustes` es sección
propia · Personal y Pareja son **dos contextos distintos** · el Modo Pareja **no
se implementa** en F4 y la arquitectura debe admitirlo después **sin rehacer la
navegación raíz** · la acción `+` es una acción destacada, **no una pestaña** ·
no se finge ninguna funcionalidad futura.

**Candidata a probar en F4.C**, sin acoplarse a ella:

```
barra inferior:  Inicio | Grupos | + | Ajustes
dentro de Inicio: selector  Personal | Pareja
```

> **La navegación se cierra viéndola en un iPhone real, no razonándola antes.**
> F4.C debe permitir cambiar etiquetas, la posición del selector, el número y la
> disposición de destinos y la barra inferior **sin rehacer el router**. Eso no
> autoriza varias implementaciones simultáneas ni una abstracción capaz de
> soportar cualquier navegación imaginable: solo que la primera implementación
> sea razonablemente reversible.

Si mostrar `Pareja` activa induce a creer que existe funcionalmente, puede
quedar **preparado y deshabilitado** hasta su fase. Los wireframes de F4.D sí
contemplan cómo convive ese cambio de contexto con la navegación principal.

---

## 4 · Componentes

F4 **no** construye una biblioteca completa. En F4.D solo entran primitives con
**un consumidor real** en los wireframes: `Surface`/`Card`, `Button`/`Pressable`,
`Chip`, `Toggle`/`Segmented`, `ListRow`, `Amount`, y los estados de carga, vacío
y error. La consolidación crece después, sobre casos reales, en F6.

**Glass y neumorfismo se empiezan a consumir aquí.** F4.A dejó los tokens
—`Glass`, `Tactile`, `MinGlassTintAlpha`— y nadie los usa todavía, así que su
render en dispositivo está sin verificar. El primer consumidor real es la barra
de navegación de F4.C, y los controles en F4.D. Dos cosas no negociables al
hacerlo: el tinte del glass **no baja de `MinGlassTintAlpha`**, que es un suelo
de legibilidad medido y no un valor estético; y la profundidad **refuerza** una
affordance, nunca la sostiene sola.

**Toda UI nueva pasa por i18n y por `lib/format`.** No hay excepción para una
etiqueta «provisional»: hay un test que falla si una pantalla incrusta texto,
un símbolo monetario o una fecha escrita a mano.

---

## 5 · Fuera de alcance de la fase

Funcionalidad económica real · backend y llamadas a `api.*` · Auth y sesión (F5)
· provisioning de ámbitos y participantes · Grupos funcionales · Modo Pareja
funcional · deuda y liquidaciones · FX · entrada rápida detallada (F7) ·
consolidación del design system (F6).
