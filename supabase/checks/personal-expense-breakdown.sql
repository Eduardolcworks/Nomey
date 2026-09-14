-- ============================================================================
-- EL DESGLOSE DE GASTOS DE PERSONAL EXPLICA SU TOTAL · api.personal_expense_share
-- ============================================================================
--
-- Fixtures propios, en una transaccion que termina en ROLLBACK. Edu (U1) con
-- su Personal; Ana (U2) con el suyo y vinculada a su participante del grupo.
-- Las secciones:
--
--   A · catalogo y privilegios: invoker en api, definer reducido en sec
--   B · cuatro gastos personales de 25 y una cuota de 10 pagada por otro: total
--       110, explicado por las cinco filas
--   C · Restaurante 20 pagado por Ana y Viajes 20 pagado por mi, a medias: dos
--       cuotas de 10, categorias 10/10; mi pago sigue siendo 20 de caja en
--       personal_operation; lo que no participo no aparece
--   D · correccion, anulacion e intervalo: las filas siguen al total
--   E · reconciliacion exacta del conjunto entero con total y categorias
--   F · aislamiento entre cuentas, e historial tras salir del grupo
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
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3600000-0000-4000-8000-0000000000a1'::uuid as edu,
  'a3600000-0000-4000-8000-0000000000b1'::uuid as ana,
  'a3600000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a3600000-0000-4000-8000-0000000000f2'::uuid as s_ana,
  'a3600000-0000-4000-8000-000000000010'::uuid as g,
  'a3600000-0000-4000-8000-000000000031'::uuid as p_edu,
  'a3600000-0000-4000-8000-000000000032'::uuid as p_ana,
  null::uuid as cat_dining, null::uuid as cat_travel,
  null::uuid as e_rest, null::uuid as e_trip;
grant select, update on fx to authenticated;

do $f$
declare r fx%rowtype; v_out jsonb; i int;
begin
  select * into r from fx;
  perform pg_temp.super();
  update fx set cat_dining = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null),
                cat_travel = (select id from core.category where message_key = 'category.expense.travel' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_ana, 'personal', r.eur, r.ana);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_ana, r.ana);

  perform pg_temp.actor(r.edu);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3600000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Brasil', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_ana, 'display_name', 'Aitor'))));
  perform pg_temp.super();
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.p_ana, r.g, r.ana);
  insert into core.membership (scope_id, user_id) values (r.g, r.ana);

  -- B · cuatro gastos personales de 25,00 de Edu
  perform pg_temp.actor(r.edu);
  for i in 1..4 loop
    perform api.record_personal_expense(jsonb_build_object(
      'client_operation_id', ('a3600000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
      'command_contract_version', 2,
      'effective_date', current_date::text, 'effective_time', '09:0' || i,
      'scope_id', r.s_edu, 'amount', '2500', 'currency_definition_id', r.eur,
      'concept', 'Personal ' || i, 'category_id', r.cat_dining));
  end loop;
  perform pg_temp.super();
end
$f$;

-- ============================ A · catalogo ===================================
do $a$
declare fallos text[] := '{}'; v_t text;
begin
  if exists (select 1 from pg_proc where oid = 'api.personal_expense_share(date,date)'::regprocedure and prosecdef) then
    fallos := array_append(fallos, 'A1 api.personal_expense_share es SECURITY DEFINER: debe ser invoker y delegar');
  end if;
  select pg_get_userbyid(p.proowner) || ':' || (case when p.prosecdef then 'definer' else 'invoker' end) into v_t
    from pg_proc p where p.oid = 'sec.my_shared_expense_share_row(date,date)'::regprocedure;
  if v_t is distinct from 'postgres:definer' then fallos := array_append(fallos, 'A2 el ayudante reducido: ' || coalesce(v_t, 'ausente')); end if;
  if has_function_privilege('anon', 'api.personal_expense_share(date,date)', 'EXECUTE') then
    fallos := array_append(fallos, 'A3 anon puede ejecutarla');
  end if;
  if not has_function_privilege('authenticated', 'api.personal_expense_share(date,date)', 'EXECUTE') then
    fallos := array_append(fallos, 'A3b authenticated no puede ejecutarla');
  end if;
  if array_length(fallos, 1) is not null then raise exception E'A · catalogo:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'A · catalogo y privilegios: OK';
end
$a$;

-- ============ B · 4 × 25 personales + 10 pagados por otro = 110 =============
do $b$
declare fallos text[] := '{}'; r fx%rowtype; v_st jsonb; v_n int; v_sum bigint;
begin
  select * into r from fx;
  -- Ana paga 20,00 a medias con Edu: la cuota de Edu son 10,00.
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3600000-0000-4000-8000-000000000141'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000',
    'effective_date', current_date::text, 'effective_time', '10:00', 'concept', 'Taxi', 'category_id', r.cat_travel,
    'payer_participant_id', r.p_ana, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));

  perform pg_temp.actor(r.edu);
  v_st := api.personal_statistics(null, null);
  if (v_st ->> 'expense_total') <> '11000' then fallos := array_append(fallos, 'B1 expense_total ' || (v_st ->> 'expense_total') || ' y no 11000'); end if;

  -- Las cinco filas: cuatro personales en personal_operation y UNA cuota aqui.
  select count(*) into v_n from api.personal_operation where operation_class = 'personal_expense';
  if v_n <> 4 then fallos := array_append(fallos, format('B2 %s gastos personales y son 4', v_n)); end if;
  select count(*) into v_n from api.personal_expense_share(null, null);
  if v_n <> 1 then fallos := array_append(fallos, format('B3 %s cuotas y es 1', v_n)); end if;
  select sum(share_amount::bigint) into v_sum from api.personal_expense_share(null, null);
  if v_sum <> 1000 then fallos := array_append(fallos, format('B3b la cuota suma %s y son 1000', v_sum)); end if;
  -- Y las cinco explican el total, a la unidad menor.
  if (select coalesce(sum(original_amount::bigint), 0) from api.personal_operation where operation_class = 'personal_expense') + v_sum
     <> (v_st ->> 'expense_total')::bigint then
    fallos := array_append(fallos, 'B4 las cinco filas no explican el total');
  end if;
  -- La fila trae el contexto: grupo, emoji, categoria, pagador, total del gasto.
  select count(*) into v_n from api.personal_expense_share(null, null)
   where group_display_name = 'Brasil' and group_emoji = 'GRP' and category_id = r.cat_travel
     and payer_display_name = 'Aitor' and total_amount = '2000' and share_amount = '1000'
     and concept = 'Taxi' and currency_code = 'EUR' and currency_scale = 2 and effective_time = '10:00';
  if v_n <> 1 then fallos := array_append(fallos, 'B5 la fila no trae el contexto esperado'); end if;
  -- Y NO mueve la caja de Edu: en Movimientos recientes no hay nada de esto.
  select count(*) into v_n from api.personal_operation where operation_class = 'group_expense';
  if v_n <> 0 then fallos := array_append(fallos, 'B6 un gasto pagado por otro aparece como caja de Edu'); end if;

  if array_length(fallos, 1) is not null then raise exception E'B · 110:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'B · cuatro de 25 y una cuota de 10 pagada por otro: total 110, cinco filas: OK';
end
$b$;

-- ============ C · Restaurante (paga Aitor) y Viajes (pago yo), a medias ======
do $c$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_st jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.ana);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3600000-0000-4000-8000-000000000142'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000',
    'effective_date', current_date::text, 'effective_time', '11:00', 'concept', 'Restaurante', 'category_id', r.cat_dining,
    'payer_participant_id', r.p_ana, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e_rest = (v_out ->> 'operation_id')::uuid;
  -- Un gasto en el que Edu NO participa: solo Ana.
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3600000-0000-4000-8000-000000000143'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '900',
    'effective_date', current_date::text, 'effective_time', '11:30', 'concept', 'Solo Ana', 'category_id', r.cat_dining,
    'payer_participant_id', r.p_ana, 'participants', jsonb_build_array(r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));

  perform pg_temp.actor(r.edu);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3600000-0000-4000-8000-000000000144'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '2000',
    'effective_date', current_date::text, 'effective_time', '12:00', 'concept', 'Viajes', 'category_id', r.cat_travel,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e_trip = (v_out ->> 'operation_id')::uuid;
  select * into r from fx;

  -- C1 · dos cuotas nuevas de 10,00: Restaurante (paga Aitor) y Viajes (pago yo)
  select count(*) into v_n from api.personal_expense_share(null, null) where concept in ('Restaurante', 'Viajes') and share_amount = '1000';
  if v_n <> 2 then fallos := array_append(fallos, format('C1 %s cuotas de 10 y son 2', v_n)); end if;
  select payer_display_name into v_t from api.personal_expense_share(null, null) where concept = 'Viajes';
  if v_t <> 'Edu' then fallos := array_append(fallos, 'C1b Viajes no dice que pago Edu: ' || coalesce(v_t, 'nulo')); end if;
  -- C2 · lo que no participo no aparece
  select count(*) into v_n from api.personal_expense_share(null, null) where concept = 'Solo Ana';
  if v_n <> 0 then fallos := array_append(fallos, 'C2 un gasto en el que no participo aparece como consumo mio'); end if;
  -- C3 · mi pago de 20,00 sigue siendo 20,00 de CAJA en Movimientos recientes, una vez
  select count(*) into v_n from api.personal_operation where operation_class = 'group_expense' and operation_id = r.e_trip and original_amount = '2000';
  if v_n <> 1 then fallos := array_append(fallos, 'C3 mi pago no sale como 20,00 de caja, o sale mas de una vez'); end if;
  select count(*) into v_n from api.personal_operation where operation_class = 'group_expense';
  if v_n <> 1 then fallos := array_append(fallos, format('C3b %s filas de caja de grupo y es 1', v_n)); end if;
  -- C4 · el diagrama: comida 4×25 + 10 = 110; viajes 10 + 10 = 20
  v_st := api.personal_statistics(null, null);
  if (v_st ->> 'expense_total') <> '13000' then fallos := array_append(fallos, 'C4 expense_total ' || (v_st ->> 'expense_total') || ' y no 13000'); end if;
  if (select c ->> 'expense_total' from jsonb_array_elements(v_st -> 'categories') c where (c ->> 'category_id')::uuid = r.cat_dining) <> '11000' then
    fallos := array_append(fallos, 'C4b comida no lleva 11000'); end if;
  if (select c ->> 'expense_total' from jsonb_array_elements(v_st -> 'categories') c where (c ->> 'category_id')::uuid = r.cat_travel) <> '2000' then
    fallos := array_append(fallos, 'C4c viajes no lleva 2000'); end if;

  if array_length(fallos, 1) is not null then raise exception E'C · a medias:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'C · Restaurante y Viajes a medias: dos cuotas de 10, caja intacta, lo ajeno fuera: OK';
end
$c$;

-- ============ D · correccion, anulacion e intervalo ==========================
do $d$
declare fallos text[] := '{}'; r fx%rowtype; v_ver uuid; v_st jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  -- D1 · Ana corrige Restaurante a 30,00: mi cuota pasa a 15,00 y el total la sigue
  perform pg_temp.super();
  select current_version_id into v_ver from core.operation where id = r.e_rest;
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3600000-0000-4000-8000-000000000145'::uuid, 'command_contract_version', 1,
    'operation_id', r.e_rest, 'expected_version_id', v_ver,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '3000',
    'effective_date', current_date::text, 'effective_time', '11:00', 'concept', 'Restaurante', 'category_id', r.cat_dining,
    'payer_participant_id', r.p_ana, 'participants', jsonb_build_array(r.p_edu, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.actor(r.edu);
  select share_amount || '/' || total_amount into v_t from api.personal_expense_share(null, null) where operation_id = r.e_rest;
  if v_t <> '1500/3000' then fallos := array_append(fallos, 'D1 tras corregir: ' || coalesce(v_t, 'ausente')); end if;
  select count(*) into v_n from api.personal_expense_share(null, null) where operation_id = r.e_rest;
  if v_n <> 1 then fallos := array_append(fallos, 'D1b la correccion duplica la fila'); end if;
  v_st := api.personal_statistics(null, null);
  if (v_st ->> 'expense_total') <> '13500' then fallos := array_append(fallos, 'D1c total ' || (v_st ->> 'expense_total') || ' y no 13500'); end if;

  -- D2 · Ana anula Restaurante: la fila desaparece y el total la sigue
  perform pg_temp.super();
  select current_version_id into v_ver from core.operation where id = r.e_rest;
  perform pg_temp.actor(r.ana);
  perform api.annul_operation(jsonb_build_object(
    'client_operation_id', 'a3600000-0000-4000-8000-000000000146'::uuid, 'command_contract_version', 2,
    'operation_id', r.e_rest, 'expected_version_id', v_ver));
  perform pg_temp.actor(r.edu);
  select count(*) into v_n from api.personal_expense_share(null, null) where operation_id = r.e_rest;
  if v_n <> 0 then fallos := array_append(fallos, 'D2 la anulada sigue en el desglose'); end if;
  v_st := api.personal_statistics(null, null);
  if (v_st ->> 'expense_total') <> '12000' then fallos := array_append(fallos, 'D2b total ' || (v_st ->> 'expense_total') || ' y no 12000'); end if;

  -- D3 · el intervalo acota igual que el total
  select count(*) into v_n from api.personal_expense_share((current_date + 1)::date, (current_date + 2)::date);
  if v_n <> 0 then fallos := array_append(fallos, 'D3 fuera del intervalo salen cuotas'); end if;
  select count(*) into v_n from api.personal_expense_share(current_date, current_date);
  if v_n <> 2 then fallos := array_append(fallos, format('D3b dentro del intervalo %s y son 2', v_n)); end if;

  if array_length(fallos, 1) is not null then raise exception E'D · correccion y anulacion:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'D · correccion, anulacion e intervalo siguen al total: OK';
end
$d$;

-- ============ E · reconciliacion exacta del conjunto entero =================
do $e$
declare fallos text[] := '{}'; r fx%rowtype; v_st jsonb; v_total bigint; v_cat bigint; v_rows bigint; v_id uuid;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  v_st := api.personal_statistics(null, null);
  v_total := (v_st ->> 'expense_total')::bigint;
  -- E1 · personales + cuotas = total, a la unidad menor
  select coalesce(sum(original_amount::bigint), 0) into v_rows from api.personal_operation where operation_class = 'personal_expense';
  v_rows := v_rows + coalesce((select sum(share_amount::bigint) from api.personal_expense_share(null, null)), 0);
  if v_rows <> v_total then fallos := array_append(fallos, format('E1 filas %s <> total %s', v_rows, v_total)); end if;
  -- E2 · por categoria, la misma igualdad para CADA categoria del diagrama
  for v_id, v_cat in select (c ->> 'category_id')::uuid, (c ->> 'expense_total')::bigint from jsonb_array_elements(v_st -> 'categories') c loop
    select coalesce(sum(original_amount::bigint), 0) into v_rows from api.personal_operation where operation_class = 'personal_expense' and category_id = v_id;
    v_rows := v_rows + coalesce((select sum(share_amount::bigint) from api.personal_expense_share(null, null) where category_id = v_id), 0);
    if v_rows <> v_cat then fallos := array_append(fallos, format('E2 categoria %s: filas %s <> diagrama %s', v_id, v_rows, v_cat)); end if;
  end loop;
  -- E3 · y ninguna cuota fuera de las categorias del diagrama
  if exists (select 1 from api.personal_expense_share(null, null) s
              where s.category_id is not null
                and not exists (select 1 from jsonb_array_elements(v_st -> 'categories') c where (c ->> 'category_id')::uuid = s.category_id)) then
    fallos := array_append(fallos, 'E3 una cuota tiene una categoria que el diagrama no lista');
  end if;
  if array_length(fallos, 1) is not null then raise exception E'E · reconciliacion:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'E · el conjunto entero de filas reconcilia con el total y con cada categoria: OK';
end
$e$;

-- ============ F · aislamiento, e historial tras salir ========================
do $g$
declare fallos text[] := '{}'; r fx%rowtype; v_n int; v_t text;
begin
  select * into r from fx;
  -- F1 · Ana ve SUS cuotas (Taxi 10, Viajes 10, Solo Ana 9), no las de Edu ni sus personales
  perform pg_temp.actor(r.ana);
  select count(*) into v_n from api.personal_expense_share(null, null);
  if v_n <> 3 then fallos := array_append(fallos, format('F1 Ana ve %s cuotas y son 3', v_n)); end if;
  select count(*) into v_n from api.personal_operation where operation_class = 'personal_expense';
  if v_n <> 0 then fallos := array_append(fallos, 'F1b Ana ve gastos personales de Edu'); end if;
  -- F2 · sin identidad, nada
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from api.personal_expense_share(null, null);
  if v_n <> 0 then fallos := array_append(fallos, 'F2 sin identidad salen cuotas'); end if;

  -- F3 · Edu sale del grupo: sus cuotas siguen en Personal, con nombre y emoji del grupo
  perform pg_temp.actor(r.edu);
  perform api.leave_group(jsonb_build_object(
    'client_command_id', 'a3600000-0000-4000-8000-000000000151'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
  select count(*) into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'F3 Edu sigue viendo el grupo tras salir'); end if;
  select count(*) into v_n from api.personal_expense_share(null, null);
  if v_n <> 2 then fallos := array_append(fallos, format('F3b tras salir, %s cuotas y son 2', v_n)); end if;
  select group_display_name || '/' || group_emoji || '/' || payer_display_name into v_t
    from api.personal_expense_share(null, null) where concept = 'Taxi';
  if v_t <> 'Brasil/GRP/Aitor' then fallos := array_append(fallos, 'F3c el contexto se perdio al salir: ' || coalesce(v_t, 'nulo')); end if;
  -- y el total sigue explicado por ellas
  if (select (api.personal_statistics(null, null) ->> 'expense_total')::bigint)
     <> (select coalesce(sum(original_amount::bigint), 0) from api.personal_operation where operation_class = 'personal_expense')
        + (select coalesce(sum(share_amount::bigint), 0) from api.personal_expense_share(null, null)) then
    fallos := array_append(fallos, 'F3d tras salir, las filas no explican el total');
  end if;

  if array_length(fallos, 1) is not null then raise exception E'F · aislamiento e historial:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'F · cada cuenta ve lo suyo; sin identidad nada; y el historial sobrevive a salir del grupo: OK';
end
$g$;

rollback;
