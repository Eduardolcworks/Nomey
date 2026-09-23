-- ============================================================================
-- LA CONVERSION CONGELADA DE UN GASTO DE GRUPO, LEIDA · F11/ADR-003 · F11 UI
-- ============================================================================
--
-- Migracion 20261004120000. Contra el writer REAL de F11.D y la funcion lectora
-- real, con identidad simulada, fixtures propias y ROLLBACK.
--
-- Los dias fijados se siembran COMO POSTGRES, dentro de esta transaccion y en
-- fechas de 2099 que ninguna ingesta real habra fijado: nunca se ingiere un
-- documento sintetico en `ecb`.
--
--   A · la superficie: definer de `postgres`, `search_path` fijado, `public`
--       sin EXECUTE, y el cliente SIN acceso directo a `core.frozen_conversion`
--   B · un miembro lee el tipo del grupo, identico a lo congelado
--   C · SOLO el ambito del grupo: ni el Personal del pagador ni el de nadie
--   D · aislamiento: quien no es miembro no lee, y pedir ids ajenos no enumera
--   E · sin conversion no hay fila
--   F · solo la version VIGENTE: corregir a otra moneda publica el tipo NUEVO
--   G · falsacion de los dos casos determinantes

\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

create function pg_temp.como(p_sql text, p_role text, p_actor uuid) returns text
language plpgsql as $$
declare
  v text; v_msg text; v_det text;
begin
  if p_actor is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_actor::text)::text, true);
  end if;
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

create function pg_temp.api(p_fn text, p_payload jsonb, p_actor uuid) returns text language sql as $$
  select pg_temp.como(format('select api.%I(%L::jsonb)::text', p_fn, p_payload), 'authenticated', p_actor);
$$;

create function pg_temp.op(p_res text) returns uuid language sql as $op$
  select case when left(p_res, 1) = '{' then (p_res::jsonb ->> 'operation_id')::uuid end;
$op$;

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

create temporary table gcr (k text primary key, v text) on commit drop;
insert into gcr (k, v) values
  ('U1',  'f11e0000-0000-4000-8000-0000000000a1'),   -- pagador y miembro
  ('U2',  'f11e0000-0000-4000-8000-0000000000a2'),   -- miembro, Personal en USD
  ('U9',  'f11e0000-0000-4000-8000-0000000000a9'),   -- AJENO al grupo
  ('S1',  'f11e0000-0000-4000-8000-000000000001'),
  ('S2',  'f11e0000-0000-4000-8000-000000000002'),
  ('S9',  'f11e0000-0000-4000-8000-000000000009'),
  ('G',   'f11e0000-0000-4000-8000-000000000010'),
  ('P1',  'f11e0000-0000-4000-8000-000000000031'),
  ('P2',  'f11e0000-0000-4000-8000-000000000032'),
  ('EUR', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  ('USD', '34cb8424-2243-52d8-be99-e2b7d22884b8'),
  ('JPY', 'f981b2f9-a022-5de8-aa6d-3af277d9dcd3'),
  ('CAT', '4ed30a44-9f82-578f-828c-b491a25ebdd9'),
  ('X1',  '2099-04-10'),
  ('X2',  '2099-04-11');
create function pg_temp.f(p_k text) returns text language sql as $$
  select v from gcr where k = p_k;
$$;
grant select on gcr to authenticated, nomey_writer;
grant execute on function pg_temp.f(text), pg_temp.api(text, jsonb, uuid), pg_temp.op(text),
                         pg_temp.super(), pg_temp.como(text, text, uuid)
  to authenticated, nomey_writer;

-- ═══════════════════════════════ el escenario ═══════════════════════════════
do $setup$
declare
  v_out jsonb;
begin
  perform pg_temp.fijar(pg_temp.f('X1')::date, '2099-04-09',
    '{"USD":["11592",4,"1.1592"],"JPY":["17856",2,"178.56"]}');
  perform pg_temp.fijar(pg_temp.f('X2')::date, '2099-04-10',
    '{"USD":["12",1,"1.2"],"JPY":["180",0,"180"]}');

  -- El Personal de U2 NO va en la moneda del grupo: asi el gasto congela dos
  -- conversiones y la de C deja de ser una comprobacion en vacio.
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (pg_temp.f('S1')::uuid, 'personal', pg_temp.f('EUR')::uuid, pg_temp.f('U1')::uuid),
    (pg_temp.f('S2')::uuid, 'personal', pg_temp.f('USD')::uuid, pg_temp.f('U2')::uuid),
    (pg_temp.f('S9')::uuid, 'personal', pg_temp.f('EUR')::uuid, pg_temp.f('U9')::uuid);
  insert into core.membership (scope_id, user_id) values
    (pg_temp.f('S1')::uuid, pg_temp.f('U1')::uuid),
    (pg_temp.f('S2')::uuid, pg_temp.f('U2')::uuid),
    (pg_temp.f('S9')::uuid, pg_temp.f('U9')::uuid);

  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('U1'))::text, true);
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'f11e0000-0000-4000-8000-0000000000c1'::uuid,
    'command_contract_version', 1,
    'client_group_id', pg_temp.f('G'), 'display_name', 'Viaje', 'emoji', 'GRP',
    'currency_definition_id', pg_temp.f('EUR'),
    'creator_participant_id', pg_temp.f('P1'), 'creator_display_name', 'Uno',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', pg_temp.f('P2'), 'display_name', 'Dos'))));
  perform pg_temp.super();

  -- P2 es la identidad de U2 en el grupo. Se siembra como postgres: ningun
  -- comando produce esta forma sin una invitacion, y lo que se mide aqui es la
  -- lectura de la conversion, no el alta.
  insert into core.participant_user_link (participant_id, scope_id, user_id, linked_at)
  values (pg_temp.f('P2')::uuid, pg_temp.f('G')::uuid, pg_temp.f('U2')::uuid, now());
  insert into core.membership (scope_id, user_id) values
    (pg_temp.f('G')::uuid, pg_temp.f('U2')::uuid);
end
$setup$;

create function pg_temp.gasto(p_key text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', pg_temp.f('G'), 'currency_definition_id', pg_temp.f('JPY'),
    'total', '150000', 'effective_date', pg_temp.f('X1'), 'effective_time', '10:00',
    'concept', 'Cena', 'category_id', pg_temp.f('CAT'),
    'payer_participant_id', pg_temp.f('P1'),
    'participants', jsonb_build_array(pg_temp.f('P1'), pg_temp.f('P2')),
    'split_method', jsonb_build_object('kind', 'equal'),
    'expected_base_currency_definition_id', pg_temp.f('EUR')) || p_extra;
$$;
grant execute on function pg_temp.gasto(text, jsonb) to authenticated, nomey_writer;

create temporary table gcr_ops (k text primary key, id uuid) on commit drop;
do $crear$
declare v text;
begin
  v := pg_temp.api('record_group_expense',
         pg_temp.gasto('f11e0000-0000-4000-8000-000000000101', '{}'::jsonb),
         pg_temp.f('U1')::uuid);
  if pg_temp.op(v) is null then raise exception 'setup: el gasto JPY no se escribio: %', v; end if;
  insert into gcr_ops values ('JPY', pg_temp.op(v));

  -- Un gasto en la moneda del grupo: sin base asumida y sin nada que congelar.
  v := pg_temp.api('record_group_expense',
         (pg_temp.gasto('f11e0000-0000-4000-8000-000000000102', '{}'::jsonb)
            - 'expected_base_currency_definition_id')
           || jsonb_build_object('currency_definition_id', pg_temp.f('EUR'), 'total', '4200'),
         pg_temp.f('U1')::uuid);
  if pg_temp.op(v) is null then raise exception 'setup: el gasto EUR no se escribio: %', v; end if;
  insert into gcr_ops values ('EUR', pg_temp.op(v));
end
$crear$;
grant select on gcr_ops to authenticated, nomey_writer;

create function pg_temp.o(p_k text) returns uuid language sql as $$
  select id from gcr_ops where k = p_k;
$$;
grant execute on function pg_temp.o(text) to authenticated, nomey_writer;

-- ══════════════════════════════ A · la superficie ═══════════════════════════
do $a$
declare fallos text[] := '{}';
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'api' and p.proname = 'group_operation_conversion'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'postgres'
       and p.proconfig = array['search_path=""']) then
    fallos := fallos || 'A1: la funcion no es definer de postgres con search_path fijado';
  end if;

  if has_function_privilege('public', 'api.group_operation_conversion(uuid[])', 'execute') then
    fallos := fallos || 'A2: public conserva EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'api.group_operation_conversion(uuid[])', 'execute') then
    fallos := fallos || 'A3: authenticated no puede ejecutarla';
  end if;

  -- LO QUE ESTA MIGRACION NO PUEDE HABER CONCEDIDO: acceso directo del cliente
  -- a la conversion congelada, a su procedencia o al esquema que las guarda.
  if has_table_privilege('authenticated', 'core.frozen_conversion', 'select') then
    fallos := fallos || 'A4: authenticated puede leer core.frozen_conversion';
  end if;
  if has_table_privilege('authenticated', 'core.frozen_conversion_provenance', 'select') then
    fallos := fallos || 'A5: authenticated puede leer la procedencia';
  end if;
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := fallos || 'A6: authenticated tiene USAGE sobre core';
  end if;

  -- Y NO es una vista: `core.frozen_conversion` sigue sin ninguna en `api`.
  if exists (
    select 1
      from pg_depend d
      join pg_rewrite r on r.oid = d.objid
      join pg_class v on v.oid = r.ev_class
      join pg_namespace n on n.oid = v.relnamespace
      join pg_class t on t.oid = d.refobjid
      join pg_namespace tn on tn.oid = t.relnamespace
     where n.nspname = 'api' and v.relkind = 'v'
       and tn.nspname = 'core' and t.relname = 'frozen_conversion') then
    fallos := fallos || 'A7: alguna vista de api depende de core.frozen_conversion';
  end if;

  if cardinality(fallos) > 0 then raise exception 'A · superficie: %', array_to_string(fallos, ' / '); end if;
  raise notice 'A · definer de postgres, public sin EXECUTE, y cero acceso directo del cliente';
end
$a$;

-- ═════════════ B · un miembro lee el tipo, identico a lo congelado ══════════
create function pg_temp.leer(p_operation uuid, p_actor uuid) returns text language sql as $$
  select pg_temp.como(format(
    $q$select count(*) || ' fila(s) | ' || coalesce(string_agg(
             sc.code || '->' || tc.code || ' ' || c.rate_coefficient || 'e-' || c.rate_scale
             || ' res ' || c.resolved_for_date || ' ' || c.source_id
             || ' ref ' || c.origin_reference_date, ' ; ' order by c.scope_id), 'sin filas')
         from api.group_operation_conversion(array[%L::uuid]) c
         join api.currency_definition sc on sc.id = c.source_currency_definition_id
         join api.currency_definition tc on tc.id = c.target_currency_definition_id$q$,
    p_operation), 'authenticated', p_actor);
$$;
grant execute on function pg_temp.leer(uuid, uuid) to authenticated, nomey_writer;

do $b$
declare
  v_u1 text; v_u2 text; v_congelado text; v_asentado text; v_importes text;
  fallos text[] := '{}';
begin
  -- Lo congelado de verdad, leido como postgres directamente de `core`.
  select sc.code || '->' || tc.code || ' ' || fc.rate_coefficient || 'e-' || fc.rate_scale
      || ' res ' || fc.resolved_for_date || ' ' || pv.source_id
      || ' ref ' || pv.origin_reference_date
    into v_congelado
    from core.operation o
    join core.frozen_conversion fc on fc.operation_version_id = o.current_version_id
    join core.frozen_conversion_provenance pv
      on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
    join core.currency_definition sc on sc.id = fc.source_currency_definition_id
    join core.currency_definition tc on tc.id = fc.target_currency_definition_id
   where o.id = pg_temp.o('JPY') and fc.scope_id = pg_temp.f('G')::uuid;

  v_u1 := pg_temp.leer(pg_temp.o('JPY'), pg_temp.f('U1')::uuid);
  v_u2 := pg_temp.leer(pg_temp.o('JPY'), pg_temp.f('U2')::uuid);

  if v_u1 <> '1 fila(s) | ' || v_congelado then
    fallos := fallos || format('B1: el pagador lee <%s>, congelado <%s>', v_u1, v_congelado);
  end if;
  if v_u2 <> v_u1 then
    fallos := fallos || format('B2: otro miembro lee algo distinto: <%s> vs <%s>', v_u2, v_u1);
  end if;
  if v_u1 not like '%JPY->EUR%' then
    fallos := fallos || format('B3: la direccion de la conversion no es JPY->EUR: <%s>', v_u1);
  end if;

  -- Los DOS importes: el declarado, y el convertido que de verdad se repartio.
  -- El convertido no se recalcula en la lectura, se suma lo asentado.
  select sum(e.economic_amount)::text into v_asentado
    from core.operation o
    join core.current_effect e on e.operation_version_id = o.current_version_id
   where o.id = pg_temp.o('JPY') and e.scope_id = pg_temp.f('G')::uuid
     and e.economic_amount is not null;

  v_importes := pg_temp.como(format(
    $q$select c.original_amount || ' -> ' || c.converted_amount
         from api.group_operation_conversion(array[%L::uuid]) c$q$, pg_temp.o('JPY')),
    'authenticated', pg_temp.f('U1')::uuid);

  if v_importes <> '150000 -> ' || v_asentado then
    fallos := fallos || format('B4: los importes publicados son <%s> y lo asentado es <%s>',
                               v_importes, v_asentado);
  end if;
  -- Y no son el mismo numero: si lo fueran, no habria conversion que enseñar.
  if v_asentado = '150000' then
    fallos := fallos || 'B5: el convertido coincide con el declarado; el caso no prueba nada';
  end if;

  if cardinality(fallos) > 0 then raise exception 'B · lectura: %', array_to_string(fallos, ' / '); end if;
  raise notice 'B · el tipo publicado es exactamente el congelado: % | importes %', v_u1, v_importes;
end
$b$;

-- ══════════ C · SOLO el ambito del grupo, aunque haya mas congeladas ════════
do $c$
declare
  v_total integer; v_publicadas integer; v_ajenas text;
  fallos text[] := '{}';
begin
  select count(*) into v_total
    from core.operation o
    join core.frozen_conversion fc on fc.operation_version_id = o.current_version_id
   where o.id = pg_temp.o('JPY');

  -- El escenario tiene que ser el interesante: mas de una congelada.
  if v_total < 2 then
    fallos := fallos || format('C1: el gasto solo congelo %s conversion(es); el caso no se prueba', v_total);
  end if;

  select (pg_temp.como(format(
    'select count(*) from api.group_operation_conversion(array[%L::uuid])', pg_temp.o('JPY')),
    'authenticated', pg_temp.f('U1')::uuid))::integer into v_publicadas;

  if v_publicadas <> 1 then
    fallos := fallos || format('C2: se publican %s filas y el ambito del grupo es UNO', v_publicadas);
  end if;

  v_ajenas := pg_temp.como(format(
    $q$select coalesce(string_agg(c.scope_id::text, ','), 'ninguna')
         from api.group_operation_conversion(array[%L::uuid]) c
        where c.scope_id <> %L::uuid$q$, pg_temp.o('JPY'), pg_temp.f('G')),
    'authenticated', pg_temp.f('U1')::uuid);
  if v_ajenas <> 'ninguna' then
    fallos := fallos || format('C3: sale la conversion de otro ambito: %s', v_ajenas);
  end if;

  if cardinality(fallos) > 0 then raise exception 'C · alcance: %', array_to_string(fallos, ' / '); end if;
  raise notice 'C · de % congeladas se publica solo la del grupo', v_total;
end
$c$;

-- ═══════════════════════════ D · aislamiento ════════════════════════════════
do $d$
declare
  v_ajeno text; v_anon text; v_enumera text;
  fallos text[] := '{}';
begin
  v_ajeno := pg_temp.leer(pg_temp.o('JPY'), pg_temp.f('U9')::uuid);
  if v_ajeno <> '0 fila(s) | sin filas' then
    fallos := fallos || format('D1: quien no es miembro lee <%s>', v_ajeno);
  end if;

  v_anon := pg_temp.como(format(
    'select count(*) from api.group_operation_conversion(array[%L::uuid])', pg_temp.o('JPY')),
    'anon', null);
  if v_anon not like 'ERR%' and v_anon <> '0' then
    fallos := fallos || format('D2: anon lee <%s>', v_anon);
  end if;

  -- Sin argumento devuelve lo del actor y NADA mas: un ajeno no enumera.
  v_enumera := pg_temp.como(
    'select count(*) from api.group_operation_conversion()', 'authenticated', pg_temp.f('U9')::uuid);
  if v_enumera <> '0' then
    fallos := fallos || format('D3: sin argumento, un ajeno enumera %s filas', v_enumera);
  end if;

  if cardinality(fallos) > 0 then raise exception 'D · aislamiento: %', array_to_string(fallos, ' / '); end if;
  raise notice 'D · fuera del grupo no se lee nada, ni con id ni sin el';
end
$d$;

-- ══════════════════════ E · sin conversion no hay fila ══════════════════════
do $e$
declare v text;
begin
  v := pg_temp.leer(pg_temp.o('EUR'), pg_temp.f('U1')::uuid);
  if v <> '0 fila(s) | sin filas' then
    raise exception 'E: un gasto en la moneda del grupo publica una conversion: <%>', v;
  end if;
  raise notice 'E · un gasto sin convertir no publica ninguna conversion';
end
$e$;

-- ═════════ F · solo la version VIGENTE: corregir publica el tipo NUEVO ══════
do $f$
declare
  v_antes text; v_despues text; v text;
  fallos text[] := '{}';
begin
  v_antes := pg_temp.leer(pg_temp.o('JPY'), pg_temp.f('U1')::uuid);

  -- Se corrige a USD el MISMO dia: cambiar la moneda original rompe la
  -- herencia de `sec.fx_personal_rate` y obliga a resolver de nuevo.
  v := pg_temp.api('record_group_expense', pg_temp.gasto(
         'f11e0000-0000-4000-8000-000000000103',
         jsonb_build_object(
           'operation_id', pg_temp.o('JPY'),
           'expected_version_id', (select current_version_id from core.operation
                                    where id = pg_temp.o('JPY')),
           'currency_definition_id', pg_temp.f('USD'), 'total', '10000')),
       pg_temp.f('U1')::uuid);
  if pg_temp.op(v) is null then
    raise exception 'F: la correccion a USD no se escribio: %', v;
  end if;

  v_despues := pg_temp.leer(pg_temp.o('JPY'), pg_temp.f('U1')::uuid);

  if v_despues = v_antes then
    fallos := fallos || 'F1: tras corregir a USD se sigue publicando el tipo del JPY';
  end if;
  if v_despues not like '%USD->EUR%' then
    fallos := fallos || format('F2: no se publica el tipo nuevo USD->EUR: <%s>', v_despues);
  end if;
  if v_despues not like '1 fila(s)%' then
    fallos := fallos || format('F3: se publica mas de una version: <%s>', v_despues);
  end if;

  if cardinality(fallos) > 0 then raise exception 'F · vigencia: %', array_to_string(fallos, ' / '); end if;
  raise notice 'F · antes <%> despues <%>', v_antes, v_despues;
end
$f$;

-- ═══════════════════════════════ G · falsacion ══════════════════════════════
--
-- Las dos guardas que de verdad sostienen esta lectura, comprobadas al reves:
-- se sustituye la funcion por una version MUTADA a la que le falta una, y se
-- exige que el resultado CAMBIE. Si no cambiara, la comprobacion de arriba
-- estaria pasando en vacio por otro motivo.
do $g$
declare
  v_ajeno text; v_filas integer;
  fallos text[] := '{}';
begin
  -- G1 · sin `sec.is_member`, un ajeno leeria.
  create or replace function api.group_operation_conversion(p_operation_ids uuid[] default null)
  returns table (
    operation_id uuid, operation_version_id uuid, scope_id uuid,
    source_currency_definition_id uuid, target_currency_definition_id uuid,
    rate_coefficient text, rate_scale smallint, resolved_for_date date,
    source_id text, origin_reference_date date, target_reference_date date,
    original_amount text, converted_amount text)
  language sql stable security definer set search_path = '' as $fn$
    select ov.operation_id, fc.operation_version_id, fc.scope_id,
           fc.source_currency_definition_id, fc.target_currency_definition_id,
           fc.rate_coefficient::text, fc.rate_scale, fc.resolved_for_date,
           pv.source_id, pv.origin_reference_date, pv.target_reference_date,
           ov.original_amount::text,
           (select sum(e.economic_amount)::text
              from core.current_effect e
             where e.operation_version_id = fc.operation_version_id
               and e.scope_id = fc.scope_id
               and e.economic_amount is not null)
      from core.frozen_conversion fc
      join core.frozen_conversion_provenance pv
        on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
      join core.operation_version ov on ov.id = fc.operation_version_id
      join core.operation o on o.id = ov.operation_id
      join core.scope s on s.id = fc.scope_id
     where s.kind = 'group' and o.operation_class = 'group_expense'
       and o.current_version_id = fc.operation_version_id
       and (p_operation_ids is null or ov.operation_id = any (p_operation_ids));
  $fn$;
  alter function api.group_operation_conversion(uuid[]) owner to postgres;
  grant execute on function api.group_operation_conversion(uuid[]) to authenticated;

  v_ajeno := pg_temp.como(format(
    'select count(*) from api.group_operation_conversion(array[%L::uuid])', pg_temp.o('JPY')),
    'authenticated', pg_temp.f('U9')::uuid);
  if v_ajeno = '0' then
    fallos := fallos || 'G1: sin la comprobacion de membresia un ajeno SIGUE sin leer: D1 no prueba nada';
  end if;

  -- G2 · sin el filtro `s.kind = group`, saldrian tambien las conversiones de
  -- los Modos Personales alcanzados.
  create or replace function api.group_operation_conversion(p_operation_ids uuid[] default null)
  returns table (
    operation_id uuid, operation_version_id uuid, scope_id uuid,
    source_currency_definition_id uuid, target_currency_definition_id uuid,
    rate_coefficient text, rate_scale smallint, resolved_for_date date,
    source_id text, origin_reference_date date, target_reference_date date,
    original_amount text, converted_amount text)
  language sql stable security definer set search_path = '' as $fn$
    select ov.operation_id, fc.operation_version_id, fc.scope_id,
           fc.source_currency_definition_id, fc.target_currency_definition_id,
           fc.rate_coefficient::text, fc.rate_scale, fc.resolved_for_date,
           pv.source_id, pv.origin_reference_date, pv.target_reference_date,
           ov.original_amount::text,
           (select sum(e.economic_amount)::text
              from core.current_effect e
             where e.operation_version_id = fc.operation_version_id
               and e.scope_id = fc.scope_id
               and e.economic_amount is not null)
      from core.frozen_conversion fc
      join core.frozen_conversion_provenance pv
        on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
      join core.operation_version ov on ov.id = fc.operation_version_id
      join core.operation o on o.id = ov.operation_id
      join core.scope s on s.id = fc.scope_id
     where o.operation_class = 'group_expense'
       and o.current_version_id = fc.operation_version_id
       and sec.is_member(fc.scope_id)
       and (p_operation_ids is null or ov.operation_id = any (p_operation_ids));
  $fn$;
  alter function api.group_operation_conversion(uuid[]) owner to postgres;
  grant execute on function api.group_operation_conversion(uuid[]) to authenticated;

  select (pg_temp.como(format(
    'select count(*) from api.group_operation_conversion(array[%L::uuid])', pg_temp.o('JPY')),
    'authenticated', pg_temp.f('U1')::uuid))::integer into v_filas;
  if v_filas < 2 then
    fallos := fallos || format('G2: sin el filtro de ambito solo salen %s filas: C2 no prueba nada', v_filas);
  end if;

  if cardinality(fallos) > 0 then raise exception 'G · falsacion: %', array_to_string(fallos, ' / '); end if;
  raise notice 'G · las dos guardas se comprueban de verdad: quitarlas cambia el resultado';
end
$g$;

rollback;
