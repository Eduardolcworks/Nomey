# Reconciliar el historial de migraciones de la base local

Diagnóstico, procedimiento y ejecución (2026-09-13; ver «Estado» al final). La base local de desarrollo (`supabase_db_Nomey`, la que usan
el iPhone y el Android por `192.168.8.105:54321`) tiene **18** migraciones
registradas en `supabase_migrations.schema_migrations` y **41** ficheros en
`supabase/migrations/`; las **23** de la Fase 9 (de `20260906120000` a
`20260913130000`) se aplicaron por `psql` a lo largo de la fase, sin registro.

## Lo que se ha comprobado

1. **Historial.** `schema_migrations` termina en `20260901120000`. Las 23
   siguientes no están. Ningún fichero registrado falta del repositorio.
2. **Esquema real frente a los ficheros.** Para cada migración se extrajeron
   los objetos que crea (tablas, vistas, funciones, columnas) y se comprobó su
   existencia en la base viva: **todo existe**, salvo dos tablas y dos vistas
   (`core.group_edit_notice`, `core.group_profile_notice` y sus vistas `api`)
   que `20260911120000` **borra a propósito** al unificarlas en
   `core.group_notice`, y que tampoco existen en un arranque desde cero.
3. **Huella completa.** Se arrancó un stack aislado desde cero con las 41
   migraciones (`NomeyIso`) y se comparó con la base viva la huella de `api`,
   `sec` y `core`: cuerpos de todas las funciones (con propietario y
   `security definer`), definición de todas las vistas, columnas y tipos de
   todas las tablas, policies, grants y constraints. **Diferencia: ninguna
   funcional.** Sólo el espacio en blanco del cuerpo de dos funciones
   (`sec.is_me`, `sec.my_claim_command_id`), aplicadas en su día con otro
   formato; el texto SQL es el mismo.

Cómo reproducirlo (solo lectura):

```bash
node scripts/migration-audit.mjs   # objetos por migracion contra la base viva
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < scripts/schema-fingerprint.sql > fp-local.txt
```

Y contra un stack aislado desde cero (`supabase_db_NomeyIso`, con las 41
migraciones aplicadas por `db reset`), el mismo fichero; `diff` entre las dos
salidas. Los dos scripts sólo leen.

## Incertidumbres que quedan

- El registro no guarda qué **contenido** se aplicó: la equivalencia se
  demuestra por la huella del esquema, no por el historial. Si en el futuro
  se edita un fichero ya aplicado, la huella es la única forma de detectarlo.
- `supabase migration repair` inserta la versión (y el nombre) sin las
  sentencias; es lo que hace también con un proyecto remoto y basta para que
  `migration up` / `migration list` sean coherentes.
- Los datos de prueba («Prueba», «Prueba 2», las dos cuentas) viven en esa
  base: cualquier procedimiento que pase por `db reset` los destruye.

## Procedimiento propuesto (cuando se decida)

**Opción A — registrar lo aplicado (recomendada, sin tocar datos ni esquema):**

1. Repetir la huella (paso 3) y confirmar que sigue sin diferencias
   funcionales. Si las hubiera, **parar**: primero se corrige el esquema o el
   fichero, nunca el registro.
2. Registrar las 23 versiones como aplicadas, en la base local:

   ```bash
   ./scripts/supabase-cli.sh migration repair --local --status applied \
     20260906120000 20260908120000 20260908130000 20260908140000 20260908150000 \
     20260908160000 20260908170000 20260909120000 20260910120000 20260910130000 \
     20260910140000 20260910150000 20260911120000 20260911150000 20260912100000 \
     20260912120000 20260912130000 20260912140000 20260912150000 20260912160000 \
     20260912170000 20260913120000 20260913130000
   ```

3. Comprobar: `./scripts/supabase-cli.sh migration list --local` debe listar
   las 41 como aplicadas, y `migration up --local` no debe tener nada que
   aplicar.
4. A partir de ahí, **cada migración nueva se aplica con
   `migration up --local`** (o `db reset` en el stack aislado), nunca por
   `psql`: es lo que evita que el desfase vuelva.

**Opción B — base nueva desde cero** (`db reset --no-seed`): registro y
esquema coinciden por construcción, pero se pierden los datos de prueba y hay
que volver a crear cuentas y grupos. Sólo si se acepta perderlos.

**No se recomienda** insertar filas a mano en `schema_migrations` ni volver a
ejecutar los ficheros sobre la base viva: casi todos crean objetos sin
`if not exists` y fallarían a medias.

## Estado

**Reconciliado el 2026-09-13 (Opción A).** Antes: huella funcional repetida
contra un arranque desde cero con las 41 (misma diferencia de espacio en
blanco en `sec.is_me` y `sec.my_claim_command_id`, nada funcional); copia
recuperable del registro (`pg_dump` de `schema_migrations` con 18 filas en el
scratchpad de la sesión, y la tabla
`supabase_migrations.schema_migrations_backup_20260913` en la propia base).
Después: `migration repair --local --status applied` de las 23 versiones →
**41 registradas** (registro = ficheros), `migration list --local` completo,
`migration up --local` → «Local database is up to date»; huella del esquema
idéntica antes y después; datos intactos (2 cuentas, 5 ámbitos, 12
operaciones, 56 efectos, 13 avisos, 9 participantes). La tabla de copia se
puede borrar cuando se quiera.

A partir de aquí, **cada migración nueva se aplica con `migration up --local`**
(o `db reset` en el stack aislado), nunca por `psql`.
