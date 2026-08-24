-- E15 · Retirada completa. Idempotente. NO ES UNA MIGRACION.

\pset pager off

drop function if exists public.e15_raise_default();
drop function if exists public.e15_raise_p0001();
drop function if exists public.e15_raise_privilege();
drop function if exists public.e15_raise_unique();
drop function if exists public.e15_raise_check();
drop function if exists public.e15_raise_pgrst();
drop function if exists public.e15_settle(text, bigint);
drop table if exists public.e15_debt_effect;
drop table if exists public.e15_scope;
drop table if exists public.e15_op;

notify pgrst, 'reload schema';

\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'funciones e15' as objeto, count(*) from pg_proc      where proname like 'e15%'
union all
select 'relaciones e15',  count(*) from pg_class     where relname like 'e15%'
union all
select 'schemas e15',     count(*) from pg_namespace where nspname like 'e15%'
union all
select 'default_acl globales', count(*) from pg_default_acl where defaclnamespace = 0;

\echo ''
\echo '=== La configuracion heredada de public NO se toca ==='
select d.defaclrole::regrole::text as creador, d.defaclobjtype, d.defaclacl::text
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public' order by 1, 2;
