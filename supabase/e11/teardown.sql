-- E11 · Retirada completa del sondeo.
--
-- Deja la base de datos como estaba antes de aplicar probe.sql y layers.sql.
-- Es idempotente: puede ejecutarse aunque el sondeo no esté aplicado.

begin;

drop function if exists public.e11_probe_json(integer);
drop function if exists public.e11_probe_raw_bigint(integer);

drop view if exists public.e11_probe_text;

drop table if exists public.e11_probe;
drop table if exists public.e11_writeback;
drop table if exists public.e11_l3_no_grant;
drop table if exists public.e11_l4_rls_sin_politica;
drop table if exists public.e11_l4_rls_con_politica;

drop schema if exists e11_hidden cascade;

commit;

-- Comprobación: no debe quedar ningún objeto e11_*.
select
  n.nspname as schema,
  c.relname as objeto,
  c.relkind as tipo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relname like 'e11%' or n.nspname like 'e11%';
