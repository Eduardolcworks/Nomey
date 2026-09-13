-- ============================================================================
-- SI UN PARTICIPANTE TIENE CUENTA: un booleano, y nada mas.
-- ============================================================================
--
-- Saldos distingue a quien esta vinculado a una cuenta de quien fue declarado
-- por su nombre. Lo que hacia falta era el DATO, y no existia: `is_self` dice
-- si ese participante es quien mira, `is_active` si esta en el grupo —y un
-- participante sin cuenta puede estar activo para el reparto—, y ninguno de
-- los dos dice si hay una cuenta detras.
--
-- `core.participant_user_link` no es legible por el cliente (ADR-012 §1): el
-- vinculo revelaria QUE cuenta hay detras de una identidad contextual. Un
-- booleano no revela eso: dice que hay una, no cual. Sale por un definer
-- REDUCIDO como `sec.participant_presence` —mismo owner, misma guardia de
-- membresia sobre el ambito, una columna—, y la vista lo publica al final,
-- para no recrear lo que depende de ella.
--
-- No es `is_self`, no se deduce del nombre ni de la presencia, y no cambia
-- identidades, presencias, reclamacion ni saldos: es una lectura.

create function sec.participant_is_linked(p_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from core.participant p
      join core.participant_user_link l on l.participant_id = p.id
     where p.id = p_participant
       and sec.is_member(p.scope_id)
  );
$fn$;

revoke execute on function sec.participant_is_linked(uuid) from public;
grant execute on function sec.participant_is_linked(uuid) to authenticated;

comment on function sec.participant_is_linked(uuid) is
  'Si el participante tiene una cuenta vinculada. Solo el hecho, nunca cual, y '
  'solo sobre ambitos de los que el actor es miembro.';

create or replace view api.group_participant
with (security_invoker = true) as
select p.id            as participant_id,
       p.scope_id,
       p.display_name,
       p.created_at,
       sec.is_my_participant(p.id) as is_self,
       coalesce(pr.is_active, false) as is_active,
       pr.eligible_until,
       exists (select 1 from core.participant_retirement r where r.participant_id = p.id) as is_retired,
       -- Al FINAL: create or replace no admite mover ni quitar columnas.
       sec.participant_is_linked(p.id) as is_linked
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr on true
 where s.kind = 'group';
