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

Node objetivo: **22 LTS**. La versión está **declarada** en [`.nvmrc`](.nvmrc) y
en el campo `engines` de `package.json` (`>=22.13.0 <23`).

> **`engines` declara, no obliga.** Sin `engine-strict` activado, npm trata el
> desajuste como un aviso `EBADENGINE` e instala igualmente. No está activado
> todavía. Hoy la versión solo queda fijada de verdad en CI, que la lee de
> `.nvmrc`. Ejecutar con otra versión funcionará casi siempre; simplemente no
> es la combinación que se valida.

**Decisión provisional (pendiente de ejecutar, en este orden):** fijar Node
`22.23.2` de forma reproducible. Primero alinear el entorno local a esa
versión; después verificar y, si procede, regenerar `package-lock.json` bajo
ella (el actual se generó con Node 26.7.0, con un diff comprobado de solo
metadatos); por último reflejar la misma versión en `eas.json` cuando exista.
`.nvmrc` contiene todavía `22` y no se cambia hasta completar el primer paso.

> **En Windows:** `nvm-windows` **no lee `.nvmrc`**. Si lo usas, ejecuta
> `nvm use 22.x.x` indicando la versión a mano. Los gestores que sí lo leen son
> [fnm](https://github.com/Schniz/fnm) y [nvs](https://github.com/jasongin/nvs);
> [Volta](https://volta.sh) también funciona bien en Windows pero se ancla
> desde `package.json`. `.nvmrc` se conserva porque además es la única fuente
> de la versión que usa la CI.

Para preparar un checkout existente, **`npm ci`**: instala exactamente lo que
fija `package-lock.json`, parte de un `node_modules` limpio y falla si el lock y
`package.json` han divergido. `npm install` puede modificar el lockfile, así que
se reserva para cuando se cambian dependencias a propósito.

```bash
npm ci
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

### Añadir dependencias

Para cualquier paquete del ecosistema Expo, **`npx expo install <paquete>`**, no
`npm install <paquete>`: selecciona la versión compatible con el SDK instalado.
Un `npm install` directo puede traer una versión que no case con SDK 57.

```bash
npx expo install expo-secure-store
```

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
