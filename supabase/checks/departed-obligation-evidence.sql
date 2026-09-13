-- ============================================================================
-- LA OBLIGACION DE QUIEN SALIO ES INTOCABLE (ADR-039) · contra las funciones reales
-- ============================================================================
--
-- api.record_group_expense y api.annul_operation con la guarda de ADR-039
-- dentro (sec.assert_departed_unchanged, migracion 20260912170000), llamadas
-- como cada cuenta; los pagos, con api.record_group_payment. Las ayudas de
-- lib/group-payment-helpers.sql solo leen y envuelven. Todo en una transaccion
-- que termina en rollback.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/departed-obligation-evidence.sql; } | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · fixture; Carlos paga y sale a cero
--   B · correccion de importe que cambia la obligacion de Carlos: RECHAZADA
--   C · correccion de reparto que la cambia (mismo neto, otro acreedor): RECHAZADA
--   D · anulacion del gasto: RECHAZADA
--   E · solo concepto y categoria: PERMITIDA
--   F · cambio economico solo entre activos, Carlos intacto: PERMITIDA
--   G · anulacion del pago de Carlos, fuera: contrato v3 (permitida), reabre;
--       va antes de C para que ninguna liquidacion vigente enmascare la guarda
--   H · retirado intermedio en un pago: C4 se conserva
--   I · alta retro-fechada que nombra a quien salio: RECHAZADA, sin escrituras
--   J · alta y correccion validas solo entre activos: PERMITIDAS
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3d00000-0000-4000-8000-0000000000a1'::uuid as ana,   'a3d00000-0000-4000-8000-0000000000f1'::uuid as s_ana,
  'a3d00000-0000-4000-8000-0000000000b1'::uuid as bea,   'a3d00000-0000-4000-8000-0000000000f2'::uuid as s_bea,
  'a3d00000-0000-4000-8000-0000000000c1'::uuid as carlos,'a3d00000-0000-4000-8000-0000000000f3'::uuid as s_carlos,
  'a3d00000-0000-4000-8000-0000000000d1'::uuid as dani,  'a3d00000-0000-4000-8000-0000000000f4'::uuid as s_dani,
  'a3d00000-0000-4000-8000-000000000010'::uuid as g,
  'a3d00000-0000-4000-8000-000000000031'::uuid as p_ana, 'a3d00000-0000-4000-8000-000000000032'::uuid as p_bea,
  'a3d00000-0000-4000-8000-000000000033'::uuid as p_carlos, 'a3d00000-0000-4000-8000-000000000034'::uuid as p_dani,
  null::uuid as cat, null::uuid as cat2, null::uuid as g1, null::uuid as pay;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$ select set_config('role', 'postgres', true); $$;
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated;
grant select, update on fx to authenticated;

-- Corregir G1 como Ana con un payload dado, con el writer REAL: 'OK' o el codigo.
create function pg_temp.corregir(p_payload jsonb) returns text language plpgsql as $$
declare r fx%rowtype; v_old uuid;
begin
  select * into r from fx;
  select current_version_id into v_old from core.operation where id = r.g1;
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(p_payload || jsonb_build_object('operation_id', r.g1, 'expected_version_id', v_old));
  perform pg_temp.super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- Anular G1 con la funcion REAL, como p_who.
create function pg_temp.anular(p_who uuid, p_key uuid) returns text language plpgsql as $$
declare r fx%rowtype; v_old uuid;
begin
  select * into r from fx;
  select current_version_id into v_old from core.operation where id = r.g1;
  perform pg_temp.actor(p_who);
  perform api.annul_operation(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 2,
    'operation_id', r.g1, 'expected_version_id', v_old));
  perform pg_temp.super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
grant execute on function pg_temp.corregir(jsonb), pg_temp.anular(uuid, uuid) to authenticated;

create function pg_temp.g1_base() returns jsonb language sql as $$
  select jsonb_build_object('command_contract_version', 1, 'scope_id', g, 'currency_definition_id', eur,
    'total', '9000', 'effective_date', (current_date - 1)::text, 'concept', 'Cena', 'category_id', cat,
    'payer_participant_id', p_ana, 'participants', jsonb_build_array(p_ana, p_bea, p_carlos),
    'split_method', jsonb_build_object('kind', 'equal')) from fx;
$$;
grant execute on function pg_temp.g1_base() to authenticated;

-- ============================ A · fixture ===================================
do $a$
declare r fx%rowtype; v_out jsonb; v text;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null),
                cat2 = (select id from core.category where message_key = 'category.expense.transport' and owner_user_id is null);
  select * into r from fx;
  if r.cat2 is null then update fx set cat2 = (select id from core.category where owner_user_id is null and id <> r.cat limit 1); select * into r from fx; end if;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_ana, 'personal', r.eur, r.ana), (r.s_bea, 'personal', r.eur, r.bea), (r.s_carlos, 'personal', r.eur, r.carlos), (r.s_dani, 'personal', r.eur, r.dani);
  insert into core.membership (scope_id, user_id) values (r.s_ana, r.ana), (r.s_bea, r.bea), (r.s_carlos, r.carlos), (r.s_dani, r.dani);
  perform pg_temp.actor(r.ana);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3d00000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Salida', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_ana, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', r.p_bea, 'display_name', 'Bea'),
      jsonb_build_object('client_participant_id', r.p_carlos, 'display_name', 'Carlos'),
      jsonb_build_object('client_participant_id', r.p_dani, 'display_name', 'Dani'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (r.g, r.bea), (r.g, r.carlos), (r.g, r.dani);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values
    (r.p_bea, r.g, r.bea), (r.p_carlos, r.g, r.carlos), (r.p_dani, r.g, r.dani);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;
  -- G1 (ayer): Ana paga 90 a tres → Bea>Ana 3000, Carlos>Ana 3000.
  perform pg_temp.actor(r.ana);
  v_out := api.record_group_expense(pg_temp.g1_base() || jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000041'::uuid));
  update fx set g1 = (v_out ->> 'operation_id')::uuid;
  perform pg_temp.super();
  select * into r from fx;
  -- Carlos paga sus 3000 a Ana (contrato ADR-038 simulado) y sale a cero.
  -- Antes de pagar, Carlos no puede salir (debe 3000 a Ana).
  v := pg_temp.gp_leave(r.carlos, 'a3d00000-0000-4000-8000-000000000060'::uuid, r.g);
  if v not like 'LEAVE_BLOCKED_DEBT %' then raise exception 'A0: %', v; end if;
  v := pg_temp.gp_pay(r.carlos, 'a3d00000-0000-4000-8000-000000000051'::uuid, r.g, r.p_carlos, r.p_ana, 3000, pg_temp.gp_expected(r.g));
  if v not like 'OK %' then raise exception 'A1: %', v; end if;
  update fx set pay = substr(v, 4)::uuid;
  v := pg_temp.gp_leave(r.carlos, 'a3d00000-0000-4000-8000-000000000061'::uuid, r.g);
  if v <> 'OK' then raise exception 'A2: %', v; end if;
  raise notice 'A · pares % · lo que G1 atribuye a quien salio (sec.departed_effects_of_version): %', pg_temp.gp_pairs(r.g), sec.departed_effects_of_version((select current_version_id from core.operation where id = r.g1));
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:3000' then raise exception 'A3: %', pg_temp.gp_pairs(r.g); end if;
  raise notice 'A · Carlos pago y salio a cero; G1 le atribuye cuota 3000 y deuda Carlos>Ana 3000: fixture OK';
end $a$;

-- ===== B · correccion de importe: RECHAZADA ==================================
do $b$
declare r fx%rowtype; v text; v_ver uuid;
begin
  select * into r from fx;
  select current_version_id into v_ver from core.operation where id = r.g1;
  v := pg_temp.corregir(pg_temp.g1_base() || jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000042'::uuid, 'total', '12000'));
  raise notice 'B · 90 → 120 a tres con Carlos fuera: %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'B1: %', v; end if;
  if (select current_version_id from core.operation where id = r.g1) <> v_ver then raise exception 'B2: quedo escrita una version'; end if;
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:3000' then raise exception 'B3: %', pg_temp.gp_pairs(r.g); end if;
  raise notice 'B · la correccion de importe que cambiaria la cuota y la deuda de Carlos se rehusa y no escribe: OK';
end $b$;

-- ===== G · anulacion del pago de Carlos, fuera: contrato v3 (antes de C: sin liquidacion vigente, la guarda de ADR-039 es la unica que decide) ===
do $g$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  v := pg_temp.gp_annul(r.carlos, 'a3d00000-0000-4000-8000-000000000071'::uuid, r.pay);
  raise notice 'G · Carlos, fuera, anula su pago: % · pares % · Personal Carlos %', v, pg_temp.gp_pairs(r.g), pg_temp.gp_personal(r.carlos);
  if v <> 'OK' then raise exception 'G1: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:3000 Carlos>Ana:3000' then raise exception 'G2: %', pg_temp.gp_pairs(r.g); end if;
  if pg_temp.gp_personal(r.carlos) not like '%deuda=-3000 movs_pago=0 deuda_reabierta=-3000' then raise exception 'G3: %', pg_temp.gp_personal(r.carlos); end if;
  if exists (select 1 from core.membership where scope_id = r.g and user_id = r.carlos) then raise exception 'G4: readmision'; end if;
  -- Y la guarda de gastos NO interviene en el pago: lo que el pago atribuye a Carlos (caja, deuda) cambia, y es su contrato.
  raise notice 'G · la anulacion del pago conserva v3 (permisos, reapertura acotada, sin readmision) y no pasa por la guarda de gastos: OK';
end $g$;

-- ===== C · correccion de reparto con el mismo neto para Carlos: RECHAZADA ===
do $c$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  -- Pagadora Bea en vez de Ana, mismo total y reparto: Carlos seguiria debiendo 3000 en NETO,
  -- pero a Bea y no a Ana. Un par distinto es una obligacion distinta. (Con el pago vigente,
  -- la guarda de sobreliquidacion ya lo rehusaria antes; tras G no hay liquidacion y decide esta.)
  v := pg_temp.corregir(pg_temp.g1_base() || jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000043'::uuid, 'payer_participant_id', r.p_bea));
  raise notice 'C · cambiar la pagadora (mismo neto de Carlos, otro acreedor): %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'C1: %', v; end if;
  -- Y un reparto que le deje la misma deuda pero otra cuota: exact_amounts Ana 3000, Bea 3000, Carlos 3000 es igual; Carlos 2000 no.
  v := pg_temp.corregir(pg_temp.g1_base() || jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000044'::uuid,
        'split_method', jsonb_build_object('kind', 'exact_amounts', 'amounts', jsonb_build_array('4000', '3000', '2000'))));
  raise notice 'C · reparto que baja la cuota de Carlos a 2000: %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'C2: %', v; end if;
  raise notice 'C · el neto de Carlos no basta: par y cuota se comparan uno a uno: OK';
end $c$;

-- ===== D · anulacion del gasto: RECHAZADA ====================================
do $d$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  v := pg_temp.anular(r.ana, 'a3d00000-0000-4000-8000-000000000045'::uuid);
  raise notice 'D · anular G1 con Carlos fuera: %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'D1: %', v; end if;
  if (select version_kind from core.operation_version ov join core.operation o on o.current_version_id = ov.id where o.id = r.g1) <> 'record' then raise exception 'D2'; end if;
  raise notice 'D · anular un gasto que atribuye algo a quien salio se rehusa: OK';
end $d$;

-- ===== E · solo concepto y categoria: PERMITIDA ==============================
do $e$
declare r fx%rowtype; v text; v_n int;
begin
  select * into r from fx;
  v := pg_temp.corregir(pg_temp.g1_base() || jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000046'::uuid, 'concept', 'Cena de despedida', 'category_id', r.cat2));
  raise notice 'E · concepto y categoria: %', v;
  if v <> 'OK' then raise exception 'E1: %', v; end if;
  select count(*) into v_n from core.operation_version where operation_id = r.g1;
  if v_n <> 2 then raise exception 'E2: versiones %', v_n; end if;
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:3000 Carlos>Ana:3000' then raise exception 'E3: %', pg_temp.gp_pairs(r.g); end if;
  raise notice 'E · concepto y categoria cambian sin efectos economicos sobre Carlos: permitido: OK';
end $e$;

-- ===== F · cambio economico solo entre activos: PERMITIDA ====================
do $f$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  -- Mismo total; Ana 2000, Bea 4000, Carlos 3000: Bea>Ana pasa a 4000; Carlos identico (cuota 3000, Carlos>Ana 3000).
  v := pg_temp.corregir(pg_temp.g1_base() || jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000047'::uuid, 'concept', 'Cena de despedida', 'category_id', r.cat2,
        'split_method', jsonb_build_object('kind', 'exact_amounts', 'amounts', jsonb_build_array('2000', '4000', '3000'))));
  raise notice 'F · reparto que solo mueve Ana/Bea: % · pares %', v, pg_temp.gp_pairs(r.g);
  if v <> 'OK' then raise exception 'F1: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:4000 Carlos>Ana:3000' then raise exception 'F2: %', pg_temp.gp_pairs(r.g); end if;
  raise notice 'F · un cambio economico entre activos que deja intacta la obligacion de quien salio: permitido: OK';
end $f$;

-- ===== H · retirado intermedio: C4 se conserva ==============================
create temp table fz as select
  'a3d00000-0000-4000-8000-000000000011'::uuid as g2,
  'a3d00000-0000-4000-8000-000000000035'::uuid as z_ana, 'a3d00000-0000-4000-8000-000000000036'::uuid as z_marta,
  'a3d00000-0000-4000-8000-000000000037'::uuid as z_dani, null::uuid as p2;
grant select, update on fz to authenticated;
do $h$
declare r fx%rowtype; z fz%rowtype; v text; v_ver uuid;
begin
  select * into r from fx; select * into z from fz;
  perform pg_temp.actor(r.ana);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a3d00000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1,
    'client_group_id', z.g2, 'display_name', 'Retiro', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', z.z_ana, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', z.z_marta, 'display_name', 'Marta'),
      jsonb_build_object('client_participant_id', z.z_dani, 'display_name', 'Dani'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (z.g2, r.dani);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (z.z_dani, z.g2, r.dani);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = z.g2;
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000048'::uuid, 'command_contract_version', 1,
    'scope_id', z.g2, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', (current_date - 1)::text, 'concept', 'R1', 'category_id', r.cat,
    'payer_participant_id', z.z_ana, 'participants', jsonb_build_array(z.z_ana, z.z_marta), 'split_method', jsonb_build_object('kind', 'equal')));
  perform api.record_group_expense(jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000049'::uuid, 'command_contract_version', 1,
    'scope_id', z.g2, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', (current_date - 1)::text, 'concept', 'R2', 'category_id', r.cat,
    'payer_participant_id', z.z_marta, 'participants', jsonb_build_array(z.z_marta, z.z_dani), 'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.super();
  v := pg_temp.gp_pay(r.dani, 'a3d00000-0000-4000-8000-000000000052'::uuid, z.g2, z.z_dani, z.z_ana, 1000, pg_temp.gp_expected(z.g2));
  if v not like 'OK %' then raise exception 'H1: %', v; end if;
  update fz set p2 = substr(v, 4)::uuid; select * into z from fz;
  perform pg_temp.actor(r.ana);
  perform api.retire_participant(jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-000000000081'::uuid,
    'command_contract_version', 1, 'scope_id', z.g2, 'participant_id', z.z_marta, 'expected_pairs', '[]'::jsonb));
  perform pg_temp.super();
  v := pg_temp.gp_annul(r.dani, 'a3d00000-0000-4000-8000-000000000072'::uuid, z.p2);
  raise notice 'H · anular el pago que atraveso a Marta (retirada): % · netos %', v, pg_temp.gp_positions(z.g2);
  if v <> 'OK' then raise exception 'H2: %', v; end if;
  if pg_temp.gp_positions(z.g2) <> 'Ana:1000 Dani:-1000 Marta:0' then raise exception 'H3: %', pg_temp.gp_positions(z.g2); end if;
  -- La guarda de ADR-039 no lo mira: Marta esta RETIRADA (la cubre la guarda de retirados), no «salida».
  select current_version_id into v_ver from core.operation where id = z.p2;
  if sec.departed_effects_of_version((select id from core.operation_version where operation_id = z.p2 and version_no = 1)) <> '{}' then
    raise exception 'H4: la guarda de salidos trato a una retirada como salida';
  end if;
  raise notice 'H · un retirado intermedio no bloquea anular el pago (C4) y la guarda de salidos no lo confunde con una salida: OK';
end $h$;

-- ===== I · alta retro-fechada que nombra a quien salio: RECHAZADA ============
do $i$
declare r fx%rowtype; v_n int; v_before text;
begin
  select * into r from fx;
  perform pg_temp.super();
  v_before := (select count(*) from core.operation) || '/' || (select count(*) from core.operation_version) || '/' || (select count(*) from core.effect)
    || '/' || (select count(*) from core.client_command);
  -- Ana registra AYER (dentro de la presencia de Carlos) una cena Ana/Carlos: la fecha es elegible, la guarda rehusa.
  perform pg_temp.actor(r.ana);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3d00000-0000-4000-8000-00000000004a'::uuid, 'command_contract_version', 1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '5000', 'effective_date', (current_date - 1)::text,
      'concept', 'Retro', 'category_id', r.cat, 'payer_participant_id', r.p_ana,
      'participants', jsonb_build_array(r.p_ana, r.p_carlos), 'split_method', jsonb_build_object('kind', 'equal')));
    raise exception 'I1: el alta retro-fechada que nombra a Carlos no se rehuso';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'DEPARTED_OBLIGATION_CHANGED' then raise; end if;
  end;
  perform pg_temp.super();
  -- Sin escrituras parciales: ni operacion, ni version, ni efectos, ni clave.
  if v_before <> (select count(*) from core.operation) || '/' || (select count(*) from core.operation_version) || '/' || (select count(*) from core.effect)
    || '/' || (select count(*) from core.client_command) then
    raise exception 'I2: quedaron escrituras parciales';
  end if;
  -- Y Carlos como PAGADOR de un alta retro-fechada (le atribuiria caja y credito): igual.
  perform pg_temp.actor(r.ana);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3d00000-0000-4000-8000-00000000004b'::uuid, 'command_contract_version', 1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '5000', 'effective_date', (current_date - 1)::text,
      'concept', 'Retro2', 'category_id', r.cat, 'payer_participant_id', r.p_carlos,
      'participants', jsonb_build_array(r.p_ana, r.p_carlos), 'split_method', jsonb_build_object('kind', 'equal')));
    raise exception 'I3: el alta con Carlos pagador no se rehuso';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'DEPARTED_OBLIGATION_CHANGED' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'I · un alta retro-fechada que atribuye algo a quien salio se rehusa con DEPARTED_OBLIGATION_CHANGED y no deja escrituras: OK';
end $i$;

-- ===== J · alta y correccion validas solo entre activos: PERMITIDAS =========
do $j$
declare r fx%rowtype; v_out jsonb; v_op uuid; v_ver uuid; v text;
begin
  select * into r from fx;
  -- Alta AYER entre Ana y Bea (activas), con Carlos fuera: permitida.
  perform pg_temp.actor(r.ana);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3d00000-0000-4000-8000-00000000004c'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', (current_date - 1)::text,
    'concept', 'Activas', 'category_id', r.cat, 'payer_participant_id', r.p_ana,
    'participants', jsonb_build_array(r.p_ana, r.p_bea), 'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;
  perform pg_temp.super();
  v_ver := (select current_version_id from core.operation where id = v_op);
  -- Y su correccion (importe): permitida; Carlos no figura.
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3d00000-0000-4000-8000-00000000004d'::uuid, 'command_contract_version', 1,
    'operation_id', v_op, 'expected_version_id', v_ver,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '3000', 'effective_date', (current_date - 1)::text,
    'concept', 'Activas', 'category_id', r.cat, 'payer_participant_id', r.p_ana,
    'participants', jsonb_build_array(r.p_ana, r.p_bea), 'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.super();
  raise notice 'J · alta y correccion entre activas: pares %', pg_temp.gp_pairs(r.g);
  if pg_temp.gp_pairs(r.g) <> 'Bea>Ana:5500 Carlos>Ana:3000' then raise exception 'J1: %', pg_temp.gp_pairs(r.g); end if;
  raise notice 'J · alta y correccion que solo nombran a activos: permitidas: OK';
end $j$;

-- ===== K · salio el MISMO DIA del gasto: concepto si, importe no, fecha no ====
--
-- Medido en dispositivo (2026-09-13): Aitor reclamo, hubo una cena de ese
-- dia con el, y salio a cero ese mismo dia. Su presencia se cerro con el dia
-- EXCLUIDO (ADR-034 §5), asi que la cena —valida cuando se registro— dejo de
-- poder corregirse hasta en el concepto: PARTICIPANT_NOT_ELIGIBLE tapaba la
-- guarda de ADR-039. La excepcion de elegibilidad de una correccion (quien
-- ya constaba en la version corregida, en su misma fecha, no vuelve a pasar
-- por la fecha) deja que decida la guarda: concepto permitido, importe
-- DEPARTED_OBLIGATION_CHANGED. Mover la fecha o nombrar a alguien nuevo sigue
-- exigiendo elegibilidad.
do $k$
declare r fx%rowtype; v_out jsonb; v_op uuid; v_ver uuid; v text; v_pay uuid; v_g uuid := 'a3d00000-0000-4000-8000-0000000000e0';
  v_pe uuid := 'a3d00000-0000-4000-8000-0000000000e9'; v_pt uuid := 'a3d00000-0000-4000-8000-0000000000ea';
  v_pm uuid := 'a3d00000-0000-4000-8000-0000000000eb';
begin
  select * into r from fx;
  -- Grupo nuevo HOY: Ana crea con Dani («Tono») y Marta; Dani reclama; cena de hoy Ana/Dani.
  perform pg_temp.actor(r.ana);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a3d00000-0000-4000-8000-0000000000e1'::uuid, 'command_contract_version', 1,
    'client_group_id', v_g, 'display_name', 'Hoy', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', v_pe, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', v_pt, 'display_name', 'Tono'),
                                      jsonb_build_object('client_participant_id', v_pm, 'display_name', 'Marta'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (v_g, r.dani);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (v_pt, v_g, r.dani);
  perform pg_temp.actor(r.ana);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3d00000-0000-4000-8000-0000000000e4'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', current_date::text,
    'concept', 'Cena', 'category_id', r.cat, 'payer_participant_id', v_pe,
    'participants', jsonb_build_array(v_pe, v_pt), 'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;
  -- Dani paga sus 1000 y sale HOY: periodo [hoy, hoy), vacio.
  perform pg_temp.super();
  v := pg_temp.gp_pay(r.dani, 'a3d00000-0000-4000-8000-0000000000e2'::uuid, v_g, v_pt, v_pe, 1000, pg_temp.gp_expected(v_g));
  if v not like 'OK %' then raise exception 'K0: %', v; end if;
  v_pay := substr(v, 4)::uuid;
  v := pg_temp.gp_leave(r.dani, 'a3d00000-0000-4000-8000-0000000000e3'::uuid, v_g);
  if v <> 'OK' then raise exception 'K0b: %', v; end if;
  if (select valid_from = valid_until from core.participant_period where participant_id = v_pt) is distinct from true then
    raise exception 'K0c: el periodo de quien salio el mismo dia no es vacio';
  end if;
  -- K1 · concepto y categoria: permitido, y la obligacion de Tono intacta.
  v_ver := (select current_version_id from core.operation where id = v_op);
  perform pg_temp.actor(r.ana);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3d00000-0000-4000-8000-0000000000e5'::uuid, 'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_ver,
      'scope_id', v_g, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', current_date::text,
      'concept', 'Cena rica', 'category_id', r.cat2, 'payer_participant_id', v_pe,
      'participants', jsonb_build_array(v_pe, v_pt), 'split_method', jsonb_build_object('kind', 'equal')));
  exception when sqlstate 'PGRST' then
    raise exception 'K1: corregir el concepto del gasto del dia de la salida: %', sqlerrm::json ->> 'code';
  end;
  perform pg_temp.super();
  if (select md.concept from core.movement_detail md join core.operation o on o.current_version_id = md.operation_version_id where o.id = v_op) <> 'Cena rica' then
    raise exception 'K1b: el concepto no cambio';
  end if;
  if pg_temp.gp_pairs(v_g) <> '-' then raise exception 'K1c: pares %', pg_temp.gp_pairs(v_g); end if;
  -- K2 · importe: la guarda de ADR-039, ya alcanzable, rehusa; sin version nueva.
  v_ver := (select current_version_id from core.operation where id = v_op);
  perform pg_temp.actor(r.ana);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3d00000-0000-4000-8000-0000000000e6'::uuid, 'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_ver,
      'scope_id', v_g, 'currency_definition_id', r.eur, 'total', '3000', 'effective_date', current_date::text,
      'concept', 'Cena rica', 'category_id', r.cat2, 'payer_participant_id', v_pe,
      'participants', jsonb_build_array(v_pe, v_pt), 'split_method', jsonb_build_object('kind', 'equal')));
    raise exception 'K2: cambiar el importe con Tono fuera se acepto';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'K2b: %', sqlerrm::json ->> 'code'; end if;
  end;
  -- K3 · mover la fecha a manana, con Tono: la elegibilidad por fecha sigue.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3d00000-0000-4000-8000-0000000000e7'::uuid, 'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_ver,
      'scope_id', v_g, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', (current_date + 1)::text,
      'concept', 'Cena rica', 'category_id', r.cat2, 'payer_participant_id', v_pe,
      'participants', jsonb_build_array(v_pe, v_pt), 'split_method', jsonb_build_object('kind', 'equal')));
    raise exception 'K3: mover la fecha con Tono fuera se acepto';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'PARTICIPANT_NOT_ELIGIBLE' then raise exception 'K3b: %', sqlerrm::json ->> 'code'; end if;
  end;
  -- K4 · anular: con el pago vigente, el par esta liquidado y manda la guarda
  --      de sobreliquidacion (SETTLEMENT_EXCEEDS_DEBT); Ana anula el pago
  --      (reabre 1000 a Tono, fuera) y entonces la que decide es ADR-039.
  begin
    perform api.annul_operation(jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-0000000000ec'::uuid,
      'command_contract_version', 2, 'operation_id', v_op, 'expected_version_id', v_ver));
    raise exception 'K4: anular el gasto con su par liquidado se acepto';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'SETTLEMENT_EXCEEDS_DEBT' then raise exception 'K4a: %', sqlerrm::json ->> 'code'; end if;
  end;
  perform pg_temp.super();
  v := pg_temp.gp_annul(r.ana, 'a3d00000-0000-4000-8000-0000000000ed'::uuid, v_pay);
  if v <> 'OK' then raise exception 'K4c: anular el pago: %', v; end if;
  if pg_temp.gp_pairs(v_g) <> 'Tono>Ana:1000' then raise exception 'K4d: pares %', pg_temp.gp_pairs(v_g); end if;
  perform pg_temp.actor(r.ana);
  begin
    perform api.annul_operation(jsonb_build_object('client_operation_id', 'a3d00000-0000-4000-8000-0000000000e8'::uuid,
      'command_contract_version', 2, 'operation_id', v_op, 'expected_version_id', v_ver));
    raise exception 'K4: anular el gasto del dia de la salida se acepto';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'K4b: %', sqlerrm::json ->> 'code'; end if;
  end;
  perform pg_temp.super();
  if (select current_version_id from core.operation where id = v_op) <> v_ver then raise exception 'K5: quedo una version'; end if;
  raise notice 'K · salio el mismo dia del gasto: concepto y categoria si; importe y anulacion DEPARTED_OBLIGATION_CHANGED; mover la fecha NOT_ELIGIBLE: OK';
end $k$;

rollback;
