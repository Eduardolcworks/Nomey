-- E17-C · ¿Distingue el catalogo una policy creada SIN `TO` de una creada
-- explicitamente `TO PUBLIC`?
--
-- Importa porque el test futuro no debe intentar reconstruir la sintaxis
-- original: debe comprobar la SEMANTICA efectiva.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off
begin;

drop table if exists e17_policy_probe cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'e17_writer') then
    execute 'drop owned by e17_writer cascade';
    execute 'drop role e17_writer';
  end if;
end $$;

create role e17_writer nologin nobypassrls nosuperuser;

create table e17_policy_probe (id int primary key, dato text);
alter table e17_policy_probe enable row level security;

-- Sin clausula TO.
create policy p_sin_to on e17_policy_probe for select using (true);
-- Con TO PUBLIC explicito.
create policy p_to_public on e17_policy_probe for select to public using (true);
-- Con un rol concreto.
create policy p_to_writer on e17_policy_probe for select to e17_writer using (true);
-- Con dos roles.
create policy p_to_dos on e17_policy_probe for select to e17_writer, authenticated using (true);

commit;

\echo ''
\echo '=== Como guarda el catalogo cada policy ==='
select polname,
       polroles::text as polroles_crudo,
       case when 0 = any(polroles) then 'PUBLIC (todos los roles)'
            else (select string_agg(r.rolname, ', ')
                  from unnest(polroles) o join pg_roles r on r.oid = o) end as aplicable_a
from pg_policy
where polrelid = 'e17_policy_probe'::regclass
order by polname;

\echo ''
\echo '=== ¿Son p_sin_to y p_to_public indistinguibles? ==='
select case when (select polroles from pg_policy where polname='p_sin_to')
              = (select polroles from pg_policy where polname='p_to_public')
            then 'SI: identicas en catalogo. La sintaxis original NO es recuperable'
            else 'NO: el catalogo las distingue' end as veredicto;

\echo ''
\echo '=== La consulta que un test deberia hacer: policies aplicables a PUBLIC ==='
\echo '    Se usa 0 = ANY(polroles) y NO la igualdad exacta con {0}: expresa el'
\echo '    invariante -PUBLIC esta entre los roles aplicables- sin depender de'
\echo '    como PostgreSQL represente hoy esa lista.'
select polname as policy_aplicable_a_public
from pg_policy
where polrelid = 'e17_policy_probe'::regclass and 0 = any(polroles)
order by 1;

\echo ''
\echo '=== ¿Admite PostgreSQL PUBLIC junto a otro rol en la misma policy? ==='
create policy p_mixta on e17_policy_probe for select to public, authenticated using (true);
select polname, polroles::text as polroles,
       (polroles = '{0}')  as igualdad_exacta,
       (0 = any(polroles)) as any_public
from pg_policy
where polrelid = 'e17_policy_probe'::regclass and polname = 'p_mixta';

\echo ''
\echo '=== ¿Hereda el writer las policies de authenticated? ==='
select 'e17_writer es miembro de authenticated: ' ||
       case when pg_has_role('e17_writer','authenticated','MEMBER')
            then 'SI  <-- heredaria sus policies'
            else 'NO  <-- no las hereda' end as pertenencia
union all
select 'e17_writer hereda privilegios (rolinherit): ' || rolinherit::text
from pg_roles where rolname = 'e17_writer';
