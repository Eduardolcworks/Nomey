-- ============================================================================
-- LA GUARDA DE SOBRELIQUIDACION VIGILA LO QUE CAMBIA (20260914150000)
-- ============================================================================
--
-- Contra las funciones reales, como cada cuenta; ayudas de
-- lib/group-payment-helpers.sql. Todo en rollback.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/oversettlement-delta.sql; } | docker exec -i supabase_db_NomeyIso psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · el caso medido: par liquidado y deuda cruzada posterior; corregir solo
--       el concepto o subir el importe: permitido; bajarlo: rehusado
--   B · anular: el gasto liquidado, rehusado; el gasto cruzado, permitido
--   C · el ejemplo canonico: 5000 liquidado 4000 → 3000 rehusado, → 4000
--       permitido; y sin liquidaciones, un par cruzado no bloquea nada
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'aad00000-0000-4000-8000-0000000000e1'::uuid as edu,   'aad00000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'aad00000-0000-4000-8000-0000000000a1'::uuid as ana,   'aad00000-0000-4000-8000-0000000000f2'::uuid as s_ana,
  'aad00000-0000-4000-8000-000000000010'::uuid as g1,
  'aad00000-0000-4000-8000-000000000311'::uuid as an1, 'aad00000-0000-4000-8000-000000000341'::uuid as e1,
  'aad00000-0000-4000-8000-000000000321'::uuid as f1, 'aad00000-0000-4000-8000-000000000361'::uuid as l1,
  null::uuid as cat, null::uuid as x1, null::uuid as x2, null::uuid as x3, null::uuid as p1;
grant select, update on fx to authenticated;

create function pg_temp.gasto(p_who uuid, p_key uuid, p_scope uuid, p_payer uuid, p_parts uuid[], p_total bigint,
                              p_concept text default 'Gasto', p_op uuid default null) returns text language plpgsql as $$
declare r fx%rowtype; v jsonb; v_payload jsonb;
begin
  select * into r from fx;
  v_payload := jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', p_scope, 'currency_definition_id', r.eur, 'total', p_total::text, 'effective_date', (current_date - 1)::text,
    'concept', p_concept, 'category_id', r.cat, 'payer_participant_id', p_payer,
    'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal'));
  if p_op is not null then
    v_payload := v_payload || jsonb_build_object('operation_id', p_op,
      'expected_version_id', (select current_version_id from core.operation where id = p_op));
  end if;
  perform pg_temp.gp_actor(p_who);
  v := api.record_group_expense(v_payload);
  perform pg_temp.gp_super();
  return 'OK ' || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
grant execute on function pg_temp.gasto(uuid, uuid, uuid, uuid, uuid[], bigint, text, uuid) to authenticated;

do $f$
declare r fx%rowtype; v text;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values (r.s_edu, 'personal', r.eur, r.edu), (r.s_ana, 'personal', r.eur, r.ana);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_ana, r.ana);
  perform pg_temp.gp_actor(r.edu);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'aad00000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g1, 'display_name', 'Cruce', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.e1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.an1, 'display_name', 'Ana'),
                                      jsonb_build_object('client_participant_id', r.f1, 'display_name', 'Fran'),
                                      jsonb_build_object('client_participant_id', r.l1, 'display_name', 'Luis'))));
  perform pg_temp.gp_super();
  insert into core.membership (scope_id, user_id) values (r.g1, r.ana);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.an1, r.g1, r.ana);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = r.g1;
end $f$;

-- ===== A · el caso medido ====================================================
do $a$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  -- X1: Fran (sin cuenta) paga 900 a Fran, Edu y Ana → Edu>Fran 300, Ana>Fran 300. P1: Edu paga sus 300.
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000101', r.g1, r.f1, array[r.f1, r.e1, r.an1], 900, 'Cena'); if v not like 'OK %' then raise exception 'A0: %', v; end if;
  update fx set x1 = substr(v, 4)::uuid;
  v := pg_temp.gp_pay(r.edu, 'aad00000-0000-4000-8000-000000000102', r.g1, r.e1, r.f1, 300); if v not like 'OK %' then raise exception 'A1: %', v; end if;
  update fx set p1 = substr(v, 4)::uuid;
  -- X2: Edu paga 400 a Edu, Ana, Fran y Luis → Fran>Edu 100: el par Edu↔Fran queda «sobrepasado» por un hecho legitimo.
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000103', r.g1, r.e1, array[r.e1, r.an1, r.f1, r.l1], 400, 'Taxi'); if v not like 'OK %' then raise exception 'A2: %', v; end if;
  update fx set x2 = substr(v, 4)::uuid;
  select * into r from fx;
  raise notice 'A · pares %', pg_temp.gp_pairs(r.g1);
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Edu:100 Ana>Fran:300 Fran>Edu:100 Luis>Edu:100' then raise exception 'A3: %', pg_temp.gp_pairs(r.g1); end if;
  -- Solo el concepto: permitido. Subir: permitido. Bajar: rehusado.
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000104', r.g1, r.f1, array[r.f1, r.e1, r.an1], 900, 'Cena de Fran', r.x1);
  raise notice 'A · solo concepto: %', v; if v not like 'OK %' then raise exception 'A4: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Edu:100 Ana>Fran:300 Fran>Edu:100 Luis>Edu:100' then raise exception 'A4b: %', pg_temp.gp_pairs(r.g1); end if;
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000105', r.g1, r.f1, array[r.f1, r.e1, r.an1], 1200, 'Cena de Fran', r.x1);
  raise notice 'A · 900 → 1200: %', v; if v not like 'OK %' then raise exception 'A5: %', v; end if;
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000106', r.g1, r.f1, array[r.f1, r.e1, r.an1], 600, 'Cena de Fran', r.x1);
  raise notice 'A · 1200 → 600 (Edu>Fran 200 < 300 liquidados): %', v; if v <> 'SETTLEMENT_EXCEEDS_DEBT' then raise exception 'A6: %', v; end if;
  -- Volver a 900 desde 1200: BAJA la deuda del par (400 → 300) con el par ya sobrepasado por el cruce: rehusado, como decide la semantica neteada (baja = empeora).
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000107', r.g1, r.f1, array[r.f1, r.e1, r.an1], 900, 'Cena de Fran', r.x1);
  raise notice 'A · 1200 → 900: %', v; if v <> 'SETTLEMENT_EXCEEDS_DEBT' then raise exception 'A7: %', v; end if;
  raise notice 'A · par liquidado con cruce posterior: concepto y subida permitidos, bajada rehusada: OK';
end $a$;

-- ===== B · anular ============================================================
do $b$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  -- Anular X1 (Edu>Fran liquidado): rehusado. Anular X2 (el cruce): permitido, y el par vuelve a cuadrar.
  v := pg_temp.gp_annul(r.edu, 'aad00000-0000-4000-8000-000000000111', r.x1);
  raise notice 'B · anular el gasto liquidado: %', v; if v <> 'SETTLEMENT_EXCEEDS_DEBT' then raise exception 'B1: %', v; end if;
  v := pg_temp.gp_annul(r.edu, 'aad00000-0000-4000-8000-000000000112', r.x2);
  raise notice 'B · anular el gasto cruzado: % · pares %', v, pg_temp.gp_pairs(r.g1); if v <> 'OK' then raise exception 'B2: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Fran:400 Edu>Fran:100' then raise exception 'B3: %', pg_temp.gp_pairs(r.g1); end if;
  raise notice 'B · anular: el liquidado rehusado, el cruzado permitido: OK';
end $b$;

-- ===== C · el ejemplo canonico y los pares sin liquidaciones =================
do $c$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  -- X3: Edu paga 10000 a Edu y Ana → Ana>Edu 5000; Ana paga 4000.
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000121', r.g1, r.e1, array[r.e1, r.an1], 10000, 'Hotel'); if v not like 'OK %' then raise exception 'C0: %', v; end if;
  update fx set x3 = substr(v, 4)::uuid; select * into r from fx;
  v := pg_temp.gp_pay(r.ana, 'aad00000-0000-4000-8000-000000000122', r.g1, r.an1, r.e1, 4000); if v not like 'OK %' then raise exception 'C1: %', v; end if;
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000123', r.g1, r.e1, array[r.e1, r.an1], 6000, 'Hotel', r.x3);
  raise notice 'C · 5000 liquidado 4000 → 3000: %', v; if v <> 'SETTLEMENT_EXCEEDS_DEBT' then raise exception 'C2: %', v; end if;
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000124', r.g1, r.e1, array[r.e1, r.an1], 8000, 'Hotel', r.x3);
  raise notice 'C · → 4000 (= liquidado): %', v; if v not like 'OK %' then raise exception 'C3: %', v; end if;
  -- Un par cruzado SIN liquidaciones (Ana>Fran 400 y, ahora, Fran>Ana) no bloquea corregir ninguno de los dos.
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000125', r.g1, r.f1, array[r.f1, r.an1], 200, 'Pan'); if v not like 'OK %' then raise exception 'C4: %', v; end if;
  v := pg_temp.gasto(r.edu, 'aad00000-0000-4000-8000-000000000126', r.g1, r.f1, array[r.f1, r.an1], 300, 'Pan y leche', substr(v, 4)::uuid);
  if v not like 'OK %' then raise exception 'C5: %', v; end if;
  raise notice 'C · el ejemplo canonico se conserva; sin liquidaciones nada bloquea: OK';
end $c$;

rollback;
