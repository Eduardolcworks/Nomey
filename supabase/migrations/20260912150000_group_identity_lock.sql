-- ============================================================================
-- EL CERROJO DE IDENTIDAD DEL GRUPO: UN PROTOCOLO PARA TODOS
-- ============================================================================
--
-- Medido con dos sesiones reales (scripts/unclaim-race-evidence.sh, antes de
-- esta migracion): una desvinculacion simulada que tomaba la fila del ambito y
-- despues el cerrojo de reclamar/retirar NO bastaba frente a
-- api.record_group_expense: el writer resolvia el Personal de la pagadora por
-- su vinculo ANTES de sec.lock_scopes (necesita saberlo para bloquearlo),
-- esperaba, y escribia la caja en un Personal que ya no era de la pagadora.
-- Ningun orden serial produce ese estado. Lo mismo vale para
-- api.record_settlement_by_transfer, que resuelve los dos extremos igual.
--
-- La causa no es la falta de relectura sino el ORDEN: la identidad
-- (membresia, vinculo, presencia, retiro) se leia bajo un cerrojo que no
-- todos tomaban, o antes de tomarlo. Desde aqui, TODA transaccion que lea o
-- cambie identidad de un grupo la protege desde la primera lectura hasta el
-- commit con el mismo cerrojo, en el mismo lugar del orden:
--
--   0 · la clave de idempotencia (client_command / provisioning_command /
--       retirement por replay), como hasta ahora: ANTES de todo bloqueo.
--   1 · sec.lock_participant_claims(grupo): el cerrojo consultivo de
--       transaccion por ambito. UNO por transaccion. Despues de el, y nunca
--       antes, se lee la membresia del actor, se resuelve un participante a
--       su Modo Personal, se mira si esta disponible o retirado, y se escribe
--       cualquiera de esas relaciones.
--   2 · sec.lock_scopes(filas ascendentes): grupo y Personales YA resueltos.
--   3 · sec.lock_and_cas(operacion): la fila de la operacion, si es correccion.
--
-- Quien lo toma: reclamar (ya lo tomaba, solo el cerrojo: el provisioner no
-- puede ver la fila del ambito, y sigue sin verla), retirar y «Saldado»
-- (antes tomaban la fila y despues el cerrojo: se invierte), salir (no tomaba
-- nada), y los dos writers que resuelven Personales por vinculo. Los writers
-- personales y record_debt_settlement no leen identidad por vinculo y siguen
-- en 2–3.
--
-- Sin interbloqueo, y no solo para un grupo: cada transaccion adquiere en
-- rango estrictamente creciente (0 < 1 < 2 < 3; dentro de 2, uuid
-- ascendente; en 1 hay un unico cerrojo por transaccion). Si T1 espera un
-- bloqueo L que tiene T2, todo lo que T1 tiene es de rango menor que L, y todo
-- lo que T2 pueda esperar es de rango mayor: siguiendo un ciclo el rango
-- crece sin fin, luego no hay ciclo. La clave (0) solo la espera quien la
-- repite, y quien la tiene la tomo antes que nada. Las unicidades de despues
-- (vinculo, retiro, membresia) solo pueden chocar entre transacciones del
-- mismo grupo, que ya se serializaron en 1: nunca se esperan.
--
-- Colision del hash: hashtextextended(scope::text, 0) es de 64 bits; dos
-- grupos con la misma clave compartirian cerrojo y se serializarian de mas,
-- nunca de menos. Con un cerrojo por transaccion no altera el orden.
--
-- Lo que NO cambia: ninguna regla de negocio, ningun codigo de error, ningun
-- grant; cada funcion se recrea con create or replace, que conserva
-- propietario y permisos. Coordinacion F11: record_group_expense y
-- record_settlement_by_transfer son los writers que F11 toca; cualquier
-- recreacion posterior debe conservar la linea del cerrojo, y
-- supabase/checks/group-identity-lock.sql falla si no.
-- ============================================================================

comment on function sec.lock_participant_claims(uuid) is
  'Cerrojo de identidad del grupo: consultivo, de transaccion, uno por transaccion; '
  'se toma despues de la clave de idempotencia y antes de leer membresia, vinculo, '
  'presencia o retiro, y antes de sec.lock_scopes. Lo toman reclamar, rectificar, '
  'retirar, «Saldado», salir y los writers que resuelven un Personal por vinculo.';

-- ─── api.record_group_expense ───────────────────────────────────────────────
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
    perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
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

-- ─── api.record_settlement_by_transfer ──────────────────────────────────────
CREATE OR REPLACE FUNCTION api.record_settlement_by_transfer(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'debt_scope_id','currency_definition_id','amount',
    'debtor_participant_id','creditor_participant_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_debtor uuid; v_creditor uuid; v_from uuid; v_to uuid; v_owner uuid;
  v_canonical jsonb; v_lock uuid[]; v_pending bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'debt_scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_debtor   := sec.payload_uuid(payload, 'debtor_participant_id', true);
  v_creditor := sec.payload_uuid(payload, 'creditor_participant_id', true);

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
    'debt_scope_id',           v_scope::text,
    'currency_definition_id',  v_currency::text,
    'amount',                  payload ->> 'amount',
    'effective_date',          v_date::text,
    'debtor_participant_id',   v_debtor::text,
    'creditor_participant_id', v_creditor::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'settlement_by_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- EL CERROJO DE IDENTIDAD DEL GRUPO, antes de leer membresia o vinculo y
  -- antes de cualquier fila (protocolo de 20260912150000): el pagador que se
  -- resuelve aqui abajo no puede cambiar hasta el commit.
  perform sec.lock_participant_claims(v_scope);

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);

  v_from := sec.participant_personal_scope(v_debtor);
  if v_from is null then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo el deudor origina el pago de su deuda mediante transferencia', 403);
  end if;
  select s.owner_user_id into v_owner from core.scope s where s.id = v_from;
  if v_owner is distinct from v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo el deudor origina el pago de su deuda mediante transferencia', 403);
  end if;

  v_to := sec.participant_personal_scope(v_creditor);
  if v_to is null then
    perform sec.raise_boundary('CREDITOR_WITHOUT_PERSONAL_SCOPE',
      'el acreedor no tiene Modo Personal: ese pago es una transferencia externa mas una liquidacion, y son dos operaciones', 422);
  end if;
  if v_from = v_to then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'origen y destino no pueden ser el mismo ambito', 400);
  end if;

  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_no_conversion(v_from,  v_currency);
  perform sec.assert_no_conversion(v_to,    v_currency);
  perform sec.assert_participant_eligible(v_debtor,   v_scope, v_date);
  perform sec.assert_participant_eligible(v_creditor, v_scope, v_date);
  -- ADR-034 §6: es la barrera que impide mover la CAJA del Modo Personal de
  -- quien salio con una transferencia retro-fechada (medido en E23). Ambos
  -- extremos activos ahora, sea cual sea la fecha.
  perform sec.assert_participant_active(v_debtor,   v_scope);
  perform sec.assert_participant_active(v_creditor, v_scope);

  -- Solo el ambito de la DEUDA entra en el protocolo: los dos Modos Personales
  -- reciben saldo, y el saldo no es deuda. ADR-013 §11 decide la pertenencia
  -- «por que efectos produce», y ninguno de esos dos efectos toca la dimension
  -- de deuda.
  v_lock := array[v_scope];
  v_obs := array[v_from, v_to];
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
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_pending := sec.pending_debt(v_scope, v_debtor, v_creditor,
                                case when v_correction then v_expected end);
  if v_amount > v_pending then
    perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
      format('Se intenta liquidar %s sobre una deuda pendiente de %s', v_amount, v_pending), 422);
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'settlement_by_transfer', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_currency,   v_amount);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
          - v_amount, v_debtor, v_creditor);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$;

-- ─── api.retire_participant ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.retire_participant(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id', 'command_contract_version', 'scope_id', 'participant_id', 'expected_pairs'];
  v_actor    uuid;
  v_key      uuid;
  v_contract integer;
  v_scope    uuid;
  v_target   uuid;
  v_parsed   record;
  v_existing core.participant_retirement%rowtype;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor    := sec.request_actor_id();
  v_key      := sec.payload_uuid(payload, 'client_operation_id', true);
  v_contract := sec.payload_contract_version(payload);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_target   := sec.payload_uuid(payload, 'participant_id', true);
  select * into v_parsed from sec.parse_retirement_payload(payload, v_scope, v_target);

  -- El cerrojo de identidad ANTES de la membresia y del vinculo, y antes de la
  -- fila del ambito (protocolo de 20260912150000).
  perform sec.lock_participant_claims(v_scope);

  -- Cualquier miembro actual (ADR-032 §2), sobre un participante del grupo.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  if not exists (select 1 from core.participant p where p.id = v_target and p.scope_id = v_scope) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'el participante no pertenece a este grupo', 422);
  end if;

  -- La fila del ambito (deuda, ADR-013 §11): despues del cerrojo, nunca antes.
  perform sec.lock_scopes(array[v_scope]);

  select * into v_existing from core.participant_retirement r where r.participant_id = v_target;
  if v_existing.participant_id is not null then
    if v_existing.client_command_id = v_key and v_existing.retired_by = v_actor then
      return jsonb_build_object('participant_id', v_target, 'operation_id', v_existing.operation_id,
                                'already_processed', true);
    end if;
    perform sec.raise_boundary('PARTICIPANT_RETIRED', 'este participante ya fue retirado', 409);
  end if;

  -- SIN CUENTA, comprobado aqui y ahora: un vinculo —aunque sea de quien
  -- salio— lo saca de esta via. A quien tiene cuenta no se le retira por otro.
  if exists (select 1 from core.participant_user_link l where l.participant_id = v_target) then
    perform sec.raise_boundary('PARTICIPANT_LINKED',
      'este participante tiene cuenta: no se puede eliminar ni retirar por otra persona', 409);
  end if;

  -- Su presencia se cierra HOY, dia de salida excluido, como al salir (ADR-034 §3).
  update core.participant_period pp
     set valid_until = current_date
   where pp.participant_id = v_target and pp.valid_until is null;

  return sec.retire_participant_core(payload, v_actor, v_key, v_scope, v_target,
                                     v_parsed.o_expected, v_parsed.o_total, v_parsed.o_canonical);
end
$function$;

-- ─── api.settle_participant ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.settle_participant(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id', 'command_contract_version', 'scope_id', 'participant_id', 'expected_pairs'];
  v_actor    uuid;
  v_key      uuid;
  v_contract integer;
  v_scope    uuid;
  v_target   uuid;
  v_parsed   record;
  v_existing core.participant_retirement%rowtype;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor    := sec.request_actor_id();
  v_key      := sec.payload_uuid(payload, 'client_operation_id', true);
  v_contract := sec.payload_contract_version(payload);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_target   := sec.payload_uuid(payload, 'participant_id', true);
  select * into v_parsed from sec.parse_retirement_payload(payload, v_scope, v_target);

  -- El cerrojo de identidad ANTES de la membresia y de la presencia, y antes
  -- de la fila del ambito (protocolo de 20260912150000).
  perform sec.lock_participant_claims(v_scope);

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  if not exists (select 1 from core.participant p where p.id = v_target and p.scope_id = v_scope) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'el participante no pertenece a este grupo', 422);
  end if;

  perform sec.lock_scopes(array[v_scope]);

  select * into v_existing from core.participant_retirement r where r.participant_id = v_target;
  if v_existing.participant_id is not null then
    if v_existing.client_command_id = v_key and v_existing.retired_by = v_actor then
      return jsonb_build_object('participant_id', v_target, 'operation_id', v_existing.operation_id,
                                'already_processed', true);
    end if;
    perform sec.raise_boundary('PARTICIPANT_RETIRED', 'este participante ya fue dado por saldado', 409);
  end if;

  if exists (select 1 from core.participant_period pp where pp.participant_id = v_target and pp.valid_until is null) then
    perform sec.raise_boundary('PARTICIPANT_ACTIVE',
      'el participante sigue en el grupo; «Saldado» es solo para quien salio', 422);
  end if;

  return sec.retire_participant_core(payload, v_actor, v_key, v_scope, v_target,
                                     v_parsed.o_expected, v_parsed.o_total, v_parsed.o_canonical);
end
$function$;

-- ─── api.leave_group ────────────────────────────────────────────────────────
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
