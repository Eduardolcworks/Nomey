---
description: Scaffold a new feature module under src/features
argument-hint: [nombre-de-la-feature]
---

Crea el andamiaje de la feature **$ARGUMENTS** en `src/features/`.

Antes de escribir nada:

1. Lee `src/features/README.md` y `AGENTS.md`.
2. Comprueba que la feature no existe ya y que su responsabilidad no solapa con
   otra. Si solapa, dilo y para.

Estructura a crear en `src/features/<nombre>/`:

```
components/    # UI específica de esta feature
hooks/         # hooks de esta feature
api.ts         # llamadas a Supabase de este dominio
types.ts
index.ts       # API pública: nada externo importa por debajo de aquí
```

Reglas que debes respetar:

- **Prohibido importar de otra feature.** Si necesitas algo de otra, eso baja a
  `domain/`, `lib/` o `ui/`. ESLint lo bloquea.
- **Prohibido importar de `src/app`.**
- Dentro de la feature, imports relativos.
- Nada de reglas financieras aquí: la aritmética de dinero vive en `domain/`.
- Nada de textos visibles hardcodeados, ni símbolos de moneda, ni formatos de
  fecha españoles.
- Archivos en kebab-case.

Crea los archivos **vacíos o mínimos**, sin inventar lógica de negocio que no
se te haya pedido. Al terminar, ejecuta `npm run verify`.
