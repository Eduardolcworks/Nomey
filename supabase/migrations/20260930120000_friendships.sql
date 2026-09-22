-- ============================================================================
-- AMIGOS: la amistad simetrica, la solicitud dirigida y el enlace personal
-- (F12/ADR-005 y F12/ADR-006, F12.E.A)
-- ============================================================================
--
-- Lo que esta migracion crea, y por que en este orden:
--
--   core.friend_request        la intencion dirigida de A de ser amigo de B:
--                              una fila, terminales PERSISTIDAS (aceptada,
--                              rechazada, cancelada, caducada), una sola
--                              pendiente por pareja en cualquier direccion
--   core.friendship            la relacion SIMETRICA y canonica (user_low,
--                              user_high): una activa por pareja, historia
--                              por ended_at, nunca borrado fisico
--   core.friend_link           el enlace personal: UN token por cuenta,
--                              estable, revocable por rotacion; en claro
--   core.friend_link_rotation  cada rotacion, para el tope exacto y el rastro
--   core.friend_link_attempt   apuntes de token invalido, para el freno
--
--   sec.friend_request_state   estado derivado de las marcas (y de now()
--                              SOLO para leer: escribir terminaliza)
--   sec.lock_friend_pair       cerrojo transaccional canonico de la pareja
--   sec.assert_friend_actor    cuenta normal + handle definitivo, o su codigo
--   sec.expire_friend_requests terminaliza, bajo el cerrojo, lo que vencio
--   sec.friend_relation        la relacion actor ↔ otro, en una palabra
--   sec.my_friend_rows         lo que las vistas publican (definer reducido)
--   sec.my_friend_request_rows
--
--   api.lookup_friend_candidate   @handle → identidad publica + relacion, en
--                                 UNA llamada y UN apunte del freno del
--                                 resolver (F12/ADR-001 §12)
--   api.create_friend_request     por @handle; estados, no excepciones, para
--                                 lo que no es un error del que pide
--   api.accept_friend_request     solo el destinatario → core.friendship
--   api.decline_friend_request    solo el destinatario; 7 dias de cooldown
--                                 para ESE emisor hacia ESE destinatario
--   api.cancel_friend_request     solo el emisor; sin cooldown
--   api.remove_friend             cualquiera de los dos; ended_at, no delete
--   api.my_friend_link            el propio token (lo crea si no existe)
--   api.rotate_friend_link        token nuevo, el anterior deja de valer
--   api.preview_friend_link       identidad publica del dueno + relacion;
--                                 solo para cuenta normal con handle
--   api.respond_friend_link       aceptar (→ amistad) o rechazar, reusando
--                                 la solicitud pendiente si la habia
--   api.my_friends                vista: amigos ACTIVOS, sin uid
--   api.my_friend_requests        vista: solicitudes PENDIENTES, sin uid
--
-- Codigos nuevos: FRIEND_REQUEST_ACCEPTED, FRIEND_REQUEST_DECLINED,
-- FRIEND_REQUEST_CANCELLED (409; una caducada responde el ESTADO expired,
-- porque su terminalizacion debe persistir y una excepcion la revertiria),
-- FRIEND_REQUEST_LIMIT (409), FRIEND_REQUEST_RATE_LIMITED (429),
-- FRIEND_LINK_ROTATION_LIMITED (429). Reutilizados: NOT_AUTHORIZED (403),
-- USERNAME_REQUIRED (409), PAYLOAD_INVALID (400), RECIPIENT_LOOKUP_THROTTLED
-- (429).
--
-- Nada de esto es contable: ni operacion, ni efecto, ni ambito. Ser amigo no
-- amplia ninguna policy (F12/ADR-005 §9): ninguna funcion economica ni
-- ninguna vista de ambitos consulta estas relaciones.
--
-- Propietarios: TODO del provisioner, como las invitaciones, el username y las
-- propuestas: relaciones de identidad y consentimiento, no de dinero. Ninguna
-- funcion nueva es de postgres; ningun rol gana BYPASSRLS; authenticated no
-- toca core (ni siquiera con grants de columna: lee SOLO por las vistas, que
-- solo leen los definers reducidos).

-- ═══════════════════════ §1 · la solicitud ═══════════════════════════════════
-- Primero, porque la amistad referencia a la solicitud que la produjo.
create table core.friend_request (
  id                uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null,
  target_user_id    uuid not null,
  -- la pareja canonica, DERIVADA y persistida: es lo que el indice parcial
  -- de «una pendiente por pareja» necesita, y CASE es inmutable sobre uuid
  pair_low          uuid generated always as (case when requester_user_id < target_user_id then requester_user_id else target_user_id end) stored,
  pair_high         uuid generated always as (case when requester_user_id < target_user_id then target_user_id else requester_user_id end) stored,
  origin            text not null default 'username',
  client_command_id uuid not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 days',
  accepted_at       timestamptz,
  declined_at       timestamptz,
  cancelled_at      timestamptz,
  expired_at        timestamptz,
  -- quien ejecuto la resolucion; la caducidad no la ejecuta nadie
  resolved_by       uuid,
  -- como termino, dicho aparte de las marcas SOLO para lo que las marcas no
  -- distinguen: aceptada por el destinatario, o resuelta al abrir el enlace
  -- del destinatario el propio emisor (F12/ADR-006 §6)
  resolution        text,
  constraint friend_request_no_a_uno_mismo   check (requester_user_id <> target_user_id),
  constraint friend_request_origen           check (origin in ('username', 'group')),
  constraint friend_request_caducidad        check (expires_at > created_at),
  -- a lo sumo UNA terminal, y la caducidad es una de ellas (persistida)
  constraint friend_request_una_terminal     check (
    (accepted_at is not null)::int + (declined_at is not null)::int
    + (cancelled_at is not null)::int + (expired_at is not null)::int <= 1),
  constraint friend_request_resolucion       check (
    resolution is null or resolution in ('accepted', 'accepted_via_link', 'declined', 'cancelled', 'expired')),
  -- la resolucion dice lo mismo que la marca, y solo entonces
  constraint friend_request_resolucion_coherente check (
       (accepted_at  is not null and resolution in ('accepted', 'accepted_via_link'))
    or (declined_at  is not null and resolution = 'declined')
    or (cancelled_at is not null and resolution = 'cancelled')
    or (expired_at   is not null and resolution = 'expired')
    or (accepted_at is null and declined_at is null and cancelled_at is null and expired_at is null and resolution is null)),
  -- alguien la resolvio ⇔ la resolvio una persona (no la caducidad)
  constraint friend_request_resuelta_por     check (
    (resolved_by is not null) = (accepted_at is not null or declined_at is not null or cancelled_at is not null)),
  constraint friend_request_resolutor_parte  check (
    resolved_by is null or resolved_by in (requester_user_id, target_user_id)),
  -- la clave del comando de creacion, por emisor: el replay la recupera
  constraint friend_request_comando          unique (requester_user_id, client_command_id)
);
comment on table core.friend_request is
  'F12/ADR-005 §3: la intencion dirigida de A de ser amigo de B. No es contable. Estado: accepted ⇔ accepted_at; declined ⇔ declined_at; cancelled ⇔ cancelled_at; expired ⇔ expired_at (PERSISTIDA: la terminaliza el primer comando que toca la pareja tras expires_at); pending el resto. Una sola pendiente por pareja en cualquier direccion (indice parcial).';
comment on column core.friend_request.resolution is
  'accepted | accepted_via_link | declined | cancelled | expired. accepted_via_link: el propio emisor abrio el enlace del destinatario y acepto; las dos voluntades ya existian (F12/ADR-006 §6).';
-- UNA pendiente por pareja, estructural. Sin now(): la caducidad esta
-- persistida en expired_at, asi que una vencida deja de bloquear en cuanto un
-- comando la terminaliza, y NUNCA bloquea para siempre.
create unique index friend_request_pendiente_por_pareja on core.friend_request (pair_low, pair_high)
  where accepted_at is null and declined_at is null and cancelled_at is null and expired_at is null;
create index friend_request_emisor_idx on core.friend_request (requester_user_id, created_at desc);
create index friend_request_destinatario_idx on core.friend_request (target_user_id)
  where accepted_at is null and declined_at is null and cancelled_at is null and expired_at is null;
-- el cooldown lee «rechazadas de este emisor a este destinatario, recientes»
create index friend_request_rechazo_idx on core.friend_request (requester_user_id, target_user_id, declined_at)
  where declined_at is not null;

alter table core.friend_request enable row level security;
grant select, insert on core.friend_request to nomey_provisioner;
grant update (accepted_at, declined_at, cancelled_at, expired_at, resolved_by, resolution) on core.friend_request to nomey_provisioner;
create policy friend_request_provisioner_select on core.friend_request
  for select to nomey_provisioner
  using (sec.request_actor_id() in (requester_user_id, target_user_id));
create policy friend_request_provisioner_insert on core.friend_request
  for insert to nomey_provisioner with check (requester_user_id = sec.request_actor_id());
-- cualquiera de las dos partes puede terminalizar (cada comando fija cual y
-- que marca en su cuerpo); caducar la ajena de la pareja entra por aqui
create policy friend_request_provisioner_update on core.friend_request
  for update to nomey_provisioner
  using (sec.request_actor_id() in (requester_user_id, target_user_id))
  with check (sec.request_actor_id() in (requester_user_id, target_user_id));

-- ═══════════════════════ §2 · la amistad ═════════════════════════════════════
create table core.friendship (
  id                uuid primary key default gen_random_uuid(),
  user_low          uuid not null,
  user_high         uuid not null,
  created_at        timestamptz not null default now(),
  -- quien puso la SEGUNDA voluntad: el que acepto la solicitud o respondio al enlace
  created_by        uuid not null,
  origin            text not null,
  origin_request_id uuid references core.friend_request (id),
  ended_at          timestamptz,
  ended_by          uuid,
  constraint friendship_pareja_canonica  check (user_low < user_high),
  constraint friendship_creada_por_parte check (created_by in (user_low, user_high)),
  constraint friendship_origen           check (origin in ('request', 'link')),
  -- de una solicitud ⇔ apunta a ella; del enlace puede apuntar a la reciproca (§6 de ADR-006) o a ninguna
  constraint friendship_origen_solicitud check (origin <> 'request' or origin_request_id is not null),
  constraint friendship_fin_coherente    check ((ended_at is null) = (ended_by is null)),
  constraint friendship_fin_por_parte    check (ended_by is null or ended_by in (user_low, user_high)),
  constraint friendship_fin_despues      check (ended_at is null or ended_at >= created_at)
);
comment on table core.friendship is
  'F12/ADR-005 §2: la amistad entre dos cuentas, SIMETRICA y canonica (user_low < user_high). Una activa por pareja (indice parcial). Eliminar es ended_at/ended_by: la instancia queda como historia y volver a anadirse crea otra. Sin FK a ambitos ni operaciones: no toca nada economico ni de grupos.';
create unique index friendship_activa_por_pareja on core.friendship (user_low, user_high) where ended_at is null;
create index friendship_low_idx  on core.friendship (user_low)  where ended_at is null;
create index friendship_high_idx on core.friendship (user_high) where ended_at is null;
-- una solicitud produce a lo sumo una amistad
create unique index friendship_por_solicitud on core.friendship (origin_request_id) where origin_request_id is not null;

alter table core.friendship enable row level security;
grant select, insert on core.friendship to nomey_provisioner;
grant update (ended_at, ended_by) on core.friendship to nomey_provisioner;
create policy friendship_provisioner_select on core.friendship
  for select to nomey_provisioner
  using (sec.request_actor_id() in (user_low, user_high));
create policy friendship_provisioner_insert on core.friendship
  for insert to nomey_provisioner
  with check (created_by = sec.request_actor_id() and sec.request_actor_id() in (user_low, user_high));
create policy friendship_provisioner_update on core.friendship
  for update to nomey_provisioner
  using (sec.request_actor_id() in (user_low, user_high))
  with check (sec.request_actor_id() in (user_low, user_high));

-- ═══════════════════════ §3 · el enlace personal ═════════════════════════════
-- EN CLARO, a proposito (F12/ADR-006 §3): no es una credencial de
-- autenticacion sino un codigo publico, opaco y revocable que su dueno
-- comparte deliberadamente y que solo concede responder a SU invitacion de
-- amistad. Guardarlo en claro es lo que permite ensenar el mismo QR en
-- cualquier aparato sin retener nada en el telefono; lo que lo protege es que
-- solo su dueno lo obtiene por api y que rotar lo invalida al instante.
create table core.friend_link (
  user_id    uuid primary key,
  token      text not null unique,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  constraint friend_link_token_forma check (token ~ '^[A-Za-z0-9_-]{43}$'),
  constraint friend_link_version    check (version >= 1)
);
comment on table core.friend_link is
  'F12/ADR-006 §3: el enlace personal de amistad de una cuenta. UN token (32 bytes aleatorios, base64url) estable y revocable: rotar lo sustituye y el anterior deja de existir. No deriva del uid, no contiene handle ni correo. Solo su dueno lo lee por api.my_friend_link.';
alter table core.friend_link enable row level security;
grant select, insert on core.friend_link to nomey_provisioner;
grant update (token, version, rotated_at) on core.friend_link to nomey_provisioner;
-- leer TODOS: es como el provisioner convierte un token en su dueno
-- (sec.handle_owner hace lo mismo con los handles); el token ajeno nunca
-- sale de una funcion
create policy friend_link_provisioner_select on core.friend_link
  for select to nomey_provisioner using (true);
create policy friend_link_provisioner_insert on core.friend_link
  for insert to nomey_provisioner with check (user_id = sec.request_actor_id());
create policy friend_link_provisioner_update on core.friend_link
  for update to nomey_provisioner
  using (user_id = sec.request_actor_id()) with check (user_id = sec.request_actor_id());

-- Cada rotacion: el tope exacto de 5 / 24 h se cuenta aqui, y queda el rastro.
create table core.friend_link_rotation (
  user_id    uuid not null,
  version    integer not null,
  rotated_at timestamptz not null default now(),
  primary key (user_id, version)
);
comment on table core.friend_link_rotation is
  'F12/ADR-006 §4: una fila por rotacion del enlace (la version 1 no rota). Insert-only; cuenta el tope de 5 rotaciones / 24 h.';
alter table core.friend_link_rotation enable row level security;
grant select, insert on core.friend_link_rotation to nomey_provisioner;
create policy friend_link_rotation_provisioner on core.friend_link_rotation
  for all to nomey_provisioner
  using (user_id = sec.request_actor_id()) with check (user_id = sec.request_actor_id());

-- Los tokens invalidos que una cuenta presenta: 20 en 10 minutos la frenan.
create table core.friend_link_attempt (
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);
comment on table core.friend_link_attempt is
  'F12/ADR-006 §5: un token INVALIDO presentado por una cuenta. Solo los invalidos cuentan (como core.invitation_attempt y core.payment_request_attempt); el token no se guarda.';
create index friend_link_attempt_user_idx on core.friend_link_attempt (user_id, attempted_at desc);
alter table core.friend_link_attempt enable row level security;
grant select, insert, delete on core.friend_link_attempt to nomey_provisioner;
create policy friend_link_attempt_provisioner on core.friend_link_attempt
  for all to nomey_provisioner
  using (user_id = sec.request_actor_id()) with check (user_id = sec.request_actor_id());

-- ═══════════════════════ §4 · helpers ════════════════════════════════════════
-- El estado, de escalares: accepted | declined | cancelled | expired | pending.
-- expires_at entra SOLO para leer con honestidad una vencida que ningun
-- comando ha terminalizado todavia; ningun escritor confia en el: terminaliza.
create function sec.friend_request_state(
  p_accepted_at timestamptz, p_declined_at timestamptz, p_cancelled_at timestamptz,
  p_expired_at timestamptz, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when p_accepted_at  is not null then 'accepted'
              when p_declined_at  is not null then 'declined'
              when p_cancelled_at is not null then 'cancelled'
              when p_expired_at   is not null then 'expired'
              when now() >= p_expires_at      then 'expired'
              else 'pending' end;
$fn$;
comment on function sec.friend_request_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) is
  'F12/ADR-005 §3: el estado de una solicitud de amistad. Las cuatro terminales estan persistidas; now() solo cubre la lectura de una vencida aun no terminalizada.';
grant create on schema sec to nomey_provisioner;
alter function sec.friend_request_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.friend_request_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) from public;
grant execute on function sec.friend_request_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) to nomey_provisioner;

-- EL CERROJO CANONICO DE LA PAREJA, transaccional: toda transicion sobre una
-- pareja —crear, aceptar, rechazar, cancelar, eliminar, responder al enlace,
-- caducar— lo toma antes de leer nada de ella. Es lo que hace que A→B y B→A
-- simultaneas dejen UNA pendiente y la otra llamada reciba el estado real.
create function sec.lock_friend_pair(p_a uuid, p_b uuid)
returns void
language sql
set search_path = ''
as $fn$
  select pg_advisory_xact_lock(hashtextextended(
    'nomey.friend_pair:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0));
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.lock_friend_pair(uuid, uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.lock_friend_pair(uuid, uuid) from public;
grant execute on function sec.lock_friend_pair(uuid, uuid) to nomey_provisioner;

-- Cerrojo por cuenta, para los topes por emisor y las rotaciones del enlace.
create function sec.lock_friend_budget(p_user uuid)
returns void
language sql
set search_path = ''
as $fn$
  select pg_advisory_xact_lock(hashtextextended('nomey.friend_budget:' || p_user::text, 0));
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.lock_friend_budget(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.lock_friend_budget(uuid) from public;
grant execute on function sec.lock_friend_budget(uuid) to nomey_provisioner;

-- QUIEN PUEDE (F12/ADR-005 §8): cuenta normal con handle definitivo, para
-- todo. Devuelve el handle propio; una sesion anonima es NOT_AUTHORIZED · 403
-- y una cuenta sin username definitivo USERNAME_REQUIRED · 409, igual que
-- api.resolve_username y api.create_transfer_proposal.
create function sec.assert_friend_actor(p_actor uuid, p_what text)
returns text
language plpgsql
set search_path = ''
as $fn$
declare
  v_guest boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_own   text;
begin
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no ' || p_what, 403);
  end if;
  select h.handle into v_own from core.account_handle h
   where h.user_id = p_actor and h.claimed_at is not null and h.released_at is null;
  if v_own is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', p_what || ' exige tener username definitivo', 409);
  end if;
  return v_own;
end
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.assert_friend_actor(uuid, text) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.assert_friend_actor(uuid, text) from public;
grant execute on function sec.assert_friend_actor(uuid, text) to nomey_provisioner;

-- CADUCAR, BAJO EL CERROJO: lo primero que hace todo comando sobre una
-- pareja. Una pendiente vencida pasa a expired_at = now() y deja libre el
-- indice parcial; ningun cron es necesario para la integridad.
create function sec.expire_friend_requests(p_a uuid, p_b uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $fn$
declare v_n integer;
begin
  update core.friend_request r
     set expired_at = now(), resolution = 'expired'
   where r.pair_low = least(p_a, p_b) and r.pair_high = greatest(p_a, p_b)
     and r.accepted_at is null and r.declined_at is null and r.cancelled_at is null and r.expired_at is null
     and r.expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.expire_friend_requests(uuid, uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.expire_friend_requests(uuid, uuid) from public;
grant execute on function sec.expire_friend_requests(uuid, uuid) to nomey_provisioner;

-- LA RELACION DEL ACTOR CON OTRA CUENTA, en una palabra y con la solicitud
-- pendiente si la hay: friends | outgoing_pending | incoming_pending |
-- cooldown | none. Lee con el estado derivado (una vencida no es pendiente
-- aunque nadie la haya terminalizado). El cooldown es DIRECCIONAL: del actor
-- hacia quien lo rechazo hace menos de 7 dias; nunca al reves.
create function sec.friend_relation(p_actor uuid, p_other uuid)
returns table (relation text, request_id uuid)
language sql
stable
set search_path = ''
as $fn$
  select case when f.id is not null then 'friends'
              when o.id is not null then 'outgoing_pending'
              when i.id is not null then 'incoming_pending'
              when d.id is not null then 'cooldown'
              else 'none' end,
         coalesce(o.id, i.id)
    from (select 1) x
    left join core.friendship f
      on f.user_low = least(p_actor, p_other) and f.user_high = greatest(p_actor, p_other) and f.ended_at is null
    left join core.friend_request o
      on o.requester_user_id = p_actor and o.target_user_id = p_other
     and sec.friend_request_state(o.accepted_at, o.declined_at, o.cancelled_at, o.expired_at, o.expires_at) = 'pending'
    left join core.friend_request i
      on i.requester_user_id = p_other and i.target_user_id = p_actor
     and sec.friend_request_state(i.accepted_at, i.declined_at, i.cancelled_at, i.expired_at, i.expires_at) = 'pending'
    left join lateral (
      select r.id from core.friend_request r
       where r.requester_user_id = p_actor and r.target_user_id = p_other
         and r.declined_at is not null and r.declined_at > now() - interval '7 days'
       order by r.declined_at desc limit 1) d on true;
$fn$;
comment on function sec.friend_relation(uuid, uuid) is
  'F12/ADR-005 §5, §7: la relacion del actor con otra cuenta. Corre bajo las policies del provisioner (solo filas de las que el actor es parte): un tercero no puede preguntar por dos ajenos.';
grant create on schema sec to nomey_provisioner;
alter function sec.friend_relation(uuid, uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.friend_relation(uuid, uuid) from public;
grant execute on function sec.friend_relation(uuid, uuid) to nomey_provisioner;

-- ═══════════════════════ §5 · buscar candidato ═══════════════════════════════
-- UNA llamada y UN apunte (F12/ADR-005 §5): resuelve el @handle exacto como
-- api.resolve_username —mismo freno, mismos estados, mismo apunte— y anade la
-- relacion con el actor. Nada de uid. Frenado y uno mismo no apuntan; found y
-- not_found apuntan una vez. Transferencias sigue con resolve_username.
create function api.lookup_friend_candidate(p_handle text)
returns table (state text, handle text, public_name text, request_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := sec.request_actor_id();
  v_own    text;
  v_handle text;
  v_n      integer;
  v_uid    uuid;
  v_found  text;
  v_name   text;
  v_rel    record;
begin
  v_own := sec.assert_friend_actor(v_actor, 'busca amigos');

  select count(*) into v_n from core.username_lookup_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    state := 'throttled'; return next; return;
  end if;

  v_handle := sec.normalize_handle(p_handle);
  if v_handle is not null and v_handle = v_own then
    state := 'self'; return next; return;
  end if;
  if v_handle is not null then
    select h.user_id, h.handle, i.public_name into v_uid, v_found, v_name
      from core.account_handle h
      join core.account_identity i on i.user_id = h.user_id
     where h.handle = v_handle and h.claimed_at is not null and h.released_at is null;
  end if;
  insert into core.username_lookup_attempt (user_id) values (v_actor);
  delete from core.username_lookup_attempt a where a.attempted_at < now() - interval '1 day';
  if v_uid is null then
    state := 'not_found'; return next; return;
  end if;

  select * into v_rel from sec.friend_relation(v_actor, v_uid);
  state := v_rel.relation; handle := v_found; public_name := v_name; request_id := v_rel.request_id;
  return next;
end
$fn$;
comment on function api.lookup_friend_candidate(text) is
  'F12/ADR-005 §5: @handle exacto → identidad publica ACTUAL y relacion con el actor (none | outgoing_pending | incoming_pending | friends | cooldown | self | not_found | throttled), en UNA llamada y con UN apunte del freno del resolver (20 / 10 min, compartido con resolve_username). Exige cuenta normal con handle definitivo. Nunca un uid.';
grant create on schema api to nomey_provisioner;
alter function api.lookup_friend_candidate(text) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.lookup_friend_candidate(text) from public;
grant execute on function api.lookup_friend_candidate(text) to authenticated;

-- ═══════════════════════ §6 · crear ══════════════════════════════════════════
-- payload: { client_command_id, command_contract_version: 1, handle }
-- Orden: forma → actor → clave (replay sin apuntar) → a uno mismo → freno →
-- resolver + apunte → nadie (estado) → [cerrojo de pareja] caducar →
-- amigos / suya pendiente / mia pendiente / cooldown (estados) →
-- [cerrojo por emisor] 30 pendientes → 10 / 60 min → insert.
create function api.create_friend_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'handle'];
  v_actor    uuid := sec.request_actor_id();
  v_own      text;
  v_command  uuid;
  v_contract integer;
  v_raw      text;
  v_handle   text;
  v_r        core.friend_request%rowtype;
  v_n        integer;
  v_oldest   timestamptz;
  v_target   uuid;
  v_rel      record;
  v_id       uuid;
  v_until    timestamptz;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_command  := sec.payload_uuid(payload, 'client_command_id', true);
  v_contract := sec.payload_contract_version(payload);
  if v_contract <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_raw := sec.payload_text(payload, 'handle', true);
  v_own := sec.assert_friend_actor(v_actor, 'envia solicitudes de amistad');

  -- REPLAY por clave: lo que se persistio con esa clave, sin apuntar ni escribir.
  select * into v_r from core.friend_request r
   where r.requester_user_id = v_actor and r.client_command_id = v_command;
  if v_r.id is not null then
    return jsonb_build_object(
      'state', sec.friend_request_state(v_r.accepted_at, v_r.declined_at, v_r.cancelled_at, v_r.expired_at, v_r.expires_at),
      'request_id', v_r.id, 'expires_at', v_r.expires_at, 'already_processed', true);
  end if;

  v_handle := sec.normalize_handle(v_raw);
  if v_handle is not null and v_handle = v_own then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes enviarte una solicitud de amistad a ti mismo', 400);
  end if;

  -- EL DESTINATARIO: el freno del resolver (F12/ADR-001 §12). Frenado no
  -- apunta; resolver apunta una vez, encuentre o no.
  select count(*) into v_n from core.username_lookup_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    perform sec.raise_boundary('RECIPIENT_LOOKUP_THROTTLED',
      'demasiadas busquedas de username en diez minutos; espera antes de buscar otra', 429);
  end if;
  v_target := sec.handle_owner(v_raw);
  insert into core.username_lookup_attempt (user_id) values (v_actor);
  delete from core.username_lookup_attempt a where a.attempted_at < now() - interval '1 day';
  if v_target is null then
    -- Un ESTADO y no un error, para que el apunte del freno persista
    -- (medido en F12.B1: una excepcion lo revierte y sondear saldria gratis).
    return jsonb_build_object('state', 'not_found', 'already_processed', false);
  end if;
  if v_target = v_actor then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes enviarte una solicitud de amistad a ti mismo', 400);
  end if;

  -- LA PAREJA, SERIALIZADA (§4 de ADR-005): caducar lo vencido y leer la
  -- relacion real. Nada de lo que sigue es un error del que pide.
  perform sec.lock_friend_pair(v_actor, v_target);
  perform sec.expire_friend_requests(v_actor, v_target);
  select * into v_rel from sec.friend_relation(v_actor, v_target);
  if v_rel.relation = 'friends' then
    return jsonb_build_object('state', 'friends', 'already_processed', false);
  elsif v_rel.relation = 'incoming_pending' then
    -- Cruzada: la otra parte ya pidio. No se inserta una segunda; se contesta
    -- la suya (F12/ADR-005 §4: nunca amistad automatica por «enviar»).
    return jsonb_build_object('state', 'incoming_pending', 'request_id', v_rel.request_id, 'already_processed', false);
  elsif v_rel.relation = 'outgoing_pending' then
    return jsonb_build_object('state', 'pending', 'request_id', v_rel.request_id,
      'expires_at', (select r.expires_at from core.friend_request r where r.id = v_rel.request_id), 'already_processed', true);
  elsif v_rel.relation = 'cooldown' then
    return jsonb_build_object('state', 'cooldown', 'already_processed', false);
  end if;

  -- TOPES POR EMISOR (§7), exactos bajo su cerrojo: 30 pendientes salientes;
  -- 10 creadas en 60 min (cualquier estado: cancelar no devuelve cuota).
  perform sec.lock_friend_budget(v_actor);
  select count(*) into v_n from core.friend_request r
   where r.requester_user_id = v_actor
     and sec.friend_request_state(r.accepted_at, r.declined_at, r.cancelled_at, r.expired_at, r.expires_at) = 'pending';
  if v_n >= 30 then
    perform sec.raise_boundary('FRIEND_REQUEST_LIMIT', 'ya tienes treinta solicitudes de amistad pendientes; cancela alguna', 409);
  end if;
  select count(*), min(r.created_at) into v_n, v_oldest from core.friend_request r
   where r.requester_user_id = v_actor and r.created_at > now() - interval '60 minutes';
  if v_n >= 10 then
    perform sec.raise_boundary('FRIEND_REQUEST_RATE_LIMITED',
      'has enviado diez solicitudes de amistad en la ultima hora; espera antes de enviar otra', 429,
      jsonb_build_object('retry_at', v_oldest + interval '60 minutes'));
  end if;

  insert into core.friend_request (requester_user_id, target_user_id, origin, client_command_id)
  values (v_actor, v_target, 'username', v_command)
  returning id, expires_at into v_id, v_until;
  return jsonb_build_object('state', 'pending', 'request_id', v_id, 'expires_at', v_until, 'already_processed', false);
end
$fn$;
comment on function api.create_friend_request(jsonb) is
  'F12/ADR-005 §3-§7: enviar una solicitud de amistad a @handle. Resuelve el handle UNA vez en servidor (un apunte del freno). Estados con 200: pending (nueva o ya existente, con request_id), not_found, friends, incoming_pending (cruzada: contesta la suya), cooldown (7 dias tras un rechazo, sin detalle). Errores: NOT_AUTHORIZED, USERNAME_REQUIRED, PAYLOAD_INVALID, RECIPIENT_LOOKUP_THROTTLED, FRIEND_REQUEST_LIMIT, FRIEND_REQUEST_RATE_LIMITED. Idempotente por client_command_id.';
grant create on schema api to nomey_provisioner;
alter function api.create_friend_request(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.create_friend_request(jsonb) from public;
grant execute on function api.create_friend_request(jsonb) to authenticated;

-- ═══════════════════════ §7 · aceptar, rechazar, cancelar ════════════════════
-- payload: { request_id }. Todas: actor elegible → la fila (o NOT_AUTHORIZED,
-- sin distinguir ajena de inexistente) → cerrojo de pareja → releer con
-- for update → caducar → estado → transicion. Idempotentes por estado:
-- repetir la misma transicion devuelve already_processed; otra terminal es
-- su codigo 409, salvo la caducidad, que es un estado (ver dentro).
create function api.accept_friend_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_id    uuid;
  v_r     core.friend_request%rowtype;
  v_state text;
  v_f     uuid;
begin
  perform sec.assert_payload_shape(payload, array['request_id']);
  v_id := sec.payload_uuid(payload, 'request_id', true);
  perform sec.assert_friend_actor(v_actor, 'acepta solicitudes de amistad');
  select * into v_r from core.friend_request r where r.id = v_id;
  if v_r.id is null or v_r.target_user_id <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la solicitud no existe o no va dirigida a ti', 403);
  end if;
  perform sec.lock_friend_pair(v_r.requester_user_id, v_r.target_user_id);
  perform sec.expire_friend_requests(v_r.requester_user_id, v_r.target_user_id);
  select * into v_r from core.friend_request r where r.id = v_id for update;
  v_state := sec.friend_request_state(v_r.accepted_at, v_r.declined_at, v_r.cancelled_at, v_r.expired_at, v_r.expires_at);
  if v_state = 'accepted' then
    select f.id into v_f from core.friendship f where f.origin_request_id = v_id;
    return jsonb_build_object('request_id', v_id, 'state', 'accepted', 'friendship_id', v_f, 'already_processed', true);
  elsif v_state = 'declined' then
    perform sec.raise_boundary('FRIEND_REQUEST_DECLINED', 'la solicitud ya fue rechazada', 409);
  elsif v_state = 'cancelled' then
    perform sec.raise_boundary('FRIEND_REQUEST_CANCELLED', 'la solicitud fue cancelada por quien la envio', 409);
  elsif v_state = 'expired' then
    -- ESTADO y no excepcion: la terminalizacion de arriba tiene que persistir,
    -- y una excepcion la revertiria (medido). Ya no hay nada que hacer.
    return jsonb_build_object('request_id', v_id, 'state', 'expired', 'already_processed', true);
  end if;

  -- Una activa de la pareja no puede coexistir con una pendiente (§4), pero
  -- si existiera, la solicitud se resuelve y la amistad es la que hay.
  select f.id into v_f from core.friendship f
   where f.user_low = v_r.pair_low and f.user_high = v_r.pair_high and f.ended_at is null;
  if v_f is null then
    insert into core.friendship (user_low, user_high, created_by, origin, origin_request_id)
    values (v_r.pair_low, v_r.pair_high, v_actor, 'request', v_id)
    returning id into v_f;
  end if;
  update core.friend_request r
     set accepted_at = now(), resolved_by = v_actor, resolution = 'accepted'
   where r.id = v_id;
  return jsonb_build_object('request_id', v_id, 'state', 'accepted', 'friendship_id', v_f, 'already_processed', false);
end
$fn$;
comment on function api.accept_friend_request(jsonb) is
  'F12/ADR-005 §3: el destinatario acepta → core.friendship (origin request). Idempotente por estado; otra terminal es su codigo.';
grant create on schema api to nomey_provisioner;
alter function api.accept_friend_request(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.accept_friend_request(jsonb) from public;
grant execute on function api.accept_friend_request(jsonb) to authenticated;

create function api.decline_friend_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_id    uuid;
  v_r     core.friend_request%rowtype;
  v_state text;
begin
  perform sec.assert_payload_shape(payload, array['request_id']);
  v_id := sec.payload_uuid(payload, 'request_id', true);
  perform sec.assert_friend_actor(v_actor, 'rechaza solicitudes de amistad');
  select * into v_r from core.friend_request r where r.id = v_id;
  if v_r.id is null or v_r.target_user_id <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la solicitud no existe o no va dirigida a ti', 403);
  end if;
  perform sec.lock_friend_pair(v_r.requester_user_id, v_r.target_user_id);
  perform sec.expire_friend_requests(v_r.requester_user_id, v_r.target_user_id);
  select * into v_r from core.friend_request r where r.id = v_id for update;
  v_state := sec.friend_request_state(v_r.accepted_at, v_r.declined_at, v_r.cancelled_at, v_r.expired_at, v_r.expires_at);
  if v_state = 'declined' then
    return jsonb_build_object('request_id', v_id, 'state', 'declined', 'already_processed', true);
  elsif v_state = 'accepted' then
    perform sec.raise_boundary('FRIEND_REQUEST_ACCEPTED', 'la solicitud ya fue aceptada: sois amigos', 409);
  elsif v_state = 'cancelled' then
    perform sec.raise_boundary('FRIEND_REQUEST_CANCELLED', 'la solicitud fue cancelada por quien la envio', 409);
  elsif v_state = 'expired' then
    -- ESTADO y no excepcion: la terminalizacion de arriba tiene que persistir,
    -- y una excepcion la revertiria (medido). Ya no hay nada que hacer.
    return jsonb_build_object('request_id', v_id, 'state', 'expired', 'already_processed', true);
  end if;
  update core.friend_request r
     set declined_at = now(), resolved_by = v_actor, resolution = 'declined'
   where r.id = v_id;
  return jsonb_build_object('request_id', v_id, 'state', 'declined', 'already_processed', false);
end
$fn$;
comment on function api.decline_friend_request(jsonb) is
  'F12/ADR-005 §3, §7: el destinatario rechaza. Abre 7 dias de cooldown de ESE emisor hacia ESE destinatario (create responde cooldown). Idempotente por estado.';
grant create on schema api to nomey_provisioner;
alter function api.decline_friend_request(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.decline_friend_request(jsonb) from public;
grant execute on function api.decline_friend_request(jsonb) to authenticated;

create function api.cancel_friend_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_id    uuid;
  v_r     core.friend_request%rowtype;
  v_state text;
begin
  perform sec.assert_payload_shape(payload, array['request_id']);
  v_id := sec.payload_uuid(payload, 'request_id', true);
  perform sec.assert_friend_actor(v_actor, 'cancela solicitudes de amistad');
  select * into v_r from core.friend_request r where r.id = v_id;
  if v_r.id is null or v_r.requester_user_id <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la solicitud no existe o no la enviaste tu', 403);
  end if;
  perform sec.lock_friend_pair(v_r.requester_user_id, v_r.target_user_id);
  perform sec.expire_friend_requests(v_r.requester_user_id, v_r.target_user_id);
  select * into v_r from core.friend_request r where r.id = v_id for update;
  v_state := sec.friend_request_state(v_r.accepted_at, v_r.declined_at, v_r.cancelled_at, v_r.expired_at, v_r.expires_at);
  if v_state = 'cancelled' then
    return jsonb_build_object('request_id', v_id, 'state', 'cancelled', 'already_processed', true);
  elsif v_state = 'accepted' then
    perform sec.raise_boundary('FRIEND_REQUEST_ACCEPTED', 'la solicitud ya fue aceptada: sois amigos', 409);
  elsif v_state = 'declined' then
    perform sec.raise_boundary('FRIEND_REQUEST_DECLINED', 'la solicitud ya fue rechazada', 409);
  elsif v_state = 'expired' then
    -- ESTADO y no excepcion: la terminalizacion de arriba tiene que persistir,
    -- y una excepcion la revertiria (medido). Ya no hay nada que hacer.
    return jsonb_build_object('request_id', v_id, 'state', 'expired', 'already_processed', true);
  end if;
  update core.friend_request r
     set cancelled_at = now(), resolved_by = v_actor, resolution = 'cancelled'
   where r.id = v_id;
  return jsonb_build_object('request_id', v_id, 'state', 'cancelled', 'already_processed', false);
end
$fn$;
comment on function api.cancel_friend_request(jsonb) is
  'F12/ADR-005 §3, §7: el emisor cancela mientras esta pendiente. Sin cooldown: puede enviar otra al instante. Idempotente por estado.';
grant create on schema api to nomey_provisioner;
alter function api.cancel_friend_request(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.cancel_friend_request(jsonb) from public;
grant execute on function api.cancel_friend_request(jsonb) to authenticated;

-- ═══════════════════════ §8 · eliminar amigo ═════════════════════════════════
-- payload: { friendship_id }. Cualquiera de los dos; ended_at/ended_by, nunca
-- delete. No toca solicitudes, ambitos, operaciones ni deudas: no hay FK
-- hacia nada de eso. Idempotente por estado.
create function api.remove_friend(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_id    uuid;
  v_f     core.friendship%rowtype;
begin
  perform sec.assert_payload_shape(payload, array['friendship_id']);
  v_id := sec.payload_uuid(payload, 'friendship_id', true);
  perform sec.assert_friend_actor(v_actor, 'elimina amigos');
  select * into v_f from core.friendship f where f.id = v_id;
  if v_f.id is null or v_actor not in (v_f.user_low, v_f.user_high) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la amistad no existe o no eres parte de ella', 403);
  end if;
  perform sec.lock_friend_pair(v_f.user_low, v_f.user_high);
  select * into v_f from core.friendship f where f.id = v_id for update;
  if v_f.ended_at is not null then
    return jsonb_build_object('friendship_id', v_id, 'state', 'ended', 'already_processed', true);
  end if;
  update core.friendship f set ended_at = now(), ended_by = v_actor where f.id = v_id;
  return jsonb_build_object('friendship_id', v_id, 'state', 'ended', 'already_processed', false);
end
$fn$;
comment on function api.remove_friend(jsonb) is
  'F12/ADR-005 §6: terminar una amistad propia (ended_at, ended_by). La instancia queda como historia; una nueva solicitud crea otra. Nada economico ni de grupos cambia.';
grant create on schema api to nomey_provisioner;
alter function api.remove_friend(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.remove_friend(jsonb) from public;
grant execute on function api.remove_friend(jsonb) to authenticated;

-- ═══════════════════════ §9 · el enlace: obtener y rotar ═════════════════════
-- El token nace la primera vez que su dueno lo pide (version 1, sin rotacion).
create function api.my_friend_link()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_l     core.friend_link%rowtype;
begin
  perform sec.assert_friend_actor(v_actor, 'tiene enlace de amistad');
  select * into v_l from core.friend_link l where l.user_id = v_actor;
  if v_l.user_id is null then
    -- dos primeras peticiones a la vez: la segunda pierde el pk y relee
    insert into core.friend_link (user_id, token) values (v_actor, sec.new_invitation_token())
    on conflict (user_id) do nothing;
    select * into v_l from core.friend_link l where l.user_id = v_actor;
  end if;
  return jsonb_build_object('token', v_l.token, 'version', v_l.version, 'rotated_at', v_l.rotated_at);
end
$fn$;
comment on function api.my_friend_link() is
  'F12/ADR-006 §3: el enlace personal PROPIO (token, version, rotated_at). Lo crea si no existe. Solo el dueno; nadie lista tokens.';
grant create on schema api to nomey_provisioner;
alter function api.my_friend_link() owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.my_friend_link() from public;
grant execute on function api.my_friend_link() to authenticated;

-- Rotar: token nuevo, version + 1, el anterior deja de existir en el mismo
-- instante. 5 en 24 h, exactas bajo el cerrojo por cuenta, que es tambien el
-- que respond_friend_link toma antes de reverificar el token: quien este
-- respondiendo con el viejo termina antes, o llega despues y lo encuentra
-- invalido.
create function api.rotate_friend_link()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := sec.request_actor_id();
  v_l      core.friend_link%rowtype;
  v_n      integer;
  v_oldest timestamptz;
  v_token  text;
begin
  perform sec.assert_friend_actor(v_actor, 'rota su enlace de amistad');
  perform sec.lock_friend_budget(v_actor);
  insert into core.friend_link (user_id, token) values (v_actor, sec.new_invitation_token())
  on conflict (user_id) do nothing;
  select count(*), min(x.rotated_at) into v_n, v_oldest from core.friend_link_rotation x
   where x.user_id = v_actor and x.rotated_at > now() - interval '24 hours';
  if v_n >= 5 then
    perform sec.raise_boundary('FRIEND_LINK_ROTATION_LIMITED',
      'has regenerado tu enlace cinco veces en un dia; espera antes de volver a hacerlo', 429,
      jsonb_build_object('retry_at', v_oldest + interval '24 hours'));
  end if;
  select * into v_l from core.friend_link l where l.user_id = v_actor for update;
  v_token := sec.new_invitation_token();
  update core.friend_link l
     set token = v_token, version = v_l.version + 1, rotated_at = now()
   where l.user_id = v_actor
  returning * into v_l;
  insert into core.friend_link_rotation (user_id, version, rotated_at) values (v_actor, v_l.version, v_l.rotated_at);
  return jsonb_build_object('token', v_l.token, 'version', v_l.version, 'rotated_at', v_l.rotated_at);
end
$fn$;
comment on function api.rotate_friend_link() is
  'F12/ADR-006 §4: regenerar el enlace propio. El anterior deja de valer al instante; 5 rotaciones / 24 h (FRIEND_LINK_ROTATION_LIMITED · 429).';
grant create on schema api to nomey_provisioner;
alter function api.rotate_friend_link() owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.rotate_friend_link() from public;
grant execute on function api.rotate_friend_link() to authenticated;

-- ═══════════════════════ §10 · el enlace: previsualizar y responder ══════════
-- SOLO una cuenta normal con handle definitivo resuelve un token (F12/ADR-006
-- §5): sin sesion, anonimo o sin username reciben su codigo ANTES de que el
-- token se mire, asi que el enlace no es una api publica de resolucion de
-- identidad. Estados con 200, nunca excepciones para lo del token, para que
-- el apunte del invalido persista: ok | own | friends | incoming_pending |
-- mutual_pending | invalid | throttled. Solo invalid apunta (20 / 10 min).
create function api.preview_friend_link(p_token text)
returns table (state text, handle text, public_name text, request_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_n     integer;
  v_owner uuid;
  v_rel   record;
  v_i     record;
begin
  perform sec.assert_friend_actor(v_actor, 'abre enlaces de amistad');
  select count(*) into v_n from core.friend_link_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    state := 'throttled'; return next; return;
  end if;
  select l.user_id into v_owner from core.friend_link l where l.token = p_token;
  if v_owner is null then
    insert into core.friend_link_attempt (user_id) values (v_actor);
    delete from core.friend_link_attempt a where a.attempted_at < now() - interval '1 day';
    state := 'invalid'; return next; return;
  end if;
  if v_owner = v_actor then
    state := 'own'; return next; return;
  end if;
  select * into v_i from sec.public_identity(v_owner);
  select * into v_rel from sec.friend_relation(v_actor, v_owner);
  state := case v_rel.relation when 'friends' then 'friends'
                               when 'incoming_pending' then 'incoming_pending'
                               when 'outgoing_pending' then 'mutual_pending'
                               else 'ok' end;
  handle := v_i.handle; public_name := v_i.public_name; request_id := v_rel.request_id;
  return next;
end
$fn$;
comment on function api.preview_friend_link(text) is
  'F12/ADR-006 §5-§6: que dice el enlace de otra cuenta a quien lo abre: su identidad publica ACTUAL y la relacion (ok | friends | incoming_pending: ya me pidio | mutual_pending: yo ya le pedi). own si es el propio; invalid apunta (20 / 10 min → throttled). Exige cuenta normal con handle definitivo. Nunca un uid.';
grant create on schema api to nomey_provisioner;
alter function api.preview_friend_link(text) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.preview_friend_link(text) from public;
grant execute on function api.preview_friend_link(text) to authenticated;

-- payload: { token, action: 'accept' | 'decline' }
-- accept → amistad, reusando la solicitud pendiente que hubiera (§6 de
-- ADR-006): la del dueno hacia mi se acepta (resolution accepted); la mia
-- hacia el dueno se resuelve accepted_via_link, porque las dos voluntades ya
-- existian y la mia no era una aceptacion; sin ninguna, amistad de origen
-- link. decline → rechaza la del dueno hacia mi si existe; si no, no
-- persiste nada (dismissed). El token se reverifica bajo el cerrojo de la
-- pareja con for share: una rotacion concurrente lo bloquea o lo invalida.
create function api.respond_friend_link(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := sec.request_actor_id();
  v_token  text;
  v_action text;
  v_n      integer;
  v_owner  uuid;
  v_rel    record;
  v_f      uuid;
  v_req    uuid;
begin
  perform sec.assert_payload_shape(payload, array['token', 'action']);
  v_token  := sec.payload_text(payload, 'token', true);
  v_action := sec.payload_text(payload, 'action', true);
  if v_action not in ('accept', 'decline') then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'action debe ser accept o decline', 400);
  end if;
  perform sec.assert_friend_actor(v_actor, 'responde a enlaces de amistad');

  select count(*) into v_n from core.friend_link_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    return jsonb_build_object('state', 'throttled', 'already_processed', false);
  end if;
  select l.user_id into v_owner from core.friend_link l where l.token = v_token;
  if v_owner is null then
    insert into core.friend_link_attempt (user_id) values (v_actor);
    delete from core.friend_link_attempt a where a.attempted_at < now() - interval '1 day';
    return jsonb_build_object('state', 'invalid', 'already_processed', false);
  end if;
  if v_owner = v_actor then
    return jsonb_build_object('state', 'own', 'already_processed', false);
  end if;

  perform sec.lock_friend_pair(v_actor, v_owner);
  -- El token, otra vez y bajo el cerrojo del DUENO (el que toma rotar): si
  -- rotaron entre la lectura y el cerrojo, ya no nombra a nadie; si rotan
  -- ahora, esperan a que esto confirme. Un cerrojo consultivo y no for share:
  -- medido en E20, un for share filtrado por la policy de UPDATE del
  -- provisioner (solo la fila propia) devuelve cero filas sin error.
  -- Orden global: pareja → cuenta, el mismo que en create.
  perform sec.lock_friend_budget(v_owner);
  perform 1 from core.friend_link l where l.user_id = v_owner and l.token = v_token;
  if not found then
    return jsonb_build_object('state', 'invalid', 'already_processed', false);
  end if;
  perform sec.expire_friend_requests(v_actor, v_owner);
  select * into v_rel from sec.friend_relation(v_actor, v_owner);

  if v_action = 'decline' then
    if v_rel.relation = 'incoming_pending' then
      update core.friend_request r
         set declined_at = now(), resolved_by = v_actor, resolution = 'declined'
       where r.id = v_rel.request_id;
      return jsonb_build_object('state', 'declined', 'request_id', v_rel.request_id, 'already_processed', false);
    end if;
    return jsonb_build_object('state', 'dismissed', 'already_processed', false);
  end if;

  if v_rel.relation = 'friends' then
    select f.id into v_f from core.friendship f
     where f.user_low = least(v_actor, v_owner) and f.user_high = greatest(v_actor, v_owner) and f.ended_at is null;
    return jsonb_build_object('state', 'friends', 'friendship_id', v_f, 'already_processed', true);
  end if;
  v_req := v_rel.request_id;
  if v_rel.relation = 'incoming_pending' then
    update core.friend_request r
       set accepted_at = now(), resolved_by = v_actor, resolution = 'accepted'
     where r.id = v_req;
    insert into core.friendship (user_low, user_high, created_by, origin, origin_request_id)
    values (least(v_actor, v_owner), greatest(v_actor, v_owner), v_actor, 'request', v_req)
    returning id into v_f;
  elsif v_rel.relation = 'outgoing_pending' then
    update core.friend_request r
       set accepted_at = now(), resolved_by = v_actor, resolution = 'accepted_via_link'
     where r.id = v_req;
    insert into core.friendship (user_low, user_high, created_by, origin, origin_request_id)
    values (least(v_actor, v_owner), greatest(v_actor, v_owner), v_actor, 'link', v_req)
    returning id into v_f;
  else
    -- none o cooldown: el enlace es la voluntad del dueno, asi que el
    -- cooldown (del actor hacia el dueno) no aplica aqui
    insert into core.friendship (user_low, user_high, created_by, origin)
    values (least(v_actor, v_owner), greatest(v_actor, v_owner), v_actor, 'link')
    returning id into v_f;
  end if;
  return jsonb_build_object('state', 'friends', 'friendship_id', v_f, 'request_id', v_req, 'already_processed', false);
end
$fn$;
comment on function api.respond_friend_link(jsonb) is
  'F12/ADR-006 §6: responder al enlace de otra cuenta. accept → friends (reusando la solicitud pendiente: la suya se acepta; la mia se resuelve accepted_via_link); decline → declined si habia solicitud suya, dismissed si no. own | invalid (apunta) | throttled como estados. Exige cuenta normal con handle definitivo.';
grant create on schema api to nomey_provisioner;
alter function api.respond_friend_link(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.respond_friend_link(jsonb) from public;
grant execute on function api.respond_friend_link(jsonb) to authenticated;

-- ═══════════════════════ §11 · leer ══════════════════════════════════════════
-- Definers REDUCIDOS del provisioner, filtrados por el actor en su cuerpo y,
-- ademas, por sus policies: son la frontera de privacidad de las vistas.
-- Publican la identidad publica ACTUAL de la contraparte (F12/ADR-001 §13) y
-- nunca un uid. authenticated no tiene NINGUN grant sobre core.friend*.
create function sec.my_friend_rows()
returns table (friendship_id uuid, counterpart_handle text, counterpart_public_name text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select f.id, i.handle, i.public_name, f.created_at
    from core.friendship f
    left join lateral sec.public_identity(
      case when f.user_low = sec.request_actor_id() then f.user_high else f.user_low end) i on true
   where f.ended_at is null
     and sec.request_actor_id() in (f.user_low, f.user_high);
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.my_friend_rows() owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.my_friend_rows() from public;
grant execute on function sec.my_friend_rows() to authenticated;

create function sec.my_friend_request_rows()
returns table (request_id uuid, direction text, counterpart_handle text, counterpart_public_name text,
               created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id,
         case when r.requester_user_id = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name, r.created_at, r.expires_at
    from core.friend_request r
    left join lateral sec.public_identity(
      case when r.requester_user_id = sec.request_actor_id() then r.target_user_id else r.requester_user_id end) i on true
   where sec.request_actor_id() in (r.requester_user_id, r.target_user_id)
     and sec.friend_request_state(r.accepted_at, r.declined_at, r.cancelled_at, r.expired_at, r.expires_at) = 'pending';
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.my_friend_request_rows() owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.my_friend_request_rows() from public;
grant execute on function sec.my_friend_request_rows() to authenticated;

create view api.my_friends
with (security_invoker = true) as
select friendship_id, counterpart_handle, counterpart_public_name, since
  from sec.my_friend_rows();
comment on view api.my_friends is
  'F12/ADR-005 §2: los amigos ACTIVOS del actor, con su identidad publica actual. Sin uid ni correo; sin historia.';
grant select on api.my_friends to authenticated;

create view api.my_friend_requests
with (security_invoker = true) as
select request_id, direction, counterpart_handle, counterpart_public_name, created_at, expires_at
  from sec.my_friend_request_rows();
comment on view api.my_friend_requests is
  'F12/ADR-005 §3: las solicitudes PENDIENTES del actor, en las dos direcciones. Las terminales no se publican.';
grant select on api.my_friend_requests to authenticated;
