-- ============================================================================
-- RESOLVER, DERIVACION Y CONVERSION FX · F11/ADR-001 §6-§7 · F11/ADR-002
-- ============================================================================
--
-- Migracion 20260925120000 (F11.B, M3). Contra las funciones REALES, con
-- fuentes de fixture (la fuente real `ecb` solo se usa para ARS, COP y CLP, que
-- no dependen de ningun dato guardado) y ROLLBACK. EXIGE el prologo de
-- vectores:
--
--   { ./scripts/vectors-prelude.sh ; cat supabase/checks/fx-resolution.sql ; } \
--     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--         -X -q -v ON_ERROR_STOP=1
--
--   A · catalogo: cinco funciones sin DEFINER, solo el writer las ejecuta, el
--       writer solo lee lo que resuelve, nada de api cambia, nada escribe
--   B · paridad del redondeo con rounding.json
--   C · paridad de la derivacion y la conversion con fx-derivation.json, con
--       las cotizaciones leidas por la propia ingesta (sin tercer parser)
--   D · paridad de la conversion con conversion.json
--   E · paridad del decimal de la fuente con fx-source-decimal.json, a traves
--       de la ingesta
--   F · paridad de la fecha efectiva con fx-dates.json
--   G · resolucion de extremo a extremo sobre dias fijados: R, P, K = 1,
--       cobertura, inicio y fin, 422 frente a 503, ARS/COP/CLP, primera fecha,
--       cero aceptado, rango, determinismo y que el resolver no escribe
--   H · como cada rol: el writer resuelve de verdad, nadie mas ejecuta nada

\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

-- Ejecuta <sql> como <role> y devuelve su primer valor, o el resultado de un
-- rechazo: 'ERR CODIGO:estado' si es un error de frontera, 'ERR sqlstate' si no.
create function pg_temp.as_role(p_sql text, p_role text) returns text
language plpgsql as $$
declare
  v text;
  v_msg text;
  v_det text;
begin
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

create function pg_temp.q(p_sql text) returns text language sql as $$
  select pg_temp.as_role(p_sql, 'postgres');
$$;

grant execute on function pg_temp.super(), pg_temp.as_role(text, text), pg_temp.q(text)
  to anon, authenticated, nomey_writer, nomey_provisioner, nomey_fx_ingest;

create function pg_temp.env(p_body text) returns text language sql as $$
  select '<?xml version="1.0" encoding="UTF-8"?>'
      || '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"'
      || ' xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">'
      || '<gesmes:subject>Reference rates</gesmes:subject>'
      || '<gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>'
      || '<Cube>' || p_body || '</Cube></gesmes:Envelope>';
$$;
create function pg_temp.dia(p_date text, p_rates text) returns text language sql as $$
  select '<Cube time="' || p_date || '">' || p_rates || '</Cube>';
$$;
create function pg_temp.t(p_code text, p_rate text) returns text language sql as $$
  select '<Cube currency="' || p_code || '" rate="' || p_rate || '"/>';
$$;
create function pg_temp.berlin(p_local text) returns timestamptz language sql as $$
  select p_local::timestamp at time zone 'Europe/Berlin';
$$;
create function pg_temp.ingerir(p_source text, p_body text, p_at timestamptz) returns jsonb language sql as $$
  select sec.fx_ingest_at(p_source, pg_temp.env(p_body),
    '{"url":"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml","status":200}'::jsonb, p_at);
$$;
create function pg_temp.fuente(p_id text, p_first date) returns void language sql as $$
  insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url)
  values (p_id, 'fixture', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', p_first, 'https://www.ecb.europa.eu/');
$$;
create function pg_temp.cubre(p_source text, p_currency uuid, p_code text, p_from date, p_until date default null)
returns void language sql as $$
  insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from, valid_until,
                                valid_from_basis, valid_from_evidence, valid_until_basis, valid_until_evidence)
  values (p_source, p_currency, p_code, p_from, p_until, 'fixture', 'https://www.ecb.europa.eu/',
          case when p_until is not null then 'fixture' end,
          case when p_until is not null then 'https://www.ecb.europa.eu/' end);
$$;
-- sec.fx_resolve reducido a texto: 'coeficiente/escala/fecha_o/fecha_d/pub_o?/pub_d?' o el rechazo.
create function pg_temp.resolver(p_date text, p_origin uuid, p_target uuid, p_source text, p_role text default 'postgres')
returns text language sql as $$
  select pg_temp.as_role(format(
    'select r.rate_coefficient || ''/'' || r.rate_scale || ''/'' || r.origin_reference_date || ''/'' '
    '|| r.target_reference_date || ''/'' || (r.origin_publication_id is not null) || ''/'' '
    '|| (r.target_publication_id is not null) || ''/'' || r.source_id '
    'from sec.fx_resolve(%L::date, %L::uuid, %L::uuid, %L) r', p_date, p_origin, p_target, p_source), p_role);
$$;
grant execute on function pg_temp.resolver(text, uuid, uuid, text, text) to nomey_writer;

-- ============================== A · catalogo =================================
do $a$
declare
  fallos text[] := '{}';
  v_t text;
  v_n int;
  v_fn text;
  c_fns constant text[] := array[
    'sec.fx_divide_round(numeric,numeric)', 'sec.fx_pow10(integer)',
    'sec.fx_derive(bigint,integer,bigint,integer)',
    'sec.fx_convert(bigint,uuid,uuid,bigint,integer)',
    'sec.fx_resolve(date,uuid,uuid,text)'];
begin
  -- A1 · las cinco: ni DEFINER, de postgres, search_path vacio, y ninguna
  --      VOLATILE. PostgreSQL rechaza cualquier escritura dentro de una funcion
  --      STABLE o IMMUTABLE: es la garantia de que el resolver no escribe.
  foreach v_fn in array c_fns loop
    select case when p.prosecdef then 'definer' else 'invoker' end || ':' || pg_get_userbyid(p.proowner)
           || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':' || p.provolatile::text
      into v_t from pg_proc p where p.oid = v_fn::regprocedure;
    if v_t is null
       or v_t not like 'invoker:postgres:search_path="":%'
       or right(v_t, 1) = 'v' then
      fallos := array_append(fallos, format('A1 %s: %s', v_fn, coalesce(v_t, 'ausente')));
    end if;
    if pg_get_functiondef(v_fn::regprocedure) ~* '\m(insert|update|delete|truncate|merge)\M' then
      fallos := array_append(fallos, format('A1b %s contiene una sentencia de escritura', v_fn));
    end if;
  end loop;

  -- A2 · EXECUTE: el writer, y nadie mas.
  foreach v_fn in array c_fns loop
    if not has_function_privilege('nomey_writer', v_fn, 'EXECUTE') then
      fallos := array_append(fallos, format('A2 el writer no ejecuta %s', v_fn));
    end if;
    select string_agg(r, ',') into v_t
      from unnest(array['public', 'anon', 'authenticated', 'service_role',
                        'nomey_provisioner', 'nomey_fx_ingest']) r
     where has_function_privilege(r, v_fn, 'EXECUTE');
    if v_t is not null then
      fallos := array_append(fallos, format('A2b %s ejecutable por %s', v_fn, v_t));
    end if;
    select string_agg(g.rolname, ',' order by g.rolname) into v_t
      from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
     where p.oid = v_fn::regprocedure and a.grantee <> p.proowner;
    if v_t is distinct from 'nomey_writer' then
      fallos := array_append(fallos, format('A2c %s concedida a %s', v_fn, coalesce(v_t, 'nadie')));
    end if;
  end loop;

  -- A3 · el writer, sobre FX: SELECT exactamente de lo que resuelve, nada mas.
  select string_agg(c.relname || '=' || a.privilege_type, ',' order by c.relname, a.privilege_type)
    into v_t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'core' and c.relname like 'fx\_%' and a.grantee = 'nomey_writer'::regrole;
  if v_t is distinct from 'fx_coverage=SELECT,fx_day=SELECT,fx_day_rate=SELECT,'
                          'fx_publication_rate=SELECT,fx_source=SELECT' then
    fallos := array_append(fallos, 'A3 privilegios del writer en FX: ' || coalesce(v_t, 'ninguno'));
  end if;

  -- A4 · y cada SELECT nuevo con su policy de lectura, una por tabla.
  select string_agg(c.relname || ':' || p.polname || ':' || pg_get_expr(p.polqual, p.polrelid),
                    ',' order by c.relname)
    into v_t
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relnamespace = 'core'::regnamespace
     and c.relname in ('fx_day', 'fx_day_rate', 'fx_publication_rate')
     and 'nomey_writer'::regrole = any (p.polroles);
  if v_t is distinct from 'fx_day:fx_day_writer_read:true,fx_day_rate:fx_day_rate_writer_read:true,'
                          'fx_publication_rate:fx_publication_rate_writer_read:true' then
    fallos := array_append(fallos, 'A4 policies del writer: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- A5 · 9 record_*, y el resolver y la conversion solo los usan los dos
  --      writers personales de F11.B (20260929120000): ninguna otra clase
  --      convierte. frozen_conversion se escribe solo con la segunda barrera, y
  --      la procedencia vive en su propia tabla.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname like 'record\_%';
  if v_n <> 9 then
    fallos := array_append(fallos, format('A5 hay %s funciones api.record_*', v_n));
  end if;
  select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text collate "C") into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('api', 'sec') and p.proname not like 'fx\_%'
     and (p.prosrc like '%fx\_resolve%' or p.prosrc like '%fx\_convert%' or p.prosrc like '%fx\_derive%'
          or p.prosrc like '%fx\_personal\_rate%');
  -- Tres desde F11.D: el gasto de grupo convierte, y sus dos ayudantes del
  -- reparto y de la congelacion viven en `sec`.
  if v_t is distinct from 'api.record_group_expense(jsonb),api.record_personal_expense(jsonb),'
                          'api.record_personal_income(jsonb),'
                          'sec.persist_group_conversions(uuid,uuid,date,uuid,uuid[],uuid)' then
    fallos := array_append(fallos, 'A5b funciones que convierten: ' || coalesce(v_t, 'ninguna'));
  end if;
  if not has_table_privilege('nomey_writer', 'core.frozen_conversion', 'insert')
     or not exists (select 1 from pg_policy p
                     where p.polrelid = 'core.frozen_conversion'::regclass and p.polcmd = 'a'
                       and pg_get_expr(p.polwithcheck, p.polrelid) like '%fx_resolve%') then
    fallos := array_append(fallos,
      'A5c: el INSERT sobre core.frozen_conversion no es el de F11.B, con la segunda barrera en su policy');
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'core'
                  and table_name = 'frozen_conversion_provenance') then
    fallos := array_append(fallos, 'A5d falta la procedencia persistida de 20260929120000');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'A · catalogo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'A · cinco funciones sin DEFINER ni VOLATILE, solo el writer ejecuta, lectura exacta, nada cambia en api: OK';
end
$a$;

-- ================== B · redondeo · paridad con rounding.json =================
do $b$
declare
  fallos text[] := '{}';
  v_case jsonb;
  v_n int := 0;
  v_got text;
begin
  for v_case in select jsonb_array_elements((select doc from vector_doc where name = 'rounding') -> 'cases') loop
    v_n := v_n + 1;
    v_got := pg_temp.q(format('select sec.fx_divide_round(%s, %s)::text',
                              v_case -> 'given' ->> 'numerator', v_case -> 'given' ->> 'denominator'));
    if v_got is distinct from v_case -> 'expect' ->> 'result' then
      fallos := array_append(fallos, format('%s: esperaba %s y dio %s', v_case ->> 'id', v_case -> 'expect' ->> 'result', v_got));
    end if;
  end loop;
  -- Y lo que el dominio no admite, tampoco aqui.
  if pg_temp.q('select sec.fx_divide_round(1, 0)::text') <> 'ERR 22012' then
    fallos := array_append(fallos, 'B2 division por cero aceptada');
  end if;
  if pg_temp.q('select sec.fx_divide_round(1.5, 2)::text') <> 'ERR 22023' then
    fallos := array_append(fallos, 'B3 operando no entero aceptado');
  end if;
  if v_n < 10 then
    fallos := array_append(fallos, format('B4 solo %s casos de rounding.json', v_n));
  end if;
  if cardinality(fallos) > 0 then
    raise exception E'B · redondeo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'B · sec.fx_divide_round reproduce los % casos de rounding.json: OK', v_n;
end
$b$;

-- ======== C · derivacion y conversion · paridad con fx-derivation.json ========
-- Las cotizaciones de los vectores son texto de la fuente. Se convierten a
-- (coeficiente, escala) con la PROPIA INGESTA: un documento con todas ellas,
-- una por codigo sintetico. Asi no existe un tercer parser.
do $c$
declare
  fallos text[] := '{}';
  v_doc   jsonb := (select doc from vector_doc where name = 'fx-derivation');
  v_quotes text[];
  v_body  text := '';
  v_i     int;
  v_case  jsonb;
  v_n     int := 0;
  v_o     record;
  v_d     record;
  v_got   text;
  v_want  text;
  v_res   jsonb;
begin
  select array_agg(distinct q order by q) into v_quotes
    from (select c -> 'given' -> 'origin' ->> 'quote' as q from jsonb_array_elements(v_doc -> 'cases') c
          union all
          select c -> 'given' -> 'target' ->> 'quote' from jsonb_array_elements(v_doc -> 'cases') c) s;
  for v_i in 1 .. cardinality(v_quotes) loop
    v_body := v_body || pg_temp.t('Q' || chr(64 + (v_i - 1) / 26 + 1) || chr(65 + (v_i - 1) % 26), v_quotes[v_i]);
  end loop;
  perform pg_temp.fuente('par_q', '2026-01-01');
  v_res := pg_temp.ingerir('par_q', pg_temp.dia('2026-01-01', v_body), pg_temp.berlin('2026-01-01 23:00'));
  if not (v_res ->> 'complete')::boolean then
    raise exception 'C · las cotizaciones de los vectores no se ingirieron: %', v_res;
  end if;

  create temp table cotizacion on commit drop as
  select v_quotes[i] as quote, r.coefficient, r.scale
    from generate_subscripts(v_quotes, 1) i
    join core.fx_publication_rate r
      on r.source_code = 'Q' || chr(64 + (i - 1) / 26 + 1) || chr(65 + (i - 1) % 26)
    join core.fx_publication p on p.id = r.publication_id and p.source_id = 'par_q';

  for v_case in select jsonb_array_elements(v_doc -> 'cases') loop
    v_n := v_n + 1;
    select * into v_o from cotizacion where quote = v_case -> 'given' -> 'origin' ->> 'quote';
    select * into v_d from cotizacion where quote = v_case -> 'given' -> 'target' ->> 'quote';
    v_got := pg_temp.q(format('select sec.fx_derive(%s, %s, %s, %s)::text',
                              v_o.coefficient, v_o.scale, v_d.coefficient, v_d.scale));

    if v_case ? 'expectError' then
      -- RATE_OUT_OF_RANGE del dominio es FX_CONVERSION_OUT_OF_RANGE · 422 en la frontera.
      if v_case ->> 'expectError' <> 'RATE_OUT_OF_RANGE' or v_got <> 'ERR FX_CONVERSION_OUT_OF_RANGE:422' then
        fallos := array_append(fallos, format('%s: esperaba FX_CONVERSION_OUT_OF_RANGE y dio %s', v_case ->> 'id', v_got));
      end if;
      continue;
    end if;
    if v_got is distinct from v_case -> 'expect' -> 'rate' ->> 'coefficient'
       or (v_case -> 'expect' -> 'rate' ->> 'scale')::int <> 12 then
      fallos := array_append(fallos, format('%s: tipo %s, esperado %s', v_case ->> 'id', v_got,
                                            v_case -> 'expect' -> 'rate' ->> 'coefficient'));
      continue;
    end if;

    if v_case -> 'given' ? 'amount' then
      v_got := pg_temp.q(format('select sec.fx_convert(%s, %L::uuid, %L::uuid, %s, 12)::text',
                                v_case -> 'given' ->> 'amount',
                                v_doc -> 'catalogue' -> (v_case -> 'given' -> 'origin' ->> 'currency') ->> 'id',
                                v_doc -> 'catalogue' -> (v_case -> 'given' -> 'target' ->> 'currency') ->> 'id',
                                v_case -> 'expect' -> 'rate' ->> 'coefficient'));
      v_want := case when v_case ? 'expectConversionError' then 'ERR FX_CONVERSION_OUT_OF_RANGE:422'
                     else v_case -> 'expect' ->> 'converted' end;
      if v_case ? 'expectConversionError' and v_case ->> 'expectConversionError' <> 'CONVERSION_OUT_OF_RANGE' then
        v_want := 'codigo de vector desconocido';
      end if;
      if v_got is distinct from v_want then
        fallos := array_append(fallos, format('%s: conversion %s, esperada %s', v_case ->> 'id', v_got, v_want));
      end if;
    end if;
  end loop;

  if v_n <> jsonb_array_length(v_doc -> 'cases') or v_n < 20 then
    fallos := array_append(fallos, format('C · %s casos recorridos', v_n));
  end if;
  if cardinality(fallos) > 0 then
    raise exception E'C · fx-derivation.json:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'C · derivacion y conversion reproducen los % casos de fx-derivation.json: OK', v_n;
end
$c$;

-- =================== D · conversion · paridad con conversion.json ============
-- Las definiciones del vector (currencies.json) no son las del catalogo: se
-- crean como fixtures con su escala. El caso de identidad incoherente es solo
-- del dominio: en SQL la escala sale del catalogo por la identidad, y dos
-- escalas para una misma identidad no pueden existir.
do $d$
declare
  fallos text[] := '{}';
  v_cur  jsonb := (select doc -> 'currencies' from vector_doc where name = 'currencies');
  v_case jsonb;
  v_key  text;
  v_n    int := 0;
  v_skip int := 0;
  v_got  text;
begin
  create temp table def_vector (key text primary key, id uuid) on commit drop;
  for v_key in select jsonb_object_keys(v_cur) loop
    if v_key in ('eurBadScale', 'eurBadCode') then continue; end if;
    insert into def_vector values (v_key, md5('fx-resolution/' || v_key)::uuid);
    insert into core.currency_definition (id, code, scale)
    values (md5('fx-resolution/' || v_key)::uuid, v_cur -> v_key ->> 'code', (v_cur -> v_key ->> 'scale')::smallint);
  end loop;

  for v_case in select jsonb_array_elements((select doc from vector_doc where name = 'conversion') -> 'cases') loop
    if v_case ? 'expectError' then
      if v_case ->> 'expectError' <> 'CURRENCY_DEFINITION_INCONSISTENT' then
        fallos := array_append(fallos, format('%s: error de vector sin equivalente SQL: %s', v_case ->> 'id', v_case ->> 'expectError'));
      end if;
      v_skip := v_skip + 1;
      continue;
    end if;
    v_n := v_n + 1;
    v_got := pg_temp.q(format('select sec.fx_convert(%s, %L::uuid, %L::uuid, %s, %s)::text',
                              v_case -> 'given' ->> 'amount',
                              (select id from def_vector where key = v_case -> 'given' ->> 'from'),
                              (select id from def_vector where key = v_case -> 'given' ->> 'to'),
                              v_case -> 'given' -> 'rate' ->> 'coefficient',
                              v_case -> 'given' -> 'rate' ->> 'scale'));
    if v_got is distinct from v_case -> 'expect' ->> 'result' then
      fallos := array_append(fallos, format('%s: esperaba %s y dio %s', v_case ->> 'id', v_case -> 'expect' ->> 'result', v_got));
    end if;
  end loop;
  if v_n < 7 then
    fallos := array_append(fallos, format('D · solo %s casos', v_n));
  end if;
  if cardinality(fallos) > 0 then
    raise exception E'D · conversion.json:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'D · sec.fx_convert reproduce los % casos de conversion.json (% solo de dominio): OK', v_n, v_skip;
end
$d$;

-- ======= E · decimal de la fuente · paridad con fx-source-decimal.json =======
-- A traves de la ingesta real: un documento por caso, cada uno en su fuente.
do $e$
declare
  fallos text[] := '{}';
  v_case jsonb;
  v_n    int := 0;
  v_src  text;
  v_res  jsonb;
  v_got  text;
  v_want text;
begin
  for v_case in select jsonb_array_elements((select doc from vector_doc where name = 'fx-source-decimal') -> 'cases') loop
    v_n := v_n + 1;
    v_src := 'sd_' || v_n;
    perform pg_temp.fuente(v_src, '2026-01-01');
    v_res := pg_temp.ingerir(v_src, pg_temp.dia('2026-01-01', pg_temp.t('USD', v_case -> 'given' ->> 'text')),
                             pg_temp.berlin('2026-01-01 23:00'));
    if v_case ? 'expectError' then
      v_want := case v_case ->> 'expectError'
                  when 'RATE_DECIMAL_INVALID' then 'rate_decimal_invalid'
                  when 'RATE_NOT_POSITIVE'    then 'rate_not_positive'
                  when 'RATE_OUT_OF_RANGE'    then 'rate_out_of_range' end;
      v_got := case when (v_res ->> 'complete')::boolean then 'completa' else v_res ->> 'reason' end;
    else
      v_want := (v_case -> 'expect' ->> 'coefficient') || 'e' || (v_case -> 'expect' ->> 'scale');
      select r.coefficient || 'e' || r.scale into v_got
        from core.fx_publication_rate r join core.fx_publication p on p.id = r.publication_id
       where p.source_id = v_src and r.source_code = 'USD';
    end if;
    if v_got is distinct from v_want then
      fallos := array_append(fallos, format('%s (%L): esperaba %s y dio %s', v_case ->> 'id', v_case -> 'given' ->> 'text', v_want, coalesce(v_got, v_res::text)));
    end if;
  end loop;
  if cardinality(fallos) > 0 then
    raise exception E'E · fx-source-decimal.json:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'E · la ingesta reproduce los % casos de fx-source-decimal.json: OK', v_n;
end
$e$;

-- ================ F · fecha efectiva · paridad con fx-dates.json ==============
-- Sobre una fuente sin ningun dia fijado y con USD y EUR cubiertos: lo que el
-- dominio llama «resoluble» espera (503); «payload_invalid» es 400; «sin
-- publicacion de referencia» es 422 y no espera.
do $f$
declare
  fallos text[] := '{}';
  v_doc  jsonb := (select doc from vector_doc where name = 'fx-dates');
  v_case jsonb;
  v_n    int := 0;
  v_skip int := 0;
  v_got  text;
  v_want text;
  c_usd constant uuid := '34cb8424-2243-52d8-be99-e2b7d22884b8';
  c_eur constant uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
begin
  perform pg_temp.fuente('fechas_f', (v_doc ->> 'sourceFirstReferenceDate')::date);
  perform pg_temp.cubre('fechas_f', c_eur, null, (v_doc ->> 'sourceFirstReferenceDate')::date);
  perform pg_temp.cubre('fechas_f', c_usd, 'USD', (v_doc ->> 'sourceFirstReferenceDate')::date);

  for v_case in select jsonb_array_elements(v_doc -> 'cases') loop
    if v_case ->> 'scope' = 'domain' then v_skip := v_skip + 1; continue; end if;
    v_n := v_n + 1;
    v_want := case v_case -> 'expect' ->> 'classification'
                when 'payload_invalid'          then 'ERR PAYLOAD_INVALID:400'
                when 'no_reference_publication' then 'ERR FX_CURRENCY_NOT_COVERED:422'
                when 'resolvable'               then 'ERR FX_RATE_NOT_YET_AVAILABLE:503' end;
    v_got := pg_temp.resolver(v_case -> 'given' ->> 'effectiveDate', c_usd, c_eur, 'fechas_f');
    if v_got is distinct from v_want then
      fallos := array_append(fallos, format('%s: esperaba %s y dio %s', v_case ->> 'id', v_want, v_got));
    end if;
  end loop;
  if v_n < 9 then
    fallos := array_append(fallos, format('F · solo %s casos', v_n));
  end if;
  if cardinality(fallos) > 0 then
    raise exception E'F · fx-dates.json:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'F · el resolver reproduce los % casos SQL de fx-dates.json (% solo de dominio): OK', v_n, v_skip;
end
$f$;

-- ================= G · de extremo a extremo sobre dias fijados ================
do $g$
declare
  fallos text[] := '{}';
  c_eur constant uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  c_usd constant uuid := '34cb8424-2243-52d8-be99-e2b7d22884b8';
  c_nok constant uuid := 'f2fe8324-641c-548d-b3af-411db0d39448';
  c_jpy constant uuid := 'f981b2f9-a022-5de8-aa6d-3af277d9dcd3';
  c_huf constant uuid := '8b951c59-bbd1-539b-9336-4174fbf47bdb';
  c_brl constant uuid := '50850a6c-39ff-5f35-85aa-afd6ea3732e6';
  c_ars constant uuid := '6cbdabc6-2d2f-5090-a063-3a366f9fd23d';
  c_cop constant uuid := '3304aa15-10b1-5eca-a6c8-3c149a9f91f1';
  c_clp constant uuid := 'a85ae854-0a0d-51de-bb34-4b7a20229bb9';
  v_res   jsonb;
  v_before text;
  v_after  text;
  v       text;
  v_cur   uuid;
  v_snap  text;
begin
  -- Fuente de fixture: primera publicacion el 01-09. NOK cubierta hasta el 07
  -- (retirada registrada) y BRL desde el 03 (inicio de cobertura).
  perform pg_temp.fuente('e2e', '2026-09-01');
  perform pg_temp.cubre('e2e', c_eur, null,  '2026-09-01');
  perform pg_temp.cubre('e2e', c_usd, 'USD', '2026-09-01');
  perform pg_temp.cubre('e2e', c_jpy, 'JPY', '2026-09-01');
  perform pg_temp.cubre('e2e', c_huf, 'HUF', '2026-09-01');
  perform pg_temp.cubre('e2e', c_nok, 'NOK', '2026-09-01', '2026-09-07');
  perform pg_temp.cubre('e2e', c_brl, 'BRL', '2026-09-03');

  v_res := pg_temp.ingerir('e2e',
       pg_temp.dia('2026-09-08', pg_temp.t('USD', '1.16')   || pg_temp.t('NOK', '10.8')    || pg_temp.t('JPY', '179')    || pg_temp.t('HUF', '365')    || pg_temp.t('BRL', '6.4'))
    || pg_temp.dia('2026-09-07', pg_temp.t('USD', '1.1592') || pg_temp.t('NOK', '10.7635') || pg_temp.t('JPY', '178.56') || pg_temp.t('HUF', '364.45') || pg_temp.t('BRL', '6.3'))
    || pg_temp.dia('2026-09-04', pg_temp.t('USD', '1.17')                                  || pg_temp.t('JPY', '173')    || pg_temp.t('HUF', '363'))
    || pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16')                                  || pg_temp.t('JPY', '172')    || pg_temp.t('HUF', '362')    || pg_temp.t('BRL', '6.2'))
    || pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15')   || pg_temp.t('NOK', '10.7')    || pg_temp.t('JPY', '171')    || pg_temp.t('HUF', '361')    || pg_temp.t('BRL', '6.1'))
    || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14')   || pg_temp.t('NOK', '10.6')    || pg_temp.t('JPY', '170')    || pg_temp.t('HUF', '360')    || pg_temp.t('BRL', '6.0')),
    pg_temp.berlin('2026-09-09 10:00'));
  if not (v_res ->> 'complete')::boolean or (v_res ->> 'days_fixed')::int <> 8 then
    raise exception 'G · la fijacion de partida no es la esperada: %', v_res;
  end if;

  -- Lo que hay antes de resolver nada: el resolver no puede cambiarlo.
  select string_agg(t || '=' || n, ',' order by t) into v_before from (
    select 'obs' t, count(*) n from core.fx_observation union all
    select 'pub', count(*) from core.fx_publication union all
    select 'rate', count(*) from core.fx_publication_rate union all
    select 'day', count(*) from core.fx_day union all
    select 'dayrate', count(*) from core.fx_day_rate union all
    select 'frozen', count(*) from core.frozen_conversion union all
    select 'op', count(*) from core.operation) s;

  -- G1 · el valor real del BCE del 07-09: USD 1.1592. Dia 08 (R = 07).
  v := pg_temp.resolver('2026-09-08', c_usd, c_eur, 'e2e');
  if v is distinct from '862663906142/12/2026-09-07/2026-09-07/true/false/e2e' then
    fallos := array_append(fallos, 'G1 USD -> EUR el 08: ' || v);
  end if;
  v := pg_temp.resolver('2026-09-08', c_eur, c_usd, 'e2e');
  if v is distinct from '1159200000000/12/2026-09-07/2026-09-07/false/true/e2e' then
    fallos := array_append(fallos, 'G1b EUR -> USD el 08 (pivote sin version): ' || v);
  end if;
  v := pg_temp.resolver('2026-09-08', c_usd, c_jpy, 'e2e');
  if v is distinct from '154037267080745/12/2026-09-07/2026-09-07/true/true/e2e' then
    fallos := array_append(fallos, 'G1c USD -> JPY cruzado el 08: ' || v);
  end if;

  -- G2 · R y P, por moneda. Dia 04: R = 03 (sin NOK), P = 02 (con NOK). NOK
  --      sale de P y USD de R: una conversion cruzada con dos fechas.
  v := pg_temp.resolver('2026-09-04', c_nok, c_usd, 'e2e');
  if v is distinct from (select sec.fx_derive(107, 1, 116, 2)::text) || '/12/2026-09-02/2026-09-03/true/true/e2e' then
    fallos := array_append(fallos, 'G2 NOK (P) -> USD (R) el 04: ' || v);
  end if;
  -- G3 · K = 1: dia 05, R = 04 y P = 03, ninguna con NOK: 422, no 503.
  if pg_temp.resolver('2026-09-05', c_nok, c_usd, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'G3 NOK mas alla del limite de antiguedad');
  end if;
  -- ... y USD si tiene tipo ese mismo dia.
  if pg_temp.resolver('2026-09-05', c_usd, c_eur, 'e2e') not like '%/2026-09-04/2026-09-04/%' then
    fallos := array_append(fallos, 'G3b USD el 05 deberia usar R = 04');
  end if;

  -- G4 · inicio de cobertura, inclusivo: BRL desde el 03.
  if pg_temp.resolver('2026-09-03', c_brl, c_eur, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'G4 BRL con R = 02, antes de su cobertura');
  end if;
  if pg_temp.resolver('2026-09-04', c_brl, c_eur, 'e2e') not like '%/2026-09-03/2026-09-03/%' then
    fallos := array_append(fallos, 'G4b BRL con R = 03, primer dia de cobertura');
  end if;
  -- ... y P dentro de la cobertura: dia 05, R = 04 sin BRL, P = 03 con BRL
  --     (el pivote, con R = 04: dos fechas en una misma conversion).
  if pg_temp.resolver('2026-09-05', c_brl, c_eur, 'e2e') not like '%/2026-09-03/2026-09-04/%' then
    fallos := array_append(fallos, 'G4c BRL con P = 03');
  end if;

  -- G5 · fin de cobertura, inclusivo: NOK hasta el 07. Dia 08 (R = 07) si;
  --      dia 09 (R = 08, NOK publicada) no: la retirada prevalece sobre K = 1.
  if pg_temp.resolver('2026-09-08', c_nok, c_eur, 'e2e') not like '%/2026-09-07/2026-09-07/%' then
    fallos := array_append(fallos, 'G5 NOK con R = 07, ultimo dia de cobertura');
  end if;
  if pg_temp.resolver('2026-09-09', c_nok, c_eur, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'G5b NOK tras su retirada');
  end if;

  -- G6 · 503 frente a 422. Un dia sin fijar espera, tambien uno muy lejano;
  --      una moneda sin correspondencia no espera nunca, ni en un dia sin fijar.
  if pg_temp.resolver('2026-09-20', c_usd, c_eur, 'e2e') <> 'ERR FX_RATE_NOT_YET_AVAILABLE:503' then
    fallos := array_append(fallos, 'G6 dia futuro sin fijar');
  end if;
  if pg_temp.resolver('9999-12-31', c_usd, c_eur, 'e2e') <> 'ERR FX_RATE_NOT_YET_AVAILABLE:503' then
    fallos := array_append(fallos, 'G6b fecha lejana sin fijar: sin limite de dias');
  end if;
  foreach v_cur in array array[c_ars, c_cop, c_clp] loop
    if pg_temp.resolver('2026-09-20', v_cur, c_eur, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422'
       or pg_temp.resolver('2026-09-08', c_usd, v_cur, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
      fallos := array_append(fallos, format('G6c %s no deberia esperar a nada', v_cur));
    end if;
    -- Y con la fuente real, sin depender de ningun dato guardado.
    if pg_temp.resolver('2026-09-08', v_cur, c_eur, 'ecb') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
      fallos := array_append(fallos, format('G6d %s con la fuente real', v_cur));
    end if;
  end loop;

  -- G7 · primera publicacion de la fuente: X igual o anterior no tiene R(X).
  if pg_temp.resolver('2026-09-01', c_usd, c_eur, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422'
     or pg_temp.resolver('2026-08-15', c_usd, c_eur, 'e2e') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'G7 fecha igual o anterior a la primera publicacion');
  end if;
  if pg_temp.resolver('2026-09-02', c_usd, c_eur, 'e2e') not like '%/2026-09-01/2026-09-01/%' then
    fallos := array_append(fallos, 'G7b el dia siguiente usa la primera publicacion');
  end if;
  if pg_temp.resolver('infinity', c_usd, c_eur, 'e2e') <> 'ERR PAYLOAD_INVALID:400'
     or pg_temp.resolver('-infinity', c_ars, c_eur, 'e2e') <> 'ERR PAYLOAD_INVALID:400' then
    fallos := array_append(fallos, 'G7c fechas no finitas');
  end if;

  -- G8 · un importe que se convierte a 0 se acepta; un tipo nunca es 0.
  v := pg_temp.q(format('select sec.fx_convert(1, %L, %L, (select rate_coefficient from sec.fx_resolve(%L, %L, %L, %L)), 12)::text',
                        c_huf, c_eur, '2026-09-08', c_huf, c_eur, 'e2e'));
  if v <> '0' then
    fallos := array_append(fallos, 'G8 1 HUF -> EUR deberia ser 0: ' || v);
  end if;
  if pg_temp.q('select sec.fx_derive(4, 0, 1, 12)::text') <> 'ERR FX_CONVERSION_OUT_OF_RANGE:422' then
    fallos := array_append(fallos, 'G8b un tipo que redondea a 0 no es representable');
  end if;

  -- G9 · 64 bits: el maximo exacto, uno mas fuera de rango, y el tipo maximo.
  if pg_temp.q(format('select sec.fx_convert(9223372036854775807, %L, %L, 1000000000000, 12)::text', c_usd, c_eur))
     <> '9223372036854775807' then
    fallos := array_append(fallos, 'G9 el maximo de 64 bits no se conserva exacto');
  end if;
  if pg_temp.q(format('select sec.fx_convert(922337203685477581, %L, %L, 1000000000000000, 12)::text', c_eur, c_jpy))
     <> 'ERR FX_CONVERSION_OUT_OF_RANGE:422' then
    fallos := array_append(fallos, 'G9b un importe fuera de 64 bits no se rechaza');
  end if;
  if pg_temp.q(format('select sec.fx_convert(922337203685477580, %L, %L, 1000000000000000, 12)::text', c_eur, c_jpy))
     <> '9223372036854775800' then
    fallos := array_append(fallos, 'G9c el ultimo importe que cabe no se conserva');
  end if;
  if pg_temp.q('select sec.fx_derive(1, 0, 10000000, 0)::text') <> 'ERR FX_CONVERSION_OUT_OF_RANGE:422' then
    fallos := array_append(fallos, 'G9d un tipo que no cabe en 64 bits no se rechaza');
  end if;

  -- G10 · determinismo: una enmienda posterior del 07 no cambia lo resuelto
  --       para el 08, ni su version.
  select string_agg(pg_temp.resolver(d::date::text, c_usd, c_eur, 'e2e'), ',' order by d)
    into v_snap from generate_series('2026-09-02'::date, '2026-09-09'::date, interval '1 day') d;
  v_res := pg_temp.ingerir('e2e',
       pg_temp.dia('2026-09-08', pg_temp.t('USD', '1.16') || pg_temp.t('NOK', '10.8') || pg_temp.t('JPY', '179') || pg_temp.t('HUF', '365') || pg_temp.t('BRL', '6.4'))
    || pg_temp.dia('2026-09-07', pg_temp.t('USD', '1.2000') || pg_temp.t('NOK', '10.7635') || pg_temp.t('JPY', '178.56') || pg_temp.t('HUF', '364.45') || pg_temp.t('BRL', '6.3')),
    pg_temp.berlin('2026-09-09 12:00'));
  if (v_res ->> 'versions_new')::int <> 1 or (v_res ->> 'days_fixed')::int <> 0 then
    fallos := array_append(fallos, 'G10 la enmienda de partida no es la esperada: ' || v_res::text);
  end if;
  select string_agg(pg_temp.resolver(d::date::text, c_usd, c_eur, 'e2e'), ',' order by d)
    into v from generate_series('2026-09-02'::date, '2026-09-09'::date, interval '1 day') d;
  if v is distinct from v_snap then
    fallos := array_append(fallos, 'G10b una version posterior cambio un tipo ya resuelto');
  end if;

  -- G11 · el resolver no escribio nada (la enmienda de G10 es de la ingesta).
  select string_agg(t || '=' || n, ',' order by t) into v_after from (
    select 'obs' t, count(*) - 1 n from core.fx_observation union all
    select 'pub', count(*) - 1 from core.fx_publication union all
    select 'rate', count(*) - 5 from core.fx_publication_rate union all
    select 'day', count(*) from core.fx_day union all
    select 'dayrate', count(*) from core.fx_day_rate union all
    select 'frozen', count(*) from core.frozen_conversion union all
    select 'op', count(*) from core.operation) s;
  if v_after is distinct from v_before then
    fallos := array_append(fallos, format('G11 algo cambio al resolver: antes %s, despues %s', v_before, v_after));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'G · de extremo a extremo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'G · R, P, K = 1, cobertura, 503 frente a 422, ARS/COP/CLP, primera fecha, cero, 64 bits, determinismo, sin escrituras: OK';
end
$g$;

-- ============================ H · como cada rol ===============================
do $h$
declare
  fallos text[] := '{}';
  c_eur constant uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  c_usd constant uuid := '34cb8424-2243-52d8-be99-e2b7d22884b8';
  c_ars constant uuid := '6cbdabc6-2d2f-5090-a063-3a366f9fd23d';
  v    text;
  r    text;
begin
  -- H1 · el writer resuelve DE VERDAD: con sus policies ve el dia, el tipo y la
  --      version. Sin ellas veria cero filas sin error y daria 503 o 42501.
  v := pg_temp.resolver('2026-09-08', c_usd, c_eur, 'e2e', 'nomey_writer');
  if v is distinct from '862663906142/12/2026-09-07/2026-09-07/true/false/e2e' then
    fallos := array_append(fallos, 'H1 el writer no resuelve: ' || v);
  end if;
  if pg_temp.resolver('2026-09-20', c_usd, c_eur, 'e2e', 'nomey_writer') <> 'ERR FX_RATE_NOT_YET_AVAILABLE:503'
     or pg_temp.resolver('2026-09-08', c_ars, c_eur, 'e2e', 'nomey_writer') <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'H1b el writer no recibe los resultados de frontera');
  end if;
  if pg_temp.as_role(format('select sec.fx_convert(10000, %L, %L, 862663906142, 12)::text', c_usd, c_eur), 'nomey_writer') <> '8627' then
    fallos := array_append(fallos, 'H1c el writer no convierte');
  end if;

  -- H2 · nadie mas ejecuta el resolver ni la conversion.
  foreach r in array array['anon', 'authenticated', 'nomey_provisioner', 'nomey_fx_ingest'] loop
    if pg_temp.resolver('2026-09-08', c_usd, c_eur, 'e2e', r) <> 'ERR 42501'
       or pg_temp.as_role('select sec.fx_divide_round(5, 2)::text', r) <> 'ERR 42501'
       or pg_temp.as_role(format('select sec.fx_convert(1, %L, %L, 1, 0)::text', c_usd, c_eur), r) <> 'ERR 42501' then
      fallos := array_append(fallos, format('H2 %s ejecuta funciones del resolver', r));
    end if;
  end loop;

  -- H3 · el writer lee lo que resuelve y nada mas, y no escribe nada de FX.
  foreach v in array array['core.fx_observation', 'core.fx_publication', 'core.fx_observation_publication'] loop
    if pg_temp.as_role(format('select count(*)::text from %s', v), 'nomey_writer') <> 'ERR 42501' then
      fallos := array_append(fallos, format('H3 el writer lee %s', v));
    end if;
  end loop;
  foreach v in array array[
    'insert into core.fx_day (source_id, day, reference_date, observation_id) select source_id, day + 100, reference_date, observation_id from core.fx_day limit 1',
    'update core.fx_day_rate set reference_date = reference_date',
    'delete from core.fx_publication_rate',
    'update core.fx_coverage set valid_until = null',
    'select sec.fx_ingest(''x'', ''{"url":"https://x","status":200}''::jsonb)::text'] loop
    if pg_temp.as_role(v, 'nomey_writer') <> 'ERR 42501' then
      fallos := array_append(fallos, format('H3b el writer puede: %s', left(v, 50)));
    end if;
  end loop;

  if cardinality(fallos) > 0 then
    raise exception E'H · roles:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'H · el writer resuelve con sus policies; nadie mas ejecuta; el writer no lee ni escribe de mas: OK';
end
$h$;

rollback;
