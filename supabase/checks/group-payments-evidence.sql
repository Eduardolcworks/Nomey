-- ============================================================================
-- PAGOS REGISTRADOS EN EL GRUPO (ADR-038): EVIDENCIA CONTRA LAS FUNCIONES REALES
-- ============================================================================
--
-- api.record_group_payment, api.annul_operation, api.leave_group,
-- api.claimed_dimension, api.personal_operation y sec.decompose_payment de
-- la migracion 20260912170000, llamadas como cada cuenta. Las ayudas de
-- supabase/checks/lib/group-payment-helpers.sql solo leen con nombres y
-- envuelven las llamadas. Todo en una transaccion que termina en rollback.
-- psql corre dentro del contenedor y no ve el checkout, asi que las ayudas
-- viajan delante por la misma entrada (como los vectores):
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/group-payments-evidence.sql; } | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · fixture: cuatro cuentas, deudas cruzadas; la propuesta
--   B · pago simplificado por caminos (Ana registra como receptora): ambos
--       Personales, sin gasto nuevo; doble confirmacion → STALE; replay
--   C · salir con pares: bloqueado; pago → salida → anulacion por quien salio;
--       la deuda reabierta visible en su Personal, acotada a lo que el pago
--       habia cerrado; una correccion ajena que le tocara ya no es posible (ADR-039)
--   D · un pago no se edita: la correccion se rehusa; tras salir no hay alta
--   E · novacion → otro pago apoyado en ella → anulacion del primero
--       (la guarda actual bloquea; con el par invertido admitido, coherente)
--   F · ambos fuera: lectura desde Personal y anulacion
--   G · terceros: miembro ajeno y no miembro no registran ni anulan
--   H · reintentos: misma clave; anular lo anulado
--   I · un retirado (ADR-036) en el camino de un pago anterior no bloquea
--       su anulacion: el retirado queda en equilibrio y el par se enruta
--   J · lecturas: api.group_payment para miembros, api.my_group_payment para
--       las partes sin membresia, Movimientos recientes con la contraparte,
--       avisos payment/payment_annulled al otro aunque haya salido
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3b00000-0000-4000-8000-0000000000a1'::uuid as ana,   'a3b00000-0000-4000-8000-0000000000f1'::uuid as s_ana,
  'a3b00000-0000-4000-8000-0000000000b1'::uuid as bea,   'a3b00000-0000-4000-8000-0000000000f2'::uuid as s_bea,
  'a3b00000-0000-4000-8000-0000000000c1'::uuid as carlos,'a3b00000-0000-4000-8000-0000000000f3'::uuid as s_carlos,
  'a3b00000-0000-4000-8000-0000000000d1'::uuid as dani,  'a3b00000-0000-4000-8000-0000000000f4'::uuid as s_dani,
  'a3b00000-0000-4000-8000-0000000000e1'::uuid as zoe,   'a3b00000-0000-4000-8000-0000000000f5'::uuid as s_zoe,
  'a3b00000-0000-4000-8000-000000000010'::uuid as g,
  'a3b00000-0000-4000-8000-000000000031'::uuid as p_ana, 'a3b00000-0000-4000-8000-000000000032'::uuid as p_bea,
  'a3b00000-0000-4000-8000-000000000033'::uuid as p_carlos, 'a3b00000-0000-4000-8000-000000000034'::uuid as p_dani,
  null::uuid as cat, null::uuid as pay1, null::uuid as pay2;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$ select set_config('role', 'postgres', true); $$;
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated;
grant select, update on fx to authenticated;

create function pg_temp.gasto(p_who uuid, p_key uuid, p_total text, p_payer uuid, p_parts uuid[], p_concept text) returns void language plpgsql as $$
declare r fx%rowtype;
begin
  select * into r from fx;
  perform pg_temp.actor(p_who);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1, 'scope_id', r.g, 'currency_definition_id', r.eur,
    'total', p_total, 'effective_date', (current_date - 1)::text, 'concept', p_concept, 'category_id', r.cat,
    'payer_participant_id', p_payer, 'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.super();
end $$;
grant execute on function pg_temp.gasto(uuid, uuid, text, uuid, uuid[], text) to authenticated;

-- ============================ A · fixture ===================================
do $a$
declare r fx%rowtype; v_out jsonb; v text;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_ana, 'personal', r.eur, r.ana), (r.s_bea, 'personal', r.eur, r.bea), (r.s_carlos, 'personal', r.eur, r.carlos),
    (r.s_dani, 'personal', r.eur, r.dani), (r.s_zoe, 'personal', r.eur, r.zoe);
  insert into core.membership (scope_id, user_id) values
    (r.s_ana, r.ana), (r.s_bea, r.bea), (r.s_carlos, r.carlos), (r.s_dani, r.dani), (r.s_zoe, r.zoe);
  perform pg_temp.actor(r.ana);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3b00000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Sierra', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_ana, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', r.p_bea, 'display_name', 'Bea'),
      jsonb_build_object('client_participant_id', r.p_carlos, 'display_name', 'Carlos'),
      jsonb_build_object('client_participant_id', r.p_dani, 'display_name', 'Dani'))));
  perform pg_temp.super();
  -- Bea, Carlos y Dani con cuenta (como si hubieran reclamado).
  insert into core.membership (scope_id, user_id) values (r.g, r.bea), (r.g, r.carlos), (r.g, r.dani);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values
    (r.p_bea, r.g, r.bea), (r.p_carlos, r.g, r.carlos), (r.p_dani, r.g, r.dani);
  -- Presencias desde hace diez dias: los gastos se fechan AYER, para que quien sale HOY siga siendo elegible en ellos.
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;
  -- G1 Ana 60 Ana/Bea · G2 Bea 60 Bea/Carlos · G3 Ana 20 Ana/Carlos · G4 Bea 10 Ana/Bea
  perform pg_temp.gasto(r.ana, 'a3b00000-0000-4000-8000-000000000041', '6000', r.p_ana, array[r.p_ana, r.p_bea], 'G1');
  perform pg_temp.gasto(r.bea, 'a3b00000-0000-4000-8000-000000000042', '6000', r.p_bea, array[r.p_bea, r.p_carlos], 'G2');
  perform pg_temp.gasto(r.ana, 'a3b00000-0000-4000-8000-000000000043', '2000', r.p_ana, array[r.p_ana, r.p_carlos], 'G3');
  perform pg_temp.gasto(r.bea, 'a3b00000-0000-4000-8000-000000000044', '1000', r.p_bea, array[r.p_ana, r.p_bea], 'G4');
  v := pg_temp.gp_pairs(r.g);
  raise notice 'A · pares neteados: % · netos: %', v, pg_temp.gp_positions(r.g);
  if v <> 'Bea>Ana:2500 Carlos>Ana:1000 Carlos>Bea:3000' then raise exception 'A1: %', v; end if;
  if pg_temp.gp_positions(r.g) <> 'Ana:3500 Bea:500 Carlos:-4000 Dani:0' then raise exception 'A2: %', pg_temp.gp_positions(r.g); end if;
  raise notice 'A · Personal Ana %', pg_temp.gp_personal(r.ana);
  raise notice 'A · Personal Carlos %', pg_temp.gp_personal(r.carlos);
  raise notice 'A · fixture: deudas cruzadas Ana↔Bea neteadas; propuesta minima: Carlos→Ana 3500 y Carlos→Bea 500';
end $a$;

-- ===== B · pago por caminos; ambos Personales; doble confirmacion; replay ===
do $b$
declare r fx%rowtype; v text; v_pos jsonb; v_dec text; v_op uuid; v_ver uuid; v_n int;
begin
  select * into r from fx;
  v_pos := pg_temp.gp_expected(r.g);
  v_dec := pg_temp.gp_decompose_text(r.g, r.p_carlos, r.p_ana, 3500);
  raise notice 'B · descomposicion de Carlos→Ana 3500: %', v_dec;
  if v_dec <> 'settlement Bea>Ana:2500 settlement Carlos>Ana:1000 settlement Carlos>Bea:2500' then raise exception 'B0: %', v_dec; end if;
  -- Ana (receptora) registra; Carlos intenta despues con la MISMA foto de netos.
  v := pg_temp.gp_pay(r.ana, 'a3b00000-0000-4000-8000-000000000051', r.g, r.p_carlos, r.p_ana, 3500, v_pos);
  if v not like 'OK %' then raise exception 'B1: %', v; end if;
  update fx set pay1 = substr(v, 4)::uuid;
  v := pg_temp.gp_pay(r.carlos, 'a3b00000-0000-4000-8000-000000000052', r.g, r.p_carlos, r.p_ana, 3500, v_pos);
  if v not like 'SETTLEMENT_STALE %' then raise exception 'B2: la segunda confirmacion (otra cuenta, otra clave) no caduco: %', v; end if;
  raise notice 'B · segunda confirmacion por Carlos con la foto anterior: %', left(v, 60);
  v := pg_temp.gp_pay(r.ana, 'a3b00000-0000-4000-8000-000000000051', r.g, r.p_carlos, r.p_ana, 3500, v_pos);
  if v <> 'REPLAY ' || (select pay1 from fx) then raise exception 'B3: el reintento con la misma clave no fue replay: %', v; end if;
  select count(*) into v_n from core.operation o where o.operation_class = 'group_payment'
     and exists (select 1 from core.payment_detail pd join core.operation_version ov on ov.id = pd.operation_version_id where ov.operation_id = o.id and pd.scope_id = r.g);
  if v_n <> 1 then raise exception 'B4: % pagos, y debia haber uno', v_n; end if;
  -- Un pago NO se edita: una correccion directa por API se rehusa.
  select current_version_id into v_ver from core.operation where id = (select pay1 from fx);
  v := pg_temp.gp_pay(r.ana, 'a3b00000-0000-4000-8000-00000000005d', r.g, r.p_carlos, r.p_ana, 3000, v_pos, (select pay1 from fx), v_ver);
  if v <> 'PAYMENT_NOT_EDITABLE' then raise exception 'B4b: la correccion no se rehuso: %', v; end if;
  -- Lo que el pago cerro, persistido con su version y publicado a los
  -- miembros en el orden calculado: igual a la descomposicion y a sus efectos.
  v := pg_temp.gp_allocation(r.bea, (select pay1 from fx));
  raise notice 'B · obligaciones cerradas por el pago (api.group_payment_allocation): %', v;
  if v <> 'settlement Bea>Ana:2500 settlement Carlos>Ana:1000 settlement Carlos>Bea:2500' then raise exception 'B4c: %', v; end if;
  select count(*) into v_n from core.payment_allocation pa join core.effect e on e.operation_version_id = pa.operation_version_id
     and e.debt_debtor_participant_id = pa.debtor_participant_id and e.debt_creditor_participant_id = pa.creditor_participant_id
     and e.debt_amount = case pa.kind when 'novation' then pa.amount else - pa.amount end
   where pa.operation_version_id = v_ver;
  if v_n <> 3 then raise exception 'B4d: % filas de payment_allocation casan con sus efectos, y son 3', v_n; end if;
  raise notice 'B · pares: % · netos: %', pg_temp.gp_pairs(r.g), pg_temp.gp_positions(r.g);
  if pg_temp.gp_pairs(r.g) <> 'Carlos>Bea:500' then raise exception 'B5: %', pg_temp.gp_pairs(r.g); end if;
  if pg_temp.gp_positions(r.g) <> 'Ana:0 Bea:500 Carlos:-500 Dani:0' then raise exception 'B6: %', pg_temp.gp_positions(r.g); end if;
  -- Ambos Personales: caja ±3500, ni gasto ni ingreso nuevo; Bea sin caja.
  v := pg_temp.gp_personal(r.ana);   raise notice 'B · Personal Ana %', v;
  if v not like 'caja=-4500 gasto=4500 deuda=0 movs_pago=1%' then raise exception 'B7 Ana: %', v; end if;
  v := pg_temp.gp_personal(r.carlos); raise notice 'B · Personal Carlos %', v;
  if v not like 'caja=-3500 gasto=4000 deuda=-500 movs_pago=1%' then raise exception 'B8 Carlos: %', v; end if;
  v := pg_temp.gp_personal(r.bea);   raise notice 'B · Personal Bea %', v;
  if v not like 'caja=-7000 gasto=6500 deuda=500 movs_pago=0%' then raise exception 'B9 Bea: %', v; end if;
  raise notice 'B · pago simplificado por caminos: netos de los demas intactos, caja exacta en dos Personales, sin consumo nuevo; doble confirmacion caduca; replay: OK';
end $b$;

-- ===== C · pago → salida → anulacion por quien salio ========================
do $c$
declare r fx%rowtype; v text; v_pos jsonb; v_op uuid; v_ver uuid; v_n int;
begin
  select * into r from fx;
  -- Con Carlos>Bea 500 pendiente, ni Bea (cobra) ni Carlos (debe) pueden salir: LEAVE_BLOCKED_DEBT con los pares.
  v := pg_temp.gp_leave(r.bea, 'a3b00000-0000-4000-8000-000000000060'::uuid, r.g);
  raise notice 'C · Bea intenta salir con un par pendiente: %', left(v, 90);
  if v not like 'LEAVE_BLOCKED_DEBT %' or v not like '%"pairs"%' then raise exception 'C1: %', v; end if;
  v := pg_temp.gp_leave(r.carlos, 'a3b00000-0000-4000-8000-00000000006a'::uuid, r.g);
  if v not like 'LEAVE_BLOCKED_DEBT %' then raise exception 'C1a: %', v; end if;
  -- Carlos paga los 500 a Bea (par directo); ahora puede salir: cero pares.
  v_pos := pg_temp.gp_expected(r.g);
  v := pg_temp.gp_pay(r.carlos, 'a3b00000-0000-4000-8000-000000000053', r.g, r.p_carlos, r.p_bea, 500, v_pos);
  if v not like 'OK %' then raise exception 'C0: %', v; end if;
  update fx set pay2 = substr(v, 4)::uuid;
  v := pg_temp.gp_leave(r.carlos, 'a3b00000-0000-4000-8000-000000000061'::uuid, r.g);
  if v <> 'OK' then raise exception 'C1b: %', v; end if;
  if exists (select 1 from core.membership where scope_id = r.g and user_id = r.carlos) then raise exception 'C2: Carlos sigue siendo miembro'; end if;
  -- Carlos, ya fuera, anula el pago de 3500 (Ana lo registro; Carlos es el pagador).
  v := pg_temp.gp_annul(r.carlos, 'a3b00000-0000-4000-8000-000000000071', r.pay1);
  if v <> 'OK' then raise exception 'C3: %', v; end if;
  raise notice 'C · tras anular: pares % · netos %', pg_temp.gp_pairs(r.g), pg_temp.gp_positions(r.g);
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:2500 Carlos>Ana:1000 Carlos>Bea:2500' then raise exception 'C4: %', pg_temp.gp_pairs(r.g); end if;
  if pg_temp.gp_positions(r.g) <> 'Ana:3500 Bea:0 Carlos:-3500 Dani:0' then raise exception 'C5: %', pg_temp.gp_positions(r.g); end if;
  perform pg_temp.super();
  if exists (select 1 from core.membership where scope_id = r.g and user_id = r.carlos) then raise exception 'C6: la anulacion readmitio a Carlos'; end if;
  v := pg_temp.gp_personal(r.carlos); raise notice 'C · Personal Carlos (fuera) %', v;
  -- Caja: solo queda el pago de 500; la deuda reabierta (3500: Carlos>Ana 1000 + Carlos>Bea 2500, lo que el pago
  -- habia cerrado y le nombra) le llega a Personal SOLO por la excepcion C6 (ya no es miembro). Bea>Ana no es suya y no se ve.
  if v not like 'caja=-500 gasto=4000 deuda=-3500 movs_pago=1 deuda_reabierta=-3500' then raise exception 'C7: %', v; end if;
  -- ADR-039: Ana ya no puede corregir G3 (20 → 40 Ana/Carlos) con Carlos fuera: cambiaria su cuota y su deuda.
  select o.id, o.current_version_id into v_op, v_ver from core.operation o join core.operation_version ov on ov.id = o.current_version_id
    join core.movement_detail d on d.operation_version_id = ov.id where d.concept = 'G3';
  perform pg_temp.actor(r.ana);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3b00000-0000-4000-8000-00000000004a'::uuid, 'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_ver,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '4000',
      'effective_date', (current_date - 1)::text, 'concept', 'G3', 'category_id', r.cat,
      'payer_participant_id', r.p_ana, 'participants', jsonb_build_array(r.p_ana, r.p_carlos),
      'split_method', jsonb_build_object('kind', 'equal')));
    raise exception 'C7b: la correccion que cambia la obligacion de Carlos (fuera) no se rehuso';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'DEPARTED_OBLIGATION_CHANGED' then raise; end if;
  end;
  perform pg_temp.super();
  if (select current_version_id from core.operation where id = v_op) <> v_ver then raise exception 'C7c: quedo una version'; end if;
  raise notice 'C · corregir G3 con Carlos fuera: DEPARTED_OBLIGATION_CHANGED (ADR-039); pares %', pg_temp.gp_pairs(r.g);
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:2500 Carlos>Ana:1000 Carlos>Bea:2500' then raise exception 'C7d: %', pg_temp.gp_pairs(r.g); end if;
  -- Y un pago VIGENTE no reabre nada: el de 500 (pay2) sigue vigente y no cuenta.
  v := pg_temp.gp_personal(r.ana); raise notice 'C · Personal Ana %', v;
  if v not like 'caja=-8000 gasto=4500 deuda=3500 %' then raise exception 'C8: %', v; end if;
  -- Autoria y momento: la version anulada la firmo Ana; la anulacion, Carlos.
  select count(*) into v_n from core.operation_version ov where ov.operation_id = r.pay1;
  if v_n <> 2 then raise exception 'C9: versiones %', v_n; end if;
  if (select created_by from core.operation_version where operation_id = r.pay1 and version_no = 1) <> r.ana
     or (select created_by from core.operation_version where operation_id = r.pay1 and version_no = 2) <> r.carlos then
    raise exception 'C10: autoria';
  end if;
  raise notice 'C · quien salio anula su pago: deuda reabierta en el grupo y visible en su Personal SOLO en lo que el pago cerro; sin readmision; autoria conservada: OK';
end $c$;

-- ===== D · un pago no se edita; tras salir no hay alta nueva ================
do $d$
declare r fx%rowtype; v text; v_pos jsonb; v_ver uuid;
begin
  select * into r from fx;
  -- Con Carlos fuera, un alta que le nombre solo entra por la excepcion de
  -- 20260913120000: Ana (activa, receptora) salda EXACTAMENTE el par que la
  -- anulacion de Carlos reabrio (Carlos>Ana:1000); ni mas, ni Carlos desde fuera.
  v_pos := pg_temp.gp_expected(r.g);
  v := pg_temp.gp_pay(r.ana, 'a3b00000-0000-4000-8000-00000000005e', r.g, r.p_carlos, r.p_ana, 1500, v_pos);
  if v not like 'PAYMENT_NOT_APPLICABLE%' then raise exception 'D0: mas que lo reabierto: %', v; end if;
  v := pg_temp.gp_pay(r.carlos, 'a3b00000-0000-4000-8000-00000000005f', r.g, r.p_carlos, r.p_ana, 1000, v_pos);
  if v not like 'NOT_AUTHORIZED%' then raise exception 'D0b: el salido registro desde fuera: %', v; end if;
  v := pg_temp.gp_pay(r.ana, 'a3b00000-0000-4000-8000-000000000054', r.g, r.p_carlos, r.p_ana, 1000, v_pos);
  if v not like 'OK %' then raise exception 'D0c: la parte activa no pudo saldar el par reabierto: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:2500 Carlos>Bea:2500' then raise exception 'D0d: %', pg_temp.gp_pairs(r.g); end if;
  -- Y se deshace (Ana anula su pago) para que el resto de la seccion vea el mismo estado.
  v := pg_temp.gp_annul(r.ana, 'a3b00000-0000-4000-8000-000000000060', substr(v, 4)::uuid);
  if v <> 'OK' then raise exception 'D0e: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:2500 Carlos>Ana:1000 Carlos>Bea:2500' then raise exception 'D0f: %', pg_temp.gp_pairs(r.g); end if;
  -- Carlos (fuera) intenta corregir el pago vigente de 500 (Carlos→Bea): un pago no se edita.
  select current_version_id into v_ver from core.operation where id = r.pay2;
  v := pg_temp.gp_pay(r.carlos, 'a3b00000-0000-4000-8000-000000000055', r.g, r.p_carlos, r.p_bea, 300, v_pos, r.pay2, v_ver);
  if v <> 'PAYMENT_NOT_EDITABLE' then raise exception 'D1: %', v; end if;
  if (select count(*) from core.operation_version where operation_id = r.pay2) <> 1 then raise exception 'D2: se escribio una version'; end if;
  raise notice 'D · sin edicion: la correccion por API se rehusa y no escribe; un alta con quien salio se rehusa (se anula y se registra otro solo con ambos activos): OK';
end $d$;

-- ===== E · novacion → otro pago apoyado en ella → revision del primero =====
create temp table fy as select
  'a3b00000-0000-4000-8000-000000000011'::uuid as g2,
  'a3b00000-0000-4000-8000-000000000035'::uuid as q_ana, 'a3b00000-0000-4000-8000-000000000036'::uuid as q_bea,
  'a3b00000-0000-4000-8000-000000000037'::uuid as q_carlos, 'a3b00000-0000-4000-8000-000000000038'::uuid as q_dani,
  null::uuid as p1, null::uuid as p2;
grant select, update on fy to authenticated;
do $e$
declare r fx%rowtype; y fy%rowtype; v text; v_pos jsonb; v_dec text; v_ver uuid;
begin
  select * into r from fx; select * into y from fy;
  perform pg_temp.actor(r.ana);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a3b00000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1,
    'client_group_id', y.g2, 'display_name', 'Novacion', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', y.q_ana, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', y.q_bea, 'display_name', 'Bea'),
      jsonb_build_object('client_participant_id', y.q_carlos, 'display_name', 'Carlos'),
      jsonb_build_object('client_participant_id', y.q_dani, 'display_name', 'Dani'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (y.g2, r.bea), (y.g2, r.carlos), (y.g2, r.dani);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values
    (y.q_bea, y.g2, r.bea), (y.q_carlos, y.g2, r.carlos), (y.q_dani, y.g2, r.dani);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = y.g2;
  update fx set g = y.g2; select * into r from fx;
  -- Bea paga 20 Ana/Bea → Ana>Bea 1000 · Carlos paga 20 Carlos/Dani → Dani>Carlos 1000
  perform pg_temp.gasto(r.bea, 'a3b00000-0000-4000-8000-000000000045', '2000', y.q_bea, array[y.q_ana, y.q_bea], 'H1');
  perform pg_temp.gasto(r.carlos, 'a3b00000-0000-4000-8000-000000000046', '2000', y.q_carlos, array[y.q_carlos, y.q_dani], 'H2');
  raise notice 'E · pares % · netos %', pg_temp.gp_pairs(y.g2), pg_temp.gp_positions(y.g2);
  v_dec := pg_temp.gp_decompose_text(y.g2, y.q_ana, y.q_carlos, 1000);
  raise notice 'E · descomposicion de Ana→Carlos 1000 (sin camino): %', v_dec;
  if v_dec <> 'novation Dani>Bea:1000 settlement Ana>Bea:1000 settlement Dani>Carlos:1000' then raise exception 'E0: %', v_dec; end if;
  v_pos := pg_temp.gp_expected(y.g2);
  v := pg_temp.gp_pay(r.ana, 'a3b00000-0000-4000-8000-000000000057', y.g2, y.q_ana, y.q_carlos, 1000, v_pos);
  if v not like 'OK %' then raise exception 'E1: %', v; end if;
  update fy set p1 = substr(v, 4)::uuid;
  raise notice 'E · tras P1: pares % · netos %', pg_temp.gp_pairs(y.g2), pg_temp.gp_positions(y.g2);
  if pg_temp.gp_pairs(y.g2) <> 'Dani>Bea:1000' or pg_temp.gp_positions(y.g2) <> 'Ana:0 Bea:1000 Carlos:0 Dani:-1000' then raise exception 'E2'; end if;
  -- P2: Dani paga a Bea la deuda NOVADA (par directo).
  v_pos := pg_temp.gp_expected(y.g2);
  v := pg_temp.gp_pay(r.dani, 'a3b00000-0000-4000-8000-000000000058', y.g2, y.q_dani, y.q_bea, 1000, v_pos);
  if v not like 'OK %' then raise exception 'E3: %', v; end if;
  update fy set p2 = substr(v, 4)::uuid; select * into y from fy;
  if pg_temp.gp_pairs(y.g2) <> '-' then raise exception 'E4: %', pg_temp.gp_pairs(y.g2); end if;
  -- La guarda de sobreliquidacion de los GASTOS habria bloqueado esto (Dani>Bea: 1000 liquidados, neto -1000 sin P1);
  -- para group_payment no se aplica (ADR-038 C4): se anula P1 sin tocar P2.
  select current_version_id into v_ver from core.operation where id = y.p1;
  begin
    perform sec.assert_annulment_leaves_no_oversettled_debt(v_ver);
    raise exception 'E5: la guarda de gastos no habria bloqueado';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'SETTLEMENT_EXCEEDS_DEBT' then raise; end if;
  end;
  v := pg_temp.gp_annul(r.ana, 'a3b00000-0000-4000-8000-000000000072', y.p1);
  if v <> 'OK' then raise exception 'E6: %', v; end if;
  raise notice 'E · tras anular P1 con P2 intacto: pares % · netos %', pg_temp.gp_pairs(y.g2), pg_temp.gp_positions(y.g2);
  -- Dani pago 1000 a Bea sin deberselos: Bea le debe 1000 a Dani (par invertido); Ana sigue debiendo a Bea; Dani a Carlos.
  if pg_temp.gp_pairs(y.g2) <> 'Ana>Bea:1000 Bea>Dani:1000 Dani>Carlos:1000' then raise exception 'E7: %', pg_temp.gp_pairs(y.g2); end if;
  if pg_temp.gp_positions(y.g2) <> 'Ana:-1000 Bea:0 Carlos:1000 Dani:0' then raise exception 'E8: %', pg_temp.gp_positions(y.g2); end if;
  -- P2 no se toco: sigue con su version 1 y sus efectos.
  if (select current_version_id from core.operation where id = y.p2) <> (select id from core.operation_version where operation_id = y.p2 and version_no = 1) then
    raise exception 'E9: P2 fue reescrito';
  end if;
  -- Y la propuesta vuelve a ser Ana→Carlos 1000 (o el par por caminos): Bea y Dani a cero.
  v_dec := pg_temp.gp_decompose_text(y.g2, y.q_ana, y.q_carlos, 1000);
  raise notice 'E · nueva descomposicion de Ana→Carlos 1000: %', v_dec;
  if v_dec <> 'settlement Ana>Bea:1000 settlement Bea>Dani:1000 settlement Dani>Carlos:1000' then raise exception 'E10: %', v_dec; end if;
  raise notice 'E · la guarda actual bloquea anular una novacion consumida; con el par invertido admitido, anular P1 deja a P2 intacto y Bea debe a Dani lo que cobro de mas, que cierra por caminos: OK';
end $e$;

-- ===== F · ambos fuera: lectura desde Personal y anulacion ==================
do $f$
declare r fx%rowtype; y fy%rowtype; v text; v_pos jsonb; v_op uuid; v_n int;
begin
  select * into r from fx; select * into y from fy;
  -- Ana paga a Carlos por caminos (1000): todos a cero; Ana y Carlos salen.
  v_pos := pg_temp.gp_expected(y.g2);
  v := pg_temp.gp_pay(r.carlos, 'a3b00000-0000-4000-8000-000000000059', y.g2, y.q_ana, y.q_carlos, 1000, v_pos);
  if v not like 'OK %' then raise exception 'F0: %', v; end if;
  v_op := substr(v, 4)::uuid;
  if pg_temp.gp_leave(r.ana, 'a3b00000-0000-4000-8000-000000000062'::uuid, y.g2) <> 'OK' then raise exception 'F1a'; end if;
  if pg_temp.gp_leave(r.carlos, 'a3b00000-0000-4000-8000-000000000063'::uuid, y.g2) <> 'OK' then raise exception 'F1b'; end if;
  -- Ninguno ve el grupo ya.
  perform pg_temp.actor(r.carlos);
  select count(*) into v_n from api.group_profile where scope_id = y.g2;
  if v_n <> 0 then raise exception 'F2: Carlos sigue viendo el grupo'; end if;
  -- api.my_group_payment: sus pagos, por vinculo, sin membresia.
  select count(*) into v_n from api.my_group_payment() where scope_id = y.g2;
  raise notice 'F · pagos de Carlos en api.my_group_payment (sin membresia): %', v_n;
  if v_n <> 2 then raise exception 'F3: %', v_n; end if;
  perform pg_temp.super();
  -- Carlos anula desde Personal, ambos fuera.
  v := pg_temp.gp_annul(r.carlos, 'a3b00000-0000-4000-8000-000000000073', v_op);
  if v <> 'OK' then raise exception 'F4: %', v; end if;
  raise notice 'F · tras anular con ambos fuera: pares % · netos %', pg_temp.gp_pairs(y.g2), pg_temp.gp_positions(y.g2);
  if pg_temp.gp_positions(y.g2) <> 'Ana:-1000 Bea:0 Carlos:1000 Dani:0' then raise exception 'F5: %', pg_temp.gp_positions(y.g2); end if;
  v := pg_temp.gp_personal(r.ana); raise notice 'F · Personal Ana (fuera) %', v;
  if v not like '%deuda=2500 %deuda_reabierta=-1000' then raise exception 'F6: %', v; end if;
  v := pg_temp.gp_personal(r.carlos); raise notice 'F · Personal Carlos (fuera) %', v;
  -- Carlos, fuera de los dos: Sierra (-3500, lo que su pago anulado cerro) y Novacion (+1000: Dani>Carlos, cerrado por el pago anulado).
  if v not like '%deuda=-2500 %deuda_reabierta=-2500' then raise exception 'F7: %', v; end if;
  -- Y Bea (miembro de los dos): la excepcion no le anade nada; su deuda de Sierra (2500 a Ana, 2500 de Carlos) sigue por membresia.
  v := pg_temp.gp_personal(r.bea); raise notice 'F · Personal Bea (miembro) %', v;
  if v not like '%deuda=0 %deuda_reabierta=0' then raise exception 'F8: %', v; end if;
  if exists (select 1 from core.membership where scope_id = y.g2 and user_id in (r.ana, r.carlos)) then raise exception 'F9: readmision'; end if;
  raise notice 'F · ambos fuera: el pago se lee por vinculo, se anula, la deuda reabierta llega a los dos Personales por la excepcion y a nadie mas; sin readmision: OK';
end $f$;

-- ===== G · terceros =========================================================
do $g$
declare r fx%rowtype; y fy%rowtype; v text; v_pos jsonb; v_op uuid;
begin
  select * into r from fx; select * into y from fy;
  -- Sierra: Dani (miembro, activo) no es parte de Bea→Ana 2500: no registra.
  v_pos := pg_temp.gp_expected('a3b00000-0000-4000-8000-000000000010'::uuid);
  v := pg_temp.gp_pay(r.dani, 'a3b00000-0000-4000-8000-00000000005a', 'a3b00000-0000-4000-8000-000000000010'::uuid, r.p_bea, r.p_ana, 2500, v_pos);
  if v <> 'NOT_AUTHORIZED' then raise exception 'G1: %', v; end if;
  -- Zoe, sin relacion con el grupo: tampoco (ni siquiera es miembro).
  v := pg_temp.gp_pay(r.zoe, 'a3b00000-0000-4000-8000-00000000005b', 'a3b00000-0000-4000-8000-000000000010'::uuid, r.p_bea, r.p_ana, 2500, v_pos);
  if v <> 'NOT_AUTHORIZED' then raise exception 'G2: %', v; end if;
  v_pos := pg_temp.gp_expected(y.g2);
  -- Un pago de Dani→Bea registrado por Dani; Bea (receptora) lo anula; Carlos (fuera, ajeno a ese pago) no puede.
  update fx set g = y.g2;
  v := pg_temp.gp_pay(r.dani, 'a3b00000-0000-4000-8000-00000000005c', y.g2, y.q_dani, y.q_bea, 100, v_pos);
  -- Dani no debe a Bea ahora (todos a cero salvo Ana/Carlos): no aplicable.
  if v <> 'PAYMENT_NOT_APPLICABLE' and v not like 'SETTLEMENT_STALE%' then raise exception 'G3: %', v; end if;
  raise notice 'G · pago sin deuda que lo sostenga: %', v;
  -- Sobre un pago existente (el de Carlos→Bea, grupo Sierra): Bea (receptora) puede anular; Dani (miembro ajeno) no.
  select * into r from fx; update fx set g = 'a3b00000-0000-4000-8000-000000000010'::uuid; select * into r from fx;
  v := pg_temp.gp_annul(r.dani, 'a3b00000-0000-4000-8000-000000000074', r.pay2);
  if v <> 'NOT_AUTHORIZED' then raise exception 'G4: %', v; end if;
  v := pg_temp.gp_annul(r.zoe, 'a3b00000-0000-4000-8000-000000000075', r.pay2);
  if v <> 'NOT_AUTHORIZED' then raise exception 'G5: %', v; end if;
  v := pg_temp.gp_annul(r.bea, 'a3b00000-0000-4000-8000-000000000076', r.pay2);
  if v <> 'OK' then raise exception 'G6: %', v; end if;
  raise notice 'G · terceros (miembro ajeno y no miembro) no registran ni anulan; la receptora si: OK';
end $g$;

-- ===== H · reintentos ========================================================
do $h$
declare r fx%rowtype; v text; v_n int;
begin
  select * into r from fx;
  -- Misma clave y misma intencion (la version que se anulo): replay.
  v := pg_temp.gp_annul(r.bea, 'a3b00000-0000-4000-8000-000000000076', r.pay2, (select id from core.operation_version where operation_id = r.pay2 and version_no = 1));
  if v <> 'REPLAY' then raise exception 'H1: %', v; end if;
  v := pg_temp.gp_annul(r.carlos, 'a3b00000-0000-4000-8000-000000000077', r.pay2);
  if v <> 'OPERATION_ANNULLED' then raise exception 'H2: anular lo anulado: %', v; end if;
  select count(*) into v_n from core.operation_version where operation_id = r.pay2;
  if v_n <> 2 then raise exception 'H3: versiones de pay2 = %', v_n; end if;
  raise notice 'H · reintento con la misma clave = replay; anular lo anulado = OPERATION_ANNULLED; historial: alta y anulacion, con sus autores: OK';
end $h$;

-- ===== I · un retirado en el camino de un pago anterior =====================
create temp table fz as select
  'a3b00000-0000-4000-8000-000000000012'::uuid as g3,
  'a3b00000-0000-4000-8000-000000000039'::uuid as z_ana, 'a3b00000-0000-4000-8000-00000000003a'::uuid as z_marta,
  'a3b00000-0000-4000-8000-00000000003b'::uuid as z_dani, null::uuid as p3;
grant select, update on fz to authenticated;
do $i$
declare r fx%rowtype; z fz%rowtype; v text; v_pos jsonb; v_ver uuid; v_dec text;
begin
  select * into r from fx; select * into z from fz;
  perform pg_temp.actor(r.ana);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a3b00000-0000-4000-8000-000000000022'::uuid, 'command_contract_version', 1,
    'client_group_id', z.g3, 'display_name', 'Retiro', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', z.z_ana, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', z.z_marta, 'display_name', 'Marta'),
      jsonb_build_object('client_participant_id', z.z_dani, 'display_name', 'Dani'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (z.g3, r.dani);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (z.z_dani, z.g3, r.dani);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = z.g3;
  update fx set g = z.g3; select * into r from fx;
  -- Ana paga 20 Ana/Marta → Marta>Ana 1000 · Marta (sin cuenta) paga 20 Marta/Dani → Dani>Marta 1000
  perform pg_temp.gasto(r.ana, 'a3b00000-0000-4000-8000-000000000047', '2000', z.z_ana, array[z.z_ana, z.z_marta], 'R1');
  perform pg_temp.gasto(r.ana, 'a3b00000-0000-4000-8000-000000000048', '2000', z.z_marta, array[z.z_marta, z.z_dani], 'R2');
  raise notice 'I · pares % · netos %', pg_temp.gp_pairs(z.g3), pg_temp.gp_positions(z.g3);
  v_dec := pg_temp.gp_decompose_text(z.g3, z.z_dani, z.z_ana, 1000);
  if v_dec <> 'settlement Dani>Marta:1000 settlement Marta>Ana:1000' then raise exception 'I0: %', v_dec; end if;
  -- Dani paga a Ana 1000 por el camino que pasa por Marta (sin cuenta: solo deuda).
  v_pos := pg_temp.gp_expected(z.g3);
  v := pg_temp.gp_pay(r.dani, 'a3b00000-0000-4000-8000-00000000005e', z.g3, z.z_dani, z.z_ana, 1000, v_pos);
  if v not like 'OK %' then raise exception 'I1: %', v; end if;
  update fz set p3 = substr(v, 4)::uuid; select * into z from fz;
  if pg_temp.gp_pairs(z.g3) <> '-' then raise exception 'I2: %', pg_temp.gp_pairs(z.g3); end if;
  -- Marta, a cero, se RETIRA (ADR-036, funcion real, sin pares).
  perform pg_temp.actor(r.ana);
  perform api.retire_participant(jsonb_build_object('client_operation_id', 'a3b00000-0000-4000-8000-000000000081'::uuid,
    'command_contract_version', 1, 'scope_id', z.g3, 'participant_id', z.z_marta, 'expected_pairs', '[]'::jsonb));
  perform pg_temp.super();
  if not exists (select 1 from core.participant_retirement where participant_id = z.z_marta) then raise exception 'I3: Marta no quedo retirada'; end if;
  -- La guarda de retirados de los GASTOS habria bloqueado esto; para group_payment rige la de neto cero (C4).
  select current_version_id into v_ver from core.operation where id = z.p3;
  begin
    perform sec.assert_no_retired_debt(v_ver);
    raise exception 'I4: la guarda de gastos no habria bloqueado';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'PARTICIPANT_RETIRED' then raise; end if;
  end;
  v := pg_temp.gp_annul(r.dani, 'a3b00000-0000-4000-8000-000000000078', z.p3);
  if v <> 'OK' then raise exception 'I5: %', v; end if;
  raise notice 'I · tras anular: pares % · netos %', pg_temp.gp_pairs(z.g3), pg_temp.gp_positions(z.g3);
  if pg_temp.gp_positions(z.g3) <> 'Ana:1000 Dani:-1000 Marta:0' then raise exception 'I6: %', pg_temp.gp_positions(z.g3); end if;
  -- Marta sigue en cero; la propuesta vuelve a ser Dani→Ana y se enruta por Marta sin escribir nada nuevo con ella.
  v_dec := pg_temp.gp_decompose_text(z.g3, z.z_dani, z.z_ana, 1000);
  if v_dec <> 'settlement Dani>Marta:1000 settlement Marta>Ana:1000' then raise exception 'I7: %', v_dec; end if;
  v := pg_temp.gp_leave(r.dani, 'a3b00000-0000-4000-8000-000000000065'::uuid, z.g3);
  if v not like 'LEAVE_BLOCKED_DEBT %' then raise exception 'I8: Dani podria salir debiendo: %', v; end if;
  -- Y lo que SI sigue bloqueando: un pago cuyo retirado quedara con neto distinto de cero no existe por construccion;
  -- una anulacion de GASTO que altere la deuda de Marta la sigue rehusando la guarda existente.
  raise notice 'I · un retirado en el camino de un pago no bloquea anularlo: queda en equilibrio y el pago siguiente lo atraviesa: OK';
end $i$;

-- ===== J · lecturas y avisos ================================================
do $j$
declare r fx%rowtype; z fz%rowtype; v text; v_n int; v_op uuid; v_pos jsonb;
begin
  select * into r from fx; select * into z from fz;
  -- Sierra: Bea (miembro) ve los pagos del grupo con sus partes; Carlos (fuera) no ve api.group_payment pero si api.my_group_payment.
  perform pg_temp.actor(r.bea);
  select count(*) into v_n from api.group_payment where scope_id = 'a3b00000-0000-4000-8000-000000000010'::uuid;
  -- Tres: los dos de B/C y el que Ana registro y anulo en D0 (la excepcion de 20260913120000).
  if v_n <> 3 then raise exception 'J1: Bea ve % pagos en Sierra', v_n; end if;
  if (select annulled from api.group_payment where operation_id = r.pay2) is not true then raise exception 'J1b: pay2 no consta anulado'; end if;
  perform pg_temp.actor(r.carlos);
  select count(*) into v_n from api.group_payment where scope_id = 'a3b00000-0000-4000-8000-000000000010'::uuid;
  if v_n <> 0 then raise exception 'J2: Carlos, fuera, ve api.group_payment'; end if;
  select count(*) into v_n from api.my_group_payment() where scope_id = 'a3b00000-0000-4000-8000-000000000010'::uuid;
  if v_n <> 3 then raise exception 'J3: Carlos ve % de sus pagos', v_n; end if;
  if (select counterpart_display_name from api.my_group_payment() where operation_id = r.pay2) <> 'Bea' then raise exception 'J3b: contraparte'; end if;
  if (select annulled_by_me from api.my_group_payment() where operation_id = r.pay2) is not false then raise exception 'J3c: pay2 lo anulo Bea, no Carlos'; end if;
  perform pg_temp.super();
  -- Retiro: Dani→Ana 1000 (via Marta, retirada), lo registra Dani (pagador): fila en su Personal y aviso a Ana.
  v_pos := pg_temp.gp_expected(z.g3);
  v := pg_temp.gp_pay(r.dani, 'a3b00000-0000-4000-8000-00000000005f', z.g3, z.z_dani, z.z_ana, 1000, v_pos);
  if v not like 'OK %' then raise exception 'J4: %', v; end if;
  v_op := substr(v, 4)::uuid;
  perform pg_temp.actor(r.dani);
  if (select payment_counterpart from api.personal_operation where operation_id = v_op) <> 'Ana' then raise exception 'J5: contraparte en Personal'; end if;
  if (select balance_amount from api.personal_operation where operation_id = v_op) <> '-1000' then raise exception 'J5b: signo'; end if;
  if (select group_display_name from api.personal_operation where operation_id = v_op) <> 'Retiro' then raise exception 'J5c: grupo'; end if;
  perform pg_temp.actor(r.ana);
  if (select balance_amount from api.personal_operation where operation_id = v_op) <> '1000' then raise exception 'J5d: signo de la receptora'; end if;
  select count(*) into v_n from api.group_notice where kind = 'payment' and operation_id = v_op;
  if v_n <> 1 then raise exception 'J6: aviso de pago a Ana = %', v_n; end if;
  if (select participant_display_name from api.group_notice where kind = 'payment' and operation_id = v_op) <> 'Dani' then raise exception 'J6b'; end if;
  -- Dani sale (a cero) y Ana anula: el aviso payment_annulled le llega a Dani aunque ya no sea miembro, y solo ese.
  perform pg_temp.super();
  if pg_temp.gp_leave(r.dani, 'a3b00000-0000-4000-8000-000000000066'::uuid, z.g3) <> 'OK' then raise exception 'J7: Dani no pudo salir'; end if;
  v := pg_temp.gp_annul(r.ana, 'a3b00000-0000-4000-8000-000000000079'::uuid, v_op);
  if v <> 'OK' then raise exception 'J8: %', v; end if;
  perform pg_temp.actor(r.dani);
  select count(*) into v_n from api.group_notice where kind = 'payment_annulled' and operation_id = v_op;
  if v_n <> 1 then raise exception 'J9: aviso de anulacion a Dani (fuera) = %', v_n; end if;
  select count(*) into v_n from api.group_notice where scope_id = z.g3 and kind not in ('payment', 'payment_annulled');
  if v_n <> 0 then raise exception 'J9b: Dani, fuera, ve otros avisos del grupo'; end if;
  if (select count(*) from api.personal_operation where operation_id = v_op) <> 0 then raise exception 'J10: el pago anulado sigue en Movimientos'; end if;
  -- Anulado, sigue contando lo que cerro: el detalle persistido no depende de los efectos vigentes.
  perform pg_temp.super();
  v := pg_temp.gp_allocation(r.ana, v_op);
  raise notice 'J · obligaciones que el pago anulado habia cerrado: %', v;
  if v <> 'settlement Marta>Ana:1000 settlement Dani>Marta:1000' then raise exception 'J10b: %', v; end if;
  if (select annulled from api.group_payment where operation_id = v_op) is distinct from true then raise exception 'J10c: api.group_payment no lo marca anulado'; end if;
  perform pg_temp.actor(r.dani);
  v := pg_temp.gp_personal(r.dani); raise notice 'J · Personal Dani (fuera, pago anulado por Ana) %', v;
  if v not like '%deuda_reabierta=-1000' then raise exception 'J11: %', v; end if;
  -- Y la cifra para Deudas de Inicio: api.my_reopened_debt(), como Dani (authenticated).
  perform pg_temp.actor(r.dani);
  if (select string_agg(amount, ',') from api.my_reopened_debt()) is distinct from '-1000' then
    raise exception 'J12: api.my_reopened_debt() de Dani = %', (select string_agg(coalesce(amount,'?'), ',') from api.my_reopened_debt());
  end if;
  perform pg_temp.super();
  perform pg_temp.super();
  raise notice 'J · lecturas: miembros ven api.group_payment; las partes fuera ven api.my_group_payment; Movimientos recientes con contraparte y signo; avisos payment y payment_annulled llegan al otro aunque haya salido, y solo esos: OK';
end $j$;

rollback;
