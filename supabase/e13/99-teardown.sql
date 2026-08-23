-- E13 · Retirada completa. Idempotente.
--
-- Los usuarios de prueba se borran con 98-users-teardown.mjs, porque viven en
-- `auth` y los gestiona GoTrue.
--
-- NO ES UNA MIGRACION.

\pset pager off

drop schema if exists e13_api  cascade;
drop schema if exists e13_sec  cascade;
drop schema if exists e13_core cascade;

\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'schemas e13'    as objeto, count(*) from pg_namespace where nspname like 'e13%'
union all
select 'relaciones e13',  count(*) from pg_class     where relname  like 'e13%'
union all
select 'funciones e13',   count(*) from pg_proc      where proname  like 'e13%'
union all
select 'politicas e13',   count(*) from pg_policy    where polname  like 'p_item%'
                                                        or polname  like 'p_membership%'
union all
select 'usuarios e13',    count(*) from auth.users   where email    like 'e13-%'
union all
select 'default_acl globales', count(*) from pg_default_acl where defaclnamespace = 0;

\echo ''
\echo '=== La configuracion heredada de public NO se toca: debe seguir igual ==='
select d.defaclrole::regrole::text as creador,
       d.defaclobjtype,
       d.defaclacl::text
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public'
order by 1, 2;
