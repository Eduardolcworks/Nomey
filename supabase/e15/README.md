# E15 · Errores y concurrencia de la frontera de escritura

Evidencia reproducible de tres incógnitas del bloque **D7 + D8** que el análisis
había marcado como **no medidas**:

| Sonda     | Pregunta                                                                           |
| --------- | ---------------------------------------------------------------------------------- |
| **E15-A** | ¿Cómo mapea PostgREST v16.1 un error de PostgreSQL a estado HTTP y a cuerpo?       |
| **E15-B** | ¿Qué patrón de idempotencia es correcto bajo concurrencia real?                    |
| **E15-C** | ¿Se puede sobrepagar una deuda con dos liquidaciones simultáneas, y qué lo impide? |

E15 mide. **No decide nada**: D7 y D8 siguen sin aprobar, y el modelo físico de
operaciones y deudas es **D9**, que no se toca aquí.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e15_`
> pertenece al modelo de datos.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor,
el `.mjs` usa el `fetch` nativo de Node 22 y los `.sh` solo orquestan sesiones
`psql` concurrentes. Este directorio **no declara `package.json`**.

**Sin secretos.** La clave publicable se toma del entorno; no hay contraseñas,
tokens ni usuarios de prueba.

## Archivos

| Archivo                 | Qué hace                                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| `10-errors.sql`         | Seis funciones que lanzan errores de formas distintas. Idempotente         |
| `20-errors-http.mjs`    | Las llama por HTTP y registra estado y cuerpo exactos                      |
| `30-idempotency.sql`    | Tabla con `UNIQUE (created_by, client_operation_id)`                       |
| `31-idempotency-run.sh` | Dos transacciones simultáneas con la misma clave, en dos patrones          |
| `40-settlement.sql`     | Deuda de 3000 y una función de liquidación con tres modos de serialización |
| `41-settlement-run.sh`  | Dos liquidaciones simultáneas de 2000, en los tres modos                   |
| `99-teardown.sql`       | Retirada completa. Debe devolver **0** en las cuatro comprobaciones        |

Los `.sql` de creación y el teardown son idempotentes: hacen `drop` antes de
crear. Los que crean funciones hacen `notify pgrst, 'reload schema'`, porque
PostgREST cachea el esquema.

## Reproducirlo

Requiere Docker y el stack local levantado (`npx supabase start`). El valor es el
que imprime ese comando: **es local de desarrollo, no una credencial real**.

```bash
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE=sb_publishable_...
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e15/10-errors.sql
```

```bash
node supabase/e15/20-errors-http.mjs
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e15/30-idempotency.sql
```

```bash
bash supabase/e15/31-idempotency-run.sh
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e15/40-settlement.sql
```

```bash
bash supabase/e15/41-settlement-run.sh
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e15/99-teardown.sql
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### E15-A · Mapeo de errores

| Forma del error                         | HTTP    | `code` del cuerpo    | `message` del cuerpo                            |
| --------------------------------------- | ------- | -------------------- | ----------------------------------------------- |
| `RAISE EXCEPTION` sin `errcode`         | **400** | `P0001`              | el texto que se pasó                            |
| `errcode = 'P0001'` con `detail`/`hint` | **400** | `P0001`              | el texto; `detail` y `hint` se conservan aparte |
| `errcode = '42501'`                     | **401** | `42501`              | el texto                                        |
| `errcode = '23505'`                     | **409** | `23505`              | el texto                                        |
| `errcode = '23514'`                     | **400** | `23514`              | el texto                                        |
| `RAISE sqlstate 'PGRST'`                | **409** | **el código propio** | libre para humanos                              |

Dos observaciones:

- Con las formas basadas en `SQLSTATE`, el campo `code` lleva el **SQLSTATE** y
  el código estable tendría que viajar en `message`, que es el campo humano.
- Con el bloque **`PGRST`**, el estado HTTP y el cuerpo se fijan explícitamente:
  el `code` del cuerpo lleva **el código propio** y `message` queda libre. Es la
  única forma medida que **no obliga a leer el mensaje humano** para obtener el
  código.

El `42501` se midió **con clave publicable, es decir sin sesión**, y devolvió
`401`. E13 midió que el mismo tipo de denegación **con un JWT devuelve `403`**;
esa diferencia es de sesión, no de la forma del error.

### E15-B · Concurrencia de la clave de idempotencia

Sesión A abre transacción, inserta y retiene 3 s. Sesión B entra 1 s después con
la **misma** `(created_by, client_operation_id)`.

| Patrón                                   | ¿Espera?                          | Filas finales | ¿Recupera el original? |
| ---------------------------------------- | --------------------------------- | ------------- | ---------------------- |
| `INSERT ... ON CONFLICT DO NOTHING`      | **Sí**, ~2 s hasta el commit de A | **1**         | **Sí**                 |
| `INSERT` + captura de `unique_violation` | **Sí**, ~2 s                      | **1**         | **Sí**                 |

> **Los dos patrones son correctos.** Ambos crean exactamente una fila, ambos
> hacen esperar al competidor hasta que la primera transacción confirma, ambos
> permiten leer la fila original después, y ninguno depende de un `SELECT`
> previo.

La lectura del original funciona dentro de la misma transacción porque el nivel
de aislamiento por defecto es `READ COMMITTED` y cada sentencia toma una
instantánea nueva. **Con un aislamiento más estricto habría que volver a
medirlo.**

### E15-C · Concurrencia de la liquidación

Deuda pendiente de 3000. Dos liquidaciones simultáneas de 2000.

| Modo                                               | Resultado                                       | Pendiente final       |
| -------------------------------------------------- | ----------------------------------------------- | --------------------- |
| **Sin bloqueo**                                    | **Las dos ACEPTADAS**, ambas viendo 3000        | **−1000 · SOBREPAGO** |
| `SELECT ... FOR UPDATE` sobre la fila del ámbito   | Una aceptada, otra rechazada con pendiente=1000 | **1000 · correcto**   |
| `pg_advisory_xact_lock` por clave del par de deuda | Una aceptada, otra rechazada                    | **1000 · correcto**   |

> **La carrera es real y está demostrada**, no es teórica: sin serializar, las
> dos comprobaciones ven la misma deuda y las dos pasan.

Ambos mecanismos la corrigen. Se diferencian en **granularidad**: la fila del
ámbito serializa **todo** lo que toque ese ámbito; el advisory por par serializa
**solo** esa relación de deuda. Cuál conviene depende de qué filas existan
realmente, que es **D9**.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| PostgREST  | v16.1 (Kong 2.8.1)    |
| Node       | 22.23.2               |
| Docker     | 29.7.2, backend WSL 2 |

Nivel de aislamiento: el de por defecto, `READ COMMITTED`.

## Configuración

**No se modificó `config.toml`.** Los objetos viven en `public` porque es el
único schema expuesto por defecto y E15-A necesita atravesar PostgREST de
verdad. Eso **no expresa ninguna preferencia de topología**: ADR-005 ya decidió
que la persistencia de Nomey no vive en `public`.

## Salidas

**No se versionan.** El procedimiento las regenera enteras. Una salida guardada
envejece sin avisar; el procedimiento, no.
