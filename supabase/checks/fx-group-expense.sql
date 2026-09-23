-- ============================================================================
-- EL GASTO DE GRUPO EN MONEDA EXTRANJERA · F11/ADR-003 · F11.D
-- ============================================================================
--
-- Migracion 20261003120000. Contra el writer REAL y las lecturas reales, con
-- identidad simulada, fixtures propias y ROLLBACK.
--
-- Los dias fijados que necesita se siembran COMO POSTGRES, dentro de esta
-- transaccion y en fechas de 2099 que ninguna ingesta real habra fijado: nunca
-- se ingiere un documento sintetico en `ecb`, y la base local de quien ejecute
-- el check queda exactamente como estaba.
--
--   A · el escenario: un grupo en EUR con tres participantes de tres monedas
--   B · gasto extranjero: original conservado, total del grupo convertido,
--       efectos del grupo en la moneda del grupo
--   C · equal, shares y exact_amounts sobre el total convertido, con suma exacta
--   D · el residuo y el desempate determinista
--   E · escala 0 contra escala 2
--   F · una conversion congelada por ambito, y ninguna encadenada
--   G · la cuota personal persistida, y las estadisticas en la base personal
--   H · sin cobertura de una moneda personal, el gasto entero se rechaza
--   I · correcciones: heredar, volver a resolver, y las guardas de F9 intactas
--   J · la caja incorporada de un fantasma no es el importe declarado
--   K · las lecturas publican cada cifra con su moneda
--   L · lo que F11.D no toca
--   M · falsacion de los casos determinantes

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

create function pg_temp.api(p_fn text, p_payload jsonb, p_actor uuid) returns text language sql as $$
  select pg_temp.como(format('select api.%I(%L::jsonb)::text', p_fn, p_payload), 'authenticated', p_actor);
$$;

create function pg_temp.op(p_res text) returns uuid language sql as $op$
  select case when left(p_res, 1) = '{' then (p_res::jsonb ->> 'operation_id')::uuid end;
$op$;

-- Un dia X de la fuente real fijado con R(X) = <ref> y los tipos dados. Como
-- postgres, sin pasar por la ingesta: no se ingiere nada en `ecb`.
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

create temporary table fx (k text primary key, v text) on commit drop;
insert into fx (k, v) values
  ('U1',  'f11d0000-0000-4000-8000-0000000000a1'),   -- pagador, Personal en EUR
  ('U2',  'f11d0000-0000-4000-8000-0000000000a2'),   -- Personal en USD
  ('U3',  'f11d0000-0000-4000-8000-0000000000a3'),   -- Personal en ARS: sin cobertura
  ('S1',  'f11d0000-0000-4000-8000-000000000001'),
  ('S2',  'f11d0000-0000-4000-8000-000000000002'),
  ('S3',  'f11d0000-0000-4000-8000-000000000003'),
  ('G',   'f11d0000-0000-4000-8000-000000000010'),   -- grupo, base EUR
  ('P1',  'f11d0000-0000-4000-8000-000000000031'),
  ('P2',  'f11d0000-0000-4000-8000-000000000032'),
  ('P3',  'f11d0000-0000-4000-8000-000000000033'),   -- fantasma, sin cuenta
  ('P4',  'f11d0000-0000-4000-8000-000000000034'),   -- identidad de U3, en ARS
  ('P5',  'f11d0000-0000-4000-8000-000000000035'),   -- identidad de U4
  ('U4',  'f11d0000-0000-4000-8000-0000000000a4'),   -- asocia al fantasma
  ('S4',  'f11d0000-0000-4000-8000-000000000004'),
  ('EUR', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  ('USD', '34cb8424-2243-52d8-be99-e2b7d22884b8'),
  ('JPY', 'f981b2f9-a022-5de8-aa6d-3af277d9dcd3'),
  ('ARS', '6cbdabc6-2d2f-5090-a063-3a366f9fd23d'),
  ('CAT', '4ed30a44-9f82-578f-828c-b491a25ebdd9'),
  ('X1',  '2099-03-10'),                             -- R = 2099-03-09
  ('X2',  '2099-03-11');                             -- R = 2099-03-10
create function pg_temp.f(p_k text) returns text language sql as $$
  select v from fx where k = p_k;
$$;
grant select on fx to authenticated, nomey_writer;
grant execute on function pg_temp.f(text), pg_temp.api(text, jsonb, uuid), pg_temp.op(text)
  to authenticated, nomey_writer;

-- ═══════════════════════════════ A · el escenario ═══════════════════════════
do $a$
declare
  v_out jsonb;
begin
  perform pg_temp.fijar(pg_temp.f('X1')::date, '2099-03-09',
    '{"USD":["11592",4,"1.1592"],"JPY":["17856",2,"178.56"]}');
  perform pg_temp.fijar(pg_temp.f('X2')::date, '2099-03-10',
    '{"USD":["12",1,"1.2"],"JPY":["180",0,"180"]}');

  -- Tres Modos Personales con TRES bases distintas. La del pagador es la del
  -- grupo; la de U2 no lo es; la de U3 no tiene cobertura del BCE.
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (pg_temp.f('S1')::uuid, 'personal', pg_temp.f('EUR')::uuid, pg_temp.f('U1')::uuid),
    (pg_temp.f('S2')::uuid, 'personal', pg_temp.f('USD')::uuid, pg_temp.f('U2')::uuid),
    (pg_temp.f('S3')::uuid, 'personal', pg_temp.f('ARS')::uuid, pg_temp.f('U3')::uuid),
    (pg_temp.f('S4')::uuid, 'personal', pg_temp.f('EUR')::uuid, pg_temp.f('U4')::uuid);
  insert into core.membership (scope_id, user_id) values
    (pg_temp.f('S1')::uuid, pg_temp.f('U1')::uuid),
    (pg_temp.f('S2')::uuid, pg_temp.f('U2')::uuid),
    (pg_temp.f('S3')::uuid, pg_temp.f('U3')::uuid),
    (pg_temp.f('S4')::uuid, pg_temp.f('U4')::uuid);

  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('U1'))::text, true);
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'f11d0000-0000-4000-8000-0000000000c1'::uuid,
    'command_contract_version', 1,
    'client_group_id', pg_temp.f('G'), 'display_name', 'Viaje', 'emoji', 'GRP',
    'currency_definition_id', pg_temp.f('EUR'),
    'creator_participant_id', pg_temp.f('P1'), 'creator_display_name', 'Uno',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', pg_temp.f('P2'), 'display_name', 'Dos'),
      jsonb_build_object('client_participant_id', pg_temp.f('P3'), 'display_name', 'Tres'),
      jsonb_build_object('client_participant_id', pg_temp.f('P4'), 'display_name', 'Cuatro'),
      jsonb_build_object('client_participant_id', pg_temp.f('P5'), 'display_name', 'Cinco'))));
  perform pg_temp.super();

  -- P2 pasa a ser la identidad de U2 en el grupo. Se siembra el vinculo y la
  -- membresia como postgres: ningun comando produce esta forma sin una
  -- invitacion, y lo que se mide aqui es la conversion, no el alta.
  insert into core.participant_user_link (participant_id, scope_id, user_id, linked_at)
  values (pg_temp.f('P2')::uuid, pg_temp.f('G')::uuid, pg_temp.f('U2')::uuid, now());
  insert into core.participant_user_link (participant_id, scope_id, user_id, linked_at)
  values (pg_temp.f('P4')::uuid, pg_temp.f('G')::uuid, pg_temp.f('U3')::uuid, now());
  insert into core.participant_user_link (participant_id, scope_id, user_id, linked_at)
  values (pg_temp.f('P5')::uuid, pg_temp.f('G')::uuid, pg_temp.f('U4')::uuid, now());
  insert into core.membership (scope_id, user_id) values
    (pg_temp.f('G')::uuid, pg_temp.f('U2')::uuid),
    (pg_temp.f('G')::uuid, pg_temp.f('U3')::uuid),
    (pg_temp.f('G')::uuid, pg_temp.f('U4')::uuid);

  if (select base_currency_definition_id from core.scope where id = pg_temp.f('G')::uuid)
     <> pg_temp.f('EUR')::uuid then
    raise exception 'A: el grupo no quedo en EUR';
  end if;
  raise notice 'escenario: grupo en EUR, pagador en EUR, un participante en USD y un fantasma sin cuenta';
end
$a$;

-- El gasto del grupo. Lo que cambia en cada caso va en `p_extra`.
create function pg_temp.gasto(p_key text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', pg_temp.f('G'), 'currency_definition_id', pg_temp.f('JPY'),
    'total', '150000', 'effective_date', pg_temp.f('X1'), 'effective_time', '10:00',
    'concept', 'Cena', 'category_id', pg_temp.f('CAT'),
    'payer_participant_id', pg_temp.f('P1'),
    'participants', jsonb_build_array(pg_temp.f('P1'), pg_temp.f('P2'), pg_temp.f('P3')),
    'split_method', jsonb_build_object('kind', 'equal'),
    'expected_base_currency_definition_id', pg_temp.f('EUR')) || p_extra;
$$;
grant execute on function pg_temp.gasto(text, jsonb) to authenticated, nomey_writer;

-- El reparto de una version, resumido: cuota del grupo y cuota personal.
create function pg_temp.reparto(p_operation uuid) returns text language sql as $$
  select string_agg(
           sp.ordinal || ':' || sp.resolved_amount || '/' ||
           coalesce(sp.personal_amount || ' ' || (select code from core.currency_definition
                                                   where id = sp.personal_currency_definition_id),
                    'sin cuota personal'),
           ' | ' order by sp.ordinal)
    from core.operation o
    join core.split_participant sp on sp.operation_version_id = o.current_version_id
   where o.id = p_operation;
$$;

-- Lo que la version declara y lo que el grupo asienta.
create function pg_temp.resumen(p_operation uuid) returns text language sql as $$
  select ov.original_amount || ' ' || (select code from core.currency_definition
                                        where id = ov.original_currency_definition_id)
      || ' | grupo ' || (select sum(e.economic_amount) from core.effect e
                          where e.operation_version_id = ov.id and e.economic_amount is not null)
      || ' ' || (select code from core.currency_definition where id = s.base_currency_definition_id)
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.scope s on s.id = pg_temp.f('G')::uuid
   where o.id = p_operation;
$$;
grant execute on function pg_temp.reparto(uuid), pg_temp.resumen(uuid) to authenticated, nomey_writer;

-- ═══════ B · el original se conserva y el total se convierte al grupo ═══════
do $b$
declare
  fallos text[] := '{}';
  v_t text; v_op uuid;
begin
  v_op := pg_temp.op(pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000101', '{}'::jsonb), pg_temp.f('U1')::uuid));
  if v_op is null then
    raise exception 'B: el gasto extranjero fue rechazado';
  end if;

  -- B1 · 150000 yenes declarados, 840,05 EUR asentados en el grupo.
  v_t := pg_temp.resumen(v_op);
  if v_t is distinct from '150000 JPY | grupo 84005 EUR' then
    fallos := array_append(fallos, 'B1 ' || v_t);
  end if;

  -- B2 · la suma del reparto ES el total convertido. Es el invariante central.
  if (select sum(sp.resolved_amount) from core.split_participant sp
       join core.operation o on o.current_version_id = sp.operation_version_id
      where o.id = v_op) <> 84005 then
    fallos := array_append(fallos, 'B2 el reparto no suma el total convertido');
  end if;

  -- B3 · TODOS los efectos del grupo van en la moneda del grupo.
  if exists (select 1 from core.effect e
              join core.operation o on o.current_version_id = e.operation_version_id
             where o.id = v_op and e.scope_id = pg_temp.f('G')::uuid
               and e.currency_definition_id <> pg_temp.f('EUR')::uuid) then
    fallos := array_append(fallos, 'B3 un efecto del grupo no va en la base del grupo');
  end if;

  -- B4 · la caja del pagador, en SU base, convertida DESDE EL ORIGINAL. Su
  --      base es la del grupo, asi que coincide con el total convertido.
  if (select e.balance_amount from core.effect e
       join core.operation o on o.current_version_id = e.operation_version_id
      where o.id = v_op and e.scope_id = pg_temp.f('S1')::uuid) <> -84005 then
    fallos := array_append(fallos, 'B4 la caja del pagador no es el total convertido');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'B · gasto extranjero:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'B · original conservado, total convertido al grupo, efectos y caja en su moneda: OK';
end
$b$;

-- ═══ C · los tres metodos reparten el total CONVERTIDO, con suma exacta ═════
do $c$
declare
  fallos text[] := '{}';
  v_op uuid; v_t text;
begin
  -- C1 · `equal`: 84005 entre tres. El resto cae por el desempate de siempre.
  v_op := pg_temp.op(pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000111', '{}'::jsonb), pg_temp.f('U1')::uuid));
  v_t := pg_temp.reparto(v_op);
  if v_t is distinct from '0:28002/28002 EUR | 1:28002/32460 USD | 2:28001/sin cuota personal' then
    fallos := array_append(fallos, 'C1 equal: ' || coalesce(v_t, 'rechazado'));
  end if;

  -- C2 · `shares` 1·2·3 sobre el mismo total convertido.
  v_op := pg_temp.op(pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000112',
      jsonb_build_object('split_method', jsonb_build_object(
        'kind', 'shares', 'weights', jsonb_build_array('1', '2', '3')))), pg_temp.f('U1')::uuid));
  if (select sum(sp.resolved_amount) from core.split_participant sp
       join core.operation o on o.current_version_id = sp.operation_version_id
      where o.id = v_op) <> 84005 then
    fallos := array_append(fallos, 'C2 shares no suma el total convertido: ' || coalesce(pg_temp.reparto(v_op), 'rechazado'));
  end if;

  -- C3 · `exact_amounts`: lo declarado va en YENES y suma el total declarado.
  --      El reparto es del total convertido, con los declarados como pesos.
  v_op := pg_temp.op(pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000113',
      jsonb_build_object('split_method', jsonb_build_object(
        'kind', 'exact_amounts', 'amounts', jsonb_build_array('50000', '50000', '50000')))),
    pg_temp.f('U1')::uuid));
  v_t := pg_temp.reparto(v_op);
  if v_t is distinct from '0:28002/28002 EUR | 1:28002/32460 USD | 2:28001/sin cuota personal' then
    fallos := array_append(fallos, 'C3 exact_amounts: ' || coalesce(v_t, 'rechazado'));
  end if;
  -- Y lo declarado se conserva EN SU MONEDA, sin convertir.
  if (select string_agg(sp.declared_amount::text, ',' order by sp.ordinal)
        from core.split_participant sp
        join core.operation o on o.current_version_id = sp.operation_version_id
       where o.id = v_op) <> '50000,50000,50000' then
    fallos := array_append(fallos, 'C3b lo declarado no se conservo en la moneda original');
  end if;

  -- C4 · LA VALIDACION SIGUE SIENDO EN LA MONEDA DECLARADA. Unos declarados
  --      que no suman el total declarado se rechazan, convertidos o no.
  v_t := pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000114',
      jsonb_build_object('split_method', jsonb_build_object(
        'kind', 'exact_amounts', 'amounts', jsonb_build_array('50000', '50000', '40000')))),
    pg_temp.f('U1')::uuid);
  if v_t <> 'ERR SPLIT_EXACT_AMOUNTS_MISMATCH:422' then
    fallos := array_append(fallos, 'C4 declarados que no cuadran: ' || v_t);
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'C · metodos de reparto:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'C · equal, shares y exact_amounts reparten el total convertido con suma exacta: OK';
end
$c$;

-- ═════════ D · el residuo y el desempate determinista, sin cambiarlo ════════
do $d$
declare
  fallos text[] := '{}';
  v_op uuid; v_t text;
begin
  -- 84005 entre tres deja 2 unidades de resto con restos fraccionarios
  -- IGUALES: lo decide la prioridad, que es el pagador primero y despues el
  -- orden estable. Con P2 de pagadora, el resto se mueve con ella.
  v_op := pg_temp.op(pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000121',
      jsonb_build_object('payer_participant_id', pg_temp.f('P2'))), pg_temp.f('U2')::uuid));
  v_t := pg_temp.reparto(v_op);
  if v_t is distinct from '0:28002/28002 EUR | 1:28002/32460 USD | 2:28001/sin cuota personal' then
    fallos := array_append(fallos, 'D1 con otra pagadora: ' || coalesce(v_t, 'rechazado'));
  end if;
  -- El que se queda sin unidad es el ULTIMO en prioridad, no el ultimo en la
  -- lista por casualidad: con tres restos iguales, pagador y ordinal deciden.
  if (select sp.resolved_amount from core.split_participant sp
        join core.operation o on o.current_version_id = sp.operation_version_id
       where o.id = v_op and sp.ordinal = 2) <> 28001 then
    fallos := array_append(fallos, 'D2 el residuo no siguio el desempate');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'D · residuo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'D · el residuo cae por el desempate de siempre, pagador primero: OK';
end
$d$;

-- ═══════════════ E · escala 0 contra escala 2, cada una la suya ═════════════
do $e$
declare
  fallos text[] := '{}';
  v_t text;
begin
  -- 150000 yenes son 150000 unidades minimas (escala 0) y 840,05 euros
  -- (escala 2). Leer el declarado con la escala del grupo lo convertiria en
  -- 1.500,00 EUR sin que nada fallara.
  select oc.scale || '/' || bc.scale into v_t
    from core.currency_definition oc, core.currency_definition bc
   where oc.id = pg_temp.f('JPY')::uuid and bc.id = pg_temp.f('EUR')::uuid;
  if v_t <> '0/2' then
    fallos := array_append(fallos, 'E1 las escalas no son 0 y 2: ' || v_t);
  end if;
  -- Y el declarado sigue siendo 150000, no 15000000.
  if (select count(*) from core.operation_version ov
       where ov.original_currency_definition_id = pg_temp.f('JPY')::uuid
         and ov.original_amount <> 150000) <> 0 then
    fallos := array_append(fallos, 'E2 algun declarado en yenes se reescalo');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'E · escalas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'E · JPY escala 0 contra EUR escala 2, cada cifra con la suya: OK';
end
$e$;

-- ═══ F · una conversion por ambito, y NINGUNA encadenada ════════════════════
do $f$
declare
  fallos text[] := '{}';
  v_op uuid; v_n integer; v_t text;
begin
  select o.id into v_op from core.operation o
    join core.client_command cc on cc.result_operation_id = o.id
   where cc.client_operation_id = 'f11d0000-0000-4000-8000-000000000111'::uuid limit 1;

  -- F1 · tres ambitos convertidos: el grupo, el Personal del pagador y el de
  --      la participante en USD. El fantasma no tiene ambito que convertir.
  select count(*) into v_n from core.frozen_conversion fc
    join core.operation o on o.current_version_id = fc.operation_version_id
   where o.id = v_op;
  if v_n <> 3 then
    fallos := array_append(fallos, format('F1 %s conversiones congeladas y se esperaban 3', v_n));
  end if;

  -- F2 · TODAS salen del importe original. Una conversion cuyo origen fuera la
  --      moneda del grupo seria una conversion encadenada.
  select string_agg(distinct (select code from core.currency_definition where id = fc.source_currency_definition_id), ',')
    into v_t
    from core.frozen_conversion fc
    join core.operation o on o.current_version_id = fc.operation_version_id
   where o.id = v_op;
  if v_t is distinct from 'JPY' then
    fallos := array_append(fallos, 'F2 alguna conversion no sale del original: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- F3 · y cada una tiene su procedencia, del BCE.
  select count(*) into v_n from core.frozen_conversion_provenance pv
    join core.operation o on o.current_version_id = pv.operation_version_id
   where o.id = v_op and pv.source_id = 'ecb';
  if v_n <> 3 then
    fallos := array_append(fallos, format('F3 %s procedencias y se esperaban 3', v_n));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'F · conversiones congeladas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'F · una conversion por ambito, todas desde el original, con su procedencia: OK';
end
$f$;

-- ═══ G · la cuota personal persistida, y las estadisticas en esa moneda ═════
do $g$
declare
  fallos text[] := '{}';
  v_st jsonb; v_cat bigint;
begin
  -- G1 · U2 ve sus cuotas en USD, que es la base de su Personal.
  v_st := pg_temp.como('select api.personal_statistics(null, null)::text',
                       'authenticated', pg_temp.f('U2')::uuid)::jsonb;
  if (v_st ->> 'currency_definition_id') <> pg_temp.f('USD') then
    fallos := array_append(fallos, 'G1 las estadisticas de U2 no van en su base');
  end if;
  -- Cinco gastos en el escenario, su cuota es 32460 USD en cada uno.
  if (v_st ->> 'expense_total') <> (32460 * 5)::text then
    fallos := array_append(fallos, 'G1b expense_total de U2: ' || (v_st ->> 'expense_total'));
  end if;

  -- G2 · EL INVARIANTE: la suma del desglose ES el total.
  select sum((c ->> 'expense_total')::bigint) into v_cat
    from jsonb_array_elements(v_st -> 'categories') c;
  if v_cat is distinct from (v_st ->> 'expense_total')::bigint then
    fallos := array_append(fallos, format('G2 el desglose suma %s y el total es %s', v_cat, v_st ->> 'expense_total'));
  end if;

  -- G3 · Y NO PASA EN VACIO: sumar la cuota del GRUPO, que es lo que se hacia
  --      hasta F11.D, habria dado 28002 por gasto, en euros contados como
  --      dolares. Si alguna vez coinciden, el escenario perdio su conversion.
  if (v_st ->> 'expense_total') = (28002 * 5)::text then
    fallos := array_append(fallos, 'G3 las estadisticas de U2 siguen sumando la cuota del grupo');
  end if;

  -- G4 · el pagador, cuya base ES la del grupo, ve exactamente la cuota del
  --      grupo: la conversion a su moneda es la misma. Sus cinco cuotas son
  --      28002 cuatro veces y 14001 en el reparto por participaciones, donde
  --      lleva peso 1 de 6: 126009 en total.
  v_st := pg_temp.como('select api.personal_statistics(null, null)::text',
                       'authenticated', pg_temp.f('U1')::uuid)::jsonb;
  if (v_st ->> 'expense_total') <> '126009' then
    fallos := array_append(fallos, 'G4 expense_total de U1: ' || (v_st ->> 'expense_total'));
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'G · cuota personal:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'G · cada uno suma su cuota en su moneda, y el desglose cuadra con el total: OK';
end
$g$;

-- ═══ H · sin cobertura de UNA moneda personal, el gasto entero se rechaza ═══
do $h$
declare
  fallos text[] := '{}';
  v_t text; v_antes bigint; v_despues bigint;
begin
  select count(*) into v_antes from core.operation_version;

  -- P4 es la identidad de U3, cuyo Personal va en ARS, que el BCE no cubre.
  -- Nombrarla alcanza su ambito, y sin tipo no hay gasto.
  v_t := pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000131',
      jsonb_build_object('participants', jsonb_build_array(
        pg_temp.f('P1'), pg_temp.f('P2'), pg_temp.f('P4')))), pg_temp.f('U1')::uuid);
  if v_t <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'H1 se esperaba FX_CURRENCY_NOT_COVERED y llego: ' || v_t);
  end if;

  -- H2 · NI UNA FILA. El rechazo revierte la transaccion entera.
  select count(*) into v_despues from core.operation_version;
  if v_despues <> v_antes then
    fallos := array_append(fallos, format('H2 el rechazo dejo %s versiones nuevas', v_despues - v_antes));
  end if;

  -- H3 · y la clave de idempotencia no se quema: el reintento vuelve a
  --      intentarlo y vuelve a fallar por lo mismo, no por la clave.
  v_t := pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000131',
      jsonb_build_object('participants', jsonb_build_array(
        pg_temp.f('P1'), pg_temp.f('P2'), pg_temp.f('P4')))), pg_temp.f('U1')::uuid);
  if v_t <> 'ERR FX_CURRENCY_NOT_COVERED:422' then
    fallos := array_append(fallos, 'H3 el reintento con la misma clave: ' || v_t);
  end if;

  -- H4 · un dia sin fijar da «todavia no disponible», que es un 503 y no un
  --      rechazo: el mismo contrato que los writers personales.
  v_t := pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000132',
      jsonb_build_object('effective_date', '2099-12-31')), pg_temp.f('U1')::uuid);
  if v_t <> 'ERR FX_RATE_NOT_YET_AVAILABLE:503' then
    fallos := array_append(fallos, 'H4 un dia sin fijar: ' || v_t);
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'H · rechazo atomico:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'H · la moneda de un participante sin cobertura rechaza el gasto entero, sin dejar nada: OK';
end
$h$;

-- ═══════ I · correcciones: heredar, volver a resolver, guardas intactas ═════
do $i$
declare
  fallos text[] := '{}';
  v_op uuid; v_ver uuid; v_t text; v_antes text;
begin
  select o.id into v_op from core.operation o
    join core.client_command cc on cc.result_operation_id = o.id
   where cc.client_operation_id = 'f11d0000-0000-4000-8000-000000000111'::uuid limit 1;
  select string_agg(fc.rate_coefficient::text, ',' order by fc.scope_id) into v_antes
    from core.frozen_conversion fc
    join core.operation o on o.current_version_id = fc.operation_version_id
   where o.id = v_op;

  -- I1 · MISMA FECHA Y MISMA MONEDA: los tipos se HEREDAN, los tres.
  v_ver := (select current_version_id from core.operation where id = v_op);
  v_t := pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000141',
      jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver,
                         'concept', 'Cena corregida')), pg_temp.f('U1')::uuid);
  if pg_temp.op(v_t) is null then
    fallos := array_append(fallos, 'I1 la correccion fue rechazada: ' || v_t);
  end if;
  if (select string_agg(fc.rate_coefficient::text, ',' order by fc.scope_id)
        from core.frozen_conversion fc
        join core.operation o on o.current_version_id = fc.operation_version_id
       where o.id = v_op) is distinct from v_antes then
    fallos := array_append(fallos, 'I1b los tipos no se heredaron con la misma fecha y moneda');
  end if;

  -- I2 · CAMBIA LA FECHA: se vuelve a resolver, y con el tipo del dia nuevo.
  v_ver := (select current_version_id from core.operation where id = v_op);
  v_t := pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000142',
      jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver,
                         'effective_date', pg_temp.f('X2'))), pg_temp.f('U1')::uuid);
  if pg_temp.op(v_t) is null then
    fallos := array_append(fallos, 'I2 la correccion con otra fecha fue rechazada: ' || v_t);
  end if;
  if (select string_agg(fc.rate_coefficient::text, ',' order by fc.scope_id)
        from core.frozen_conversion fc
        join core.operation o on o.current_version_id = fc.operation_version_id
       where o.id = v_op) = v_antes then
    fallos := array_append(fallos, 'I2b al cambiar la fecha no se volvio a resolver');
  end if;
  -- Y el reparto sigue sumando el total convertido del dia nuevo.
  if (select sum(sp.resolved_amount) from core.split_participant sp
       join core.operation o on o.current_version_id = sp.operation_version_id
      where o.id = v_op)
     <> (select sum(e.economic_amount) from core.effect e
          join core.operation o on o.current_version_id = e.operation_version_id
         where o.id = v_op and e.economic_amount is not null) then
    fallos := array_append(fallos, 'I2c el reparto corregido no cuadra con los efectos');
  end if;

  -- I3 · una conversion congelada NO se modifica nunca: las de la version
  --      anterior siguen ahi, intactas.
  if (select count(*) from core.frozen_conversion fc
       join core.operation_version ov on ov.id = fc.operation_version_id
      where ov.operation_id = v_op) < 6 then
    fallos := array_append(fallos, 'I3 alguna conversion de una version anterior desaparecio');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'I · correcciones:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'I · heredar con la misma fecha, resolver al cambiarla, y nada congelado se toca: OK';
end
$i$;

-- ═══════ J · la caja incorporada de un fantasma no es el declarado ══════════
do $j$
declare
  fallos text[] := '{}';
  v_op uuid; v_caja bigint; v_n integer;
begin
  -- Un gasto pagado por el FANTASMA, en yenes.
  v_op := pg_temp.op(pg_temp.api('record_group_expense',
    pg_temp.gasto('f11d0000-0000-4000-8000-000000000151',
      jsonb_build_object('payer_participant_id', pg_temp.f('P3'))), pg_temp.f('U1')::uuid));
  if v_op is null then
    fallos := array_append(fallos, 'J0 el gasto pagado por el fantasma fue rechazado');
  end if;

  -- U4, con identidad propia en el grupo y Personal en EUR como el, asocia
  -- al fantasma por el comando REAL y se lleva su caja.
  if pg_temp.op(pg_temp.api('associate_participant', jsonb_build_object(
       'client_command_id', 'f11d0000-0000-4000-8000-0000000000c9'::uuid,
       'command_contract_version', 1,
       'scope_id', pg_temp.f('G'), 'participant_id', pg_temp.f('P3')),
     pg_temp.f('U4')::uuid)) is null then
    -- associate_participant no devuelve operation_id; basta con que no falle.
    null;
  end if;

  -- J1 · LA CAJA ES EL TOTAL EN LA MONEDA DEL GRUPO, no el importe declarado.
  --      840,05 EUR, nunca 150000 —que ademas serian yenes leidos como euros—.
  select e.balance_amount into v_caja from core.effect e
    join core.operation o on o.current_version_id = e.operation_version_id
   where o.id = v_op and e.scope_id = pg_temp.f('S4')::uuid;
  if v_caja is distinct from -84005 then
    fallos := array_append(fallos, format('J1 la caja incorporada es %s y deberia ser -84005', coalesce(v_caja::text, 'ninguna')));
  end if;
  if v_caja = -150000 then
    fallos := array_append(fallos, 'J1b la caja incorporada es el importe declarado, en otra moneda');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'J · caja del fantasma:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'J · la caja incorporada es el importe del gasto en la moneda del ambito: OK';
end
$j$;

-- ═════════════ K · las lecturas publican cada cifra con su moneda ═══════════
do $k$
declare
  fallos text[] := '{}';
  v_t text; v_op uuid;
begin
  -- El identificador se resuelve AQUI, como postgres: el cliente no alcanza
  -- `core`, y meterlo en su consulta la haria fallar por permisos.
  select o.id into v_op from core.operation o
    join core.client_command cc on cc.result_operation_id = o.id
   where cc.client_operation_id = 'f11d0000-0000-4000-8000-000000000101'::uuid limit 1;

  -- K1 · el gasto de grupo publica la moneda DECLARADA junto a su total.
  v_t := pg_temp.como(format(
    'select go.total_amount || '' '' || oc.code || '' | '' || go.your_share || '' '' || bc.code'
    ' from api.group_operation go'
    ' join api.currency_definition oc on oc.id = go.original_currency_definition_id'
    ' join api.currency_definition bc on bc.id = go.currency_definition_id'
    ' where go.operation_id = %L', v_op),
    'authenticated', pg_temp.f('U1')::uuid);
  if v_t is distinct from '150000 JPY | 28002 EUR' then
    fallos := array_append(fallos, 'K1 group_operation: ' || v_t);
  end if;

  -- K2 · la cuota compartida publica las TRES cifras con sus tres monedas.
  v_t := pg_temp.como(format(
    'select s.total_amount || '' '' || oc.code || '' | grupo '' || s.share_amount || '' '' || s.currency_code'
    ' || '' | mio '' || s.personal_amount || '' '' || pc.code'
    ' from api.personal_expense_share() s'
    ' join api.currency_definition oc on oc.id = s.original_currency_definition_id'
    ' join api.currency_definition pc on pc.id = s.personal_currency_definition_id'
    -- Por SU identificador, no por orden: varias filas comparten instante y
    -- cual saliera primero no es lo que esta seccion mide.
    ' where s.operation_id = %L', v_op),
    'authenticated', pg_temp.f('U2')::uuid);
  if v_t is distinct from '150000 JPY | grupo 28002 EUR | mio 32460 USD' then
    fallos := array_append(fallos, 'K2 personal_expense_share: ' || v_t);
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'K · lecturas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'K · el declarado con su moneda, la cuota del grupo con la del grupo y la mia con la mia: OK';
end
$k$;

-- ══════════════════════ L · lo que F11.D no toca ════════════════════════════
do $l$
declare
  fallos text[] := '{}';
  v_t text;
begin
  -- L1 · LAS OTRAS SIETE CLASES CONSERVAN SU NEGATIVA. Solo el gasto de grupo
  --      la pierde, y solo en sus dos llamadas.
  select string_agg(p.proname, ',' order by p.proname collate "C") into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname like 'record\_%' and p.prokind = 'f'
     and p.prosrc like '%sec.assert_no_conversion%';
  if v_t is distinct from 'record_adjustment,record_debt_settlement,record_external_transfer,'
                          'record_group_payment,record_internal_transfer,'
                          'record_settlement_by_transfer' then
    fallos := array_append(fallos, 'L1 clases con negativa de conversion: ' || coalesce(v_t, 'ninguna'));
  end if;

  -- L2 · el grupo sigue siendo net-zero en SU moneda: las deudas suman lo que
  --      las cuotas de quien no pago.
  if exists (
    select 1 from core.operation o
      join core.effect e on e.operation_version_id = o.current_version_id
     where o.operation_class = 'group_expense' and e.debt_amount is not null
       and e.currency_definition_id <> pg_temp.f('EUR')::uuid) then
    fallos := array_append(fallos, 'L2 alguna deuda del grupo no va en la base del grupo');
  end if;

  -- L3 · y ningun efecto economico del gasto de grupo se materializo en un
  --      Modo Personal: la cuota vive en el grupo (F11/ADR-003 §4).
  if exists (
    select 1 from core.operation o
      join core.effect e on e.operation_version_id = o.current_version_id
      join core.scope s on s.id = e.scope_id and s.kind = 'personal'
     where o.operation_class = 'group_expense' and e.economic_amount is not null) then
    fallos := array_append(fallos, 'L3 la cuota se materializo como efecto economico personal');
  end if;

  -- L4 · el cliente sigue sin alcanzar el reparto ni la conversion.
  if pg_temp.como('select count(*)::text from core.split_participant',
                  'authenticated', pg_temp.f('U1')::uuid) <> 'ERR 42501' then
    fallos := array_append(fallos, 'L4 el cliente alcanza core.split_participant');
  end if;

  if cardinality(fallos) > 0 then
    raise exception E'L · lo que no se toca:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'L · las otras clases con su negativa, el grupo net-zero en su moneda y sin efectos personales nuevos: OK';
end
$l$;

-- ═══════════════════ M · falsacion de lo determinante ═══════════════════════
do $m$
declare
  fallos text[] := '{}';
  v_ok boolean;
  v_ver uuid; v_scope uuid; v_part uuid;
begin
  -- Un gasto EN LA MONEDA DEL GRUPO, que por definicion no convierte: es el
  -- unico escenario en el que el invariante tiene sentido.
  if pg_temp.op(pg_temp.api('record_group_expense', pg_temp.gasto(
       'f11d0000-0000-4000-8000-000000000191',
       jsonb_build_object('currency_definition_id', pg_temp.f('EUR'), 'total', '3000',
         -- El fantasma quedo fusionado en J, y P4 va en una moneda sin
         -- cobertura: este gasto lo reparten quienes pueden.
         'participants', jsonb_build_array(pg_temp.f('P1'), pg_temp.f('P2'), pg_temp.f('P5')),
         -- Y con reparto EXACTO, que es el metodo cuyo invariante se falsifica:
         -- la cabecera manda, y una fila de otro metodo la rechaza su FK antes
         -- de que el trigger llegue a mirarla.
         'split_method', jsonb_build_object('kind', 'exact_amounts',
           'amounts', jsonb_build_array('1000', '1000', '1000')))),
     pg_temp.f('U1')::uuid)) is null then
    fallos := array_append(fallos, 'M0 el gasto en la moneda del grupo fue rechazado');
  end if;

  -- M1 · EL INVARIANTE DE `exact_amounts` SIN CONVERSION, en su nueva sede.
  --      Se busca una version SIN conversion y se le intenta escribir una fila
  --      exacta con resuelto distinto del declarado: el trigger diferido tiene
  --      que rechazarla al forzar la comprobacion.
  select sp.operation_version_id, sp.scope_id into v_ver, v_scope
    from core.split_participant sp
   where not exists (select 1 from core.frozen_conversion fc
                      where fc.operation_version_id = sp.operation_version_id
                        and fc.scope_id = sp.scope_id)
   limit 1;
  if v_ver is null then
    fallos := array_append(fallos, 'M1 no hay ninguna version sin conversion con la que probar');
  else
    select p.id into v_part from core.participant p
     where p.scope_id = v_scope
       and not exists (select 1 from core.split_participant x
                        where x.operation_version_id = v_ver and x.participant_id = p.id)
     limit 1;
    v_ok := false;
    begin
      insert into core.split_participant
        (operation_version_id, scope_id, participant_id, ordinal, split_method,
         declared_amount, resolved_amount)
      values (v_ver, v_scope, v_part, 99, 'exact_amounts', 5000, 4000);
      set constraints all immediate;
      v_ok := true;
    exception when others then null;
    end;
    if v_ok then
      fallos := array_append(fallos,
        'M1 se acepto un reparto exacto SIN conversion con resuelto distinto del declarado');
    end if;
    delete from core.split_participant
     where operation_version_id = v_ver and scope_id = v_scope and ordinal = 99;
    set constraints all immediate;
  end if;

  -- M2 · y la falsacion de esa falsacion: sin el trigger, la misma fila entra.
  --      Si entrara igualmente con el trigger puesto, M1 no probaria nada.
  -- Los eventos diferidos que quedan de las secciones anteriores se resuelven
  -- antes: no se puede alterar la tabla con comprobaciones pendientes.
  set constraints all immediate;
  drop trigger split_participant_exactos_coinciden_sin_conversion on core.split_participant;
  v_ok := false;
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_amount, resolved_amount)
    values (v_ver, v_scope, v_part, 98, 'exact_amounts', 5000, 4000);
    set constraints all immediate;
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'M2 sin el trigger la fila SIGUE rechazandose: M1 no estaba probando el trigger');
  end if;
  delete from core.split_participant
   where operation_version_id = v_ver and scope_id = v_scope and ordinal = 98;
  create constraint trigger split_participant_exactos_coinciden_sin_conversion
    after insert on core.split_participant
    deferrable initially deferred
    for each row execute function sec.split_exact_matches_without_conversion();

  if cardinality(fallos) > 0 then
    raise exception E'M · falsacion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'M · el invariante de exact_amounts sin conversion se comprueba, y falla cuando se quita: OK';
end
$m$;

rollback;

\echo 'fx-group-expense: OK'
