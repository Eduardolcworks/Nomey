-- ============================================================================
-- RECTIFICAR UNA RECLAMACION: «ME EQUIVOQUE DE PARTICIPANTE» (ADR-037)
-- ============================================================================
--
--   §1  la procedencia de la reclamacion en el vinculo (claim_command_id), con
--       el relleno INEQUIVOCO de los vinculos anteriores
--   §2  core.participant_unclaim: el hecho, insert-only
--   §3  sec.unclaim_blocking_operations: la caja que bloquea, como frontera
--   §4  sec.raise_boundary con detalles: el error lleva las operaciones
--   §5  api.redeem_invitation escribe la procedencia
--   §6  api.unclaim_participant, del provisioner, con el protocolo de
--       identidad de 20260912150000 (clave → cerrojo → identidad)
--   §7  api.group_participant publica claim_command_id (solo el propio)
--
-- Lo que rectificar NO hace: no toca efectos, presencias, versiones ni
-- autoria; no manda aviso de salida; no borra al participante. Borra el
-- vinculo y la membresia que la reclamacion creo, y deja el hecho.
-- ============================================================================

-- ═══════════════════════ §1 · la procedencia ═════════════════════════════════

alter table core.participant_user_link
  add column claim_command_id uuid;
alter table core.participant_user_link
  add constraint participant_user_link_procedencia
  foreign key (user_id, claim_command_id)
  references core.provisioning_command (created_by, client_command_id);
comment on column core.participant_user_link.claim_command_id is
  'El comando invitation.redeem (claim) que creo este vinculo, o nulo (creador, «Soy nuevo», o procedencia no demostrable). Solo un vinculo con procedencia admite rectificarse (ADR-037 §1).';

-- Relleno de los vinculos anteriores, SOLO donde la procedencia es inequivoca:
-- exactamente un comando de reclamacion del mismo usuario sobre ese
-- participante. Sin rectificar (no existia), un vinculo solo pudo nacer de esa
-- reclamacion o del creador / «Soy nuevo», que no dejan comando de
-- reclamacion; una reclamacion fallida deshace su comando. Cero o mas de uno:
-- nulo, y ese vinculo queda fuera de esta via. Nada se habilita por suposicion.
update core.participant_user_link l
   set claim_command_id = c.client_command_id
  from (
    select pc.created_by, (pc.canonical_intent ->> 'participant_id')::uuid as participant_id,
           min(pc.client_command_id::text)::uuid as client_command_id, count(*) as n
      from core.provisioning_command pc
     where pc.command_type = 'invitation.redeem'
       and pc.canonical_intent ->> 'choice' = 'claim'
       and pc.canonical_intent ->> 'participant_id' is not null
     group by pc.created_by, (pc.canonical_intent ->> 'participant_id')::uuid
  ) c
 where c.n = 1 and c.created_by = l.user_id and c.participant_id = l.participant_id
   and l.claim_command_id is null;

-- El provisioner borra el vinculo PROPIO: solo el suyo, como en salir borra
-- su membresia.
grant delete on core.participant_user_link to nomey_provisioner;
create policy participant_user_link_provisioner_self_delete on core.participant_user_link
  for delete to nomey_provisioner
  using (user_id = sec.request_actor_id());

-- ═══════════════════════ §2 · el hecho ═══════════════════════════════════════

create table core.participant_unclaim (
  id                uuid primary key default gen_random_uuid(),
  participant_id    uuid not null references core.participant (id),
  scope_id          uuid not null references core.scope (id),
  user_id           uuid not null,
  -- El comando de reclamacion que se deshizo. Sin FK al vinculo (ya no existe)
  -- y sin FK al comando: el hecho sobrevive a lo que describe.
  claim_command_id  uuid not null,
  unclaimed_at      timestamptz not null default now(),
  client_command_id uuid not null unique
);
comment on table core.participant_unclaim is
  'Una reclamacion deshecha por la propia cuenta (ADR-037): el vinculo y la membresia que creo se borran, y este es el hecho que queda. Insert-only.';
create index participant_unclaim_scope_idx on core.participant_unclaim (scope_id, unclaimed_at desc);
alter table core.participant_unclaim enable row level security;
grant select, insert on core.participant_unclaim to nomey_provisioner;
create policy participant_unclaim_provisioner_insert on core.participant_unclaim
  for insert to nomey_provisioner
  with check (user_id = sec.request_actor_id());
create policy participant_unclaim_provisioner_select on core.participant_unclaim
  for select to nomey_provisioner
  using (user_id = sec.request_actor_id());

-- ═══════════════════════ §3 · la caja que bloquea ════════════════════════════
--
-- Un efecto de SALDO vigente en un Modo Personal del actor cuya version tenga
-- algun efecto en el grupo: un gasto pagado como el participante o una
-- liquidacion por transferencia hecha como el (medido en unclaim-evidence.sql
-- D y F). Cruza RLS a proposito —el provisioner no ve los efectos del grupo—
-- y su lista de columnas es la frontera: de cada operacion del actor en un
-- grupo del que es miembro, lo que ya puede ver como miembro (clase, concepto,
-- importe declarado, fecha) para que la pantalla diga QUE bloquea sin ensenar
-- identificadores. El importe viaja como texto (ADR-003).
create function sec.unclaim_blocking_operations(p_scope uuid)
returns table (operation_id uuid, operation_class text, concept text, amount text, effective_date date)
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct ov.operation_id, o.operation_class,
         (select d.concept from core.movement_detail d where d.operation_version_id = ov.id),
         ov.original_amount::text, ov.effective_date
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
    join core.scope s on s.id = e.scope_id
   where s.kind = 'personal'
     and s.owner_user_id = sec.request_actor_id()
     and e.balance_amount is not null
     and sec.is_member(p_scope)
     and exists (select 1 from core.current_effect g
                  where g.operation_version_id = e.operation_version_id
                    and g.scope_id = p_scope);
$fn$;
revoke execute on function sec.unclaim_blocking_operations(uuid) from public;
grant execute on function sec.unclaim_blocking_operations(uuid) to nomey_provisioner;

-- ═══════════════════════ §4 · el error con detalles ══════════════════════════
--
-- PostgREST devuelve como cuerpo el JSON del mensaje de un error PGRST: code,
-- message, details, hint. `details` viaja como TEXTO (un JSON serializado):
-- es lo que supabase-js expone tal cual en `error.details`.
create function sec.raise_boundary(p_code text, p_message text, p_status integer, p_details jsonb)
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  raise sqlstate 'PGRST' using
    message = json_build_object('code', p_code, 'message', p_message, 'details', p_details::text)::text,
    detail  = format('{"status":%s,"headers":{}}', p_status);
end
$fn$;
revoke execute on function sec.raise_boundary(text, text, integer, jsonb) from public;
grant execute on function sec.raise_boundary(text, text, integer, jsonb) to nomey_writer, nomey_provisioner;

-- ═══════════════════════ §5 · reclamar deja su procedencia ═══════════════════
CREATE OR REPLACE FUNCTION api.redeem_invitation(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    --      Y LA PROCEDENCIA (ADR-037 §1): el comando de ESTA reclamacion
    --      queda en el vinculo, y es lo unico que rectificar admite deshacer.
    begin
      insert into core.participant_user_link (participant_id, scope_id, user_id, claim_command_id)
      values (v_target, v_inv.scope_id, v_actor, v_command);
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
$function$;

-- ═══════════════════════ §6 · rectificar ═════════════════════════════════════
create function api.unclaim_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id', 'participant_id', 'claim_command_id'];
  v_actor    uuid;
  v_command  uuid;
  v_version  integer;
  v_scope    uuid;
  v_target   uuid;
  v_claim    uuid;
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
  v_link     record;
  v_blocking jsonb;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  v_target  := (payload ->> 'participant_id')::uuid;
  v_claim   := (payload ->> 'claim_command_id')::uuid;
  if v_command is null or v_version is null or v_scope is null or v_target is null or v_claim is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version, scope_id, participant_id y claim_command_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;

  v_intent := jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'claim_command_id', v_claim);

  -- 0 · LA CLAVE, antes de autorizar y antes del cerrojo (ADR-033, ADR-010 §5).
  --     Un reintento de una rectificacion ya hecha responde su resultado
  --     original y NO llega a mirar el vinculo actual: si alguien —esta cuenta
  --     u otra— reclamo al participante despues, esa reclamacion no se toca.
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'participant.unclaim', v_version, v_intent, v_scope);
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
    return jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'already_processed', true);
  end if;

  -- 1 · EL CERROJO DE IDENTIDAD DEL GRUPO, y solo el cerrojo: el provisioner
  --     no toma filas de ambito (E6). Todo lo que sigue se lee bajo el.
  perform sec.lock_participant_claims(v_scope);

  -- Membresia VIGENTE, leida aqui y no antes: una salida concurrente ya se
  -- serializo y se ve.
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  -- 2 · EL VINCULO PROPIO, y la reclamacion que lo creo. Solo se deshace la
  --     reclamacion que creo el vinculo VIGENTE: una posterior —de esta cuenta
  --     o de otra— no es la que se pide deshacer.
  select l.participant_id, l.claim_command_id into v_link
    from core.participant_user_link l
   where l.participant_id = v_target and l.scope_id = v_scope and l.user_id = v_actor;
  if v_link.participant_id is null then
    perform sec.raise_boundary('CLAIM_SUPERSEDED',
      'ese participante ya no esta vinculado a tu cuenta en este grupo', 409);
  end if;
  if v_link.claim_command_id is null then
    perform sec.raise_boundary('UNCLAIM_NOT_AVAILABLE',
      'este vinculo no procede de una reclamacion rectificable', 409);
  end if;
  if v_link.claim_command_id <> v_claim then
    perform sec.raise_boundary('CLAIM_SUPERSEDED',
      'la reclamacion que se pide deshacer no es la que creo el vinculo actual', 409);
  end if;

  -- 3 · LA CAJA. Ninguna caja vigente en tu Personal por operaciones de este
  --     grupo: si la hay, se rehusa con las operaciones, y nada cambia. No se
  --     borra ni se reasigna ningun efecto para hacerlo posible.
  select jsonb_agg(jsonb_build_object(
           'operation_id', b.operation_id, 'operation_class', b.operation_class,
           'concept', b.concept, 'amount', b.amount, 'effective_date', b.effective_date::text)
         order by b.effective_date desc, b.operation_id)
    into v_blocking
    from sec.unclaim_blocking_operations(v_scope) b;
  if v_blocking is not null then
    perform sec.raise_boundary('UNCLAIM_BLOCKED_CASH',
      'hay dinero registrado en tu Personal como este participante en este grupo', 409,
      jsonb_build_object('operations', v_blocking));
  end if;

  -- 4 · EL HECHO, y despues lo que la reclamacion creo: el vinculo y la
  --     membresia, ambos del actor. Ni presencia, ni efectos, ni versiones,
  --     ni aviso: el participante sigue en el grupo, ahora sin cuenta.
  insert into core.participant_unclaim (participant_id, scope_id, user_id, claim_command_id, client_command_id)
  values (v_target, v_scope, v_actor, v_claim, v_command);
  delete from core.participant_user_link where participant_id = v_target and user_id = v_actor;
  delete from core.membership where scope_id = v_scope and user_id = v_actor;

  return jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'already_processed', false);
end
$fn$;

grant create on schema api to nomey_provisioner;
alter function api.unclaim_participant(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.unclaim_participant(jsonb) from public;
grant execute on function api.unclaim_participant(jsonb) to authenticated;
comment on function api.unclaim_participant(jsonb) is
  'Deshace la reclamacion que creo el vinculo actual del actor en un grupo (ADR-037): solo el propio actor, miembro vigente, sin caja vigente en su Personal por operaciones del grupo. Borra vinculo y membresia; conserva todo lo demas.';

-- ═══════════════════════ §7 · la lectura ═════════════════════════════════════
--
-- «Procede de una reclamacion rectificable» —el vinculo PROPIO lleva
-- procedencia, y es la que hay que citar al rectificar— no es «puede
-- rectificarse ahora»: eso lo decide el servidor bajo el cerrojo. Solo sobre
-- el actor, nunca sobre los demas (ADR-012 §1): para cualquier otro es nulo.
create function sec.my_claim_command_id(p_participant uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.claim_command_id
    from core.participant_user_link l
   where l.participant_id = p_participant
     and l.user_id = sec.request_actor_id();
$fn$;
revoke execute on function sec.my_claim_command_id(uuid) from public;
grant execute on function sec.my_claim_command_id(uuid) to authenticated;

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
       sec.participant_has_history(p.id) as has_history,
       -- Al FINAL: create or replace no admite mover ni quitar columnas.
       sec.my_claim_command_id(p.id) as claim_command_id
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr on true
 where s.kind = 'group';
