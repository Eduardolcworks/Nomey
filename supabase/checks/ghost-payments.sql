-- ============================================================================
-- PAGOS CON PARTICIPANTES SIN CUENTA, Y LA CAMPANA DE QUIEN SALIO (20260913130000)
-- ============================================================================
--
-- Contra las funciones REALES; lib/group-payment-helpers.sql delante. Rollback.
--
--   A · Edu (con cuenta) debe a Marta (sin cuenta): «Saldado» por Edu cierra
--       la deuda, saca la caja SOLO de su Personal, deja el pago con las dos
--       identidades y no crea ningun Personal ni ningun aviso
--   B · simetrico: Marta debe a Edu; Edu, receptor, lo declara
--   C · rechazos: un tercero con cuenta; entre dos sin cuenta
--   D · anulacion por Edu: reversion exacta; un tercero no puede; replay
--   E · coherencia con la reclamacion (F10, sin implementarlo): si Bea
--       reclamara a Marta, el pago le llega por el identificador estable
--       del participante, con su estado; su caja nunca se escribio
--   F · la campana de quien salio: los avisos de pago que le llegan sin
--       membresia se dan por leidos al abrir la campana
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a4000000-0000-4000-8000-0000000000a1'::uuid as edu, 'a4000000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a4000000-0000-4000-8000-0000000000b1'::uuid as bea, 'a4000000-0000-4000-8000-0000000000f2'::uuid as s_bea,
  'a4000000-0000-4000-8000-000000000010'::uuid as g,
  'a4000000-0000-4000-8000-000000000031'::uuid as p_edu, 'a4000000-0000-4000-8000-000000000032'::uuid as p_bea,
  'a4000000-0000-4000-8000-000000000033'::uuid as p_marta, 'a4000000-0000-4000-8000-000000000034'::uuid as p_dani,
  null::uuid as cat, null::uuid as pay_a, null::uuid as pay_b, null::uuid as pay_f;
grant select, update on fx to authenticated;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$ select set_config('role', 'postgres', true); $$;
create function pg_temp.gasto(p_who uuid, p_key uuid, p_payer uuid, p_parts uuid[], p_total bigint) returns uuid language plpgsql as $$
declare r fx%rowtype; v jsonb;
begin
  select * into r from fx;
  perform pg_temp.actor(p_who);
  v := api.record_group_expense(jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', p_total::text, 'effective_date', (current_date - 1)::text,
    'concept', 'Gasto', 'category_id', r.cat, 'payer_participant_id', p_payer,
    'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.super();
  return (v ->> 'operation_id')::uuid;
end $$;
grant execute on function pg_temp.actor(uuid), pg_temp.super(), pg_temp.gasto(uuid, uuid, uuid, uuid[], bigint) to authenticated;

-- ===== fixtures: Edu crea con Bea (con cuenta), Marta y Dani (sin cuenta) ====
do $f$
declare r fx%rowtype;
begin
  select * into r from fx;
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_bea, 'personal', r.eur, r.bea);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_bea, r.bea);
  perform pg_temp.actor(r.edu);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a4000000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Fantasmas', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_bea, 'display_name', 'Bea'),
                                      jsonb_build_object('client_participant_id', r.p_marta, 'display_name', 'Marta'),
                                      jsonb_build_object('client_participant_id', r.p_dani, 'display_name', 'Dani'))));
  perform pg_temp.super();
  insert into core.membership (scope_id, user_id) values (r.g, r.bea);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.p_bea, r.g, r.bea);
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;
end $f$;

-- ===== A · Edu debe a Marta (sin cuenta): «Saldado» por Edu ================
do $a$
declare r fx%rowtype; v text; v_n int; v_scopes int; v_notices int;
begin
  select * into r from fx;
  perform pg_temp.gasto(r.edu, 'a4000000-0000-4000-8000-000000000041'::uuid, r.p_marta, array[r.p_edu, r.p_marta], 2000);
  if pg_temp.gp_pairs(r.g) <> 'Edu>Marta:1000' then raise exception 'A0: %', pg_temp.gp_pairs(r.g); end if;
  select count(*) into v_scopes from core.scope where kind = 'personal';
  select count(*) into v_notices from core.group_notice where scope_id = r.g;
  v := pg_temp.gp_pay(r.edu, 'a4000000-0000-4000-8000-000000000051'::uuid, r.g, r.p_edu, r.p_marta, 1000, pg_temp.gp_expected(r.g));
  if v not like 'OK %' then raise exception 'A1: pagar a quien no tiene cuenta: %', v; end if;
  update fx set pay_a = substr(v, 4)::uuid;
  if pg_temp.gp_pairs(r.g) <> '-' then raise exception 'A2: %', pg_temp.gp_pairs(r.g); end if;
  -- Caja: solo Edu, -1000 (Marta pago el gasto, asi que Edu no tenia caja antes).
  v := pg_temp.gp_personal(r.edu); raise notice 'A · Personal Edu: %', v;
  if v not like 'caja=-1000 gasto=1000 deuda=0 movs_pago=1%' then raise exception 'A3: %', v; end if;
  select count(*) into v_n from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = (select pay_a from fx) and e.balance_amount is not null;
  if v_n <> 1 then raise exception 'A3b: % efectos de caja y es 1 (solo el Personal que existe)', v_n; end if;
  -- Ningun Personal nuevo, ningun aviso (Marta no existe como destinataria).
  if (select count(*) from core.scope where kind = 'personal') <> v_scopes then raise exception 'A4: se creo un Personal'; end if;
  if (select count(*) from core.group_notice where scope_id = r.g) <> v_notices then raise exception 'A5: se creo un aviso sin destinatario'; end if;
  -- El pago y su detalle, con las DOS identidades de participante.
  if (select payer_participant_id::text || '>' || receiver_participant_id::text || ' ' || declared_by_receiver
        from core.payment_detail where operation_version_id = (select current_version_id from core.operation where id = (select pay_a from fx)))
     <> r.p_edu::text || '>' || r.p_marta::text || ' false' then raise exception 'A6: payment_detail'; end if;
  if pg_temp.gp_allocation(r.edu, (select pay_a from fx)) <> 'settlement Edu>Marta:1000' then raise exception 'A7: %', pg_temp.gp_allocation(r.edu, (select pay_a from fx)); end if;
  -- Sin renta ni gasto nuevo: economica de la version vacia.
  select count(*) into v_n from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = (select pay_a from fx) and e.economic_amount is not null;
  if v_n <> 0 then raise exception 'A8: el pago escribio efecto economico'; end if;
  raise notice 'A · Edu salda con Marta (sin cuenta): deuda cerrada, caja solo en su Personal, pago con las dos identidades, sin Personal ni aviso inventados: OK';
end $a$;

-- ===== B · simetrico: Marta debe a Edu; Edu, receptor, declara ==============
do $b$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  perform pg_temp.gasto(r.edu, 'a4000000-0000-4000-8000-000000000042'::uuid, r.p_edu, array[r.p_edu, r.p_marta], 2000);
  if pg_temp.gp_pairs(r.g) <> 'Marta>Edu:1000' then raise exception 'B0: %', pg_temp.gp_pairs(r.g); end if;
  v := pg_temp.gp_pay(r.edu, 'a4000000-0000-4000-8000-000000000052'::uuid, r.g, r.p_marta, r.p_edu, 1000, pg_temp.gp_expected(r.g));
  if v not like 'OK %' then raise exception 'B1: cobrar de quien no tiene cuenta: %', v; end if;
  update fx set pay_b = substr(v, 4)::uuid;
  if pg_temp.gp_pairs(r.g) <> '-' then raise exception 'B2: %', pg_temp.gp_pairs(r.g); end if;
  -- Caja de Edu: -1000 (A) -2000 (pago el gasto) +1000 (cobro) = -2000; gasto 2000.
  v := pg_temp.gp_personal(r.edu); raise notice 'B · Personal Edu: %', v;
  if v not like 'caja=-2000 gasto=2000 deuda=0 movs_pago=2%' then raise exception 'B3: %', v; end if;
  if (select declared_by_receiver from core.payment_detail where operation_version_id = (select current_version_id from core.operation where id = (select pay_b from fx))) is distinct from true then
    raise exception 'B4: declarado por el receptor';
  end if;
  raise notice 'B · Marta (sin cuenta) paga a Edu, y Edu lo declara: deuda cerrada, caja +1000 en Edu: OK';
end $b$;

-- ===== C · rechazos ==========================================================
do $c$
declare r fx%rowtype; v text; v_n int; v_op uuid;
begin
  select * into r from fx;
  select count(*) into v_n from core.operation o where o.operation_class = 'group_payment' and exists (
    select 1 from core.payment_detail pd join core.operation_version ov on ov.id = pd.operation_version_id where ov.operation_id = o.id and pd.scope_id = r.g);
  -- C1 · Bea, con cuenta y miembro, no es parte: no registra el pago de Edu a Marta.
  v := pg_temp.gp_pay(r.bea, 'a4000000-0000-4000-8000-000000000053'::uuid, r.g, r.p_edu, r.p_marta, 1000, pg_temp.gp_expected(r.g));
  if v not like 'NOT_AUTHORIZED%' then raise exception 'C1: un tercero registro un pago ajeno: %', v; end if;
  -- C2 · entre dos sin cuenta no hay quien declare: ni Edu (no es parte) ni nadie.
  v_op := pg_temp.gasto(r.edu, 'a4000000-0000-4000-8000-000000000044'::uuid, r.p_dani, array[r.p_marta, r.p_dani], 2000);
  v := pg_temp.gp_pay(r.edu, 'a4000000-0000-4000-8000-000000000054'::uuid, r.g, r.p_marta, r.p_dani, 1000, pg_temp.gp_expected(r.g));
  if v not like 'NOT_AUTHORIZED%' then raise exception 'C2: un pago entre dos sin cuenta se registro: %', v; end if;
  -- Ese gasto se anula (Edu, miembro; sin caja de nadie) para no dejar a Marta con neto cero en D.
  v := pg_temp.gp_annul(r.edu, 'a4000000-0000-4000-8000-000000000074'::uuid, v_op);
  if v <> 'OK' then raise exception 'C2b: %', v; end if;
  if (select count(*) from core.operation o where o.operation_class = 'group_payment' and exists (
        select 1 from core.payment_detail pd join core.operation_version ov on ov.id = pd.operation_version_id where ov.operation_id = o.id and pd.scope_id = r.g)) <> v_n then
    raise exception 'C3: un rechazo escribio';
  end if;
  raise notice 'C · un tercero con cuenta no registra pagos ajenos; entre dos sin cuenta nadie: OK';
end $c$;

-- ===== D · anulacion, reversion exacta, replay ==============================
do $d$
declare r fx%rowtype; v text; v_n int; v_ver uuid;
begin
  select * into r from fx;
  v_ver := (select current_version_id from core.operation where id = (select pay_a from fx));
  -- Bea (tercera) no anula el pago de Edu con Marta.
  v := pg_temp.gp_annul(r.bea, 'a4000000-0000-4000-8000-000000000071'::uuid, (select pay_a from fx));
  if v <> 'NOT_AUTHORIZED' then raise exception 'D1: un tercero anulo: %', v; end if;
  -- Edu anula A: el par Edu>Marta vuelve, su caja recupera los 1000, la version anulada no tiene efectos.
  v := pg_temp.gp_annul(r.edu, 'a4000000-0000-4000-8000-000000000072'::uuid, (select pay_a from fx));
  if v <> 'OK' then raise exception 'D2: %', v; end if;
  if pg_temp.gp_pairs(r.g) <> 'Edu>Marta:1000' then raise exception 'D3: %', pg_temp.gp_pairs(r.g); end if;
  v := pg_temp.gp_personal(r.edu); raise notice 'D · Personal Edu tras anular A: %', v;
  if v not like 'caja=-1000 gasto=2000 deuda=-1000 movs_pago=1%' then raise exception 'D4: %', v; end if;
  select count(*) into v_n from core.current_effect e join core.operation_version ov on ov.id = e.operation_version_id where ov.operation_id = (select pay_a from fx);
  if v_n <> 0 then raise exception 'D5: la version anulada conserva efectos vigentes'; end if;
  -- El detalle historico se conserva, y el replay de la anulacion no escribe otra version.
  if pg_temp.gp_allocation(r.edu, (select pay_a from fx)) <> 'settlement Edu>Marta:1000' then raise exception 'D6: %', pg_temp.gp_allocation(r.edu, (select pay_a from fx)); end if;
  -- Misma clave, MISMA intencion (la version que se anulo): replay. Con otra
  -- intencion la clave se rehusa (IDEMPOTENCY_KEY_REUSED), que es lo correcto.
  v := pg_temp.gp_annul(r.edu, 'a4000000-0000-4000-8000-000000000072'::uuid, (select pay_a from fx), v_ver);
  if v <> 'REPLAY' then raise exception 'D7: %', v; end if;
  select count(*) into v_n from core.operation_version where operation_id = (select pay_a from fx);
  if v_n <> 2 then raise exception 'D8: % versiones y son 2', v_n; end if;
  -- Y se vuelve a saldar (replay de la clave de A: ya no es la misma intencion → otra clave).
  v := pg_temp.gp_pay(r.edu, 'a4000000-0000-4000-8000-000000000055'::uuid, r.g, r.p_edu, r.p_marta, 1000, pg_temp.gp_expected(r.g));
  if v not like 'OK %' then raise exception 'D9: %', v; end if;
  raise notice 'D · anular revierte exactamente la caja y la deuda; un tercero no; replay sin segunda version: OK';
end $d$;

-- ===== E · coherencia con la reclamacion (F10, sin implementarlo) ===========
do $e$
declare r fx%rowtype; v_n int; v_t text;
begin
  select * into r from fx;
  -- Antes de reclamar, Bea no ve ningun pago suyo; Marta no existe como cuenta.
  perform pg_temp.actor(r.bea);
  select count(*) into v_n from api.my_group_payment();
  if v_n <> 0 then raise exception 'E0: Bea ya ve pagos suyos'; end if;
  perform pg_temp.super();
  -- Si Bea reclamara a Marta (lo que hace redeem_invitation con «claim»: un
  -- vinculo por identificador estable, nunca por nombre), los pagos en los que
  -- Marta es parte le llegan por vinculo, con su estado (anulado o vigente).
  -- Aqui se simula SOLO el vinculo, como postgres, para medir la lectura.
  update core.participant_user_link set participant_id = r.p_marta where participant_id = r.p_bea;
  perform pg_temp.actor(r.bea);
  select count(*) into v_n from api.my_group_payment();
  if v_n <> 3 then raise exception 'E1: Bea ve % pagos de Marta y son 3 (A anulado, B, D9)', v_n; end if;
  select string_agg(case when annulled then 'anulado' else 'vigente' end, ' ' order by effective_date, operation_id) into v_t from api.my_group_payment();
  -- Su caja NUNCA se escribio: Personal de Bea sin filas de pago ni saldo.
  if (select count(*) from api.personal_operation where operation_class = 'group_payment') <> 0 then raise exception 'E2: aparecio caja de pagos anteriores a la reclamacion'; end if;
  if (select balance_amount from api.personal_balance) <> '0' then raise exception 'E3: el Disponible de Bea se movio'; end if;
  perform pg_temp.super();
  raise notice 'E · tras un vinculo por identificador estable, los pagos de Marta llegan a Bea con su estado (%), sin caja inventada: OK', v_t;
end $e$;

-- ===== F · la campana de quien salio =========================================
do $f2$
declare r fx%rowtype; v text; v_n int;
begin
  select * into r from fx;
  update core.participant_user_link set participant_id = r.p_bea where user_id = r.bea;  -- deshacer E
  -- Bea paga 2000 entre Edu y Bea → Edu>Bea 1000; Edu paga (aviso a Bea); Bea sale a cero; Edu anula (aviso a Bea, fuera).
  perform pg_temp.gasto(r.bea, 'a4000000-0000-4000-8000-000000000045'::uuid, r.p_bea, array[r.p_edu, r.p_bea], 2000);
  v := pg_temp.gp_pay(r.edu, 'a4000000-0000-4000-8000-000000000056'::uuid, r.g, r.p_edu, r.p_bea, 1000, pg_temp.gp_expected(r.g));
  if v not like 'OK %' then raise exception 'F1: %', v; end if;
  update fx set pay_f = substr(v, 4)::uuid;
  v := pg_temp.gp_leave(r.bea, 'a4000000-0000-4000-8000-000000000061'::uuid, r.g);
  if v <> 'OK' then raise exception 'F2: %', v; end if;
  v := pg_temp.gp_annul(r.edu, 'a4000000-0000-4000-8000-000000000073'::uuid, (select pay_f from fx));
  if v <> 'OK' then raise exception 'F3: %', v; end if;
  -- Bea, fuera: dos avisos de pago sin leer; abrir la campana los da por leidos.
  perform pg_temp.actor(r.bea);
  select count(*) into v_n from api.group_notice where read_at is null;
  if v_n <> 2 then raise exception 'F4: Bea tiene % avisos sin leer y son 2', v_n; end if;
  v_n := api.mark_group_notices_seen((select id from api.group_notice order by occurred_at desc limit 1));
  if v_n <> 2 then raise exception 'F5: mark_group_notices_seen marco % y son 2 (los de pago, sin membresia)', v_n; end if;
  select count(*) into v_n from api.group_notice where read_at is null;
  if v_n <> 0 then raise exception 'F6: quedan % sin leer', v_n; end if;
  perform pg_temp.super();
  -- Un aviso que llegue DESPUES sigue pendiente: Edu registra otro pago con Bea... no puede (Bea fuera, sin par reabierto
  -- salvo el que la anulacion reabrio): lo salda por la excepcion → aviso nuevo a Bea, sin leer.
  v := pg_temp.gp_pay(r.edu, 'a4000000-0000-4000-8000-000000000057'::uuid, r.g, r.p_edu, r.p_bea, 1000, pg_temp.gp_expected(r.g));
  if v not like 'OK %' then raise exception 'F7: %', v; end if;
  perform pg_temp.actor(r.bea);
  select count(*) into v_n from api.group_notice where read_at is null;
  if v_n <> 1 then raise exception 'F8: el aviso nuevo no queda pendiente (%)', v_n; end if;
  perform api.mark_group_notice_read((select id from api.group_notice where read_at is null));
  if (select count(*) from api.group_notice where read_at is null) <> 0 then raise exception 'F9: mark_group_notice_read no marco el aviso de pago sin membresia'; end if;
  perform pg_temp.super();
  raise notice 'F · quien salio da por leidos sus avisos de pago al abrir la campana; los que lleguen despues quedan pendientes: OK';
end $f2$;

rollback;
