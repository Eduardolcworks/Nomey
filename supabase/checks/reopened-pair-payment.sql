-- ============================================================================
-- SALDAR UN PENDIENTE REABIERTO CON QUIEN SALIO (20260913120000, ADR-038 C6)
-- ============================================================================
--
-- Contra las funciones REALES; lib/group-payment-helpers.sql delante. Rollback.
--
--   A · salida a cero → anulacion por la parte activa → el par reaparece y
--       api.group_reopened_pair lo propone SOLO a los miembros
--   B · la parte activa registra el pago: par a cero, caja en los dos
--       Personales, deuda reabierta del salido a cero, aviso al salido, y la
--       parte activa puede salir
--   C · rechazos: el salido desde fuera, un tercero miembro, mas que el tope,
--       la direccion contraria, y sin par reabierto
--   D · ciclos: anular el nuevo pago reabre lo mismo (no el doble); se vuelve
--       a saldar; el gasto sigue protegido (ADR-039 / sobreliquidacion)
--   E · las dos partes fuera: nadie activo que declare
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3f00000-0000-4000-8000-0000000000a1'::uuid as ana,    'a3f00000-0000-4000-8000-0000000000f1'::uuid as s_ana,
  'a3f00000-0000-4000-8000-0000000000b1'::uuid as bea,    'a3f00000-0000-4000-8000-0000000000f2'::uuid as s_bea,
  'a3f00000-0000-4000-8000-0000000000c1'::uuid as carlos, 'a3f00000-0000-4000-8000-0000000000f3'::uuid as s_carlos,
  'a3f00000-0000-4000-8000-000000000010'::uuid as g,
  'a3f00000-0000-4000-8000-000000000031'::uuid as p_ana, 'a3f00000-0000-4000-8000-000000000032'::uuid as p_bea,
  'a3f00000-0000-4000-8000-000000000033'::uuid as p_carlos,
  null::uuid as cat, null::uuid as g1, null::uuid as pay1, null::uuid as pay2;
grant select, update on fx to authenticated;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$ select set_config('role', 'postgres', true); $$;
-- Lo que api.group_reopened_pair le propone a p_user.
create function pg_temp.reopened(p_user uuid, p_scope uuid) returns text language plpgsql as $$
declare v text; j jsonb;
begin
  perform pg_temp.actor(p_user);
  select jsonb_agg(jsonb_build_object('d', debtor_participant_id, 'c', creditor_participant_id, 'a', amount)) into j
    from api.group_reopened_pair(p_scope);
  perform pg_temp.super();
  select coalesce(string_agg(pg_temp.gp_name((x ->> 'd')::uuid) || '>' || pg_temp.gp_name((x ->> 'c')::uuid) || ':' || (x ->> 'a'), ' '), '-')
    into v from jsonb_array_elements(coalesce(j, '[]'::jsonb)) x;
  return v;
end $$;
grant execute on function pg_temp.actor(uuid), pg_temp.super(), pg_temp.reopened(uuid, uuid) to authenticated;

-- ===== fixtures: Ana crea con Bea y Carlos (con cuenta); cena 2000 Ana/Carlos
do $f$
declare r fx%rowtype; v_out jsonb;
begin
  select * into r from fx;
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_ana, 'personal', r.eur, r.ana), (r.s_bea, 'personal', r.eur, r.bea), (r.s_carlos, 'personal', r.eur, r.carlos);
  insert into core.membership (scope_id, user_id) values (r.s_ana, r.ana), (r.s_bea, r.bea), (r.s_carlos, r.carlos);
  perform pg_temp.actor(r.ana);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a3f00000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Reabierto', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_ana, 'creator_display_name', 'Ana',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_bea, 'display_name', 'Bea'),
                                      jsonb_build_object('client_participant_id', r.p_carlos, 'display_name', 'Carlos'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (r.g, r.bea), (r.g, r.carlos);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.p_bea, r.g, r.bea), (r.p_carlos, r.g, r.carlos);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;
  perform pg_temp.actor(r.ana);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3f00000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000', 'effective_date', (current_date - 1)::text,
    'concept', 'Cena', 'category_id', r.cat, 'payer_participant_id', r.p_ana,
    'participants', jsonb_build_array(r.p_ana, r.p_carlos), 'split_method', jsonb_build_object('kind', 'equal')));
  update fx set g1 = (v_out ->> 'operation_id')::uuid;
  perform pg_temp.super();
end $f$;

-- ===== A · salida a cero, anulacion, y lo que se propone =====================
do $a$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  if pg_temp.gp_pairs(r.g) <> 'Carlos>Ana:1000' then raise exception 'A0: %', pg_temp.gp_pairs(r.g); end if;
  if pg_temp.reopened(r.ana, r.g) <> '-' then raise exception 'A0b: hay pares reabiertos antes de nada: %', pg_temp.reopened(r.ana, r.g); end if;
  v := pg_temp.gp_pay(r.carlos, 'a3f00000-0000-4000-8000-000000000051'::uuid, r.g, r.p_carlos, r.p_ana, 1000, pg_temp.gp_expected(r.g, r.carlos));
  if v not like 'OK %' then raise exception 'A1: %', v; end if;
  update fx set pay1 = substr(v, 4)::uuid;
  v := pg_temp.gp_leave(r.carlos, 'a3f00000-0000-4000-8000-000000000061'::uuid, r.g);
  if v <> 'OK' then raise exception 'A2: salir a cero: %', v; end if;
  v := pg_temp.gp_annul(r.ana, 'a3f00000-0000-4000-8000-000000000071'::uuid, (select pay1 from fx));
  if v <> 'OK' then raise exception 'A3: anular: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Carlos>Ana:1000' then raise exception 'A4: %', pg_temp.gp_pairs(r.g); end if;
  -- Lo que se propone: a Ana y a Bea (miembros) el par; a Carlos (fuera) nada.
  if pg_temp.reopened(r.ana, r.g) <> 'Carlos>Ana:1000' then raise exception 'A5: %', pg_temp.reopened(r.ana, r.g); end if;
  if pg_temp.reopened(r.bea, r.g) <> 'Carlos>Ana:1000' then raise exception 'A5b: %', pg_temp.reopened(r.bea, r.g); end if;
  if pg_temp.reopened(r.carlos, r.g) <> '-' then raise exception 'A5c: el salido lee pares del grupo'; end if;
  if pg_temp.gp_personal(r.carlos) not like '%deuda_reabierta=-1000' then raise exception 'A6: %', pg_temp.gp_personal(r.carlos); end if;
  raise notice 'A · salida a cero → anulacion: el par reaparece, se propone a los miembros y no al salido: OK';
end $a$;

-- ===== C (antes que B) · rechazos ==============================================
do $c$
declare r fx%rowtype; v text; v_pos jsonb; v_n int;
begin
  select * into r from fx; v_pos := pg_temp.gp_expected(r.g, r.ana);
  select count(*) into v_n from core.operation where operation_class = 'group_payment' and exists (
    select 1 from core.payment_detail pd join core.operation_version ov on ov.id = pd.operation_version_id where ov.operation_id = core.operation.id and pd.scope_id = r.g);
  -- C1 · Carlos, fuera, no registra (sin membresia).
  v := pg_temp.gp_pay(r.carlos, 'a3f00000-0000-4000-8000-000000000052'::uuid, r.g, r.p_carlos, r.p_ana, 1000, v_pos);
  if v not like 'NOT_AUTHORIZED%' then raise exception 'C1: el salido registro: %', v; end if;
  -- C2 · Bea, miembro y tercera, tampoco.
  v := pg_temp.gp_pay(r.bea, 'a3f00000-0000-4000-8000-000000000053'::uuid, r.g, r.p_carlos, r.p_ana, 1000, v_pos);
  if v not like 'NOT_AUTHORIZED%' then raise exception 'C2: un tercero registro: %', v; end if;
  -- C3 · mas que el tope.
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-000000000054'::uuid, r.g, r.p_carlos, r.p_ana, 1500, v_pos);
  if v not like 'PAYMENT_NOT_APPLICABLE%' then raise exception 'C3: mas que el tope: %', v; end if;
  -- C4 · la direccion contraria (Ana pagando a Carlos): sin par reabierto en esa direccion.
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-000000000055'::uuid, r.g, r.p_ana, r.p_carlos, 1000, v_pos);
  if v not like 'PAYMENT_NOT_APPLICABLE%' then raise exception 'C4: direccion contraria: %', v; end if;
  -- C5 · con Bea, activa y sin par reabierto ni pendiente: nada que saldar.
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-000000000056'::uuid, r.g, r.p_bea, r.p_ana, 100, v_pos);
  if v not like 'PAYMENT_NOT_APPLICABLE%' then raise exception 'C5: %', v; end if;
  if (select count(*) from core.operation where operation_class = 'group_payment' and exists (
        select 1 from core.payment_detail pd join core.operation_version ov on ov.id = pd.operation_version_id where ov.operation_id = core.operation.id and pd.scope_id = r.g)) <> v_n then
    raise exception 'C6: un rechazo escribio un pago';
  end if;
  raise notice 'C · rechazos: salido, tercero, mas que el tope, direccion contraria, sin par: OK';
end $c$;

-- ===== B · la parte activa salda =============================================
do $b$
declare r fx%rowtype; v text; v_n int;
begin
  select * into r from fx;
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-000000000057'::uuid, r.g, r.p_carlos, r.p_ana, 1000, pg_temp.gp_expected(r.g, r.ana));
  if v not like 'OK %' then raise exception 'B1: %', v; end if;
  update fx set pay2 = substr(v, 4)::uuid;
  if pg_temp.gp_pairs(r.g) <> '-' then raise exception 'B2: %', pg_temp.gp_pairs(r.g); end if;
  if pg_temp.reopened(r.ana, r.g) <> '-' then raise exception 'B2b: sigue proponiendose: %', pg_temp.reopened(r.ana, r.g); end if;
  -- Declarado por la receptora; solo el par directo; caja en los dos Personales.
  if (select declared_by_receiver from core.payment_detail where operation_version_id = (select current_version_id from core.operation where id = (select pay2 from fx))) is distinct from true then
    raise exception 'B3: no consta que lo declaro la receptora';
  end if;
  if pg_temp.gp_allocation(r.ana, (select pay2 from fx)) <> 'settlement Carlos>Ana:1000' then raise exception 'B3b: %', pg_temp.gp_allocation(r.ana, (select pay2 from fx)); end if;
  v := pg_temp.gp_personal(r.carlos); raise notice 'B · Personal Carlos (fuera): %', v;
  if v not like 'caja=-1000 gasto=1000 deuda=0 movs_pago=1 deuda_reabierta=0' then raise exception 'B4: %', v; end if;
  v := pg_temp.gp_personal(r.ana); raise notice 'B · Personal Ana: %', v;
  if v not like 'caja=-1000 gasto=1000 deuda=0 movs_pago=1%' then raise exception 'B5: %', v; end if;
  -- Aviso a Carlos aunque este fuera, y sin readmision.
  perform pg_temp.actor(r.carlos);
  select count(*) into v_n from api.group_notice where kind = 'payment' and operation_id = (select pay2 from fx);
  if v_n <> 1 then raise exception 'B6: aviso al salido = %', v_n; end if;
  if (select count(*) from api.group_profile where scope_id = r.g) <> 0 then raise exception 'B7: el salido vuelve a ver el grupo'; end if;
  perform pg_temp.super();
  if (select count(*) from core.membership where scope_id = r.g and user_id = r.carlos) <> 0 then raise exception 'B7b: readmitido'; end if;
  -- Ana puede salir ahora (cero pares): se prueba y se deshace la salida NO, se prueba en E.
  raise notice 'B · la parte activa salda el par reabierto: par a cero, caja en los dos, deuda reabierta a cero, aviso, sin readmision: OK';
end $b$;

-- ===== D · ciclos ============================================================
do $d$
declare r fx%rowtype; v text; v_ver uuid;
begin
  select * into r from fx;
  -- Ana anula el nuevo pago: el par vuelve, y el tope sigue siendo 1000 (no 2000).
  v := pg_temp.gp_annul(r.ana, 'a3f00000-0000-4000-8000-000000000072'::uuid, (select pay2 from fx));
  if v <> 'OK' then raise exception 'D1: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Carlos>Ana:1000' then raise exception 'D2: %', pg_temp.gp_pairs(r.g); end if;
  if pg_temp.reopened(r.ana, r.g) <> 'Carlos>Ana:1000' then raise exception 'D3: el tope se amplio: %', pg_temp.reopened(r.ana, r.g); end if;
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-000000000058'::uuid, r.g, r.p_carlos, r.p_ana, 1500, pg_temp.gp_expected(r.g, r.ana));
  if v not like 'PAYMENT_NOT_APPLICABLE%' then raise exception 'D4: se sumo dos veces: %', v; end if;
  -- Y se vuelve a saldar.
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-000000000059'::uuid, r.g, r.p_carlos, r.p_ana, 1000, pg_temp.gp_expected(r.g, r.ana));
  if v not like 'OK %' then raise exception 'D5: %', v; end if;
  update fx set pay2 = substr(v, 4)::uuid;
  if pg_temp.gp_pairs(r.g) <> '-' then raise exception 'D6: %', pg_temp.gp_pairs(r.g); end if;
  -- El gasto sigue protegido: anularlo con el par liquidado, sobreliquidacion; ADR-039 no se relaja.
  v_ver := (select current_version_id from core.operation where id = r.g1);
  perform pg_temp.actor(r.ana);
  begin
    perform api.annul_operation(jsonb_build_object('client_operation_id', 'a3f00000-0000-4000-8000-000000000073'::uuid,
      'command_contract_version', 2, 'operation_id', r.g1, 'expected_version_id', v_ver));
    raise exception 'D7: anular la cena se acepto';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') not in ('SETTLEMENT_EXCEEDS_DEBT', 'DEPARTED_OBLIGATION_CHANGED') then raise exception 'D7b: %', sqlerrm::json ->> 'code'; end if;
  end;
  perform pg_temp.super();
  raise notice 'D · anular el nuevo pago reabre lo mismo (no el doble), se vuelve a saldar, y el gasto sigue protegido: OK';
end $d$;

-- ===== E · la parte activa sale; las dos fuera, nadie salda ==================
do $e$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  v := pg_temp.gp_leave(r.ana, 'a3f00000-0000-4000-8000-000000000062'::uuid, r.g);
  if v <> 'OK' then raise exception 'E1: Ana no pudo salir a cero: %', v; end if;
  -- Ana, fuera, anula su pago (permiso de las partes conservado): el par vuelve con las dos fuera.
  v := pg_temp.gp_annul(r.ana, 'a3f00000-0000-4000-8000-000000000074'::uuid, (select pay2 from fx));
  if v <> 'OK' then raise exception 'E2: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Carlos>Ana:1000' then raise exception 'E3: %', pg_temp.gp_pairs(r.g); end if;
  -- Nadie activo: Ana (fuera) NOT_AUTHORIZED por membresia; Bea (miembro) no es parte; y la lectura no lo propone.
  v := pg_temp.gp_pay(r.ana, 'a3f00000-0000-4000-8000-00000000005a'::uuid, r.g, r.p_carlos, r.p_ana, 1000, pg_temp.gp_expected(r.g, r.ana));
  if v not like 'NOT_AUTHORIZED%' then raise exception 'E4: %', v; end if;
  v := pg_temp.gp_pay(r.bea, 'a3f00000-0000-4000-8000-00000000005b'::uuid, r.g, r.p_carlos, r.p_ana, 1000, pg_temp.gp_expected(r.g, r.bea));
  if v not like 'NOT_AUTHORIZED%' and v not like 'PARTICIPANT_INACTIVE%' then raise exception 'E5: %', v; end if;
  if pg_temp.reopened(r.bea, r.g) <> '-' then raise exception 'E6: se propone un par con las dos fuera: %', pg_temp.reopened(r.bea, r.g); end if;
  -- Los dos lo ven en su Personal por la excepcion C6, cada uno con su signo.
  if pg_temp.gp_personal(r.carlos) not like '%deuda_reabierta=-1000' then raise exception 'E7: %', pg_temp.gp_personal(r.carlos); end if;
  if pg_temp.gp_personal(r.ana) not like '%deuda_reabierta=1000' then raise exception 'E8: %', pg_temp.gp_personal(r.ana); end if;
  raise notice 'E · la parte activa sale a cero; con las dos fuera nadie salda y no se propone; la deuda reabierta la ven los dos: OK';
end $e$;

rollback;
