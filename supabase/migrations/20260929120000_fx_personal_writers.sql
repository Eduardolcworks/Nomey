-- ============================================================================
-- CONVERSION EN LOS WRITERS PERSONALES · F11/ADR-001 §4, §6-§10 · F11/ADR-002
-- Bloque F11.B, M4 (B5)
-- ============================================================================
--
-- Parte del estado que dejaron 20260922120000 (catalogo), 20260923120000
-- (ingesta y fijacion) y 20260925120000 (resolver). Los dos writers se recrean
-- desde su cuerpo vigente, el de 20260901120000_expense_only_categories.sql,
-- sin cambiar nada de lo que no es conversion.
--
--   §0  core.frozen_conversion_provenance: la procedencia, en su propia tabla
--       (F11/ADR-001 §9: las columnas de core.frozen_conversion no se tocan)
--   §1  la segunda barrera: el tipo congelado y su procedencia no pueden
--       diferir de lo que el resolver devuelve para esa fecha y ese par
--   §2  sec.fx_personal_rate y sec.persist_frozen_conversion, compartidos por
--       los dos writers
--   §3  api.record_personal_expense y api.record_personal_income
--
-- Lo que NO trae: ninguna otra clase convierte. record_group_expense,
-- record_adjustment, las transferencias, las liquidaciones y
-- incorporate_participant_cash conservan sec.assert_no_conversion tal cual
-- (F11/ADR-001 §4; el gasto de grupo espera a F11.D). Ni lecturas ni
-- estadisticas (F11.C), ni politica nueva en core.effect (decision D1 de B5).
--
-- ======================= QUE HACE UN WRITER PERSONAL ========================
--
-- Hasta aqui, toda moneda distinta de la base de su ambito se rechazaba con
-- CURRENCY_CONVERSION_UNSUPPORTED. Ahora, BAJO EL CERROJO DEL AMBITO y despues
-- de reclamar el comando (un replay no resuelve nada):
--
--   · la base vigente se lee bajo el cerrojo, nunca antes;
--   · la base asumida al capturar, `expected_base_currency_definition_id`, es
--     opcional; si falta, es la moneda de la operacion (F11/ADR-001 §10). Si no
--     es la base vigente: CURRENCY_CONVERSION_UNSUPPORTED · 422, el conflicto
--     de siempre. Por eso un cliente que no la envia recibe exactamente lo
--     mismo que antes para una moneda que no es la base;
--   · moneda = base: nada cambia, ni una fila mas;
--   · moneda distinta: el tipo del dia de la fecha efectiva, con
--     sec.fx_resolve y la fuente por defecto (nunca una del payload), y el
--     importe original convertido UNA vez con sec.fx_convert. La version
--     conserva el importe y la moneda originales; el efecto va en la base con
--     el importe convertido, aunque sea 0; la conversion queda congelada.
--
-- Un 422 o un 503 abortan la transaccion entera, reclamo incluido: la clave de
-- idempotencia no se quema y el reintento con la misma clave vuelve a intentarlo.
--
-- Una CORRECCION con la misma fecha efectiva y la misma moneda original hereda
-- LITERALMENTE la conversion congelada de la version anterior y su procedencia
-- (F11/ADR-001 §8, F03/ADR-010 §6); si cambia la fecha o la moneda, se resuelve
-- de nuevo. Una conversion congelada no se modifica nunca: es insert-only.
-- ============================================================================

-- ═══════════════════════════ §0 · la procedencia ════════════════════════════
--
-- Evidencia, nunca autoridad: la autoridad del importe es el tipo congelado de
-- core.frozen_conversion. Dice de donde salio ese tipo: la fuente, el metodo y,
-- para el origen y el destino, la fecha de referencia y la version usadas (nula
-- para el pivote, que no tiene version). Las dos fechas pueden ser distintas
-- (F11/ADR-002 §7).

create table core.frozen_conversion_provenance (
  operation_version_id   uuid not null,
  scope_id               uuid not null,
  source_id              text not null references core.fx_source (id),
  method                 text not null,
  origin_reference_date  date not null,
  origin_publication_id  uuid references core.fx_publication (id),
  target_reference_date  date not null,
  target_publication_id  uuid references core.fx_publication (id),

  constraint frozen_conversion_provenance_pk primary key (operation_version_id, scope_id),
  -- Una procedencia por conversion congelada, y ninguna sin ella.
  constraint frozen_conversion_provenance_de_la_conversion
    foreign key (operation_version_id, scope_id)
    references core.frozen_conversion (operation_version_id, scope_id),
  -- Vocabulario cerrado: el tipo del dia por moneda de F11/ADR-002.
  constraint frozen_conversion_provenance_metodo
    check (method = 'daily_rate_per_currency')
);

comment on table core.frozen_conversion_provenance is
  'Procedencia de cada conversion congelada (F11/ADR-001 §9, F11/ADR-002 §7): fuente, metodo, y fecha y version de origen y destino. Evidencia; nunca se usa para calcular.';

alter table core.frozen_conversion_provenance enable row level security;

-- Solo el writer: la escribe y la lee (para heredarla en una correccion).
-- Ningun rol cliente; su lectura, si llega, es de F11.C.
grant select, insert on core.frozen_conversion_provenance to nomey_writer;

create policy frozen_conversion_provenance_writer_select on core.frozen_conversion_provenance
  for select to nomey_writer using (true);

-- ═══════════════════════════ §1 · segunda barrera ═══════════════════════════
--
-- La RUTA la da el writer; estas policies son la segunda barrera (E16): aunque
-- un writer fallara, no puede congelar un tipo que no sea el del dia fijado, ni
-- guardar una procedencia que lo contradiga. Se evaluan como el writer, que
-- ejecuta el resolver con la fuente por defecto.
--
-- Compatibles con las correcciones: heredar copia un tipo que el resolver
-- devuelve igual, porque el dia fijado no cambia y la guarda de cobertura
-- (20260923120000 §3) impide estrecharla por detras de lo fijado. Un replay no
-- inserta nada.

-- 7a le retiro este INSERT porque ninguna ruta lo ejercia (ADR-009 §8 en la
-- numeracion antigua). Vuelve con la ruta que lo ejerce.
grant insert on core.frozen_conversion to nomey_writer;

drop policy frozen_conversion_writer_insert on core.frozen_conversion;
create policy frozen_conversion_writer_insert on core.frozen_conversion
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
       where ov.id = frozen_conversion.operation_version_id
         and ov.created_by = sec.request_actor_id()
    )
    and exists (
      select 1
        from sec.fx_resolve(frozen_conversion.resolved_for_date,
                            frozen_conversion.source_currency_definition_id,
                            frozen_conversion.target_currency_definition_id) r
       where r.rate_coefficient = frozen_conversion.rate_coefficient
         and r.rate_scale = frozen_conversion.rate_scale
    )
  );

create policy frozen_conversion_provenance_writer_insert on core.frozen_conversion_provenance
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
       where ov.id = frozen_conversion_provenance.operation_version_id
         and ov.created_by = sec.request_actor_id()
    )
    and exists (
      select 1
        from core.frozen_conversion fc
       cross join lateral sec.fx_resolve(fc.resolved_for_date,
                                         fc.source_currency_definition_id,
                                         fc.target_currency_definition_id) r
       where fc.operation_version_id = frozen_conversion_provenance.operation_version_id
         and fc.scope_id = frozen_conversion_provenance.scope_id
         and r.source_id = frozen_conversion_provenance.source_id
         and r.origin_reference_date = frozen_conversion_provenance.origin_reference_date
         and r.origin_publication_id is not distinct from frozen_conversion_provenance.origin_publication_id
         and r.target_reference_date = frozen_conversion_provenance.target_reference_date
         and r.target_publication_id is not distinct from frozen_conversion_provenance.target_publication_id
    )
  );

-- Sin UPDATE ni DELETE para nadie: una conversion congelada, y su procedencia,
-- no se modifican nunca.

-- ═══════════════════ §2 · lo que comparten los dos writers ══════════════════

-- El tipo con el que se registra una operacion personal, BAJO EL CERROJO del
-- ambito, que el writer ya tomo. Devuelve la base vigente y, si hay que
-- convertir, el tipo congelable y su procedencia; si no, el tipo nulo.
--
--   p_assumed_base  la base asumida al capturar, o nula si el payload no la trae
--   p_supersedes    la version que se corrige, o nula si es un alta
create function sec.fx_personal_rate(
  p_scope        uuid,
  p_currency     uuid,
  p_assumed_base uuid,
  p_date         date,
  p_supersedes   uuid,
  out base_currency_definition_id uuid,
  out rate_coefficient      bigint,
  out rate_scale            smallint,
  out source_id             text,
  out origin_reference_date date,
  out origin_publication_id uuid,
  out target_reference_date date,
  out target_publication_id uuid
)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_prev_date     date;
  v_prev_currency uuid;
begin
  select s.base_currency_definition_id into base_currency_definition_id
    from core.scope s where s.id = p_scope;
  if base_currency_definition_id is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'ambito no alcanzable', 403);
  end if;

  -- Paso 4 de F11/ADR-001 §6: la base asumida frente a la vigente. Sin base
  -- asumida, la moneda de la operacion hace de base asumida (§10).
  if coalesce(p_assumed_base, p_currency) is distinct from base_currency_definition_id then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la base asumida al capturar no es la moneda base vigente del ambito', 422);
  end if;

  if p_currency = base_currency_definition_id then
    return;   -- sin conversion
  end if;

  -- Heredar: una correccion con la misma fecha efectiva y la misma moneda
  -- original reutiliza literalmente el tipo congelado de la version anterior.
  if p_supersedes is not null then
    select ov.effective_date, ov.original_currency_definition_id
      into v_prev_date, v_prev_currency
      from core.operation_version ov where ov.id = p_supersedes;
    if v_prev_date = p_date and v_prev_currency = p_currency then
      select fc.rate_coefficient, fc.rate_scale,
             pv.source_id, pv.origin_reference_date, pv.origin_publication_id,
             pv.target_reference_date, pv.target_publication_id
        into rate_coefficient, rate_scale,
             source_id, origin_reference_date, origin_publication_id,
             target_reference_date, target_publication_id
        from core.frozen_conversion fc
        join core.frozen_conversion_provenance pv
          on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
       where fc.operation_version_id = p_supersedes
         and fc.scope_id = p_scope
         and fc.target_currency_definition_id = base_currency_definition_id;
      if rate_coefficient is not null then
        return;
      end if;
    end if;
  end if;

  -- Pasos 5-8: el tipo del dia de la fecha efectiva, siempre con la fuente por
  -- defecto. Un 422 o un 503 salen de aqui y abortan todo.
  select r.rate_coefficient, r.rate_scale, r.source_id,
         r.origin_reference_date, r.origin_publication_id,
         r.target_reference_date, r.target_publication_id
    into rate_coefficient, rate_scale, source_id,
         origin_reference_date, origin_publication_id,
         target_reference_date, target_publication_id
    from sec.fx_resolve(p_date, p_currency, base_currency_definition_id) r;
end
$fn$;

comment on function sec.fx_personal_rate(uuid, uuid, uuid, date, uuid) is
  'Base vigente (leida bajo el cerrojo del writer), conflicto de base asumida y tipo congelable: heredado en una correccion con la misma fecha y moneda, resuelto con la fuente por defecto si no (F11/ADR-001 §6, §8, §10).';

-- La conversion congelada y su procedencia, en ese orden (la FK lo exige).
create function sec.persist_frozen_conversion(
  p_version       uuid,
  p_scope         uuid,
  p_date          date,
  p_source_currency uuid,
  p_target_currency uuid,
  p_rate_coefficient bigint,
  p_rate_scale    smallint,
  p_source_id     text,
  p_origin_reference_date date,
  p_origin_publication_id uuid,
  p_target_reference_date date,
  p_target_publication_id uuid
) returns void
language sql
set search_path = ''
as $fn$
  insert into core.frozen_conversion
    (operation_version_id, scope_id, source_currency_definition_id, target_currency_definition_id,
     rate_coefficient, rate_scale, resolved_for_date)
  values (p_version, p_scope, p_source_currency, p_target_currency,
          p_rate_coefficient, p_rate_scale, p_date);
  insert into core.frozen_conversion_provenance
    (operation_version_id, scope_id, source_id, method,
     origin_reference_date, origin_publication_id, target_reference_date, target_publication_id)
  values (p_version, p_scope, p_source_id, 'daily_rate_per_currency',
          p_origin_reference_date, p_origin_publication_id, p_target_reference_date, p_target_publication_id);
$fn$;

comment on function sec.persist_frozen_conversion(uuid, uuid, date, uuid, uuid, bigint, smallint, text, date, uuid, date, uuid) is
  'Congela la conversion de una version en un ambito y su procedencia. Las dos policies de INSERT son la segunda barrera.';

revoke execute on function sec.fx_personal_rate(uuid, uuid, uuid, date, uuid) from public;
revoke execute on function sec.persist_frozen_conversion(uuid, uuid, date, uuid, uuid, bigint, smallint, text, date, uuid, date, uuid) from public;
grant execute on function sec.fx_personal_rate(uuid, uuid, uuid, date, uuid) to nomey_writer;
grant execute on function sec.persist_frozen_conversion(uuid, uuid, date, uuid, uuid, bigint, smallint, text, date, uuid, date, uuid) to nomey_writer;

-- ═════════════════════════ §3 · los dos writers ═════════════════════════════
--
-- Diferencias con el cuerpo vigente, y ninguna mas:
--   · `expected_base_currency_definition_id` admitido y, si viene y difiere de
--     la moneda, parte de la intencion canonica: los comandos ya enviados sin
--     el campo conservan su forma y su replay (F11/ADR-001 §10);
--   · sin sec.assert_no_conversion antes del cerrojo: la base se lee despues,
--     en sec.fx_personal_rate;
--   · el efecto va en la base, con el importe convertido si hubo conversion;
--   · la conversion congelada y su procedencia, despues de la version.

create or replace function api.record_personal_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id','concept','category_id',
    'expected_base_currency_definition_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time;
  v_concept text; v_category uuid; v_assumed_base uuid;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_fx record; v_booked bigint;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_time     := sec.payload_time(payload, 'effective_time', true);
  -- OBLIGATORIA. Un gasto sin categoria no existe en Nomey, y `Otros` es la
  -- categoria REAL de los que no encajan en otra.
  v_category := sec.payload_uuid(payload, 'category_id', true);
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));
  v_assumed_base := sec.payload_uuid(payload, 'expected_base_currency_definition_id', false);

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un gasto de cero o negativo no es valido (ADR-013 §3)', 400);
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
  if v_assumed_base is not null and v_assumed_base <> v_currency then
    v_canonical := v_canonical || jsonb_build_object(
      'expected_base_currency_definition_id', v_assumed_base::text);
  end if;

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'personal_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);

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

  perform sec.assert_category_usable(v_category, v_actor, v_supersedes);

  -- F11: base bajo el cerrojo, conflicto de base, y tipo heredado o resuelto.
  select * into v_fx from sec.fx_personal_rate(v_scope, v_currency, v_assumed_base, v_date, v_supersedes);
  v_booked := case when v_fx.rate_coefficient is null then v_amount
                   else sec.fx_convert(v_amount, v_currency, v_fx.base_currency_definition_id,
                                       v_fx.rate_coefficient, v_fx.rate_scale) end;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_expense', v_date, v_amount, v_currency,
                              v_time);
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  if v_fx.rate_coefficient is not null then
    perform sec.persist_frozen_conversion(v_version, v_scope, v_date, v_currency,
      v_fx.base_currency_definition_id, v_fx.rate_coefficient, v_fx.rate_scale, v_fx.source_id,
      v_fx.origin_reference_date, v_fx.origin_publication_id,
      v_fx.target_reference_date, v_fx.target_publication_id);
  end if;

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'expense', v_fx.base_currency_definition_id,
          - v_booked, v_booked, null);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$fn$;

create or replace function api.record_personal_income(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id','concept',
    'expected_base_currency_definition_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time;
  v_concept text; v_assumed_base uuid;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_fx record; v_booked bigint;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_time     := sec.payload_time(payload, 'effective_time', true);
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));
  v_assumed_base := sec.payload_uuid(payload, 'expected_base_currency_definition_id', false);

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
    'concept',                v_concept);
  if v_assumed_base is not null and v_assumed_base <> v_currency then
    v_canonical := v_canonical || jsonb_build_object(
      'expected_base_currency_definition_id', v_assumed_base::text);
  end if;

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'personal_income', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);

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

  -- F11: base bajo el cerrojo, conflicto de base, y tipo heredado o resuelto.
  select * into v_fx from sec.fx_personal_rate(v_scope, v_currency, v_assumed_base, v_date, v_supersedes);
  v_booked := case when v_fx.rate_coefficient is null then v_amount
                   else sec.fx_convert(v_amount, v_currency, v_fx.base_currency_definition_id,
                                       v_fx.rate_coefficient, v_fx.rate_scale) end;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_income', v_date, v_amount, v_currency,
                              v_time);
  -- Concepto SI, categoria NO. El ingreso no tiene ese concepto de dominio.
  perform sec.persist_movement_detail(v_version, v_concept);

  if v_fx.rate_coefficient is not null then
    perform sec.persist_frozen_conversion(v_version, v_scope, v_date, v_currency,
      v_fx.base_currency_definition_id, v_fx.rate_coefficient, v_fx.rate_scale, v_fx.source_id,
      v_fx.origin_reference_date, v_fx.origin_publication_id,
      v_fx.target_reference_date, v_fx.target_publication_id);
  end if;

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'income', v_fx.base_currency_definition_id,
          v_booked, v_booked, null);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$fn$;
