-- ============================================================================
-- DEJAR UNA INSTANCIA PROPIA DE VINCULO: EVALUADOR, UNLINK, HECHO, AVISO
-- F10/ADR-001 §2, §4–§10, §12, §14 — bloque F10.A2 (backend completo)
-- ============================================================================
--
--   §1  sec.instance_subjects: los participantes crudos que resuelven hacia P
--       (cierre transitivo sobre core.participant_merge). Es S_now al evaluar
--       y S0 al nacer una instancia.
--   §2  sec.unlink_blocking_attribution: el evaluador economico del ADR §2.
--       Ids crudos, cantidades firmadas, base congelada frente a estado
--       vigente; capa necesaria (cur > base en eco/owes) y politica v1
--       (identidad nueva). Sin abs(), sin neto, sin canonico, sin reloj.
--   §3  core.participant_unlink: grants y policies minimos (el titular escribe
--       su hecho; el cliente lee tres columnas por membresia, para el aviso).
--   §4  identity_released: kind nuevo, PERSISTIDO y OCULTO al cliente vigente
--       (api.group_notice y mark_group_notices_seen lo filtran hasta A3).
--   §5  sec.unlink_instance: LA implementacion autoritativa (una sola).
--   §6  api.unlink_participant: la API nueva (payload con link_id).
--   §7  api.unclaim_participant: WRAPPER temporal, misma firma, que delega en
--       §5 con la MISMA clave del cliente; claim_command_id es solo el origen.
--   §8  api.redeem_invitation: S0 por cierre transitivo (§1).
--   §9  api.group_participant publica link_id en la fila propia.
--   §10 core.participant_unclaim se retira (fail-closed si tuviera filas).
--
-- QUEDA SOLO POR COMPATIBILIDAD hasta A3 (cliente y tipos generados), y se
-- retira entonces: api.unclaim_participant (wrapper), sec.my_claim_command_id,
-- la columna participant_user_link.claim_command_id con su CHECK, y el filtro
-- de identity_released en api.group_notice / mark_group_notices_seen.
-- ============================================================================

-- ═══════════════════════ §1 · los sujetos de una identidad ══════════════════
-- Hoy api.associate_participant rehusa un origen que ya sea destino o fuente,
-- asi que ninguna cadena A → B → P puede nacer por la via autoritativa; pero
-- el esquema no lo impone (no hay constraint) y sec.canonical_participant es
-- de un salto. La atribucion historica de un origen no puede perderse por una
-- fusion transitiva, asi que los sujetos se calculan por CIERRE, y un check
-- afirma que hoy no existe ninguna cadena.
create function sec.instance_subjects(p_participant uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  with recursive s as (
    select p_participant as id
    union
    select m.source_participant_id
      from core.participant_merge m
      join s on m.target_participant_id = s.id)
  select array_agg(id) from s;
$fn$;
revoke execute on function sec.instance_subjects(uuid) from public;
grant execute on function sec.instance_subjects(uuid) to nomey_provisioner;

-- ═══════════════════════ §2 · el evaluador economico ═════════════════════════
-- ADR §2.1–§2.3. Para la instancia L = (P, G, U):
--   S0    = core.link_baseline_subject de L (congelado al nacer)
--   S_now = sec.instance_subjects(P)         (S0 ⊆ S_now: las fusiones son insert-only)
--   base  = atribucion de S0 en cada baseline_version_id de L
--   cur   = atribucion de S_now en la version VIGENTE de cada operacion de G
--           que nombra a algun sujeto de S_now
-- Identidades por efecto, con ids CRUDOS: eco (participante economico ∈ S),
-- owes:<acreedor> (deudor ∈ S), owed:<deudor> (acreedor ∈ S). Cantidades
-- firmadas sumadas por (operacion, identidad); ausente = 0.
--   necesaria: identidad eco u owes con cur > base            → 'attribution'
--   politica v1: cualquier identidad con base = 0 y cur <> 0  → 'policy'
-- Un owed presente en la base puede crecer. Nada por neto, nada por abs().
-- Definer de postgres: lee core.effect por version, cruzando RLS como
-- api.claimed_dimension(); solo el provisioner lo ejecuta.
create function sec.unlink_blocking_attribution(p_link uuid)
returns table (operation_id uuid, operation_class text, concept text, amount text, effective_date date, reason text)
language sql
stable
security definer
set search_path = ''
as $fn$
  with l as (
    select l.participant_id, l.scope_id from core.participant_user_link l where l.link_id = p_link),
  s0 as (
    select s.participant_id from core.link_baseline_subject s where s.link_id = p_link),
  snow as (
    select unnest(sec.instance_subjects((select participant_id from l))) as participant_id),
  base as (
    select b.operation_id as op, k.key, sum(k.q) as q
      from core.link_baseline b
      join core.effect e on e.operation_version_id = b.baseline_version_id
      cross join lateral (
        select 'eco'::text as key, e.economic_amount as q
         where e.economic_participant_id in (select participant_id from s0)
        union all
        select 'owes:' || e.debt_creditor_participant_id, e.debt_amount
         where e.debt_debtor_participant_id in (select participant_id from s0)
        union all
        select 'owed:' || e.debt_debtor_participant_id, e.debt_amount
         where e.debt_creditor_participant_id in (select participant_id from s0)) k
     where b.link_id = p_link
       and e.scope_id = (select scope_id from l)
     group by 1, 2),
  cur as (
    select o.id as op, k.key, sum(k.q) as q
      from core.operation o
      join core.effect e on e.operation_version_id = o.current_version_id
      cross join lateral (
        select 'eco'::text as key, e.economic_amount as q
         where e.economic_participant_id in (select participant_id from snow)
        union all
        select 'owes:' || e.debt_creditor_participant_id, e.debt_amount
         where e.debt_debtor_participant_id in (select participant_id from snow)
        union all
        select 'owed:' || e.debt_debtor_participant_id, e.debt_amount
         where e.debt_creditor_participant_id in (select participant_id from snow)) k
     where e.scope_id = (select scope_id from l)
     group by 1, 2),
  verdict as (
    select coalesce(c.op, b.op) as op,
           bool_or(coalesce(c.key, b.key) not like 'owed:%' and coalesce(c.q, 0) > coalesce(b.q, 0)) as necessary,
           bool_or(coalesce(b.q, 0) = 0 and coalesce(c.q, 0) <> 0) as policy
      from cur c
      full outer join base b on b.op = c.op and b.key = c.key
     group by 1
    having bool_or(coalesce(c.key, b.key) not like 'owed:%' and coalesce(c.q, 0) > coalesce(b.q, 0))
        or bool_or(coalesce(b.q, 0) = 0 and coalesce(c.q, 0) <> 0))
  select v.op,
         o.operation_class,
         (select d.concept from core.movement_detail d where d.operation_version_id = o.current_version_id),
         ov.original_amount::text,
         ov.effective_date,
         case when v.necessary then 'attribution' else 'policy' end
    from verdict v
    join core.operation o on o.id = v.op
    join core.operation_version ov on ov.id = o.current_version_id
   order by ov.effective_date desc, v.op;
$fn$;
revoke execute on function sec.unlink_blocking_attribution(uuid) from public;
grant execute on function sec.unlink_blocking_attribution(uuid) to nomey_provisioner;

-- ═══════════════════════ §3 · el hecho de baja: quien lo escribe y quien lo lee
-- El titular (provisioner, bajo RLS) escribe SU hecho: user_id y unlinked_by
-- son el actor (ADR §7, §8). Lo lee de vuelta solo para el replay. El cliente
-- lee TRES columnas por membresia —lo justo para que el aviso resuelva al
-- participante—; user_id, unlinked_by, origin_command_id y client_command_id
-- no salen por ninguna via.
grant insert, select on core.participant_unlink to nomey_provisioner;
create policy participant_unlink_provisioner_insert on core.participant_unlink
  for insert to nomey_provisioner
  with check (user_id = sec.request_actor_id() and unlinked_by = sec.request_actor_id());
create policy participant_unlink_provisioner_select on core.participant_unlink
  for select to nomey_provisioner
  using (user_id = sec.request_actor_id());
grant select (id, participant_id, scope_id) on core.participant_unlink to authenticated;
create policy participant_unlink_client_select on core.participant_unlink
  for select to authenticated
  using (sec.is_member(scope_id));

-- ═══════════════════════ §4 · identity_released, persistido y oculto ═════════
-- ADR §10: kind propio, a los miembros que quedan, subject = el hecho. El
-- cliente vigente indexa un mapa por kind y pintaria una linea vacia con uno
-- desconocido, asi que HASTA A3 el kind existe en core y NO cruza api: ni la
-- vista lo lista ni «visto» lo marca (asi A3 lo encontrara sin leer).
alter table core.group_notice drop constraint group_notice_kind_check;
alter table core.group_notice add constraint group_notice_kind_check
  check (kind = any (array['edit', 'profile', 'departure', 'settlement', 'payment', 'payment_annulled', 'identity_released']));

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
         when 'identity_released' then (select u.participant_id from core.participant_unlink u where u.id = n.subject_id)
         else null::uuid
       end as participant_id,
       case n.kind
         when 'departure' then (select p.display_name from core.group_departure d join core.participant p on p.id = d.participant_id where d.id = n.subject_id)
         when 'settlement' then (select p.display_name from core.participant_retirement r join core.participant p on p.id = r.participant_id where r.client_command_id = n.subject_id)
         when 'payment' then sec.payment_counterpart_name(n.subject_id)
         when 'payment_annulled' then sec.payment_counterpart_name(n.subject_id)
         when 'identity_released' then (select p.display_name from core.participant_unlink u join core.participant p on p.id = u.participant_id where u.id = n.subject_id)
         else null::text
       end as participant_display_name
  from core.group_notice n
 -- COMPATIBILIDAD hasta A3: el cliente vigente no sabe representar este kind.
 where n.kind <> 'identity_released';

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
       -- COMPATIBILIDAD hasta A3: lo que el cliente no ve no se da por visto.
       and n.kind <> 'identity_released'
    returning 1
  )
  select count(*)::integer from done;
$function$;

-- ═══════════════════════ §5 · la implementacion autoritativa ═════════════════
-- Una sola. api.unlink_participant (§6) y el wrapper api.unclaim_participant
-- (§7) delegan aqui. Orden (ADR §9): clave (0) → replay → cerrojo (1) →
-- membresia → vinculo PROPIO con ese link_id (LINK_SUPERSEDED uniforme) →
-- atribucion → caja → hecho → avisos → borrado del vinculo y de la membresia,
-- esta al final porque las policies del provisioner pasan por is_member.
-- Sin rango 2: no se escribe ninguna fila de ambito ni ningun efecto.
--
-- p_legacy: solo lo pasa el wrapper (§7). Cambia UNICAMENTE el nombre de dos
-- codigos en el punto donde se rehusa —LINK_SUPERSEDED → CLAIM_SUPERSEDED y
-- UNLINK_BLOCKED_CASH → UNCLAIM_BLOCKED_CASH, los que el cliente vigente
-- conoce—: ninguna lectura, ninguna escritura y ningun manejador de
-- excepciones distintos. El unico handler es el de la clave (F03/ADR-008 §13).
create function sec.unlink_instance(
  p_actor uuid, p_command uuid, p_contract integer,
  p_scope uuid, p_participant uuid, p_link uuid, p_legacy boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
  v_fact     core.participant_unlink%rowtype;
  v_link     core.participant_user_link%rowtype;
  v_blocking jsonb;
begin
  v_intent := jsonb_build_object('scope_id', p_scope, 'participant_id', p_participant, 'link_id', p_link);

  -- 0 · LA CLAVE, antes de autorizar y antes del cerrojo (F09/ADR-002).
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (p_actor, p_command, 'participant.unlink', p_contract, v_intent, p_scope);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored
      from core.provisioning_command pc
     where pc.created_by = p_actor and pc.client_command_id = p_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT', 'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);
    end if;
    -- El resultado original: el hecho que ese comando dejo. Ni se lee ni se
    -- toca la instancia que pueda existir ahora (puede ser de otra cuenta).
    select * into v_fact from core.participant_unlink u
     where u.user_id = p_actor and u.client_command_id = p_command;
    return jsonb_build_object('scope_id', p_scope, 'participant_id', p_participant, 'link_id', p_link,
                              'unlink_id', v_fact.id, 'already_processed', true);
  end if;

  -- 1 · EL CERROJO DE IDENTIDAD DEL GRUPO. Todo lo que sigue se lee bajo el.
  perform sec.lock_participant_claims(p_scope);

  -- 2 · AUTORIZACION: miembro vigente. Quien salio conserva su vinculo y no
  --     puede dejarlo (sostiene su Personal y su reincorporacion, ADR §5):
  --     NOT_AUTHORIZED. Sin membresia y sin vinculo propio en el grupo —la
  --     instancia ya termino, o nunca existio— la respuesta es la uniforme de
  --     §8/§9 (segunda baja con clave distinta): LINK_SUPERSEDED. Solo se
  --     consulta el vinculo PROPIO: ninguna de las dos ramas revela nada.
  if not sec.is_member(p_scope) then
    if exists (select 1 from core.participant_user_link l where l.scope_id = p_scope and l.user_id = p_actor) then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
    end if;
    perform sec.raise_boundary(case when p_legacy then 'CLAIM_SUPERSEDED' else 'LINK_SUPERSEDED' end,
      'esa instancia de vinculo no es la tuya vigente en este grupo', 409);
  end if;
  perform sec.assert_scope_kind(p_scope, 'group');

  -- 3 · EL VINCULO PROPIO con exactamente ese link_id. Inexistente, ajeno o
  --     sustituido responden LO MISMO, y nada se escribe (ADR §1, §8).
  select * into v_link from core.participant_user_link l
   where l.scope_id = p_scope and l.user_id = p_actor
     and l.participant_id = p_participant and l.link_id = p_link;
  if v_link.link_id is null then
    perform sec.raise_boundary(case when p_legacy then 'CLAIM_SUPERSEDED' else 'LINK_SUPERSEDED' end,
      'esa instancia de vinculo no es la tuya vigente en este grupo', 409);
  end if;

  -- 4 · LA REGLA ECONOMICA (ADR §2.2–§2.3), sobre la base congelada de la instancia.
  select jsonb_agg(jsonb_build_object(
           'operation_id', b.operation_id, 'operation_class', b.operation_class,
           'concept', b.concept, 'amount', b.amount, 'effective_date', b.effective_date::text,
           'reason', b.reason)
         order by b.effective_date desc, b.operation_id)
    into v_blocking
    from sec.unlink_blocking_attribution(p_link) b;
  if v_blocking is not null then
    perform sec.raise_boundary('UNLINK_BLOCKED_ATTRIBUTION',
      'hay actividad economica registrada bajo esta identidad que dejarla te permitiria eludir', 409,
      jsonb_build_object('operations', v_blocking));
  end if;

  -- 5 · LA CAJA (ADR §2.4): la misma guarda de F09/ADR-006, sin cambios.
  select jsonb_agg(jsonb_build_object(
           'operation_id', b.operation_id, 'operation_class', b.operation_class,
           'concept', b.concept, 'amount', b.amount, 'effective_date', b.effective_date::text)
         order by b.effective_date desc, b.operation_id)
    into v_blocking
    from sec.unclaim_blocking_operations(p_scope) b;
  if v_blocking is not null then
    perform sec.raise_boundary(case when p_legacy then 'UNCLAIM_BLOCKED_CASH' else 'UNLINK_BLOCKED_CASH' end,
      'hay dinero registrado en tu Personal como este participante en este grupo', 409,
      jsonb_build_object('operations', v_blocking));
  end if;

  -- 6 · EL HECHO (ADR §7), con la instancia exacta y su procedencia.
  insert into core.participant_unlink (
    link_id, participant_id, scope_id, user_id, unlinked_by, origin_command_id, reason, client_command_id)
  values (p_link, p_participant, p_scope, p_actor, p_actor, v_link.origin_command_id, 'self', p_command)
  returning * into v_fact;

  -- 7 · EL AVISO (ADR §10), a los que quedan y nunca al actor, ligado al
  --     hecho: replay retorna antes y un rechazo aborta la transaccion.
  insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
  select m.user_id, p_scope, 'identity_released', v_fact.id, p_actor
    from core.membership m
   where m.scope_id = p_scope and m.user_id <> p_actor
  on conflict (recipient_user_id, kind, subject_id) do nothing;

  -- 8 · LA BAJA (ADR §6): el vinculo propio y la membresia propia. Presencia,
  --     participante, hechos contables, fusiones y linea base, intactos.
  delete from core.participant_user_link where link_id = p_link and user_id = p_actor;
  delete from core.membership where scope_id = p_scope and user_id = p_actor;

  return jsonb_build_object('scope_id', p_scope, 'participant_id', p_participant, 'link_id', p_link,
                            'unlink_id', v_fact.id, 'already_processed', false);
end
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean) from public;

-- ═══════════════════════ §6 · api.unlink_participant ═════════════════════════
create function api.unlink_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id', 'participant_id', 'link_id'];
  v_actor   uuid;
  v_command uuid;
  v_version integer;
  v_scope   uuid;
  v_target  uuid;
  v_link    uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  v_target  := (payload ->> 'participant_id')::uuid;
  v_link    := (payload ->> 'link_id')::uuid;
  if v_command is null or v_version is null or v_scope is null or v_target is null or v_link is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version, scope_id, participant_id y link_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  return sec.unlink_instance(v_actor, v_command, v_version, v_scope, v_target, v_link, false);
end
$fn$;
grant create on schema api to nomey_provisioner;
alter function api.unlink_participant(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.unlink_participant(jsonb) from public;
grant execute on function api.unlink_participant(jsonb) to authenticated;

-- ═══════════════════════ §7 · api.unclaim_participant, wrapper temporal ══════
-- MISMA firma que F09/ADR-006 ({client_command_id, command_contract_version,
-- scope_id, participant_id, claim_command_id}); el cliente vigente no cambia.
-- Semantica: la de §5, sin excepciones. Dos comandos, dos columnas:
--   claim_command_id  = ORIGEN de la instancia (invitation.redeem/claim), la
--                       que el cliente leyo en su fila; nunca es la clave de
--                       la baja.
--   client_command_id = la clave de ESTA baja, la que el cliente conserva
--                       entre reintentos (use-membership.ts): es la que §5
--                       reclama como participant.unlink, asi que un retry no
--                       deja ningun comando adicional.
-- Replay: antes de resolver nada, el hecho que esa clave dejo (el vinculo ya
-- no existe tras el exito, y no se puede volver a resolver); con la misma
-- clave y otra intencion, IDEMPOTENCY_KEY_REUSED. Dos llamadas simultaneas
-- con la misma clave las serializa la propia clave en §5. Los codigos que el
-- cliente vigente conoce los nombra §5 en el punto donde rehusa (p_legacy):
-- aqui no hay ningun manejador de excepciones.
--
-- Colision con el contrato anterior: F09 reclamaba (actor, client_command_id)
-- como participant.unclaim en la misma transaccion que escribia
-- core.participant_unclaim; §10 rehusa aplicarse si esa relacion tiene filas,
-- y un intento rehusado no dejaba clave. Por construccion no queda ningun
-- comando participant.unclaim al llegar aqui, y §10 lo afirma.
create or replace function api.unclaim_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id', 'participant_id', 'claim_command_id'];
  v_actor   uuid;
  v_command uuid;
  v_version integer;
  v_scope   uuid;
  v_target  uuid;
  v_claim   uuid;
  v_fact    core.participant_unlink%rowtype;
  v_link    core.participant_user_link%rowtype;
  v_out     jsonb;
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

  -- Replay por la clave de la baja: el hecho que este comando dejo.
  select * into v_fact from core.participant_unlink u
   where u.user_id = v_actor and u.client_command_id = v_command;
  if v_fact.id is not null then
    if v_fact.scope_id <> v_scope or v_fact.participant_id <> v_target
       or v_fact.origin_command_id is distinct from v_claim then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);
    end if;
    return jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'already_processed', true);
  end if;

  -- El vinculo propio cuyo origen es ese comando, y que el origen fuera una
  -- reclamacion: los del creador y de «Soy nuevo» no entran por esta puerta
  -- (F09/ADR-006 §1; la nueva la abre A3 sobre api.unlink_participant).
  select * into v_link from core.participant_user_link l
   where l.scope_id = v_scope and l.user_id = v_actor and l.participant_id = v_target;
  if v_link.link_id is null or v_link.origin_command_id is distinct from v_claim then
    perform sec.raise_boundary('CLAIM_SUPERSEDED',
      'la reclamacion que se pide deshacer no es la que creo el vinculo actual', 409);
  end if;
  if not exists (select 1 from core.provisioning_command pc
                  where pc.created_by = v_actor and pc.client_command_id = v_claim
                    and pc.command_type = 'invitation.redeem' and pc.canonical_intent ->> 'choice' = 'claim') then
    perform sec.raise_boundary('UNCLAIM_NOT_AVAILABLE',
      'este vinculo no procede de una reclamacion rectificable', 409);
  end if;

  v_out := sec.unlink_instance(v_actor, v_command, v_version, v_scope, v_target, v_link.link_id, true);
  return jsonb_build_object('scope_id', v_scope, 'participant_id', v_target,
                            'already_processed', (v_out ->> 'already_processed')::boolean);
end
$fn$;

-- ═══════════════════════ §8 · S0 por cierre transitivo al reclamar ══════════
-- Recreada desde 20260915120000 con UN cambio: los sujetos de la instancia
-- salen de sec.instance_subjects (§1) en vez de un solo salto.
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
    --      origen de la instancia; claim_command_id lo repite solo por
    --      compatibilidad derivada hasta A3.
    begin
      insert into core.participant_user_link (participant_id, scope_id, user_id, claim_command_id, origin_command_id)
      values (v_target, v_inv.scope_id, v_actor, v_command, v_command)
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

-- ═══════════════════════ §9 · link_id en la fila propia ══════════════════════
-- ADR §1: el cliente cita la instancia que observo. Solo sobre uno mismo,
-- como my_claim_command_id (que queda por compatibilidad hasta A3).
create function sec.my_link_id(p_participant uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.link_id from core.participant_user_link l
   where l.participant_id = p_participant and l.user_id = sec.request_actor_id();
$fn$;
revoke execute on function sec.my_link_id(uuid) from public;
grant execute on function sec.my_link_id(uuid) to authenticated;

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
       sec.my_claim_command_id(p.id) as claim_command_id,
       (select m.target_participant_id from core.participant_merge m where m.source_participant_id = p.id) as merged_into_participant_id,
       sec.my_link_id(p.id) as link_id
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr(is_active, eligible_until) on true
 where s.kind = 'group';

-- ═══════════════════════ §10 · core.participant_unclaim se retira ════════════
-- El hecho general la sustituye (ADR §7, §12). Fail-closed: si tuviera filas
-- no se trasladan a ciegas —no llevan link_id—, se detiene la migracion. Y con
-- ellas sus comandos: F09 reclamaba (actor, client_command_id) como
-- participant.unclaim en la misma transaccion que el hecho, asi que sin hechos
-- no hay comandos; se afirma para que el wrapper (§7) reclame esa misma clave
-- como participant.unlink sin colision posible con el contrato anterior.
do $retire$
declare v_n integer;
begin
  select count(*) into v_n from core.participant_unclaim;
  if v_n > 0 then
    raise exception 'F10/ADR-001 §12: core.participant_unclaim tiene % filas; no se migran sin instancia. Reinicia la base local (docs/runbooks/local-setup.md).', v_n;
  end if;
  select count(*) into v_n from core.provisioning_command where command_type = 'participant.unclaim';
  if v_n > 0 then
    raise exception 'F10/ADR-001 §12: quedan % comandos participant.unclaim sin hecho; no se reinterpretan. Reinicia la base local (docs/runbooks/local-setup.md).', v_n;
  end if;
end
$retire$;
drop table core.participant_unclaim;
