-- E12 · Privilegio LISTADO frente a privilegio EFECTIVO.
--
-- Tres instrumentos distintos sobre los mismos objetos:
--   information_schema.role_table_grants  -> vista SQL estandar
--   pg_class.relacl + aclexplode          -> la ACL real de PostgreSQL
--   has_table_privilege()                 -> privilegio efectivo resuelto
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo '=== 1 · information_schema.role_table_grants (lo que vio E11) ==='
select
  table_schema, table_name, grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_name like 'e12%'
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by 1, 2, 3
order by 1, 2, 3;

\echo ''
\echo '=== 2 · relacl real de cada objeto (NULL = solo el owner) ==='
select
  n.nspname, c.relname, c.relkind,
  c.relowner::regrole::text as owner,
  coalesce(c.relacl::text, '(NULL: solo el owner)') as relacl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (c.relname like 'e12%' or n.nspname like 'e12%') and c.relkind in ('r','S','v')
order by 1, 2;

\echo ''
\echo '=== 3 · relacl desglosada con aclexplode ==='
select
  n.nspname, c.relname,
  coalesce(a.grantee::regrole::text, 'PUBLIC') as beneficiario,
  string_agg(a.privilege_type, ', ' order by a.privilege_type) as privilegios
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where (c.relname like 'e12%' or n.nspname like 'e12%') and c.relkind in ('r','S')
group by 1, 2, 3
order by 1, 2, 3;

\echo ''
\echo '=== 4 · has_table_privilege: privilegio EFECTIVO, incluido MAINTAIN ==='
select
  t.tbl as tabla,
  r.rol,
  has_table_privilege(r.rol, t.tbl, 'SELECT')     as sel,
  has_table_privilege(r.rol, t.tbl, 'INSERT')     as ins,
  has_table_privilege(r.rol, t.tbl, 'UPDATE')     as upd,
  has_table_privilege(r.rol, t.tbl, 'DELETE')     as del,
  has_table_privilege(r.rol, t.tbl, 'TRUNCATE')   as trunc,
  has_table_privilege(r.rol, t.tbl, 'REFERENCES') as refs,
  has_table_privilege(r.rol, t.tbl, 'TRIGGER')    as trig,
  has_table_privilege(r.rol, t.tbl, 'MAINTAIN')   as maint
from (values
        ('public.e12_public_plain'),
        ('public.e12_public_rls'),
        ('public.e12_public_serial'),
        ('e12_internal.e12_internal_plain'),
        ('e12_playground.e12_trigger_log')
     ) as t(tbl)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
order by 1, 2;

\echo ''
\echo '=== 5 · Secuencias: privilegio efectivo ==='
select
  s.seq, r.rol,
  has_sequence_privilege(r.rol, s.seq, 'USAGE')  as usage,
  has_sequence_privilege(r.rol, s.seq, 'SELECT') as select_,
  has_sequence_privilege(r.rol, s.seq, 'UPDATE') as update_
from (values ('public.e12_public_serial_id_seq')) as s(seq)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
order by 1, 2;

\echo ''
\echo '=== 6 · Funciones: EXECUTE efectivo, incluido el pseudo-rol PUBLIC ==='
select
  f.fn, r.rol,
  has_function_privilege(r.rol, f.fn, 'EXECUTE') as execute_
from (values
        ('public.e12_public_fn()'),
        ('e12_internal.e12_internal_fn()'),
        ('e12_playground.e12_usable_fn()')
     ) as f(fn)
cross join (values ('anon'), ('authenticated'), ('service_role'), ('public')) as r(rol)
order by 1, 2;

\echo ''
\echo '=== 7 · proacl real de cada funcion (NULL = default de PostgreSQL) ==='
select
  n.nspname, p.proname,
  coalesce(p.proacl::text, '(NULL: default de PostgreSQL)') as proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname like 'e12%'
order by 1, 2;

\echo ''
\echo '=== 8 · USAGE efectivo sobre cada schema ==='
select
  s.nsp, r.rol,
  has_schema_privilege(r.rol, s.nsp, 'USAGE')  as usage_,
  has_schema_privilege(r.rol, s.nsp, 'CREATE') as create_
from (values ('public'), ('e12_internal'), ('e12_playground')) as s(nsp)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
order by 1, 2;
