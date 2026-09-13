-- ============================================================================
-- INVITACIONES A UN GRUPO: emitir, previsualizar y canjear. ADR-035.
-- ============================================================================
--
-- La decision de producto (2026-09-10): POSEER UNA INVITACION VALIDA AUTORIZA a
-- entrar en el grupo y a reclamar un participante disponible. Sin aprobacion
-- de nadie, sin coincidencia de nombre como prueba: una invitacion reenviada
-- concede el mismo acceso. Es la prueba de autorizacion que ADR-012 §9
-- delegaba a F10, y queda escrita aqui y en el ADR.
--
-- Lo que hay:
--
--   core.group_invitation            el hecho: ambito, HASH del token, quien,
--                                    cuando, hasta cuando, y si se revoco
--   core.invitation_attempt          intentos fallidos por cuenta, para frenar
--                                    la adivinacion en masa (sin el token)
--   api.create_group_invitation      un miembro emite; el token sale UNA vez
--   api.revoke_group_invitation      un miembro revoca
--   api.preview_invitation           que grupo es y quien esta disponible,
--                                    y NADA mas: ni deudas, ni importes
--   api.redeem_invitation            entrar: reclamar o ser nuevo; membresia,
--                                    vinculo y presencia en una transaccion
--
-- El token es opaco (32 bytes aleatorios, base64url) y SOLO se guarda su
-- SHA-256: ni la base ni los logs lo conocen. El enlace y el QR transportan el
-- mismo token; no existe web de invitacion ni Universal Link: el enlace es un
-- esquema de la app (`nomey://join?t=...`) y el QR lleva la misma cadena.

create table core.group_invitation (
  id          uuid primary key default gen_random_uuid(),
  scope_id    uuid not null references core.scope (id),
  token_hash  bytea not null unique,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  constraint group_invitation_caduca_despues check (expires_at > created_at)
);
comment on table core.group_invitation is
  'Una invitacion a un grupo. Solo el hash del token (ADR-035): el token vive en el enlace y en el QR, nunca aqui.';
alter table core.group_invitation enable row level security;
grant select, insert on core.group_invitation to nomey_provisioner;
grant update (revoked_at) on core.group_invitation to nomey_provisioner;
create policy group_invitation_provisioner_insert on core.group_invitation
  for insert to nomey_provisioner
  with check (created_by = sec.request_actor_id() and sec.is_member(scope_id));
create policy group_invitation_provisioner_select on core.group_invitation
  for select to nomey_provisioner
  using (sec.is_member(scope_id));
create policy group_invitation_provisioner_revoke on core.group_invitation
  for update to nomey_provisioner
  using (sec.is_member(scope_id))
  with check (sec.is_member(scope_id));

-- Intentos FALLIDOS de previsualizar, por cuenta. No lleva el token ni nada de
-- el: solo quien y cuando, que es lo que hace falta para frenar.
create table core.invitation_attempt (
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);
create index invitation_attempt_user_idx on core.invitation_attempt (user_id, attempted_at desc);
alter table core.invitation_attempt enable row level security;

-- ═══════════════════════ el token, y su resolucion ═══════════════════════════

-- base64url sin relleno: cabe en un QR corto y en una URL sin escapar. Definer
-- de postgres SOLO por el USAGE sobre `extensions`, que el provisioner no tiene
-- ni debe tener: no lee ni escribe ninguna relacion.
create function sec.new_invitation_token()
returns text
language sql
volatile
security definer
set search_path = ''
as $fn$
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$fn$;
revoke execute on function sec.new_invitation_token() from public;
grant execute on function sec.new_invitation_token() to nomey_provisioner;

create function sec.invitation_hash(p_token text)
returns bytea
language sql
immutable
security definer
set search_path = ''
as $fn$
  select extensions.digest(p_token, 'sha256');
$fn$;
revoke execute on function sec.invitation_hash(text) from public;
grant execute on function sec.invitation_hash(text) to nomey_provisioner;

-- RESUELVE un token a su invitacion, o dice por que no. Definer de postgres
-- para que ni el cliente ni el provisioner necesiten leer la tabla por su
-- cuenta: solo responde a quien trae el token.
--
-- DEVUELVE UN ESTADO EN VEZ DE LANZAR, y no es estilo: un intento fallido se
-- apunta en `core.invitation_attempt`, y una excepcion revertiria ese apunte
-- con el resto de la transaccion (PostgreSQL no tiene transacciones autonomas).
-- Sin apunte no hay freno. Asi que `invalid`, `revoked`, `expired` y
-- `throttled` viajan como estado —HTTP 200, transaccion confirmada— y quien
-- llama decide que hacer; solo `ok` trae invitacion y ambito. Se frena a partir
-- de 20 fallos en 10 minutos por cuenta, y el token nunca se escribe.
create function sec.resolve_invitation(p_token text)
returns table (state text, invitation_id uuid, scope_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_row   core.group_invitation%rowtype;
  v_n     int;
begin
  if v_actor is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'hace falta una sesion para usar una invitacion', 401);
  end if;

  select count(*) into v_n from core.invitation_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    state := 'throttled'; return next; return;
  end if;

  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{40,64}$' then
    select * into v_row from core.group_invitation i where i.token_hash = sec.invitation_hash(p_token);
  end if;
  if v_row.id is null then
    insert into core.invitation_attempt (user_id) values (v_actor);
    -- limpieza oportunista, para que la tabla no crezca sin fin
    delete from core.invitation_attempt a where a.attempted_at < now() - interval '1 day';
    state := 'invalid'; return next; return;
  end if;
  if v_row.revoked_at is not null then
    state := 'revoked'; return next; return;
  end if;
  if v_row.expires_at <= now() then
    state := 'expired'; return next; return;
  end if;

  state := 'ok';
  invitation_id := v_row.id;
  scope_id := v_row.scope_id;
  return next;
end
$fn$;
revoke execute on function sec.resolve_invitation(text) from public;
grant execute on function sec.resolve_invitation(text) to nomey_provisioner;

-- ¿SE PUEDE RECLAMAR? De este ambito, sin cuenta vinculada, no retirado y con
-- presencia abierta. Definer de postgres: el provisioner no lee retiradas ni
-- presencias por su cuenta, y la pregunta es una sola.
create function sec.participant_available(p_participant uuid, p_scope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from core.participant p
     where p.id = p_participant and p.scope_id = p_scope
       and not exists (select 1 from core.participant_user_link l where l.participant_id = p.id)
       and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
       and exists (select 1 from core.participant_period pp where pp.participant_id = p.id and pp.valid_until is null));
$fn$;
revoke execute on function sec.participant_available(uuid, uuid) from public;
grant execute on function sec.participant_available(uuid, uuid) to nomey_provisioner;

-- ═══════════════════════ emitir y revocar ═══════════════════════════════════

create function api.create_group_invitation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'scope_id', 'expires_in_days'];
  v_actor   uuid;
  v_command uuid;
  v_version integer;
  v_scope   uuid;
  v_days    integer;
  v_intent  jsonb;
  v_stored  jsonb;
  v_replay  boolean := false;
  v_token   text;
  v_id      uuid;
  v_until   timestamptz;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  v_days    := coalesce((payload ->> 'expires_in_days')::integer, 7);
  if v_command is null or v_version is null or v_scope is null then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'client_command_id, command_contract_version y scope_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  -- Caducidad: por defecto 7 dias, nunca mas de 30. Una invitacion eterna no
  -- existe: es la decision de ADR-035 §3.
  if v_days < 1 or v_days > 30 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'expires_in_days va de 1 a 30', 400);
  end if;

  v_intent := jsonb_build_object('scope_id', v_scope, 'expires_in_days', v_days);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.invite', v_version, v_intent, v_scope);
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
    -- El token salio una sola vez: un reintento no puede volver a enseñarlo.
    return jsonb_build_object('scope_id', v_scope, 'token', null, 'already_processed', true);
  end if;

  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  v_token := sec.new_invitation_token();
  v_until := now() + make_interval(days => v_days);
  insert into core.group_invitation (scope_id, token_hash, created_by, expires_at)
  values (v_scope, sec.invitation_hash(v_token), v_actor, v_until)
  returning id into v_id;

  return jsonb_build_object('scope_id', v_scope, 'invitation_id', v_id, 'token', v_token,
                            'expires_at', v_until, 'already_processed', false);
end
$fn$;

create function api.revoke_group_invitation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'invitation_id'];
  v_actor uuid; v_command uuid; v_version integer; v_id uuid; v_scope uuid;
  v_intent jsonb; v_stored jsonb; v_replay boolean := false;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_id      := (payload ->> 'invitation_id')::uuid;
  if v_command is null or v_version <> 1 or v_id is null then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'client_command_id, command_contract_version e invitation_id son obligatorios', 400);
  end if;
  -- La RLS del provisioner solo deja ver las invitaciones de los grupos del actor.
  select i.scope_id into v_scope from core.group_invitation i where i.id = v_id;
  if v_scope is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'esa invitacion no existe o no es tuya', 403);
  end if;
  v_intent := jsonb_build_object('invitation_id', v_id);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.revoke_invitation', v_version, v_intent, v_scope);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is distinct from v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);
    end if;
    return jsonb_build_object('invitation_id', v_id, 'already_processed', true);
  end if;
  update core.group_invitation set revoked_at = coalesce(revoked_at, now()) where id = v_id;
  return jsonb_build_object('invitation_id', v_id, 'already_processed', false);
end
$fn$;

-- ═══════════════════════ previsualizar ═══════════════════════════════════════
--
-- SOLO lo necesario para elegir identidad: el nombre y el emoji del grupo, si
-- ya se es miembro, y los participantes DISPONIBLES —sin cuenta vinculada, no
-- retirados, con presencia abierta— por nombre. Ni deudas, ni importes, ni
-- historial, ni quien esta detras de cada nombre. `scope_id` solo si ya se es
-- miembro, que es cuando el cliente lo necesita para abrir el grupo.
create function api.preview_invitation(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_inv   record;
  v_state text;
  v_name  text;
  v_emoji text;
begin
  select * into v_inv from sec.resolve_invitation(p_token);
  if v_inv.state <> 'ok' then
    return jsonb_build_object('state', v_inv.state);
  end if;

  select gp.display_name, gp.emoji into v_name, v_emoji
    from core.group_profile gp where gp.scope_id = v_inv.scope_id;

  if exists (select 1 from core.membership m where m.scope_id = v_inv.scope_id and m.user_id = v_actor) then
    v_state := 'member';
  elsif exists (select 1 from core.participant_user_link l where l.scope_id = v_inv.scope_id and l.user_id = v_actor) then
    -- Salio con vinculo: reincorporarse es otra decision (ADR-034 §8, F10).
    v_state := 'rejoin_pending';
  else
    v_state := 'join';
  end if;

  return jsonb_build_object(
    'state', v_state,
    'display_name', v_name,
    'emoji', v_emoji,
    'scope_id', case when v_state = 'member' then v_inv.scope_id end,
    'participants', case when v_state = 'join' then coalesce((
      select jsonb_agg(jsonb_build_object('participant_id', p.id, 'display_name', p.display_name)
                       order by p.created_at, p.id)
        from core.participant p
       where p.scope_id = v_inv.scope_id and sec.participant_available(p.id, v_inv.scope_id)
    ), '[]'::jsonb) else '[]'::jsonb end);
end
$fn$;

-- ═══════════════════════ canjear ═════════════════════════════════════════════

-- La membresia por invitacion: la misma forma que la del creador, con el
-- comando de canje como testigo. Ningun scope_id del payload autoriza nada.
create policy membership_provisioner_invitation_insert on core.membership
  for insert to nomey_provisioner
  with check (
    user_id = sec.request_actor_id()
    and exists (select 1 from core.provisioning_command pc
                 where pc.result_scope_id = membership.scope_id
                   and pc.created_by = sec.request_actor_id()
                   and pc.command_type = 'invitation.redeem'));

create function api.redeem_invitation(payload jsonb)
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

-- ═══════════════════════ propiedad y ejecucion ════════════════════════════════
grant create on schema api to nomey_provisioner;
alter function api.create_group_invitation(jsonb) owner to nomey_provisioner;
alter function api.revoke_group_invitation(jsonb) owner to nomey_provisioner;
alter function api.redeem_invitation(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
-- preview queda de postgres: cruza la RLS a proposito, y su cuerpo es la frontera.
revoke execute on function api.create_group_invitation(jsonb), api.revoke_group_invitation(jsonb),
  api.preview_invitation(text), api.redeem_invitation(jsonb) from public;
grant execute on function api.create_group_invitation(jsonb), api.revoke_group_invitation(jsonb),
  api.preview_invitation(text), api.redeem_invitation(jsonb) to authenticated;
