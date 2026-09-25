-- ============================================================================
-- LA TRANSFERENCIA DE GRUPO: UNA VOLUNTAD, INMEDIATA, DEL LIBRO DEL GRUPO
-- (F12/ADR-007, F12.C3)
-- ============================================================================
--
-- B3 (`20260928120000`) construyo una transferencia de grupo de DOS
-- voluntades: una propuesta que el receptor acepta y que se materializa como
-- `settlement_by_transfer`, con caja en los dos Personales. Al validarla a
-- mano aparecio que ese contrato **no es el producto**: un participante SIN
-- CUENTA no puede aparecer siquiera en la lista, porque no hay nadie que
-- acepte y no hay Personal al que abonar. Y un grupo con un fantasma es el
-- caso normal, no el raro.
--
-- El contrato final, decidido el 2026-09-24:
--
--   * UNA VOLUNTAD. El actor declara «he transferido X a estas personas del
--     grupo» y el efecto ocurre al confirmar el servidor. Sin propuesta, sin
--     aceptacion, sin rechazo, sin caducidad.
--   * ES UNA OPERACION DEL GRUPO, no una transferencia Personal→Personal
--     materializada por consentimiento. El receptor autoritativo es el
--     PARTICIPANTE, no una cuenta Nomey.
--   * POR ESO EL FANTASMA FUNCIONA. Ni cuenta, ni username, ni Personal, ni
--     amistad, ni vinculo: las mismas reglas que cualquier alta del grupo.
--   * LA CAJA ES SOLO LA DEL EMISOR. Declarar la salida del dinero propio es
--     una voluntad sobre lo propio; abonar el Personal del receptor seria
--     escribir en la cuenta de otro sin que lo haya consentido — y un
--     fantasma ni siquiera tiene Personal.
--   * MULTI-DESTINATARIO ATOMICO. Una intencion, una operacion, N efectos.
--     Si un receptor falla, no se escribe ninguno.
--   * NO SE CORRIGE, SI SE ANULA. La irreversibilidad de B3 venia de las dos
--     voluntades; esta declaracion es unilateral y se deshace como un pago
--     declarado (F09/ADR-007).
--
-- Lo que crea:
--
--   core.group_transfer_allocation   lo que la transferencia dio a cada
--                                    participante, con su version
--   sec.persist_version              RECREADA: `group_transfer` no admite una
--                                    segunda version `record`; si anulacion
--   api.record_group_transfer        la entrada autoritativa
--   api.group_transfer_operation     una fila por operacion vigente
--   api.group_transfer_allocation    N filas: el reparto de cada una
--
-- ─── POR QUE UNA CLASE NUEVA Y NO `settlement_by_transfer` ──────────────────
--
-- Porque la irreversibilidad esta escrita SOBRE LA CLASE, no sobre el origen:
-- `sec.persist_version` y `api.annul_operation` rehusan toda version nueva de
-- `internal_transfer` y `settlement_by_transfer` con el argumento explicito de
-- que «las dos partes consintieron ESE hecho». Reutilizar esa clase para una
-- declaracion unilateral obligaria a relajar esa guarda, degradandola para las
-- transferencias Personal, que si la necesitan. Y `core.transfer_part` es 1:1
-- con la version: no admite N receptores.
--
-- `group_payment` tampoco: esa clase significa «pago declarado ACOTADO POR LA
-- DEUDA», con su descomposicion en caminos, sus novaciones y su tope. Una
-- transferencia de grupo no tiene tope y puede cruzar cero.
--
-- `operation_class` es vocabulario ABIERTO a proposito (`check (<> '')`), asi
-- que `group_transfer` no toca el esquema del ledger.
--
-- ─── LO QUE NO SE TOCA ──────────────────────────────────────────────────────
--
--   * TODO B3 SIGUE EN PIE Y DORMIDO: `core.group_transfer_proposal`,
--     `core.transfer_part`, `create_/cancel_/decline_group_transfer_proposal`,
--     `api.record_settlement_by_transfer`, `api.group_transfer_proposals`,
--     `api.group_transfers` y sus nueve carreras. Backend sin superficie
--     cliente, igual que las solicitudes de pago de B2. Sus checks siguen
--     verdes: este contrato no cambia ni uno.
--   * Las transferencias Personal de F12.C1 (dos voluntades, entre cuentas,
--     `api.my_transfers`): intactas.
--   * «Saldado» (`api.record_group_payment`): intacto, con su tope por deuda
--     y su anulacion.
--   * `api.group_operation`: la transferencia NO entra ahi. El historico del
--     grupo ya es la mezcla en cliente de varias lecturas, y meterla dentro
--     exigiria relajar su `join core.split` —una transferencia no reparte un
--     gasto— y añadir columnas nulas para todo gasto.
--   * La regla de «Ingresos» (F12.E.E, `20261002120000`): cuenta SOLO
--     `internal_transfer` recibida. Un `group_transfer` no es ingreso de
--     nadie, y el debito del emisor es CAJA, no consumo: no toca «Gastos».
--
-- ─── LO QUE SE CONSERVA DE LA VERSION ANTERIOR DE ESTE FICHERO ──────────────
--
-- `sec.group_transfer_currencies_match` y la recreacion de
-- `api.create_group_transfer_proposal` con la guarda temprana de moneda. Son
-- una mejora de B3 —una propuesta que nadie podria aceptar ya no se crea— y
-- `group-transfer-proposals.sql` E4 las mide. B3 duerme, pero duerme correcta.
-- ============================================================================

-- ═══════════════════ §1 · la compatibilidad de monedas ══════════════════════
-- UNA definición, la que aceptar ya imponía: la base del grupo, la del
-- Personal del emisor y la del Personal del receptor son la MISMA.
--
-- Booleano, no excepción: el preflight necesita contestar un estado y el
-- comando necesita lanzar. Cada uno decide qué hacer con el mismo hecho.
--
-- Definer del WRITER porque lee `core.scope` de dos Personales ajenos, que es
-- lo que `sec.participant_personal_scope` ya resuelve dentro del comando de
-- B3; `authenticated` no lo alcanza —ni grant ni USAGE sobre `sec`—.
create function sec.group_transfer_currencies_match(
  p_group    uuid,
  p_sender   uuid,
  p_receiver uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select g.base_currency_definition_id
       from core.scope g where g.id = p_group)
    = (select ps.base_currency_definition_id
         from core.scope ps where ps.id = sec.participant_personal_scope(p_sender))
    and (select g.base_currency_definition_id
           from core.scope g where g.id = p_group)
      = (select pr.base_currency_definition_id
           from core.scope pr where pr.id = sec.participant_personal_scope(p_receiver)),
    false);
$fn$;
comment on function sec.group_transfer_currencies_match(uuid, uuid, uuid) is
  'F12/ADR-003 §22 (F12.C3): la base del grupo y las de los dos Personales son la misma. La UNICA definicion de esa compatibilidad: la usan el preflight y la guarda temprana de create, y aceptar la impone otra vez con sus tres assert_no_conversion. NULL en cualquier extremo es false: sin Modo Personal no hay moneda que comparar.';
grant create on schema sec to nomey_writer;
alter function sec.group_transfer_currencies_match(uuid, uuid, uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.group_transfer_currencies_match(uuid, uuid, uuid) from public;
grant execute on function sec.group_transfer_currencies_match(uuid, uuid, uuid) to nomey_writer;

-- ═══════════════════ §2 · B3 dormido: crear, con la guarda temprana ═════════════════════
-- MISMO CONTRATO PUBLICO que `20260928120000`: misma firma, mismo payload,
-- mismos estados, mismos codigos, mismo orden observable. Lo unico que se
-- añade son cuatro lineas —la comprobacion de moneda— justo despues de
-- resolver los dos Personales y antes de contar el presupuesto, de modo que
-- una propuesta imposible no consume cuota ni deja fila.
--
-- Va DENTRO del cerrojo de rango 1, con los participantes ya validados: el
-- preflight de §2 no sirve de autoridad y esto es lo que de verdad impide
-- crear una propuesta que nadie podra aceptar.
create or replace function api.create_group_transfer_proposal(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'group_scope_id', 'receiver_participant_id', 'amount', 'concept'];
  v_actor    uuid;
  v_guest    boolean;
  v_command  uuid;
  v_contract integer;
  v_group    uuid;
  v_receiver uuid;
  v_amount   bigint;
  v_concept  text;
  v_sender   uuid;
  v_target   uuid;
  v_currency uuid;
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
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
  v_group    := sec.payload_uuid(payload, 'group_scope_id', true);
  v_receiver := sec.payload_uuid(payload, 'receiver_participant_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_concept  := sec.payload_text(payload, 'concept', false);
  if v_concept is not null then
    v_concept := sec.canonical_concept(v_concept);
  end if;
  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'el importe de una transferencia debe ser positivo', 400);
  end if;

  -- EL EMISOR (§5): cuenta normal con handle definitivo.
  if v_guest then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no propone transferencias', 403);
  end if;
  if (select i.handle from sec.public_identity(v_actor) i) is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'proponer una transferencia exige tener username definitivo', 409);
  end if;

  -- CLAVE DE IDEMPOTENCIA (F09/ADR-002), antes del cerrojo (protocolo de
  -- 20260912150000, comprobado por group-identity-lock.sql).
  v_intent := jsonb_build_object('group_scope_id', v_group::text, 'receiver_participant_id', v_receiver::text,
                                 'amount', payload ->> 'amount', 'concept', v_concept);
  begin
    insert into core.provisioning_command (created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group_transfer_proposal.create', v_contract, v_intent, v_group);
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
    select g.id, g.expires_at into v_id, v_until from core.group_transfer_proposal g
     where g.created_by = v_actor and g.client_command_id = v_command;
    return jsonb_build_object('proposal_id', v_id, 'expires_at', v_until, 'already_processed', true);
  end if;

  -- RANGO 1: antes de leer membresia, vinculo, presencia o salida.
  perform sec.lock_participant_claims(v_group);
  perform sec.assert_scope_kind(v_group, 'group');
  perform sec.assert_member(v_group, v_actor);

  -- El emisor es la identidad ACTIVA del actor en este grupo (F10/ADR-003).
  select l.participant_id into v_sender
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = v_group and l.ended_at is null
   limit 1;
  if v_sender is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no tienes identidad activa en este grupo', 403);
  end if;
  perform sec.assert_participant_active(v_sender, v_group);

  -- El receptor: del grupo, elegible hoy, activo, vinculado a una cuenta
  -- normal con handle definitivo y con Modo Personal; no uno mismo.
  if not exists (select 1 from core.participant p where p.id = v_receiver and p.scope_id = v_group) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'la propuesta nombra un participante que no pertenece a su grupo', 422);
  end if;
  perform sec.assert_participant_active(v_receiver, v_group);
  perform sec.assert_participant_eligible(v_receiver, v_group, current_date);
  if v_receiver = v_sender then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes proponerte una transferencia a ti mismo', 400);
  end if;
  select l.user_id into v_target from core.participant_user_link l
   where l.participant_id = v_receiver and l.ended_at is null;
  if v_target is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'ese participante no tiene una cuenta vinculada', 403);
  end if;
  if v_target = v_actor then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes proponerte una transferencia a ti mismo', 400);
  end if;
  if (select i.handle from sec.public_identity(v_target) i) is null then
    perform sec.raise_boundary('USERNAME_REQUIRED', 'el receptor todavia no tiene username definitivo', 409);
  end if;
  if sec.participant_personal_scope(v_receiver) is null then
    perform sec.raise_boundary('RECIPIENT_WITHOUT_PERSONAL_SCOPE', 'el receptor no tiene Modo Personal al que recibir', 422);
  end if;
  if sec.participant_personal_scope(v_sender) is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'el emisor no tiene Modo Personal', 403);
  end if;

  -- La moneda es la base del grupo (§22), derivada: el payload no la lleva.
  select s.base_currency_definition_id into v_currency from core.scope s where s.id = v_group;

  -- ═══ LA GUARDA TEMPRANA DE MONEDA (F12.C3) ═══
  --
  -- Aceptar exige que la base del grupo y las de los DOS Personales sean la
  -- misma, y hasta ahora eso solo se descubria AL ACEPTAR: se podia crear una
  -- propuesta que nadie podria materializar, y el 422 le llegaba al receptor
  -- por algo que el emisor no habia podido ver. Aqui, dentro del cerrojo y
  -- con los dos Personales ya resueltos, no se crea.
  --
  -- El mismo codigo que devuelve aceptar: no es un error nuevo, es el mismo
  -- hecho visto antes.
  if not sec.group_transfer_currencies_match(v_group, v_sender, v_receiver) then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la moneda del grupo y las de los Modos Personales implicados no coinciden, y la conversion todavia no esta disponible', 422);
  end if;

  -- ANTI-SPAM (§20), bajo el cerrojo del emisor: pareja por grupo y presupuesto compartido, exactos.
  perform sec.lock_proposal_budget(v_actor);
  select count(*) into v_n
    from core.group_transfer_proposal g
    cross join lateral sec.derive_group_transfer_proposal_state(
      g.group_scope_id, g.sender_participant_id, g.receiver_participant_id, g.created_at, g.expires_at,
      g.accepted_operation_id, g.declined_at, g.cancelled_at) st
   where g.created_by = v_actor and g.target_user_id = v_target and g.group_scope_id = v_group
     and st.state = 'pending';
  if v_n >= 3 then
    perform sec.raise_boundary('PROPOSAL_LIMIT_PER_TARGET',
      'ya tienes tres propuestas pendientes con ese participante en este grupo', 409);
  end if;
  perform sec.assert_proposal_budget(v_actor);

  insert into core.group_transfer_proposal
    (created_by, target_user_id, group_scope_id, sender_participant_id, receiver_participant_id,
     amount, currency_definition_id, concept, client_command_id)
  values (v_actor, v_target, v_group, v_sender, v_receiver, v_amount, v_currency, v_concept, v_command)
  returning id, expires_at into v_id, v_until;

  return jsonb_build_object('proposal_id', v_id, 'expires_at', v_until, 'already_processed', false);
end
$fn$;
comment on function api.create_group_transfer_proposal(jsonb) is
  'F12/ADR-003 §3-§5, §20, §22: proponer una transferencia a un participante del grupo. Receptor por participante, nunca por @handle; moneda = base del grupo; ni operacion ni deuda ni saldo. Desde F12.C3 rehusa CURRENCY_CONVERSION_UNSUPPORTED (422) si la base del grupo y las de los dos Personales no coinciden, en vez de dejar que lo descubra quien acepta. Idempotente por client_command_id.';

-- ═══════════════════ §3 · lo que la transferencia dio a cada uno ════════════
--
-- La forma es la de `core.payment_allocation` (`20260912170000`), y no por
-- parecido: es el mismo tipo de hecho —lo que UNA operacion asigno a varios
-- pares, con su version— y comparte sus garantias. PK `(version, ordinal)`,
-- `amount > 0`, partes distintas, y FK COMPUESTAS `(participante, scope)`
-- contra `core.participant (id, scope_id)`, que es lo que hace estructural
-- que emisor y receptor sean del mismo grupo (F03/ADR-009 §1).
--
-- NO es `core.transfer_part`: aquella es 1:1 con la version, nombra dos
-- AMBITOS Personales y significa «esta transferencia salio de aqui y entro
-- alli». Aqui no entra en ningun Personal.
--
-- El `ordinal` no es decoracion: fija el orden del reparto, y con el la
-- persona a la que le toca la unidad menor que sobra. Se escribe en el orden
-- canonico (§5) para que un replay reproduzca el mismo reparto.
create table core.group_transfer_allocation (
  operation_version_id    uuid not null references core.operation_version (id),
  ordinal                 smallint not null,
  scope_id                uuid not null references core.scope (id),
  sender_participant_id   uuid not null,
  receiver_participant_id uuid not null,
  amount                  bigint not null check (amount > 0),
  primary key (operation_version_id, ordinal),
  constraint group_transfer_allocation_partes_distintas
    check (sender_participant_id <> receiver_participant_id),
  constraint group_transfer_allocation_emisor_del_ambito
    foreign key (sender_participant_id, scope_id) references core.participant (id, scope_id),
  constraint group_transfer_allocation_receptor_del_ambito
    foreign key (receiver_participant_id, scope_id) references core.participant (id, scope_id),
  -- Un receptor no se repite dentro de la misma transferencia: dos filas para
  -- la misma persona serian dos intenciones metidas en una.
  constraint group_transfer_allocation_receptor_unico
    unique (operation_version_id, receiver_participant_id)
);
comment on table core.group_transfer_allocation is
  'F12/ADR-007: lo que una transferencia de grupo asigno a cada participante, con su version. Se conserva al anular: es lo que esa transferencia declaro, no los saldos de ahora.';
alter table core.group_transfer_allocation enable row level security;
grant select, insert on core.group_transfer_allocation to nomey_writer;
create policy group_transfer_allocation_writer_insert on core.group_transfer_allocation
  for insert to nomey_writer with check (true);
create policy group_transfer_allocation_writer_select on core.group_transfer_allocation
  for select to nomey_writer using (true);
grant select on core.group_transfer_allocation to authenticated;
create policy group_transfer_allocation_client_select on core.group_transfer_allocation
  for select to authenticated using (sec.is_member(scope_id));


-- ═══════════════════ §4 · la clase, en la guarda de versiones ═══════════════
--
-- `group_transfer` NO se corrige y SI se anula, que es justo lo contrario de
-- las dos clases que ya estaban aqui. El motivo es el que esas mismas lineas
-- dicen: lo que las hace irreversibles es que DOS partes consintieron el
-- hecho. Una declaracion unilateral no tiene esa propiedad, y se deshace como
-- un pago declarado — anular escribe una version SIN efectos, y
-- `current_version_id` sigue siendo la unica autoridad sobre que cuenta
-- (F06/ADR-006).
--
-- Que no se corrija es la disciplina de `group_payment` (`PAYMENT_NOT_EDITABLE`):
-- reescribir un reparto ya aplicado significaria mover deuda de terceros sin
-- decirlo. Se anula y se registra otra.
--
-- Cuerpo integro de la version vigente (`20260928120000`) mas una rama.
create or replace function sec.persist_version(
  p_actor uuid, p_operation uuid, p_version uuid, p_version_no integer,
  p_supersedes uuid, p_operation_class text, p_effective_date date,
  p_original_amount bigint, p_currency uuid,
  p_effective_time time without time zone default null,
  p_version_kind text default 'record')
returns void
language plpgsql
set search_path = ''
as $fn$
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
    -- Una transferencia de dos voluntades (F12/ADR-002 §16, F12/ADR-003 §25)
    -- tiene exactamente una version: las dos partes consintieron ESE hecho, y
    -- reescribirlo o deshacerlo seria que una alterase el Personal de la otra
    -- sin su voluntad. La devolucion es otra transferencia.
    if v_clase in ('internal_transfer', 'settlement_by_transfer') then
      if p_version_kind = 'annulment' then
        perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',
          'una transferencia de dos voluntades no se anula: la devolucion es otra transferencia', 422);
      end if;
      perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
        'una transferencia de dos voluntades no se corrige: la devolucion es otra transferencia', 422);
    end if;
    -- F12/ADR-007: la transferencia de grupo es UNA voluntad. Se anula —una
    -- version de anulacion pasa— pero no se reescribe.
    if v_clase = 'group_transfer' and p_version_kind is distinct from 'annulment' then
      perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
        'una transferencia de grupo no se corrige: se anula y se registra otra', 422);
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
$fn$;


-- ═══════════════════ §5 · el writer ═════════════════════════════════════════
--
-- UNA intencion, UNA operacion, UNA transaccion. El cliente manda el TOTAL y
-- la lista de receptores; **el reparto lo hace el servidor**, con
-- `sec.allocate_by_largest_remainder` (`20260826205500`), que es la regla
-- canonica de F01/ADR-001 §5 —la misma que reparte las cuotas de un gasto y
-- la que los 22 vectores compartidos comprueban—. No hay una segunda
-- implementacion del reparto: el cliente calcula el suyo solo para la vista
-- previa, con el mismo algoritmo y el mismo orden.
--
-- ─── EL ORDEN CANONICO ──────────────────────────────────────────────────────
--
-- `(participant.created_at, participant.id)`: el orden en que las personas
-- entraron al grupo. Es estable, vive en el servidor y es el que
-- `api.group_transfer_candidates` publica, de modo que la persona a la que le
-- toca el centimo que sobra es LA MISMA en la vista previa y en la escritura.
-- El orden del JSON NO se usa: dependeria de en que orden se fueron tocando
-- los ticks, y eso no es una decision que nadie haya tomado.
--
-- ─── LA CAJA ────────────────────────────────────────────────────────────────
--
-- UN solo efecto de balance, `-total`, en el Personal del EMISOR si existe —el
-- mismo patron con el que `record_group_expense` carga la caja del pagador y
-- `record_group_payment` la del que paga, y la misma tolerancia al
-- participante sin Personal de `20260913130000`—. NINGUN efecto en el
-- Personal de ningun receptor: eso es lo que distingue esta clase de
-- `settlement_by_transfer`.
--
-- ─── EL ALGEBRA ─────────────────────────────────────────────────────────────
--
-- `D_after = D - N` por par, con el importe COMPLETO y sin tope: puede cruzar
-- cero y dejar al acreedor debiendo. `SETTLEMENT_EXCEEDS_DEBT` no aplica a
-- esta clase al escribir (si al anular: ver §6).
create function api.record_group_transfer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'group_scope_id','total_amount','concept','receiver_participant_ids'];
  v_group uuid; v_total bigint; v_concept text;
  v_raw uuid[]; v_receivers uuid[]; v_n integer;
  v_currency uuid; v_canonical jsonb; v_ids_text text;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_sender uuid; v_from uuid; v_obs uuid[]; v_before bigint[];
  v_shares bigint[]; v_date date; v_time time; i integer;
begin
  -- Una transferencia de grupo NO se corrige. Error de FORMA, antes que nada:
  -- que el payload traiga una version que sustituir no es un permiso que
  -- falte, es un comando que no existe.
  if (payload ? 'operation_id') or (payload ? 'expected_version_id') then
    perform sec.raise_boundary('TRANSFER_NOT_EDITABLE',
      'una transferencia de grupo no se corrige: se anula y se registra otra', 422);
  end if;
  perform sec.assert_payload_shape(payload, c_allowed);

  v_group   := sec.payload_uuid(payload, 'group_scope_id', true);
  -- LA FECHA Y LA HORA SON LAS DEL APARATO DE QUIEN REGISTRA, como en un
  -- gasto compartido y como en un pago declarado. NO el reloj del servidor:
  -- corre en UTC, y tomarlo de ahi colocaba una transferencia hecha a las
  -- 21:30 en Madrid como si fueran las 19:30 — por debajo, en Movimientos,
  -- de lo que se habia registrado antes esa misma tarde. La hora es opcional
  -- (F06/ADR-002 §3: sin hora no es medianoche, es «no se sabe»).
  v_date    := sec.payload_date(payload, 'effective_date');
  v_time    := sec.payload_time(payload, 'effective_time', false);
  v_total   := sec.payload_amount(payload, 'total_amount');
  v_concept := sec.payload_text(payload, 'concept', false);
  if v_concept is not null then
    v_concept := sec.canonical_concept(v_concept);
  end if;

  if jsonb_typeof(payload -> 'receiver_participant_ids') is distinct from 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'receiver_participant_ids debe ser una lista de identificadores', 400);
  end if;
  if exists (select 1 from jsonb_array_elements(payload -> 'receiver_participant_ids') e
              where jsonb_typeof(e) is distinct from 'string'
                 or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'cada destinatario es un identificador de participante', 400);
  end if;
  select array_agg(x::uuid order by ord) into v_raw
    from jsonb_array_elements_text(payload -> 'receiver_participant_ids') with ordinality as u(x, ord);
  if v_raw is null or cardinality(v_raw) = 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'una transferencia necesita al menos un destinatario', 400);
  end if;
  -- Duplicados: dos veces la misma persona es la misma intencion escrita dos
  -- veces, y el reparto dejaria de significar lo que dice.
  if cardinality(v_raw) <> cardinality(sec.normalize_scopes(v_raw)) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un destinatario no puede repetirse en la misma transferencia', 400);
  end if;
  v_n := cardinality(v_raw);

  if v_total <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      'el importe de la transferencia debe ser positivo', 422);
  end if;
  -- Repartir 2 centimos entre tres dejaria a alguien con cero, y una
  -- transferencia de cero no es una transferencia: la fila no significaria
  -- nada y `amount > 0` la rehusaria a mitad de escritura.
  if v_total < v_n then
    perform sec.raise_boundary('TRANSFER_AMOUNT_TOO_SMALL',
      'el importe no alcanza para dar al menos una unidad menor a cada destinatario', 422,
      jsonb_build_object('receivers', v_n));
  end if;

  -- La intencion canonica: el grupo, el total, el concepto y los receptores
  -- en ORDEN ESTABLE. Dos envios con los mismos receptores en distinto orden
  -- son el mismo comando, que es lo que hace que la clave de idempotencia
  -- signifique algo.
  select string_agg(x::text, ' ' order by x) into v_ids_text from unnest(v_raw) as x;
  v_canonical := jsonb_build_object(
    'group_scope_id', v_group::text,
    'total_amount',   payload ->> 'total_amount',
    'effective_date', v_date::text,
    'effective_time', v_time::text,
    'concept',        v_concept,
    'receivers',      v_ids_text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- RANGO 1: el cerrojo de identidad del grupo, antes de leer membresia,
  -- vinculo o presencia (`20260912150000`).
  perform sec.lock_participant_claims(v_group);
  perform sec.assert_scope_kind(v_group, 'group');
  perform sec.assert_member(v_group, v_actor);

  -- La moneda es la BASE DEL GRUPO, derivada: el payload no la lleva y no hay
  -- nada que elegir.
  select s.base_currency_definition_id into v_currency
    from core.scope s where s.id = v_group;
  perform sec.assert_no_conversion(v_group, v_currency);

  -- El emisor es la identidad ACTIVA del actor en este grupo (F10/ADR-003).
  select l.participant_id into v_sender
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = v_group and l.ended_at is null
   limit 1;
  if v_sender is null then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'no tienes identidad activa en este grupo', 403);
  end if;

  -- El emisor, con las reglas de cualquier alta del grupo.
  perform sec.assert_participant_eligible(v_sender, v_group, v_date);
  perform sec.assert_participant_not_retired(v_sender, v_group);
  perform sec.assert_participant_active(v_sender, v_group);

  -- ORDEN CANONICO: por entrada al grupo. Ni el del JSON ni el de los toques.
  select array_agg(p.id order by p.created_at, p.id) into v_receivers
    from core.participant p
   where p.id = any (v_raw) and p.scope_id = v_group;
  -- Si alguno no es del grupo, la lista ordenada es mas corta: se dice cual.
  if v_receivers is null or cardinality(v_receivers) <> v_n then
    perform sec.assert_participant_eligible(
      (select x from unnest(v_raw) as x
        where not exists (select 1 from core.participant p where p.id = x and p.scope_id = v_group)
        limit 1), v_group, v_date);
  end if;

  foreach v_from in array v_receivers loop
    if v_from = v_sender then
      perform sec.raise_boundary('DEBT_SELF_REFERENCE',
        'no puedes transferirte a ti mismo', 422);
    end if;
    -- Las MISMAS reglas que nombrar a alguien en un gasto nuevo: del ambito,
    -- elegible hoy, no retirado, no origen de una fusion — mas activo, que es
    -- lo que `record_group_payment` exige. NINGUNA mira cuenta, username,
    -- Personal ni amistad: por eso un fantasma recibe.
    perform sec.assert_participant_eligible(v_from, v_group, v_date);
    perform sec.assert_participant_not_retired(v_from, v_group);
    perform sec.assert_participant_active(v_from, v_group);
  end loop;
  v_from := null;

  -- La caja del emisor, si tiene Personal. El de los receptores NO se toca ni
  -- se consulta: un fantasma no lo tiene y un vinculado no lo ha consentido.
  v_from := sec.participant_personal_scope(v_sender);
  if v_from is not null then
    perform sec.assert_no_conversion(v_from, v_currency);
  end if;

  -- RANGO 2: el grupo y el Personal del emisor, en orden ascendente.
  v_obs := case when v_from is not null then array[v_from] else '{}'::uuid[] end;
  perform sec.lock_scopes(array[v_group] || v_obs);
  v_before := sec.balances_before(v_obs);

  -- EL REPARTO, autoritativo. Pesos a uno y desempate por el orden canonico:
  -- con pesos iguales todos los restos empatan, asi que la unidad menor que
  -- sobra la decide la prioridad — la primera persona que entro al grupo.
  v_shares := sec.allocate_by_largest_remainder(
    v_total,
    array(select 1::bigint from generate_series(1, v_n)),
    array(select (g - 1)::integer from generate_series(1, v_n) g));

  perform sec.persist_version(v_actor, v_operation, v_version, 1, null,
                              'group_transfer', v_date, v_total, v_currency, v_time);
  if v_concept is not null then
    perform sec.persist_movement_detail(v_version, v_concept);
  end if;

  -- LA CAJA: un solo efecto, por el TOTAL. No N.
  if v_from is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
    values (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_total);
  end if;

  -- LA DEUDA: un efecto por receptor, con el importe COMPLETO de su cuota y
  -- sin tope. `debt_amount` negativo reduce lo que el emisor debe al receptor,
  -- y cruza cero si la cuota supera la deuda (F12/ADR-003 §9).
  for i in 1 .. v_n loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
    values (gen_random_uuid(), v_version, v_group, 'settlement', v_currency,
            - v_shares[i], v_sender, v_receivers[i]);
    insert into core.group_transfer_allocation
      (operation_version_id, ordinal, scope_id, sender_participant_id, receiver_participant_id, amount)
    values (v_version, i::smallint, v_group, v_sender, v_receivers[i], v_shares[i]);
  end loop;

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$fn$;
comment on function api.record_group_transfer(jsonb) is
  'F12/ADR-007: registrar una transferencia de grupo de UNA voluntad. Receptores por participante (fantasma incluido: ni cuenta, ni username, ni Personal, ni amistad), reparto autoritativo por mayor resto sobre el orden de entrada al grupo, caja SOLO en el Personal del emisor, N efectos de settlement sin tope. Fecha y hora efectivas del aparato de quien registra, como el gasto y el pago. Una operacion atomica; no se corrige, si se anula. Idempotente por client_operation_id.';

grant create on schema api to nomey_writer;
alter function api.record_group_transfer(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.record_group_transfer(jsonb) from public;
grant execute on function api.record_group_transfer(jsonb) to authenticated;


-- ═══════════════════ §6 · el historico: una intencion, una fila ═════════════
--
-- UNA fila por operacion, con su reparto aparte. Partirla en N filas
-- contradiria el modelo —una intencion— y ademas romperia la anulacion: no se
-- anula un tercio de una operacion.
--
-- Ambas vistas cuelgan de `operation.current_version_id`, asi que una
-- transferencia anulada desaparece del historico sin ninguna clausula que lo
-- diga: su version vigente es la anulacion, que no tiene ni efectos ni
-- reparto. Es el mismo comportamiento que un gasto anulado.
--
-- `version_id` se publica porque anular lo necesita (`api.annul_operation`
-- toma `operation_id` + `expected_version_id`), igual que `api.group_operation`
-- y `api.group_payment`.
--
-- NI uid, NI correo, NI @handle: solo participantes y sus nombres visibles.
create view api.group_transfer_operation
with (security_invoker = true) as
select o.id                                        as operation_id,
       ov.id                                       as version_id,
       a.scope_id                                  as group_scope_id,
       a.sender_participant_id,
       ps.display_name                             as sender_display_name,
       sec.is_my_participant(a.sender_participant_id) as is_sender,
       ov.original_amount::text                    as total_amount,
       ov.original_currency_definition_id          as currency_definition_id,
       ov.effective_date,
       ov.effective_time,
       md.concept,
       a.receiver_count,
       o.created_at                                as operation_created_at
  from core.operation o
  join core.operation_version ov on ov.id = o.current_version_id
  join lateral (
        select x.scope_id, x.sender_participant_id, count(*)::integer as receiver_count
          from core.group_transfer_allocation x
         where x.operation_version_id = ov.id
         group by x.scope_id, x.sender_participant_id
       ) a on true
  join core.participant ps on ps.id = a.sender_participant_id
  left join core.movement_detail md on md.operation_version_id = ov.id
 where o.operation_class = 'group_transfer';
comment on view api.group_transfer_operation is
  'F12/ADR-007: las transferencias de grupo vigentes, UNA fila por operacion. Una anulada no aparece: su version vigente no tiene reparto. Publica participantes y nombres, nunca cuentas.';
grant select on api.group_transfer_operation to authenticated;

create view api.group_transfer_allocation
with (security_invoker = true) as
select ov.operation_id,
       a.operation_version_id                      as version_id,
       a.scope_id                                  as group_scope_id,
       a.ordinal,
       a.receiver_participant_id,
       pr.display_name                             as receiver_display_name,
       sec.is_my_participant(a.receiver_participant_id) as is_receiver,
       a.amount::text                              as amount
  from core.group_transfer_allocation a
  join core.operation_version ov on ov.id = a.operation_version_id
  join core.operation o on o.id = ov.operation_id and o.current_version_id = ov.id
  join core.participant pr on pr.id = a.receiver_participant_id;
comment on view api.group_transfer_allocation is
  'F12/ADR-007: el reparto de cada transferencia de grupo vigente, una fila por receptor. Importes en texto (F02/ADR-001).';
grant select on api.group_transfer_allocation to authenticated;
