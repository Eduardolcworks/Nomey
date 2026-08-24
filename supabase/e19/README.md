# E19 · La proyección canónica de efectos vigentes

Evidencia reproducible de los dos huecos de **D11** que dependen de
comportamiento medible de PostgreSQL, y **solo de esos dos**. E19 **no mide
rendimiento**: no habría cambiado ninguna decisión, y medirlo habría sido
ceremonia.

| Sonda     | Pregunta                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| **E19-A** | Con **dos** vistas `security_invoker` encadenadas, ¿sigue aplicándose la RLS de las tablas base? |
| **E19-B** | ¿Permite el catálogo distinguir quién referencia la tabla base de quién pasa por la proyección?  |

E19 mide. **No decide nada**: D11 sigue sin cerrarse y no hay ADR.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e19_`
> pertenece al modelo de datos.

**Por qué no basta con E13.** [E13](../e13/README.md) midió **un** nivel:
`api` → tabla de `core`. La forma que analiza D11 tiene **dos**, porque la
proyección canónica de efectos vigentes se interpone. Que la RLS sobreviva a un
nivel no demuestra que sobreviva a dos: es una pregunta distinta.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor y
los `.mjs` usan el `fetch` nativo de Node 22. **Sin secretos**: la contraseña de
los dos usuarios de prueba se genera en cada ejecución, no se escribe en ningún
sitio y los usuarios se borran en el teardown.

## El modelo mínimo

Una maqueta de juguete de la forma que D11 propone:

```
e19_api.effect_v            vista security_invoker      <- superficie cliente
      |
e19_core.current_effect     vista security_invoker      <- proyeccion canonica
      |                       (el filtro de vigencia vive AQUI y solo aqui)
e19_core.effect  ->  operation_version  ->  operation   <- tablas con RLS
```

Datos: la operación de **A** tiene V1 = 60,00 **histórica** y V2 = 75,00
**vigente**; la de **B**, una sola versión de 40,00. **A** y **B** son miembros
de ámbitos distintos. Así, una consulta correcta devuelve **una** fila y las dos
formas de equivocarse producen cifras distintas y reconocibles.

Las columnas monetarias son `BIGINT` solo para parecerse al modelo real: E19
**no toca** la frontera textual de [ADR-008](../../docs/adr/ADR-008-exact-data-boundary.md),
que cerró E14.

## Archivos

| Archivo                 | Qué hace                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `00-users.mjs`          | Da de alta A y B en GoTrue y obtiene sus JWT reales                     |
| `10-setup.sql`          | La topología, las políticas y las cuatro vistas. Idempotente            |
| `20-chain.sql`          | E19-A: suficiencia y minimalidad de privilegios, aislamiento y vigencia |
| `30-http.mjs`           | E19-A: ¿abren esos privilegios alguna ruta HTTP hacia `core`?           |
| `40-depend.sql`         | E19-B: qué registra `pg_depend` de vistas y de funciones                |
| `50-ownership.sql`      | E19-A: matriz externo × interno, con el caso de E13 como control        |
| `98-users-teardown.mjs` | Borra los usuarios de prueba                                            |
| `99-teardown.sql`       | Retirada completa. Debe devolver **0** en las cinco comprobaciones      |

`10-setup.sql` y `99-teardown.sql` son idempotentes: hacen `drop` antes de crear.

> **`50-ownership.sql` va el último a propósito.** Crea vistas adicionales que
> aparecerían como ruido en la sonda de catálogo, así que `40-depend.sql` debe
> ejecutarse antes.

## Reproducirlo

Requiere Docker y el stack local levantado (`npx supabase start`). Los valores
son los que imprime ese comando: **son locales de desarrollo, no credenciales
reales**.

```bash
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE=sb_publishable_... SUPABASE_SECRET=sb_secret_...
```

```bash
node supabase/e19/00-users.mjs
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e19/10-setup.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e19/20-chain.sql
```

```bash
node supabase/e19/30-http.mjs
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e19/40-depend.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e19/50-ownership.sql
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e19/99-teardown.sql
```

```bash
node supabase/e19/98-users-teardown.mjs
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### E19-A · La cadena de dos niveles

**Privilegios · suficiencia**, concedidos de uno en uno hasta que la consulta
funciona:

| Paso | Concedido                            | Resultado                                      |
| ---- | ------------------------------------ | ---------------------------------------------- |
| 1    | nada                                 | `42501` permission denied for schema `e19_api` |
| 2    | `USAGE api` + `SELECT` vista externa | `42501` … for view `current_effect`            |
| 3    | + `USAGE core`                       | `42501` … for view `current_effect`            |
| 4    | + `SELECT` vista interna             | `42501` … for table `effect`                   |
| 5    | + `SELECT effect`                    | `42501` … for table `operation_version`        |
| 6    | + `SELECT operation_version`         | `42501` … for table `operation`                |
| 7    | + `SELECT operation`                 | `42501` … for table `membership`               |
| 8    | + `SELECT membership`                | **OK, 1 fila: 7500**                           |

**Privilegios · minimalidad**, revocando cada pieza por separado sobre el
conjunto completo:

| Revocado                 | Resultado                               |
| ------------------------ | --------------------------------------- |
| `USAGE` sobre `e19_core` | **Sigue funcionando** — no es necesario |
| `SELECT` vista interna   | `42501` for view `current_effect`       |
| `SELECT effect`          | `42501` for table `effect`              |
| `SELECT operation`       | `42501` for table `operation`           |
| `SELECT membership`      | `42501` for table `membership`          |

> **Dos hechos que conviene no fundir.** El invocante necesita `SELECT` sobre
> **cada relación que la cadena atraviesa** —las dos vistas y las tres tablas—
> más `SELECT` sobre `membership`, porque las políticas hacen join contra ella.
> En cambio **`USAGE` sobre el schema de la persistencia no hizo falta**: una
> vez concedido y vuelto a revocar, la consulta siguió funcionando. Medido, no
> deducido; y medido para **esta** forma, no en general.

**Aislamiento y vigencia**, con el conjunto completo de privilegios:

| Consulta                                    | Filas | Importes      |
| ------------------------------------------- | ----- | ------------- |
| A por la vista externa                      | 1     | `7500`        |
| B por la vista externa                      | 1     | `4000`        |
| Sin sesión                                  | 0     | —             |
| A por la vista interna                      | 1     | `7500`        |
| A por la **tabla base**                     | 2     | `6000 · 7500` |
| A por una vista que **evita** la proyección | 2     | `6000 · 7500` |

> **La RLS sobrevive a los dos niveles** y **el filtro de vigencia vive en la
> vista interna**: A tiene privilegio sobre la tabla base y ve allí sus dos
> efectos —el histórico y el vigente—, mientras que por la proyección canónica
> ve solo el vigente. Las dos cifras son plausibles y **solo una es correcta**.

**Matriz de propiedad**, con la forma que midió E13 como control:

| Externo                                                 | Interno         | A ve                         | Sin sesión            |
| ------------------------------------------------------- | --------------- | ---------------------------- | --------------------- |
| `invoker`                                               | `invoker`       | 1 · `7500`                   | **0**                 |
| **propietario**                                         | `invoker`       | 1 · `7500`                   | **0**                 |
| `invoker`                                               | **propietario** | 2 · `4000 · 7500`            | **2 · `4000 · 7500`** |
| **propietario**                                         | **propietario** | 2 · `4000 · 7500`            | **2 · `4000 · 7500`** |
| _control:_ vista `invoker` directa sobre la tabla       | —               | 2 · `6000 · 7500`            | —                     |
| _control:_ vista **propietario** directa sobre la tabla | —               | **3 · `4000 · 6000 · 7500`** | —                     |

> **Lo que decide es el eslabón más cercano a las tablas.** Con la vista interna
> declarada `security_invoker`, una vista externa ejecutada como propietario
> **no** reintrodujo el bypass. Con la vista interna ejecutada como propietario,
> una vista externa `security_invoker` **no** lo rescató: se filtraron las filas
> del otro ámbito **incluso sin sesión alguna**.
>
> El control confirma que este montaje **sí es capaz de filtrar** —una vista
> propietario directa sobre la tabla devolvió las tres filas—, así que los ceros
> de arriba no son un artefacto.

**Superficie HTTP.** Con `authenticated` **poseyendo** `SELECT` sobre las dos
vistas y las cuatro tablas:

| Petición                                                                  | Estado           |
| ------------------------------------------------------------------------- | ---------------- |
| `e19_api.effect_v` con `Accept-Profile` y JWT                             | `406` `PGRST106` |
| `e19_api.effect_v` sin `Accept-Profile`                                   | `404` `PGRST205` |
| `e19_core.{effect,current_effect,operation,operation_version,membership}` | `406` `PGRST106` |
| `e19_core.effect` con la clave publicable                                 | `406` `PGRST106` |

> Ninguno de los dos schemas está en `config.toml`, y **PostgREST responde
> `Invalid schema` antes de mirar privilegio alguno**. Añadir un nivel a la
> cadena **no cambió** la conclusión de E13: poseer el privilegio y existir una
> ruta HTTP capaz de ejercerlo siguen siendo dos afirmaciones distintas.

### E19-B · Verificabilidad por catálogo

**Las dependencias que registra `pg_depend` son directas, no transitivas:**

| Vista             | Referencia registrada                      | Tipo  |
| ----------------- | ------------------------------------------ | ----- |
| `current_effect`  | `effect`, `operation`, `operation_version` | tabla |
| `effect_v`        | `current_effect`                           | vista |
| `effect_owner_v`  | `current_effect`                           | vista |
| `effect_bypass_v` | `effect`                                   | tabla |

> **`effect_v` no aparece colgando de `effect`.** Es lo que hace viable la
> guarda: una vista que pasa por la proyección canónica y otra que se la salta
> **se distinguen en el catálogo**.

**La guarda candidata** —«la única relación que puede depender directamente de
la tabla de efectos es la proyección canónica»— listó **exactamente**
`e19_api.effect_bypass_v`, y nada más.

**Ruido que la regla debe excluir**, medido sobre la misma tabla: `pg_type`,
`pg_attrdef`, dos `pg_constraint` y una `pg_policy`. Filtrar por
`classid = 'pg_rewrite'` **y** `relkind = 'v'` los descarta todos, y exceptuar
la propia proyección canónica evita el único falso positivo restante.

**Funciones · aquí está el límite.** Dos funciones sobre los mismos datos
devolvieron **13500** y **7500**: la primera suma historia y vigente sin fallar,
que es exactamente el modo de fallo que la guarda existe para impedir.

| Forma del cuerpo                      | ¿La registra `pg_depend`? |
| ------------------------------------- | ------------------------- |
| `language sql` … `as $$ … $$`         | **No**                    |
| `language plpgsql` … `as $$ … $$`     | **No**                    |
| `language sql` … `BEGIN ATOMIC … END` | **Sí**                    |

> **Medido:** un cuerpo `BEGIN ATOMIC` se analiza al crear la función, y sus
> referencias **quedan en `pg_depend`** —`prosqlbody` no es nulo—. Las dos
> formas entre `$$` son cadenas opacas para el catálogo y **no dejan ninguna
> dependencia**.

Lo único que el catálogo ofrece para esas dos formas es el texto de `prosrc`, y
tiene una trampa medida: **`current_effect` contiene la subcadena `effect`**, de
modo que una regla ingenua por subcadena marcaría como infractora precisamente a
la función correcta.

### Una trampa operativa, de propina

`ALTER TABLE` sobre una tabla con **eventos de trigger diferidos pendientes**
falla con `cannot ALTER TABLE because it has pending trigger events`. Con el
puntero de vigencia declarado `DEFERRABLE`, eso significa que **todo el DDL debe
completarse antes de insertar datos**; por eso este sondeo usa dos
transacciones. Es de la misma familia que la trampa de borrado que ya recogía
[ADR-011](../../docs/adr/ADR-011-operation-version-model.md).

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| PostgREST  | v16.1 (Kong 2.8.1)    |
| Node       | 22.23.2               |
| Docker     | 29.7.2, backend WSL 2 |

Nivel de aislamiento: el de por defecto, `READ COMMITTED`.

## Configuración

**No se modificó `config.toml`.** Ni `e19_core` ni `e19_api` están expuestos, y
esa es justamente la condición bajo la que se mide la superficie HTTP.

## Salidas

**No se versionan.** El procedimiento las regenera enteras. Una salida guardada
envejece sin avisar; el procedimiento, no.
