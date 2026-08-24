# E17 · Ciclo operación/versión y reclamación del comando cliente

Evidencia reproducible de los últimos detalles físicos de **D9**, antes de que
sus decisiones pasen a un ADR.

| Sonda     | Pregunta                                                                                      |
| --------- | --------------------------------------------------------------------------------------------- |
| **E17-A** | ¿Deja la FK compuesta diferible un invariante **fuerte al commit** entre operación y versión? |
| **E17-B** | ¿Se puede reclamar el comando cliente **antes** de que exista su resultado?                   |
| **E17-C** | ¿Distingue el catálogo una policy creada sin `TO` de una creada `TO PUBLIC`?                  |

E17 mide. **No decide nada**: D9 sigue sin cerrarse y D10 y D11 no se tocan.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e17_`
> pertenece al modelo de datos.

**Es una maqueta a escala de juguete.** No hay columnas de negocio: no se mide
contabilidad, se miden restricciones.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor y
el `.sh` solo orquesta sesiones concurrentes. **Sin secretos**: no hay claves,
contraseñas ni usuarios de prueba.

## Archivos

| Archivo             | Qué hace                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `10-setup.sql`      | La maqueta: cuatro tablas, FK compuestas diferibles y constraints de lineage |
| `20-cycle.sql`      | E17-A1/A2/A3 y las cinco constraints de lineage, una a una                   |
| `30-command.sql`    | E17-B1 y B2: reclamar antes del resultado, y qué queda si algo falla         |
| `31-command-run.sh` | E17-B3 y B4: dos peticiones simultáneas por la misma clave                   |
| `40-policies.sql`   | E17-C: representación de las policies en el catálogo y herencia de roles     |
| `99-teardown.sql`   | Retirada completa. Debe devolver **0** en las cuatro comprobaciones          |

Todos son idempotentes: hacen `drop` antes de crear.

> **Aviso que cuesta una hora si no se sabe.** El borrado va **dentro de una
> transacción** a propósito. La FK del puntero de vigencia es
> `DEFERRABLE INITIALLY DEFERRED`, así que borrar con sentencias sueltas la
> viola al confirmar cada una por separado.

## Reproducirlo

Requiere Docker y el stack local (`npx supabase start`).

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e17/10-setup.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e17/20-cycle.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e17/30-command.sql
```

```bash
bash supabase/e17/31-command-run.sh
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e17/40-policies.sql
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e17/99-teardown.sql
```

## La forma medida

```
e17_operation                        e17_operation_version
  id                                   id
  current_version_id  NOT NULL ──────► operation_id
                                       version_no
  FK COMPUESTA y DIFERIBLE:            supersedes_version_id
  (id, current_version_id)
     → (operation_id, id)            e17_client_command
                                       (actor, client_operation_id) PK
                                       command_type · contract_version
                                       canonical_intent
                                       (result_operation_id, result_version_id)
                                          → FK compuesta DIFERIBLE
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### E17-A · El ciclo operación ↔ versión

| Caso   | Qué se probó                                                                       | Resultado                            |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------ |
| **A1** | Insertar la operación apuntando a una V1 **que aún no existe**, y crear V1 después | **`COMMIT` correcto**                |
| **A2** | No crear nunca V1                                                                  | **Falla**: `23503` sobre la FK       |
| **A3** | El puntero apunta a una versión **de otra operación**                              | **Falla**: `23503` sobre la misma FK |

> Con **UUID pregenerados** y la FK **compuesta y diferible**,
> `current_version_id` puede declararse **`NOT NULL` desde el primer `INSERT`**,
> y aun así el invariante se valida al commit. Una operación sin versión
> vigente, o apuntando a la versión de otra operación, **no puede existir al
> confirmar**.

Nótese que **la misma restricción** cubre A2 y A3: al ser compuesta, garantiza a
la vez que la versión existe y que pertenece a esta operación.

### Las constraints de lineage

| Intento                                        | Resultado             | Quién lo rechaza                                  |
| ---------------------------------------------- | --------------------- | ------------------------------------------------- |
| `version_no = 0`                               | **Rechazado** `23514` | `CHECK (version_no >= 1)`                         |
| Segundo `version_no = 2` en la misma operación | **Rechazado** `23505` | `UNIQUE (operation_id, version_no)`               |
| Versión 2 **sin** `supersedes_version_id`      | **Rechazado** `23514` | `CHECK ((version_no = 1) = (supersedes IS NULL))` |
| `supersedes_version_id = id` (autorreferencia) | **Rechazado** `23514` | `CHECK (supersedes IS DISTINCT FROM id)`          |
| `supersedes` apuntando a **otra operación**    | **Rechazado** `23503` | FK compuesta `(operation_id, supersedes)`         |
| Versión 2 bien formada                         | **Aceptada**          | —                                                 |

**Un matiz de orden que conviene conocer:** un intento de duplicar
`version_no = 1` lo rechaza antes el `CHECK` de primera versión que el `UNIQUE`,
porque una segunda versión 1 tendría que llevar `supersedes` no nulo. El
`UNIQUE` se observa aisladamente con `version_no = 2`.

### E17-B · Reclamar el comando antes del resultado

| Caso   | Escenario                                                  | Resultado                                                                                                             |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **B1** | Reclamar la clave, luego crear operación, versión y efecto | **OK**: 1 comando, 1 operación, 1 versión                                                                             |
| **B2** | Reclamar la clave y **fallar después** (autorización)      | **0 comandos**: solo se persisten los aceptados                                                                       |
| **B3** | Dos peticiones simultáneas; la primera **confirma**        | La segunda **espera ~2 s**, recibe `unique_violation` y **hace replay** del comando existente. 1 comando, 1 operación |
| **B4** | Dos peticiones simultáneas; la primera **revierte**        | La segunda **reclama la clave** y completa con normalidad. 1 comando, 1 operación                                     |

> **B2 es el que confirma la propiedad buscada**: la fila de comando vive en la
> misma transacción que su resultado, así que un fallo posterior la revierte
> también. No hace falta ninguna limpieza, y **nunca se persisten comandos
> rechazados**.
>
> **B4 confirma que la clave no se «quema»**: un intento fallido no bloquea el
> siguiente.

### E17-C · Policies y catálogo

| Policy creada como | `polroles` en catálogo | Aplicable a                 |
| ------------------ | ---------------------- | --------------------------- |
| sin cláusula `TO`  | **`{0}`**              | **PUBLIC, todos los roles** |
| `TO PUBLIC`        | **`{0}`**              | PUBLIC, todos los roles     |
| `TO e17_writer`    | `{oid}`                | solo ese rol                |
| `TO a, b`          | `{oid, oid}`           | esos dos roles              |

> **Son indistinguibles en el catálogo.** La sintaxis original **no es
> recuperable**: una policy escrita sin `TO` y otra escrita `TO PUBLIC` quedan
> guardadas exactamente igual.
>
> Por tanto un test **no puede** comprobar que alguien «escribió `TO`». Lo que
> sí puede comprobar, y es lo que importa, es la **semántica efectiva**:
>
> ```sql
> select polname from pg_policy where polrelid = ... and 0 = any(polroles);
> ```

**Por qué `0 = ANY(polroles)` y no la igualdad exacta con `{0}`.** El invariante
que interesa es «**`PUBLIC` está entre los roles aplicables**», y `ANY` lo dice
literalmente; la igualdad exacta afirma además algo sobre la **representación**
de la lista, que es un detalle del motor.

Medido: al crear una policy `TO public, authenticated`, PostgreSQL responde
`WARNING: ignoring specified roles other than PUBLIC` y guarda **`{0}`**. Es
decir, **hoy las dos formulaciones coinciden**, porque `PUBLIC` colapsa la lista
y nunca convive con otros oid.

**Aun así se adopta `ANY`**: expresa la propiedad buscada en vez de apoyarse en
ese colapso, y no habría que revisarlo si el motor cambiara de criterio. La
igualdad exacta sería correcta por casualidad, no por construcción.

**Herencia de roles**, medido sobre un rol recién creado con los atributos del
writer: **no es miembro de `authenticated`**, así que **no hereda sus policies**.
El rol sí tiene `rolinherit = true`, de modo que heredaría los privilegios de
cualquier rol del que **sí** se le hiciera miembro — conviene comprobarlo, no
suponerlo.

## Consecuencia operativa reencontrada

La misma que midió E16, ahora en el teardown: **`drop owned by` exige ser
miembro del rol**. Sin `grant e17_writer to postgres` falla con
`permission denied to drop objects`, porque **`postgres` no es superusuario en
este stack**. El teardown lo hace explícitamente.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| Docker     | 29.7.2, backend WSL 2 |

Nivel de aislamiento: el de por defecto, `READ COMMITTED`.

## Salidas

**No se versionan.** El procedimiento las regenera enteras.
