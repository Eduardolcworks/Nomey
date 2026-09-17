-- ============================================================================
-- INGESTA Y FIJACION DEL TIPO DEL DIA · F11/ADR-002 §1-§5
-- ============================================================================
--
-- Migracion 20260920120000 (F11.B, M2). Contra las funciones REALES, con
-- fuentes de fixture (nunca la fuente real `ecb`, que puede tener datos en una
-- base local) y ROLLBACK. EXIGE el prologo de vectores, porque la seccion B
-- compara la fijacion con tests/vectors/fx-day.json:
--
--   { ./scripts/vectors-prelude.sh ; cat supabase/checks/fx-ingest.sql ; } \
--     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--         -X -q -v ON_ERROR_STOP=1
--
--   A · catalogo y privilegios de las seis tablas y las dos funciones
--   B · paridad: la fijacion reproduce los 36 casos de fx-day.json
--   C · observacion completa: cada condicion de §2 que falla se registra, con
--       su motivo, y no escribe nada mas
--   D · fijacion: una sola vez, a partir de las 00:00 de Berlin, versiones,
--       enmiendas, cambios de hora, dias pendientes
--   E · segunda barrera y estructura: policies y FK que detienen lo que la
--       funcion no deberia escribir nunca
--   F · lo que la funcion rechaza como error de llamada
--   G · la cobertura curada no puede desdecir una fijacion ya hecha

\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

create function pg_temp.try(p_sql text, p_role text) returns text
language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  execute p_sql;
  perform pg_temp.super();
  return 'OK';
exception when others then
  perform pg_temp.super();
  return sqlstate;
end $$;

grant execute on function pg_temp.super(), pg_temp.try(text, text) to nomey_fx_ingest;

-- Como `try`, pero ademas adelanta la comprobacion de las constraints
-- diferidas: es la unica forma de ver dentro de una transaccion lo que, en una
-- migracion, fallaria al confirmar.
create function pg_temp.try_diferido(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  set constraints all immediate;
  set constraints all deferred;
  return 'OK';
exception when others then
  return sqlstate;
end $$;

-- Un documento con la forma del BCE, con el cuerpo que se le pase.
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
create function pg_temp.ev(p_status int default 200,
                           p_url text default 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml')
returns jsonb language sql as $$
  select jsonb_build_object('url', p_url, 'status', p_status,
                            'last_modified', 'Tue, 15 Sep 2026 14:15:02 GMT', 'etag', '"fixture"');
$$;
-- Hora local de Francfort -> instante.
create function pg_temp.berlin(p_local text) returns timestamptz language sql as $$
  select p_local::timestamp at time zone 'Europe/Berlin';
$$;

-- Una fuente de fixture con cobertura EUR (pivote), USD y NOK desde su inicio.
create function pg_temp.fuente(p_id text, p_first date) returns void language sql as $$
  insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url)
  values (p_id, 'fixture', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', p_first, 'https://www.ecb.europa.eu/');
  insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from,
                                valid_from_basis, valid_from_evidence)
  values (p_id, '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', null,  p_first, 'fixture', 'https://www.ecb.europa.eu/'),
         (p_id, '34cb8424-2243-52d8-be99-e2b7d22884b8', 'USD', p_first, 'fixture', 'https://www.ecb.europa.eu/'),
         (p_id, 'f2fe8324-641c-548d-b3af-411db0d39448', 'NOK', p_first, 'fixture', 'https://www.ecb.europa.eu/');
$$;

-- Algo ya guardado en <fecha>, como lo habria dejado una ingesta anterior: la
-- forma de probar documentos que no empiezan en la primera publicacion.
create function pg_temp.guardado(p_source text, p_date date) returns void language sql as $$
  with o as (
    insert into core.fx_observation (source_id, observed_at, document_url, http_status,
                                     document_sha256, document_bytes, first_reference_date,
                                     last_reference_date, reference_date_count, complete)
    values (p_source, pg_temp.berlin(p_date::text || ' 23:00'),
            'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml', 200,
            repeat('0', 64), 0, p_date, p_date, 1, true)
    returning id
  ), p as (
    insert into core.fx_publication (source_id, reference_date, content_sha256, rate_count, first_observation_id)
    select p_source, p_date, repeat('1', 64), 1, o.id from o
    returning id
  )
  insert into core.fx_publication_rate (publication_id, source_code, coefficient, scale, source_text)
  select p.id, 'ZZZ', 1, 0, '1' from p;
$$;

create function pg_temp.dias(p_source text) returns bigint language sql as $$
  select count(*) from core.fx_day where source_id = p_source;
$$;
create function pg_temp.versiones(p_source text) returns bigint language sql as $$
  select count(*) from core.fx_publication where source_id = p_source;
$$;

-- ======================= A · catalogo y privilegios ==========================
do $a$
declare
  fallos text[] := '{}';
  v_t text;
  v_n int;
  c_tablas constant text[] := array['fx_observation', 'fx_publication', 'fx_publication_rate',
                                    'fx_observation_publication', 'fx_day', 'fx_day_rate'];
  v_rel text;
  v_fn text;
begin
  -- A1 · las seis tablas, con RLS, sin FORCE y de postgres.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relkind = 'r' and c.relname = any (c_tablas)
     and c.relrowsecurity and not c.relforcerowsecurity and pg_get_userbyid(c.relowner) = 'postgres';
  if v_n <> 6 then
    fallos := array_append(fallos, format('A1 %s de 6 tablas con RLS y propiedad de postgres', v_n));
  end if;

  -- A2 · privilegios EXACTOS: solo la ingesta, y solo SELECT e INSERT.
  foreach v_rel in array c_tablas loop
    select string_agg(g.rolname || '=' || a.privilege_type, ',' order by g.rolname, a.privilege_type)
      into v_t
      from pg_class c cross join lateral aclexplode(c.relacl) a
      join pg_roles g on g.oid = a.grantee
     where c.oid = ('core.' || v_rel)::regclass and a.grantee <> c.relowner;
    if v_t is distinct from 'nomey_fx_ingest=INSERT,nomey_fx_ingest=SELECT' then
      fallos := array_append(fallos, format('A2 %s: %s', v_rel, coalesce(v_t, 'sin privilegios')));
    end if;
    select string_agg(r || ':' || p, ',') into v_t
      from unnest(array['anon', 'authenticated', 'service_role', 'nomey_writer',
                        'nomey_provisioner', 'nomey_fx_ingest']) r,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
     where has_table_privilege(r, 'core.' || v_rel, p)
       and not (r = 'nomey_fx_ingest' and p in ('SELECT', 'INSERT'));
    if v_t is not null then
      fallos := array_append(fallos, format('A2b %s: %s', v_rel, v_t));
    end if;
    if exists (select 1 from pg_attribute at cross join lateral aclexplode(at.attacl) a
                where at.attrelid = ('core.' || v_rel)::regclass) then
      fallos := array_append(fallos, format('A2c %s tiene privilegios de columna', v_rel));
    end if;
  end loop;

  -- A3 · policies: una de lectura y una de insercion por tabla, las doce solo
  --      para la ingesta; y las cuatro que atan la validez siguen ahi.
  select count(*) into v_n
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relname = any (c_tablas)
     and p.polroles = array['nomey_fx_ingest'::regrole::oid]
     and p.polcmd in ('r', 'a') and p.polpermissive;
  if v_n <> 12
     or (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'core' and c.relname = any (c_tablas)) <> 12 then
    fallos := array_append(fallos, format('A3 %s de 12 policies previstas', v_n));
  end if;
  select string_agg(c.relname, ',' order by c.relname) into v_t
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = any (c_tablas) and p.polcmd = 'a'
     and pg_get_expr(p.polwithcheck, p.polrelid) like '%complete%';
  if v_t is distinct from 'fx_day,fx_observation_publication,fx_publication,fx_publication_rate' then
    fallos := array_append(fallos, 'A3b policies que exigen observacion completa: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- A4 · las dos funciones: definer, de la ingesta, search_path vacio, y sin
  --      EXECUTE para nadie de aplicacion.
  foreach v_fn in array array['sec.fx_ingest(text,jsonb)', 'sec.fx_ingest_at(text,text,jsonb,timestamptz)'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = v_fn::regprocedure and p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'nomey_fx_ingest'
                      and p.proconfig = array['search_path=""']) then
      fallos := array_append(fallos, format('A4 %s no es definer de la ingesta con search_path vacio', v_fn));
    end if;
    select string_agg(r, ',') into v_t
      from unnest(array['public', 'anon', 'authenticated', 'service_role',
                        'nomey_writer', 'nomey_provisioner']) r
     where has_function_privilege(r, v_fn, 'EXECUTE');
    if v_t is not null then
      fallos := array_append(fallos, format('A4b %s ejecutable por %s', v_fn, v_t));
    end if;
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = v_fn::regprocedure and a.grantee <> p.proowner) then
      fallos := array_append(fallos, format('A4c %s tiene EXECUTE concedido a otro rol', v_fn));
    end if;
  end loop;

  -- A5 · ninguna superficie nueva: 9 record_*, nada de api toca FX, el writer
  --      no lee todavia nada de la ingesta y frozen_conversion sigue sin ruta.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname like 'record\_%';
  if v_n <> 9 then
    fallos := array_append(fallos, format('A5 hay %s funciones api.record_*', v_n));
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and (p.proname ilike '%fx%' or p.prosrc like '%fx\_%');
  v_n := v_n + (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'api' and c.relname ilike '%fx%');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5b %s objetos de api tocan FX', v_n));
  end if;
  if has_table_privilege('nomey_writer', 'core.frozen_conversion', 'INSERT') then
    fallos := array_append(fallos, 'A5c nomey_writer tiene INSERT sobre core.frozen_conversion');
  end if;

  -- A6 · constraints, no triggers.
  select count(*) into v_n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = any (c_tablas) and c.relnamespace = 'core'::regnamespace and not t.tgisinternal;
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6 hay %s triggers en las tablas de la ingesta', v_n));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'A · catalogo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'A · seis tablas con RLS, solo la ingesta lee e inserta, funciones cerradas, sin superficie nueva: OK';
end
$a$;

-- ============== B · paridad con tests/vectors/fx-day.json ====================
-- Cada caso en su propia fuente de fixture. La historia del caso es el
-- documento; si no empieza en la primera publicacion, se simula lo guardado en
-- su primera fecha (condicion 5). Se observa a las 23:00 de Berlin del ultimo
-- dia entre X y la ultima fecha de la historia: la primera observacion
-- posterior a las 00:00 de X que contiene toda la historia.
--
-- Traduccion de las expectativas del dominio a lo fijado:
--   selected                           -> fila con esa posicion y esa fecha
--   not_covered/no_reference_publication -> X no se fija nunca (X <= primera)
--   not_covered/no_source_mapping      -> ninguna fila para la moneda
--   not_covered/otro motivo            -> dia fijado, sin fila para la moneda
--   observation_insufficient           -> X sin fijar, aunque es fijable
--   FX_PUBLICATION_DUPLICATED          -> observacion incompleta por fecha repetida
do $b$
declare
  v_vec    jsonb := (select doc from vector_doc where name = 'fx-day');
  v_first  date;
  v_case   jsonb;
  v_hist   jsonb;
  v_cov    jsonb;
  v_x      date;
  v_n      int := 0;
  v_src    text;
  v_def    uuid;
  v_body   text;
  v_min    date;
  v_max    date;
  v_res    jsonb;
  v_exp    jsonb;
  v_day    boolean;
  v_rate   core.fx_day_rate;
  v_bad    text;
  fallos   text[] := '{}';
  c_isk constant uuid := 'f11b3000-0000-4000-8000-000000000001';
begin
  if v_vec is null then
    raise exception 'B · falta el prologo de vectores (scripts/vectors-prelude.sh)';
  end if;
  v_first := (v_vec ->> 'sourceFirstReferenceDate')::date;
  insert into core.currency_definition (id, code, scale) values (c_isk, 'ISK', 0);

  for v_case in select jsonb_array_elements(v_vec -> 'cases') loop
    v_n := v_n + 1;
    v_src := 'vec_' || v_n;
    v_hist := v_vec -> 'histories' -> (v_case -> 'given' ->> 'history');
    v_cov := v_vec -> 'coverages' -> (v_case -> 'given' ->> 'coverage');
    v_x := (v_case -> 'given' ->> 'effectiveDate')::date;
    v_exp := v_case -> 'expect';

    insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url)
    values (v_src, v_case ->> 'id', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', v_first, 'https://www.ecb.europa.eu/');

    if v_cov is null or jsonb_typeof(v_cov) = 'null' then
      v_def := '6cbdabc6-2d2f-5090-a063-3a366f9fd23d';  -- ARS: sin correspondencia
    else
      v_def := case v_cov ->> 'sourceCode'
                 when 'USD' then '34cb8424-2243-52d8-be99-e2b7d22884b8'::uuid
                 when 'NOK' then 'f2fe8324-641c-548d-b3af-411db0d39448'::uuid
                 when 'BRL' then '50850a6c-39ff-5f35-85aa-afd6ea3732e6'::uuid
                 when 'RON' then '8b33cd38-5e20-5145-bee9-c0b81c9a81ba'::uuid
                 when 'ISK' then c_isk
               end;
      if v_cov ->> 'sourceCode' is null then
        v_def := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
      end if;
      if v_def is null then
        raise exception 'B · el caso % usa un codigo sin definicion de fixture: %', v_case ->> 'id', v_cov ->> 'sourceCode';
      end if;
      insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from, valid_until,
                                    valid_from_basis, valid_from_evidence, valid_until_basis, valid_until_evidence)
      select v_src, v_def, v_cov ->> 'sourceCode', (i ->> 'from')::date, (i ->> 'until')::date,
             'vector', 'https://www.ecb.europa.eu/',
             case when i ->> 'until' is not null then 'vector' end,
             case when i ->> 'until' is not null then 'https://www.ecb.europa.eu/' end
        from jsonb_array_elements(v_cov -> 'intervals') i;
    end if;

    select string_agg(pg_temp.dia(e ->> 'referenceDate',
                                  (select coalesce(string_agg(pg_temp.t(code, '1.5'), ''), '')
                                     from jsonb_array_elements_text(e -> 'sourceCodes') code)),
                      '' order by e ->> 'referenceDate' desc),
           min((e ->> 'referenceDate')::date), max((e ->> 'referenceDate')::date)
      into v_body, v_min, v_max
      from jsonb_array_elements(v_hist) e;

    if v_min > v_first then
      perform pg_temp.guardado(v_src, v_min);
    end if;

    v_res := sec.fx_ingest_at(v_src, pg_temp.env(v_body), pg_temp.ev(),
                              pg_temp.berlin(greatest(v_x, v_max)::text || ' 23:00'));

    v_day := exists (select 1 from core.fx_day where source_id = v_src and day = v_x);
    select * into v_rate from core.fx_day_rate
     where source_id = v_src and day = v_x and currency_definition_id = v_def;
    v_bad := null;

    if v_case ? 'expectError' then
      if v_case ->> 'expectError' <> 'FX_PUBLICATION_DUPLICATED'
         or (v_res ->> 'complete')::boolean
         or v_res ->> 'reason' is distinct from 'reference_date_duplicated' then
        v_bad := 'esperaba fecha repetida: ' || v_res::text;
      end if;
    elsif not (v_res ->> 'complete')::boolean then
      v_bad := 'observacion incompleta: ' || v_res::text;
    elsif v_exp ->> 'kind' = 'selected' then
      if v_rate.position is distinct from v_exp ->> 'position'
         or v_rate.reference_date is distinct from (v_exp ->> 'referenceDate')::date then
        v_bad := format('esperaba %s en %s y hay %s en %s (dia fijado: %s)',
                        v_exp ->> 'position', v_exp ->> 'referenceDate',
                        coalesce(v_rate.position, 'nada'), coalesce(v_rate.reference_date::text, '-'), v_day);
      end if;
    elsif v_exp ->> 'kind' = 'not_covered' and v_exp ->> 'reason' = 'no_reference_publication' then
      if v_day or v_x > v_first then
        v_bad := format('X no deberia fijarse nunca (fijado: %s)', v_day);
      end if;
    elsif v_exp ->> 'kind' = 'not_covered' and v_exp ->> 'reason' = 'no_source_mapping' then
      if v_rate.day is not null
         or exists (select 1 from core.fx_coverage where source_id = v_src and currency_definition_id = v_def) then
        v_bad := 'una definicion sin correspondencia tiene cobertura o tipo';
      end if;
    elsif v_exp ->> 'kind' = 'not_covered' then
      if not v_day or v_rate.day is not null then
        v_bad := format('esperaba dia fijado sin tipo (fijado: %s, tipo: %s)', v_day, coalesce(v_rate.position, 'nada'));
      end if;
    elsif v_exp ->> 'kind' = 'observation_insufficient' then
      if v_day or v_x <= v_first then
        v_bad := format('X no deberia quedar fijado por esta observacion (fijado: %s)', v_day);
      end if;
    else
      v_bad := 'expectativa desconocida: ' || v_exp::text;
    end if;

    if v_bad is not null then
      fallos := array_append(fallos, format('%s: %s', v_case ->> 'id', v_bad));
    end if;
  end loop;

  if v_n <> 36 then
    fallos := array_append(fallos, format('se esperaban 36 casos y hay %s', v_n));
  end if;
  if cardinality(fallos) > 0 then
    raise exception E'B · paridad con fx-day.json:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'B · la fijacion reproduce los % casos de fx-day.json: OK', v_n;
end
$b$;

-- ================ C · observacion completa (F11/ADR-002 §2) ==================
do $c$
declare
  fallos text[] := '{}';
  v_base text;
  v_ok   text;
  v_at   timestamptz := pg_temp.berlin('2026-09-04 10:00');
  v_res  jsonb;
  v_case record;
  v_obs  bigint;
  v_n    int := 0;
begin
  perform pg_temp.fuente('obs_c', '2026-09-01');
  perform pg_temp.fuente('obs_c2', '2026-09-01');

  v_ok := pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16'))
       || pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15') || pg_temp.t('NOK', '10.7'))
       || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14') || pg_temp.t('NOK', '10.6'));
  v_base := pg_temp.env(v_ok);

  -- C1 · con NADA guardado: cada documento falla por un unico motivo.
  for v_case in
    select * from (values
      ('http 500',                    v_base, pg_temp.ev(500), 'http_not_ok'),
      ('http 304',                    v_base, pg_temp.ev(304), 'http_not_ok'),
      ('url ajena',                   v_base, pg_temp.ev(200, 'https://example.com/eurofxref-hist.xml'), 'unexpected_url'),
      ('url sin https',               v_base, pg_temp.ev(200, 'http://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'), 'unexpected_url'),
      ('vacio',                       '',     pg_temp.ev(), 'empty_document'),
      ('con DTD',                     replace(v_base, '<gesmes:Envelope', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><gesmes:Envelope'), pg_temp.ev(), 'doctype_present'),
      ('pagina de error con doctype', '<!DOCTYPE html><html><body>Service unavailable</body></html>', pg_temp.ev(), 'doctype_present'),
      ('truncado',                    left(v_base, length(v_base) - 30), pg_temp.ev(), 'not_well_formed'),
      ('mal formado',                 replace(v_base, '</Cube></gesmes:Envelope>', '</gesmes:Envelope>'), pg_temp.ev(), 'not_well_formed'),
      ('texto plano',                 'Service unavailable', pg_temp.ev(), 'not_well_formed'),
      ('pagina de error xml',         '<html><body>Service unavailable</body></html>', pg_temp.ev(), 'not_source_document'),
      ('namespace ajeno',             replace(v_base, 'http://www.ecb.int/vocabulary/2002-08-01/eurofxref', 'http://example.org/x'), pg_temp.ev(), 'not_source_document'),
      ('otro remitente',              replace(v_base, 'European Central Bank', 'Some Other Bank'), pg_temp.ev(), 'not_source_document'),
      ('raiz distinta',               replace(replace(v_base, 'gesmes:Envelope', 'gesmes:Other'), '</gesmes:Other>', '</gesmes:Other>'), pg_temp.ev(), 'not_source_document'),
      ('tipo sin valor',              pg_temp.env(replace(v_ok, 'rate="1.16"', '')), pg_temp.ev(), 'unexpected_structure'),
      ('elemento extra en el dia',    pg_temp.env(replace(v_ok, '<Cube currency="USD" rate="1.16"/>', '<Cube currency="USD" rate="1.16"/><Note/>')), pg_temp.ev(), 'unexpected_structure'),
      ('dia sin fecha',               pg_temp.env(replace(v_ok, ' time="2026-09-03"', '')), pg_temp.ev(), 'unexpected_structure'),
      ('algo bajo un tipo',           pg_temp.env(replace(v_ok, '<Cube currency="USD" rate="1.16"/>', '<Cube currency="USD" rate="1.16"><Cube/></Cube>')), pg_temp.ev(), 'unexpected_structure'),
      ('sin fechas',                  pg_temp.env(''), pg_temp.ev(), 'no_reference_dates'),
      ('fecha imposible',             pg_temp.env(pg_temp.dia('2026-02-30', pg_temp.t('USD', '1.1')) || v_ok), pg_temp.ev(), 'reference_date_invalid'),
      ('fecha sin ceros',             pg_temp.env(pg_temp.dia('2026-9-2', pg_temp.t('USD', '1.1')) || v_ok), pg_temp.ev(), 'reference_date_invalid'),
      ('fecha infinita',              pg_temp.env(pg_temp.dia('infinity', pg_temp.t('USD', '1.1')) || v_ok), pg_temp.ev(), 'reference_date_invalid'),
      ('fecha vacia',                 pg_temp.env(pg_temp.dia('', pg_temp.t('USD', '1.1')) || v_ok), pg_temp.ev(), 'reference_date_invalid'),
      ('fecha repetida',              pg_temp.env(pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.1')) || v_ok), pg_temp.ev(), 'reference_date_duplicated'),
      ('fecha futura en Berlin',      pg_temp.env(pg_temp.dia('2026-09-05', pg_temp.t('USD', '1.1')) || v_ok), pg_temp.ev(), 'reference_date_in_future'),
      ('anterior a la fuente',        pg_temp.env(v_ok || pg_temp.dia('2026-08-31', pg_temp.t('USD', '1.1'))), pg_temp.ev(), 'reference_date_before_source'),
      ('fecha sin tipos',             pg_temp.env(pg_temp.dia('2026-09-04', '') || v_ok), pg_temp.ev(), 'reference_date_without_rates'),
      ('codigo en minusculas',        pg_temp.env(replace(v_ok, 'currency="NOK" rate="10.7"', 'currency="nok" rate="10.7"')), pg_temp.ev(), 'currency_code_invalid'),
      ('codigo de dos letras',        pg_temp.env(replace(v_ok, 'currency="NOK" rate="10.7"', 'currency="NO" rate="10.7"')), pg_temp.ev(), 'currency_code_invalid'),
      ('codigo repetido',             pg_temp.env(replace(v_ok, 'currency="NOK" rate="10.7"', 'currency="USD" rate="10.7"')), pg_temp.ev(), 'currency_code_duplicated'),
      ('N/A',                         pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="N/A"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('N/A de moneda no cubierta',   pg_temp.env(replace(v_ok, '<Cube currency="USD" rate="1.16"/>', '<Cube currency="USD" rate="1.16"/><Cube currency="XYZ" rate="N/A"/>')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('negativo',                    pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="-10.7"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('con signo',                   pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="+10.7"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('exponente',                   pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="1e1"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('coma decimal',                pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="10,7"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('sin parte entera',            pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate=".7"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('punto final',                 pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="10."')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('espacios',                    pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate=" 10.7"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('valor vacio',                 pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate=""')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('NaN',                         pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="NaN"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('13 decimales',                pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="0.1234567890123"')), pg_temp.ev(), 'rate_decimal_invalid'),
      ('cero',                        pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="0"')), pg_temp.ev(), 'rate_not_positive'),
      ('cero con decimales',          pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="0.0000"')), pg_temp.ev(), 'rate_not_positive'),
      ('fuera de 64 bits',            pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="9223372036854775808"')), pg_temp.ev(), 'rate_out_of_range'),
      ('fuera de 64 bits con escala', pg_temp.env(replace(v_ok, 'rate="10.7"', 'rate="92233720368.54775808"')), pg_temp.ev(), 'rate_out_of_range'),
      ('no empieza en la fuente',     pg_temp.env(pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16')) || pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15'))), pg_temp.ev(), 'gap_from_source_start')
    ) as t (nombre, doc, ev, motivo)
  loop
    v_n := v_n + 1;
    v_res := sec.fx_ingest_at('obs_c', v_case.doc, v_case.ev, v_at);
    if (v_res ->> 'complete')::boolean or v_res ->> 'reason' is distinct from v_case.motivo then
      fallos := array_append(fallos, format('C1 %s: esperaba %s y dio %s', v_case.nombre, v_case.motivo, v_res));
    end if;
  end loop;
  if pg_temp.versiones('obs_c') <> 0 or pg_temp.dias('obs_c') <> 0 then
    fallos := array_append(fallos, 'C1b una observacion incompleta escribio versiones o dias');
  end if;
  select count(*) into v_obs from core.fx_observation where source_id = 'obs_c' and not complete;
  if v_obs <> v_n or v_n < 40 then
    fallos := array_append(fallos, format('C1c %s documentos y %s observaciones incompletas registradas', v_n, v_obs));
  end if;
  if exists (select 1 from core.fx_observation where source_id = 'obs_c'
              and (first_reference_date is not null or reference_date_count <> 0
                   or last_modified is distinct from 'Tue, 15 Sep 2026 14:15:02 GMT'
                   or document_sha256 !~ '^[0-9a-f]{64}$')) then
    fallos := array_append(fallos, 'C1d la evidencia de una observacion incompleta no es la esperada');
  end if;

  -- C2 · una moneda ausente, o cubierta en unas fechas y no en otras, no hace
  --      incompleta la observacion (09-03 no trae NOK).
  v_res := sec.fx_ingest_at('obs_c', v_base, pg_temp.ev(), v_at);
  if not (v_res ->> 'complete')::boolean then
    fallos := array_append(fallos, 'C2 el documento base no es completo: ' || v_res::text);
  end if;

  -- C3 · con algo guardado (hasta 09-03).
  for v_case in
    select * from (values
      ('hueco tras lo guardado',   pg_temp.env(pg_temp.dia('2026-09-04', pg_temp.t('USD', '1.17'))), 'gap_after_stored'),
      ('mas viejo que lo guardado', pg_temp.env(pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15')) || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14'))), 'older_than_stored'),
      ('falta una fecha ya vista', pg_temp.env(pg_temp.dia('2026-09-04', pg_temp.t('USD', '1.17')) || pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16')) || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14'))), 'stored_date_missing')
    ) as t (nombre, doc, motivo)
  loop
    v_res := sec.fx_ingest_at('obs_c', v_case.doc, pg_temp.ev(), v_at);
    if (v_res ->> 'complete')::boolean or v_res ->> 'reason' is distinct from v_case.motivo then
      fallos := array_append(fallos, format('C3 %s: esperaba %s y dio %s', v_case.nombre, v_case.motivo, v_res));
    end if;
  end loop;
  if pg_temp.versiones('obs_c') <> 3 then
    fallos := array_append(fallos, format('C3b hay %s versiones y deberia haber 3', pg_temp.versiones('obs_c')));
  end if;

  -- C4 · y el documento que empieza en lo ultimo guardado si es completo: la
  --      ausencia de una fecha dentro de la ventana no es un hueco.
  v_res := sec.fx_ingest_at('obs_c',
             pg_temp.env(pg_temp.dia('2026-09-04', pg_temp.t('USD', '1.17')) || pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16'))),
             pg_temp.ev(), pg_temp.berlin('2026-09-04 18:00'));
  if not (v_res ->> 'complete')::boolean then
    fallos := array_append(fallos, 'C4 la ventana que empieza en lo guardado no es completa: ' || v_res::text);
  end if;

  -- C5 · la fuente real no admite otro reloj que el del servidor; ningun
  --      documento llega a mirarse.
  if pg_temp.try(format('select sec.fx_ingest_at(%L, %L, %L::jsonb, %L::timestamptz)',
                        'ecb', v_base, pg_temp.ev(), '2026-09-04 10:00+02'), 'postgres') <> '42501' then
    fallos := array_append(fallos, 'C5 la fuente real acepto un instante distinto de now()');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'C · observacion completa:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'C · % documentos incompletos registrados con su motivo y sin escribir nada; moneda ausente y ventana: OK', v_n;
end
$c$;

-- ============================ D · fijacion ===================================
do $d$
declare
  fallos text[] := '{}';
  v_doc1 text;
  v_doc2 text;
  v_doc3 text;
  v_doc4 text;
  v_res  jsonb;
  v_snap text;
  v_amend uuid;
  v_t    text;
  c_usd constant uuid := '34cb8424-2243-52d8-be99-e2b7d22884b8';
  c_nok constant uuid := 'f2fe8324-641c-548d-b3af-411db0d39448';
begin
  perform pg_temp.fuente('fix_d', '2026-09-01');

  v_doc1 := pg_temp.env(pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15') || pg_temp.t('NOK', '10.7'))
                     || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14') || pg_temp.t('NOK', '10.6')));

  -- D1 · la primera observacion, el 02 a las 23:30: fija solo el 02, con R en
  --      la primera publicacion y sin P.
  v_res := sec.fx_ingest_at('fix_d', v_doc1, pg_temp.ev(), pg_temp.berlin('2026-09-02 23:30'));
  if (v_res ->> 'versions_new')::int <> 2 or (v_res ->> 'days_fixed')::int <> 1
     or (v_res ->> 'day_rates_fixed')::int <> 3 or (v_res ->> 'days_unfixed')::int <> 0 then
    fallos := array_append(fallos, 'D1 primera observacion: ' || v_res::text);
  end if;
  select string_agg(day || ':' || reference_date || ':' || coalesce(previous_reference_date::text, '-'), ',' order by day)
    into v_t from core.fx_day where source_id = 'fix_d';
  if v_t is distinct from '2026-09-02:2026-09-01:-' then
    fallos := array_append(fallos, 'D1b dias: ' || coalesce(v_t, 'ninguno'));
  end if;

  -- D2 · el 03 a las 00:30: el mismo documento ya no crea versiones y fija el 03.
  v_res := sec.fx_ingest_at('fix_d', v_doc1, pg_temp.ev(), pg_temp.berlin('2026-09-03 00:30'));
  if (v_res ->> 'versions_new')::int <> 0 or (v_res ->> 'days_fixed')::int <> 1 then
    fallos := array_append(fallos, 'D2 segunda observacion: ' || v_res::text);
  end if;

  -- D3 · repetirlo no escribe nada mas que la observacion.
  v_res := sec.fx_ingest_at('fix_d', v_doc1, pg_temp.ev(), pg_temp.berlin('2026-09-03 01:00'));
  if (v_res ->> 'versions_new')::int <> 0 or (v_res ->> 'days_fixed')::int <> 0
     or (select count(*) from core.fx_observation where source_id = 'fix_d') <> 3 then
    fallos := array_append(fallos, 'D3 repeticion: ' || v_res::text);
  end if;

  select string_agg(day || '/' || currency_definition_id || '/' || position || '/' || reference_date
                    || '/' || coalesce(publication_id::text, '-'), ',' order by day, currency_definition_id)
    into v_snap from core.fx_day_rate where source_id = 'fix_d';

  -- D4 · una enmienda del 02 (NOK 10.8) y la publicacion del 03 sin NOK, a las
  --      17:00 del 03: dos versiones nuevas, ningun dia nuevo, y lo fijado no
  --      cambia (F11/ADR-002 §4).
  v_doc2 := pg_temp.env(pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.1600'))
                     || pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15') || pg_temp.t('NOK', '10.8'))
                     || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14') || pg_temp.t('NOK', '10.6')));
  v_res := sec.fx_ingest_at('fix_d', v_doc2, pg_temp.ev(), pg_temp.berlin('2026-09-03 17:00'));
  if (v_res ->> 'versions_new')::int <> 2 or (v_res ->> 'days_fixed')::int <> 0 then
    fallos := array_append(fallos, 'D4 enmienda: ' || v_res::text);
  end if;
  if (select count(*) from core.fx_publication where source_id = 'fix_d' and reference_date = '2026-09-02') <> 2 then
    fallos := array_append(fallos, 'D4b la enmienda no es una version aparte');
  end if;
  select string_agg(day || '/' || currency_definition_id || '/' || position || '/' || reference_date
                    || '/' || coalesce(publication_id::text, '-'), ',' order by day, currency_definition_id)
    into v_t from core.fx_day_rate where source_id = 'fix_d';
  if v_t is distinct from v_snap then
    fallos := array_append(fallos, 'D4c una version posterior cambio un dia fijado');
  end if;
  select p.id into v_amend from core.fx_publication p
   where p.source_id = 'fix_d' and p.reference_date = '2026-09-02'
     and p.first_observation_id = (v_res ->> 'observation_id')::uuid;

  -- D5 · el 03 a las 23:59:59 no fija el 04; a las 00:00:00 de Berlin
  --      (22:00 UTC) si, y con la version que contiene ESA observacion.
  v_res := sec.fx_ingest_at('fix_d', v_doc2, pg_temp.ev(), pg_temp.berlin('2026-09-03 23:59:59'));
  if (v_res ->> 'days_fixed')::int <> 0 then
    fallos := array_append(fallos, 'D5 se fijo el 04 antes de las 00:00 de Berlin: ' || v_res::text);
  end if;
  v_res := sec.fx_ingest_at('fix_d', v_doc2, pg_temp.ev(), '2026-09-03 22:00:00+00');
  if (v_res ->> 'days_fixed')::int <> 1 then
    fallos := array_append(fallos, 'D5b a las 00:00 de Berlin no se fijo el 04: ' || v_res::text);
  end if;
  select string_agg(c.code || ':' || r.position || ':' || r.reference_date, ',' order by c.code)
    into v_t from core.fx_day_rate r join core.currency_definition c on c.id = r.currency_definition_id
   where r.source_id = 'fix_d' and r.day = '2026-09-04';
  if v_t is distinct from 'EUR:pivot:2026-09-03,NOK:P:2026-09-02,USD:R:2026-09-03' then
    fallos := array_append(fallos, 'D5c tipos del 04: ' || coalesce(v_t, 'ninguno'));
  end if;
  if (select publication_id from core.fx_day_rate
       where source_id = 'fix_d' and day = '2026-09-04' and currency_definition_id = c_nok)
     is distinct from v_amend then
    fallos := array_append(fallos, 'D5d el 04 no usa la version del 02 que contenia su observacion');
  end if;

  -- D6 · el mismo valor escrito con otro cero final no es una version nueva.
  v_doc3 := pg_temp.env(pg_temp.dia('2026-09-04', pg_temp.t('USD', '1.17'))
                     || pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16'))
                     || pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.150') || pg_temp.t('NOK', '10.80'))
                     || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14') || pg_temp.t('NOK', '10.6')));
  v_res := sec.fx_ingest_at('fix_d', v_doc3, pg_temp.ev(), pg_temp.berlin('2026-09-04 17:00'));
  if (v_res ->> 'versions_new')::int <> 1 then
    fallos := array_append(fallos, 'D6 ceros finales crearon versiones: ' || v_res::text);
  end if;

  -- D7 · 12 decimales, el maximo de 64 bits y un cero final de sobra se
  --      guardan exactos; el texto original queda como evidencia. Un fin de
  --      semana sin publicacion: 05, 06 y 07 usan el 04, y NOK, ausente en el
  --      04 y en el 03, no tiene tipo esos dias.
  v_doc4 := pg_temp.env(pg_temp.dia('2026-09-07', pg_temp.t('USD', '0.123456789012')
                                                || pg_temp.t('NOK', '9223372036854775807')
                                                || pg_temp.t('XYZ', '1.0000000000000'))
                     || pg_temp.dia('2026-09-04', pg_temp.t('USD', '1.17'))
                     || pg_temp.dia('2026-09-03', pg_temp.t('USD', '1.16'))
                     || pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15') || pg_temp.t('NOK', '10.8')));
  v_res := sec.fx_ingest_at('fix_d', v_doc4, pg_temp.ev(), pg_temp.berlin('2026-09-07 18:00'));
  if not (v_res ->> 'complete')::boolean or (v_res ->> 'versions_new')::int <> 1
     or (v_res ->> 'days_fixed')::int <> 3 then
    fallos := array_append(fallos, 'D7 documento con valores limite: ' || v_res::text);
  end if;
  select string_agg(r.source_code || '=' || r.coefficient || 'e' || r.scale || '<' || r.source_text, ',' order by r.source_code)
    into v_t from core.fx_publication_rate r join core.fx_publication p on p.id = r.publication_id
   where p.source_id = 'fix_d' and p.reference_date = '2026-09-07';
  if v_t is distinct from 'NOK=9223372036854775807e0<9223372036854775807,USD=123456789012e12<0.123456789012,XYZ=1e0<1.0000000000000' then
    fallos := array_append(fallos, 'D7b tipos exactos: ' || coalesce(v_t, 'ninguno'));
  end if;
  select string_agg(r.day || ':' || c.code || ':' || r.position || ':' || r.reference_date, ',' order by r.day, c.code)
    into v_t from core.fx_day_rate r join core.currency_definition c on c.id = r.currency_definition_id
   where r.source_id = 'fix_d' and r.day between '2026-09-05' and '2026-09-07';
  if v_t is distinct from
     '2026-09-05:EUR:pivot:2026-09-04,2026-09-05:USD:R:2026-09-04,'
     '2026-09-06:EUR:pivot:2026-09-04,2026-09-06:USD:R:2026-09-04,'
     '2026-09-07:EUR:pivot:2026-09-04,2026-09-07:USD:R:2026-09-04' then
    fallos := array_append(fallos, 'D7c fin de semana: ' || coalesce(v_t, 'ninguno'));
  end if;
  if (select count(*) from core.fx_day_rate where source_id = 'fix_d' and currency_definition_id = c_usd) <> 6 then
    fallos := array_append(fallos, 'D7d USD no tiene tipo en los seis dias fijados');
  end if;

  -- D8 · cambio de hora de primavera: el 29-03-2026 empieza a las 23:00 UTC del 28.
  perform pg_temp.fuente('dst_a', '2026-03-26');
  v_doc1 := pg_temp.env(pg_temp.dia('2026-03-27', pg_temp.t('USD', '1.08')) || pg_temp.dia('2026-03-26', pg_temp.t('USD', '1.07')));
  v_res := sec.fx_ingest_at('dst_a', v_doc1, pg_temp.ev(), '2026-03-28 22:59:59+00');
  if (v_res ->> 'days_fixed')::int <> 2 then
    fallos := array_append(fallos, 'D8 antes de las 00:00 del 29 (CET): ' || v_res::text);
  end if;
  v_res := sec.fx_ingest_at('dst_a', v_doc1, pg_temp.ev(), '2026-03-28 23:00:00+00');
  if (v_res ->> 'days_fixed')::int <> 1
     or not exists (select 1 from core.fx_day where source_id = 'dst_a' and day = '2026-03-29') then
    fallos := array_append(fallos, 'D8b a las 00:00 del 29 (CET): ' || v_res::text);
  end if;

  -- D9 · y el de otono: el 25-10-2026 empieza a las 22:00 UTC del 24.
  perform pg_temp.fuente('dst_b', '2026-10-21');
  v_doc1 := pg_temp.env(pg_temp.dia('2026-10-22', pg_temp.t('USD', '1.08')) || pg_temp.dia('2026-10-21', pg_temp.t('USD', '1.07')));
  v_res := sec.fx_ingest_at('dst_b', v_doc1, pg_temp.ev(), '2026-10-24 21:59:59+00');
  if (v_res ->> 'days_fixed')::int <> 3 then
    fallos := array_append(fallos, 'D9 antes de las 00:00 del 25 (CEST): ' || v_res::text);
  end if;
  v_res := sec.fx_ingest_at('dst_b', v_doc1, pg_temp.ev(), '2026-10-24 22:00:00+00');
  if (v_res ->> 'days_fixed')::int <> 1 then
    fallos := array_append(fallos, 'D9b a las 00:00 del 25 (CEST): ' || v_res::text);
  end if;

  -- D10 · dias que la observacion no alcanza: lo guardado empieza el 01-09 y la
  --       fuente el 01-08. El 02 no se fija (le falta P), el 03 si; quedan 32
  --       dias sin fijar desde la primera publicacion.
  perform pg_temp.fuente('unf', '2026-08-01');
  perform pg_temp.guardado('unf', '2026-09-01');
  v_res := sec.fx_ingest_at('unf',
             pg_temp.env(pg_temp.dia('2026-09-02', pg_temp.t('USD', '1.15')) || pg_temp.dia('2026-09-01', pg_temp.t('USD', '1.14'))),
             pg_temp.ev(), pg_temp.berlin('2026-09-03 10:00'));
  if (v_res ->> 'days_fixed')::int <> 1 or (v_res ->> 'days_unfixed')::int <> 32
     or not exists (select 1 from core.fx_day where source_id = 'unf' and day = '2026-09-03') then
    fallos := array_append(fallos, 'D10 dias pendientes: ' || v_res::text);
  end if;

  -- D11 · la primera publicacion de la fuente se fija sin P; el dia de la
  --       primera publicacion no se fija nunca.
  if exists (select 1 from core.fx_day where source_id = 'fix_d' and day <= '2026-09-01')
     or (select previous_reference_date from core.fx_day where source_id = 'fix_d' and day = '2026-09-02') is not null then
    fallos := array_append(fallos, 'D11 la primera publicacion se trato mal');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'D · fijacion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'D · una sola fijacion, 00:00 de Berlin, versiones y enmiendas, valores limite, cambios de hora, dias pendientes: OK';
end
$d$;

-- ================= E · segunda barrera y estructura ==========================
do $e$
declare
  fallos text[] := '{}';
  v text;
  v_bad_obs  uuid;
  v_obs_d1   uuid;
  v_obs_d2   uuid;
  v_pub_orig uuid;
  c_chf constant uuid := 'c8483062-e215-5da5-850e-cd7bfda52eff';
  c_usd constant uuid := '34cb8424-2243-52d8-be99-e2b7d22884b8';
begin
  select id into v_bad_obs from core.fx_observation where source_id = 'obs_c' and not complete limit 1;
  select observation_id into v_obs_d1 from core.fx_day where source_id = 'fix_d' and day = '2026-09-02';
  select observation_id into v_obs_d2 from core.fx_day where source_id = 'fix_d' and day = '2026-09-03';
  select id into v_pub_orig from core.fx_publication
   where source_id = 'fix_d' and reference_date = '2026-09-02' and first_observation_id = v_obs_d1;

  -- E1 · como la ingesta, lo que la funcion nunca haria.
  v := pg_temp.try(format('insert into core.fx_day (source_id, day, reference_date, observation_id) values (%L, %L, %L, %L)',
                          'obs_c', '2026-09-20', '2026-09-03', v_bad_obs), 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1 dia con observacion incompleta: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_publication (source_id, reference_date, content_sha256, rate_count, first_observation_id) values (%L, %L, %L, 1, %L)',
                          'obs_c', '2026-09-20', repeat('a', 64), v_bad_obs), 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1b version de una observacion incompleta: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_observation_publication (observation_id, publication_id, source_id) '
                          'select %L, id, source_id from core.fx_publication where source_id = %L limit 1',
                          v_bad_obs, 'obs_c'), 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1c observacion incompleta con versiones: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day (source_id, day, reference_date, observation_id) values (%L, %L, %L, %L)',
                          'fix_d', '2026-09-20', '2026-09-07', v_obs_d1), 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1d dia fijado por una observacion anterior a sus 00:00: ' || v); end if;
  v := pg_temp.try('update core.fx_day set reference_date = reference_date where source_id = ''fix_d''', 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1e update de un dia: ' || v); end if;
  v := pg_temp.try('update core.fx_observation set complete = true where source_id = ''obs_c''', 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1f completar una observacion: ' || v); end if;
  v := pg_temp.try('delete from core.fx_day_rate where source_id = ''fix_d''', 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1g delete de tipos: ' || v); end if;
  v := pg_temp.try('delete from core.fx_publication_rate', 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1h delete de versiones: ' || v); end if;
  v := pg_temp.try('truncate core.fx_observation cascade', 'nomey_fx_ingest');
  if v <> '42501' then fallos := array_append(fallos, 'E1i truncate: ' || v); end if;

  -- E2 · como postgres, las FK que atan cada tipo a su dia, su version y su
  --      observacion.
  v := pg_temp.try(format('insert into core.fx_day_rate (source_id, day, currency_definition_id, position, reference_date, observation_id, publication_id, source_code) '
                          'values (%L, %L, %L, %L, %L, %L, %L, %L)',
                          'fix_d', '2026-09-03', c_chf, 'P', '2026-09-02', v_obs_d2, v_pub_orig, 'USD'), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'E2 P con la fecha de R: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day_rate (source_id, day, currency_definition_id, position, reference_date, observation_id) '
                          'values (%L, %L, %L, %L, %L, %L)',
                          'fix_d', '2026-09-03', c_chf, 'pivot', '2026-09-02', v_obs_d2), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'E2b pivote que no es el de la fuente: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day_rate (source_id, day, currency_definition_id, position, reference_date, observation_id, publication_id, source_code) '
                          'values (%L, %L, %L, %L, %L, %L, %L, %L)',
                          'fix_d', '2026-09-04', c_chf, 'P', '2026-09-02',
                          (select observation_id from core.fx_day where source_id = 'fix_d' and day = '2026-09-04'),
                          v_pub_orig, 'USD'), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'E2c version que no contenia la observacion que fijo el dia: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day_rate (source_id, day, currency_definition_id, position, reference_date, observation_id, publication_id, source_code) '
                          'values (%L, %L, %L, %L, %L, %L, %L, %L)',
                          'fix_d', '2026-09-03', c_chf, 'R', '2026-09-02', v_obs_d2, v_pub_orig, 'CHF'), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'E2d codigo que la version no trae: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day_rate (source_id, day, currency_definition_id, position, reference_date, observation_id, publication_id, source_code) '
                          'values (%L, %L, %L, %L, %L, %L, null, %L)',
                          'fix_d', '2026-09-03', c_chf, 'R', '2026-09-02', v_obs_d2, 'USD'), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'E2e tipo con codigo y sin version: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day (source_id, day, reference_date, observation_id) values (%L, %L, %L, %L)',
                          'fix_d', '2026-09-30', '2026-09-30', v_obs_d1), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'E2f R igual a X: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_day (source_id, day, reference_date, observation_id) values (%L, %L, %L, %L)',
                          'fix_d', '2026-09-02', '2026-09-01', v_obs_d1), 'postgres');
  if v <> '23505' then fallos := array_append(fallos, 'E2g un dia fijado dos veces: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_observation (source_id, observed_at, document_url, http_status, document_sha256, document_bytes, complete) '
                          'values (%L, now(), %L, 200, %L, 0, true)',
                          'fix_d', 'https://www.ecb.europa.eu/', repeat('0', 64)), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'E2h observacion completa sin ventana: ' || v); end if;
  v := pg_temp.try(format('insert into core.fx_observation (source_id, observed_at, document_url, http_status, document_sha256, document_bytes, complete, invalid_reason) '
                          'values (%L, now(), %L, 200, %L, 0, false, %L)',
                          'fix_d', 'https://www.ecb.europa.eu/', repeat('0', 64), 'otro'), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'E2i motivo fuera del vocabulario: ' || v); end if;

  -- E3 · nadie mas lee nada de esto todavia.
  foreach v in array array['anon', 'authenticated', 'nomey_writer', 'nomey_provisioner'] loop
    if pg_temp.try('select 1 from core.fx_day_rate limit 1', v) <> '42501' then
      fallos := array_append(fallos, format('E3 %s lee core.fx_day_rate', v));
    end if;
  end loop;

  if cardinality(fallos) > 0 then
    raise exception E'E · segunda barrera:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'E · policies de validez, insert-only, FK de dia, version y observacion, nadie mas lee: OK';
end
$e$;

-- ======================= F · errores de llamada ==============================
do $f$
declare
  fallos text[] := '{}';
  v text;
  c_doc constant text := '<x/>';
begin
  foreach v in array array[
    format('select sec.fx_ingest_at(null, %L, %L::jsonb, now())', c_doc, '{"url":"https://x","status":200}'),
    format('select sec.fx_ingest_at(%L, null, %L::jsonb, now())', 'fix_d', '{"url":"https://x","status":200}'),
    format('select sec.fx_ingest_at(%L, %L, null, now())', 'fix_d', c_doc),
    format('select sec.fx_ingest_at(%L, %L, %L::jsonb, null)', 'fix_d', c_doc, '{"url":"https://x","status":200}')
  ] loop
    if pg_temp.try(v, 'postgres') <> '22004' then
      fallos := array_append(fallos, 'F1 argumento nulo aceptado: ' || v);
    end if;
  end loop;
  foreach v in array array[
    '[]', '{"url":"https://x"}', '{"status":200}', '{"url":1,"status":200}', '{"url":"","status":200}',
    '{"url":"https://x","status":"200"}', '{"url":"https://x","status":2000}',
    '{"url":"https://x","status":200,"otro":1}', '{"url":"https://x","status":200,"etag":1}'
  ] loop
    if pg_temp.try(format('select sec.fx_ingest_at(%L, %L, %L::jsonb, now())', 'fix_d', c_doc, v), 'postgres') <> '22023' then
      fallos := array_append(fallos, 'F2 evidencia mal formada aceptada: ' || v);
    end if;
  end loop;
  if pg_temp.try(format('select sec.fx_ingest_at(%L, %L, %L::jsonb, %L)', 'fix_d', c_doc,
                        '{"url":"https://x","status":200}', 'infinity'), 'postgres') <> '22023' then
    fallos := array_append(fallos, 'F3 instante infinito aceptado');
  end if;
  if pg_temp.try(format('select sec.fx_ingest_at(%L, %L, %L::jsonb, now())', 'no_existe', c_doc,
                        '{"url":"https://x","status":200}'), 'postgres') <> '23503' then
    fallos := array_append(fallos, 'F4 fuente inexistente aceptada');
  end if;
  -- Nada de lo anterior dejo rastro.
  if exists (select 1 from core.fx_observation where document_url = 'https://x') then
    fallos := array_append(fallos, 'F5 un error de llamada registro una observacion');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'F · errores de llamada:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'F · argumentos nulos, evidencia mal formada, instante infinito y fuente inexistente: OK';
end
$f$;

-- ========= G · la cobertura no puede dejar fuera lo ya fijado (§5) ===========
-- La guarda es un constraint trigger DIFERIDO: comprueba el estado final, no
-- cada sentencia. `try_diferido` adelanta esa comprobacion.
do $g$
declare
  fallos text[] := '{}';
  v text;
  c_usd constant uuid := '34cb8424-2243-52d8-be99-e2b7d22884b8';
  c_eur constant uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  c_chf constant uuid := 'c8483062-e215-5da5-850e-cd7bfda52eff';
  v_max date;
begin
  -- En fix_d, USD tiene tipos fijados con fechas de referencia del 01 al 04 de
  -- septiembre (los dias 05, 06 y 07 usan el 04).
  select max(reference_date) into v_max from core.fx_day_rate
   where source_id = 'fix_d' and currency_definition_id = c_usd;
  if v_max is distinct from '2026-09-04' then
    fallos := array_append(fallos, 'G0 la ultima fecha usada por USD: ' || coalesce(v_max::text, 'ninguna'));
  end if;

  -- G1 · cerrar el intervalo por detras de esa fecha: rechazado.
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L '
    'where source_id = %L and currency_definition_id = %L',
    '2026-09-03', 'retirada', 'https://www.ecb.europa.eu/', 'fix_d', c_usd));
  if v <> '23514' then fallos := array_append(fallos, 'G1 retirada por detras de lo fijado: ' || v); end if;

  -- G2 · cerrarlo en esa misma fecha: permitido (el fin es inclusivo).
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L '
    'where source_id = %L and currency_definition_id = %L',
    '2026-09-04', 'retirada', 'https://www.ecb.europa.eu/', 'fix_d', c_usd));
  if v <> 'OK' then fallos := array_append(fallos, 'G2 retirada en la ultima fecha usada: ' || v); end if;

  -- G3 · mover el inicio por delante de una fecha ya usada: rechazado.
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set valid_from = %L where source_id = %L and currency_definition_id = %L',
    '2026-09-03', 'fix_d', c_usd));
  if v <> '23514' then fallos := array_append(fallos, 'G3 inicio por delante de lo fijado: ' || v); end if;

  -- G4 · borrar el intervalo: rechazado.
  v := pg_temp.try_diferido(format(
    'delete from core.fx_coverage where source_id = %L and currency_definition_id = %L', 'fix_d', c_usd));
  if v <> '23514' then fallos := array_append(fallos, 'G4 borrado del intervalo: ' || v); end if;

  -- G5 · y tambien para el pivote, que tiene tipo todos los dias fijados.
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L '
    'where source_id = %L and currency_definition_id = %L',
    '2026-09-02', 'retirada', 'https://www.ecb.europa.eu/', 'fix_d', c_eur));
  if v <> '23514' then fallos := array_append(fallos, 'G5 retirada del pivote por detras de lo fijado: ' || v); end if;

  -- G6 · cambiar la moneda del intervalo deja huerfanas las fijaciones de la
  --      anterior: tambien se rechaza.
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set currency_definition_id = %L, source_code = %L '
    'where source_id = %L and currency_definition_id = %L',
    c_chf, 'CHF', 'fix_d', c_usd));
  if v <> '23514' then fallos := array_append(fallos, 'G6 cambio de moneda del intervalo: ' || v); end if;

  -- G7 · DIFERIDO de verdad: cerrar el intervalo por detras deja un hueco, pero
  --      abrir en la misma transaccion otro que lo cubre es correcto.
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L '
    '  where source_id = %L and currency_definition_id = %L',
    '2026-09-02', 'reorganizacion', 'https://www.ecb.europa.eu/', 'fix_d', c_usd));
  if v <> '23514' then fallos := array_append(fallos, 'G7 el primer paso deja fechas sin cobertura: ' || v); end if;
  v := pg_temp.try_diferido(format(
    'update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L '
    '  where source_id = %L and currency_definition_id = %L; '
    'insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from, '
    '  valid_from_basis, valid_from_evidence) values (%L, %L, %L, %L, %L, %L);',
    '2026-09-02', 'reorganizacion', 'https://www.ecb.europa.eu/', 'fix_d', c_usd,
    'fix_d', c_usd, 'USD', '2026-09-03', 'reorganizacion', 'https://www.ecb.europa.eu/'));
  if v <> 'OK' then fallos := array_append(fallos, 'G7b los dos pasos juntos deberian valer: ' || v); end if;

  -- G8 · una moneda sin ninguna fijacion se puede retirar o borrar.
  perform pg_temp.fuente('cov_g', '2026-09-01');
  v := pg_temp.try_diferido(format(
    'delete from core.fx_coverage where source_id = %L and currency_definition_id = %L', 'cov_g', c_usd));
  if v <> 'OK' then fallos := array_append(fallos, 'G8 borrar cobertura sin fijaciones: ' || v); end if;

  -- G9 · la guarda es un constraint trigger diferido, y no entra en INSERT:
  --      anadir cobertura nunca puede dejar nada fuera.
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'core.fx_coverage'::regclass and not t.tgisinternal
         and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
         and (t.tgtype & 4) = 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0) <> 1 then
    fallos := array_append(fallos, 'G9 la guarda no es un constraint trigger diferido de UPDATE y DELETE');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'G · cobertura y fijaciones:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'G · una retirada no puede dejar fuera una fecha ya fijada, y lo diferido permite reorganizar en dos pasos: OK';
end
$g$;

rollback;

-- F6 · el aislamiento: con REPEATABLE READ la instantanea es anterior al
--      candado y la ingesta podria no ver lo que confirmo la anterior.
begin isolation level repeatable read;
do $h$
begin
  begin
    perform sec.fx_ingest_at('ecb', '', '{"url":"https://x","status":200}', now());
    raise exception 'F6 · la ingesta acepto REPEATABLE READ';
  exception when sqlstate '25000' then
    raise notice 'F6 · la ingesta exige READ COMMITTED: OK';
  end;
end
$h$;
rollback;
