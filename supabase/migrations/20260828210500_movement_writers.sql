-- Anatomia del movimiento · F6.B, segunda mitad: frontera y escritura.
--
-- Duodecima migracion real. Trae:
--
--   sec.canonical_concept          recorte y NFC, sin plegar mayusculas
--   sec.payload_time               lectura estricta de la hora
--   sec.assert_category_usable     familia, propiedad y baja logica
--   sec.persist_movement_detail    el detalle por version
--   sec.persist_version            + hora efectiva  + GUARDA DE CLASE
--   api.record_personal_expense    + concepto, categoria y hora
--   api.record_personal_income     LA OCTAVA, clase `income`
--   api.category                   vista del catalogo visible
--   api.create_custom_category     alta de personalizada
--   api.rename_custom_category     renombrado
--   api.set_custom_category_active baja y alta logicas
--
-- ============ LA CORRECCION CRUZADA DE CLASE, CERRADA EN UN SOLO SITIO ======
--
-- El defecto detectado al cerrar F6.A: `sec.lock_and_cas` comprueba EXISTENCIA y
-- CAS, y no que la clase de la operacion coincida con la funcion que la esta
-- corrigiendo. Con una sola clase personal era teorico. Con `income` deja de
-- serlo: los dos payloads son de FORMA IDENTICA, asi que basta intercambiar el
-- `operation_id` para dejar `operation_class = personal_expense` con efectos
-- `income`, sin que nada lance.
--
-- La guarda vive en `sec.persist_version`, y la eleccion tiene tres motivos:
--
--   1. YA RECIBE LA CLASE. Las siete funciones existentes le pasan su propio
--      literal —`'adjustment'`, `'personal_expense'`, `'group_expense'`…— asi
--      que no hay que tocar ni un cuerpo ni anadir un parametro que alguien
--      pueda olvidar. **Ninguna funcion autoritativa puede quedarse fuera**,
--      porque las ocho pasan por aqui para existir.
--   2. ES SU TRABAJO. Es la funcion que inserta la version y mueve el puntero
--      de vigencia; negarse a colgar una version de una operacion de otra clase
--      es exactamente lo que le corresponde.
--   3. EL ORDEN CORRECTO. Se ejecuta DESPUES del CAS. Provocar este error exige
--      por tanto haber acertado el `expected_version_id` vigente, que es un UUID
--      inadivinable: la comprobacion no se convierte en un oraculo con el que
--      averiguar la clase de una operacion ajena. Ponerla en
--      `sec.begin_command` —que corre antes de autorizar— si lo habria sido.
--
-- Un parametro con valor por defecto habria sido peor que esto: quien lo
-- omitiera se saltaria la comprobacion en silencio.

-- ====================== 1 · canonicalizacion del concepto ==================
--
-- MINIMA Y EXPLICITA, que es lo que pide el contrato. Hace dos cosas y ninguna
-- mas:
--
--   · recorta los espacios exteriores;
--   · normaliza a NFC.
--
-- El NFC no es cosmetico. En iOS y en macOS un acento puede llegar como caracter
-- precompuesto o como letra mas diacritico combinante: dos secuencias de bytes
-- distintas que se ven igual y que la persona escribio igual. Sin normalizar,
-- «Café» tecleado en dos teclados produciria dos intenciones distintas y un
-- reintento legitimo seria CONFLICTO. NFC es la forma canonica de Unicode y esa
-- comparacion deja de depender del teclado.
--
-- LO QUE NO HACE, y es tan importante como lo que hace: **no pliega mayusculas**.
-- `Mercadona` y `MERCADONA` son intenciones DISTINTAS y se conservan distintas.
-- Tampoco colapsa espacios interiores, ni recorta longitud, ni quita signos:
-- todo eso seria normalizacion semantica, y decidir por la persona que dos
-- textos suyos «significan lo mismo» no le corresponde a la frontera.
--
-- El valor canonicalizado es el que se PERSISTE y el que entra en la intencion
-- canonica, de modo que lo comparado y lo mostrado son el mismo texto.

create function sec.canonical_concept(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_out text := normalize(btrim(coalesce(p_raw, '')), nfc);
begin
  if v_out = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el concepto es obligatorio y no puede quedar vacio al recortarlo', 400);
  end if;
  return v_out;
end
$fn$;

comment on function sec.canonical_concept(text) is
  'Recorta y normaliza a NFC. NO pliega mayusculas: Mercadona y MERCADONA son intenciones distintas (ADR-020).';

revoke execute on function sec.canonical_concept(text) from public;
grant  execute on function sec.canonical_concept(text) to nomey_writer;

-- ======================== 2 · lectura estricta de la hora ==================
-- Completa la familia `sec.payload_*`. Exige string JSON, como el resto.

create function sec.payload_time(p_payload jsonb, p_key text, p_required boolean)
returns time
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw jsonb := p_payload -> p_key;
  v_out time;
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
    v_out := (p_payload ->> p_key)::time;
  exception when others then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s no es una hora valida', p_key), 400);
  end;
  return v_out;
end
$fn$;

comment on function sec.payload_time(jsonb, text, boolean) is
  'Lectura estricta de una hora del payload. Sin zona: el par (fecha, hora) es un reloj de pared local (ADR-020).';

revoke execute on function sec.payload_time(jsonb, text, boolean) from public;
grant  execute on function sec.payload_time(jsonb, text, boolean) to nomey_writer;

-- ========================= 3 · la categoria, autorizada ====================
--
-- Cuatro comprobaciones, y el ORDEN importa por privacidad:
--
--   1. VISIBLE para el actor —de sistema, o suya—. Si no lo es, el mensaje NO
--      distingue «no existe» de «no es tuya»: distinguirlos convertiria la
--      funcion en un oraculo con el que enumerar las categorias de otra persona.
--   2. de la FAMILIA esperada. Una categoria de gasto no vale para un ingreso y
--      viceversa. La familia esperada es una CONSTANTE en cada writer, no un
--      dato del payload: no hay nada que el cliente pueda torcer.
--   3. ACTIVA... salvo que sea LA MISMA que ya tenia la version que se corrige.
--      Sin esa excepcion, dar de baja una categoria dejaria INCORREGIBLE todo
--      movimiento que la use: cualquier correccion —aunque solo cambiara el
--      importe— seria rechazada por una categoria que la persona no esta
--      tocando. Con ella, se conserva lo que hay y solo se prohibe ASIGNAR una
--      inactiva nueva.
--
-- Todo con `CATEGORY_NOT_USABLE`, un unico codigo: el cliente no puede hacer
-- nada distinto segun el caso, y los mensajes ya lo explican.

create function sec.assert_category_usable(
  p_category   uuid,
  p_family     text,
  p_actor      uuid,
  p_supersedes uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_family text;
  v_owner  uuid;
  v_active boolean;
  v_previa uuid;
begin
  select c.applies_to, c.owner_user_id, c.is_active
    into v_family, v_owner, v_active
    from core.category c
   where c.id = p_category;

  -- 1 · visibilidad. Mismo mensaje para inexistente y ajena.
  if not found or (v_owner is not null and v_owner is distinct from p_actor) then
    perform sec.raise_boundary('CATEGORY_NOT_USABLE',
      'esa categoria no existe o no esta disponible para el actor', 422);
  end if;

  -- 2 · familia.
  if v_family is distinct from p_family then
    perform sec.raise_boundary('CATEGORY_NOT_USABLE',
      format('esa categoria es de la familia %s y la operacion es de la familia %s',
             v_family, p_family), 422);
  end if;

  -- 3 · baja logica, con la excepcion de conservar la que ya estaba.
  if not v_active then
    if p_supersedes is null then
      perform sec.raise_boundary('CATEGORY_NOT_USABLE',
        'esa categoria esta dada de baja y no puede asignarse', 422);
    end if;
    select d.category_id into v_previa
      from core.movement_detail d where d.operation_version_id = p_supersedes;
    if v_previa is distinct from p_category then
      perform sec.raise_boundary('CATEGORY_NOT_USABLE',
        'esa categoria esta dada de baja y no puede asignarse', 422);
    end if;
  end if;
end
$fn$;

comment on function sec.assert_category_usable(uuid, text, uuid, uuid) is
  'Visibilidad, familia y baja logica de una categoria. Una inactiva solo se conserva, nunca se asigna (ADR-021).';

revoke execute on function sec.assert_category_usable(uuid, text, uuid, uuid) from public;
grant  execute on function sec.assert_category_usable(uuid, text, uuid, uuid) to nomey_writer;

-- ========================= 4 · el detalle del movimiento ===================

create function sec.persist_movement_detail(
  p_version  uuid,
  p_concept  text,
  p_category uuid,
  p_family   text
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  insert into core.movement_detail (operation_version_id, concept, category_id, applies_to)
  values (p_version, p_concept, p_category, p_family);
end
$fn$;

revoke execute on function sec.persist_movement_detail(uuid, text, uuid, text) from public;
grant  execute on function sec.persist_movement_detail(uuid, text, uuid, text) to nomey_writer;

-- ================= 5 · persist_version: hora y guarda de clase =============
--
-- `p_effective_time` se anade AL FINAL y CON DEFECTO NULO, de modo que las seis
-- clases que todavia no declaran hora siguen llamando igual. Aqui el defecto no
-- es una via de escape: nulo es el valor CORRECTO para una clase que no registra
-- hora, no la ausencia de una comprobacion.
--
-- La guarda de clase, en cambio, NO tiene defecto ni parametro: usa el
-- `p_operation_class` que ya viaja, y por eso nadie puede omitirla.
--
-- ================== POR QUE SE SUELTA LA VERSION ANTERIOR ==================
--
-- `CREATE OR REPLACE` con un parametro nuevo NO reemplaza: la firma cambia, asi
-- que PostgreSQL crea una funcion DISTINTA y conviven las dos. Medido al aplicar
-- esta migracion por primera vez —las llamadas de nueve argumentos pasaron a
-- fallar con «function ... is not unique»—, y el fallo ruidoso oculta uno
-- silencioso peor: si la resolucion de sobrecarga hubiera elegido la antigua,
-- las siete funciones existentes habrian seguido escribiendo **sin la guarda de
-- clase**, y la comprobacion habria parecido instalada sin estarlo.
--
-- Por eso se suelta explicitamente la de nueve argumentos, y por eso el check
-- afirma que queda EXACTAMENTE UNA `sec.persist_version`.

drop function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid);

create function sec.persist_version(
  p_actor           uuid,
  p_operation       uuid,
  p_version         uuid,
  p_version_no      integer,
  p_supersedes      uuid,
  p_operation_class text,
  p_effective_date  date,
  p_original_amount bigint,
  p_currency        uuid,
  p_effective_time  time default null
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_clase text;
begin
  if p_version_no = 1 then
    insert into core.operation (id, operation_class, created_by, current_version_id)
    values (p_operation, p_operation_class, p_actor, p_version);
  else
    -- GUARDA DE CLASE. La operacion ya existe y ya esta bloqueada por
    -- `sec.lock_and_cas`, asi que esta lectura no compite con nadie.
    --
    -- Se comprueba ANTES de insertar nada: una version colgada de una operacion
    -- de otra clase no debe llegar a existir ni un instante.
    select o.operation_class into v_clase from core.operation o where o.id = p_operation;
    if v_clase is distinct from p_operation_class then
      perform sec.raise_boundary('OPERATION_CLASS_MISMATCH',
        format('la operacion es de clase %s y esta funcion escribe %s: una clase no corrige a otra',
               v_clase, p_operation_class), 422);
    end if;
  end if;

  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, effective_time, original_amount, original_currency_definition_id,
     economic_rules_version)
  values (p_version, p_operation, p_version_no, p_supersedes, p_actor,
          p_effective_date, p_effective_time, p_original_amount, p_currency, 'v1');

  if p_version_no > 1 then
    update core.operation set current_version_id = p_version where id = p_operation;
  end if;
end
$fn$;

comment on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time) is
  'Persiste la version y mueve el puntero. Contiene la GUARDA DE CLASE: una funcion de una clase no puede corregir una operacion de otra (ADR-020).';

-- Soltar la anterior se llevo su grant, asi que vuelve aqui.
revoke execute on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time) from public;
grant  execute on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time) to nomey_writer;

-- `sec.payload_text` nacio en F6.A para el provisioning y ahora la usan tambien
-- los dos writers de movimiento, que corren como `nomey_writer`.
grant execute on function sec.payload_text(jsonb, text, boolean) to nomey_writer;

-- ============================ 6 · privilegios nuevos =======================
-- E21 midio tres veces que un GRANT sin policy aplicable devuelve CERO FILAS SIN
-- ERROR. Cada grant de lectura de aqui abajo lleva la suya.

grant select on core.category        to nomey_writer;
grant select, insert on core.movement_detail to nomey_writer;

create policy category_writer_select on core.category
  for select to nomey_writer using (true);

create policy movement_detail_writer_select on core.movement_detail
  for select to nomey_writer using (true);

-- Misma forma que `effect_writer_insert`: la version referida debe estar
-- atribuida al actor de la peticion. E20 midio que la subconsulta ve las filas
-- insertadas y no confirmadas de la misma transaccion.
create policy movement_detail_writer_insert on core.movement_detail
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = movement_detail.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

-- =========================== 7 · el gasto, ampliado ========================
-- Misma semantica economica que antes —saldo -importe, economica +importe sin
-- participante—. Lo unico que cambia es que ahora el movimiento SIGNIFICA algo
-- para quien lo lee. `command_contract_version` pasa a 2 por convencion; el
-- servidor no la impone, y §13 del ADR explica por que.

create or replace function api.record_personal_expense(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id','concept','category_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time;
  v_concept text; v_category uuid;
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
  v_time     := sec.payload_time(payload, 'effective_time', true);
  v_category := sec.payload_uuid(payload, 'category_id', true);
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un gasto de cero o negativo no es valido (ADR-013 §3)', 400);
  end if;

  -- El concepto entra en la intencion canonica YA CANONICALIZADO, y la
  -- categoria y la hora tambien: son intencion declarada por la persona, asi
  -- que un reintento que las cambie es CONFLICTO y no replay.
  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'amount',                 payload ->> 'amount',
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'concept',                v_concept,
    'category_id',            v_category::text);

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

  perform sec.assert_category_usable(v_category, 'expense', v_actor, v_supersedes);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_expense', v_date, v_amount, v_currency,
                              v_time);
  perform sec.persist_movement_detail(v_version, v_concept, v_category, 'expense');

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
          - v_amount, v_amount, null);

  return sec.envelope(v_operation, false);
end
$fn$;

-- ============================== 8 · el ingreso =============================
--
-- LA OCTAVA FUNCION, y una clase contable de primera. `income` existe en
-- `data-model.md` §3 y en el invariante 7 desde la Fase 1, y hasta ahora no
-- tenia ruta de escritura.
--
-- NO se modela como gasto negativo ni como ajuste positivo, y no es una
-- preferencia: las estadisticas son una LISTA DE ADMITIDOS —solo `ingreso` y
-- `gasto` las alimentan—, de modo que un ingreso disfrazado de ajuste
-- desapareceria de ellas sin que nada fallara. Es el fallo silencioso que el
-- invariante 7 existe para evitar.
--
-- Espejo exacto del gasto: saldo +importe, economica +importe SIN participante
-- —el Modo Personal no nomina participante (ADR-013 §8)— e importe > 0 por la
-- misma razon por la que el gasto lo exige: el signo lo pone la clase, no la
-- persona.

create function api.record_personal_income(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id','concept','category_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time;
  v_concept text; v_category uuid;
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
  v_time     := sec.payload_time(payload, 'effective_time', true);
  v_category := sec.payload_uuid(payload, 'category_id', true);
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un ingreso de cero o negativo no es valido: el signo lo pone la clase', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'amount',                 payload ->> 'amount',
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'concept',                v_concept,
    'category_id',            v_category::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'personal_income', v_canonical);
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

  perform sec.assert_category_usable(v_category, 'income', v_actor, v_supersedes);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_income', v_date, v_amount, v_currency,
                              v_time);
  perform sec.persist_movement_detail(v_version, v_concept, v_category, 'income');

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'income', v_currency,
          v_amount, v_amount, null);

  return sec.envelope(v_operation, false);
end
$fn$;

grant create on schema api to nomey_writer;
alter function api.record_personal_income(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;

revoke execute on function api.record_personal_income(jsonb) from public;
grant  execute on function api.record_personal_income(jsonb) to authenticated;

comment on function api.record_personal_income(jsonb) is
  'Ingreso en el Modo Personal: saldo positivo y economica positiva sin participante. Clase contable propia, nunca un ajuste (ADR-020).';

-- ===================== 9 · las categorias, escritura y lectura =============
--
-- QUIEN ES EL DUENO DE ESTAS FUNCIONES, y por que no hace falta un cuarto rol.
--
-- Crear o renombrar una categoria NO es un hecho contable: no produce operacion,
-- ni version, ni efecto. Es exactamente la familia de escrituras para la que ya
-- existe `nomey_provisioner` —ADR-019 lo creo para «crear ambitos y membresias,
-- que no son hechos contables»—, de modo que su alcance real es **la frontera
-- de las escrituras que no son contabilidad**, y las categorias son su segundo
-- miembro. Se reutiliza en vez de inventar un rol nuevo.
--
-- Las dos alternativas se descartan por escrito:
--
--   · `nomey_writer` NO, porque es el escritor CONTABLE y ensancharlo mezclaria
--     dos fronteras que el proyecto mantiene separadas a proposito.
--   · Conceder al cliente INSERT/UPDATE directo sobre `core.category` tampoco:
--     hoy `authenticated` no escribe NADA en `core`, y esa frase entera es facil
--     de verificar. Cambiarla por «no escribe nada salvo categorias» es
--     precisamente el tipo de excepcion que despues nadie recuerda.
--
-- Nada de esto pasa por `core.client_command`: ADR-011 §5 lo define como la
-- unidad de idempotencia del COMANDO CONTABLE, y aqui no hay operacion que
-- deduplicar. La unicidad la da el indice de nombre por persona y familia.

grant select, insert on core.category to nomey_provisioner;
grant update (label, is_active)       on core.category to nomey_provisioner;

-- Solo lo suyo y lo de sistema, para poder validar familia y nombres.
create policy category_provisioner_select on core.category
  for select to nomey_provisioner
  using (owner_user_id is null or owner_user_id = sec.request_actor_id());

-- Solo puede crear categorias PROPIAS del actor: `owner_user_id` no llega nunca
-- del cliente y aqui ademas seria imposible falsearlo.
create policy category_provisioner_insert on core.category
  for insert to nomey_provisioner
  with check (owner_user_id = sec.request_actor_id());

-- Y solo puede modificar las suyas, sin poder convertirlas en de sistema.
create policy category_provisioner_update on core.category
  for update to nomey_provisioner
  using      (owner_user_id = sec.request_actor_id())
  with check (owner_user_id = sec.request_actor_id());

create function api.create_custom_category(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['applies_to','label','icon'];
  v_actor  uuid := sec.request_actor_id();
  v_family text;
  v_label  text;
  v_icon   text;
  v_id     uuid := gen_random_uuid();
  v_ord    smallint;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_family := sec.payload_text(payload, 'applies_to', true);
  v_label  := normalize(btrim(sec.payload_text(payload, 'label', true)), nfc);
  v_icon   := btrim(coalesce(sec.payload_text(payload, 'icon', false), 'tag'));

  if v_family not in ('expense', 'income') then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'applies_to debe ser expense o income', 400);
  end if;
  if v_label = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el nombre de la categoria no puede quedar vacio al recortarlo', 400);
  end if;
  if v_icon = '' then v_icon := 'tag'; end if;

  -- Detras de las de sistema, y en el orden en que la persona las crea.
  select coalesce(max(c.ordinal), 0) + 10 into v_ord
    from core.category c
   where c.applies_to = v_family and c.owner_user_id = v_actor;
  v_ord := greatest(v_ord, 1000);

  begin
    insert into core.category (id, applies_to, owner_user_id, label, icon, ordinal)
    values (v_id, v_family, v_actor, v_label, v_icon, v_ord);
  exception when unique_violation then
    perform sec.raise_boundary('CATEGORY_NAME_TAKEN',
      'ya tienes una categoria con ese nombre en esa familia', 409);
  end;

  return jsonb_build_object('category_id', v_id, 'applies_to', v_family, 'label', v_label);
end
$fn$;

create function api.rename_custom_category(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['category_id','label'];
  v_actor uuid := sec.request_actor_id();
  v_id    uuid;
  v_label text;
  v_n     integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_id    := sec.payload_uuid(payload, 'category_id', true);
  v_label := normalize(btrim(sec.payload_text(payload, 'label', true)), nfc);

  if v_label = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el nombre de la categoria no puede quedar vacio al recortarlo', 400);
  end if;

  begin
    update core.category set label = v_label where id = v_id;
  exception when unique_violation then
    perform sec.raise_boundary('CATEGORY_NAME_TAKEN',
      'ya tienes una categoria con ese nombre en esa familia', 409);
  end;
  get diagnostics v_n = row_count;

  -- Cero filas SIN error es como se manifiesta una policy que no casa —medido
  -- en E21—, y aqui cubre los tres casos a la vez: no existe, es de otro, o es
  -- de sistema. Mismo mensaje para los tres, para no ser un oraculo.
  if v_n <> 1 then
    perform sec.raise_boundary('CATEGORY_NOT_USABLE',
      'esa categoria no existe o no es tuya', 422);
  end if;

  -- Renombrar NO crea version de nada. El historico referencia la ENTIDAD, asi
  -- que los movimientos antiguos pasan a mostrar el nombre nuevo, que es
  -- justamente lo que el producto pide: una categoria es una entidad, no una
  -- etiqueta copiada en cada movimiento.
  return jsonb_build_object('category_id', v_id, 'label', v_label);
end
$fn$;

create function api.set_custom_category_active(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['category_id','is_active'];
  v_actor  uuid := sec.request_actor_id();
  v_id     uuid;
  v_raw    jsonb;
  v_active boolean;
  v_n      integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_id  := sec.payload_uuid(payload, 'category_id', true);
  v_raw := payload -> 'is_active';
  if v_raw is null or jsonb_typeof(v_raw) <> 'boolean' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'is_active debe ser un booleano JSON', 400);
  end if;
  v_active := (payload ->> 'is_active')::boolean;

  -- BAJA LOGICA, nunca DELETE. Los movimientos que la referencian siguen
  -- resolviendo su nombre y su icono; lo unico que cambia es que deja de
  -- ofrecerse en el selector.
  update core.category set is_active = v_active where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    perform sec.raise_boundary('CATEGORY_NOT_USABLE',
      'esa categoria no existe o no es tuya', 422);
  end if;

  return jsonb_build_object('category_id', v_id, 'is_active', v_active);
end
$fn$;

grant create on schema api to nomey_provisioner;
alter function api.create_custom_category(jsonb)     owner to nomey_provisioner;
alter function api.rename_custom_category(jsonb)     owner to nomey_provisioner;
alter function api.set_custom_category_active(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;

revoke execute on function api.create_custom_category(jsonb)     from public;
revoke execute on function api.rename_custom_category(jsonb)     from public;
revoke execute on function api.set_custom_category_active(jsonb) from public;
grant  execute on function api.create_custom_category(jsonb)     to authenticated;
grant  execute on function api.rename_custom_category(jsonb)     to authenticated;
grant  execute on function api.set_custom_category_active(jsonb) to authenticated;

comment on function api.create_custom_category(jsonb) is
  'Crea una categoria propia del actor en una familia. El propietario sale del JWT y nunca del payload (ADR-021).';
comment on function api.rename_custom_category(jsonb) is
  'Renombra una categoria propia. El historico referencia la entidad, asi que el nombre nuevo se ve tambien en los movimientos antiguos.';
comment on function api.set_custom_category_active(jsonb) is
  'Baja o alta logica de una categoria propia. Nunca DELETE: el historico la sigue resolviendo.';

-- La vista del catalogo. `security_invoker`, asi que la RLS de `core.category`
-- es la que decide: de sistema y propias, y ni la existencia de una ajena.
--
-- `is_active` SE PROYECTA y no se filtra aqui: quien pinta un selector pide
-- `is_active=eq.true`, y quien resuelve el nombre de un movimiento historico
-- necesita ver tambien las dadas de baja. Filtrar en la vista haria imposible lo
-- segundo.
--
-- `owner_user_id` NO se proyecta —es identidad—, pero si un booleano derivado
-- que dice si es propia, que es lo unico que la UI necesita para saber si puede
-- renombrarla.
create view api.category
with (security_invoker = true) as
select
  c.id,
  c.applies_to,
  c.message_key,
  c.label,
  c.icon,
  c.ordinal,
  c.is_active,
  (c.owner_user_id is not null) as is_custom
from core.category c;

comment on view api.category is
  'Catalogo visible para el actor: de sistema y propias. is_active se proyecta y no se filtra, porque el historico debe resolver tambien las dadas de baja (ADR-021).';

grant select on api.category to authenticated;
