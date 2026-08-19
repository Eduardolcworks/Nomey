-- E11 · Valor REAL almacenado en PostgreSQL.
--
-- Se ejecuta contra la base de datos directamente, sin pasar por PostgREST ni
-- por JavaScript. Es la verdad de referencia contra la que se comparan las
-- lecturas de la frontera.

\echo '=== e11_probe: valor exacto y su representacion textual ==='
select
  id,
  v_bigint,
  v_bigint::text     as bigint_text,
  v_numeric::text    as numeric_text,
  v_numeric_ps::text as numeric_ps_text,
  v_text
from public.e11_probe
order by id;

\echo ''
\echo '=== e11_probe: tipos declarados de cada columna ==='
select column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public' and table_name = 'e11_probe'
order by ordinal_position;

\echo ''
\echo '=== e11_writeback: que se almaceno realmente tras la escritura ==='
select
  id,
  note,
  v_bigint,
  v_bigint::text as bigint_text,
  v_numeric_ps::text as numeric_ps_text
from public.e11_writeback
order by id;

\echo ''
\echo '=== e11_writeback: comprobacion de exactitud ==='
select
  id,
  note,
  v_bigint,
  case
    when v_bigint = 9007199254740993  then 'EXACTO (2^53+1)'
    when v_bigint = 9007199254740992  then 'DEGRADADO a 2^53'
    when v_bigint = 9223372036854775807 then 'EXACTO (int64 max)'
    else 'otro'
  end as veredicto
from public.e11_writeback
order by id;

\echo ''
\echo '=== Grants efectivos sobre los objetos del sondeo ==='
select
  table_schema,
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_name like 'e11%'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_schema, table_name, grantee
order by table_schema, table_name, grantee;

\echo ''
\echo '=== RLS y politicas de los objetos del sondeo ==='
select
  c.relname as tabla,
  c.relrowsecurity as rls_activada,
  coalesce(count(p.polname), 0) as num_politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where c.relname like 'e11%' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;
