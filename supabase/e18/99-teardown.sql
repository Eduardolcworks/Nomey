-- E18 · Retirada completa. Idempotente. NO ES UNA MIGRACION.

\pset pager off

drop table if exists e18_participant_period    cascade;
drop table if exists e18_participant_user_link cascade;
drop table if exists e18_participant           cascade;
drop table if exists e18_user                  cascade;
drop table if exists e18_scope                 cascade;

-- El sondeo instala btree_gist temporalmente y la retira en 30-periods.sql.
-- Aqui se comprueba que no quedo instalada por un fallo a medio camino.
\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'relaciones e18' as objeto, count(*) from pg_class where relname like 'e18%'
union all
select 'btree_gist instalada', count(*) from pg_extension where extname = 'btree_gist'
union all
select 'default_acl globales', count(*) from pg_default_acl where defaclnamespace = 0;
