-- ============================================================================
-- LAS LECTURAS PERSONALES CON MONEDA EXTRANJERA · F11/ADR-001 §12 · F11.C
-- ============================================================================
--
-- Migracion 20261001120000. Contra las lecturas REALES y los writers reales de
-- 20260929120000 (F11.B B5), con identidad simulada, fixtures propias y
-- ROLLBACK.
--
-- Las operaciones con moneda extranjera se crean con los writers de verdad, y
-- eso necesita dias fijados de la fuente real `ecb`. Se siembran COMO POSTGRES,
-- dentro de esta transaccion y en fechas de 2099 que ninguna ingesta real habra
-- fijado: nunca se ingiere un documento sintetico en `ecb`, y la base local de
-- quien ejecute el check queda exactamente como estaba.
--
--   A · la superficie: la columna nueva, los privilegios de la funcion lectora,
--       y que NINGUNA lectura depende del resolver
--   B · sin conversion no cambia nada: las dos monedas coinciden
--   C · con conversion: el original en su moneda y el convertido en la base,
--       en la misma fila, y distintos
--   D · escala distinta: JPY sin decimales en un Personal en EUR
--   E · el tipo congelado y la atribucion salen de la conversion congelada,
--       identicos a `core.frozen_conversion`, por la funcion lectora
--   F · aislamiento: nadie lee la conversion de otro, ni enumera, ni sin JWT
--   G · estadisticas con una operacion extranjera: el desglose deja de sumar
--       el declarado, y `sum(categories) = expense_total` vuelve a cumplirse
--   H · corregir conserva la moneda original; heredar y volver a resolver
--       siguen siendo lo que decidio B5
--   I · lo que queda intacto fuera de F11.C
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
  ('U1',  'f11c0000-0000-4000-8000-0000000000a1'),
  ('U2',  'f11c0000-0000-4000-8000-0000000000a2'),
  ('S1',  'f11c0000-0000-4000-8000-000000000001'),   -- Personal de U1, base EUR
  ('S2',  'f11c0000-0000-4000-8000-000000000002'),   -- Personal de U2, base EUR
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

create function pg_temp.op(p_res text) returns uuid language sql as $op$
  select case when left(p_res, 1) = '{' then (p_res::jsonb ->> 'operation_id')::uuid end;
$op$;

-- Un gasto de U1. Todo lo que cambia de un caso a otro va en `p_extra`.
create function pg_temp.gasto(p_key text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 2,
    'effective_date', pg_temp.f('X1'), 'effective_time', '10:00',
    'scope_id', pg_temp.f('S1'), 'amount', '10000', 'currency_definition_id', pg_temp.f('USD'),
    'concept', 'Cena', 'category_id', pg_temp.f('CAT'),
    'expected_base_currency_definition_id', pg_temp.f('EUR')) || p_extra;
$$;
create function pg_temp.ingreso(p_key text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'effective_date', pg_temp.f('X1'), 'effective_time', '10:00',
    'scope_id', pg_temp.f('S1'), 'amount', '5000', 'currency_definition_id', pg_temp.f('USD'),
    'concept', 'Cobro',
    'expected_base_currency_definition_id', pg_temp.f('EUR')) || p_extra;
$$;

-- Una fila de api.personal_operation como su duenno, resumida en lo que este
-- check vigila: el declarado con SU moneda, y el asentado con la base.
create function pg_temp.fila(p_operation uuid, p_actor uuid) returns text language sql as $$
  select pg_temp.como(format(
    $q$select po.original_amount || ' ' || oc.code
           || ' | asentado ' || po.balance_amount || ' ' || bc.code
         from api.personal_operation po
         join api.currency_definition oc on oc.id = po.original_currency_definition_id
         join api.currency_definition bc on bc.id = po.currency_definition_id
        where po.operation_id = %L$q$, p_operation), 'authenticated', p_actor);
$$;
grant execute on function pg_temp.op(text), pg_temp.fila(uuid, uuid),
                         pg_temp.gasto(text, jsonb), pg_temp.ingreso(text, jsonb)
  to authenticated, nomey_writer;

-- Las operaciones del escenario, creadas con los writers reales.
create temporary table fx_ops (k text primary key, id uuid) on commit drop;
do $crear$
declare v text;
begin
  -- 1 · un gasto en la BASE: el caso que no debe cambiar.
  v := pg_temp.api('record_personal_expense', pg_temp.gasto(
         'f11c0000-0000-4000-8000-000000000101',
         jsonb_build_object('currency_definition_id', pg_temp.f('EUR'), 'amount', '4200')),
       pg_temp.f('U1')::uuid);
  insert into fx_ops values ('EUR_GASTO', pg_temp.op(v));
  -- 2 · un gasto en USD: escala 2 contra escala 2.
  v := pg_temp.api('record_personal_expense', pg_temp.gasto(
         'f11c0000-0000-4000-8000-000000000102', '{}'::jsonb), pg_temp.f('U1')::uuid);
  insert into fx_ops values ('USD_GASTO', pg_temp.op(v));
  -- 3 · un gasto en JPY: escala 0 contra escala 2.
  v := pg_temp.api('record_personal_expense', pg_temp.gasto(
         'f11c0000-0000-4000-8000-000000000103',
         jsonb_build_object('currency_definition_id', pg_temp.f('JPY'), 'amount', '150000')),
       pg_temp.f('U1')::uuid);
  insert into fx_ops values ('JPY_GASTO', pg_temp.op(v));
  -- 4 · un ingreso en USD.
  v := pg_temp.api('record_personal_income', pg_temp.ingreso(
         'f11c0000-0000-4000-8000-000000000104', '{}'::jsonb), pg_temp.f('U1')::uuid);
  insert into fx_ops values ('USD_INGRESO', pg_temp.op(v));
end
$crear$;
grant select on fx_ops to authenticated, nomey_writer;
create function pg_temp.o(p_k text) returns uuid language sql as $$
  select id from fx_ops where k = p_k;
$$;
grant execute on function pg_temp.o(text) to authenticated, nomey_writer;

do $escenario$
declare v_n integer;
begin
  select count(*) into v_n from fx_ops where id is null;
  if v_n > 0 then
    raise exception 'el escenario no se creo: % de 4 operaciones fueron rechazadas', v_n;
  end if;
  -- Y hay conversion de verdad: sin esto, todo lo que sigue pasaria en vacio.
  select count(*) into v_n from core.frozen_conversion fc
   where fc.scope_id = pg_temp.f('S1')::uuid;
  if v_n <> 3 then
    raise exception 'se esperaban 3 conversiones congeladas en el escenario y hay %', v_n;
  end if;
  raise notice 'escenario: 4 operaciones (1 en la base, 3 en moneda extranjera), 3 conversiones congeladas';
end
$escenario$;

-- ==================== A · la superficie, y lo que no alcanza ================
do $a$
declare
  fallos text[] := '{}';
  v_n integer; v_t text;
begin
  -- A1 · la columna nueva, y la de siempre con su significado de siempre.
  select string_agg(column_name || ':' || data_type, ',' order by column_name) into v_t
    from information_schema.columns
   where table_schema = 'api' and table_name = 'personal_operation'
     and column_name in ('currency_definition_id', 'original_currency_definition_id',
                         'original_amount', 'balance_amount');
  if v_t is distinct from 'balance_amount:text,currency_definition_id:uuid,'
                          'original_amount:text,original_currency_definition_id:uuid' then
    fallos := array_append(fallos, 'A1 columnas de personal_operation: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- A2 · la funcion lectora: definer, search_path fijado, y solo authenticated.
  select string_agg(p.prosecdef::text || ':' || pg_get_userbyid(p.proowner)
                    || ':' || coalesce(array_to_string(p.proconfig, '|'), 'sin'), ',') into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'personal_operation_conversion';
  if v_t is distinct from 'true:postgres:search_path=""' then
    fallos := array_append(fallos, 'A2 la funcion lectora no es definer de postgres con search_path fijado: ' || coalesce(v_t, 'no existe'));
  end if;
  if not has_function_privilege('authenticated', 'api.personal_operation_conversion(uuid[])', 'execute') then
    fallos := array_append(fallos, 'A2b authenticated no puede ejecutar la funcion lectora');
  end if;
  if has_function_privilege('anon', 'api.personal_operation_conversion(uuid[])', 'execute')
     or has_function_privilege('public', 'api.personal_operation_conversion(uuid[])', 'execute') then
    fallos := array_append(fallos, 'A2c anon o PUBLIC pueden ejecutar la funcion lectora');
  end if;

  -- A3 · el cliente SIGUE sin ninguna ruta directa a la conversion congelada:
  --      F11.C no concede ni un privilegio sobre esas dos tablas.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core'
     and table_name in ('frozen_conversion', 'frozen_conversion_provenance')
     and grantee in ('authenticated', 'anon', 'nomey_provisioner');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A3 %s privilegios de cliente sobre la conversion congelada', v_n));
  end if;

  -- A4 · NINGUNA LECTURA ALCANZA EL RESOLVER. Dos barreras independientes:
  --      el privilegio no existe, y ninguna definicion lo nombra. La segunda
  --      importa porque la funcion lectora es definer y el privilegio no la
  --      frenaria.
  select string_agg(p.proname, ',' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and p.proname in ('fx_resolve', 'fx_convert', 'fx_derive')
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_t is not null then
    fallos := array_append(fallos, 'A4 authenticated puede ejecutar: ' || v_t);
  end if;
  select string_agg(c.relname, ',' order by c.relname) into v_t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api' and c.relkind = 'v'
     and pg_get_viewdef(c.oid, true) ~ 'fx_(resolve|convert|derive)';
  if v_t is not null then
    fallos := array_append(fallos, 'A4b vistas de api que nombran el resolver: ' || v_t);
  end if;
  select string_agg(p.proname, ',' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api'
     and p.proname in ('personal_statistics', 'personal_operation_conversion',
                       'observed_balance', 'personal_expense_share', 'claimed_dimension')
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'fx_(resolve|convert|derive)';
  if v_t is not null then
    fallos := array_append(fallos, 'A4c lecturas de api que nombran el resolver: ' || v_t);
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'A · superficie:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'A · la moneda original publicada, la lectora acotada, y ninguna lectura alcanza el resolver: OK';
end
$a$;

-- ============ B · sin conversion, la lectura es exactamente la de antes =====
do $b$
declare
  fallos text[] := '{}';
  v_t text;
begin
  -- B1 · un gasto en la base: las dos monedas COINCIDEN, y el declarado y el
  --      asentado son la misma cifra con el signo de la clase.
  v_t := pg_temp.fila(pg_temp.o('EUR_GASTO'), pg_temp.f('U1')::uuid);
  if v_t is distinct from '4200 EUR | asentado -4200 EUR' then
    fallos := array_append(fallos, 'B1 gasto en la base: ' || v_t);
  end if;

  -- B2 · y no hay ninguna conversion congelada que lo acompanne.
  if pg_temp.como(format('select count(*)::text from api.personal_operation_conversion(array[%L]::uuid[])',
                         pg_temp.o('EUR_GASTO')), 'authenticated', pg_temp.f('U1')::uuid) <> '0' then
    fallos := array_append(fallos, 'B2 una operacion sin conversion trae conversion');
  end if;

  -- B3 · el ajuste y las demas clases siguen teniendo las dos monedas iguales
  --      por construccion: sus writers conservan sec.assert_no_conversion.
  if pg_temp.como(
       'select count(*)::text from api.personal_operation'
       ' where original_currency_definition_id is distinct from currency_definition_id'
       '   and operation_class not in (''personal_expense'', ''personal_income'')',
       'authenticated', pg_temp.f('U1')::uuid) <> '0' then
    fallos := array_append(fallos, 'B3 una clase que no convierte tiene dos monedas distintas');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'B · sin conversion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'B · sin conversion las dos monedas coinciden y ninguna cifra cambia: OK';
end
$b$;

-- ====== C · con conversion: cada cifra con SU moneda, en la misma fila ======
do $c$
declare
  fallos text[] := '{}';
  v_t text;
begin
  -- C1 · USD 100,00 en un Personal en EUR. El declarado sigue siendo 10000 en
  --      USD; lo asentado son 86,27 EUR. Las dos cifras y las dos monedas
  --      salen de la misma fila y no se pueden confundir.
  v_t := pg_temp.fila(pg_temp.o('USD_GASTO'), pg_temp.f('U1')::uuid);
  if v_t is distinct from '10000 USD | asentado -8627 EUR' then
    fallos := array_append(fallos, 'C1 gasto en USD: ' || v_t);
  end if;
  v_t := pg_temp.fila(pg_temp.o('USD_INGRESO'), pg_temp.f('U1')::uuid);
  if v_t is distinct from '5000 USD | asentado 4313 EUR' then
    fallos := array_append(fallos, 'C1b ingreso en USD: ' || v_t);
  end if;

  -- C2 · EL IMPORTE ASENTADO ES EL DEL EFECTO, no uno recalculado al leer.
  --      Identico al byte: si la lectura reconstruyera la conversion, un
  --      segundo redondeo podria separarlos y nadie se enteraria.
  select string_agg(t.dif::text, ',') into v_t from (
    select po.balance_amount::bigint - e.balance_amount as dif
      from api.personal_operation po
      join core.effect e on e.operation_version_id = po.current_version_id
     where po.scope_id = pg_temp.f('S1')::uuid) t
   where t.dif <> 0;
  if v_t is not null then
    fallos := array_append(fallos, 'C2 lo publicado no es lo asentado: ' || v_t);
  end if;

  -- C3 · y el declarado NO es el asentado: son cifras distintas de verdad, no
  --      un escenario que pasaria igual sin conversion.
  select count(*)::text into v_t from api.personal_operation po
   where po.scope_id = pg_temp.f('S1')::uuid
     and po.original_currency_definition_id <> po.currency_definition_id
     and abs(po.original_amount::bigint) = abs(po.balance_amount::bigint);
  if v_t <> '0' then
    fallos := array_append(fallos, 'C3 ' || v_t || ' operaciones extranjeras con el declarado igual al asentado');
  end if;

  -- C4 · el historial sigue publicando la moneda ORIGINAL de cada version,
  --      que es lo que ya hacia: ahi `currency_definition_id` nunca fue la del
  --      efecto, y F11.C no lo cambia.
  if pg_temp.como(format(
       'select currency_definition_id::text from api.personal_operation_version'
       ' where operation_id = %L and is_current', pg_temp.o('USD_GASTO')),
     'authenticated', pg_temp.f('U1')::uuid) <> pg_temp.f('USD') then
    fallos := array_append(fallos, 'C4 el historial no publica la moneda original');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'C · con conversion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'C · original con su moneda, asentado con la base, y lo publicado es lo asentado: OK';
end
$c$;

-- ============== D · una escala distinta: JPY sin decimales en EUR ===========
do $d$
declare
  fallos text[] := '{}';
  v_t text;
begin
  -- D1 · 150000 yenes son 150000 unidades minimas (escala 0), y son 840,05
  --      euros (escala 2). Leer el declarado con la escala de la base lo
  --      convertiria en 1.500,00 EUR sin que nada fallara: es el defecto que
  --      cierra F11.C, y aqui las dos escalas van con su moneda.
  v_t := pg_temp.fila(pg_temp.o('JPY_GASTO'), pg_temp.f('U1')::uuid);
  if v_t is distinct from '150000 JPY | asentado -84005 EUR' then
    fallos := array_append(fallos, 'D1 gasto en JPY: ' || v_t);
  end if;

  -- D2 · y la escala de cada moneda es alcanzable por el cliente para
  --      formatear las dos cifras, sin inventarse ninguna.
  if pg_temp.como(format(
       'select oc.scale::text || ''/'' || bc.scale::text from api.personal_operation po'
       ' join api.currency_definition oc on oc.id = po.original_currency_definition_id'
       ' join api.currency_definition bc on bc.id = po.currency_definition_id'
       ' where po.operation_id = %L', pg_temp.o('JPY_GASTO')),
     'authenticated', pg_temp.f('U1')::uuid) <> '0/2' then
    fallos := array_append(fallos, 'D2 las escalas de las dos monedas no son 0 y 2');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'D · escalas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'D · JPY escala 0 contra EUR escala 2, cada cifra con la suya: OK';
end
$d$;

-- ========= E · el tipo y la atribucion salen de la conversion congelada =====
do $e$
declare
  fallos text[] := '{}';
  v_t text; v_n integer;
begin
  -- E1 · lo que devuelve la lectora es, campo a campo, lo que guardaron B5 y
  --      su procedencia. Sin reconstruir nada y sin volver a resolver.
  select count(*) into v_n
    from api.personal_operation_conversion() r
    join core.frozen_conversion fc
      on fc.operation_version_id = r.operation_version_id and fc.scope_id = r.scope_id
    join core.frozen_conversion_provenance pv
      on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
   where r.rate_coefficient = fc.rate_coefficient::text
     and r.rate_scale = fc.rate_scale
     and r.resolved_for_date = fc.resolved_for_date
     and r.source_currency_definition_id = fc.source_currency_definition_id
     and r.target_currency_definition_id = fc.target_currency_definition_id
     and r.source_id = pv.source_id
     and r.origin_reference_date = pv.origin_reference_date
     and r.target_reference_date = pv.target_reference_date;
  if v_n <> 3 then
    fallos := array_append(fallos, format('E1 %s de 3 conversiones coinciden con lo congelado', v_n));
  end if;

  -- E2 · la atribucion es del BCE, y sale de la procedencia, no de una
  --      constante escrita en la lectura.
  select string_agg(distinct r.source_id, ',') into v_t from api.personal_operation_conversion() r;
  if v_t is distinct from 'ecb' then
    fallos := array_append(fallos, 'E2 la fuente atribuida no es ecb: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- E3 · el coeficiente cruza como TEXTO, no como bigint: a 12 decimales de
  --      escala, parsearlo como numero de JSON lo degradaria (F03/ADR-012).
  select string_agg(t.name || ':' || t.typ, ',' order by t.name) into v_t
    from (select p.proargnames[i] as name,
                 format_type(p.proallargtypes[i], null) as typ
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                 generate_subscripts(p.proallargtypes, 1) i
           where n.nspname = 'api' and p.proname = 'personal_operation_conversion') t
   where t.name in ('rate_coefficient', 'rate_scale');
  if v_t is distinct from 'rate_coefficient:text,rate_scale:smallint' then
    fallos := array_append(fallos, 'E3 el tipo publicado del tipo de cambio: ' || coalesce(v_t, 'ninguno'));
  end if;

  -- E4 · y una operacion sin conversion no aparece: la lectora no inventa una
  --      fila con tipo 1 para las que nunca convirtieron.
  select count(*) into v_n from api.personal_operation_conversion(array[pg_temp.o('EUR_GASTO')]);
  if v_n <> 0 then
    fallos := array_append(fallos, 'E4 la lectora devuelve conversion para una operacion sin ella');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'E · conversion congelada:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'E · el tipo y la atribucion al BCE son los congelados, campo a campo, y el tipo cruza como texto: OK';
end
$e$;

-- ================= F · nadie lee la conversion de otro ======================
do $f$
declare
  fallos text[] := '{}';
  v_t text;
begin
  -- F1 · U2 no ve ninguna: ni las suyas, que no tiene, ni las de U1.
  if pg_temp.como('select count(*)::text from api.personal_operation_conversion()',
                  'authenticated', pg_temp.f('U2')::uuid) <> '0' then
    fallos := array_append(fallos, 'F1 U2 ve conversiones');
  end if;

  -- F1b · Y PEDIRLAS POR SU IDENTIFICADOR TAMPOCO. Es la prueba que importa:
  --       la lectora es definer, asi que la RLS no la frena y lo unico que
  --       acota es la propiedad del ambito comprobada en su cuerpo.
  if pg_temp.como(format('select count(*)::text from api.personal_operation_conversion(array[%L]::uuid[])',
                         pg_temp.o('USD_GASTO')), 'authenticated', pg_temp.f('U2')::uuid) <> '0' then
    fallos := array_append(fallos, 'F1c U2 lee la conversion de U1 pidiendola por su id');
  end if;

  -- F2 · sin JWT no hay actor, y sin actor no hay ambito propio que iguale.
  if pg_temp.como('select count(*)::text from api.personal_operation_conversion()',
                  'authenticated', null) <> '0' then
    fallos := array_append(fallos, 'F2 sin JWT salen conversiones');
  end if;

  -- F3 · y la ruta directa sigue cerrada: ni las tablas ni el esquema.
  for v_t in select unnest(array[
    'select count(*)::text from core.frozen_conversion',
    'select count(*)::text from core.frozen_conversion_provenance']) loop
    if pg_temp.como(v_t, 'authenticated', pg_temp.f('U1')::uuid) <> 'ERR 42501' then
      fallos := array_append(fallos, 'F3 el cliente alcanza ' || v_t);
    end if;
  end loop;

  -- F4 · U1 si ve las suyas, para que F1 no pase por estar todo vacio.
  if pg_temp.como('select count(*)::text from api.personal_operation_conversion()',
                  'authenticated', pg_temp.f('U1')::uuid) <> '3' then
    fallos := array_append(fallos, 'F4 U1 no ve sus tres conversiones');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'F · aislamiento:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'F · cada cual ve la suya; ni por id ajeno, ni sin JWT, ni por la tabla: OK';
end
$f$;

-- === G · estadisticas: el desglose deja de sumar el declarado ===============
--
-- Corre ANTES de las correcciones, que cambian los importes del escenario.
do $g$
declare
  fallos text[] := '{}';
  v_st jsonb; v_cat bigint; v_dec bigint;
begin
  v_st := pg_temp.como('select api.personal_statistics(null, null)::text',
                       'authenticated', pg_temp.f('U1')::uuid)::jsonb;

  -- G1 · los dos totales, en la base, con la magnitud economica convertida.
  --      4200 propios + 8627 (USD 100,00) + 84005 (JPY 150000) = 96832.
  if (v_st ->> 'expense_total') <> '96832' then
    fallos := array_append(fallos, 'G1 expense_total ' || (v_st ->> 'expense_total') || ' y no 96832');
  end if;
  if (v_st ->> 'income_total') <> '4313' then
    fallos := array_append(fallos, 'G1b income_total ' || (v_st ->> 'income_total') || ' y no 4313');
  end if;
  if (v_st ->> 'currency_definition_id') <> pg_temp.f('EUR') then
    fallos := array_append(fallos, 'G1c las estadisticas no van en la base del ambito');
  end if;

  -- G2 · EL INVARIANTE DE F06/ADR-008 §6, con una operacion extranjera dentro.
  select sum((c ->> 'expense_total')::bigint) into v_cat
    from jsonb_array_elements(v_st -> 'categories') c;
  if v_cat is distinct from (v_st ->> 'expense_total')::bigint then
    fallos := array_append(fallos, format('G2 el desglose suma %s y el total es %s', v_cat, v_st ->> 'expense_total'));
  end if;

  -- G3 · Y NO PASA EN VACIO: sumar el declarado, que es lo que se hacia hasta
  --      F11.C, habria dado 164200 —yenes y dolares contados como euros—.
  --      Si alguna vez vuelven a coincidir, es que el escenario perdio su
  --      operacion extranjera y este check ya no comprueba nada.
  select sum(ov.original_amount) into v_dec
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.effect e on e.operation_version_id = ov.id
   where e.scope_id = pg_temp.f('S1')::uuid and o.operation_class = 'personal_expense';
  if v_dec <> 164200 then
    fallos := array_append(fallos, format('G3 la suma de los declarados es %s y no 164200: el escenario cambio', v_dec));
  end if;
  if v_dec = v_cat then
    fallos := array_append(fallos, 'G3b el desglose coincide con la suma de los declarados: no hay conversion en el escenario');
  end if;

  -- G4 · una categoria, tres operaciones: el recuento no cambia al cambiar de
  --      donde sale la magnitud.
  if (v_st -> 'categories' -> 0 ->> 'operation_count') <> '3' then
    fallos := array_append(fallos, 'G4 operation_count ' || (v_st -> 'categories' -> 0 ->> 'operation_count'));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'G · estadisticas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'G · totales y desglose en la magnitud convertida, invariante cumplido y escenario con conversion real: OK';
end
$g$;

-- ====== H · corregir conserva la moneda original; B5 sigue mandando =========
do $h$
declare
  fallos text[] := '{}';
  v_op uuid := pg_temp.o('USD_GASTO');
  v_ver uuid; v_t text; v_tipo text; v_antes text;
begin
  select rate_coefficient || 'e' || rate_scale || ' @' || resolved_for_date into v_antes
    from core.frozen_conversion fc join core.operation o on o.current_version_id = fc.operation_version_id
   where o.id = v_op;

  -- H1 · MISMA FECHA Y MISMA MONEDA: la moneda original se conserva —no se
  --      sustituye por la base— y el tipo se HEREDA, tal cual decidio B5.
  v_ver := (select current_version_id from core.operation where id = v_op);
  v_t := pg_temp.api('record_personal_expense', pg_temp.gasto(
           'f11c0000-0000-4000-8000-000000000201',
           jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver, 'amount', '20000')),
         pg_temp.f('U1')::uuid);
  if pg_temp.op(v_t) is null then
    fallos := array_append(fallos, 'H1 la correccion fue rechazada: ' || v_t);
  end if;
  v_t := pg_temp.fila(v_op, pg_temp.f('U1')::uuid);
  if v_t is distinct from '20000 USD | asentado -17253 EUR' then
    fallos := array_append(fallos, 'H1b tras corregir: ' || v_t);
  end if;
  select rate_coefficient || 'e' || rate_scale || ' @' || resolved_for_date into v_tipo
    from core.frozen_conversion fc join core.operation o on o.current_version_id = fc.operation_version_id
   where o.id = v_op;
  if v_tipo is distinct from v_antes then
    fallos := array_append(fallos, format('H1c el tipo no se heredo: %s -> %s', v_antes, v_tipo));
  end if;

  -- H2 · CAMBIA LA FECHA: se vuelve a resolver, con el tipo del dia nuevo, y
  --      la moneda original sigue siendo USD.
  v_ver := (select current_version_id from core.operation where id = v_op);
  v_t := pg_temp.api('record_personal_expense', pg_temp.gasto(
           'f11c0000-0000-4000-8000-000000000202',
           jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver, 'amount', '20000',
                              'effective_date', pg_temp.f('X2'))), pg_temp.f('U1')::uuid);
  if pg_temp.op(v_t) is null then
    fallos := array_append(fallos, 'H2 la correccion con otra fecha fue rechazada: ' || v_t);
  end if;
  v_t := pg_temp.fila(v_op, pg_temp.f('U1')::uuid);
  if v_t is distinct from '20000 USD | asentado -16667 EUR' then
    fallos := array_append(fallos, 'H2b tras cambiar la fecha: ' || v_t);
  end if;
  select rate_coefficient || 'e' || rate_scale || ' @' || resolved_for_date into v_tipo
    from core.frozen_conversion fc join core.operation o on o.current_version_id = fc.operation_version_id
   where o.id = v_op;
  if v_tipo is distinct from '833333333333e12 @' || pg_temp.f('X2') then
    fallos := array_append(fallos, 'H2c el tipo del dia nuevo: ' || coalesce(v_tipo, 'ninguno'));
  end if;

  -- H3 · Y LA LECTORA SIGUE A LA VERSION VIGENTE: devuelve el tipo nuevo, uno
  --      solo, y no el heredado de la version superada.
  if pg_temp.como(format(
       'select string_agg(rate_coefficient, '','') from api.personal_operation_conversion(array[%L]::uuid[])',
       v_op), 'authenticated', pg_temp.f('U1')::uuid) <> '833333333333' then
    fallos := array_append(fallos, 'H3 la lectora no sigue a la version vigente');
  end if;

  -- H4 · volver a la BASE es una operacion sin conversion, y la lectura lo
  --      dice: las dos monedas vuelven a coincidir y no queda tipo que leer.
  v_ver := (select current_version_id from core.operation where id = v_op);
  v_t := pg_temp.api('record_personal_expense', pg_temp.gasto(
           'f11c0000-0000-4000-8000-000000000203',
           jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver, 'amount', '20000',
                              'effective_date', pg_temp.f('X2'),
                              'currency_definition_id', pg_temp.f('EUR'))), pg_temp.f('U1')::uuid);
  if pg_temp.op(v_t) is null then
    fallos := array_append(fallos, 'H4 volver a la base fue rechazado: ' || v_t);
  end if;
  v_t := pg_temp.fila(v_op, pg_temp.f('U1')::uuid);
  if v_t is distinct from '20000 EUR | asentado -20000 EUR' then
    fallos := array_append(fallos, 'H4b tras volver a la base: ' || v_t);
  end if;
  if pg_temp.como(format('select count(*)::text from api.personal_operation_conversion(array[%L]::uuid[])', v_op),
                  'authenticated', pg_temp.f('U1')::uuid) <> '0' then
    fallos := array_append(fallos, 'H4c sigue habiendo conversion tras volver a la base');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'H · correcciones:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'H · corregir conserva la moneda original; heredar, volver a resolver y volver a la base se leen bien: OK';
end
$h$;

-- ============== I · lo que F11.C no toca, y se comprueba que no ============
do $i$
declare
  fallos text[] := '{}';
  v_t text; v_n integer;
begin
  -- I1 · `api.group_operation` publica la moneda original DESDE F11.D
  --      (20261002120000): cuando este bloque se escribio todavia no lo hacia,
  --      porque ningun gasto de grupo admitia otra moneda. Su comportamiento
  --      se mide en fx-group-expense.sql; aqui solo se comprueba que la
  --      columna sigue estando, para que nadie la retire sin darse cuenta.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'api' and table_name = 'group_operation'
                    and column_name = 'original_currency_definition_id') then
    fallos := array_append(fallos, 'I1 group_operation dejo de publicar la moneda original');
  end if;

  -- I2 · las otras lecturas personales, con su lista de columnas de siempre.
  select string_agg(t.v, ' ; ' order by t.v) into v_t from (
    select table_name || '=' || string_agg(column_name, ',' order by column_name) as v
      from information_schema.columns
     where table_schema = 'api'
       and table_name in ('personal_balance', 'personal_effect', 'personal_operation_version')
     group by table_name) t;
  if v_t is distinct from
       'personal_balance=balance_amount,currency_definition_id,scope_id ; '
       'personal_effect=accounting_class,balance_amount,currency_definition_id,economic_amount,effective_date,id,scope_id ; '
       'personal_operation_version=category_id,concept,currency_definition_id,effective_date,effective_time,is_current,'
       'operation_class,operation_id,operation_version_id,original_amount,supersedes_version_id,target_balance,version_created_at,version_no' then
    fallos := array_append(fallos, 'I2 las columnas de las otras lecturas personales cambiaron: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- I3 · LA CUOTA COMPARTIDA SIGUE COMO ESTABA, a proposito. Entra en las
  --      estadisticas en la moneda del GRUPO, que es el defecto que F11.D
  --      tiene que resolver; arreglarlo aqui seria invadirlo.
  if pg_get_functiondef('sec.my_shared_expense_shares(date, date)'::regprocedure) ~ 'frozen_conversion' then
    fallos := array_append(fallos, 'I3 la cuota compartida ya consulta la conversion congelada: eso es F11.D');
  end if;
  if pg_get_functiondef('api.personal_statistics(date, date)'::regprocedure) !~ 'my_shared_expense_shares' then
    fallos := array_append(fallos, 'I3b las estadisticas dejaron de sumar la cuota compartida');
  end if;

  -- I4 · los writers de B5, sin tocar: siguen resolviendo por su helper y
  --      siendo los dos unicos que convierten.
  select string_agg(p.proname, ',' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'fx_personal_rate';
  if v_t is distinct from 'record_group_expense,record_personal_expense,record_personal_income' then
    fallos := array_append(fallos, 'I4 los writers que convierten: ' || coalesce(v_t, 'ninguno'));
  end if;

  -- I5 · y F11.C no concedio NI UN privilegio nuevo sobre `core`: el cliente
  --      sigue sin USAGE, y las dos tablas de la conversion sin grants.
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := array_append(fallos, 'I5 authenticated gano USAGE sobre core');
  end if;
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and grantee = 'anon';
  if v_n <> 0 then
    fallos := array_append(fallos, format('I5b anon gano %s privilegios sobre core', v_n));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'I · lo que no se toca:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'I · group_operation, las otras lecturas, la cuota compartida y los writers de B5, intactos: OK';
end
$i$;

rollback;

\echo 'fx-personal-reads: OK'
