-- ============================================================================
-- TRANSFERENCIAS DENTRO DE UN GRUPO CON DOS VOLUNTADES: la propuesta de grupo
-- y la settlement_by_transfer que la acepta. F12/ADR-003 (F12.B3).
--
-- Cierra F12.B: record_settlement_by_transfer deja aqui, ATOMICAMENTE, su
-- contrato de F3 (unilateral, solo el deudor, con tope SETTLEMENT_EXCEEDS_DEBT,
-- corregible) y pasa a ser la aceptacion de una propuesta de grupo, sin tope
-- por deuda previa (cruza cero, §9-§12), con una sola version (§25).
-- group_payment («Saldado») y record_debt_settlement NO cambian: siguen
-- unilaterales, con tope y anulables (§8, §27).
-- ============================================================================
--
-- Lo que hay:
--
--   core.group_transfer_proposal  la propuesta de grupo (§4): emisor, receptor
--                                 (uid y participante, fijados al crear),
--                                 grupo, importe, base del grupo, concepto,
--                                 7 dias; marcas terminales excluyentes; el
--                                 estado se DERIVA, incluida la salida (§6)
--   core.transfer_part            AMPLIADA (§16): group_scope_id,
--                                 sender_participant_id y
--                                 receiver_participant_id, todo o nada; las
--                                 filas de B1/B2 quedan con los tres nulos
--
--   sec.derive_group_transfer_proposal_state
--                                 estado + motivo desde las marcas, la ventana
--                                 y core.group_departure (solo writer)
--   sec.group_transfer_proposal_state(uuid)
--                                 el mismo estado para las vistas: definer del
--                                 writer CON autorizacion interna (solo las
--                                 propuestas de las que el actor es parte;
--                                 inexistente y ajena son indistinguibles)
--   sec.assert_proposal_budget    RECREADA: cuenta transfer_proposal +
--                                 group_transfer_proposal bajo el MISMO
--                                 cerrojo por emisor (§20)
--
--   api.create_group_transfer_proposal   A propone a un participante (§3-§5)
--   api.cancel_group_transfer_proposal   solo created_by, mientras pending
--   api.decline_group_transfer_proposal  solo target_user_id, mientras pending
--   api.record_settlement_by_transfer    RECREADA: acepta la propuesta (§13)
--   sec.persist_version / api.annul_operation
--                                 RECREADAS: settlement_by_transfer no admite
--                                 version nueva (§25)
--   sec.my_transfer_counterparts  RECREADA: tambien las propuestas de grupo
--   api.my_transfers              RECREADA: tambien settlement_by_transfer,
--                                 con group_scope_id y
--                                 group_transfer_proposal_id AL FINAL
--   api.group_transfer_proposals  las propias en el grupo (§17)
--   api.group_transfers           las transferencias del grupo (§16)
--
-- Propietarios: TODO lo nuevo es del nomey_writer, propuesta incluida. No es
-- provisioning puro: crear, cancelar y rechazar leen la elegibilidad del OTRO
-- participante (periodo, vinculo, salida) bajo el rango 1, y esa visibilidad
-- es la del writer (participant, participant_period, participant_user_link,
-- membership con SELECT true) y no la del provisioner (solo lo propio;
-- medido). Para la clave del comando de creacion el writer recibe INSERT y
-- SELECT sobre core.provisioning_command con policy created_by = actor, y
-- para derivar la salida, SELECT sobre core.group_departure. Nada de
-- postgres, sin BYPASSRLS, el cliente sigue sin USAGE sobre core.
--
-- Precisiones a ADR-003 que este bloque fija (docs/adr/F12/README.md):
--   · Anonimo → NOT_AUTHORIZED · 403 (no existe USERNAME_GUEST_NOT_ALLOWED).
--   · cancelled · departure viaja como PROPOSAL_CANCELLED · 409 con
--     details.reason = 'departure' (creator para la del emisor); no hay
--     codigo nuevo ni estado invalidated.
--   · La moneda de la propuesta es la base del grupo, DERIVADA: el payload no
--     la lleva.
--   · Los comandos de la propuesta son del writer (motivo arriba) y el
--     comando de creacion usa core.provisioning_command como todo comando de
--     intencion (F09/ADR-002).

-- ═══════════════════════ §1 · la propuesta de grupo ══════════════════════════
create table core.group_transfer_proposal (
  id                      uuid primary key default gen_random_uuid(),
  created_by              uuid not null,
  target_user_id          uuid not null,
  group_scope_id          uuid not null references core.scope (id),
  sender_participant_id   uuid not null,
  receiver_participant_id uuid not null,
  amount                  bigint not null,
  currency_definition_id  uuid not null references core.currency_definition (id),
  concept                 text,
  client_command_id       uuid not null,
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null default now() + interval '7 days',
  accepted_at             timestamptz,
  accepted_operation_id   uuid references core.operation (id),
  declined_at             timestamptz,
  cancelled_at            timestamptz,
  constraint group_transfer_proposal_importe_positivo check (amount > 0),
  constraint group_transfer_proposal_no_a_uno_mismo   check (created_by <> target_user_id),
  constraint group_transfer_proposal_partes_distintas check (sender_participant_id <> receiver_participant_id),
  constraint group_transfer_proposal_caducidad        check (expires_at > created_at),
  constraint group_transfer_proposal_concepto         check (concept is null or btrim(concept) <> ''),
  constraint group_transfer_proposal_aceptada         check ((accepted_at is null) = (accepted_operation_id is null)),
  constraint group_transfer_proposal_una_terminal     check (
    (accepted_at is not null)::int + (declined_at is not null)::int + (cancelled_at is not null)::int <= 1),
  constraint group_transfer_proposal_comando          unique (created_by, client_command_id),
  -- los dos participantes son DE ESE grupo, por estructura (F03/ADR-009 §1)
  constraint group_transfer_proposal_emisor_del_grupo   foreign key (sender_participant_id, group_scope_id)
    references core.participant (id, scope_id),
  constraint group_transfer_proposal_receptor_del_grupo foreign key (receiver_participant_id, group_scope_id)
    references core.participant (id, scope_id)
);
comment on table core.group_transfer_proposal is
  'F12/ADR-003 §4, §17: la intencion de A de enviar N a B dentro de un grupo. NO es una operacion: sin efectos, sin deuda, sin saldo. uid y participante de cada parte fijados al crear. Estado DERIVADO (§6): accepted ⇔ accepted_operation_id; declined ⇔ declined_at; cancelled·creator ⇔ cancelled_at; cancelled·departure ⇔ sin marca y una salida de sender o receiver en (created_at, expires_at); expired ⇔ now() >= expires_at; pending el resto. Ninguna terminal revive.';
create unique index group_transfer_proposal_operacion_unica on core.group_transfer_proposal (accepted_operation_id)
  where accepted_operation_id is not null;
create index group_transfer_proposal_emisor_idx on core.group_transfer_proposal (created_by, created_at desc);
create index group_transfer_proposal_pareja_idx on core.group_transfer_proposal (created_by, target_user_id, group_scope_id)
  where accepted_at is null and declined_at is null and cancelled_at is null;
create index group_transfer_proposal_receptor_idx on core.group_transfer_proposal (target_user_id)
  where accepted_at is null and declined_at is null and cancelled_at is null;
create index group_transfer_proposal_grupo_idx on core.group_transfer_proposal (group_scope_id);

alter table core.group_transfer_proposal enable row level security;
-- writer: crea la propia; lee y marca solo aquellas de las que el actor es
-- parte (que columna toca cada comando lo fija su cuerpo); la operacion que
-- liga al aceptar es la que el mismo acaba de escribir.
grant select, insert on core.group_transfer_proposal to nomey_writer;
grant update (accepted_at, accepted_operation_id, declined_at, cancelled_at) on core.group_transfer_proposal to nomey_writer;
create policy group_transfer_proposal_writer_select on core.group_transfer_proposal
  for select to nomey_writer
  using (created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id());
create policy group_transfer_proposal_writer_insert on core.group_transfer_proposal
  for insert to nomey_writer with check (created_by = sec.request_actor_id());
create policy group_transfer_proposal_writer_update on core.group_transfer_proposal
  for update to nomey_writer
  using (created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id())
  with check ((created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id())
              and (accepted_operation_id is null
                   or exists (select 1 from core.operation o
                               where o.id = accepted_operation_id and o.created_by = sec.request_actor_id())));
-- provisioner: las de las que el actor es parte — las propias para el
-- presupuesto compartido (§20) y las dirigidas a el para la contraparte de
-- las vistas (sec.my_transfer_counterparts corre como provisioner).
grant select on core.group_transfer_proposal to nomey_provisioner;
create policy group_transfer_proposal_provisioner_select on core.group_transfer_proposal
  for select to nomey_provisioner
  using (created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id());
-- cliente: las de las que es parte, por las vistas, y SIN los uid.
grant select (id, group_scope_id, sender_participant_id, receiver_participant_id, amount, currency_definition_id,
              concept, created_at, expires_at, accepted_at, accepted_operation_id, declined_at, cancelled_at)
  on core.group_transfer_proposal to authenticated;
create policy group_transfer_proposal_client_select on core.group_transfer_proposal
  for select to authenticated
  using (created_by = (select auth.uid()) or target_user_id = (select auth.uid()));

-- ═══════════════════════ §2 · las partes, ampliadas ══════════════════════════
alter table core.transfer_part
  add column group_scope_id          uuid references core.scope (id),
  add column sender_participant_id   uuid,
  add column receiver_participant_id uuid,
  add constraint transfer_part_grupo_todo_o_nada check (
    (group_scope_id is null) = (sender_participant_id is null)
    and (group_scope_id is null) = (receiver_participant_id is null)),
  add constraint transfer_part_partes_distintas check (
    sender_participant_id is null or sender_participant_id <> receiver_participant_id),
  add constraint transfer_part_emisor_del_grupo foreign key (sender_participant_id, group_scope_id)
    references core.participant (id, scope_id),
  add constraint transfer_part_receptor_del_grupo foreign key (receiver_participant_id, group_scope_id)
    references core.participant (id, scope_id);
comment on column core.transfer_part.group_scope_id is
  'F12/ADR-003 §16: el grupo de una settlement_by_transfer, con sus dos participantes. Nulo (los tres) en las internal_transfer de B1/B2.';
-- el cliente lee tambien las partes de las transferencias de su grupo
drop policy transfer_part_client_select on core.transfer_part;
create policy transfer_part_client_select on core.transfer_part
  for select to authenticated
  using (sec.is_member(from_scope_id) or sec.is_member(to_scope_id)
         or (group_scope_id is not null and sec.is_member(group_scope_id)));

-- ═══════════════════════ §3 · lo que el writer necesita leer y reclamar ══════
-- La clave del comando de creacion, como todo comando de intencion
-- (F09/ADR-002): solo las propias, y nada mas.
grant select, insert on core.provisioning_command to nomey_writer;
create policy provisioning_command_writer_self on core.provisioning_command
  for all to nomey_writer
  using (created_by = sec.request_actor_id()) with check (created_by = sec.request_actor_id());
-- La salida de cualquiera de las dos partes, para derivar el estado (§6).
grant select on core.group_departure to nomey_writer;
create policy group_departure_writer_select on core.group_departure
  for select to nomey_writer using (true);

-- ═══════════════════════ §4 · el presupuesto compartido (§20) ════════════════
-- Mismo nombre, misma firma, mismo cerrojo ('nomey.proposal_budget:' || uid):
-- ahora cuenta las dos relaciones. Pasa a SECURITY DEFINER del provisioner
-- para que, llamada por el writer desde el comando de grupo, cuente las
-- propuestas Personales del emisor bajo la policy del provisioner
-- (created_by = actor): el actor sigue saliendo de request.jwt, y solo se
-- leen las filas propias del emisor. No expone nada: cuenta y lanza.
create or replace function sec.assert_proposal_budget(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n      integer;
  v_oldest timestamptz;
begin
  perform sec.lock_proposal_budget(p_user);
  select count(*), min(t.created_at) into v_n, v_oldest
    from (select p.created_at from core.transfer_proposal p
           where p.created_by = p_user and p.created_at > now() - interval '60 minutes'
          union all
          select g.created_at from core.group_transfer_proposal g
           where g.created_by = p_user and g.created_at > now() - interval '60 minutes') t;
  if v_n >= 10 then
    perform sec.raise_boundary('PROPOSAL_RATE_LIMITED',
      'has creado diez propuestas en la ultima hora; espera antes de crear otra', 429,
      jsonb_build_object('retry_at', v_oldest + interval '60 minutes'));
  end if;
end
$fn$;
comment on function sec.assert_proposal_budget(uuid) is
  'F12/ADR-002 §18 y F12/ADR-003 §20: 10 propuestas creadas / 60 min por emisor, Personal y de grupo juntas, contadas bajo sec.lock_proposal_budget. Definer del provisioner: cuenta solo las filas propias del emisor.';
grant execute on function sec.assert_proposal_budget(uuid) to nomey_writer;
grant execute on function sec.lock_proposal_budget(uuid) to nomey_writer;

-- ═══════════════════════ §5 · el estado, y quien puede preguntarlo ═══════════
-- La derivacion (§6), sobre valores: solo el writer, que lee las salidas.
create function sec.derive_group_transfer_proposal_state(
  p_group uuid, p_sender uuid, p_receiver uuid, p_created_at timestamptz, p_expires_at timestamptz,
  p_accepted_operation_id uuid, p_declined_at timestamptz, p_cancelled_at timestamptz)
returns table (state text, cancel_reason text)
language sql
stable
set search_path = ''
as $fn$
  select case when p_accepted_operation_id is not null then 'accepted'
              when p_declined_at is not null then 'declined'
              when p_cancelled_at is not null then 'cancelled'
              when exists (select 1 from core.group_departure d
                            where d.scope_id = p_group
                              and d.participant_id in (p_sender, p_receiver)
                              and d.left_at > p_created_at and d.left_at < p_expires_at) then 'cancelled'
              when now() >= p_expires_at then 'expired'
              else 'pending' end,
         case when p_accepted_operation_id is not null or p_declined_at is not null then null
              when p_cancelled_at is not null then 'creator'
              when exists (select 1 from core.group_departure d
                            where d.scope_id = p_group
                              and d.participant_id in (p_sender, p_receiver)
                              and d.left_at > p_created_at and d.left_at < p_expires_at) then 'departure'
              else null end;
$fn$;
comment on function sec.derive_group_transfer_proposal_state(uuid, uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, timestamptz) is
  'F12/ADR-003 §6: accepted → declined → cancelled·creator → cancelled·departure (salida de una parte en la ventana) → expired → pending. Solo el writer.';
grant create on schema sec to nomey_writer;
alter function sec.derive_group_transfer_proposal_state(uuid, uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, timestamptz) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.derive_group_transfer_proposal_state(uuid, uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, timestamptz) from public;
grant execute on function sec.derive_group_transfer_proposal_state(uuid, uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, timestamptz) to nomey_writer;

-- El mismo estado para las vistas, con AUTORIZACION INTERNA: el actor sale
-- de request.jwt, la fila se localiza solo si el actor es parte (la policy
-- del writer ya lo acota, y se repite aqui a proposito), y una propuesta
-- ajena o inexistente devuelven lo mismo: ninguna fila. Un anonimo tampoco
-- obtiene nada. Publica solo state y cancel_reason: ni uid, ni instantes de
-- salida, ni la existencia de salidas.
create function sec.group_transfer_proposal_state(p_proposal uuid)
returns table (state text, cancel_reason text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_guest boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_p     core.group_transfer_proposal%rowtype;
begin
  if v_guest then
    return;
  end if;
  select * into v_p from core.group_transfer_proposal g
   where g.id = p_proposal and v_actor in (g.created_by, g.target_user_id);
  if v_p.id is null then
    return;
  end if;
  return query select * from sec.derive_group_transfer_proposal_state(
    v_p.group_scope_id, v_p.sender_participant_id, v_p.receiver_participant_id, v_p.created_at, v_p.expires_at,
    v_p.accepted_operation_id, v_p.declined_at, v_p.cancelled_at);
end
$fn$;
comment on function sec.group_transfer_proposal_state(uuid) is
  'F12/ADR-003 §6, §17: estado y motivo de una propuesta de grupo, SOLO para quien es parte (autorizacion interna); ajena, inexistente o anonimo → ninguna fila. Para las vistas de api.';
grant create on schema sec to nomey_writer;
alter function sec.group_transfer_proposal_state(uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.group_transfer_proposal_state(uuid) from public;
grant execute on function sec.group_transfer_proposal_state(uuid) to authenticated, nomey_writer, nomey_provisioner;

-- ═══════════════════════ §6 · crear ══════════════════════════════════════════
-- payload: { client_command_id, command_contract_version: 1, group_scope_id,
--            receiver_participant_id, amount, concept? }
-- Orden (aprobado): forma → actor normal con handle → clave → rango 1 →
-- miembro y grupo → emisor = participante activo y vinculado del actor →
-- receptor elegible, vinculado a una cuenta normal con handle y con Personal
-- → moneda = base del grupo → cerrojo por emisor → tope de pareja →
-- presupuesto → insert.
create function api.create_group_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'group_scope_id', 'receiver_participant_id', 'amount', 'concept'];
  v_actor    uuid;
  v_guest    boolean;
  v_command  uuid;
  v_contract integer;
  v_group    uuid;
  v_receiver uuid;
  v_amount   bigint;
  v_concept  text;
  v_sender   uuid;
  v_target   uuid;
  v_currency uuid;
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
  v_n        integer;
  v_id       uuid;
  v_until    timestamptz;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor    := sec.request_actor_id();
  v_guest    := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_command  := sec.payload_uuid(payload, 'client_command_id', true);
  v_contract := sec.payload_contract_version(payload);
  if v_contract <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_group    := sec.payload_uuid(payload, 'group_scope_id', true);
  v_receiver := sec.payload_uuid(payload, 'receiver_participant_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_concept  := sec.payload_text(payload, 'concept', false);
  if v_concept is not null then
    v_concept := sec.canonical_concept(v_concept);
  end if;
  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'el importe de una transferencia debe ser positivo', 400);
  end if;

  -- EL EMISOR (§5): cuenta normal con handle definitivo.
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no propone transferencias', 403);
  end if;
  if (select i.handle from sec.public_identity(v_actor) i) is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'proponer una transferencia exige tener username definitivo', 409);
  end if;

  -- CLAVE DE IDEMPOTENCIA (F09/ADR-002), antes del cerrojo (protocolo de
  -- 20260912150000, comprobado por group-identity-lock.sql).
  v_intent := jsonb_build_object('group_scope_id', v_group::text, 'receiver_participant_id', v_receiver::text,
                                 'amount', payload ->> 'amount', 'concept', v_concept);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group_transfer_proposal.create', v_contract, v_intent, v_group);
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
    select g.id, g.expires_at into v_id, v_until from core.group_transfer_proposal g
     where g.created_by = v_actor and g.client_command_id = v_command;
    return jsonb_build_object('proposal_id', v_id, 'expires_at', v_until, 'already_processed', true);
  end if;

  -- RANGO 1: antes de leer membresia, vinculo, presencia o salida.
  perform sec.lock_participant_claims(v_group);
  perform sec.assert_scope_kind(v_group, 'group');
  perform sec.assert_member(v_group, v_actor);

  -- El emisor es la identidad ACTIVA del actor en este grupo (F10/ADR-003).
  select l.participant_id into v_sender
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = v_group and l.ended_at is null
   limit 1;
  if v_sender is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no tienes identidad activa en este grupo', 403);
  end if;
  perform sec.assert_participant_active(v_sender, v_group);

  -- El receptor: del grupo, elegible hoy, activo, vinculado a una cuenta
  -- normal con handle definitivo y con Modo Personal; no uno mismo.
  if not exists (select 1 from core.participant p where p.id = v_receiver and p.scope_id = v_group) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'la propuesta nombra un participante que no pertenece a su grupo', 422);
  end if;
  perform sec.assert_participant_active(v_receiver, v_group);
  perform sec.assert_participant_eligible(v_receiver, v_group, current_date);
  if v_receiver = v_sender then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes proponerte una transferencia a ti mismo', 400);
  end if;
  select l.user_id into v_target from core.participant_user_link l
   where l.participant_id = v_receiver and l.ended_at is null;
  if v_target is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'ese participante no tiene una cuenta vinculada', 403);
  end if;
  if v_target = v_actor then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes proponerte una transferencia a ti mismo', 400);
  end if;
  if (select i.handle from sec.public_identity(v_target) i) is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'el receptor todavia no tiene username definitivo', 409);
  end if;
  if sec.participant_personal_scope(v_receiver) is null then
    perform sec.raise_boundary('RECIPIENT_WITHOUT_PERSONAL_SCOPE', 'el receptor no tiene Modo Personal al que recibir', 422);
  end if;
  if sec.participant_personal_scope(v_sender) is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'el emisor no tiene Modo Personal', 403);
  end if;

  -- La moneda es la base del grupo (§22), derivada: el payload no la lleva.
  select s.base_currency_definition_id into v_currency from core.scope s where s.id = v_group;

  -- ANTI-SPAM (§20), bajo el cerrojo del emisor: pareja por grupo y presupuesto compartido, exactos.
  perform sec.lock_proposal_budget(v_actor);
  select count(*) into v_n
    from core.group_transfer_proposal g
    cross join lateral sec.derive_group_transfer_proposal_state(
      g.group_scope_id, g.sender_participant_id, g.receiver_participant_id, g.created_at, g.expires_at,
      g.accepted_operation_id, g.declined_at, g.cancelled_at) st
   where g.created_by = v_actor and g.target_user_id = v_target and g.group_scope_id = v_group
     and st.state = 'pending';
  if v_n >= 3 then
    perform sec.raise_boundary('PROPOSAL_LIMIT_PER_TARGET',
      'ya tienes tres propuestas pendientes con ese participante en este grupo', 409);
  end if;
  perform sec.assert_proposal_budget(v_actor);

  insert into core.group_transfer_proposal
    (created_by, target_user_id, group_scope_id, sender_participant_id, receiver_participant_id,
     amount, currency_definition_id, concept, client_command_id)
  values (v_actor, v_target, v_group, v_sender, v_receiver, v_amount, v_currency, v_concept, v_command)
  returning id, expires_at into v_id, v_until;

  return jsonb_build_object('proposal_id', v_id, 'expires_at', v_until, 'already_processed', false);
end
$fn$;
comment on function api.create_group_transfer_proposal(jsonb) is
  'F12/ADR-003 §3-§5, §20: proponer una transferencia a un participante del grupo. Receptor por participante, nunca por @handle; moneda = base del grupo; ni operacion ni deuda ni saldo. Idempotente por client_command_id.';
grant create on schema api to nomey_writer;
alter function api.create_group_transfer_proposal(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.create_group_transfer_proposal(jsonb) from public;
grant execute on function api.create_group_transfer_proposal(jsonb) to authenticated;

-- ═══════════════════════ §7 · cancelar y rechazar ════════════════════════════
-- payload: { proposal_id }. Fila `for update` → rango 1 → estado → marca.
-- Idempotentes por estado; una salida en la ventana es PROPOSAL_CANCELLED con
-- details.reason = 'departure' (§6, §18).
create function api.cancel_group_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_guest boolean;
  v_id    uuid;
  v_p     core.group_transfer_proposal%rowtype;
  v_st    record;
begin
  perform sec.assert_payload_shape(payload, array['proposal_id']);
  v_actor := sec.request_actor_id();
  v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_id    := sec.payload_uuid(payload, 'proposal_id', true);
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no cancela propuestas', 403);
  end if;
  select * into v_p from core.group_transfer_proposal g where g.id = v_id for update;
  if v_p.id is null or v_p.created_by <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no la creaste tu', 403);
  end if;
  -- RANGO 1 antes de derivar: una salida en curso decide antes o despues, nunca a la vez.
  perform sec.lock_participant_claims(v_p.group_scope_id);
  select * into v_st from sec.derive_group_transfer_proposal_state(
    v_p.group_scope_id, v_p.sender_participant_id, v_p.receiver_participant_id, v_p.created_at, v_p.expires_at,
    v_p.accepted_operation_id, v_p.declined_at, v_p.cancelled_at);
  if v_st.state = 'cancelled' and v_st.cancel_reason = 'creator' then
    return jsonb_build_object('proposal_id', v_id, 'state', 'cancelled', 'cancel_reason', 'creator', 'already_processed', true);
  end if;
  if v_st.state = 'cancelled' then
    perform sec.raise_boundary('PROPOSAL_CANCELLED', 'la propuesta quedo cancelada al salir una de las partes del grupo', 409,
                               jsonb_build_object('reason', v_st.cancel_reason));
  elsif v_st.state = 'accepted' then
    perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
  elsif v_st.state = 'declined' then
    perform sec.raise_boundary('PROPOSAL_DECLINED', 'la propuesta ya fue rechazada', 409);
  elsif v_st.state = 'expired' then
    perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
  end if;
  update core.group_transfer_proposal g set cancelled_at = now() where g.id = v_id;
  return jsonb_build_object('proposal_id', v_id, 'state', 'cancelled', 'cancel_reason', 'creator', 'already_processed', false);
end
$fn$;
comment on function api.cancel_group_transfer_proposal(jsonb) is
  'F12/ADR-003 §17: cancelar una propuesta de grupo propia mientras esta pending, bajo el rango 1. Idempotente por estado.';
grant create on schema api to nomey_writer;
alter function api.cancel_group_transfer_proposal(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.cancel_group_transfer_proposal(jsonb) from public;
grant execute on function api.cancel_group_transfer_proposal(jsonb) to authenticated;

create function api.decline_group_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_guest boolean;
  v_id    uuid;
  v_p     core.group_transfer_proposal%rowtype;
  v_st    record;
begin
  perform sec.assert_payload_shape(payload, array['proposal_id']);
  v_actor := sec.request_actor_id();
  v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_id    := sec.payload_uuid(payload, 'proposal_id', true);
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no rechaza propuestas', 403);
  end if;
  select * into v_p from core.group_transfer_proposal g where g.id = v_id for update;
  if v_p.id is null or v_p.target_user_id <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no va dirigida a ti', 403);
  end if;
  perform sec.lock_participant_claims(v_p.group_scope_id);
  select * into v_st from sec.derive_group_transfer_proposal_state(
    v_p.group_scope_id, v_p.sender_participant_id, v_p.receiver_participant_id, v_p.created_at, v_p.expires_at,
    v_p.accepted_operation_id, v_p.declined_at, v_p.cancelled_at);
  if v_st.state = 'declined' then
    return jsonb_build_object('proposal_id', v_id, 'state', 'declined', 'already_processed', true);
  end if;
  if v_st.state = 'cancelled' then
    perform sec.raise_boundary('PROPOSAL_CANCELLED', 'la propuesta ya no esta pendiente', 409,
                               jsonb_build_object('reason', v_st.cancel_reason));
  elsif v_st.state = 'accepted' then
    perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
  elsif v_st.state = 'expired' then
    perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
  end if;
  update core.group_transfer_proposal g set declined_at = now() where g.id = v_id;
  return jsonb_build_object('proposal_id', v_id, 'state', 'declined', 'already_processed', false);
end
$fn$;
comment on function api.decline_group_transfer_proposal(jsonb) is
  'F12/ADR-003 §17: rechazar una propuesta de grupo dirigida a uno mientras esta pending, bajo el rango 1. Idempotente por estado.';
grant create on schema api to nomey_writer;
alter function api.decline_group_transfer_proposal(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.decline_group_transfer_proposal(jsonb) from public;
grant execute on function api.decline_group_transfer_proposal(jsonb) to authenticated;

-- ═══════════════════════ §8 · aceptar: la settlement_by_transfer ═════════════
-- RECREADA con el contrato de F12/ADR-003 §13-§14, partiendo del cuerpo de F3
-- (20260826205500 y siguientes). Lo que cambia: el unico origen es la
-- propuesta de grupo (payload { client_operation_id, command_contract_version,
-- proposal_id }); emisor, receptor, grupo, importe y moneda salen de ella;
-- operation_id / expected_version_id son TRANSFER_NOT_EDITABLE; los campos de
-- F3 son PAYLOAD_INVALID; NO hay tope por deuda previa (la deuda del par
-- cruza cero: §9-§12); fecha y hora del servidor (§23); partes con grupo
-- (§16); transicion a accepted en la misma transaccion (§14). Lo que no
-- cambia: definer del writer bajo RLS, begin_command → fila → RANGO 1 →
-- ambitos ascendentes, la triple assert_no_conversion, ambos extremos activos
-- ahora (ADR-034 §6), tres efectos, balances_before / observe_balances.
create or replace function api.record_settlement_by_transfer(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id', 'command_contract_version', 'proposal_id', 'operation_id', 'expected_version_id'];
  v_proposal uuid;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_guest boolean;
  v_p core.group_transfer_proposal%rowtype;
  v_st record;
  v_from uuid; v_to uuid;
  v_obs uuid[]; v_before bigint[];
  v_date date; v_time time;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  -- §25: una settlement_by_transfer tiene exactamente una version.
  if (payload ? 'operation_id') or (payload ? 'expected_version_id') then
    perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
      'una transferencia de grupo no se corrige: la devolucion es otra transferencia', 422);
  end if;
  v_proposal := sec.payload_uuid(payload, 'proposal_id', true);

  -- EL RECEPTOR (§5): cuenta normal con handle definitivo, antes de la clave.
  v_actor := sec.request_actor_id();
  v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no acepta transferencias', 403);
  end if;
  if (select i.handle from sec.public_identity(v_actor) i) is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'aceptar una transferencia exige tener username definitivo', 409);
  end if;

  v_canonical := jsonb_build_object('proposal_id', v_proposal::text);
  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'settlement_by_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- LA PROPUESTA, bloqueada (§14: clave → fila → rango 1 → ambitos). La
  -- policy del writer alcanza las filas de las que el actor es parte; el
  -- cuerpo exige ser el receptor.
  select * into v_p from core.group_transfer_proposal g where g.id = v_proposal for update;
  if v_p.id is null or v_p.target_user_id <> v_actor or v_p.created_by = v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no va dirigida a ti', 403);
  end if;

  -- RANGO 1 (protocolo de 20260912150000): antes de derivar el estado (que
  -- lee salidas) y antes de leer membresia, vinculo o presencia.
  perform sec.lock_participant_claims(v_p.group_scope_id);
  select * into v_st from sec.derive_group_transfer_proposal_state(
    v_p.group_scope_id, v_p.sender_participant_id, v_p.receiver_participant_id, v_p.created_at, v_p.expires_at,
    v_p.accepted_operation_id, v_p.declined_at, v_p.cancelled_at);
  if v_st.state = 'accepted' then
    perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
  elsif v_st.state = 'declined' then
    perform sec.raise_boundary('PROPOSAL_DECLINED', 'la propuesta ya fue rechazada', 409);
  elsif v_st.state = 'cancelled' then
    perform sec.raise_boundary('PROPOSAL_CANCELLED', 'la propuesta ya no esta pendiente', 409,
                               jsonb_build_object('reason', v_st.cancel_reason));
  elsif v_st.state = 'expired' then
    perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
  end if;

  -- ELEGIBILIDAD, otra vez y ahora (§5): ambos del grupo, elegibles hoy,
  -- activos, y con el vinculo activo que la propuesta fijo.
  perform sec.assert_member(v_p.group_scope_id, v_actor);
  perform sec.assert_participant_active(v_p.sender_participant_id,   v_p.group_scope_id);
  perform sec.assert_participant_active(v_p.receiver_participant_id, v_p.group_scope_id);
  perform sec.assert_participant_eligible(v_p.sender_participant_id,   v_p.group_scope_id, current_date);
  perform sec.assert_participant_eligible(v_p.receiver_participant_id, v_p.group_scope_id, current_date);
  if not exists (select 1 from core.participant_user_link l
                  where l.participant_id = v_p.sender_participant_id and l.user_id = v_p.created_by and l.ended_at is null)
     or not exists (select 1 from core.participant_user_link l
                  where l.participant_id = v_p.receiver_participant_id and l.user_id = v_actor and l.ended_at is null) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'las identidades de la propuesta ya no son las vinculadas', 403);
  end if;

  -- LOS EXTREMOS (§16): el Personal del EMISOR sale y el del RECEPTOR entra,
  -- derivados del vinculo, nunca del payload.
  v_from := sec.participant_personal_scope(v_p.sender_participant_id);
  if v_from is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'el emisor no tiene Modo Personal', 403);
  end if;
  v_to := sec.participant_personal_scope(v_p.receiver_participant_id);
  if v_to is null then
    perform sec.raise_boundary('RECIPIENT_WITHOUT_PERSONAL_SCOPE', 'el receptor no tiene Modo Personal al que recibir', 422);
  end if;
  if v_from = v_to then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'origen y destino no pueden ser el mismo ambito', 400);
  end if;

  -- §22: la moneda de la propuesta es la base del grupo y de los dos Personales.
  perform sec.assert_no_conversion(v_p.group_scope_id, v_p.currency_definition_id);
  perform sec.assert_no_conversion(v_from, v_p.currency_definition_id);
  perform sec.assert_no_conversion(v_to,   v_p.currency_definition_id);

  -- LOCK de saldo y deuda (ADR-013 §11): grupo y los dos Personales, en el
  -- orden global ascendente.
  v_obs := array[v_from, v_to];
  perform sec.lock_scopes(array[v_p.group_scope_id] || v_obs);
  v_before := sec.balances_before(v_obs);

  -- §23: fecha e instante de la aceptacion, del servidor.
  v_date := current_date;
  v_time := localtime(0);

  perform sec.persist_version(v_actor, v_operation, v_version, 1, null,
                              'settlement_by_transfer', v_date, v_p.amount, v_p.currency_definition_id, v_time);

  -- §13: exactamente tres efectos. SIN tope por deuda previa: el settlement
  -- del par cruza cero si toca (§9).
  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_p.currency_definition_id, - v_p.amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_p.currency_definition_id,   v_p.amount);
  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_p.group_scope_id, 'settlement', v_p.currency_definition_id,
          - v_p.amount, v_p.sender_participant_id, v_p.receiver_participant_id);

  insert into core.transfer_part
    (operation_version_id, from_scope_id, to_scope_id, group_scope_id, sender_participant_id, receiver_participant_id)
  values (v_version, v_from, v_to, v_p.group_scope_id, v_p.sender_participant_id, v_p.receiver_participant_id);

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- §14: la transicion, en la misma transaccion. Todo o nada.
  update core.group_transfer_proposal g
     set accepted_at = now(), accepted_operation_id = v_operation
   where g.id = v_proposal;
  if not found then
    raise exception 'la propuesta % no pudo marcarse aceptada: falta la policy o el privilegio de UPDATE del writer', v_proposal;
  end if;

  return sec.envelope(v_operation, false);
end
$fn$;
comment on function api.record_settlement_by_transfer(jsonb) is
  'F12/ADR-003 §13-§14: aceptar una propuesta de grupo. Solo el receptor; emisor, receptor, grupo, importe y moneda salen de la propuesta; transfer -N/+N en los Personales y settlement -N sobre el par, sin tope por deuda previa. Una sola version: ni correccion ni anulacion.';
grant create on schema api to nomey_writer;
alter function api.record_settlement_by_transfer(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.record_settlement_by_transfer(jsonb) from public;
grant execute on function api.record_settlement_by_transfer(jsonb) to authenticated;

-- ═══════════════════════ §9 · irreversibilidad, donde toda version pasa ═══════
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
    -- Una transferencia de dos voluntades (F12/ADR-002 §16, F12/ADR-003 §25)
    -- tiene exactamente una version: las dos partes consintieron ESE hecho, y
    -- reescribirlo o deshacerlo seria que una alterase el Personal de la otra
    -- sin su voluntad. La devolucion es otra transferencia.
    if v_clase in ('internal_transfer', 'settlement_by_transfer') then
      if p_version_kind = 'annulment' then
        perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
          'una transferencia de dos voluntades no se anula: la devolucion es otra transferencia', 422);
      end if;
      perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
        'una transferencia de dos voluntades no se corrige: la devolucion es otra transferencia', 422);
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
$function$;

-- api.annul_operation: la clase se rehusa ANTES de autorizar por membresia y
-- antes de cualquier cerrojo. El resto del cuerpo es el vigente (B1).
create or replace function api.annul_operation(payload jsonb)
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

  -- F12/ADR-002 §16 y F12/ADR-003 §25: una transferencia de dos voluntades no
  -- se anula, la pida quien la pida. Antes de la membresia y de cualquier
  -- cerrojo; sec.persist_version lo respalda si algo llegara hasta alli.
  if v_clase in ('internal_transfer', 'settlement_by_transfer') then
    perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
      'una transferencia de dos voluntades no se anula: la devolucion es otra transferencia', 422);
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
                         and l.participant_id in (sec.canonical_participant(v_pd.payer_participant_id),
                                                  sec.canonical_participant(v_pd.receiver_participant_id))) then
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
       and l.participant_id = sec.canonical_participant(
             case when exists (select 1 from core.participant_user_link x
                                where x.participant_id = sec.canonical_participant(v_pd.payer_participant_id) and x.user_id = v_actor)
                  then v_pd.receiver_participant_id else v_pd.payer_participant_id end);
    if v_other is not null and v_other <> v_actor then
      insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
      values (v_other, v_pd.scope_id, 'payment_annulled', v_operation, v_actor)
      on conflict (recipient_user_id, kind, subject_id) do nothing;
    end if;
  end if;

  return sec.envelope(v_operation, false);
end
$function$;
grant create on schema api to nomey_writer;
alter function api.annul_operation(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;

-- ═══════════════════════ §10 · lectura ═══════════════════════════════════════
-- La contraparte de cada propuesta (Personal y de grupo) y solicitud de la que
-- el actor es parte, como identidad publica ACTUAL. Cambia el tipo de retorno
-- (se anade group_transfer_proposal_id): las tres vistas que dependian de ella
-- se recrean, dos identicas y my_transfers ampliada con columnas AL FINAL.
drop view api.my_transfers;
drop view api.my_transfer_proposals;
drop view api.my_payment_requests;
drop function sec.my_transfer_counterparts();
create function sec.my_transfer_counterparts()
returns table (proposal_id uuid, payment_request_id uuid, accepted_operation_id uuid, direction text,
               counterpart_handle text, counterpart_public_name text, group_transfer_proposal_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, null::uuid, p.accepted_operation_id,
         case when p.created_by = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name, null::uuid
    from core.transfer_proposal p
    left join lateral sec.public_identity(
      case when p.created_by = sec.request_actor_id() then p.target_user_id else p.created_by end) i on true
   where sec.request_actor_id() in (p.created_by, p.target_user_id)
  union all
  select null::uuid, r.id, r.paid_operation_id,
         case when r.paid_by = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name, null::uuid
    from core.payment_request r
    left join lateral sec.public_identity(
      case when r.paid_by = sec.request_actor_id() then r.created_by else r.paid_by end) i on true
   where sec.request_actor_id() in (r.created_by, r.paid_by)
  union all
  -- Propuesta de grupo: quien la creo envia. La direccion CONTABLE sigue
  -- saliendo de core.transfer_part en api.my_transfers.
  select null::uuid, null::uuid, g.accepted_operation_id,
         case when g.created_by = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name, g.id
    from core.group_transfer_proposal g
    left join lateral sec.public_identity(
      case when g.created_by = sec.request_actor_id() then g.target_user_id else g.created_by end) i on true
   where sec.request_actor_id() in (g.created_by, g.target_user_id);
$fn$;
comment on function sec.my_transfer_counterparts() is
  'F12/ADR-002 §9, F12/ADR-003 §16 y F12/ADR-004 §16: por cada propuesta (Personal o de grupo) o solicitud propia, la direccion y la identidad publica ACTUAL de la contraparte. Sin uid. Solo para las vistas de api.';
grant create on schema sec to nomey_provisioner;
alter function sec.my_transfer_counterparts() owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.my_transfer_counterparts() from public;
grant execute on function sec.my_transfer_counterparts() to authenticated;

-- api.my_transfer_proposals, identica a B1/B2.
create view api.my_transfer_proposals
with (security_invoker = true) as
select p.id as proposal_id,
       c.direction,
       c.counterpart_handle,
       c.counterpart_public_name,
       p.amount::text as amount,
       p.currency_definition_id,
       p.concept,
       p.created_at,
       p.expires_at,
       sec.transfer_proposal_state(p.accepted_operation_id, p.cancelled_at, p.declined_at, p.expires_at) as state,
       p.accepted_operation_id
  from core.transfer_proposal p
  join sec.my_transfer_counterparts() c on c.proposal_id = p.id
 where c.direction = 'outgoing'
    or sec.transfer_proposal_state(p.accepted_operation_id, p.cancelled_at, p.declined_at, p.expires_at) = 'pending';
comment on view api.my_transfer_proposals is
  'F12/ADR-002 §9: las propuestas de las que el actor es parte. Enviadas: todas, con estado. Recibidas: solo pending. La contraparte es su identidad publica actual; ni uid ni ambito.';
grant select on api.my_transfer_proposals to authenticated;

-- api.my_payment_requests, identica a B2.
create view api.my_payment_requests
with (security_invoker = true) as
select r.id as request_id,
       r.amount::text as amount,
       r.currency_definition_id,
       r.concept,
       r.created_at,
       r.expires_at,
       sec.payment_request_state(r.paid_operation_id, r.cancelled_at, r.expires_at) as state,
       r.paid_at,
       r.paid_operation_id,
       c.counterpart_handle as payer_handle,
       c.counterpart_public_name as payer_public_name
  from core.payment_request r
  join sec.my_transfer_counterparts() c on c.payment_request_id = r.id
 where c.direction = 'incoming';
comment on view api.my_payment_requests is
  'F12/ADR-004 §16: las solicitudes de pago creadas por el actor, con su estado derivado y, si ya se pago, la identidad publica actual del pagador. Sin token, sin hash, sin uid.';
grant select on api.my_payment_requests to authenticated;

-- api.my_transfers, AMPLIADA: tambien la settlement_by_transfer en el Personal
-- («Enviaste/Recibiste», ADR-003 §16). Direccion desde las partes; concepto y
-- contraparte desde la propuesta o la solicitud. Columnas nuevas AL FINAL.
create view api.my_transfers
with (security_invoker = true) as
select o.id as operation_id,
       e.scope_id,
       e.currency_definition_id,
       e.balance_amount::text as balance_amount,
       case when tp.from_scope_id = e.scope_id then 'outgoing' else 'incoming' end as direction,
       ov.original_amount::text as amount,
       ov.effective_date,
       ov.effective_time,
       coalesce(p.concept, r.concept, g.concept) as concept,
       c.counterpart_handle,
       c.counterpart_public_name,
       p.id as proposal_id,
       o.created_at as operation_created_at,
       r.id as payment_request_id,
       tp.group_scope_id,
       g.id as group_transfer_proposal_id
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  join core.transfer_part tp on tp.operation_version_id = ov.id
  left join core.transfer_proposal p on p.accepted_operation_id = o.id
  left join core.payment_request r on r.paid_operation_id = o.id
  left join core.group_transfer_proposal g on g.accepted_operation_id = o.id
  left join sec.my_transfer_counterparts() c on c.accepted_operation_id = o.id
 where s.kind = 'personal'
   and s.owner_user_id = (select auth.uid())
   and o.operation_class in ('internal_transfer', 'settlement_by_transfer')
   and ov.version_kind = 'record'
   and e.balance_amount is not null
   and sec.counts_in_personal(e.scope_id, o.id);
comment on view api.my_transfers is
  'F12/ADR-002 §7, §14, F12/ADR-003 §16 y F12/ADR-004 §16: las transferencias de dos voluntades vigentes en el Personal propio. direction sale de core.transfer_part; concept y contraparte, de la propuesta (Personal o de grupo) o de la solicitud. Publica solo el ambito PROPIO.';
grant select on api.my_transfers to authenticated;

-- Las propuestas de grupo propias (§17): identidad por PARTICIPANTE del grupo
-- (nombre), no por @handle. Enviadas: todas con estado y motivo; recibidas:
-- solo pending. Estado por sec.group_transfer_proposal_state (autorizada).
create view api.group_transfer_proposals
with (security_invoker = true) as
select g.id as proposal_id,
       g.group_scope_id,
       g.sender_participant_id,
       g.receiver_participant_id,
       ps.display_name as sender_display_name,
       pr.display_name as receiver_display_name,
       case when sec.is_my_participant(g.sender_participant_id) then 'outgoing' else 'incoming' end as direction,
       g.amount::text as amount,
       g.currency_definition_id,
       g.concept,
       g.created_at,
       g.expires_at,
       st.state,
       st.cancel_reason,
       g.accepted_operation_id
  from core.group_transfer_proposal g
  join core.participant ps on ps.id = g.sender_participant_id
  join core.participant pr on pr.id = g.receiver_participant_id
  cross join lateral sec.group_transfer_proposal_state(g.id) st
 where sec.is_my_participant(g.sender_participant_id)
    or st.state = 'pending';
comment on view api.group_transfer_proposals is
  'F12/ADR-003 §17: las propuestas de grupo de las que el actor es parte, por participante del grupo. Enviadas: todas, con estado y cancel_reason (creator | departure). Recibidas: solo pending. Sin uid.';
grant select on api.group_transfer_proposals to authenticated;

-- Las transferencias del grupo (§16), para todos sus miembros: partes y
-- efectos, nunca created_by. El concepto solo lo ven las dos partes (la
-- propuesta es suya).
create view api.group_transfers
with (security_invoker = true) as
select o.id as operation_id,
       tp.group_scope_id,
       tp.sender_participant_id,
       tp.receiver_participant_id,
       ps.display_name as sender_display_name,
       pr.display_name as receiver_display_name,
       sec.is_my_participant(tp.sender_participant_id) as is_sender,
       sec.is_my_participant(tp.receiver_participant_id) as is_receiver,
       ov.original_amount::text as amount,
       e.currency_definition_id,
       ov.effective_date,
       ov.effective_time,
       g.concept,
       g.id as proposal_id,
       o.created_at as operation_created_at
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.transfer_part tp on tp.operation_version_id = ov.id and tp.group_scope_id = e.scope_id
  join core.participant ps on ps.id = tp.sender_participant_id
  join core.participant pr on pr.id = tp.receiver_participant_id
  left join core.group_transfer_proposal g on g.accepted_operation_id = o.id
 where o.operation_class = 'settlement_by_transfer'
   and ov.version_kind = 'record'
   and e.debt_amount is not null;
comment on view api.group_transfers is
  'F12/ADR-003 §16: las transferencias de dos voluntades del grupo, una fila por operacion, con emisor y receptor como participantes del grupo (partes persistidas, nunca created_by). Sin uid ni Personal ajeno.';
grant select on api.group_transfers to authenticated;
