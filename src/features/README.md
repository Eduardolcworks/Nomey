# `src/features` — dominios funcionales

Cada feature es autónoma y agrupa todo lo suyo: UI, hooks, acceso a datos y
tipos.

## Anatomía

```
features/<nombre>/
├── components/   # UI específica de esta feature
├── hooks/        # hooks de esta feature
├── api.ts        # llamadas a Supabase de este dominio
├── types.ts
└── index.ts      # API pública: nada externo importa por debajo de aquí
```

## Reglas

- **Prohibido feature → feature.** Impuesto por ESLint. Si dos features
  necesitan lo mismo, eso baja a `domain/` (reglas de negocio), `lib/`
  (infraestructura) o `ui/` (presentación).
- **Prohibido importar de `src/app`.** Las rutas dependen de las features, no
  al revés.
- Dentro de una feature, usar imports relativos (`./`, `../`).
- Todo lo que consuma el exterior se exporta desde `index.ts`.

Esta separación es también lo que permite que varios agentes trabajen en
features distintas sin tocar los mismos archivos.

## Features previstas

`auth` · `transactions` · `budgets` · `insights` · `groups` ·
`shared-expenses` · `settlements` · `quick-entry`

Ninguna implementada todavía: se crean a partir de la Fase 5.
