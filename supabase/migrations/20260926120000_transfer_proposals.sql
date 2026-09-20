-- ============================================================================
-- TRANSFERENCIAS ENTRE USUARIOS CON DOS VOLUNTADES: la propuesta y la
-- internal_transfer que la materializa. F12/ADR-002 (F12.B1).
--
-- SOLO la clase internal_transfer. La transferencia dentro de un grupo
-- (F12/ADR-003, settlement_by_transfer) y la solicitud de pago por enlace
-- (F12/ADR-004) llegan en sus propios bloques (B3 y B2); aqui nada las toca:
-- record_settlement_by_transfer conserva su contrato de F3 intacto.
-- ============================================================================
--
-- Lo que hay:
--
--   core.transfer_proposal        la intencion dirigida (ADR-002 §6): emisor,
--                                 receptor resuelto UNA vez, importe, moneda,
--                                 concepto, 7 dias; marcas terminales
--                                 excluyentes; estado DERIVADO (§8)
--   core.transfer_part            las partes de cada version de registro de
--                                 una internal_transfer (§14): Personal de
--                                 salida y de entrada, patron payment_detail
--
--   sec.transfer_proposal_state   pending | accepted | declined | cancelled |
--                                 expired, de las marcas y de now()
--   sec.lock_proposal_budget      cerrojo transaccional por EMISOR
--   sec.assert_proposal_budget    10 creadas / 60 min o PROPOSAL_RATE_LIMITED,
--                                 contadas bajo ese cerrojo: exacto, sin ±1
--   sec.handle_owner              handle definitivo y activo → uid; el
--                                 cliente nunca manda un uid ni lo recibe
--   sec.has_personal_scope        ¿tiene esa cuenta un Modo Personal? La unica
--                                 pregunta sobre un ambito AJENO que el
--                                 provisioner necesita, y la contesta el writer
--   sec.my_transfer_counterparts  la contraparte de cada propuesta propia como
--                                 identidad publica ACTUAL (F12/ADR-001 §13)
--
--   api.create_transfer_proposal  A propone a @handle (§4, §5, §18)
--   api.cancel_transfer_proposal  solo created_by, mientras pending
--   api.decline_transfer_proposal solo target_user_id, mientras pending
--   api.record_internal_transfer  RECREADA (§11, §16): el payload es la
--                                 propuesta; una sola version; ni correccion
--                                 ni anulacion
--   sec.persist_version           RECREADA: internal_transfer no admite
--                                 version nueva (TRANSFER_NOT_EDITABLE /
--                                 OPERATION_NOT_ANNULLABLE)
--   api.annul_operation           RECREADA: internal_transfer →
--                                 OPERATION_NOT_ANNULLABLE antes de autorizar
--   api.my_transfer_proposals     las propias: todas las enviadas, las
--                                 recibidas solo pending (§9)
--   api.my_transfers              las transferencias materializadas en el
--                                 Personal propio, con direccion derivada de
--                                 las PARTES y concepto de la propuesta (§7)
--
-- Propietarios: lo nuevo de la propuesta es del nomey_provisioner (es
-- provisioning: no toca saldo); lo que escribe contabilidad sigue siendo del
-- nomey_writer; sec.persist_version sigue siendo de postgres porque ya lo era
-- (se recrea, no nace). Ninguna funcion nueva es de postgres, ninguna tiene
-- BYPASSRLS y el cliente sigue sin USAGE sobre core.
--
-- Precisiones a ADR-002 que este bloque fija (docs/adr/F12/README.md):
--   · El emisor anonimo se rehusa con NOT_AUTHORIZED · 403 (no existe
--     USERNAME_GUEST_NOT_ALLOWED: es el mismo codigo del resto de comandos
--     que exigen cuenta normal, como claim_username).
--   · El destinatario llega como HANDLE en el payload y el servidor lo
--     resuelve dentro de la transaccion (sec.handle_owner); el freno del
--     resolver (20 / 10 min, F12/ADR-001 §12) se COMPARTE: una resolucion aqui
--     apunta en core.username_lookup_attempt como una de resolve_username
--     (found y not_found apuntan; a uno mismo y ya frenado, no), y frenado es
--     RECIPIENT_LOOKUP_THROTTLED · 429 sin apuntar.
--   · «Nadie tiene ese username» NO es RECIPIENT_NOT_FOUND · 404 sino el
--     estado `not_found` de la respuesta (200): una excepcion revertiria el
--     apunte del freno (medido), y sondear inexistentes saldria gratis. Es
--     el mismo motivo por el que sec.resolve_invitation devuelve `invalid`
--     como estado (F09/ADR-004). RECIPIENT_NOT_FOUND no existe en el catalogo.
--   · El presupuesto de creacion se cuenta sobre las propuestas persistidas
--     de los ultimos 60 minutos bajo un cerrojo transaccional por emisor, no
--     sobre una relacion de intentos aparte; B3 ampliara el cuerpo de
--     sec.assert_proposal_budget a las propuestas de grupo, misma funcion.
--   · El tope de pareja (3 pending) se comprueba bajo el mismo cerrojo, asi
--     que tambien es exacto frente a dos creaciones simultaneas.
--   · La fecha y la hora efectivas de la transferencia son las del servidor
--     al aceptar (§21): current_date y localtime; el payload no las lleva.
--   · Corregir una internal_transfer (operation_id + expected_version_id) es
--     TRANSFER_NOT_EDITABLE · 422, decidido en la forma del payload, antes de
--     la clave de idempotencia; anularla, OPERATION_NOT_ANNULLABLE · 422.

-- ═══════════════════════ §1 · la propuesta ═══════════════════════════════════
create table core.transfer_proposal (
  id                     uuid primary key default gen_random_uuid(),
  created_by             uuid not null,
  target_user_id         uuid not null,
  amount                 bigint not null,
  currency_definition_id uuid not null references core.currency_definition (id),
  concept                text,
  client_command_id      uuid not null,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null default now() + interval '7 days',
  accepted_at            timestamptz,
  accepted_operation_id  uuid references core.operation (id),
  declined_at            timestamptz,
  cancelled_at           timestamptz,
  constraint transfer_proposal_importe_positivo check (amount > 0),
  constraint transfer_proposal_no_a_uno_mismo   check (created_by <> target_user_id),
  constraint transfer_proposal_caducidad        check (expires_at > created_at),
  constraint transfer_proposal_concepto         check (concept is null or btrim(concept) <> ''),
  -- aceptada ⇔ ligada a su operacion
  constraint transfer_proposal_aceptada         check ((accepted_at is null) = (accepted_operation_id is null)),
  -- a lo sumo UNA transicion terminal (§10)
  constraint transfer_proposal_una_terminal     check (
    (accepted_at is not null)::int + (declined_at is not null)::int + (cancelled_at is not null)::int <= 1),
  -- la clave del comando de creacion, por emisor: el replay la recupera
  constraint transfer_proposal_comando          unique (created_by, client_command_id)
);
comment on table core.transfer_proposal is
  'F12/ADR-002 §6: la intencion dirigida de A de enviar N a B. NO es una operacion: sin efectos, sin saldo. target_user_id se resuelve del handle UNA vez al crear (§4) y nunca se vuelve a resolver. Estado derivado (§8): accepted ⇔ accepted_operation_id; cancelled ⇔ cancelled_at; declined ⇔ declined_at; expired ⇔ now() >= expires_at; pending el resto.';
comment on column core.transfer_proposal.accepted_operation_id is
  'La internal_transfer que la materializo (§11). UNICA: una propuesta produce a lo sumo una operacion.';
create unique index transfer_proposal_operacion_unica on core.transfer_proposal (accepted_operation_id)
  where accepted_operation_id is not null;
create index transfer_proposal_emisor_idx on core.transfer_proposal (created_by, created_at desc);
create index transfer_proposal_receptor_idx on core.transfer_proposal (target_user_id)
  where accepted_at is null and declined_at is null and cancelled_at is null;
create index transfer_proposal_pareja_idx on core.transfer_proposal (created_by, target_user_id)
  where accepted_at is null and declined_at is null and cancelled_at is null;

alter table core.transfer_proposal enable row level security;
-- provisioner: crea la propia, lee las de las que es parte, marca cancelada
-- o rechazada (que columna toca cada comando lo fija el cuerpo).
grant select, insert on core.transfer_proposal to nomey_provisioner;
grant update (cancelled_at, declined_at) on core.transfer_proposal to nomey_provisioner;
create policy transfer_proposal_provisioner_select on core.transfer_proposal
  for select to nomey_provisioner
  using (created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id());
create policy transfer_proposal_provisioner_insert on core.transfer_proposal
  for insert to nomey_provisioner with check (created_by = sec.request_actor_id());
create policy transfer_proposal_provisioner_update on core.transfer_proposal
  for update to nomey_provisioner
  using (created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id())
  with check (created_by = sec.request_actor_id() or target_user_id = sec.request_actor_id());
-- writer: SOLO el receptor acepta, y la operacion que liga es la que el
-- mismo acaba de escribir. `for update` sobre la fila exige que la policy de
-- UPDATE la alcance (medido en E20: si no, cero filas sin error).
grant select on core.transfer_proposal to nomey_writer;
grant update (accepted_at, accepted_operation_id) on core.transfer_proposal to nomey_writer;
create policy transfer_proposal_writer_select on core.transfer_proposal
  for select to nomey_writer using (target_user_id = sec.request_actor_id());
create policy transfer_proposal_writer_accept on core.transfer_proposal
  for update to nomey_writer
  using (target_user_id = sec.request_actor_id())
  with check (target_user_id = sec.request_actor_id()
              and exists (select 1 from core.operation o
                           where o.id = accepted_operation_id and o.created_by = sec.request_actor_id()));
-- cliente: las de las que es parte, por las vistas de api, y SIN las columnas
-- de uid: created_by y target_user_id no tienen privilegio de lectura, asi que
-- ninguna vista invoker puede publicarlos ni por descuido (§9, ADR-001 §13).
grant select (id, amount, currency_definition_id, concept, created_at, expires_at,
              accepted_at, accepted_operation_id, declined_at, cancelled_at)
  on core.transfer_proposal to authenticated;
create policy transfer_proposal_client_select on core.transfer_proposal
  for select to authenticated
  using (created_by = (select auth.uid()) or target_user_id = (select auth.uid()));

-- ═══════════════════════ §2 · las partes ═════════════════════════════════════
create table core.transfer_part (
  operation_version_id uuid primary key references core.operation_version (id),
  from_scope_id        uuid not null references core.scope (id),
  to_scope_id          uuid not null references core.scope (id),
  constraint transfer_part_extremos_distintos check (from_scope_id <> to_scope_id)
);
comment on table core.transfer_part is
  'F12/ADR-002 §14: el Personal de salida y el de entrada de cada version de registro de una internal_transfer. De ellas —y no de created_by— salen «Enviaste» y «Recibiste» (§12). Sin username ni nombre: la identidad se resuelve uid → actual al leer.';
alter table core.transfer_part enable row level security;
grant select, insert on core.transfer_part to nomey_writer;
create policy transfer_part_writer_insert on core.transfer_part
  for insert to nomey_writer
  with check (exists (select 1 from core.operation_version ov
                       where ov.id = operation_version_id and ov.created_by = sec.request_actor_id()));
create policy transfer_part_writer_select on core.transfer_part
  for select to nomey_writer using (true);
-- cliente: las partes de las transferencias que alcanzan un ambito suyo; las
-- vistas solo las usan para la direccion, nunca publican el ambito ajeno.
grant select on core.transfer_part to authenticated;
create policy transfer_part_client_select on core.transfer_part
  for select to authenticated
  using (sec.is_member(from_scope_id) or sec.is_member(to_scope_id));

-- ═══════════════════════ §3 · estado, cerrojo y presupuesto ══════════════════
create function sec.transfer_proposal_state(
  p_accepted_operation_id uuid, p_cancelled_at timestamptz, p_declined_at timestamptz, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when p_accepted_operation_id is not null then 'accepted'
              when p_cancelled_at is not null then 'cancelled'
              when p_declined_at is not null then 'declined'
              when now() >= p_expires_at then 'expired'
              else 'pending' end;
$fn$;
comment on function sec.transfer_proposal_state(uuid, timestamptz, timestamptz, timestamptz) is
  'F12/ADR-002 §8: el estado de una propuesta, derivado de sus marcas y de now(). Escalares y no la fila: asi el cliente lo evalua sin privilegio sobre los uid.';
grant create on schema sec to nomey_provisioner;
alter function sec.transfer_proposal_state(uuid, timestamptz, timestamptz, timestamptz) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.transfer_proposal_state(uuid, timestamptz, timestamptz, timestamptz) from public;
grant execute on function sec.transfer_proposal_state(uuid, timestamptz, timestamptz, timestamptz)
  to nomey_provisioner, nomey_writer, authenticated;

-- Cerrojo TRANSACCIONAL por emisor, con clave propia de F12 (como el de la
-- ingesta FX): dos creaciones del mismo emisor se serializan aqui; las de
-- emisores distintos no se esperan. Lo toman create_transfer_proposal (B1) y,
-- en B3, la propuesta de grupo: el presupuesto es compartido (§18).
create function sec.lock_proposal_budget(p_user uuid)
returns void
language sql
set search_path = ''
as $fn$
  select pg_advisory_xact_lock(hashtextextended('nomey.proposal_budget:' || p_user::text, 0));
$fn$;
grant create on schema sec to nomey_provisioner;
alter function sec.lock_proposal_budget(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.lock_proposal_budget(uuid) from public;
grant execute on function sec.lock_proposal_budget(uuid) to nomey_provisioner;

-- 10 creadas en los ultimos 60 minutos → la siguiente se rehusa. Se cuentan
-- las PERSISTIDAS (cualquier estado: cancelar no devuelve cuota; un rechazo
-- antes de crear no la consume porque no persiste nada) bajo el cerrojo, de
-- modo que once simultaneas dan exactamente diez.
create function sec.assert_proposal_budget(p_user uuid)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_n      integer;
  v_oldest timestamptz;
begin
  perform sec.lock_proposal_budget(p_user);
  select count(*), min(p.created_at) into v_n, v_oldest
    from core.transfer_proposal p
   where p.created_by = p_user and p.created_at > now() - interval '60 minutes';
  if v_n >= 10 then
    perform sec.raise_boundary('PROPOSAL_RATE_LIMITED',
      'has creado diez propuestas en la ultima hora; espera antes de crear otra', 429,
      jsonb_build_object('retry_at', v_oldest + interval '60 minutes'));
  end if;
end
$fn$;
comment on function sec.assert_proposal_budget(uuid) is
  'F12/ADR-002 §18: 10 propuestas creadas / 60 min por emisor, contadas bajo sec.lock_proposal_budget. B3 amplia el cuerpo a las propuestas de grupo.';
grant create on schema sec to nomey_provisioner;
alter function sec.assert_proposal_budget(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.assert_proposal_budget(uuid) from public;
grant execute on function sec.assert_proposal_budget(uuid) to nomey_provisioner;

-- ═══════════════════════ §4 · handle → uid, y el Personal ajeno ═════════════
-- El unico sitio de F12.B donde un handle se convierte en uid, y solo del
-- lado del servidor: el cliente manda `handle` y recibe un estado. Solo un
-- handle DEFINITIVO y ACTIVO nombra a alguien: una reserva, un retenido o un
-- inexistente son «nadie», sin distinguirlos (§5). No es definer: corre como
-- el provisioner que la llama, bajo su policy de lectura de todos los handles.
create function sec.handle_owner(p_handle text)
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select h.user_id
    from core.account_handle h
   where h.handle = sec.normalize_handle(p_handle)
     and h.claimed_at is not null and h.released_at is null;
$fn$;
comment on function sec.handle_owner(text) is
  'F12/ADR-002 §4: handle definitivo y activo → uid, resuelto UNA vez al crear la propuesta. Nunca en api; nunca hacia atras.';
grant create on schema sec to nomey_provisioner;
alter function sec.handle_owner(text) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.handle_owner(text) from public;
grant execute on function sec.handle_owner(text) to nomey_provisioner;

-- El provisioner solo ve sus Personales y sus grupos; que el destinatario
-- tenga Modo Personal (§5) lo contesta el writer, que lee todos los ambitos,
-- y contesta SOLO si/no: ni el id ni la moneda del ambito ajeno salen de aqui.
create function sec.has_personal_scope(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from core.scope s where s.kind = 'personal' and s.owner_user_id = p_user);
$fn$;
comment on function sec.has_personal_scope(uuid) is
  'F12/ADR-002 §5: ¿tiene esa cuenta un Modo Personal? Definer del writer para que el provisioner lo pregunte de una cuenta ajena sin ampliar sus policies sobre core.scope. Solo un booleano.';
grant create on schema sec to nomey_writer;
alter function sec.has_personal_scope(uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.has_personal_scope(uuid) from public;
grant execute on function sec.has_personal_scope(uuid) to nomey_provisioner;

-- Dos helpers de payload que el provisioner no tenia y ahora necesita.
grant execute on function sec.payload_amount(jsonb, text) to nomey_provisioner;
grant execute on function sec.canonical_concept(text) to nomey_provisioner;

-- ═══════════════════════ §5 · crear ══════════════════════════════════════════
-- payload: { client_command_id, command_contract_version: 1, handle, amount,
--            currency_definition_id, concept? }
-- Orden (aprobado en F12.B1): forma → actor (normal, handle definitivo, con
-- Personal, moneda = base) → clave de idempotencia → a uno mismo →
-- freno de resolucion → resolver → apunte → nadie (estado) → Personal del
-- destinatario → [cerrojo por emisor] tope de pareja → presupuesto → insert.
create function api.create_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'handle', 'amount', 'currency_definition_id', 'concept'];
  v_actor    uuid;
  v_guest    boolean;
  v_command  uuid;
  v_contract integer;
  v_raw      text;
  v_handle   text;
  v_amount   bigint;
  v_currency uuid;
  v_concept  text;
  v_own      text;
  v_from     uuid;
  v_base     uuid;
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
  v_target   uuid;
  v_n        integer;
  v_id       uuid;
  v_until    timestamptz;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor    := sec.request_actor_id();
  v_guest    := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_command  := sec.payload_uuid(payload, 'client_command_id', true);
  v_contract := sec.payload_contract_version(payload);
  if v_contract <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_raw      := sec.payload_text(payload, 'handle', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_concept  := sec.payload_text(payload, 'concept', false);
  if v_concept is not null then
    v_concept := sec.canonical_concept(v_concept);
  end if;
  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el importe de una transferencia debe ser positivo: uno negativo invertiria la direccion', 400);
  end if;

  -- EL EMISOR (§5): cuenta normal, con Modo Personal, y la moneda de la
  -- propuesta es la base de ese Personal (§20). Antes de la clave porque el
  -- comando de provisioning apunta al ambito resultado.
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no propone transferencias', 403);
  end if;
  -- Emisor con handle definitivo (§5; F12/ADR-001 §14: resolver exige tener
  -- el propio). Antes que su Personal y su moneda: sin identidad publica no
  -- hay nada que proponer, sea cual sea el resto.
  select h.handle into v_own from core.account_handle h
   where h.user_id = v_actor and h.claimed_at is not null and h.released_at is null;
  if v_own is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'proponer una transferencia exige tener username definitivo', 409);
  end if;
  select s.id, s.base_currency_definition_id into v_from, v_base
    from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
  if v_from is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'el emisor no tiene Modo Personal', 403);
  end if;
  if v_base is distinct from v_currency then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la moneda de la propuesta es la base del Modo Personal del emisor, y la transferencia no convierte', 422);
  end if;

  -- CLAVE DE IDEMPOTENCIA (F09/ADR-002): la intencion canonica lleva el handle
  -- normalizado, de modo que «@Ana» y «ana» son la misma intencion.
  v_handle := sec.normalize_handle(v_raw);
  v_intent := jsonb_build_object(
    'handle', coalesce(v_handle, v_raw), 'amount', payload ->> 'amount',
    'currency_definition_id', v_currency::text, 'concept', v_concept);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'transfer_proposal.create', v_contract, v_intent, v_from);
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
    select p.id, p.expires_at into v_id, v_until from core.transfer_proposal p
     where p.created_by = v_actor and p.client_command_id = v_command;
    if v_id is null then
      -- el comando se resolvio como «nadie tiene ese username» (abajo)
      return jsonb_build_object('state', 'not_found', 'already_processed', true);
    end if;
    return jsonb_build_object('state', 'pending', 'proposal_id', v_id, 'expires_at', v_until, 'already_processed', true);
  end if;

  -- A uno mismo es PAYLOAD_INVALID y NO apunta en el freno.
  if v_handle is not null and v_handle = v_own then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes proponerte una transferencia a ti mismo', 400);
  end if;

  -- EL DESTINATARIO (§4): el freno del resolver, compartido con
  -- resolve_username (F12/ADR-001 §12). Frenado no apunta; resolver apunta
  -- una vez, encuentre o no. El texto consultado no se guarda nunca.
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
    -- «Nadie» es un ESTADO y no un error, por la misma razon que `invalid` en
    -- sec.resolve_invitation (F09/ADR-004): una excepcion revertiria el apunte
    -- del freno que acaba de escribirse, y sondear handles inexistentes desde
    -- aqui saldria gratis, que es justo lo que el freno de F12/ADR-001 §12
    -- existe para impedir (medido: el apunte no sobrevive al raise). El
    -- comando queda persistido con esta intencion: su replay es not_found.
    return jsonb_build_object('state', 'not_found', 'already_processed', false);
  end if;
  if v_target = v_actor then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes proponerte una transferencia a ti mismo', 400);
  end if;
  if not sec.has_personal_scope(v_target) then
    perform sec.raise_boundary('RECIPIENT_WITHOUT_PERSONAL_SCOPE',
      'ese usuario todavia no tiene Modo Personal al que recibir', 422);
  end if;

  -- ANTI-SPAM (§18), bajo el cerrojo del emisor: pareja y presupuesto exactos.
  perform sec.lock_proposal_budget(v_actor);
  select count(*) into v_n from core.transfer_proposal p
   where p.created_by = v_actor and p.target_user_id = v_target
     and sec.transfer_proposal_state(p.accepted_operation_id, p.cancelled_at, p.declined_at, p.expires_at) = 'pending';
  if v_n >= 3 then
    perform sec.raise_boundary('PROPOSAL_LIMIT_PER_TARGET',
      'ya tienes tres propuestas pendientes con ese usuario', 409);
  end if;
  perform sec.assert_proposal_budget(v_actor);

  insert into core.transfer_proposal (created_by, target_user_id, amount, currency_definition_id, concept, client_command_id)
  values (v_actor, v_target, v_amount, v_currency, v_concept, v_command)
  returning id, expires_at into v_id, v_until;

  return jsonb_build_object('state', 'pending', 'proposal_id', v_id, 'expires_at', v_until, 'already_processed', false);
end
$fn$;
comment on function api.create_transfer_proposal(jsonb) is
  'F12/ADR-002 §4-§6, §18: proponer una transferencia a @handle. Resuelve el handle UNA vez en servidor; ni crea operacion ni toca saldo. Devuelve state pending (con proposal_id) o not_found (sin error, para que el apunte del freno persista). Idempotente por client_command_id (core.provisioning_command).';
grant create on schema api to nomey_provisioner;
alter function api.create_transfer_proposal(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.create_transfer_proposal(jsonb) from public;
grant execute on function api.create_transfer_proposal(jsonb) to authenticated;

-- ═══════════════════════ §6 · cancelar y rechazar ════════════════════════════
-- payload: { proposal_id }. Idempotentes por estado: repetir la misma
-- transicion devuelve el estado sin escribir; otra terminal es su codigo.
create function api.cancel_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_guest boolean;
  v_id    uuid;
  v_p     core.transfer_proposal%rowtype;
  v_state text;
begin
  perform sec.assert_payload_shape(payload, array['proposal_id']);
  v_actor := sec.request_actor_id();
  v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_id    := sec.payload_uuid(payload, 'proposal_id', true);
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no cancela propuestas', 403);
  end if;
  -- La fila, bloqueada: quien llegue despues ve la transicion (§10).
  select * into v_p from core.transfer_proposal p where p.id = v_id for update;
  if v_p.id is null or v_p.created_by <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no la creaste tu', 403);
  end if;
  v_state := sec.transfer_proposal_state(v_p.accepted_operation_id, v_p.cancelled_at, v_p.declined_at, v_p.expires_at);
  if v_state = 'cancelled' then
    return jsonb_build_object('proposal_id', v_id, 'state', v_state, 'already_processed', true);
  end if;
  if v_state = 'accepted' then
    perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
  elsif v_state = 'declined' then
    perform sec.raise_boundary('PROPOSAL_DECLINED', 'la propuesta ya fue rechazada', 409);
  elsif v_state = 'expired' then
    perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
  end if;
  update core.transfer_proposal p set cancelled_at = now() where p.id = v_id;
  return jsonb_build_object('proposal_id', v_id, 'state', 'cancelled', 'already_processed', false);
end
$fn$;
comment on function api.cancel_transfer_proposal(jsonb) is
  'F12/ADR-002 §8: cancelar una propuesta propia mientras esta pending. Idempotente por estado.';
grant create on schema api to nomey_provisioner;
alter function api.cancel_transfer_proposal(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.cancel_transfer_proposal(jsonb) from public;
grant execute on function api.cancel_transfer_proposal(jsonb) to authenticated;

create function api.decline_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_guest boolean;
  v_id    uuid;
  v_p     core.transfer_proposal%rowtype;
  v_state text;
begin
  perform sec.assert_payload_shape(payload, array['proposal_id']);
  v_actor := sec.request_actor_id();
  v_guest := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
  v_id    := sec.payload_uuid(payload, 'proposal_id', true);
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no rechaza propuestas', 403);
  end if;
  select * into v_p from core.transfer_proposal p where p.id = v_id for update;
  if v_p.id is null or v_p.target_user_id <> v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no va dirigida a ti', 403);
  end if;
  v_state := sec.transfer_proposal_state(v_p.accepted_operation_id, v_p.cancelled_at, v_p.declined_at, v_p.expires_at);
  if v_state = 'declined' then
    return jsonb_build_object('proposal_id', v_id, 'state', v_state, 'already_processed', true);
  end if;
  if v_state = 'accepted' then
    perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
  elsif v_state = 'cancelled' then
    perform sec.raise_boundary('PROPOSAL_CANCELLED', 'quien la creo ya la cancelo', 409);
  elsif v_state = 'expired' then
    perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
  end if;
  update core.transfer_proposal p set declined_at = now() where p.id = v_id;
  return jsonb_build_object('proposal_id', v_id, 'state', 'declined', 'already_processed', false);
end
$fn$;
comment on function api.decline_transfer_proposal(jsonb) is
  'F12/ADR-002 §8: rechazar una propuesta dirigida a uno mientras esta pending. Sin motivo. Idempotente por estado.';
grant create on schema api to nomey_provisioner;
alter function api.decline_transfer_proposal(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.decline_transfer_proposal(jsonb) from public;
grant execute on function api.decline_transfer_proposal(jsonb) to authenticated;

-- ═══════════════════════ §7 · aceptar: la internal_transfer ═════════════════
-- RECREADA sobre su cuerpo vigente de F3 (20260825131652). Lo que cambia:
--   · payload: { client_operation_id, command_contract_version, proposal_id };
--     emisor, receptor, importe y moneda SALEN DE LA PROPUESTA, nunca del
--     payload (§11). from_scope_id / to_scope_id / amount / effective_date ya
--     no son campos: PAYLOAD_INVALID como cualquier campo desconocido.
--   · operation_id + expected_version_id → TRANSFER_NOT_EDITABLE · 422 (§16),
--     antes de la clave: una correccion no llega a reclamar nada.
--   · autorizacion: el actor es el target_user_id de una propuesta pending y
--     no caducada (§13, invariante 14 precisado). assert_owned_personal_scope
--     deja de aplicarse a `from`: `from` es el Personal del created_by de la
--     propuesta, derivado, sin parametro libre.
--   · fecha y hora efectivas: las del servidor al aceptar (§21).
--   · partes por version en core.transfer_part (§14) y la transicion a
--     accepted en la misma transaccion (§11).
-- Lo que NO cambia: definer del writer bajo RLS (E16), begin_command,
-- lock_scopes en orden global, balances_before / observe_balances, dos
-- efectos transfer sin dimension economica ni deuda, sec.envelope.
create or replace function api.record_internal_transfer(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id', 'command_contract_version', 'proposal_id',
    'operation_id', 'expected_version_id'];
  v_proposal uuid;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_p core.transfer_proposal%rowtype;
  v_state text;
  v_from uuid; v_to uuid;
  v_obs uuid[]; v_before bigint[];
  v_date date; v_time time;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  -- §16: una internal_transfer tiene exactamente una version. La forma del
  -- payload lo decide antes de tocar la clave.
  if (payload ? 'operation_id') or (payload ? 'expected_version_id') then
    perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
      'una transferencia entre usuarios no se corrige: la devolucion es otra transferencia', 422);
  end if;
  v_proposal  := sec.payload_uuid(payload, 'proposal_id', true);
  v_canonical := jsonb_build_object('proposal_id', v_proposal::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'internal_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- LA PROPUESTA, bloqueada (§10: clave → fila → ambitos). La policy del
  -- writer solo alcanza las dirigidas al actor: la de un tercero, o una
  -- inexistente, son cero filas y NOT_AUTHORIZED, sin distinguirlas.
  select * into v_p from core.transfer_proposal p where p.id = v_proposal for update;
  if v_p.id is null or v_p.target_user_id <> v_actor or v_p.created_by = v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la propuesta no existe o no va dirigida a ti', 403);
  end if;
  v_state := sec.transfer_proposal_state(v_p.accepted_operation_id, v_p.cancelled_at, v_p.declined_at, v_p.expires_at);
  if v_state = 'accepted' then
    perform sec.raise_boundary('PROPOSAL_ACCEPTED', 'la propuesta ya fue aceptada: la transferencia existe', 409);
  elsif v_state = 'cancelled' then
    perform sec.raise_boundary('PROPOSAL_CANCELLED', 'quien la creo ya la cancelo', 409);
  elsif v_state = 'declined' then
    perform sec.raise_boundary('PROPOSAL_DECLINED', 'la propuesta ya fue rechazada', 409);
  elsif v_state = 'expired' then
    perform sec.raise_boundary('PROPOSAL_EXPIRED', 'la propuesta ya caduco', 409);
  end if;

  -- LOS EXTREMOS, derivados (§11, §13): el Personal de quien propuso y el de
  -- quien acepta. Ningun dato del payload elige un ambito.
  select s.id into v_from from core.scope s where s.kind = 'personal' and s.owner_user_id = v_p.created_by;
  select s.id into v_to   from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
  if v_from is null or v_to is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una de las dos partes no tiene Modo Personal', 403);
  end if;
  -- §20: la moneda de la propuesta es la base de los dos, o no hay transferencia.
  perform sec.assert_no_conversion(v_from, v_p.currency_definition_id);
  perform sec.assert_no_conversion(v_to,   v_p.currency_definition_id);

  -- LOCK de la dimension SALDO (ADR-013 §11, F6.C), en el orden global.
  v_obs := array[v_from, v_to];
  perform sec.lock_scopes(v_obs);
  v_before := sec.balances_before(v_obs);

  -- §21: fecha e instante de la aceptacion, del servidor.
  v_date := current_date;
  v_time := localtime(0);

  perform sec.persist_version(v_actor, v_operation, v_version, 1, null,
                              'internal_transfer', v_date, v_p.amount, v_p.currency_definition_id, v_time);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_p.currency_definition_id, - v_p.amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_p.currency_definition_id,   v_p.amount);

  insert into core.transfer_part (operation_version_id, from_scope_id, to_scope_id)
  values (v_version, v_from, v_to);

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- La transicion, en la misma transaccion (§11): todo o nada.
  update core.transfer_proposal p
     set accepted_at = now(), accepted_operation_id = v_operation
   where p.id = v_proposal;
  if not found then
    raise exception 'la propuesta % no pudo marcarse aceptada: falta la policy o el privilegio de UPDATE del writer', v_proposal;
  end if;

  return sec.envelope(v_operation, false);
end
$fn$;
comment on function api.record_internal_transfer(jsonb) is
  'F12/ADR-002 §11: materializar una propuesta aceptada. Solo el target_user_id; emisor, receptor, importe y moneda salen de la propuesta. Una sola version: ni correccion (TRANSFER_NOT_EDITABLE) ni anulacion (OPERATION_NOT_ANNULLABLE).';
grant create on schema api to nomey_writer;
alter function api.record_internal_transfer(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.record_internal_transfer(jsonb) from public;
grant execute on function api.record_internal_transfer(jsonb) to authenticated;

-- ═══════════════════════ §8 · irreversibilidad, donde toda version pasa ═══════
-- sec.persist_version: una internal_transfer no admite version nueva, ni de
-- correccion ni de anulacion (§16). Mismo patron que departure_novation
-- (20260914120000): la guarda vive donde toda version pasa, y corre DESPUES
-- del CAS, asi que la clase es la de una operacion ya bloqueada.
create or replace function sec.persist_version(p_actor uuid, p_operation uuid, p_version uuid, p_version_no integer, p_supersedes uuid, p_operation_class text, p_effective_date date, p_original_amount bigint, p_currency uuid, p_effective_time time without time zone DEFAULT NULL::time without time zone, p_version_kind text DEFAULT 'record'::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_clase text;
  v_kind  text;
begin
  if p_version_no = 1 then
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values (p_operation, p_operation_class, p_actor, p_version);
  else
    -- GUARDA DE CLASE (ADR-020 §6). La operacion ya esta bloqueada por
    -- `sec.lock_and_cas`, asi que esta lectura no compite con nadie, y corre
    -- DESPUES del CAS: no es un oraculo de la clase de una operacion ajena.
    select o.operation_class into v_clase from core.operation o where o.id = p_operation;
    if v_clase is distinct from p_operation_class then
      perform sec.raise_boundary('OPERATION_CLASS_MISMATCH',
        format('la operacion es de clase %s y esta funcion escribe %s: una clase no corrige a otra',
               v_clase, p_operation_class), 422);
    end if;

    -- GUARDA DE ANULACION. La version que se sustituye es la vigente, por el
    -- CAS. Si es una anulacion, la operacion esta cerrada.
    select ov.version_kind into v_kind
      from core.operation_version ov where ov.id = p_supersedes;
    if v_kind = 'annulment' then
      perform sec.raise_boundary('OPERATION_ANNULLED',
        'la operacion esta anulada y no admite versiones nuevas', 409);
    end if;
    -- Una novacion de salida (ADR-038 C8) no admite versiones: ni correccion
    -- ni anulacion. Es la consecuencia de una salida, que tampoco se deshace.
    if v_clase = 'departure_novation' then
      perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
        'una novacion de salida no se corrige ni se anula', 422);
    end if;
    -- Una transferencia entre usuarios (F12/ADR-002 §16) tiene exactamente
    -- una version: las dos partes consintieron ESE hecho, y reescribirlo o
    -- deshacerlo seria que una alterase el Personal de la otra sin su
    -- voluntad. La devolucion es otra transferencia.
    if v_clase = 'internal_transfer' then
      if p_version_kind = 'annulment' then
        perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
          'una transferencia entre usuarios no se anula: la devolucion es otra transferencia', 422);
      end if;
      perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
        'una transferencia entre usuarios no se corrige: la devolucion es otra transferencia', 422);
    end if;
  end if;

  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, effective_time, original_amount, original_currency_definition_id,
     economic_rules_version, version_kind)
  values (p_version, p_operation, p_version_no, p_supersedes, p_actor,
          p_effective_date, p_effective_time, p_original_amount, p_currency, 'v1',
          p_version_kind);

  if p_version_no > 1 then
    update core.operation set current_version_id = p_version where id = p_operation;
  end if;
end
$function$;

-- api.annul_operation: la clase se rehusa ANTES de autorizar por membresia,
-- para las dos partes por igual, y sin tomar ningun cerrojo de ambito: nada
-- que anular, nada que serializar. El resto del cuerpo es el vigente
-- (20260914130000 y anteriores), sin cambios.
create or replace function api.annul_operation(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version',
    'operation_id','expected_version_id'];
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_clase text; v_date date; v_time time; v_amount bigint; v_currency uuid;
  v_obs uuid[] := '{}'::uuid[]; v_lock uuid[] := '{}'::uuid[]; v_before bigint[];
  v_scope uuid; v_group uuid; v_pd core.payment_detail%rowtype; v_other uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  -- Anular es SIEMPRE sobre una operacion existente: no hay alta que valga.
  if not (payload ? 'operation_id') or not (payload ? 'expected_version_id') then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'anular exige operation_id y expected_version_id', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',        (sec.payload_uuid(payload,'operation_id',true))::text,
    'expected_version_id', (sec.payload_uuid(payload,'expected_version_id',true))::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'annulment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- La clase sale de la operacion, no del payload: anular no la elige.
  select o.operation_class into v_clase from core.operation o where o.id = v_operation;
  if v_clase is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la operacion no existe o no es alcanzable', 403);
  end if;

  -- F12/ADR-002 §16: una transferencia entre usuarios no se anula, la pida
  -- quien la pida. Antes de la membresia y antes de cualquier cerrojo;
  -- sec.persist_version lo respalda si algo llegara hasta alli.
  if v_clase = 'internal_transfer' then
    perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
      'una transferencia entre usuarios no se anula: la devolucion es otra transferencia', 422);
  end if;

  -- RANGO 1 (protocolo de identidad, 20260912150000): antes de leer
  -- membresia, vinculo o salida. El ambito de grupo de la version, si lo hay.
  select g.id into v_group
    from core.current_effect ce join core.scope g on g.id = ce.scope_id and g.kind = 'group'
   where ce.operation_version_id = v_expected
   limit 1;
  if v_group is not null then
    perform sec.lock_participant_claims(v_group);
  end if;

  if v_clase = 'group_payment' then
    -- ADR-038 C4: pagador o receptor DE ESE PAGO (core.payment_detail), con o
    -- sin membresia; nadie mas. Las partes salen del hecho persistido, no de
    -- los efectos vigentes.
    select * into v_pd from core.payment_detail pd
     where pd.operation_version_id = (select ov.id from core.operation_version ov
                                        where ov.operation_id = v_operation and ov.version_kind = 'record'
                                        order by ov.version_no desc limit 1);
    if v_pd.operation_version_id is null
       or not exists (select 1 from core.participant_user_link l
                       where l.scope_id = v_pd.scope_id and l.user_id = v_actor
                         and l.participant_id in (sec.canonical_participant(v_pd.payer_participant_id),
                                                  sec.canonical_participant(v_pd.receiver_participant_id))) then
      perform sec.raise_boundary('NOT_AUTHORIZED',
        'solo quien pago o quien cobro puede anular este pago', 403);
    end if;
  else
    -- AUTORIZACION: la misma que corregir. `data-model.md` §7 la fija como
    -- membresia ACTUAL del ambito, sin mirar quien creo la operacion ni cuando
    -- entro. Se comprueba sobre cada ambito que la version vigente alcanza:
    -- un gasto con caja de OTRO pagador solo lo anula ese pagador (documentado
    -- en ADR-039; no se amplia aqui).
    foreach v_scope in array sec.normalize_scopes(
        sec.balance_scopes_of_version(v_expected) || sec.debt_scopes_of_version(v_expected))
    loop
      perform sec.assert_member(v_scope, v_actor);
    end loop;
  end if;

  -- LOCK sobre esos mismos ambitos, antes del CAS y en el orden global.
  v_obs  := sec.normalize_scopes(sec.balance_scopes_of_version(v_expected));
  v_lock := sec.normalize_scopes(v_obs || sec.debt_scopes_of_version(v_expected));
  perform sec.lock_scopes(v_lock);

  select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

  -- Ninguna deuda puede quedar con pendiente negativo al desaparecer la que la
  -- originaba. Mismo invariante que protege la correccion, en otro momento.
  -- ADR-034 §6: anular un gasto cuya version vigente deja deuda con un
  -- retirado alteraria un pendiente declarado resuelto. Antes que el
  -- sobrepago, para que el motivo que llega sea el de fondo.
  if v_clase = 'group_payment' then
    -- ADR-038 C4: un pago del que dependen pagos posteriores SI se anula (el
    -- par consumido queda invertido: un credito de quien pago de mas), y un
    -- retirado en su camino no lo bloquea si queda en equilibrio. La guarda
    -- de sobreliquidacion y la de retirados de los GASTOS no se aplican aqui.
    perform sec.assert_payment_annulment_leaves_retired_balanced(v_expected);
  else
    perform sec.assert_no_retired_debt(v_expected);
    perform sec.assert_annulment_leaves_no_oversettled_debt(v_expected);
    -- ADR-039: anular un gasto que atribuye algo a quien salio se rehusa.
    perform sec.assert_departed_unchanged(null, v_expected);
  end if;

  -- La version anulada define el hecho que se declara sin vigencia.
  select ov.effective_date, ov.effective_time, ov.original_amount,
         ov.original_currency_definition_id
    into v_date, v_time, v_amount, v_currency
    from core.operation_version ov where ov.id = v_expected;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, v_clase, v_date, v_amount, v_currency,
                              v_time, 'annulment');

  -- Y NINGUN efecto. Es lo que la hace no contar.

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ADR-038 C6: la contraparte del pago recibe el aviso aunque ya no sea
  -- miembro; el sujeto es la operacion.
  if v_clase = 'group_payment' then
    select l.user_id into v_other
      from core.participant_user_link l
     where l.scope_id = v_pd.scope_id
       and l.participant_id = sec.canonical_participant(
             case when exists (select 1 from core.participant_user_link x
                                where x.participant_id = sec.canonical_participant(v_pd.payer_participant_id) and x.user_id = v_actor)
                  then v_pd.receiver_participant_id else v_pd.payer_participant_id end);
    if v_other is not null and v_other <> v_actor then
      insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
      values (v_other, v_pd.scope_id, 'payment_annulled', v_operation, v_actor)
      on conflict (recipient_user_id, kind, subject_id) do nothing;
    end if;
  end if;

  return sec.envelope(v_operation, false);
end
$function$;
grant create on schema api to nomey_writer;
alter function api.annul_operation(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;

-- ═══════════════════════ §9 · lectura ════════════════════════════════════════
-- La contraparte de cada propuesta de la que el actor es parte, como
-- identidad publica ACTUAL (F12/ADR-001 §13: uid → identidad, nunca al
-- reves), y la direccion desde la propuesta (quien la creo envia). Definer
-- del provisioner —que ya lee todas las identidades bajo su policy medida de
-- A1— sin parametros y filtrada por el actor en su cuerpo, como
-- sec.my_group_payment_context(): su lista de columnas ES la frontera de
-- privacidad. Ni uid ni ambito salen de aqui. El actor sale de
-- sec.request_actor_id() y no de auth.uid(): el provisioner no tiene USAGE
-- sobre auth (medido: «permission denied for schema auth»), y ambos leen el
-- mismo `sub` del JWT.
create function sec.my_transfer_counterparts()
returns table (proposal_id uuid, accepted_operation_id uuid, direction text,
               counterpart_handle text, counterpart_public_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.accepted_operation_id,
         case when p.created_by = sec.request_actor_id() then 'outgoing' else 'incoming' end,
         i.handle, i.public_name
    from core.transfer_proposal p
    left join lateral sec.public_identity(
      case when p.created_by = sec.request_actor_id() then p.target_user_id else p.created_by end) i on true
   where sec.request_actor_id() in (p.created_by, p.target_user_id);
$fn$;
comment on function sec.my_transfer_counterparts() is
  'F12/ADR-002 §9, §14: por cada propuesta propia, la direccion y la identidad publica ACTUAL de la contraparte. Sin uid. Solo para las vistas de api.';
grant create on schema sec to nomey_provisioner;
alter function sec.my_transfer_counterparts() owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.my_transfer_counterparts() from public;
grant execute on function sec.my_transfer_counterparts() to authenticated;

-- Las propuestas propias (§9): TODAS las enviadas con su estado; de las
-- recibidas, solo las pending. Los importes cruzan como texto (F02/ADR-001).
create view api.my_transfer_proposals
with (security_invoker = true) as
select p.id as proposal_id,
       c.direction,
       c.counterpart_handle,
       c.counterpart_public_name,
       p.amount::text as amount,
       p.currency_definition_id,
       p.concept,
       p.created_at,
       p.expires_at,
       sec.transfer_proposal_state(p.accepted_operation_id, p.cancelled_at, p.declined_at, p.expires_at) as state,
       p.accepted_operation_id
  from core.transfer_proposal p
  join sec.my_transfer_counterparts() c on c.proposal_id = p.id
 where c.direction = 'outgoing'
    or sec.transfer_proposal_state(p.accepted_operation_id, p.cancelled_at, p.declined_at, p.expires_at) = 'pending';
comment on view api.my_transfer_proposals is
  'F12/ADR-002 §9: las propuestas de las que el actor es parte. Enviadas: todas, con estado. Recibidas: solo pending. La contraparte es su identidad publica actual; ni uid ni ambito.';
grant select on api.my_transfer_proposals to authenticated;

-- Las transferencias materializadas en el Personal propio (§7, §14):
-- direccion desde las PARTES (nunca desde created_by), concepto y contraparte
-- desde la propuesta que la produjo. Una fila por transferencia y ambito
-- propio; sec.counts_in_personal la deja siempre dentro (§21).
create view api.my_transfers
with (security_invoker = true) as
select o.id as operation_id,
       e.scope_id,
       e.currency_definition_id,
       e.balance_amount::text as balance_amount,
       case when tp.from_scope_id = e.scope_id then 'outgoing' else 'incoming' end as direction,
       ov.original_amount::text as amount,
       ov.effective_date,
       ov.effective_time,
       p.concept,
       c.counterpart_handle,
       c.counterpart_public_name,
       p.id as proposal_id,
       o.created_at as operation_created_at
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  join core.transfer_part tp on tp.operation_version_id = ov.id
  left join core.transfer_proposal p on p.accepted_operation_id = o.id
  left join sec.my_transfer_counterparts() c on c.accepted_operation_id = o.id
 where s.kind = 'personal'
   and s.owner_user_id = (select auth.uid())
   and o.operation_class = 'internal_transfer'
   and ov.version_kind = 'record'
   and e.balance_amount is not null
   and sec.counts_in_personal(e.scope_id, o.id);
comment on view api.my_transfers is
  'F12/ADR-002 §7, §14: las transferencias entre usuarios vigentes en el Personal propio. direction sale de core.transfer_part; concept y contraparte, de la propuesta. Publica solo el ambito PROPIO.';
grant select on api.my_transfers to authenticated;
