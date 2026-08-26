-- Comprobaciones del nucleo de operacion, version y comando cliente, contra la
-- base REAL construida por las migraciones.
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/core-ledger.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno,
-- para que un unico error no oculte los demas. Todo ocurre dentro de una
-- transaccion que termina en ROLLBACK: no deja datos.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ===================================== A · forma, privilegios y constraints ==
do $estructura$
declare
  fallos text[] := '{}';
  A  constant uuid := '11111111-1111-4111-8111-111111111111';
  B  constant uuid := '22222222-2222-4222-8222-222222222222';
  CD constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_n int;
begin
  -- A1 · las cuatro relaciones existen.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and c.relkind = 'r'
    and c.relname in ('currency_definition','operation','operation_version','client_command');
  if v_n <> 4 then
    fallos := array_append(fallos, format('A1: se esperaban 4 relaciones de core y hay %s', v_n));
  end if;

  -- A2 · ninguna tabla de core sin RLS.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    fallos := array_append(fallos, 'A2: hay tablas de core sin RLS activada');
  end if;

  -- A3 · ninguna policy aplicable a PUBLIC. Semantico, no sintactico (E17).
  if exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and 0 = any(p.polroles)
  ) then
    fallos := array_append(fallos, 'A3: existe una policy de core aplicable a PUBLIC');
  end if;

  -- A4 · roles cliente sin escritura directa.
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and grantee in ('anon','authenticated','service_role')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A4: los roles cliente tienen %s privilegios de escritura sobre core', v_n));
  end if;

  -- A5 · atributos del writer (ADR-009 §5).
  if not exists (
    select 1 from pg_roles
    where rolname = 'nomey_writer'
      and not rolcanlogin and not rolbypassrls and not rolsuper
  ) then
    fallos := array_append(fallos, 'A5: nomey_writer no es NOLOGIN / NOBYPASSRLS / NOSUPERUSER');
  end if;

  -- A6 · el writer no posee ninguna tabla de core.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relowner = 'nomey_writer'::regrole
  ) then
    fallos := array_append(fallos, 'A6: nomey_writer es propietario de alguna tabla de core');
  end if;

  -- A7 · el UPDATE del writer sobre `operation` esta acotado POR COLUMNA.
  select count(*) into v_n
  from information_schema.column_privileges
  where table_schema='core' and table_name='operation'
    and grantee='nomey_writer' and privilege_type='UPDATE';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A7: se esperaba UPDATE sobre 1 columna y hay %s', v_n));
  end if;
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema='core' and table_name='operation' and grantee='nomey_writer'
      and privilege_type='UPDATE' and column_name='current_version_id'
  ) then
    fallos := array_append(fallos, 'A8: el UPDATE por columna del writer no es current_version_id');
  end if;

  -- A9 · el writer no modifica ni borra versiones ni comandos (ADR-011 §14).
  if exists (
    select 1 from information_schema.table_privileges
    where table_schema='core' and table_name in ('operation_version','client_command')
      and grantee='nomey_writer' and privilege_type in ('UPDATE','DELETE')
  ) then
    fallos := array_append(fallos, 'A9: el writer puede modificar o borrar versiones o comandos');
  end if;

  ------------------------------------------------------------- constraints --
  insert into core.currency_definition (id, code, scale) values (CD, 'EUR', 2);

  -- B1 · una operacion valida con su V1.
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('a1000000-0000-4000-8000-000000000000','personal_expense', A,
            'b1000000-0000-4000-8000-000000000000');
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b1000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            1, null, A, date '2026-01-01', 2000, CD, 'v1');
  exception when others then
    fallos := array_append(fallos, format('B1: una operacion valida fue rechazada: %s', sqlerrm));
  end;

  -- B2 · version_no invalido.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b2000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            0, null, A, date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'B2: se acepto version_no = 0');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B2: error inesperado %s', sqlstate));
  end;

  -- B3 · una V1 con predecesor.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b3000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            1, 'b1000000-0000-4000-8000-000000000000', A, date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'B3: se acepto una V1 con predecesor');
  exception when check_violation or unique_violation then null;
    when others then fallos := array_append(fallos, format('B3: error inesperado %s', sqlstate));
  end;

  -- B4 · una V2 sin predecesor.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b4000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            2, null, A, date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'B4: se acepto una V2 sin predecesor');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B4: error inesperado %s', sqlstate));
  end;

  -- B5 · autorreferencia.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b5000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            2, 'b5000000-0000-4000-8000-000000000000', A, date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'B5: se acepto una version que se supersede a si misma');
  exception when check_violation or foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B5: error inesperado %s', sqlstate));
  end;

  -- B6 · el puntero no puede apuntar a la version de OTRA operacion.
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('a6000000-0000-4000-8000-000000000000','personal_expense', A,
            'b1000000-0000-4000-8000-000000000000');
    set constraints core.operation_current_version_fk immediate;
    fallos := array_append(fallos, 'B6: el puntero acepto la version de otra operacion');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B6: error inesperado %s', sqlstate));
  end;
  set constraints all deferred;

  -- B7 · (operation_id, version_no) unico.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b7000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            1, null, A, date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'B7: se acepto un version_no duplicado en la misma operacion');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('B7: error inesperado %s', sqlstate));
  end;

  -- B8 · el predecesor debe pertenecer a la MISMA operacion. Es lo unico del
  -- linaje que la FK compuesta si garantiza estructuralmente; el resto —que el
  -- predecesor sea exactamente la version vigente anterior— lo reserva
  -- ADR-011 §11 a la frontera autoritativa.
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('a8000000-0000-4000-8000-000000000000','personal_expense', A,
            'b8000000-0000-4000-8000-000000000000');
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b8000000-0000-4000-8000-000000000000','a8000000-0000-4000-8000-000000000000',
            1, null, A, date '2026-01-01', 1, CD, 'v1');
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b8800000-0000-4000-8000-000000000000','a8000000-0000-4000-8000-000000000000',
            2, 'b1000000-0000-4000-8000-000000000000',  -- V1 de OTRA operacion
            A, date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'B8: una version supersedio a la version de otra operacion');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B8: error inesperado %s', sqlstate));
  end;

  --------------------------------------------------------- client_command ---
  insert into core.client_command
    (created_by, client_operation_id, command_type, command_contract_version,
     canonical_intent, result_operation_id, result_version_id)
  values (A, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'create_expense', 1,
          '{}'::jsonb, 'a1000000-0000-4000-8000-000000000000',
          'b1000000-0000-4000-8000-000000000000');

  -- C1 · el mismo actor no reutiliza el UUID, ni siquiera con otra clase.
  begin
    insert into core.client_command
      (created_by, client_operation_id, command_type, command_contract_version,
       canonical_intent, result_operation_id, result_version_id)
    values (A, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'correct_expense', 1,
            '{}'::jsonb, 'a1000000-0000-4000-8000-000000000000',
            'b1000000-0000-4000-8000-000000000000');
    fallos := array_append(fallos, 'C1: el mismo actor reutilizo el client_operation_id con otra clase');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('C1: error inesperado %s', sqlstate));
  end;

  -- C2 · otro actor SI puede usar el mismo UUID.
  begin
    insert into core.client_command
      (created_by, client_operation_id, command_type, command_contract_version,
       canonical_intent, result_operation_id, result_version_id)
    values (B, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'create_expense', 1,
            '{}'::jsonb, 'a1000000-0000-4000-8000-000000000000',
            'b1000000-0000-4000-8000-000000000000');
  exception when others then
    fallos := array_append(fallos, format('C2: otro actor no pudo usar el mismo UUID: %s', sqlerrm));
  end;

  -- C3 · el resultado no puede mezclar operacion y version de operaciones
  -- distintas.
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('a3000000-0000-4000-8000-000000000000','personal_expense', A,
            'b3300000-0000-4000-8000-000000000000');
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('b3300000-0000-4000-8000-000000000000','a3000000-0000-4000-8000-000000000000',
            1, null, A, date '2026-01-01', 1, CD, 'v1');
    insert into core.client_command
      (created_by, client_operation_id, command_type, command_contract_version,
       canonical_intent, result_operation_id, result_version_id)
    values (A, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'create_expense', 1,
            '{}'::jsonb, 'a3000000-0000-4000-8000-000000000000',
            'b1000000-0000-4000-8000-000000000000');
    set constraints core.client_command_result_fk immediate;
    fallos := array_append(fallos, 'C3: un comando declaro como resultado la version de otra operacion');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('C3: error inesperado %s', sqlstate));
  end;
  set constraints all deferred;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE ESTRUCTURA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · forma, privilegios, constraints e idempotencia estructural';
end
$estructura$;

-- ============================== D · la RLS del writer como segunda barrera ==
-- Se ejecuta como `nomey_writer`, con el actor en el GUC de la peticion, sobre
-- las filas que dejo la seccion anterior.
do $rls$
declare
  fallos text[] := '{}';
  A constant text := '11111111-1111-4111-8111-111111111111';
  B constant text := '22222222-2222-4222-8222-222222222222';
  CD constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_n int;
  v_ptr uuid;
  v_max int;
begin
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);

  -- D1 · atribuir una operacion a otro actor. La frontera funcional no existe
  -- todavia; si esto se rechaza, lo rechaza la RLS.
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('d1000000-0000-4000-8000-000000000000','personal_expense', B::uuid,
            'd1100000-0000-4000-8000-000000000000');
    fallos := array_append(fallos, 'D1: la RLS acepto una operacion atribuida a otro actor');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D1: error inesperado %s', sqlstate));
  end;

  -- D2 · atribuir una version a otro actor.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('d2000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            9, 'b1000000-0000-4000-8000-000000000000', B::uuid,
            date '2026-01-01', 1, CD, 'v1');
    fallos := array_append(fallos, 'D2: la RLS acepto una version atribuida a otro actor');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D2: error inesperado %s', sqlstate));
  end;

  -- D3 · SELECT ... FOR UPDATE bajo las policies del writer. E20 midio que sin
  -- policy de UPDATE devuelve CERO FILAS SIN ERROR, asi que se comprueba que
  -- devuelve la fila, no que no lance.
  begin
    select o.current_version_id into v_ptr
    from core.operation o
    where o.id = 'a1000000-0000-4000-8000-000000000000'
    for update;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      fallos := array_append(fallos, format('D3: SELECT ... FOR UPDATE devolvio %s filas', v_n));
    end if;
  exception when others then
    fallos := array_append(fallos, format('D3: SELECT ... FOR UPDATE fallo: %s', sqlerrm));
  end;

  ------------------------------------------------- correccion cross-author --
  -- El actor pasa a ser B, que NO creo la operacion ni su V1.
  perform set_config('request.jwt.claims', json_build_object('sub', B)::text, true);

  -- D4 · B debe poder LEER la V1 de A. Sin esa lectura no puede calcular el
  -- siguiente version_no ni heredar nada (medido en E20-F).
  begin
    select max(ov.version_no) into v_max
    from core.operation_version ov
    where ov.operation_id = 'a1000000-0000-4000-8000-000000000000';
    if v_max is null then
      fallos := array_append(fallos, 'D4: B no puede leer las versiones de A; la correccion cross-author queda bloqueada');
    end if;
  exception when others then
    fallos := array_append(fallos, format('D4: error leyendo la version ajena: %s', sqlerrm));
  end;

  -- D5 · B crea la V2 de la operacion de A, atribuida a B.
  begin
    insert into core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by,
       effective_date, original_amount, original_currency_definition_id, economic_rules_version)
    values ('d5000000-0000-4000-8000-000000000000','a1000000-0000-4000-8000-000000000000',
            coalesce(v_max, 1) + 1, 'b1000000-0000-4000-8000-000000000000', B::uuid,
            date '2026-01-01', 2500, CD, 'v1');
  exception when others then
    fallos := array_append(fallos, format('D5: B no pudo corregir la operacion de A: %s', sqlerrm));
  end;

  -- D6 · B mueve el puntero a la version que B creo.
  begin
    update core.operation
       set current_version_id = 'd5000000-0000-4000-8000-000000000000'
     where id = 'a1000000-0000-4000-8000-000000000000';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      fallos := array_append(fallos, format('D6: el movimiento del puntero afecto a %s filas', v_n));
    end if;
  exception when others then
    fallos := array_append(fallos, format('D6: B no pudo mover el puntero a su propia version: %s', sqlerrm));
  end;

  -- D7 · B NO puede devolver la vigencia a una version que no creo.
  begin
    update core.operation
       set current_version_id = 'b1000000-0000-4000-8000-000000000000'
     where id = 'a1000000-0000-4000-8000-000000000000';
    fallos := array_append(fallos, 'D7: B movio el puntero a una version ajena');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D7: error inesperado %s', sqlstate));
  end;

  -- D8 · el writer no puede tocar una columna distinta del puntero. Lo impide
  -- el GRANT por columna, no la RLS.
  begin
    update core.operation set operation_class = 'MUTADA'
     where id = 'a1000000-0000-4000-8000-000000000000';
    fallos := array_append(fallos, 'D8: el writer mutó una columna que no es el puntero');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D8: error inesperado %s', sqlstate));
  end;

  -- D9 · sin identidad en la peticion, el helper falla cerrado.
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('d9000000-0000-4000-8000-000000000000','personal_expense', A::uuid,
            'd9900000-0000-4000-8000-000000000000');
    fallos := array_append(fallos, 'D9: se acepto una escritura sin identidad en la peticion');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D9: error inesperado %s (se esperaba 42501)', sqlstate));
  end;

  -- D10 · un `sub` malformado tambien falla cerrado con 42501, no con 22P02.
  perform set_config('request.jwt.claims', '{"sub":"no-soy-un-uuid"}', true);
  begin
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values ('da000000-0000-4000-8000-000000000000','personal_expense', A::uuid,
            'daa00000-0000-4000-8000-000000000000');
    fallos := array_append(fallos, 'D10: se acepto una escritura con un sub malformado');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D10: sqlstate %s en vez de 42501', sqlstate));
  end;

  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE RLS:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · la RLS del writer actua como segunda barrera';
end
$rls$;

rollback;
