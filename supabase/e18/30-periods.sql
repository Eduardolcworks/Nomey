-- E18-B · Periodos de presencia del participante.
--
-- Carlos entra, sale y vuelve: DOS periodos, UNA sola identidad.
--
-- NO ES UNA MIGRACION.

\pset pager off

delete from e18_participant_period;

-- P123: periodo 1 cerrado, periodo 2 abierto.
insert into e18_participant_period(id, participant_id, valid_from, valid_until) values
  ('11111111-0000-0000-0000-00000000aaaa','c1230000-0000-0000-0000-000000000123','2026-01-01','2026-03-01'),
  ('22222222-0000-0000-0000-00000000bbbb','c1230000-0000-0000-0000-000000000123','2026-06-01', null);

\echo ''
\echo '=== periodos de P123: una sola identidad, dos periodos ==='
select valid_from, coalesce(valid_until::text,'(abierto)') as valid_until, period::text
from e18_participant_period
where participant_id = 'c1230000-0000-0000-0000-000000000123'
order by valid_from;

\echo ''
\echo '=== elegibilidad por fecha efectiva ==='
select f.fecha,
       exists (select 1 from e18_participant_period p
               where p.participant_id = 'c1230000-0000-0000-0000-000000000123'
                 and p.period @> f.fecha) as elegible,
       f.esperado
from (values (date '2026-02-01', true),   -- dentro del periodo 1
             (date '2026-04-15', false),  -- entre ambos: fuera
             (date '2026-09-01', true))   -- dentro del periodo 2, abierto
     as f(fecha, esperado)
order by f.fecha;

\echo ''
\echo '=== ¿Se puede impedir el solape SIN extension? ==='
do $$
begin
  execute 'alter table e18_participant_period
             add constraint e18_period_sin_solape
             exclude using gist (participant_id with =, period with &&)';
  raise notice 'EXCLUDE creada sin extension -> INESPERADO';
exception when others then
  raise notice 'EXCLUDE sin btree_gist -> % : %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo '=== Coste medido de la alternativa declarativa ==='
select name, default_version, coalesce(installed_version,'(NO instalada)') as instalada
from pg_available_extensions where name = 'btree_gist';

create extension if not exists btree_gist;
alter table e18_participant_period
  add constraint e18_period_sin_solape
  exclude using gist (participant_id with =, period with &&);
\echo 'EXCLUDE creada CON btree_gist instalada'

do $$
begin
  insert into e18_participant_period(id, participant_id, valid_from, valid_until)
  values (gen_random_uuid(),'c1230000-0000-0000-0000-000000000123','2026-02-01','2026-02-15');
  raise notice 'periodo SOLAPADO -> INESPERADO: aceptado';
exception when others then
  raise notice 'periodo SOLAPADO -> rechazado (%)', sqlstate;
end $$;

do $$
begin
  insert into e18_participant_period(id, participant_id, valid_from, valid_until)
  values (gen_random_uuid(),'c4560000-0000-0000-0000-000000000456','2026-02-01','2026-02-15');
  raise notice 'periodo de OTRO participante en las mismas fechas -> aceptado (correcto)';
exception when others then
  raise notice 'periodo de OTRO participante -> INESPERADO: % %', sqlstate, sqlerrm;
end $$;

-- Se retira: instalar una extension no es una decision de este sondeo.
alter table e18_participant_period drop constraint e18_period_sin_solape;
drop extension if exists btree_gist;
\echo ''
\echo '=== btree_gist retirada: el sondeo no deja la instalacion alterada ==='
select coalesce(installed_version,'(NO instalada)') as btree_gist
from pg_available_extensions where name = 'btree_gist';
