-- ============================================================================
-- RETIRAR A UN PARTICIPANTE SIN CUENTA · api.retire_participant
-- ============================================================================
--
-- Fixtures propios, ROLLBACK al final. Edu crea el grupo con Ana (con cuenta,
-- reclamada), Luis (sin cuenta, con historial), Marta (sin cuenta, sin
-- historial), Sol (sin cuenta, neto cero con pares cruzados). Secciones:
--
--   A · catalogo: owner, privilegios, has_history en la vista
--   B · sin historial: «eliminar» = retirada sin operacion; fuera de listas,
--       contador, selector de reclamacion y nuevos gastos; reintento
--   C · con historial y sin pendientes: retirada, historial intacto
--   D · con pares: neto cero con pares cruzados; sin detallar → STALE; con
--       los pares → un efecto por par, ninguno de caja, Personal intacto
--   E · con cuenta: PARTICIPANT_LINKED, tambien para quien salio con vinculo
--   F · actor sin permisos; reclamacion concurrente (dos sesiones reales)
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
create function pg_temp.code(p_msg text) returns text language sql immutable as $$
  select coalesce(substring(p_msg from '[A-Z_]{8,}'), p_msg);
$$;
grant execute on function pg_temp.actor(uuid), pg_temp.super(), pg_temp.code(text) to authenticated;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3700000-0000-4000-8000-0000000000a1'::uuid as edu,
  'a3700000-0000-4000-8000-0000000000b1'::uuid as ana,
  'a3700000-0000-4000-8000-0000000000e1'::uuid as ajeno,
  'a3700000-0000-4000-8000-000000000010'::uuid as g,
  'a3700000-0000-4000-8000-000000000031'::uuid as p_edu,
  'a3700000-0000-4000-8000-000000000032'::uuid as p_ana,
  'a3700000-0000-4000-8000-000000000033'::uuid as p_luis,
  'a3700000-0000-4000-8000-000000000034'::uuid as p_marta,
  'a3700000-0000-4000-8000-000000000035'::uuid as p_sol,
  null::uuid as cat, null::uuid as e1;
grant select, update on fx to authenticated;

do $f$
declare r fx%rowtype; v_out jsonb;
begin
  select * into r from fx;
  perform pg_temp.super();
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    ('a3700000-0000-4000-8000-0000000000f1', 'personal', r.eur, r.edu),
    ('a3700000-0000-4000-8000-0000000000f2', 'personal', r.eur, r.ana),
    ('a3700000-0000-4000-8000-0000000000f5', 'personal', r.eur, r.ajeno);
  insert into core.membership (scope_id, user_id) values
    ('a3700000-0000-4000-8000-0000000000f1', r.edu), ('a3700000-0000-4000-8000-0000000000f2', r.ana),
    ('a3700000-0000-4000-8000-0000000000f5', r.ajeno);
  perform pg_temp.actor(r.edu);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3700000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Retiro', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', r.p_ana,   'display_name', 'Ana'),
      jsonb_build_object('client_participant_id', r.p_luis,  'display_name', 'Luis'),
      jsonb_build_object('client_participant_id', r.p_marta, 'display_name', 'Marta'),
      jsonb_build_object('client_participant_id', r.p_sol,   'display_name', 'Sol'))));
  perform pg_temp.super();
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.p_ana, r.g, r.ana);
  insert into core.membership (scope_id, user_id) values (r.g, r.ana);
  update core.participant_period pp set valid_from = current_date - 10
    from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;

  -- E1: Edu paga 1000 entre Edu, Luis y Sol (Edu 334 por el resto; Luis y Sol deben 333 a Edu).
  perform pg_temp.actor(r.edu);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1000',
    'effective_date', (current_date - 3)::text, 'concept', 'Cena E1', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_luis, r.p_sol),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e1 = (v_out ->> 'operation_id')::uuid;
  -- E2: Ana registra que SOL pago 666 entre Sol y ANA: Ana debe 333 a Sol.
  -- Asi Sol queda a NETO CERO (debe 333 a Edu, Ana le debe 333) con DOS pares
  -- con dos personas distintas: el neto cero no es ausencia de pendientes.
  perform pg_temp.actor(r.ana);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000042'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '666',
    'effective_date', (current_date - 2)::text, 'concept', 'Sol E2', 'category_id', r.cat,
    'payer_participant_id', r.p_sol, 'participants', jsonb_build_array(r.p_sol, r.p_ana),
    'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.super();
end
$f$;

-- ============================ A · catalogo ===================================
do $a$
declare fallos text[] := '{}'; v_t text; v_n int;
begin
  select pg_get_userbyid(p.proowner) into v_t from pg_proc p where p.oid = 'api.retire_participant(jsonb)'::regprocedure;
  if v_t is distinct from 'nomey_writer' then fallos := array_append(fallos, 'A1 retire_participant no es del writer: ' || coalesce(v_t, 'ausente')); end if;
  select pg_get_userbyid(p.proowner) into v_t from pg_proc p where p.oid = 'api.settle_participant(jsonb)'::regprocedure;
  if v_t is distinct from 'nomey_writer' then fallos := array_append(fallos, 'A1b settle_participant cambio de dueno: ' || coalesce(v_t, 'ausente')); end if;
  if has_function_privilege('anon', 'api.retire_participant(jsonb)', 'EXECUTE') then fallos := array_append(fallos, 'A2 anon puede retirar'); end if;
  if has_schema_privilege('nomey_writer', 'api', 'CREATE') then fallos := array_append(fallos, 'A2b el writer conserva CREATE sobre api'); end if;
  -- El writer solo puede CERRAR presencias, nunca abrirlas ni reabrirlas.
  select count(*) into v_n from information_schema.role_column_grants
   where table_schema = 'core' and table_name = 'participant_period' and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_n <> 1 then fallos := array_append(fallos, format('A3 el writer tiene %s columnas de UPDATE en participant_period y es 1', v_n)); end if;
  select count(*) into v_n from information_schema.columns where table_schema = 'api' and table_name = 'group_participant' and column_name = 'has_history';
  if v_n <> 1 then fallos := array_append(fallos, 'A4 la vista no publica has_history'); end if;
  if array_length(fallos, 1) is not null then raise exception E'A · catalogo:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'A · catalogo y privilegios: OK';
end
$a$;

-- ============================ B · sin historial ==============================
do $b$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  select has_history::text || '/' || is_linked::text || '/' || is_active::text into v_t from api.group_participant where participant_id = r.p_marta;
  if v_t <> 'false/false/true' then fallos := array_append(fallos, 'B0 Marta: ' || coalesce(v_t, 'ausente')); end if;
  select participant_count into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 5 then fallos := array_append(fallos, format('B0b contador %s y son 5', v_n)); end if;

  v_out := api.retire_participant(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000051'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_marta, 'expected_pairs', '[]'::jsonb));
  if (v_out ->> 'already_processed') <> 'false' or (v_out -> 'operation_id') is distinct from 'null'::jsonb and v_out ->> 'operation_id' is not null then
    fallos := array_append(fallos, 'B1 respuesta: ' || v_out::text);
  end if;
  -- Retirada sin operacion: nada monetario.
  perform pg_temp.super();
  select count(*) into v_n from core.participant_retirement where participant_id = r.p_marta and operation_id is null;
  if v_n <> 1 then fallos := array_append(fallos, 'B1b sin historial no queda un retiro sin operacion'); end if;
  select count(*) into v_n from core.participant where id = r.p_marta;
  if v_n <> 1 then fallos := array_append(fallos, 'B1c el participante se borro fisicamente'); end if;
  select count(*) into v_n from core.participant_period pp where pp.participant_id = r.p_marta and pp.valid_until = current_date;
  if v_n <> 1 then fallos := array_append(fallos, 'B1d la presencia no se cerro hoy'); end if;
  -- Fuera de listas, contador, saldos y reclamacion.
  perform pg_temp.actor(r.edu);
  select is_retired::text || '/' || is_active::text into v_t from api.group_participant where participant_id = r.p_marta;
  if v_t <> 'true/false' then fallos := array_append(fallos, 'B2 Marta tras retirar: ' || v_t); end if;
  select participant_count into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 4 then fallos := array_append(fallos, format('B2b contador %s y son 4', v_n)); end if;
  select count(*) into v_n from api.group_balance where participant_id = r.p_marta;
  if v_n <> 0 then fallos := array_append(fallos, 'B2c Marta sigue en Saldos'); end if;
  perform pg_temp.super();
  if sec.participant_available(r.p_marta, r.g) then fallos := array_append(fallos, 'B2d Marta sigue reclamable'); end if;
  -- Un gasto nuevo no puede nombrarla.
  perform pg_temp.actor(r.edu);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '100',
      'effective_date', current_date::text, 'concept', 'Con Marta', 'category_id', r.cat,
      'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_marta),
      'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'B3 un gasto nuevo admitio a la retirada');
  exception when others then
    if pg_temp.code(sqlerrm) not in ('PARTICIPANT_RETIRED', 'PARTICIPANT_NOT_ELIGIBLE') then fallos := array_append(fallos, 'B3b codigo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- Reintento con la misma clave: replay; con otra: ya retirada.
  v_out := api.retire_participant(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000051'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_marta, 'expected_pairs', '[]'::jsonb));
  if (v_out ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'B4 el reintento no fue replay'); end if;
  begin
    perform api.retire_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_marta, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'B4b una segunda retirada con otra clave paso');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_RETIRED' then fallos := array_append(fallos, 'B4c codigo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  if array_length(fallos, 1) is not null then raise exception E'B · sin historial:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'B · sin historial: retirada sin operacion, fuera de listas, contador, reclamacion y gastos; reintento: OK';
end
$b$;

-- ============================ C · con historial, sin pendientes ==============
do $c$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  -- Luis debe 333 a Edu: primero se salda por la via normal (Luis paga a Edu).
  perform pg_temp.actor(r.edu);
  perform api.record_debt_settlement(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000061'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '333', 'effective_date', current_date::text,
    'debtor_participant_id', r.p_luis, 'creditor_participant_id', r.p_edu));
  select has_history::text into v_t from api.group_participant where participant_id = r.p_luis;
  if v_t <> 'true' then fallos := array_append(fallos, 'C0 Luis sin historial pese a E1'); end if;
  select count(*) into v_n from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_luis or creditor_participant_id = r.p_luis);
  if v_n <> 0 then fallos := array_append(fallos, format('C0b Luis con %s pares pendientes', v_n)); end if;

  v_out := api.retire_participant(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000062'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_luis, 'expected_pairs', '[]'::jsonb));
  if v_out ->> 'operation_id' is not null then fallos := array_append(fallos, 'C1 sin pendientes creo una operacion'); end if;
  -- El historial intacto: E1 sigue nombrandolo con su nombre y su cuota.
  select count(*) into v_n from api.group_split_participant where version_id = (select version_id from api.group_operation where operation_id = r.e1) and participant_id = r.p_luis;
  if v_n <> 1 then fallos := array_append(fallos, 'C2 Luis desaparecio del reparto de E1'); end if;
  select display_name into v_t from api.group_participant where participant_id = r.p_luis;
  if v_t <> 'Luis' then fallos := array_append(fallos, 'C2b el nombre no se conservo'); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.effect where debt_debtor_participant_id = r.p_luis or economic_participant_id = r.p_luis;
  if v_n < 2 then fallos := array_append(fallos, format('C2c los efectos de Luis se borraron: quedan %s', v_n)); end if;
  if array_length(fallos, 1) is not null then raise exception E'C · con historial:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'C · con historial y sin pendientes: retirada sin operacion, historial y nombre intactos: OK';
end
$c$;

-- ============================ D · con pares ==================================
do $d$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text; v_bal text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  -- D0 · Sol: neto CERO, dos pares pendientes (Sol>Edu 333 y Ana>Sol 333).
  select net_position into v_bal from api.group_balance where participant_id = r.p_sol;
  if v_bal <> '0' then fallos := array_append(fallos, 'D0 el neto de Sol no es 0: ' || coalesce(v_bal, 'nulo')); end if;
  select count(*) into v_n from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_sol or creditor_participant_id = r.p_sol);
  if v_n <> 2 then fallos := array_append(fallos, format('D0b Sol tiene %s pares y son 2', v_n)); end if;
  -- D1 · sin detallar los pares: STALE, y nada se cancela.
  begin
    perform api.retire_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_sol, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'D1 «Eliminar» sin pares cancelo deudas en silencio');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'SETTLEMENT_STALE' then fallos := array_append(fallos, 'D1b codigo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) into v_n from core.participant_retirement where participant_id = r.p_sol;
  if v_n <> 0 then fallos := array_append(fallos, 'D1c se retiro pese al STALE'); end if;
  -- D2 · con los pares ensenados: un efecto de deuda por par, ninguno de caja.
  perform pg_temp.actor(r.edu);
  v_out := api.retire_participant(jsonb_build_object(
    'client_operation_id', 'a3700000-0000-4000-8000-000000000071'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_sol, 'expected_pairs', jsonb_build_array(
      jsonb_build_object('debtor_participant_id', r.p_sol, 'creditor_participant_id', r.p_edu, 'amount', '333'),
      jsonb_build_object('debtor_participant_id', r.p_ana, 'creditor_participant_id', r.p_sol, 'amount', '333'))));
  if v_out ->> 'operation_id' is null then fallos := array_append(fallos, 'D2 con pares no hubo operacion'); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.effect e where e.operation_version_id = (select current_version_id from core.operation where id = (v_out ->> 'operation_id')::uuid);
  if v_n <> 2 then fallos := array_append(fallos, format('D2b %s efectos y son 2 (uno por par)', v_n)); end if;
  select count(*) into v_n from core.effect e where e.operation_version_id = (select current_version_id from core.operation where id = (v_out ->> 'operation_id')::uuid) and e.balance_amount is not null;
  if v_n <> 0 then fallos := array_append(fallos, 'D2c la retirada movio caja'); end if;
  perform pg_temp.actor(r.edu);
  select count(*) into v_n from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_sol or creditor_participant_id = r.p_sol);
  if v_n <> 0 then fallos := array_append(fallos, 'D2d quedan pares de Sol'); end if;
  -- Personal de Edu: su Disponible no se movio por la retirada (solo E1 -1000).
  select balance_amount into v_bal from api.personal_balance;
  if v_bal <> '-1000' then fallos := array_append(fallos, 'D2e el Disponible de Edu cambio: ' || coalesce(v_bal, 'nulo')); end if;
  perform pg_temp.super();
  if array_length(fallos, 1) is not null then raise exception E'D · con pares:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'D · neto cero con pares cruzados: sin detallar STALE; con los pares, un efecto por par y sin caja: OK';
end
$d$;

-- ============================ E · con cuenta =================================
do $e$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb;
begin
  select * into r from fx;
  -- E1 · Ana, con cuenta y activa: no se puede.
  perform pg_temp.actor(r.edu);
  begin
    perform api.retire_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'E1 se retiro a alguien con cuenta');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_LINKED' then fallos := array_append(fallos, 'E1b codigo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- E2 · Ana sale: inactiva con vinculo sigue sin ser «sin cuenta».
  perform pg_temp.actor(r.ana);
  v_out := api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g));
  perform pg_temp.actor(r.edu);
  begin
    perform api.retire_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'E2 se retiro por esta via a quien salio con vinculo');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_LINKED' then fallos := array_append(fallos, 'E2b codigo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- Y «Saldado» (la via de ADR-034) sigue funcionando para ella.
  v_out := api.settle_participant(jsonb_build_object(
    'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', '[]'::jsonb));
  if (v_out ->> 'already_processed') <> 'false' then fallos := array_append(fallos, 'E3 «Saldado» dejo de funcionar: ' || v_out::text); end if;
  perform pg_temp.super();
  if array_length(fallos, 1) is not null then raise exception E'E · con cuenta:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'E · con cuenta: PARTICIPANT_LINKED, activa o salida; «Saldado» sigue para quien salio: OK';
end
$e$;

-- ============================ F · permisos y carrera =========================
do $g$
declare fallos text[] := '{}'; r fx%rowtype; v_new uuid := 'a3700000-0000-4000-8000-000000000036';
begin
  select * into r from fx;
  perform pg_temp.super();
  insert into core.participant (id, scope_id, display_name) values (v_new, r.g, 'Nadia');
  insert into core.participant_period (participant_id, valid_from) values (v_new, current_date - 1);
  -- F1 · un ajeno no puede
  perform pg_temp.actor(r.ajeno);
  begin
    perform api.retire_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', v_new, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'F1 un ajeno retiro');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'NOT_AUTHORIZED' then fallos := array_append(fallos, 'F1b codigo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  if array_length(fallos, 1) is not null then raise exception E'F · permisos:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'F · un ajeno no retira (la carrera con reclamar se mide en scripts/retire-claim-race.sh): OK';
end
$g$;

rollback;
