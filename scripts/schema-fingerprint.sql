-- Huella del esquema autoritativo (api, sec, core): funciones (cuerpo),
-- vistas (definicion), tablas (columnas y tipos), policies, grants. Ordenada
-- para poder compararla entre dos bases con diff.
\pset pager off
\t on
\a
select 'FUNCTION ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') owner=' || pg_get_userbyid(p.proowner) || ' secdef=' || p.prosecdef || E'\n' || pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('api', 'sec') order by 1;
select 'VIEW ' || n.nspname || '.' || c.relname || E'\n' || pg_get_viewdef(c.oid, true)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v' and n.nspname in ('api', 'core') order by 1;
select 'TABLE ' || table_schema || '.' || table_name || ' ' || column_name || ' ' || data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '')
  from information_schema.columns where table_schema in ('core', 'sec') order by 1;
select 'POLICY ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' roles=' || roles::text || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
  from pg_policies where schemaname in ('core', 'api', 'sec') order by 1;
select 'GRANT ' || table_schema || '.' || table_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.role_table_grants where table_schema in ('api', 'core', 'sec') and grantee in ('authenticated', 'anon', 'nomey_writer', 'nomey_provisioner') order by 1;
select 'CONSTRAINT ' || n.nspname || '.' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('core', 'sec') order by 1;
