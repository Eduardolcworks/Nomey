-- ============================================================================
-- CATALOGO FX Y COBERTURA CURADA · F11/ADR-001 §5 · F11/ADR-002 §5
-- ============================================================================
--
-- Migracion 20260919120000 (F11.B, M1). Contra el catalogo REAL, con fixtures
-- propias y ROLLBACK. Lo que se afirma:
--
--   A · catalogo y privilegios: RLS, rol de ingesta, ninguna escritura de
--       aplicacion, ninguna superficie nueva, y las guardas de conversion y de
--       escritura siguen como estaban
--   B · siembra: las 20 definiciones intactas, el BCE con el EUR como pivote,
--       las 17 coberturas esperadas, y ARS, COP y CLP sin cobertura
--   C · constraints, con fixtures: fin inclusivo, retirada, reincorporacion,
--       solapes, pivote, formato y trazabilidad
--   D · escrituras prohibidas intentadas con cada rol de aplicacion, y lectura
--       efectiva de los dos roles que la tienen
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/fx-catalog.sql

\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

-- Ejecuta una sentencia con el rol <role> y devuelve el SQLSTATE ('OK' si no
-- fallo). Cada llamada es un subbloque: lo que falla no deja rastro.
create function pg_temp.try(p_sql text, p_role text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', 'f11b0000-0000-4000-8000-0000000000a1')::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  perform pg_temp.super();
  return 'OK';
exception when others then
  perform pg_temp.super();
  return sqlstate;
end $$;

-- Como `try`, pero devuelve el primer valor de la consulta (o 'ERR <sqlstate>').
create function pg_temp.read(p_sql text, p_role text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('role', p_role, true);
  execute p_sql into v;
  perform pg_temp.super();
  return v;
exception when others then
  perform pg_temp.super();
  return 'ERR ' || sqlstate;
end $$;

grant execute on function pg_temp.super(), pg_temp.try(text, text), pg_temp.read(text, text)
  to anon, authenticated, nomey_writer, nomey_provisioner, nomey_fx_ingest;

-- ======================== A · catalogo y privilegios =========================
do $a$
declare
  fallos text[] := '{}';
  v_t text;
  v_n int;
begin
  -- A1 · las dos tablas existen, con RLS, sin FORCE y propiedad de postgres.
  select string_agg(c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity
                    || ':' || pg_get_userbyid(c.relowner), ',' order by c.relname)
    into v_t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relname in ('fx_source', 'fx_coverage') and c.relkind = 'r';
  if v_t is distinct from 'fx_coverage:true:false:postgres,fx_source:true:false:postgres' then
    fallos := array_append(fallos, 'A1 tablas, RLS o propietario: ' || coalesce(v_t, 'ausentes'));
  end if;

  -- A2 · el rol de ingesta: NOLOGIN, NOBYPASSRLS, sin poderes, sin heredar
  --      ningun otro rol y sin poseer nada.
  if not exists (select 1 from pg_roles
                  where rolname = 'nomey_fx_ingest'
                    and not rolcanlogin and not rolbypassrls and not rolsuper
                    and not rolcreatedb and not rolcreaterole and not rolreplication) then
    fallos := array_append(fallos, 'A2 nomey_fx_ingest no es NOLOGIN NOBYPASSRLS sin poderes');
  end if;
  if exists (select 1 from pg_auth_members m
              where m.member = 'nomey_fx_ingest'::regrole) then
    fallos := array_append(fallos, 'A2b nomey_fx_ingest es miembro de otro rol');
  end if;
  select count(*) into v_n from pg_class where relowner = 'nomey_fx_ingest'::regrole;
  v_n := v_n + (select count(*) from pg_proc where proowner = 'nomey_fx_ingest'::regrole);
  if v_n <> 0 then
    fallos := array_append(fallos, format('A2c nomey_fx_ingest posee %s objetos', v_n));
  end if;

  -- A3 · privilegios de tabla EXACTOS sobre las dos tablas, para todo rol que
  --      no sea el propietario: solo SELECT, y solo writer e ingesta.
  select string_agg(distinct g.rolname || '=' || a.privilege_type, ',' order by g.rolname || '=' || a.privilege_type)
    into v_t
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    join pg_roles g on g.oid = a.grantee
   where c.oid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass)
     and a.grantee <> c.relowner;
  if v_t is distinct from 'nomey_fx_ingest=SELECT,nomey_writer=SELECT' then
    fallos := array_append(fallos, 'A3 privilegios de tabla: ' || coalesce(v_t, 'ninguno'));
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
              where c.oid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass)
                and a.grantee = 0) then
    fallos := array_append(fallos, 'A3b PUBLIC tiene privilegios sobre el catalogo FX');
  end if;
  select count(*) into v_n
    from pg_attribute at cross join lateral aclexplode(at.attacl) a
   where at.attrelid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass);
  if v_n <> 0 then
    fallos := array_append(fallos, format('A3c hay %s privilegios de columna', v_n));
  end if;

  -- A3d · ningun rol de aplicacion puede escribir, ni por herencia.
  select string_agg(r || ':' || t || ':' || p, ',') into v_t
    from unnest(array['anon','authenticated','service_role','nomey_writer',
                      'nomey_provisioner','nomey_fx_ingest']) r,
         unnest(array['core.fx_source','core.fx_coverage']) t,
         unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   where has_table_privilege(r, t, p);
  if v_t is not null then
    fallos := array_append(fallos, 'A3d escritura de aplicacion: ' || v_t);
  end if;
  select string_agg(r || ':' || t, ',') into v_t
    from unnest(array['anon','authenticated','service_role','nomey_provisioner']) r,
         unnest(array['core.fx_source','core.fx_coverage']) t
   where has_table_privilege(r, t, 'SELECT');
  if v_t is not null then
    fallos := array_append(fallos, 'A3e lectura no prevista: ' || v_t);
  end if;

  -- A4 · policies: una por tabla, solo lectura, para writer e ingesta, nunca
  --      PUBLIC ni cliente.
  select string_agg(c.relname || ':' || p.polcmd::text || ':' || p.polpermissive || ':'
                    || (select string_agg(rolname, '+' order by rolname) from pg_roles where oid = any (p.polroles))
                    || ':' || pg_get_expr(p.polqual, p.polrelid),
                    ',' order by c.relname)
    into v_t
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.oid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass);
  if v_t is distinct from 'fx_coverage:r:true:nomey_fx_ingest+nomey_writer:true,'
                          'fx_source:r:true:nomey_fx_ingest+nomey_writer:true' then
    fallos := array_append(fallos, 'A4 policies: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- A5 · el rol de ingesta: de los schemas de Nomey y de Supabase, USAGE solo
  --      sobre core (public y extensions son de PUBLIC por defecto y no
  --      contienen nada de Nomey); SELECT solo sobre las dos tablas; ninguna
  --      funcion de Nomey ejecutable.
  select string_agg(s, ',' order by s) into v_t
    from unnest(array['core','sec','api','auth','storage','graphql_public']) s
   where exists (select 1 from pg_namespace where nspname = s)
     and (has_schema_privilege('nomey_fx_ingest', s, 'USAGE')
          or has_schema_privilege('nomey_fx_ingest', s, 'CREATE'));
  if v_t is distinct from 'core' then
    fallos := array_append(fallos, 'A5 schemas de la ingesta: ' || coalesce(v_t, 'ninguno'));
  end if;
  select string_agg(n.nspname || '.' || c.relname || '=' || a.privilege_type, ','
                    order by n.nspname || '.' || c.relname || '=' || a.privilege_type)
    into v_t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where a.grantee = 'nomey_fx_ingest'::regrole;
  if v_t is distinct from 'core.fx_coverage=SELECT,core.fx_source=SELECT' then
    fallos := array_append(fallos, 'A5b privilegios de la ingesta: ' || coalesce(v_t, 'ninguno'));
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('core', 'sec', 'api')
     and has_function_privilege('nomey_fx_ingest', p.oid, 'EXECUTE');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5c la ingesta puede ejecutar %s funciones de Nomey', v_n));
  end if;

  -- A6 · ninguna superficie nueva: la escritura sigue siendo las 9 funciones
  --      record_*, nada de api nombra FX, y nada lee todavia el catalogo FX.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname like 'record\_%';
  if v_n <> 9 then
    fallos := array_append(fallos, format('A6 hay %s funciones api.record_* y deberian ser 9', v_n));
  end if;
  select count(*) into v_n
    from (select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api'
          union all
          select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'api') o
   where o.name ilike '%fx%' or o.name ilike '%coverage%';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6b hay %s objetos de api que nombran FX', v_n));
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('api', 'sec', 'core')
     and (p.prosrc like '%fx\_source%' or p.prosrc like '%fx\_coverage%');
  v_n := v_n + (select count(*) from pg_depend d
                 where d.refobjid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass)
                   and d.classid = 'pg_rewrite'::regclass);
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6c %s funciones o vistas leen ya el catalogo FX', v_n));
  end if;

  -- A7 · la conversion congelada sigue sin ruta: el writer no recupero INSERT,
  --      y su policy de INSERT disenada sigue ahi.
  if has_table_privilege('nomey_writer', 'core.frozen_conversion', 'INSERT') then
    fallos := array_append(fallos, 'A7 nomey_writer tiene INSERT sobre core.frozen_conversion');
  end if;
  if has_table_privilege('nomey_fx_ingest', 'core.frozen_conversion', 'SELECT') then
    fallos := array_append(fallos, 'A7b la ingesta alcanza core.frozen_conversion');
  end if;
  select count(*) into v_n from pg_policy
   where polrelid = 'core.frozen_conversion'::regclass and polcmd = 'a';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A7c frozen_conversion tiene %s policies de INSERT y deberia tener 1', v_n));
  end if;

  -- A8 · la integridad la dan constraints, no triggers.
  select count(*) into v_n from pg_trigger
   where tgrelid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass) and not tgisinternal;
  if v_n <> 0 then
    fallos := array_append(fallos, format('A8 hay %s triggers en el catalogo FX', v_n));
  end if;
  select string_agg(conname || ':' || contype::text, ',' order by conname) into v_t
    from pg_constraint
   where conrelid = 'core.fx_coverage'::regclass and contype in ('f', 'x', 'p');
  if v_t is distinct from 'fx_coverage_codigo_sin_solapes:x,fx_coverage_currency_definition_id_fkey:f,'
                          'fx_coverage_pk:p,fx_coverage_sin_codigo_es_el_pivote:f,'
                          'fx_coverage_sin_solapes:x,fx_coverage_source_id_fkey:f' then
    fallos := array_append(fallos, 'A8b constraints de fx_coverage: ' || coalesce(v_t, 'ninguna'));
  end if;
  -- Ninguna FK hacia el catalogo monetario borra o anula en cascada.
  if exists (select 1 from pg_constraint
              where conrelid in ('core.fx_source'::regclass, 'core.fx_coverage'::regclass)
                and contype = 'f' and (confdeltype <> 'a' or confupdtype <> 'a')) then
    fallos := array_append(fallos, 'A8c una FK del catalogo FX tiene accion en cascada');
  end if;

  -- A9 · nada de geografia: las columnas son exactamente estas.
  select string_agg(table_name || '.' || column_name, ',' order by table_name, ordinal_position)
    into v_t
    from information_schema.columns
   where table_schema = 'core' and table_name in ('fx_source', 'fx_coverage');
  if v_t is distinct from
     'fx_coverage.source_id,fx_coverage.currency_definition_id,fx_coverage.valid_from,'
     'fx_coverage.valid_until,fx_coverage.source_code,fx_coverage.valid_from_basis,'
     'fx_coverage.valid_from_evidence,fx_coverage.valid_until_basis,fx_coverage.valid_until_evidence,'
     'fx_coverage.pivot_currency_definition_id,'
     'fx_source.id,fx_source.name,fx_source.pivot_currency_definition_id,'
     'fx_source.first_reference_date,fx_source.evidence_url' then
    fallos := array_append(fallos, 'A9 columnas del catalogo FX: ' || coalesce(v_t, 'ninguna'));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'A · catalogo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'A · RLS, rol de ingesta, privilegios exactos, sin superficie nueva, frozen_conversion sin ruta: OK';
end
$a$;

-- ================================ B · siembra ================================
do $b$
declare
  fallos text[] := '{}';
  v_t text;
  v_n int;
begin
  -- B1 · las 20 definiciones monetarias, intactas: identidad, codigo y escala.
  select count(*) into v_n from (
    (select id, code, scale from core.currency_definition
     except
     select * from (values
       ('830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid, 'EUR', 2::smallint),
       ('34cb8424-2243-52d8-be99-e2b7d22884b8', 'USD', 2), ('fe22eeff-f72b-50ce-9b37-6033833df95e', 'GBP', 2),
       ('c8483062-e215-5da5-850e-cd7bfda52eff', 'CHF', 2), ('f981b2f9-a022-5de8-aa6d-3af277d9dcd3', 'JPY', 0),
       ('6cfbf3ad-967d-50ba-9822-f1afbb10f7f5', 'CAD', 2), ('c9203a94-12aa-5d7f-8703-2ee17e524dca', 'AUD', 2),
       ('c3d5768c-33be-5ab8-896e-38203ac5cc48', 'NZD', 2), ('f725bdd8-5690-53a8-85c0-eabed7405c10', 'SEK', 2),
       ('f2fe8324-641c-548d-b3af-411db0d39448', 'NOK', 2), ('31f1a13d-3829-5af9-9b65-e5da1181b9ac', 'DKK', 2),
       ('a280144a-a4a0-55cd-98db-7b8acf25a638', 'PLN', 2), ('d281d5cf-cdd5-5207-93a5-df1f80e6de84', 'CZK', 2),
       ('8b951c59-bbd1-539b-9336-4174fbf47bdb', 'HUF', 2), ('8b33cd38-5e20-5145-bee9-c0b81c9a81ba', 'RON', 2),
       ('b500e177-a2ff-5a55-b0b6-868dc91a10f6', 'MXN', 2), ('50850a6c-39ff-5f35-85aa-afd6ea3732e6', 'BRL', 2),
       ('6cbdabc6-2d2f-5090-a063-3a366f9fd23d', 'ARS', 2), ('3304aa15-10b1-5eca-a6c8-3c149a9f91f1', 'COP', 2),
       ('a85ae854-0a0d-51de-bb34-4b7a20229bb9', 'CLP', 0)) e (id, code, scale))
  ) d;
  if v_n <> 0 or (select count(*) from core.currency_definition) <> 20 then
    fallos := array_append(fallos, format('B1 el catalogo monetario cambio (%s filas distintas, %s en total)',
                                          v_n, (select count(*) from core.currency_definition)));
  end if;

  -- B2 · una sola fuente, el BCE, con el EUR como pivote y su primera fecha.
  select string_agg(s.id || ':' || c.code || ':' || s.first_reference_date, ',') into v_t
    from core.fx_source s join core.currency_definition c on c.id = s.pivot_currency_definition_id;
  if v_t is distinct from 'ecb:EUR:1999-01-04' then
    fallos := array_append(fallos, 'B2 fuente: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- B3 · la cobertura sembrada es EXACTAMENTE esta: 17 intervalos abiertos, uno
  --      por definicion, por identidad y no por codigo ISO.
  select string_agg(c.code || '>' || coalesce(v.source_code, '-') || '@' || v.valid_from
                    || '..' || coalesce(v.valid_until::text, ''), ',' order by c.code)
    into v_t
    from core.fx_coverage v join core.currency_definition c on c.id = v.currency_definition_id;
  if v_t is distinct from
     'AUD>AUD@1999-01-04..,BRL>BRL@2008-01-02..,CAD>CAD@1999-01-04..,CHF>CHF@1999-01-04..,'
     'CZK>CZK@1999-01-04..,DKK>DKK@1999-01-04..,EUR>-@1999-01-04..,GBP>GBP@1999-01-04..,'
     'HUF>HUF@1999-01-04..,JPY>JPY@1999-01-04..,MXN>MXN@2008-01-02..,NOK>NOK@1999-01-04..,'
     'NZD>NZD@1999-01-04..,PLN>PLN@1999-01-04..,RON>RON@2005-07-01..,SEK>SEK@1999-01-04..,'
     'USD>USD@1999-01-04..' then
    fallos := array_append(fallos, 'B3 cobertura sembrada: ' || coalesce(v_t, 'ninguna'));
  end if;
  select count(*) into v_n from core.fx_coverage v
   where v.source_id <> 'ecb'
      or v.currency_definition_id not in (
           '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', '34cb8424-2243-52d8-be99-e2b7d22884b8',
           'fe22eeff-f72b-50ce-9b37-6033833df95e', 'c8483062-e215-5da5-850e-cd7bfda52eff',
           'f981b2f9-a022-5de8-aa6d-3af277d9dcd3', '6cfbf3ad-967d-50ba-9822-f1afbb10f7f5',
           'c9203a94-12aa-5d7f-8703-2ee17e524dca', 'c3d5768c-33be-5ab8-896e-38203ac5cc48',
           'f725bdd8-5690-53a8-85c0-eabed7405c10', 'f2fe8324-641c-548d-b3af-411db0d39448',
           '31f1a13d-3829-5af9-9b65-e5da1181b9ac', 'a280144a-a4a0-55cd-98db-7b8acf25a638',
           'd281d5cf-cdd5-5207-93a5-df1f80e6de84', '8b951c59-bbd1-539b-9336-4174fbf47bdb',
           '8b33cd38-5e20-5145-bee9-c0b81c9a81ba', 'b500e177-a2ff-5a55-b0b6-868dc91a10f6',
           '50850a6c-39ff-5f35-85aa-afd6ea3732e6');
  if v_n <> 0 then
    fallos := array_append(fallos, format('B3b %s intervalos fuera de las 17 identidades esperadas', v_n));
  end if;

  -- B4 · ARS, COP y CLP siguen en el catalogo y no tienen ninguna cobertura.
  select string_agg(c.code, ',' order by c.code) into v_t
    from core.currency_definition c
   where c.id in ('6cbdabc6-2d2f-5090-a063-3a366f9fd23d', '3304aa15-10b1-5eca-a6c8-3c149a9f91f1',
                  'a85ae854-0a0d-51de-bb34-4b7a20229bb9')
     and not exists (select 1 from core.fx_coverage v where v.currency_definition_id = c.id);
  if v_t is distinct from 'ARS,CLP,COP' then
    fallos := array_append(fallos, 'B4 ARS/COP/CLP en catalogo y sin cobertura: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- B5 · el pivote: un unico intervalo sin codigo, y es el pivote de la fuente.
  select string_agg(v.currency_definition_id::text, ',') into v_t
    from core.fx_coverage v where v.source_code is null;
  if v_t is distinct from '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'
     or exists (select 1 from core.fx_coverage v join core.fx_source s on s.id = v.source_id
                 where v.currency_definition_id = s.pivot_currency_definition_id
                   and v.source_code is not null) then
    fallos := array_append(fallos, 'B5 pivote mal representado: ' || coalesce(v_t, 'sin intervalo'));
  end if;

  -- B6 · ningun solape vivo, y ningun intervalo antes de la primera publicacion.
  select count(*) into v_n
    from core.fx_coverage a join core.fx_coverage b
      on a.source_id = b.source_id
     and (a.currency_definition_id = b.currency_definition_id or a.source_code = b.source_code)
     and (a.currency_definition_id, a.valid_from) <> (b.currency_definition_id, b.valid_from)
     and daterange(a.valid_from, a.valid_until, '[]') && daterange(b.valid_from, b.valid_until, '[]');
  if v_n <> 0 then
    fallos := array_append(fallos, format('B6 hay %s pares de intervalos solapados', v_n));
  end if;
  select count(*) into v_n
    from core.fx_coverage v join core.fx_source s on s.id = v.source_id
   where v.valid_from < s.first_reference_date;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B6b %s intervalos empiezan antes de la primera publicacion', v_n));
  end if;

  -- B7 · trazabilidad de la siembra: base y evidencia en cada inicio.
  select count(*) into v_n from core.fx_coverage
   where valid_from_basis = '' or valid_from_evidence not like 'https://www.ecb.europa.eu/%';
  if v_n <> 0 then
    fallos := array_append(fallos, format('B7 %s intervalos sin base o sin evidencia del BCE', v_n));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'B · siembra:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'B · 20 definiciones intactas, BCE con pivote EUR, 17 coberturas, ARS/COP/CLP sin cobertura: OK';
end
$b$;

-- ===================== C · constraints, con fixtures propias =================
-- Como postgres, que es el propietario y quien cura por migracion: aqui se
-- prueban CONSTRAINTS. Definiciones ficticias con UUID de fixture; codigos
-- reales de monedas retiradas o con hueco, con sus fechas medidas en
-- eurofxref-hist.xml el 2026-09-15. Van en un savepoint que se deshace al
-- terminar la seccion: D comprueba el catalogo sembrado, sin fixtures.
savepoint fixtures;
do $c$
declare
  fallos text[] := '{}';
  BGN constant uuid := 'f11b0000-0000-4000-8000-000000000001';  -- retirada
  ISK constant uuid := 'f11b0000-0000-4000-8000-000000000002';  -- hueco y reincorporacion
  TMP constant uuid := 'f11b0000-0000-4000-8000-000000000003';  -- intervalo abierto
  OTR constant uuid := 'f11b0000-0000-4000-8000-000000000004';  -- sin intervalos
  HIST constant text := 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';
  NOTA constant text := 'https://www.ecb.europa.eu/services/using-our-site/technical-updates/html/ecb.mid_update251217.en.html';
  v text;
  ins constant text := 'insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from, valid_until, '
                       'valid_from_basis, valid_from_evidence, valid_until_basis, valid_until_evidence) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)';
begin
  insert into core.currency_definition (id, code, scale) values
    (BGN, 'BGN', 2), (ISK, 'ISK', 0), (TMP, 'TMP', 2), (OTR, 'OTR', 2);

  -- C1 · una retirada registrada: intervalo cerrado con base y nota del BCE.
  v := pg_temp.try(format(ins, 'ecb', BGN, 'BGN', '2000-07-19', '2025-12-31',
                          'Primera publicacion de BGN', HIST,
                          'Retirada: ultima publicacion 2025-12-31', NOTA), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C1 retirada no registrable: ' || v); end if;

  -- C2 · el fin es INCLUSIVO: la ultima fecha cubierta esta dentro, la
  --      siguiente publicacion (2026-01-02) no.
  if not exists (select 1 from core.fx_coverage where currency_definition_id = BGN
                   and daterange(valid_from, valid_until, '[]') @> date '2025-12-31') then
    fallos := array_append(fallos, 'C2 el fin no esta dentro del intervalo');
  end if;
  if exists (select 1 from core.fx_coverage where currency_definition_id = BGN
               and daterange(valid_from, valid_until, '[]') @> date '2026-01-02') then
    fallos := array_append(fallos, 'C2b una fecha posterior a la retirada sigue cubierta');
  end if;
  if exists (select 1 from core.fx_coverage where currency_definition_id = BGN
               and daterange(valid_from, valid_until, '[]') @> date '2000-07-18') then
    fallos := array_append(fallos, 'C2c una fecha anterior al inicio esta cubierta');
  end if;
  -- ... y por eso un intervalo que empieza el mismo dia del fin SE SOLAPA,
  --     y uno que empieza el dia siguiente no.
  v := pg_temp.try(format(ins, 'ecb', BGN, 'BGN', '2025-12-31', null, 'x', HIST, null, null), 'postgres');
  if v <> '23P01' then fallos := array_append(fallos, 'C2d inicio igual al fin no rechazado: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', BGN, 'BGN', '2026-01-01', '2026-01-01', 'x', HIST, 'y', HIST), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C2e intervalo contiguo rechazado: ' || v); end if;

  -- C3 · la definicion retirada SIGUE en el catalogo, y el catalogo no puede
  --      perderla mientras tenga cobertura: ninguna cascada.
  if not exists (select 1 from core.currency_definition where id = BGN) then
    fallos := array_append(fallos, 'C3 la definicion retirada desaparecio');
  end if;
  v := pg_temp.try(format('delete from core.currency_definition where id = %L', BGN), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'C3b borrar una definicion con cobertura: ' || v); end if;

  -- C4 · reincorporacion tras un hueco (ISK): dos intervalos, el hueco sin
  --      cobertura, y un tercero que pisa cualquiera de los dos se rechaza.
  v := pg_temp.try(format(ins, 'ecb', ISK, 'ISK', '1999-01-04', '2008-12-09', 'Inicio', HIST, 'Suspension', HIST), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C4 primer intervalo de ISK: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', ISK, 'ISK', '2018-02-01', null, 'Reincorporacion', HIST, null, null), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C4b reincorporacion de ISK: ' || v); end if;
  if exists (select 1 from core.fx_coverage where currency_definition_id = ISK
               and daterange(valid_from, valid_until, '[]') @> date '2012-06-01') then
    fallos := array_append(fallos, 'C4c el hueco de ISK esta cubierto');
  end if;
  v := pg_temp.try(format(ins, 'ecb', ISK, 'ISK', '2010-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23P01' then fallos := array_append(fallos, 'C4d solape con el intervalo abierto: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', ISK, 'ISK', '2008-01-01', '2008-12-31', 'x', HIST, 'y', HIST), 'postgres');
  if v <> '23P01' then fallos := array_append(fallos, 'C4e solape con el intervalo cerrado: ' || v); end if;

  -- C5 · registrar una retirada sobre un intervalo abierto (lo que hara una
  --      migracion): exige fin, base y nota a la vez, y fin >= inicio.
  v := pg_temp.try(format(ins, 'ecb', TMP, 'XTM', '2020-01-02', null, 'Inicio', HIST, null, null), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C5 intervalo abierto: ' || v); end if;
  v := pg_temp.try(format('update core.fx_coverage set valid_until = %L where currency_definition_id = %L',
                          '2024-05-31', TMP), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C5b fin sin base ni nota: ' || v); end if;
  v := pg_temp.try(format('update core.fx_coverage set valid_until_basis = %L, valid_until_evidence = %L where currency_definition_id = %L',
                          'x', HIST, TMP), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C5c base de fin sin fin: ' || v); end if;
  v := pg_temp.try(format('update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L where currency_definition_id = %L',
                          '2019-12-31', 'x', HIST, TMP), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C5d fin anterior al inicio: ' || v); end if;
  v := pg_temp.try(format('update core.fx_coverage set valid_until = %L, valid_until_basis = %L, valid_until_evidence = %L where currency_definition_id = %L',
                          '2020-01-02', 'Retirada el mismo dia', HIST, TMP), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C5e intervalo de un solo dia: ' || v); end if;

  -- C6 · solo el pivote carece de codigo, y el pivote no se duplica.
  v := pg_temp.try(format(ins, 'ecb', TMP, null, '2030-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'C6 sin codigo y no pivote: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', null, '2030-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23P01' then fallos := array_append(fallos, 'C6b segundo intervalo solapado del pivote: ' || v); end if;

  -- C7 · un codigo de la fuente no pertenece a dos definiciones a la vez; si a
  --      dos en momentos distintos.
  v := pg_temp.try(format(ins, 'ecb', TMP, 'USD', '2030-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23P01' then fallos := array_append(fallos, 'C7 USD para dos definiciones a la vez: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', TMP, 'BGN', '2026-02-01', null, 'x', HIST, null, null), 'postgres');
  if v <> 'OK' then fallos := array_append(fallos, 'C7b codigo reutilizado tras su fin: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', OTR, 'BGN', '2026-03-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23P01' then fallos := array_append(fallos, 'C7c codigo reutilizado por dos: ' || v); end if;

  -- C8 · formato del codigo, fechas finitas, evidencia https, base no vacia.
  v := pg_temp.try(format(ins, 'ecb', TMP, 'usd', '2031-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C8 codigo en minusculas: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', TMP, 'US', '2031-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C8b codigo de dos letras: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', TMP, 'XTN', 'infinity', null, 'x', HIST, null, null), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C8c inicio infinito: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', TMP, 'XTN', '2031-01-01', 'infinity', 'x', HIST, 'y', HIST), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C8d fin infinito: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', TMP, 'XTN', '2031-01-01', null, 'x', 'http://example.com', null, null), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C8e evidencia sin https: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', TMP, 'XTN', '2031-01-01', null, '', HIST, null, null), 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C8f base vacia: ' || v); end if;

  -- C9 · integridad referencial: fuente y definicion existentes.
  v := pg_temp.try(format(ins, 'otra', TMP, 'XTN', '2031-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'C9 fuente inexistente: ' || v); end if;
  v := pg_temp.try(format(ins, 'ecb', 'f11b0000-0000-4000-8000-0000000000ff', 'XTN', '2031-01-01', null, 'x', HIST, null, null), 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'C9b definicion inexistente: ' || v); end if;
  v := pg_temp.try('insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url) '
                   'values (''Otra Fuente'', ''x'', ''830e6f7e-2e33-564e-9ea3-f6c2023af1fe'', ''1999-01-04'', ''https://x'')', 'postgres');
  if v <> '23514' then fallos := array_append(fallos, 'C9c identificador de fuente mal formado: ' || v); end if;
  v := pg_temp.try('insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url) '
                   'values (''otra'', ''x'', ''f11b0000-0000-4000-8000-0000000000ff'', ''1999-01-04'', ''https://x'')', 'postgres');
  if v <> '23503' then fallos := array_append(fallos, 'C9d pivote inexistente: ' || v); end if;

  if cardinality(fallos) > 0 then
    raise exception E'C · constraints:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'C · fin inclusivo, retirada, reincorporacion, solapes, pivote, formato y trazabilidad: OK';
end
$c$;
rollback to savepoint fixtures;

-- ============= D · escrituras prohibidas y lectura efectiva, por rol ==========
do $d$
declare
  fallos text[] := '{}';
  v text;
  r text;
  s text;
begin
  -- D1 · ningun rol de aplicacion escribe ni manipula el catalogo.
  foreach r in array array['anon', 'authenticated', 'nomey_writer', 'nomey_provisioner', 'nomey_fx_ingest'] loop
    foreach s in array array[
      'insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url) '
        'values (''otra'', ''x'', ''830e6f7e-2e33-564e-9ea3-f6c2023af1fe'', ''1999-01-04'', ''https://x'')',
      'update core.fx_source set first_reference_date = ''1998-01-01''',
      'delete from core.fx_source',
      'truncate core.fx_source cascade',
      'insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from, valid_from_basis, valid_from_evidence) '
        'values (''ecb'', ''6cbdabc6-2d2f-5090-a063-3a366f9fd23d'', ''ARS'', ''2020-01-02'', ''x'', ''https://x'')',
      'update core.fx_coverage set valid_until = valid_from, valid_until_basis = ''x'', valid_until_evidence = ''https://x''',
      'update core.fx_coverage set source_code = ''XXX'' where source_code = ''USD''',
      'delete from core.fx_coverage',
      'truncate core.fx_coverage'
    ] loop
      v := pg_temp.try(s, r);
      if v <> '42501' then
        fallos := array_append(fallos, format('D1 %s: %s -> %s', r, left(s, 40), v));
      end if;
    end loop;
  end loop;

  -- D2 · los clientes y el provisioner ni siquiera leen.
  foreach r in array array['anon', 'authenticated', 'nomey_provisioner'] loop
    v := pg_temp.read('select count(*)::text from core.fx_coverage', r);
    if v <> 'ERR 42501' then fallos := array_append(fallos, format('D2 %s lee la cobertura: %s', r, v)); end if;
    v := pg_temp.read('select count(*)::text from core.fx_source', r);
    if v <> 'ERR 42501' then fallos := array_append(fallos, format('D2b %s lee la fuente: %s', r, v)); end if;
  end loop;

  -- D3 · writer e ingesta leen de verdad: no el «cero filas sin error» de E21.
  foreach r in array array['nomey_writer', 'nomey_fx_ingest'] loop
    v := pg_temp.read('select count(*)::text from core.fx_coverage where source_id = ''ecb''', r);
    if v <> '17' then fallos := array_append(fallos, format('D3 %s ve %s intervalos y deberia ver 17', r, v)); end if;
    v := pg_temp.read('select pivot_currency_definition_id::text from core.fx_source where id = ''ecb''', r);
    if v is distinct from '830e6f7e-2e33-564e-9ea3-f6c2023af1fe' then
      fallos := array_append(fallos, format('D3b %s no ve el pivote: %s', r, v));
    end if;
  end loop;

  -- D4 · y la ingesta no alcanza nada contable ni de identidad.
  foreach s in array array['core.operation', 'core.operation_version', 'core.effect', 'core.scope',
                           'core.frozen_conversion', 'core.currency_definition', 'core.participant_user_link'] loop
    v := pg_temp.read(format('select count(*)::text from %s', s), 'nomey_fx_ingest');
    if v <> 'ERR 42501' then fallos := array_append(fallos, format('D4 la ingesta lee %s: %s', s, v)); end if;
  end loop;

  -- D5 · nada de lo anterior cambio el catalogo.
  if (select count(*) from core.fx_coverage where source_id = 'ecb') <> 17
     or (select count(*) from core.fx_source) <> 1 then
    fallos := array_append(fallos, 'D5 el catalogo cambio durante los intentos');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'D · roles:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'D · ningun rol de aplicacion escribe; clientes y provisioner no leen; writer e ingesta leen las 17: OK';
end
$d$;

rollback;
