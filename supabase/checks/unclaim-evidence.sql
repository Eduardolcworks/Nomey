-- ============================================================================
-- RECTIFICAR UNA RECLAMACION («ME EQUIVOQUE DE PARTICIPANTE») · ADR-037
-- ============================================================================
--
-- Contra la funcion REAL, api.unclaim_participant (20260912160000). Cada
-- clase de escritura posterior a una reclamacion se enfrenta a la
-- rectificacion: las permitidas se ejecutan de verdad dentro de un sub-bloque
-- que se deshace con una excepcion —las variables conservan lo medido— para
-- seguir con la misma fixture; las bloqueadas no cambian nada y se leen del
-- error. Lo que se mide en la cuenta reclamante: caja (personal_balance),
-- lista de caja (personal_operation), cuotas (personal_expense_share), deuda
-- atribuida (claimed_dimension) y las lecturas del grupo (your_share,
-- is_self). Todo con fixtures y ROLLBACK.
--
-- Secciones:
--   A · antes de reclamar: nada de la cuenta en el grupo
--   B · reclamar: atribucion retroactiva, sin efectos; rectificar la deshace
--   C · gasto POSTERIOR de otro con la reclamada como PARTICIPANTE (permitido)
--   D · gasto POSTERIOR de otro con la reclamada como PAGADORA (bloquea, con la operacion)
--   E · el mismo, corregido a otro pagador; y anulado (permitido)
--   G · liquidacion sin caja que la nombra (permitido)
--   H · autoria de la reclamada (permitido; la autoria se conserva)
--   I · permisos y aislamiento del provisioner; quien no puede
--   J · rectificacion REAL: historial y efectos intactos; Personal y acceso
--   K · claves: reintento tras una nueva reclamacion; comando nuevo contra la superada
--   L · procedencia ausente (creador) y ambigua (el relleno no la inventa)
--   M · invitacion caducada tras rectificar: la rectificacion no se revierte
--   F · liquidacion por transferencia con la reclamada como pagadora (bloquea)
\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated, nomey_provisioner;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3900000-0000-4000-8000-0000000000a1'::uuid as edu,
  'a3900000-0000-4000-8000-0000000000b1'::uuid as ana,
  'a3900000-0000-4000-8000-0000000000c1'::uuid as zoe,   -- con cuenta, sin relacion con el grupo
  'a3900000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a3900000-0000-4000-8000-0000000000f2'::uuid as s_ana,
  'a3900000-0000-4000-8000-0000000000f3'::uuid as s_zoe,
  'a3900000-0000-4000-8000-000000000010'::uuid as g,
  'a3900000-0000-4000-8000-000000000031'::uuid as p_edu,
  'a3900000-0000-4000-8000-000000000032'::uuid as p_ana,
  'a3900000-0000-4000-8000-000000000061'::uuid as claim, -- la reclamacion de B
  null::uuid as cat, null::text as token, null::uuid as e_pay, null::uuid as e_part, null::uuid as e_tr;
grant select, update on fx to authenticated;

-- La foto de la cuenta de Ana: lo que Personal y el grupo le atribuyen.
create function pg_temp.foto(p_scope uuid, p_participant uuid) returns text language sql as $$
  select 'caja=' || coalesce((select balance_amount from api.personal_balance), 'nula')
      || ' filas_caja_grupo=' || (select count(*) from api.personal_operation where operation_class = 'group_expense')
      || ' cuotas=' || coalesce((select sum(share_amount::bigint) from api.personal_expense_share(null, null)), 0)
      || ' deuda=' || coalesce((select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt'), 0)
      || ' your_share=' || coalesce((select string_agg(coalesce(your_share, '-'), ',' order by operation_created_at) from api.group_operation where scope_id = p_scope), '')
      || ' is_self=' || coalesce((select is_self::text from api.group_participant where participant_id = p_participant), 'nulo');
$$;
grant execute on function pg_temp.foto(uuid, uuid) to authenticated;

-- LA RECTIFICACION REAL, como Ana, contra la reclamacion que creo su vinculo
-- (o contra la que se indique). Devuelve el resultado o el codigo del error
-- con sus detalles; un error deshace lo suyo y no toca nada.
create function pg_temp.rectificar(p_key uuid, p_claim uuid default null, p_who uuid default null) returns text
language plpgsql as $$
declare r fx%rowtype; v jsonb;
begin
  select * into r from fx;
  perform pg_temp.actor(coalesce(p_who, r.ana));
  v := api.unclaim_participant(jsonb_build_object(
    'client_command_id', p_key, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_ana, 'claim_command_id', coalesce(p_claim, r.claim)));
  return 'OK already_processed=' || (v ->> 'already_processed');
exception when sqlstate 'PGRST' then
  return (sqlerrm::json ->> 'code') || coalesce(' ' || (sqlerrm::json ->> 'details'), '');
end $$;
grant execute on function pg_temp.rectificar(uuid, uuid, uuid) to authenticated;

do $f$
declare r fx%rowtype; v_out jsonb;
begin
  select * into r from fx;
  perform pg_temp.super();
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_ana, 'personal', r.eur, r.ana), (r.s_zoe, 'personal', r.eur, r.zoe);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_ana, r.ana), (r.s_zoe, r.zoe);
  perform pg_temp.actor(r.edu);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3900000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Unclaim', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_ana, 'display_name', 'Ana'))));
  -- Presencias desde hace diez dias, para poder fechar E0 antes de hoy.
  perform pg_temp.super();
  update core.participant_period pp set valid_from = current_date - 10
    from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;
  perform pg_temp.actor(r.edu);
  -- E0: ANTES de reclamar, Edu paga 900 entre los dos (Ana debe 450).
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '900',
    'effective_date', (current_date - 3)::text, 'concept', 'Antes', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_out := api.create_group_invitation(jsonb_build_object('client_command_id', 'a3900000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
  update fx set token = v_out ->> 'token';
  perform pg_temp.super();
end
$f$;

-- ============================ A · antes de reclamar ==========================
do $a$
declare r fx%rowtype; v_t text; v_res text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.ana);
  v_t := pg_temp.foto(r.g, r.p_ana);
  raise notice 'A · Ana antes de reclamar: %', v_t;
  if v_t not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0 your_share= is_self=nulo' then
    raise exception 'A: la cuenta ya tiene algo del grupo antes de reclamar: %', v_t;
  end if;
  -- Sin membresia no hay nada que rectificar: NOT_AUTHORIZED, bajo el cerrojo.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a0'::uuid);
  if v_res <> 'NOT_AUTHORIZED' then raise exception 'A2: rectificar sin ser miembro respondio %', v_res; end if;
  perform pg_temp.super();
  raise notice 'A · sin membresia, rectificar responde NOT_AUTHORIZED: OK';
end
$a$;

-- ============================ B · reclamar ===================================
do $b$
declare r fx%rowtype; v_t text; v_n int; v_after text; v_res text; v_claim uuid;
begin
  select * into r from fx;
  perform pg_temp.super();
  select count(*) into v_n from core.effect;
  perform pg_temp.actor(r.ana);
  perform api.redeem_invitation(jsonb_build_object('client_command_id', r.claim, 'command_contract_version', 1,
    'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
  v_t := pg_temp.foto(r.g, r.p_ana);
  raise notice 'B · Ana tras reclamar: %', v_t;
  -- La lectura publica la procedencia del vinculo PROPIO (y solo del propio); no dice
  -- que pueda rectificarse ahora (eso lo decide el servidor bajo el cerrojo).
  if ((select claim_command_id from api.group_participant where participant_id = r.p_ana) = r.claim) is not true then
    raise exception 'B0: la lectura no publica la procedencia del vinculo propio';
  end if;
  if (select claim_command_id from api.group_participant where participant_id = r.p_edu) is not null then
    raise exception 'B0b: la lectura publica la procedencia del vinculo de OTRO';
  end if;
  perform pg_temp.super();
  if (select count(*) from core.effect) <> v_n then raise exception 'B: reclamar escribio efectos'; end if;
  select claim_command_id into v_claim from core.participant_user_link where participant_id = r.p_ana;
  if v_claim is distinct from r.claim then raise exception 'B1: el vinculo no lleva la procedencia de la reclamacion (%)', v_claim; end if;
  -- La atribucion es retroactiva: cuota 450 y deuda -450 de E0, sin caja.
  if v_t not like 'caja=0 filas_caja_grupo=0 cuotas=450 deuda=-450 your_share=450 is_self=true' then
    raise exception 'B: atribucion inesperada: %', v_t;
  end if;
  -- Rectificar ahora deja EXACTAMENTE la foto de antes: reversible.
  begin
    v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a1'::uuid);
    perform pg_temp.actor(r.ana);
    v_after := pg_temp.foto(r.g, r.p_ana);
    raise exception using errcode = 'P0001', message = 'SIMULACION';
  exception when others then
    if sqlerrm <> 'SIMULACION' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'B · rectificar: % · Ana despues: %', v_res, v_after;
  if v_res <> 'OK already_processed=false' then raise exception 'B2: %', v_res; end if;
  if v_after not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0 your_share= is_self=nulo' then
    raise exception 'B: la rectificacion no vuelve al estado previo: %', v_after;
  end if;
  raise notice 'B · reclamar no escribe efectos; rectificar sin actividad devuelve la foto previa, sin acceso al grupo: OK (PERMITIDO)';
end
$b$;

-- ===== C · gasto posterior de OTRO con la reclamada como participante ========
do $c$
declare r fx%rowtype; v_t text; v_after text; v_out jsonb; v_res text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000042'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '100',
    'effective_date', current_date::text, 'concept', 'Participa', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e_part = (v_out ->> 'operation_id')::uuid;
  perform pg_temp.actor(r.ana);
  v_t := pg_temp.foto(r.g, r.p_ana);
  raise notice 'C · Ana con un gasto de Edu en el que participa: %', v_t;
  begin
    v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a2'::uuid);
    perform pg_temp.actor(r.ana);
    v_after := pg_temp.foto(r.g, r.p_ana);
    -- Y lo que ve Edu: la deuda de «Ana» (participante) sigue integra.
    perform pg_temp.actor(r.edu);
    v_after := v_after || ' | edu_deuda=' || coalesce((select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt'), 0);
    raise exception using errcode = 'P0001', message = 'SIMULACION';
  exception when others then
    if sqlerrm <> 'SIMULACION' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'C · rectificar: % · despues: %', v_res, v_after;
  if v_res <> 'OK already_processed=false' then raise exception 'C2: %', v_res; end if;
  if v_after not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0 %| edu_deuda=500' then
    raise exception 'C: %', v_after;
  end if;
  raise notice 'C · participar (sin pagar) no deja nada en la cuenta; la deuda de Edu contra «Ana» sigue: OK (PERMITIDO)';
end
$c$;

-- ===== D · gasto posterior de OTRO con la reclamada como PAGADORA ============
do $d$
declare r fx%rowtype; v_t text; v_after text; v_out jsonb; v_res text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000043'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000',
    'effective_date', current_date::text, 'concept', 'Paga Ana', 'category_id', r.cat,
    'payer_participant_id', r.p_ana, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e_pay = (v_out ->> 'operation_id')::uuid;
  select * into r from fx;
  perform pg_temp.actor(r.ana);
  v_t := pg_temp.foto(r.g, r.p_ana);
  raise notice 'D · Ana pagadora (registrado por Edu): %', v_t;
  if v_t not like 'caja=-2000 filas_caja_grupo=1%' then raise exception 'D: la caja no llego al Personal de Ana por el vinculo: %', v_t; end if;
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a3'::uuid);
  perform pg_temp.actor(r.ana);
  v_after := pg_temp.foto(r.g, r.p_ana);
  perform pg_temp.super();
  raise notice 'D · rectificar: % · despues: %', v_res, v_after;
  -- Se rehusa CON la operacion que bloquea, y nada cambia: la caja (-2000)
  -- sigue atribuida a quien sigue vinculada.
  -- Con la operacion descrita (clase, concepto, importe como texto, fecha), y solo esa.
  if v_res not like 'UNCLAIM_BLOCKED_CASH {"operations": [{%' or v_res not like '%"operation_id": "' || r.e_pay || '"%'
     or v_res not like '%"operation_class": "group_expense"%' or v_res not like '%"concept": "Paga Ana"%'
     or v_res not like '%"amount": "2000"%' or (length(v_res) - length(replace(v_res, 'operation_id', ''))) / length('operation_id') <> 1 then
    raise exception 'D2: %', v_res;
  end if;
  if v_after <> v_t then raise exception 'D3: un bloqueo cambio algo: % → %', v_t, v_after; end if;
  if not exists (select 1 from core.participant_user_link where participant_id = r.p_ana) then raise exception 'D4: el vinculo se fue'; end if;
  raise notice 'D · un gasto de otro con ella como pagadora BLOQUEA, con la operacion, y no cambia nada';
end
$d$;

-- ===== E · corregido a otro pagador; anulado =================================
do $e$
declare r fx%rowtype; v_ver uuid; v_after text; v_n int; v_res text;
begin
  select * into r from fx;
  -- E1 · Edu corrige: ahora paga Edu.
  perform pg_temp.super();
  select current_version_id into v_ver from core.operation where id = r.e_pay;
  perform pg_temp.actor(r.edu);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000044'::uuid, 'command_contract_version', 1,
    'operation_id', r.e_pay, 'expected_version_id', v_ver,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000',
    'effective_date', current_date::text, 'concept', 'Paga Edu', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  begin
    v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a4'::uuid);
    perform pg_temp.actor(r.ana);
    v_after := pg_temp.foto(r.g, r.p_ana);
    raise exception using errcode = 'P0001', message = 'SIMULACION';
  exception when others then
    if sqlerrm <> 'SIMULACION' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'E1 · corregido a otro pagador; rectificar: % · despues: %', v_res, v_after;
  if v_res <> 'OK already_processed=false' then raise exception 'E1: %', v_res; end if;
  if v_after not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0%' then raise exception 'E1: %', v_after; end if;
  -- El efecto de caja de la version superada sigue en core.effect, referido al
  -- Personal de Ana, pero NO es vigente: ninguna lectura lo publica.
  select count(*) into v_n from core.effect e where e.scope_id = r.s_ana and e.balance_amount is not null;
  if v_n <> 1 then raise exception 'E1b: se esperaba 1 efecto de caja historico (superado) en el Personal de Ana, hay %', v_n; end if;
  select count(*) into v_n from core.current_effect e where e.scope_id = r.s_ana and e.balance_amount is not null;
  if v_n <> 0 then raise exception 'E1c: la caja superada sigue vigente'; end if;
  raise notice 'E1 · tras corregir el pagador, la caja vigente de Ana esta limpia (la superada no se publica): PERMITIDO';
  -- E2 · Edu anula el gasto entero.
  perform pg_temp.super();
  select current_version_id into v_ver from core.operation where id = r.e_pay;
  perform pg_temp.actor(r.edu);
  perform api.annul_operation(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000045'::uuid, 'command_contract_version', 2,
    'operation_id', r.e_pay, 'expected_version_id', v_ver));
  begin
    v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a5'::uuid);
    perform pg_temp.actor(r.ana);
    v_after := pg_temp.foto(r.g, r.p_ana);
    raise exception using errcode = 'P0001', message = 'SIMULACION';
  exception when others then
    if sqlerrm <> 'SIMULACION' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'E2 · anulado; rectificar: % · despues: %', v_res, v_after;
  if v_res <> 'OK already_processed=false' then raise exception 'E2: %', v_res; end if;
  if v_after not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0%' then raise exception 'E2: %', v_after; end if;
  raise notice 'E2 · anulado, nada vigente en su Personal: PERMITIDO';
end
$e$;

-- ===== G · liquidacion SIN caja que la nombra ================================
do $h$
declare r fx%rowtype; v_after text; v_res text;
begin
  select * into r from fx;
  -- Edu declara que Ana le pago 50 fuera de la app: solo deuda, sin caja.
  perform pg_temp.actor(r.edu);
  perform api.record_debt_settlement(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000048'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '50', 'effective_date', current_date::text,
    'debtor_participant_id', r.p_ana, 'creditor_participant_id', r.p_edu));
  begin
    v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a6'::uuid);
    perform pg_temp.actor(r.ana);
    v_after := pg_temp.foto(r.g, r.p_ana);
    perform pg_temp.actor(r.edu);
    v_after := v_after || ' | edu_deuda=' || coalesce((select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt'), 0);
    raise exception using errcode = 'P0001', message = 'SIMULACION';
  exception when others then
    if sqlerrm <> 'SIMULACION' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'G · liquidacion sin caja; rectificar: % · despues: %', v_res, v_after;
  if v_res <> 'OK already_processed=false' then raise exception 'G: %', v_res; end if;
  if v_after not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0 %| edu_deuda=450' then raise exception 'G: %', v_after; end if;
  raise notice 'G · la liquidacion sin caja sigue al participante, no a la cuenta: PERMITIDO';
end
$h$;

-- ===== H · autoria de la reclamada ==========================================
do $i$
declare r fx%rowtype; v_after text; v_n int; v_res text;
begin
  select * into r from fx;
  -- Ana registra un gasto pagado por EDU: no le entra caja; solo es autora.
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000049'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '40',
    'effective_date', current_date::text, 'concept', 'Autora', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  begin
    v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a7'::uuid);
    perform pg_temp.actor(r.ana);
    v_after := pg_temp.foto(r.g, r.p_ana);
    perform pg_temp.super();
    select count(*) into v_n from core.operation_version ov where ov.created_by = r.ana;
    raise exception using errcode = 'P0001', message = 'SIMULACION';
  exception when others then
    if sqlerrm <> 'SIMULACION' then raise; end if;
  end;
  perform pg_temp.super();
  raise notice 'H · autora; rectificar: % · despues: % (versiones firmadas por su cuenta: %)', v_res, v_after, v_n;
  if v_res <> 'OK already_processed=false' then raise exception 'H: %', v_res; end if;
  if v_after not like 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0%' then raise exception 'H: %', v_after; end if;
  if v_n <> 1 then raise exception 'H2: la autoria de Ana no se conservo (%)', v_n; end if;
  raise notice 'H · la autoria queda en la version (como la de quien salio, ADR-034) y no deja caja ni cuota: PERMITIDO con la autoria conservada';
end
$i$;

-- ===== I · permisos y aislamiento del provisioner; quien no puede ===========
do $j$
declare r fx%rowtype; v_res text; v_n int;
begin
  select * into r from fx;
  -- I1 · otra cuenta, no miembro: NOT_AUTHORIZED, y sin tocar nada.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000a8'::uuid, null, r.zoe);
  if v_res <> 'NOT_AUTHORIZED' then raise exception 'I1: %', v_res; end if;
  -- I2 · Edu, miembro y creador: su vinculo no procede de una reclamacion.
  perform pg_temp.actor(r.edu);
  begin
    perform api.unclaim_participant(jsonb_build_object(
      'client_command_id', 'a3900000-0000-4000-8000-0000000000a9'::uuid, 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_edu, 'claim_command_id', r.claim));
    raise exception 'I2: el creador rectifico';
  exception when sqlstate 'PGRST' then
    v_res := sqlerrm::json ->> 'code';
  end;
  if v_res <> 'UNCLAIM_NOT_AVAILABLE' then raise exception 'I2: %', v_res; end if;
  -- I3 · Edu, sobre el participante de Ana: no es su vinculo → CLAIM_SUPERSEDED (no revela nada mas).
  perform pg_temp.actor(r.edu);
  begin
    perform api.unclaim_participant(jsonb_build_object(
      'client_command_id', 'a3900000-0000-4000-8000-0000000000aa'::uuid, 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana, 'claim_command_id', r.claim));
    raise exception 'I3: Edu rectifico el vinculo de Ana';
  exception when sqlstate 'PGRST' then
    v_res := sqlerrm::json ->> 'code';
  end;
  if v_res <> 'CLAIM_SUPERSEDED' then raise exception 'I3: %', v_res; end if;
  -- I4 · Ana con OTRA clave de reclamacion: no es la que creo el vinculo.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000ab'::uuid, 'a3900000-0000-4000-8000-000000000099'::uuid);
  if v_res <> 'CLAIM_SUPERSEDED' then raise exception 'I4: %', v_res; end if;
  perform pg_temp.super();
  if not exists (select 1 from core.participant_user_link where participant_id = r.p_ana and claim_command_id = r.claim) then
    raise exception 'I5: algun rechazo toco el vinculo';
  end if;
  -- I6 · permisos reales: la funcion es del provisioner; la frontera de caja
  --      solo la ejecuta el provisioner; el cliente no toca el hecho ni el vinculo.
  if (select pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'api' and p.proname = 'unclaim_participant') <> 'nomey_provisioner' then
    raise exception 'I6: unclaim_participant no es del provisioner';
  end if;
  if has_function_privilege('authenticated', 'sec.unclaim_blocking_operations(uuid)', 'execute')
     or has_function_privilege('nomey_writer', 'sec.unclaim_blocking_operations(uuid)', 'execute')
     or not has_function_privilege('nomey_provisioner', 'sec.unclaim_blocking_operations(uuid)', 'execute') then
    raise exception 'I6b: el execute de unclaim_blocking_operations no es solo del provisioner';
  end if;
  if has_any_column_privilege('authenticated', 'core.participant_unclaim', 'select')
     or has_any_column_privilege('authenticated', 'core.participant_user_link', 'select')
     or has_table_privilege('nomey_provisioner', 'core.participant_unclaim', 'update')
     or has_table_privilege('nomey_provisioner', 'core.participant_unclaim', 'delete') then
    raise exception 'I6c: privilegios de mas sobre el hecho o el vinculo';
  end if;
  -- I7 · aislamiento: como provisioner, los efectos del GRUPO no se ven (solo
  --      los del Personal propio); la frontera los cruza a proposito y devuelve
  --      solo ids de operaciones del actor.
  perform set_config('request.jwt.claims', json_build_object('sub', r.ana::text)::text, true);
  perform set_config('role', 'nomey_provisioner', true);
  select count(*) into v_n from core.effect where scope_id = r.g;
  if v_n <> 0 then raise exception 'I7: el provisioner ve % efectos del grupo', v_n; end if;
  select count(*) into v_n from sec.unclaim_blocking_operations(r.g);
  if v_n <> 0 then raise exception 'I7b: ahora no hay caja que bloquee, y la frontera devolvio %', v_n; end if;
  if (select count(*) from core.scope where id = r.g) <> 1 then raise exception 'I7c: el provisioner miembro no ve el grupo'; end if;
  perform pg_temp.super();
  raise notice 'I · no miembro, creador sin procedencia, vinculo ajeno y clave equivocada rehusan sin tocar nada; permisos y aislamiento del provisioner intactos: OK';
end
$j$;

-- ===== J · rectificacion REAL: historial, efectos, Personal y acceso =========
do $k$
declare r fx%rowtype; v_res text; v_before text; v_after text; v_n int;
begin
  select * into r from fx;
  perform pg_temp.super();
  v_before := (select count(*) from core.effect) || '/' || (select count(*) from core.operation_version)
    || '/' || (select count(*) from core.split_participant where scope_id = r.g)
    || '/' || (select count(*) from core.operation_version where created_by = r.ana)
    || '/' || (select count(*) from core.participant_period pp join core.participant p on p.id = pp.participant_id where p.scope_id = r.g and pp.valid_until is null);
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000b0'::uuid);
  if v_res <> 'OK already_processed=false' then raise exception 'J0: %', v_res; end if;
  perform pg_temp.super();
  v_after := (select count(*) from core.effect) || '/' || (select count(*) from core.operation_version)
    || '/' || (select count(*) from core.split_participant where scope_id = r.g)
    || '/' || (select count(*) from core.operation_version where created_by = r.ana)
    || '/' || (select count(*) from core.participant_period pp join core.participant p on p.id = pp.participant_id where p.scope_id = r.g and pp.valid_until is null);
  raise notice 'J · efectos/versiones/reparto/autoria de Ana/presencias abiertas: % → %', v_before, v_after;
  if v_before <> v_after then raise exception 'J1: la rectificacion toco historial, efectos o presencia'; end if;
  if exists (select 1 from core.participant_user_link where participant_id = r.p_ana) then raise exception 'J2: el vinculo sigue'; end if;
  if exists (select 1 from core.membership where scope_id = r.g and user_id = r.ana) then raise exception 'J3: la membresia sigue'; end if;
  select count(*) into v_n from core.participant_unclaim where scope_id = r.g and participant_id = r.p_ana and user_id = r.ana and claim_command_id = r.claim;
  if v_n <> 1 then raise exception 'J4: el hecho no quedo (%)', v_n; end if;
  if exists (select 1 from core.group_departure where scope_id = r.g and user_id = r.ana) then raise exception 'J5: se registro una salida'; end if;
  if exists (select 1 from core.group_notice where scope_id = r.g and kind = 'departure') then raise exception 'J6: se aviso una salida'; end if;
  -- Personal de Ana: sin nada del grupo; y sin acceso a el.
  perform pg_temp.actor(r.ana);
  v_after := pg_temp.foto(r.g, r.p_ana);
  if v_after <> 'caja=0 filas_caja_grupo=0 cuotas=0 deuda=0 your_share= is_self=nulo' then raise exception 'J7: %', v_after; end if;
  if (select count(*) from api.group_summary where scope_id = r.g) <> 0 then raise exception 'J8: Ana sigue viendo el grupo'; end if;
  if (select count(*) from api.group_operation where scope_id = r.g) <> 0 then raise exception 'J9: Ana sigue viendo movimientos'; end if;
  if (select count(*) from api.group_participant where scope_id = r.g) <> 0 then raise exception 'J10: Ana sigue viendo participantes'; end if;
  if (select count(*) from api.group_notice where scope_id = r.g) <> 0 then raise exception 'J11: Ana sigue viendo avisos'; end if;
  -- Y lo que ve Edu: «Ana» sigue, activa, sin cuenta, con historial y disponible.
  perform pg_temp.actor(r.edu);
  if (select is_active and not is_linked and has_history and not is_retired and claim_command_id is null
        from api.group_participant where participant_id = r.p_ana) is not true then
    raise exception 'J12: Edu no ve a Ana activa, sin cuenta y con historial';
  end if;
  if (select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt') <> 470 then
    raise exception 'J13: la deuda de Edu contra «Ana» cambio';
  end if;
  perform pg_temp.super();
  if not sec.participant_available(r.p_ana, r.g) then raise exception 'J14: Ana no vuelve a estar disponible'; end if;
  raise notice 'J · rectificacion real: nada de historial, efectos ni presencia cambia; ningun aviso; Ana pierde el acceso y su Personal no atribuye nada del grupo; «Ana» sigue disponible: OK';
end
$k$;

-- ===== K · claves: reintento tras una nueva reclamacion; comando nuevo ======
do $l$
declare r fx%rowtype; v_res text; v_claim uuid; v_new constant uuid := 'a3900000-0000-4000-8000-000000000062';
begin
  select * into r from fx;
  -- Ana vuelve a reclamar a «Ana» con un comando NUEVO: vinculo nuevo, procedencia nueva.
  perform pg_temp.actor(r.ana);
  perform api.redeem_invitation(jsonb_build_object('client_command_id', v_new, 'command_contract_version', 1,
    'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
  perform pg_temp.super();
  select claim_command_id into v_claim from core.participant_user_link where participant_id = r.p_ana;
  if v_claim <> v_new then raise exception 'K0: la procedencia del vinculo nuevo no es la reclamacion nueva'; end if;
  -- K1 · REINTENTO de la rectificacion ya completada (misma clave): resultado
  --      original, y la reclamacion posterior NO se toca.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000b0'::uuid);
  if v_res <> 'OK already_processed=true' then raise exception 'K1: %', v_res; end if;
  perform pg_temp.super();
  if (select claim_command_id from core.participant_user_link where participant_id = r.p_ana) is distinct from v_new then
    raise exception 'K1b: el reintento toco la reclamacion posterior';
  end if;
  if not exists (select 1 from core.membership where scope_id = r.g and user_id = r.ana) then raise exception 'K1c: el reintento quito la membresia'; end if;
  -- K2 · COMANDO NUEVO contra la reclamacion SUPERADA (la antigua): rechazo.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000b1'::uuid, r.claim);
  if v_res <> 'CLAIM_SUPERSEDED' then raise exception 'K2: %', v_res; end if;
  -- K3 · la misma clave antigua con OTRA intencion: reutilizada.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000b0'::uuid, v_new);
  if v_res <> 'IDEMPOTENCY_KEY_REUSED' then raise exception 'K3: %', v_res; end if;
  perform pg_temp.super();
  if (select claim_command_id from core.participant_user_link where participant_id = r.p_ana) is distinct from v_new then
    raise exception 'K4: algun rechazo toco el vinculo nuevo';
  end if;
  update fx set claim = v_new;
  raise notice 'K · el reintento devuelve el resultado original sin tocar la reclamacion posterior; un comando nuevo contra la superada se rechaza; la clave con otra intencion se rechaza: OK';
end
$l$;

-- ===== L · procedencia ausente y ambigua ====================================
-- El relleno de la migracion, literal: solo con exactamente UNA reclamacion.
create function pg_temp.backfill() returns void language sql as $$
  update core.participant_user_link l
     set claim_command_id = c.client_command_id
    from (
      select pc.created_by, (pc.canonical_intent ->> 'participant_id')::uuid as participant_id,
             min(pc.client_command_id::text)::uuid as client_command_id, count(*) as n
        from core.provisioning_command pc
       where pc.command_type = 'invitation.redeem'
         and pc.canonical_intent ->> 'choice' = 'claim'
         and pc.canonical_intent ->> 'participant_id' is not null
       group by pc.created_by, (pc.canonical_intent ->> 'participant_id')::uuid
    ) c
   where c.n = 1 and c.created_by = l.user_id and c.participant_id = l.participant_id
     and l.claim_command_id is null;
$$;
do $m$
declare r fx%rowtype; v_claim uuid;
  v_luis constant uuid := 'a3900000-0000-4000-8000-0000000000d1';
  v_p_luis constant uuid := 'a3900000-0000-4000-8000-000000000033';
begin
  select * into r from fx;
  perform pg_temp.super();
  -- L1 · el creador: sin comando de reclamacion, nulo antes y despues del relleno.
  perform pg_temp.backfill();
  if (select claim_command_id from core.participant_user_link where participant_id = r.p_edu) is not null then
    raise exception 'L1: el relleno invento procedencia al creador';
  end if;
  -- L2 · ambigua: «Luis» con vinculo sin procedencia y DOS comandos de
  --      reclamacion sobre el (imposible por la API; sembrado como postgres).
  insert into core.participant (id, scope_id, display_name) values (v_p_luis, r.g, 'Luis');
  insert into core.participant_period (participant_id, valid_from, valid_until) values (v_p_luis, current_date, null);
  insert into core.membership (scope_id, user_id) values (r.g, v_luis);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (v_p_luis, r.g, v_luis);
  insert into core.provisioning_command (created_by, client_command_id, command_type, command_contract_version, canonical_intent, result_scope_id) values
    (v_luis, 'a3900000-0000-4000-8000-0000000000e1', 'invitation.redeem', 1, jsonb_build_object('choice', 'claim', 'participant_id', v_p_luis::text), r.g),
    (v_luis, 'a3900000-0000-4000-8000-0000000000e2', 'invitation.redeem', 1, jsonb_build_object('choice', 'claim', 'participant_id', v_p_luis::text), r.g);
  perform pg_temp.backfill();
  select claim_command_id into v_claim from core.participant_user_link where participant_id = v_p_luis;
  if v_claim is not null then raise exception 'L2: el relleno eligio una de dos reclamaciones (%)', v_claim; end if;
  -- Y sin procedencia, Luis no puede rectificar: UNCLAIM_NOT_AVAILABLE.
  perform pg_temp.actor(v_luis);
  begin
    perform api.unclaim_participant(jsonb_build_object(
      'client_command_id', 'a3900000-0000-4000-8000-0000000000e3'::uuid, 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', v_p_luis, 'claim_command_id', 'a3900000-0000-4000-8000-0000000000e1'::uuid));
    raise exception 'L2b: Luis rectifico sin procedencia';
  exception when sqlstate 'PGRST' then
    v_claim := null;
    if (sqlerrm::json ->> 'code') <> 'UNCLAIM_NOT_AVAILABLE' then raise exception 'L2b: %', sqlerrm::json ->> 'code'; end if;
  end;
  -- L3 · inequivoca: con un solo comando, el relleno la recupera.
  perform pg_temp.super();
  delete from core.provisioning_command where created_by = v_luis and client_command_id = 'a3900000-0000-4000-8000-0000000000e2';
  perform pg_temp.backfill();
  select claim_command_id into v_claim from core.participant_user_link where participant_id = v_p_luis;
  if v_claim <> 'a3900000-0000-4000-8000-0000000000e1' then raise exception 'L3: el relleno no recupero la procedencia inequivoca (%)', v_claim; end if;
  raise notice 'L · sin comando (creador) o con dos: nulo y sin via; con exactamente uno: recuperado. Nada por suposicion: OK';
end
$m$;

-- ===== M · invitacion caducada tras rectificar ==============================
do $n$
declare r fx%rowtype; v_res text; v_state text; v_out jsonb;
begin
  select * into r from fx;
  -- Ana rectifica (la reclamacion nueva de K) y la invitacion caduca despues.
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000b2'::uuid);
  if v_res <> 'OK already_processed=false' then raise exception 'M0: %', v_res; end if;
  perform pg_temp.super();
  update core.group_invitation set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' where scope_id = r.g;
  perform pg_temp.actor(r.ana);
  v_state := api.preview_invitation(r.token) ->> 'state';
  if v_state <> 'expired' then raise exception 'M1: la previsualizacion dice % y no expired', v_state; end if;
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', 'a3900000-0000-4000-8000-000000000063'::uuid, 'command_contract_version', 1,
    'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
  if (v_out ->> 'state') <> 'expired' then raise exception 'M2: reclamar con la caducada dio %', v_out; end if;
  perform pg_temp.super();
  -- La rectificacion hecha sigue hecha: no se revierte ni se pierde.
  if exists (select 1 from core.participant_user_link where participant_id = r.p_ana) then raise exception 'M3: el vinculo volvio'; end if;
  if exists (select 1 from core.membership where scope_id = r.g and user_id = r.ana) then raise exception 'M4: la membresia volvio'; end if;
  if (select count(*) from core.participant_unclaim where participant_id = r.p_ana) <> 2 then raise exception 'M5: faltan hechos de rectificacion'; end if;
  -- Con una invitacion valida (aqui, la misma restaurada), Ana vuelve a poder reclamar.
  update core.group_invitation set expires_at = now() + interval '1 day' where scope_id = r.g;
  perform pg_temp.actor(r.ana);
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', 'a3900000-0000-4000-8000-000000000064'::uuid, 'command_contract_version', 1,
    'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
  if (v_out ->> 'state') <> 'ok' or (v_out ->> 'already_processed') <> 'false' then raise exception 'M6: %', v_out; end if;
  update fx set claim = 'a3900000-0000-4000-8000-000000000064'::uuid;
  perform pg_temp.super();
  raise notice 'M · con la invitacion caducada, reclamar de nuevo no es posible (expired) y la rectificacion hecha no se revierte; con una valida, se vuelve a reclamar: OK';
end
$n$;

-- ===== F · liquidacion por transferencia con la reclamada como pagadora ======
do $g$
declare r fx%rowtype; v_after text; v_t text; v_res text; v_out jsonb;
begin
  select * into r from fx;
  -- Ana debe 470 a Edu (450 + 50 + 20 − 50 de G). Ana paga 100 por transferencia: caja en los dos.
  perform pg_temp.actor(r.ana);
  v_out := api.record_settlement_by_transfer(jsonb_build_object(
    'client_operation_id', 'a3900000-0000-4000-8000-000000000046'::uuid, 'command_contract_version', 1,
    'debt_scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '100', 'effective_date', current_date::text,
    'debtor_participant_id', r.p_ana, 'creditor_participant_id', r.p_edu));
  update fx set e_tr = (v_out ->> 'operation_id')::uuid;
  select * into r from fx;
  v_t := pg_temp.foto(r.g, r.p_ana);
  raise notice 'F · Ana tras pagar 100 por transferencia: %', v_t;
  v_res := pg_temp.rectificar('a3900000-0000-4000-8000-0000000000b3'::uuid);
  perform pg_temp.actor(r.ana);
  v_after := pg_temp.foto(r.g, r.p_ana);
  perform pg_temp.super();
  raise notice 'F · rectificar: % · despues: %', v_res, v_after;
  if v_res not like 'UNCLAIM_BLOCKED_CASH {"operations": [{%' or v_res not like '%"operation_id": "' || r.e_tr || '"%'
     or v_res not like '%"operation_class": "settlement_by_transfer"%' or v_res not like '%"amount": "100"%'
     or (length(v_res) - length(replace(v_res, 'operation_id', ''))) / length('operation_id') <> 1 then
    raise exception 'F2: %', v_res;
  end if;
  if v_after <> v_t or v_after not like 'caja=-100%' then raise exception 'F3: %', v_after; end if;
  raise notice 'F · la transferencia deja caja (-100) en su Personal: BLOQUEA, con la operacion, y nada cambia';
end
$g$;

rollback;
