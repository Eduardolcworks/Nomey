# E16 · `SECURITY DEFINER` con owner dedicado, frente a RLS

Evidencia reproducible de una **contradicción aparente** en el análisis de D7.

Ese análisis afirmaba que «dentro de un `SECURITY DEFINER` la RLS de la
persistencia no protege nada». La afirmación se hizo suponiendo un owner
privilegiado. E16 la mide con un **rol dedicado de mínimo privilegio**:
`NOLOGIN`, `NOBYPASSRLS`, no superusuario y **no propietario** de las tablas.

E16 mide. **No decide nada**: D7 y D8 siguen sin aprobar, y el modelo físico es
**D9**.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e16_`
> pertenece al modelo de datos.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor y
el `.mjs` usa el `fetch` nativo de Node 22. Este directorio **no declara
`package.json`**.

**Sin secretos.** Las claves se toman del entorno. El usuario de prueba usa una
contraseña **generada por ejecución** y se borra en el propio script.

## El modelo

| Objeto                   | Qué es                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| `e16_core.item`          | Dos filas, una `visible = true` y otra `false`. RLS activada                      |
| `p_solo_visibles`        | Política permisiva general: `for select using (visible)`                          |
| `e16_writer`             | Rol dedicado: `NOLOGIN`, `NOBYPASSRLS`, no superusuario, no owner                 |
| `e16_api.inspeccionar()` | `SECURITY DEFINER` propiedad del writer, `search_path = ''`, nombres cualificados |

El caller (`authenticated`) **no recibe ningún privilegio sobre `e16_core`**.

## Archivos

| Archivo           | Qué hace                                                              |
| ----------------- | --------------------------------------------------------------------- |
| `10-setup.sql`    | Crea el modelo, el rol y la función. Idempotente                      |
| `20-cases.sql`    | Los casos A, B, C y D, más tres comprobaciones que surgieron al medir |
| `30-http.mjs`     | La misma función por HTTP con un **JWT real**, y borra el usuario     |
| `99-teardown.sql` | Retirada completa. Debe devolver **0** en las seis comprobaciones     |

## Reproducirlo

Requiere Docker y el stack local (`npx supabase start`). Los valores son los que
imprime ese comando: **son locales de desarrollo, no credenciales reales**.

```bash
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE=sb_publishable_... SUPABASE_SECRET=sb_secret_...
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e16/10-setup.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e16/20-cases.sql
```

Para la comprobación por HTTP hay que exponer un envoltorio en `public`, porque
`e16_api` no está en los schemas expuestos:

```bash
docker exec supabase_db_Nomey psql -U postgres -d postgres -X -q -c "create or replace function public.e16_probe() returns jsonb language sql security invoker as \$\$ select e16_api.inspeccionar() \$\$; grant usage on schema e16_api to authenticated; revoke execute on function public.e16_probe() from public; grant execute on function public.e16_probe() to authenticated; notify pgrst, 'reload schema';"
```

```bash
node supabase/e16/30-http.mjs
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e16/99-teardown.sql
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### La matriz principal

En los cuatro casos, dentro de la función: `current_user = e16_writer`,
`session_user = postgres` por `psql` y `authenticator` por HTTP.

| Caso   | Situación del writer                                 | Filas vistas de 2 | ¿Se aplica la RLS? |
| ------ | ---------------------------------------------------- | ----------------- | ------------------ |
| **A**  | **No owner**, `NOBYPASSRLS`                          | **1**             | **Sí**             |
| **B**  | **Owner** de la tabla                                | **2**             | **No**             |
| **C**  | Owner **+ `FORCE ROW LEVEL SECURITY`**               | **1**             | **Sí**             |
| **D1** | No owner + política permisiva `TO e16_writer` amplia | **2**             | Sí, pero ampliada  |
| **D3** | Igual, sin la política general permisiva             | **1**             | Sí, solo la suya   |

> **La afirmación de que «dentro de un `SECURITY DEFINER` la RLS no protege
> nada» es falsa para un owner no propietario y sin `BYPASSRLS`.** Solo se
> cumple cuando el owner de la función es también el owner de la tabla (caso B),
> o cuando tiene `BYPASSRLS`.

### Las políticas permisivas se combinan con OR

El caso **D2** —política `TO e16_writer` acotada a `id = 2`, con la política
general todavía presente— siguió devolviendo **2 filas**. Añadir una política
permisiva **amplía**, nunca restringe: el writer ve `visible` **O** `id = 2`.

Solo al retirar la política general (**D3**) la política del writer quedó como
única, y entonces devolvió **1 fila**, la que ella permite.

**Consecuencia:** para que la RLS sea una restricción real sobre el writer, hay
que diseñarla sabiendo que las permisivas se suman, o recurrir a políticas
`RESTRICTIVE`.

### La RLS sí frena una escritura indebida del writer

Con `p_writer_ins ... with check (visible)`:

| Intento del writer           | Resultado                                              |
| ---------------------------- | ------------------------------------------------------ |
| `INSERT` con `visible=true`  | **Pudo**                                               |
| `INSERT` con `visible=false` | **`42501 new row violates row-level security policy`** |

Es la prueba de que, en el caso A, la RLS **no es decorativa**: detiene una
escritura que el código de la función habría dejado pasar.

### El caller no alcanza la persistencia

`authenticated` intentando leer la tabla directamente:
**`42501 permission denied for schema`**.

### `auth.uid()` no es invocable por el writer

Dentro del `SECURITY DEFINER` del writer, `auth.uid()` falla con
**`permission denied for schema auth`**, y **`postgres` no puede conceder ese
`USAGE`**: `grant usage on schema auth to e16_writer` responde
`WARNING: no privileges were granted for "auth"`, porque el schema `auth`
pertenece a `supabase_auth_admin`.

**Sí funciona** leer el GUC directamente, sin tocar ningún schema:

```sql
current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
```

Medido por HTTP con un JWT real: devolvió exactamente el `id` del usuario.

### Tres consecuencias operativas del owner dedicado

Las tres medidas, y ninguna estaba prevista:

- **Ceder la propiedad de un objeto exige ser miembro del rol destino.**
  `postgres` **no es superusuario** en este stack, así que sin
  `grant e16_writer to postgres` la operación falla con
  `must be able to SET ROLE`.
- **El nuevo owner necesita `CREATE` sobre el schema** para recibir la
  propiedad. Se concede durante el despliegue y se retira después, de modo que
  el writer quede sin DDL en régimen normal.
- **Cambiar el owner de ida y vuelta pierde los `GRANT` explícitos** al rol:
  mientras fue owner no los necesitaba, y al devolver la propiedad no
  reaparecen. Hay que reponerlos.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| PostgREST  | v16.1 (Kong 2.8.1)    |
| GoTrue     | v2.195.0              |
| Node       | 22.23.2               |
| Docker     | 29.7.2, backend WSL 2 |

## Configuración

**No se modificó `config.toml`.** El envoltorio de `30-http.mjs` vive en `public`
porque es el único schema expuesto por defecto. Eso **no expresa ninguna
preferencia de topología**: ADR-005 ya decidió que la persistencia de Nomey no
vive en `public`.

## Salidas

**No se versionan.** El procedimiento las regenera enteras.
