-- ============================================================================
-- VOLVER A ENTRAR TRAS SALIR (ADR-041): LA MISMA IDENTIDAD, OTRO PERIODO
-- ============================================================================
--
-- Decision de producto (2026-09-14): quien salio voluntariamente puede volver
-- mientras el enlace o QR sea valido y el grupo admita incorporaciones. Se
-- reutiliza el flujo de invitacion: la cuenta se reconoce por su vinculo (que
-- la salida conserva, ADR-034) y recupera su participante canonico; se abre
-- un periodo de presencia desde hoy y la membresia. Nada mas cambia: ni
-- gastos, ni pagos, ni anulaciones, ni fusiones (ADR-040), ni novaciones de
-- salida (ADR-038 C8), ni caja. Los retirados (ADR-036) son otra politica y
-- no pasan por aqui.
--
--   §1  api.preview_invitation: estado 'rejoin' con la identidad anterior
--   §2  api.redeem_invitation: choice 'rejoin'; con vinculo, cualquier otra
--       eleccion se rehusa (REJOIN_REQUIRED); sin vinculo, 'rejoin' se rehusa
--       (REJOIN_NOT_AVAILABLE). Ya miembro: como antes, nada nuevo.
--   §3  api.group_profile: participant_count sin origenes fusionados
--
-- Evidencia: supabase/checks/rejoin-after-departure.sql (aislado) y
-- scripts/rejoin-race-evidence.sh (dos sesiones).

-- ═══════════════════════ §1 · previsualizar ══════════════════════════════════

CREATE OR REPLACE FUNCTION api.preview_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_inv   record;
  v_state text;
  v_name  text;
  v_emoji text;
  v_prev_id uuid;
  v_prev_name text;
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
    -- Salio con vinculo: puede volver con su identidad de siempre (ADR-041).
    -- La identidad es la del vinculo, que es siempre la canonica (un destino
    -- de fusion, nunca un origen).
    v_state := 'rejoin';
    select l.participant_id, p.display_name into v_prev_id, v_prev_name
      from core.participant_user_link l join core.participant p on p.id = l.participant_id
     where l.scope_id = v_inv.scope_id and l.user_id = v_actor;
  else
    v_state := 'join';
  end if;

  return jsonb_build_object(
    'state', v_state,
    'display_name', v_name,
    'emoji', v_emoji,
    'scope_id', case when v_state = 'member' then v_inv.scope_id end,
    'previous_participant', case when v_state = 'rejoin'
      then jsonb_build_object('participant_id', v_prev_id, 'display_name', v_prev_name) end,
    'participants', case when v_state = 'join' then coalesce((
      select jsonb_agg(jsonb_build_object('participant_id', p.id, 'display_name', p.display_name)
                       order by p.created_at, p.id)
        from core.participant p
       where p.scope_id = v_inv.scope_id and sec.participant_available(p.id, v_inv.scope_id)
    ), '[]'::jsonb) else '[]'::jsonb end);
end
$function$;

-- ═══════════════════════ §2 · canjear ═══════════════════════════════════════
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

-- ═══════════════════════ §3 · participantes del grupo, sin origenes ══════════
-- Medido en «Prueba» (2026-09-14): la tarjeta decia 3 participantes con dos
-- identidades vigentes, porque contaba al origen fusionado (ADR-040). Misma
-- lista de columnas.
create or replace view api.group_profile with (security_invoker = true) as
select g.scope_id,
       g.display_name,
       g.emoji,
       s.base_currency_definition_id,
       c.code as currency_code,
       c.scale as currency_scale,
       (select count(*) from core.participant p
         where p.scope_id = g.scope_id
           and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
           and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id))::integer as participant_count,
       g.created_at,
       g.updated_at,
       g.default_category_id,
       (select max(o.created_at)
          from core.current_effect e
          join core.operation_version ov on ov.id = e.operation_version_id
          join core.operation o on o.id = ov.operation_id
         where e.scope_id = g.scope_id) as last_activity_at
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id;
