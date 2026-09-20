-- ============================================================================
-- SOLICITUDES DE PAGO MEDIANTE ENLACE: la capability al portador y la
-- internal_transfer que la paga. F12/ADR-004 (F12.B2).
--
-- SOLO la solicitud y la segunda via de origen de internal_transfer. La
-- transferencia dentro de un grupo (F12/ADR-003, settlement_by_transfer)
-- llega en B3: record_settlement_by_transfer conserva su contrato de F3
-- intacto. La propuesta dirigida de B1 (20260926120000) no cambia de contrato.
-- ============================================================================
--
-- Lo que hay:
--
--   core.payment_request          la solicitud (ADR-004 §2, §29): creador,
--                                 hash del token, importe, moneda, concepto,
--                                 7 dias; marcas terminales excluyentes;
--                                 estado DERIVADO (§10); paid_by, paid_at y
--                                 paid_operation_id escritos atomicamente
--   core.payment_request_attempt  apuntes del freno de previsualizacion
--                                 (§24): quien y cuando, NUNCA el token
--
--   sec.payment_request_state     pending | paid | cancelled | expired
--   sec.lock_payment_request_cap  cerrojo transaccional por CREADOR: el tope
--                                 de 20 pendientes propias es exacto
--
--   api.create_payment_request    crea y entrega el token UNA vez (§18)
--   api.cancel_payment_request    solo created_by, mientras pending (§21)
--   api.preview_payment_request   estado + lo minimo para pagar (§24)
--   api.record_internal_transfer  RECREADA: dos origenes de intencion,
--                                 proposal_id XOR payment_request_token
--   sec.my_transfer_counterparts  RECREADA: tambien las solicitudes
--   api.my_transfers              RECREADA: concepto y contraparte tambien
--                                 desde la solicitud (payment_request_id)
--   api.my_payment_requests       las propias, con el pagador si ya se pago
--
-- Propietarios: lo de la solicitud es del nomey_provisioner; lo contable
-- sigue siendo del nomey_writer. Nada nuevo de postgres, sin BYPASSRLS y el
-- cliente sigue sin USAGE sobre core. El token lo generan y lo hashean los
-- helpers de F09/ADR-004 (sec.new_invitation_token, sec.invitation_hash):
-- son helpers genericos de bearer —256 bits base64url, sha256— y solo se
-- llaman «invitation» por historia; el writer recibe EXECUTE sobre el hash.
--
-- Precisiones a ADR-004 que este bloque fija (docs/adr/F12/README.md):
--   · Anonimo → NOT_AUTHORIZED · 403 (no existe GUEST_NOT_ALLOWED), como en
--     F12.A y F12.B1.
--   · Al pagar, el payload NO lleva importe, moneda ni concepto: el writer
--     los toma de la solicitud bloqueada. PAYMENT_REQUEST_AMOUNT_MISMATCH no
--     existe: no hay nada que comparar.
--   · preview_payment_request es definer del provisioner, no de postgres, y
--     cuenta SOLO los intentos `invalid` (20 / 10 min), como el resolver de
--     invitaciones; devuelve estados, nunca excepciones.
--   · El token es un bearer que el cliente (F12.C) incorporara al enlace
--     compartible; aqui solo se entrega, una vez, en el cuerpo de la
--     respuesta de create. El replay devuelve token null.
--   · paid_by es una columna de auditoria escrita por el writer con paid_at
--     y paid_operation_id; los roles economicos siguen saliendo de
--     core.transfer_part y ninguna vista deriva la direccion de created_by.

-- ═══════════════════════ §1 · la solicitud ═══════════════════════════════════
create table core.payment_request (
  id                     uuid primary key default gen_random_uuid(),
  created_by             uuid not null,
  token_hash             bytea not null,
  amount                 bigint not null,
  currency_definition_id uuid not null references core.currency_definition (id),
  concept                text,
  client_command_id      uuid not null,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null default now() + interval '7 days',
  cancelled_at           timestamptz,
  paid_at                timestamptz,
  paid_by                uuid,
  paid_operation_id      uuid references core.operation (id),
  constraint payment_request_importe_positivo check (amount > 0),
  constraint payment_request_caducidad        check (expires_at > created_at),
  constraint payment_request_concepto         check (concept is null or btrim(concept) <> ''),
  -- pagada ⇔ ligada a su operacion ⇔ con pagador
  constraint payment_request_pagada           check ((paid_at is null) = (paid_operation_id is null)
                                                     and (paid_at is null) = (paid_by is null)),
  constraint payment_request_no_autopago      check (paid_by is null or paid_by <> created_by),
  -- a lo sumo UNA transicion terminal (§19)
  constraint payment_request_una_terminal     check ((paid_at is not null)::int + (cancelled_at is not null)::int <= 1),
  constraint payment_request_token_hash_key   unique (token_hash),
  constraint payment_request_comando          unique (created_by, client_command_id)
);
comment on table core.payment_request is
  'F12/ADR-004 §2, §29: la capability al portador de B para recibir N. NO es una operacion: sin efectos, sin saldo, sin deuda. Solo el hash del token (§18). Estado derivado (§10): paid ⇔ paid_operation_id; cancelled ⇔ cancelled_at; expired ⇔ now() >= expires_at; pending el resto. Sin declined.';
comment on column core.payment_request.paid_by is
  'Auditoria: el actor que materializo el pago (= operation.created_by = dueno de transfer_part.from_scope_id). Los roles economicos salen de las partes, no de aqui ni de created_by.';
create unique index payment_request_operacion_unica on core.payment_request (paid_operation_id)
  where paid_operation_id is not null;
create index payment_request_creador_idx on core.payment_request (created_by)
  where paid_at is null and cancelled_at is null;
create index payment_request_pagador_idx on core.payment_request (paid_by) where paid_by is not null;

alter table core.payment_request enable row level security;
-- provisioner: crea la propia, lee TODAS (resuelve token → fila por hash en
-- la previsualizacion: el bearer no lleva destinatario, como account_handle
-- en F12.A1) y marca cancelada solo la propia.
grant select, insert on core.payment_request to nomey_provisioner;
grant update (cancelled_at) on core.payment_request to nomey_provisioner;
create policy payment_request_provisioner_select on core.payment_request
  for select to nomey_provisioner using (true);
create policy payment_request_provisioner_insert on core.payment_request
  for insert to nomey_provisioner with check (created_by = sec.request_actor_id());
create policy payment_request_provisioner_cancel on core.payment_request
  for update to nomey_provisioner
  using (created_by = sec.request_actor_id()) with check (created_by = sec.request_actor_id());
-- writer: resuelve el token, bloquea y marca pagada una solicitud AJENA, y la
-- operacion que liga es la que el mismo acaba de escribir. `for update` exige
-- que la policy de UPDATE alcance la fila (E20): la propia son cero filas.
grant select on core.payment_request to nomey_writer;
grant update (paid_at, paid_by, paid_operation_id) on core.payment_request to nomey_writer;
create policy payment_request_writer_select on core.payment_request
  for select to nomey_writer using (true);
create policy payment_request_writer_pay on core.payment_request
  for update to nomey_writer
  using (created_by <> sec.request_actor_id())
  with check (created_by <> sec.request_actor_id()
              and paid_by = sec.request_actor_id()
              and exists (select 1 from core.operation o
                           where o.id = paid_operation_id and o.created_by = sec.request_actor_id()));
-- cliente: las propias y las que pago, por las vistas de api, y SIN el hash
-- ni los uid: ninguna vista invoker puede publicarlos ni por descuido.
grant select (id, amount, currency_definition_id, concept, created_at, expires_at, cancelled_at, paid_at, paid_operation_id)
  on core.payment_request to authenticated;
create policy payment_request_client_select on core.payment_request
  for select to authenticated
  using (created_by = (select auth.uid()) or paid_by = (select auth.uid()));

-- ═══════════════════════ §2 · freno de previsualizacion ══════════════════════
create table core.payment_request_attempt (
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);
comment on table core.payment_request_attempt is
  'F12/ADR-004 §24: una previsualizacion FALLIDA (invalid) que cuenta. Quien y cuando; el token consultado no se guarda nunca.';
create index payment_request_attempt_user_idx on core.payment_request_attempt (user_id, attempted_at desc);
alter table core.payment_request_attempt enable row level security;
grant select, insert, delete on core.payment_request_attempt to nomey_provisioner;
create policy payment_request_attempt_provisioner_select on core.payment_request_attempt
  for select to nomey_provisioner
  using (user_id = sec.request_actor_id() or attempted_at < now() - interval '1 day');
create policy payment_request_attempt_provisioner_insert on core.payment_request_attempt
  for insert to nomey_provisioner with check (user_id = sec.request_actor_id());
create policy payment_request_attempt_provisioner_prune on core.payment_request_attempt
  for delete to nomey_provisioner using (attempted_at < now() - interval '1 day');

-- ═══════════════════════ §3 · estado y cerrojo ═══════════════════════════════
create function sec.payment_request_state(p_paid_operation_id uuid, p_cancelled_at timestamptz, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when p_paid_operation_id is not null then 'paid'
              when p_cancelled_at is not null then 'cancelled'
              when now() >= p_expires_at then 'expired'
              else 'pending' end;
$fn$;
comment on function sec.payment_request_state(uuid, timestamptz, timestamptz) is
  'F12/ADR-004 §10: el estado de una solicitud, derivado de sus marcas y de now(). Precedencia paid → cancelled → expired → pending.';
grant create on schema sec to nomey_provisioner;
alter function sec.payment_request_state(uuid, timestamptz, timestamptz) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.payment_request_state(uuid, timestamptz, timestamptz) from public;
grant execute on function sec.payment_request_state(uuid, timestamptz, timestamptz)
  to nomey_provisioner, nomey_writer, authenticated;

-- Cerrojo TRANSACCIONAL por creador, con clave propia: dos creaciones del
-- mismo creador se serializan y el tope de pendientes es exacto (§23).
create function sec.lock_payment_request_cap(p_user uuid)
returns void
language sql
set search_path = ''
as $fn$
  select pg_advisory_xact_lock(hashtextextended('nomey.payment_request_cap:' || p_user::text, 0));
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.lock_payment_request_cap(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.lock_payment_request_cap(uuid) from public;
grant execute on function sec.lock_payment_request_cap(uuid) to nomey_provisioner;

-- El writer resuelve token → fila por el mismo hash que persiste el provisioner.
grant execute on function sec.invitation_hash(text) to nomey_writer;

-- ═══════════════════════ §4 · crear ══════════════════════════════════════════
-- payload: { client_command_id, command_contract_version: 1, amount,
--            currency_definition_id, concept? }
-- Orden: forma → actor (normal, handle definitivo, con Personal, moneda =
-- base) → clave de idempotencia (replay: misma solicitud, token null) →
-- [cerrojo por creador] tope de 20 pendientes → token → insert → el token,
-- UNA vez.
create function api.create_payment_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'amount', 'currency_definition_id', 'concept'];
  v_actor    uuid;
  v_guest    boolean;
  v_command  uuid;
  v_contract integer;
  v_amount   bigint;
  v_currency uuid;
  v_concept  text;
  v_own      text;
  v_scope    uuid;
  v_base     uuid;
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
  v_n        integer;
  v_token    text;
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
  v_amount   := sec.payload_amount(payload, 'amount');
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_concept  := sec.payload_text(payload, 'concept', false);
  if v_concept is not null then
    v_concept := sec.canonical_concept(v_concept);
  end if;
  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'el importe de una solicitud debe ser positivo', 400);
  end if;

  -- EL CREADOR (§4): cuenta normal, con handle definitivo, con Modo Personal,
  -- y la moneda es la base de ese Personal (§7).
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no crea solicitudes de pago', 403);
  end if;
  select h.handle into v_own from core.account_handle h
   where h.user_id = v_actor and h.claimed_at is not null and h.released_at is null;
  if v_own is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'crear una solicitud de pago exige tener username definitivo', 409);
  end if;
  select s.id, s.base_currency_definition_id into v_scope, v_base
    from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
  if v_scope is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'el solicitante no tiene Modo Personal', 403);
  end if;
  if v_base is distinct from v_currency then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la moneda de la solicitud es la base del Modo Personal del solicitante, y la transferencia no convierte', 422);
  end if;

  -- CLAVE DE IDEMPOTENCIA (F09/ADR-002). El token salio UNA vez (§18): el
  -- replay devuelve la misma solicitud con token null, y el cliente que
  -- perdio la primera respuesta la cancela y crea otra con otra clave.
  v_intent := jsonb_build_object('amount', payload ->> 'amount', 'currency_definition_id', v_currency::text, 'concept', v_concept);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'payment_request.create', v_contract, v_intent, v_scope);
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
    select r.id, r.expires_at into v_id, v_until from core.payment_request r
     where r.created_by = v_actor and r.client_command_id = v_command;
    return jsonb_build_object('request_id', v_id, 'expires_at', v_until, 'token', null, 'already_processed', true);
  end if;

  -- TOPE DE PENDIENTES PROPIAS (§23), bajo el cerrojo del creador: exacto.
  perform sec.lock_payment_request_cap(v_actor);
  select count(*) into v_n from core.payment_request r
   where r.created_by = v_actor
     and sec.payment_request_state(r.paid_operation_id, r.cancelled_at, r.expires_at) = 'pending';
  if v_n >= 20 then
    perform sec.raise_boundary('PAYMENT_REQUEST_LIMIT',
      'ya tienes veinte solicitudes de pago pendientes; cancela o deja caducar alguna', 409);
  end if;

  v_token := sec.new_invitation_token();
  insert into core.payment_request (created_by, token_hash, amount, currency_definition_id, concept, client_command_id)
  values (v_actor, sec.invitation_hash(v_token), v_amount, v_currency, v_concept, v_command)
  returning id, expires_at into v_id, v_until;

  return jsonb_build_object('request_id', v_id, 'expires_at', v_until, 'token', v_token, 'already_processed', false);
end
$fn$;
comment on function api.create_payment_request(jsonb) is
  'F12/ADR-004 §4, §7, §18, §23: crear una solicitud de pago al portador. Entrega el token UNA vez (el replay devuelve token null); persiste solo su hash; ni operacion ni saldo. Tope de 20 pendientes propias. Idempotente por client_command_id.';
grant create on schema api to nomey_provisioner;
alter function api.create_payment_request(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.create_payment_request(jsonb) from public;
grant execute on function api.create_payment_request(jsonb) to authenticated;

-- ═══════════════════════ §5 · cancelar ═══════════════════════════════════════
-- payload: { request_id }. Solo created_by, mientras pending (§21).
create function api.cancel_payment_request(payload jsonb)
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
  v_r     core.payment_request%rowtype;
  v_state text;
begin
  perform sec.assert_payload_shape(payload, array['request_id']);
  v_actor := sec.request_actor_id();
  v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_id    := sec.payload_uuid(payload, 'request_id', true);
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no cancela solicitudes', 403);
  end if;
  -- La fila, bloqueada: el mismo cerrojo que toma el pago (§19, §21).
  select * into v_r from core.payment_request r where r.id = v_id for update;
  if v_r.id is null or v_r.created_by <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la solicitud no existe o no la creaste tu', 403);
  end if;
  v_state := sec.payment_request_state(v_r.paid_operation_id, v_r.cancelled_at, v_r.expires_at);
  if v_state in ('cancelled', 'expired') then
    return jsonb_build_object('request_id', v_id, 'state', v_state, 'already_processed', true);
  end if;
  if v_state = 'paid' then
    perform sec.raise_boundary('PAYMENT_REQUEST_ALREADY_PAID', 'la solicitud ya fue pagada: la transferencia existe', 409);
  end if;
  update core.payment_request r set cancelled_at = now() where r.id = v_id;
  return jsonb_build_object('request_id', v_id, 'state', 'cancelled', 'already_processed', false);
end
$fn$;
comment on function api.cancel_payment_request(jsonb) is
  'F12/ADR-004 §21: cancelar una solicitud propia mientras esta pending. cancelled y expired responden su estado sin escribir; paid es PAYMENT_REQUEST_ALREADY_PAID.';
grant create on schema api to nomey_provisioner;
alter function api.cancel_payment_request(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.cancel_payment_request(jsonb) from public;
grant execute on function api.cancel_payment_request(jsonb) to authenticated;

-- ═══════════════════════ §6 · previsualizar ══════════════════════════════════
-- Estados, nunca excepciones (§24): ok | own | paid | cancelled | expired |
-- invalid | throttled. Solo `invalid` apunta y solo `invalid` cuenta (20 / 10
-- min); frenado no apunta. En ok y own se publica lo minimo para decidir
-- pagar: importe, moneda, concepto y la identidad publica ACTUAL del
-- creador. Ni id, ni hash, ni uid.
create function api.preview_payment_request(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_guest boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_r     core.payment_request%rowtype;
  v_state text;
  v_n     integer;
  v_id    record;
begin
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no previsualiza solicitudes', 403);
  end if;

  select count(*) into v_n from core.payment_request_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    return jsonb_build_object('state', 'throttled');
  end if;

  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{40,64}$' then
    select * into v_r from core.payment_request r where r.token_hash = sec.invitation_hash(p_token);
  end if;
  if v_r.id is null then
    insert into core.payment_request_attempt (user_id) values (v_actor);
    delete from core.payment_request_attempt a where a.attempted_at < now() - interval '1 day';
    return jsonb_build_object('state', 'invalid');
  end if;

  v_state := sec.payment_request_state(v_r.paid_operation_id, v_r.cancelled_at, v_r.expires_at);
  if v_state <> 'pending' then
    return jsonb_build_object('state', v_state);
  end if;

  select * into v_id from sec.public_identity(v_r.created_by);
  return jsonb_build_object(
    'state', case when v_r.created_by = v_actor then 'own' else 'ok' end,
    'amount', v_r.amount::text,
    'currency_definition_id', v_r.currency_definition_id,
    'concept', v_r.concept,
    'creator_handle', v_id.handle,
    'creator_public_name', v_id.public_name);
end
$fn$;
comment on function api.preview_payment_request(text) is
  'F12/ADR-004 §24: lo minimo para decidir pagar, como estado y nunca excepcion. Solo los `invalid` apuntan y cuentan (20 / 10 min). Nunca id, hash ni uid.';
grant create on schema api to nomey_provisioner;
alter function api.preview_payment_request(text) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.preview_payment_request(text) from public;
grant execute on function api.preview_payment_request(text) to authenticated;

-- ═══════════════════════ §7 · pagar: la internal_transfer ═══════════════════
-- RECREADA sobre su cuerpo de F12.B1. Lo que cambia: DOS origenes de
-- intencion, exactamente uno por llamada (XOR): `proposal_id` (B1, sin
-- cambios) o `payment_request_token` (§12). En la solicitud: actor normal con
-- handle (ANTES del token: quien no puede pagar no distingue si el bearer
-- existe) → token → fila por hash → no propia (PAYMENT_REQUEST_OWN) → clave →
-- fila `for update` → pending no caducada → Personal del PAGADOR (from) y del
-- CREADOR (to) → el resto identico a B1 → paid_at, paid_by, paid_operation_id.
-- Importe, moneda y concepto salen SOLO de la solicitud: el payload no los
-- lleva, y no existe PAYMENT_REQUEST_AMOUNT_MISMATCH.
create or replace function api.record_internal_transfer(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id', 'command_contract_version', 'proposal_id', 'payment_request_token',
    'operation_id', 'expected_version_id'];
  v_proposal uuid;
  v_token text;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_p core.transfer_proposal%rowtype;
  v_r core.payment_request%rowtype;
  v_guest boolean;
  v_state text;
  v_from uuid; v_to uuid;
  v_amount bigint; v_currency uuid;
  v_obs uuid[]; v_before bigint[];
  v_date date; v_time time;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  -- §16: una internal_transfer tiene exactamente una version. La forma del
  -- payload lo decide antes de tocar la clave.
  if (payload ? 'operation_id') or (payload ? 'expected_version_id') then
    perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
      'una transferencia entre usuarios no se corrige: la devolucion es otra transferencia', 422);
  end if;
  v_proposal := sec.payload_uuid(payload, 'proposal_id', false);
  v_token    := sec.payload_text(payload, 'payment_request_token', false);
  if (v_proposal is null) = (v_token is null) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'una transferencia nace de exactamente un origen: proposal_id o payment_request_token', 400);
  end if;

  if v_token is not null then
    -- EL PAGADOR (§5), ANTES de mirar el token: cuenta normal con handle
    -- definitivo. Quien todavia no puede pagar no distingue si el bearer
    -- existe: anonimo recibe NOT_AUTHORIZED y sin handle USERNAME_REQUIRED,
    -- sea el token valido o no. Solo una cuenta elegible llega a resolverlo.
    v_actor := sec.request_actor_id();
    v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
    if v_guest then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no paga solicitudes', 403);
    end if;
    -- sec.public_identity corre como provisioner: el writer no lee handles.
    if (select i.handle from sec.public_identity(v_actor) i) is null then
      perform sec.raise_boundary('USERNAME_REQUIRED', 'pagar una solicitud exige tener username definitivo', 409);
    end if;
    -- LA SOLICITUD (§12): token → fila por hash, sin bloquear todavia. Un
    -- token que no nombra nada es PAYMENT_REQUEST_INVALID; con 256 bits de
    -- entropia no es un oraculo util (§23), y el writer responde sobre.
    if v_token !~ '^[A-Za-z0-9_-]{40,64}$' then
      perform sec.raise_boundary('PAYMENT_REQUEST_INVALID', 'ese enlace no corresponde a ninguna solicitud', 404);
    end if;
    select * into v_r from core.payment_request r where r.token_hash = sec.invitation_hash(v_token);
    if v_r.id is null then
      perform sec.raise_boundary('PAYMENT_REQUEST_INVALID', 'ese enlace no corresponde a ninguna solicitud', 404);
    end if;
    if v_r.created_by = v_actor then
      perform sec.raise_boundary('PAYMENT_REQUEST_OWN', 'no puedes pagar tu propia solicitud', 422);
    end if;
    v_canonical := jsonb_build_object('payment_request_id', v_r.id::text);
  else
    v_canonical := jsonb_build_object('proposal_id', v_proposal::text);
  end if;

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'internal_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  if v_token is not null then
    -- LA FILA, bloqueada (§19: clave → fila → ambitos). La policy de UPDATE
    -- del writer solo alcanza las ajenas; la propia ya se rehuso arriba.
    select * into v_r from core.payment_request r where r.id = v_r.id for update;
    if v_r.id is null then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'la solicitud no es alcanzable', 403);
    end if;
    v_state := sec.payment_request_state(v_r.paid_operation_id, v_r.cancelled_at, v_r.expires_at);
    if v_state = 'paid' then
      perform sec.raise_boundary('PAYMENT_REQUEST_ALREADY_PAID', 'la solicitud ya fue pagada: la transferencia existe', 409);
    elsif v_state = 'cancelled' then
      perform sec.raise_boundary('PAYMENT_REQUEST_CANCELLED', 'quien la creo ya la cancelo', 409);
    elsif v_state = 'expired' then
      perform sec.raise_boundary('PAYMENT_REQUEST_EXPIRED', 'la solicitud ya caduco', 409);
    end if;
    -- LOS EXTREMOS (§12, §15): el Personal del PAGADOR sale y el del CREADOR entra.
    select s.id into v_from from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
    if v_from is null then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'el pagador no tiene Modo Personal', 403);
    end if;
    select s.id into v_to from core.scope s where s.kind = 'personal' and s.owner_user_id = v_r.created_by;
    if v_to is null then
      perform sec.raise_boundary('RECIPIENT_WITHOUT_PERSONAL_SCOPE', 'el solicitante no tiene Modo Personal al que recibir', 422);
    end if;
    v_amount := v_r.amount; v_currency := v_r.currency_definition_id;
  else
    -- LA PROPUESTA (B1, §10 de ADR-002: clave → fila → ambitos). La policy del
    -- writer solo alcanza las dirigidas al actor: la de un tercero, o una
    -- inexistente, son cero filas y NOT_AUTHORIZED, sin distinguirlas.
    select * into v_p from core.transfer_proposal p where p.id = v_proposal for update;
    if v_p.id is null or v_p.target_user_id <> v_actor or v_p.created_by = v_actor then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no va dirigida a ti', 403);
    end if;
    v_state := sec.transfer_proposal_state(v_p.accepted_operation_id, v_p.cancelled_at, v_p.declined_at, v_p.expires_at);
    if v_state = 'accepted' then
      perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
    elsif v_state = 'cancelled' then
      perform sec.raise_boundary('PROPOSAL_CANCELLED', 'quien la creo ya la cancelo', 409);
    elsif v_state = 'declined' then
      perform sec.raise_boundary('PROPOSAL_DECLINED', 'la propuesta ya fue rechazada', 409);
    elsif v_state = 'expired' then
      perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
    end if;
    -- LOS EXTREMOS, derivados (ADR-002 §11, §13): el Personal de quien propuso
    -- y el de quien acepta. Ningun dato del payload elige un ambito.
    select s.id into v_from from core.scope s where s.kind = 'personal' and s.owner_user_id = v_p.created_by;
    select s.id into v_to   from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
    if v_from is null or v_to is null then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'una de las dos partes no tiene Modo Personal', 403);
    end if;
    v_amount := v_p.amount; v_currency := v_p.currency_definition_id;
  end if;

  -- ADR-002 §20 / ADR-004 §7: la moneda es la base de los dos, o no hay transferencia.
  perform sec.assert_no_conversion(v_from, v_currency);
  perform sec.assert_no_conversion(v_to,   v_currency);

  -- LOCK de la dimension SALDO (ADR-013 §11, F6.C), en el orden global.
  v_obs := array[v_from, v_to];
  perform sec.lock_scopes(v_obs);
  v_before := sec.balances_before(v_obs);

  -- Fecha e instante de la materializacion, del servidor (ADR-002 §21).
  v_date := current_date;
  v_time := localtime(0);

  perform sec.persist_version(v_actor, v_operation, v_version, 1, null,
                              'internal_transfer', v_date, v_amount, v_currency, v_time);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_currency,   v_amount);

  insert into core.transfer_part (operation_version_id, from_scope_id, to_scope_id)
  values (v_version, v_from, v_to);

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- La transicion terminal, en la misma transaccion: todo o nada.
  if v_token is not null then
    update core.payment_request r
       set paid_at = now(), paid_by = v_actor, paid_operation_id = v_operation
     where r.id = v_r.id;
    if not found then
      raise exception 'la solicitud % no pudo marcarse pagada: falta la policy o el privilegio de UPDATE del writer', v_r.id;
    end if;
  else
    update core.transfer_proposal p
       set accepted_at = now(), accepted_operation_id = v_operation
     where p.id = v_proposal;
    if not found then
      raise exception 'la propuesta % no pudo marcarse aceptada: falta la policy o el privilegio de UPDATE del writer', v_proposal;
    end if;
  end if;

  return sec.envelope(v_operation, false);
end
$fn$;
comment on function api.record_internal_transfer(jsonb) is
  'F12/ADR-002 §11 y F12/ADR-004 §12: materializar una propuesta aceptada (proposal_id) o pagar una solicitud (payment_request_token), exactamente uno. Emisor, receptor, importe y moneda salen del origen. Una sola version: ni correccion (TRANSFER_NOT_EDITABLE) ni anulacion (OPERATION_NOT_ANNULLABLE).';
grant create on schema api to nomey_writer;
alter function api.record_internal_transfer(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.record_internal_transfer(jsonb) from public;
grant execute on function api.record_internal_transfer(jsonb) to authenticated;

-- ═══════════════════════ §8 · lectura ════════════════════════════════════════
-- La contraparte de cada propuesta Y de cada solicitud de la que el actor es
-- parte, como identidad publica ACTUAL. Cambia el tipo de retorno (se anade
-- payment_request_id), asi que la vista que dependia de ella se recrea.
-- Las dos vistas de B1 dependen de la funcion: se recrean identicas en su
-- contrato (my_transfer_proposals) o ampliadas (my_transfers).
drop view api.my_transfers;
drop view api.my_transfer_proposals;
drop function sec.my_transfer_counterparts();
create function sec.my_transfer_counterparts()
returns table (proposal_id uuid, payment_request_id uuid, accepted_operation_id uuid, direction text,
               counterpart_handle text, counterpart_public_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, null::uuid, p.accepted_operation_id,
         case when p.created_by = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name
    from core.transfer_proposal p
    left join lateral sec.public_identity(
      case when p.created_by = sec.request_actor_id() then p.target_user_id else p.created_by end) i on true
   where sec.request_actor_id() in (p.created_by, p.target_user_id)
  union all
  -- Solicitud: quien la pago envia (paid_by, auditoria del writer); quien la
  -- creo recibe. La direccion CONTABLE de la transferencia sigue saliendo de
  -- core.transfer_part en api.my_transfers; esto solo nombra la contraparte.
  select null::uuid, r.id, r.paid_operation_id,
         case when r.paid_by = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name
    from core.payment_request r
    left join lateral sec.public_identity(
      case when r.paid_by = sec.request_actor_id() then r.created_by else r.paid_by end) i on true
   where sec.request_actor_id() in (r.created_by, r.paid_by);
$fn$;
comment on function sec.my_transfer_counterparts() is
  'F12/ADR-002 §9, §14 y F12/ADR-004 §16, §17: por cada propuesta o solicitud propia, la direccion y la identidad publica ACTUAL de la contraparte. Sin uid. Solo para las vistas de api.';
grant create on schema sec to nomey_provisioner;
alter function sec.my_transfer_counterparts() owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.my_transfer_counterparts() from public;
grant execute on function sec.my_transfer_counterparts() to authenticated;

-- api.my_transfer_proposals, identica a B1 (§9 de ADR-002): TODAS las enviadas con su estado; de las
-- recibidas, solo las pending. Los importes cruzan como texto (F02/ADR-001).
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
       coalesce(p.concept, r.concept) as concept,
       c.counterpart_handle,
       c.counterpart_public_name,
       p.id as proposal_id,
       o.created_at as operation_created_at,
       r.id as payment_request_id
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  join core.transfer_part tp on tp.operation_version_id = ov.id
  left join core.transfer_proposal p on p.accepted_operation_id = o.id
  left join core.payment_request r on r.paid_operation_id = o.id
  left join sec.my_transfer_counterparts() c on c.accepted_operation_id = o.id
 where s.kind = 'personal'
   and s.owner_user_id = (select auth.uid())
   and o.operation_class = 'internal_transfer'
   and ov.version_kind = 'record'
   and e.balance_amount is not null
   and sec.counts_in_personal(e.scope_id, o.id);
comment on view api.my_transfers is
  'F12/ADR-002 §7, §14 y F12/ADR-004 §16: las transferencias entre usuarios vigentes en el Personal propio. direction sale de core.transfer_part; concept y contraparte, de la propuesta o de la solicitud que la produjo. Publica solo el ambito PROPIO.';
grant select on api.my_transfers to authenticated;

-- Las solicitudes propias (§16): estado y, si ya se pago, quien pago.
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
