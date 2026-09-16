-- ============================================================================
-- VINCULO ACTIVO Y VINCULO HISTORICO · F10/ADR-003 — bloque F10.A3
-- ============================================================================
--
-- Decision de producto (F10/ADR-003, Aceptado): al salir de un grupo, la
-- identidad de la cuenta en ese grupo deja de ser ACTIVA y pasa a ser
-- HISTORIA. El vinculo no se borra —sostiene el Personal de quien salio, la
-- atribucion de todo lo anterior y el `is_self` de su historia, y hace al
-- participante irreclamable e irretirable por otros (F10/ADR-002)— pero
-- TERMINA: `ended_at` y la salida que lo termino. Quien salio ya no figura
-- como participante actual: ni en Saldos, ni en el recuento, ni en las listas
-- del presente. Su historia y sus nombres siguen donde estaban.
--
-- Al volver con invitacion, quien ya estuvo elige: volver con su identidad de
-- entonces (el MISMO vinculo se reactiva; F10/ADR-001 §1, volver no crea
-- instancia) o entrar como un participante sin cuenta disponible (la identidad
-- anterior queda como historia). Lo que NO puede es entrar como nuevo. Quien
-- nunca estuvo sigue como en F9: participantes disponibles y «Soy nuevo».
--
-- Un participante SALIDO no es un participante SIN CUENTA: el primero es
-- historia (invisible en el presente, irreclamable, irretirable); el segundo
-- es activo, visible y reclamable. Nada de esto toca la economia de F9: las
-- condiciones de salida (neto cero), la novacion, las guardas, la obligacion
-- de quien salio (F09/ADR-008), core.group_departure y los pagos siguen tal
-- cual.
--
-- Esta migracion parte del estado que dejo 20260917120000 (F10/ADR-002).
--
--   §0  el vinculo: ended_at + departure_id, CHECK de coherencia, FK a la
--       salida; la unicidad (scope_id, user_id) pasa a ser PARCIAL sobre los
--       activos —una sola identidad activa por cuenta y grupo; las historicas
--       no cuentan—; el provisioner puede terminar y reactivar SOLO el propio;
--       la policy de borrado del provisioner, huerfana desde 20260917120000, se
--       retira (nada borra un vinculo).
--   §1  relleno: los vinculos de quien ya salio (sin membresia, sin periodo
--       abierto, con salida registrada) quedan terminados por su ultima salida.
--   §2  sec.participant_link_ended: la ayuda definer que las vistas usan para
--       saber si una identidad es historia (acotada a miembros, como is_linked).
--   §3  api.group_participant publica is_departed; api.group_balance, la foto
--       de netos del pago (sec.group_positions_text) y el participant_count de
--       api.group_profile dejan fuera a las historicas.
--   §4  api.leave_group termina el vinculo activo; api.preview_invitation y
--       api.redeem_invitation ofrecen volver O reclamar a quien ya estuvo, y
--       rehusan «nuevo»; api.associate_participant asocia a la identidad ACTIVA.
--   §5  api.group_payment publica effective_time (la cronologia unica de
--       Movimientos ordena gastos y pagos por fecha y hora reales).
--
-- Lo que NO cambia: sec.is_my_participant, sec.participant_personal_scope,
-- api.claimed_dimension y todas las lecturas de atribucion e historia (vinculo
-- activo O historico: la historia sigue siendo de quien la hizo);
-- sec.participant_available (un vinculo terminado sigue siendo un vinculo);
-- api.retire_participant (rehusa cualquier vinculo); sec.my_reopened_debt
-- (por membresia, como en F09/ADR-010); las novaciones y guardas de F9.
-- ============================================================================

-- ═══════════════════════ §0 · el vinculo: activo o historico ════════════════
alter table core.participant_user_link
  add column ended_at     timestamptz,
  add column departure_id uuid references core.group_departure (id),
  add constraint participant_user_link_fin_coherente
    check ((ended_at is null) = (departure_id is null));
comment on column core.participant_user_link.ended_at is
  'Nulo mientras la identidad esta ACTIVA. Al salir del grupo se pone el instante de la salida (F10/ADR-003 §1); al volver con esa identidad vuelve a nulo. Nunca se borra el vinculo.';
comment on column core.participant_user_link.departure_id is
  'La salida (core.group_departure) que termino el vinculo. Nula si y solo si ended_at es nula.';

-- Una salida termina a lo sumo un vinculo.
create unique index participant_user_link_salida_unica
  on core.participant_user_link (departure_id) where departure_id is not null;

-- UNA SOLA IDENTIDAD ACTIVA por cuenta y grupo. La unicidad total de
-- 20260825152805 impedia que quien salio como Aitor entrara despues como Ana:
-- pasa a ser parcial sobre los activos. La clave primaria (participant_id)
-- sigue diciendo que un participante tiene a lo sumo UN vinculo en toda su
-- vida: una identidad historica no puede volver a ser de nadie.
alter table core.participant_user_link
  drop constraint participant_user_link_usuario_unico_por_ambito;
create unique index participant_user_link_identidad_activa_unica
  on core.participant_user_link (scope_id, user_id) where ended_at is null;

-- El provisioner termina y reactiva SOLO el vinculo propio, y solo esas dos
-- columnas. El borrado no existe: la identidad es permanente (F10/ADR-002).
grant update (ended_at, departure_id) on core.participant_user_link to nomey_provisioner;
create policy participant_user_link_provisioner_self_end
  on core.participant_user_link for update to nomey_provisioner
  using (user_id = sec.request_actor_id())
  with check (user_id = sec.request_actor_id());
drop policy participant_user_link_provisioner_self_delete on core.participant_user_link;
revoke delete on core.participant_user_link from nomey_provisioner;

-- ═══════════════════════ §1 · relleno: quien ya salio ═══════════════════════
-- Un vinculo sin membresia, cuyo participante no tiene periodo abierto y con
-- salida registrada, es de alguien que salio: queda terminado por su ULTIMA
-- salida. Si no hay salida registrada (estados sembrados por comprobaciones),
-- no se inventa una: se deja activo, y ninguna funcion depende de que no lo
-- este.
update core.participant_user_link l
   set ended_at = d.left_at, departure_id = d.id
  from (select distinct on (gd.participant_id, gd.user_id) gd.participant_id, gd.user_id, gd.id, gd.left_at
          from core.group_departure gd
         where gd.participant_id is not null
         order by gd.participant_id, gd.user_id, gd.left_at desc) d
 where d.participant_id = l.participant_id and d.user_id = l.user_id
   and l.ended_at is null
   and not exists (select 1 from core.membership m where m.scope_id = l.scope_id and m.user_id = l.user_id)
   and not exists (select 1 from core.participant_period pp where pp.participant_id = l.participant_id and pp.valid_until is null);

-- ═══════════════════════ §2 · sec.participant_link_ended ════════════════════
-- ¿Es esta identidad HISTORIA (vinculo terminado)? Solo el hecho, nunca de
-- quien; acotada a miembros, como sec.participant_is_linked (20260912130000).
create function sec.participant_link_ended(p_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from core.participant p
      join core.participant_user_link l on l.participant_id = p.id
     where p.id = p_participant
       and l.ended_at is not null
       and sec.is_member(p.scope_id)
  );
$fn$;
revoke execute on function sec.participant_link_ended(uuid) from public;
grant execute on function sec.participant_link_ended(uuid) to authenticated;
comment on function sec.participant_link_ended(uuid) is
  'F10/ADR-003: si el participante es una identidad historica (su cuenta salio del grupo y el vinculo termino). Solo para miembros del ambito; nunca dice de que cuenta.';

-- ═══════════════════════ §3 · las vistas del presente ═══════════════════════
-- api.group_participant: la fila se CONSERVA —los movimientos anteriores
-- siguen nombrando a quien salio— y se marca is_departed. Columna nueva al
-- final; el resto identico a 20260917120000.
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
       (select m.target_participant_id from core.participant_merge m where m.source_participant_id = p.id) as merged_into_participant_id,
       sec.participant_link_ended(p.id) as is_departed
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr(is_active, eligible_until) on true
 where s.kind = 'group';

-- api.group_balance: Saldos es el presente. Quien salio no es una fila actual
-- (ni «Inactivo» ni nada): como los retirados y los origenes fusionados.
create or replace view api.group_balance with (security_invoker = true) as
select p.scope_id,
       p.id as participant_id,
       p.display_name,
       s.base_currency_definition_id as currency_definition_id,
       sec.is_my_participant(p.id) as is_self,
       (coalesce((select sum(e.debt_amount) from core.current_effect e
                   where e.scope_id = p.scope_id and e.debt_amount is not null and e.debt_creditor_participant_id = p.id), 0)
      - coalesce((select sum(e.debt_amount) from core.current_effect e
                   where e.scope_id = p.scope_id and e.debt_amount is not null and e.debt_debtor_participant_id = p.id), 0))::text as net_position
  from core.participant p
  join core.scope s on s.id = p.scope_id
 where s.kind = 'group'
   and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
   and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id)
   and not sec.participant_link_ended(p.id);

-- La foto de netos del pago (20260914160000) se compara sobre el MISMO
-- conjunto que api.group_balance publica: tambien sin las historicas. Su neto
-- es cero por construccion al salir (F09/ADR-007 C8) y, si un pago anulado se
-- lo reabre (C6), la suma del ambito sigue siendo cero y la foto lo detecta en
-- alguna visible, como con retirados y origenes.
create or replace function sec.group_positions_text(p_scope uuid)
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
   where p.scope_id = p_scope
     -- Las MISMAS exclusiones que api.group_balance (20260911120000, 20260914130000 §5, F10/ADR-003).
     and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
     and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id)
     and not exists (select 1 from core.participant_user_link l where l.participant_id = p.id and l.ended_at is not null);
$fn$;
comment on function sec.group_positions_text(uuid) is
  'Los netos del grupo en texto canonico, sobre los participantes que api.group_balance publica (ni retirados, ni origenes fusionados, ni identidades historicas de quien salio): lo que el cliente manda como expected_positions y lo que record_group_payment compara bajo cerrojo. Si la vista cambia su conjunto, esto cambia con ella.';

-- api.group_profile.participant_count: los del presente.
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
           and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id)
           and not sec.participant_link_ended(p.id))::integer as participant_count,
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

-- ═══════════════════════ §4 · salir, previsualizar, canjear, asociar ════════
create or replace function api.leave_group(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  -- 1 · la identidad ACTIVA del actor en este grupo, si la hay (F10/ADR-003:
  --     un vinculo terminado es historia, y un miembro tiene a lo sumo uno
  --     activo por el indice parcial).
  select l.participant_id into v_participant
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = v_scope and l.ended_at is null
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

  -- 3b · EL VINCULO TERMINA (F10/ADR-003 §1): deja de ser la identidad activa
  --     y pasa a ser historia, con la salida que lo termino. No se borra: sigue
  --     sosteniendo el Personal, la atribucion y el `is_self` de lo anterior
  --     (F09/ADR-003 §8, F03/ADR-013), y sigue haciendo al participante
  --     irreclamable e irretirable por otros (F10/ADR-002).
  if v_participant is not null then
    update core.participant_user_link l
       set ended_at = d.left_at, departure_id = d.id
      from core.group_departure d
     where d.id = v_departure and l.participant_id = v_participant and l.user_id = v_actor;
  end if;

  -- 4 · y AL FINAL, la membresia. Ni un efecto, ni una operacion, ni una fila
  --     bloqueada: solo el cerrojo de identidad.
  delete from core.membership where scope_id = v_scope and user_id = v_actor;

  return jsonb_build_object('scope_id', v_scope, 'already_processed', false);
end
$function$;

create or replace function api.preview_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  else
    -- YA ESTUVO (F10/ADR-003 §2): su identidad mas reciente, la del vinculo
    -- que termino al salir. Puede volver con ella O elegir un participante sin
    -- cuenta; lo que NO puede es entrar como nuevo. La identidad es la del
    -- vinculo, que es siempre la canonica (un destino de fusion, nunca un
    -- origen). Con mas de una salida se ofrece la ultima.
    select l.participant_id, p.display_name into v_prev_id, v_prev_name
      from core.participant_user_link l join core.participant p on p.id = l.participant_id
     where l.scope_id = v_inv.scope_id and l.user_id = v_actor and l.ended_at is not null
     order by l.ended_at desc
     limit 1;
    v_state := case when v_prev_id is null then 'join' else 'rejoin' end;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'display_name', v_name,
    'emoji', v_emoji,
    'scope_id', case when v_state = 'member' then v_inv.scope_id end,
    'previous_participant', case when v_state = 'rejoin'
      then jsonb_build_object('participant_id', v_prev_id, 'display_name', v_prev_name) end,
    -- Los participantes sin cuenta disponibles, tanto para quien nunca estuvo
    -- como para quien ya estuvo (F10/ADR-003 §2). Nunca una identidad
    -- historica: un vinculo terminado sigue siendo un vinculo, y
    -- participant_available exige que no haya ninguno.
    'participants', case when v_state in ('join', 'rejoin') then coalesce((
      select jsonb_agg(jsonb_build_object('participant_id', p.id, 'display_name', p.display_name)
                       order by p.created_at, p.id)
        from core.participant p
       where p.scope_id = v_inv.scope_id and sec.participant_available(p.id, v_inv.scope_id)
    ), '[]'::jsonb) else '[]'::jsonb end);
end
$function$;

create or replace function api.redeem_invitation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  -- YA ESTUVO (F10/ADR-003 §2): su vinculo mas reciente TERMINO al salir
  -- (F09/ADR-003 conserva el vinculo; F10/ADR-003 lo termina sin borrarlo).
  -- Tres caminos, y solo tres:
  --   rejoin · vuelve con esa identidad: el MISMO vinculo se reactiva (mismo
  --            link_id, misma procedencia, misma linea base: F10/ADR-001 §1,
  --            volver no crea instancia), se abre un periodo desde HOY y la
  --            membresia. Lo que la salida novo sigue novado; C6 se lee una
  --            sola vez (F09/ADR-010).
  --   claim  · elige un participante sin cuenta: sigue abajo como cualquier
  --            reclamacion. La identidad anterior queda como historia: su
  --            vinculo terminado la hace irreclamable e irretirable por
  --            otros, y sostiene todo lo que fue suyo.
  --   new    · NO: quien ya estuvo no entra como nuevo (REJOIN_REQUIRED).
  -- Una sola identidad activa por cuenta y grupo (indice parcial): la
  -- reactivacion y la reclamacion son excluyentes por construccion.
  select l.participant_id into v_mine
    from core.participant_user_link l
   where l.scope_id = v_inv.scope_id and l.user_id = v_actor and l.ended_at is not null
   order by l.ended_at desc
   limit 1;
  if v_mine is not null and v_choice = 'new' then
    perform sec.raise_boundary('REJOIN_REQUIRED',
      'ya estuviste en este grupo: vuelve con tu identidad de entonces o elige un participante sin cuenta', 409);
  end if;
  if v_mine is not null and v_choice = 'rejoin' then
    -- Retirados: politica aparte (ADR-036), que exige SIN cuenta; una identidad
    -- con vinculo no puede estar retirada, asi que aqui no hay nada que mirar.
    update core.participant_user_link
       set ended_at = null, departure_id = null
     where participant_id = v_mine and user_id = v_actor;
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

create or replace function api.associate_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'scope_id', 'participant_id'];
  v_actor   uuid;
  v_command uuid;
  v_version integer;
  v_scope   uuid;
  v_source  uuid;
  v_target  uuid;
  v_intent  jsonb;
  v_stored  jsonb;
  v_replay  boolean := false;
  v_cash    integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  v_source  := (payload ->> 'participant_id')::uuid;
  if v_command is null or v_version is null or v_scope is null or v_source is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version, scope_id y participant_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_intent := jsonb_build_object('scope_id', v_scope, 'participant_id', v_source);

  -- 0 · LA CLAVE, antes de autorizar y antes del cerrojo (ADR-033, ADR-010 §5).
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.associate', v_version, v_intent, v_scope);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT', 'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);
    end if;
    select m.target_participant_id into v_target from core.participant_merge m where m.source_participant_id = v_source;
    return jsonb_build_object('scope_id', v_scope, 'participant_id', v_source, 'target_participant_id', v_target, 'already_processed', true);
  end if;

  -- 1 · EL CERROJO DE IDENTIDAD DEL GRUPO (rango 1). Todo lo que sigue se lee
  --     bajo el: otra asociacion, una reclamacion, una retirada o una salida
  --     concurrentes ya se serializaron.
  perform sec.lock_participant_claims(v_scope);
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  -- 2 · EL DESTINO es mi identidad ACTIVA en el grupo (F10/ADR-003: nunca una
  --     historica, que ya no es de nadie en el presente); sin ella no hay a
  --     que asociar.
  select l.participant_id into v_target
    from core.participant_user_link l
   where l.scope_id = v_scope and l.user_id = v_actor and l.ended_at is null;
  if v_target is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no tienes identidad en este grupo', 403);
  end if;
  if v_source = v_target then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'ese participante ya es tu identidad', 400);
  end if;

  -- 3 · EL ORIGEN: del grupo, sin cuenta, no retirado, no fusionado, no salido.
  if not exists (select 1 from core.participant p where p.id = v_source and p.scope_id = v_scope) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'ese participante no es de este grupo', 422);
  end if;
  -- El vinculo de OTRA cuenta no lo lee el provisioner (su policy es la
  -- propia): lo resuelve la ayuda definer, como en las vistas.
  if sec.participant_is_linked(v_source) then
    perform sec.raise_boundary('PARTICIPANT_LINKED', 'ese participante ya tiene cuenta', 409);
  end if;
  if exists (select 1 from core.participant_merge m where m.source_participant_id = v_source or m.target_participant_id = v_source) then
    perform sec.raise_boundary('PARTICIPANT_MERGED', 'ese participante ya esta asociado a una cuenta', 409);
  end if;
  -- Sin vinculo ni fusion, lo unico que cierra el periodo de un participante
  -- es la retirada (nadie sin cuenta sale): la ayuda definer de siempre lo
  -- resuelve (el provisioner no lee core.participant_retirement).
  if not sec.participant_available(v_source, v_scope) then
    perform sec.raise_boundary('PARTICIPANT_RETIRED', 'ese participante esta retirado', 409);
  end if;

  -- 4 · EL HECHO, y despues la caja historica (writer, rango 2), atomica con el.
  insert into core.participant_merge (source_participant_id, target_participant_id, scope_id, merged_by, client_command_id)
  values (v_source, v_target, v_scope, v_actor, v_command);
  v_cash := sec.incorporate_participant_cash(v_scope, v_source);

  return jsonb_build_object('scope_id', v_scope, 'participant_id', v_source, 'target_participant_id', v_target,
                            'incorporated_versions', v_cash, 'already_processed', false);
end
$function$;

-- ═══════════════════════ §5 · api.group_payment con hora ════════════════════
-- Movimientos es UNA cronologia: gastos y pagos («Saldado») por fecha y hora
-- reales de la operacion, con el desempate estable de siempre. La hora ya
-- estaba en la version (F06/ADR-002 §3); faltaba publicarla. Columna nueva al
-- final; el resto identico a 20260912170000.
create or replace view api.group_payment with (security_invoker = true) as
select o.id as operation_id,
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
       o.created_at as operation_created_at,
       ov.effective_time
  from core.operation o
  join core.operation_version cur on cur.id = o.current_version_id
  join lateral (select ov.* from core.operation_version ov where ov.operation_id = o.id and ov.version_kind = 'record' order by ov.version_no desc limit 1) ov on true
  join core.payment_detail pd on pd.operation_version_id = ov.id
 where o.operation_class = 'group_payment';
