-- E13 · La misma consulta por dos superficies distintas.
--
--   item_v        -> `security_invoker = true`, se ejecuta como quien consulta
--   item_owner_v  -> sin declararlo, es decir el DEFECTO: se ejecuta como su
--                    propietario
--
-- La diferencia no es de rendimiento ni de estilo. NO ES UNA MIGRACION.

\pset pager off
\set QUIET on
select id as uid_a from auth.users where email='e13-a@probe.local' \gset
select id as uid_b from auth.users where email='e13-b@probe.local' \gset
\set QUIET off

create or replace function pg_temp.ver_owner(etiqueta text, uid uuid) returns text
language plpgsql as $$
declare n int; notas text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  select count(*), coalesce(string_agg(nota, ' | '), '(ninguna)')
    into n, notas from e13_api.item_owner_v;
  reset role;
  return etiqueta || ' -> ' || n || ' fila(s): ' || notas;
exception when others then
  reset role;
  return etiqueta || ' -> ' || sqlstate || ' ' || sqlerrm;
end $$;

-- Se retira TODO privilegio sobre core: la via del propietario no lo necesita.
revoke select on e13_core.item       from authenticated;
revoke select on e13_core.membership from authenticated;
revoke usage  on schema e13_core     from authenticated;
grant  select on e13_api.item_owner_v to authenticated;

\echo ''
\echo '=== Privilegios de authenticated sobre core en este bloque ==='
select has_schema_privilege('authenticated','e13_core','USAGE')       as usage_core,
       has_table_privilege ('authenticated','e13_core.item','SELECT') as select_item;

\echo ''
\echo '=== Vista ejecutada como PROPIETARIO ==='
select pg_temp.ver_owner('usuario A (miembro)',    :'uid_a');
select pg_temp.ver_owner('usuario B (NO miembro)', :'uid_b');
select pg_temp.ver_owner('sin sesion (uid nulo)',  null);

\echo ''
\echo '=== Referencia: filas reales de la tabla ==='
select count(*) as filas_en_e13_core_item from e13_core.item;

-- Se devuelven los privilegios del camino invoker para los bloques siguientes.
grant usage  on schema e13_core   to authenticated;
grant select on e13_core.item     to authenticated;
