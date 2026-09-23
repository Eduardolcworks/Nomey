-- ============================================================================
-- CONVERSION EN LOS WRITERS PERSONALES · F11/ADR-001 §4, §6-§10 · F11/ADR-002
-- ============================================================================
--
-- Migracion 20260929120000 (F11.B, M4). Contra los writers REALES, con
-- identidad simulada, fixtures propias y ROLLBACK.
--
-- El camino con exito necesita dias fijados de la fuente real `ecb`, porque
-- los writers resuelven siempre con ella. Se siembran COMO POSTGRES, dentro de
-- esta transaccion y en fechas de 2099 que ninguna ingesta real habra fijado:
-- nunca se ingiere un documento sintetico en `ecb`, y la base local de quien
-- ejecute el check queda exactamente como estaba.
--
--   A · catalogo: procedencia, privilegios, las dos policies de segunda
--       barrera, y que solo estos dos writers convierten
--   B · gasto e ingreso en moneda extranjera: version original, efecto en la
--       base con la conversion unica, conversion congelada y su procedencia
--   C · moneda base sin cambios; conflicto de base asumida; 422 y 503, que
--       abortan todo sin quemar la clave; replay; campos de tipo o de fuente
--   D · correcciones: heredar con la misma fecha y moneda; resolver de nuevo
--       al cambiar la fecha o la moneda; volver a la base
--   E · importe convertido 0; invariante general de conversion unica
--   F · segunda barrera: el tipo y la procedencia que el resolver no da no
--       entran, aunque se escriban directamente como el writer; insert-only
--   G · las clases que siguen fuera de F11.B conservan su negativa

\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

-- <sql> como <role> con <actor> en el JWT: su primer valor, 'ERR CODIGO:estado'
-- si es un error de frontera o 'ERR sqlstate' si no.
create function pg_temp.como(p_sql text, p_role text, p_actor uuid) returns text
language plpgsql as $$
declare
  v text; v_msg text; v_det text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor::text)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql into v;
  perform pg_temp.super();
  return coalesce(v, 'NULL');
exception
  when sqlstate 'PGRST' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    perform pg_temp.super();
    return 'ERR ' || (v_msg::json ->> 'code') || ':' || (v_det::json ->> 'status');
  when others then
    perform pg_temp.super();
    return 'ERR ' || sqlstate;
end $$;
grant execute on function pg_temp.super(), pg_temp.como(text, text, uuid)
  to authenticated, nomey_writer;

-- api.<fn>(payload) como <actor>, igual que el cliente.
create function pg_temp.api(p_fn text, p_payload jsonb, p_actor uuid) returns text language sql as $$
  select pg_temp.como(format('select api.%I(%L::jsonb)::text', p_fn, p_payload), 'authenticated', p_actor);
$$;

-- Un dia X de la fuente real fijado con R(X) = <ref> y los tipos dados
-- ({codigo: [coeficiente, escala, texto]}). Como postgres, sin pasar por la
-- ingesta: no se ingiere nada en `ecb`.
create function pg_temp.fijar(p_day date, p_ref date, p_rates jsonb) returns void
language plpgsql as $$
declare
  v_obs uuid := gen_random_uuid();
  v_pub uuid := gen_random_uuid();
begin
  insert into core.fx_observation (id, source_id, observed_at, document_url, http_status,
                                   document_sha256, document_bytes, first_reference_date,
                                   last_reference_date, reference_date_count, complete)
  values (v_obs, 'ecb', p_day::timestamp at time zone 'Europe/Berlin',
          'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml', 200,
          repeat('0', 64), 0, p_ref, p_ref, 1, true);
  insert into core.fx_publication (id, source_id, reference_date, content_sha256, rate_count, first_observation_id)
  values (v_pub, 'ecb', p_ref, encode(sha256(convert_to(v_pub::text, 'UTF8')), 'hex'),
          (select count(*) from jsonb_object_keys(p_rates)), v_obs);
  insert into core.fx_publication_rate (publication_id, source_code, coefficient, scale, source_text)
  select v_pub, e.key, (e.value ->> 0)::bigint, (e.value ->> 1)::smallint, e.value ->> 2
    from jsonb_each(p_rates) e;
  insert into core.fx_observation_publication (observation_id, publication_id, source_id)
  values (v_obs, v_pub, 'ecb');
  insert into core.fx_day (source_id, day, reference_date, observation_id)
  values ('ecb', p_day, p_ref, v_obs);
  insert into core.fx_day_rate (source_id, day, currency_definition_id, position, reference_date,
                                observation_id, publication_id, source_code)
  select 'ecb', p_day, c.currency_definition_id,
         case when c.source_code is null then 'pivot' else 'R' end, p_ref, v_obs,
         case when c.source_code is null then null else v_pub end, c.source_code
    from core.fx_coverage c
   where c.source_id = 'ecb' and c.valid_from <= p_ref
     and (c.valid_until is null or p_ref <= c.valid_until)
     and (c.source_code is null or p_rates ? c.source_code);
end $$;

create temporary table fx_fix (k text primary key, v text) on commit drop;
insert into fx_fix (k, v) values
  ('U1',  'f11b5000-0000-4000-8000-0000000000a1'),
  ('U2',  'f11b5000-0000-4000-8000-0000000000a2'),
  ('S1',  'f11b5000-0000-4000-8000-000000000001'),   -- Personal de U1, base EUR
  ('S2',  'f11b5000-0000-4000-8000-000000000002'),   -- Personal de U2, base EUR
  ('EUR', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  ('USD', '34cb8424-2243-52d8-be99-e2b7d22884b8'),
  ('JPY', 'f981b2f9-a022-5de8-aa6d-3af277d9dcd3'),
  ('HUF', '8b951c59-bbd1-539b-9336-4174fbf47bdb'),
  ('NOK', 'f2fe8324-641c-548d-b3af-411db0d39448'),
  ('ARS', '6cbdabc6-2d2f-5090-a063-3a366f9fd23d'),
  ('CAT', '4ed30a44-9f82-578f-828c-b491a25ebdd9'),   -- Otros, gasto
  ('X1',  '2099-03-10'),                             -- R = 2099-03-09, USD 1.1592
  ('X2',  '2099-03-11'),                             -- R = 2099-03-10, USD 1.2
  ('XN',  '2099-12-31');                             -- sin fijar
create function pg_temp.f(p_k text) returns text language sql as $$
  select v from fx_fix where k = p_k;
$$;
grant select on fx_fix to authenticated, nomey_writer;
grant execute on function pg_temp.f(text) to authenticated, nomey_writer;

insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
values (pg_temp.f('S1')::uuid, 'personal', pg_temp.f('EUR')::uuid, pg_temp.f('U1')::uuid),
       (pg_temp.f('S2')::uuid, 'personal', pg_temp.f('EUR')::uuid, pg_temp.f('U2')::uuid);
insert into core.membership (scope_id, user_id)
values (pg_temp.f('S1')::uuid, pg_temp.f('U1')::uuid), (pg_temp.f('S2')::uuid, pg_temp.f('U2')::uuid);

do $fixtures$
begin
  perform pg_temp.fijar(pg_temp.f('X1')::date, '2099-03-09',
    '{"USD":["11592",4,"1.1592"],"JPY":["17856",2,"178.56"],"HUF":["36445",2,"364.45"]}');
  perform pg_temp.fijar(pg_temp.f('X2')::date, '2099-03-10',
    '{"USD":["12",1,"1.2"],"JPY":["180",0,"180"],"HUF":["365",0,"365"]}');
end
$fixtures$;

-- Un gasto de U1: la base del payload se completa con lo que cambie en cada caso.
create function pg_temp.gasto(p_key text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 2,
    'effective_date', pg_temp.f('X1'), 'effective_time', '10:00',
    'scope_id', pg_temp.f('S1'), 'amount', '10000', 'currency_definition_id', pg_temp.f('USD'),
    'concept', 'Cena', 'category_id', pg_temp.f('CAT')) || p_extra;
$$;
create function pg_temp.ingreso(p_key text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'effective_date', pg_temp.f('X1'), 'effective_time', '10:00',
    'scope_id', pg_temp.f('S1'), 'amount', '5000', 'currency_definition_id', pg_temp.f('USD'),
    'concept', 'Cobro') || p_extra;
$$;
-- El operation_id de una respuesta, o null si fue un rechazo: un fallo se
-- cuenta como fallo, no revienta el check.
create function pg_temp.op(p_res text) returns uuid language sql as $op$
  select case when left(p_res, 1) = '{' then (p_res::jsonb ->> 'operation_id')::uuid end;
$op$;

-- La version vigente de una operacion, resumida: original, efecto y conversion.
create function pg_temp.resumen(p_operation uuid) returns text language sql as $$
  select ov.original_amount || ' ' || (select code from core.currency_definition where id = ov.original_currency_definition_id)
      || ' @' || ov.effective_date
      || ' | efecto ' || e.balance_amount || '/' || e.economic_amount || ' '
      || (select code from core.currency_definition where id = e.currency_definition_id)
      || ' | ' || coalesce(fc.rate_coefficient || 'e' || fc.rate_scale || ' ' || fc.resolved_for_date
                           || ' ' || pv.source_id || ' o=' || pv.origin_reference_date
                           || ' d=' || pv.target_reference_date
                           || ' po=' || (pv.origin_publication_id is not null)
                           || ' pd=' || (pv.target_publication_id is not null), 'sin conversion')
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.effect e on e.operation_version_id = ov.id
    left join core.frozen_conversion fc on fc.operation_version_id = ov.id
    left join core.frozen_conversion_provenance pv
      on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
   where o.id = p_operation;
$$;

-- ============================== A · catalogo =================================
do $a$
declare
  fallos text[] := '{}';
  v_t text;
  v_n int;
begin
  -- A1 · la procedencia: con RLS, de postgres, y solo el writer la lee y la
  --      inserta; ningun cliente la alcanza.
  if not exists (select 1 from pg_class
                  where oid = 'core.frozen_conversion_provenance'::regclass
                    and relrowsecurity and not relforcerowsecurity and pg_get_userbyid(relowner) = 'postgres') then
    fallos := array_append(fallos, 'A1 la procedencia no tiene RLS o no es de postgres');
  end if;
  select string_agg(g.rolname || '=' || a.privilege_type, ',' order by g.rolname, a.privilege_type) into v_t
    from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
   where c.oid = 'core.frozen_conversion_provenance'::regclass and a.grantee <> c.relowner;
  if v_t is distinct from 'nomey_writer=INSERT,nomey_writer=SELECT' then
    fallos := array_append(fallos, 'A1b privilegios de la procedencia: ' || coalesce(v_t, 'ninguno'));
  end if;
  select string_agg(g.rolname || '=' || a.privilege_type, ',' order by g.rolname, a.privilege_type) into v_t
    from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
   where c.oid = 'core.frozen_conversion'::regclass and a.grantee <> c.relowner;
  if v_t is distinct from 'nomey_writer=INSERT,nomey_writer=SELECT' then
    fallos := array_append(fallos, 'A1c privilegios de la conversion congelada: ' || coalesce(v_t, 'ninguno'));
  end if;

  -- A2 · las dos policies de INSERT exigen el resultado del resolver.
  select count(*) into v_n from pg_policy p
   where p.polcmd = 'a' and p.polroles = array['nomey_writer'::regrole::oid]
     and p.polrelid in ('core.frozen_conversion'::regclass, 'core.frozen_conversion_provenance'::regclass)
     and pg_get_expr(p.polwithcheck, p.polrelid) like '%fx_resolve%'
     and pg_get_expr(p.polwithcheck, p.polrelid) like '%request_actor_id%';
  if v_n <> 2 then
    fallos := array_append(fallos, format('A2 %s de 2 policies de segunda barrera', v_n));
  end if;

  -- A3 · la procedencia no esta en las columnas de la conversion congelada.
  if (select count(*) from information_schema.columns
       where table_schema = 'core' and table_name = 'frozen_conversion') <> 7 then
    fallos := array_append(fallos, 'A3 core.frozen_conversion cambio de columnas');
  end if;

  -- A4 · solo estos dos writers convierten; los otros siete conservan la
  --      negativa y ninguno de ellos resuelve.
  select string_agg(p.proname, ',' order by p.proname collate "C") into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname like 'record\_%'
     and p.prosrc like '%sec.assert_no_conversion%';
  -- SEIS desde F11.D (20261003120000): el gasto de grupo convierte, asi que
  -- deja la lista. Las otras seis conservan su negativa (F11/ADR-003 §6).
  if v_t is distinct from 'record_adjustment,record_debt_settlement,record_external_transfer,'
                          'record_group_payment,record_internal_transfer,'
                          'record_settlement_by_transfer' then
    fallos := array_append(fallos, 'A4 clases con negativa de conversion: ' || coalesce(v_t, 'ninguna'));
  end if;
  select string_agg(p.proname, ',' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.prosrc like '%fx\_personal\_rate%';
  if v_t is distinct from 'record_group_expense,record_personal_expense,record_personal_income' then
    fallos := array_append(fallos, 'A4b writers que convierten: ' || coalesce(v_t, 'ninguno'));
  end if;

  -- A5 · los helpers: sin DEFINER, y solo el writer los ejecuta.
  select string_agg(p.proname, ',' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and p.proname in ('fx_personal_rate', 'persist_frozen_conversion')
     and not p.prosecdef and p.proconfig = array['search_path=""']
     and has_function_privilege('nomey_writer', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('public', p.oid, 'EXECUTE');
  if v_t is distinct from 'fx_personal_rate,persist_frozen_conversion' then
    fallos := array_append(fallos, 'A5 helpers de F11.B: ' || coalesce(v_t, 'ninguno'));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'A · catalogo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'A · procedencia aparte, privilegios exactos, dos policies de segunda barrera, solo los dos writers convierten: OK';
end
$a$;

-- ======================= B · gasto e ingreso con FX ==========================
do $b$
declare
  fallos text[] := '{}';
  U1 constant uuid := pg_temp.f('U1');
  v text;
  v_op uuid;
begin
  -- B1 · gasto de 100,00 USD el X1 con base asumida EUR. 1/1.1592 a escala
  --      12 = 0.862663906142; 10000 x ese tipo = 8626,64 -> 8627 centimos.
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000b001',
                       jsonb_build_object('expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  v_op := pg_temp.op(v);
  if pg_temp.resumen(v_op) is distinct from
     '10000 USD @2099-03-10 | efecto -8627/8627 EUR | 862663906142e12 2099-03-10 ecb o=2099-03-09 d=2099-03-09 po=true pd=false' then
    fallos := array_append(fallos, 'B1 gasto: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;
  insert into fx_fix values ('OP_GASTO', v_op::text);

  -- B2 · ingreso de 50,00 USD el X1: 4313,32 -> 4313, con signo positivo.
  v := pg_temp.api('record_personal_income',
         pg_temp.ingreso('f11b5000-0000-4000-8000-00000000b002',
                         jsonb_build_object('expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  v_op := pg_temp.op(v);
  if pg_temp.resumen(v_op) is distinct from
     '5000 USD @2099-03-10 | efecto 4313/4313 EUR | 862663906142e12 2099-03-10 ecb o=2099-03-09 d=2099-03-09 po=true pd=false' then
    fallos := array_append(fallos, 'B2 ingreso: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;

  -- B3 · la version conserva el importe y la moneda originales; el efecto va en
  --      la base; la conversion congelada apunta a la fecha efectiva de la
  --      version y a la base del ambito.
  if exists (select 1 from core.frozen_conversion fc
               join core.operation_version ov on ov.id = fc.operation_version_id
               join core.scope s on s.id = fc.scope_id
              where ov.created_by = U1
                and (fc.resolved_for_date <> ov.effective_date
                     or fc.source_currency_definition_id <> ov.original_currency_definition_id
                     or fc.target_currency_definition_id <> s.base_currency_definition_id)) then
    fallos := array_append(fallos, 'B3 una conversion congelada no es la de su version y su ambito');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'B · gasto e ingreso:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'B · gasto e ingreso en USD: original conservado, efecto en EUR con una conversion, tipo y procedencia congelados: OK';
end
$b$;

-- ====== C · base, conflicto, 422, 503, idempotencia y campos prohibidos ======
do $c$
declare
  fallos text[] := '{}';
  U1 constant uuid := pg_temp.f('U1');
  v text;
  v_op uuid;
  v_ops_antes bigint;
  v_fc_antes bigint;
begin
  -- C1 · moneda = base, sin base asumida: exactamente como antes.
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000c001',
                       jsonb_build_object('currency_definition_id', pg_temp.f('EUR'), 'amount', '3000')), U1);
  v_op := pg_temp.op(v);
  if pg_temp.resumen(v_op) is distinct from '3000 EUR @2099-03-10 | efecto -3000/3000 EUR | sin conversion' then
    fallos := array_append(fallos, 'C1 gasto en la base: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;
  -- ... y con base asumida igual a la base, tambien.
  v := pg_temp.api('record_personal_income',
         pg_temp.ingreso('f11b5000-0000-4000-8000-00000000c002',
                         jsonb_build_object('currency_definition_id', pg_temp.f('EUR'),
                                            'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(pg_temp.op(v)) is distinct from '5000 EUR @2099-03-10 | efecto 5000/5000 EUR | sin conversion' then
    fallos := array_append(fallos, 'C1b ingreso en la base: ' || v);
  end if;

  select count(*) into v_ops_antes from core.operation;
  select count(*) into v_fc_antes from core.frozen_conversion;

  -- C2 · conflicto de base asumida: sin ella, una moneda que no es la base es
  --      el conflicto de siempre; con otra base asumida, tambien; y una base
  --      asumida distinta en una operacion en la base, tambien.
  if pg_temp.api('record_personal_expense', pg_temp.gasto('f11b5000-0000-4000-8000-00000000c010', '{}'), U1)
     <> 'ERR CURRENCY_CONVERSION_UNSUPPORTED:422' then
    fallos := array_append(fallos, 'C2 moneda extranjera sin base asumida');
  end if;
  if pg_temp.api('record_personal_expense',
       pg_temp.gasto('f11b5000-0000-4000-8000-00000000c011',
                     jsonb_build_object('expected_base_currency_definition_id', pg_temp.f('JPY'))), U1)
     <> 'ERR CURRENCY_CONVERSION_UNSUPPORTED:422' then
    fallos := array_append(fallos, 'C2b base asumida que no es la vigente');
  end if;
  if pg_temp.api('record_personal_income',
       pg_temp.ingreso('f11b5000-0000-4000-8000-00000000c012',
                       jsonb_build_object('currency_definition_id', pg_temp.f('EUR'),
                                          'expected_base_currency_definition_id', pg_temp.f('USD'))), U1)
     <> 'ERR CURRENCY_CONVERSION_UNSUPPORTED:422' then
    fallos := array_append(fallos, 'C2c base asumida distinta en una operacion en la base');
  end if;

  -- C3 · 422 sin cobertura: ARS no tiene correspondencia (ni espera a un dia
  --      fijado); NOK no tiene tipo el X1.
  if pg_temp.api('record_personal_expense',
       pg_temp.gasto('f11b5000-0000-4000-8000-00000000c020',
                     jsonb_build_object('currency_definition_id', pg_temp.f('ARS'), 'effective_date', pg_temp.f('XN'),
                                        'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1)
     <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'C3 ARS');
  end if;
  if pg_temp.api('record_personal_income',
       pg_temp.ingreso('f11b5000-0000-4000-8000-00000000c021',
                       jsonb_build_object('currency_definition_id', pg_temp.f('NOK'),
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1)
     <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'C3b NOK sin tipo ese dia');
  end if;

  -- C4 · 503 con un dia sin fijar, y la clave no se quema: el reintento con la
  --      misma clave vuelve a resolver y vuelve a esperar.
  for i in 1 .. 2 loop
    if pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000c030',
                       jsonb_build_object('effective_date', pg_temp.f('XN'),
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1)
       <> 'ERR FX_RATE_NOT_YET_AVAILABLE:503' then
      fallos := array_append(fallos, format('C4 intento %s: dia sin fijar', i));
    end if;
  end loop;

  -- C5 · ninguno de los rechazos escribio nada, ni reclamo su clave.
  if (select count(*) from core.operation) <> v_ops_antes
     or (select count(*) from core.frozen_conversion) <> v_fc_antes
     or exists (select 1 from core.client_command
                 where client_operation_id::text between 'f11b5000-0000-4000-8000-00000000c010'
                                                    and 'f11b5000-0000-4000-8000-00000000c030') then
    fallos := array_append(fallos, 'C5 un rechazo escribio o consumio su clave');
  end if;
  -- ... y la clave del conflicto sirve despues para la intencion corregida.
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000c010',
                       jsonb_build_object('expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if v not like '%"already_processed": false%' then
    fallos := array_append(fallos, 'C5b la clave rechazada no se pudo usar: ' || v);
  end if;

  -- C6 · replay: la misma clave con la misma intencion devuelve el resultado
  --      original y no escribe otra conversion.
  select count(*) into v_fc_antes from core.frozen_conversion;
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000b001',
                       jsonb_build_object('expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if v not like '%"already_processed": true%' or v not like '%' || pg_temp.f('OP_GASTO') || '%'
     or (select count(*) from core.frozen_conversion) <> v_fc_antes then
    fallos := array_append(fallos, 'C6 replay: ' || v);
  end if;
  -- ... y la base asumida es parte de la intencion: sin ella es otra intencion.
  if pg_temp.api('record_personal_expense', pg_temp.gasto('f11b5000-0000-4000-8000-00000000b001', '{}'), U1)
     <> 'ERR IDEMPOTENCY_KEY_REUSED:409' then
    fallos := array_append(fallos, 'C6b la base asumida no forma parte de la intencion canonica');
  end if;

  -- C7 · ni tipo, ni fuente, ni escala desde el payload.
  foreach v in array array['source_id', 'rate_coefficient', 'rate_scale', 'resolved_for_date', 'fx_source'] loop
    if pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000c040',
                       jsonb_build_object('expected_base_currency_definition_id', pg_temp.f('EUR'), v, 'ecb')), U1)
       <> 'ERR PAYLOAD_INVALID:400' then
      fallos := array_append(fallos, format('C7 el payload admite %s', v));
    end if;
  end loop;

  if cardinality(fallos) > 0 then
    raise exception E'C · base, conflicto, 422, 503, idempotencia:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'C · base intacta, conflicto de base, 422, 503 sin quemar la clave, replay y sin campos de tipo: OK';
end
$c$;

-- ============================ D · correcciones ===============================
do $d$
declare
  fallos text[] := '{}';
  U1 constant uuid := pg_temp.f('U1');
  v_op uuid := pg_temp.f('OP_GASTO')::uuid;
  v text;
  v_prev uuid;
  v_prev_pv text;
  v_n int := 0;
begin
  -- D1 · misma fecha y misma moneda (cambia el importe): HEREDA el tipo y la
  --      procedencia de la version anterior, literalmente.
  select current_version_id into v_prev from core.operation where id = v_op;
  select pv.source_id || pv.origin_reference_date || coalesce(pv.origin_publication_id::text, '-')
         || pv.target_reference_date || coalesce(pv.target_publication_id::text, '-')
    into v_prev_pv from core.frozen_conversion_provenance pv where pv.operation_version_id = v_prev;
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000d001',
                       jsonb_build_object('operation_id', v_op, 'expected_version_id', v_prev,
                                          'amount', '20000', 'concept', 'Cena corregida',
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(v_op) is distinct from
     '20000 USD @2099-03-10 | efecto -17253/17253 EUR | 862663906142e12 2099-03-10 ecb o=2099-03-09 d=2099-03-09 po=true pd=false' then
    fallos := array_append(fallos, 'D1 correccion con la misma fecha y moneda: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;
  if (select pv.source_id || pv.origin_reference_date || coalesce(pv.origin_publication_id::text, '-')
             || pv.target_reference_date || coalesce(pv.target_publication_id::text, '-')
        from core.operation o join core.frozen_conversion_provenance pv on pv.operation_version_id = o.current_version_id
       where o.id = v_op) is distinct from v_prev_pv then
    fallos := array_append(fallos, 'D1b la procedencia heredada no es la de la version anterior');
  end if;
  -- ... y la conversion de la version anterior sigue intacta.
  if (select rate_coefficient from core.frozen_conversion where operation_version_id = v_prev) <> 862663906142 then
    fallos := array_append(fallos, 'D1c la conversion anterior cambio');
  end if;

  -- D2 · cambia la fecha: se resuelve de nuevo con el dia X2 (USD 1.2).
  select current_version_id into v_prev from core.operation where id = v_op;
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000d002',
                       jsonb_build_object('operation_id', v_op, 'expected_version_id', v_prev,
                                          'amount', '20000', 'effective_date', pg_temp.f('X2'),
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(v_op) is distinct from
     '20000 USD @2099-03-11 | efecto -16667/16667 EUR | 833333333333e12 2099-03-11 ecb o=2099-03-10 d=2099-03-10 po=true pd=false' then
    fallos := array_append(fallos, 'D2 correccion con otra fecha: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;

  -- D3 · cambia la moneda (JPY, escala 0): se resuelve de nuevo. 1000 JPY el X2
  --      a 1/180 -> 5,56 EUR.
  select current_version_id into v_prev from core.operation where id = v_op;
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000d003',
                       jsonb_build_object('operation_id', v_op, 'expected_version_id', v_prev,
                                          'amount', '1000', 'effective_date', pg_temp.f('X2'),
                                          'currency_definition_id', pg_temp.f('JPY'),
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(v_op) is distinct from
     '1000 JPY @2099-03-11 | efecto -556/556 EUR | 5555555556e12 2099-03-11 ecb o=2099-03-10 d=2099-03-10 po=true pd=false' then
    fallos := array_append(fallos, 'D3 correccion con otra moneda: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;

  -- D4 · vuelve a la base: sin conversion, y sin base asumida en la correccion.
  select current_version_id into v_prev from core.operation where id = v_op;
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000d004',
                       jsonb_build_object('operation_id', v_op, 'expected_version_id', v_prev,
                                          'amount', '4500', 'currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(v_op) is distinct from '4500 EUR @2099-03-10 | efecto -4500/4500 EUR | sin conversion' then
    fallos := array_append(fallos, 'D4 correccion a la base: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;

  -- D5 · y de la base otra vez a USD en la misma fecha que tuvo: no hay nada
  --      que heredar de la version anterior, que no convertia; se resuelve.
  select current_version_id into v_prev from core.operation where id = v_op;
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000d005',
                       jsonb_build_object('operation_id', v_op, 'expected_version_id', v_prev,
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(v_op) is distinct from
     '10000 USD @2099-03-10 | efecto -8627/8627 EUR | 862663906142e12 2099-03-10 ecb o=2099-03-09 d=2099-03-09 po=true pd=false' then
    fallos := array_append(fallos, 'D5 de la base a USD: ' || coalesce(pg_temp.resumen(v_op), v));
  end if;

  -- D6 · las cinco versiones: tres conversiones propias, ninguna tocada.
  select count(*) into v_n from core.frozen_conversion fc
    join core.operation_version ov on ov.id = fc.operation_version_id where ov.operation_id = v_op;
  if v_n <> 5 then
    fallos := array_append(fallos, format('D6 la operacion tiene %s conversiones y deberia tener 5 (B1, D1, D2, D3, D5)', v_n));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'D · correcciones:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'D · heredar con misma fecha y moneda; resolver al cambiar fecha o moneda; volver a la base: OK';
end
$d$;

-- ================== E · cero y conversion unica en general ==================
do $e$
declare
  fallos text[] := '{}';
  U1 constant uuid := pg_temp.f('U1');
  v text;
  v_n bigint;
begin
  -- E1 · 0,01 HUF el X1 -> 0,0000274 EUR -> 0 centimos: se acepta, con su
  --      conversion congelada y un efecto de cero.
  v := pg_temp.api('record_personal_expense',
         pg_temp.gasto('f11b5000-0000-4000-8000-00000000e001',
                       jsonb_build_object('currency_definition_id', pg_temp.f('HUF'), 'amount', '1',
                                          'expected_base_currency_definition_id', pg_temp.f('EUR'))), U1);
  if pg_temp.resumen(pg_temp.op(v)) is distinct from
     '1 HUF @2099-03-10 | efecto 0/0 EUR | 2743860612e12 2099-03-10 ecb o=2099-03-09 d=2099-03-09 po=true pd=false' then
    fallos := array_append(fallos, 'E1 importe convertido 0: ' || v);
  end if;

  -- E2 · para CADA version de U1 con efecto: el efecto va en la base del
  --      ambito, y su importe es el original convertido UNA vez con el tipo
  --      congelado, o el original si no hubo conversion. Ni doble conversion ni
  --      importe original etiquetado con la base.
  select count(*) into v_n
    from core.operation_version ov
    join core.effect e on e.operation_version_id = ov.id
    join core.scope s on s.id = e.scope_id
    left join core.frozen_conversion fc on fc.operation_version_id = ov.id and fc.scope_id = e.scope_id
   where ov.created_by = U1
     and (e.currency_definition_id <> s.base_currency_definition_id
          or abs(e.economic_amount) <> case
               when fc.operation_version_id is null then ov.original_amount
               else sec.fx_convert(ov.original_amount, ov.original_currency_definition_id,
                                   fc.target_currency_definition_id, fc.rate_coefficient, fc.rate_scale) end
          or (fc.operation_version_id is null) <> (ov.original_currency_definition_id = s.base_currency_definition_id));
  if v_n <> 0 then
    fallos := array_append(fallos, format('E2 %s efectos no son la conversion unica de su original', v_n));
  end if;
  if (select count(*) from core.operation_version where created_by = U1) < 10 then
    fallos := array_append(fallos, 'E2b el invariante recorrio menos versiones de las esperadas');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'E · cero y conversion unica:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'E · importe convertido 0 aceptado; cada efecto es la conversion unica de su original: OK';
end
$e$;

-- ============================ F · segunda barrera ============================
-- Directamente como el writer, con el actor autor de la version: lo unico que
-- detiene un tipo o una procedencia falsos es la policy.
do $f$
declare
  fallos text[] := '{}';
  U1 constant uuid := pg_temp.f('U1');
  v_ver uuid;
  v text;
  c_ins_fc constant text :=
    'insert into core.frozen_conversion (operation_version_id, scope_id, source_currency_definition_id, '
    'target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date) '
    'values (%L, %L, %L, %L, %s, %s, %L) returning ''OK''';
  c_ins_pv constant text :=
    'insert into core.frozen_conversion_provenance (operation_version_id, scope_id, source_id, method, '
    'origin_reference_date, origin_publication_id, target_reference_date, target_publication_id) '
    'select %L, %L, pv.source_id, pv.method, %L, pv.origin_publication_id, pv.target_reference_date, '
    'pv.target_publication_id from core.frozen_conversion_provenance pv '
    'where pv.operation_version_id = %L returning ''OK''';
begin
  -- La primera version del ingreso B2 (USD, X1), congelada en S1; se usa S2,
  -- otro ambito con base EUR, para una fila que la clave primaria admita.
  select ov.id into v_ver from core.operation_version ov
    join core.movement_detail d on d.operation_version_id = ov.id
   where ov.created_by = U1 and d.concept = 'Cobro' and ov.original_currency_definition_id = pg_temp.f('USD')::uuid
   limit 1;

  -- F1 · un tipo que el resolver no da: rechazado por la policy.
  v := pg_temp.como(format(c_ins_fc, v_ver, pg_temp.f('S2'), pg_temp.f('USD'), pg_temp.f('EUR'),
                           862663906143, 12, pg_temp.f('X1')), 'nomey_writer', U1);
  if v <> 'ERR 42501' then fallos := array_append(fallos, 'F1 tipo distinto del resuelto: ' || v); end if;
  v := pg_temp.como(format(c_ins_fc, v_ver, pg_temp.f('S2'), pg_temp.f('USD'), pg_temp.f('EUR'),
                           86266390614, 11, pg_temp.f('X1')), 'nomey_writer', U1);
  if v <> 'ERR 42501' then fallos := array_append(fallos, 'F1b el mismo valor a otra escala: ' || v); end if;
  -- ... y el que el resolver da, si entra: la barrera no lo bloquea todo.
  v := pg_temp.como(format(c_ins_fc, v_ver, pg_temp.f('S2'), pg_temp.f('USD'), pg_temp.f('EUR'),
                           862663906142, 12, pg_temp.f('X1')), 'nomey_writer', U1);
  if v <> 'OK' then fallos := array_append(fallos, 'F1c el tipo resuelto no entra: ' || v); end if;

  -- F2 · una procedencia que contradice al resolver: rechazada.
  v := pg_temp.como(format(c_ins_pv, v_ver, pg_temp.f('S2'), '2099-03-06', v_ver), 'nomey_writer', U1);
  if v <> 'ERR 42501' then fallos := array_append(fallos, 'F2 procedencia con otra fecha: ' || v); end if;
  v := pg_temp.como(format(c_ins_pv, v_ver, pg_temp.f('S2'), '2099-03-09', v_ver), 'nomey_writer', U1);
  if v <> 'OK' then fallos := array_append(fallos, 'F2b la procedencia verdadera no entra: ' || v); end if;

  -- F3 · ni otro actor puede congelar la version de U1.
  v := pg_temp.como(format(c_ins_fc, v_ver, pg_temp.f('S2'), pg_temp.f('USD'), pg_temp.f('EUR'),
                           862663906142, 12, pg_temp.f('X1')), 'nomey_writer', pg_temp.f('U2')::uuid);
  if v not in ('ERR 42501', 'ERR 23505') then fallos := array_append(fallos, 'F3 otro actor: ' || v); end if;

  -- F4 · insert-only: ni el writer modifica ni borra una conversion o su procedencia.
  foreach v in array array[
    'update core.frozen_conversion set rate_coefficient = rate_coefficient returning ''OK''',
    'delete from core.frozen_conversion returning ''OK''',
    'update core.frozen_conversion_provenance set origin_reference_date = origin_reference_date returning ''OK''',
    'delete from core.frozen_conversion_provenance returning ''OK'''] loop
    if pg_temp.como(v, 'nomey_writer', U1) <> 'ERR 42501' then
      fallos := array_append(fallos, 'F4 el writer puede: ' || left(v, 60));
    end if;
  end loop;

  -- F5 · el cliente no alcanza ni la conversion ni su procedencia.
  if pg_temp.como('select count(*)::text from core.frozen_conversion_provenance', 'authenticated', U1) <> 'ERR 42501' then
    fallos := array_append(fallos, 'F5 el cliente lee la procedencia');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'F · segunda barrera:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'F · tipo y procedencia distintos de los del resolver rechazados, los verdaderos admitidos, insert-only: OK';
end
$f$;

-- ================ G · las clases fuera de F11.B no convierten ================
do $g$
declare
  fallos text[] := '{}';
  U1 constant uuid := pg_temp.f('U1');
begin
  -- G1 · el ajuste sigue rechazando otra moneda, y no admite base asumida.
  if pg_temp.api('record_adjustment', jsonb_build_object(
       'client_operation_id', 'f11b5000-0000-4000-8000-00000000f001', 'command_contract_version', 2,
       'effective_date', pg_temp.f('X1'), 'effective_time', '09:00', 'scope_id', pg_temp.f('S1'),
       'delta', '100', 'currency_definition_id', pg_temp.f('USD')), U1)
     <> 'ERR CURRENCY_CONVERSION_UNSUPPORTED:422' then
    fallos := array_append(fallos, 'G1 el ajuste convierte');
  end if;
  if pg_temp.api('record_adjustment', jsonb_build_object(
       'client_operation_id', 'f11b5000-0000-4000-8000-00000000f002', 'command_contract_version', 2,
       'effective_date', pg_temp.f('X1'), 'effective_time', '09:00', 'scope_id', pg_temp.f('S1'),
       'delta', '100', 'currency_definition_id', pg_temp.f('USD'),
       'expected_base_currency_definition_id', pg_temp.f('EUR')), U1)
     <> 'ERR PAYLOAD_INVALID:400' then
    fallos := array_append(fallos, 'G1b el ajuste admite base asumida');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'G · clases fuera de F11.B:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'G · el ajuste conserva su negativa (el gasto de grupo, en authoritative-writer-debt): OK';
end
$g$;

rollback;
