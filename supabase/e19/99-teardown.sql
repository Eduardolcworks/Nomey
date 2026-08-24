-- E19 · Retirada completa. Debe devolver 0 en las cuatro comprobaciones.
--
-- Los grants a `authenticated` se van con los schemas al hacer DROP CASCADE,
-- pero se comprueba explicitamente que no queda ninguno colgando.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off

drop schema if exists e19_api  cascade;
drop schema if exists e19_core cascade;

\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'relaciones e19' as objeto,
       count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname like 'e19%' or c.relname like 'e19\_%'
union all
select 'schemas e19',
       count(*) from pg_namespace where nspname like 'e19%'
union all
select 'funciones e19',
       count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname like 'e19%'
union all
select 'default_acl globales',
       count(*) from pg_default_acl where defaclnamespace = 0
union all
select 'grants e19 a authenticated',
       count(*) from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema like 'e19%';
