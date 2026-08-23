-- E13 · Privilegios minimos que necesita una vista `security_invoker`.
--
-- Se concede de uno en uno y se observa donde falla. Despues se revoca cada
-- pieza por separado para comprobar cuales son REALMENTE necesarias: conceder
-- en orden solo demuestra suficiencia, no minimalidad.
--
-- NO ES UNA MIGRACION.

\pset pager off
\set QUIET on
select id as uid_a from auth.users where email='e13-a@probe.local' \gset
select id as uid_b from auth.users where email='e13-b@probe.local' \gset
\set QUIET off

-- Consulta la vista invoker como `authenticated` con el JWT de `uid`.
create or replace function pg_temp.ver(etiqueta text, uid uuid) returns text
language plpgsql as $$
declare n int; notas text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  select count(*), coalesce(string_agg(nota, ' | '), '(ninguna)')
    into n, notas from e13_api.item_v;
  reset role;
  return etiqueta || ' -> OK, ' || n || ' fila(s): ' || notas;
exception when others then
  reset role;
  return etiqueta || ' -> ' || sqlstate || ' ' || sqlerrm;
end $$;

\echo ''
\echo '=== SUFICIENCIA · se concede de una en una ==='
select pg_temp.ver('1 · sin ningun privilegio', :'uid_a');

grant usage on schema e13_api to authenticated;
grant select on e13_api.item_v to authenticated;
select pg_temp.ver('2 · USAGE api + SELECT vista', :'uid_a');

grant usage on schema e13_core to authenticated;
select pg_temp.ver('3 · + USAGE core', :'uid_a');

grant select on e13_core.item to authenticated;
select pg_temp.ver('4 · + SELECT sobre la tabla subyacente', :'uid_a');

grant select on e13_core.membership to authenticated;
select pg_temp.ver('5 · + SELECT sobre membership', :'uid_a');

\echo ''
\echo '=== MINIMALIDAD · se revoca cada pieza por separado ==='
revoke usage on schema e13_core from authenticated;
select pg_temp.ver('sin USAGE core', :'uid_a');
grant usage on schema e13_core to authenticated;

revoke select on e13_core.membership from authenticated;
select pg_temp.ver('sin SELECT membership (politica de join)', :'uid_a');
grant select on e13_core.membership to authenticated;

revoke select on e13_core.item from authenticated;
select pg_temp.ver('sin SELECT sobre la tabla subyacente', :'uid_a');
grant select on e13_core.item to authenticated;

\echo ''
\echo '=== AISLAMIENTO · con el conjunto completo ==='
select pg_temp.ver('usuario A (miembro)',      :'uid_a');
select pg_temp.ver('usuario B (NO miembro)',   :'uid_b');
select pg_temp.ver('sin sesion (uid nulo)',    null);

\echo ''
\echo '=== La RLS se evalua con auth.uid() de quien consulta ==='
do $$
declare quien text; visto int; total int; reclamos text;
begin
  -- Se lee auth.users ANTES de cambiar de rol: `authenticated` no puede leerla.
  select json_build_object('sub', id::text, 'role', 'authenticated')::text
    into reclamos from auth.users where email='e13-a@probe.local';
  set local role authenticated;
  perform set_config('request.jwt.claims', reclamos, true);
  select auth.uid()::text into quien;
  select count(*) into visto from e13_api.item_v;
  reset role;
  select count(*) into total from e13_core.item;
  raise notice 'auth.uid() dentro de la consulta = %', quien;
  raise notice 'filas vistas por la vista = %  ·  filas reales en la tabla = %', visto, total;
end $$;
