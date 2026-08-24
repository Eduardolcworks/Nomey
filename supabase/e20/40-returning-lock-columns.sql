-- E20-C · Tres comportamientos de PostgreSQL que condicionan el conjunto minimo
-- de politicas del writer, medidos en el mismo montaje:
--
--   1. ¿Exige INSERT ... RETURNING una politica de SELECT adicional?
--   2. ¿Exige SELECT ... FOR UPDATE una politica de UPDATE ademas de la de SELECT?
--   3. ¿Puede la RLS limitar el UPDATE a la columna del puntero, o eso es un grant?
--
-- Depende de 20-sequence.sql: usa la operacion A1 y su version V1.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== politicas de partida ==='
select c.relname as tabla, p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                     when 'w' then 'UPDATE' else p.polcmd::text end as comando,
       pg_get_expr(p.polwithcheck, p.polrelid) is null as with_check_omitido
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'e20_core'
order by 1, 3, 2;

\echo ''
\echo '=== C1 · INSERT ... RETURNING sobre effect, SIN politica de SELECT ==='
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111'; v_ret uuid;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000031-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'C1a INSERT sin RETURNING   ACEPTADO';
  exception when others then
    raise notice 'C1a INSERT sin RETURNING   RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000032-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    returning id into v_ret;
    raise notice 'C1b INSERT ... RETURNING   ACEPTADO  (%)', v_ret;
  exception when others then
    raise notice 'C1b INSERT ... RETURNING   RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== C2 · el mismo RETURNING, CON politica de SELECT sobre effect ==='
begin;
create policy p_ef_writer_sel on e20_core.effect
  for select to e20_writer
  using (
    exists (select 1 from e20_core.operation_version ov
             where ov.id = effect.operation_version_id
               and ov.created_by = e20_sec.request_actor_id())
  );
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111'; v_ret uuid;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000033-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    returning id into v_ret;
    raise notice 'C2  INSERT ... RETURNING   ACEPTADO  (%)', v_ret;
  exception when others then
    raise notice 'C2  INSERT ... RETURNING   RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- retira la politica de SELECT sobre effect

\echo ''
\echo '=== C3 · SELECT ... FOR UPDATE con politicas de SELECT y de UPDATE ==='
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111'; v_ptr uuid; v_n int;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    select o.current_version_id into v_ptr
    from e20_core.operation o
    where o.id = 'a0000001-0000-4000-8000-000000000000' for update;
    get diagnostics v_n = row_count;
    raise notice 'C3  SELECT ... FOR UPDATE  ACEPTADO  filas=%  puntero=%', v_n, v_ptr;
  exception when others then
    raise notice 'C3  SELECT ... FOR UPDATE  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== C4 · el mismo bloqueo SIN la politica de UPDATE ==='
begin;
drop policy p_op_writer_upd on e20_core.operation;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111'; v_ptr uuid; v_n int;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    select o.current_version_id into v_ptr
    from e20_core.operation o
    where o.id = 'a0000001-0000-4000-8000-000000000000';
    get diagnostics v_n = row_count;
    raise notice 'C4a SELECT sin FOR UPDATE  ACEPTADO  filas=%', v_n;
  exception when others then
    raise notice 'C4a SELECT sin FOR UPDATE  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  begin
    select o.current_version_id into v_ptr
    from e20_core.operation o
    where o.id = 'a0000001-0000-4000-8000-000000000000' for update;
    get diagnostics v_n = row_count;
    raise notice 'C4b SELECT ... FOR UPDATE  ACEPTADO  filas=%', v_n;
  exception when others then
    raise notice 'C4b SELECT ... FOR UPDATE  RECHAZADO  sqlstate=%  %  <-- exige politica de UPDATE', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- restaura la politica de UPDATE

\echo ''
\echo '=== C5 · UPDATE de una columna que NO es el puntero, con grant por columna ==='
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);
select jsonb_pretty(e20_api.probe_update_class(
  'a0000001-0000-4000-8000-000000000000'::uuid)) as c5_columna_ajena_grant_estrecho;
reset role;
rollback;

\echo ''
\echo '=== C6 · el MISMO UPDATE con grant de UPDATE sobre toda la tabla ==='
\echo '    Si ahora pasa, queda medido que la RLS no estrecha por columna.'
begin;
grant update on e20_core.operation to e20_writer;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);
select jsonb_pretty(e20_api.probe_update_class(
  'a0000001-0000-4000-8000-000000000000'::uuid)) as c6_columna_ajena_grant_amplio;
reset role;
rollback;   -- retira el grant amplio y deshace la mutacion

\echo ''
\echo '=== C7 · el WITH CHECK omitido del UPDATE: ¿se copia del USING? ==='
\echo '    Con grant amplio, se intenta reatribuir la fila al actor B. Si el'
\echo '    UPDATE se rechaza, el WITH CHECK implicito existe y es el USING.'
begin;
grant update on e20_core.operation to e20_writer;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111'; v_n int;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    update e20_core.operation
       set created_by = '22222222-2222-4222-8222-222222222222'
     where id = 'a0000001-0000-4000-8000-000000000000';
    get diagnostics v_n = row_count;
    raise notice 'C7  reatribucion al actor B  ACEPTADA  filas=%  <-- sin WITH CHECK efectivo', v_n;
  exception when others then
    raise notice 'C7  reatribucion al actor B  RECHAZADA  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== estado final: nada de 40- debe haber persistido ==='
select o.id as operation, o.created_by, o.operation_class, o.current_version_id
from e20_core.operation o order by 1;
select count(*) as efectos from e20_core.effect;
select table_name, privilege_type
from information_schema.table_privileges
where grantee = 'e20_writer' and table_schema = 'e20_core' order by 1, 2;
