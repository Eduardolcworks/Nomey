-- E20-E · El predicado de `operation` que hace falta para el paso 5, sin
-- decidir de paso una regla de producto que ningun ADR ha decidido.
--
-- A5 midio que, con `operation.created_by = actor` como USING de SELECT y de
-- UPDATE, un actor distinto del creador NO puede corregir la operacion: el
-- SELECT ... FOR UPDATE del paso 1 devuelve 0 filas. Eso funciona, pero
-- afirma que "solo el creador corrige", y **eso no esta decidido**: ADR-011 y
-- ADR-013 no lo dicen, y ADR-002 §10 sustituye la confirmacion previa por
-- atribucion, historial y notificacion, lo que sugiere justo lo contrario.
--
-- Aqui se mide un predicado alternativo que NO prejuzga quien puede corregir:
--   el puntero solo puede moverse a una version atribuida al actor que lo mueve.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== E1 · linea base: politicas de 10-setup, el actor B corrige a A ==='
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','22222222-2222-4222-8222-222222222222')::text, true);
select jsonb_pretty(e20_api.run_correction(
  'a0000001-0000-4000-8000-000000000000'::uuid,
  'b0000011-0000-4000-8000-000000000000'::uuid,
  'b0000031-0000-4000-8000-000000000000'::uuid,
  'c0000051-0000-4000-8000-000000000000'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  3
)) as e1_predicado_por_creador;
reset role;
rollback;

\echo ''
\echo '=== E2 · predicado alternativo: el puntero apunta a una version del actor ==='
\echo '    SELECT y UPDATE del writer con USING amplio; la restriccion util se'
\echo '    traslada al WITH CHECK del UPDATE, que SI es explicito.'
begin;
drop policy p_op_writer_sel on e20_core.operation;
drop policy p_op_writer_upd on e20_core.operation;

create policy p_op_writer_sel on e20_core.operation
  for select to e20_writer using (true);

create policy p_op_writer_upd on e20_core.operation
  for update to e20_writer
  using (true)
  with check (
    exists (select 1 from e20_core.operation_version ov
             where ov.id           = operation.current_version_id
               and ov.operation_id = operation.id
               and ov.created_by   = e20_sec.request_actor_id())
  );

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','22222222-2222-4222-8222-222222222222')::text, true);
select jsonb_pretty(e20_api.run_correction(
  'a0000001-0000-4000-8000-000000000000'::uuid,
  'b0000011-0000-4000-8000-000000000000'::uuid,
  'b0000032-0000-4000-8000-000000000000'::uuid,
  'c0000052-0000-4000-8000-000000000000'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  3
)) as e2_correccion_por_otro_miembro;
reset role;
rollback;   -- restaura las politicas de 10-setup

\echo ''
\echo '=== E3 · con el mismo predicado, mover el puntero a una version AJENA ==='
\echo '    El actor B intenta dejar vigente la V1 de A sin crear ninguna version.'
begin;
drop policy p_op_writer_sel on e20_core.operation;
drop policy p_op_writer_upd on e20_core.operation;
create policy p_op_writer_sel on e20_core.operation
  for select to e20_writer using (true);
create policy p_op_writer_upd on e20_core.operation
  for update to e20_writer
  using (true)
  with check (
    exists (select 1 from e20_core.operation_version ov
             where ov.id           = operation.current_version_id
               and ov.operation_id = operation.id
               and ov.created_by   = e20_sec.request_actor_id())
  );

do $probe$
declare v_actor text := '22222222-2222-4222-8222-222222222222'; v_n int;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    update e20_core.operation
       set current_version_id = 'b0000001-0000-4000-8000-000000000000'  -- V1, del actor A
     where id = 'a0000001-0000-4000-8000-000000000000';
    get diagnostics v_n = row_count;
    raise notice 'E3  ACEPTADO   filas=%  <-- se puede revertir la vigencia sin autoria', v_n;
  exception when others then
    raise notice 'E3  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== E4 · con el predicado amplio en operation, ¿sigue mordiendo el de effect? ==='
begin;
drop policy p_op_writer_sel on e20_core.operation;
create policy p_op_writer_sel on e20_core.operation
  for select to e20_writer using (true);

do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000053-0000-4000-8000-000000000000',
            'b0000020-0000-4000-8000-000000000000',   -- version del actor B
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'E4  ACEPTADO   <-- el predicado de effect dependia del de operation';
  exception when others then
    raise notice 'E4  RECHAZADO  sqlstate=%  %  <-- son independientes', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== politicas de operation tras E1-E4 (deben ser las de 10-setup) ==='
select p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                     when 'w' then 'UPDATE' else p.polcmd::text end as comando,
       pg_get_expr(p.polqual,      p.polrelid) as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_policy p
where p.polrelid = 'e20_core.operation'::regclass
order by 2, 1;
