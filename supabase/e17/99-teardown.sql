-- E17 · Retirada completa. Idempotente. NO ES UNA MIGRACION.
--
-- El borrado va dentro de una transaccion: la FK del puntero de vigencia es
-- DEFERRABLE INITIALLY DEFERRED y confirmar cada sentencia por separado la
-- violaria.

\pset pager off

begin;
drop table if exists e17_policy_probe      cascade;
drop table if exists e17_client_command    cascade;
drop table if exists e17_effect            cascade;
drop table if exists e17_operation_version cascade;
drop table if exists e17_operation         cascade;
commit;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'e17_writer') then
    -- Hay que ser MIEMBRO del rol para soltar lo que posee: `postgres` no es
    -- superusuario en este stack. Sin esto falla con
    -- `permission denied to drop objects` [medido, igual que en E16].
    execute 'grant e17_writer to postgres';
    execute 'drop owned by e17_writer cascade';
    execute 'revoke e17_writer from postgres';
    execute 'drop role e17_writer';
  end if;
end $$;

\echo ''
\echo '=== Comprobacion: todo debe devolver 0 ==='
select 'relaciones e17' as objeto, count(*) from pg_class     where relname like 'e17%'
union all
select 'roles e17',       count(*) from pg_roles    where rolname like 'e17%'
union all
select 'policies e17',    count(*) from pg_policy   where polname like 'p_%'
                                     and polrelid::regclass::text like 'e17%'
union all
select 'default_acl globales', count(*) from pg_default_acl where defaclnamespace = 0;
