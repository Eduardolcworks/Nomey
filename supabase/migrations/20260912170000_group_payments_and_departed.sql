-- ============================================================================
-- PAGOS REGISTRADOS EN EL GRUPO, SALIR SIN PENDIENTES, Y LA OBLIGACION DE
-- QUIEN SALIO ES INTOCABLE (ADR-038 v3 · ADR-039)
-- ============================================================================
--
--   §1  core.payment_detail: las partes de un pago, persistidas; y
--       core.payment_allocation: las obligaciones que cerro o reasigno
--   §2  sec.decompose_payment: par directo → caminos → novacion
--   §3  api.record_group_payment (clase group_payment): SOLO alta
--   §4  sec.departed_effects_of_version / sec.assert_departed_unchanged (ADR-039)
--       y sec.assert_payment_annulment_leaves_retired_balanced (ADR-038 C4)
--   §5  api.record_group_expense: la guarda de salidos, en alta y correccion
--   §6  api.annul_operation: rango 1, autorizacion por partes para pagos,
--       guardas por clase, aviso a la contraparte
--   §7  api.record_debt_settlement: rango 1
--   §8  api.leave_group: sin pares pendientes (sec.pending_pairs_of)
--   §9  api.group_pending_pair: las dos direcciones
--   §10 core.group_notice: kinds payment / payment_annulled, lectura por
--       destinatario sin membresia; api.group_notice los describe
--   §11 lecturas: api.group_payment (miembros), api.my_group_payment (partes,
--       sin membresia), api.personal_operation con la clase group_payment,
--       api.claimed_dimension con la excepcion acotada (sec.my_reopened_debt)
--
-- Sin cambios en record_settlement_by_transfer, moneda ni conversion (F11).
-- ============================================================================

-- ═══════════════════════ §1 · las partes de un pago ══════════════════════════
create table core.payment_detail (
  operation_version_id    uuid primary key references core.operation_version (id),
  scope_id                uuid not null references core.scope (id),
  payer_participant_id    uuid not null,
  receiver_participant_id uuid not null,
  -- Quien lo declaro: la version ya lleva created_by; aqui se dice si fue el
  -- receptor, para que el Personal del pagador lo distinga.
  declared_by_receiver    boolean not null,
  constraint payment_detail_partes_distintas check (payer_participant_id <> receiver_participant_id),
  constraint payment_detail_pagador_del_ambito foreign key (payer_participant_id, scope_id) references core.participant (id, scope_id),
  constraint payment_detail_receptor_del_ambito foreign key (receiver_participant_id, scope_id) references core.participant (id, scope_id)
);
comment on table core.payment_detail is
  'Pagador y receptor de un pago registrado en el grupo (ADR-038). Del hecho, no de los efectos: la autorizacion para anular un pago —incluso ya anulado— sale de aqui.';
alter table core.payment_detail enable row level security;
grant select, insert on core.payment_detail to nomey_writer;
create policy payment_detail_writer_insert on core.payment_detail for insert to nomey_writer with check (true);
create policy payment_detail_writer_select on core.payment_detail for select to nomey_writer using (true);
grant select on core.payment_detail to authenticated;
create policy payment_detail_client_select on core.payment_detail for select to authenticated using (sec.is_member(scope_id));

-- LO QUE EL PAGO CERRO O REASIGNO, persistido con su version: la misma
-- descomposicion que se convierte en efectos de deuda, fila a fila, en el
-- orden en que se calculo. Es un hecho del pago —lo que declaro cerrar bajo
-- el cerrojo— y no una lectura de los saldos de ahora: por eso se conserva
-- aunque el pago se anule (sus efectos dejan de ser vigentes y la proyeccion
-- canonica ya no los publica; ADR-013 §9 y ADR-025 no dejan leerlos por
-- una vista) y el detalle del movimiento puede seguir contandolo. Es el
-- mismo criterio por el que core.split_participant persiste el reparto
-- resuelto junto a los efectos economicos (ADR-013 §1).
create table core.payment_allocation (
  operation_version_id    uuid not null references core.operation_version (id),
  ordinal                 smallint not null,
  scope_id                uuid not null references core.scope (id),
  -- 'settlement': una obligacion cerrada (debtor deja de deber a creditor);
  -- 'novation': una obligacion nueva que sustituye a las cerradas por camino.
  kind                    text not null check (kind in ('settlement', 'novation')),
  debtor_participant_id   uuid not null,
  creditor_participant_id uuid not null,
  amount                  bigint not null check (amount > 0),
  primary key (operation_version_id, ordinal),
  constraint payment_allocation_partes_distintas check (debtor_participant_id <> creditor_participant_id),
  constraint payment_allocation_deudor_del_ambito foreign key (debtor_participant_id, scope_id) references core.participant (id, scope_id),
  constraint payment_allocation_acreedor_del_ambito foreign key (creditor_participant_id, scope_id) references core.participant (id, scope_id)
);
comment on table core.payment_allocation is
  'Obligaciones que un pago registrado cerro (settlement) o reasigno (novation), persistidas con su version (ADR-038 C3). Se conservan al anular: son lo que ese pago declaro, no los saldos de ahora.';
alter table core.payment_allocation enable row level security;
grant select, insert on core.payment_allocation to nomey_writer;
create policy payment_allocation_writer_insert on core.payment_allocation for insert to nomey_writer with check (true);
create policy payment_allocation_writer_select on core.payment_allocation for select to nomey_writer using (true);
grant select on core.payment_allocation to authenticated;
create policy payment_allocation_client_select on core.payment_allocation for select to authenticated using (sec.is_member(scope_id));

-- ═══════════════════════ §2 · la descomposicion ══════════════════════════════
--
-- Sobre los pares NETEADOS pendientes del grupo: (1) el par directo; (2) los
-- caminos mas cortos primero, cuello de botella descendente, desempate estable,
-- cada camino reduce todos sus pares (los intermedios conservan su neto); (3)
-- novacion entre salientes del pagador y entrantes del receptor. Lo que el
-- grafo no sostiene no se registra. Devuelve settlement (reduce) y novation
-- (crea); el importe siempre positivo, el signo lo pone quien escribe.
create function sec.pending_pairs(p_scope uuid)
returns table (debtor uuid, creditor uuid, amount bigint)
language sql
stable
set search_path = ''
as $fn$
  with raw as (
    select e.debt_debtor_participant_id d, e.debt_creditor_participant_id c, sum(e.debt_amount) amt
      from core.current_effect e
     where e.scope_id = p_scope and e.debt_amount is not null
     group by 1, 2),
  dirs as (select d, c from raw union select c, d from raw),
  net as (
    select b.d, b.c, coalesce((select r.amt from raw r where r.d = b.d and r.c = b.c), 0)
                   - coalesce((select r.amt from raw r where r.d = b.c and r.c = b.d), 0) amt
      from dirs b)
  select d, c, amt::bigint from net where amt > 0;
$fn$;
revoke execute on function sec.pending_pairs(uuid) from public;
grant execute on function sec.pending_pairs(uuid) to nomey_writer;

create function sec.decompose_payment(p_scope uuid, p_payer uuid, p_receiver uuid, p_amount bigint)
returns table (kind text, debtor uuid, creditor uuid, amount bigint)
language plpgsql
set search_path = ''
as $fn$
declare
  -- El grafo de trabajo en tres arrays paralelos (sin tablas temporales: la
  -- funcion corre bajo el writer y una tabla temporal de otra sesion o rol
  -- no le pertenece). Las salidas, en otros tres.
  v_d uuid[]; v_c uuid[]; v_amt bigint[];
  v_ok text[] := '{}'; v_od uuid[] := '{}'; v_oc uuid[] := '{}'; v_oamt bigint[] := '{}';
  v_left bigint := p_amount; v_take bigint; r record; v_path uuid[]; v_i int; v_j int; v_k int;
  v_out record; v_in record;
begin
  select coalesce(array_agg(pp.debtor order by pp.debtor, pp.creditor), '{}'),
         coalesce(array_agg(pp.creditor order by pp.debtor, pp.creditor), '{}'),
         coalesce(array_agg(pp.amount order by pp.debtor, pp.creditor), '{}')
    into v_d, v_c, v_amt
    from sec.pending_pairs(p_scope) pp;

  -- 1 · par directo
  for v_i in 1 .. coalesce(array_length(v_d, 1), 0) loop
    if v_d[v_i] = p_payer and v_c[v_i] = p_receiver and v_amt[v_i] > 0 and v_left > 0 then
      v_take := least(v_amt[v_i], v_left);
      v_amt[v_i] := v_amt[v_i] - v_take;
      v_ok := v_ok || 'settlement'::text; v_od := v_od || p_payer; v_oc := v_oc || p_receiver; v_oamt := v_oamt || v_take;
      v_left := v_left - v_take;
    end if;
  end loop;

  -- 2 · caminos mas cortos, cuello de botella descendente, desempate estable
  while v_left > 0 loop
    with recursive w as (select * from unnest(v_d, v_c, v_amt) as t(d, c, amt) where amt > 0),
    walk (node, path, bottleneck) as (
      select p_payer, array[p_payer], null::bigint
      union all
      select w.c, walk.path || w.c, least(coalesce(walk.bottleneck, w.amt), w.amt)
        from walk join w on w.d = walk.node
       where not (w.c = any(walk.path)) and array_length(walk.path, 1) < 8 and walk.node <> p_receiver)
    select path, bottleneck into r from walk
     where node = p_receiver and array_length(path, 1) > 2
     order by array_length(path, 1), bottleneck desc, path::text
     limit 1;
    exit when r.path is null;
    v_path := r.path; v_take := least(r.bottleneck, v_left);
    for v_j in 1 .. array_length(v_path, 1) - 1 loop
      for v_i in 1 .. array_length(v_d, 1) loop
        if v_d[v_i] = v_path[v_j] and v_c[v_i] = v_path[v_j + 1] then v_amt[v_i] := v_amt[v_i] - v_take; end if;
      end loop;
      v_ok := v_ok || 'settlement'::text; v_od := v_od || v_path[v_j]; v_oc := v_oc || v_path[v_j + 1]; v_oamt := v_oamt || v_take;
    end loop;
    v_left := v_left - v_take;
    r := null;
  end loop;

  -- 3 · novacion: salientes del pagador contra entrantes del receptor
  if v_left > 0 then
    for v_i in 1 .. coalesce(array_length(v_d, 1), 0) loop
      exit when v_left = 0;
      continue when v_d[v_i] <> p_payer or v_amt[v_i] <= 0;
      for v_k in 1 .. array_length(v_d, 1) loop
        exit when v_left = 0 or v_amt[v_i] = 0;
        continue when v_c[v_k] <> p_receiver or v_amt[v_k] <= 0;
        v_take := least(v_amt[v_i], v_amt[v_k], v_left);
        v_amt[v_i] := v_amt[v_i] - v_take; v_amt[v_k] := v_amt[v_k] - v_take;
        v_ok := v_ok || 'settlement'::text; v_od := v_od || v_d[v_i]; v_oc := v_oc || v_c[v_i]; v_oamt := v_oamt || v_take;
        v_ok := v_ok || 'settlement'::text; v_od := v_od || v_d[v_k]; v_oc := v_oc || v_c[v_k]; v_oamt := v_oamt || v_take;
        v_ok := v_ok || 'novation'::text; v_od := v_od || v_d[v_k]; v_oc := v_oc || v_c[v_i]; v_oamt := v_oamt || v_take;
        v_left := v_left - v_take;
      end loop;
    end loop;
  end if;

  if v_left > 0 then
    perform sec.raise_boundary('PAYMENT_NOT_APPLICABLE',
      format('el pago no se sostiene sobre las obligaciones vigentes: quedan %s sin obligacion que cerrar', v_left), 422);
  end if;

  return query
    select t.k, t.d, t.c, sum(t.a)::bigint
      from unnest(v_ok, v_od, v_oc, v_oamt) as t(k, d, c, a)
     group by t.k, t.d, t.c
     order by t.k, t.d, t.c;
end
$fn$;
revoke execute on function sec.decompose_payment(uuid, uuid, uuid, bigint) from public;
grant execute on function sec.decompose_payment(uuid, uuid, uuid, bigint) to nomey_writer;

-- Los netos del grupo, en texto canonico: lo que el cliente manda como
-- expected_positions (ordenado por participante) y lo que se compara bajo bloqueo.
create function sec.group_positions_text(p_scope uuid)
returns text
language sql
stable
set search_path = ''
as $fn$
  select coalesce(string_agg(p.id::text || ':' || coalesce(n.net, 0)::text, ' ' order by p.id), '')
    from core.participant p
    left join (
      select x.pid, sum(x.amt) net from (
        select e.debt_creditor_participant_id pid, e.debt_amount amt from core.current_effect e where e.scope_id = p_scope and e.debt_amount is not null
        union all
        select e.debt_debtor_participant_id, - e.debt_amount from core.current_effect e where e.scope_id = p_scope and e.debt_amount is not null) x
      group by x.pid) n on n.pid = p.id
   where p.scope_id = p_scope;
$fn$;
revoke execute on function sec.group_positions_text(uuid) from public;
grant execute on function sec.group_positions_text(uuid) to nomey_writer;

-- ═══════════════════════ §3 · registrar un pago ══════════════════════════════
create function api.record_group_payment(payload jsonb)
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
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      format('Un pago registra un importe positivo, recibido: %s', v_amount), 422);
  end if;
  if v_payer = v_receiver then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE', 'pagador y receptor no pueden ser el mismo', 422);
  end if;
  if payload -> 'expected_positions' is null or jsonb_typeof(payload -> 'expected_positions') <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'expected_positions debe ser una lista de {participant_id, net}', 400);
  end if;
  select string_agg((x ->> 'participant_id') || ':' || (x ->> 'net'), ' ' order by (x ->> 'participant_id'))
    into v_expected_text
    from jsonb_array_elements(payload -> 'expected_positions') x;

  v_canonical := jsonb_build_object(
    'scope_id', v_scope::text, 'currency_definition_id', v_currency::text, 'amount', payload ->> 'amount',
    'effective_date', v_date::text, 'effective_time', v_time::text, 'payer_participant_id', v_payer::text,
    'receiver_participant_id', v_receiver::text, 'expected_positions', coalesce(v_expected_text, ''));

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_payment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- RANGO 1 antes de la identidad (20260912150000).
  perform sec.lock_participant_claims(v_scope);
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_participant_eligible(v_payer,    v_scope, v_date);
  perform sec.assert_participant_eligible(v_receiver, v_scope, v_date);

  -- Pagador o receptor, por vinculo: ningun tercero (ADR-038).
  if not exists (select 1 from core.participant_user_link l
                  where l.scope_id = v_scope and l.user_id = v_actor
                    and l.participant_id in (v_payer, v_receiver)) then
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
  -- Ambos ACTIVOS ahora (ADR-034 §6 / ADR-038): tras salir no hay alta.
  perform sec.assert_participant_active(v_payer,    v_scope);
  perform sec.assert_participant_active(v_receiver, v_scope);

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

  -- Aviso a la contraparte (C6).
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

-- ═══════════════════════ §4 · guardas ════════════════════════════════════════
--
-- ADR-039: lo que una version atribuye a quien SALIO (sin periodo abierto y
-- no retirado): deuda por par y direccion, cuota economica y caja en su
-- Personal, como texto canonico. Los retirados los cubre su propia guarda.
create function sec.departed_effects_of_version(p_version uuid)
returns text[]
language sql
stable
set search_path = ''
as $fn$
  with departed as (
    -- Solo los participantes del GRUPO de la version: la caja de una cuenta se
    -- atribuye por su vinculo en ESE grupo, no por haber salido de otro.
    select p.id, s.id as personal
      from core.participant p
      left join core.participant_user_link l on l.participant_id = p.id
      left join core.scope s on s.kind = 'personal' and s.owner_user_id = l.user_id
     where p.scope_id in (select g.scope_id from core.effect g join core.scope gs on gs.id = g.scope_id and gs.kind = 'group'
                           where g.operation_version_id = p_version)
       and not exists (select 1 from core.participant_period pp where pp.participant_id = p.id and pp.valid_until is null)
       and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id))
  select coalesce(array_agg(x order by x), '{}') from (
    select 'debt ' || e.debt_debtor_participant_id || '>' || e.debt_creditor_participant_id || ':' || e.debt_amount as x
      from core.effect e where e.operation_version_id = p_version and e.debt_amount is not null
       and exists (select 1 from departed d where d.id in (e.debt_debtor_participant_id, e.debt_creditor_participant_id))
    union all
    select 'economic ' || e.economic_participant_id || ':' || e.economic_amount
      from core.effect e where e.operation_version_id = p_version and e.economic_participant_id is not null
       and exists (select 1 from departed d where d.id = e.economic_participant_id)
    union all
    select 'cash ' || e.scope_id || ':' || e.balance_amount
      from core.effect e where e.operation_version_id = p_version and e.balance_amount is not null
       and exists (select 1 from departed d where d.personal = e.scope_id)) t;
$fn$;
-- p_new nulo = anulacion (ninguna atribucion); p_old nulo = alta (referencia vacia).
create function sec.assert_departed_unchanged(p_new uuid, p_old uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if coalesce(sec.departed_effects_of_version(p_new), '{}') <> coalesce(sec.departed_effects_of_version(p_old), '{}') then
    perform sec.raise_boundary('DEPARTED_OBLIGATION_CHANGED',
      'esta operacion cambiaria lo que el gasto atribuye a alguien que ya salio del grupo (ADR-039); concepto y categoria si se pueden cambiar', 422);
  end if;
end
$fn$;
-- ADR-038 C4: anular un pago solo se rehusa si deja a un RETIRADO con neto
-- distinto de cero sobre los efectos que revive; un pago lo atraviesa siempre
-- en equilibrio.
create function sec.assert_payment_annulment_leaves_retired_balanced(p_version uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from (
      select x.pid, sum(x.amt) net from (
        select e.debt_creditor_participant_id pid, e.debt_amount amt from core.effect e where e.operation_version_id = p_version and e.debt_amount is not null
        union all
        select e.debt_debtor_participant_id, - e.debt_amount from core.effect e where e.operation_version_id = p_version and e.debt_amount is not null) x
      join core.participant_retirement rt on rt.participant_id = x.pid
      group by x.pid having sum(x.amt) <> 0) z) then
    perform sec.raise_boundary('PARTICIPANT_RETIRED',
      'anular este pago dejaria a un participante retirado con pendiente (ADR-038 C4)', 422);
  end if;
end
$fn$;
revoke execute on function sec.departed_effects_of_version(uuid), sec.assert_departed_unchanged(uuid, uuid),
  sec.assert_payment_annulment_leaves_retired_balanced(uuid) from public;
grant execute on function sec.departed_effects_of_version(uuid), sec.assert_departed_unchanged(uuid, uuid),
  sec.assert_payment_annulment_leaves_retired_balanced(uuid) to nomey_writer;

-- Quien ya constaba en el reparto de una version, en su misma fecha: la
-- excepcion de elegibilidad de una correccion (arriba, en §5).
create function sec.participant_kept_in_version(p_participant uuid, p_version uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (
    select 1
      from core.split_participant sp
      join core.operation_version ov on ov.id = sp.operation_version_id
     where sp.operation_version_id = p_version
       and sp.participant_id = p_participant
       and ov.effective_date = p_date);
$fn$;
revoke execute on function sec.participant_kept_in_version(uuid, uuid, date) from public;
grant execute on function sec.participant_kept_in_version(uuid, uuid, date) to nomey_writer;

-- ═══════════════════════ §5 · record_group_expense ═══════════════════════════
CREATE OR REPLACE FUNCTION api.record_group_expense(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method',
    'concept','category_id'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_time time; v_payer uuid;
  v_participants uuid[]; v_method jsonb; v_kind text; v_resolved bigint[];
  v_concept text; v_category uuid;
  v_payer_scope uuid; v_canonical jsonb; v_lock uuid[];
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_i integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_total    := sec.payload_amount(payload, 'total');
  v_date     := sec.payload_date(payload, 'effective_date');
  -- OPCIONAL, a diferencia del personal: un gasto historico sin hora se corrige
  -- conservando su ausencia, y nadie le inventa una (ADR-020 §3).
  v_time     := sec.payload_time(payload, 'effective_time', false);
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_participants := sec.jsonb_uuid_array(payload -> 'participants', 'participants');
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));
  v_category := sec.payload_uuid(payload, 'category_id', true);

  v_method := payload -> 'split_method';
  if v_method is null or jsonb_typeof(v_method) <> 'object' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method debe ser un objeto JSON', 400);
  end if;
  v_kind := v_method ->> 'kind';
  if v_kind is null or not (v_kind = any(array['equal','shares','exact_amounts'])) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method.kind debe ser equal, shares o exact_amounts', 400);
  end if;
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  v_resolved := sec.resolve_split(v_total, v_participants, v_payer, v_method);

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'currency_definition_id', v_currency::text,
    'total',                  payload ->> 'total',
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'payer_participant_id',   v_payer::text,
    'participants',           (select coalesce(jsonb_agg(p::text order by ord), '[]'::jsonb)
                                 from unnest(v_participants) with ordinality as u(p, ord)),
    'split_method',           v_method,
    'concept',                v_concept,
    'category_id',            v_category::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- EL CERROJO DE IDENTIDAD DEL GRUPO, antes de leer membresia o vinculo y
  -- antes de cualquier fila (protocolo de 20260912150000): el pagador que se
  -- resuelve aqui abajo no puede cambiar hasta el commit.
  perform sec.lock_participant_claims(v_scope);

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_shared_category_usable(v_category, v_expected);

  foreach v_payer_scope in array v_participants loop
    -- Elegibilidad por fecha (ADR-012 §7, ADR-034 §5), con UNA excepcion: en
    -- una correccion, quien ya constaba en la version que se corrige y en la
    -- MISMA fecha no vuelve a pasar por ella. Su presencia se cerro con el
    -- dia de salida excluido, asi que un gasto de ese dia —valido cuando se
    -- registro— dejaria de poder corregirse hasta en el concepto; lo que
    -- protege su obligacion es ADR-039 (sec.assert_departed_unchanged), mas
    -- abajo. Mover la fecha o nombrar a alguien nuevo sigue exigiendo
    -- elegibilidad.
    if not (v_correction and sec.participant_kept_in_version(v_payer_scope, v_expected, v_date)) then
      perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
    end if;
    -- ADR-034 §6: un ALTA no puede nombrar a un retirado, ni siquiera
    -- retro-fechada dentro de su periodo: crearia deuda sobre un pendiente
    -- que los miembros declararon resuelto. En una correccion se compara
    -- despues, efecto a efecto.
    if not v_correction then
      perform sec.assert_participant_not_retired(v_payer_scope, v_scope);
    end if;
  end loop;
  v_payer_scope := null;

  v_payer_scope := sec.participant_personal_scope(v_payer);
  if v_payer_scope is not null then
    perform sec.assert_no_conversion(v_payer_scope, v_currency);
  end if;

  v_lock := array[v_scope];
  v_obs := case when v_payer_scope is not null then array[v_payer_scope] else '{}'::uuid[] end;
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  v_lock := v_lock || v_obs;
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency,
                              v_time);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved);
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  if v_payer_scope is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_currency, - v_total);
  end if;

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ADR-034 §6: corregir un gasto de un retirado es posible solo si NINGUN
  -- efecto de deuda que lo nombre cambia. Se compara con los efectos ya
  -- escritos, y un rechazo aqui revierte la version entera.
  if v_correction then
    perform sec.assert_retired_debt_unchanged(v_version, v_expected);
  end if;
  -- ADR-039: lo que la version atribuye a quien SALIO —deuda por par y
  -- direccion, cuota, caja— es intocable. En un alta la referencia es vacia:
  -- nombrar a un salido, aunque la fecha caiga en su antigua presencia, se
  -- rehusa. Despues de escribir, como la de retirados: un rechazo revierte
  -- la version entera.
  perform sec.assert_departed_unchanged(v_version, v_expected);

  -- ═══ Y SOLO SI FUE UNA CORRECCION, el aviso interno ═══
  --
  -- Aqui, y no antes: la version ya esta escrita y sus efectos asentados, asi
  -- que ninguna notificacion puede sobrevivir a un rechazo posterior. Un alta no
  -- notifica nada — no es una edicion de nada.
  if v_correction then
    perform sec.notify_group_edit(v_scope, v_operation, v_version, v_actor);
  end if;

  return sec.envelope(v_operation, false);
end
$function$;

-- ═══════════════════════ §6 · annul_operation ════════════════════════════════
CREATE OR REPLACE FUNCTION api.annul_operation(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version',
    'operation_id','expected_version_id'];
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_clase text; v_date date; v_time time; v_amount bigint; v_currency uuid;
  v_obs uuid[] := '{}'::uuid[]; v_lock uuid[] := '{}'::uuid[]; v_before bigint[];
  v_scope uuid; v_group uuid; v_pd core.payment_detail%rowtype; v_other uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  -- Anular es SIEMPRE sobre una operacion existente: no hay alta que valga.
  if not (payload ? 'operation_id') or not (payload ? 'expected_version_id') then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'anular exige operation_id y expected_version_id', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',        (sec.payload_uuid(payload,'operation_id',true))::text,
    'expected_version_id', (sec.payload_uuid(payload,'expected_version_id',true))::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'annulment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- La clase sale de la operacion, no del payload: anular no la elige.
  select o.operation_class into v_clase from core.operation o where o.id = v_operation;
  if v_clase is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la operacion no existe o no es alcanzable', 403);
  end if;

  -- RANGO 1 (protocolo de identidad, 20260912150000): antes de leer
  -- membresia, vinculo o salida. El ambito de grupo de la version, si lo hay.
  select g.id into v_group
    from core.current_effect ce join core.scope g on g.id = ce.scope_id and g.kind = 'group'
   where ce.operation_version_id = v_expected
   limit 1;
  if v_group is not null then
    perform sec.lock_participant_claims(v_group);
  end if;

  if v_clase = 'group_payment' then
    -- ADR-038 C4: pagador o receptor DE ESE PAGO (core.payment_detail), con o
    -- sin membresia; nadie mas. Las partes salen del hecho persistido, no de
    -- los efectos vigentes.
    select * into v_pd from core.payment_detail pd
     where pd.operation_version_id = (select ov.id from core.operation_version ov
                                        where ov.operation_id = v_operation and ov.version_kind = 'record'
                                        order by ov.version_no desc limit 1);
    if v_pd.operation_version_id is null
       or not exists (select 1 from core.participant_user_link l
                       where l.scope_id = v_pd.scope_id and l.user_id = v_actor
                         and l.participant_id in (v_pd.payer_participant_id, v_pd.receiver_participant_id)) then
      perform sec.raise_boundary('NOT_AUTHORIZED',
        'solo quien pago o quien cobro puede anular este pago', 403);
    end if;
  else
    -- AUTORIZACION: la misma que corregir. `data-model.md` §7 la fija como
    -- membresia ACTUAL del ambito, sin mirar quien creo la operacion ni cuando
    -- entro. Se comprueba sobre cada ambito que la version vigente alcanza:
    -- un gasto con caja de OTRO pagador solo lo anula ese pagador (documentado
    -- en ADR-039; no se amplia aqui).
    foreach v_scope in array sec.normalize_scopes(
        sec.balance_scopes_of_version(v_expected) || sec.debt_scopes_of_version(v_expected))
    loop
      perform sec.assert_member(v_scope, v_actor);
    end loop;
  end if;

  -- LOCK sobre esos mismos ambitos, antes del CAS y en el orden global.
  v_obs  := sec.normalize_scopes(sec.balance_scopes_of_version(v_expected));
  v_lock := sec.normalize_scopes(v_obs || sec.debt_scopes_of_version(v_expected));
  perform sec.lock_scopes(v_lock);

  select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

  -- Ninguna deuda puede quedar con pendiente negativo al desaparecer la que la
  -- originaba. Mismo invariante que protege la correccion, en otro momento.
  -- ADR-034 §6: anular un gasto cuya version vigente deja deuda con un
  -- retirado alteraria un pendiente declarado resuelto. Antes que el
  -- sobrepago, para que el motivo que llega sea el de fondo.
  if v_clase = 'group_payment' then
    -- ADR-038 C4: un pago del que dependen pagos posteriores SI se anula (el
    -- par consumido queda invertido: un credito de quien pago de mas), y un
    -- retirado en su camino no lo bloquea si queda en equilibrio. La guarda
    -- de sobreliquidacion y la de retirados de los GASTOS no se aplican aqui.
    perform sec.assert_payment_annulment_leaves_retired_balanced(v_expected);
  else
    perform sec.assert_no_retired_debt(v_expected);
    perform sec.assert_annulment_leaves_no_oversettled_debt(v_expected);
    -- ADR-039: anular un gasto que atribuye algo a quien salio se rehusa.
    perform sec.assert_departed_unchanged(null, v_expected);
  end if;

  -- La version anulada define el hecho que se declara sin vigencia.
  select ov.effective_date, ov.effective_time, ov.original_amount,
         ov.original_currency_definition_id
    into v_date, v_time, v_amount, v_currency
    from core.operation_version ov where ov.id = v_expected;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, v_clase, v_date, v_amount, v_currency,
                              v_time, 'annulment');

  -- Y NINGUN efecto. Es lo que la hace no contar.

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ADR-038 C6: la contraparte del pago recibe el aviso aunque ya no sea
  -- miembro; el sujeto es la operacion.
  if v_clase = 'group_payment' then
    select l.user_id into v_other
      from core.participant_user_link l
     where l.scope_id = v_pd.scope_id
       and l.participant_id = case when exists (select 1 from core.participant_user_link x
                                                  where x.participant_id = v_pd.payer_participant_id and x.user_id = v_actor)
                                   then v_pd.receiver_participant_id else v_pd.payer_participant_id end;
    if v_other is not null and v_other <> v_actor then
      insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
      values (v_other, v_pd.scope_id, 'payment_annulled', v_operation, v_actor)
      on conflict (recipient_user_id, kind, subject_id) do nothing;
    end if;
  end if;

  return sec.envelope(v_operation, false);
end
$function$;

-- ═══════════════════════ §7 · record_debt_settlement ═════════════════════════
CREATE OR REPLACE FUNCTION api.record_debt_settlement(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','amount',
    'debtor_participant_id','creditor_participant_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_debtor uuid; v_creditor uuid;
  v_canonical jsonb; v_lock uuid[]; v_pending bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope     := sec.payload_uuid(payload, 'scope_id', true);
  v_currency  := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount    := sec.payload_amount(payload, 'amount');
  v_date      := sec.payload_date(payload, 'effective_date');
  v_debtor    := sec.payload_uuid(payload, 'debtor_participant_id', true);
  v_creditor  := sec.payload_uuid(payload, 'creditor_participant_id', true);

  if v_amount <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      format('Una liquidacion salda un importe positivo, recibido: %s', v_amount), 422);
  end if;
  if v_debtor = v_creditor then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE',
      'Una deuda no puede tener el mismo deudor y acreedor', 422);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',            (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',                v_scope::text,
    'currency_definition_id',  v_currency::text,
    'amount',                  payload ->> 'amount',
    'effective_date',          v_date::text,
    'debtor_participant_id',   v_debtor::text,
    'creditor_participant_id', v_creditor::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'debt_settlement', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- `data-model.md` §8 marca «marcar deuda saldada» como inmediata y no la
  -- restringe a las partes: es una AFIRMACION SOBRE UNA OBLIGACION YA
  -- DETERMINADA, y quien la hace responde por atribucion, historial,
  -- notificacion y correccion. La autorizacion es la membresia del ambito.
  -- Rango 1 (protocolo de identidad, 20260912150000): cambia deuda, y salir
  -- decide sobre los pares bajo este cerrojo (ADR-038 C5).
  perform sec.lock_participant_claims(v_scope);
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_participant_eligible(v_debtor,   v_scope, v_date);
  perform sec.assert_participant_eligible(v_creditor, v_scope, v_date);
  -- ADR-034 §6: ademas de la fecha, los DOS extremos activos AHORA. A quien
  -- salio se le resuelve con settle_participant, nunca con una liquidacion
  -- —retro-fechada o no—.
  perform sec.assert_participant_active(v_debtor,   v_scope);
  perform sec.assert_participant_active(v_creditor, v_scope);

  -- 6 · LOCK, y 8 · leer la deuda DESPUES. Invertirlos reintroduce la carrera
  -- que E15 midio: dos liquidaciones de 2000 sobre una deuda de 3000 pasan las
  -- dos y dejan un pendiente de -1000.
  v_lock := array[v_scope];
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  -- La version que se supersede se excluye: corregir una liquidacion de 3000 a
  -- 4000 no puede validarse contra una deuda que todavia incluye esos 3000.
  v_pending := sec.pending_debt(v_scope, v_debtor, v_creditor,
                                case when v_correction then v_expected end);

  -- Una liquidacion nunca supera el pendiente. De ahi salen los tres rechazos
  -- de `data-model.md` §3: sobrepago, liquidar sin deuda, y liquidar en la
  -- direccion contraria —donde el neteo del par devuelve cero—.
  if v_amount > v_pending then
    perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
      format('Se intenta liquidar %s sobre una deuda pendiente de %s', v_amount, v_pending), 422);
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'debt_settlement', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
          - v_amount, v_debtor, v_creditor);

  return sec.envelope(v_operation, false);
end
$function$;

-- ═══════════════════════ §8 · leave_group ════════════════════════════════════
--
-- El provisioner no ve efectos del grupo: la lectura de pares es un definer
-- reducido de postgres, solo sobre el participante del actor y solo para el
-- provisioner.
create function sec.pending_pairs_of(p_scope uuid)
returns table (debtor_participant_id uuid, creditor_participant_id uuid, amount bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  select pp.debtor, pp.creditor, pp.amount
    from sec.pending_pairs(p_scope) pp
   where exists (select 1 from core.participant_user_link l
                  where l.scope_id = p_scope and l.user_id = sec.request_actor_id()
                    and l.participant_id in (pp.debtor, pp.creditor));
$fn$;
revoke execute on function sec.pending_pairs_of(uuid) from public;
grant execute on function sec.pending_pairs_of(uuid) to nomey_provisioner;
grant execute on function sec.raise_boundary(text, text, integer, jsonb) to nomey_provisioner;
CREATE OR REPLACE FUNCTION api.leave_group(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'scope_id'];
  v_actor       uuid;
  v_command     uuid;
  v_version     integer;
  v_scope       uuid;
  v_intent      jsonb;
  v_stored      jsonb;
  v_replay      boolean := false;
  v_participant uuid;
  v_departure   uuid;
  v_pairs       jsonb;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  if v_command is null or v_version is null or v_scope is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version y scope_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;

  v_intent := jsonb_build_object('scope_id', v_scope);

  -- El reclamo de la clave ANTES de autorizar (ADR-033, ADR-010 §5): un
  -- reintento tras salir responde replay, no NOT_AUTHORIZED.
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.leave', v_version, v_intent, v_scope);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT',
        'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED',
        'esa clave ya se uso con una intencion distinta', 409);
    end if;
    return jsonb_build_object('scope_id', v_scope, 'already_processed', true);
  end if;

  -- El cerrojo de identidad del grupo (protocolo de 20260912150000): salir
  -- cambia la membresia, y todo lo que la lee o resuelve un vinculo lo toma.
  perform sec.lock_participant_claims(v_scope);

  -- La autorizacion: ser miembro, y nada mas (ADR-032 §2). Salir no se aprueba.
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  -- ORDEN, y no es estilo: todo lo que pasa por sec.is_member va ANTES de
  -- borrar la membresia, porque es la del propio actor la que se evalua.

  -- 1 · el participante vinculado al actor en este grupo, si lo hay.
  select l.participant_id into v_participant
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = v_scope
   limit 1;

  -- 1b · ADR-038 C5: sin pares pendientes, en las dos direcciones, comprobados
  --      por par bajo el cerrojo de identidad. Con pendientes no se sale; el
  --      cliente lleva a Pagos sugeridos. Nada se cancela ni se mueve.
  if v_participant is not null then
    select jsonb_agg(jsonb_build_object('debtor_participant_id', pp.debtor_participant_id,
                                        'creditor_participant_id', pp.creditor_participant_id,
                                        'amount', pp.amount::text))
      into v_pairs
      from sec.pending_pairs_of(v_scope) pp;
    if v_pairs is not null then
      perform sec.raise_boundary('LEAVE_BLOCKED_DEBT',
        'no puedes salir con pendientes por pagar o por cobrar', 409,
        jsonb_build_object('pairs', v_pairs));
    end if;
  end if;

  -- 2 · su presencia se cierra HOY, excluido (ADR-034 §5). Creado y salido el
  --     mismo dia deja un periodo vacio, que la restriccion admite.
  if v_participant is not null then
    update core.participant_period
       set valid_until = current_date
     where participant_id = v_participant and valid_until is null;
  end if;

  -- 3 · el hecho, y el aviso a los que se quedan (el actor aun es miembro:
  --     se excluye a si mismo, porque deja de serlo en esta transaccion).
  insert into core.group_departure (scope_id, participant_id, user_id, client_command_id)
  values (v_scope, v_participant, v_actor, v_command)
  returning id into v_departure;
  insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
  select m.user_id, v_scope, 'departure', v_departure, v_actor
    from core.membership m
   where m.scope_id = v_scope and m.user_id <> v_actor
  on conflict (recipient_user_id, kind, subject_id) do nothing;

  -- 4 · y AL FINAL, la membresia. Ni un efecto, ni una operacion, ni una fila
  --     bloqueada: solo el cerrojo de identidad.
  delete from core.membership where scope_id = v_scope and user_id = v_actor;

  return jsonb_build_object('scope_id', v_scope, 'already_processed', false);
end
$function$;

-- ═══════════════════════ §9 · api.group_pending_pair ═════════════════════════
--
-- Las DOS direcciones: un par cuya suma bruta es negativa (tras anular un pago
-- del que dependian otros) es un credito del otro lado y aflora invertido.
create or replace view api.group_pending_pair
with (security_invoker = true) as
with raw as (
  select e.scope_id, e.debt_debtor_participant_id as debtor, e.debt_creditor_participant_id as creditor, sum(e.debt_amount) as amount
    from core.current_effect e
    join core.scope s on s.id = e.scope_id and s.kind = 'group'
   where e.debt_amount is not null
   group by e.scope_id, e.debt_debtor_participant_id, e.debt_creditor_participant_id),
dirs as (
  select scope_id, debtor, creditor from raw
  union
  select scope_id, creditor, debtor from raw),
net as (
  select d.scope_id, d.debtor, d.creditor,
         coalesce((select r.amount from raw r where r.scope_id = d.scope_id and r.debtor = d.debtor and r.creditor = d.creditor), 0)
       - coalesce((select r.amount from raw r where r.scope_id = d.scope_id and r.debtor = d.creditor and r.creditor = d.debtor), 0) as amount
    from dirs d)
select scope_id, debtor as debtor_participant_id, creditor as creditor_participant_id, amount::text as amount
  from net
 where amount > 0;

-- ═══════════════════════ §10 · avisos ════════════════════════════════════════
alter table core.group_notice drop constraint group_notice_kind_check;
alter table core.group_notice add constraint group_notice_kind_check
  check (kind in ('edit', 'profile', 'departure', 'settlement', 'payment', 'payment_annulled'));
-- Los avisos de pagos llegan a la contraparte aunque ya no sea miembro (C6):
-- solo estos kinds, solo por destinatario.
create policy group_notice_client_select_payment on core.group_notice
  for select to authenticated
  using (sec.is_me(recipient_user_id) and kind in ('payment', 'payment_annulled'));
create policy group_notice_client_update_payment on core.group_notice
  for update to authenticated
  using (sec.is_me(recipient_user_id) and kind in ('payment', 'payment_annulled'))
  with check (sec.is_me(recipient_user_id) and kind in ('payment', 'payment_annulled'));

-- El nombre de la contraparte de un pago para quien mira: definer reducido,
-- solo si quien mira es una de las dos partes.
create function sec.payment_counterpart_name(p_operation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case when l.participant_id = pd.payer_participant_id then pr.display_name else pp.display_name end
    from core.operation_version ov
    join core.payment_detail pd on pd.operation_version_id = ov.id
    join core.participant pp on pp.id = pd.payer_participant_id
    join core.participant pr on pr.id = pd.receiver_participant_id
    join core.participant_user_link l on l.scope_id = pd.scope_id and l.user_id = sec.request_actor_id()
                                      and l.participant_id in (pd.payer_participant_id, pd.receiver_participant_id)
   where ov.operation_id = p_operation and ov.version_kind = 'record'
   order by ov.version_no desc
   limit 1;
$fn$;
revoke execute on function sec.payment_counterpart_name(uuid) from public;
grant execute on function sec.payment_counterpart_name(uuid) to authenticated;

-- El nombre del grupo de un aviso: para miembros y para quien tiene vinculo
-- (la contraparte de un pago que ya salio). Definer reducido.
create function sec.notice_group_name(p_scope uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select gp.display_name
    from core.group_profile gp
   where gp.scope_id = p_scope
     and (sec.is_member(p_scope)
          or exists (select 1 from core.participant_user_link l where l.scope_id = p_scope and l.user_id = sec.request_actor_id()));
$fn$;
revoke execute on function sec.notice_group_name(uuid) from public;
grant execute on function sec.notice_group_name(uuid) to authenticated;

create or replace view api.group_notice
with (security_invoker = true) as
select n.id,
       n.scope_id,
       sec.notice_group_name(n.scope_id) as group_display_name,
       n.kind,
       n.subject_id,
       sec.is_me(n.actor_user_id) as by_me,
       n.occurred_at,
       n.read_at,
       case n.kind
         when 'edit' then (select ov.operation_id from core.operation_version ov where ov.id = n.subject_id)
         when 'settlement' then (select r.operation_id from core.participant_retirement r where r.client_command_id = n.subject_id)
         when 'payment' then n.subject_id
         when 'payment_annulled' then n.subject_id
         else null::uuid
       end as operation_id,
       case n.kind
         when 'departure' then (select d.participant_id from core.group_departure d where d.id = n.subject_id)
         when 'settlement' then (select r.participant_id from core.participant_retirement r where r.client_command_id = n.subject_id)
         else null::uuid
       end as participant_id,
       case n.kind
         when 'departure' then (select p.display_name from core.group_departure d join core.participant p on p.id = d.participant_id where d.id = n.subject_id)
         when 'settlement' then (select p.display_name from core.participant_retirement r join core.participant p on p.id = r.participant_id where r.client_command_id = n.subject_id)
         -- Pagos: el nombre del OTRO (quien no soy yo), del hecho persistido.
         when 'payment' then sec.payment_counterpart_name(n.subject_id)
         when 'payment_annulled' then sec.payment_counterpart_name(n.subject_id)
         else null::text
       end as participant_display_name
  from core.group_notice n;

-- ═══════════════════════ §11 · lecturas ══════════════════════════════════════
--

-- Los pagos de un grupo, para sus miembros: la fila del movimiento de
-- transferencia en el grupo.
create view api.group_payment
with (security_invoker = true) as
select o.id as operation_id,
       -- La version VIGENTE: el expected_version_id de una anulacion desde el grupo.
       o.current_version_id as version_id,
       pd.scope_id,
       pd.payer_participant_id,
       pd.receiver_participant_id,
       ov.original_amount::text as amount,
       ov.effective_date,
       ov.version_no,
       (cur.version_kind = 'annulment') as annulled,
       sec.is_me(ov.created_by) as recorded_by_me,
       pd.declared_by_receiver,
       o.created_at as operation_created_at
  from core.operation o
  join core.operation_version cur on cur.id = o.current_version_id
  join lateral (select ov.* from core.operation_version ov where ov.operation_id = o.id and ov.version_kind = 'record' order by ov.version_no desc limit 1) ov on true
  join core.payment_detail pd on pd.operation_version_id = ov.id
 where o.operation_class = 'group_payment';
grant select on api.group_payment to authenticated;

-- Lo que cada pago cerro o reasigno, para sus miembros: del hecho persistido
-- (payment_allocation), vigente o anulado, en el orden en que se calculo.
create view api.group_payment_allocation
with (security_invoker = true) as
select o.id as operation_id,
       pa.scope_id,
       pa.ordinal,
       pa.kind,
       pa.debtor_participant_id,
       pa.creditor_participant_id,
       pa.amount::text as amount
  from core.payment_allocation pa
  join core.operation_version ov on ov.id = pa.operation_version_id
  join core.operation o on o.id = ov.operation_id
 where o.operation_class = 'group_payment';
grant select on api.group_payment_allocation to authenticated;

-- Mis pagos, por vinculo y SIN membresia: la entrada desde el movimiento de
-- transferencia de Personal para quien salio. Definer reducido: solo los
-- pagos en los que quien mira es pagador o receptor.
create function api.my_group_payment()
returns table (operation_id uuid, scope_id uuid, group_display_name text, counterpart_display_name text,
               i_paid boolean, amount text, effective_date date, annulled boolean,
               recorded_by_me boolean, annulled_by_me boolean, expected_version_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id, pd.scope_id, gp.display_name,
         case when l.participant_id = pd.payer_participant_id then pr.display_name else pp.display_name end,
         l.participant_id = pd.payer_participant_id,
         ov.original_amount::text, ov.effective_date,
         cur.version_kind = 'annulment',
         ov.created_by = sec.request_actor_id(),
         cur.version_kind = 'annulment' and cur.created_by = sec.request_actor_id(),
         o.current_version_id
    from core.operation o
    join core.operation_version cur on cur.id = o.current_version_id
    join lateral (select ov.* from core.operation_version ov where ov.operation_id = o.id and ov.version_kind = 'record' order by ov.version_no desc limit 1) ov on true
    join core.payment_detail pd on pd.operation_version_id = ov.id
    join core.group_profile gp on gp.scope_id = pd.scope_id
    join core.participant pp on pp.id = pd.payer_participant_id
    join core.participant pr on pr.id = pd.receiver_participant_id
    join core.participant_user_link l on l.scope_id = pd.scope_id and l.user_id = sec.request_actor_id()
                                      and l.participant_id in (pd.payer_participant_id, pd.receiver_participant_id)
   where o.operation_class = 'group_payment'
   order by ov.effective_date desc, o.created_at desc;
$fn$;
revoke execute on function api.my_group_payment() from public;
grant execute on function api.my_group_payment() to authenticated;

-- El contexto de un pago en Movimientos recientes de Personal: grupo y
-- contraparte, solo para las partes.
create function sec.my_group_payment_context()
returns table (operation_id uuid, group_scope_id uuid, group_display_name text, counterpart_display_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id, pd.scope_id, gp.display_name,
         case when l.participant_id = pd.payer_participant_id then pr.display_name else pp.display_name end
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.payment_detail pd on pd.operation_version_id = ov.id
    join core.group_profile gp on gp.scope_id = pd.scope_id
    join core.participant pp on pp.id = pd.payer_participant_id
    join core.participant pr on pr.id = pd.receiver_participant_id
    join core.participant_user_link l on l.scope_id = pd.scope_id and l.user_id = (select auth.uid())
                                      and l.participant_id in (pd.payer_participant_id, pd.receiver_participant_id)
   where o.operation_class = 'group_payment';
$fn$;
revoke execute on function sec.my_group_payment_context() from public;
grant execute on function sec.my_group_payment_context() to authenticated;

create or replace view api.personal_operation
with (security_invoker = true) as
select o.id as operation_id,
       o.operation_class,
       e.scope_id,
       e.currency_definition_id,
       sum(e.balance_amount)::text as balance_amount,
       ov.original_amount::text as original_amount,
       ov.effective_date,
       ov.effective_time,
       md.concept,
       xc.category_id,
       ad.target_balance::text as target_balance,
       o.current_version_id,
       ov.supersedes_version_id as previous_version_id,
       ov.version_no,
       o.created_at as operation_created_at,
       coalesce(ctx.group_scope_id, pctx.group_scope_id) as group_scope_id,
       coalesce(ctx.group_display_name, pctx.group_display_name) as group_display_name,
       ctx.your_share,
       -- Al FINAL: la contraparte de un pago (ADR-038), nula para el resto.
       pctx.counterpart_display_name as payment_counterpart
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category xc on xc.operation_version_id = ov.id
  left join core.adjustment_detail ad on ad.operation_version_id = ov.id
  left join sec.my_group_expense_context() ctx(operation_id, group_scope_id, group_display_name, your_share) on ctx.operation_id = o.id
  left join sec.my_group_payment_context() pctx(operation_id, group_scope_id, group_display_name, counterpart_display_name) on pctx.operation_id = o.id
 where s.kind = 'personal' and s.owner_user_id = (select auth.uid())
   and o.operation_class = any (array['personal_expense', 'personal_income', 'adjustment', 'group_expense', 'group_payment'])
   and ov.version_kind = 'record' and e.balance_amount is not null
 group by o.id, o.operation_class, e.scope_id, e.currency_definition_id, ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, xc.category_id, ad.target_balance, o.current_version_id, ov.supersedes_version_id, ov.version_no, o.created_at,
          ctx.group_scope_id, ctx.group_display_name, ctx.your_share, pctx.group_scope_id, pctx.group_display_name, pctx.counterpart_display_name;

-- La deuda reabierta por MIS pagos anulados, fuera del grupo (C6, acotada):
-- por cada pago mio anulado, los pares que redujo y que me nombran, y de cada
-- uno como mucho lo que redujo, acotado al pendiente vigente. Definer de
-- postgres: cruza RLS a proposito y publica solo importes de pares que me
-- nombran, en grupos de los que ya no soy miembro.
create function sec.my_reopened_debt()
returns table (currency_definition_id uuid, effective_date date, amount bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  with me as (select (select auth.uid()) as uid),
  mine as (
    select l.participant_id, l.scope_id
      from core.participant_user_link l, me
     where l.user_id = me.uid
       and not exists (select 1 from core.membership m where m.scope_id = l.scope_id and m.user_id = me.uid)),
  reduced as (
    select m.participant_id as me_p, m.scope_id, e.debt_debtor_participant_id d, e.debt_creditor_participant_id c,
           sum(- e.debt_amount) amt, s.base_currency_definition_id as cur, max(cur_v.effective_date) as annulled_on
      from mine m
      join core.scope s on s.id = m.scope_id
      join core.operation o on o.operation_class = 'group_payment'
      join core.operation_version cur_v on cur_v.id = o.current_version_id and cur_v.version_kind = 'annulment'
      join lateral (select ov.id from core.operation_version ov where ov.operation_id = o.id and ov.version_kind = 'record' order by ov.version_no desc limit 1) rec on true
      join core.payment_detail pd on pd.operation_version_id = rec.id and pd.scope_id = m.scope_id
                                  and m.participant_id in (pd.payer_participant_id, pd.receiver_participant_id)
      join core.effect e on e.operation_version_id = rec.id and e.scope_id = m.scope_id and e.debt_amount < 0
     where m.participant_id in (e.debt_debtor_participant_id, e.debt_creditor_participant_id)
     group by 1, 2, 3, 4, 6),
  capped as (
    select r.me_p, r.d, r.c, r.cur, r.annulled_on,
           least(r.amt, coalesce((select p.amount from sec.pending_pairs(r.scope_id) p where p.debtor = r.d and p.creditor = r.c), 0)) amt
      from reduced r)
  select cur, annulled_on, (case when d = me_p then - amt else amt end)::bigint
    from capped
   where amt > 0;
$fn$;
revoke execute on function sec.my_reopened_debt() from public;
grant execute on function sec.my_reopened_debt() to authenticated;

-- La deuda reabierta acotada (C6) como cifra para Deudas de Inicio: por
-- divisa, sin nombrar el grupo. Es la misma lectura que ya entra en
-- api.claimed_dimension; aqui sale sola porque la tarjeta de Inicio suma
-- posiciones por membresia (api.group_summary) y quien salio no tiene fila.
create function api.my_reopened_debt()
returns table (currency_definition_id uuid, amount text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.currency_definition_id, sum(r.amount)::text
    from sec.my_reopened_debt() r
   group by r.currency_definition_id;
$fn$;
revoke execute on function api.my_reopened_debt() from public;
grant execute on function api.my_reopened_debt() to authenticated;

CREATE OR REPLACE FUNCTION api.claimed_dimension()
 RETURNS TABLE(accounting_class text, currency_definition_id uuid, effective_date date, dimension text, amount text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
BEGIN ATOMIC
 SELECT e.accounting_class,
     e.currency_definition_id,
     ov.effective_date,
     'economic'::text,
     (e.economic_amount)::text AS economic_amount
    FROM ((core.current_effect e
      JOIN core.operation_version ov ON ((ov.id = e.operation_version_id)))
      JOIN core.participant_user_link l ON ((l.participant_id = e.economic_participant_id)))
   WHERE ((l.user_id = ( SELECT auth.uid() AS uid)) AND (e.economic_amount IS NOT NULL))
 UNION ALL
  SELECT e.accounting_class,
     e.currency_definition_id,
     ov.effective_date,
     'debt'::text,
     ((- e.debt_amount))::text AS text
    FROM ((core.current_effect e
      JOIN core.operation_version ov ON ((ov.id = e.operation_version_id)))
      JOIN core.participant_user_link l ON ((l.participant_id = e.debt_debtor_participant_id)))
   WHERE ((l.user_id = ( SELECT auth.uid() AS uid)) AND (e.debt_amount IS NOT NULL) AND sec.is_member(e.scope_id))
 UNION ALL
  SELECT e.accounting_class,
     e.currency_definition_id,
     ov.effective_date,
     'debt'::text,
     (e.debt_amount)::text AS debt_amount
    FROM ((core.current_effect e
      JOIN core.operation_version ov ON ((ov.id = e.operation_version_id)))
      JOIN core.participant_user_link l ON ((l.participant_id = e.debt_creditor_participant_id)))
   WHERE ((l.user_id = ( SELECT auth.uid() AS uid)) AND (e.debt_amount IS NOT NULL) AND sec.is_member(e.scope_id))
  UNION ALL
  -- ADR-038 C6: fuera del grupo, SOLO lo que mis pagos anulados habian cerrado,
  -- par a par, y como mucho el pendiente vigente. Nunca la deuda de otras causas.
  SELECT 'settlement'::text, r.currency_definition_id, r.effective_date, 'debt'::text, r.amount::text
    FROM sec.my_reopened_debt() r;
END;

-- ═══════════════════════ propiedad y ejecucion ════════════════════════════════
grant create on schema api to nomey_writer;
alter function api.record_group_payment(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.record_group_payment(jsonb) from public;
grant execute on function api.record_group_payment(jsonb) to authenticated;
grant execute on function sec.assert_participant_active(uuid, uuid) to nomey_writer;
