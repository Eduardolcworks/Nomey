-- E13 · El helper `is_member` y sus permisos.
--
-- Dos preguntas distintas:
--   1. ¿Basta con EXECUTE, o hace falta ademas USAGE sobre el schema `sec`?
--   2. Con el helper en la politica, ¿sigue necesitando el rol cliente leer
--      `membership` directamente?
--
-- NO ES UNA MIGRACION.

\pset pager off
\set QUIET on
select id as uid_a from auth.users where email='e13-a@probe.local' \gset
select id as uid_b from auth.users where email='e13-b@probe.local' \gset
\set QUIET off

create or replace function pg_temp.ver(etiqueta text, uid uuid) returns text
language plpgsql as $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  select count(*) into n from e13_api.item_v;
  reset role;
  return etiqueta || ' -> OK, ' || n || ' fila(s)';
exception when others then
  reset role;
  return etiqueta || ' -> ' || sqlstate || ' ' || sqlerrm;
end $$;

-- La politica de `item` pasa de la forma B (join) al helper.
drop policy if exists p_item_join on e13_core.item;
drop policy if exists p_item_helper on e13_core.item;
create policy p_item_helper on e13_core.item for select
  using (e13_sec.is_member(item.scope_id));

-- Se retira el SELECT sobre membership: la pregunta es si el helper lo hace
-- innecesario.
revoke select on e13_core.membership from authenticated;
revoke usage  on schema e13_sec      from authenticated;
grant  execute on function e13_sec.is_member(uuid) to authenticated;

\echo ''
\echo '=== CASO A · EXECUTE sobre la funcion, SIN USAGE sobre sec ==='
select has_schema_privilege  ('authenticated','e13_sec','USAGE')                   as usage_sec,
       has_function_privilege('authenticated','e13_sec.is_member(uuid)','EXECUTE') as execute_fn,
       has_table_privilege   ('authenticated','e13_core.membership','SELECT')      as select_membership;
select pg_temp.ver('consulta via politica', :'uid_a');

\echo ''
\echo '=== ¿Puede el usuario LLAMAR al helper directamente sin USAGE sobre sec? ==='
do $$
declare r boolean; reclamos text;
begin
  select json_build_object('sub', id::text, 'role','authenticated')::text
    into reclamos from auth.users where email='e13-a@probe.local';
  set local role authenticated;
  perform set_config('request.jwt.claims', reclamos, true);
  select e13_sec.is_member('11111111-1111-1111-1111-111111111111') into r;
  reset role;
  raise notice 'llamada directa -> PUDO, devolvio %', r;
exception when others then
  reset role;
  raise notice 'llamada directa -> % %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo '=== CASO B · USAGE sobre sec + EXECUTE ==='
grant usage on schema e13_sec to authenticated;
select pg_temp.ver('usuario A (miembro)',    :'uid_a');
select pg_temp.ver('usuario B (NO miembro)', :'uid_b');

-- Se deja el caso A, que es el que menos abre.
revoke usage on schema e13_sec from authenticated;
