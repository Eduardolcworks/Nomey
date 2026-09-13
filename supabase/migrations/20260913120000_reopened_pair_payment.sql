-- ============================================================================
-- SALDAR UN PENDIENTE REABIERTO CON QUIEN SALIO (ADR-038 C6, excepcion 2)
-- ============================================================================
--
-- Medido en dispositivo (2026-09-13): Aitor salio a cero de «Prueba» y Eduardo
-- anulo despues el pago; reaparecio Aitor → Eduardo 10 y NADIE podia cerrarlo:
-- registrar un pago exigia a los dos activos, y Eduardo no podia salir con el
-- par pendiente.
--
-- Decision: la parte que SIGUE ACTIVA puede registrar el pago que salda ese
-- pendiente. Limites, todos en servidor:
--   · solo pares REABIERTOS por la anulacion de un pago entre esas dos partes
--     (la misma lectura y el mismo tope que la excepcion C6 de Personal:
--     lo que el pago anulado habia reducido, acotado al pendiente vigente);
--   · el autor es una de las dos partes y esta activa; el salido no registra
--     desde fuera (sin membresia, NOT_AUTHORIZED) y un tercero tampoco;
--   · los dos con cuenta y Personal; el pago es EXACTAMENTE ese par (pagador =
--     deudor del par, receptor = acreedor) y no mas que el tope;
--   · nada mas cambia: sin readmision, CAS de netos, clave de idempotencia,
--     cerrojos, historial, avisos y caja en los dos Personales como siempre;
--     los permisos de anulacion no se tocan. Un ciclo pagar → anular → pagar
--     no amplia el tope: se acota al pendiente vigente del par.
--   · ADR-039 no se relaja: esto no nombra al salido en un GASTO nuevo.
--
--   §1  sec.participant_departed, sec.reopened_pair_cap
--   §2  api.record_group_payment: la excepcion, dentro del writer
--   §3  api.group_reopened_pair(p_scope): lo que Pagos sugeridos propone a la
--       parte activa (definer, solo miembros)

-- ═══════════════════════ §1 · lecturas ═══════════════════════════════════════

-- Salido: sin periodo abierto y no retirado (el mismo criterio que
-- sec.departed_effects_of_version). Quien nunca estuvo no cuenta.
create function sec.participant_departed(p_participant uuid, p_scope uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from core.participant p where p.id = p_participant and p.scope_id = p_scope)
     and not exists (select 1 from core.participant_period pp where pp.participant_id = p_participant and pp.valid_until is null)
     and not exists (select 1 from core.participant_retirement r where r.participant_id = p_participant);
$fn$;
revoke execute on function sec.participant_departed(uuid, uuid) from public;
grant execute on function sec.participant_departed(uuid, uuid) to nomey_writer, nomey_provisioner;

-- Cuanto del par deudor → acreedor esta REABIERTO por pagos anulados entre
-- esas dos partes: la suma de lo que esos pagos habian reducido en ese par,
-- acotada al pendiente vigente (0 si el par no debe nada). Es el tope de la
-- excepcion, y el mismo calculo por par que sec.my_reopened_debt hace por
-- persona.
create function sec.reopened_pair_cap(p_scope uuid, p_debtor uuid, p_creditor uuid)
returns bigint
language sql
stable
set search_path = ''
as $fn$
  with reduced as (
    select coalesce(sum(- e.debt_amount), 0)::bigint as amt
      from core.operation o
      join core.operation_version cur on cur.id = o.current_version_id and cur.version_kind = 'annulment'
      join lateral (select ov.id from core.operation_version ov
                     where ov.operation_id = o.id and ov.version_kind = 'record'
                     order by ov.version_no desc limit 1) rec on true
      join core.payment_detail pd on pd.operation_version_id = rec.id and pd.scope_id = p_scope
      join core.effect e on e.operation_version_id = rec.id and e.scope_id = p_scope
                        and e.debt_amount < 0
                        and e.debt_debtor_participant_id = p_debtor
                        and e.debt_creditor_participant_id = p_creditor
     where o.operation_class = 'group_payment'
       and (pd.payer_participant_id in (p_debtor, p_creditor) and pd.receiver_participant_id in (p_debtor, p_creditor))),
  pending as (
    select coalesce((select pp.amount from sec.pending_pairs(p_scope) pp
                      where pp.debtor = p_debtor and pp.creditor = p_creditor), 0)::bigint as amt)
  select least(reduced.amt, pending.amt) from reduced, pending;
$fn$;
revoke execute on function sec.reopened_pair_cap(uuid, uuid, uuid) from public;
grant execute on function sec.reopened_pair_cap(uuid, uuid, uuid) to nomey_writer;

-- ═══════════════════════ §2 · el writer ══════════════════════════════════════
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

  -- Los dos con Modo Personal: la caja va a los dos.
  v_pp := sec.participant_personal_scope(v_payer);
  v_pr := sec.participant_personal_scope(v_receiver);
  if v_pp is null or v_pr is null then
    perform sec.raise_boundary('RECEIVER_WITHOUT_PERSONAL_SCOPE',
      'pagador y receptor necesitan cuenta: un participante sin cuenta no registra pagos', 422);
  end if;
  perform sec.assert_no_conversion(v_pp, v_currency);
  perform sec.assert_no_conversion(v_pr, v_currency);
  -- Ambos ACTIVOS ahora (ADR-034 §6 / ADR-038): tras salir no hay alta, salvo
  -- la excepcion de arriba para la punta salida.
  if v_departed is distinct from v_payer    then perform sec.assert_participant_active(v_payer,    v_scope); end if;
  if v_departed is distinct from v_receiver then perform sec.assert_participant_active(v_receiver, v_scope); end if;

  -- Rango 2: el grupo y los dos Personales, ascendente.
  v_obs := sec.normalize_scopes(array[v_pp, v_pr]);
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
  -- Caja: sale del pagador y entra al receptor. Ningun efecto economico.
  insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_version, v_pp, 'transfer', v_currency, - v_amount),
         (gen_random_uuid(), v_version, v_pr, 'transfer', v_currency, v_amount);
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

  -- Aviso a la contraparte (C6): tambien a quien salio, por destinatario.
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

-- ═══════════════════════ §3 · la lectura para Pagos sugeridos ════════════════
--
-- Los pares reabiertos con alguien que salio, que la parte activa puede
-- saldar: deudor, acreedor y tope. Definer reducido: solo para miembros del
-- grupo (sec.is_member), sin nombres ni nada mas del salido que la vista de
-- participantes no publique ya.
create function api.group_reopened_pair(p_scope uuid)
returns table (debtor_participant_id uuid, creditor_participant_id uuid, amount text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select x.debtor, x.creditor, x.cap::text
    from (
      select pp.debtor, pp.creditor, sec.reopened_pair_cap(p_scope, pp.debtor, pp.creditor) as cap
        from sec.pending_pairs(p_scope) pp
       where sec.is_member(p_scope)
         and (sec.participant_departed(pp.debtor, p_scope) or sec.participant_departed(pp.creditor, p_scope))
         and not (sec.participant_departed(pp.debtor, p_scope) and sec.participant_departed(pp.creditor, p_scope))) x
   where x.cap > 0
   order by x.debtor, x.creditor;
$fn$;
revoke execute on function api.group_reopened_pair(uuid) from public;
grant execute on function api.group_reopened_pair(uuid) to authenticated;
