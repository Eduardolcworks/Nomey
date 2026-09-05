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

> ### Que `supabase start` termine bien NO demuestra que la frontera esté en pie
>
> **Medido en F8.A4.** El stack puede quedarse con Postgres, GoTrue y PostgREST
> corriendo y el contenedor de **Kong parado**. En ese estado `supabase start`
> sale con **código 0** — los contenedores que siguen vivos le bastan para darse
> por levantado — y `54321` no contesta a nadie. Todo lo que entra por
> `docker exec` funciona con normalidad, así que el problema no aparece hasta el
> primer `curl`, muy lejos de su causa y con un `000` que no nombra el gateway.
>
> La comprobación real es el endpoint, no el código de salida:
>
> ```bash
> curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
> docker ps --filter name=supabase_kong --format '{{.Names}} {{.Status}}'
> ```
>
> `200` es la frontera sana; `000` es que no hay gateway. Los tres scripts que
> hablan por HTTP —`http-boundary-check.sh`, `http-boundary-isolation.sh` y
> `offline-taxonomy-probe.sh`— ya lo comprueban al arrancar con
> `exigir_frontera_http`, de `scripts/local-db-guard.sh`, y abortan diciendo qué
> falta. **Ninguna de esas guardas arregla nada**: no levanta, no reinicia y no
> para contenedores. Recuperarlo es una decisión de quien mira, y lo mínimo que
> lo resuelve es `docker start supabase_kong_Nomey`.
>
> El wrapper `scripts/supabase-cli.sh` **no** hace esta comprobación, y es
> deliberado: es un paso a través que termina en `exec`, de modo que no puede
> inspeccionar el resultado de un `start` sin dejar de serlo, y sus dos guardas
> responden a otra pregunta — qué binario se ejecuta, no si el stack está sano.
> Meterle un sondeo obligaría a tratar `start` como un caso especial dentro de
> un comando genérico.

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

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/scope-effect.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/participant-identity.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/split-conversion.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/canonical-attribution.sql
```

```bash
{ ./scripts/vectors-prelude.sh ; cat supabase/checks/authoritative-writer.sql ; } \
  | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
      -X -q -v ON_ERROR_STOP=1
```

```bash
{ ./scripts/vectors-prelude.sh ; cat supabase/checks/authoritative-writer-debt.sql ; } \
  | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
      -X -q -v ON_ERROR_STOP=1
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/personal-provisioning.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/movement-anatomy.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/balance-and-annulment.sql
```

> **Los dos últimos se encadenan con el prólogo de vectores.** `psql` corre
> dentro del contenedor y no ve el checkout, así que `tests/vectors/*.json`
> viajan por la misma entrada estándar. ADR-002 §7 exige que la implementación
> de PL/pgSQL reproduzca esos vectores exactamente, y esa comprobación es el
> único detector de deriva frente a `src/domain/`.

Fallan con código distinto de cero en la primera violación, y **no dejan datos**:
lo que insertan ocurre dentro de una transacción que termina en `ROLLBACK`. La
configuración versionada la comprueba `npm test`, en `tests/infra/`.

**CI ejecuta estos mismos once ficheros** en el job `Migrations rebuilt from
zero`, sobre un stack levantado desde cero.

> **El último lleva dos regresiones deliberadas dentro.** Quita una policy del
> provisioner, comprueba que el fallo aparece **en la forma esperada**, y la
> devuelve. Sin la de `core.effect`, el cambio de moneda debe seguir rechazándose
> **por la FK compuesta** y no por el error de frontera; sin la de `core.scope`,
> el provisioning legítimo debe romperse. Si alguna de las dos dejara de fallar,
> la policy correspondiente habría dejado de importar y el check lo dice.

### Provisioning concurrente

Por la misma razón que la deuda: dos `ensure_personal_scope` simultáneos no se
pueden comprobar desde una sola sesión de `psql`.

```bash
./scripts/provisioning-concurrency.sh
```

Comprueba que la carrera deja **un solo ámbito con su membresía** —un ámbito sin
membresía deja al dueño sin ver sus propios efectos y no lanza nada— y que dos
cambios de moneda simultáneos no producen un estado mezclado. Se verificó capaz
de fallar quitando el índice único `scope_un_personal_por_usuario`, que reproduce
el ámbito duplicado exactamente.

> **Los tres scripts que escriben filas confirmadas borran solo lo suyo.** Desde
> la Fase 6.A el catálogo monetario lo siembra una migración, así que un
> `delete from core.currency_definition` sin filtro lo arrasaría y los checks
> siguientes dejarían de encontrarlo. Dos de ellos comprueban al terminar que las
> **veinte definiciones siguen ahí**.

### Concurrencia real de la deuda

Hay una comprobación que **no puede ser un fichero de `supabase/checks/`**: una
sola sesión de `psql` no tiene concurrencia, y una simulación secuencial pasaría
también con el lock quitado. El protocolo de serialización de
[ADR-013](../adr/ADR-013-persisted-vs-derived.md) §11 se comprueba con sesiones
simultáneas de verdad, igual que hizo E15-C:

```bash
./scripts/writer-debt-concurrency.sh
```

Y desde F6.C, la del **saldo**, que reproduce ya corregidas las dos carreras que
[`supabase/e22/`](../../supabase/e22/README.md) midió antes de arreglarlas:

```bash
./scripts/balance-concurrency.sh
```

> **Estos sí escriben filas confirmadas**, porque un bloqueo de fila solo existe
> entre transacciones distintas. Las retira al terminar y comprueba que no queda
> ninguna. Ejecútalo **después** de los checks: si algo lo interrumpiera a
> mitad, los datos que dejaría cambiarían los recuentos de los demás. Un
> `db reset` los borra igualmente.

Comprueba cuatro cosas, y todas se verificaron capaces de fallar sustituyendo
`sec.lock_debt_scopes` por una función vacía:

| Escenario                                      | Qué demuestra                                                |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Dos liquidaciones simultáneas                  | Una aceptada, una rechazada, y **ningún sobrepago**          |
| Dos correcciones que cruzan los mismos ámbitos | El orden ascendente por identificador **evita el deadlock**  |
| Corrección que reduce la deuda vs. liquidación | La liquidación **espera** y valida contra la deuda corregida |
| La misma carrera cinco veces                   | El resultado contable es **determinista**                    |

Con el lock desactivado reaparece exactamente el `−1000` que E15-C midió.

### La frontera completa, por HTTP y con JWT real

```bash
./scripts/http-boundary-check.sh
```

Recorre la ruta entera, sin simular nada:

```
cliente HTTP → Kong → GoTrue (JWT real) → PostgREST → api.* → writer → RLS/core
```

**Exige que GoTrue esté arrancado.** Todos los demás checks simulan la identidad
con `set_config('request.jwt.claims', …)`, que es suficiente para la RLS pero
**no puede demostrar** que un token emitido por Auth resuelva a `authenticated`.
Si el stack se levantó excluyendo `gotrue`, el script aborta con instrucciones en
vez de dar un falso verde.

```bash
./scripts/supabase-cli.sh start \
  -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

> **Mailpit sigue excluido a propósito.** `config.toml` tiene
> `enable_confirmations = false`, así que el alta devuelve sesión sin enviar
> ningún correo. Medido con esta topología exacta, que es la misma que usa CI.

Comprueba: el JWT resuelve al rol correcto y su `sub` acaba en la atribución de
la operación · sin JWT la escritura se rechaza con `401` · un importe enviado
como **number** se rechaza y uno por encima de 2^53 cruza y se persiste exacto ·
**las siete funciones** responden `200` · el replay devuelve el mismo
`operation_id` con `already_processed` · los seis códigos de error viajan con su
estado HTTP · ninguna tabla de `core` es alcanzable y `api.personal_effect` sí,
con su caso positivo y su caso negativo · los importes salen como string JSON.

> **Escribe filas confirmadas y crea dos usuarios reales**, porque una petición
> HTTP es su propia transacción. Los retira al terminar y comprueba que no queda
> ninguno — ni datos ni usuarios. **Sin secretos en el repositorio:** la clave
> publicable se lee en ejecución de la configuración del Kong en marcha.

> ### `auth.uid()` no depende de GoTrue
>
> `scope-effect.sql` ejerce la RLS del rol cliente, que necesita `auth.uid()`.
> **Medido el 2026-08-25 sobre un arranque en frío con la topología exacta de
> CI** —solo `postgres`, `kong` y `postgrest`—: la función existe y funciona.
> Viene de los scripts de inicialización de la imagen `supabase/postgres`, no
> del contenedor de GoTrue, resuelve un `request.jwt.claims` simulado con
> `set_config` y devuelve `NULL` cuando no hay claims.
>
> **Consecuencia práctica:** los tests de aislamiento a nivel de base de datos
> no necesitan usuarios reales, y el job de CI no tiene que arrancar GoTrue.

### La tripleta de cada clase de respuesta · puerta de aceptación de ADR-028

```bash
./scripts/offline-taxonomy-probe.sh
```

**Es una comprobación permanente, no instrumentación de un bloque.** Mide sobre
el stack real la tripleta `estado HTTP · código de frontera · SQLSTATE` de cada
clase de respuesta de ADR-028 §11, que es de donde sale el mapa de
`src/lib/offline/response.ts`. La razón de que siga aquí: de esa clasificación
depende si se puede o no proponer registrar el gasto otra vez, y equivocarse
**duplica dinero**. Si un día la frontera cambia un estado o un código, esto lo
enseña; sin ella, el mapa envejecería en silencio.

Lo que hay que saber para leerla:

- **`42501` no significa «sesión caducada».** Llega con **401** cuando no hay
  JWT. Una denegación de autorización real, con sesión válida, llega con **403 y
  `NOT_AUTHORIZED`**. Por eso el mapa decide por el estado y el código sólo
  afina.
- **El SQLSTATE no viaja en la respuesta:** `sec.raise_boundary` lo convierte en
  estado HTTP y cuerpo (`raise sqlstate 'PGRST'`). La sonda lo dice en vez de
  inventarlo.
- **Fixtures propias y limpieza exacta.** Crea sus usuarios
  `nomey-f7c-*@example.test`, su ámbito y sus comandos, y borra **sólo lo suyo**.
  Imprime un censo antes y después —usuarios ajenos / operaciones / comandos /
  ámbitos— y **las dos cifras tienen que coincidir**: es la prueba de que no
  tocó los datos de desarrollo.
- **Necesita Kong arrancado**, como `http-boundary-check.sh`: lee de él la clave
  publicable en ejecución, así que en el repositorio no hay ninguna credencial.

> **`core.operation.current_version_id` es `NOT NULL`.** Su limpieza no puede
> «soltar» el puntero antes de borrar la versión; la FK compuesta es diferible
> (ADR-011 §7), así que borra versión y operación en una transacción con
> `set constraints all deferred`. Con `ON_ERROR_STOP=0` esto fallaba en silencio
> y dejaba operaciones huérfanas — de ahí que use `ON_ERROR_STOP=1`.

### Preflight de `btree_gist` antes de un despliegue real

El esquema depende de la extensión **`btree_gist`**, que es lo que da a `uuid` el
operator class GiST sin el cual la exclusión de solapes de
`core.participant_period` **no puede existir** — falla con `42704`. En el stack
local está disponible (1.7) e instalada en `extensions` por la migración.

**Eso no demuestra nada sobre el proyecto objetivo.** La documentación pública de
Supabase no enumera esta extensión, así que **antes de desplegar contra un
proyecto real hay que comprobarlo en ese proyecto**, con esta consulta:

```sql
select name, default_version, installed_version
from pg_available_extensions where name = 'btree_gist';
```

Debe devolver una fila. Si el entorno objetivo **no la ofreciera**,
[ADR-012](../adr/ADR-012-participant-identity.md) §5 obliga a **revisar el
mecanismo** —su alternativa G, validación procedural, exige serializar para ser
correcta bajo concurrencia—, no a sustituirlo preventivamente.

Nada de este runbook apunta a un proyecto remoto (§8): la comprobación se hará
cuando exista uno, y es un requisito de ese momento, no de hoy.

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
