-- E23 · QUE LEE CADA SUPERFICIE DE PERSONAL CUANDO UNA CUENTA DEJA DE SER MIEMBRO
--
-- Evidencia, no norma: mide el comportamiento ACTUAL de las lecturas si se
-- quita la membresia (y, aparte, si se cierra la presencia) sin cambiar nada
-- mas. Todo en una transaccion que termina en ROLLBACK. No toca datos reales:
-- los actores, el grupo y los gastos son fixtures con uuids fijos.
--
-- NO ES UNA MIGRACION. No decide nada: lo que decide es ADR-034.
\pset pager off
\set ON_ERROR_STOP on
begin;

do $e$
declare
  v_eur uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua  uuid := 'e2300000-0000-4000-8000-0000000000a1';   -- Edu, crea y paga E1
  v_ub  uuid := 'e2300000-0000-4000-8000-0000000000b1';   -- Ana, sale DEBIENDO
  v_uc  uuid := 'e2300000-0000-4000-8000-0000000000c1';   -- Luis, sale COBRANDO
  v_pa  uuid := 'e2300000-0000-4000-8000-0000000000f1';
  v_pb  uuid := 'e2300000-0000-4000-8000-0000000000f2';
  v_pc  uuid := 'e2300000-0000-4000-8000-0000000000f3';
  v_g   uuid := 'e2300000-0000-4000-8000-000000000010';
  v_p1  uuid := 'e2300000-0000-4000-8000-000000000031';   -- Edu (participante)
  v_p2  uuid := 'e2300000-0000-4000-8000-000000000032';   -- Ana
  v_p3  uuid := 'e2300000-0000-4000-8000-000000000033';   -- Luis
  v_p4  uuid := 'e2300000-0000-4000-8000-000000000034';   -- Marta, sin cuenta
  v_cat uuid;
  v_e1  uuid;
  v_e2  uuid;
  v_v1  uuid;
  v_v2  uuid;
  v_out jsonb;
  v_t   text;
  v_n   int;
begin
  -- ─────────────── fixtures: tres cuentas, tres personales, un grupo ───────
  perform set_config('role', 'postgres', true);
  select id into v_cat from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (v_pa, 'personal', v_eur, v_ua), (v_pb, 'personal', v_eur, v_ub), (v_pc, 'personal', v_eur, v_uc);
  insert into core.membership (scope_id, user_id) values (v_pa, v_ua), (v_pb, v_ub), (v_pc, v_uc);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true); perform set_config('role', 'authenticated', true);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'e2300000-0000-4000-8000-000000000020'::uuid,
    'command_contract_version', 1, 'client_group_id', v_g,
    'display_name', 'E23 salida', 'emoji', 'GRP', 'currency_definition_id', v_eur,
    'creator_participant_id', v_p1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', v_p2, 'display_name', 'Ana'),
      jsonb_build_object('client_participant_id', v_p3, 'display_name', 'Luis'),
      jsonb_build_object('client_participant_id', v_p4, 'display_name', 'Marta'))));

  -- Ana y Luis reclamados (F10 no existe: se siembra como postgres) y miembros.
  perform set_config('role', 'postgres', true);
  insert into core.participant_user_link (participant_id, scope_id, user_id)
  values (v_p2, v_g, v_ub), (v_p3, v_g, v_uc);
  insert into core.membership (scope_id, user_id) values (v_g, v_ub), (v_g, v_uc);
  -- Presencias que empiezan hace diez dias, para poder fechar gastos "ayer".
  update core.participant_period pp set valid_from = current_date - 10
    from core.participant p where p.id = pp.participant_id and p.scope_id = v_g;

  -- E1: Edu paga 1000 entre los cuatro → Ana debe 250, Luis debe 250.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true); perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'e2300000-0000-4000-8000-000000000041'::uuid,
    'command_contract_version', 1, 'scope_id', v_g, 'currency_definition_id', v_eur,
    'total', '1000', 'effective_date', (current_date - 3)::text, 'concept', 'Cena E1',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_e1 := (v_out ->> 'operation_id')::uuid;

  -- E2: Luis paga 900 entre Edu, Ana y Luis → Edu debe 300, Ana debe 300.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uc::text)::text, true); perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'e2300000-0000-4000-8000-000000000042'::uuid,
    'command_contract_version', 1, 'scope_id', v_g, 'currency_definition_id', v_eur,
    'total', '900', 'effective_date', (current_date - 2)::text, 'concept', 'Cena E2',
    'category_id', v_cat, 'payer_participant_id', v_p3,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_e2 := (v_out ->> 'operation_id')::uuid;
  perform set_config('role', 'postgres', true);
  select current_version_id into v_v2 from core.operation where id = v_e2;

  -- Una correccion de E1 por Edu ANTES de que nadie salga: genera avisos.
  perform set_config('role', 'postgres', true);
  select current_version_id into v_v1 from core.operation where id = v_e1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true); perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'e2300000-0000-4000-8000-000000000043'::uuid,
    'command_contract_version', 1, 'scope_id', v_g, 'currency_definition_id', v_eur,
    'operation_id', v_e1, 'expected_version_id', v_v1,
    'total', '1000', 'effective_date', (current_date - 3)::text, 'concept', 'Cena E1 corregida',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));

  raise notice '════ ANTES DE SALIR ════';
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub::text)::text, true); perform set_config('role', 'authenticated', true);
  select coalesce(string_agg(dimension || ':' || amount, ' '), '∅') into v_t from api.claimed_dimension() where dimension = 'debt';
  raise notice 'Ana  claimed_dimension(debt)      = %', v_t;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  raise notice 'Ana  personal_statistics.expense  = %', v_t;
  select count(*) into v_n from api.group_profile where scope_id = v_g;
  raise notice 'Ana  group_profile visible        = %', v_n;
  -- NOTA: `api.group_edit_notice` falla como `authenticated` (permission denied for
  -- function request_actor_id): la politica llama a sec.request_actor_id() en vez
  -- de sec.is_me(). Se cuenta en core, como postgres, lo que el cliente VERIA.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_edit_notice where scope_id = v_g and recipient_user_id = v_ub;
  raise notice 'Ana  group_edit_notice            = %', v_n;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uc::text)::text, true); perform set_config('role', 'authenticated', true);
  select coalesce(string_agg(dimension || ':' || amount, ' '), '∅') into v_t from api.claimed_dimension() where dimension = 'debt';
  raise notice 'Luis claimed_dimension(debt)      = %', v_t;
  select balance_amount into v_t from api.personal_balance;
  raise notice 'Luis personal_balance             = %', v_t;
  select coalesce(string_agg(coalesce(group_display_name, 'NULL') || '|' || coalesce(your_share, 'NULL') || '|' || balance_amount, ' '), '∅')
    into v_t from api.personal_operation where operation_class = 'group_expense';
  raise notice 'Luis personal_operation(grupo)    = %', v_t;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  raise notice 'Luis personal_statistics.expense  = %', v_t;
  select net_position into v_t from api.group_summary where scope_id = v_g;
  raise notice 'Luis group_summary.net_position   = %', v_t;

  -- ─────────────── SALIDA simulada: solo la membresia, nada mas ────────────
  perform set_config('role', 'postgres', true);
  delete from core.membership where scope_id = v_g and user_id in (v_ub, v_uc);

  raise notice '════ DESPUES DE QUITAR LA MEMBRESIA (Ana y Luis) ════';
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub::text)::text, true); perform set_config('role', 'authenticated', true);
  select coalesce(string_agg(dimension || ':' || amount, ' '), '∅') into v_t from api.claimed_dimension() where dimension = 'debt';
  raise notice 'Ana  claimed_dimension(debt)      = %   ← atraviesa RLS por vinculo', v_t;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  raise notice 'Ana  personal_statistics.expense  = %   (cuotas conservadas)', v_t;
  select count(*) into v_n from api.group_profile where scope_id = v_g;
  raise notice 'Ana  group_profile visible        = %', v_n;
  select count(*) into v_n from api.group_summary where scope_id = v_g;
  raise notice 'Ana  group_summary visible        = %', v_n;
  -- NOTA: `api.group_edit_notice` falla como `authenticated` (permission denied for
  -- function request_actor_id): la politica llama a sec.request_actor_id() en vez
  -- de sec.is_me(). Se cuenta en core, como postgres, lo que el cliente VERIA.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_edit_notice where scope_id = v_g and recipient_user_id = v_ub;
  raise notice 'Ana  group_edit_notice            = %   ← el aviso antiguo sigue ahi', v_n;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uc::text)::text, true); perform set_config('role', 'authenticated', true);
  select coalesce(string_agg(dimension || ':' || amount, ' '), '∅') into v_t from api.claimed_dimension() where dimension = 'debt';
  raise notice 'Luis claimed_dimension(debt)      = %', v_t;
  select balance_amount into v_t from api.personal_balance;
  raise notice 'Luis personal_balance             = %   (caja conservada)', v_t;
  select coalesce(string_agg(coalesce(group_display_name, 'NULL') || '|' || coalesce(your_share, 'NULL') || '|' || balance_amount, ' '), '∅')
    into v_t from api.personal_operation where operation_class = 'group_expense';
  raise notice 'Luis personal_operation(grupo)    = %   ← fila si, contexto NO', v_t;
  select coalesce(string_agg(coalesce(concept, 'NULL') || '|' || coalesce(category_id::text, 'NULL'), ' '), '∅')
    into v_t from api.personal_operation_version where operation_id = v_e2;
  raise notice 'Luis personal_operation_version   = %', v_t;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  raise notice 'Luis personal_statistics.expense  = %', v_t;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true); perform set_config('role', 'authenticated', true);
  select string_agg(display_name || '=' || net_position, ' ' order by display_name) into v_t
    from api.group_balance where scope_id = v_g;
  raise notice 'Edu  group_balance                = %   (deudas intactas)', v_t;
  select count(*) into v_n from api.group_participant where scope_id = v_g;
  raise notice 'Edu  group_participant            = % participantes', v_n;

  -- ─────────────── PRESENCIA cerrada: la regla temporal, medida ────────────
  perform set_config('role', 'postgres', true);
  update core.participant_period set valid_until = current_date
   where participant_id = v_p2 and valid_until is null;     -- Ana: hasta AYER inclusive
  raise notice '════ PRESENCIA DE ANA CERRADA: valid_until = hoy (exclusivo) ════';
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true); perform set_config('role', 'authenticated', true);
  foreach v_t in array array[(current_date - 1)::text, current_date::text, (current_date + 1)::text] loop
    begin
      perform api.record_group_expense(jsonb_build_object(
        'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
        'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '300',
        'effective_date', v_t, 'concept', 'Sonda ' || v_t, 'category_id', v_cat,
        'payer_participant_id', v_p1, 'participants', jsonb_build_array(v_p1, v_p2, v_p3),
        'split_method', jsonb_build_object('kind', 'equal')));
      raise notice 'gasto con Ana fechado %  → ACEPTADO', v_t;
    exception when others then
      raise notice 'gasto con Ana fechado %  → % ', v_t, substring(sqlerrm from '[A-Z_]{8,}');
    end;
  end loop;
  -- Corregir E1 (fecha hace 3 dias, Ana dentro): permitido por la fecha original.
  perform set_config('role', 'postgres', true);
  select current_version_id into v_v1 from core.operation where id = v_e1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true); perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', v_g, 'currency_definition_id', v_eur,
      'operation_id', v_e1, 'expected_version_id', v_v1,
      'total', '1200', 'effective_date', (current_date - 3)::text, 'concept', 'Cena E1 v3',
      'category_id', v_cat, 'payer_participant_id', v_p1,
      'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
      'split_method', jsonb_build_object('kind', 'equal')));
    raise notice 'corregir E1 (hace 3 dias, con Ana) → ACEPTADO';
  exception when others then
    raise notice 'corregir E1 (hace 3 dias, con Ana) → %', substring(sqlerrm from '[A-Z_]{8,}');
  end;
  -- Liquidar hoy la deuda de Ana con Edu: lo que hace HOY el contrato.
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', v_g, 'currency_definition_id', v_eur, 'amount', '100',
      'effective_date', current_date::text,
      'debtor_participant_id', v_p2, 'creditor_participant_id', v_p1));
    raise notice 'liquidacion Ana→Edu fechada hoy → ACEPTADA';
  exception when others then
    raise notice 'liquidacion Ana→Edu fechada hoy → %', substring(sqlerrm from '[A-Z_]{8,}');
  end;
  -- Y Luis (sin membresia) intenta corregir su propio E2: sin acceso ordinario.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uc::text)::text, true); perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', v_g, 'currency_definition_id', v_eur,
      'operation_id', v_e2, 'expected_version_id', v_v2,
      'total', '900', 'effective_date', (current_date - 2)::text, 'concept', 'E2 por Luis',
      'category_id', v_cat, 'payer_participant_id', v_p3,
      'participants', jsonb_build_array(v_p1, v_p2, v_p3),
      'split_method', jsonb_build_object('kind', 'equal')));
    raise notice 'Luis corrige E2 tras salir → ACEPTADO';
  exception when others then
    raise notice 'Luis corrige E2 tras salir → %', substring(sqlerrm from '[A-Z_]{8,}');
  end;
end
$e$;

rollback;
