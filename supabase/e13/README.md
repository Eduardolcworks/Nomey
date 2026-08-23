# E13 · Cómo lee `api` desde `core`

Evidencia reproducible del nudo que
[ADR-005](../../docs/adr/ADR-005-schema-topology.md) §4 dejó abierto: **qué
privilegios necesita un rol cliente para leer a través de la superficie
expuesta, y si tenerlos abre alguna ruta directa hacia la persistencia.**

E13 mide. **No decide nada**: la topología es normativa en ADR-005, y la
estrategia de `GRANT` y de membresía son D3 y D5, todavía sin aprobar.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e13_`
> pertenece al modelo de datos.

**La columna de datos es texto a propósito.** E13 no toca la frontera textual de
[ADR-003](../../docs/adr/ADR-003-money-representation.md) §6, que es **D6** y
sigue abierta. Aquí solo se miden ejecución, RLS y privilegios.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor y
los `.mjs` usan el `fetch` nativo de Node 22. Este directorio **no declara
`package.json`**: el de la raíz no cambia y el bundle de la app tampoco.

## El modelo mínimo

Una topología de juguete que imita la de ADR-005:

| Schema     | Contiene                                                       |
| ---------- | -------------------------------------------------------------- |
| `e13_core` | `item` y `membership`, con RLS activada. No expuesto           |
| `e13_api`  | Dos vistas sobre `item`: una **invoker** y una **propietario** |
| `e13_sec`  | `is_member(scope)`, `SECURITY DEFINER` con `search_path = ''`  |

Dos usuarios reales de GoTrue con JWT reales: **A** pertenece a un ámbito, **B**
no pertenece a ninguno.

## Archivos

| Archivo                   | Qué hace                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `00-users.mjs`            | Da de alta los usuarios A y B y obtiene sus JWT                                                 |
| `10-setup.sql`            | Crea la topología de juguete, las políticas y las dos vistas. Idempotente                       |
| `20-privileges.sql`       | Privilegios mínimos de una vista `security_invoker`: **suficiencia y minimalidad** por separado |
| `30-owner-vs-invoker.sql` | La misma consulta por la vista invoker y por la vista del propietario                           |
| `40-helper.sql`           | `is_member` con y sin `USAGE` sobre el schema del helper                                        |
| `50-http.mjs`             | PostgREST y GraphQL desde fuera, con JWT reales                                                 |
| `60-graphql.sql`          | Superficie GraphQL: habilita `pg_graphql`, mide y **la retira**                                 |
| `98-users-teardown.mjs`   | Borra los usuarios de prueba                                                                    |
| `99-teardown.sql`         | Retirada completa. Debe devolver **0** en las seis comprobaciones                               |

`10-setup.sql` y `99-teardown.sql` son idempotentes: hacen `drop` antes de
crear.

## Reproducirlo

Requiere Docker y el stack local levantado (`npx supabase start`). Los valores
son los que imprime ese comando: **son locales de desarrollo, no credenciales
reales**.

```bash
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE=sb_publishable_... SUPABASE_SECRET=sb_secret_...
```

```bash
node supabase/e13/00-users.mjs
```

Exporta los `TOKEN_A` y `TOKEN_B` que imprime, y sigue:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e13/10-setup.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e13/20-privileges.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e13/30-owner-vs-invoker.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e13/40-helper.sql
```

```bash
node supabase/e13/50-http.mjs
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e13/60-graphql.sql
```

Teardown, **obligatorio**:

```bash
node supabase/e13/98-users-teardown.mjs
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e13/99-teardown.sql
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### Privilegios de una vista `security_invoker`

| Privilegio                              | ¿Necesario?                    | Sin él                                         |
| --------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `USAGE` sobre el schema de la vista     | Sí                             | `42501 permission denied for schema`           |
| `SELECT` sobre la vista                 | Sí                             | —                                              |
| `SELECT` sobre la **tabla subyacente**  | Sí                             | `42501 permission denied for table item`       |
| `SELECT` sobre `membership`             | Sí **con la política de join** | `42501 permission denied for table membership` |
| `USAGE` sobre el schema de persistencia | **No**                         | Funciona igualmente                            |

La minimalidad se comprueba **revocando cada pieza por separado**, no solo
concediéndolas en orden: conceder en orden solo demuestra suficiencia.

### La RLS se evalúa como quien consulta

`auth.uid()` dentro de la consulta devuelve el `sub` del JWT. Usuario A: **1**
fila. Usuario B: **0**. Sin sesión: **0**. La tabla contiene **2**. La vista
`security_invoker` **no salta la RLS**.

### La vista ejecutada como propietario

Con el rol cliente sin **ningún** privilegio sobre la persistencia:

| Quién consulta         | Filas devueltas |
| ---------------------- | --------------- |
| Usuario A (miembro)    | **2**           |
| Usuario B (no miembro) | **2**           |
| Sin sesión             | **2**           |

La RLS **no se aplica**. Un olvido de autorización por esta vía devuelve filas
de más con `200 OK`; por la vía invoker devuelve `42501`.

### El helper `is_member`

| Caso                                | Política que lo usa | Llamada directa del usuario                   |
| ----------------------------------- | ------------------- | --------------------------------------------- |
| **A** · solo `EXECUTE`, sin `USAGE` | **Funciona**        | **Denegada** — `permission denied for schema` |
| **B** · `USAGE` + `EXECUTE`         | Funciona            | Permitida                                     |

Y con el helper en la política, el rol cliente **deja de necesitar `SELECT`
sobre `membership`** — verificado con ese privilegio en `false`.

### PostgREST

Con `USAGE` sobre el schema de persistencia **y** `SELECT` sobre sus tablas:

| Intento                              | Respuesta          |
| ------------------------------------ | ------------------ |
| Tabla de `core` con `Accept-Profile` | **`406 PGRST106`** |
| Tabla de `core` sin `Accept-Profile` | **`404 PGRST205`** |
| Tabla de `core` con clave publicable | **`406 PGRST106`** |

**Tener el privilegio SQL y tener una ruta HTTP que lo ejerza son cosas
distintas.**

### GraphQL

- En este stack, `pg_graphql` está **disponible pero no instalada**, y
  `graphql_public.graphql` es un stub que responde
  `pg_graphql extension is not enabled.` a cualquier consulta.
- Con la extensión habilitada, el wrapper es **`SECURITY INVOKER` y no fija
  `search_path`**: refleja lo que haya en el search_path de la petición, que
  PostgREST toma de `api.extra_search_path` de `config.toml`.
- Con `search_path = public, extensions` —el de hoy—, la tabla de `core` **no se
  refleja**: `Unknown field "itemCollection" on type Query`.
- Con un `search_path` que **incluyera** el schema de persistencia, la tabla
  **sí se refleja y devuelve datos** — y la **RLS sigue filtrando**: A ve su
  fila, B ve `[]`.
- Una tabla sobre la que el rol no tiene `SELECT` **no llega a reflejarse**.

### La condición, enunciada de una vez

Reuniendo lo medido en las dos superficies:

> **Los `GRANT` SQL sobre las tablas de la persistencia no crean una ruta
> cliente, mientras ese schema permanezca fuera de _ambas_ cosas: los schemas
> expuestos por PostgREST y los search paths de las superficies API.**

**La condición es doble y ninguna mitad sustituye a la otra.** PostgREST se
corta por `api.schemas`; GraphQL, por `api.extra_search_path`. Son dos
parámetros distintos del mismo fichero, y E13 midió que basta con abrir el
segundo para que los objetos se reflejen aunque el primero siga cerrado.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| PostgREST  | v16.1 (Kong 2.8.1)    |
| GoTrue     | v2.195.0              |
| pg_graphql | 1.6.1 (no instalada)  |
| Node       | 22.23.2               |
| Docker     | 29.7.2, backend WSL 2 |

## Configuración

**No se modificó `config.toml`.** El sondeo mide la configuración por defecto,
incluida `extra_search_path = ["public", "extensions"]`. `60-graphql.sql`
habilita `pg_graphql` y **la retira en el mismo script**; es la única parte de
E13 que altera la instalación.

## Salidas

**No se versionan.** El procedimiento las regenera enteras. Una salida guardada
envejece sin avisar; el procedimiento, no.
