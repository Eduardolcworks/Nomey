-- ============================================================================
-- SALIR A CERO: LA SALIDA REASIGNA LAS OBLIGACIONES (ADR-038 C8) — BORRADOR
-- ============================================================================
--
-- Decision de producto (2026-09-14): quien queda a NETO cero puede salir
-- aunque conserve pares; sus pares se reasignan entre los demas sin dinero
-- (Aitor>Edu 3 y Edu>Luis 3 → Aitor>Luis 3). Ningun pago se inventa, ninguna
-- caja se mueve, ningun gasto se reescribe, no hay renta ni gasto.
--
--   §1  core.group_departure.novation_operation_id (procedencia)
--   §2  sec.record_departure_novation: la operacion de clase
--       departure_novation, escrita por el writer, atomica e idempotente con
--       la salida (misma clave, otra relacion)
--   §3  sec.persist_version: una novacion de salida no se anula
--   §4  api.leave_group: neto cero en vez de cero pares
--
-- Evidencia: supabase/checks/departure-novation.sql (aislado).

-- ═══════════════════════ §1 · procedencia ═════════════════════════════════════
alter table core.group_departure add column novation_operation_id uuid references core.operation (id);
comment on column core.group_departure.novation_operation_id is
  'La novacion de salida (ADR-038 C8) que reasigno los pares de quien salio, si los tenia. Nulo si salio sin pares.';

-- ═══════════════════════ §2 · la novacion de salida ═══════════════════════════
--
-- Del writer (definer de nomey_writer), invocable por el provisioner desde
-- api.leave_group, que ya tiene el cerrojo de identidad del grupo. Toma el
-- rango 2 del grupo y escribe UNA operacion de clase departure_novation:
-- liquidaciones de todos los pares del que sale y novaciones D>C por el
-- emparejamiento determinista de sus entrantes con sus salientes. Exige neto
-- cero: si no, nada se escribe. Idempotente por (actor, clave de la salida)
-- en core.client_command: un reintento de la salida no escribe otra.
create function sec.record_departure_novation(p_scope uuid, p_participant uuid, p_command uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ins_d uuid[]; v_ins_a bigint[]; v_out_c uuid[]; v_out_a bigint[];
  v_sum_in bigint; v_sum_out bigint; v_i int := 1; v_k int := 1; v_take bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid; v_correction boolean; v_expected uuid;
  v_currency uuid; v_payload jsonb; v_canonical jsonb; v_total bigint;
begin
  select coalesce(array_agg(pp.debtor order by pp.debtor), '{}'), coalesce(array_agg(pp.amount order by pp.debtor), '{}'), coalesce(sum(pp.amount), 0)
    into v_ins_d, v_ins_a, v_sum_in
    from sec.pending_pairs(p_scope) pp where pp.creditor = p_participant;
  select coalesce(array_agg(pp.creditor order by pp.creditor), '{}'), coalesce(array_agg(pp.amount order by pp.creditor), '{}'), coalesce(sum(pp.amount), 0)
    into v_out_c, v_out_a, v_sum_out
    from sec.pending_pairs(p_scope) pp where pp.debtor = p_participant;
  if v_sum_in <> v_sum_out then
    perform sec.raise_boundary('LEAVE_BLOCKED_DEBT', 'la novacion de salida exige neto cero', 409,
      jsonb_build_object('net', (v_sum_in - v_sum_out)::text));
  end if;
  if v_sum_in = 0 then return null; end if;
  v_total := v_sum_in;

  -- La clave de la salida, como clave de esta operacion (clase distinta: no
  -- colisiona con ningun pago ni gasto del actor).
  v_payload := jsonb_build_object('client_operation_id', p_command, 'command_contract_version', 1, 'scope_id', p_scope);
  v_canonical := jsonb_build_object('scope_id', p_scope::text, 'participant_id', p_participant::text, 'total', v_total::text);
  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(v_payload, 'departure_novation', v_canonical);
  if v_replay then return v_operation; end if;

  select s.base_currency_definition_id into v_currency from core.scope s where s.id = p_scope;
  perform sec.lock_scopes(array[p_scope]);
  perform sec.persist_version(v_actor, v_operation, v_version, 1, null, 'departure_novation', current_date, v_total, v_currency);

  -- Liquidaciones: todos los pares del que sale, en las dos direcciones.
  for v_i in 1 .. coalesce(array_length(v_ins_d, 1), 0) loop
    insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values (gen_random_uuid(), v_version, p_scope, 'settlement', v_currency, - v_ins_a[v_i], v_ins_d[v_i], p_participant);
  end loop;
  for v_k in 1 .. coalesce(array_length(v_out_c, 1), 0) loop
    insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values (gen_random_uuid(), v_version, p_scope, 'settlement', v_currency, - v_out_a[v_k], p_participant, v_out_c[v_k]);
  end loop;
  -- Novaciones: entrantes y salientes ordenados por identidad, el minimo restante cada vez.
  v_i := 1; v_k := 1;
  while v_i <= array_length(v_ins_d, 1) and v_k <= array_length(v_out_c, 1) loop
    v_take := least(v_ins_a[v_i], v_out_a[v_k]);
    if v_take > 0 then
      insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, p_scope, 'novation', v_currency, v_take, v_ins_d[v_i], v_out_c[v_k]);
      v_ins_a[v_i] := v_ins_a[v_i] - v_take; v_out_a[v_k] := v_out_a[v_k] - v_take;
    end if;
    if v_ins_a[v_i] = 0 then v_i := v_i + 1; end if;
    if v_k <= array_length(v_out_c, 1) and v_out_a[v_k] = 0 then v_k := v_k + 1; end if;
  end loop;
  return v_operation;
end
$fn$;
grant create on schema sec to nomey_writer;
alter function sec.record_departure_novation(uuid, uuid, uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.record_departure_novation(uuid, uuid, uuid) from public;
grant execute on function sec.record_departure_novation(uuid, uuid, uuid) to nomey_provisioner;

-- ═══════════════════════ §3 · no se anula ════════════════════════════════════
-- La guarda vive donde toda anulacion pasa: sec.persist_version con
-- version_kind = 'annulment'. Se recrea desde el cuerpo vivo con esa linea.
create or replace function sec.persist_version(p_actor uuid, p_operation uuid, p_version uuid, p_version_no integer, p_supersedes uuid, p_operation_class text, p_effective_date date, p_original_amount bigint, p_currency uuid, p_effective_time time without time zone DEFAULT NULL::time without time zone, p_version_kind text DEFAULT 'record'::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_clase text;
  v_kind  text;
begin
  if p_version_no = 1 then
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values (p_operation, p_operation_class, p_actor, p_version);
  else
    -- GUARDA DE CLASE (ADR-020 §6). La operacion ya esta bloqueada por
    -- `sec.lock_and_cas`, asi que esta lectura no compite con nadie, y corre
    -- DESPUES del CAS: no es un oraculo de la clase de una operacion ajena.
    select o.operation_class into v_clase from core.operation o where o.id = p_operation;
    if v_clase is distinct from p_operation_class then
      perform sec.raise_boundary('OPERATION_CLASS_MISMATCH',
        format('la operacion es de clase %s y esta funcion escribe %s: una clase no corrige a otra',
               v_clase, p_operation_class), 422);
    end if;

    -- GUARDA DE ANULACION. La version que se sustituye es la vigente, por el
    -- CAS. Si es una anulacion, la operacion esta cerrada.
    select ov.version_kind into v_kind
      from core.operation_version ov where ov.id = p_supersedes;
    if v_kind = 'annulment' then
      perform sec.raise_boundary('OPERATION_ANNULLED',
        'la operacion esta anulada y no admite versiones nuevas', 409);
    end if;
    -- Una novacion de salida (ADR-038 C8) no admite versiones: ni correccion
    -- ni anulacion. Es la consecuencia de una salida, que tampoco se deshace.
    if v_clase = 'departure_novation' then
      perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
        'una novacion de salida no se corrige ni se anula', 422);
    end if;
  end if;

  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, effective_time, original_amount, original_currency_definition_id,
     economic_rules_version, version_kind)
  values (p_version, p_operation, p_version_no, p_supersedes, p_actor,
          p_effective_date, p_effective_time, p_original_amount, p_currency, 'v1',
          p_version_kind);

  if p_version_no > 1 then
    update core.operation set current_version_id = p_version where id = p_operation;
  end if;
end
$function$

;


-- ═══════════════════════ §4 · api.leave_group ════════════════════════════════
create or replace function api.leave_group(payload jsonb)
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
  v_net         bigint;
  v_novation    uuid;
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

  -- 1b · ADR-038 C8 (20260914120000): se sale con NETO cero, bajo el cerrojo
  --      de identidad. Con neto distinto de cero no se sale (el cliente lleva
  --      a Pagos sugeridos, que reparte netos). Con neto cero y pares vivos,
  --      la salida los REASIGNA entre los demas sin dinero (novacion de
  --      salida): nada se cancela, ninguna caja se mueve, ningun gasto se
  --      reescribe.
  if v_participant is not null then
    select jsonb_agg(jsonb_build_object('debtor_participant_id', pp.debtor_participant_id,
                                        'creditor_participant_id', pp.creditor_participant_id,
                                        'amount', pp.amount::text)),
           coalesce(sum(case when pp.creditor_participant_id = v_participant then pp.amount else - pp.amount end), 0)
      into v_pairs, v_net
      from sec.pending_pairs_of(v_scope) pp;
    if v_net <> 0 then
      perform sec.raise_boundary('LEAVE_BLOCKED_DEBT',
        'no puedes salir con saldo pendiente por pagar o por cobrar', 409,
        jsonb_build_object('net', v_net::text, 'pairs', v_pairs));
    end if;
    if v_pairs is not null then
      v_novation := sec.record_departure_novation(v_scope, v_participant, v_command);
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
  insert into core.group_departure (scope_id, participant_id, user_id, client_command_id, novation_operation_id)
  values (v_scope, v_participant, v_actor, v_command, v_novation)
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
$function$

;
