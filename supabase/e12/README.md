# E12 · Sondeo de privilegios heredados

Evidencia reproducible de la medición **D4** de la Fase 3.C: de dónde salen los
privilegios `REFERENCES`, `TRIGGER` y `TRUNCATE` que `anon` y `authenticated`
muestran sobre tablas nuevas de `public` a las que nadie concedió nada, cuáles
son **efectivos**, cuáles son **ejecutables** y por qué caminos son
**alcanzables**.

E11 registró la observación sin sacar conclusión. E12 la explica.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e12_`
> pertenece al modelo de datos.

El resultado se lee en
[`docs/architecture/phase-3c-design.md`](../../docs/architecture/phase-3c-design.md)
§D4, que es **no normativo**: D4 aporta hechos medidos, no decide la estrategia
de `GRANT`.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor
de la base de datos y el script HTTP usa el `fetch` nativo de Node 22. A
diferencia de `supabase/e11/`, este directorio **no declara `package.json`** y
no instala nada: el `package.json` raíz no cambia y el bundle de la app tampoco.

## Archivos

| Archivo                      | Qué hace                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `00-baseline.sql`            | Configuración **preexistente**: `pg_default_acl`, ACL de schemas, atributos y pertenencia de roles, event triggers      |
| `10-objects.sql`             | Crea los objetos desechables `e12_` en `public`, en un schema no expuesto y en un banco de pruebas. Idempotente         |
| `20-listed-vs-effective.sql` | `information_schema` frente a `relacl` + `aclexplode` frente a `has_*_privilege`                                        |
| `30-executable.sql`          | Intenta **de verdad** cada operación con `set local role` y registra el mensaje de error exacto cuando falla            |
| `45-grants.sql`              | Control positivo: aplica el `GRANT SELECT` que faltaba, para distinguir «sin privilegio» de «la RLS filtró en silencio» |
| `40-data-api.mjs`            | El mismo rol por PostgREST, con clave publicable, clave secreta y un **JWT real** de un usuario creado y borrado        |
| `99-teardown.sql`            | Retirada completa. Termina con la comprobación, que debe dar **0 en todas las filas**                                   |

Los `.sql` de creación son idempotentes: hacen `drop` antes de crear.

## Reproducirlo

Requiere Docker operativo y el stack local levantado (`npx supabase start`).

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e12/00-baseline.sql
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/e12/10-objects.sql
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e12/20-listed-vs-effective.sql
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e12/30-executable.sql
```

Data API, con los valores que imprimió `npx supabase start` —**valores locales
de desarrollo, no credenciales reales**:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_PUBLISHABLE=sb_publishable_... \
SUPABASE_SECRET=sb_secret_... \
node supabase/e12/40-data-api.mjs
```

Control positivo y segunda pasada:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e12/45-grants.sql
E12_FASE2=1 SUPABASE_URL=... SUPABASE_PUBLISHABLE=... SUPABASE_SECRET=... node supabase/e12/40-data-api.mjs
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e12/99-teardown.sql
```

Debe imprimir `0` en las siete filas de comprobación y dejar `pg_default_acl`
exactamente como estaba.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| PostgREST  | v16.1 (Kong 2.8.1)    |
| GoTrue     | v2.195.0              |
| Node       | 22.23.2               |
| Docker     | 29.7.2, backend WSL 2 |

## Configuración

**No se modificó `config.toml`.** El sondeo mide la configuración por defecto
que deja la plantilla del CLI, que es lo que D4 necesitaba saber. Los `GRANT`
del banco de pruebas `e12_playground` existen solo para poder **intentar** las
operaciones como `anon`; no expresan ninguna estrategia de privilegios.

## Salidas

**No se versionan.** El procedimiento las regenera enteras. Una salida guardada
envejece sin avisar; el procedimiento, no.
