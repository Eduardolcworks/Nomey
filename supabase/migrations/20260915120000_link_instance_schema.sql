-- ============================================================================
-- INSTANCIA DE VINCULO: IDENTIDAD, PROCEDENCIA, LINEA BASE Y HECHO DE BAJA
-- F10/ADR-001 §1, §3, §7, §11 — bloque F10.A2.1 (esquema y hechos persistidos)
-- ============================================================================
--
-- Lo que esta migracion deja, y lo que NO hace todavia.
--
--   §1  core.participant_user_link: `link_id` (identidad estable de la
--       instancia) y `origin_command_id` (procedencia: el comando que la creo).
--       `claim_command_id` se conserva SOLO como compatibilidad derivada (§6).
--   §2  core.link_baseline_subject (S0: los participantes crudos que resolvian
--       hacia P al nacer la instancia) y core.link_baseline (la version vigente
--       de cada operacion que atribuia algo a S0 al nacer). Insert-only y
--       SIN FK hacia la fila viva del vinculo: sobreviven a su baja (ADR §3).
--   §3  core.participant_unlink: el hecho insert-only de la baja (ADR §7). Sin
--       ningun grant: la funcion que lo escribe llega en F10.A2.2.
--   §4  Grants minimos, RLS y dos helpers definer de solo lectura.
--   §5  Relleno FAIL-CLOSED de los vinculos existentes: origen solo si es
--       demostrable, S0 = {P} solo si P nunca tuvo otra instancia, linea base
--       vacia solo si es demostrable sin reloj. Cualquier otro estado ABORTA
--       la migracion con diagnostico (ADR §11).
--   §6  `claim_command_id` como compatibilidad derivada: un CHECK la ata al
--       origen (una sola semantica) hasta su retirada en A2.2.
--   §7  sec.link_baseline_rows: la linea base de una reclamacion, con ids
--       crudos, leida por un definer de postgres bajo el rango 1.
--   §8  api.create_group: toma el rango 1, escribe origen y S0.
--   §9  api.redeem_invitation: claim y new escriben origen, S0 y (claim) la
--       linea base; rejoin no crea instancia.
--
-- NO hay unlink, ni evaluacion economica, ni aviso identity_released, ni
-- cambios de superficie `api` ni de cliente: A2.2 en adelante.
-- ============================================================================

-- ═══════════════════════ §1 · identidad y procedencia de la instancia ═══════
-- ADR §1. `link_id` es la identidad de la INSTANCIA: nace con el vinculo y
-- termina con su baja; sobrevive a salir y volver (rejoin no crea vinculo).
-- La PK sigue siendo participant_id: un participante, un vinculo vigente.
-- `origin_command_id` es la PROCEDENCIA y es otra columna a proposito: una
-- responde «¿que instancia?» y la otra «¿como nacio?». Nullable: nunca se
-- inventa (§5). La FK es compuesta porque provisioning_command se identifica
-- por (actor, comando), y asi el origen solo puede ser un comando del titular.
alter table core.participant_user_link
  add column link_id           uuid not null default gen_random_uuid(),
  add column origin_command_id uuid;
alter table core.participant_user_link
  add constraint participant_user_link_instancia_unica unique (link_id),
  add constraint participant_user_link_origen
    foreign key (user_id, origin_command_id)
    references core.provisioning_command (created_by, client_command_id);
comment on column core.participant_user_link.link_id is
  'Identidad estable de la INSTANCIA de vinculo (F10/ADR-001 §1): ancla del CAS, del replay y de la auditoria. Sobrevive a salir y volver; termina solo con la baja.';
comment on column core.participant_user_link.origin_command_id is
  'Procedencia: el comando de provisioning que creo la instancia (group.create, invitation.redeem new/claim). Nula solo si no es demostrable; nunca se inventa (F10/ADR-001 §11).';

-- ═══════════════════════ §2 · linea base de la instancia ════════════════════
-- ADR §3. Dos relaciones insert-only. `link_id` NO lleva FK al vinculo vivo:
-- estas filas son la historia de la instancia y se conservan tras la baja,
-- y `core` no usa `on delete cascade`. La integridad de CREACION la dan la
-- policy (solo el titular, solo bajo una instancia viva, solo su ambito), las
-- funciones autoritativas y la guarda de catalogo; la de TERMINACION,
-- core.participant_unlink, que conserva la identidad exacta de la instancia.
create table core.link_baseline_subject (
  link_id        uuid not null,
  participant_id uuid not null references core.participant (id),
  primary key (link_id, participant_id)
);
comment on table core.link_baseline_subject is
  'S0 de la instancia (F10/ADR-001 §2.1, §3): los participantes CRUDOS que resolvian hacia P al nacer —P y los origenes ya fusionados en P—. Insert-only; sobrevive a la baja del vinculo.';

create table core.link_baseline (
  link_id             uuid not null,
  operation_id        uuid not null references core.operation (id),
  baseline_version_id uuid not null references core.operation_version (id),
  primary key (link_id, operation_id),
  -- La version base pertenece exactamente a la operacion (operation_version
  -- tiene unique (operation_id, id) desde su migracion).
  constraint link_baseline_version_de_la_operacion
    foreign key (operation_id, baseline_version_id)
    references core.operation_version (operation_id, id)
);
comment on table core.link_baseline is
  'Linea base de la instancia (F10/ADR-001 §3): para cada operacion del grupo cuya version vigente atribuia algo a S0 al nacer la instancia, esa version. Vacia por construccion para create/new. Insert-only; sobrevive a la baja.';

-- ═══════════════════════ §3 · el hecho de baja ═════════════════════════════
-- ADR §7. Sin FK a link_id (el vinculo ya no existe cuando se escribe). Dos
-- comandos DISTINTOS con dos FK independientes: `origin_command_id` es como
-- nacio la instancia; `client_command_id` es el comando que la termino. Los
-- dos se identifican como todo comando de provisioning: (actor, comando).
-- `unlinked_by = user_id` es el principio de no adjudicacion como DATO (§0):
-- en F10 solo el titular termina su instancia.
create table core.participant_unlink (
  id                uuid primary key default gen_random_uuid(),
  link_id           uuid not null unique,
  participant_id    uuid not null,
  scope_id          uuid not null references core.scope (id),
  user_id           uuid not null,
  unlinked_by       uuid not null,
  origin_command_id uuid,
  reason            text not null,
  client_command_id uuid not null,
  unlinked_at       timestamptz not null default now(),
  constraint participant_unlink_participante_del_ambito
    foreign key (participant_id, scope_id) references core.participant (id, scope_id),
  constraint participant_unlink_origen
    foreign key (user_id, origin_command_id)
    references core.provisioning_command (created_by, client_command_id),
  constraint participant_unlink_comando_unico unique (user_id, client_command_id),
  constraint participant_unlink_comando
    foreign key (user_id, client_command_id)
    references core.provisioning_command (created_by, client_command_id),
  constraint participant_unlink_actor_es_titular check (unlinked_by = user_id),
  constraint participant_unlink_motivo check (reason = 'self')
);
comment on table core.participant_unlink is
  'Una instancia de vinculo terminada por su titular (F10/ADR-001 §7). Insert-only. Conserva la identidad exacta de la instancia (link_id), su procedencia y el comando que la termino. Sin ruta de escritura hasta F10.A2.2.';

-- ═══════════════════════ §4 · grants, RLS y helpers ═════════════════════════
-- Las tres nacen con RLS y sin nada para PUBLIC, `authenticated` ni el writer.
-- El provisioner gana SOLO insert/select en las dos de linea base (las
-- escribe al crear el vinculo) y NADA en participant_unlink. Nadie tiene
-- update ni delete: insert-only de verdad, no por convencion.
alter table core.link_baseline_subject enable row level security;
alter table core.link_baseline         enable row level security;
alter table core.participant_unlink    enable row level security;
revoke all on core.link_baseline_subject, core.link_baseline, core.participant_unlink from public;
grant select, insert on core.link_baseline_subject, core.link_baseline to nomey_provisioner;

-- Dos helpers definer de postgres, de solo lectura y con predicado cerrado,
-- para que las policies del provisioner no dependan de lo que ese rol ve por
-- su propia RLS (sus policies sobre participant y effect estan acotadas a
-- proposito y no sirven para esta pregunta).
create function sec.participant_in_scope(p_participant uuid, p_scope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from core.participant p where p.id = p_participant and p.scope_id = p_scope);
$fn$;
revoke execute on function sec.participant_in_scope(uuid, uuid) from public;
grant execute on function sec.participant_in_scope(uuid, uuid) to nomey_provisioner;

-- Una version «toca» un ambito si alguno de sus efectos vive en el.
create function sec.version_touches_scope(p_version uuid, p_scope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from core.effect e where e.operation_version_id = p_version and e.scope_id = p_scope);
$fn$;
revoke execute on function sec.version_touches_scope(uuid, uuid) from public;
grant execute on function sec.version_touches_scope(uuid, uuid) to nomey_provisioner;

-- Solo bajo una instancia VIVA del propio actor, y solo un participante del
-- MISMO ambito que esa instancia: un fallo del provisioner no puede meter en
-- S0 a alguien de otro grupo.
create policy link_baseline_subject_provisioner_insert on core.link_baseline_subject
  for insert to nomey_provisioner
  with check (exists (
    select 1 from core.participant_user_link l
     where l.link_id = link_baseline_subject.link_id
       and l.user_id = sec.request_actor_id()
       and sec.participant_in_scope(link_baseline_subject.participant_id, l.scope_id)));
create policy link_baseline_subject_provisioner_select on core.link_baseline_subject
  for select to nomey_provisioner
  using (exists (
    select 1 from core.participant_user_link l
     where l.link_id = link_baseline_subject.link_id and l.user_id = sec.request_actor_id()));

-- Idem para la linea base: solo el titular, solo una instancia viva, y solo
-- una version que tenga efectos en el ambito de esa instancia.
create policy link_baseline_provisioner_insert on core.link_baseline
  for insert to nomey_provisioner
  with check (exists (
    select 1 from core.participant_user_link l
     where l.link_id = link_baseline.link_id
       and l.user_id = sec.request_actor_id()
       and sec.version_touches_scope(link_baseline.baseline_version_id, l.scope_id)));
create policy link_baseline_provisioner_select on core.link_baseline
  for select to nomey_provisioner
  using (exists (
    select 1 from core.participant_user_link l
     where l.link_id = link_baseline.link_id and l.user_id = sec.request_actor_id()));

-- participant_unlink: RLS activada y NINGUNA policy ni grant. Con RLS y sin
-- policy el resultado es denegacion total para todo rol que no sea el
-- propietario, que es el estado seguro hasta que exista el comando (A2.2).

-- ═══════════════════════ §5 · relleno FAIL-CLOSED ═══════════════════════════
-- ADR §11. Para cada vinculo existente:
--   origen  → exactamente UN comando candidato del mismo actor y ambito
--             (group.create con ese creator_participant_id; invitation.redeem
--             new; invitation.redeem claim con ese participant_id, que ademas
--             ha de coincidir con claim_command_id si no es nulo); si no, nulo.
--   S0      → {P} solo si P NUNCA tuvo otra instancia (core.participant_unclaim
--             sin filas para P): toda fusion con destino P exigio P vinculado,
--             y esta es su unica instancia, asi que cualquier fusion es
--             posterior a ella. Si hubo otra instancia, el orden entre esa
--             fusion y este vinculo no es demostrable sin reloj → ABORTA.
--   base    → vacia si el origen es create/new (el participante nacio con el
--             vinculo) o si NINGUNA version de la historia tiene efectos que
--             nombren a P (las versiones son inmutables: si ninguna lo nombra
--             hoy, ninguna lo nombraba al nacer). En otro caso solo el reloj
--             podria decir cuales eran vigentes al nacer → ABORTA.
-- Nada se infiere por timestamps y ninguna linea base se inventa. El
-- diagnostico nombra el vinculo; el runbook indica reiniciar la base local.
do $backfill$
declare
  r          record;
  v_cands    uuid[];
  v_kinds    text[];
  v_origin   uuid;
  v_kind     text;
  v_problems text[] := '{}';
  v_filled   integer := 0;
begin
  for r in select l.participant_id, l.scope_id, l.user_id, l.link_id, l.claim_command_id
             from core.participant_user_link l
            order by l.linked_at, l.participant_id
  loop
    select coalesce(array_agg(c.cmd), '{}'), coalesce(array_agg(c.kind), '{}')
      into v_cands, v_kinds
      from (
        select pc.client_command_id as cmd, 'create' as kind
          from core.provisioning_command pc
         where pc.command_type = 'group.create'
           and pc.created_by = r.user_id and pc.result_scope_id = r.scope_id
           and (pc.canonical_intent ->> 'creator_participant_id')::uuid = r.participant_id
        union all
        select pc.client_command_id, 'new'
          from core.provisioning_command pc
         where pc.command_type = 'invitation.redeem'
           and pc.created_by = r.user_id and pc.result_scope_id = r.scope_id
           and pc.canonical_intent ->> 'choice' = 'new'
        union all
        select pc.client_command_id, 'claim'
          from core.provisioning_command pc
         where pc.command_type = 'invitation.redeem'
           and pc.created_by = r.user_id and pc.result_scope_id = r.scope_id
           and pc.canonical_intent ->> 'choice' = 'claim'
           and (pc.canonical_intent ->> 'participant_id')::uuid = r.participant_id
           and (r.claim_command_id is null or r.claim_command_id = pc.client_command_id)
      ) c;

    if cardinality(v_cands) = 1 then
      v_origin := v_cands[1];
      v_kind   := v_kinds[1];
      update core.participant_user_link set origin_command_id = v_origin where link_id = r.link_id;
      v_filled := v_filled + 1;
    else
      v_origin := null;
      v_kind   := 'unknown';
    end if;

    -- S0
    if exists (select 1 from core.participant_unclaim u where u.participant_id = r.participant_id) then
      v_problems := array_append(v_problems,
        format('vinculo %s (participante %s): tuvo otra instancia antes; S0 no es demostrable', r.link_id, r.participant_id));
      continue;
    end if;
    insert into core.link_baseline_subject (link_id, participant_id) values (r.link_id, r.participant_id);

    -- linea base
    if v_kind in ('create', 'new') then
      null; -- vacia por construccion: el participante nacio con el vinculo
    elsif not exists (
      select 1 from core.effect e
       where e.economic_participant_id = r.participant_id
          or e.debt_debtor_participant_id = r.participant_id
          or e.debt_creditor_participant_id = r.participant_id) then
      null; -- vacia y demostrable: ninguna version de la historia lo nombra
    else
      v_problems := array_append(v_problems,
        format('vinculo %s (participante %s, origen %s): hay versiones que lo nombran y la linea base al nacer no es demostrable sin reloj',
               r.link_id, r.participant_id, v_kind));
    end if;
  end loop;

  if cardinality(v_problems) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'F10/ADR-001 §11: la linea base de estas instancias no es reconstruible; no se inventa. Reinicia la base local (docs/runbooks/local-setup.md) o corrige los datos: ' || array_to_string(v_problems, ' | ');
  end if;

  raise notice 'relleno F10/ADR-001: % vinculos, % con origen demostrable, todos con S0 y linea base demostrables',
    (select count(*) from core.participant_user_link), v_filled;
end
$backfill$;

-- ═══════════════════════ §6 · compatibilidad derivada ═══════════════════════
-- `claim_command_id` deja de ser la fuente normativa (ADR §1, §12) y se
-- retira con A2.2. Mientras exista, no puede decir otra cosa que el origen.
alter table core.participant_user_link
  add constraint participant_user_link_claim_es_origen
    check (claim_command_id is null or claim_command_id = origin_command_id);

-- ═══════════════════════ §7 · la linea base de una reclamacion ══════════════
-- ADR §3. Definer de postgres: lee core.operation y core.effect por version
-- (ids CRUDOS, nunca sec.canonical_participant) y devuelve, para el ambito,
-- la version VIGENTE de cada operacion que atribuye —economica o deuda— algo
-- a alguno de los sujetos. Solo lee; el provisioner inserta bajo su policy.
-- Se invoca bajo sec.lock_participant_claims(ambito), que todo escritor de
-- atribucion sostiene: el corte es consistente sin reloj.
create function sec.link_baseline_rows(p_scope uuid, p_subjects uuid[])
returns table (operation_id uuid, baseline_version_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct o.id, o.current_version_id
    from core.operation o
    join core.effect e on e.operation_version_id = o.current_version_id
   where e.scope_id = p_scope
     and (e.economic_participant_id    = any (p_subjects)
       or e.debt_debtor_participant_id   = any (p_subjects)
       or e.debt_creditor_participant_id = any (p_subjects));
$fn$;
revoke execute on function sec.link_baseline_rows(uuid, uuid[]) from public;
grant execute on function sec.link_baseline_rows(uuid, uuid[]) to nomey_provisioner;

-- ═══════════════════════ §8 · api.create_group ══════════════════════════════
-- Recreada desde el cuerpo vivo con TRES cambios: toma el rango 1 sobre el
-- ambito que va a crear (justo despues de la clave, antes de escribir nada),
-- escribe `origin_command_id` en el vinculo del creador, y escribe S0 = {P}.
-- Linea base: vacia por construccion (el participante nace aqui).
CREATE OR REPLACE FUNCTION api.create_group(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'client_group_id',
    'display_name', 'emoji', 'currency_definition_id', 'default_category_id',
    'creator_participant_id', 'creator_display_name', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor    uuid;
  v_command  uuid;
  v_version  integer;
  v_scope    uuid;
  v_currency uuid;
  v_name     text;
  v_emoji    text;
  v_default  uuid;
  v_creator  uuid;
  v_creator_name text;
  v_parts    jsonb;
  v_ids      uuid[];
  v_intent   jsonb;
  v_stored   jsonb;
  v_result   uuid;
  v_replay   boolean := false;
  v_item     jsonb;
  v_link     uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  v_actor    := sec.request_actor_id();
  v_command  := sec.payload_uuid(payload, 'client_command_id', true);
  v_version  := sec.payload_contract_version(payload);
  v_scope    := sec.payload_uuid(payload, 'client_group_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_creator  := sec.payload_uuid(payload, 'creator_participant_id', true);
  v_name     := sec.canonical_display_name(sec.payload_text(payload, 'display_name', true));
  v_creator_name := sec.canonical_display_name(sec.payload_text(payload, 'creator_display_name', true));
  v_emoji    := sec.payload_text(payload, 'emoji', true);
  v_parts    := coalesce(payload -> 'participants', '[]'::jsonb);

  perform sec.assert_object_array_shape(v_parts, 'participants', c_participant_fields);

  -- El nombre ya viene comprobado por `sec.canonical_display_name`. El emoji no
  -- se canonicaliza —un emoji no lleva espacios que colapsar— pero si se exige.
  if btrim(v_emoji) = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'emoji no puede quedar vacio', 400);
  end if;

  -- LA CATEGORIA PREESTABLECIDA, opcional. Nula es «Todas»: ningun gasto nuevo
  -- nace con categoria. Si viene, tiene que ser una que un gasto compartido
  -- pueda llevar —de sistema y activa—, con la MISMA regla que el gasto.
  v_default := sec.payload_uuid(payload, 'default_category_id', false);
  if v_default is not null then
    perform sec.assert_shared_category_usable(v_default, null);
  end if;

  -- Las identidades de participante son del cliente y tienen que ser unicas
  -- entre si y distintas de la del creador: dos filas con el mismo id
  -- reventarian a mitad de la insercion, y el rechazo debe ser del contrato.
  select array_agg((p ->> 'client_participant_id')::uuid)
    into v_ids
    from jsonb_array_elements(v_parts) as e(p);
  v_ids := coalesce(v_ids, array[]::uuid[]);

  -- `cardinality` y no `array_length`: el segundo devuelve NULL sobre un array
  -- vacio, y la comparacion daba un falso positivo cuando no habia participantes.
  if cardinality(v_ids) <> cardinality(array(select distinct unnest(v_ids))) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'hay identidades de participante repetidas', 400);
  end if;
  if v_creator = any (v_ids) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un participante repite la identidad del creador', 400);
  end if;

  if not exists (select 1 from core.currency_definition c where c.id = v_currency) then
    perform sec.raise_boundary('CURRENCY_NOT_SUPPORTED',
      'esa definicion monetaria no esta en el catalogo soportado', 422);
  end if;

  -- La intencion CANONICA. El nombre ya normalizado y los participantes con su
  -- nombre normalizado, en el orden en que llegaron: es exactamente lo que se
  -- va a escribir, no lo que se recibio.
  v_intent := jsonb_build_object(
    'client_group_id',        v_scope,
    'display_name',           v_name,
    'emoji',                  v_emoji,
    'default_category_id',    v_default::text,
    'currency_definition_id', v_currency,
    'creator_participant_id', v_creator,
    'creator_display_name',   v_creator_name,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_participant_id', p ->> 'client_participant_id',
               'display_name',          sec.canonical_display_name(p ->> 'display_name'))
               order by ord)
        from jsonb_array_elements(v_parts) with ordinality as e(p, ord)
    ), '[]'::jsonb));

  -- ---------- el reclamo de la clave, antes de crear nada ----------
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.create', v_version, v_intent, v_scope);
  exception when unique_violation then
    -- Ya reclamada. Puede ser un replay legitimo o una reutilizacion.
    v_replay := true;
  end;

  if v_replay then
    select pc.canonical_intent, pc.result_scope_id into v_stored, v_result
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;

    if v_stored is null then
      -- La carrera perdio contra otra sesion que todavia no ha confirmado. No
      -- se inventa nada: el cliente reintenta, que es seguro por definicion.
      perform sec.raise_boundary('COMMAND_IN_FLIGHT',
        'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;

    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED',
        'esa clave ya se uso con una intencion distinta', 409);
    end if;

    return sec.group_envelope(v_result, true);
  end if;

  -- ---------- el cerrojo de identidad del grupo (rango 1) ----------
  --
  -- F10/ADR-001 §3: toda alta de instancia de vinculo escribe su linea base y
  -- su S0 bajo sec.lock_participant_claims(ambito). Un ambito que nace en
  -- esta transaccion no tiene competidores, pero el invariante se cumple de
  -- forma literal en vez de documentar una excepcion: clave (0) → cerrojo
  -- (1) → escrituras. La guarda de catalogo group-identity-lock.sql lo vigila.
  perform sec.lock_participant_claims(v_scope);

  -- ---------- la creacion, ya con la clave nuestra ----------
  --
  -- Si el ambito ya existe es de otro comando o de otra persona, y en los dos
  -- casos se rechaza: adoptarlo dejaria apuntar a un ambito ajeno.
  --
  -- **Lo detecta la clave primaria, no una lectura previa.** Una lectura la
  -- acota la RLS del provisioner, que a proposito solo alcanza ambitos sin
  -- miembros: preguntarle por un grupo ajeno diria "no existe" y el codigo
  -- seguiria adelante. La PK no se puede acotar.
  --
  -- Se captura para dar el codigo de frontera y se RELANZA acto seguido; no
  -- continua. La regla de ADR-009 §5 existe para que ninguna excepcion
  -- convierta un fallo en escritura parcial, y aqui no hay continuacion.
  begin
    insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
    values (v_scope, 'group', v_currency, null);
  exception when unique_violation then
    perform sec.raise_boundary('SCOPE_ID_TAKEN',
      'ese identificador de ambito ya existe', 409);
  end;

  insert into core.membership (scope_id, user_id) values (v_scope, v_actor);

  insert into core.group_profile (scope_id, display_name, emoji, created_by, default_category_id)
  values (v_scope, v_name, v_emoji, v_actor, v_default);

  -- El participante del creador, y su vinculo con la cuenta. El vinculo es lo
  -- que le da identidad contextual; la membresia de arriba es lo que le da
  -- acceso. Son dos hechos distintos y ADR-012 §4 exige no confundirlos.
  insert into core.participant (id, scope_id, display_name)
  values (v_creator, v_scope, v_creator_name);

  -- LA INSTANCIA (F10/ADR-001 §1, §3): identidad propia, procedencia = este
  -- comando, y S0 = {P}. Linea base vacia por construccion: el participante
  -- acaba de nacer y ninguna version puede nombrarlo.
  insert into core.participant_user_link (participant_id, scope_id, user_id, origin_command_id)
  values (v_creator, v_scope, v_actor, v_command)
  returning link_id into v_link;
  insert into core.link_baseline_subject (link_id, participant_id) values (v_link, v_creator);

  -- ============ LA PRESENCIA DEL CREADOR, desde el día de la creación =========
  --
  -- Sin periodo NADIE es elegible en ninguna fecha —`sec.assert_participant_eligible`
  -- lo dice literalmente— y por eso ningún gasto de grupo se podía registrar.
  -- Se abre AQUÍ, en la misma transacción que crea al participante: son el mismo
  -- hecho —«esta persona está en el grupo desde que el grupo existe»— y separarlos
  -- dejaría una ventana en la que el grupo existe y nadie puede gastar.
  --
  -- **`[current_date, ∞)`, abierto por arriba.** Cerrar el periodo exigiría saber
  -- cuándo se va, que es una decisión de ciclo de vida que pertenece a F10.
  --
  -- **Un reintepto idempotente no lo duplica ni lo desplaza**: `sec.claim_provisioning`
  -- devuelve antes de llegar aquí cuando el comando ya se ejecutó, así que este
  -- bloque corre exactamente una vez por grupo.
  insert into core.participant_period (participant_id, valid_from, valid_until)
  values (v_creator, current_date, null);

  -- Los demas: nombre y nada mas. Sin cuenta, sin vinculo y sin capacidad de
  -- actuar hasta que reclamen su nombre (F09/ADR-004).
  for v_item in select value from jsonb_array_elements(v_intent -> 'participants') loop
    insert into core.participant (id, scope_id, display_name)
    values ((v_item ->> 'client_participant_id')::uuid, v_scope, v_item ->> 'display_name');

    -- Y su presencia, con la misma fecha y el mismo criterio que la del creador.
    -- Sin cuenta y sin vínculo, pero presentes: participar en un gasto no exige
    -- tener cuenta (ADR-012 §1), sólo haber estado.
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values ((v_item ->> 'client_participant_id')::uuid, current_date, null);
  end loop;

  return sec.group_envelope(v_scope, false);
end
$function$;

-- ═══════════════════════ §9 · api.redeem_invitation ═════════════════════════
-- Recreada desde el cuerpo vivo (20260914140000) con cambios minimos:
--   claim → origin_command_id = este comando (y claim_command_id igual,
--           mientras dure la compatibilidad de §5); S0 = {P} ∪ {origenes ya
--           fusionados en P}; linea base = sec.link_baseline_rows(ambito, S0),
--           todo bajo el rango 1 que la funcion ya toma antes de leer.
--   new   → origin_command_id = este comando; S0 = {P}; linea base vacia.
--   rejoin → sin cambios: no crea instancia (mismo link_id, misma base, mismo S0).
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
    --      compatibilidad derivada hasta A2.2.
    begin
      insert into core.participant_user_link (participant_id, scope_id, user_id, claim_command_id, origin_command_id)
      values (v_target, v_inv.scope_id, v_actor, v_command, v_command)
      returning link_id into v_link;
    exception when unique_violation then
      perform sec.raise_boundary('PARTICIPANT_ALREADY_CLAIMED', 'otra cuenta acaba de reclamar ese participante', 409);
    end;
    -- 4a · S0 y LINEA BASE (F10/ADR-001 §2.1, §3), bajo el rango 1 ya tomado:
    --      S0 = P mas los origenes que HOY resuelven hacia P (crudos); la base,
    --      la version vigente de cada operacion del grupo que atribuye algo a
    --      alguno de ellos. Un reclamante hereda lo que el participante ya era.
    select array_agg(x) into v_s0
      from (select v_target as x
            union
            select m.source_participant_id from core.participant_merge m where m.target_participant_id = v_target) s;
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
