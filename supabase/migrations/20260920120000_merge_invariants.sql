-- ============================================================================
-- LOS DOS CIERRES DE F10/ADR-004 · bloque F10.C0
-- ============================================================================
--
-- F10/ADR-004 (Aceptado) cerro el alcance de la identidad contextual y dejo a
-- C0 dos obligaciones medidas en B0:
--
--   §0  REGRESION: api.retire_participant aceptaba retirar a un participante
--       que ya es ORIGEN de core.participant_merge (asociado a la identidad
--       de una cuenta). No movia dinero —sus efectos ya resuelven al destino—
--       pero dejaba un estado «fusionado y retirado» que ninguna guarda
--       contemplaba y avisaba a los miembros de alguien que el grupo ya no ve.
--       La guarda va en sec.retire_participant_core, el nucleo que comparten
--       las DOS puertas (retirar y «Saldado»), con el codigo de los writers:
--       PARTICIPANT_MERGED · 409.
--   §1  INVARIANTE: una fusion es de UN salto. Un origen nunca es destino, un
--       destino nunca es origen; A → B → C no puede existir, lo escriba quien
--       lo escriba. Hoy lo imponia solo api.associate_participant; medido en
--       B0 que una cadena forzada a mano rompe la suma cero en silencio (los
--       efectos de A se quedan en B, que esta oculto por ser origen). El
--       modelo no puede decirlo con un CHECK —la regla cruza filas— asi que
--       se dice con un trigger de fila sobre core.participant_merge, que es
--       la forma minima de que el catalogo lo imponga a cualquier escritor,
--       presente o futuro. Ademas, los dos extremos de una fusion no se
--       reescriben: no hay UPDATE que cambie origen ni destino.
--
-- Nada mas cambia: ni las lecturas, ni asociar (que sigue rehusando antes,
-- con su propio mensaje), ni los vinculos.
-- ============================================================================

-- ══════════════════════ §0 · retirar a un origen fusionado ══════════════════
create or replace function sec.retire_participant_core(
  payload jsonb, p_actor uuid, p_key uuid, p_scope uuid, p_target uuid,
  p_expected text[], p_total bigint, p_canonical jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  v_actual     text[] := '{}';
  v_pair       record;
  v_item       jsonb;
  v_currency   uuid;
  v_replay     boolean := false;
  v_actor      uuid;
  v_operation  uuid;
  v_version    uuid;
  v_correction boolean;
  v_unused     uuid;
begin
  -- F10/ADR-004 §5 / C0: un origen de fusion ya no es nadie en el presente
  -- —sus efectos resuelven al destino, no esta en Saldos ni en las listas—:
  -- no se retira ni se da por saldado. El mismo codigo que los writers usan
  -- cuando alguien lo nombra.
  if exists (select 1 from core.participant_merge m where m.source_participant_id = p_target) then
    perform sec.raise_boundary('PARTICIPANT_MERGED',
      'ese participante se asocio a una cuenta: su identidad vigente es el destino', 409);
  end if;

  for v_pair in
    select q.id as other,
           sec.pending_debt(p_scope, p_target, q.id, null) as owes,
           sec.pending_debt(p_scope, q.id, p_target, null) as owed
      from core.participant q
     where q.scope_id = p_scope and q.id <> p_target
  loop
    if v_pair.owes > 0 then
      v_actual := v_actual || (p_target::text || '>' || v_pair.other::text || ':' || v_pair.owes::text);
    end if;
    if v_pair.owed > 0 then
      v_actual := v_actual || (v_pair.other::text || '>' || p_target::text || ':' || v_pair.owed::text);
    end if;
  end loop;
  select coalesce(array_agg(x order by x), '{}') into v_actual from unnest(v_actual) x;

  if v_actual <> p_expected then
    perform sec.raise_boundary('SETTLEMENT_STALE',
      'los pendientes han cambiado desde que se mostraron; vuelve a revisarlos', 409);
  end if;

  if array_length(v_actual, 1) is not null then
    select s.base_currency_definition_id into v_currency from core.scope s where s.id = p_scope;
    select * into v_replay, v_actor, v_operation, v_version, v_correction, v_unused
      from sec.begin_command(payload, 'participant_settlement', p_canonical);
    if v_replay then
      return jsonb_build_object('participant_id', p_target, 'operation_id', v_operation, 'already_processed', true);
    end if;
    perform sec.persist_version(v_actor, v_operation, v_version, 1, null,
                                'participant_settlement', current_date, p_total, v_currency);
    for v_item in select value from jsonb_array_elements(payload -> 'expected_pairs') loop
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, p_scope, 'settlement', v_currency,
              - sec.payload_amount(v_item, 'amount'),
              (v_item ->> 'debtor_participant_id')::uuid, (v_item ->> 'creditor_participant_id')::uuid);
    end loop;
  end if;

  insert into core.participant_retirement (participant_id, scope_id, operation_id, retired_by, client_command_id)
  values (p_target, p_scope, v_operation, p_actor, p_key);

  perform sec.notify_members(p_scope, 'settlement', p_key, p_actor);

  return jsonb_build_object('participant_id', p_target, 'operation_id', v_operation, 'already_processed', false);
end
$fn$;

-- ══════════════════════ §1 · una fusion es de un salto ═══════════════════════
-- El trigger ve TODAS las filas de la tabla (corre como su dueño, postgres),
-- asi que la regla no depende de la RLS del escritor.
create function sec.participant_merge_one_hop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and (new.source_participant_id <> old.source_participant_id
          or new.target_participant_id <> old.target_participant_id) then
    perform sec.raise_boundary('PARTICIPANT_MERGED',
      'una fusion no se reapunta: sus dos extremos son definitivos', 409);
  end if;
  -- El origen no puede ser destino de otra fusion (B → C con B ya destino de A → B).
  if exists (select 1 from core.participant_merge m where m.target_participant_id = new.source_participant_id) then
    perform sec.raise_boundary('PARTICIPANT_MERGED',
      'ese participante ya es destino de una fusion: una fusion es de un solo salto', 409);
  end if;
  -- El destino no puede ser origen de otra fusion (A → B con A ya origen de A → X).
  if exists (select 1 from core.participant_merge m where m.source_participant_id = new.target_participant_id) then
    perform sec.raise_boundary('PARTICIPANT_MERGED',
      'ese participante ya es origen de una fusion: una fusion es de un solo salto', 409);
  end if;
  return new;
end
$fn$;
comment on function sec.participant_merge_one_hop() is
  'F10/ADR-004 §5: un origen nunca es destino, un destino nunca es origen, y una fusion no se reapunta. Cierre de invariante en catalogo, para cualquier escritor.';
revoke execute on function sec.participant_merge_one_hop() from public;

create trigger participant_merge_un_salto
  before insert or update on core.participant_merge
  for each row execute function sec.participant_merge_one_hop();
