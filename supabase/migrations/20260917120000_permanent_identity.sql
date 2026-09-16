-- ============================================================================
-- IDENTIDAD PERMANENTE EN EL GRUPO · F10/ADR-002 — bloque F10.A3
-- ============================================================================
--
-- Decision de producto (F10/ADR-002, Aceptado): una vez una cuenta se vincula
-- a un participante —creando el grupo, entrando como nuevo o reclamando—, ese
-- participante es su identidad permanente en ese grupo. No existe ninguna
-- accion de deshacerlo: ni el `unclaim` de F09/ADR-006 ni el `unlink` de
-- F10/ADR-001. Salir y volver son el ciclo de F9, que no se toca: el vinculo
-- se conserva al salir y volver recupera el mismo participante.
--
-- Esta migracion parte del estado que dejo 20260916120000 (F10.A2) y retira
-- la superficie publica y la maquinaria que solo servian para la baja. No hay
-- produccion ni consumidores externos: la unica app es la de este repositorio.
--
--   §0  fail-closed: ninguna baja ni aviso de baja registrados (0 filas).
--   §1  se retiran las funciones de la baja y del legado: api.unlink_participant,
--       sec.unlink_instance, sec.unlink_blocking_attribution,
--       sec.unclaim_blocking_operations, api.unclaim_participant,
--       sec.my_claim_command_id, sec.my_link_id.
--   §2  api.group_participant sin claim_command_id ni link_id: la instancia es
--       interna y el cliente no la necesita.
--   §3  identity_released deja de existir (sin evento de producto): vista y
--       «visto» sin la rama, el CHECK vuelve a seis kinds, y core.participant_unlink
--       se retira sin filas.
--   §4  api.redeem_invitation deja de escribir claim_command_id; la columna se
--       retira con su CHECK y su FK.
--
-- Se conserva a proposito: participant_user_link.link_id (identidad interna de
-- la instancia), origin_command_id (procedencia), core.link_baseline y
-- core.link_baseline_subject con sus escritores en create_group y redeem
-- (auditoria historica de lo que existia al nacer la instancia),
-- sec.instance_subjects y sec.link_baseline_rows, y todo el ciclo de F9.
-- ============================================================================

-- ═══════════════════════ §0 · fail-closed ═══════════════════════════════════
do $guard$
declare v_n integer;
begin
  select count(*) into v_n from core.participant_unlink;
  if v_n > 0 then
    raise exception 'F10/ADR-002: core.participant_unlink tiene % filas; una baja registrada no se borra en silencio. Reinicia la base local (docs/runbooks/local-setup.md).', v_n;
  end if;
  select count(*) into v_n from core.group_notice where kind = 'identity_released';
  if v_n > 0 then
    raise exception 'F10/ADR-002: hay % avisos identity_released; no se borran en silencio. Reinicia la base local (docs/runbooks/local-setup.md).', v_n;
  end if;
end
$guard$;

-- ═══════════════════════ §1 · las funciones de la baja y del legado ═════════
-- postgres es miembro del rol dueno (nomey_provisioner) de las tres primeras.
drop function api.unlink_participant(jsonb);
drop function sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean);
drop function api.unclaim_participant(jsonb);
drop function sec.unlink_blocking_attribution(uuid);
drop function sec.unclaim_blocking_operations(uuid);
-- sec.my_claim_command_id la usa todavia api.group_participant: cae en §2,
-- despues de recrear la vista (medido en la reconstruccion desde cero).

-- ═══════════════════════ §2 · api.group_participant sin instancia ═══════════
-- Quitar columnas exige recrear la vista; el grant se repone igual. Despues
-- caen sec.my_link_id y sec.my_claim_command_id, que solo la vista usaba.
drop view api.group_participant;
create or replace view api.group_participant with (security_invoker = true) as
select p.id as participant_id,
       p.scope_id,
       p.display_name,
       p.created_at,
       sec.is_my_participant(p.id) as is_self,
       coalesce(pr.is_active, false) as is_active,
       pr.eligible_until,
       exists (select 1 from core.participant_retirement r where r.participant_id = p.id) as is_retired,
       sec.participant_is_linked(p.id) as is_linked,
       sec.participant_has_history(p.id) as has_history,
       (select m.target_participant_id from core.participant_merge m where m.source_participant_id = p.id) as merged_into_participant_id
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr(is_active, eligible_until) on true
 where s.kind = 'group';
grant select on api.group_participant to authenticated;
drop function sec.my_link_id(uuid);
drop function sec.my_claim_command_id(uuid);

-- ═══════════════════════ §3 · identity_released deja de existir ═════════════
create or replace view api.group_notice with (security_invoker = true) as
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
         when 'payment' then sec.payment_counterpart_name(n.subject_id)
         when 'payment_annulled' then sec.payment_counterpart_name(n.subject_id)
         else null::text
       end as participant_display_name
  from core.group_notice n;

create or replace function api.mark_group_notices_seen(p_newest uuid)
returns integer
language sql
security definer
set search_path = ''
as $function$
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
$function$;

alter table core.group_notice drop constraint group_notice_kind_check;
alter table core.group_notice add constraint group_notice_kind_check
  check (kind = any (array['edit', 'profile', 'departure', 'settlement', 'payment', 'payment_annulled']));
drop table core.participant_unlink;

-- ═══════════════════════ §4 · redeem_invitation sin la columna derivada ══════
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
  v_mine    uuid;
  v_target  uuid;
  v_name    text;
  v_inv     record;
  v_intent  jsonb;
  v_stored  jsonb;
  v_replay  boolean := false;
  v_new     uuid;
  v_link    uuid;
  v_s0      uuid[];
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
  elsif v_choice = 'rejoin' then
    -- Volver con la identidad de siempre (ADR-041): ni participante ni nombre.
    null;
  elsif v_choice = 'new' then
    -- El nombre REAL del perfil, o el que la persona escribio: nunca el correo.
    v_name := sec.canonical_display_name(payload ->> 'display_name');
  else
    perform sec.raise_boundary('PAYLOAD_INVALID', 'choice es claim, new o rejoin', 400);
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
  -- SALIO CON VINCULO (ADR-034) Y VUELVE (ADR-041): la identidad es la del
  -- vinculo, que se conserva al salir; ni participante nuevo ni reclamacion.
  -- Se abre un periodo de presencia desde HOY —los anteriores y el hueco de
  -- ausencia quedan como estaban: sin reparto retroactivo— y la membresia.
  -- Ninguna operacion, ninguna caja, ninguna novacion se toca: lo que la
  -- salida reasigno sigue reasignado, y lo que un pago anulado reabrio deja
  -- de leerse por la excepcion C6 (ya hay membresia) y pasa a leerse como
  -- miembro, una sola vez.
  -- F10/ADR-001 §1: volver NO crea instancia. El link_id, la linea base y el
  -- S0 son los de la instancia que nunca termino.
  select l.participant_id into v_mine
    from core.participant_user_link l
   where l.scope_id = v_inv.scope_id and l.user_id = v_actor;
  if v_mine is not null then
    if v_choice <> 'rejoin' then
      perform sec.raise_boundary('REJOIN_REQUIRED',
        'ya estuviste en este grupo: vuelve a entrar con tu identidad de entonces', 409);
    end if;
    -- Retirados: politica aparte (ADR-036), que exige SIN cuenta; una identidad
    -- con vinculo no puede estar retirada, asi que aqui no hay nada que mirar.
    insert into core.membership (scope_id, user_id) values (v_inv.scope_id, v_actor);
    -- El periodo es de grano DIA (ADR-012): si salio hoy mismo, el periodo de
    -- hoy quedo cerrado en hoy (vacio) y se vuelve a abrir; si no, uno nuevo
    -- desde hoy. Los anteriores no se tocan.
    update core.participant_period set valid_until = null
     where participant_id = v_mine and valid_from = current_date and valid_until is not null;
    if not found and not exists (select 1 from core.participant_period pp where pp.participant_id = v_mine and pp.valid_until is null) then
      insert into core.participant_period (participant_id, valid_from, valid_until) values (v_mine, current_date, null);
    end if;
    return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'participant_id', v_mine,
                              'rejoined', true, 'already_processed', false);
  end if;
  if v_choice = 'rejoin' then
    perform sec.raise_boundary('REJOIN_NOT_AVAILABLE', 'no estuviste en este grupo', 409);
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
    --      LA PROCEDENCIA (F10/ADR-001 §1): el comando de ESTA reclamacion es el
    --      origen de la instancia.
    begin
      insert into core.participant_user_link (participant_id, scope_id, user_id, origin_command_id)
      values (v_target, v_inv.scope_id, v_actor, v_command)
      returning link_id into v_link;
    exception when unique_violation then
      perform sec.raise_boundary('PARTICIPANT_ALREADY_CLAIMED', 'otra cuenta acaba de reclamar ese participante', 409);
    end;
    -- 4a · S0 y LINEA BASE (F10/ADR-001 §2.1, §3), bajo el rango 1 ya tomado:
    --      S0 = P mas TODO origen que hoy resuelve hacia P (cierre transitivo,
    --      crudos); la base, la version vigente de cada operacion del grupo que
    --      atribuye algo a alguno de ellos. Un reclamante hereda lo que el
    --      participante ya era.
    v_s0 := sec.instance_subjects(v_target);
    insert into core.link_baseline_subject (link_id, participant_id)
    select v_link, unnest(v_s0);
    insert into core.link_baseline (link_id, operation_id, baseline_version_id)
    select v_link, b.operation_id, b.baseline_version_id
      from sec.link_baseline_rows(v_inv.scope_id, v_s0) b;
    return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'participant_id', v_target, 'already_processed', false);
  end if;

  -- 2b · nuevo: identidad contextual con el nombre real, presencia desde HOY
  --      —sin reparto retroactivo: los gastos anteriores no lo nombran—, y el
  --      vinculo. Origen = este comando; S0 = {P}; linea base vacia por
  --      construccion (F10/ADR-001 §3).
  if v_name is null or v_name = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'hace falta un nombre para entrar como nuevo', 400);
  end if;
  v_new := gen_random_uuid();
  insert into core.participant (id, scope_id, display_name) values (v_new, v_inv.scope_id, v_name);
  insert into core.participant_period (participant_id, valid_from, valid_until) values (v_new, current_date, null);
  insert into core.participant_user_link (participant_id, scope_id, user_id, origin_command_id)
  values (v_new, v_inv.scope_id, v_actor, v_command)
  returning link_id into v_link;
  insert into core.link_baseline_subject (link_id, participant_id) values (v_link, v_new);
  return jsonb_build_object('state', 'ok', 'scope_id', v_inv.scope_id, 'participant_id', v_new, 'already_processed', false);
end
$function$;

-- Con la columna caen su CHECK (participant_user_link_claim_es_origen) y su FK
-- (participant_user_link_procedencia). origin_command_id y su FK se quedan.
alter table core.participant_user_link drop column claim_command_id;
