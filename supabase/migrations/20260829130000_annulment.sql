-- Anulacion de una operacion · F6.C, tercera parte.
--
-- Decimoquinta migracion real. ADR-011 dejo la anulacion **expresamente fuera y
-- sin prejuzgar**: «tambien quedan fuera, y no se prejuzgan: la anulacion o
-- cancelacion como concepto distinto de la correccion». Esto la recoge; no
-- edita aquel ADR.
--
-- ============================== LA FORMA ===================================
--
--   V1  gasto -20,00  ->  efectos
--   V2  ANULACION     ->  CERO efectos        current_version_id = V2
--
-- Y eso es todo el mecanismo. `core.current_effect` une por
-- `current_version_id`, asi que una operacion cuya version vigente no tiene
-- efectos **aporta cero** sin ninguna logica adicional, en saldo, en deuda, en
-- estadisticas y en cualquier derivado futuro.
--
-- **`current_version_id` sigue siendo la UNICA autoridad de vigencia.** No hay
-- `deleted_at`, ni `is_deleted`, ni estado paralelo: un segundo mecanismo de
-- vigencia es exactamente lo que ADR-011 §1 evita al decidir que el puntero
-- SELECCIONA la version que cuenta.
--
-- V2 conserva `original_amount`, moneda, fecha y hora de la version anulada: es
-- el mismo hecho declarado, ahora sin vigencia, y hace legible el diff. Lo que
-- la hace no contar es **no producir efectos**, no un importe cero fabricado.
--
-- NADA SE BORRA. Operacion, versiones y efectos historicos permanecen. La
-- trazabilidad no depende de la buena voluntad de nadie: no existe ninguna ruta
-- de `DELETE` para el cliente ni para el writer.

-- ============================ 1 · el discriminante ==========================
--
-- POR QUE HACE FALTA, y no es comodidad. La superficie de lectura de F6.D tiene
-- que excluir las operaciones anuladas. Detectarlas por «su version vigente no
-- tiene efectos» obliga a una subconsulta sobre `core.effect` **dentro de una
-- vista**, y eso lo prohibe la guarda de catalogo de ADR-013 §9: la unica
-- relacion autorizada a depender directamente de `core.effect` es la proyeccion
-- canonica. Ya ocurrio en F6.A con una columna orientativa de
-- `api.personal_scope`, y la guarda la rechazo.
--
-- Con el discriminante, la exclusion se resuelve mirando la propia version.
--
-- DESCRIBE QUE CLASE DE VERSION ES; NO DECIDE CUAL CUENTA. Vocabulario cerrado,
-- como `scope.kind`: un tercer valor exige migracion deliberada.

alter table core.operation_version
  add column version_kind text not null default 'record';

alter table core.operation_version
  add constraint operation_version_kind_valida
  check (version_kind in ('record', 'annulment'));

comment on column core.operation_version.version_kind is
  'record | annulment. Describe QUE CLASE de version es. La vigencia la decide current_version_id y solo el (ADR-024).';

-- ====================== 2 · persist_version, con la clase ==================
--
-- Se suelta y se recrea por la misma razon medida en F6.B: `CREATE OR REPLACE`
-- con un parametro nuevo NO reemplaza, crea una funcion distinta, y conviven las
-- dos. Si la resolucion de sobrecarga eligiera la antigua, las ocho funciones
-- seguirian escribiendo sin la guarda de clase Y sin la de anulacion.
--
-- Las ocho llamadas existentes pasan diez argumentos y siguen resolviendo aqui
-- gracias al valor por defecto. `annul_operation` es la unica que pasa el
-- undecimo.
--
-- GANA ADEMAS UNA SEGUNDA GUARDA: **una operacion anulada no admite versiones
-- posteriores**. En F6 la anulacion es TERMINAL. «Restaurar» seria otra version
-- y no se disena hoy; lo que no puede pasar es que una correccion la reviva sin
-- que nadie lo haya decidido.

drop function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time);

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
  p_effective_time  time default null,
  p_version_kind    text default 'record'
)
returns void
language plpgsql
volatile
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

comment on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time, text) is
  'Persiste la version y mueve el puntero. Contiene la guarda de CLASE (ADR-020) y la de ANULACION: una operacion anulada no admite versiones nuevas (ADR-024).';

revoke execute on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time, text) from public;
grant  execute on function sec.persist_version(uuid, uuid, uuid, integer, uuid, text, date, bigint, uuid, time, text) to nomey_writer;

-- ===================== 3 · la RLS de una version sin efectos ===============
--
-- EL FALLO QUE ESTO EVITA, y es silencioso. `operation_version_client_select`
-- exige `EXISTS (efecto visible de esa version)`. Una anulacion no tiene
-- ninguno, asi que la operacion SIGUE siendo visible —su policy recorre TODAS
-- las versiones— y su version vigente NO se puede leer. Un cliente que cayera
-- en la version anterior mostraria **el movimiento que el usuario acaba de
-- eliminar**, y nada fallaria.
--
-- La ampliacion es estrictamente acotada: solo alcanza a versiones **sin ningun
-- efecto**, que por construccion no contienen ningun hecho de ambito. No
-- concede ni una fila que la policy anterior protegiera.

-- POR QUE HACE FALTA UN HELPER Y NO UNA SUBCONSULTA. La primera version de esta
-- policy resolvia «la operacion es visible» con un `EXISTS` que unia
-- `core.effect` con `core.operation_version`… **desde dentro de la policy de
-- `core.operation_version`**. Eso es una policy que consulta la tabla que
-- protege, y PostgreSQL lo corta con `42P17: infinite recursion detected in
-- policy`. Lo midio el check de ambito y efecto en cuanto se ejecuto.
--
-- `AGENTS.md` §4 lo nombra como error de diseno y advierte que **relajar la
-- policy para «arreglarlo» es peor que el bug**. La salida correcta ya existe y
-- es la que ADR-007 §2 establecio para `sec.is_member`: un helper
-- `SECURITY DEFINER` **reducido**, que rompe la recursion porque sus lecturas no
-- vuelven a pasar por la RLS.
--
-- Reducido en el mismo sentido: acepta la OPERACION y deriva el actor por
-- dentro. `sec.operation_is_visible(operacion, usuario)` seria un oraculo de
-- pertenencia gratuito para cualquiera que pudiera invocarlo.

drop policy operation_version_client_select on core.operation_version;

create policy operation_version_client_select on core.operation_version
  for select to authenticated
  using (
    exists (
      select 1
      from core.effect e
      where e.operation_version_id = operation_version.id
        and sec.is_member(e.scope_id)
    )
    -- Una ANULACION no tiene efectos, asi que el disyunto de arriba nunca la
    -- alcanza: se ve si se ven los efectos de LA VERSION QUE ANULA.
    --
    -- Las dos referencias son a columnas de la FILA QUE SE ESTA FILTRANDO
    -- —`version_kind` y `supersedes_version_id`—, no consultas a
    -- `core.operation_version`. Esa distincion es todo el asunto: la primera
    -- redaccion resolvia «la operacion es visible» uniendo `core.effect` con
    -- `core.operation_version` DESDE DENTRO de la policy de esa misma tabla, y
    -- PostgreSQL lo corto con `42P17: infinite recursion detected in policy`.
    -- Lo detecto el check de ambito y efecto en cuanto se ejecuto.
    --
    -- `AGENTS.md` §4 lo nombra como error de diseno y advierte que relajar la
    -- policy para «arreglarlo» es peor que el bug. Aqui no se relaja nada: se
    -- usa el dato que la propia fila ya tiene. Y de paso se evita un helper
    -- `SECURITY DEFINER` que habria tenido que leer `core.effect` directamente,
    -- contra la guarda de catalogo de ADR-013 §9.
    --
    -- La anulacion es TERMINAL, asi que su predecesora es siempre una version de
    -- contenido con efectos: la cadena no puede alargarse.
    or (operation_version.version_kind = 'annulment'
        and exists (
          select 1 from core.effect e
          where e.operation_version_id = operation_version.supersedes_version_id
            and sec.is_member(e.scope_id)))
  );

comment on policy operation_version_client_select on core.operation_version is
  'Se ve una version de la que se ve algun efecto; y una version SIN efectos si la operacion es visible, que es el caso de la anulacion (ADR-024).';

-- ============ 3 bis · anular tampoco puede dejar deuda sobreliquidada ======
--
-- `data-model.md` §3 fija que lo liquidado nunca puede superar lo debido, y que
-- ese invariante se comprueba **en distintos momentos**: al liquidar, al
-- corregir y —desde aqui— al anular. Anular el gasto que originaba una deuda
-- borra la deuda y deja las liquidaciones sin nada que respaldar, que es
-- exactamente el mismo pendiente negativo.
--
-- Se mira `sec.net_debt` y no `sec.pending_debt`: la segunda acota a cero con un
-- `greatest`, asi que jamas podria delatar un negativo.
--
-- Reutiliza `SETTLEMENT_EXCEEDS_DEBT` en vez de estrenar codigo: es el mismo
-- invariante, no uno nuevo.

create function sec.assert_annulment_leaves_no_oversettled_debt(p_version uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  r record;
  v_neto bigint;
begin
  for r in
    select distinct e.scope_id, e.debt_debtor_participant_id as deudor,
                    e.debt_creditor_participant_id as acreedor
      from core.current_effect e
     where e.operation_version_id = p_version
       and e.debt_amount is not null
  loop
    v_neto := sec.net_debt(r.scope_id, r.deudor, r.acreedor, p_version);
    if v_neto < 0 then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('anular dejaria la deuda del par con %s pendiente, y lo liquidado no puede superar lo debido', v_neto),
        422);
    end if;
  end loop;
end
$fn$;

comment on function sec.assert_annulment_leaves_no_oversettled_debt(uuid) is
  'Anular no puede dejar ninguna deuda con pendiente negativo. Mismo invariante de data-model.md §3, comprobado al anular (ADR-024).';

revoke execute on function sec.assert_annulment_leaves_no_oversettled_debt(uuid) from public;
grant  execute on function sec.assert_annulment_leaves_no_oversettled_debt(uuid) to nomey_writer;

-- ============================== 4 · la funcion =============================
--
-- UNA SOLA para cualquier clase. No contradice «una funcion publica por clase de
-- operacion» (ADR-009 §1): esa regla existe porque cada clase deriva efectos
-- distintos, y anular no deriva ninguno. Ocho funciones identicas seria ocho
-- sitios donde equivocarse.
--
-- Participa en el protocolo de serializacion con la UNION de los ambitos donde
-- la version anulada dejo saldo y donde dejo deuda: los dos cambian al
-- desaparecer sus efectos.
--
-- Y aplica la MISMA comprobacion de deuda que una correccion: anular un gasto
-- cuya deuda ya tiene liquidaciones dejaria pendiente negativo. Reutiliza
-- `SETTLEMENT_EXCEEDS_DEBT` en vez de estrenar codigo, porque es el mismo
-- invariante comprobado en otro momento. No alcanzable en F6 —no hay Grupos—,
-- y se escribe bien desde el principio porque F9 llega detras.

create function api.annul_operation(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
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
  v_scope uuid;
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

  -- AUTORIZACION: la misma que corregir. `data-model.md` §7 la fija como
  -- membresia ACTUAL del ambito, sin mirar quien creo la operacion ni cuando
  -- entro. Se comprueba sobre cada ambito que la version vigente alcanza.
  foreach v_scope in array sec.normalize_scopes(
      sec.balance_scopes_of_version(v_expected) || sec.debt_scopes_of_version(v_expected))
  loop
    perform sec.assert_member(v_scope, v_actor);
  end loop;

  -- LOCK sobre esos mismos ambitos, antes del CAS y en el orden global.
  v_obs  := sec.normalize_scopes(sec.balance_scopes_of_version(v_expected));
  v_lock := sec.normalize_scopes(v_obs || sec.debt_scopes_of_version(v_expected));
  perform sec.lock_scopes(v_lock);

  select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

  -- Ninguna deuda puede quedar con pendiente negativo al desaparecer la que la
  -- originaba. Mismo invariante que protege la correccion, en otro momento.
  perform sec.assert_annulment_leaves_no_oversettled_debt(v_expected);

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

  return sec.envelope(v_operation, false);
end
$fn$;

grant create on schema api to nomey_writer;
alter function api.annul_operation(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_writer;

revoke execute on function api.annul_operation(jsonb) from public;
grant  execute on function api.annul_operation(jsonb) to authenticated;

comment on function api.annul_operation(jsonb) is
  'Anula una operacion con una version nueva SIN efectos. No borra nada, y la vigencia la sigue decidiendo current_version_id (ADR-024).';

-- Privilegios que la anulacion ejerce y que el writer no tenia por esta via.
grant execute on function sec.net_debt(uuid, uuid, uuid, uuid)          to nomey_writer;
grant execute on function sec.normalize_scopes(uuid[])                  to nomey_writer;
grant execute on function sec.debt_scopes_of_version(uuid)              to nomey_writer;
