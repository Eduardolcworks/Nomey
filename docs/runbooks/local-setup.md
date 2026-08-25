# Runbook · Entorno local de Nomey

> **Procedimiento operativo, no decisión de arquitectura.** Describe cómo se
> monta y se usa el entorno de desarrollo de este equipo. Las decisiones que
> obedece viven en [`docs/adr/`](../adr/README.md).

Escrito el 2026-08-25, al fijar la vía reproducible de la Supabase CLI antes de
las primeras migraciones.

---

## 1 · La topología, en una imagen

```
Windows  ← entorno principal
├── VS Code / Claude Code
├── checkout de Nomey en C:\Proyectos\Nomey
├── node_modules  ← EXCLUSIVO de Windows
├── npm test · npm run verify
└── Docker Desktop (backend WSL2)
        │
        └── Ubuntu (WSL2)  ← solo para la Supabase CLI
            ├── Node por nvm, versión de .nvmrc
            ├── ve el mismo checkout en /mnt/c/Proyectos/Nomey
            └── ./scripts/supabase-cli.sh
```

**Un solo checkout, dos toolchains.** No se clona el repositorio dos veces:
Ubuntu lee el mismo árbol a través de `/mnt/c`. Es lo que evita que Windows y
Linux diverjan.

---

## 2 · Entorno principal — Windows

El desarrollo normal ocurre en Windows: editor, ejecución de la app y toda la
verificación.

```bash
npm ci
npm test
npm run verify
```

> ### `node_modules` pertenece al toolchain de Windows
>
> **Nunca ejecutes `npm install` ni `npm ci` desde Ubuntu sobre
> `/mnt/c/Proyectos/Nomey`.**
>
> Windows y Ubuntu ven **físicamente el mismo `node_modules`**, porque el
> checkout está en `/mnt/c`. Ese árbol contiene hoy artefactos compilados para
> Windows. Un `npm ci` desde Linux los sustituiría por los de Linux y dejaría
> el entorno de Windows roto; hacerlo al revés rompería el de Linux. No hay
> aviso: la instalación tiene éxito y lo que falla es después.
>
> La Supabase CLI **no necesita** `node_modules`: `npx` descarga a
> `~/.npm/_npx` del usuario de Linux, fuera del repositorio.

---

## 3 · Docker

**Docker Desktop con backend WSL2**, y la integración habilitada para la distro
de Ubuntu — _Settings → Resources → WSL Integration_. Es lo que hace que
`docker` funcione dentro de Ubuntu apuntando al mismo motor que usa Windows, de
modo que **hay un único stack de Supabase**, no dos.

Comprobación desde Ubuntu:

```bash
docker version --format '{{.Server.Version}}'
docker ps --format '{{.Names}}'
```

Deben verse los contenedores `supabase_*_Nomey`. El usuario de Linux pertenece
al grupo `docker`, así que no hace falta `sudo`.

---

## 4 · Ubuntu (WSL2)

Una **distro de usuario normal**, instalada con `wsl --install -d Ubuntu`.

> **No uses `docker-desktop` como distro de desarrollo.** Es infraestructura
> interna de Docker Desktop, no un entorno soportado para trabajar.

**Node se instala con nvm**, sin `sudo` y sin instalación global, porque el
repositorio ya fija la versión exacta en [`.nvmrc`](../../.nvmrc) y `nvm` la
lee sin que haya que repetirla:

```bash
cd /mnt/c/Proyectos/Nomey
nvm install   # lee .nvmrc
nvm use
```

Comprobación de que la shell usa el toolchain de **Linux** y no el de Windows:

```bash
command -v node && command -v npm && command -v npx
```

Deben apuntar a `~/.nvm/versions/node/...`. Si apuntan a `/mnt/c/...`, nvm no
está cargado en esa shell: `source ~/.nvm/nvm.sh && nvm use`.

---

## 5 · Supabase CLI

**El comando estándar del proyecto es el wrapper**, siempre desde Ubuntu:

```bash
./scripts/supabase-cli.sh --version
./scripts/supabase-cli.sh status
```

**La versión de la CLI vive en una sola línea**, dentro de
[`scripts/supabase-cli.sh`](../../scripts/supabase-cli.sh). Este documento no
la repite a propósito: cambiarla es editar esa línea, y `--version` es la forma
de saber cuál está fijada. No se añade la CLI a `package.json` — ver §2.

El wrapper **falla en vez de funcionar mal**: si `npx` resuelve bajo `/mnt/c`
—es decir, si nvm no está cargado y se acabaría ejecutando el binario de
Windows— aborta con un mensaje explícito en lugar de ejecutar la vía
equivocada.

### Por qué desde Linux

El binario que descarga esta vía es `@supabase/cli-linux-x64`, un ELF de Linux.
El de Windows, `supabase.exe`, **no está firmado** (`NotSigned`), y su ejecución
depende del veredicto de reputación de **Smart App Control**, que está activo en
modo _enforced_ en este equipo.

> **La CLI de Windows no está rota.** Hoy funciona: se midió el 2026-08-25 y
> devuelve la misma información. Pero ese permiso es un veredicto externo,
> revocable, y **cada versión nueva de la CLI es un binario nuevo con un
> veredicto nuevo**. La vía de Linux no depende de eso, y por eso es la elegida
> para el trabajo de migraciones.

---

## 6 · Comprobación de que el entorno está sano

Desde **Windows**:

```bash
npm test
npm run verify
```

Desde **Ubuntu**, en `/mnt/c/Proyectos/Nomey`:

```bash
./scripts/supabase-cli.sh --version
./scripts/supabase-cli.sh status
```

`status` debe listar Studio, REST, GraphQL y la URL de la base de datos, y
detectar los contenedores **ya existentes** sin recrearlos.

---

## 7 · Migraciones

```bash
./scripts/supabase-cli.sh migration new <nombre>
./scripts/supabase-cli.sh db reset
```

`db reset` recrea la base y aplica **todas** las migraciones desde cero.

> ### `db reset` no relee `config.toml`
>
> **Un cambio en `config.toml` no llega a los contenedores con `db reset`.** Ese
> comando recrea la base de datos y recarga la caché de esquema, pero **no
> vuelve a renderizar el entorno de los contenedores**. Se midió: tras cambiar
> los schemas expuestos y hacer `db reset`, PostgREST seguía sirviendo la lista
> anterior.
>
> Para aplicar `config.toml` hace falta un ciclo completo:
>
> ```bash
> ./scripts/supabase-cli.sh stop --no-backup
> ./scripts/supabase-cli.sh start
> ```

### El orden de arranque, ya medido

`supabase start` desde frío ejecuta, **en este orden**:

```
Starting database  →  Applying migration ...  →  Starting containers  →  health checks
```

**Las migraciones se aplican antes de arrancar PostgREST.** Es lo que hace
viable la decisión de [ADR-014](../adr/ADR-014-data-api-schema-exposure.md): con
`schemas = ["api", …]` el schema ya existe cuando PostgREST carga su caché, y no
se reproduce el `503` que sí ocurre si se cambia la configuración sin la
migración.

### La E/S de `/mnt/c` es aceptable

Medido el 2026-08-25 sobre el bootstrap:

| Operación                   | Duración |
| --------------------------- | -------- |
| `db reset` (primera)        | 38 s     |
| `db reset` (segunda)        | 38 s     |
| `stop` + `start` desde frío | 47 s     |

Suficiente para trabajar. **No se migra el repositorio al filesystem de Linux**;
si en el futuro un esquema mucho mayor lo empeorase de forma material, esa
alternativa sigue disponible, con el coste de mantener dos copias.

### Comprobar el bootstrap contra la base real

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/bootstrap.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/core-ledger.sql
```

Fallan con código distinto de cero en la primera violación, y **no dejan datos**:
lo que insertan ocurre dentro de una transacción que termina en `ROLLBACK`. La
configuración versionada la comprueba `npm test`, en `tests/infra/`.

**CI ejecuta estos mismos dos ficheros** en el job `Migrations rebuilt from
zero`, sobre un stack levantado desde cero.

---

## 8 · Lo que este entorno no cubre

- **HTTP en CI.** El job de base de datos levanta solo `postgres` y `postgrest`,
  así que las comprobaciones de exposición por HTTP siguen siendo locales. Lo
  que sí protege es el arranque: si `api` dejara de existir, PostgREST no
  pasaría su health check.
- **Producción.** Nada de este runbook apunta a un proyecto remoto; no hay
  `link`, `push` ni `pull`, y `AGENTS.md` prohíbe ejecutar nada contra
  producción.
- **macOS y Linux nativo.** Este runbook describe el equipo de desarrollo
  actual, que es Windows. Un entorno sin WSL no necesita el rodeo: usaría la
  CLI directamente.
