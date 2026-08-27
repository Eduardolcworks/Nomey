# `src/ui` — design system

Presentación pura y agnóstica del dominio.

## Reglas

- No importa de `app/`, `features/`, `domain/` **ni `lib/`** (impuesto por
  ESLint). Un componente no debe alcanzar Supabase, la cola offline ni las
  variables de entorno: eso lo recibe por props o por un hook de la feature.
- La restricción se aplica sobre la **ubicación real** del archivo importado,
  así que escribir `../lib/x` en lugar de `@/lib/x` no la elude.
- **Ningún hex hardcodeado en componentes.** Los colores se leen de
  `ui/theme` vía `useTheme()`, de modo que un cambio de marca o la llegada del
  tema claro sean una sola edición.
- **Ningún texto visible hardcodeado** una vez exista i18n (F4.B). Ver
  `AGENTS.md`.
- **Ningún tamaño de fuente suelto.** Se pide un **rol** —`amountRow`,
  `caption`— nunca «17px semibold».
- **Ningún `fontFamily` en los roles de texto.** Se usa la fuente del sistema
  —SF Pro en iOS, Roboto en Android—, y no se envía ninguna fuente propia para
  imitar a ninguna de las dos. Solo `mono` nombra familia.
- **Ningún `letterSpacing`.** SF Pro ya aplica tracking óptico por tamaño;
  añadir el propio lo aprieta dos veces.
- **El peso significa algo, y la negrita es del dinero:** `700` los dos importes
  de display · `600` estructura · `500` énfasis · `400` prosa.

## Estructura

```
ui/
├── theme/
│   ├── colors.ts       paleta, dark-first, con su contraste medido
│   ├── typography.ts   roles tipográficos, con cifras tabulares en importes
│   ├── elevation.ts    glass (superficies) y táctil (controles)
│   ├── spacing.ts      escala de espaciado y radios
│   ├── fonts.ts        familias por plataforma
│   └── use-theme.ts    el único punto donde se resuelve la paleta activa
└── components/         componentes base reutilizables
```

## Estado

**Nomey es dark-only.** `Colors.dark` es la experiencia real y la única con
contraste medido; `Colors.light` se conserva como andamiaje para no bloquear una
ampliación futura, **no está diseñada ni validada**, y ninguna pantalla se
comprueba contra ella.

**La paleta ya no es provisional.** El amarillo de marca es `#FDC506` y sus
ratios están anotados en `colors.ts`. `textDisabled` es el **único** token por
debajo de AA, deliberadamente y con su motivo escrito.

**Los tokens de profundidad existen; su render en dispositivo todavía no está
verificado.** Los consumirá un componente en F4.C/F4.D. Dos cosas que no son
negociables al hacerlo:

- el tinte del glass no baja de `MinGlassTintAlpha`, que es un **suelo medido**
  de legibilidad, no un valor estético;
- la profundidad **refuerza** una affordance, nunca la sostiene sola.

**`components/` sigue teniendo solo lo mínimo**: `ThemedText` y `ThemedView`. La
biblioteca no se construye aquí de forma especulativa — crece en F6 sobre casos
reales.

> **Cuidado con `role`.** `TextProps` de React Native ya trae una prop `role`
> (ARIA). Por eso el rol tipográfico de `ThemedText` se llama **`variant`**:
> intersecar ambas uniones colapsa la prop al único valor que comparten y el
> error de TypeScript no apunta ni de lejos a la causa.

Los tokens `positive` / `negative` son semántica financiera (entra / sale
dinero). **El color nunca debe ser la única señal**: acompañar siempre con
signo, icono o etiqueta.
