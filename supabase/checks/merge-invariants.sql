-- ============================================================================
-- LOS DOS CIERRES DE F10/ADR-004 (migracion 20260920120000) · contra las
-- funciones reales, aislado
-- ============================================================================
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/merge-invariants.sql; } | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · catalogo: el trigger existe, esta activo, cubre insert y update, y la
--       guarda de retirar vive en el nucleo compartido de las dos puertas
--   B · retirar / «Saldado» a un origen fusionado: PARTICIPANT_MERGED, sin
--       escribir nada; retirar al DESTINO sigue funcionando
--   C · una fusion valida (fantasma → identidad propia) sigue funcionando; un
--       segundo fantasma sobre el mismo destino tambien
--   D · cadenas rehusadas en catalogo, escriba quien escriba (como postgres,
--       sin pasar por la API): B → C con B destino; C → A con A origen;
--       reapuntar; y la suma cero de Saldos no se rompe
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a6000000-0000-4000-8000-0000000000b1'::uuid as bea,   'a6000000-0000-4000-8000-0000000000f1'::uuid as s_bea,
  'a6000000-0000-4000-8000-0000000000c1'::uuid as carlos,'a6000000-0000-4000-8000-0000000000f2'::uuid as s_carlos,
  'a6000000-0000-4000-8000-000000000010'::uuid as g,
  'a6000000-0000-4000-8000-000000000031'::uuid as p_bea,
  'a6000000-0000-4000-8000-000000000032'::uuid as p_ana,    -- fantasma
  'a6000000-0000-4000-8000-000000000033'::uuid as p_ana2,   -- fantasma
  'a6000000-0000-4000-8000-000000000034'::uuid as p_carlos,
  null::uuid as cat;
grant select, update on fx to authenticated;

create function pg_temp.gasto(p_who uuid, p_key uuid, p_payer uuid, p_parts uuid[], p_total bigint, p_concept text default 'Gasto') returns text language plpgsql as $$
declare r fx%rowtype; v jsonb;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(p_who);
  v := api.record_group_expense(jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', p_total::text, 'effective_date', current_date::text,
    'concept', p_concept, 'category_id', r.cat, 'payer_participant_id', p_payer,
    'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.gp_super();
  return 'OK ' || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.asociar(p_who uuid, p_key uuid, p_source uuid) returns text language plpgsql as $$
declare r fx%rowtype;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(p_who);
  perform api.associate_participant(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'scope_id', r.g, 'participant_id', p_source));
  perform pg_temp.gp_super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.retirar(p_who uuid, p_key uuid, p_target uuid) returns text language plpgsql as $$
declare r fx%rowtype;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(p_who);
  perform api.retire_participant(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1, 'scope_id', r.g, 'participant_id', p_target,
    'expected_pairs', (select coalesce(jsonb_agg(jsonb_build_object('debtor_participant_id', debtor_participant_id, 'creditor_participant_id', creditor_participant_id, 'amount', amount)), '[]'::jsonb) from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = p_target or creditor_participant_id = p_target))));
  perform pg_temp.gp_super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.saldar(p_who uuid, p_key uuid, p_target uuid) returns text language plpgsql as $$
declare r fx%rowtype;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(p_who);
  perform api.settle_participant(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1, 'scope_id', r.g, 'participant_id', p_target, 'expected_pairs', '[]'::jsonb));
  perform pg_temp.gp_super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- Una fila de fusion escrita A MANO, como postgres: lo que haria un escritor futuro sin guarda propia.
create function pg_temp.fusion_manual(p_source uuid, p_target uuid) returns text language plpgsql as $$
declare r fx%rowtype;
begin
  select * into r from fx;
  insert into core.participant_merge (source_participant_id, target_participant_id, scope_id, merged_by, client_command_id)
  values (p_source, p_target, r.g, r.bea, gen_random_uuid());
  return 'OK';
exception when sqlstate 'PGRST' then
  return sqlerrm::json ->> 'code';
end $$;
-- Saldos del grupo, como Bea: 'nombre:neto ...' y la suma.
create function pg_temp.saldos(p_who uuid) returns text language plpgsql as $$
declare r fx%rowtype; v text; s bigint;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(p_who);
  select coalesce(string_agg(display_name || ':' || net_position, ' ' order by display_name), '-'), coalesce(sum(net_position::bigint), 0)
    into v, s from api.group_balance where scope_id = r.g;
  perform pg_temp.gp_super();
  return v || ' suma=' || s;
end $$;
grant execute on function pg_temp.gasto(uuid, uuid, uuid, uuid[], bigint, text), pg_temp.asociar(uuid, uuid, uuid), pg_temp.retirar(uuid, uuid, uuid),
  pg_temp.saldar(uuid, uuid, uuid), pg_temp.saldos(uuid) to authenticated;

-- ============================ A · catalogo ===================================
do $a$
declare fallos text[] := '{}'; v_t record;
begin
  select tgenabled, tgtype into v_t from pg_trigger where tgrelid = 'core.participant_merge'::regclass and tgname = 'participant_merge_un_salto' and not tgisinternal;
  if v_t is null then
    fallos := array_append(fallos, 'A1: falta el trigger participant_merge_un_salto');
  elsif v_t.tgenabled = 'D' then
    fallos := array_append(fallos, 'A2: el trigger esta deshabilitado');
  elsif (v_t.tgtype & 4) = 0 or (v_t.tgtype & 16) = 0 or (v_t.tgtype & 1) = 0 or (v_t.tgtype & 2) = 0 then
    fallos := array_append(fallos, 'A3: el trigger no es BEFORE INSERT OR UPDATE FOR EACH ROW');
  end if;
  if not (select prosecdef from pg_proc where oid = 'sec.participant_merge_one_hop()'::regprocedure) then
    fallos := array_append(fallos, 'A4: el trigger no ve todas las filas (no es definer)');
  end if;
  if pg_get_functiondef('sec.retire_participant_core(jsonb,uuid,uuid,uuid,uuid,text[],bigint,jsonb)'::regprocedure) not ilike '%participant_merge%' then
    fallos := array_append(fallos, 'A5: el nucleo de retirar/saldar no consulta participant_merge');
  end if;
  -- F10/ADR-004 §1-§2, §6: ninguna cesion, y un unico escritor de participant_merge en api.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and (p.proname ilike '%handover%' or p.proname ilike '%unlink%' or p.proname ilike '%unclaim%')) then
    fallos := array_append(fallos, 'A6: existe una funcion de cesion o de baja en api');
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%insert into core.participant_merge%') <> 1 then
    fallos := array_append(fallos, 'A7: participant_merge tiene mas de un escritor en api');
  end if;
  if array_length(fallos, 1) is not null then
    raise exception E'A · catalogo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · trigger de un salto activo (insert y update, definer); guarda de retirar en el nucleo compartido; sin cesion ni baja; un escritor';
end
$a$;

-- ============================ fixture ========================================
do $f$
declare r fx%rowtype; t text;
begin
  select * into r from fx;
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values (r.s_bea, 'personal', r.eur, r.bea), (r.s_carlos, 'personal', r.eur, r.carlos);
  insert into core.membership (scope_id, user_id) values (r.s_bea, r.bea), (r.s_carlos, r.carlos);
  perform pg_temp.gp_actor(r.bea);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a6000000-0000-4000-8000-000000000101', 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Cadena', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_bea, 'creator_display_name', 'Bea',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_ana, 'display_name', 'Ana'),
                                      jsonb_build_object('client_participant_id', r.p_ana2, 'display_name', 'Ana Lopez'),
                                      jsonb_build_object('client_participant_id', r.p_carlos, 'display_name', 'Carlos'))));
  perform pg_temp.gp_super();
  insert into core.membership (scope_id, user_id) values (r.g, r.carlos);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.p_carlos, r.g, r.carlos);
  -- Historia: Ana paga 800 para Ana y Bea; Bea paga 3000 para Bea, Ana, Ana Lopez; Carlos paga 400 para Carlos y Ana Lopez.
  t := pg_temp.gasto(r.bea, 'a6000000-0000-4000-8000-000000000201', r.p_ana, array[r.p_ana, r.p_bea], 800, 'Taxi');
  if t not like 'OK %' then raise exception 'fixture E0: %', t; end if;
  t := pg_temp.gasto(r.bea, 'a6000000-0000-4000-8000-000000000202', r.p_bea, array[r.p_bea, r.p_ana, r.p_ana2], 3000, 'Cena');
  if t not like 'OK %' then raise exception 'fixture E1: %', t; end if;
  t := pg_temp.gasto(r.carlos, 'a6000000-0000-4000-8000-000000000203', r.p_carlos, array[r.p_carlos, r.p_ana2], 400, 'Cafe');
  if t not like 'OK %' then raise exception 'fixture E2: %', t; end if;
end $f$;

-- ============================ B · retirar a un origen fusionado ==============
do $b$
declare r fx%rowtype; fallos text[] := '{}'; t text; v_antes text;
begin
  select * into r from fx;
  v_antes := pg_temp.saldos(r.bea);
  if v_antes not like '% suma=0' then fallos := array_append(fallos, 'B0: la fixture no suma cero: ' || v_antes); end if;
  -- Bea asocia a Ana (fantasma → identidad propia): la fusion valida de F09/ADR-009.
  t := pg_temp.asociar(r.bea, 'a6000000-0000-4000-8000-000000000301', r.p_ana);
  if t <> 'OK' then fallos := array_append(fallos, 'B1: asociar a Ana fallo: ' || t); end if;
  -- Retirar a Ana (ORIGEN) por cualquiera de las dos puertas: rehusado, sin escribir.
  t := pg_temp.retirar(r.carlos, 'a6000000-0000-4000-8000-000000000401', r.p_ana);
  if t <> 'PARTICIPANT_MERGED' then fallos := array_append(fallos, 'B2: retirar a un origen fusionado: ' || t); end if;
  -- «Saldado» es solo para quien salio: su puerta rehusa a un origen fusionado
  -- (activo) ANTES de llegar al nucleo, con su propio codigo; la guarda del
  -- nucleo queda detras como segunda barrera. Lo que importa: no escribe.
  t := pg_temp.saldar(r.carlos, 'a6000000-0000-4000-8000-000000000402', r.p_ana);
  if t not in ('PARTICIPANT_MERGED', 'PARTICIPANT_ACTIVE') then fallos := array_append(fallos, 'B3: «Saldado» a un origen fusionado: ' || t); end if;
  if exists (select 1 from core.participant_retirement where participant_id = r.p_ana) then fallos := array_append(fallos, 'B4: quedo una retirada escrita'); end if;
  if exists (select 1 from core.client_command where client_operation_id in ('a6000000-0000-4000-8000-000000000401', 'a6000000-0000-4000-8000-000000000402')) then
    fallos := array_append(fallos, 'B5: el rechazo dejo su clave de idempotencia');
  end if;
  if pg_temp.saldos(r.bea) not like '% suma=0' then fallos := array_append(fallos, 'B6: la suma cero se rompio: ' || pg_temp.saldos(r.bea)); end if;
  -- Retirar a un fantasma NO fusionado sigue funcionando (Ana Lopez, con sus pares).
  t := pg_temp.retirar(r.carlos, 'a6000000-0000-4000-8000-000000000403', r.p_ana2);
  if t <> 'OK' then fallos := array_append(fallos, 'B7: retirar a un fantasma normal dejo de funcionar: ' || t); end if;
  if pg_temp.saldos(r.bea) not like '% suma=0' then fallos := array_append(fallos, 'B8: tras retirar, la suma no es cero: ' || pg_temp.saldos(r.bea)); end if;
  if array_length(fallos, 1) is not null then
    raise exception E'B · retirar a un origen fusionado:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · retirar y «Saldado» rehusan a un origen fusionado con PARTICIPANT_MERGED, sin escribir; retirar a un fantasma normal sigue';
end
$b$;

-- ============================ C · las fusiones validas siguen ================
do $c$
declare r fx%rowtype; fallos text[] := '{}'; t text;
begin
  select * into r from fx;
  -- Un SEGUNDO fantasma sobre el mismo destino (dos origenes, un destino): valido.
  perform pg_temp.gp_super();
  insert into core.participant (id, scope_id, display_name) values ('a6000000-0000-4000-8000-000000000035', r.g, 'Anita');
  insert into core.participant_period (participant_id, valid_from, valid_until) values ('a6000000-0000-4000-8000-000000000035', current_date, null);
  t := pg_temp.asociar(r.bea, 'a6000000-0000-4000-8000-000000000302', 'a6000000-0000-4000-8000-000000000035');
  if t <> 'OK' then fallos := array_append(fallos, 'C1: un segundo origen sobre el mismo destino se rehuso: ' || t); end if;
  if (select count(*) from core.participant_merge where target_participant_id = r.p_bea) <> 2 then
    fallos := array_append(fallos, 'C2: deberia haber dos fusiones hacia Bea');
  end if;
  -- Y la API sigue rehusando lo de siempre: reasociar un origen, o asociar al destino.
  t := pg_temp.asociar(r.carlos, 'a6000000-0000-4000-8000-000000000303', r.p_ana);
  if t <> 'PARTICIPANT_MERGED' then fallos := array_append(fallos, 'C3: reasociar un origen: ' || t); end if;
  if array_length(fallos, 1) is not null then
    raise exception E'C · fusiones validas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · fantasma → identidad propia sigue funcionando, tambien con dos origenes sobre un destino';
end
$c$;

-- ============================ D · cadenas, en catalogo =======================
do $d$
declare r fx%rowtype; fallos text[] := '{}'; t text; v_antes text;
begin
  select * into r from fx;
  v_antes := pg_temp.saldos(r.bea);
  -- Estado: Ana → Bea y Anita → Bea. Escribiendo A MANO como postgres, sin la API:
  -- D1 · B → C: el ORIGEN es destino de otra (Bea → Carlos).
  t := pg_temp.fusion_manual(r.p_bea, r.p_carlos);
  if t <> 'PARTICIPANT_MERGED' then fallos := array_append(fallos, 'D1: el catalogo dejo pasar B → C: ' || t); end if;
  -- D2 · C → A: el DESTINO es origen de otra (Carlos → Ana).
  t := pg_temp.fusion_manual(r.p_carlos, r.p_ana);
  if t <> 'PARTICIPANT_MERGED' then fallos := array_append(fallos, 'D2: el catalogo dejo pasar C → A: ' || t); end if;
  -- D3 · A → C: el origen ya es origen (la PK lo rehusa antes que nadie).
  begin
    perform pg_temp.fusion_manual(r.p_ana, r.p_carlos);
    fallos := array_append(fallos, 'D3: un origen se fusiono dos veces');
  exception when unique_violation then null;
  end;
  -- D4 · reapuntar una fusion existente.
  begin
    update core.participant_merge set target_participant_id = r.p_carlos where source_participant_id = r.p_ana;
    fallos := array_append(fallos, 'D4: una fusion se reapunto');
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'PARTICIPANT_MERGED' then fallos := array_append(fallos, 'D4b: codigo inesperado ' || sqlerrm); end if;
  end;
  -- D5 · nada de eso escribio, y la suma cero sigue.
  if (select count(*) from core.participant_merge where scope_id = r.g) <> 2 then fallos := array_append(fallos, 'D5: cambio el numero de fusiones'); end if;
  if pg_temp.saldos(r.bea) <> v_antes or v_antes not like '% suma=0' then
    fallos := array_append(fallos, 'D6: los saldos cambiaron o no suman cero: ' || pg_temp.saldos(r.bea) || ' (antes ' || v_antes || ')');
  end if;
  -- D7 · una fusion nueva de un salto sigue entrando a mano (un fantasma nuevo hacia Carlos).
  perform pg_temp.gp_super();
  insert into core.participant (id, scope_id, display_name) values ('a6000000-0000-4000-8000-000000000036', r.g, 'Carl');
  insert into core.participant_period (participant_id, valid_from, valid_until) values ('a6000000-0000-4000-8000-000000000036', current_date, null);
  t := pg_temp.fusion_manual('a6000000-0000-4000-8000-000000000036', r.p_carlos);
  if t <> 'OK' then fallos := array_append(fallos, 'D7: el trigger rehuso una fusion de un salto valida: ' || t); end if;
  if array_length(fallos, 1) is not null then
    raise exception E'D · cadenas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · B → C, C → A y el reapuntado se rehusan en catalogo; A → B de un salto entra; la suma cero no se toca';
end
$d$;

rollback;
