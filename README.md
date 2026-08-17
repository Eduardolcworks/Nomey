# Nomey

Aplicación móvil de finanzas personales y gastos compartidos, para iOS y
Android.

**Software propietario.** Ver [`NOTICE.md`](NOTICE.md) y
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

---

## Qué es

Tres pilares:

1. **Finanzas personales** — ingresos, gastos, categorías, presupuestos, gastos
   recurrentes, objetivos de ahorro, previsión y dinero disponible real.
2. **Gastos compartidos** — grupos, viajes, parejas y pisos compartidos: quién
   pagó, cómo se reparte, deudas y liquidaciones.
3. **Entrada en ~5 segundos** — registrar un gasto corriente debe ser casi
   instantáneo, primero desde la app y después desde widgets, Siri y el Botón
   de Acción.

### La idea que lo distingue

Un gasto compartido son **tres hechos distintos**, no uno. Si alguien paga 120 €
de una cena entre cuatro:

| Hecho                     | Importe |
| ------------------------- | ------- |
| Salió de su cuenta        | −120 €  |
| Lo que realmente consumió | −30 €   |
| Lo que le deben           | +90 €   |

Cuando recibe esos 90 €, **no es un ingreso**: cancela una deuda. Modelar esto
correctamente es la decisión central del proyecto.

---

## Estado

**Fase 0 — cimientos del repositorio.**

Todavía no hay base de datos, ni autenticación, ni funcionalidad. La pantalla
en blanco es intencionada. Ver el [roadmap por fases](docs/README.md).

---

## Stack

React Native · Expo SDK 57 · expo-router · TypeScript · Supabase (Postgres,
Auth, RLS) · Swift para integraciones nativas de iOS más adelante.

Web **no** es plataforma objetivo.

---

## Puesta en marcha

Requiere **Node 22 LTS** (`>=22.13.0 <23`). La versión está declarada en
[`.nvmrc`](.nvmrc) y en el campo `engines` de `package.json`.

> **En Windows:** `nvm-windows` **no lee `.nvmrc`**. Si lo usas, ejecuta
> `nvm use 22.x.x` indicando la versión a mano. Los gestores que sí lo leen son
> [fnm](https://github.com/Schniz/fnm) y [nvs](https://github.com/jasongin/nvs);
> [Volta](https://volta.sh) también funciona bien en Windows pero se ancla
> desde `package.json`. `.nvmrc` se conserva porque además es la única fuente
> de la versión que usa la CI.

```bash
npm install
```

```bash
npm start
```

Después, `i` para iOS o `a` para Android. También `npm run ios` / `npm run android`.

Copia `.env.example` a `.env` cuando haya credenciales que configurar. **`.env`
nunca se commitea.**

---

## Comandos

| Comando             | Qué hace                        |
| ------------------- | ------------------------------- |
| `npm start`         | Servidor de desarrollo          |
| `npm run ios`       | Servidor + iOS                  |
| `npm run android`   | Servidor + Android              |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | ESLint                          |
| `npm run format`    | Prettier                        |
| `npm run verify`    | typecheck + lint + format check |

Ejecuta `npm run verify` después de cada unidad de trabajo. CI lo comprueba en
cada PR.

---

## Estructura

```
src/
├── app/        # rutas de expo-router. Archivos finos, solo composición.
├── features/   # dominios funcionales autónomos
├── domain/     # reglas de negocio puras. Sin React, Expo, Supabase ni red.
├── lib/        # infraestructura: supabase, query, offline, format, env
├── ui/         # design system
└── types/
```

Las dependencias van en una sola dirección:
`app/ → features/ → domain/ + lib/ + ui/`. Nunca al revés, nunca entre
features. Lo impone ESLint, no es una convención opcional.

Cada carpeta tiene un `README.md` con sus restricciones.

---

## Documentación

- [`docs/`](docs/README.md) — wiki técnica y de producto (español)
- [`docs/adr/`](docs/adr/README.md) — decisiones arquitectónicas
- [`AGENTS.md`](AGENTS.md) — reglas operativas para personas y agentes de IA

---

## Contribuir

Ramas `feature/*`, `fix/*`, `chore/*` desde `main`. Commits en inglés siguiendo
Conventional Commits. Nunca commits directos a `main`.

Todo lo que toque dinero o RLS necesita revisión reforzada: son los dos sitios
donde un fallo produce números erróneos silenciosos o fuga de datos entre
usuarios.
