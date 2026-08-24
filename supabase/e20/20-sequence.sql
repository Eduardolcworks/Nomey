-- E20-A · La secuencia autoritativa completa bajo la RLS del writer.
--
-- Mide: INSERT operation -> INSERT operation_version -> INSERT effect ->
-- SELECT ... FOR UPDATE -> UPDATE del puntero, con la atribucion coherente y
-- con la atribucion incoherente, mas la correccion que MUEVE el puntero.
--
-- Actores fijos (no son filas de auth.users: el helper solo lee el GUC).
--   A = 11111111-1111-4111-8111-111111111111
--   B = 22222222-2222-4222-8222-222222222222
--
-- NO ES UNA MIGRACION.

\pset pager off
\set ACTOR_A '11111111-1111-4111-8111-111111111111'
\set ACTOR_B '22222222-2222-4222-8222-222222222222'
\set SCOPE_A 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set SCOPE_B 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

\echo ''
\echo '=== A1 · secuencia completa, actor A, atribucion coherente ==='
\echo '    Se ejecuta por la frontera autoritativa real (SECURITY DEFINER del'
\echo '    writer) e incluye el COMMIT, de modo que la FK compuesta diferida'
\echo '    del puntero se valida de verdad.'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ACTOR_A')::text, true);
select jsonb_pretty(e20_api.run_sequence(
  'a0000001-0000-4000-8000-000000000000'::uuid,   -- operation
  'b0000001-0000-4000-8000-000000000000'::uuid,   -- version V1
  'c0000001-0000-4000-8000-000000000000'::uuid,   -- effect
  :'SCOPE_A'::uuid
)) as a1_secuencia_completa;
reset role;
commit;

\echo ''
\echo '=== A2 · misma secuencia, pero atribuyendo la escritura al actor B ==='
\echo '    La funcion NO lo valida a proposito. Si se rechaza, lo rechaza la RLS.'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ACTOR_A')::text, true);
select jsonb_pretty(e20_api.run_sequence(
  'a0000002-0000-4000-8000-000000000000'::uuid,
  'b0000002-0000-4000-8000-000000000000'::uuid,
  'c0000002-0000-4000-8000-000000000000'::uuid,
  :'SCOPE_A'::uuid,
  p_attr => :'ACTOR_B'::uuid
)) as a2_atribucion_ajena;
reset role;
commit;

\echo ''
\echo '=== A3 · operacion coherente, VERSION atribuida a otro actor ==='
\echo '    A nivel de sentencia, con el rol writer activo. Aisla el paso 2.'
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.operation (id, operation_class, created_by, current_version_id)
    values ('a0000003-0000-4000-8000-000000000000',
            'probe', v_actor::uuid, 'b0000003-0000-4000-8000-000000000000');
    raise notice 'A3 paso 1 (operation, atribucion coherente)  ACEPTADO';
  exception when others then
    raise notice 'A3 paso 1  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  begin
    insert into e20_core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by)
    values ('b0000003-0000-4000-8000-000000000000',
            'a0000003-0000-4000-8000-000000000000', 1, null,
            '22222222-2222-4222-8222-222222222222');
    raise notice 'A3 paso 2 (version atribuida al actor B)  ACEPTADO  <-- la RLS no lo para';
  exception when others then
    raise notice 'A3 paso 2  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
-- La operacion de A3 queda apuntando a una version que no existe. Al no haberse
-- creado nunca la V1, el COMMIT debe fallar por la FK diferida; se deshace.
rollback;

\echo ''
\echo '=== A4 · correccion: V2 + movimiento del puntero, sobre la operacion A1 ==='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ACTOR_A')::text, true);
select jsonb_pretty(e20_api.run_correction(
  'a0000001-0000-4000-8000-000000000000'::uuid,   -- operation existente
  'b0000001-0000-4000-8000-000000000000'::uuid,   -- V1
  'b0000011-0000-4000-8000-000000000000'::uuid,   -- V2
  'c0000011-0000-4000-8000-000000000000'::uuid,   -- effect de V2
  :'SCOPE_A'::uuid,
  2                                               -- version_no de la V2
)) as a4_correccion;
reset role;
commit;

\echo ''
\echo '=== A5 · la MISMA correccion intentada por el actor B ==='
\echo '    La operacion es de A. El paso 1 es un SELECT ... FOR UPDATE.'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ACTOR_B')::text, true);
select jsonb_pretty(e20_api.run_correction(
  'a0000001-0000-4000-8000-000000000000'::uuid,
  'b0000011-0000-4000-8000-000000000000'::uuid,
  'b0000012-0000-4000-8000-000000000000'::uuid,
  'c0000012-0000-4000-8000-000000000000'::uuid,
  :'SCOPE_A'::uuid,
  3
)) as a5_correccion_ajena;
reset role;
commit;

\echo ''
\echo '=== A6 · el rol cliente intenta escribir y leer e20_core directamente ==='
\echo '    Las politicas del writer NO deben ampliarle nada: no tiene grants.'
do $probe$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);

  begin
    insert into e20_core.operation (id, operation_class, created_by, current_version_id)
    values ('a00000ff-0000-4000-8000-000000000000', 'probe',
            '11111111-1111-4111-8111-111111111111', 'b00000ff-0000-4000-8000-000000000000');
    raise notice 'A6 INSERT directo del cliente  ACEPTADO  <-- FUGA';
  exception when others then
    raise notice 'A6 INSERT directo del cliente  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  begin
    perform count(*) from e20_core.operation;
    raise notice 'A6 SELECT directo del cliente  ACEPTADO  <-- FUGA';
  exception when others then
    raise notice 'A6 SELECT directo del cliente  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;

\echo ''
\echo '=== estado tras A1-A6, leido como propietario (sin RLS) ==='
select o.id as operation, o.created_by, o.current_version_id, o.operation_class
from e20_core.operation o order by 1;
select v.id as version, v.operation_id, v.version_no, v.supersedes_version_id, v.created_by
from e20_core.operation_version v order by v.operation_id, v.version_no;
select e.id as effect, e.operation_version_id, e.scope_id from e20_core.effect e order by 1;

\echo ''
\echo '=== invariante de vigencia: puntero == version de mayor version_no ==='
select o.id as operation,
       o.current_version_id,
       (select v.id from e20_core.operation_version v
         where v.operation_id = o.id order by v.version_no desc limit 1) as mayor_version_no,
       o.current_version_id =
       (select v.id from e20_core.operation_version v
         where v.operation_id = o.id order by v.version_no desc limit 1) as coincide
from e20_core.operation o order by 1;
