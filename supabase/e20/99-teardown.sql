-- E20 · Teardown. Retira todo lo que creo el experimento y lo comprueba.
--
-- NO ES UNA MIGRACION.

\pset pager off

begin;

drop schema if exists e20_api  cascade;
drop schema if exists e20_sec  cascade;
drop schema if exists e20_core cascade;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'e20_writer') then
    execute 'drop owned by e20_writer cascade';
    execute 'revoke e20_writer from postgres';
    execute 'drop role e20_writer';
  end if;
end $$;

commit;

\echo ''
\echo '=== residuos: todo debe ser 0 ==='
select 'relaciones e20_*' as que,
       count(*) as n
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname like 'e20\_%'
union all
select 'schemas e20_*', count(*) from pg_namespace where nspname like 'e20\_%'
union all
select 'funciones e20_*', count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname like 'e20\_%'
union all
select 'politicas e20_*', count(*)
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname like 'e20\_%'
union all
select 'rol e20_writer', count(*) from pg_roles where rolname = 'e20_writer'
union all
select 'grants residuales del writer', count(*)
from information_schema.table_privileges where grantee = 'e20_writer';
