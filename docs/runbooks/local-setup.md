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

## 7 · Antes de la primera migración

Dos cosas que este runbook **no** resuelve y que hay que tener presentes al
escribir `supabase/migrations/`, que hoy no existe.

### El bootstrap de `api`

[ADR-014](../adr/ADR-014-data-api-schema-exposure.md) decide que `public` no se
expone. La configuración final es `schemas = ["api", "graphql_public"]`, y **el
commit que cree el schema `api` debe traerla consigo**: está medido que con esa
lista y sin ese schema PostgREST no arranca.

> **Lo que ese commit tendrá que verificar desde un estado limpio** es el orden
> real de arranque: que la migración se aplique **antes** de que PostgREST
> reclame el schema. Que ambos cambios viajen juntos es **necesario**; su
> suficiencia **no está medida**. Es un criterio de aceptación de esa migración.

### La E/S de `/mnt/c`

El camino de lectura está probado: `--version` y `status` responden con
normalidad, y un recorrido de los ficheros del repositorio desde Ubuntu tarda
unos 166 ms. **Pero `db reset` y `db diff` mueven mucha más E/S**, y eso no está
medido. Si `/mnt/c` resultara demasiado lento, la alternativa es un checkout
dentro del filesystem de Linux — que implica dos copias y su propio coste, y no
se adopta sin evidencia.

---

## 8 · Lo que este entorno no cubre

- **CI.** GitHub Actions no ejecuta hoy la Supabase CLI.
- **Producción.** Nada de este runbook apunta a un proyecto remoto; no hay
  `link`, `push` ni `pull`, y `AGENTS.md` prohíbe ejecutar nada contra
  producción.
- **macOS y Linux nativo.** Este runbook describe el equipo de desarrollo
  actual, que es Windows. Un entorno sin WSL no necesita el rodeo: usaría la
  CLI directamente.
