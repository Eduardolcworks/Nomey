-- E14 · Retirada completa. Idempotente.
--
-- NO ES UNA MIGRACION.

\pset pager off

drop function if exists public.e14_echo_text(text);
drop function if exists public.e14_echo_jsonb(jsonb);

notify pgrst, 'reload schema';

\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'funciones e14'  as objeto, count(*) from pg_proc      where proname like 'e14%'
union all
select 'relaciones e14',  count(*) from pg_class     where relname like 'e14%'
union all
select 'schemas e14',     count(*) from pg_namespace where nspname like 'e14%'
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
