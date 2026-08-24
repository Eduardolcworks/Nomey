-- E18-A · ¿Representan las constraints los invariantes, o solo los comentarios?
--
-- Escenario: dos scopes. En el A hay P123 y P456; en el B hay P789.
--
-- NO ES UNA MIGRACION.

\pset pager off

delete from e18_participant_period;
delete from e18_participant_user_link;
delete from e18_participant;
delete from e18_user;
delete from e18_scope;

insert into e18_scope values
  ('aaaa0000-0000-0000-0000-000000000001','Grupo A'),
  ('bbbb0000-0000-0000-0000-000000000002','Grupo B');

insert into e18_user values
  ('11110000-0000-0000-0000-000000000001','U1 Carlos'),
  ('22220000-0000-0000-0000-000000000002','U2 Otro');

insert into e18_participant values
  ('c1230000-0000-0000-0000-000000000123','aaaa0000-0000-0000-0000-000000000001','P123 Carlos'),
  ('c4560000-0000-0000-0000-000000000456','aaaa0000-0000-0000-0000-000000000001','P456 Otro nombre'),
  ('c7890000-0000-0000-0000-000000000789','bbbb0000-0000-0000-0000-000000000002','P789 Carlos en B');

create or replace function pg_temp.intenta(etiqueta text, sql text) returns text
language plpgsql as $$
begin
  execute sql;
  return etiqueta || ' -> ACEPTADO';
exception when others then
  return etiqueta || ' -> RECHAZADO (' || sqlstate || ') ' ||
         coalesce((select conname from pg_constraint
                   where conname = split_part(split_part(sqlerrm,'"',2),'"',1)), sqlerrm);
end $$;

\echo ''
\echo '===== A1 · P123 sin usuario, U1 lo reclama ====='
select pg_temp.intenta('A1 · U1 reclama P123',
  $q$insert into e18_participant_user_link(participant_id, scope_id, user_id)
     values ('c1230000-0000-0000-0000-000000000123','aaaa0000-0000-0000-0000-000000000001',
             '11110000-0000-0000-0000-000000000001')$q$);

\echo ''
\echo '===== A2 · U2 intenta reclamar P123 despues ====='
select pg_temp.intenta('A2 · U2 reclama P123 ya reclamado',
  $q$insert into e18_participant_user_link(participant_id, scope_id, user_id)
     values ('c1230000-0000-0000-0000-000000000123','aaaa0000-0000-0000-0000-000000000001',
             '22220000-0000-0000-0000-000000000002')$q$);

\echo ''
\echo '===== A3 · U1 intenta reclamar tambien P456, en el MISMO scope ====='
select pg_temp.intenta('A3 · U1 reclama P456 en scope A',
  $q$insert into e18_participant_user_link(participant_id, scope_id, user_id)
     values ('c4560000-0000-0000-0000-000000000456','aaaa0000-0000-0000-0000-000000000001',
             '11110000-0000-0000-0000-000000000001')$q$);

\echo ''
\echo '===== A4 · U1 reclama P789 en OTRO scope ====='
select pg_temp.intenta('A4 · U1 reclama P789 en scope B',
  $q$insert into e18_participant_user_link(participant_id, scope_id, user_id)
     values ('c7890000-0000-0000-0000-000000000789','bbbb0000-0000-0000-0000-000000000002',
             '11110000-0000-0000-0000-000000000001')$q$);

\echo ''
\echo '===== A6 · vinculo con un scope_id que NO es el del participant ====='
select pg_temp.intenta('A6 · P456 (scope A) declarado en scope B',
  $q$insert into e18_participant_user_link(participant_id, scope_id, user_id)
     values ('c4560000-0000-0000-0000-000000000456','bbbb0000-0000-0000-0000-000000000002',
             '22220000-0000-0000-0000-000000000002')$q$);

\echo ''
\echo '=== vinculos resultantes ==='
select p.display_name as participante, s.name as scope, u.name as usuario
from e18_participant_user_link l
join e18_participant p on p.id = l.participant_id
join e18_scope s on s.id = l.scope_id
join e18_user u on u.id = l.user_id
order by s.name, p.display_name;
