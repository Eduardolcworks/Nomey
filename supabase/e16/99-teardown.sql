-- E16 · Retirada completa. Idempotente. NO ES UNA MIGRACION.

\pset pager off

drop function if exists public.e16_probe();
drop schema if exists e16_api  cascade;
drop schema if exists e16_core cascade;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'e16_writer') then
    -- `drop owned by` retira tambien los privilegios concedidos AL rol.
    execute 'drop owned by e16_writer cascade';
    execute 'revoke e16_writer from postgres';
    execute 'drop role e16_writer';
  end if;
end $$;

notify pgrst, 'reload schema';

\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'schemas e16'   as objeto, count(*) from pg_namespace where nspname like 'e16%'
union all
select 'relaciones e16', count(*) from pg_class  where relname like 'e16%'
union all
select 'funciones e16',  count(*) from pg_proc   where proname like 'e16%'
union all
select 'roles e16',      count(*) from pg_roles  where rolname like 'e16%'
union all
select 'usuarios e16',   count(*) from auth.users where email like 'e16-%'
union all
select 'default_acl globales', count(*) from pg_default_acl where defaclnamespace = 0;
