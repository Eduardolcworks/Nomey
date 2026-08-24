-- E20-D · Como se comporta el helper del actor DENTRO de las politicas del
-- writer: ausencia de identidad, identidad invalida, y que privilegios exige
-- su evaluacion en una politica frente a su invocacion directa.
--
-- Reproduce en el contexto del writer lo que E13 midio para el rol cliente.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== D1 · sin GUC de identidad: ¿como falla la politica? ==='
begin;
do $probe$
begin
  set local role e20_writer;
  -- No se fija request.jwt.claims a proposito.

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000041-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'D1  ACEPTADO   <-- la ausencia de identidad NO detiene la escritura';
  exception when others then
    raise notice 'D1  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== D2 · GUC presente pero con un sub que no es UUID ==='
begin;
do $probe$
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', '{"sub":"no-soy-un-uuid"}', true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000042-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'D2  ACEPTADO   <-- FUGA';
  exception when others then
    raise notice 'D2  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== D3 · sin USAGE sobre el schema del helper ==='
\echo '    Se separan dos cosas: la evaluacion DENTRO de una politica y la'
\echo '    invocacion DIRECTA desde el cuerpo de la funcion autoritativa.'
begin;
revoke usage on schema e20_sec from e20_writer;

do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000043-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'D3a helper DENTRO de la politica   FUNCIONA sin USAGE';
  exception when others then
    raise notice 'D3a helper DENTRO de la politica   FALLA  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);
select jsonb_pretty(e20_api.probe_state()) as d3b_invocacion_directa_sin_usage;
reset role;
rollback;   -- restaura USAGE

\echo ''
\echo '=== D4 · sin EXECUTE sobre el helper ==='
begin;
revoke execute on function e20_sec.request_actor_id() from e20_writer;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000044-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'D4  ACEPTADO   <-- la politica no exige EXECUTE';
  exception when others then
    raise notice 'D4  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- restaura EXECUTE

\echo ''
\echo '=== D5 · el mismo helper con identidad valida, como control ==='
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);
select jsonb_pretty(e20_api.probe_state()) as d5_control_actor_a;
reset role;
rollback;

\echo ''
\echo '=== privilegios del writer sobre el helper tras D3-D4 (deben estar intactos) ==='
select has_schema_privilege('e20_writer', 'e20_sec', 'USAGE')   as usage_e20_sec,
       has_function_privilege('e20_writer',
         'e20_sec.request_actor_id()', 'EXECUTE')               as execute_helper;
