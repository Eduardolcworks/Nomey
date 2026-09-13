-- ============================================================================
-- EDITAR UN GRUPO: nombre, emoji y participantes nuevos. Con actor, estado
-- anterior y posterior, fecha, historial y aviso desde la primera version,
-- exactamente lo que ADR-032 §Consecuencias reservo para esta escritura.
-- ============================================================================
--
-- ═══════════ QUE SE PUEDE CAMBIAR, Y QUE NO ═══════════
--
-- - **Nombre y emoji**: cualquier miembro (ADR-032 §2: no hay roles).
-- - **Participantes**: solo ALTAS. Un participante nuevo es una identidad
--   contextual sin cuenta y sin vinculo (ADR-012 §1), con su presencia abierta
--   desde HOY —`current_date`, el mismo criterio que la creacion—. No se le
--   incorpora a ningun gasto anterior: la elegibilidad se evalua al escribir
--   cada operacion contra su fecha efectiva (ADR-016 §4), y un periodo que
--   empieza hoy no alcanza ayer.
-- - **Ni bajas, ni renombrados, ni reclamaciones** de participantes: F10.
-- - **La moneda base no se toca aqui.** ADR-032 §4 la deja cambiar mientras no
--   haya efectos; este comando simplemente no la acepta en su payload.
-- - **La identidad del grupo no cambia**: `scope_id` es clave, no dato.
--
-- ═══════════ IDEMPOTENCIA Y CONCURRENCIA ═══════════
--
-- La clave se reclama en `core.provisioning_command` con `command_type =
-- 'group.update'` ANTES de escribir nada (ADR-033 §1): misma clave y misma
-- intencion es replay; misma clave y otra intencion, `IDEMPOTENCY_KEY_REUSED`.
--
-- **Nadie pisa en silencio un cambio concurrente.** El cliente declara
-- `expected_updated_at`, el `updated_at` del perfil que leyo, y el servidor lo
-- compara bajo bloqueo de fila: si otro miembro guardo entre medias, se
-- responde `PROFILE_CONFLICT` (409) y no se escribe nada. Es el mismo CAS de
-- ADR-011 §13 aplicado a un perfil en vez de a una version, y usa la columna
-- que ADR-032 ya persistia para esto. **La comparacion es de instante exacto**:
-- no hay ventana en la que dos guardados con la misma lectura pasen los dos.
--
-- ═══════════ HISTORIAL Y AVISO ═══════════
--
-- `core.group_profile_change` guarda quien, cuando, con que comando, el perfil
-- ANTES y DESPUES y los participantes que dio de alta. Es la relacion de la
-- que un dia saldra «Edu cambio el nombre del grupo»; hoy es la garantia de que
-- ninguna edicion es anonima ni irrecuperable.
--
-- `core.group_profile_notice` es la bandeja: una fila por miembro y cambio, con
-- la misma forma y la misma RLS que `core.group_edit_notice` —el editor
-- incluido, lectura y marcado solo por su destinatario, sin claves ajenas a
-- `auth.users`—. Es una relacion hermana y no una ampliacion de aquella: un
-- aviso de gasto apunta a una version de operacion y este a un cambio de
-- perfil, y forzar los dos en una tabla obligaria a anular columnas que hoy
-- son `not null` por buenas razones.

-- ---------------------------------------------------------------------------
-- 1 · Historial
-- ---------------------------------------------------------------------------
create table core.group_profile_change (
  id                 uuid primary key default gen_random_uuid(),
  scope_id           uuid not null references core.scope (id),
  changed_by         uuid not null,
  changed_at         timestamptz not null default now(),
  client_command_id  uuid not null,
  before_profile     jsonb not null,
  after_profile      jsonb not null,
  added_participants jsonb not null default '[]'::jsonb,
  constraint group_profile_change_un_comando unique (changed_by, client_command_id)
);

comment on table core.group_profile_change is
  'Cada edicion del perfil de un grupo: actor, instante, comando, perfil antes '
  'y despues, y los participantes dados de alta. Insert-only.';

create index group_profile_change_por_grupo
  on core.group_profile_change (scope_id, changed_at desc);

alter table core.group_profile_change enable row level security;

-- Solo escribe el provisioner, y solo como el actor de la peticion. Nadie lo
-- lee todavia por el Data API: la primera lectura llegara con la pantalla de
-- historial y decidira entonces sus columnas.
grant insert, select on core.group_profile_change to nomey_provisioner;
create policy group_profile_change_provisioner_insert on core.group_profile_change
  for insert to nomey_provisioner
  with check (changed_by = sec.request_actor_id());
create policy group_profile_change_provisioner_select on core.group_profile_change
  for select to nomey_provisioner
  using (sec.is_member(scope_id));

-- ---------------------------------------------------------------------------
-- 2 · Aviso por destinatario
-- ---------------------------------------------------------------------------
create table core.group_profile_notice (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  scope_id          uuid not null references core.scope (id),
  change_id         uuid not null references core.group_profile_change (id),
  editor_user_id    uuid not null,
  edited_at         timestamptz not null default now(),
  read_at           timestamptz,
  constraint group_profile_notice_una_por_destinatario unique (recipient_user_id, change_id)
);

create index group_profile_notice_bandeja
  on core.group_profile_notice (recipient_user_id, edited_at desc);

alter table core.group_profile_notice enable row level security;

grant insert, select on core.group_profile_notice to nomey_provisioner;
create policy group_profile_notice_provisioner_insert on core.group_profile_notice
  for insert to nomey_provisioner
  with check (editor_user_id = sec.request_actor_id());
create policy group_profile_notice_provisioner_select on core.group_profile_notice
  for select to nomey_provisioner
  using (editor_user_id = sec.request_actor_id());

grant select, update (read_at) on core.group_profile_notice to authenticated;
create policy group_profile_notice_client_select on core.group_profile_notice
  for select to authenticated
  using (recipient_user_id = sec.request_actor_id());
create policy group_profile_notice_client_update on core.group_profile_notice
  for update to authenticated
  using (recipient_user_id = sec.request_actor_id())
  with check (recipient_user_id = sec.request_actor_id());

create view api.group_profile_notice
with (security_invoker = true) as
select n.id,
       n.scope_id,
       n.change_id,
       n.editor_user_id,
       sec.is_me(n.editor_user_id) as edited_by_me,
       n.edited_at,
       n.read_at
  from core.group_profile_notice n;

grant select, update (read_at) on api.group_profile_notice to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Los privilegios que la edicion necesita, y ninguno mas
-- ---------------------------------------------------------------------------
-- UPDATE de las tres columnas del perfil. `created_by`, `created_at` y la
-- identidad no entran: no hay forma de cambiarlos por esta puerta.
grant update (display_name, emoji, updated_at) on core.group_profile to nomey_provisioner;
create policy group_profile_provisioner_update on core.group_profile
  for update to nomey_provisioner
  using (sec.is_member(scope_id))
  with check (sec.is_member(scope_id));

-- Leer QUIENES son los miembros del grupo, para repartir el aviso. El
-- provisioner tenia SELECT en la tabla y ninguna policy que lo dejara ver una
-- fila: medido, el aviso se insertaba a cero destinatarios sin ningun error.
-- Acotado a los grupos en los que el actor es miembro, como todo lo demas.
--
-- EL GRANT, explicito: ninguna migracion anterior lo daba (la base local lo
-- tenia por una via no versionada, y una reconstruccion desde cero fallaba en
-- api.create_group con «permission denied for table membership» al evaluar la
-- policy de participant_period). Medido en una base aislada el 2026-09-12.
grant select on core.membership to nomey_provisioner;
create policy membership_provisioner_member_select on core.membership
  for select to nomey_provisioner
  using (sec.is_member(scope_id));

-- Abrir la presencia de un participante NUEVO en un grupo que YA tiene
-- miembros. La policy de creacion exige justo lo contrario —un ambito sin
-- miembros—, asi que sin esta el alta fallaria por RLS. Sigue sin haber
-- UPDATE ni DELETE: cerrar un periodo es de F10.
create policy participant_period_provisioner_member_insert on core.participant_period
  for insert to nomey_provisioner
  with check (sec.is_member((select p.scope_id from core.participant p
                              where p.id = participant_period.participant_id)));

-- ---------------------------------------------------------------------------
-- 4 · La frontera
-- ---------------------------------------------------------------------------
create function api.update_group_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id',
    'display_name', 'emoji', 'expected_updated_at', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor     uuid;
  v_command   uuid;
  v_version   integer;
  v_scope     uuid;
  v_name      text;
  v_emoji     text;
  v_expected  timestamptz;
  v_parts     jsonb;
  v_intent    jsonb;
  v_stored    jsonb;
  v_replay    boolean := false;
  v_before    core.group_profile%rowtype;
  v_change    uuid;
  v_item      jsonb;
  v_ids       uuid[];
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

  v_name  := sec.canonical_display_name(payload ->> 'display_name');
  v_emoji := btrim(coalesce(payload ->> 'emoji', ''));
  if v_emoji = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'emoji no puede quedar vacio', 400);
  end if;

  v_expected := (payload ->> 'expected_updated_at')::timestamptz;
  if v_expected is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'expected_updated_at es obligatorio: declara el perfil que leiste', 400);
  end if;

  v_parts := coalesce(payload -> 'participants', '[]'::jsonb);
  if jsonb_typeof(v_parts) <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'participants debe ser una lista', 400);
  end if;
  for v_item in select value from jsonb_array_elements(v_parts) loop
    perform sec.assert_payload_shape(v_item, c_participant_fields);
    if (v_item ->> 'client_participant_id') is null then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'cada participante nuevo lleva su client_participant_id', 400);
    end if;
  end loop;

  -- ---------- la autorizacion: ser miembro, y nada mas (ADR-032 §2) ----------
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;

  -- ---------- la intencion canonica ----------
  v_intent := jsonb_build_object(
    'scope_id',            v_scope,
    'display_name',        v_name,
    'emoji',               v_emoji,
    'expected_updated_at', v_expected,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_participant_id', p ->> 'client_participant_id',
               'display_name',          sec.canonical_display_name(p ->> 'display_name'))
               order by ord)
        from jsonb_array_elements(v_parts) with ordinality as e(p, ord)
    ), '[]'::jsonb));

  -- ---------- el reclamo de la clave, antes de escribir nada (ADR-033) ----------
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.update', v_version, v_intent, v_scope);
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
    return sec.group_envelope(v_scope, true);
  end if;

  -- ---------- el CAS, bajo bloqueo de la fila ----------
  select * into v_before from core.group_profile g
   where g.scope_id = v_scope for update;
  if v_before.scope_id is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  if v_before.updated_at <> v_expected then
    perform sec.raise_boundary('PROFILE_CONFLICT',
      'otro miembro ha guardado cambios desde que leiste el grupo; recarga', 409);
  end if;

  -- ---------- el historial, ANTES del cambio: si esto falla, nada cambia ----------
  insert into core.group_profile_change (
    scope_id, changed_by, client_command_id, before_profile, after_profile, added_participants)
  values (
    v_scope, v_actor, v_command,
    jsonb_build_object('display_name', v_before.display_name, 'emoji', v_before.emoji),
    jsonb_build_object('display_name', v_name,                'emoji', v_emoji),
    v_intent -> 'participants')
  returning id into v_change;

  -- ---------- el perfil ----------
  -- `clock_timestamp()` y no `now()`: el testigo del CAS tiene que ser un
  -- instante DISTINTO en cada guardado, y `now()` es el mismo durante toda
  -- una transaccion. Medido con la fixture: dos guardados en una transaccion
  -- daban el mismo `updated_at` y el segundo pisaba al primero sin conflicto.
  update core.group_profile
     set display_name = v_name,
         emoji        = v_emoji,
         updated_at   = clock_timestamp()
   where scope_id = v_scope;

  -- ---------- las altas: identidad contextual + presencia desde hoy ----------
  for v_item in select value from jsonb_array_elements(v_intent -> 'participants') loop
    begin
      insert into core.participant (id, scope_id, display_name)
      values ((v_item ->> 'client_participant_id')::uuid, v_scope, v_item ->> 'display_name');
    exception when unique_violation then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'ese client_participant_id ya existe', 409);
    end;
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values ((v_item ->> 'client_participant_id')::uuid, current_date, null);
  end loop;

  -- ---------- el aviso, a todos los miembros, el editor incluido ----------
  insert into core.group_profile_notice (recipient_user_id, scope_id, change_id, editor_user_id)
  select m.user_id, v_scope, v_change, v_actor
    from core.membership m
   where m.scope_id = v_scope
  on conflict (recipient_user_id, change_id) do nothing;

  return sec.group_envelope(v_scope, false);
end
$fn$;

-- El mismo cierre que el provisioning personal: el rol necesita CREATE en el
-- esquema solo para recibir la propiedad, y se le retira acto seguido.
grant create on schema api to nomey_provisioner;
alter function api.update_group_profile(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.update_group_profile(jsonb) from public;
grant  execute on function api.update_group_profile(jsonb) to authenticated;

comment on function api.update_group_profile(jsonb) is
  'Edita nombre y emoji de un grupo y da de alta participantes nuevos. Solo '
  'miembros; idempotente por (actor, client_command_id) con replay; CAS sobre '
  'updated_at; historial y aviso por destinatario en la misma transaccion.';

-- El provisioner necesita leer la membresia para el aviso: ya tenia SELECT.
-- Y el sobre lee participant y currency_definition, que tambien tenia.

-- ---------------------------------------------------------------------------
-- 5 · El perfil publica `updated_at`: es el testigo del CAS
-- ---------------------------------------------------------------------------
-- Sin el, el cliente no tiene que declarar y el servidor no tiene contra que
-- comparar. Es un instante, no un dato de dinero: puede viajar tal cual.
create or replace view api.group_profile
with (security_invoker = true) as
select g.scope_id,
       g.display_name,
       g.emoji,
       s.base_currency_definition_id,
       c.code  as currency_code,
       c.scale as currency_scale,
       (select count(*) from core.participant p where p.scope_id = g.scope_id) as participant_count,
       g.created_at,
       g.updated_at
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id;
