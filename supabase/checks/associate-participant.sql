-- ============================================================================
-- ASOCIAR UN FANTASMA A MI CUENTA: LECTURA CANONICA + CAJA HISTORICA (ADR-040)
-- ============================================================================
--
-- Contra las funciones REALES del borrador 20260914130000 (api.associate_participant,
-- sec.incorporate_participant_cash, core.current_effect canonica) y del
-- 20260914120000 (novacion de salida), llamadas como cada cuenta. Las ayudas
-- de lib/group-payment-helpers.sql solo leen y envuelven. Todo en una
-- transaccion que termina en rollback. Solo sobre la pila aislada.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/associate-participant.sql; } | docker exec -i supabase_db_NomeyIso psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · fixture: actividad previa de las DOS identidades (gastos con las dos,
--       deuda entre ellas, pagos vigentes y anulados, un pago entre ellas)
--   B · asociar: pares y netos canonicos (sin par conmigo mismo), conservacion
--       de la suma, caja historica incorporada una vez, cuota por lectura,
--       Movimientos, vistas de grupo; replay y segunda clave; rechazos
--   C · despues: alta nueva con el origen (rehusada), correccion que lo
--       conserva (permitida), correccion del gasto que pago (la caja nueva se
--       deriva del destino), anulacion (la caja incorporada desaparece con la
--       version), anulacion de un pago del origen (autorizacion por canonico)
--   D · con la novacion de salida: asociar al fantasma acreedor de un par
--       novado no duplica nada; pagar y salir despues
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a6d00000-0000-4000-8000-0000000000e1'::uuid as edu,   'a6d00000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a6d00000-0000-4000-8000-0000000000a1'::uuid as aitor, 'a6d00000-0000-4000-8000-0000000000f2'::uuid as s_aitor,
  'a6d00000-0000-4000-8000-0000000000a2'::uuid as ana,   'a6d00000-0000-4000-8000-0000000000f3'::uuid as s_ana,
  'a6d00000-0000-4000-8000-000000000010'::uuid as g1,
  'a6d00000-0000-4000-8000-000000000311'::uuid as an1,  -- «Aitor» (Soy nuevo, vinculado)
  'a6d00000-0000-4000-8000-000000000321'::uuid as af1,  -- «Aitor F» (fantasma que añadio Edu)
  'a6d00000-0000-4000-8000-000000000331'::uuid as a1,   -- Ana
  'a6d00000-0000-4000-8000-000000000341'::uuid as e1,   -- Edu
  'a6d00000-0000-4000-8000-000000000351'::uuid as j1,   -- Juan (fantasma retirado)
  'a6d00000-0000-4000-8000-000000000361'::uuid as l1,   -- Luis (fantasma)
  'a6d00000-0000-4000-8000-000000000011'::uuid as g2,
  'a6d00000-0000-4000-8000-000000000312'::uuid as an2, 'a6d00000-0000-4000-8000-000000000332'::uuid as a2,
  'a6d00000-0000-4000-8000-000000000342'::uuid as e2,  'a6d00000-0000-4000-8000-000000000362'::uuid as l2,
  null::uuid as cat, null::uuid as x1, null::uuid as x2, null::uuid as x3, null::uuid as x4,
  null::uuid as p1, null::uuid as p2, null::uuid as p3, null::uuid as nov;
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
-- ASOCIAR con la funcion real, como p_who. 'OK <destino> caja=<n>' / 'REPLAY <destino>' / codigo.
create function pg_temp.asociar(p_who uuid, p_key uuid, p_scope uuid, p_source uuid) returns text language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.gp_actor(p_who);
  v := api.associate_participant(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1,
                                                    'scope_id', p_scope, 'participant_id', p_source));
  perform pg_temp.gp_super();
  return case when (v ->> 'already_processed')::boolean then 'REPLAY ' || pg_temp.gp_name((v ->> 'target_participant_id')::uuid)
              else 'OK ' || pg_temp.gp_name((v ->> 'target_participant_id')::uuid) || ' caja=' || (v ->> 'incorporated_versions') end;
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- La caja de un Personal, efecto a efecto, con la operacion que la origina.
create function pg_temp.caja(p_personal uuid) returns text language sql stable as $$
  select coalesce(string_agg(coalesce(md.concept, 'pago') || ':' || e.balance_amount, ' ' order by ov.effective_date, coalesce(md.concept, 'pago'), e.balance_amount), '-')
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    left join core.movement_detail md on md.operation_version_id = ov.id
   where e.scope_id = p_personal and e.balance_amount is not null;
$$;
-- Lo que las vistas de grupo publican a p_user: participantes visibles (sin
-- origenes), saldos por fila.
create function pg_temp.vistas(p_user uuid, p_scope uuid) returns text language plpgsql as $$
declare v text; j jsonb; k jsonb;
begin
  perform pg_temp.gp_actor(p_user);
  select jsonb_agg(jsonb_build_object('n', display_name, 'm', merged_into_participant_id, 's', is_self) order by display_name) into j
    from api.group_participant where scope_id = p_scope;
  select jsonb_agg(jsonb_build_object('n', display_name, 'p', net_position) order by display_name) into k
    from api.group_balance where scope_id = p_scope;
  perform pg_temp.gp_super();
  v := 'participantes=' || (select string_agg((x ->> 'n') || case when (x ->> 'm') is not null then '→' || pg_temp.gp_name((x ->> 'm')::uuid) else '' end
                                               || case when (x ->> 's')::boolean then '*' else '' end, ' ') from jsonb_array_elements(j) x)
    || ' · saldos=' || (select string_agg((x ->> 'n') || ':' || (x ->> 'p'), ' ') from jsonb_array_elements(k) x);
  return v;
end $$;
create function pg_temp.salida_nov(p_scope uuid, p_participant uuid) returns uuid language sql stable as $$
  select novation_operation_id from core.group_departure where scope_id = p_scope and participant_id = p_participant;
$$;
create function pg_temp.grupo(p_key uuid, p_g uuid, p_name text, p_edu uuid, p_parts jsonb, p_links jsonb) returns void language plpgsql as $$
declare r fx%rowtype; x jsonb;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(r.edu);
  perform api.create_group(jsonb_build_object(
    'client_command_id', p_key, 'command_contract_version', 1,
    'client_group_id', p_g, 'display_name', p_name, 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', p_edu, 'creator_display_name', 'Edu', 'participants', p_parts));
  perform pg_temp.gp_super();
  for x in select * from jsonb_array_elements(p_links) loop
    insert into core.membership (scope_id, user_id) values (p_g, (x ->> 'user')::uuid);
    insert into core.participant_user_link (participant_id, scope_id, user_id) values ((x ->> 'participant')::uuid, p_g, (x ->> 'user')::uuid);
  end loop;
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = p_g;
end $$;
grant execute on function pg_temp.gasto(uuid, uuid, uuid, uuid, uuid[], bigint, text, uuid), pg_temp.asociar(uuid, uuid, uuid, uuid),
  pg_temp.caja(uuid), pg_temp.vistas(uuid, uuid) to authenticated;

-- ============================ A · fixture ====================================
do $a$
declare r fx%rowtype; v text;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_aitor, 'personal', r.eur, r.aitor), (r.s_ana, 'personal', r.eur, r.ana);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_aitor, r.aitor), (r.s_ana, r.ana);
  perform pg_temp.grupo('a6d00000-0000-4000-8000-000000000020', r.g1, 'Fusion', r.e1,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.an1, 'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.af1, 'display_name', 'Aitor F'),
                      jsonb_build_object('client_participant_id', r.a1,  'display_name', 'Ana'),
                      jsonb_build_object('client_participant_id', r.j1,  'display_name', 'Juan'),
                      jsonb_build_object('client_participant_id', r.l1,  'display_name', 'Luis')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.an1), jsonb_build_object('user', r.ana, 'participant', r.a1)));
  -- Juan, sin actividad, retirado por Edu (retire_participant real).
  perform pg_temp.gp_actor(r.edu);
  perform api.retire_participant(jsonb_build_object('client_operation_id', 'a6d00000-0000-4000-8000-000000000030', 'command_contract_version', 1,
                                                    'scope_id', r.g1, 'participant_id', r.j1, 'expected_pairs', '[]'::jsonb));
  perform pg_temp.gp_super();
  -- Los pagos estan acotados por los NETOS del momento (ADR-038 v3), asi que
  -- el orden importa: cada pago se registra cuando el pagador debe y el
  -- receptor cobra al menos ese importe.
  -- X1: Aitor F (sin cuenta) paga 900 a F, Edu y Ana → Edu>F 300, Ana>F 300. Ninguna caja.
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000101', r.g1, r.af1, array[r.af1, r.e1, r.a1], 900, 'Cena');
  if v not like 'OK %' then raise exception 'A1: %', v; end if; update fx set x1 = substr(v, 4)::uuid;
  -- P2: Ana paga 100 a F y lo anula: no cuenta.
  v := pg_temp.gp_pay(r.ana, 'a6d00000-0000-4000-8000-000000000106', r.g1, r.a1, r.af1, 100);
  if v not like 'OK %' then raise exception 'A6: %', v; end if; update fx set p2 = substr(v, 4)::uuid;
  select * into r from fx;
  v := pg_temp.gp_annul(r.ana, 'a6d00000-0000-4000-8000-000000000107', r.p2);
  if v <> 'OK' then raise exception 'A7: %', v; end if;
  -- P1: Edu paga 300 a F (vigente). Caja de Edu -300; F sin caja.
  v := pg_temp.gp_pay(r.edu, 'a6d00000-0000-4000-8000-000000000105', r.g1, r.e1, r.af1, 300);
  if v not like 'OK %' then raise exception 'A5: %', v; end if; update fx set p1 = substr(v, 4)::uuid;
  -- X4: F paga 200 a F y Aitor → Aitor>F 100. Ninguna caja.
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000104', r.g1, r.af1, array[r.af1, r.an1], 200, 'Pan');
  if v not like 'OK %' then raise exception 'A4: %', v; end if; update fx set x4 = substr(v, 4)::uuid;
  -- P3: Aitor paga 100 a F (entre mis dos identidades). Caja de Aitor -100; F sin caja.
  v := pg_temp.gp_pay(r.aitor, 'a6d00000-0000-4000-8000-000000000108', r.g1, r.an1, r.af1, 100);
  if v not like 'OK %' then raise exception 'A8: %', v; end if; update fx set p3 = substr(v, 4)::uuid;
  -- X2: Edu paga 400 a Edu, Aitor, F y Luis → 100 cada uno a Edu. Caja de Edu -400.
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000102', r.g1, r.e1, array[r.e1, r.an1, r.af1, r.l1], 400, 'Taxi');
  if v not like 'OK %' then raise exception 'A2: %', v; end if; update fx set x2 = substr(v, 4)::uuid;
  -- X3: Aitor paga 200 a Aitor y F → F>Aitor 100 (deuda entre mis dos identidades). Caja de Aitor -200.
  v := pg_temp.gasto(r.aitor, 'a6d00000-0000-4000-8000-000000000103', r.g1, r.an1, array[r.an1, r.af1], 200, 'Cafes');
  if v not like 'OK %' then raise exception 'A3: %', v; end if; update fx set x3 = substr(v, 4)::uuid;
  select * into r from fx;
  raise notice 'A · antes: pares % · netos % · Personal Aitor % · caja Aitor % · vistas Aitor %',
    pg_temp.gp_pairs(r.g1), pg_temp.gp_positions(r.g1), pg_temp.gp_personal(r.aitor), pg_temp.caja(r.s_aitor), pg_temp.vistas(r.aitor, r.g1);
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Edu:100 Aitor F>Aitor:100 Aitor F>Edu:100 Ana>Aitor F:300 Luis>Edu:100' then raise exception 'A9: %', pg_temp.gp_pairs(r.g1); end if;
  if pg_temp.gp_positions(r.g1) <> 'Aitor:0 Aitor F:100 Ana:-300 Edu:300 Juan:0 Luis:-100' then raise exception 'A10: %', pg_temp.gp_positions(r.g1); end if;
  if pg_temp.gp_personal(r.aitor) <> 'caja=-300 gasto=300 deuda=0 movs_pago=1 deuda_reabierta=0' then raise exception 'A11: %', pg_temp.gp_personal(r.aitor); end if;
  raise notice 'A · dos identidades con actividad, deuda entre ellas, pagos vigentes, anulados y entre ellas: fixture OK';
end $a$;

-- ============================ B · asociar ====================================
do $b$
declare r fx%rowtype; v text; v_effects int; v_obs int; v_edu text; v_ana text;
begin
  select * into r from fx;
  v_edu := pg_temp.gp_personal(r.edu); v_ana := pg_temp.gp_personal(r.ana);
  -- Rechazos antes del hecho.
  v := pg_temp.asociar(r.edu,   'a6d00000-0000-4000-8000-000000000201', r.g1, r.an1); if v <> 'PARTICIPANT_LINKED'  then raise exception 'B0a: %', v; end if;
  v := pg_temp.asociar(r.aitor, 'a6d00000-0000-4000-8000-000000000202', r.g1, r.j1);  if v <> 'PARTICIPANT_RETIRED' then raise exception 'B0b: %', v; end if;
  v := pg_temp.asociar(r.aitor, 'a6d00000-0000-4000-8000-000000000203', r.g1, r.an1); if v <> 'PAYLOAD_INVALID'     then raise exception 'B0c: %', v; end if;
  v := pg_temp.asociar(r.aitor, 'a6d00000-0000-4000-8000-000000000204', r.g2, r.af1); if v <> 'NOT_AUTHORIZED'      then raise exception 'B0d: %', v; end if;
  if exists (select 1 from core.participant_merge m join core.participant p on p.id = m.source_participant_id where p.scope_id in (r.g1, r.g2)) then raise exception 'B0e: un rechazo escribio'; end if;

  -- Aitor asocia a «Aitor F».
  v := pg_temp.asociar(r.aitor, 'a6d00000-0000-4000-8000-000000000205', r.g1, r.af1);
  raise notice 'B · asociar: %', v;
  if v <> 'OK Aitor caja=4' then raise exception 'B1: %', v; end if;
  raise notice 'B · despues: pares % · netos % · Personal Aitor % · caja Aitor % · vistas Aitor % · vistas Edu %',
    pg_temp.gp_pairs(r.g1), pg_temp.gp_positions(r.g1), pg_temp.gp_personal(r.aitor), pg_temp.caja(r.s_aitor), pg_temp.vistas(r.aitor, r.g1), pg_temp.vistas(r.edu, r.g1);
  -- Pares canonicos: un solo Aitor, sin par conmigo mismo; netos conservados (F 100 + Aitor 0 = Aitor 100).
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Edu:200 Ana>Aitor:300 Luis>Edu:100' then raise exception 'B2: %', pg_temp.gp_pairs(r.g1); end if;
  if pg_temp.gp_positions(r.g1) <> 'Aitor:100 Aitor F:0 Ana:-300 Edu:300 Juan:0 Luis:-100' then raise exception 'B3: %', pg_temp.gp_positions(r.g1); end if;
  -- Caja: X1 -900, X4 -200, P1 +300, P3 +100 (el otro lado del pago conmigo mismo); P2 anulado no; X2/X3 ya tenian la suya.
  if pg_temp.caja(r.s_aitor) <> 'Cafes:-200 Cena:-900 Pan:-200 pago:-100 pago:100 pago:300' then raise exception 'B4: %', pg_temp.caja(r.s_aitor); end if;
  -- Personal: caja -1000; gasto = mis cuotas (300) + las de F (300+100+100+100 = 600) = 900; deuda = neto canonico +100.
  if pg_temp.gp_personal(r.aitor) <> 'caja=-1000 gasto=900 deuda=100 movs_pago=2 deuda_reabierta=0' then raise exception 'B5: %', pg_temp.gp_personal(r.aitor); end if;
  -- Nadie mas cambio.
  if pg_temp.gp_personal(r.edu) <> v_edu or pg_temp.gp_personal(r.ana) <> v_ana then raise exception 'B6: Edu % Ana %', pg_temp.gp_personal(r.edu), pg_temp.gp_personal(r.ana); end if;
  -- Vistas: el origen se marca fusionado y no tiene fila en saldos; Edu ve lo mismo.
  if pg_temp.vistas(r.aitor, r.g1) <> 'participantes=Aitor* Aitor F→Aitor Ana Edu Juan Luis · saldos=Aitor:100 Ana:-300 Edu:300 Luis:-100' then raise exception 'B7: %', pg_temp.vistas(r.aitor, r.g1); end if;
  -- La foto que compara el pago (20260914160000) es exactamente la que la
  -- vista publica: sin el origen (af1) ni el retirado (j1). Antes los listaba
  -- a :0 y ningun pago podia dejar de caducar en este grupo.
  if sec.group_positions_text(r.g1) <> (select string_agg(participant_id::text || ':' || net_position, ' ' order by participant_id) from api.group_balance where scope_id = r.g1)
    then raise exception 'B7b: texto % · vista %', sec.group_positions_text(r.g1), (select string_agg(participant_id::text || ':' || net_position, ' ' order by participant_id) from api.group_balance where scope_id = r.g1); end if;
  if sec.group_positions_text(r.g1) like '%' || r.af1::text || '%' or sec.group_positions_text(r.g1) like '%' || r.j1::text || '%' then raise exception 'B7c: %', sec.group_positions_text(r.g1); end if;
  if pg_temp.vistas(r.edu, r.g1) <> 'participantes=Aitor Aitor F→Aitor Ana Edu* Juan Luis · saldos=Aitor:100 Ana:-300 Edu:300 Luis:-100' then raise exception 'B7b: %', pg_temp.vistas(r.edu, r.g1); end if;
  -- Movimientos del grupo: «tu parte» en X2 (100 mia + 100 de F) es la suma, como Aitor.
  perform pg_temp.gp_actor(r.aitor);
  select your_share into v from api.group_operation where operation_id = r.x2;
  perform pg_temp.gp_super();
  if v <> '200' then raise exception 'B7c: your_share %', v; end if;
  -- Observaciones: una por version completada que no tenia la de este Personal (X1, X4, P1); P3 ya la tenia.
  select count(*) into v_obs from core.balance_observation where scope_id = r.s_aitor;
  if v_obs <> 5 then raise exception 'B8: % observaciones', v_obs; end if;

  -- Replay (doble pulsacion): nada nuevo. Segunda clave: ya asociado. Otra cuenta: ya asociado.
  select count(*) into v_effects from core.effect where scope_id = r.s_aitor;
  v := pg_temp.asociar(r.aitor, 'a6d00000-0000-4000-8000-000000000205', r.g1, r.af1); if v <> 'REPLAY Aitor' then raise exception 'B9: %', v; end if;
  v := pg_temp.asociar(r.aitor, 'a6d00000-0000-4000-8000-000000000206', r.g1, r.af1); if v <> 'PARTICIPANT_MERGED' then raise exception 'B10: %', v; end if;
  v := pg_temp.asociar(r.ana,   'a6d00000-0000-4000-8000-000000000207', r.g1, r.af1); if v <> 'PARTICIPANT_MERGED' then raise exception 'B11: %', v; end if;
  if (select count(*) from core.effect where scope_id = r.s_aitor) <> v_effects or (select count(*) from core.participant_merge where scope_id = r.g1) <> 1 then raise exception 'B12: se escribio de mas'; end if;
  raise notice 'B · un solo Aitor en pares y saldos, suma conservada, caja historica una vez (4 versiones), cuota por lectura, replay y rechazos: OK';
end $b$;

-- ============================ C · despues ====================================
do $c$
declare r fx%rowtype; v text; v_caja text;
begin
  select * into r from fx;
  -- C1 · alta nueva que nombra al origen: rehusada; con el destino: permitida (y la retiro para no ensuciar).
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000301', r.g1, r.e1, array[r.e1, r.af1], 100);
  if v <> 'PARTICIPANT_MERGED' then raise exception 'C1: %', v; end if;
  -- C2 · correccion de X2 (nombra a F, que ya constaba): solo concepto, permitida; F conserva su cuota, que se lee como mia.
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000302', r.g1, r.e1, array[r.e1, r.an1, r.af1, r.l1], 400, 'Taxi al hotel', r.x2);
  if v not like 'OK %' then raise exception 'C2: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Edu:200 Ana>Aitor:300 Luis>Edu:100' then raise exception 'C2b: %', pg_temp.gp_pairs(r.g1); end if;
  -- C3 · correccion de X4 (F pago 200 → 300, como Edu): la caja de la version
  --      nueva se deriva del DESTINO (-300 en mi Personal) y el -200 se va con
  --      la version sustituida. Los pares canonicos no cambian (Aitor>F es un
  --      par conmigo mismo). Nota: corregir X1 (F pago 900) esta rehusado por
  --      SETTLEMENT_EXCEEDS_DEBT con o sin fusion: la guarda de correccion
  --      neta las dos direcciones del par y P1 (300) mas la deuda inversa de X2
  --      la disparan; es un hallazgo previo a este bloque (sonda en el
  --      handoff), no de la fusion.
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000303', r.g1, r.af1, array[r.af1, r.an1], 300, 'Pan', r.x4);
  raise notice 'C3 · corregir el pan que pago F a 300: % · caja Aitor %', v, pg_temp.caja(r.s_aitor);
  if v not like 'OK %' then raise exception 'C3: %', v; end if;
  if pg_temp.caja(r.s_aitor) <> 'Cafes:-200 Cena:-900 Pan:-300 pago:-100 pago:100 pago:300' then raise exception 'C3b: %', pg_temp.caja(r.s_aitor); end if;
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Edu:200 Ana>Aitor:300 Luis>Edu:100' then raise exception 'C3c: %', pg_temp.gp_pairs(r.g1); end if;
  -- C4 · anular X4 (F pago; su caja ya es mia): Edu no puede (caja de otro), Aitor si; la caja incorporada y la corregida desaparecen con la version.
  v := pg_temp.gp_annul(r.edu, 'a6d00000-0000-4000-8000-000000000304', r.x4);
  if v <> 'NOT_AUTHORIZED' then raise exception 'C4: %', v; end if;
  v := pg_temp.gp_annul(r.aitor, 'a6d00000-0000-4000-8000-000000000305', r.x4);
  if v <> 'OK' then raise exception 'C4b: %', v; end if;
  raise notice 'C4 · X4 anulado por Aitor: caja Aitor % · pares %', pg_temp.caja(r.s_aitor), pg_temp.gp_pairs(r.g1);
  if pg_temp.caja(r.s_aitor) <> 'Cafes:-200 Cena:-900 pago:-100 pago:100 pago:300' then raise exception 'C4c: %', pg_temp.caja(r.s_aitor); end if;
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Edu:200 Ana>Aitor:300 Luis>Edu:100' then raise exception 'C4d: %', pg_temp.gp_pairs(r.g1); end if;
  -- C5 · anular P1 (Edu pago 300 a F): Edu (pagador) puede; el +300 incorporado desaparece; el par Edu>Aitor reaparece y se neta con Aitor>Edu.
  v := pg_temp.gp_annul(r.edu, 'a6d00000-0000-4000-8000-000000000306', r.p1);
  if v <> 'OK' then raise exception 'C5: %', v; end if;
  raise notice 'C5 · P1 anulado: caja Aitor % · pares %', pg_temp.caja(r.s_aitor), pg_temp.gp_pairs(r.g1);
  if pg_temp.caja(r.s_aitor) <> 'Cafes:-200 Cena:-900 pago:-100 pago:100' then raise exception 'C5b: %', pg_temp.caja(r.s_aitor); end if;
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Aitor:300 Edu>Aitor:100 Luis>Edu:100' then raise exception 'C5c: %', pg_temp.gp_pairs(r.g1); end if;
  -- C6 · anular P3 (Aitor pago 100 a F, ahora conmigo mismo): Aitor es las dos partes; los dos efectos de caja se van.
  v := pg_temp.gp_annul(r.aitor, 'a6d00000-0000-4000-8000-000000000307', r.p3);
  if v <> 'OK' then raise exception 'C6: %', v; end if;
  if pg_temp.caja(r.s_aitor) <> 'Cafes:-200 Cena:-900' then raise exception 'C6b: %', pg_temp.caja(r.s_aitor); end if;
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Aitor:300 Edu>Aitor:100 Luis>Edu:100' then raise exception 'C6c: %', pg_temp.gp_pairs(r.g1); end if;
  raise notice 'C · alta con el origen rehusada; correccion que lo conserva; caja de correcciones derivada del destino; anulaciones revierten la caja incorporada exactamente: OK';
end $c$;

-- ============================ D · con la novacion de salida ==================
do $d$
declare r fx%rowtype; v text; v_pos text;
begin
  select * into r from fx;
  perform pg_temp.grupo('a6d00000-0000-4000-8000-000000000021', r.g2, 'Salida', r.e2,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.an2, 'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.a2,  'display_name', 'Ana'),
                      jsonb_build_object('client_participant_id', r.l2,  'display_name', 'Luis')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.an2), jsonb_build_object('user', r.ana, 'participant', r.a2)));
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000401', r.g2, r.e2, array[r.e2, r.an2], 600); if v not like 'OK %' then raise exception 'D0a: %', v; end if;
  v := pg_temp.gasto(r.edu, 'a6d00000-0000-4000-8000-000000000402', r.g2, r.l2, array[r.l2, r.e2], 600); if v not like 'OK %' then raise exception 'D0b: %', v; end if;
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Edu:300 Edu>Luis:300' then raise exception 'D1: %', pg_temp.gp_pairs(r.g2); end if;
  v_pos := pg_temp.gp_positions(r.g2);
  v := pg_temp.gp_leave(r.edu, 'a6d00000-0000-4000-8000-000000000403', r.g2);
  if v <> 'OK' then raise exception 'D2: %', v; end if;
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Luis:300' then raise exception 'D3: %', pg_temp.gp_pairs(r.g2); end if;
  -- Ana asocia a Luis: el par novado se lee Aitor>Ana; las liquidaciones de la novacion (Edu>Luis -300) y el gasto original (Edu>Luis +300) se netan sobre Ana; nada se duplica.
  v := pg_temp.asociar(r.ana, 'a6d00000-0000-4000-8000-000000000404', r.g2, r.l2);
  raise notice 'D · Ana asocia a Luis tras la salida de Edu: % · pares % · netos % · caja Ana %', v, pg_temp.gp_pairs(r.g2), pg_temp.gp_positions(r.g2), pg_temp.caja(r.s_ana);
  if v <> 'OK Ana caja=1' then raise exception 'D4: %', v; end if;
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Ana:300' then raise exception 'D5: %', pg_temp.gp_pairs(r.g2); end if;
  if pg_temp.gp_positions(r.g2) <> 'Aitor:-300 Ana:300 Edu:0 Luis:0' then raise exception 'D6: %', pg_temp.gp_positions(r.g2); end if;
  if pg_temp.caja(r.s_ana) <> 'Gasto:-600' then raise exception 'D7: %', pg_temp.caja(r.s_ana); end if;
  -- La novacion sigue sin poder anularse; Ana no sale con neto +300; Aitor le paga y Ana sale sin pares.
  v := pg_temp.gp_annul(r.aitor, 'a6d00000-0000-4000-8000-000000000405', pg_temp.salida_nov(r.g2, r.e2));
  if v not in ('OPERATION_NOT_ANNULLABLE', 'DEPARTED_OBLIGATION_CHANGED', 'SETTLEMENT_EXCEEDS_DEBT') then raise exception 'D8: %', v; end if;
  v := pg_temp.gp_leave(r.ana, 'a6d00000-0000-4000-8000-000000000406', r.g2);
  if v not like 'LEAVE_BLOCKED_DEBT %' then raise exception 'D9: %', v; end if;
  v := pg_temp.gp_pay(r.aitor, 'a6d00000-0000-4000-8000-000000000407', r.g2, r.an2, r.a2, 300);
  if v not like 'OK %' then raise exception 'D10: %', v; end if;
  if pg_temp.gp_pairs(r.g2) <> '-' then raise exception 'D11: %', pg_temp.gp_pairs(r.g2); end if;
  v := pg_temp.gp_leave(r.ana, 'a6d00000-0000-4000-8000-000000000408', r.g2);
  if v <> 'OK' then raise exception 'D12: %', v; end if;
  raise notice 'D · simplificacion + asociacion: un solo par, netos conservados, caja del fantasma una vez, pago y salida despues: OK';
end $d$;

rollback;
