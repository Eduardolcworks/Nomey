-- E12 · Retirada completa. Idempotente.
--
-- Debe dejar CERO objetos `e12*` y CERO usuarios de sondeo. Termina imprimiendo
-- la comprobacion, que debe devolver 0 en todas las filas.
--
-- NO ES UNA MIGRACION.

\pset pager off

drop trigger if exists e12_spy_trg on public.e12_public_plain;

drop schema if exists e12_internal   cascade;
drop schema if exists e12_playground cascade;

drop table if exists public.e12_public_plain  cascade;
drop table if exists public.e12_public_rls    cascade;
drop table if exists public.e12_public_serial cascade;
drop table if exists public.e12_recursion     cascade;

drop function if exists public.e12_public_fn();
drop function if exists public.e12_tmp_fn();

-- Usuario de sondeo creado por `40-data-api.mjs`, por si el script no llego a
-- borrarlo. Se borra por email, nunca por barrido.
delete from auth.users where email = 'e12-probe@example.com';

\echo '=== COMPROBACION DE TEARDOWN · todo debe ser 0 ==='
select 'relaciones e12*'  as que, count(*) as quedan
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relname like 'e12%' or n.nspname like 'e12%'
union all
select 'schemas e12*', count(*) from pg_namespace where nspname like 'e12%'
union all
select 'funciones e12*', count(*) from pg_proc where proname like 'e12%'
union all
select 'triggers e12*', count(*) from pg_trigger where tgname like 'e12%'
union all
select 'politicas e12*', count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'e12%'
union all
select 'usuarios de sondeo', count(*) from auth.users where email like 'e12-%'
union all
select 'tipos e12*', count(*) from pg_type where typname like 'e12%'
order by 1;

\echo ''
\echo '=== La configuracion heredada NO se toca: sigue igual que al empezar ==='
select d.defaclrole::regrole::text as creador, n.nspname, d.defaclobjtype, d.defaclacl::text
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public' order by 1, 3;
