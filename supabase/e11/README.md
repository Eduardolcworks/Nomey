# E11 · Sondeo de la frontera de datos

Evidencia reproducible del experimento que
[ADR-003](../../docs/adr/ADR-003-money-representation.md) exigía como puerta de
aceptación: cómo sobreviven los tipos numéricos al recorrido

```
PostgreSQL  ->  PostgREST  ->  supabase-js  ->  TypeScript
```

El resultado normativo está en **§10 de ADR-003**. Aquí vive solo lo necesario
para volver a obtenerlo.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> a propósito, para no contaminar el historial del esquema definitivo. Se aplica
> y se retira a voluntad, y **nunca debe convertirse en migración**.

## Aislamiento de la dependencia

Los scripts de cliente miden `@supabase/supabase-js`, que **no es una
dependencia de Nomey**. Para no contaminar la aplicación, este directorio
declara su propio `package.json` y su propio `package-lock.json`, **fijados a la
versión realmente medida (`2.112.3`, sin rango**).

Consecuencias, todas deliberadas:

- El `package.json` raíz **no cambia**; el bundle de la app tampoco.
- No hay workspaces, así que un `npm ci` en la raíz **ignora este directorio**.
- `node_modules/` está en el `.gitignore` raíz y aplica a cualquier profundidad.
- Instalar aquí es **opcional y explícito**: solo lo hace quien reproduce E11.

## Archivos

| Archivo            | Qué hace                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe.sql`        | Tabla de sondeo con `BIGINT`, `NUMERIC` y `NUMERIC(30,12)`, casos límite alrededor de `2^53`, destino de escritura y las tres fronteras alternativas |
| `layers.sql`       | Cuatro tablas que aíslan cada nivel: schema expuesto · objeto · `GRANT` · RLS                                                                        |
| `readback.sql`     | Valor **real** almacenado en PostgreSQL, más grants y RLS efectivos                                                                                  |
| `teardown.sql`     | Retirada completa. Idempotente                                                                                                                       |
| `raw-http.mjs`     | Bytes crudos de PostgREST, frontera directa                                                                                                          |
| `client.mjs`       | Qué recibe `supabase-js`, frontera directa                                                                                                           |
| `layers.mjs`       | Los cuatro niveles de alcance                                                                                                                        |
| `alternatives.mjs` | Vista con `::text`, RPC con casts, RPC sin castear                                                                                                   |

Los tres primeros `.sql` son **idempotentes**: hacen `drop` antes de crear, así
que se reaplican sin depender de residuos de una ejecución anterior.

## Reproducirlo desde un clon limpio

Requiere Docker operativo.

### 1 · Levantar el stack

```bash
npx supabase start
```

Anota de su salida el `API_URL` y el `PUBLISHABLE_KEY`. Son valores locales de
desarrollo, no credenciales reales.

### 2 · Aplicar el sondeo

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/e11/probe.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/e11/layers.sql
```

### 3 · Instalar la dependencia del sondeo

```bash
cd supabase/e11 && npm ci
```

### 4 · Exportar el entorno

Desde `supabase/e11`, con la clave publicable que imprimió `supabase start`:

```bash
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=sb_publishable_...
```

### 5 · Lectura HTTP cruda

```bash
npm run raw
```

### 6 · Medición con supabase-js

```bash
npm run client
```

### 7 · Prueba de capas

```bash
npm run layers
```

### 8 · Fronteras alternativas

Ejecutar **solo si** la frontera directa incumple T7, que es lo que ocurrió.

```bash
npm run alternatives
```

### 9 · Generación de tipos

Desde la raíz del repositorio. **No** dirigir la salida a `src/types/` ni a
ningún `.ts` dentro de `supabase/`: `tsconfig.json` incluye `**/*.ts` y lo
typecheckearía.

```bash
npx supabase gen types typescript --local
```

### 10 · Verdad de referencia

Valor realmente almacenado en PostgreSQL, sin pasar por la frontera:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres < supabase/e11/readback.sql
```

### 11 · Teardown

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres < supabase/e11/teardown.sql
```

Termina imprimiendo los objetos `e11*` que quedan. **Debe devolver cero filas.**

## Versiones de la ejecución registrada

Las que sostienen el resultado de §10 de ADR-003.

| Componente               | Versión               |
| ------------------------ | --------------------- |
| Supabase CLI             | 2.115.0               |
| PostgreSQL               | 17.6                  |
| PostgREST                | v16.1                 |
| Kong                     | 2.8.1                 |
| GoTrue                   | v2.195.0              |
| `@supabase/supabase-js`  | 2.112.3               |
| `@supabase/postgrest-js` | 2.112.3               |
| Node                     | 22.23.2               |
| Docker                   | 29.7.2, backend WSL 2 |

Todas las lecturas se hicieron con la **clave publicable local**, es decir con
el rol `anon`. Los `GRANT` del sondeo se dieron a `anon` y `authenticated` por
igual; la serialización no depende del rol.

## Configuración

**No se modificó `config.toml`.** El experimento mide la frontera **por defecto**
que deja `supabase init`, que es lo que ADR-003 necesitaba saber. Los `GRANT` del
sondeo son explícitos únicamente para controlar el experimento; **no expresan
ninguna estrategia de privilegios para Nomey**.

## Salidas

**No se versionan.** El procedimiento de arriba las regenera enteras, y una
salida guardada envejece sin avisar mientras el procedimiento no.
