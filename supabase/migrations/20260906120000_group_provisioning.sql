-- Provisioning de Grupo: perfil, idempotencia por clave y creacion atomica.
--
-- Decimonovena migracion, y la que abre el modelo de Grupo. Trae:
--
--   core.group_profile          nombre y emoji del grupo. Relacion PROPIA
--   core.provisioning_command   idempotencia por clave de los comandos de
--                               provisioning iniciados por el cliente
--   api.create_group            la unica frontera que crea un grupo
--   api.group_profile           vista: los grupos alcanzables por el actor
--   api.group_participant       vista: sus participantes
--
-- ADR-032 (modelo y permisos de Grupo) y ADR-033 (idempotencia de provisioning
-- iniciada por cliente).
--
-- =================== POR QUE UNA RELACION Y NO DOS COLUMNAS ================
--
-- `core.scope` es el ancla contable y de autorizacion, y su vocabulario de
-- columnas es el que comparten los TRES tipos de ambito. Un nombre y un emoji
-- son de Grupo y no del Modo Personal, exactamente igual que el concepto de un
-- movimiento es de unas clases y no de otras: el modelo ya resolvio ese caso
-- con relaciones propias —`core.movement_detail`, `core.expense_category`— y
-- este es el mismo caso una capa mas arriba.
--
-- La migracion de `core.scope` lo dejo escrito: «Los atributos de Grupo y Modo
-- Pareja llegan en sus fases». Llegan aqui, y llegan al lado.
--
-- ========================= POR QUE NO HAY NINGUN ROL =======================
--
-- No hay `owner`, no hay `admin` y `created_by` NO es un privilegio: es
-- atribucion para el historial futuro. Quien puede actuar sobre un grupo lo
-- decide `core.membership`, cuya migracion ya dice que ningun ADR fija roles
-- dentro de un ambito. Toda cuenta con membresia tiene la misma capacidad.
--
-- Un participante sin `core.participant_user_link` no tiene membresia, asi que
-- no puede actuar: no es una regla escrita en ningun sitio, es que no hay
-- ninguna fila que le de acceso. Reclamar su nombre —F10— creara el vinculo y
-- la membresia, y con ellos exactamente la misma capacidad que los demas.
--
-- =================== POR QUE NO ES `core.client_command` ===================
--
-- Esa relacion exige `result_operation_id` y `result_version_id` NOT NULL con
-- FK a `core.operation_version`. Crear un grupo no produce ninguna operacion ni
-- ninguna version, y ADR-019 §6 ya decidio que el provisioning no entra ahi:
-- «contaminaria la relacion contable y obligaria a inventarle un command_type
-- para algo que no lo es».
--
-- Pero el provisioning del Modo Personal se libro con idempotencia POR ESTADO
-- —un indice unico hacia seguro el reintento— y crear un grupo no puede: dos
-- grupos con el mismo nombre y los mismos participantes son legitimamente dos
-- grupos. Hace falta una CLAVE, y por eso una relacion hermana.

-- ============================ 1 · el perfil de grupo =======================

-- El destino de la FK compuesta de abajo. Redundante como restriccion —`id` ya
-- es clave— y necesario como destino, igual que `scope_id_moneda_unico`.
alter table core.scope add constraint scope_id_kind_unico unique (id, kind);

create table core.group_profile (
  scope_id     uuid        primary key references core.scope (id),
  -- REDUNDANTE Y ESTRUCTURAL. Con la FK compuesta de abajo y el CHECK, es lo
  -- que hace imposible que un perfil cuelgue de un ambito que no sea de tipo
  -- grupo. Sin ella la regla dependeria de que el codigo no se equivoque, y
  -- un CHECK no puede mirar otra tabla.
  scope_kind   text        not null default 'group',
  display_name text        not null,
  emoji        text        not null,
  -- ATRIBUCION, NO PRIVILEGIO. Quien creo el grupo, para el historial que
  -- vendra. No concede nada: la capacidad la da `core.membership` y nada mas.
  created_by   uuid        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- El unico contrato que existe sobre un texto de presentacion en este modelo
  -- es el de `core.participant.display_name`: no vacio, y NINGUNA longitud
  -- maxima. Se replica tal cual en vez de inventar un tope.
  constraint group_profile_nombre_no_vacio check (display_name <> ''),
  constraint group_profile_emoji_no_vacio  check (emoji <> ''),
  constraint group_profile_solo_grupo check (scope_kind = 'group'),

  constraint group_profile_ambito_de_grupo
    foreign key (scope_id, scope_kind) references core.scope (id, kind)
);

comment on table core.group_profile is
  'Atributos de presentacion de un ambito de tipo grupo. Relacion propia: `core.scope` es el ancla contable y no describe (ADR-032).';
comment on column core.group_profile.created_by is
  'Quien creo el grupo. ATRIBUCION para el historial, nunca un privilegio: no existen roles internos (ADR-032).';

alter table core.group_profile enable row level security;

comment on column core.group_profile.scope_kind is
  'Siempre `group`. Con el CHECK y la FK compuesta, hace ESTRUCTURAL que un perfil solo cuelgue de un ambito de grupo (ADR-032).';

-- ================== 2 · idempotencia de provisioning por clave =============
--
-- Hermana de `core.client_command` y deliberadamente NO su copia:
--
--   · sin `result_operation_id` ni `result_version_id`: no hay operacion;
--   · con `result_scope_id`, que es lo que este comando produce;
--   · `command_type` NO entra en la clave, igual que alli: la unicidad es
--     transversal, asi que una misma clave no puede reaparecer disfrazada de
--     otro comando.
--
-- `canonical_intent` guarda la intencion tal y como el servidor la entendio.
-- Es lo que permite distinguir un REPLAY —misma clave, misma intencion— de una
-- REUTILIZACION —misma clave, intencion distinta—, que es un error del cliente
-- y se rechaza en vez de devolver algo que no pidio.

create table core.provisioning_command (
  created_by               uuid        not null,
  client_command_id        uuid        not null,
  command_type             text        not null,
  command_contract_version integer     not null,
  canonical_intent         jsonb       not null,
  result_scope_id          uuid        not null,
  created_at               timestamptz not null default now(),

  constraint provisioning_command_pk primary key (created_by, client_command_id),
  constraint provisioning_command_type_no_vacio check (command_type <> ''),
  constraint provisioning_command_contrato_positivo check (command_contract_version >= 1),

  -- DIFERIBLE, y por la misma razon que la de `core.client_command`: la clave
  -- se reclama ANTES de crear el ambito —ADR-011 §13 aplicado al provisioning—,
  -- asi que durante un instante apunta a una fila que todavia no existe. Al
  -- final de la transaccion existe o no existe nada.
  constraint provisioning_command_result_fk
    foreign key (result_scope_id) references core.scope (id)
    deferrable initially deferred
);

comment on table core.provisioning_command is
  'Unidad fisica de idempotencia de los comandos de PROVISIONING de origen cliente. Unicidad transversal a tipos (ADR-033). No cubre cargos recurrentes, importaciones ni comandos de origen backend: siguen abiertos.';

alter table core.provisioning_command enable row level security;

-- ================================ 3 · privilegios ==========================
-- Cada grant corresponde a una ruta concreta de `api.create_group`. Ninguno
-- "por si acaso", y en particular NADA para el cliente: `authenticated` no
-- recibe ni un privilegio sobre estas dos tablas.

-- El helper de version de contrato lo tenia solo el writer: este es el primer
-- comando de provisioning que lleva version de payload.
grant execute on function sec.payload_contract_version(jsonb) to nomey_provisioner;
-- Sus propias policies de SELECT preguntan por la membresia: sin este EXECUTE
-- fallan con 42501 dentro del definer, igual que midio E21/A con el helper de
-- identidad.
grant execute on function sec.is_member(uuid)                 to nomey_provisioner;

grant select, insert on core.group_profile        to nomey_provisioner;
grant select, insert on core.provisioning_command to nomey_provisioner;

-- Ya tenia `insert` sobre `core.scope` y `core.membership` para el Modo
-- Personal; lo que le faltaba es el resto de la fila de un grupo.
grant select, insert on core.participant           to nomey_provisioner;
grant select, insert on core.participant_user_link to nomey_provisioner;

-- ================================ 4 · policies =============================
-- Todas acotadas al actor. NINGUNA aplica a PUBLIC ni a `authenticated`.
--
-- E21 midio tres veces el mismo modo de fallo —privilegio concedido y policy
-- ausente devuelve CERO FILAS SIN ERROR—, asi que cada SELECT que la funcion
-- necesita tiene la suya, incluidas las que solo sirven para que un `WITH
-- CHECK` pueda mirar otra tabla.

-- El ambito de grupo: se crea con el actor como creador de su perfil, pero el
-- ambito NO tiene owner. `owner_user_id` es null para todo lo que no sea
-- personal, y el indice unico `scope_un_personal_por_usuario` lo garantiza.
create policy scope_provisioner_group_insert on core.scope
  for insert to nomey_provisioner
  with check (kind = 'group' and owner_user_id is null);

-- SOLO LOS GRUPOS DE LOS QUE YA ES MIEMBRO EL ACTOR.
--
-- Una version anterior abria esto a «cualquier grupo sin miembros» para poder
-- crear la primera membresia. Era una propiedad TEMPORAL y demasiado ancha:
-- describe un instante, no una autorizacion, y cualquier funcion futura del
-- provisioner la habria heredado como capacidad. Se retiro.
--
-- La primera membresia se autoriza ahora con el RECLAMO —ver la policy de
-- `core.membership`—, asi que nada necesita leer un ambito ajeno.
create policy scope_provisioner_group_member_select on core.scope
  for select to nomey_provisioner
  using (kind = 'group' and sec.is_member(id));

create policy group_profile_provisioner_insert on core.group_profile
  for insert to nomey_provisioner
  with check (created_by = sec.request_actor_id());

create policy group_profile_provisioner_select on core.group_profile
  for select to nomey_provisioner
  using (sec.is_member(scope_id));

-- LA PRIMERA MEMBRESIA SE AUTORIZA CON EL RECLAMO, no con el estado.
--
-- El reclamo de `core.provisioning_command` ya ocurrio en esta misma
-- transaccion y es especifico hasta el ultimo campo: lo escribio ESTE actor,
-- apunta a ESTE ambito y es de tipo `group.create`. Una clave de otra persona,
-- de otro ambito o de otro tipo de comando no autoriza nada, y una clave
-- reclamada con otra intencion ni siquiera llega hasta aqui: la funcion la
-- rechaza antes con IDEMPOTENCY_KEY_REUSED.
--
-- Fuera de esa transaccion la autorizacion no existe, porque el reclamo y la
-- creacion son la misma: si la transaccion se va, la fila del reclamo se va
-- con ella.
--
-- Ya no hace falta mirar `core.scope`: que el ambito sea de tipo grupo lo
-- garantiza la FK compuesta de `core.group_profile`, que es estructura.
create policy membership_provisioner_group_insert on core.membership
  for insert to nomey_provisioner
  with check (
    user_id = sec.request_actor_id()
    and exists (
      select 1 from core.provisioning_command pc
      where pc.result_scope_id = membership.scope_id
        and pc.created_by = sec.request_actor_id()
        and pc.command_type = 'group.create'
    )
  );

create policy participant_provisioner_insert on core.participant
  for insert to nomey_provisioner
  with check (sec.is_member(scope_id));

create policy participant_provisioner_select on core.participant
  for select to nomey_provisioner
  using (sec.is_member(scope_id));

-- El vinculo del participante del CREADOR con su propia cuenta. Ningun otro:
-- vincular a un tercero es reclamar por el, y eso exige la prueba de
-- autorizacion que F10 decidira.
create policy participant_link_provisioner_insert on core.participant_user_link
  for insert to nomey_provisioner
  with check (user_id = sec.request_actor_id());

create policy provisioning_command_provisioner_all on core.provisioning_command
  for all to nomey_provisioner
  using      (created_by = sec.request_actor_id())
  with check (created_by = sec.request_actor_id());

-- ===================== 5 · lectura estricta de una lista ===================
-- El unico helper nuevo. Lee un array JSON de objetos y comprueba su forma
-- entera antes de que nadie mire su contenido: campos exactos, tipos exactos,
-- sin sobrantes. Es el equivalente de `sec.assert_payload_shape` un nivel mas
-- abajo, y existe porque `group.create` es el primer comando con estructura
-- anidada.

create function sec.assert_object_array_shape(p_node jsonb, p_label text, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_key  text;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s debe ser un array JSON', p_label), 400);
  end if;

  for v_item in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_item) <> 'object' then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        format('cada elemento de %s debe ser un objeto JSON', p_label), 400);
    end if;
    for v_key in select k from jsonb_object_keys(v_item) as k loop
      if not (v_key = any (p_allowed)) then
        perform sec.raise_boundary('PAYLOAD_INVALID',
          format('campo no admitido en %s: %s', p_label, v_key), 400);
      end if;
    end loop;
  end loop;
end
$fn$;

comment on function sec.assert_object_array_shape(jsonb, text, text[]) is
  'Forma estricta de una lista de objetos del payload: campos exactos y sin sobrantes, antes de mirar su contenido (ADR-008 §3).';

revoke execute on function sec.assert_object_array_shape(jsonb, text, text[]) from public;
grant  execute on function sec.assert_object_array_shape(jsonb, text, text[]) to nomey_provisioner;

-- ==================== 5 bis · el nombre visible, canonico ==================
--
-- **No es `sec.canonical_concept`, y no puede serlo.** Aquel recorta y
-- normaliza a NFC pero NO colapsa los espacios de dentro, y lo usan los siete
-- escritores contables: tocarlo cambiaria su intencion canonica y con ella su
-- idempotencia, para operaciones que ya existen.
--
-- Este es el de los nombres VISIBLES —el del grupo y el de cada
-- participante—, y hace las cuatro cosas que un nombre necesita:
--
--   1  NFC primero, para que `Jose` + acento combinante y `José` sean la
--      misma cadena antes de medir nada;
--   2  colapsa cualquier racha de espacios a uno solo. La clase es explicita
--      y cubre lo que `s` cubre en JavaScript —tabulador, saltos, NBSP y los
--      separadores Unicode—, porque `[[:space:]]` depende de la intercalacion
--      y aqui la respuesta no puede depender del entorno;
--   3  recorta los extremos;
--   4  rechaza el vacio, que no nombra nada.
--
-- **El servidor no confia en que el cliente haya normalizado.** Lo que se
-- almacena y lo que entra en `canonical_intent` sale de aqui, y de aqui solo.
-- La paridad con el cliente se garantiza con vectores compartidos
-- —`tests/vectors/display-names.json`—, no compartiendo codigo.

create function sec.canonical_display_name(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  c_espacios constant text := E'[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';
  v_out text := btrim(regexp_replace(normalize(coalesce(p_raw, ''), nfc), c_espacios, ' ', 'g'), ' ');
begin
  if v_out = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el nombre es obligatorio y no puede quedar vacio al normalizarlo', 400);
  end if;
  return v_out;
end
$fn$;

comment on function sec.canonical_display_name(text) is
  'Forma canonica de un nombre visible de grupo o participante: NFC, espacios colapsados, recortado y no vacio (ADR-032).';

revoke execute on function sec.canonical_display_name(text) from public;
grant  execute on function sec.canonical_display_name(text) to nomey_provisioner;

-- ========================= 6 · la respuesta de la frontera =================
-- Fuera de la funcion para que el replay y la creacion devuelvan LO MISMO
-- construido por el mismo codigo, y no dos objetos que puedan divergir.

create function sec.group_envelope(p_scope uuid, p_replay boolean)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'scope_id',                    g.scope_id,
    'display_name',                g.display_name,
    'emoji',                       g.emoji,
    'base_currency_definition_id', c.id,
    'currency_code',               c.code,
    'currency_scale',              c.scale,
    'participant_count',           (select count(*) from core.participant p
                                     where p.scope_id = g.scope_id),
    'created_at',                  g.created_at,
    'replay',                      p_replay)
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id
  where g.scope_id = p_scope;
$fn$;

comment on function sec.group_envelope(uuid, boolean) is
  'La respuesta de `api.create_group`, identica en creacion y en replay (ADR-033).';

revoke execute on function sec.group_envelope(uuid, boolean) from public;
grant  execute on function sec.group_envelope(uuid, boolean) to nomey_provisioner;

-- ============================ 7 · crear el grupo ===========================
--
-- UNA transaccion, UNA clave, y el reclamo de la clave ANTES de crear nada
-- —ADR-011 §13 aplicado a provisioning—. La secuencia importa:
--
--   1  forma del payload y del array de participantes;
--   2  actor de la SESION. Nunca un `created_by` del cliente;
--   3  intencion canonica: lo que el servidor entendio, no lo que llego;
--   4  reclamo de la clave. Si ya estaba: misma intencion -> replay; distinta
--      -> IDEMPOTENCY_KEY_REUSED. La carrera la resuelve la PK, capturando
--      `unique_violation` y releyendo — la UNICA excepcion capturada;
--   5  creacion completa. Si algo falla aqui, la transaccion entera se va y no
--      queda ni la fila de la clave.
--
-- `client_group_id` es la identidad DEFINITIVA del ambito, generada por el
-- cliente antes de encolar. Es lo que permite que la tarjeta y la navegacion
-- funcionen sin servidor. Una colision con un ambito que ya existe y no es de
-- este comando se RECHAZA: adoptarlo seria dejar que alguien apunte a un ambito
-- ajeno.

create function api.create_group(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'client_group_id',
    'display_name', 'emoji', 'currency_definition_id',
    'creator_participant_id', 'creator_display_name', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor    uuid;
  v_command  uuid;
  v_version  integer;
  v_scope    uuid;
  v_currency uuid;
  v_name     text;
  v_emoji    text;
  v_creator  uuid;
  v_creator_name text;
  v_parts    jsonb;
  v_ids      uuid[];
  v_intent   jsonb;
  v_stored   jsonb;
  v_result   uuid;
  v_replay   boolean := false;
  v_item     jsonb;
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

  insert into core.group_profile (scope_id, display_name, emoji, created_by)
  values (v_scope, v_name, v_emoji, v_actor);

  -- El participante del creador, y su vinculo con la cuenta. El vinculo es lo
  -- que le da identidad contextual; la membresia de arriba es lo que le da
  -- acceso. Son dos hechos distintos y ADR-012 §4 exige no confundirlos.
  insert into core.participant (id, scope_id, display_name)
  values (v_creator, v_scope, v_creator_name);

  insert into core.participant_user_link (participant_id, scope_id, user_id)
  values (v_creator, v_scope, v_actor);

  -- Los demas: nombre y nada mas. Sin cuenta, sin vinculo y sin capacidad de
  -- actuar hasta que reclamen su nombre (F10).
  for v_item in select value from jsonb_array_elements(v_intent -> 'participants') loop
    insert into core.participant (id, scope_id, display_name)
    values ((v_item ->> 'client_participant_id')::uuid, v_scope, v_item ->> 'display_name');
  end loop;

  return sec.group_envelope(v_scope, false);
end
$fn$;

-- Misma mecanica que el resto de la frontera: ceder la propiedad exige CREATE
-- sobre el schema y PIERDE LOS GRANT EXPLICITOS, asi que los grants van
-- DESPUES y el CREATE se devuelve en cuanto deja de hacer falta.
grant create on schema api to nomey_provisioner;
alter function api.create_group(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;

comment on function api.create_group(jsonb) is
  'Crea un grupo completo en una sola transaccion, idempotente por (actor, client_command_id). No acepta created_by del cliente (ADR-032, ADR-033).';

revoke execute on function api.create_group(jsonb) from public;
grant  execute on function api.create_group(jsonb) to authenticated;

-- ============================== 8 · lectura del cliente ====================
-- `security_invoker`, como el resto de `api`: la RLS que decide es la del
-- usuario real, no la de quien creo la vista (E19).

-- `group` es palabra reservada de SQL, asi que la vista no puede llamarse asi.
-- Se llama como la relacion que publica, que ademas es lo que describe.
create view api.group_profile
with (security_invoker = true) as
select g.scope_id,
       g.display_name,
       g.emoji,
       s.base_currency_definition_id,
       c.code  as currency_code,
       c.scale as currency_scale,
       (select count(*) from core.participant p where p.scope_id = g.scope_id) as participant_count,
       g.created_at
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id;

comment on view api.group_profile is
  'Los grupos alcanzables por el actor. `participant_count` incluye al creador (ADR-032).';

grant select on api.group_profile to authenticated;

create view api.group_participant
with (security_invoker = true) as
select p.id as participant_id,
       p.scope_id,
       p.display_name,
       p.created_at
  from core.participant p
  join core.scope s on s.id = p.scope_id
 where s.kind = 'group';

comment on view api.group_participant is
  'Los participantes de los grupos alcanzables. NO publica el vinculo con la cuenta: eso revelaria que identidad global hay detras (ADR-012 §1).';

grant select on api.group_participant to authenticated;

grant select on core.group_profile to authenticated;

-- Las policies de lectura del cliente. `core.participant` y `core.scope` ya
-- tenian las suyas; `core.group_profile` la estrena aqui.
create policy group_profile_client_select on core.group_profile
  for select to authenticated
  using (sec.is_member(scope_id));

-- El ambito NO necesita policy nueva: `scope_client_select` de la migracion de
-- ambitos ya alcanza cualquier ambito con membresia, grupos incluidos. Anadir
-- una segunda diria lo mismo en otro sitio.
