-- Comprobaciones del ambito, el participante, la membresia y el efecto, contra
-- la base REAL construida por las migraciones.
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/scope-effect.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno,
-- para que un unico error no oculte los demas. Todo ocurre dentro de una
-- transaccion que termina en ROLLBACK: no deja datos, ni vistas, ni policies
-- modificadas.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ===================================== A · forma, privilegios y catalogo ====
do $estructura$
declare
  fallos text[] := '{}';
  v_n int;
  v_b boolean;
begin
  -- A1 · las cuatro relaciones nuevas existen.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and c.relkind = 'r'
    and c.relname in ('scope','participant','membership','effect');
  if v_n <> 4 then
    fallos := array_append(fallos, format('A1: se esperaban 4 relaciones nuevas y hay %s', v_n));
  end if;

  -- A2 · ninguna tabla de core sin RLS. Regla dura, no solo para las nuevas.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    fallos := array_append(fallos, 'A2: hay tablas de core sin RLS activada');
  end if;

  -- A3 · ninguna policy aplicable a PUBLIC (ADR-011 §15). Semantico, no
  -- sintactico: E17 midio que sin `TO` y `TO PUBLIC` son indistinguibles.
  if exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and 0 = any(p.polroles)
  ) then
    fallos := array_append(fallos, 'A3: existe una policy de core aplicable a PUBLIC');
  end if;

  -- A4 · ningun rol cliente escribe directamente sobre core (cierre 5 del
  -- roadmap).
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and grantee in ('anon','authenticated','service_role')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A4: los roles cliente tienen %s privilegios de escritura sobre core', v_n));
  end if;

  -- A5 · el writer no recibe UPDATE ni DELETE sobre las cuatro nuevas
  -- (ADR-011 §14), y su INSERT se limita a `effect`.
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and table_name in ('scope','participant','membership','effect')
    and grantee = 'nomey_writer'
    and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5: el writer tiene %s privilegios de mutacion sobre las tablas nuevas', v_n));
  end if;

  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core' and grantee = 'nomey_writer'
    and privilege_type = 'INSERT'
    and table_name in ('scope','participant','membership');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5b: el writer tiene INSERT sobre %s relaciones que este bloque no le concede', v_n));
  end if;

  if not has_table_privilege('nomey_writer', 'core.effect', 'insert') then
    fallos := array_append(fallos, 'A5c: el writer no puede insertar efectos');
  end if;

  -- A6 · el helper existe con los atributos que ADR-007 §2 exige.
  select p.prosecdef into v_b
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'sec' and p.proname = 'is_member';
  if v_b is null then
    fallos := array_append(fallos, 'A6: no existe sec.is_member');
  elsif not v_b then
    fallos := array_append(fallos, 'A6: sec.is_member no es SECURITY DEFINER');
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'sec' and p.proname = 'is_member'
      and (p.provolatile <> 's'
           or p.proconfig is distinct from array['search_path=""'])
  ) then
    fallos := array_append(fallos, 'A6b: sec.is_member no es STABLE con search_path fijado a vacio');
  end if;

  -- A6c · un solo parametro. `is_member(scope, user)` seria un oraculo de
  -- pertenencia, y ADR-007 §2 lo prohibe expresamente.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'sec' and p.proname = 'is_member';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A6c: hay %s sobrecargas de sec.is_member; se esperaba 1', v_n));
  end if;

  -- A7 · privilegios del helper: PUBLIC no, `authenticated` si, y sin USAGE
  -- sobre `sec` (ADR-007 §3).
  if has_function_privilege('public', 'sec.is_member(uuid)', 'execute') then
    fallos := array_append(fallos, 'A7: PUBLIC puede ejecutar sec.is_member');
  end if;
  if not has_function_privilege('authenticated', 'sec.is_member(uuid)', 'execute') then
    fallos := array_append(fallos, 'A7b: authenticated no puede ejecutar sec.is_member');
  end if;
  if has_schema_privilege('authenticated', 'sec', 'usage') then
    fallos := array_append(fallos, 'A7c: authenticated tiene USAGE sobre sec');
  end if;
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := array_append(fallos, 'A7d: authenticated tiene USAGE sobre core');
  end if;

  -- A8 · `BEGIN ATOMIC` dejo la dependencia de catalogo. E19 midio que los
  -- cuerpos textuales no dejan ninguna; si esto falla, el helper dejo de ser
  -- analizable y `core.membership` podria caer sin aviso.
  if not exists (
    select 1
    from pg_depend d
    join pg_class c on c.oid = d.refobjid
    join pg_namespace n on n.oid = c.relnamespace
    where d.objid = 'sec.is_member(uuid)'::regprocedure
      and d.classid = 'pg_proc'::regclass
      and n.nspname = 'core' and c.relname = 'membership'
  ) then
    fallos := array_append(fallos, 'A8: sec.is_member no deja dependencia de catalogo hacia core.membership');
  end if;

  -- A9 · la membresia no es alcanzable por el rol cliente (ADR-007 §4).
  if has_table_privilege('authenticated', 'core.membership', 'select') then
    fallos := array_append(fallos, 'A9: authenticated tiene SELECT sobre core.membership');
  end if;
  if has_table_privilege('authenticated', 'core.client_command', 'select') then
    fallos := array_append(fallos, 'A9b: authenticated tiene SELECT sobre core.client_command');
  end if;

  -- A10 · el camino de lectura que este bloque si concede.
  foreach v_b in array array[
    has_table_privilege('authenticated','core.scope','select'),
    has_table_privilege('authenticated','core.participant','select'),
    has_table_privilege('authenticated','core.effect','select'),
    has_table_privilege('authenticated','core.operation','select'),
    has_table_privilege('authenticated','core.operation_version','select'),
    has_table_privilege('authenticated','core.currency_definition','select')
  ] loop
    if not v_b then
      fallos := array_append(fallos, 'A10: falta algun SELECT del camino de lectura del cliente');
    end if;
  end loop;

  -- A11 · COMPROBACION GENERICA. Un `GRANT SELECT` sobre una tabla de `core`
  -- con RLS que no tenga NINGUNA policy de SELECT aplicable a ese mismo rol es
  -- un privilegio inutilizado en silencio: la lectura devuelve cero filas SIN
  -- ERROR. Es exactamente lo que le ocurria a `core.currency_definition` con
  -- `nomey_writer` antes de este bloque.
  --
  -- La regla se dispara por el GRANT, no por la tabla, de modo que una relacion
  -- que deliberadamente niegue la lectura —`membership`, `client_command`— no
  -- la incumple: sin grant no hay nada que quede inutilizado.
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_roles g on g.oid = a.grantee
  where n.nspname = 'core'
    and c.relkind = 'r'
    and c.relrowsecurity
    and a.privilege_type = 'SELECT'
    and g.rolname in ('anon','authenticated','service_role','nomey_writer')
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid
        and p.polcmd in ('r','*')
        and (0 = any(p.polroles) or a.grantee = any(p.polroles))
    );
  if v_n <> 0 then
    fallos := array_append(fallos, format('A11: %s GRANT SELECT de core quedan inutilizados por ausencia total de policy aplicable', v_n));
  end if;

  -- A11b · el caso concreto que este bloque corrige.
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relname = 'currency_definition'
      and p.polcmd in ('r','*')
      and (select oid from pg_roles where rolname = 'nomey_writer') = any(p.polroles)
  ) then
    fallos := array_append(fallos, 'A11b: core.currency_definition sigue sin policy de SELECT para nomey_writer');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE ESTRUCTURA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · forma, privilegios, helper y catalogo';
end
$estructura$;

-- ============================== B · fixture e invariantes de forma ==========
-- Se ejecuta como `postgres`, que es propietario y tiene BYPASSRLS: aqui se
-- comprueban CONSTRAINTS, no politicas.
do $forma$
declare
  fallos text[] := '{}';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  JPY constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  B   constant uuid := '22222222-2222-4222-8222-222222222222';
  S1  constant uuid := '51000000-0000-4000-8000-000000000000'; -- grupo EUR de A
  S2  constant uuid := '52000000-0000-4000-8000-000000000000'; -- personal EUR de B
  S3  constant uuid := '53000000-0000-4000-8000-000000000000'; -- personal EUR de A
  S4  constant uuid := '54000000-0000-4000-8000-000000000000'; -- grupo JPY sin efectos
  P1A constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  P1B constant uuid := 'a1b00000-0000-4000-8000-000000000000';
  P2  constant uuid := 'a2000000-0000-4000-8000-000000000000';
  OP1 constant uuid := '01000000-0000-4000-8000-000000000000';
  V1  constant uuid := '0f100000-0000-4000-8000-000000000000';
  v_n int;
begin
  insert into core.currency_definition (id, code, scale)
  values (EUR, 'EUR', 2), (JPY, 'JPY', 0);

  -- Los Modo Personal llevan dueno desde la migracion de atribucion: la
  -- constraint `scope_dueno_solo_en_personal` hace estructural que `personal`
  -- y propiedad vayan juntos, asi que un fixture sin dueno ya no es
  -- representable (ADR-016).
  insert into core.scope (id, kind, base_currency_definition_id) values
    (S1, 'group',    EUR),
    (S4, 'group',    JPY);
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (S2, 'personal', EUR, B),
    (S3, 'personal', EUR, A);

  insert into core.participant (id, scope_id, display_name) values
    (P1A, S1, 'Marta'),
    (P1B, S1, 'Carlos'),
    (P2,  S2, 'B');

  insert into core.operation (id, operation_class, created_by, current_version_id)
  values (OP1, 'group_expense', A, V1);
  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, original_amount, original_currency_definition_id, economic_rules_version)
  values (V1, OP1, 1, null, A, date '2026-01-15', 6000, EUR, 'v1');

  -- B1 · un `kind` fuera del vocabulario se rechaza. ADR-002 §2 fija tres
  -- ambitos; un cuarto exige migracion deliberada.
  begin
    insert into core.scope (id, kind, base_currency_definition_id)
    values ('5f000000-0000-4000-8000-000000000000', 'household', EUR);
    fallos := array_append(fallos, 'B1: se acepto un kind de ambito fuera del vocabulario');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B1: sqlstate inesperado %s', sqlstate));
  end;

  -- B2 · los tres validos se aceptan. Sin este positivo, B1 pasaria con un
  -- check que rechazase todo.
  select count(*) into v_n from core.scope where kind in ('personal','group','couple');
  if v_n <> 4 then
    fallos := array_append(fallos, format('B2: se esperaban 4 ambitos validos y hay %s', v_n));
  end if;
  begin
    insert into core.scope (id, kind, base_currency_definition_id)
    values ('5c000000-0000-4000-8000-000000000000', 'couple', EUR);
  exception when others then
    fallos := array_append(fallos, format('B2b: se rechazo un ambito couple valido: %s', sqlerrm));
  end;

  -- B3 · POSITIVO · un efecto SIN dimension de deuda es valido. Es la mayoria
  -- de los efectos, y la forma incondicional del check de partes distintas
  -- —`debtor is distinct from creditor`— los habria rechazado todos, porque
  -- `NULL is distinct from NULL` es FALSE.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount, economic_amount, economic_participant_id)
    values ('e1000000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR,
            null, 2000, P1A);
  exception when others then
    fallos := array_append(fallos, format('B3: se rechazo un efecto sin deuda: %s', sqlerrm));
  end;

  -- B4 · POSITIVO · participante economico NULO es valido (Modo Personal), y
  -- un efecto de solo saldo tambien.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values ('e2000000-0000-4000-8000-000000000000', V1, S3, 'expense', EUR, -6000);
  exception when others then
    fallos := array_append(fallos, format('B4: se rechazo un efecto de solo saldo sin participante: %s', sqlerrm));
  end;

  -- B5 · POSITIVO · un efecto con las tres dimensiones y con importe CERO.
  -- ADR-013 §8 no prohibe globalmente los ceros y exige conservar los
  -- economicos resueltos en cero por indivisibilidad.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount, economic_amount, economic_participant_id,
       debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values ('e3000000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR,
            -6000, 0, P1B, 4000, P1B, P1A);
  exception when others then
    fallos := array_append(fallos, format('B5: se rechazo un efecto con las tres dimensiones o con importe cero: %s', sqlerrm));
  end;

  -- B6 · deudor = acreedor se rechaza.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values ('ef100000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR,
            1000, P1A, P1A);
    fallos := array_append(fallos, 'B6: se acepto una deuda con deudor igual a acreedor');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B6: sqlstate inesperado %s', sqlstate));
  end;

  -- B7 · deuda parcial: importe sin deudor ni acreedor.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       debt_amount)
    values ('ef200000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, 1000);
    fallos := array_append(fallos, 'B7: se acepto una dimension de deuda incompleta');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B7: sqlstate inesperado %s', sqlstate));
  end;

  -- B7b · deuda parcial en el otro sentido: partes sin importe.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values ('ef300000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR,
            -100, P1A, P1B);
    fallos := array_append(fallos, 'B7b: se acepto deudor y acreedor sin importe de deuda');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B7b: sqlstate inesperado %s', sqlstate));
  end;

  -- B8 · un efecto sin NINGUNA dimension.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id)
    values ('ef400000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR);
    fallos := array_append(fallos, 'B8: se acepto un efecto sin ninguna dimension');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B8: sqlstate inesperado %s', sqlstate));
  end;

  -- B9 · participante economico sin importe economico.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount, economic_participant_id)
    values ('ef500000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, -100, P1A);
    fallos := array_append(fallos, 'B9: se acepto un participante economico sin importe');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B9: sqlstate inesperado %s', sqlstate));
  end;

  -- B10 · un participante de OTRO ambito. Es lo que hace estructural que el
  -- participante sea contextual (ADR-012 §1).
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values ('ef600000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, 100, P2);
    fallos := array_append(fallos, 'B10: se acepto un participante de otro ambito');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B10: sqlstate inesperado %s', sqlstate));
  end;

  -- B10b · lo mismo para el deudor.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values ('ef700000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, 100, P2, P1A);
    fallos := array_append(fallos, 'B10b: se acepto un deudor de otro ambito');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B10b: sqlstate inesperado %s', sqlstate));
  end;

  -- B11 · una moneda distinta de la base del ambito (ADR-002 §8).
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values ('ef800000-0000-4000-8000-000000000000', V1, S1, 'expense', JPY, 100);
    fallos := array_append(fallos, 'B11: se acepto un efecto en una moneda distinta de la base del ambito');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B11: sqlstate inesperado %s', sqlstate));
  end;

  -- B12 · cambiar la moneda base CON efectos existentes se rechaza. Es la
  -- inmutabilidad "tras la primera operacion" hecha estructural.
  begin
    update core.scope set base_currency_definition_id = JPY where id = S1;
    fallos := array_append(fallos, 'B12: se cambio la moneda base de un ambito con efectos');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B12: sqlstate inesperado %s', sqlstate));
  end;

  -- B12b · POSITIVO · SIN efectos si se puede cambiar. `data-model.md` §10: el
  -- creador de un Grupo todavia puede cambiarla antes de la primera operacion.
  -- Sin este positivo, B12 pasaria con una columna simplemente inmutable.
  begin
    update core.scope set base_currency_definition_id = EUR where id = S4;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      fallos := array_append(fallos, 'B12b: no se pudo cambiar la moneda base de un ambito sin efectos');
    end if;
    update core.scope set base_currency_definition_id = JPY where id = S4;
  exception when others then
    fallos := array_append(fallos, format('B12b: se rechazo cambiar la moneda base de un ambito sin efectos: %s', sqlerrm));
  end;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE FORMA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · constraints de forma del ambito y del efecto';
end
$forma$;

-- ============================ B bis · la operacion que cruza dos ambitos ====
-- Fixture del aislamiento: una operacion cuyos efectos caen en el ambito de A y
-- en el de B. ADR-002 §10 lo permite deliberadamente, y es el caso que decide
-- si la RLS filtra por FILA o por operacion.
insert into core.membership (scope_id, user_id) values
  ('51000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111'),
  ('53000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111'),
  ('52000000-0000-4000-8000-000000000000', '22222222-2222-4222-8222-222222222222');

insert into core.operation (id, operation_class, created_by, current_version_id)
values ('02000000-0000-4000-8000-000000000000', 'internal_transfer',
        '11111111-1111-4111-8111-111111111111',
        '0f200000-0000-4000-8000-000000000000');
insert into core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by,
   effective_date, original_amount, original_currency_definition_id, economic_rules_version)
values ('0f200000-0000-4000-8000-000000000000', '02000000-0000-4000-8000-000000000000',
        1, null, '11111111-1111-4111-8111-111111111111',
        date '2026-02-01', 3000, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'v1');

insert into core.effect
  (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
values
  ('e4000000-0000-4000-8000-000000000000', '0f200000-0000-4000-8000-000000000000',
   '53000000-0000-4000-8000-000000000000', 'transfer',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', -3000),
  ('e5000000-0000-4000-8000-000000000000', '0f200000-0000-4000-8000-000000000000',
   '52000000-0000-4000-8000-000000000000', 'transfer',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',  3000);

-- Una tercera operacion, enteramente AJENA a A: su unico efecto cae en el
-- ambito de B. Es la unica forma de que la relajacion deliberada de la policy
-- de versiones (E4) tenga algo que revelar; sin ella A veria todas las
-- versiones legitimamente y la regresion pasaria sin probar nada.
insert into core.operation (id, operation_class, created_by, current_version_id)
values ('03000000-0000-4000-8000-000000000000', 'personal_expense',
        '22222222-2222-4222-8222-222222222222',
        '0f300000-0000-4000-8000-000000000000');
insert into core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by,
   effective_date, original_amount, original_currency_definition_id, economic_rules_version)
values ('0f300000-0000-4000-8000-000000000000', '03000000-0000-4000-8000-000000000000',
        1, null, '22222222-2222-4222-8222-222222222222',
        date '2026-02-10', 1500, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'v1');
insert into core.effect
  (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
values ('e6000000-0000-4000-8000-000000000000', '0f300000-0000-4000-8000-000000000000',
        '52000000-0000-4000-8000-000000000000', 'expense',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', -1500);

-- Las vistas del camino REAL de lectura. `authenticated` no tiene USAGE sobre
-- `core` —y A7d comprueba que sigue sin tenerlo—, asi que la unica forma de
-- ejercer sus policies es la que ADR-006 §5 fija: vistas `security_invoker` de
-- `api`. Las definitivas, con su cast a texto de ADR-008, pertenecen al bloque
-- siguiente; estas son del test y desaparecen con el ROLLBACK.
create view api.chk_effect            with (security_invoker = true) as select * from core.effect;
create view api.chk_scope             with (security_invoker = true) as select * from core.scope;
create view api.chk_participant       with (security_invoker = true) as select * from core.participant;
create view api.chk_operation         with (security_invoker = true) as select * from core.operation;
create view api.chk_operation_version with (security_invoker = true) as select * from core.operation_version;
create view api.chk_currency          with (security_invoker = true) as select * from core.currency_definition;
create view api.chk_membership        with (security_invoker = true) as select * from core.membership;
grant select on api.chk_effect, api.chk_scope, api.chk_participant, api.chk_operation,
                api.chk_operation_version, api.chk_currency, api.chk_membership
  to authenticated;

-- ================================= C · aislamiento del rol cliente ==========
do $aislamiento$
declare
  fallos text[] := '{}';
  A constant text := '11111111-1111-4111-8111-111111111111';
  B constant text := '22222222-2222-4222-8222-222222222222';
  S1 constant uuid := '51000000-0000-4000-8000-000000000000';
  S2 constant uuid := '52000000-0000-4000-8000-000000000000';
  OP2 constant uuid := '02000000-0000-4000-8000-000000000000';
  v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);

  -- C1 · POSITIVO. Sin el, todo lo negativo pasaria con la base vacia, que es
  -- la trampa que el handoff §15 describe.
  select count(*) into v_n from api.chk_scope;
  if v_n <> 2 then
    fallos := array_append(fallos, format('C1: A ve %s ambitos propios y deberia ver 2', v_n));
  end if;

  select count(*) into v_n from api.chk_participant;
  if v_n <> 2 then
    fallos := array_append(fallos, format('C1b: A ve %s participantes de sus ambitos y deberia ver 2', v_n));
  end if;

  select count(*) into v_n from api.chk_effect;
  if v_n <> 4 then
    fallos := array_append(fallos, format('C1c: A ve %s efectos de sus ambitos y deberia ver 4', v_n));
  end if;

  -- C2 · NEGATIVO. Ni el ambito, ni los participantes, ni los efectos ajenos.
  select count(*) into v_n from api.chk_scope where id = S2;
  if v_n <> 0 then
    fallos := array_append(fallos, 'C2: A ve el ambito de B');
  end if;

  select count(*) into v_n from api.chk_participant where scope_id = S2;
  if v_n <> 0 then
    fallos := array_append(fallos, 'C2b: A ve participantes del ambito de B');
  end if;

  select count(*) into v_n from api.chk_effect where scope_id = S2;
  if v_n <> 0 then
    fallos := array_append(fallos, 'C2c: A ve efectos del ambito de B');
  end if;

  -- C3 · A ve la operacion compartida y su version, porque tiene un efecto
  -- visible de ella. ADR-013 §2: sin la clase, su propio efecto queda sin
  -- interpretar.
  select count(*) into v_n from api.chk_operation where id = OP2;
  if v_n <> 1 then
    fallos := array_append(fallos, 'C3: A no ve la operacion de la que si ve un efecto');
  end if;
  select count(*) into v_n from api.chk_operation_version
   where operation_id = OP2;
  if v_n <> 1 then
    fallos := array_append(fallos, 'C3b: A no ve la version de la que si ve un efecto');
  end if;

  -- C3c · y NO ve la version ni la operacion de la que no ve ningun efecto.
  select count(*) into v_n from api.chk_operation_version;
  if v_n <> 2 then
    fallos := array_append(fallos, format('C3c: A alcanza %s versiones y solo deberia alcanzar 2', v_n));
  end if;
  select count(*) into v_n from api.chk_operation
   where id = '03000000-0000-4000-8000-000000000000';
  if v_n <> 0 then
    fallos := array_append(fallos, 'C3d: A ve una operacion cuyos efectos caen todos fuera de sus ambitos');
  end if;

  -- C4 · EL PUNTO QUE DECIDE. Ver una operacion compartida NO da acceso a sus
  -- efectos en otros ambitos: la RLS filtra por FILA, no por operacion.
  select count(*) into v_n
  from api.chk_effect e
  join api.chk_operation_version ov on ov.id = e.operation_version_id
  where ov.operation_id = OP2;
  if v_n <> 1 then
    fallos := array_append(fallos, format('C4: A alcanza %s efectos de la operacion compartida y solo deberia alcanzar 1', v_n));
  end if;

  -- C5 · la membresia no es legible ni por la superficie. Falta el GRANT, asi
  -- que el fallo es 42501 y no una lista vacia.
  begin
    perform 1 from api.chk_membership;
    fallos := array_append(fallos, 'C5: el rol cliente pudo leer core.membership');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('C5: sqlstate inesperado %s', sqlstate));
  end;

  -- C6 · el helper no es invocable por nombre. E13 midio que la policy si puede
  -- usarlo mientras el usuario no; sin eso seria un oraculo de pertenencia.
  begin
    perform sec.is_member(S2);
    fallos := array_append(fallos, 'C6: el rol cliente pudo invocar sec.is_member por su cuenta');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('C6: sqlstate inesperado %s', sqlstate));
  end;

  -- C7 · el catalogo monetario si es legible: sin `code` y `scale` no se puede
  -- formatear ningun importe.
  select count(*) into v_n from api.chk_currency;
  if v_n < 2 then
    fallos := array_append(fallos, format('C7: el cliente ve %s definiciones monetarias', v_n));
  end if;

  -- C8 · el cliente no escribe efectos. Cierre 5 del roadmap, en ejecucion y no
  -- solo por catalogo.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values ('ec800000-0000-4000-8000-000000000000', '0f200000-0000-4000-8000-000000000000',
            S1, 'expense', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1);
    fallos := array_append(fallos, 'C8: el rol cliente inserto un efecto');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('C8: sqlstate inesperado %s', sqlstate));
  end;

  begin
    update core.effect set balance_amount = 0;
    fallos := array_append(fallos, 'C8b: el rol cliente actualizo un efecto');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('C8b: sqlstate inesperado %s', sqlstate));
  end;

  begin
    delete from core.effect;
    fallos := array_append(fallos, 'C8c: el rol cliente borro efectos');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('C8c: sqlstate inesperado %s', sqlstate));
  end;

  ------------------------------------------------------- el otro lado -------
  perform set_config('request.jwt.claims', json_build_object('sub', B)::text, true);

  -- C9 · simetria: B ve su lado de la misma operacion y no el de A.
  select count(*) into v_n from api.chk_effect;
  if v_n <> 2 then
    fallos := array_append(fallos, format('C9: B ve %s efectos y solo deberia ver 2', v_n));
  end if;
  select count(*) into v_n from api.chk_operation where id = OP2;
  if v_n <> 1 then
    fallos := array_append(fallos, 'C9b: B no ve la operacion compartida');
  end if;
  select count(*) into v_n from api.chk_scope;
  if v_n <> 1 then
    fallos := array_append(fallos, format('C9c: B ve %s ambitos y solo deberia ver 1', v_n));
  end if;

  -- C9d · B NO ve la operacion que ocurre solo en los ambitos de A.
  select count(*) into v_n from api.chk_operation
   where id = '01000000-0000-4000-8000-000000000000';
  if v_n <> 0 then
    fallos := array_append(fallos, 'C9d: B ve una operacion sin ningun efecto en su ambito');
  end if;

  ------------------------------------------------- sin identidad ------------
  perform set_config('request.jwt.claims', '', true);

  -- C10 · sin JWT el helper falla cerrado: `auth.uid()` es nulo y no hay
  -- membresia que casar.
  select count(*) into v_n from api.chk_effect;
  if v_n <> 0 then
    fallos := array_append(fallos, format('C10: sin identidad se ven %s efectos', v_n));
  end if;
  select count(*) into v_n from api.chk_scope;
  if v_n <> 0 then
    fallos := array_append(fallos, format('C10b: sin identidad se ven %s ambitos', v_n));
  end if;
  select count(*) into v_n from api.chk_operation;
  if v_n <> 0 then
    fallos := array_append(fallos, format('C10c: sin identidad se ven %s operaciones', v_n));
  end if;

  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE AISLAMIENTO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · aislamiento del rol cliente por el camino real de lectura';
end
$aislamiento$;

-- =============================== D · el writer sobre los efectos ============
do $writer$
declare
  fallos text[] := '{}';
  A constant text := '11111111-1111-4111-8111-111111111111';
  B constant text := '22222222-2222-4222-8222-222222222222';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  S1 constant uuid := '51000000-0000-4000-8000-000000000000';
  V1 constant uuid := '0f100000-0000-4000-8000-000000000000';
  v_n int;
begin
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);

  -- D1 · POSITIVO. El actor de la peticion creo la version, asi que puede
  -- colgar efectos de ella.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values ('ed100000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, -1);
  exception when others then
    fallos := array_append(fallos, format('D1: el writer no pudo insertar un efecto de su propia version: %s', sqlerrm));
  end;

  -- D1b · el efecto puede caer en un ambito DEL QUE EL ACTOR NO ES MIEMBRO.
  -- ADR-002 §10 lo permite, y por eso el WITH CHECK no comprueba membresia:
  -- hacerlo rechazaria escrituras legitimas.
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values ('ed200000-0000-4000-8000-000000000000', V1,
            '52000000-0000-4000-8000-000000000000', 'transfer', EUR, 1);
  exception when others then
    fallos := array_append(fallos, format('D1b: el writer no pudo producir un efecto sobre el ambito de otro: %s', sqlerrm));
  end;

  -- D2 · el actor pasa a ser B, que no creo la version.
  perform set_config('request.jwt.claims', json_build_object('sub', B)::text, true);
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values ('ed300000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, -1);
    fallos := array_append(fallos, 'D2: el writer colgo un efecto de la version de otro actor');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D2: sqlstate inesperado %s', sqlstate));
  end;

  -- D3 · el writer LEE los efectos de otros actores. Sin esto no puede derivar
  -- la deuda vigente del ambito, y E20 midio que el fallo no es un error: es un
  -- NULL. Las policies de SELECT del writer son portantes de la escritura.
  select count(*) into v_n from core.effect where scope_id = S1;
  if v_n < 3 then
    fallos := array_append(fallos, format('D3: el writer solo alcanza %s efectos del ambito; no puede derivar la deuda', v_n));
  end if;

  -- D4 · el writer lee la version de otro actor, que es lo que exige construir
  -- una V2.
  select count(*) into v_n from core.operation_version where created_by = A::uuid;
  if v_n < 1 then
    fallos := array_append(fallos, 'D4: el writer no lee las versiones de otro actor; la correccion cross-author queda bloqueada');
  end if;

  -- D5 · el catalogo monetario es legible. ANTES DE ESTE BLOQUE devolvia cero
  -- filas sin error, porque tenia GRANT y no tenia policy.
  select count(*) into v_n from core.currency_definition;
  if v_n < 2 then
    fallos := array_append(fallos, format('D5: el writer ve %s definiciones monetarias; con GRANT y sin policy serian 0', v_n));
  end if;

  -- D6 · contexto de validacion: ambitos, participantes y membresias ajenas.
  select count(*) into v_n from core.membership;
  if v_n < 3 then
    fallos := array_append(fallos, format('D6: el writer alcanza %s membresias; no puede validar quien pertenece a que', v_n));
  end if;
  select count(*) into v_n from core.participant;
  if v_n < 3 then
    fallos := array_append(fallos, format('D6b: el writer alcanza %s participantes', v_n));
  end if;
  select count(*) into v_n from core.scope;
  if v_n < 4 then
    fallos := array_append(fallos, format('D6c: el writer alcanza %s ambitos', v_n));
  end if;

  -- D7 · sin UPDATE ni DELETE sobre los efectos (ADR-011 §14). Lo impide el
  -- privilegio ausente, no una policy.
  begin
    update core.effect set balance_amount = 0 where scope_id = S1;
    fallos := array_append(fallos, 'D7: el writer actualizo un efecto');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D7: sqlstate inesperado %s', sqlstate));
  end;

  begin
    delete from core.effect where scope_id = S1;
    fallos := array_append(fallos, 'D7b: el writer borro un efecto');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D7b: sqlstate inesperado %s', sqlstate));
  end;

  -- D8 · el writer no crea ambitos, participantes ni membresias en este
  -- bloque: esas altas llegan con los comandos que las ejecutan.
  begin
    insert into core.membership (scope_id, user_id) values (S1, B::uuid);
    fallos := array_append(fallos, 'D8: el writer creo una membresia sin que este bloque se lo conceda');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D8: sqlstate inesperado %s', sqlstate));
  end;

  -- D9 · sin identidad en la peticion, el WITH CHECK falla cerrado.
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values ('ed900000-0000-4000-8000-000000000000', V1, S1, 'expense', EUR, -1);
    fallos := array_append(fallos, 'D9: se acepto un efecto sin identidad en la peticion');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D9: sqlstate %s en vez de 42501', sqlstate));
  end;

  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DEL WRITER:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · el writer sobre los efectos, con la RLS como segunda barrera';
end
$writer$;

-- ============================ E · regresiones deliberadas ===================
-- La suite debe poder fallar. Aqui se relajan a proposito las policies de
-- aislamiento mas importantes y se comprueba que la fuga OCURRE: si no
-- ocurriera, las asercines de la seccion C estarian pasando por casualidad
-- —por ejemplo con la base vacia— y no por la policy.
--
-- Todo se restaura acto seguido, y ademas la transaccion termina en ROLLBACK.
do $regresion$
declare
  fallos text[] := '{}';
  A constant text := '11111111-1111-4111-8111-111111111111';
  S2 constant uuid := '52000000-0000-4000-8000-000000000000';
  v_n int;
begin
  ---------------------------------------------------------------- efecto ----
  alter policy effect_client_select on core.effect using (true);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  select count(*) into v_n from api.chk_effect where scope_id = S2;
  reset role;

  if v_n = 0 then
    fallos := array_append(fallos,
      'E1: con effect_client_select relajada a `true` A SIGUE sin ver los efectos de B; la asercion C2c no estaba probando la policy');
  end if;

  alter policy effect_client_select on core.effect using (sec.is_member(scope_id));

  -- Y vuelve a filtrar tras restaurarla.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  select count(*) into v_n from api.chk_effect where scope_id = S2;
  reset role;
  if v_n <> 0 then
    fallos := array_append(fallos, 'E1b: la policy de efectos no volvio a filtrar tras restaurarla');
  end if;

  ---------------------------------------------------------------- ambito ----
  alter policy scope_client_select on core.scope using (true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  select count(*) into v_n from api.chk_scope where id = S2;
  reset role;
  if v_n = 0 then
    fallos := array_append(fallos,
      'E2: con scope_client_select relajada a `true` A SIGUE sin ver el ambito de B; la asercion C2 no estaba probando la policy');
  end if;
  alter policy scope_client_select on core.scope using (sec.is_member(id));

  ---------------------------------------------------- participante ----------
  alter policy participant_client_select on core.participant using (true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  select count(*) into v_n from api.chk_participant where scope_id = S2;
  reset role;
  if v_n = 0 then
    fallos := array_append(fallos,
      'E3: con participant_client_select relajada a `true` A SIGUE sin ver los participantes de B; la asercion C2b no estaba probando la policy');
  end if;
  alter policy participant_client_select on core.participant using (sec.is_member(scope_id));

  -------------------------------------------- fuga por la operacion ---------
  -- La mas sutil: si la policy de la version derivase de la operacion en vez de
  -- del efecto, ver una operacion compartida arrastraria la version aunque no
  -- se vea ningun efecto de ella.
  alter policy operation_version_client_select on core.operation_version using (true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  select count(*) into v_n from api.chk_operation_version;
  reset role;
  if v_n <> 3 then
    fallos := array_append(fallos,
      format('E4: con la policy de versiones relajada A alcanza %s versiones en vez de las 3 existentes; C3c no estaba probando la policy', v_n));
  end if;
  alter policy operation_version_client_select on core.operation_version
    using (exists (select 1 from core.effect e
                   where e.operation_version_id = operation_version.id
                     and sec.is_member(e.scope_id)));

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE REGRESION DELIBERADA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · las policies de aislamiento fallan cuando se relajan a proposito';
end
$regresion$;

rollback;
