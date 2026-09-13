-- ============================================================================
-- PAGOS CON PARTICIPANTES SIN CUENTA, Y LA CAMPANA DE QUIEN SALIO
-- ============================================================================
--
--   §1  api.record_group_payment: un pago puede cerrar una deuda con un
--       participante SIN cuenta ni Personal (decision 2026-09-13, sustituye la
--       exigencia de ambos Personales de ADR-038 C7). La caja va solo al
--       Personal que existe; el pago y su detalle quedan con las DOS
--       identidades de participante (payment_detail, payment_allocation), que
--       es el identificador estable con el que F10 podra incorporar el
--       historial al Personal de quien reclame (ADR-012: nunca por nombre).
--       Registra la parte con cuenta, autorizada y activa (unica con vinculo);
--       entre dos sin cuenta no hay quien declare. Idempotencia, CAS, cerrojos,
--       tope de la excepcion de 20260913120000, historial, anulacion y avisos
--       (solo a destinatarios que existen) sin cambios.
--   §2  api.mark_group_notices_seen / api.mark_group_notice_read: marcaban
--       solo avisos de grupos con membresia; los de pago que llegan a quien
--       salio (legibles por destinatario) no se daban por leidos nunca y el
--       punto de la campana no se apagaba (medido en Android: Aitor, fuera
--       de «Prueba», con dos avisos de pago sin leer). Ahora marcan lo mismo
--       que la lectura deja ver.

-- ═══════════════════════ §1 · el writer ══════════════════════════════════════
create or replace function api.record_group_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'scope_id','currency_definition_id','amount',
    'payer_participant_id','receiver_participant_id','expected_positions'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time; v_payer uuid; v_receiver uuid;
  v_expected_text text; v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid; v_correction boolean; v_expected uuid;
  v_pp uuid; v_pr uuid; v_obs uuid[]; v_before bigint[]; v_net_payer bigint; v_net_receiver bigint;
  v_by_receiver boolean; v_other uuid; r record; v_ordinal smallint := 0;
  v_departed uuid; v_cap bigint;
begin
  -- Un pago NO se edita (ADR-038): operation_id o expected_version_id son un
  -- error de forma, antes de cualquier otra cosa.
  if (payload ? 'operation_id') or (payload ? 'expected_version_id') then
    perform sec.raise_boundary('PAYMENT_NOT_EDITABLE',
      'un pago registrado no se corrige: se anula y se registra otro', 422);
  end if;
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  -- La hora del hecho, opcional (ADR-020 §3): un pago se declara cuando se
  -- registra y el cliente manda su hora local, para que ordene con la fecha
  -- entre los demas movimientos del dia. Sin hora no se inventa medianoche.
  v_time     := sec.payload_time(payload, 'effective_time', false);
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_receiver := sec.payload_uuid(payload, 'receiver_participant_id', true);
  if v_amount <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE', 'el importe del pago debe ser positivo', 422);
  end if;
  if v_payer = v_receiver then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE', 'pagador y receptor no pueden ser el mismo', 422);
  end if;
  -- La foto de netos que el cliente vio (C2), en el mismo texto canonico que
  -- el servidor calcula bajo cerrojo. Lista de {participant_id, net}.
  if jsonb_typeof(payload -> 'expected_positions') is distinct from 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'expected_positions debe ser una lista', 400);
  end if;
  select string_agg(x.pid || ':' || x.net, ' ' order by x.pid) into v_expected_text
    from (select (e ->> 'participant_id')::uuid as pid, (e ->> 'net')::bigint as net
            from jsonb_array_elements(payload -> 'expected_positions') e) x;

  v_canonical := jsonb_build_object(
    'scope_id', v_scope::text, 'currency_definition_id', v_currency::text, 'amount', payload ->> 'amount',
    'effective_date', v_date::text, 'effective_time', v_time::text, 'payer_participant_id', v_payer::text,
    'receiver_participant_id', v_receiver::text, 'expected_positions', coalesce(v_expected_text, ''));

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_payment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- Rango 1: el cerrojo de identidad del grupo, antes de leer membresia,
  -- vinculo o presencia (20260912150000).
  perform sec.lock_participant_claims(v_scope);
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  -- LA EXCEPCION (C6, 20260913120000): una de las dos puntas salio. Solo si
  -- el par pagador → receptor esta reabierto por un pago anulado entre ellos,
  -- y como mucho por ese tope. Las dos fuera: no hay parte activa que declare.
  if sec.participant_departed(v_payer, v_scope) and sec.participant_departed(v_receiver, v_scope) then
    perform sec.raise_boundary('PARTICIPANT_INACTIVE',
      'las dos partes salieron del grupo: no queda nadie activo que registre el pago', 422);
  end if;
  v_departed := case when sec.participant_departed(v_payer, v_scope) then v_payer
                     when sec.participant_departed(v_receiver, v_scope) then v_receiver end;
  if v_departed is not null then
    v_cap := sec.reopened_pair_cap(v_scope, v_payer, v_receiver);
    if v_cap <= 0 or v_amount > v_cap then
      perform sec.raise_boundary('PAYMENT_NOT_APPLICABLE',
        'con quien salio del grupo solo se salda lo que un pago anulado volvio a dejar pendiente, y como mucho eso', 422,
        jsonb_build_object('reopened_cap', v_cap::text));
    end if;
  end if;

  -- Elegibilidad por fecha para la parte activa; la salida ya no la tiene
  -- (su presencia se cerro) y en la excepcion no se le exige.
  if v_departed is distinct from v_payer    then perform sec.assert_participant_eligible(v_payer,    v_scope, v_date); end if;
  if v_departed is distinct from v_receiver then perform sec.assert_participant_eligible(v_receiver, v_scope, v_date); end if;

  -- Pagador o receptor, por vinculo: ningun tercero (ADR-038). En la
  -- excepcion, ademas, el actor tiene que ser LA PARTE ACTIVA: el salido no
  -- es miembro (assert_member ya lo rehuso) y un miembro ajeno no es parte.
  if not exists (select 1 from core.participant_user_link l
                  where l.scope_id = v_scope and l.user_id = v_actor
                    and l.participant_id in (v_payer, v_receiver)
                    and l.participant_id is distinct from v_departed) then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo quien pago o quien cobro puede registrar el pago', 403);
  end if;
  v_by_receiver := exists (select 1 from core.participant_user_link l
                            where l.participant_id = v_receiver and l.user_id = v_actor);

  -- La caja va a los Personales que EXISTEN (20260913130000): un
  -- participante sin cuenta ni Personal puede ser pagador o receptor —la
  -- deuda se cierra igual y el pago queda con las dos identidades de
  -- participante—, y solo sale o entra dinero en el Personal de la parte con
  -- cuenta, que es quien declara (ya es la unica parte con vinculo). Entre
  -- dos participantes sin cuenta no hay quien declare: se rehusa. No se crea
  -- ningun Personal ficticio.
  v_pp := sec.participant_personal_scope(v_payer);
  v_pr := sec.participant_personal_scope(v_receiver);
  if v_pp is null and v_pr is null then
    perform sec.raise_boundary('RECEIVER_WITHOUT_PERSONAL_SCOPE',
      'entre dos participantes sin cuenta no se registra un pago: al menos una de las partes necesita cuenta', 422);
  end if;
  if v_pp is not null then perform sec.assert_no_conversion(v_pp, v_currency); end if;
  if v_pr is not null then perform sec.assert_no_conversion(v_pr, v_currency); end if;
  -- Ambos ACTIVOS ahora (ADR-034 §6 / ADR-038): tras salir no hay alta, salvo
  -- la excepcion de arriba para la punta salida.
  if v_departed is distinct from v_payer    then perform sec.assert_participant_active(v_payer,    v_scope); end if;
  if v_departed is distinct from v_receiver then perform sec.assert_participant_active(v_receiver, v_scope); end if;

  -- Rango 2: el grupo y los Personales que existen, ascendente.
  v_obs := sec.normalize_scopes(array_remove(array[v_pp, v_pr], null));
  perform sec.lock_scopes(sec.normalize_scopes(v_obs || array[v_scope]));

  -- CAS de la propuesta (C2): los netos vigentes son los que el cliente vio.
  if sec.group_positions_text(v_scope) is distinct from v_expected_text then
    perform sec.raise_boundary('SETTLEMENT_STALE',
      'los saldos del grupo cambiaron: la propuesta ya no es la vigente', 409,
      jsonb_build_object('positions', sec.group_positions_text(v_scope)));
  end if;
  -- Aplicable: el pagador debe al menos el importe en neto, y el receptor lo cobra.
  select coalesce(sum(case when e.debt_creditor_participant_id = v_payer then e.debt_amount else - e.debt_amount end), 0)
    into v_net_payer from core.current_effect e
   where e.scope_id = v_scope and e.debt_amount is not null and v_payer in (e.debt_debtor_participant_id, e.debt_creditor_participant_id);
  select coalesce(sum(case when e.debt_creditor_participant_id = v_receiver then e.debt_amount else - e.debt_amount end), 0)
    into v_net_receiver from core.current_effect e
   where e.scope_id = v_scope and e.debt_amount is not null and v_receiver in (e.debt_debtor_participant_id, e.debt_creditor_participant_id);
  if v_net_payer > - v_amount or v_net_receiver < v_amount then
    perform sec.raise_boundary('PAYMENT_NOT_APPLICABLE',
      'el pago supera lo que el pagador debe o lo que el receptor cobra en el grupo', 422);
  end if;

  v_before := sec.balances_before(v_obs);
  perform sec.persist_version(v_actor, v_operation, v_version, 1, null, 'group_payment', v_date, v_amount, v_currency, v_time);
  insert into core.payment_detail (operation_version_id, scope_id, payer_participant_id, receiver_participant_id, declared_by_receiver)
  values (v_version, v_scope, v_payer, v_receiver, v_by_receiver);
  -- Caja: sale del pagador y entra al receptor, en los Personales que
  -- existen. Ningun efecto economico. La parte sin cuenta no lleva caja: la
  -- suya no se conoce, y no se inventa.
  if v_pp is not null then
    insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values (gen_random_uuid(), v_version, v_pp, 'transfer', v_currency, - v_amount);
  end if;
  if v_pr is not null then
    insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values (gen_random_uuid(), v_version, v_pr, 'transfer', v_currency, v_amount);
  end if;
  -- Deuda: reducciones por par, y novaciones si no hay camino (C3). Cada
  -- fila queda ademas en payment_allocation: lo que el pago cerro o reasigno,
  -- conservado aunque se anule.
  for r in select * from sec.decompose_payment(v_scope, v_payer, v_receiver, v_amount) loop
    -- En la excepcion el pago es SOLO el par directo: un camino o una novacion
    -- moveria obligaciones de terceros con quien salio, y eso es ADR-039.
    if v_departed is not null and (r.kind <> 'settlement' or r.debtor <> v_payer or r.creditor <> v_receiver) then
      perform sec.raise_boundary('PAYMENT_NOT_APPLICABLE',
        'con quien salio del grupo solo se salda el par directo reabierto', 422);
    end if;
    insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
                             debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values (gen_random_uuid(), v_version, v_scope,
            case r.kind when 'novation' then 'novation' else 'settlement' end, v_currency,
            case r.kind when 'novation' then r.amount else - r.amount end, r.debtor, r.creditor);
    v_ordinal := v_ordinal + 1;
    insert into core.payment_allocation (operation_version_id, ordinal, scope_id, kind, debtor_participant_id, creditor_participant_id, amount)
    values (v_version, v_ordinal, v_scope, r.kind, r.debtor, r.creditor, r.amount);
  end loop;
  perform sec.observe_balances(v_version, v_obs, v_before);

  -- Aviso a la contraparte (C6): tambien a quien salio, por destinatario; a
  -- un participante sin cuenta no hay a quien avisar (sin vinculo, v_other
  -- es nulo).
  select l.user_id into v_other from core.participant_user_link l
   where l.scope_id = v_scope and l.participant_id = case when v_by_receiver then v_payer else v_receiver end;
  if v_other is not null and v_other <> v_actor then
    insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
    values (v_other, v_scope, 'payment', v_operation, v_actor)
    on conflict (recipient_user_id, kind, subject_id) do nothing;
  end if;

  return sec.envelope(v_operation, false);
end
$fn$;


-- ═══════════════════════ §2 · la campana ═════════════════════════════════════
--
-- El criterio es EL DE LA LECTURA (group_notice_client_select y
-- group_notice_client_select_payment): con membresia, o un aviso de pago
-- dirigido a mi. Lo que se ve se puede dar por leido; lo que no se ve, no.
create or replace function api.mark_group_notices_seen(p_newest uuid)
returns integer
language sql
security definer
set search_path = ''
as $fn$
  with cutoff as (
    select n.occurred_at
      from core.group_notice n
     where n.id = p_newest
       and n.recipient_user_id = (select auth.uid())
  ),
  done as (
    update core.group_notice n
       set read_at = now()
     where n.recipient_user_id = (select auth.uid())
       and n.read_at is null
       and n.occurred_at <= (select occurred_at from cutoff)
       and (sec.is_member(n.scope_id) or n.kind in ('payment', 'payment_annulled'))
    returning 1
  )
  select count(*)::integer from done;
$fn$;

create or replace function api.mark_group_notice_read(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update core.group_notice n
     set read_at = coalesce(n.read_at, now())
   where n.id = p_id
     and n.recipient_user_id = (select auth.uid())
     and (sec.is_member(n.scope_id) or n.kind in ('payment', 'payment_annulled'));
$fn$;
