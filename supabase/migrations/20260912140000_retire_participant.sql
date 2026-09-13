-- ============================================================================
-- RETIRAR A UN PARTICIPANTE SIN CUENTA · api.retire_participant
-- ============================================================================
--
-- ═══════════ LO QUE AMPLIA DE ADR-034, Y QUEDA EXPLICITO ═══════════
--
-- ADR-034 §6 fijo «Saldado» SOLO para quien SALIO del grupo: un participante
-- inactivo, con o sin cuenta, al que un miembro da por saldado (pares CAS, un
-- efecto de deuda por par, retiro, sin caja). Esta migracion AMPLIA ese
-- contrato a un caso que ADR-034 no cubria y que aqui se decide: un
-- participante ACTIVO declarado por su nombre y SIN cuenta puede ser retirado
-- por cualquier miembro actual. Es la misma retirada —mismo registro, mismos
-- pares, misma ausencia de dinero en Personal—, precedida de cerrar HOY su
-- presencia (`valid_until = current_date`, dia de salida excluido, como al
-- salir). No es comportamiento del contrato anterior: es una ampliacion.
--
-- La pantalla lo llama «Eliminar participante» cuando no tiene historial y
-- «Retirar participante» cuando lo tiene. Por debajo son la misma operacion:
-- NO hay borrado fisico. Un participante sin historial se retira igual —su
-- fila queda, fuera de listas, contador y selectores, y no vuelve a ofrecerse
-- para reclamar ni para nuevos gastos (sec.participant_available)— porque la
-- retirada es lo que da idempotencia, aviso y ausencia de dobles caminos; un
-- borrado fisico no las daria y no aporta nada que la persona vea.
--
-- ═══════════ LO QUE EL SERVIDOR COMPRUEBA DENTRO DE LA TRANSACCION ═══════════
--
-- - Bajo el bloqueo del ambito (ADR-013 §11), que el participante sigue SIN
--   cuenta: un vinculo, aunque sea de quien salio, es PARTICIPANT_LINKED (409).
--   Un antiguo miembro inactivo con vinculo no es un participante sin cuenta.
-- - Que reclamar y retirar no se crucen: api.redeem_invitation y esta funcion
--   toman el MISMO cerrojo de transaccion por ambito antes de decidir, asi que
--   una reclamacion concurrente ve la retirada (participant_available) o la
--   retirada ve el vinculo. Nunca ambos.
-- - Los pares REALES bajo bloqueo contra los que el cliente enseno
--   (SETTLEMENT_STALE si cambiaron): una deuda pendiente no se cancela por
--   pulsar «Eliminar»; se salda con el mismo efecto que «Saldado», y el
--   cliente lo detalla antes. Saldo neto cero con pares pendientes sigue
--   siendo pares pendientes.
-- - Reintento con la misma clave: replay por participant_retirement.
--
-- Nada se borra: ni operaciones, ni efectos, ni referencias; el nombre sigue en
-- los movimientos y en api.group_participant (is_retired). Sin cambios en
-- gastos, reclamacion, salida ni en las politicas de F11.

-- ─────────────── 1 · reclamar y retirar se serializan ──────────────────────
-- Un cerrojo consultivo de transaccion por ambito. No es la fila estable del
-- ambito (ADR-013 §11): al reclamar, el actor todavia no es miembro y el
-- provisioner no puede ver esa fila —y group-provisioning E6 exige que no la
-- vea—. Un cerrojo consultivo no lee nada y sirve a los dos roles. Se toma
-- despues de lock_scopes en el writer, y solo el, asi que no hay ciclo.
create function sec.lock_participant_claims(p_scope uuid)
returns void
language sql
volatile
set search_path = ''
as $fn$
  select pg_advisory_xact_lock(hashtextextended(p_scope::text, 0));
$fn$;
revoke execute on function sec.lock_participant_claims(uuid) from public;
grant execute on function sec.lock_participant_claims(uuid) to nomey_writer, nomey_provisioner;

create or replace function api.redeem_invitation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'token', 'choice', 'participant_id', 'display_name'];
  v_actor   uuid;
  v_command uuid;
  v_version integer;
  v_token   text;
  v_choice  text;
  v_target  uuid;
  v_name    text;
  v_inv     record;
  v_intent  jsonb;
  v_stored  jsonb;
  v_replay  boolean := false;
  v_new     uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_token   := payload ->> 'token';
  v_choice  := payload ->> 'choice';
  v_target  := (payload ->> 'participant_id')::uuid;
  if v_command is null or v_version is null or v_token is null or v_choice is null then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'client_command_id, command_contract_version, token y choice son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  if v_choice = 'claim' then
    if v_target is null then
      perform sec.raise_boundary('PAYLOAD_INVALID', 'reclamar exige participant_id', 400);
    end if;
  elsif v_choice = 'new' then
    -- El nombre REAL del perfil, o el que la persona escribio: nunca el correo.
    v_name := sec.canonical_display_name(payload ->> 'display_name');
  else
    perform sec.raise_boundary('PAYLOAD_INVALID', 'choice es claim o new', 400);
  end if;

  -- LA INVITACION SE VERIFICA EN CADA OPERACION, no solo al previsualizar. De
  -- ella sale el ambito: ningun scope_id del payload vale como autorizacion.
  select * into v_inv from sec.resolve_invitation(v_token);
  if v_inv.state <> 'ok' then
    -- Sin excepcion, para que el intento fallido quede apuntado (ver arriba).
    -- Nada se ha escrito todavia: no hay clave reclamada ni membresia.
    return jsonb_build_object('state', v_inv.state);
  end if;

  -- La intencion canonica lleva la invitacion por su id, nunca el token.
  v_intent := jsonb_build_object('invitation_id', v_inv.invitation_id, 'choice', v_choice,
                                 'participant_id', v_target::text, 'display_name', v_name);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'invitation.redeem', v_version, v_intent, v_inv.scope_id);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT', 'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);
    end if;
    return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'already_processed', true);
  end if;

  -- RECLAMAR Y RETIRAR SE SERIALIZAN ANTES DE MIRAR NADA: un cerrojo de
  -- transaccion por ambito (sec.lock_participant_claims) que toman los dos
  -- comandos, asi que ninguno decide sobre un estado que el otro esta
  -- cambiando. No es la fila estable del ambito —el provisioner no puede verla
  -- aqui: al reclamar todavia no es miembro— sino un cerrojo consultivo.
  perform sec.lock_participant_claims(v_inv.scope_id);

  -- Ya miembro: se abre el grupo. Ni membresia, ni participante, ni vinculo nuevos.
  if exists (select 1 from core.membership m where m.scope_id = v_inv.scope_id and m.user_id = v_actor) then
    return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'already_member', true, 'already_processed', false);
  end if;
  -- Salio con vinculo (ADR-034): no se fabrica otro participante para eludirlo.
  if exists (select 1 from core.participant_user_link l where l.scope_id = v_inv.scope_id and l.user_id = v_actor) then
    perform sec.raise_boundary('REJOIN_NOT_AVAILABLE',
      'ya estuviste en este grupo; reincorporarse todavia no esta disponible', 409);
  end if;

  -- 1 · la membresia, con el comando como testigo (politica de arriba).
  insert into core.membership (scope_id, user_id) values (v_inv.scope_id, v_actor);

  if v_choice = 'claim' then
    -- 2a · el participante: de ESTE ambito, sin vinculo, no retirado, presente.
    if not exists (select 1 from core.participant p where p.id = v_target and p.scope_id = v_inv.scope_id) then
      perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'ese participante no es de este grupo', 422);
    end if;
    if not sec.participant_available(v_target, v_inv.scope_id) then
      -- Vinculado, retirado o sin presencia: conflicto recuperable, se releen opciones.
      perform sec.raise_boundary('PARTICIPANT_ALREADY_CLAIMED', 'ese participante ya no esta disponible', 409);
    end if;
    -- 3a · el vinculo. La clave primaria es el arbitro de la carrera: si otra
    --      cuenta lo reclamo antes, esto falla y TODA la transaccion vuelve
    --      atras, membresia incluida. Conflicto recuperable: se releen opciones.
    begin
      insert into core.participant_user_link (participant_id, scope_id, user_id)
      values (v_target, v_inv.scope_id, v_actor);
    exception when unique_violation then
      perform sec.raise_boundary('PARTICIPANT_ALREADY_CLAIMED', 'otra cuenta acaba de reclamar ese participante', 409);
    end;
    return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'participant_id', v_target, 'already_processed', false);
  end if;

  -- 2b · nuevo: identidad contextual con el nombre real, presencia desde HOY
  --      —sin reparto retroactivo: los gastos anteriores no lo nombran—, y el
  --      vinculo.
  if v_name is null or v_name = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'hace falta un nombre para entrar como nuevo', 400);
  end if;
  v_new := gen_random_uuid();
  insert into core.participant (id, scope_id, display_name) values (v_new, v_inv.scope_id, v_name);
  insert into core.participant_period (participant_id, valid_from, valid_until) values (v_new, current_date, null);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (v_new, v_inv.scope_id, v_actor);
  return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'participant_id', v_new, 'already_processed', false);
end
$fn$;

-- ─────────────── 2 · el writer puede CERRAR una presencia ───────────────────
grant update (valid_until) on core.participant_period to nomey_writer;
-- Solo presencias de grupos de los que el actor es miembro, y solo para
-- CERRARLAS (WITH CHECK exige un limite). Con el idioma del writer: la
-- membresia por core.membership y sec.request_actor_id(), no sec.is_member,
-- que el writer no puede ejecutar.
create policy participant_period_writer_close on core.participant_period
  for update to nomey_writer
  using (exists (select 1 from core.participant p
                   join core.membership m on m.scope_id = p.scope_id
                  where p.id = participant_period.participant_id and m.user_id = sec.request_actor_id()))
  with check (valid_until is not null
              and exists (select 1 from core.participant p
                            join core.membership m on m.scope_id = p.scope_id
                           where p.id = participant_period.participant_id and m.user_id = sec.request_actor_id()));

-- ─────────────── 3 · si un participante tiene historial ─────────────────────
-- Para que la pantalla diga «Eliminar» o «Retirar»: sale de los efectos
-- VIGENTES que lo nombran (cuota, deuda en cualquiera de los dos lados), por un
-- definer reducido con la guardia de membresia, como participant_presence.
create function sec.participant_has_history(p_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from core.participant p
     where p.id = p_participant
       and sec.is_member(p.scope_id)
       and exists (select 1 from core.current_effect e
                    where e.economic_participant_id = p.id
                       or e.debt_debtor_participant_id = p.id
                       or e.debt_creditor_participant_id = p.id)
  );
$fn$;
revoke execute on function sec.participant_has_history(uuid) from public;
grant execute on function sec.participant_has_history(uuid) to authenticated;

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
       sec.participant_is_linked(p.id) as is_linked,
       -- Al FINAL, como is_linked.
       sec.participant_has_history(p.id) as has_history
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr on true
 where s.kind = 'group';

-- ─────────────── 4 · el nucleo de la retirada, compartido ───────────────────
-- Lo que «Saldado» hacia despues de sus guardias, extraido tal cual para que
-- retirar a un sin cuenta y dar por saldado a quien salio sean UNA sola
-- retirada: pares reales bajo bloqueo, CAS contra lo ensenado, una operacion
-- con un efecto de deuda por par si los hay, el registro de retiro y el aviso.
-- Quien llama ya valido el payload, autorizo, bloqueo el ambito y comprobo el
-- estado que le toca (inactivo, o sin cuenta).
create function sec.retire_participant_core(
  payload     jsonb,
  p_actor     uuid,
  p_key       uuid,
  p_scope     uuid,
  p_target    uuid,
  p_expected  text[],
  p_total     bigint,
  p_canonical jsonb
)
returns jsonb
language plpgsql
volatile
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
revoke execute on function sec.retire_participant_core(jsonb, uuid, uuid, uuid, uuid, text[], bigint, jsonb) from public;
grant execute on function sec.retire_participant_core(jsonb, uuid, uuid, uuid, uuid, text[], bigint, jsonb) to nomey_writer;

-- Y la validacion del payload, tambien compartida: devuelve los pares
-- esperados canonizados, su suma y la intencion canonica.
create function sec.parse_retirement_payload(payload jsonb, p_scope uuid, p_target uuid,
                                             out o_expected text[], out o_total bigint, out o_canonical jsonb)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  c_pair_fields constant text[] := array['debtor_participant_id', 'creditor_participant_id', 'amount'];
  v_item   jsonb;
  v_amount bigint;
begin
  if jsonb_typeof(payload -> 'expected_pairs') is distinct from 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'expected_pairs debe ser una lista, aunque este vacia', 400);
  end if;
  o_expected := '{}';
  o_total := 0;
  for v_item in select value from jsonb_array_elements(payload -> 'expected_pairs') loop
    perform sec.assert_payload_shape(v_item, c_pair_fields);
    v_amount := sec.payload_amount(v_item, 'amount');
    if v_amount <= 0 then
      perform sec.raise_boundary('PAYLOAD_INVALID', 'cada par pendiente lleva un importe positivo', 400);
    end if;
    if (sec.payload_uuid(v_item, 'debtor_participant_id', true) <> p_target
        and sec.payload_uuid(v_item, 'creditor_participant_id', true) <> p_target) then
      perform sec.raise_boundary('PAYLOAD_INVALID', 'cada par nombra al participante que se salda', 400);
    end if;
    o_expected := o_expected || (
      (v_item ->> 'debtor_participant_id') || '>' || (v_item ->> 'creditor_participant_id') || ':' || v_amount::text);
    o_total := o_total + v_amount;
  end loop;
  select coalesce(array_agg(x order by x), '{}') into o_expected from unnest(o_expected) x;
  o_canonical := jsonb_build_object(
    'scope_id', p_scope::text, 'participant_id', p_target::text, 'expected_pairs', to_jsonb(o_expected));
end
$fn$;
revoke execute on function sec.parse_retirement_payload(jsonb, uuid, uuid) from public;
grant execute on function sec.parse_retirement_payload(jsonb, uuid, uuid) to nomey_writer;

-- ─────────────── 5 · «Saldado», sobre el nucleo, con su misma conducta ──────
create or replace function api.settle_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
$fn$;

-- ─────────────── 6 · retirar a un participante SIN cuenta ───────────────────
create function api.retire_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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

  -- Cualquier miembro actual (ADR-032 §2), sobre un participante del grupo.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  if not exists (select 1 from core.participant p where p.id = v_target and p.scope_id = v_scope) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'el participante no pertenece a este grupo', 422);
  end if;

  -- El bloqueo del ambito (deuda) y, despues, el cerrojo que comparte con
  -- reclamar: ANTES de mirar el vinculo, que es lo que serializa a los dos.
  perform sec.lock_scopes(array[v_scope]);
  perform sec.lock_participant_claims(v_scope);

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
$fn$;

-- Cambiar de dueno exige CREATE sobre el esquema, solo durante el traspaso.
grant create on schema api to nomey_writer;
alter function api.retire_participant(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.retire_participant(jsonb) from public;
grant execute on function api.retire_participant(jsonb) to authenticated;

comment on function api.retire_participant(jsonb) is
  'Retira a un participante ACTIVO y SIN cuenta (ampliacion explicita de ADR-034 §6): '
  'cierra su presencia hoy y lo da por saldado con la misma retirada que «Saldado». '
  'PARTICIPANT_LINKED si tiene cuenta; SETTLEMENT_STALE si los pares cambiaron.';
