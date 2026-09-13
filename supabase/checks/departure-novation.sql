-- ============================================================================
-- SALIR A CERO: LA SALIDA REASIGNA LAS OBLIGACIONES (ADR-038 C8) · aislado
-- ============================================================================
--
-- Contra las funciones REALES del borrador 20260914120000 (api.leave_group con
-- neto cero y sec.record_departure_novation), llamadas como cada cuenta. Las
-- ayudas de lib/group-payment-helpers.sql solo leen y envuelven. Todo en una
-- transaccion que termina en rollback. Este check NO se ejecuta sobre la base
-- local mientras el borrador no este aplicado: solo sobre la pila aislada.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/departure-novation.sql; } | docker exec -i supabase_db_NomeyIso psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · el ejemplo: Aitor>Edu 300 y Edu>Luis 300 → Edu sale, Aitor>Luis 300,
--       ninguna caja se mueve, nada aparece en Movimientos, replay sin segunda
--       novacion; con neto distinto de cero, LEAVE_BLOCKED_DEBT y nada escrito
--   B · cadena con importes distintos y obligaciones ajenas que permanecen;
--       segunda salida sobre pares ya novados; fantasmas como deudor y acreedor
--   C · ciclo compensado: la salida lo colapsa; quien queda sin pares sale sin
--       novacion
--   D · despues: pagar una obligacion reasignada (acotado por netos, par
--       directo y camino C3), anular ese pago (C4), anular
--       o corregir un gasto original (ADR-039), anular la novacion (rehusado
--       sin escribir), correccion solo de concepto (permitida)
--   E · C6: la novacion no entra en my_reopened_debt; un pago anulado del que
--       salio, si (como hasta ahora)
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a5d00000-0000-4000-8000-0000000000e1'::uuid as edu,   'a5d00000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a5d00000-0000-4000-8000-0000000000a1'::uuid as aitor, 'a5d00000-0000-4000-8000-0000000000f2'::uuid as s_aitor,
  'a5d00000-0000-4000-8000-0000000000a2'::uuid as ana,   'a5d00000-0000-4000-8000-0000000000f3'::uuid as s_ana,
  'a5d00000-0000-4000-8000-0000000000b1'::uuid as bea,   'a5d00000-0000-4000-8000-0000000000f4'::uuid as s_bea,
  -- Tres grupos; los ids de participante fijan el orden del emparejamiento
  -- (Aitor < Ana < Bea < Edu < Gus < Luis, tambien alfabetico).
  'a5d00000-0000-4000-8000-000000000010'::uuid as g1,
  'a5d00000-0000-4000-8000-000000000311'::uuid as a1, 'a5d00000-0000-4000-8000-000000000341'::uuid as e1, 'a5d00000-0000-4000-8000-000000000361'::uuid as l1,
  'a5d00000-0000-4000-8000-000000000011'::uuid as g2,
  'a5d00000-0000-4000-8000-000000000312'::uuid as a2, 'a5d00000-0000-4000-8000-000000000322'::uuid as an2, 'a5d00000-0000-4000-8000-000000000332'::uuid as b2,
  'a5d00000-0000-4000-8000-000000000342'::uuid as e2, 'a5d00000-0000-4000-8000-000000000352'::uuid as gu2, 'a5d00000-0000-4000-8000-000000000362'::uuid as l2,
  'a5d00000-0000-4000-8000-000000000012'::uuid as g3,
  'a5d00000-0000-4000-8000-000000000313'::uuid as a3, 'a5d00000-0000-4000-8000-000000000343'::uuid as e3, 'a5d00000-0000-4000-8000-000000000363'::uuid as l3,
  null::uuid as cat, null::uuid as x1, null::uuid as x2, null::uuid as pay1, null::uuid as nov1, null::uuid as nov2, null::uuid as nov3, null::uuid as pay2;
grant select, update on fx to authenticated;

-- Gasto a partes iguales con el writer REAL, como p_who. Con p_op, correccion
-- de esa operacion sobre su version vigente. 'OK <op>' o el codigo.
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
-- Lo que una novacion de salida escribio: sus efectos con nombres, y cuantos
-- de caja o economicos (deben ser cero).
create function pg_temp.novacion(p_op uuid) returns text language sql stable as $$
  select coalesce((select o.operation_class from core.operation o where o.id = p_op), 'NULA') || ' · '
      || coalesce((select string_agg(e.accounting_class || ' ' || pg_temp.gp_name(e.debt_debtor_participant_id) || '>' || pg_temp.gp_name(e.debt_creditor_participant_id) || ':' || e.debt_amount, ' '
                                     order by e.accounting_class, pg_temp.gp_name(e.debt_debtor_participant_id), pg_temp.gp_name(e.debt_creditor_participant_id))
                     from core.current_effect e where e.operation_version_id = (select current_version_id from core.operation where id = p_op) and e.debt_amount is not null), '-')
      || ' · caja/economico=' || (select count(*) from core.current_effect e where e.operation_version_id = (select current_version_id from core.operation where id = p_op)
                                                                                and (e.balance_amount is not null or e.economic_amount is not null));
$$;
-- Lo que la salida guardo como procedencia.
create function pg_temp.salida(p_scope uuid, p_participant uuid) returns uuid language sql stable as $$
  select novation_operation_id from core.group_departure where scope_id = p_scope and participant_id = p_participant;
$$;
-- Lo que Movimientos del grupo y Pagos publican a p_user: cuantas filas.
create function pg_temp.listas(p_user uuid, p_scope uuid) returns text language plpgsql as $$
declare v text; j jsonb;
begin
  -- Se lee como el usuario (las vistas, bajo su RLS) y se nombra como postgres.
  perform pg_temp.gp_actor(p_user);
  v := 'gastos=' || (select count(*) from api.group_operation where scope_id = p_scope)
    || ' pagos=' || (select count(*) from api.group_payment where scope_id = p_scope)
    || ' movs_personal=' || (select count(*) from api.personal_operation);
  select jsonb_agg(jsonb_build_object('d', debtor_participant_id, 'c', creditor_participant_id, 'a', amount)) into j
    from api.group_pending_pair where scope_id = p_scope;
  perform pg_temp.gp_super();
  return v || ' pares=' || coalesce((select string_agg(pg_temp.gp_name((x ->> 'd')::uuid) || '>' || pg_temp.gp_name((x ->> 'c')::uuid) || ':' || (x ->> 'a'), ' ' order by 1)
                                       from jsonb_array_elements(coalesce(j, '[]'::jsonb)) x), '-');
end $$;
grant execute on function pg_temp.gasto(uuid, uuid, uuid, uuid, uuid[], bigint, text, uuid), pg_temp.novacion(uuid), pg_temp.salida(uuid, uuid), pg_temp.listas(uuid, uuid) to authenticated;

-- Crea un grupo como Edu con los participantes dados; los que tienen cuenta
-- reciben membresia y vinculo como postgres (la invitacion no es el objeto).
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

-- ============================ fixture ========================================
do $f$
declare r fx%rowtype;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_aitor, 'personal', r.eur, r.aitor), (r.s_ana, 'personal', r.eur, r.ana), (r.s_bea, 'personal', r.eur, r.bea);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_aitor, r.aitor), (r.s_ana, r.ana), (r.s_bea, r.bea);
  perform pg_temp.grupo('a5d00000-0000-4000-8000-000000000020', r.g1, 'Tres', r.e1,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.a1, 'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.l1, 'display_name', 'Luis')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.a1)));
  perform pg_temp.grupo('a5d00000-0000-4000-8000-000000000021', r.g2, 'Cadena', r.e2,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.a2, 'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.an2, 'display_name', 'Ana'),
                      jsonb_build_object('client_participant_id', r.b2, 'display_name', 'Bea'),
                      jsonb_build_object('client_participant_id', r.gu2, 'display_name', 'Gus'),
                      jsonb_build_object('client_participant_id', r.l2, 'display_name', 'Luis')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.a2), jsonb_build_object('user', r.ana, 'participant', r.an2),
                      jsonb_build_object('user', r.bea, 'participant', r.b2)));
  perform pg_temp.grupo('a5d00000-0000-4000-8000-000000000022', r.g3, 'Ciclo', r.e3,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.a3, 'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.l3, 'display_name', 'Luis')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.a3)));
end $f$;

-- ===== A · el ejemplo ========================================================
do $a$
declare r fx%rowtype; v text; v_edu text; v_aitor text; v_pos text; v_l_aitor text; v_ops int;
begin
  select * into r from fx;
  -- G1: Edu paga 600 a Edu y Aitor → Aitor>Edu 300. Con eso, Edu NO esta a cero.
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000101', r.g1, r.e1, array[r.e1, r.a1], 600, 'Cena');
  if v not like 'OK %' then raise exception 'A0: %', v; end if;
  update fx set x1 = substr(v, 4)::uuid;
  select count(*) into v_ops from core.operation;
  v := pg_temp.gp_leave(r.edu, 'a5d00000-0000-4000-8000-000000000102', r.g1);
  raise notice 'A · Edu con neto +300 intenta salir: %', v;
  if v not like 'LEAVE_BLOCKED_DEBT %' or v not like '%"net": "300"%' then raise exception 'A1: %', v; end if;
  if (select count(*) from core.operation) <> v_ops then raise exception 'A1b: la salida rehusada escribio una operacion'; end if;
  if exists (select 1 from core.group_departure where scope_id = r.g1) or not exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.edu) then
    raise exception 'A1c: la salida rehusada dejo rastro';
  end if;
  -- G2: Luis (sin cuenta) paga 800 a Luis y Edu → Edu>Luis 400; Edu le paga 100 → Edu>Luis 300.
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000103', r.g1, r.l1, array[r.l1, r.e1], 800, 'Taxi');
  if v not like 'OK %' then raise exception 'A2: %', v; end if;
  update fx set x2 = substr(v, 4)::uuid;
  v := pg_temp.gp_pay(r.edu, 'a5d00000-0000-4000-8000-000000000104', r.g1, r.e1, r.l1, 100);
  if v not like 'OK %' then raise exception 'A3: %', v; end if;
  update fx set pay1 = substr(v, 4)::uuid;
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Edu:300 Edu>Luis:300' then raise exception 'A4: %', pg_temp.gp_pairs(r.g1); end if;
  v_pos := pg_temp.gp_positions(r.g1);
  v_edu := pg_temp.gp_personal(r.edu); v_aitor := pg_temp.gp_personal(r.aitor);
  v_l_aitor := pg_temp.listas(r.aitor, r.g1);
  raise notice 'A · antes: pares % · netos % · Personal Edu % · Personal Aitor % · listas Aitor %', pg_temp.gp_pairs(r.g1), v_pos, v_edu, v_aitor, v_l_aitor;
  if v_edu not like 'caja=-700 %' then raise exception 'A5: %', v_edu; end if;
  select count(*) into v_ops from core.operation;

  -- Edu, a neto cero con dos pares, sale.
  v := pg_temp.gp_leave(r.edu, 'a5d00000-0000-4000-8000-000000000105', r.g1);
  if v <> 'OK' then raise exception 'A6: %', v; end if;
  update fx set nov1 = pg_temp.salida(r.g1, r.e1);
  select * into r from fx;
  raise notice 'A · despues: pares % · netos % · novacion %', pg_temp.gp_pairs(r.g1), pg_temp.gp_positions(r.g1), pg_temp.novacion(r.nov1);
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Luis:300' then raise exception 'A7: %', pg_temp.gp_pairs(r.g1); end if;
  if pg_temp.gp_positions(r.g1) <> v_pos then raise exception 'A8: los netos cambiaron: % → %', v_pos, pg_temp.gp_positions(r.g1); end if;
  if r.nov1 is null then raise exception 'A9: la salida no guardo la novacion'; end if;
  if pg_temp.novacion(r.nov1) <> 'departure_novation · novation Aitor>Luis:300 settlement Aitor>Edu:-300 settlement Edu>Luis:-300 · caja/economico=0' then
    raise exception 'A10: %', pg_temp.novacion(r.nov1);
  end if;
  if (select count(*) from core.operation) <> v_ops + 1 then raise exception 'A11: se escribio mas de una operacion'; end if;
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.edu) or not sec.participant_departed(r.e1, r.g1) then raise exception 'A12: Edu no salio'; end if;
  -- Ninguna caja se movio, ningun movimiento aparecio, nadie anoto renta ni gasto.
  if pg_temp.gp_personal(r.edu) <> v_edu then raise exception 'A13: Personal Edu cambio: % → %', v_edu, pg_temp.gp_personal(r.edu); end if;
  if pg_temp.gp_personal(r.aitor) <> v_aitor then raise exception 'A14: Personal Aitor cambio: % → %', v_aitor, pg_temp.gp_personal(r.aitor); end if;
  v := pg_temp.listas(r.aitor, r.g1);
  raise notice 'A · listas Aitor despues: %', v;
  if v <> 'gastos=2 pagos=1 movs_personal=0 pares=Aitor>Luis:300' then raise exception 'A15: %', v; end if;
  -- Replay de la misma salida: nada nuevo.
  v := pg_temp.gp_leave(r.edu, 'a5d00000-0000-4000-8000-000000000105', r.g1);
  if v <> 'REPLAY' then raise exception 'A16: %', v; end if;
  if (select count(*) from core.group_departure d where d.scope_id = r.g1 and d.novation_operation_id is not null) <> 1 then raise exception 'A17: segunda novacion'; end if;
  raise notice 'A · Aitor>Edu 300 y Edu>Luis 300 → Edu sale a cero; Aitor>Luis 300; ninguna caja se mueve, ninguna lista cambia, replay sin segunda novacion: OK';
end $a$;

-- ===== B · cadena con importes distintos y segunda salida sobre lo novado ====
do $b$
declare r fx%rowtype; v text; v_pos text; v_ops int;
begin
  select * into r from fx;
  -- Entrantes de Edu: Aitor>Edu 300, Gus(sin cuenta)>Edu 200.
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000111', r.g2, r.e2, array[r.e2, r.a2], 600);   if v not like 'OK %' then raise exception 'B0a: %', v; end if;
  update fx set x1 = substr(v, 4)::uuid;
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000112', r.g2, r.e2, array[r.e2, r.gu2], 400);  if v not like 'OK %' then raise exception 'B0b: %', v; end if;
  -- Salientes de Edu: Edu>Bea 400, Edu>Luis(sin cuenta) 100.
  v := pg_temp.gasto(r.bea, 'a5d00000-0000-4000-8000-000000000113', r.g2, r.b2, array[r.b2, r.e2], 800);   if v not like 'OK %' then raise exception 'B0c: %', v; end if;
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000114', r.g2, r.l2, array[r.l2, r.e2], 200);   if v not like 'OK %' then raise exception 'B0d: %', v; end if;
  update fx set x2 = substr(v, 4)::uuid;
  -- Ajenos a Edu, que deben permanecer: Bea>Luis 400 (deja a Bea a cero con pares), Ana>Aitor 250.
  v := pg_temp.gasto(r.bea, 'a5d00000-0000-4000-8000-000000000115', r.g2, r.l2, array[r.l2, r.b2], 800);   if v not like 'OK %' then raise exception 'B0e: %', v; end if;
  v := pg_temp.gasto(r.aitor, 'a5d00000-0000-4000-8000-000000000116', r.g2, r.a2, array[r.a2, r.an2], 500); if v not like 'OK %' then raise exception 'B0f: %', v; end if;
  v_pos := pg_temp.gp_positions(r.g2);
  raise notice 'B · antes: pares % · netos %', pg_temp.gp_pairs(r.g2), v_pos;
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Edu:300 Ana>Aitor:250 Bea>Luis:400 Edu>Bea:400 Edu>Luis:100 Gus>Edu:200' then raise exception 'B1: %', pg_temp.gp_pairs(r.g2); end if;

  -- Edu sale: entrantes [Aitor 300, Gus 200] contra salientes [Bea 400, Luis 100].
  v := pg_temp.gp_leave(r.edu, 'a5d00000-0000-4000-8000-000000000117', r.g2);
  if v <> 'OK' then raise exception 'B2: %', v; end if;
  update fx set nov2 = pg_temp.salida(r.g2, r.e2);
  select * into r from fx;
  raise notice 'B · Edu fuera: pares % · novacion %', pg_temp.gp_pairs(r.g2), pg_temp.novacion(r.nov2);
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Bea:300 Ana>Aitor:250 Bea>Luis:400 Gus>Bea:100 Gus>Luis:100' then raise exception 'B3: %', pg_temp.gp_pairs(r.g2); end if;
  if pg_temp.gp_positions(r.g2) <> v_pos then raise exception 'B4: netos % → %', v_pos, pg_temp.gp_positions(r.g2); end if;
  if pg_temp.novacion(r.nov2) <> 'departure_novation · novation Aitor>Bea:300 novation Gus>Bea:100 novation Gus>Luis:100 settlement Aitor>Edu:-300 settlement Edu>Bea:-400 settlement Edu>Luis:-100 settlement Gus>Edu:-200 · caja/economico=0' then
    raise exception 'B5: %', pg_temp.novacion(r.nov2);
  end if;

  -- Ana, con neto -250, no sale; nada se escribe.
  select count(*) into v_ops from core.operation;
  v := pg_temp.gp_leave(r.ana, 'a5d00000-0000-4000-8000-000000000118', r.g2);
  if v not like 'LEAVE_BLOCKED_DEBT %' or v not like '%"net": "-250"%' then raise exception 'B6: %', v; end if;
  if (select count(*) from core.operation) <> v_ops then raise exception 'B6b: escribio'; end if;

  -- Bea, a cero con entrantes YA NOVADOS [Aitor 300, Gus 100] y saliente original [Luis 400], sale.
  v := pg_temp.gp_leave(r.bea, 'a5d00000-0000-4000-8000-000000000119', r.g2);
  if v <> 'OK' then raise exception 'B7: %', v; end if;
  update fx set nov3 = pg_temp.salida(r.g2, r.b2);
  select * into r from fx;
  raise notice 'B · Bea fuera: pares % · netos % · novacion %', pg_temp.gp_pairs(r.g2), pg_temp.gp_positions(r.g2), pg_temp.novacion(r.nov3);
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Luis:300 Ana>Aitor:250 Gus>Luis:200' then raise exception 'B8: %', pg_temp.gp_pairs(r.g2); end if;
  if pg_temp.gp_positions(r.g2) <> v_pos then raise exception 'B9: netos % → %', v_pos, pg_temp.gp_positions(r.g2); end if;
  if pg_temp.novacion(r.nov3) <> 'departure_novation · novation Aitor>Luis:300 novation Gus>Luis:100 settlement Aitor>Bea:-300 settlement Bea>Luis:-400 settlement Gus>Bea:-100 · caja/economico=0' then
    raise exception 'B10: %', pg_temp.novacion(r.nov3);
  end if;
  raise notice 'B · cadena: importes distintos, fantasmas como deudor y acreedor, pares ajenos intactos, segunda salida sobre pares novados, netos identicos: OK';
end $b$;

-- ===== C · ciclo compensado ==================================================
do $c$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000121', r.g3, r.e3, array[r.e3, r.a3], 600);   if v not like 'OK %' then raise exception 'C0a: %', v; end if;
  v := pg_temp.gasto(r.edu, 'a5d00000-0000-4000-8000-000000000122', r.g3, r.l3, array[r.l3, r.e3], 600);   if v not like 'OK %' then raise exception 'C0b: %', v; end if;
  v := pg_temp.gasto(r.aitor, 'a5d00000-0000-4000-8000-000000000123', r.g3, r.a3, array[r.a3, r.l3], 600); if v not like 'OK %' then raise exception 'C0c: %', v; end if;
  raise notice 'C · antes: pares % · netos %', pg_temp.gp_pairs(r.g3), pg_temp.gp_positions(r.g3);
  if pg_temp.gp_pairs(r.g3) <> 'Aitor>Edu:300 Edu>Luis:300 Luis>Aitor:300' then raise exception 'C1: %', pg_temp.gp_pairs(r.g3); end if;
  if pg_temp.gp_positions(r.g3) <> 'Aitor:0 Edu:0 Luis:0' then raise exception 'C2: %', pg_temp.gp_positions(r.g3); end if;
  v := pg_temp.gp_leave(r.edu, 'a5d00000-0000-4000-8000-000000000124', r.g3);
  if v <> 'OK' then raise exception 'C3: %', v; end if;
  raise notice 'C · Edu fuera: pares % · novacion %', pg_temp.gp_pairs(r.g3), pg_temp.novacion(pg_temp.salida(r.g3, r.e3));
  if pg_temp.gp_pairs(r.g3) <> '-' then raise exception 'C4: %', pg_temp.gp_pairs(r.g3); end if;
  -- Aitor ya no tiene pares: sale sin novacion.
  v := pg_temp.gp_leave(r.aitor, 'a5d00000-0000-4000-8000-000000000125', r.g3);
  if v <> 'OK' then raise exception 'C5: %', v; end if;
  if pg_temp.salida(r.g3, r.a3) is not null then raise exception 'C6: novacion sin pares'; end if;
  raise notice 'C · el ciclo Aitor>Edu>Luis>Aitor se colapsa al salir Edu; Aitor sale sin pares y sin novacion: OK';
end $c$;

-- ===== D · despues de la salida ==============================================
do $d$
declare r fx%rowtype; v text; v_ops int;
begin
  select * into r from fx;
  -- D1 · la obligacion reasignada Aitor>Luis 300 (g2, novada dos veces) se paga
  --      como cualquier par: los pagos siguen acotados por los NETOS (v3), que la
  --      salida no cambio. Aitor (neto -50) paga 50 a Luis: par directo. Ana
  --      (neto -250) paga 250 a Luis: camino Ana>Aitor>Luis (C3) sobre el par
  --      novado. Pagar 300 de golpe como Aitor se rehusa como antes de la salida.
  v := pg_temp.gp_pay(r.aitor, 'a5d00000-0000-4000-8000-000000000130', r.g2, r.a2, r.l2, 300);
  if v not like 'PAYMENT_NOT_APPLICABLE%' then raise exception 'D0: %', v; end if;
  v := pg_temp.gp_pay(r.aitor, 'a5d00000-0000-4000-8000-000000000131', r.g2, r.a2, r.l2, 50);
  if v not like 'OK %' then raise exception 'D1: %', v; end if;
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Luis:250 Ana>Aitor:250 Gus>Luis:200' then raise exception 'D1a: %', pg_temp.gp_pairs(r.g2); end if;
  v := pg_temp.gp_pay(r.ana, 'a5d00000-0000-4000-8000-000000000139', r.g2, r.an2, r.l2, 250);
  if v not like 'OK %' then raise exception 'D1c: %', v; end if;
  update fx set pay2 = substr(v, 4)::uuid; select * into r from fx;
  raise notice 'D1 · Aitor paga 50 y Ana 250 a Luis sobre lo reasignado: pares % · reparto del pago de Ana: %', pg_temp.gp_pairs(r.g2), pg_temp.gp_allocation(r.ana, r.pay2);
  if pg_temp.gp_pairs(r.g2) <> 'Gus>Luis:200' then raise exception 'D1b: %', pg_temp.gp_pairs(r.g2); end if;
  if pg_temp.gp_allocation(r.ana, r.pay2) <> 'settlement Aitor>Luis:250 settlement Ana>Aitor:250' then raise exception 'D1d: %', pg_temp.gp_allocation(r.ana, r.pay2); end if;
  -- D2 · con esa obligacion pagada: anular las novaciones o el gasto original que la sostenia, rehusado, sin escribir.
  select count(*) into v_ops from core.operation_version;
  v := pg_temp.gp_annul(r.aitor, 'a5d00000-0000-4000-8000-000000000132', r.nov2);
  raise notice 'D2 · anular la novacion de Edu (pagada): %', v;
  if v not in ('OPERATION_NOT_ANNULLABLE', 'DEPARTED_OBLIGATION_CHANGED', 'SETTLEMENT_EXCEEDS_DEBT') then raise exception 'D2a: %', v; end if;
  v := pg_temp.gp_annul(r.aitor, 'a5d00000-0000-4000-8000-000000000133', r.nov3);
  if v not in ('OPERATION_NOT_ANNULLABLE', 'DEPARTED_OBLIGATION_CHANGED', 'SETTLEMENT_EXCEEDS_DEBT') then raise exception 'D2b: %', v; end if;
  -- El gasto que pago Edu lleva SU caja: solo Edu lo anularia (regla vigente,
  -- ADR-039), y Edu ya no es miembro. El que pago Luis (sin caja) lo puede
  -- intentar Aitor, y es ADR-039 quien lo rehusa: nombra a quien salio.
  v := pg_temp.gp_annul(r.aitor, 'a5d00000-0000-4000-8000-000000000134', r.x1);
  raise notice 'D2 · anular el gasto original Edu→Aitor 600 (caja de Edu, Edu fuera): %', v;
  if v <> 'NOT_AUTHORIZED' then raise exception 'D2c: %', v; end if;
  v := pg_temp.gp_annul(r.aitor, 'a5d00000-0000-4000-8000-00000000013a', r.x2);
  raise notice 'D2 · anular el gasto original Luis→Edu 200 (sin caja, Edu fuera): %', v;
  if v not in ('DEPARTED_OBLIGATION_CHANGED', 'SETTLEMENT_EXCEEDS_DEBT') then raise exception 'D2f: %', v; end if;
  v := pg_temp.gasto(r.aitor, 'a5d00000-0000-4000-8000-000000000135', r.g2, r.l2, array[r.l2, r.e2], 300, 'Gasto', r.x2);
  raise notice 'D2 · corregir su importe 200 → 300: %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'D2d: %', v; end if;
  if (select count(*) from core.operation_version) <> v_ops then raise exception 'D2e: algo rehusado escribio una version'; end if;
  -- D3 · solo el concepto (la obligacion de Edu intacta): permitido, y los pares no cambian.
  v := pg_temp.gasto(r.aitor, 'a5d00000-0000-4000-8000-000000000136', r.g2, r.l2, array[r.l2, r.e2], 200, 'Taxi de Luis', r.x2);
  if v not like 'OK %' then raise exception 'D3: %', v; end if;
  if pg_temp.gp_pairs(r.g2) <> 'Gus>Luis:200' then raise exception 'D3b: %', pg_temp.gp_pairs(r.g2); end if;
  -- D4 · C4: anular el pago de Ana reabre lo que cerro (su par y el novado), como cualquier par.
  v := pg_temp.gp_annul(r.ana, 'a5d00000-0000-4000-8000-000000000137', r.pay2);
  if v <> 'OK' then raise exception 'D4: %', v; end if;
  raise notice 'D4 · pago de Ana anulado: pares %', pg_temp.gp_pairs(r.g2);
  if pg_temp.gp_pairs(r.g2) <> 'Aitor>Luis:250 Ana>Aitor:250 Gus>Luis:200' then raise exception 'D4b: %', pg_temp.gp_pairs(r.g2); end if;
  -- D5 · anular una novacion sigue rehusado sin escribir. Con pagos que se
  --      apoyan en ella, por sobreliquidacion; sin ninguno (la de g1), por
  --      ADR-039: sus efectos nombran a quien salio. La guarda de clase en
  --      sec.persist_version queda detras de las dos, como respaldo.
  select count(*) into v_ops from core.operation_version;
  v := pg_temp.gp_annul(r.aitor, 'a5d00000-0000-4000-8000-000000000138', r.nov2);
  raise notice 'D5 · anular la novacion de Edu en g2 (pago de Aitor vigente): %', v;
  if v not in ('OPERATION_NOT_ANNULLABLE', 'DEPARTED_OBLIGATION_CHANGED', 'SETTLEMENT_EXCEEDS_DEBT') then raise exception 'D5a: %', v; end if;
  v := pg_temp.gp_annul(r.aitor, 'a5d00000-0000-4000-8000-00000000013b', r.nov1);
  raise notice 'D5 · anular la novacion de Edu en g1 (sin pagos): %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'D5c: %', v; end if;
  if (select count(*) from core.operation_version) <> v_ops then raise exception 'D5b: escribio'; end if;
  raise notice 'D · pagar lo reasignado, C4 al anular ese pago, ADR-039 sobre los originales, novaciones no anulables, concepto corregible: OK';
end $d$;

-- ===== E · C6 ================================================================
do $e$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  if pg_temp.gp_reopened_debt(r.edu) <> 0 or pg_temp.gp_reopened_debt(r.bea) <> 0 then
    raise exception 'E0: la novacion entro en my_reopened_debt: Edu % Bea %', pg_temp.gp_reopened_debt(r.edu), pg_temp.gp_reopened_debt(r.bea);
  end if;
  -- El pago de 100 que Edu hizo a Luis antes de salir (g1) se anula: reabre Edu>Luis 100 y solo eso.
  v := pg_temp.gp_annul(r.edu, 'a5d00000-0000-4000-8000-000000000141', r.pay1);
  if v <> 'OK' then raise exception 'E1: %', v; end if;
  raise notice 'E · pago de Edu anulado tras salir: pares % · reabierta de Edu %', pg_temp.gp_pairs(r.g1), pg_temp.gp_reopened_debt(r.edu);
  if pg_temp.gp_pairs(r.g1) <> 'Aitor>Luis:300 Edu>Luis:100' then raise exception 'E2: %', pg_temp.gp_pairs(r.g1); end if;
  if pg_temp.gp_reopened_debt(r.edu) <> -100 then raise exception 'E3: %', pg_temp.gp_reopened_debt(r.edu); end if;
  raise notice 'E · C6: la novacion no reabre nada; un pago anulado del que salio reabre su par y solo el: OK';
end $e$;

rollback;
