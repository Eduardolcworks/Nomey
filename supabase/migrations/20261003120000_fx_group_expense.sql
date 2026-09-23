-- ============================================================================
-- EL GASTO DE GRUPO EN MONEDA EXTRANJERA · F11/ADR-003 · F11.D
-- ============================================================================
--
-- Cierra lo que F11/ADR-001 §4 dejaba abierto: un gasto de grupo admite
-- moneda extranjera «al integrarse Grupos (F9)», y esa integracion es esta.
-- Se apoya entera en las primitivas de F11.B (20260925120000, 20260929120000)
-- y no anade ninguna politica FX nueva.
--
--   §1  core.split_participant: la cuota de cada participante en la base de su
--       Modo Personal, junto a la cuota del grupo
--   §2  sec.resolve_split: se reparte el total CONVERTIDO
--   §3  sec.persist_split: persiste tambien la cuota personal
--   §4  sec.persist_group_conversions: una conversion congelada por ambito
--   §5  api.record_group_expense: convertir, repartir, congelar
--   §6  sec.incorporate_participant_cash: la caja no es el importe declarado
--   §7  las lecturas, con cada cifra en su moneda
--
-- ═══════════════════════ LAS TRES REGLAS QUE LO GOBIERNAN ═══════════════════
--
-- 1 · SE CONVIERTE ANTES DE REPARTIR. El total va del importe original a la
--     base del grupo, una sola vez, y el reparto ocurre despues y en moneda del
--     grupo. Repartir primero y convertir cada cuota daria N redondeos y una
--     suma que no cuadra con el total.
--
-- 2 · CADA CONVERSION SALE DEL IMPORTE ORIGINAL. El grupo y cada Modo Personal
--     alcanzado convierten desde el declarado, nunca desde el total ya
--     convertido de otro ambito: encadenar redondea dos veces.
--
-- 3 · EL GASTO ES ATOMICO. Si el tipo de CUALQUIER ambito alcanzado no se
--     puede resolver —sin cobertura, o todavia sin fijar— se rechaza el gasto
--     entero con el codigo que ya existe, y no queda ni una fila.
--
-- Lo que NO trae: ni liquidaciones, ni pagos declarados, ni transferencias, ni
-- ajustes. Las otras siete clases conservan `sec.assert_no_conversion` intacta;
-- las dos unicas llamadas que se retiran son las de esta funcion.
-- ============================================================================

-- ═════════════ §1 · la cuota personal, junto a la cuota del grupo ═══════════
--
-- La cuota de un participante vive en el ambito del GRUPO, en su moneda base.
-- Cuando la base del Modo Personal de ese participante es otra, sus
-- estadisticas personales no pueden sumar esa cifra: seria mezclar
-- definiciones monetarias (AGENTS.md §1).
--
-- Se persiste aqui, junto al reparto, y NO como un `core.effect` personal: un
-- gasto de grupo sigue siendo una entidad del grupo, y materializarlo como
-- efecto lo contaria dos veces en el Disponible y cambiaria la atribucion de
-- F03/ADR-013.
--
-- Las tres columnas van juntas o no van: una cuota sin moneda no es una cifra.
alter table core.split_participant
  add column personal_scope_id               uuid,
  add column personal_currency_definition_id uuid,
  add column personal_amount                 bigint;

alter table core.split_participant
  -- La moneda de la cuota personal ES la base de ese ambito, con la misma
  -- clave compuesta que sostiene la moneda de `core.effect`. Estructural.
  add constraint split_participant_cuota_personal_en_su_base
    foreign key (personal_scope_id, personal_currency_definition_id)
    references core.scope (id, base_currency_definition_id),
  add constraint split_participant_cuota_personal_completa
    check (num_nonnulls(personal_scope_id, personal_currency_definition_id, personal_amount) in (0, 3)),
  -- Misma regla que el resuelto: magnitud no negativa, y el cero es valido.
  add constraint split_participant_cuota_personal_no_negativa
    check (personal_amount is null or personal_amount >= 0);

comment on column core.split_participant.personal_scope_id is
  'Modo Personal del participante cuando tiene cuenta, resuelto por el vinculo al escribir. Null si no la tenia.';
comment on column core.split_participant.personal_amount is
  'La cuota en la base de ESE Modo Personal (F11/ADR-003). Sin conversion coincide con resolved_amount.';

-- ── EL INVARIANTE LOCAL DE `exact_amounts` DEJA DE SER LOCAL ────────────────
--
-- `split_participant_exactos_coinciden` exigia `resolved_amount =
-- declared_amount`. Su premisa era que «el dominio devuelve los declarados tal
-- cual», y bajo conversion deja de serlo: lo declarado va en la moneda
-- original y lo resuelto en la del grupo, asi que coincidir seria el error.
--
-- No se sustituye por una version debilitada. Se RECLASIFICA, como
-- `20260825213506` ya hizo con la cardinalidad minima del reparto: pasa a ser
-- un invariante de la frontera autoritativa —`sec.resolve_split` devuelve los
-- declarados exactamente cuando no hay conversion, y hay una comprobacion que
-- lo falsifica— porque una fila no puede saber si su version convirtio.
alter table core.split_participant drop constraint split_participant_exactos_coinciden;

-- No se pierde la garantia: se traslada a donde SI puede comprobarse, que es
-- despues de que la version este completa. Es el mismo recurso que
-- 20260923120000 §3 usa para la cobertura: un CONSTRAINT TRIGGER DIFERIDO,
-- que corre al confirmar y puede mirar otras tablas.
--
-- Sin conversion en ese ambito, un reparto exacto sigue teniendo que resolver
-- EXACTAMENTE lo declarado. Con conversion, lo declarado va en otra moneda y
-- compararlos seria el error.
-- SECURITY DEFINER, y por una razon medida: un constraint trigger DIFERIDO
-- corre en el COMMIT, ya FUERA de la funcion `security definer` del writer,
-- con el rol de la sesion. En una peticion real ese rol es `authenticated`,
-- que no tiene USAGE sobre `core`, asi que leer la conversion fallaba con
-- `42501` y el gasto entero se rechazaba con un 403.
--
-- Es una frontera de privilegio minima: lee UNA fila de
-- `core.frozen_conversion` por la clave de la version, no acepta parametros
-- del cliente y no escribe nada. El mismo patron que el resto de definers de
-- `sec`, con su `search_path` fijado.
create function sec.split_exact_matches_without_conversion() returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.split_method = 'exact_amounts'
     and new.resolved_amount is distinct from new.declared_amount
     and not exists (select 1 from core.frozen_conversion fc
                      where fc.operation_version_id = new.operation_version_id
                        and fc.scope_id = new.scope_id) then
    raise exception 'un reparto exacto sin conversion resuelve lo declarado: % frente a %',
      new.resolved_amount, new.declared_amount
      using errcode = '23514';
  end if;
  return null;
end
$fn$;

comment on function sec.split_exact_matches_without_conversion() is
  'Invariante de exact_amounts SIN conversion: resuelto = declarado. Diferido, porque la conversion de la version se escribe despues del reparto (F11/ADR-003).';

create constraint trigger split_participant_exactos_coinciden_sin_conversion
  after insert on core.split_participant
  deferrable initially deferred
  for each row execute function sec.split_exact_matches_without_conversion();

-- ═════════════════ §2 · el reparto es del total CONVERTIDO ══════════════════
--
-- Recibe los DOS totales. `p_total` es el declarado y sigue siendo el que
-- valida `exact_amounts`, en su moneda; `p_target_total` es el que se reparte.
--
-- Sin conversion los dos coinciden y el resultado es identico al de siempre,
-- incluidos los vectores compartidos de `tests/vectors/split.json`.
create function sec.resolve_split(
  p_total        bigint,
  p_target_total bigint,
  p_participants uuid[],
  p_payer        uuid,
  p_method       jsonb
)
returns bigint[]
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_n        integer := coalesce(array_length(p_participants, 1), 0);
  v_kind     text;
  v_payer_ix integer := null;
  v_priority integer[] := '{}';
  v_weights  bigint[] := '{}';
  v_amounts  bigint[];
  v_declared bigint := 0;
  v_i        integer;
begin
  if v_n = 0 then
    perform sec.raise_boundary('SPLIT_NO_PARTICIPANTS',
      'Un reparto necesita al menos un participante', 422);
  end if;

  if (select count(distinct p) from unnest(p_participants) as p) <> v_n then
    perform sec.raise_boundary('SPLIT_DUPLICATE_PARTICIPANT',
      'Un participante no puede figurar dos veces en la misma operacion', 422);
  end if;

  for v_i in 1 .. v_n loop
    if p_participants[v_i] = p_payer then
      v_payer_ix := v_i;
    end if;
  end loop;
  if v_payer_ix is null then
    perform sec.raise_boundary('SPLIT_PAYER_NOT_PARTICIPANT',
      'El pagador debe figurar siempre entre los participantes', 422);
  end if;

  if p_total < 0 or p_target_total < 0 then
    perform sec.raise_boundary('SPLIT_NEGATIVE_TOTAL',
      format('El total de un reparto no puede ser negativo: %s', least(p_total, p_target_total)), 422);
  end if;

  -- Prioridad de desempate: el pagador primero (-1) y despues el orden estable
  -- guardado con la operacion, en base 0 como en el dominio.
  for v_i in 1 .. v_n loop
    v_priority := v_priority || case when v_i = v_payer_ix then -1 else v_i - 1 end;
  end loop;

  v_kind := p_method ->> 'kind';

  if v_kind = 'equal' then
    for v_i in 1 .. v_n loop
      v_weights := v_weights || 1::bigint;
    end loop;
    return sec.allocate_by_largest_remainder(p_target_total, v_weights, v_priority);

  elsif v_kind = 'shares' then
    v_weights := sec.jsonb_amount_array(p_method -> 'weights', 'split_method.weights');
    if coalesce(array_length(v_weights, 1), 0) <> v_n then
      perform sec.raise_boundary('SPLIT_WEIGHTS_LENGTH_MISMATCH',
        format('Hay %s participantes y %s pesos', v_n, coalesce(array_length(v_weights, 1), 0)), 422);
    end if;
    for v_i in 1 .. v_n loop
      if v_weights[v_i] <= 0 then
        perform sec.raise_boundary('SPLIT_SHARE_NOT_POSITIVE',
          format('Los pesos declarados deben ser enteros > 0, recibido: %s', v_weights[v_i]), 422);
      end if;
    end loop;
    return sec.allocate_by_largest_remainder(p_target_total, v_weights, v_priority);

  elsif v_kind = 'exact_amounts' then
    v_amounts := sec.jsonb_amount_array(p_method -> 'amounts', 'split_method.amounts');
    if coalesce(array_length(v_amounts, 1), 0) <> v_n then
      perform sec.raise_boundary('SPLIT_AMOUNTS_LENGTH_MISMATCH',
        format('Hay %s participantes y %s importes', v_n, coalesce(array_length(v_amounts, 1), 0)), 422);
    end if;
    for v_i in 1 .. v_n loop
      -- Participante de una operacion = persona con participacion economica
      -- DECLARADA en ella. Quien declara 0 no participa.
      if v_amounts[v_i] <= 0 then
        perform sec.raise_boundary('SPLIT_EXACT_AMOUNT_NOT_POSITIVE',
          format('Todo participante de un reparto exacto declara un importe > 0, recibido: %s', v_amounts[v_i]), 422);
      end if;
      v_declared := v_declared + v_amounts[v_i];
    end loop;
    -- LA VALIDACION ES EN LA MONEDA DECLARADA, no en la convertida: es la
    -- unica en la que la persona declaro esas cifras. Sin correccion
    -- silenciosa (ADR-002 §5).
    if v_declared <> p_total then
      perform sec.raise_boundary('SPLIT_EXACT_AMOUNTS_MISMATCH',
        format('Los importes declarados suman %s y el total es %s', v_declared, p_total), 422);
    end if;
    -- Y EL REPARTO ES DEL TOTAL OBJETIVO, con los declarados como pesos
    -- (F11/ADR-003). Sin conversion, `p_target_total = p_total` y la suma de
    -- los pesos es ese mismo total, asi que el asignador devuelve los
    -- declarados EXACTAMENTE: el comportamiento de siempre.
    return sec.allocate_by_largest_remainder(p_target_total, v_amounts, v_priority);
  end if;

  perform sec.raise_boundary('PAYLOAD_INVALID',
    'split_method.kind debe ser equal, shares o exact_amounts', 400);
  return null;
end
$fn$;

drop function sec.resolve_split(bigint, uuid[], uuid, jsonb);

comment on function sec.resolve_split(bigint, bigint, uuid[], uuid, jsonb) is
  'Reparto resuelto del total OBJETIVO, con los declarados validados contra el total declarado (F11/ADR-003). Sin conversion, ambos totales coinciden.';

revoke execute on function sec.resolve_split(bigint, bigint, uuid[], uuid, jsonb) from public;
grant  execute on function sec.resolve_split(bigint, bigint, uuid[], uuid, jsonb) to nomey_writer;

-- ═══════════════ §3 · persistir tambien la cuota personal ═══════════════════
create function sec.persist_split(
  p_version      uuid,
  p_scope        uuid,
  p_method       jsonb,
  p_participants uuid[],
  p_payer        uuid,
  p_resolved     bigint[],
  -- F11/ADR-003: la cuota de cada participante en la base de SU Modo Personal,
  -- con el ambito y la moneda a los que pertenece. Null donde no hay cuenta.
  p_personal_scopes  uuid[],
  p_personal_bases   uuid[],
  p_personal_amounts bigint[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_kind    text := p_method ->> 'kind';
  v_weights bigint[];
  v_amounts bigint[];
  v_i       integer;
begin
  insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
  values (p_version, p_scope, v_kind, p_payer);

  if v_kind = 'shares' then
    v_weights := sec.jsonb_amount_array(p_method -> 'weights', 'split_method.weights');
  elsif v_kind = 'exact_amounts' then
    v_amounts := sec.jsonb_amount_array(p_method -> 'amounts', 'split_method.amounts');
  end if;

  for v_i in 1 .. array_length(p_participants, 1) loop
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_weight, declared_amount, resolved_amount,
       personal_scope_id, personal_currency_definition_id, personal_amount)
    values (p_version, p_scope, p_participants[v_i], v_i - 1, v_kind,
            case when v_kind = 'shares'        then v_weights[v_i] end,
            case when v_kind = 'exact_amounts' then v_amounts[v_i] end,
            p_resolved[v_i],
            p_personal_scopes[v_i], p_personal_bases[v_i], p_personal_amounts[v_i]);
  end loop;
end
$fn$;

drop function sec.persist_split(uuid, uuid, jsonb, uuid[], uuid, bigint[]);

revoke execute on function sec.persist_split(uuid, uuid, jsonb, uuid[], uuid, bigint[], uuid[], uuid[], bigint[]) from public;
grant  execute on function sec.persist_split(uuid, uuid, jsonb, uuid[], uuid, bigint[], uuid[], uuid[], bigint[]) to nomey_writer;

-- ═════════ §4 · una conversion congelada por ambito que la requiera ═════════
--
-- Con la infraestructura de F11.B y nada mas: `sec.fx_personal_rate` decide si
-- el tipo se hereda de la version corregida o se resuelve, y
-- `sec.persist_frozen_conversion` escribe la conversion y su procedencia bajo
-- las dos policies de segunda barrera.
--
-- Se llama DESPUES de `persist_version` porque la conversion cuelga de la
-- version. Resolver de nuevo aqui devuelve lo mismo que resolvio el writer:
-- es la misma transaccion, el mismo cerrojo y una funcion `stable`.
--
-- Convertir una moneda a si misma no es una conversion, y no se congela.
create function sec.persist_group_conversions(
  p_version    uuid,
  p_scope      uuid,
  p_date       date,
  p_currency   uuid,
  p_scopes     uuid[],
  p_supersedes uuid
) returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_done  uuid[] := '{}'::uuid[];
  v_i     integer;
  v_scope uuid;
  v_fx    record;
begin
  -- El indice 0 es el ambito del grupo; despues, el Personal de cada
  -- participante que tenga cuenta, sin repetir.
  for v_i in 0 .. coalesce(array_length(p_scopes, 1), 0) loop
    v_scope := case when v_i = 0 then p_scope else p_scopes[v_i] end;
    if v_scope is not null and not (v_scope = any(v_done)) then
      v_done := v_done || v_scope;
      select * into v_fx from sec.fx_personal_rate(
        v_scope, p_currency,
        (select s.base_currency_definition_id from core.scope s where s.id = v_scope),
        p_date, p_supersedes);
      if v_fx.rate_coefficient is not null then
        perform sec.persist_frozen_conversion(
          p_version, v_scope, p_date, p_currency, v_fx.base_currency_definition_id,
          v_fx.rate_coefficient, v_fx.rate_scale, v_fx.source_id,
          v_fx.origin_reference_date, v_fx.origin_publication_id,
          v_fx.target_reference_date, v_fx.target_publication_id);
      end if;
    end if;
  end loop;
end
$fn$;

comment on function sec.persist_group_conversions(uuid, uuid, date, uuid, uuid[], uuid) is
  'Congela la conversion de cada ambito alcanzado por un gasto de grupo, con su procedencia (F11/ADR-001 §4, F11/ADR-003).';

revoke execute on function sec.persist_group_conversions(uuid, uuid, date, uuid, uuid[], uuid) from public;
grant  execute on function sec.persist_group_conversions(uuid, uuid, date, uuid, uuid[], uuid) to nomey_writer;

-- ═══════════════ §5 · convertir, repartir y congelar, en ese orden ══════════
CREATE OR REPLACE FUNCTION api.record_group_expense(payload jsonb)
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
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method',
    'concept','category_id','expected_base_currency_definition_id'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_time time; v_payer uuid;
  v_participants uuid[]; v_method jsonb; v_kind text; v_resolved bigint[];
  v_concept text; v_category uuid;
  v_payer_scope uuid; v_canonical jsonb; v_lock uuid[];
  v_assumed_base uuid; v_fx record; v_total_group bigint;
  v_scopes uuid[] := '{}'::uuid[];          -- Personal de cada participante, o null
  v_totals bigint[] := '{}'::bigint[];      -- total convertido a la base de cada uno
  v_personal bigint[] := '{}'::bigint[];    -- cuota de cada uno en SU base
  v_bases uuid[] := '{}'::uuid[];           -- base de cada Personal alcanzado
  v_seen uuid[] := '{}'::uuid[];            -- ambitos ya congelados
  v_j integer; v_ps uuid; v_cash bigint; v_currency_group uuid;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_i integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_total    := sec.payload_amount(payload, 'total');
  v_date     := sec.payload_date(payload, 'effective_date');
  -- OPCIONAL, a diferencia del personal: un gasto historico sin hora se corrige
  -- conservando su ausencia, y nadie le inventa una (ADR-020 §3).
  v_time     := sec.payload_time(payload, 'effective_time', false);
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_participants := sec.jsonb_uuid_array(payload -> 'participants', 'participants');
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));
  v_category := sec.payload_uuid(payload, 'category_id', true);
  v_assumed_base := sec.payload_uuid(payload, 'expected_base_currency_definition_id', false);

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
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  -- EL REPARTO DEFINITIVO NO SE RESUELVE AQUI (F11/ADR-003): se reparte el
  -- total CONVERTIDO a la base del grupo, y esa conversion exige la base
  -- vigente, que solo se puede leer bajo el cerrojo del ambito.
  --
  -- Pero la VALIDACION DE FORMA si se queda aqui, y con ella el orden de
  -- errores de siempre: sin participantes, duplicados, pagador que no
  -- participa, total negativo y —en un reparto exacto— declarados que no
  -- suman el total. Ninguna depende de ninguna moneda, y moverlas detras de
  -- los cerrojos habria cambiado que responde la frontera a un payload mal
  -- formado. Se resuelve contra el total DECLARADO y el resultado se
  -- descarta; mas abajo se vuelve a repartir sobre el convertido.
  perform sec.resolve_split(v_total, v_total, v_participants, v_payer, v_method);

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'currency_definition_id', v_currency::text,
    'total',                  payload ->> 'total',
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'payer_participant_id',   v_payer::text,
    'participants',           (select coalesce(jsonb_agg(p::text order by ord), '[]'::jsonb)
                                 from unnest(v_participants) with ordinality as u(p, ord)),
    'split_method',           v_method,
    'concept',                v_concept,
    'category_id',            v_category::text);
  -- Como en los writers personales (20260929120000): solo si viene y difiere
  -- de la moneda, para que los comandos ya enviados conserven su forma y su
  -- replay (F11/ADR-001 §10).
  if v_assumed_base is not null and v_assumed_base <> v_currency then
    v_canonical := v_canonical || jsonb_build_object(
      'expected_base_currency_definition_id', v_assumed_base::text);
  end if;

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- EL CERROJO DE IDENTIDAD DEL GRUPO, antes de leer membresia o vinculo y
  -- antes de cualquier fila (protocolo de 20260912150000): el pagador que se
  -- resuelve aqui abajo no puede cambiar hasta el commit.
  perform sec.lock_participant_claims(v_scope);

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  -- SIN LA NEGATIVA DE CONVERSION, ni para el grupo ni para el Personal del
  -- pagador: son las DOS UNICAS llamadas que F11.D retira, y solo de esta
  -- funcion. Las otras seis clases conservan la suya (F11/ADR-001 §4), y el
  -- check lo comprueba enumerandolas.
  perform sec.assert_shared_category_usable(v_category, v_expected);

  foreach v_payer_scope in array v_participants loop
    -- Elegibilidad por fecha (ADR-012 §7, ADR-034 §5), con UNA excepcion: en
    -- una correccion, quien ya constaba en la version que se corrige y en la
    -- MISMA fecha no vuelve a pasar por ella. Su presencia se cerro con el
    -- dia de salida excluido, asi que un gasto de ese dia —valido cuando se
    -- registro— dejaria de poder corregirse hasta en el concepto; lo que
    -- protege su obligacion es ADR-039 (sec.assert_departed_unchanged), mas
    -- abajo. Mover la fecha o nombrar a alguien nuevo sigue exigiendo
    -- elegibilidad.
    if not (v_correction and sec.participant_kept_in_version(v_payer_scope, v_expected, v_date)) then
      perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
    end if;
    -- ADR-034 §6: un ALTA no puede nombrar a un retirado, ni siquiera
    -- retro-fechada dentro de su periodo: crearia deuda sobre un pendiente
    -- que los miembros declararon resuelto. En una correccion se compara
    -- despues, efecto a efecto.
    if not v_correction then
      perform sec.assert_participant_not_retired(v_payer_scope, v_scope);
    end if;
  end loop;
  v_payer_scope := null;

  v_payer_scope := sec.participant_personal_scope(v_payer);

  -- EL CERROJO ALCANZA A TODOS LOS PERSONALES QUE SE VAN A CONVERTIR, no
  -- solo al del pagador: de cada uno se lee su base vigente para resolver su
  -- tipo, y leerla sin cerrojo permitiria que cambiara bajo los pies. El orden
  -- lo sigue imponiendo `sec.lock_scopes`, que ordena ascendentemente.
  --
  -- `v_scopes[i]` es el Personal del participante i, o null si no tiene
  -- cuenta. Se resuelve por el vinculo, nunca por el payload.
  for v_i in 1 .. array_length(v_participants, 1) loop
    v_scopes := v_scopes || sec.participant_personal_scope(v_participants[v_i]);
  end loop;

  v_lock := array[v_scope];
  v_obs := case when v_payer_scope is not null then array[v_payer_scope] else '{}'::uuid[] end;
  for v_i in 1 .. array_length(v_scopes, 1) loop
    if v_scopes[v_i] is not null and not (v_scopes[v_i] = any(v_lock)) then
      v_lock := v_lock || v_scopes[v_i];
    end if;
  end loop;
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

  -- ═══════════════ FX: UNA CONVERSION POR AMBITO, DESDE EL ORIGINAL ══════════
  --
  -- Bajo el cerrojo y despues del CAS. `sec.fx_personal_rate` es la primitiva
  -- de F11.B (20260929120000) y se usa TAL CUAL para cada ambito: lee su base
  -- vigente, hereda el tipo congelado de la version que se corrige cuando la
  -- fecha y la moneda no han cambiado, y si no resuelve con `sec.fx_resolve`
  -- y la fuente por defecto. Un 422 o un 503 salen de aqui y abortan la
  -- transaccion entera, antes de escribir una sola fila.
  --
  -- CADA CONVERSION SALE DEL IMPORTE ORIGINAL (F11/ADR-003). Convertir el
  -- total del grupo hacia un Personal encadenaria dos redondeos.
  select * into v_fx from sec.fx_personal_rate(v_scope, v_currency, v_assumed_base, v_date, v_supersedes);
  v_currency_group := v_fx.base_currency_definition_id;
  v_total_group := case when v_fx.rate_coefficient is null then v_total
                        else sec.fx_convert(v_total, v_currency, v_fx.base_currency_definition_id,
                                            v_fx.rate_coefficient, v_fx.rate_scale) end;

  -- El reparto, sobre el total YA convertido y en moneda del grupo.
  v_resolved := sec.resolve_split(v_total, v_total_group, v_participants, v_payer, v_method);

  -- Y la cuota de cada participante en SU base: el mismo reparto, con los
  -- mismos pesos y el mismo desempate, sobre el total convertido a esa moneda.
  -- Con la base del grupo coincide con `resolved_amount` por construccion.
  for v_i in 1 .. array_length(v_participants, 1) loop
    v_ps := v_scopes[v_i];
    if v_ps is null then
      v_bases := v_bases || null::uuid;
      v_totals := v_totals || null::bigint;
      v_personal := v_personal || null::bigint;
    else
      v_j := array_position(v_scopes[1:v_i - 1], v_ps);
      if v_j is not null then
        -- Dos participantes de la misma cuenta: la conversion ya esta hecha.
        v_bases := v_bases || v_bases[v_j];
        v_totals := v_totals || v_totals[v_j];
      else
        select * into v_fx from sec.fx_personal_rate(
          v_ps, v_currency,
          (select s.base_currency_definition_id from core.scope s where s.id = v_ps),
          v_date, v_supersedes);
        v_bases := v_bases || v_fx.base_currency_definition_id;
        v_totals := v_totals || case when v_fx.rate_coefficient is null then v_total
                                     else sec.fx_convert(v_total, v_currency,
                                            v_fx.base_currency_definition_id,
                                            v_fx.rate_coefficient, v_fx.rate_scale) end;
      end if;
      v_personal := v_personal || (sec.resolve_split(
        v_total, v_totals[v_i], v_participants, v_payer, v_method))[v_i];
    end if;
  end loop;

  if v_correction then
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency,
                              v_time);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved,
                            v_scopes, v_bases, v_personal);
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency_group,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency_group,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  -- LA CAJA DEL PAGADOR es el total en SU base, convertido desde el original
  -- (F11/ADR-001 §4: «hacia cada ambito alcanzado que lo requiera»). No es su
  -- cuota, y no sale del total del grupo.
  if v_payer_scope is not null then
    v_j := array_position(v_scopes, v_payer_scope);
    v_cash := v_totals[v_j];
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_bases[v_j], - v_cash);
  end if;

  -- ═══ LAS CONVERSIONES CONGELADAS, una por ambito que la requiera ═══
  --
  -- Con la infraestructura de F11.B: `sec.persist_frozen_conversion` escribe
  -- la conversion y su procedencia, y las dos policies de segunda barrera
  -- vuelven a resolver el tipo para comprobarlo. Solo donde hubo conversion:
  -- convertir una moneda a si misma no es una conversion.
  perform sec.persist_group_conversions(
    v_version, v_scope, v_date, v_currency, v_scopes, v_supersedes);

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ADR-034 §6: corregir un gasto de un retirado es posible solo si NINGUN
  -- efecto de deuda que lo nombre cambia. Se compara con los efectos ya
  -- escritos, y un rechazo aqui revierte la version entera.
  if v_correction then
    perform sec.assert_retired_debt_unchanged(v_version, v_expected);
  end if;
  -- ADR-039: lo que la version atribuye a quien SALIO —deuda por par y
  -- direccion, cuota, caja— es intocable. En un alta la referencia es vacia:
  -- nombrar a un salido, aunque la fecha caiga en su antigua presencia, se
  -- rehusa. Despues de escribir, como la de retirados: un rechazo revierte
  -- la version entera.
  perform sec.assert_departed_unchanged(v_version, v_expected);

  -- ═══ Y SOLO SI FUE UNA CORRECCION, el aviso interno ═══
  --
  -- Aqui, y no antes: la version ya esta escrita y sus efectos asentados, asi
  -- que ninguna notificacion puede sobrevivir a un rechazo posterior. Un alta no
  -- notifica nada — no es una edicion de nada.
  if v_correction then
    perform sec.notify_group_edit(v_scope, v_operation, v_version, v_actor);
  end if;

  return sec.envelope(v_operation, false);
end
$function$;

-- ═══════════════ §6 · la caja incorporada no es el declarado ════════════════
create or replace function sec.incorporate_participant_cash(p_scope uuid, p_source uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := sec.request_actor_id();
  v_personal uuid;
  v_currency uuid;
  v_group_currency uuid;
  v_n        integer := 0;
  r          record;
begin
  select s.id, s.base_currency_definition_id into v_personal, v_currency
    from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
  if v_personal is null then
    perform sec.raise_boundary('PERSONAL_SCOPE_MISSING', 'la cuenta no tiene Modo Personal', 409);
  end if;
  select s.base_currency_definition_id into v_group_currency from core.scope s where s.id = p_scope;
  if v_group_currency <> v_currency then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la caja del grupo esta en otra moneda que tu Personal: la conversion no esta soportada', 422);
  end if;

  perform sec.lock_scopes(array[p_scope, v_personal]);

  for r in
    with vigentes as (
      select distinct ov.id as version_id, ov.effective_date, ov.version_no, ov.original_amount
        from core.operation o
        join core.operation_version ov on ov.id = o.current_version_id
        join core.effect e on e.operation_version_id = ov.id and e.scope_id = p_scope
       where ov.version_kind = 'record'),
    hechos as (
      -- LA CAJA DE UN GASTO NO ES SU IMPORTE DECLARADO (F11/ADR-003). Desde
      -- F11.D ese importe puede estar en otra moneda, y la caja que
      -- corresponde a este ambito es el total EN LA MONEDA DEL GRUPO, que es
      -- exactamente la suma del reparto ya resuelto y persistido. Sin
      -- conversion las dos cifras coinciden, asi que nada cambia para lo ya
      -- escrito. No se resuelve ningun tipo aqui: se lee lo persistido.
      --
      -- La guarda de mas arriba sigue exigiendo que la base del grupo sea la
      -- del Personal, asi que esta cifra ya esta en la moneda correcta.
      select v.version_id, v.effective_date, v.version_no,
             - (select sum(spp.resolved_amount) from core.split_participant spp
                 where spp.operation_version_id = v.version_id and spp.scope_id = p_scope) as amount,
             'expense'::text as accounting_class
        from vigentes v
        join core.split sp on sp.operation_version_id = v.version_id and sp.scope_id = p_scope
       where sp.payer_participant_id = p_source
      union all
      select v.version_id, v.effective_date, v.version_no,
             case when pd.payer_participant_id = p_source then - v.original_amount else v.original_amount end,
             'transfer'
        from vigentes v
        join core.payment_detail pd on pd.operation_version_id = v.version_id and pd.scope_id = p_scope
       where p_source in (pd.payer_participant_id, pd.receiver_participant_id))
    select h.* from hechos h
     where not exists (select 1 from core.effect x
                        where x.operation_version_id = h.version_id and x.scope_id = v_personal
                          and x.balance_amount = h.amount and x.accounting_class = h.accounting_class)
     order by h.effective_date, h.version_id
  loop
    if exists (select 1 from core.balance_observation bo where bo.operation_version_id = r.version_id and bo.scope_id = v_personal) then
      -- La version ya movio este Personal (un pago entre mis dos identidades):
      -- se completa el otro lado; la observacion de esa version ya existe.
      insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
      values (gen_random_uuid(), r.version_id, v_personal, r.accounting_class, v_currency, r.amount);
    else
      declare v_before bigint[];
      begin
        v_before := sec.balances_before(array[v_personal]);
        insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
        values (gen_random_uuid(), r.version_id, v_personal, r.accounting_class, v_currency, r.amount);
        perform sec.observe_balances(r.version_id, array[v_personal], v_before);
      end;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$fn$;

-- ═══════════════════ §7 · cada cifra, con su moneda ═════════════════════════
create or replace view api.group_operation with (security_invoker = true) as
select o.id as operation_id,
       ov.id as version_id,
       e.scope_id,
       e.currency_definition_id,
       ov.original_amount::text as total_amount,
       ov.original_amount as total_order,
       ov.effective_date,
       md.concept,
       ec.category_id,
       sp.payer_participant_id,
       sp.split_method,
       (select sum(ee.economic_amount)::text
          from core.current_effect ee
         where ee.operation_version_id = ov.id and ee.economic_amount is not null
           and ee.economic_participant_id is not null and sec.is_my_participant(ee.economic_participant_id)) as your_share,
       ov.supersedes_version_id as previous_version_id,
       (select prev.original_amount::text from core.operation_version prev where prev.id = ov.supersedes_version_id) as previous_amount,
       ov.version_no,
       o.created_at as operation_created_at,
       ov.effective_time,
       -- F11/ADR-003: `total_amount` es el importe DECLARADO y puede no ir en
       -- la moneda del efecto. Se publica su moneda para que nadie lo etiquete
       -- con la del grupo. Va la ultima porque `create or replace view` solo
       -- admite anadir al final.
       ov.original_currency_definition_id
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  join core.split sp on sp.operation_version_id = ov.id and sp.scope_id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category ec on ec.operation_version_id = ov.id
 where s.kind = 'group' and o.operation_class = 'group_expense' and ov.version_kind = 'record'
 group by o.id, ov.id, e.scope_id, e.currency_definition_id, ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, ec.category_id, sp.payer_participant_id, sp.split_method, ov.supersedes_version_id, ov.version_no, o.created_at,
          ov.original_currency_definition_id;

comment on view api.group_operation is
  'El gasto de grupo vigente. `total_amount` va en `original_currency_definition_id`; `your_share` y los efectos, en la base del grupo (F11/ADR-003).';

-- La cuota que suman las estadisticas personales pasa a ser la PERSONAL.
--
-- Hasta aqui devolvia el efecto economico del ambito del GRUPO, en la moneda
-- del grupo, y `api.personal_statistics` lo sumaba a un total expresado en la
-- base del Personal. Era el defecto que F9 introdujo, que F11.C identifico y
-- que cierra este bloque.
--
-- Tres casos, y el tercero es el unico que cambia de resultado:
--
--   · la fila tiene cuota personal persistida -> esa, en la base del Personal;
--   · no la tiene y las dos bases coinciden   -> el efecto, que ya esta en esa
--     misma moneda. Es el caso de todo lo escrito antes de F11.D y el de un
--     fantasma asociado despues, cuyo reparto se escribio sin cuenta;
--   · no la tiene y las bases difieren        -> NO SALE. Convertirla exigiria
--     resolver un tipo al leer, que F11.C prohibe, e inventar uno seria peor
--     que omitirla.
create or replace function sec.my_shared_expense_shares(p_from date default null, p_to date default null)
returns table (operation_id uuid, effective_date date, category_id uuid, amount bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id,
         ov.effective_date,
         xc.category_id,
         case when sp.personal_amount is not null then sp.personal_amount
              when s.base_currency_definition_id = mine.base_currency_definition_id
                then sp.resolved_amount end
    from core.scope mine
    -- UNA FILA POR PARTICIPANTE, que es lo que el reparto ya garantiza. Mirarlo
    -- desde el efecto duplicaba cuando dos participaciones mias —la propia y la
    -- de un fantasma que asocie despues— caen en el mismo gasto: la proyeccion
    -- canonica resuelve las dos a la misma identidad.
    --
    -- La identidad se resuelve por el VINCULO, no por
    -- `sec.participant_personal_scope`: esa funcion exige tomar antes el
    -- cerrojo de identidad del grupo (guarda de F9, 20260912150000), y una
    -- lectura no puede ni debe tomarlo. `sec.canonical_participant` resuelve
    -- la fusion, asi que un fantasma asociado sigue encontrando su cuota.
    join core.split_participant sp on true
    join core.participant_user_link l
      on l.participant_id = sec.canonical_participant(sp.participant_id)
     and l.user_id = (select auth.uid())
    join core.scope s on s.id = sp.scope_id and s.kind = 'group'
    join core.operation_version ov on ov.id = sp.operation_version_id
    join core.operation o on o.current_version_id = ov.id
    left join core.expense_category xc on xc.operation_version_id = ov.id
   where mine.kind = 'personal' and mine.owner_user_id = (select auth.uid())
     and o.operation_class = 'group_expense'
     and ov.version_kind = 'record'
     and (p_from is null or ov.effective_date >= p_from)
     and (p_to   is null or ov.effective_date <= p_to)
     and (sp.personal_amount is not null
          or s.base_currency_definition_id = mine.base_currency_definition_id)
     and sec.counts_in_personal(mine.id, ov.operation_id);
$fn$;

comment on function sec.my_shared_expense_shares(date, date) is
  'La cuota economica del actor en gastos compartidos, EN LA BASE DE SU MODO PERSONAL (F11/ADR-003). Una cuota que no se puede expresar en esa moneda no sale.';

-- La fila de esa cuota, con las tres cifras y sus tres monedas. Se recrea
-- entera porque cambia su tipo de retorno.
drop function api.personal_expense_share(date, date);
drop function sec.my_shared_expense_share_row(date, date);

create function sec.my_shared_expense_share_row(p_from date default null, p_to date default null)
returns table (
  operation_id           uuid,
  current_version_id     uuid,
  scope_id               uuid,
  group_display_name     text,
  group_emoji            text,
  concept                text,
  category_id            uuid,
  effective_date         date,
  effective_time         time,
  payer_display_name     text,
  total_amount           text,
  share_amount           text,
  currency_definition_id uuid,
  currency_code          text,
  currency_scale         integer,
  operation_created_at   timestamptz,
  -- F11/ADR-003. `total_amount` va en la moneda DECLARADA, que puede no ser
  -- la del grupo; `share_amount` en la del grupo; y la cuota personal en la
  -- base del Personal del actor, que es la que suman sus estadisticas.
  original_currency_definition_id uuid,
  personal_amount                 text,
  personal_currency_definition_id uuid
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select sh.operation_id,
         o.current_version_id,
         sp.scope_id,
         gp.display_name,
         gp.emoji,
         md.concept,
         sh.category_id,
         sh.effective_date,
         ov.effective_time,
         py.display_name,
         ov.original_amount::text,
         -- LA CUOTA EN MONEDA DEL GRUPO sale del reparto persistido. Para las
         -- filas anteriores a F11.D no hay columna, y entonces `sh.amount` ya
         -- esta en la moneda del grupo porque coincide con la del Personal:
         -- es la unica condicion en la que esas filas entran.
         coalesce(spp.resolved_amount, sh.amount)::text,
         s.base_currency_definition_id,
         cd.code,
         cd.scale,
         o.created_at,
         ov.original_currency_definition_id,
         sh.amount::text,
         mine.base_currency_definition_id
    from sec.my_shared_expense_shares(p_from, p_to) sh
    join core.operation o on o.id = sh.operation_id
    join core.operation_version ov on ov.id = o.current_version_id
    join core.split sp on sp.operation_version_id = ov.id
    join core.scope s on s.id = sp.scope_id
    join core.currency_definition cd on cd.id = s.base_currency_definition_id
    left join core.group_profile gp on gp.scope_id = s.id
    left join core.movement_detail md on md.operation_version_id = ov.id
    left join core.participant py on py.id = sp.payer_participant_id
    left join core.scope mine
      on mine.kind = 'personal' and mine.owner_user_id = (select auth.uid())
    left join core.split_participant spp
      on spp.operation_version_id = ov.id and spp.scope_id = sp.scope_id
     and spp.personal_scope_id = mine.id;
$fn$;

revoke execute on function sec.my_shared_expense_share_row(date, date) from public;
grant  execute on function sec.my_shared_expense_share_row(date, date) to authenticated;

comment on function sec.my_shared_expense_share_row(date, date) is
  'Las cuotas del actor en gastos compartidos, con contexto. `total_amount` en la moneda declarada, `share_amount` en la del grupo y `personal_amount` en la base de su Personal.';

create function api.personal_expense_share(p_from date default null, p_to date default null)
returns table (
  operation_id           uuid,
  current_version_id     uuid,
  scope_id               uuid,
  group_display_name     text,
  group_emoji            text,
  concept                text,
  category_id            uuid,
  effective_date         date,
  effective_time         time,
  payer_display_name     text,
  total_amount           text,
  share_amount           text,
  currency_definition_id uuid,
  currency_code          text,
  currency_scale         integer,
  operation_created_at   timestamptz,
  original_currency_definition_id uuid,
  personal_amount                 text,
  personal_currency_definition_id uuid
)
language sql
stable
set search_path = ''
-- `begin atomic`: el cuerpo se resuelve al crearse, como `personal_statistics`,
-- y por eso puede delegar en `sec` sin que `authenticated` tenga USAGE alli.
begin atomic
  select * from sec.my_shared_expense_share_row(p_from, p_to);
end;

revoke execute on function api.personal_expense_share(date, date) from public;
grant  execute on function api.personal_expense_share(date, date) to authenticated;

comment on function api.personal_expense_share(date, date) is
  'Las cuotas del actor en gastos compartidos, con contexto, para el desglose '
  'de Gastos de Personal. Mismo intervalo y mismas filas que personal_statistics.';
