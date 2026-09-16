-- ============================================================================
-- PUNTO DE INICIO DEL MODO PERSONAL TRAS EL INVITADO · F10/ADR-005 — bloque F10.C0
-- ============================================================================
--
-- Decision de producto (F10/ADR-005, Aceptado): una cuenta que nacio como
-- sesion Invitado (F05/ADR-003) y llega por primera vez a su Modo Personal
-- con historia de Grupos ELIGE, una sola vez, como empezar:
--
--   include  todo lo que ya hizo en sus grupos cuenta en Personal (lo de
--            siempre: saldo, historial, estadisticas, cuotas);
--   fresh    un PUNTO DE INICIO: las operaciones de origen grupo anteriores a
--            ese instante no cuentan en el Personal —ni saldo, ni historial,
--            ni estadisticas, ni cuotas—; nada se borra, Grupos y las deudas
--            pendientes siguen exactamente igual, y todo lo posterior entra
--            con normalidad.
--
-- Y una cuenta de origen Invitado SIN historia relevante al primer acceso
-- queda resuelta como `include` automaticamente y de forma persistida, para
-- que la pregunta no pueda aparecer dias despues.
--
-- Esta migracion parte del estado que dejo 20260918120000 (F10/ADR-003).
--
--   §0  core.scope.provisioned_as_guest: la marca durable de «nacio como
--       Invitado», escrita por api.ensure_personal_scope al CREAR el ambito
--       bajo una sesion anonima (el claim `is_anonymous` del JWT llega a SQL).
--   §1  core.personal_start: la decision, insert-only, un hecho por Personal.
--       sec.personal_group_history_exists: «hay historia de grupo atribuida a
--       esta cuenta». sec.counts_in_personal: EL predicado —una operacion
--       cuenta para un Personal si no es de origen grupo o si nacio en o
--       despues del corte—; con include o sin decision, siempre true.
--   §2  api.start_personal_scope: el comando (provisioning, clave, cerrojo del
--       ambito, idempotente por clave y por estado; `automatic` para el primer
--       acceso sin historia, que el servidor rehusa si SI hay historia).
--   §3  el saldo y las lecturas del Personal respetan el predicado:
--       sec.derive_balance (la cifra del writer), api.personal_balance,
--       api.personal_effect, api.personal_operation (y con ella
--       personal_operation_version y observed_balance), y la cuota economica
--       (sec.my_shared_expense_shares → personal_statistics y
--       personal_expense_share).
--   §4  api.ensure_personal_scope marca y publica; api.personal_scope publica
--       provisioned_as_guest, start_mode y needs_start_decision.
--
-- Lo que NO cambia: api.claimed_dimension (atribucion, F03/ADR-013),
-- api.group_summary / api.group_pending_pair y todo Grupos (la deuda vive
-- alli y se lee de alli), el protocolo del target_balance y la observacion
-- (F06/ADR-004/005: leen la misma cifra por construccion), los vinculos y las
-- fusiones (F10/ADR-002/003/004).
-- ============================================================================

-- ══════════════════════ §0 · la marca de origen Invitado ═════════════════════
alter table core.scope
  add column provisioned_as_guest boolean not null default false;

comment on column core.scope.provisioned_as_guest is
  'true si el Modo Personal se creo bajo una sesion anonima (F05/ADR-003). Lo escribe api.ensure_personal_scope al crear; nunca se pone a false. Es lo que hace elegible la pregunta de F10/ADR-005.';

-- Los grants de core.scope son por tabla; se hacen explicitos por si alguna
-- vez dejaran de serlo: quien lee el ambito lee la marca.
grant select (provisioned_as_guest) on core.scope to authenticated, nomey_provisioner, nomey_writer;
grant insert (provisioned_as_guest) on core.scope to nomey_provisioner;

-- ══════════════════════ §1 · la decision y el predicado ══════════════════════
create table core.personal_start (
  scope_id          uuid        primary key references core.scope (id),
  mode              text        not null,
  started_at        timestamptz not null default now(),
  automatic         boolean     not null default false,
  decided_by        uuid        not null,
  client_command_id uuid        not null unique,
  constraint personal_start_mode_conocido check (mode in ('include', 'fresh'))
);

comment on table core.personal_start is
  'Como empezo el Modo Personal de una cuenta de origen Invitado (F10/ADR-005): include o fresh, y el instante del corte. Un hecho por ambito, insert-only: no se vuelve a decidir.';
comment on column core.personal_start.started_at is
  'El corte, hora de servidor (now() de la transaccion del comando). Con fresh, una operacion de origen grupo cuenta si y solo si core.operation.created_at >= started_at.';
comment on column core.personal_start.automatic is
  'true si lo resolvio el primer acceso sin historia relevante (include). Informativo.';

alter table core.personal_start enable row level security;

-- El dueño la lee (las vistas del Personal son security_invoker); el
-- provisioner la lee y la escribe SOLO para su propio Personal; el writer la
-- lee (derive_balance es definer de postgres, pero el predicado tambien se
-- invoca desde funciones del writer). Nadie la actualiza ni la borra.
grant select on core.personal_start to authenticated, nomey_writer, nomey_provisioner;
grant insert on core.personal_start to nomey_provisioner;

create policy personal_start_client_select on core.personal_start
  for select to authenticated
  using (exists (select 1 from core.scope s
                  where s.id = personal_start.scope_id and s.kind = 'personal'
                    and s.owner_user_id = (select auth.uid())));
create policy personal_start_writer_select on core.personal_start
  for select to nomey_writer using (true);
create policy personal_start_provisioner_select on core.personal_start
  for select to nomey_provisioner
  using (exists (select 1 from core.scope s
                  where s.id = personal_start.scope_id and s.kind = 'personal'
                    and s.owner_user_id = sec.request_actor_id()));
create policy personal_start_provisioner_insert on core.personal_start
  for insert to nomey_provisioner
  with check (decided_by = sec.request_actor_id()
              and exists (select 1 from core.scope s
                           where s.id = personal_start.scope_id and s.kind = 'personal'
                             and s.owner_user_id = sec.request_actor_id()));

-- «Hay historia de grupo atribuida a esta cuenta»: caja de origen grupo en
-- su Personal, o cualquier efecto vigente de un grupo que la nombre por
-- vinculo (cuota o deuda; activo o historico: la historia es de quien la
-- hizo). Definer de postgres: cruza RLS a proposito y publica un booleano.
create function sec.personal_group_history_exists(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1
             from core.participant_user_link l
             join core.current_effect e
               on l.participant_id in (e.economic_participant_id, e.debt_debtor_participant_id, e.debt_creditor_participant_id)
            where l.user_id = p_user)
      or exists (
           select 1
             from core.scope ps
             join core.current_effect e on e.scope_id = ps.id and e.balance_amount is not null
             join core.operation_version ov on ov.id = e.operation_version_id
             join core.current_effect ge on ge.operation_version_id = ov.id
             join core.scope gs on gs.id = ge.scope_id and gs.kind = 'group'
            where ps.kind = 'personal' and ps.owner_user_id = p_user);
$fn$;
revoke execute on function sec.personal_group_history_exists(uuid) from public;
grant execute on function sec.personal_group_history_exists(uuid) to authenticated, nomey_provisioner;

-- EL PREDICADO. Una operacion cuenta para un Personal si:
--   · el Personal no tiene decision, o la decision es include  → siempre;
--   · la operacion no es de origen grupo (ningun efecto vigente en un ambito
--     de tipo group)                                            → siempre;
--   · nacio en o despues del corte (core.operation.created_at) → si.
-- Origen grupo es ESTRUCTURAL, no una lista de clases: lo que la operacion
-- escribio en un grupo. La caja incorporada al asociar un fantasma cuelga de
-- la version ORIGINAL (medido, F10/ADR-005): el corte la ve como lo que es,
-- historia anterior. Definer de postgres: el origen se decide sobre efectos
-- de grupos de los que el actor puede ya no ser miembro (salio, F10/ADR-003),
-- y RLS los ocultaria a un invocador; publica un booleano sobre una operacion
-- que el invocador ya ve.
create function sec.counts_in_personal(p_scope uuid, p_operation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((
    select case
             when ps.mode <> 'fresh' then true
             when not exists (select 1
                                from core.current_effect ge
                                join core.scope gs on gs.id = ge.scope_id and gs.kind = 'group'
                               where ge.operation_version_id = o.current_version_id) then true
             else o.created_at >= ps.started_at
           end
      from core.personal_start ps
      join core.operation o on o.id = p_operation
     where ps.scope_id = p_scope), true);
$fn$;
comment on function sec.counts_in_personal(uuid, uuid) is
  'F10/ADR-005 §3: si una operacion cuenta para un Modo Personal. El unico predicado del corte; lo usan todas las lecturas del Personal y sec.derive_balance.';
revoke execute on function sec.counts_in_personal(uuid, uuid) from public;
grant execute on function sec.counts_in_personal(uuid, uuid) to authenticated, nomey_writer, nomey_provisioner;

-- ══════════════════════ §2 · el comando ══════════════════════════════════════
create function api.start_personal_scope(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'mode', 'automatic'];
  v_actor     uuid;
  v_command   uuid;
  v_version   integer;
  v_mode      text;
  v_automatic boolean;
  v_scope     uuid;
  v_guest     boolean;
  v_intent    jsonb;
  v_stored    jsonb;
  v_replay    boolean := false;
  v_existing  core.personal_start%rowtype;
  v_history   boolean;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor     := sec.request_actor_id();
  v_command   := (payload ->> 'client_command_id')::uuid;
  v_version   := (payload ->> 'command_contract_version')::integer;
  v_mode      := payload ->> 'mode';
  v_automatic := coalesce((payload ->> 'automatic')::boolean, false);
  if v_command is null or v_version is null or v_mode is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version y mode son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  if v_mode not in ('include', 'fresh') then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'mode es include o fresh', 400);
  end if;
  if v_automatic and v_mode <> 'include' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'automatic solo con include', 400);
  end if;

  select s.id, s.provisioned_as_guest into v_scope, v_guest
    from core.scope s
   where s.kind = 'personal' and s.owner_user_id = v_actor;
  if v_scope is null then
    perform sec.raise_boundary('PERSONAL_SCOPE_MISSING', 'la cuenta no tiene Modo Personal', 409);
  end if;

  v_intent := jsonb_build_object('scope_id', v_scope, 'mode', v_mode, 'automatic', v_automatic);

  -- 0 · LA CLAVE, antes de autorizar y antes del cerrojo (F09/ADR-002).
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'personal.start', v_version, v_intent, v_scope);
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
    select * into v_existing from core.personal_start ps where ps.scope_id = v_scope;
    return jsonb_build_object('scope_id', v_scope, 'mode', v_existing.mode,
                              'started_at', v_existing.started_at, 'already_processed', true);
  end if;

  -- 1 · Solo una cuenta que nacio como Invitado tiene esta decision.
  if not v_guest then
    perform sec.raise_boundary('PERSONAL_START_NOT_APPLICABLE',
      'este Modo Personal no procede de una sesion de invitado', 409);
  end if;

  -- 2 · EL CERROJO DEL AMBITO: el mismo que toma el writer para escribir caja
  --     en este Personal, asi que una decision y un gasto de grupo concurrentes
  --     se serializan y los instantes (now() de cada transaccion) reflejan el
  --     orden. Todo lo que sigue se lee bajo el.
  perform sec.lock_scopes(array[v_scope]);

  -- 3 · Idempotente por ESTADO ademas de por clave: la misma decision, con otra
  --     clave, es la misma decision (un reinicio de la app no la repite ni la
  --     rompe); otra decision distinta se rehusa: no se vuelve a decidir.
  select * into v_existing from core.personal_start ps where ps.scope_id = v_scope;
  if v_existing.scope_id is not null then
    if v_existing.mode = v_mode then
      return jsonb_build_object('scope_id', v_scope, 'mode', v_existing.mode,
                                'started_at', v_existing.started_at, 'already_processed', true);
    end if;
    perform sec.raise_boundary('PERSONAL_START_DECIDED',
      'el Modo Personal ya decidio como empezar; no se vuelve a decidir', 409);
  end if;

  -- 4 · La autoridad sobre «hay historia» es del servidor, aqui y ahora:
  --     un include AUTOMATICO (primer acceso sin historia) se rehusa si en
  --     este instante si la hay —el cliente vuelve a leer y pregunta—, y un
  --     fresh sin historia no tiene sentido.
  v_history := sec.personal_group_history_exists(v_actor);
  if v_automatic and v_history then
    perform sec.raise_boundary('PERSONAL_START_DECISION_REQUIRED',
      'ya hay movimientos de grupos: la persona decide como empezar', 409);
  end if;
  if v_mode = 'fresh' and not v_history then
    perform sec.raise_boundary('PERSONAL_START_NOT_APPLICABLE',
      'sin movimientos de grupos no hay nada que dejar fuera', 409);
  end if;

  -- 5 · EL HECHO.
  insert into core.personal_start (scope_id, mode, automatic, decided_by, client_command_id)
  values (v_scope, v_mode, v_automatic, v_actor, v_command)
  returning * into v_existing;

  return jsonb_build_object('scope_id', v_scope, 'mode', v_existing.mode,
                            'started_at', v_existing.started_at, 'already_processed', false);
end
$fn$;
grant create on schema api to nomey_provisioner;
alter function api.start_personal_scope(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.start_personal_scope(jsonb) from public;
grant execute on function api.start_personal_scope(jsonb) to authenticated;
-- El cerrojo del ambito lo tomaba solo el writer (y el provisioner a traves
-- de incorporate_participant_cash, que es del writer). Aqui lo toma el
-- provisioner sobre su propio Personal: su policy de UPDATE (la de la moneda)
-- es la que hace que `for update` devuelva la fila.
grant execute on function sec.lock_scopes(uuid[]) to nomey_provisioner;
comment on function api.start_personal_scope(jsonb) is
  'F10/ADR-005: decide, una sola vez, como empieza el Modo Personal de una cuenta de origen Invitado (include | fresh). Provisioning idempotente por clave y por estado; insert-only.';

-- ══════════════════════ §3 · el saldo y las lecturas respetan el corte ═══════
-- LA CIFRA DEL WRITER. Si la vista dijera 0 y esto siguiera viendo la caja
-- anterior, el primer ajuste por objetivo derivaria un delta contra una cifra
-- que la persona no ve, y la observacion contradiria al Disponible en
-- pantalla. La fuente de verdad del saldo personal es UNA funcion; el corte
-- vive aqui y las vistas la reproducen. (`begin atomic`, como siempre: las
-- dependencias quedan analizables y la guarda de core.effect sigue viendo que
-- lee la proyeccion.)
create or replace function sec.derive_balance(p_scope uuid, p_exclude_version uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
begin atomic
  select coalesce(sum(e.balance_amount), 0)::bigint
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where e.scope_id = p_scope
     and e.balance_amount is not null
     and (p_exclude_version is null or e.operation_version_id <> p_exclude_version)
     and sec.counts_in_personal(p_scope, ov.operation_id);
end;

create or replace view api.personal_balance
with (security_invoker = true) as
select s.id as scope_id,
       s.base_currency_definition_id as currency_definition_id,
       coalesce(b.total, 0)::text as balance_amount
  from core.scope s
  left join lateral (
    select sum(e.balance_amount) as total
      from core.current_effect e
      join core.operation_version ov on ov.id = e.operation_version_id
     where e.scope_id = s.id and e.balance_amount is not null
       and sec.counts_in_personal(s.id, ov.operation_id)) b on true
 where s.kind = 'personal' and s.owner_user_id = (select auth.uid());

create or replace view api.personal_effect
with (security_invoker = true) as
select e.id,
       e.scope_id,
       e.accounting_class,
       e.currency_definition_id,
       ov.effective_date,
       e.balance_amount::text as balance_amount,
       (case when e.economic_participant_id is null then e.economic_amount else null end)::text as economic_amount
  from core.current_effect e
  join core.scope s on s.id = e.scope_id
  join core.operation_version ov on ov.id = e.operation_version_id
 where s.kind = 'personal' and s.owner_user_id = (select auth.uid())
   and (e.balance_amount is not null or (e.economic_amount is not null and e.economic_participant_id is null))
   and sec.counts_in_personal(e.scope_id, ov.operation_id);

create or replace view api.personal_operation
with (security_invoker = true) as
select o.id as operation_id,
       o.operation_class,
       e.scope_id,
       e.currency_definition_id,
       sum(e.balance_amount)::text as balance_amount,
       ov.original_amount::text as original_amount,
       ov.effective_date,
       ov.effective_time,
       md.concept,
       xc.category_id,
       ad.target_balance::text as target_balance,
       o.current_version_id,
       ov.supersedes_version_id as previous_version_id,
       ov.version_no,
       o.created_at as operation_created_at,
       coalesce(ctx.group_scope_id, pctx.group_scope_id) as group_scope_id,
       coalesce(ctx.group_display_name, pctx.group_display_name) as group_display_name,
       ctx.your_share,
       pctx.counterpart_display_name as payment_counterpart
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category xc on xc.operation_version_id = ov.id
  left join core.adjustment_detail ad on ad.operation_version_id = ov.id
  left join sec.my_group_expense_context() ctx(operation_id, group_scope_id, group_display_name, your_share) on ctx.operation_id = o.id
  left join sec.my_group_payment_context() pctx(operation_id, group_scope_id, group_display_name, counterpart_display_name) on pctx.operation_id = o.id
 where s.kind = 'personal' and s.owner_user_id = (select auth.uid())
   and o.operation_class = any (array['personal_expense', 'personal_income', 'adjustment', 'group_expense', 'group_payment'])
   and ov.version_kind = 'record' and e.balance_amount is not null
   -- F10/ADR-005 §3: con fresh, la historia de grupo anterior al corte no es del Personal.
   and sec.counts_in_personal(e.scope_id, o.id)
 group by o.id, o.operation_class, e.scope_id, e.currency_definition_id, ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, xc.category_id, ad.target_balance, o.current_version_id, ov.supersedes_version_id, ov.version_no, o.created_at,
          ctx.group_scope_id, ctx.group_display_name, ctx.your_share, pctx.group_scope_id, pctx.group_display_name, pctx.counterpart_display_name;

-- La cuota economica: la misma funcion reducida, con el corte sobre el
-- Personal del actor. personal_statistics y personal_expense_share
-- (my_shared_expense_share_row) la consumen sin cambios.
create or replace function sec.my_shared_expense_shares(p_from date default null, p_to date default null)
returns table (operation_id uuid, effective_date date, category_id uuid, amount bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  select ov.operation_id,
         ov.effective_date,
         xc.category_id,
         e.economic_amount
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.scope s on s.id = e.scope_id and s.kind = 'group'
    join core.participant_user_link l on l.participant_id = e.economic_participant_id
    left join core.expense_category xc on xc.operation_version_id = ov.id
   where l.user_id = (select auth.uid())
     and e.accounting_class = 'expense'
     and e.economic_amount is not null
     and (p_from is null or ov.effective_date >= p_from)
     and (p_to   is null or ov.effective_date <= p_to)
     and sec.counts_in_personal(
           (select ps.id from core.scope ps where ps.kind = 'personal' and ps.owner_user_id = (select auth.uid())),
           ov.operation_id);
$fn$;

-- ══════════════════════ §4 · provisioning y lectura del ambito ═══════════════
create or replace function api.ensure_personal_scope(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['currency_code'];
  v_actor    uuid;
  v_scope    uuid;
  v_currency uuid;
  v_created  boolean := false;
  v_guest    boolean;
  v_mode     text;
  v_needs    boolean;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor := sec.request_actor_id();

  -- Ya existe: se devuelve tal cual y NO se toca la moneda. Es lo que permite
  -- invocarla en cada arranque sin deshacer una eleccion del usuario.
  select s.id, s.base_currency_definition_id, s.provisioned_as_guest into v_scope, v_currency, v_guest
    from core.scope s
   where s.owner_user_id = v_actor and s.kind = 'personal';

  if v_scope is null then
    v_currency := sec.resolve_recommended_currency(
                    sec.payload_text(payload, 'currency_code', false));
    v_scope    := gen_random_uuid();
    -- LA MARCA DE ORIGEN (F10/ADR-005 §2): el claim del JWT dice si esta
    -- sesion es anonima; se escribe al crear, y nunca se pone a false.
    v_guest    := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);

    begin
      insert into core.scope (id, kind, base_currency_definition_id, owner_user_id, provisioned_as_guest)
      values (v_scope, 'personal', v_currency, v_actor, v_guest);
      v_created := true;
    exception when unique_violation then
      -- Carrera: otra sesion creo el ambito primero. `scope_un_personal_por_
      -- usuario` la resuelve, y esta es la UNICA excepcion capturada en todo el
      -- camino: cualquier otra convertiria un fallo en escritura parcial.
      select s.id, s.base_currency_definition_id, s.provisioned_as_guest into v_scope, v_currency, v_guest
        from core.scope s
       where s.owner_user_id = v_actor and s.kind = 'personal';
      v_created := false;
    end;

    if v_created then
      insert into core.membership (scope_id, user_id) values (v_scope, v_actor);
    end if;
  end if;

  if v_scope is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no se pudo resolver el ambito personal', 403);
  end if;

  select ps.mode into v_mode from core.personal_start ps where ps.scope_id = v_scope;
  v_needs := v_guest and v_mode is null and sec.personal_group_history_exists(v_actor);

  return (
    select jsonb_build_object(
      'scope_id',                     v_scope,
      'base_currency_definition_id',  c.id,
      'currency_code',                c.code,
      'currency_scale',               c.scale,
      'created',                      v_created,
      'provisioned_as_guest',         v_guest,
      'start_mode',                   v_mode,
      'needs_start_decision',         v_needs)
    from core.currency_definition c where c.id = v_currency
  );
end
$fn$;

create or replace view api.personal_scope
with (security_invoker = true) as
select s.id,
       s.base_currency_definition_id,
       c.code  as currency_code,
       c.scale as currency_scale,
       s.provisioned_as_guest,
       ps.mode as start_mode,
       (s.provisioned_as_guest and ps.mode is null and sec.personal_group_history_exists(s.owner_user_id)) as needs_start_decision
  from core.scope s
  join core.currency_definition c on c.id = s.base_currency_definition_id
  left join core.personal_start ps on ps.scope_id = s.id
 where s.kind = 'personal' and s.owner_user_id = (select auth.uid());
