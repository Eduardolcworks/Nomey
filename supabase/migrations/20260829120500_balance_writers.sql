-- Serializacion y observacion de la dimension SALDO · F6.C, segunda parte.
--
-- Decimocuarta migracion real. Reescribe las OCHO funciones autoritativas:
--
--   · las SIETE que producen efecto de saldo entran en el protocolo de
--     serializacion y escriben su observacion historica;
--   · `record_debt_settlement` no produce saldo, asi que no observa nada y solo
--     cambia por el renombrado del helper de bloqueo.
--
-- Y `api.record_adjustment` gana ademas el SALDO OBJETIVO y la hora efectiva.
--
-- ============ POR QUE PARTICIPAN LAS SIETE Y NO SOLO EL AJUSTE =============
--
-- E22 lo midio, y el resultado es el que decide el alcance:
--
--   R1  dos objetivos calculados en el cliente dejan el saldo en 80,00 cuando
--       los dos pidieron 100,00. NINGUN orden serial produce eso.
--
--   R2  dos gastos simultaneos observando su propio resultado: al menos una
--       observacion es FALSA, porque en READ COMMITTED ninguna transaccion ve
--       los efectos no confirmados de la otra.
--
-- R2 es el que amplia el alcance. Un gasto o un ingreso escriben un DELTA
-- CIEGO: no leen el saldo, asi que por si solos nunca producen un resultado no
-- serializable. Es LA OBSERVACION la que convierte toda escritura de saldo en
-- una lectura, y por tanto la que obliga a que participen las siete.
--
-- Con solo el ajuste bloqueando, R2 sigue ocurriendo. Es exactamente la
-- «serializacion parcial» que ADR-013 §11 declara equivalente a no serializar
-- nada: «quien altera el consumible participa igual que quien lo consume».
--
-- UN UNICO ORDEN GLOBAL ASCENDENTE para las dos dimensiones, y una sola llamada
-- por funcion sobre la UNION de los ambitos de la intencion nueva y los de la
-- version sustituida. Dos ordenes distintos es como se construye un deadlock.
--
-- Los ambitos se bloquean ANTES del CAS, igual que ya hacia el protocolo de
-- deuda, usando `expected_version_id` del payload —que es la version sustituida
-- si el CAS prospera, y si no prospera la transaccion aborta igual—.

-- ========================= 1 · el ajuste, con objetivo =====================
--
-- `delta` O `target_balance`, EXACTAMENTE UNO. No se crea una segunda funcion
-- publica: ADR-009 §1 fija una por CLASE DE OPERACION, y la forma del comando
-- no es una clase nueva.
--
-- QUE DECLARA CADA COSA:
--
--   target_balance  INTENCION. El saldo que la persona declara tener AL
--                   RECONCILIAR. Va a `core.adjustment_detail` y a la intencion
--                   canonica.
--   delta           DERIVADO cuando hay objetivo. Es `original_amount` de la
--                   version y el importe del efecto, igual que en el ajuste por
--                   delta: esa columna conserva UN SOLO significado.
--
-- LO QUE `target_balance` NO SIGNIFICA, y conviene que no se reinterprete: no
-- es «el saldo que tenia en un instante historico elegido». F6.C no reconstruye
-- saldos `as-of`, no recalcula un ajuste ya escrito cuando despues aparece un
-- movimiento con fecha anterior, y no reabre nada. La hora efectiva representa
-- el momento declarado de la reconciliacion y NO convierte el objetivo en un
-- saldo historico que haya que reconstruir.
--
-- La intencion canonica lleva el OBJETIVO, nunca el delta derivado: el delta
-- depende del estado y no es intencion. Dos reintentos con el mismo objetivo son
-- replay; con objetivos distintos, conflicto.
--
-- HORA EFECTIVA, ahora obligatoria —contrato 2—. F6.B dejo la decision aqui, y
-- son tres razones: un ajuste por objetivo es POR NATURALEZA una observacion en
-- un instante —«ahora mismo tengo 100»—; F6.D necesita UN orden en una lista
-- mixta, y con el ajuste sin hora habria dos reglas; y `created_at` no puede
-- fingir ser la hora efectiva, porque ajustar hoy un saldo de ayer los separa.
--
-- SIN concepto ni categoria, como decidio F6.B: su linea de historial la deriva
-- el producto —«Saldo ajustado a X»— y el objetivo persistido es exactamente lo
-- que la rellena.

create or replace function api.record_adjustment(payload jsonb)
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
    'scope_id','delta','target_balance','currency_definition_id'];
  v_scope uuid; v_currency uuid; v_delta bigint; v_date date; v_time time;
  v_target bigint; v_por_objetivo boolean;
  v_sin_sustituida bigint;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_date     := sec.payload_date(payload, 'effective_date');
  v_time     := sec.payload_time(payload, 'effective_time', true);

  -- Exactamente uno de los dos. Ni ninguno —no habria intencion— ni los dos,
  -- que serian dos intenciones distintas en el mismo comando.
  v_por_objetivo := payload ? 'target_balance';
  if v_por_objetivo = (payload ? 'delta') then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un ajuste declara delta O target_balance, exactamente uno', 400);
  end if;

  if v_por_objetivo then
    v_target := sec.payload_amount(payload, 'target_balance');
  else
    v_delta := sec.payload_amount(payload, 'delta');
  end if;

  -- El IMPORTE ENTRA TAL COMO LLEGO (ADR-011 §8). El delta derivado NO entra:
  -- depende del estado y no es intencion declarada.
  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'delta',                  payload ->> 'delta',
    'target_balance',         payload ->> 'target_balance',
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text,
    'effective_time',         v_time::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'adjustment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  -- LOCK de la dimension SALDO, antes del CAS y antes de leer nada.
  v_obs := array[v_scope];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  -- EL DELTA SE DERIVA AQUI, y no antes: bajo lock y con el CAS ya resuelto.
  --
  -- Al CORREGIR hay que excluir la version que se sustituye, y la exclusion no
  -- necesita ninguna estructura nueva: el puntero de vigencia TODAVIA NO SE HA
  -- MOVIDO, asi que la version sustituida es la vigente y sus efectos estan
  -- dentro de `core.current_effect`. Basta descontarla por identificador sobre
  -- la propia proyeccion canonica.
  if v_por_objetivo then
    v_sin_sustituida := sec.derive_balance(v_scope, v_supersedes);
    v_delta := v_target - v_sin_sustituida;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'adjustment', v_date, v_delta, v_currency,
                              v_time);

  if v_por_objetivo then
    insert into core.adjustment_detail (operation_version_id, target_balance)
    values (v_version, v_target);
  end if;

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_version, v_scope, 'adjustment', v_currency, v_delta);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$fn$;

comment on function api.record_adjustment(jsonb) is
  'Ajuste de saldo por DELTA o por SALDO OBJETIVO, exactamente uno. Con objetivo, el delta lo deriva el servidor bajo lock (ADR-022).';

-- ============== 2 · las otras siete, con lock y observacion ================
--
-- Reescritas desde su definicion VIGENTE EN EL CATALOGO, con tres cambios
-- mecanicos y ninguno de semantica economica:
--
--   1. `sec.lock_debt_scopes` pasa a `sec.lock_scopes`;
--   2. el conjunto a bloquear gana los ambitos con dimension de SALDO, de la
--      intencion nueva y de la version sustituida;
--   3. dos llamadas de observacion, una antes de escribir y otra despues.
--
-- `record_settlement_by_transfer` traia un comentario que decia que los dos
-- Modos Personales no entraban en el protocolo «porque el saldo no es deuda».
-- Era cierto cuando el protocolo solo cubria la deuda; desde F6.C hay dos
-- dimensiones y esos dos ambitos SI participan, por la de saldo.

create or replace function api.record_debt_settlement(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','amount',
    'debtor_participant_id','creditor_participant_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_debtor uuid; v_creditor uuid;
  v_canonical jsonb; v_lock uuid[]; v_pending bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope     := sec.payload_uuid(payload, 'scope_id', true);
  v_currency  := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount    := sec.payload_amount(payload, 'amount');
  v_date      := sec.payload_date(payload, 'effective_date');
  v_debtor    := sec.payload_uuid(payload, 'debtor_participant_id', true);
  v_creditor  := sec.payload_uuid(payload, 'creditor_participant_id', true);

  if v_amount <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      format('Una liquidacion salda un importe positivo, recibido: %s', v_amount), 422);
  end if;
  if v_debtor = v_creditor then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE',
      'Una deuda no puede tener el mismo deudor y acreedor', 422);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',            (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',                v_scope::text,
    'currency_definition_id',  v_currency::text,
    'amount',                  payload ->> 'amount',
    'effective_date',          v_date::text,
    'debtor_participant_id',   v_debtor::text,
    'creditor_participant_id', v_creditor::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'debt_settlement', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- `data-model.md` §8 marca «marcar deuda saldada» como inmediata y no la
  -- restringe a las partes: es una AFIRMACION SOBRE UNA OBLIGACION YA
  -- DETERMINADA, y quien la hace responde por atribucion, historial,
  -- notificacion y correccion. La autorizacion es la membresia del ambito.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_participant_eligible(v_debtor,   v_scope, v_date);
  perform sec.assert_participant_eligible(v_creditor, v_scope, v_date);

  -- 6 · LOCK, y 8 · leer la deuda DESPUES. Invertirlos reintroduce la carrera
  -- que E15 midio: dos liquidaciones de 2000 sobre una deuda de 3000 pasan las
  -- dos y dejan un pendiente de -1000.
  v_lock := array[v_scope];
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  -- La version que se supersede se excluye: corregir una liquidacion de 3000 a
  -- 4000 no puede validarse contra una deuda que todavia incluye esos 3000.
  v_pending := sec.pending_debt(v_scope, v_debtor, v_creditor,
                                case when v_correction then v_expected end);

  -- Una liquidacion nunca supera el pendiente. De ahi salen los tres rechazos
  -- de `data-model.md` §3: sobrepago, liquidar sin deuda, y liquidar en la
  -- direccion contraria —donde el neteo del par devuelve cero—.
  if v_amount > v_pending then
    perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
      format('Se intenta liquidar %s sobre una deuda pendiente de %s', v_amount, v_pending), 422);
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'debt_settlement', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
          - v_amount, v_debtor, v_creditor);

  return sec.envelope(v_operation, false);
end
$function$

;
create or replace function api.record_external_transfer(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
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
    'delta',                  payload ->> 'delta',
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'external_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  -- LOCK de la dimension SALDO (ADR-013 §11, extendido en F6.C). Antes del
  -- CAS y antes de leer nada, y en el MISMO orden global ascendente que la
  -- deuda: un segundo orden seria como se construye un deadlock.
  v_obs := array[v_scope];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'external_transfer', v_date, v_delta, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_version, v_scope, 'transfer', v_currency, v_delta);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$

;
create or replace function api.record_group_expense(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_payer uuid;
  v_participants uuid[]; v_method jsonb; v_kind text; v_resolved bigint[];
  v_payer_scope uuid; v_canonical jsonb; v_lock uuid[];
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_i integer;
begin
  -- 1 · forma
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_total    := sec.payload_amount(payload, 'total');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_participants := sec.jsonb_uuid_array(payload -> 'participants', 'participants');

  v_method := payload -> 'split_method';
  if v_method is null or jsonb_typeof(v_method) <> 'object' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method debe ser un objeto JSON', 400);
  end if;
  v_kind := v_method ->> 'kind';
  if v_kind is null or not (v_kind = any(array['equal','shares','exact_amounts'])) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method.kind debe ser equal, shares o exact_amounts', 400);
  end if;
  -- Vocabulario cerrado tambien en las CLAVES: `equal` no declara nada, y
  -- aceptar `weights` junto a `exact_amounts` dejaria creer que se tuvo en
  -- cuenta. Mismo criterio que `created_by` en `sec.assert_payload_shape`.
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  -- El cliente NO envia ordinales ni efectos: el orden estable es el de la
  -- lista y el ordinal lo asigna el servidor (ADR-002 §7, ADR-013 §5).
  v_resolved := sec.resolve_split(v_total, v_participants, v_payer, v_method);

  -- Canonicalizacion: SOLO el servidor (ADR-011 §8). Los valores exactos entran
  -- VERBATIM —«00100» no es «100»— y las identidades y la fecha materializan su
  -- representacion canonica. El orden de `participants` se conserva porque ES
  -- intencion: es el desempate del paso 5 de ADR-002 §5.
  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'currency_definition_id', v_currency::text,
    'total',                  payload ->> 'total',
    'effective_date',         v_date::text,
    'payer_participant_id',   v_payer::text,
    'participants',           (select coalesce(jsonb_agg(p::text order by ord), '[]'::jsonb)
                                 from unnest(v_participants) with ordinality as u(p, ord)),
    'split_method',           v_method);

  -- 2, 3 y 4 · actor, reclamo y replay o conflicto, SIEMPRE antes del CAS.
  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- 5 · autorizacion actual. Un gasto de Grupo lo registra CUALQUIER INTEGRANTE
  -- —`data-model.md` §8 lo marca «inmediata»— y la autoria original no concede
  -- exclusividad sobre la correccion (`data-model.md` §7). Por eso aqui no se
  -- mira `created_by` de la operacion: se mira la membresia actual del ambito.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  -- Elegibilidad de cada participante en la FECHA EFECTIVA (ADR-012 §7).
  foreach v_payer_scope in array v_participants loop
    perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
  end loop;
  v_payer_scope := null;

  -- El extremo de caja: derivado, opcional, y en la moneda base de su ambito.
  v_payer_scope := sec.participant_personal_scope(v_payer);
  if v_payer_scope is not null then
    perform sec.assert_no_conversion(v_payer_scope, v_currency);
  end if;

  -- 6 · LOCK de los ambitos cuya deuda puede cambiar (ADR-013 §11).
  v_lock := array[v_scope];
  v_obs := case when v_payer_scope is not null then array[v_payer_scope] else '{}'::uuid[] end;
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  v_lock := v_lock || v_obs;
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  -- 7 · lock de la operacion y CAS.
  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

    -- 8 y 9 · leer la deuda autoritativa DESPUES de los locks, y validar. Un
    -- alta no necesita esta comprobacion: solo suma deuda. Una correccion puede
    -- restarla por debajo de lo ya liquidado, y eso viola el mismo invariante
    -- que `record_debt_settlement` protege al liquidar.
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved);

  -- Gasto economico de cada participante, sin cambio de saldo. LOS CEROS SE
  -- CONSERVAN: una participacion calculada en cero por indivisibilidad sigue
  -- siendo una participacion (ADR-013 §8).
  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  -- Derechos del pagador frente al resto. Una participacion calculada en cero NO
  -- genera deuda: no hay obligacion que registrar, y ADR-013 §8 prohibe
  -- inventar deuda de cero donde el dominio la omite.
  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  -- El movimiento de caja: UNO SOLO y por el total (invariante 4). No se
  -- descompone en gasto mas transferencia. Si el pagador no tiene Modo Personal
  -- no hay extremo interno que registrar, igual que en una transferencia
  -- externa (`data-model.md` §4.7).
  if v_payer_scope is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_currency, - v_total);
  end if;

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$

;
create or replace function api.record_internal_transfer(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
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
    'amount',                 payload ->> 'amount',
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

  -- LOCK de la dimension SALDO (ADR-013 §11, extendido en F6.C). Antes del
  -- CAS y antes de leer nada, y en el MISMO orden global ascendente que la
  -- deuda: un segundo orden seria como se construye un deadlock.
  v_obs := array[v_from, v_to];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'internal_transfer', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_currency,   v_amount);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$

;
create or replace function api.record_personal_expense(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
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

  -- LOCK de la dimension SALDO (ADR-013 §11, extendido en F6.C). Antes del
  -- CAS y antes de leer nada, y en el MISMO orden global ascendente que la
  -- deuda: un segundo orden seria como se construye un deadlock.
  v_obs := array[v_scope];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.assert_category_usable(v_category, 'expense', v_actor, v_supersedes);

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_expense', v_date, v_amount, v_currency,
                              v_time);
  perform sec.persist_movement_detail(v_version, v_concept, v_category, 'expense');

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
          - v_amount, v_amount, null);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$

;
create or replace function api.record_personal_income(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
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

  -- LOCK de la dimension SALDO (ADR-013 §11, extendido en F6.C). Antes del
  -- CAS y antes de leer nada, y en el MISMO orden global ascendente que la
  -- deuda: un segundo orden seria como se construye un deadlock.
  v_obs := array[v_scope];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.assert_category_usable(v_category, 'income', v_actor, v_supersedes);

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_income', v_date, v_amount, v_currency,
                              v_time);
  perform sec.persist_movement_detail(v_version, v_concept, v_category, 'income');

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'income', v_currency,
          v_amount, v_amount, null);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$

;
create or replace function api.record_settlement_by_transfer(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'debt_scope_id','currency_definition_id','amount',
    'debtor_participant_id','creditor_participant_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_debtor uuid; v_creditor uuid; v_from uuid; v_to uuid; v_owner uuid;
  v_canonical jsonb; v_lock uuid[]; v_pending bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'debt_scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_debtor   := sec.payload_uuid(payload, 'debtor_participant_id', true);
  v_creditor := sec.payload_uuid(payload, 'creditor_participant_id', true);

  if v_amount <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      format('Una liquidacion salda un importe positivo, recibido: %s', v_amount), 422);
  end if;
  if v_debtor = v_creditor then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE',
      'Una deuda no puede tener el mismo deudor y acreedor', 422);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',            (sec.payload_uuid(payload,'operation_id',false))::text,
    'debt_scope_id',           v_scope::text,
    'currency_definition_id',  v_currency::text,
    'amount',                  payload ->> 'amount',
    'effective_date',          v_date::text,
    'debtor_participant_id',   v_debtor::text,
    'creditor_participant_id', v_creditor::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'settlement_by_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);

  v_from := sec.participant_personal_scope(v_debtor);
  if v_from is null then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo el deudor origina el pago de su deuda mediante transferencia', 403);
  end if;
  select s.owner_user_id into v_owner from core.scope s where s.id = v_from;
  if v_owner is distinct from v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo el deudor origina el pago de su deuda mediante transferencia', 403);
  end if;

  v_to := sec.participant_personal_scope(v_creditor);
  if v_to is null then
    perform sec.raise_boundary('CREDITOR_WITHOUT_PERSONAL_SCOPE',
      'el acreedor no tiene Modo Personal: ese pago es una transferencia externa mas una liquidacion, y son dos operaciones', 422);
  end if;
  if v_from = v_to then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'origen y destino no pueden ser el mismo ambito', 400);
  end if;

  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_no_conversion(v_from,  v_currency);
  perform sec.assert_no_conversion(v_to,    v_currency);
  perform sec.assert_participant_eligible(v_debtor,   v_scope, v_date);
  perform sec.assert_participant_eligible(v_creditor, v_scope, v_date);

  -- Solo el ambito de la DEUDA entra en el protocolo: los dos Modos Personales
  -- reciben saldo, y el saldo no es deuda. ADR-013 §11 decide la pertenencia
  -- «por que efectos produce», y ninguno de esos dos efectos toca la dimension
  -- de deuda.
  v_lock := array[v_scope];
  v_obs := array[v_from, v_to];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  v_lock := v_lock || v_obs;
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_pending := sec.pending_debt(v_scope, v_debtor, v_creditor,
                                case when v_correction then v_expected end);
  if v_amount > v_pending then
    perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
      format('Se intenta liquidar %s sobre una deuda pendiente de %s', v_amount, v_pending), 422);
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'settlement_by_transfer', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_currency,   v_amount);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
          - v_amount, v_debtor, v_creditor);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$


;
