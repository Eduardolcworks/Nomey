-- E12 · Linea base: configuracion que ya existe ANTES de crear ningun objeto.
--
-- Responde a las preguntas 2 y 3 de D4: que trae PostgreSQL de fabrica y que
-- anade la plantilla de Supabase. No crea nada.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo '=== 1 · Default privileges instalados (pg_default_acl) ==='
\echo 'Clave: quien los creo (defaclrole) y sobre que schema (defaclnamespace).'
select
  d.defaclrole::regrole::text            as creador,
  coalesce(n.nspname, '(sin schema)')    as schema,
  case d.defaclobjtype
    when 'r' then 'tablas/vistas'
    when 'S' then 'secuencias'
    when 'f' then 'funciones'
    when 'T' then 'tipos'
    when 'n' then 'schemas'
  end                                    as tipo_objeto,
  d.defaclacl::text                      as acl
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
where coalesce(n.nspname, '') in ('public', '')
order by 1, 3;

\echo ''
\echo '=== 2 · Los mismos default privileges, desglosados por rol y privilegio ==='
select
  d.defaclrole::regrole::text as creador,
  n.nspname                   as schema,
  d.defaclobjtype             as objtype,
  coalesce(a.grantee::regrole::text, 'PUBLIC') as beneficiario,
  a.privilege_type
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
where n.nspname = 'public'
  and coalesce(a.grantee::regrole::text, 'PUBLIC') in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by 3, 4, 5;

\echo ''
\echo '=== 3 · ACL del schema public y de los schemas vecinos ==='
select
  n.nspname,
  n.nspowner::regrole::text as owner,
  coalesce(n.nspacl::text, '(NULL: solo el owner)') as acl
from pg_namespace n
where n.nspname in ('public', 'auth', 'extensions', 'graphql_public', 'storage')
order by 1;

\echo ''
\echo '=== 4 · Atributos de los roles implicados ==='
\echo 'rolcanlogin decide si el rol puede abrir una conexion SQL directa.'
\echo 'rolbypassrls decide si la RLS se le aplica.'
select rolname, rolsuper, rolinherit, rolcanlogin, rolbypassrls
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres', 'supabase_admin')
order by 1;

\echo ''
\echo '=== 5 · Pertenencia de roles: de quien heredan anon y authenticated ==='
select
  m.roleid::regrole::text  as rol_concedido,
  m.member::regrole::text  as miembro,
  m.inherit_option
from pg_auth_members m
where m.roleid::regrole::text in ('anon', 'authenticated', 'service_role')
   or m.member::regrole::text in ('anon', 'authenticated', 'service_role')
order by 1, 2;

\echo ''
\echo '=== 6 · Vocabulario de privilegios que conoce information_schema ==='
\echo 'Si MAINTAIN no aparece aqui, una auditoria basada en information_schema no lo ve.'
select distinct privilege_type from information_schema.table_privileges order by 1;

\echo ''
\echo '=== 7 · Event triggers instalados ==='
select evtname, evtevent, evtenabled, evtfoid::regprocedure::text as funcion
from pg_event_trigger order by 1;
