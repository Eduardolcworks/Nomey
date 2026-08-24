-- E19-A · Matriz de propiedad: ¿introduce la cadena un bypass por ownership?
--
-- E13 midio UN nivel y observo que una vista ejecutada como su propietario NO
-- aplica la RLS de la tabla. Con DOS niveles hay cuatro combinaciones, y no se
-- puede suponer cual gana. Se miden las cuatro, mas el caso de E13 como control
-- para demostrar que este montaje SI es capaz de filtrar.
--
-- Todas las relaciones las posee `postgres`, que es propietario de las tablas y
-- por tanto salta la RLS cuando la consulta se ejecuta con su identidad.
--
-- NO ES UNA MIGRACION.

\pset pager off
\set QUIET on
select id as uid_a from auth.users where email='e19-a@probe.local' \gset
\set QUIET off

begin;

-- Nivel interno en las dos variantes.
create view e19_core.current_effect_owner as
  select e.id, e.scope_id, e.amount_minor
  from   e19_core.effect e
  join   e19_core.operation_version v on v.id = e.operation_version_id
  join   e19_core.operation o         on o.id = v.operation_id
  where  o.current_version_id = v.id;

-- Las cuatro combinaciones externo x interno.
create view e19_api.m_inv_inv with (security_invoker = true) as
  select id, scope_id, amount_minor from e19_core.current_effect;
create view e19_api.m_own_inv as
  select id, scope_id, amount_minor from e19_core.current_effect;
create view e19_api.m_inv_own with (security_invoker = true) as
  select id, scope_id, amount_minor from e19_core.current_effect_owner;
create view e19_api.m_own_own as
  select id, scope_id, amount_minor from e19_core.current_effect_owner;

-- CONTROL · la forma que E13 midio: vista propietario directamente sobre la
-- tabla, sin nivel intermedio. Si esta NO filtra, el montaje no puede filtrar y
-- los resultados de arriba no significarian nada.
create view e19_api.control_own_tabla as
  select id, scope_id, amount_minor from e19_core.effect;
create view e19_api.control_inv_tabla with (security_invoker = true) as
  select id, scope_id, amount_minor from e19_core.effect;

commit;

grant usage on schema e19_api, e19_core to authenticated;
grant select on all tables in schema e19_api  to authenticated;
grant select on all tables in schema e19_core to authenticated;

create or replace function pg_temp.ver(etiqueta text, rel text, uid uuid) returns text
language plpgsql as $$
declare n int; importes text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    case when uid is null then '{"role":"authenticated"}'
         else json_build_object('sub', uid::text, 'role', 'authenticated')::text end, true);
  execute format('select count(*), coalesce(string_agg(amount_minor::text, '' | '' order by amount_minor), ''(ninguno)'') from %s', rel)
    into n, importes;
  reset role;
  return rpad(etiqueta, 40) || ' -> ' || n || ' fila(s): ' || importes;
exception when others then
  reset role;
  return rpad(etiqueta, 40) || ' -> ' || sqlstate || ' ' || sqlerrm;
end $$;

\echo ''
\echo '=== CONTROL · un solo nivel, como en E13 ==='
\echo '    A es miembro de un solo ambito. La tabla tiene 3 efectos en total.'
select pg_temp.ver('vista INVOKER sobre la tabla', 'e19_api.control_inv_tabla', :'uid_a');
select pg_temp.ver('vista PROPIETARIO sobre la tabla', 'e19_api.control_own_tabla', :'uid_a');

\echo ''
\echo '=== MATRIZ · externo x interno, con A ==='
\echo '    Esperado si la RLS aguanta: 1 fila (7500). Si se salta: hasta 3.'
select pg_temp.ver('externo INVOKER · interno INVOKER', 'e19_api.m_inv_inv', :'uid_a');
select pg_temp.ver('externo PROPIET. · interno INVOKER', 'e19_api.m_own_inv', :'uid_a');
select pg_temp.ver('externo INVOKER · interno PROPIET.', 'e19_api.m_inv_own', :'uid_a');
select pg_temp.ver('externo PROPIET. · interno PROPIET.', 'e19_api.m_own_own', :'uid_a');

\echo ''
\echo '=== MATRIZ · sin sesion (uid nulo) ==='
select pg_temp.ver('externo INVOKER · interno INVOKER', 'e19_api.m_inv_inv', null);
select pg_temp.ver('externo PROPIET. · interno INVOKER', 'e19_api.m_own_inv', null);
select pg_temp.ver('externo INVOKER · interno PROPIET.', 'e19_api.m_inv_own', null);
select pg_temp.ver('externo PROPIET. · interno PROPIET.', 'e19_api.m_own_own', null);
select pg_temp.ver('control PROPIETARIO sobre la tabla', 'e19_api.control_own_tabla', null);
