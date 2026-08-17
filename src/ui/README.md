# `src/ui` — design system

Presentación pura y agnóstica del dominio.

## Reglas

- No importa de `app/`, `features/` ni `domain/` (impuesto por ESLint).
- **Ningún hex hardcodeado en componentes.** Los colores se leen de
  `ui/theme` vía `useTheme()`, de modo que el modo oscuro y un futuro cambio de
  marca sean una sola edición.
- **Ningún texto visible hardcodeado** una vez exista i18n. Ver `AGENTS.md`.

## Estructura

```
ui/
├── theme/       # colors, spacing, fonts, useTheme
└── components/  # componentes base reutilizables
```

## Estado

`colors.ts` es **provisional**: la identidad de Nomey es negra y amarilla, pero
la paleta exacta está pendiente. El acento cambiará; la escala neutra debería
sobrevivir.

Los tokens `positive` / `negative` son semántica financiera (entra / sale
dinero). **El color nunca debe ser la única señal**: acompañar siempre con
signo, icono o etiqueta.
