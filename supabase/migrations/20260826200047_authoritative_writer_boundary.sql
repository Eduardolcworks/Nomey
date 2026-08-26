-- Frontera autoritativa de escritura · 7a.
--
-- Septima migracion real, y primera mitad del writer. Trae la INFRAESTRUCTURA
-- COMUN del protocolo autoritativo y las CUATRO clases de operacion que NO
-- producen dimension de deuda:
--
--   api.record_adjustment          adjustment
--   api.record_personal_expense    personal_expense
--   api.record_external_transfer   external_transfer
--   api.record_internal_transfer   internal_transfer
--
-- La costura con 7b no es de tamano: es la de ADR-013 §11, que decide quien
-- participa en el protocolo de serializacion de la deuda «por que efectos
-- produce, no por el nombre de la clase». Ninguna de estas cuatro toca deuda,
-- asi que 7a NO necesita el lock sobre `core.scope` ni el ensanchamiento de
-- privilegio que ese lock exige. Eso queda aislado en 7b, para que se revise
-- solo.
--
-- Fuentes:
--   ADR-002 §7  · el cliente no escribe efectos; el servidor los deriva
--   ADR-003 §1  · importes en unidad minima como entero exacto
--   ADR-008 §1, §3 · valores exactos como texto, y el tipo JSON original observable
--   ADR-009     · forma, seguridad y atomicidad de la frontera
--   ADR-010     · idempotencia del origen cliente
--   ADR-011 §5, §7, §8, §12, §13 · comando, canonicalizacion, CAS y orden
--   ADR-013 §2, §3 · clase de operacion y validacion del signo por clase
--   ADR-016     · propiedad durable del Modo Personal

-- ================================ 0 · privilegios sin ruta autoritativa ====
-- Se concedieron anticipando al writer, y 7a demuestra que ninguna funcion los
-- ejerce. El principio «cada privilegio corresponde a una ruta concreta» solo
-- vale si se aplica tambien hacia atras.
--
--   frozen_conversion · no habra ruta mientras el FX cross-currency siga sin
--                       decidirse (ADR-009 §8). Vuelve cuando exista.
--   split · split_participant · vuelven en 7b con `record_group_expense`.
--
-- Las policies de INSERT ya disenadas NO se borran: son decisiones razonadas de
-- ADR-013 §10 y volveran a hacer falta intactas. Lo que se retira es el grant.

revoke insert on core.frozen_conversion from nomey_writer;
revoke insert on core.split             from nomey_writer;
revoke insert on core.split_participant from nomey_writer;

-- ============================== 1 · errores de frontera ====================
-- ADR-009 §9 mantiene DOS contratos separados y NO define una taxonomia: los
-- errores de dominio conservan sus codigos de `src/domain/errors.ts`, y la
-- frontera usa los suyos. Aqui se fijan los CINCO minimos de este writer, y
-- ninguno se anade a `errors.ts`.
--
-- La forma es la que midio E15, y es la unica que NO obliga a leer el mensaje
-- humano para obtener el codigo: `message` lleva el cuerpo JSON con el codigo
-- propio, y `detail` fija el estado HTTP.
--
-- «No autenticado» NO recibe codigo nuevo: `sec.request_actor_id()` ya falla
-- cerrado con `42501`, los checks del nucleo lo comprueban, y E15 midio que
-- sale como 401 sin sesion y 403 con JWT. Envolverlo cambiaria un
-- comportamiento ya probado sin ganar nada.

create function sec.raise_boundary(p_code text, p_message text, p_status integer)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  raise sqlstate 'PGRST' using
    message = json_build_object('code', p_code, 'message', p_message)::text,
    detail  = format('{"status":%s,"headers":{}}', p_status);
end
$fn$;

comment on function sec.raise_boundary(text, text, integer) is
  'Error de frontera en la forma medida en E15: el codigo propio viaja en el cuerpo, no en el mensaje humano (ADR-009 §9).';

revoke execute on function sec.raise_boundary(text, text, integer) from public;

-- ============================== 2 · lectura estricta del payload ===========
-- ADR-009 §2: la intencion llega como un unico `jsonb`, y no como parametros
-- tipados, porque E14 midio que PostgREST COACCIONA UN NUMERO JSON A UN
-- PARAMETRO `text`. Con `jsonb` el tipo JSON original es observable, que es lo
-- que ADR-008 §3 exige poder comprobar.

create function sec.assert_payload_shape(p_payload jsonb, p_allowed text[])
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'el payload debe ser un objeto JSON', 400);
  end if;

  -- El actor sale SIEMPRE de la peticion. Enviarlo no se ignora: invalida.
  -- Ignorarlo dejaria creer al cliente que fue tenido en cuenta.
  if p_payload ? 'created_by' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'created_by no se acepta: el actor procede de la peticion autenticada', 400);
  end if;

  for v_key in select jsonb_object_keys(p_payload) loop
    if not (v_key = any(p_allowed)) then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        format('campo desconocido en el payload: %s', v_key), 400);
    end if;
  end loop;
end
$fn$;

revoke execute on function sec.assert_payload_shape(jsonb, text[]) from public;

-- Un importe exacto llega como STRING JSON y se rechaza si llega como number.
-- Es la comprobacion que ADR-008 §3 pide y que un parametro `text` no permite.
create function sec.payload_amount(p_payload jsonb, p_key text)
returns bigint
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw jsonb := p_payload -> p_key;
  v_out bigint;
begin
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('falta el campo %s', p_key), 400);
  end if;
  if jsonb_typeof(v_raw) <> 'string' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('%s debe llegar como string JSON y no como number: un entero grande se degrada al parsearse (ADR-008 §1)', p_key), 400);
  end if;
  begin
    v_out := (p_payload ->> p_key)::bigint;
  exception when others then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('%s no es un entero en unidad minima', p_key), 400);
  end;
  return v_out;
end
$fn$;

revoke execute on function sec.payload_amount(jsonb, text) from public;

create function sec.payload_uuid(p_payload jsonb, p_key text, p_required boolean)
returns uuid
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw jsonb := p_payload -> p_key;
  v_out uuid;
begin
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    if p_required then
      perform sec.raise_boundary('PAYLOAD_INVALID', format('falta el campo %s', p_key), 400);
    end if;
    return null;
  end if;
  if jsonb_typeof(v_raw) <> 'string' then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s debe ser un string JSON', p_key), 400);
  end if;
  begin
    v_out := (p_payload ->> p_key)::uuid;
  exception when others then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s no es un UUID', p_key), 400);
  end;
  return v_out;
end
$fn$;

revoke execute on function sec.payload_uuid(jsonb, text, boolean) from public;

create function sec.payload_date(p_payload jsonb, p_key text)
returns date
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw jsonb := p_payload -> p_key;
  v_out date;
begin
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('falta el campo %s', p_key), 400);
  end if;
  if jsonb_typeof(v_raw) <> 'string' then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s debe ser un string JSON', p_key), 400);
  end if;
  begin
    v_out := (p_payload ->> p_key)::date;
  exception when others then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s no es una fecha ISO', p_key), 400);
  end;
  return v_out;
end
$fn$;

revoke execute on function sec.payload_date(jsonb, text) from public;

create function sec.payload_contract_version(p_payload jsonb)
returns integer
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw jsonb := p_payload -> 'command_contract_version';
begin
  -- NO es un valor monetario: aqui un number JSON es lo correcto.
  if v_raw is null or jsonb_typeof(v_raw) <> 'number' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'command_contract_version debe ser un entero JSON', 400);
  end if;
  if (p_payload ->> 'command_contract_version')::numeric <> floor((p_payload ->> 'command_contract_version')::numeric)
     or (p_payload ->> 'command_contract_version')::integer < 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'command_contract_version debe ser un entero >= 1', 400);
  end if;
  return (p_payload ->> 'command_contract_version')::integer;
end
$fn$;

revoke execute on function sec.payload_contract_version(jsonb) from public;

-- ============================== 3 · autorizacion por ambito ================
-- Las cuatro clases de 7a producen SALDO, y el saldo solo existe en un Modo
-- Personal: el Grupo no tiene saldo propio (`data-model.md` §2) y el saldo del
-- Modo Pareja esta gobernado por su ciclo de cierre —invariante 18—, que no
-- existe todavia. Escribir en un `couple` sin esa maquinaria podria saltarse la
-- proteccion que bloquea las retiradas unilaterales, asi que 7a se restringe a
-- `personal` en los dos extremos.
--
-- La propiedad se comprueba contra `owner_user_id` (ADR-016), NUNCA contra la
-- membresia.
--
-- El mismo error para «no existe» y «no es tuyo», a proposito: distinguirlos
-- convertiria la funcion en un oraculo de existencia de ambitos.

create function sec.assert_owned_personal_scope(p_scope uuid, p_actor uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_kind  text;
  v_owner uuid;
begin
  select s.kind, s.owner_user_id into v_kind, v_owner
    from core.scope s where s.id = p_scope;
  if not found or v_kind <> 'personal' or v_owner is distinct from p_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'el actor no puede producir efectos en ese ambito', 403);
  end if;
end
$fn$;

revoke execute on function sec.assert_owned_personal_scope(uuid, uuid) from public;

-- El extremo de DESTINO de una transferencia interna puede ser el Modo Personal
-- de otro usuario: ADR-002 §10 lo permite y `data-model.md` §4.8 lo describe.
-- Lo que NO puede es originarse desde el ambito ajeno — eso lo garantiza que el
-- extremo de SALIDA exija propiedad (invariante 14).
create function sec.assert_personal_scope(p_scope uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_kind text;
begin
  select s.kind into v_kind from core.scope s where s.id = p_scope;
  if not found or v_kind <> 'personal' then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'el ambito de destino no es un Modo Personal alcanzable', 403);
  end if;
end
$fn$;

revoke execute on function sec.assert_personal_scope(uuid) from public;

-- FX: 3.C NO resuelve conversion. ADR-009 §8 deja la regla de resolucion como
-- decision de producto pendiente y ADR-003 §4 niega autoridad al tipo que
-- aporte el cliente, de modo que el servidor no tiene con que resolverlo.
--
-- El codigo es propio y no `PAYLOAD_INVALID`: la intencion es valida y el actor
-- esta autorizado; lo que falta es una CAPACIDAD. Reportarlo como payload
-- invalido haria que el cliente corrigiera algo que no esta mal.
create function sec.assert_no_conversion(p_scope uuid, p_currency uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_base uuid;
begin
  select s.base_currency_definition_id into v_base from core.scope s where s.id = p_scope;
  if not found then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'ambito no alcanzable', 403);
  end if;
  if v_base is distinct from p_currency then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la moneda de la operacion no es la moneda base del ambito, y la conversion todavia no esta disponible', 422);
  end if;
end
$fn$;

revoke execute on function sec.assert_no_conversion(uuid, uuid) from public;

-- ============================== 4 · protocolo comun ========================
-- Pasos 1 a 4 de ADR-011 §13: actor, forma, RECLAMO de la clave y resolucion
-- de replay o conflicto. La autorizacion actual (paso 5) la hace cada funcion
-- publica DESPUES, porque depende de la clase, y el bloqueo con CAS (6-7) va en
-- `sec.lock_and_cas`.
--
-- El orden no es negociable: reclamar ANTES del CAS. Sin el, un reintento
-- tardio de una correccion —despues de que otra persona confirmara la suya—
-- fallaria como edicion obsoleta, el cliente concluiria que no se aplico y
-- podria generar una intencion nueva. Es justo el duplicado que ADR-010 existe
-- para impedir.

create function sec.begin_command(
  p_payload         jsonb,
  p_operation_class text,
  p_canonical       jsonb,
  out o_replay      boolean,
  out o_actor       uuid,
  out o_operation   uuid,
  out o_version     uuid,
  out o_correction  boolean,
  out o_expected    uuid
)
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_key          uuid;
  v_contract     integer;
  v_command_type text;
  v_existing     core.client_command%rowtype;
begin
  -- 1 · actor. Falla cerrado con 42501 si no hay identidad valida.
  o_actor := sec.request_actor_id();

  -- 2 · forma
  v_key      := sec.payload_uuid(p_payload, 'client_operation_id', true);
  v_contract := sec.payload_contract_version(p_payload);
  o_operation := sec.payload_uuid(p_payload, 'operation_id', false);
  o_expected  := sec.payload_uuid(p_payload, 'expected_version_id', false);
  o_correction := o_operation is not null;

  if o_correction and o_expected is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'una correccion exige expected_version_id: sin el no hay control de concurrencia', 400);
  end if;
  if not o_correction and o_expected is not null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'expected_version_id solo se usa al corregir', 400);
  end if;

  -- El `command_type` distingue alta de correccion, de modo que reutilizar la
  -- clave de un alta para corregir sea CONFLICTO y no replay (ADR-010 §3).
  -- La clase NO se mete en la unicidad: eso lo prohibe ADR-010 §2.
  v_command_type := p_operation_class || case when o_correction then '.correct' else '.create' end;

  o_version := gen_random_uuid();
  if not o_correction then
    o_operation := gen_random_uuid();
  end if;

  -- 3 · RECLAMO. La FK compuesta del resultado es DIFERIBLE, asi que el comando
  -- puede referenciar una version que todavia no existe fisicamente pero debe
  -- existir al commit (ADR-011 §5, §7).
  begin
    insert into core.client_command
      (created_by, client_operation_id, command_type, command_contract_version,
       canonical_intent, result_operation_id, result_version_id)
    values (o_actor, v_key, v_command_type, v_contract,
            p_canonical, o_operation, o_version);
    o_replay := false;
    return;
  exception when unique_violation then
    -- Es la UNICA captura de excepcion permitida en todo el camino. Cualquier
    -- otra convertiria un fallo en escritura parcial.
    --
    -- Carrera: el segundo INSERT bloquea en el indice unico hasta que el
    -- primero resuelve. Si confirma, llegamos aqui y hacemos replay; si
    -- revierte, el INSERT habria tenido exito. Medido en E15-B y E17.
    null;
  end;

  -- 4 · replay o conflicto, ANTES del CAS.
  select * into v_existing
    from core.client_command
   where created_by = o_actor and client_operation_id = v_key;

  if v_existing.command_type is distinct from v_command_type
     or v_existing.canonical_intent is distinct from p_canonical then
    perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED',
      'la clave ya se uso con otra clase de comando o con otra intencion', 409);
  end if;

  o_replay    := true;
  o_operation := v_existing.result_operation_id;
end
$fn$;

comment on function sec.begin_command(jsonb, text, jsonb, out boolean, out uuid, out uuid, out uuid, out boolean, out uuid) is
  'Pasos 1-4 de ADR-011 §13: actor, forma, reclamo de la clave y replay o conflicto. SIEMPRE antes del CAS.';

revoke execute on function sec.begin_command(jsonb, text, jsonb) from public;

-- Pasos 6 y 7: bloqueo de la fila de la operacion y CAS.
--
-- Bloquear PRIMERO y comprobar despues es lo que da el error limpio. Si se
-- insertara la version antes, un competidor que ya hubiera creado N+1 haria
-- saltar `UNIQUE (operation_id, version_no)` —el backstop de ADR-011 §12— y el
-- fallo se reportaria como violacion de restriccion en vez de como conflicto.
--
-- Y es lo que resuelve el invariante que ADR-011 §11 reservo expresamente a la
-- frontera: `supersedes_version_id` sale de la fila BLOQUEADA, asi que es
-- exactamente la version vigente anterior y no hay bifurcacion posible.
--
-- `SELECT ... FOR UPDATE` exige el privilegio UPDATE sobre al menos una columna
-- —el writer tiene `update (current_version_id)`— y una policy de UPDATE. E20
-- midio que sin la policy devuelve CERO FILAS SIN ERROR.

create function sec.lock_and_cas(
  p_operation      uuid,
  p_expected       uuid,
  out o_version_no integer,
  out o_supersedes uuid
)
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_current uuid;
begin
  select o.current_version_id into v_current
    from core.operation o
   where o.id = p_operation
   for update;

  if not found then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'la operacion no existe o no es alcanzable', 403);
  end if;

  if v_current is distinct from p_expected then
    perform sec.raise_boundary('VERSION_CONFLICT',
      'expected_version_id no es la version vigente de esa operacion', 409);
  end if;

  select ov.version_no into o_version_no
    from core.operation_version ov where ov.id = v_current;

  o_version_no := o_version_no + 1;
  o_supersedes := v_current;
end
$fn$;

revoke execute on function sec.lock_and_cas(uuid, uuid) from public;

-- Pasos 9 y 10: operacion —solo si es nueva—, version, y movimiento del puntero.
--
-- El puntero se mueve DESPUES de insertar la version: su `WITH CHECK` exige que
-- la version referida este atribuida al actor, y E20 midio que la subconsulta ve
-- las filas insertadas y aun no confirmadas de la misma transaccion.
create function sec.persist_version(
  p_actor           uuid,
  p_operation       uuid,
  p_version         uuid,
  p_version_no      integer,
  p_supersedes      uuid,
  p_operation_class text,
  p_effective_date  date,
  p_original_amount bigint,
  p_currency        uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  if p_version_no = 1 then
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values (p_operation, p_operation_class, p_actor, p_version);
  end if;

  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, original_amount, original_currency_definition_id,
     economic_rules_version)
  values (p_version, p_operation, p_version_no, p_supersedes, p_actor,
          p_effective_date, p_original_amount, p_currency, 'v1');

  if p_version_no > 1 then
    update core.operation
       set current_version_id = p_version
     where id = p_operation;
  end if;
end
$fn$;

revoke execute on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid) from public;

-- Envelope unico de retorno. La MISMA forma en alta y en replay, a proposito:
-- ADR-010 §5 acota lo que puede devolverse cuando el actor pudo perder la
-- autorizacion despues, y si el exito fuera mas rico el replay tendria que
-- empobrecerse y el cliente veria dos contratos.
create function sec.envelope(p_operation uuid, p_replay boolean)
returns jsonb
language sql
immutable
set search_path = ''
begin atomic
  select jsonb_build_object('operation_id', p_operation, 'already_processed', p_replay);
end;

revoke execute on function sec.envelope(uuid, boolean) from public;

-- El writer invoca estos helpers directamente, asi que necesita EXECUTE.
grant execute on function sec.raise_boundary(text, text, integer)             to nomey_writer;
grant execute on function sec.assert_payload_shape(jsonb, text[])             to nomey_writer;
grant execute on function sec.payload_amount(jsonb, text)                     to nomey_writer;
grant execute on function sec.payload_uuid(jsonb, text, boolean)              to nomey_writer;
grant execute on function sec.payload_date(jsonb, text)                       to nomey_writer;
grant execute on function sec.payload_contract_version(jsonb)                 to nomey_writer;
grant execute on function sec.assert_owned_personal_scope(uuid, uuid)         to nomey_writer;
grant execute on function sec.assert_personal_scope(uuid)                     to nomey_writer;
grant execute on function sec.assert_no_conversion(uuid, uuid)                to nomey_writer;
grant execute on function sec.begin_command(jsonb, text, jsonb)               to nomey_writer;
grant execute on function sec.lock_and_cas(uuid, uuid)                        to nomey_writer;
grant execute on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid) to nomey_writer;
grant execute on function sec.envelope(uuid, boolean)                         to nomey_writer;

-- ============================== 5 · las cuatro clases ======================
-- Una funcion publica POR CLASE DE OPERACION, tal como fija ADR-009 §1 —cuyos
-- propios ejemplos, `record_personal_expense` y `record_group_expense`,
-- comparten clase contable y demuestran que «clase de operacion» no es la clase
-- contable de ADR-002 §3 sino el TIPO de operacion de ADR-013 §2—.
--
-- Alta y correccion comparten funcion porque son la misma clase; las distingue
-- el `command_type`. Una funcion generica quedaria descartada por ADR-009
-- alternativa B: un solo EXECUTE abriria todas las clases a la vez.
--
-- Los valores de `operation_class` van en snake_case y se corresponden uno a
-- uno con los `kind` en camelCase de `tests/vectors/scenarios.json`:
--
--   adjustment         <-> adjustment
--   personal_expense   <-> personalExpense
--   external_transfer  <-> externalTransfer
--   internal_transfer  <-> internalTransfer

-- ------------------------------------------------------------- adjustment --
-- `data-model.md` §4.11: la declaracion inicial de dinero disponible es el
-- primer ajuste; no existe un concepto separado de saldo inicial. Fuera de
-- estadisticas: encontrar 50 mas de los esperados no es haberlos ganado.
--
-- El signo es libre: ADR-013 §3 dice expresamente que «un ajuste negativo es
-- valido». No se inventa ninguna cota que el dominio no imponga.
create function api.record_adjustment(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','delta','currency_definition_id'];
  v_scope uuid; v_currency uuid; v_delta bigint; v_date date;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_delta    := sec.payload_amount(payload, 'delta');
  v_date     := sec.payload_date(payload, 'effective_date');

  -- Canonicalizacion: la hace SOLO el servidor (ADR-011 §8) y NORMALIZA por
  -- construccion, porque cada valor pasa por su tipo. Sin ello, un cliente que
  -- rellenara el importe con ceros a la izquierda veria un conflicto falso.
  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'delta',                  v_delta::text,
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'adjustment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'adjustment', v_date, v_delta, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_version, v_scope, 'adjustment', v_currency, v_delta);

  return sec.envelope(v_operation, false);
end
$fn$;

-- ------------------------------------------------------- personal expense --
-- `derivePersonalExpense`: un solo efecto con saldo -importe y economica
-- +importe SIN participante, porque el Modo Personal no nomina participante.
--
-- El importe debe ser > 0: ADR-013 §3 dice que «un gasto de cero o negativo no»
-- es valido, y asigna esa validacion por clase a la frontera, no al dominio.
create function api.record_personal_expense(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un gasto de cero o negativo no es valido (ADR-013 §3)', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'amount',                 v_amount::text,
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'personal_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_expense', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
          - v_amount, v_amount, null);

  return sec.envelope(v_operation, false);
end
$fn$;

-- ------------------------------------------------------ external transfer --
-- Un unico extremo dentro de Nomey (`data-model.md` §3). El `delta` es con
-- signo por diseno: negativo al pagar, positivo al reflejar dinero recibido.
-- No se valida el signo porque solo alcanza al ambito de quien la registra y no
-- hay riesgo de apropiacion.
create function api.record_external_transfer(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','delta','currency_definition_id'];
  v_scope uuid; v_currency uuid; v_delta bigint; v_date date;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_delta    := sec.payload_amount(payload, 'delta');
  v_date     := sec.payload_date(payload, 'effective_date');

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'delta',                  v_delta::text,
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'external_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'external_transfer', v_date, v_delta, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_version, v_scope, 'transfer', v_currency, v_delta);

  return sec.envelope(v_operation, false);
end
$fn$;

-- ------------------------------------------------------ internal transfer --
-- Exactamente una salida en origen y una entrada en destino (invariante 4).
--
-- El extremo de SALIDA exige propiedad, y el de destino solo existir: es el
-- invariante 14 —«solo puedes iniciar una transferencia desde tu propio Modo
-- Personal»— y lo que impide la primitiva directa de apropiacion que
-- `data-model.md` §8 describe.
--
-- Y por eso el importe debe ser > 0: un importe negativo invertiria la
-- direccion y sacaria dinero del ambito del tercero, que es exactamente lo
-- prohibido.
--
-- Un solo `amount`, y no uno por extremo como en el dominio: con la conversion
-- sin soportar, ambas monedas base coinciden y los dos importes son el mismo
-- numero. Cuando llegue el FX, el contrato gana el segundo importe y sube
-- `command_contract_version`.
create function api.record_internal_transfer(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'from_scope_id','to_scope_id','amount','currency_definition_id'];
  v_from uuid; v_to uuid; v_currency uuid; v_amount bigint; v_date date;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_from     := sec.payload_uuid(payload, 'from_scope_id', true);
  v_to       := sec.payload_uuid(payload, 'to_scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el importe de una transferencia interna debe ser positivo: uno negativo invertiria la direccion', 400);
  end if;
  if v_from = v_to then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'origen y destino no pueden ser el mismo ambito', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'from_scope_id',          v_from::text,
    'to_scope_id',            v_to::text,
    'amount',                 v_amount::text,
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'internal_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_from, v_actor);
  perform sec.assert_personal_scope(v_to);
  perform sec.assert_no_conversion(v_from, v_currency);
  perform sec.assert_no_conversion(v_to,   v_currency);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'internal_transfer', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_currency,   v_amount);

  return sec.envelope(v_operation, false);
end
$fn$;

-- ============================== 6 · propiedad y privilegios ================
-- ADR-009 §5: las funciones autoritativas son propiedad de un WRITER DEDICADO,
-- no de `postgres`. Es lo contrario que `api.claimed_dimension()`, y es
-- deliberado: la de lectura debe ATRAVESAR la RLS para recuperar lo reclamado;
-- estas deben quedar DEBAJO de ella. E16 midio que con un writer no propietario
-- y `NOBYPASSRLS` una policy `WITH CHECK` detuvo una escritura que el codigo
-- habria dejado pasar. Unificarlas romperia una de las dos.
--
-- Ceder la propiedad tiene una mecanica delicada que ADR-009 registra como
-- coste medido: el nuevo owner necesita CREATE sobre el schema, y el cambio de
-- propiedad PIERDE LOS GRANT EXPLICITOS. Por eso los grants van despues.

grant create on schema api to nomey_writer;

alter function api.record_adjustment(jsonb)         owner to nomey_writer;
alter function api.record_personal_expense(jsonb)   owner to nomey_writer;
alter function api.record_external_transfer(jsonb)  owner to nomey_writer;
alter function api.record_internal_transfer(jsonb)  owner to nomey_writer;

revoke create on schema api from nomey_writer;

-- ADR-006 §4 y ADR-009 §4: revoke explicito y grant solo al rol autorizado.
-- E12 midio que sin el revoke la funcion es invocable por `anon`.
revoke execute on function api.record_adjustment(jsonb)        from public;
revoke execute on function api.record_personal_expense(jsonb)  from public;
revoke execute on function api.record_external_transfer(jsonb) from public;
revoke execute on function api.record_internal_transfer(jsonb) from public;

grant execute on function api.record_adjustment(jsonb)        to authenticated;
grant execute on function api.record_personal_expense(jsonb)  to authenticated;
grant execute on function api.record_external_transfer(jsonb) to authenticated;
grant execute on function api.record_internal_transfer(jsonb) to authenticated;

comment on function api.record_adjustment(jsonb) is
  'Ajuste de saldo, incluida la declaracion inicial. Alta o correccion segun lleve operation_id (ADR-009, ADR-011).';
comment on function api.record_personal_expense(jsonb) is
  'Gasto en el Modo Personal: saldo negativo y economica positiva sin participante.';
comment on function api.record_external_transfer(jsonb) is
  'Transferencia con un unico extremo dentro de Nomey. El delta lleva signo.';
comment on function api.record_internal_transfer(jsonb) is
  'Transferencia entre dos Modos Personales. Solo la origina el dueno del extremo de salida (invariante 14).';

-- Ningun privilegio nuevo del cliente sobre `core`: la unica entrada de
-- escritura son estas cuatro funciones.
