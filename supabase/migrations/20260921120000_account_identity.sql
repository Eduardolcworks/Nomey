-- ============================================================================
-- IDENTIDAD PUBLICA DE LA CUENTA: username, nombre publico y resolver.
-- F12/ADR-001 (F12.A1). Modelo, ciclo de vida y resolucion; SIN el hook de
-- alta (F12.A2) y SIN cliente (F12.A3): nada de la app consume esto todavia.
-- ============================================================================
--
-- Lo que hay:
--
--   core.reserved_handle          25 exactos y 4 prefijos (ADR-001 §4), los
--                                 mismos de tests/vectors/username.json
--   core.account_identity         1:1 con la cuenta: public_name y la fecha
--                                 del ultimo cambio de handle (cooldown)
--   core.account_handle           una fila por handle: reserva, definitivo,
--                                 retenido. El estado se DERIVA de las marcas
--   core.account_handle_event     diario insert-only de lo que paso con cada
--                                 handle: el historial que ADR-001 §2 y §9
--                                 exigen conservar, aunque la fila viva se
--                                 desaloje
--   core.username_lookup_attempt  apuntes del freno del resolver: quien y
--                                 cuando, NUNCA el handle consultado (§12)
--
--   sec.normalize_handle          NFKC → recorte → «@» → ASCII → minusculas →
--                                 forma y longitud; null si no nombra nada
--   sec.assert_handle_valid       lo anterior + reservados, o lanza
--   sec.evict_expired_handle      desalojo perezoso de reservas caducadas y
--                                 retenciones vencidas (§6, §9)
--   sec.account_handle_state      la fila propia tal y como la ve la vista
--   sec.public_identity(uid)      «uid → identidad actual» para el writer y
--                                 el provisioner (§13); el cliente no la llama
--   api.reserve_username          reservar (anonimo o normal); normal reclama
--                                 en el acto; con definitivo, solo el mismo
--   api.claim_username            hacer definitiva la reserva viva
--   api.change_username           cambiar: cooldown 30 dias, retencion 90
--   api.set_public_name           el nombre publico, primero en core (§10)
--   api.resolve_username          found | not_found | self | throttled (§11)
--   api.my_account_handle         la fila propia; sin historial
--
-- Propietario de TODO lo nuevo: nomey_provisioner, sin BYPASSRLS. Ninguna
-- funcion nueva es de postgres: las de `sec` que leen todas las identidades
-- (resolver, public_identity) lo hacen bajo una politica de SELECT del
-- provisioner con USING (true), medida, y no cruzando RLS por propiedad. Las
-- escrituras del provisioner son sobre la cuenta propia, con dos excepciones
-- acotadas en la politica: desalojar una reserva CADUCADA o una retencion
-- VENCIDA de cualquiera (§6, §9), y apuntar en el diario un desalojo ajeno
-- (actor_user_id sigue siendo el actor).
--
-- Precisiones a ADR-001 que este bloque fija (docs/adr/F12/README.md):
--   · public_name vive en core.account_identity (1:1), no en la fila del
--     handle: un handle no lleva instantaneas del nombre.
--   · reserve_username admite una sesion ANONIMA solo para reservar
--     (Invitado → cuenta, F12.A2/A3); reclamar, cambiar y resolver exigen una
--     cuenta normal (NOT_AUTHORIZED · 403).
--   · reserva caducada al reclamar → USERNAME_REQUIRED (no existe
--     USERNAME_RESERVATION_EXPIRED); reclamar ya reclamado → estado, sin
--     error (no existe USERNAME_ALREADY_SET).
--   · resolve_username exige que el ACTOR tenga handle definitivo (§14).
--   · resolve_username es definer de nomey_provisioner, no de postgres.

-- ═══════════════════════ §1 · reservados ═════════════════════════════════════
create table core.reserved_handle (
  handle text primary key,
  kind   text not null,
  constraint reserved_handle_tipo  check (kind in ('exact', 'prefix')),
  constraint reserved_handle_forma check (handle ~ '^[a-z](_?[a-z0-9])*$' and length(handle) between 3 and 20)
);
comment on table core.reserved_handle is
  'F12/ADR-001 §4: handles que nadie puede tomar. exact bloquea el handle entero; prefix, todo lo que empiece por el. Sembrado por migracion, gemelo de tests/vectors/username.json.';
alter table core.reserved_handle enable row level security;
grant select on core.reserved_handle to nomey_provisioner;
create policy reserved_handle_provisioner_select on core.reserved_handle
  for select to nomey_provisioner using (true);

insert into core.reserved_handle (handle, kind) values
  ('help', 'exact'), ('ayuda', 'exact'), ('security', 'exact'), ('seguridad', 'exact'),
  ('staff', 'exact'), ('team', 'exact'), ('equipo', 'exact'), ('official', 'exact'), ('oficial', 'exact'),
  ('verified', 'exact'), ('verificado', 'exact'), ('root', 'exact'), ('system', 'exact'), ('sistema', 'exact'),
  ('join', 'exact'), ('pay', 'exact'), ('auth', 'exact'), ('recovery', 'exact'), ('api', 'exact'), ('app', 'exact'),
  ('null', 'exact'), ('anonymous', 'exact'), ('anonimo', 'exact'), ('invitado', 'exact'), ('guest', 'exact'),
  ('nomey', 'prefix'), ('admin', 'prefix'), ('support', 'prefix'), ('soporte', 'prefix');

-- ═══════════════════════ §2 · identidad publica (1:1) ════════════════════════
create table core.account_identity (
  user_id           uuid primary key,
  public_name       text not null,
  handle_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint account_identity_nombre check (public_name = btrim(public_name) and length(public_name) between 1 and 80)
);
comment on table core.account_identity is
  'F12/ADR-001 §10: el nombre publico de una cuenta, autoritativo para terceros, y la fecha del ultimo cambio de handle (cooldown §9). Una fila por cuenta; sin FK a auth.users, como todo core.';
comment on column core.account_identity.handle_changed_at is
  'Ultimo cambio de username (§9). Nulo hasta el primer cambio: reclamar no es cambiar.';
alter table core.account_identity enable row level security;
grant select, insert on core.account_identity to nomey_provisioner;
grant update (public_name, handle_changed_at, updated_at) on core.account_identity to nomey_provisioner;
grant select on core.account_identity to authenticated;
-- El provisioner lee TODAS: el resolver (§11) y public_identity (§13) resuelven
-- a terceros bajo esta politica, y cada funcion publica solo handle y nombre.
create policy account_identity_provisioner_select on core.account_identity
  for select to nomey_provisioner using (true);
create policy account_identity_provisioner_insert on core.account_identity
  for insert to nomey_provisioner with check (user_id = sec.request_actor_id());
create policy account_identity_provisioner_update on core.account_identity
  for update to nomey_provisioner
  using (user_id = sec.request_actor_id()) with check (user_id = sec.request_actor_id());
-- El cliente, solo la suya, a traves de api.my_account_handle. auth.uid() y no
-- sec.request_actor_id(): el cliente no ejecuta sec, como en el resto de las
-- politicas de lectura del cliente.
create policy account_identity_client_select on core.account_identity
  for select to authenticated using (user_id = (select auth.uid()));
-- El writer no la lee: llama a sec.public_identity, que corre como provisioner.

-- ═══════════════════════ §3 · handles ════════════════════════════════════════
create table core.account_handle (
  handle         text primary key,
  user_id        uuid not null,
  reserved_at    timestamptz not null default now(),
  reserved_until timestamptz,
  claimed_at     timestamptz,
  released_at    timestamptz,
  held_until     timestamptz,
  constraint account_handle_forma check (handle ~ '^[a-z](_?[a-z0-9])*$' and length(handle) between 3 and 20),
  -- reserva provisional ⇔ sin reclamar
  constraint account_handle_reserva check ((claimed_at is null) = (reserved_until is not null)),
  constraint account_handle_reserva_posterior check (reserved_until is null or reserved_until > reserved_at),
  -- retencion ⇔ liberado; y solo se libera lo definitivo (una reserva se sustituye o se desaloja)
  constraint account_handle_retencion check ((released_at is null) = (held_until is null)),
  constraint account_handle_liberado_definitivo check (released_at is null or claimed_at is not null),
  constraint account_handle_retencion_posterior check (held_until is null or held_until > released_at)
);
comment on table core.account_handle is
  'F12/ADR-001 §2: una fila por handle. Estado DERIVADO de las marcas: reservada (claimed_at nulo), definitiva (claimed_at, released_at nulo), retenida (released_at), caducada (reserva con reserved_until < now()), liberable (held_until < now()). El indice unico del handle arbitra las tres a la vez.';
-- Una cuenta tiene un solo handle vivo (reservado o definitivo).
create unique index account_handle_una_viva_por_cuenta on core.account_handle (user_id) where released_at is null;
create index account_handle_cuenta_idx on core.account_handle (user_id);
alter table core.account_handle enable row level security;
grant select, insert, delete on core.account_handle to nomey_provisioner;
grant update (reserved_until, claimed_at, released_at, held_until) on core.account_handle to nomey_provisioner;
grant select on core.account_handle to authenticated;
create policy account_handle_provisioner_select on core.account_handle
  for select to nomey_provisioner using (true);
create policy account_handle_provisioner_insert on core.account_handle
  for insert to nomey_provisioner with check (user_id = sec.request_actor_id());
create policy account_handle_provisioner_update on core.account_handle
  for update to nomey_provisioner
  using (user_id = sec.request_actor_id()) with check (user_id = sec.request_actor_id());
-- Borrar: la reserva propia sin reclamar (sustituirla), una reserva CADUCADA
-- de cualquiera o una retencion VENCIDA de cualquiera. Nada definitivo y
-- vigente se borra jamas, ni propio ni ajeno.
create policy account_handle_provisioner_delete on core.account_handle
  for delete to nomey_provisioner
  using ((claimed_at is null and user_id = sec.request_actor_id())
      or (claimed_at is null and reserved_until < now())
      or (released_at is not null and held_until < now()));
create policy account_handle_client_select on core.account_handle
  for select to authenticated using (user_id = (select auth.uid()));

-- ═══════════════════════ §4 · diario ═════════════════════════════════════════
create table core.account_handle_event (
  id            bigint generated always as identity primary key,
  handle        text not null,
  user_id       uuid not null,
  event         text not null,
  actor_user_id uuid not null,
  occurred_at   timestamptz not null default now(),
  constraint account_handle_event_tipo check (event in ('reserved', 'replaced', 'claimed', 'released', 'recovered', 'evicted'))
);
comment on table core.account_handle_event is
  'F12/ADR-001 §2, §9: que paso con cada handle y de quien era. Insert-only: el historial de handles de una cuenta, para retencion, auditoria y soporte. Nunca se publica como identidad historica en movimientos (§13).';
alter table core.account_handle_event enable row level security;
grant insert on core.account_handle_event to nomey_provisioner;
create policy account_handle_event_provisioner_insert on core.account_handle_event
  for insert to nomey_provisioner with check (actor_user_id = sec.request_actor_id());

-- ═══════════════════════ §5 · freno del resolver ═════════════════════════════
create table core.username_lookup_attempt (
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);
comment on table core.username_lookup_attempt is
  'F12/ADR-001 §12: una consulta del resolver que cuenta (found o not_found). Quien y cuando; el handle consultado no se guarda nunca.';
create index username_lookup_attempt_user_idx on core.username_lookup_attempt (user_id, attempted_at desc);
alter table core.username_lookup_attempt enable row level security;
grant select, insert, delete on core.username_lookup_attempt to nomey_provisioner;
-- Lee los propios (el conteo del freno) y los de mas de un dia de cualquiera:
-- un DELETE con WHERE pasa tambien por la politica de SELECT, y sin esa
-- segunda rama la poda solo alcanzaria a los apuntes del propio actor.
create policy username_lookup_attempt_provisioner_select on core.username_lookup_attempt
  for select to nomey_provisioner
  using (user_id = sec.request_actor_id() or attempted_at < now() - interval '1 day');
create policy username_lookup_attempt_provisioner_insert on core.username_lookup_attempt
  for insert to nomey_provisioner with check (user_id = sec.request_actor_id());
create policy username_lookup_attempt_provisioner_prune on core.username_lookup_attempt
  for delete to nomey_provisioner using (attempted_at < now() - interval '1 day');

-- ═══════════════════════ §6 · sintaxis (sec) ═════════════════════════════════
-- Gemela de normalizeHandle en src/domain/username/handle.ts, sobre
-- tests/vectors/username.json. El orden importa: la comprobacion ASCII va
-- ANTES de lower() para que `İ` o `ß` no dependan del locale.
create function sec.normalize_handle(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_raw is null then return null; end if;
  -- los blancos ASCII que String.prototype.trim y este recorte comparten tras
  -- NFKC (que ya plego NBSP y el espacio ideografico a espacio): sin \s, que
  -- depende del locale para lo que no es ASCII
  v := regexp_replace(normalize(p_raw, nfkc), E'^[ \t\n\r\f\x0b]+|[ \t\n\r\f\x0b]+$', '', 'g');
  if left(v, 1) = '@' then v := substr(v, 2); end if;
  if v !~ '^[A-Za-z0-9_]+$' then return null; end if;
  v := lower(v);
  if length(v) not between 3 and 20 or v !~ '^[a-z](_?[a-z0-9])*$' then return null; end if;
  return v;
end
$fn$;
comment on function sec.normalize_handle(text) is
  'F12/ADR-001 §3: la forma almacenada de un handle, o null si no nombra nada. NFKC, sin transliterar; ASCII antes de minusculas.';
grant create on schema sec to nomey_provisioner;
alter function sec.normalize_handle(text) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.normalize_handle(text) from public;
grant execute on function sec.normalize_handle(text) to nomey_provisioner;

-- Normaliza y rehusa: USERNAME_INVALID · 400 o USERNAME_RESERVED · 422.
create function sec.assert_handle_valid(p_raw text)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v text := sec.normalize_handle(p_raw);
begin
  if v is null then
    perform sec.raise_boundary('USERNAME_INVALID',
      'el username empieza por letra, usa a-z, 0-9 y _ (nunca doble, ni al principio ni al final), y mide de 3 a 20', 400);
  end if;
  if exists (select 1 from core.reserved_handle r
              where (r.kind = 'exact' and r.handle = v)
                 or (r.kind = 'prefix' and left(v, length(r.handle)) = r.handle)) then
    perform sec.raise_boundary('USERNAME_RESERVED', 'ese username esta reservado', 422,
                               jsonb_build_object('handle', v));
  end if;
  return v;
end
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.assert_handle_valid(text) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.assert_handle_valid(text) from public;
grant execute on function sec.assert_handle_valid(text) to nomey_provisioner;

-- ═══════════════════════ §7 · desalojo perezoso ══════════════════════════════
-- Retira la fila de ese handle si es una reserva caducada o una retencion
-- vencida, y lo apunta en el diario. La politica de DELETE es la que decide:
-- una fila definitiva vigente, o una reserva viva ajena, no se toca aunque el
-- cuerpo lo pidiera. Devuelve si desalojo algo.
create function sec.evict_expired_handle(p_handle text)
returns boolean
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_owner uuid;
begin
  delete from core.account_handle h
   where h.handle = p_handle
     and ((h.claimed_at is null and h.reserved_until < now())
       or (h.released_at is not null and h.held_until < now()))
  returning h.user_id into v_owner;
  if v_owner is null then return false; end if;
  insert into core.account_handle_event (handle, user_id, event, actor_user_id)
  values (p_handle, v_owner, 'evicted', sec.request_actor_id());
  return true;
end
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.evict_expired_handle(text) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.evict_expired_handle(text) from public;
grant execute on function sec.evict_expired_handle(text) to nomey_provisioner;

-- ═══════════════════════ §8 · el estado propio ═══════════════════════════════
-- Lo que devuelven los comandos y lo que publica la vista: una fila si la
-- cuenta tiene identidad; handle nulo si no tiene ninguno vivo.
create function sec.account_handle_state(p_user uuid)
returns table (handle text, public_name text, state text, reserved_until timestamptz, can_change_at timestamptz)
language sql
stable
set search_path = ''
as $fn$
  select h.handle,
         i.public_name,
         case when h.handle is null then null
              when h.claimed_at is null then 'reserved'
              else 'claimed' end,
         h.reserved_until,
         case when h.claimed_at is null then null
              else coalesce(i.handle_changed_at + interval '30 days', h.claimed_at) end
    from core.account_identity i
    left join core.account_handle h on h.user_id = i.user_id and h.released_at is null
   where i.user_id = p_user;
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.account_handle_state(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.account_handle_state(uuid) from public;
grant execute on function sec.account_handle_state(uuid) to nomey_provisioner;

-- ═══════════════════════ §9 · uid → identidad actual ═════════════════════════
-- ADR-001 §13: toda lectura historica ensena la identidad ACTUAL del uid.
-- Definer del provisioner: corre bajo su SELECT USING (true) y publica SOLO
-- nombre y handle activo (nunca uno liberado, nunca una reserva). Para el
-- writer y el provisioner; el cliente no la ejecuta.
create function sec.public_identity(p_user uuid)
returns table (public_name text, handle text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select i.public_name, h.handle
    from core.account_identity i
    left join core.account_handle h
      on h.user_id = i.user_id and h.released_at is null and h.claimed_at is not null
   where i.user_id = p_user;
$fn$;
comment on function sec.public_identity(uuid) is
  'F12/ADR-001 §13: la identidad publica ACTUAL de una cuenta (nombre y handle definitivo, o nombre solo). Su lista de columnas es la frontera de privacidad.';
grant create on schema sec to nomey_provisioner;
alter function sec.public_identity(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.public_identity(uuid) from public;
grant execute on function sec.public_identity(uuid) to nomey_writer, nomey_provisioner;

-- ═══════════════════════ §10 · reservar ══════════════════════════════════════
-- payload: { handle, public_name? }. public_name es obligatorio la primera
-- vez (la cuenta aun no tiene identidad); despues, si viene, la actualiza.
--
-- Sesion anonima (Invitado → cuenta): solo reserva, 7 dias. Cuenta normal:
-- reserva y reclama en el acto. Idempotente por estado: pedir el handle que
-- ya se tiene devuelve el estado sin escribir nada; una reserva viva propia se
-- sustituye por la nueva (replaced). Con un handle DEFINITIVO, pedir otro no
-- es reservar sino cambiar, y el comando para eso es change_username:
-- PAYLOAD_INVALID · 400.
create function api.reserve_username(payload jsonb)
returns table (handle text, public_name text, state text, reserved_until timestamptz, can_change_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := sec.request_actor_id();
  v_guest  boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_handle text;
  v_name   text;
  v_live   core.account_handle%rowtype;
begin
  perform sec.assert_payload_shape(payload, array['handle', 'public_name']);
  v_handle := sec.assert_handle_valid(sec.payload_text(payload, 'handle', true));
  v_name   := sec.payload_text(payload, 'public_name', false);

  if v_name is not null then
    v_name := sec.canonical_display_name(v_name);
    insert into core.account_identity (user_id, public_name) values (v_actor, v_name)
    on conflict (user_id) do update set public_name = excluded.public_name, updated_at = now()
     where account_identity.public_name is distinct from excluded.public_name;
  elsif not exists (select 1 from core.account_identity i where i.user_id = v_actor) then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'la primera reserva necesita public_name', 400);
  end if;

  select * into v_live from core.account_handle h where h.user_id = v_actor and h.released_at is null;

  if v_live.handle is not null and v_live.claimed_at is not null then
    -- definitivo: el mismo handle es un exito idempotente (nada se escribe,
    -- ni evento ni cooldown); otro handle NO es una reserva sino un cambio, y
    -- el comando para eso es change_username: PAYLOAD_INVALID, sin codigo nuevo.
    if v_live.handle <> v_handle then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'la cuenta ya tiene un username definitivo; para cambiarlo existe change_username', 400,
        jsonb_build_object('handle', v_live.handle));
    end if;
    return query select * from sec.account_handle_state(v_actor);
    return;
  end if;

  if v_live.handle is not null and v_live.handle = v_handle then
    if v_guest then
      return query select * from sec.account_handle_state(v_actor);
      return;
    end if;
    -- normal con su propia reserva viva del mismo handle: la reclama
    update core.account_handle h set claimed_at = now(), reserved_until = null where h.handle = v_handle;
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_actor, 'claimed', v_actor);
    return query select * from sec.account_handle_state(v_actor);
    return;
  end if;

  if v_live.handle is not null then
    delete from core.account_handle h where h.handle = v_live.handle;
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_live.handle, v_actor, 'replaced', v_actor);
  end if;

  perform sec.evict_expired_handle(v_handle);

  begin
    if v_guest then
      insert into core.account_handle (handle, user_id, reserved_until) values (v_handle, v_actor, now() + interval '7 days');
      insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_actor, 'reserved', v_actor);
    else
      insert into core.account_handle (handle, user_id, claimed_at) values (v_handle, v_actor, now());
      insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_actor, 'reserved', v_actor);
      insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_actor, 'claimed', v_actor);
    end if;
  exception when unique_violation then
    perform sec.raise_boundary('USERNAME_TAKEN', 'ese username ya esta en uso', 409, jsonb_build_object('handle', v_handle));
  end;

  return query select * from sec.account_handle_state(v_actor);
end
$fn$;
comment on function api.reserve_username(jsonb) is
  'F12/ADR-001 §6-§8: reservar un username. Anonimo: reserva provisional de 7 dias. Normal: reserva y reclama. Idempotente por estado; sustituye la reserva viva propia.';
grant create on schema api to nomey_provisioner;
alter function api.reserve_username(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.reserve_username(jsonb) from public;
grant execute on function api.reserve_username(jsonb) to authenticated;

-- ═══════════════════════ §11 · reclamar ══════════════════════════════════════
-- Sin argumentos: la reserva viva del actor. Anonimo → NOT_AUTHORIZED · 403.
-- Sin reserva, o caducada → USERNAME_REQUIRED · 409 (la app ensena el gate).
-- Ya definitivo → el estado, sin error.
create function api.claim_username()
returns table (handle text, public_name text, state text, reserved_until timestamptz, can_change_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_guest boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_live  core.account_handle%rowtype;
begin
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no puede reclamar un username', 403);
  end if;
  select * into v_live from core.account_handle h where h.user_id = v_actor and h.released_at is null for update;
  if v_live.handle is null or (v_live.claimed_at is null and v_live.reserved_until < now()) then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'la cuenta no tiene ninguna reserva de username vigente', 409);
  end if;
  if v_live.claimed_at is null then
    update core.account_handle h set claimed_at = now(), reserved_until = null where h.handle = v_live.handle;
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_live.handle, v_actor, 'claimed', v_actor);
  end if;
  return query select * from sec.account_handle_state(v_actor);
end
$fn$;
comment on function api.claim_username() is
  'F12/ADR-001 §7: hacer definitiva la reserva viva del actor. Idempotente por estado.';
grant create on schema api to nomey_provisioner;
alter function api.claim_username() owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.claim_username() from public;
grant execute on function api.claim_username() to authenticated;

-- ═══════════════════════ §12 · cambiar ═══════════════════════════════════════
-- payload: { handle }. Exige handle definitivo (USERNAME_REQUIRED · 409) y
-- cuenta normal. Cooldown de 30 dias desde el ultimo cambio
-- (USERNAME_CHANGE_COOLDOWN · 409, details.available_at). El anterior queda
-- liberado y retenido 90 dias. Recuperar un handle propio retenido es un
-- cambio mas (cuenta para el cooldown) y reactiva la misma fila.
create function api.change_username(payload jsonb)
returns table (handle text, public_name text, state text, reserved_until timestamptz, can_change_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := sec.request_actor_id();
  v_guest    boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_handle   text;
  v_live     core.account_handle%rowtype;
  v_target   core.account_handle%rowtype;
  v_changed  timestamptz;
begin
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no puede cambiar de username', 403);
  end if;
  perform sec.assert_payload_shape(payload, array['handle']);
  v_handle := sec.assert_handle_valid(sec.payload_text(payload, 'handle', true));

  -- Primero el cerrojo sobre la identidad, DESPUES la lectura del handle: dos
  -- cambios simultaneos de la misma cuenta se serializan aqui y el segundo lee
  -- el estado que dejo el primero (READ COMMITTED: instantanea nueva por
  -- sentencia), asi que recibe el cooldown y no un USERNAME_REQUIRED falso.
  select i.handle_changed_at into v_changed from core.account_identity i where i.user_id = v_actor for update;
  if not found then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'cambiar de username exige tener uno definitivo', 409);
  end if;
  select * into v_live from core.account_handle h where h.user_id = v_actor and h.released_at is null;
  if v_live.handle is null or v_live.claimed_at is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'cambiar de username exige tener uno definitivo', 409);
  end if;
  if v_live.handle = v_handle then
    return query select * from sec.account_handle_state(v_actor);
    return;
  end if;

  if v_changed is not null and v_changed + interval '30 days' > now() then
    perform sec.raise_boundary('USERNAME_CHANGE_COOLDOWN', 'el username se cambio hace menos de 30 dias', 409,
                               jsonb_build_object('available_at', v_changed + interval '30 days'));
  end if;

  -- sin FOR UPDATE: el cerrojo exigiria la politica de UPDATE del provisioner
  -- (solo filas propias) y ocultaria la fila ajena; la carrera la arbitra el
  -- indice unico en el INSERT
  select * into v_target from core.account_handle h where h.handle = v_handle;
  if v_target.handle is not null and v_target.user_id = v_actor and v_target.released_at is not null then
    -- recuperar el propio retenido: liberar el vigente y reactivar la fila antigua
    update core.account_handle h set released_at = now(), held_until = now() + interval '90 days' where h.handle = v_live.handle;
    update core.account_handle h set released_at = null, held_until = null where h.handle = v_handle;
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_live.handle, v_actor, 'released', v_actor);
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_actor, 'recovered', v_actor);
  else
    if v_target.handle is not null then
      perform sec.evict_expired_handle(v_handle);
    end if;
    update core.account_handle h set released_at = now(), held_until = now() + interval '90 days' where h.handle = v_live.handle;
    begin
      insert into core.account_handle (handle, user_id, claimed_at) values (v_handle, v_actor, now());
    exception when unique_violation then
      perform sec.raise_boundary('USERNAME_TAKEN', 'ese username ya esta en uso', 409, jsonb_build_object('handle', v_handle));
    end;
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_live.handle, v_actor, 'released', v_actor);
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_actor, 'claimed', v_actor);
  end if;

  update core.account_identity i set handle_changed_at = now(), updated_at = now() where i.user_id = v_actor;
  return query select * from sec.account_handle_state(v_actor);
end
$fn$;
comment on function api.change_username(jsonb) is
  'F12/ADR-001 §9: cambiar de username. Cooldown 30 dias, retencion 90; recuperar el propio retenido cuenta como cambio.';
grant create on schema api to nomey_provisioner;
alter function api.change_username(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.change_username(jsonb) from public;
grant execute on function api.change_username(jsonb) to authenticated;

-- ═══════════════════════ §13 · nombre publico ════════════════════════════════
-- payload: { public_name }. Primero core, despues la metadata de Auth (la app,
-- F12.A3). No es unico, no es identidad, no deja historial.
create function api.set_public_name(payload jsonb)
returns table (handle text, public_name text, state text, reserved_until timestamptz, can_change_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_guest boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_name  text;
begin
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no tiene nombre publico', 403);
  end if;
  perform sec.assert_payload_shape(payload, array['public_name']);
  v_name := sec.canonical_display_name(sec.payload_text(payload, 'public_name', true));
  insert into core.account_identity (user_id, public_name) values (v_actor, v_name)
  on conflict (user_id) do update set public_name = excluded.public_name, updated_at = now();
  return query select * from sec.account_handle_state(v_actor);
end
$fn$;
comment on function api.set_public_name(jsonb) is
  'F12/ADR-001 §10: el nombre publico de la cuenta propia, autoritativo para terceros.';
grant create on schema api to nomey_provisioner;
alter function api.set_public_name(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.set_public_name(jsonb) from public;
grant execute on function api.set_public_name(jsonb) to authenticated;

-- ═══════════════════════ §14 · resolver ══════════════════════════════════════
-- Estado, no excepcion (patron sec.resolve_invitation): el apunte del freno
-- debe quedar confirmado. Exige cuenta normal (NOT_AUTHORIZED · 403) con
-- handle definitivo (USERNAME_REQUIRED · 409): quien no puede recibir no
-- pregunta. Cuentan found y not_found; self no cuenta y throttled no apunta.
-- Nunca devuelve uid, scope ni correo: la lista de columnas es la frontera.
create function api.resolve_username(p_handle text)
returns table (state text, handle text, public_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := sec.request_actor_id();
  v_guest  boolean := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_handle text;
  v_n      integer;
  v_uid    uuid;
  v_found  text;
  v_name   text;
begin
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no resuelve usernames', 403);
  end if;
  if not exists (select 1 from core.account_handle h
                  where h.user_id = v_actor and h.released_at is null and h.claimed_at is not null) then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'resolver un username exige tener el propio', 409);
  end if;

  select count(*) into v_n from core.username_lookup_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    state := 'throttled'; return next; return;
  end if;

  v_handle := sec.normalize_handle(p_handle);
  if v_handle is not null then
    select h.user_id, h.handle, i.public_name into v_uid, v_found, v_name
      from core.account_handle h
      join core.account_identity i on i.user_id = h.user_id
     where h.handle = v_handle and h.claimed_at is not null and h.released_at is null;
    if v_uid = v_actor then
      state := 'self'; return next; return;
    end if;
  end if;

  insert into core.username_lookup_attempt (user_id) values (v_actor);
  delete from core.username_lookup_attempt a where a.attempted_at < now() - interval '1 day';

  if v_uid is null then
    state := 'not_found'; return next; return;
  end if;
  state := 'found'; handle := v_found; public_name := v_name;
  return next;
end
$fn$;
comment on function api.resolve_username(text) is
  'F12/ADR-001 §11-§12: resolucion exacta de un username a handle y nombre publico. found | not_found | self | throttled; 20 consultas / 10 min por cuenta; nunca un identificador interno.';
grant create on schema api to nomey_provisioner;
alter function api.resolve_username(text) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.resolve_username(text) from public;
grant execute on function api.resolve_username(text) to authenticated;

-- ═══════════════════════ §15 · la fila propia ════════════════════════════════
create view api.my_account_handle
with (security_invoker = true) as
select h.handle,
       i.public_name,
       case when h.handle is null then null
            when h.claimed_at is null then 'reserved'
            else 'claimed' end as state,
       h.reserved_until,
       case when h.claimed_at is null then null
            else coalesce(i.handle_changed_at + interval '30 days', h.claimed_at) end as can_change_at
  from core.account_identity i
  left join core.account_handle h on h.user_id = i.user_id and h.released_at is null
 where i.user_id = (select auth.uid());
comment on view api.my_account_handle is
  'F12/ADR-001 §2: la identidad publica propia. Una fila si la cuenta tiene identidad; handle nulo si no tiene ninguno vivo. Sin historial.';
grant select on api.my_account_handle to authenticated;
