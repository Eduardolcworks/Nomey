-- ============================================================================
-- TRANSFERENCIAS DENTRO DE UN GRUPO CON DOS VOLUNTADES (F12/ADR-003, F12.B3)
-- contra las funciones reales de 20260928120000, aislado
-- ============================================================================
--
--   cat supabase/checks/lib/group-payment-helpers.sql supabase/checks/group-transfer-proposals.sql \
--     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
-- Dentro de UNA transaccion now() no avanza, asi que created_at y left_at
-- coinciden: la ventana de la salida (created_at < left_at < expires_at) y
-- la caducidad se fijan como fixture, como postgres, RETRASANDO created_at /
-- expires_at de propuestas que las funciones produjeron. Las salidas son
-- reales (api.leave_group) y las vueltas tambien (api.redeem_invitation).
--
--   A · estructura: tabla con RLS; transfer_part ampliada todo-o-nada y las
--       filas de B1/B2 con nulos; propietarios (todo del writer; nada de
--       postgres); definer donde toca; EXECUTE por rol; el cliente sin
--       created_by ni target_user_id; policies created_by = actor intactas;
--       ninguna vista deriva el rol de created_by; nueve record_*; el writer
--       reclama solo sus claves en provisioning_command
--   B · crear: ni operacion, ni efecto, ni deuda, ni saldo; replay; moneda =
--       base del grupo; elegibilidad de ambos (anonimo, sin handle, no
--       miembro, fantasma, inactivo, a uno mismo, ajeno al grupo); tope de 3
--       pending por pareja y grupo; presupuesto MIXTO Personal + grupo
--   C · el estado y quien puede preguntarlo: creador y receptor si; un
--       tercero y una propuesta inexistente son indistinguibles; anonimo no;
--       solo state y cancel_reason; authenticated sin USAGE sobre sec
--   D · la salida (§6): seis casos y la vuelta; el rango 1 hace imposible
--       marcar despues de una salida en la ventana
--   E · aceptar: tres efectos, partes con grupo, autoria = receptor, fecha del
--       servidor, una version; replay; segunda clave; terminales; el algebra:
--       78 + 80 → el acreedor debe 2 (net_debt, pending_debt,
--       group_pending_pair, group_balance, claimed_dimension); 20 + 5, 20 +
--       30, 0 + N; en negativo se ejecuta; bases distintas
--   F · irreversibilidad; group_payment sigue con tope y anulable;
--       record_debt_settlement sigue con SETTLEMENT_EXCEEDS_DEBT
--   G · vistas: group_transfer_proposals, group_transfers, my_transfers
--       ampliada; sin uid ni Personal ajeno; concepto solo para las partes
--   H · el cliente no alcanza core
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  'b3000000-0000-4000-8000-0000000000a1'::uuid as aitor, -- handle, Personal EUR
  'b3000000-0000-4000-8000-0000000000b1'::uuid as edu,   -- handle, Personal EUR
  'b3000000-0000-4000-8000-0000000000c1'::uuid as cris,  -- handle, Personal EUR
  'b3000000-0000-4000-8000-0000000000d1'::uuid as dan,   -- SIN handle, Personal EUR, vinculado
  'b3000000-0000-4000-8000-0000000000f1'::uuid as fer,   -- handle, Personal EUR, fuera del grupo
  'b3000000-0000-4000-8000-000000000011'::uuid as inv,   -- invitado
  'b3000000-0000-4000-8000-000000000021'::uuid as nadie, -- sin nada
  'b3c00000-0000-4000-8000-0000000000e1'::uuid as eur,
  'b3c00000-0000-4000-8000-0000000000d1'::uuid as usd,
  'b3a00000-0000-4000-8000-0000000000a1'::uuid as pa,
  'b3a00000-0000-4000-8000-0000000000b1'::uuid as pb,
  'b3a00000-0000-4000-8000-0000000000c1'::uuid as pc,
  'b3a00000-0000-4000-8000-0000000000d1'::uuid as pd,
  'b3a00000-0000-4000-8000-0000000000f1'::uuid as pf,
  'b3a00000-0000-4000-8000-000000000100'::uuid as g,     -- el grupo principal
  'b3b00000-0000-4000-8000-000000000101'::uuid as xa,
  'b3b00000-0000-4000-8000-000000000102'::uuid as xb,
  'b3b00000-0000-4000-8000-000000000103'::uuid as xc,
  'b3b00000-0000-4000-8000-000000000104'::uuid as xd,
  'b3b00000-0000-4000-8000-000000000105'::uuid as xg,    -- fantasma (sin cuenta)
  'b3b00000-0000-4000-8000-000000000106'::uuid as xz;    -- periodo cerrado (inactivo)
grant select on fx to authenticated, nomey_writer;

insert into core.currency_definition (id, code, scale) select eur, 'EUR', 2 from fx union all select usd, 'USD', 2 from fx;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  select pa, 'personal', eur, aitor from fx union all select pb, 'personal', eur, edu from fx union all
  select pc, 'personal', eur, cris from fx union all select pd, 'personal', eur, dan from fx union all
  select pf, 'personal', eur, fer from fx;
insert into core.scope (id, kind, base_currency_definition_id) select g, 'group', eur from fx;
insert into core.membership (scope_id, user_id)
  select pa, aitor from fx union all select pb, edu from fx union all select pc, cris from fx union all
  select pd, dan from fx union all select pf, fer from fx union all
  select g, aitor from fx union all select g, edu from fx union all select g, cris from fx union all select g, dan from fx;
insert into core.participant (id, scope_id, display_name)
  select xa, g, 'Aitor' from fx union all select xb, g, 'Eduardo' from fx union all select xc, g, 'Cris' from fx union all
  select xd, g, 'Dan' from fx union all select xg, g, 'Fantasma' from fx union all select xz, g, 'Zeta' from fx;
insert into core.participant_user_link (participant_id, scope_id, user_id)
  select xa, g, aitor from fx union all select xb, g, edu from fx union all select xc, g, cris from fx union all select xd, g, dan from fx;
insert into core.participant_period (participant_id, valid_from, valid_until)
  select xa, date '2020-01-01', null::date from fx union all select xb, date '2020-01-01', null::date from fx union all
  select xc, date '2020-01-01', null::date from fx union all select xd, date '2020-01-01', null::date from fx union all
  select xg, date '2020-01-01', null::date from fx union all select xz, date '2020-01-01', date '2021-01-01' from fx;

create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.writer(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'nomey_writer', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid, boolean), pg_temp.writer(uuid, boolean), pg_temp.super() to authenticated, nomey_writer;

do $seed$
declare r record;
begin
  perform pg_temp.actor((select aitor from fx)); select * into r from api.reserve_username('{"handle":"aitor_gt","public_name":"Aitor"}');
  perform pg_temp.actor((select edu from fx));   select * into r from api.reserve_username('{"handle":"edu_gt","public_name":"Eduardo"}');
  perform pg_temp.actor((select cris from fx));  select * into r from api.reserve_username('{"handle":"cris_gt","public_name":"Cris"}');
  perform pg_temp.actor((select fer from fx));   select * into r from api.reserve_username('{"handle":"fer_gt","public_name":"Fer"}');
  perform pg_temp.super();
end $seed$;

-- crear como p_user: 'ok' | 'replay' | codigo. Guarda el id por clave.
create temp table props (key uuid primary key, proposal_id uuid);
grant select, insert on props to authenticated;
create function pg_temp.crear(p_user uuid, p_key uuid, p_group uuid, p_receiver uuid, p_amount text, p_concept text default null, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb; v jsonb;
begin
  v := jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'group_scope_id', p_group,
                          'receiver_participant_id', p_receiver, 'amount', p_amount);
  if p_concept is not null then v := v || jsonb_build_object('concept', p_concept); end if;
  perform pg_temp.actor(p_user, p_anon);
  r := api.create_group_transfer_proposal(v);
  perform pg_temp.super();
  if (r ->> 'already_processed')::boolean then return 'replay'; end if;
  insert into props (key, proposal_id) values (p_key, (r ->> 'proposal_id')::uuid);
  return 'ok';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.pid(p_key uuid) returns uuid language sql as $$ select proposal_id from props where key = p_key; $$;
-- aceptar: 'ok' | 'replay' | codigo[ reason]
create function pg_temp.aceptar(p_user uuid, p_key uuid, p_proposal uuid, p_extra jsonb default '{}'::jsonb, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.record_settlement_by_transfer(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1, 'proposal_id', p_proposal) || p_extra);
  perform pg_temp.super();
  return case when (r ->> 'already_processed')::boolean then 'replay' else 'ok' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return (sqlerrm::json ->> 'code') || coalesce(' ' || ((sqlerrm::json ->> 'details')::json ->> 'reason'), '');
end $$;
create function pg_temp.cancelar(p_user uuid, p_proposal uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.cancel_group_transfer_proposal(jsonb_build_object('proposal_id', p_proposal));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return (sqlerrm::json ->> 'code') || coalesce(' ' || ((sqlerrm::json ->> 'details')::json ->> 'reason'), '');
end $$;
create function pg_temp.rechazar(p_user uuid, p_proposal uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.decline_group_transfer_proposal(jsonb_build_object('proposal_id', p_proposal));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return (sqlerrm::json ->> 'code') || coalesce(' ' || ((sqlerrm::json ->> 'details')::json ->> 'reason'), '');
end $$;
create function pg_temp.anular(p_user uuid, p_key uuid, p_operation uuid) returns text language plpgsql as $$
declare r jsonb; v uuid;
begin
  select o.current_version_id into v from core.operation o where o.id = p_operation;
  perform pg_temp.actor(p_user);
  r := api.annul_operation(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1, 'operation_id', p_operation, 'expected_version_id', v));
  perform pg_temp.super();
  return 'ok';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- salir del grupo, por la funcion real: 'ok' | codigo
create function pg_temp.salir(p_user uuid, p_group uuid) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', p_group));
  perform pg_temp.super();
  return 'ok';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- volver al grupo con la identidad de siempre: p_host invita, p_user vuelve
create function pg_temp.volver(p_host uuid, p_user uuid, p_group uuid) returns text language plpgsql as $$
declare r jsonb; v_tok text;
begin
  perform pg_temp.actor(p_host);
  r := api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', p_group));
  v_tok := r ->> 'token';
  perform pg_temp.actor(p_user);
  r := api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', v_tok, 'choice', 'rejoin'));
  perform pg_temp.super();
  return r ->> 'state';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- gasto de grupo: p_payer paga p_total a medias con p_other
create function pg_temp.gasto(p_user uuid, p_group uuid, p_payer uuid, p_other uuid, p_total text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.record_group_expense(jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
        'effective_date', current_date::text, 'scope_id', p_group, 'currency_definition_id', (select eur from fx), 'total', p_total,
        'concept', 'Gasto', 'category_id', '4ed30a44-9f82-578f-828c-b491a25ebdd9', 'payer_participant_id', p_payer,
        'participants', jsonb_build_array(p_payer, p_other), 'split_method', jsonb_build_object('kind', 'equal')));
  perform pg_temp.super();
  return (r ->> 'operation_id')::uuid;
end $$;
-- estado por el helper interno, como postgres (lee las salidas)
create function pg_temp.estado(p_proposal uuid) returns text language sql as $$
  select st.state || coalesce('·' || st.cancel_reason, '')
    from core.group_transfer_proposal g
    cross join lateral sec.derive_group_transfer_proposal_state(g.group_scope_id, g.sender_participant_id, g.receiver_participant_id,
      g.created_at, g.expires_at, g.accepted_operation_id, g.declined_at, g.cancelled_at) st
   where g.id = p_proposal;
$$;
-- estado por el helper AUTORIZADO, como el writer con el JWT de p_user: 'state·reason' | '-' (ninguna fila)
create function pg_temp.estado_como(p_user uuid, p_proposal uuid, p_anon boolean default false) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.writer(p_user, p_anon);
  select coalesce(string_agg(st.state || coalesce('·' || st.cancel_reason, ''), ';'), '-') into v from sec.group_transfer_proposal_state(p_proposal) st;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.op_de(p_proposal uuid) returns uuid language sql as $$ select accepted_operation_id from core.group_transfer_proposal where id = p_proposal; $$;
create function pg_temp.saldo(p_scope uuid) returns bigint language sql as $$
  select coalesce(sum(e.balance_amount), 0) from core.current_effect e where e.scope_id = p_scope and e.balance_amount is not null;
$$;
create function pg_temp.neto(p_group uuid, p_debtor uuid, p_creditor uuid) returns bigint language sql as $$
  select sec.net_debt(p_group, p_debtor, p_creditor, null);
$$;
create function pg_temp.pendiente(p_group uuid, p_debtor uuid, p_creditor uuid) returns bigint language sql as $$
  select sec.pending_debt(p_group, p_debtor, p_creditor, null);
$$;
create function pg_temp.pares(p_group uuid) returns text language sql as $$
  select coalesce(string_agg(pg_temp.gp_name(debtor_participant_id) || '>' || pg_temp.gp_name(creditor_participant_id) || ':' || amount, ' ' order by pg_temp.gp_name(debtor_participant_id), pg_temp.gp_name(creditor_participant_id)), '-')
    from api.group_pending_pair where scope_id = p_group;
$$;
create function pg_temp.ops() returns integer language sql as $$
  select count(*)::integer from core.operation where operation_class = 'settlement_by_transfer';
$$;
create function pg_temp.vista_propuestas(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(direction || ':' || sender_display_name || '>' || receiver_display_name || ':' || amount || ':' || state || coalesce('·' || cancel_reason, ''), ';' order by created_at, amount::bigint), '-') into v from api.group_transfer_proposals;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.espera(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: se esperaba «%» y se obtuvo «%»', p_label, p_want, p_got;
  end if;
end $$;
create function pg_temp.k(p_n integer) returns uuid language sql immutable as $$
  select ('b3e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
-- un grupo mas, con Aitor, Edu y Cris vinculados (para cada caso de salida)
create function pg_temp.grupo(p_g uuid, p_xa uuid, p_xb uuid, p_xc uuid) returns void language plpgsql as $$
declare r record;
begin
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id) values (p_g, 'group', r.eur);
  insert into core.membership (scope_id, user_id) values (p_g, r.aitor), (p_g, r.edu), (p_g, r.cris);
  insert into core.participant (id, scope_id, display_name) values (p_xa, p_g, 'Aitor'), (p_xb, p_g, 'Eduardo'), (p_xc, p_g, 'Cris');
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (p_xa, p_g, r.aitor), (p_xb, p_g, r.edu), (p_xc, p_g, r.cris);
  insert into core.participant_period (participant_id, valid_from) values (p_xa, date '2020-01-01'), (p_xb, date '2020-01-01'), (p_xc, date '2020-01-01');
end $$;
grant execute on function pg_temp.crear(uuid, uuid, uuid, uuid, text, text, boolean), pg_temp.pid(uuid), pg_temp.aceptar(uuid, uuid, uuid, jsonb, boolean),
  pg_temp.cancelar(uuid, uuid, boolean), pg_temp.rechazar(uuid, uuid, boolean), pg_temp.anular(uuid, uuid, uuid), pg_temp.salir(uuid, uuid),
  pg_temp.volver(uuid, uuid, uuid), pg_temp.gasto(uuid, uuid, uuid, uuid, text), pg_temp.estado(uuid), pg_temp.estado_como(uuid, uuid, boolean),
  pg_temp.op_de(uuid), pg_temp.saldo(uuid), pg_temp.neto(uuid, uuid, uuid), pg_temp.pendiente(uuid, uuid, uuid), pg_temp.pares(uuid), pg_temp.ops(),
  pg_temp.vista_propuestas(uuid), pg_temp.espera(text, text, text), pg_temp.k(integer), pg_temp.grupo(uuid, uuid, uuid, uuid) to authenticated, nomey_writer;

-- ═══════════════════════ A · estructura ═══════════════════════════════════════
do $a$
declare
  v_n integer;
  v_t text;
  r record;
begin
  if not (select relrowsecurity from pg_class where oid = 'core.group_transfer_proposal'::regclass) then raise exception 'A: sin RLS'; end if;
  select count(*) into v_n from pg_constraint where conrelid = 'core.group_transfer_proposal'::regclass and contype = 'c';
  if v_n < 7 then raise exception 'A: core.group_transfer_proposal tiene % CHECKs, se esperaban al menos 7', v_n; end if;
  select count(*) into v_n from pg_constraint where conrelid = 'core.group_transfer_proposal'::regclass and contype = 'f'
    and pg_get_constraintdef(oid) like '%REFERENCES core.participant(id, scope_id)%';
  if v_n <> 2 then raise exception 'A: los dos participantes no van por FK compuesta al grupo (%)', v_n; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'group_transfer_proposal'
                  and indexdef ilike '%unique%' and indexdef ilike '%(accepted_operation_id)%') then
    raise exception 'A: falta el indice unico de accepted_operation_id';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'group_transfer_proposal'
              and column_name in ('handle', 'username', 'public_name', 'display_name', 'cancel_reason', 'state')) then
    raise exception 'A: la propuesta persiste un handle, un nombre o un estado';
  end if;
  -- transfer_part: todo o nada, y las filas de B1/B2 con nulos
  if not exists (select 1 from pg_constraint where conrelid = 'core.transfer_part'::regclass and conname = 'transfer_part_grupo_todo_o_nada') then
    raise exception 'A: falta el CHECK todo-o-nada de transfer_part';
  end if;
  select count(*) into v_n from pg_constraint where conrelid = 'core.transfer_part'::regclass and contype = 'f'
    and pg_get_constraintdef(oid) like '%REFERENCES core.participant(id, scope_id)%';
  if v_n <> 2 then raise exception 'A: las partes de grupo no van por FK compuesta (%)', v_n; end if;
  begin
    insert into core.transfer_part (operation_version_id, from_scope_id, to_scope_id, group_scope_id)
    values (gen_random_uuid(), (select pa from fx), (select pb from fx), (select g from fx));
    raise exception 'A: transfer_part acepto el grupo sin participantes';
  exception when check_violation then null;
  end;
  raise notice 'OK · A1 · tabla con RLS, CHECKs y FK compuestas; transfer_part ampliada todo-o-nada';

  for r in select n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'api' and p.proname in ('create_group_transfer_proposal', 'cancel_group_transfer_proposal', 'decline_group_transfer_proposal', 'record_settlement_by_transfer', 'annul_operation'))
               or (n.nspname = 'sec' and p.proname in ('derive_group_transfer_proposal_state', 'group_transfer_proposal_state')) loop
    if r.owner <> 'nomey_writer' then raise exception 'A: % es de %, no del writer', r.name, r.owner; end if;
    if r.definer <> (r.name like 'api.%' or r.name = 'sec.group_transfer_proposal_state') then
      raise exception 'A: % definer=% no es lo esperado', r.name, r.definer;
    end if;
  end loop;
  if (select pg_get_userbyid(proowner) || ':' || prosecdef::text from pg_proc where oid = 'sec.assert_proposal_budget(uuid)'::regprocedure) <> 'nomey_provisioner:true' then
    raise exception 'A: sec.assert_proposal_budget no es definer del provisioner';
  end if;
  if (select pg_get_userbyid(proowner) || ':' || prosecdef::text from pg_proc where oid = 'sec.persist_version(uuid,uuid,uuid,integer,uuid,text,date,bigint,uuid,time,text)'::regprocedure) <> 'postgres:false' then
    raise exception 'A: sec.persist_version cambio de propietario o de definer';
  end if;
  if exists (select 1 from pg_roles where rolname in ('nomey_writer', 'nomey_provisioner') and rolbypassrls) then raise exception 'A: BYPASSRLS'; end if;
  raise notice 'OK · A2 · propietarios: todo lo nuevo del writer; el presupuesto, definer del provisioner; persist_version intacta; sin BYPASSRLS';

  foreach v_t in array array['api.create_group_transfer_proposal(jsonb)', 'api.cancel_group_transfer_proposal(jsonb)', 'api.decline_group_transfer_proposal(jsonb)', 'api.record_settlement_by_transfer(jsonb)'] loop
    if not has_function_privilege('authenticated', v_t, 'execute') then raise exception 'A: authenticated no ejecuta %', v_t; end if;
    if has_function_privilege('anon', v_t, 'execute') or has_function_privilege('public', v_t, 'execute') then raise exception 'A: anon o public ejecutan %', v_t; end if;
  end loop;
  if has_function_privilege('authenticated', 'sec.derive_group_transfer_proposal_state(uuid,uuid,uuid,timestamptz,timestamptz,uuid,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('nomey_provisioner', 'sec.derive_group_transfer_proposal_state(uuid,uuid,uuid,timestamptz,timestamptz,uuid,timestamptz,timestamptz)', 'execute') then
    raise exception 'A: la derivacion cruda la ejecuta alguien distinto del writer';
  end if;
  if not has_function_privilege('nomey_writer', 'sec.assert_proposal_budget(uuid)', 'execute') or not has_function_privilege('nomey_writer', 'sec.lock_proposal_budget(uuid)', 'execute') then
    raise exception 'A: el writer no ejecuta el presupuesto compartido';
  end if;
  -- authenticated NO tiene USAGE sobre sec: ninguna funcion de sec es invocable
  -- directamente por el cliente; el EXECUTE solo sirve a las vistas (por OID).
  if has_schema_privilege('authenticated', 'sec', 'usage') or has_schema_privilege('anon', 'sec', 'usage') then
    raise exception 'A: el cliente tiene USAGE sobre sec';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and has_function_privilege('supabase_auth_admin', p.oid, 'execute');
  if v_n <> 1 then raise exception 'A: supabase_auth_admin ejecuta % funciones de sec', v_n; end if;
  raise notice 'OK · A3 · EXECUTE: cliente solo api (y sin USAGE sobre sec); derivacion cruda solo writer; presupuesto writer + provisioner';

  if exists (select 1 from information_schema.column_privileges where table_schema = 'core' and table_name = 'group_transfer_proposal'
              and grantee = 'authenticated' and column_name in ('created_by', 'target_user_id')) then
    raise exception 'A: authenticated puede leer created_by o target_user_id';
  end if;
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.column_privileges
   where table_schema = 'core' and table_name = 'group_transfer_proposal' and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_t <> 'accepted_at,accepted_operation_id,cancelled_at,declined_at' then raise exception 'A: el writer actualiza % de la propuesta', v_t; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'group_transfer_proposal'
              and grantee in ('authenticated', 'nomey_provisioner', 'nomey_writer') and privilege_type = 'DELETE') then
    raise exception 'A: alguien puede borrar propuestas';
  end if;
  select string_agg(privilege_type, ',' order by privilege_type) into v_t from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'provisioning_command' and grantee = 'nomey_writer';
  if v_t <> 'INSERT,SELECT' then raise exception 'A: el writer tiene % sobre provisioning_command', v_t; end if;
  if not exists (select 1 from pg_policies where tablename = 'provisioning_command' and policyname = 'provisioning_command_writer_self'
                  and qual like '%created_by = sec.request_actor_id()%' and with_check like '%created_by = sec.request_actor_id()%') then
    raise exception 'A: la policy del writer sobre provisioning_command no es self-only';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'group_departure' and roles = '{nomey_writer}' and cmd = 'SELECT') then
    raise exception 'A: el writer no lee group_departure';
  end if;
  raise notice 'OK · A4 · columnas: cliente sin uid; writer solo las marcas; nadie borra; provisioning_command self-only para el writer; group_departure legible por el writer';

  for v_t in select unnest(array['operation', 'operation_version', 'client_command', 'effect']) loop
    if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = v_t and roles = '{nomey_writer}' and cmd = 'INSERT'
                    and with_check ilike '%created_by = sec.request_actor_id()%') then
      raise exception 'A: la policy de INSERT del writer sobre core.% ya no exige created_by = actor', v_t;
    end if;
  end loop;
  for v_t in select unnest(array['group_transfer_proposals', 'group_transfers', 'my_transfers', 'my_transfer_proposals', 'my_payment_requests']) loop
    if pg_get_viewdef(('api.' || v_t)::regclass) ilike '%created_by%' or pg_get_viewdef(('api.' || v_t)::regclass) ilike '%target_user_id%' then
      raise exception 'A: api.% deriva algo de created_by o target_user_id', v_t;
    end if;
    if not exists (select 1 from pg_class where oid = ('api.' || v_t)::regclass and reloptions @> array['security_invoker=true']) then
      raise exception 'A: api.% no es security_invoker', v_t;
    end if;
  end loop;
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'group_transfer_proposals';
  if v_t <> 'proposal_id,group_scope_id,sender_participant_id,receiver_participant_id,sender_display_name,receiver_display_name,direction,amount,currency_definition_id,concept,created_at,expires_at,state,cancel_reason,accepted_operation_id' then
    raise exception 'A: columnas de api.group_transfer_proposals: %', v_t;
  end if;
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'group_transfers';
  if v_t <> 'operation_id,group_scope_id,sender_participant_id,receiver_participant_id,sender_display_name,receiver_display_name,is_sender,is_receiver,amount,currency_definition_id,effective_date,effective_time,concept,proposal_id,operation_created_at' then
    raise exception 'A: columnas de api.group_transfers: %', v_t;
  end if;
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'my_transfers';
  if v_t <> 'operation_id,scope_id,currency_definition_id,balance_amount,direction,amount,effective_date,effective_time,concept,counterpart_handle,counterpart_public_name,proposal_id,operation_created_at,payment_request_id,group_scope_id,group_transfer_proposal_id' then
    raise exception 'A: columnas de api.my_transfers: %', v_t;
  end if;
  -- LA LISTA EXACTA, no un recuento: B3 no añadio ninguna clase, y lo que
  -- prueba eso es QUIENES son, no cuantos. F12.C3 (`20261006120000`) si añadio
  -- una —`record_group_transfer`, la transferencia de grupo de UNA voluntad—,
  -- que es una clase nueva y deliberada; figura aqui por su nombre para que
  -- la siguiente no pueda colarse.
  select string_agg(p.proname, ' ' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname like 'record\_%';
  if v_t <> 'record_adjustment record_debt_settlement record_external_transfer'
         || ' record_group_expense record_group_payment record_group_transfer'
         || ' record_internal_transfer record_personal_expense record_personal_income'
         || ' record_settlement_by_transfer' then
    raise exception 'A: los api.record_* son: %', v_t;
  end if;
  raise notice 'OK · A5 · policies created_by = actor intactas; vistas invoker sin uid, con sus columnas (my_transfers amplia AL FINAL); los diez record_* por su nombre';
end
$a$;

-- ═══════════════════════ B · crear ════════════════════════════════════════════
do $b$
declare
  aitor constant uuid := (select aitor from fx); edu constant uuid := (select edu from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); fer constant uuid := (select fer from fx); inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  g constant uuid := (select g from fx); xa constant uuid := (select xa from fx); xb constant uuid := (select xb from fx); xc constant uuid := (select xc from fx);
  xd constant uuid := (select xd from fx); xg constant uuid := (select xg from fx); xz constant uuid := (select xz from fx);
  pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx);
  v_p uuid; v_n integer; i integer; v_env jsonb;
begin
  -- B1 · crear: intencion persistida, nada contable; moneda = base del grupo; replay; otra intencion
  perform pg_temp.espera('B1 crear', pg_temp.crear(aitor, pg_temp.k(1), g, xb, '8000', '  Te paso  '), 'ok');
  v_p := pg_temp.pid(pg_temp.k(1));
  perform pg_temp.espera('B1 estado', pg_temp.estado(v_p), 'pending');
  if (select concept || '|' || (currency_definition_id = (select eur from fx))::text || '|' || (target_user_id = edu)::text || '|' || (sender_participant_id = xa)::text
        from core.group_transfer_proposal where id = v_p) <> 'Te paso|true|true|true' then
    raise exception 'B1: la propuesta no fijo concepto canonico, moneda del grupo, uid del receptor y participante del emisor';
  end if;
  if (select expires_at - created_at from core.group_transfer_proposal where id = v_p) <> interval '7 days' then raise exception 'B1: la caducidad no es de 7 dias'; end if;
  if pg_temp.ops() <> 0 or pg_temp.saldo(pa) <> 0 or pg_temp.saldo(pb) <> 0 or pg_temp.neto(g, xa, xb) <> 0 then raise exception 'B1: crear toco la contabilidad'; end if;
  perform pg_temp.espera('B1 replay', pg_temp.crear(aitor, pg_temp.k(1), g, xb, '8000', 'Te paso'), 'replay');
  perform pg_temp.espera('B1 otra intencion', pg_temp.crear(aitor, pg_temp.k(1), g, xb, '8001', 'Te paso'), 'IDEMPOTENCY_KEY_REUSED');
  if (select count(*) from core.group_transfer_proposal) <> 1 then raise exception 'B1: el replay creo otra'; end if;
  -- el comando quedo en provisioning_command a nombre del writer... del ACTOR
  if (select count(*) from core.provisioning_command where command_type = 'group_transfer_proposal.create' and created_by = aitor) <> 1 then
    raise exception 'B1: el comando de creacion no quedo reclamado por el actor';
  end if;
  raise notice 'OK · B1 · crear persiste la intencion (uid y participante fijados, base del grupo, 7 dias) sin tocar saldo ni deuda; replay e IDEMPOTENCY_KEY_REUSED';

  -- B2 · elegibilidad al crear
  perform pg_temp.espera('B2 negativo', pg_temp.crear(aitor, pg_temp.k(2), g, xb, '-5'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B2 anonimo', pg_temp.crear(inv, pg_temp.k(2), g, xb, '5', null, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B2 sin handle (Dan)', pg_temp.crear(dan, pg_temp.k(2), g, xb, '5'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('B2 no miembro (Fer)', pg_temp.crear(fer, pg_temp.k(2), g, xb, '5'), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B2 a uno mismo', pg_temp.crear(aitor, pg_temp.k(2), g, xa, '5'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B2 fantasma', pg_temp.crear(aitor, pg_temp.k(2), g, xg, '5'), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B2 inactivo (Zeta)', pg_temp.crear(aitor, pg_temp.k(2), g, xz, '5'), 'PARTICIPANT_INACTIVE');
  perform pg_temp.espera('B2 receptor sin handle (Dan)', pg_temp.crear(aitor, pg_temp.k(2), g, xd, '5'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('B2 participante de otro grupo', pg_temp.crear(aitor, pg_temp.k(2), g, gen_random_uuid(), '5'), 'PARTICIPANT_NOT_IN_SCOPE');
  perform pg_temp.espera('B2 grupo inexistente', pg_temp.crear(aitor, pg_temp.k(2), gen_random_uuid(), xb, '5'), 'NOT_AUTHORIZED');
  begin
    perform pg_temp.actor(aitor);
    perform api.create_group_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'group_scope_id', g, 'receiver_participant_id', xb, 'amount', '5', 'currency_definition_id', (select usd from fx)));
    raise exception 'B2: se acepto una moneda en el payload';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PAYLOAD_INVALID' then raise exception 'B2: moneda en el payload dio %', sqlerrm::json ->> 'code'; end if;
  end;
  if (select count(*) from core.group_transfer_proposal) <> 1 or (select count(*) from core.provisioning_command where command_type = 'group_transfer_proposal.create') <> 1 then
    raise exception 'B2: un rechazo dejo propuesta o comando';
  end if;
  raise notice 'OK · B2 · elegibilidad al crear: anonimo, no miembro, fantasma → NOT_AUTHORIZED; sin handle (emisor o receptor) → USERNAME_REQUIRED; inactivo → PARTICIPANT_INACTIVE; ajeno → PARTICIPANT_NOT_IN_SCOPE; a uno mismo y moneda en el payload → PAYLOAD_INVALID; nada persiste';

  -- B3 · tope: 3 pending por (emisor, receptor, grupo); la Personal no cuenta aqui ni al reves
  perform pg_temp.espera('B3 segunda a Edu', pg_temp.crear(aitor, pg_temp.k(11), g, xb, '11'), 'ok');
  perform pg_temp.espera('B3 tercera a Edu', pg_temp.crear(aitor, pg_temp.k(12), g, xb, '12'), 'ok');
  perform pg_temp.espera('B3 cuarta a Edu', pg_temp.crear(aitor, pg_temp.k(13), g, xb, '13'), 'PROPOSAL_LIMIT_PER_TARGET');
  perform pg_temp.espera('B3 a Cris si', pg_temp.crear(aitor, pg_temp.k(13), g, xc, '13'), 'ok');
  perform pg_temp.espera('B3 cancelar libera', pg_temp.cancelar(aitor, pg_temp.pid(pg_temp.k(11))), 'cancelled');
  perform pg_temp.espera('B3 vuelve a caber', pg_temp.crear(aitor, pg_temp.k(14), g, xb, '14'), 'ok');
  perform pg_temp.espera('B3 rechazar libera', pg_temp.rechazar(edu, pg_temp.pid(pg_temp.k(12))), 'declined');
  perform pg_temp.espera('B3 vuelve a caber otra', pg_temp.crear(aitor, pg_temp.k(15), g, xb, '15'), 'ok');
  -- la Personal hacia Edu no consume el tope de grupo
  perform pg_temp.actor(aitor);
  v_env := api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(16), 'command_contract_version', 1, 'handle', 'edu_gt', 'amount', '16', 'currency_definition_id', (select eur from fx)));
  perform pg_temp.super();
  perform pg_temp.espera('B3 con tres de grupo pending la cuarta 409', pg_temp.crear(aitor, pg_temp.k(17), g, xb, '17'), 'PROPOSAL_LIMIT_PER_TARGET');
  raise notice 'OK · B3 · tres pending por pareja y grupo; cancelar y rechazar liberan; la propuesta Personal no cuenta en el tope de grupo';

  -- B4 · presupuesto MIXTO: Aitor lleva 7 (k1, k11, k12, k13, k14, k15 de grupo + k16 Personal)
  perform pg_temp.espera('B4 en ventana', (select count(*) from core.group_transfer_proposal where created_by = aitor)::text || '+' || (select count(*) from core.transfer_proposal where created_by = aitor)::text, '6+1');
  perform pg_temp.actor(aitor);
  v_env := api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(18), 'command_contract_version', 1, 'handle', 'cris_gt', 'amount', '18', 'currency_definition_id', (select eur from fx)));
  v_env := api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(19), 'command_contract_version', 1, 'handle', 'fer_gt', 'amount', '19', 'currency_definition_id', (select eur from fx)));
  perform pg_temp.super();
  perform pg_temp.espera('B4 decima (grupo)', pg_temp.crear(aitor, pg_temp.k(20), g, xc, '20'), 'ok');
  perform pg_temp.espera('B4 undecima de grupo', pg_temp.crear(aitor, pg_temp.k(21), g, xc, '21'), 'PROPOSAL_RATE_LIMITED');
  begin
    perform pg_temp.actor(aitor);
    perform api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(22), 'command_contract_version', 1, 'handle', 'fer_gt', 'amount', '22', 'currency_definition_id', (select eur from fx)));
    raise exception 'B4: la undecima Personal entro';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PROPOSAL_RATE_LIMITED' then raise exception 'B4: undecima Personal dio %', sqlerrm::json ->> 'code'; end if;
  end;
  -- otro emisor no comparte; y envejecer una saca de la ventana
  perform pg_temp.espera('B4 otro emisor', pg_temp.crear(edu, pg_temp.k(23), g, xa, '23'), 'ok');
  update core.transfer_proposal set created_at = now() - interval '61 minutes', expires_at = now() + interval '6 days' where created_by = aitor and client_command_id = pg_temp.k(19);
  perform pg_temp.espera('B4 fuera de ventana, cabe otra', pg_temp.crear(aitor, pg_temp.k(21), g, xc, '21'), 'ok');
  begin
    perform pg_temp.actor(aitor);
    perform api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(24), 'command_contract_version', 1, 'handle', 'fer_gt', 'amount', '24', 'currency_definition_id', (select eur from fx)));
    raise exception 'B4: tras rellenar el hueco entro otra';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PROPOSAL_RATE_LIMITED' then raise exception 'B4: la siguiente dio %', sqlerrm::json ->> 'code'; end if;
  end;
  raise notice 'OK · B4 · presupuesto UNICO Personal + grupo: 7 grupo + 3 Personal = 10, la undecima PROPOSAL_RATE_LIMITED por cualquiera de las dos vias; por emisor; la ventana envejece';
end
$b$;

-- ═══════════════════════ C · el estado, y quien puede preguntarlo ═════════════
do $c$
declare
  aitor constant uuid := (select aitor from fx); edu constant uuid := (select edu from fx); cris constant uuid := (select cris from fx);
  inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  v_p uuid; v_t text;
begin
  v_p := pg_temp.pid(pg_temp.k(1));  -- Aitor → Edu, pending
  perform pg_temp.espera('C A · el creador', pg_temp.estado_como(aitor, v_p), 'pending');
  perform pg_temp.espera('C B · el receptor', pg_temp.estado_como(edu, v_p), 'pending');
  perform pg_temp.espera('C C · un tercero (Cris, miembro)', pg_temp.estado_como(cris, v_p), '-');
  perform pg_temp.espera('C C · un tercero, propuesta inexistente', pg_temp.estado_como(cris, gen_random_uuid()), '-');
  perform pg_temp.espera('C C · nadie', pg_temp.estado_como(nadie, v_p), '-');
  perform pg_temp.espera('C D · anonimo (aunque sea el creador)', pg_temp.estado_como(aitor, v_p, true), '-');
  perform pg_temp.espera('C D · anonimo cualquiera', pg_temp.estado_como(inv, v_p, true), '-');
  -- E · el helper publica exactamente state y cancel_reason
  select string_agg(a.name, ',' order by a.ord) into v_t
    from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(name, mode, ord)
   where p.oid = 'sec.group_transfer_proposal_state(uuid)'::regprocedure and a.mode = 't';
  perform pg_temp.espera('C E · columnas del helper', v_t, 'state,cancel_reason');
  -- cancelada y con motivo: el creador lo ve; un tercero sigue sin ver nada
  perform pg_temp.espera('C cancelada con motivo', pg_temp.estado_como(aitor, pg_temp.pid(pg_temp.k(11))), 'cancelled·creator');
  perform pg_temp.espera('C tercero sobre una cancelada', pg_temp.estado_como(cris, pg_temp.pid(pg_temp.k(11))), '-');
  -- el cliente no puede llamar a sec directamente (sin USAGE): la unica via es la vista
  perform pg_temp.actor(cris);
  begin
    perform * from sec.group_transfer_proposal_state(v_p);
    raise exception 'C: authenticated llama a sec.group_transfer_proposal_state directamente';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · C · estado con autorizacion interna: creador y receptor si; tercero, inexistente y anonimo no (indistinguibles); solo state y cancel_reason; el cliente no llama a sec';
end
$c$;

-- ═══════════════════════ D · la salida (§6) ═══════════════════════════════════
do $d$
declare
  aitor constant uuid := (select aitor from fx); edu constant uuid := (select edu from fx); cris constant uuid := (select cris from fx);
  g2 constant uuid := 'b3a00000-0000-4000-8000-000000000200'; ya constant uuid := 'b3b00000-0000-4000-8000-000000000201'; yb constant uuid := 'b3b00000-0000-4000-8000-000000000202'; yc constant uuid := 'b3b00000-0000-4000-8000-000000000203';
  g3 constant uuid := 'b3a00000-0000-4000-8000-000000000300'; za constant uuid := 'b3b00000-0000-4000-8000-000000000301'; zb constant uuid := 'b3b00000-0000-4000-8000-000000000302'; zc constant uuid := 'b3b00000-0000-4000-8000-000000000303';
  g4 constant uuid := 'b3a00000-0000-4000-8000-000000000400'; wa constant uuid := 'b3b00000-0000-4000-8000-000000000401'; wb constant uuid := 'b3b00000-0000-4000-8000-000000000402'; wc constant uuid := 'b3b00000-0000-4000-8000-000000000403';
  g5 constant uuid := 'b3a00000-0000-4000-8000-000000000500'; va constant uuid := 'b3b00000-0000-4000-8000-000000000501'; vb constant uuid := 'b3b00000-0000-4000-8000-000000000502'; vc constant uuid := 'b3b00000-0000-4000-8000-000000000503';
  g6 constant uuid := 'b3a00000-0000-4000-8000-000000000600'; ua constant uuid := 'b3b00000-0000-4000-8000-000000000601'; ub constant uuid := 'b3b00000-0000-4000-8000-000000000602'; uc constant uuid := 'b3b00000-0000-4000-8000-000000000603';
  g7 constant uuid := 'b3a00000-0000-4000-8000-000000000700'; ta constant uuid := 'b3b00000-0000-4000-8000-000000000701'; tb constant uuid := 'b3b00000-0000-4000-8000-000000000702'; tc constant uuid := 'b3b00000-0000-4000-8000-000000000703';
  v_p uuid; v_op uuid;
begin
  -- B4 agoto el presupuesto de Aitor: sus propuestas envejecen como fixture (fuera de la ventana de 60 min).
  update core.transfer_proposal set created_at = created_at - interval '2 hours' where created_by = aitor;
  update core.group_transfer_proposal set created_at = created_at - interval '2 hours' where created_by = aitor;
  perform pg_temp.grupo(g2, ya, yb, yc); perform pg_temp.grupo(g3, za, zb, zc); perform pg_temp.grupo(g4, wa, wb, wc);
  perform pg_temp.grupo(g5, va, vb, vc); perform pg_temp.grupo(g6, ua, ub, uc); perform pg_temp.grupo(g7, ta, tb, tc);

  -- D1 · accept → leave: accepted permanece. Edu paga 50 a medias (Aitor le debe 25), Aitor propone 25, Edu acepta, neto 0, Aitor sale.
  perform pg_temp.gasto(edu, g2, yb, ya, '5000');
  perform pg_temp.espera('D1 crear', pg_temp.crear(aitor, pg_temp.k(101), g2, yb, '2500'), 'ok');
  v_p := pg_temp.pid(pg_temp.k(101));
  update core.group_transfer_proposal set created_at = now() - interval '1 hour', expires_at = now() + interval '6 days' where id = v_p;
  perform pg_temp.espera('D1 aceptar', pg_temp.aceptar(edu, pg_temp.k(102), v_p), 'ok');
  perform pg_temp.espera('D1 neto 0', pg_temp.neto(g2, ya, yb)::text, '0');
  perform pg_temp.espera('D1 Aitor sale', pg_temp.salir(aitor, g2), 'ok');
  perform pg_temp.espera('D1 sigue accepted', pg_temp.estado(v_p), 'accepted');
  if pg_temp.op_de(v_p) is null then raise exception 'D1: la operacion desaparecio'; end if;
  raise notice 'OK · D1 · accept → leave: accepted permanece y la operacion existe';

  -- D2 · leave → accept: cancelled·departure; aceptar, rechazar y cancelar → PROPOSAL_CANCELLED departure; rejoin no revive
  perform pg_temp.espera('D2 crear', pg_temp.crear(aitor, pg_temp.k(103), g3, zb, '2500'), 'ok');
  v_p := pg_temp.pid(pg_temp.k(103));
  update core.group_transfer_proposal set created_at = now() - interval '1 hour', expires_at = now() + interval '6 days' where id = v_p;
  perform pg_temp.espera('D2 Aitor sale', pg_temp.salir(aitor, g3), 'ok');
  perform pg_temp.espera('D2 estado', pg_temp.estado(v_p), 'cancelled·departure');
  perform pg_temp.espera('D2 aceptar', pg_temp.aceptar(edu, pg_temp.k(104), v_p), 'PROPOSAL_CANCELLED departure');
  perform pg_temp.espera('D2 rechazar', pg_temp.rechazar(edu, v_p), 'PROPOSAL_CANCELLED departure');
  perform pg_temp.espera('D2 cancelar (creador ya fuera)', pg_temp.cancelar(aitor, v_p), 'PROPOSAL_CANCELLED departure');
  if pg_temp.ops() <> 1 then raise exception 'D2: se materializo algo'; end if;
  if exists (select 1 from core.client_command where client_operation_id = pg_temp.k(104)) then raise exception 'D2: la aceptacion dejo clave'; end if;
  perform pg_temp.espera('D2 Aitor vuelve', pg_temp.volver(cris, aitor, g3), 'ok');
  perform pg_temp.espera('D2 tras volver sigue cancelled·departure', pg_temp.estado(v_p), 'cancelled·departure');
  perform pg_temp.espera('D2 aceptar tras volver', pg_temp.aceptar(edu, pg_temp.k(105), v_p), 'PROPOSAL_CANCELLED departure');
  perform pg_temp.espera('D2 el creador la ve cancelada por salida', pg_temp.estado_como(aitor, v_p), 'cancelled·departure');
  raise notice 'OK · D2 · leave → pending: cancelled·departure; aceptar/rechazar/cancelar → PROPOSAL_CANCELLED (departure); volver no revive';

  -- D3 · la salida del RECEPTOR tambien invalida
  perform pg_temp.espera('D3 crear', pg_temp.crear(aitor, pg_temp.k(106), g4, wb, '2500'), 'ok');
  v_p := pg_temp.pid(pg_temp.k(106));
  update core.group_transfer_proposal set created_at = now() - interval '1 hour', expires_at = now() + interval '6 days' where id = v_p;
  perform pg_temp.espera('D3 Edu sale', pg_temp.salir(edu, g4), 'ok');
  perform pg_temp.espera('D3 estado', pg_temp.estado(v_p), 'cancelled·departure');
  raise notice 'OK · D3 · la salida del receptor tambien invalida';

  -- D4 · decline → leave: declined permanece
  perform pg_temp.espera('D4 crear', pg_temp.crear(aitor, pg_temp.k(107), g5, vb, '2500'), 'ok');
  v_p := pg_temp.pid(pg_temp.k(107));
  update core.group_transfer_proposal set created_at = now() - interval '1 hour', expires_at = now() + interval '6 days' where id = v_p;
  perform pg_temp.espera('D4 rechazar', pg_temp.rechazar(edu, v_p), 'declined');
  perform pg_temp.espera('D4 Edu sale', pg_temp.salir(edu, g5), 'ok');
  perform pg_temp.espera('D4 sigue declined', pg_temp.estado(v_p), 'declined');
  raise notice 'OK · D4 · decline → leave: declined permanece';

  -- D5 · cancel creator → leave: cancelled·creator permanece
  perform pg_temp.espera('D5 crear', pg_temp.crear(aitor, pg_temp.k(108), g6, ub, '2500'), 'ok');
  v_p := pg_temp.pid(pg_temp.k(108));
  update core.group_transfer_proposal set created_at = now() - interval '1 hour', expires_at = now() + interval '6 days' where id = v_p;
  perform pg_temp.espera('D5 cancelar', pg_temp.cancelar(aitor, v_p), 'cancelled');
  perform pg_temp.espera('D5 Aitor sale', pg_temp.salir(aitor, g6), 'ok');
  perform pg_temp.espera('D5 sigue cancelled·creator', pg_temp.estado(v_p), 'cancelled·creator');
  raise notice 'OK · D5 · cancel creator → leave: cancelled·creator permanece';

  -- D6 · expired → leave: expired permanece (la salida cae fuera de la ventana)
  perform pg_temp.espera('D6 crear', pg_temp.crear(aitor, pg_temp.k(109), g7, tb, '2500'), 'ok');
  v_p := pg_temp.pid(pg_temp.k(109));
  update core.group_transfer_proposal set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where id = v_p;
  perform pg_temp.espera('D6 caducada', pg_temp.estado(v_p), 'expired');
  perform pg_temp.espera('D6 Aitor sale', pg_temp.salir(aitor, g7), 'ok');
  perform pg_temp.espera('D6 sigue expired', pg_temp.estado(v_p), 'expired');
  perform pg_temp.espera('D6 aceptar', pg_temp.aceptar(edu, pg_temp.k(110), v_p), 'PROPOSAL_EXPIRED');
  raise notice 'OK · D6 · expired → leave: expired permanece; ninguna terminal vuelve a pending';
end
$d$;

-- ═══════════════════════ E · aceptar ══════════════════════════════════════════
do $e$
declare
  aitor constant uuid := (select aitor from fx); edu constant uuid := (select edu from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); fer constant uuid := (select fer from fx); inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  g constant uuid := (select g from fx); xa constant uuid := (select xa from fx); xb constant uuid := (select xb from fx); xc constant uuid := (select xc from fx);
  pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx); pc constant uuid := (select pc from fx);
  v_p uuid; v_op uuid; v_ver uuid; v_n integer; v_txt text; v_bal_a bigint; v_bal_b bigint; v_before integer;
begin
  -- La deuda de 78: Edu paga 156 a medias con Aitor.
  perform pg_temp.gasto(edu, g, xb, xa, '15600');
  perform pg_temp.espera('E0 Aitor debe 78', pg_temp.neto(g, xa, xb)::text, '7800');
  v_p := pg_temp.pid(pg_temp.k(1));  -- Aitor → Edu, 80,00 «Te paso», pending

  -- E1 · quien no acepta
  perform pg_temp.espera('E1 el creador', pg_temp.aceptar(aitor, pg_temp.k(201), v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 un tercero miembro (Cris)', pg_temp.aceptar(cris, pg_temp.k(201), v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 nadie (sin handle: antes de mirar la fila)', pg_temp.aceptar(nadie, pg_temp.k(201), v_p), 'USERNAME_REQUIRED');
  perform pg_temp.espera('E1 Dan (miembro sin handle)', pg_temp.aceptar(dan, pg_temp.k(201), v_p), 'USERNAME_REQUIRED');
  perform pg_temp.espera('E1 anonimo', pg_temp.aceptar(edu, pg_temp.k(201), v_p, '{}'::jsonb, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 inexistente', pg_temp.aceptar(edu, pg_temp.k(201), gen_random_uuid()), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 payload de F3', pg_temp.aceptar(edu, pg_temp.k(201), v_p, jsonb_build_object('amount', '8000')), 'PAYLOAD_INVALID');
  perform pg_temp.espera('E1 corregir', pg_temp.aceptar(edu, pg_temp.k(201), v_p, jsonb_build_object('operation_id', gen_random_uuid(), 'expected_version_id', gen_random_uuid())), 'TRANSFER_NOT_EDITABLE');
  if exists (select 1 from core.client_command where client_operation_id = pg_temp.k(201)) then raise exception 'E1: un rechazo dejo clave'; end if;
  perform pg_temp.espera('E1 sigue pending', pg_temp.estado(v_p), 'pending');
  raise notice 'OK · E1 · aceptar es solo del receptor: anonimo y sin handle se rehusan antes de la fila; creador, tercero e inexistente → NOT_AUTHORIZED; payload de F3 → PAYLOAD_INVALID; corregir → TRANSFER_NOT_EDITABLE';

  -- E2 · 78 + 80 → Edu debe 2 a Aitor. Tres efectos, partes con grupo, autoria = receptor, fecha del servidor, una version.
  v_bal_a := pg_temp.saldo(pa); v_bal_b := pg_temp.saldo(pb); v_before := pg_temp.ops();
  perform pg_temp.espera('E2 Edu acepta', pg_temp.aceptar(edu, pg_temp.k(202), v_p), 'ok');
  v_op := pg_temp.op_de(v_p);
  if v_op is null then raise exception 'E2: sin operacion ligada'; end if;
  perform pg_temp.espera('E2 estado', pg_temp.estado(v_p), 'accepted');
  perform pg_temp.espera('E2 saldo A', (pg_temp.saldo(pa) - v_bal_a)::text, '-8000');
  perform pg_temp.espera('E2 saldo B', (pg_temp.saldo(pb) - v_bal_b)::text, '8000');
  perform pg_temp.espera('E2 net_debt Aitor→Edu', pg_temp.neto(g, xa, xb)::text, '-200');
  perform pg_temp.espera('E2 pending_debt Aitor→Edu', pg_temp.pendiente(g, xa, xb)::text, '0');
  perform pg_temp.espera('E2 pending_debt Edu→Aitor', pg_temp.pendiente(g, xb, xa)::text, '200');
  perform pg_temp.espera('E2 group_pending_pair', pg_temp.pares(g), 'Eduardo>Aitor:200');
  select o.current_version_id into v_ver from core.operation o where o.id = v_op;
  select count(*) into v_n from core.effect e where e.operation_version_id = v_ver;
  if v_n <> 3 then raise exception 'E2: % efectos y deben ser 3', v_n; end if;
  if (select count(*) from core.effect e where e.operation_version_id = v_ver and e.accounting_class = 'transfer' and e.balance_amount is not null) <> 2
     or (select count(*) from core.effect e where e.operation_version_id = v_ver and e.accounting_class = 'settlement' and e.debt_amount = -8000
           and e.debt_debtor_participant_id = xa and e.debt_creditor_participant_id = xb and e.scope_id = g) <> 1
     or exists (select 1 from core.effect e where e.operation_version_id = v_ver and e.economic_amount is not null) then
    raise exception 'E2: los efectos no son transfer -N / transfer +N / settlement -N (sender → receiver)';
  end if;
  select from_scope_id::text || '>' || to_scope_id::text || '|' || group_scope_id::text || '|' || sender_participant_id::text || '>' || receiver_participant_id::text into v_txt
    from core.transfer_part where operation_version_id = v_ver;
  perform pg_temp.espera('E2 partes', v_txt, pa::text || '>' || pb::text || '|' || g::text || '|' || xa::text || '>' || xb::text);
  if (select created_by from core.operation where id = v_op) <> edu or (select created_by from core.operation_version where id = v_ver) <> edu then
    raise exception 'E2: created_by no es el receptor que materializo';
  end if;
  if (select effective_date from core.operation_version where id = v_ver) <> current_date then raise exception 'E2: fecha efectiva no es la del servidor'; end if;
  if (select original_amount || '|' || version_kind || '|' || version_no from core.operation_version where id = v_ver) <> '8000|record|1' then raise exception 'E2: version'; end if;
  if exists (select 1 from core.movement_detail where operation_version_id = v_ver) then raise exception 'E2: la version lleva concepto'; end if;
  select count(*) into v_n from core.balance_observation where operation_version_id = v_ver;
  if v_n <> 2 then raise exception 'E2: % observaciones y deben ser 2', v_n; end if;
  -- claimed_dimension: la deuda del par se atribuye a los vinculados con signo
  perform pg_temp.actor(edu);
  select coalesce(sum(amount::bigint), 0) into v_bal_a from api.claimed_dimension() where dimension = 'debt' and effective_date = current_date;
  perform pg_temp.actor(aitor);
  select coalesce(sum(amount::bigint), 0) into v_bal_b from api.claimed_dimension() where dimension = 'debt' and effective_date = current_date;
  perform pg_temp.super();
  perform pg_temp.espera('E2 claimed_dimension Edu (deudor)', v_bal_a::text, '-200');
  perform pg_temp.espera('E2 claimed_dimension Aitor (acreedor)', v_bal_b::text, '200');
  perform pg_temp.espera('E2 replay', pg_temp.aceptar(edu, pg_temp.k(202), v_p), 'replay');
  perform pg_temp.espera('E2 segunda clave', pg_temp.aceptar(edu, pg_temp.k(203), v_p), 'PROPOSAL_ACCEPTED');
  perform pg_temp.espera('E2 una operacion nueva', (pg_temp.ops() - v_before)::text, '1');
  raise notice 'OK · E2 · 78 + 80 → Edu debe 2: tres efectos, partes con grupo, created_by = receptor, fecha del servidor, una version, net/pending/pares/claimed_dimension coherentes, replay, PROPOSAL_ACCEPTED';

  -- E3 · el algebra en otros casos: 20 + 5 → 15; 20 + 30 → inversa 10; 0 + N → inversa N; inversa previa + transferencia → suma
  --      (con Cris: Aitor debe 20 a Cris tras un gasto de 40 pagado por Cris)
  -- las tres pendientes de B hacia Cris se cancelan para dejar sitio en la pareja
  perform pg_temp.espera('E3 libera k13', pg_temp.cancelar(aitor, pg_temp.pid(pg_temp.k(13))), 'cancelled');
  perform pg_temp.espera('E3 libera k20', pg_temp.cancelar(aitor, pg_temp.pid(pg_temp.k(20))), 'cancelled');
  perform pg_temp.espera('E3 libera k21', pg_temp.cancelar(aitor, pg_temp.pid(pg_temp.k(21))), 'cancelled');
  perform pg_temp.gasto(cris, g, xc, xa, '4000');
  perform pg_temp.espera('E3 Aitor debe 20 a Cris', pg_temp.neto(g, xa, xc)::text, '2000');
  perform pg_temp.espera('E3 propone 5', pg_temp.crear(aitor, pg_temp.k(204), g, xc, '500'), 'ok');
  perform pg_temp.espera('E3 acepta', pg_temp.aceptar(cris, pg_temp.k(205), pg_temp.pid(pg_temp.k(204))), 'ok');
  perform pg_temp.espera('E3 20 + 5 → 15', pg_temp.neto(g, xa, xc)::text, '1500');
  perform pg_temp.espera('E3 propone 30', pg_temp.crear(aitor, pg_temp.k(206), g, xc, '3000'), 'ok');
  perform pg_temp.espera('E3 acepta', pg_temp.aceptar(cris, pg_temp.k(207), pg_temp.pid(pg_temp.k(206))), 'ok');
  perform pg_temp.espera('E3 15 + 30 → Cris debe 15', pg_temp.neto(g, xc, xa)::text, '1500');
  perform pg_temp.espera('E3 pares', pg_temp.pares(g), 'Cris>Aitor:1500 Eduardo>Aitor:200');
  -- inversa previa + otra transferencia del mismo sentido: suma
  perform pg_temp.espera('E3 propone 10 mas', pg_temp.crear(aitor, pg_temp.k(208), g, xc, '1000'), 'ok');
  perform pg_temp.espera('E3 acepta', pg_temp.aceptar(cris, pg_temp.k(209), pg_temp.pid(pg_temp.k(208))), 'ok');
  perform pg_temp.espera('E3 inversa 15 + 10 → 25', pg_temp.neto(g, xc, xa)::text, '2500');
  -- 0 + N: Edu propone a Cris sin deuda previa
  perform pg_temp.espera('E3 0 + N', pg_temp.crear(edu, pg_temp.k(210), g, xc, '700'), 'ok');
  perform pg_temp.espera('E3 acepta', pg_temp.aceptar(cris, pg_temp.k(211), pg_temp.pid(pg_temp.k(210))), 'ok');
  perform pg_temp.espera('E3 Cris debe 7 a Edu', pg_temp.neto(g, xc, xb)::text, '700');
  -- en negativo se ejecuta: Aitor ya esta en negativo y sigue pudiendo
  perform pg_temp.espera('E3 saldo A negativo', (pg_temp.saldo(pa) < 0)::text, 'true');
  raise notice 'OK · E3 · el algebra: 20 + 5 → 15; 15 + 30 → inversa 15; inversa + 10 → 25; 0 + N → inversa N; sin validacion de fondos';

  -- E4 · BASES DISTINTAS, y desde F12.C3 en DOS momentos.
  --
  --      Un grupo nuevo en USD con Aitor y Edu: la base del grupo no es la de
  --      sus Personales, asi que nadie podria materializar la transferencia.
  --
  --      Hasta F12.C3 eso solo se descubria AL ACEPTAR: se podia crear una
  --      propuesta imposible y el 422 le llegaba al receptor por algo que el
  --      emisor no habia podido ver. La guarda temprana de 20261006120000 lo
  --      rehusa ya al crear, con el MISMO codigo.
  perform pg_temp.grupo('b3a00000-0000-4000-8000-000000000800', 'b3b00000-0000-4000-8000-000000000801', 'b3b00000-0000-4000-8000-000000000802', 'b3b00000-0000-4000-8000-000000000803');
  update core.scope set base_currency_definition_id = (select usd from fx) where id = 'b3a00000-0000-4000-8000-000000000800';
  v_before := pg_temp.ops();
  perform pg_temp.espera('E4 crear en el grupo USD ya no se puede',
    pg_temp.crear(aitor, pg_temp.k(212), 'b3a00000-0000-4000-8000-000000000800', 'b3b00000-0000-4000-8000-000000000802', '100'),
    'CURRENCY_CONVERSION_UNSUPPORTED');
  if exists (select 1 from core.group_transfer_proposal where client_command_id = pg_temp.k(212)) then
    raise exception 'E4 la guarda temprana dejo una fila de propuesta';
  end if;

  --      Y LA GUARDA DE ACEPTAR SIGUE AHI, que es la que protege el dinero.
  --      Una pendiente creada ANTES de que la guarda existiera no se borra ni
  --      caduca sola: se siembra una a mano —como la habria dejado el codigo
  --      anterior— y se comprueba que aceptar responde el error autoritativo,
  --      no escribe nada, y la deja pendiente para que cualquiera de las dos
  --      partes la retire.
  insert into core.group_transfer_proposal
    (id, created_by, target_user_id, group_scope_id, sender_participant_id, receiver_participant_id,
     amount, currency_definition_id, client_command_id)
  values ('b3c00000-0000-4000-8000-000000000804', aitor, edu,
          'b3a00000-0000-4000-8000-000000000800',
          'b3b00000-0000-4000-8000-000000000801', 'b3b00000-0000-4000-8000-000000000802',
          100, (select usd from fx), pg_temp.k(214));
  perform pg_temp.espera('E4 aceptar una vieja e incompatible',
    pg_temp.aceptar(edu, pg_temp.k(213), 'b3c00000-0000-4000-8000-000000000804'),
    'CURRENCY_CONVERSION_UNSUPPORTED');
  perform pg_temp.espera('E4 sin escribir', (pg_temp.ops() - v_before)::text, '0');
  perform pg_temp.espera('E4 sigue pending', pg_temp.estado('b3c00000-0000-4000-8000-000000000804'), 'pending');
  raise notice 'OK · E4 · bases distintas: crear lo rehusa ya (F12.C3) sin dejar fila, y aceptar una anterior sigue rehusando sin escribir';
end
$e$;

-- ═══════════════════════ F · irreversibilidad y lo que NO cambia ══════════════
do $f$
declare
  aitor constant uuid := (select aitor from fx); edu constant uuid := (select edu from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); xd constant uuid := (select xd from fx);
  g constant uuid := (select g from fx); xa constant uuid := (select xa from fx); xb constant uuid := (select xb from fx); xc constant uuid := (select xc from fx);
  v_p uuid; v_op uuid; v_ver uuid; v_n integer; r jsonb; v_pos jsonb;
begin
  v_p := pg_temp.pid(pg_temp.k(1)); v_op := pg_temp.op_de(v_p);
  select current_version_id into v_ver from core.operation where id = v_op;
  perform pg_temp.espera('F1 anula el receptor', pg_temp.anular(edu, pg_temp.k(301), v_op), 'OPERATION_NOT_ANNULLABLE');
  perform pg_temp.espera('F1 anula el emisor', pg_temp.anular(aitor, pg_temp.k(302), v_op), 'OPERATION_NOT_ANNULLABLE');
  perform pg_temp.espera('F1 anula un tercero', pg_temp.anular(cris, pg_temp.k(303), v_op), 'OPERATION_NOT_ANNULLABLE');
  select count(*) into v_n from core.operation_version where operation_id = v_op;
  if v_n <> 1 then raise exception 'F1: % versiones', v_n; end if;
  begin
    perform sec.persist_version(edu, v_op, gen_random_uuid(), 2, v_ver, 'settlement_by_transfer', current_date, 8000, (select eur from fx), null, 'record');
    raise exception 'F1: persist_version acepto una correccion';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'TRANSFER_NOT_EDITABLE' then raise exception 'F1: correccion dio %', sqlerrm::json ->> 'code'; end if;
  end;
  begin
    perform sec.persist_version(edu, v_op, gen_random_uuid(), 2, v_ver, 'settlement_by_transfer', current_date, 8000, (select eur from fx), null, 'annulment');
    raise exception 'F1: persist_version acepto una anulacion';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'OPERATION_NOT_ANNULLABLE' then raise exception 'F1: anulacion dio %', sqlerrm::json ->> 'code'; end if;
  end;
  raise notice 'OK · F1 · una settlement_by_transfer tiene una version: anular → OPERATION_NOT_ANNULLABLE para todos; persist_version rehusa correccion y anulacion';

  -- F2 · group_payment sigue con tope (PAYMENT_NOT_APPLICABLE por encima del neto) y anulable; record_debt_settlement sigue con SETTLEMENT_EXCEEDS_DEBT
  --      Estado del par Edu→Aitor: Edu debe 2. Un «Saldado» de 5 de Edu a Aitor excede.
  v_pos := pg_temp.gp_expected(g, edu);
  perform pg_temp.actor(edu);
  begin
    perform api.record_group_payment(jsonb_build_object('client_operation_id', pg_temp.k(304), 'command_contract_version', 1, 'scope_id', g,
      'currency_definition_id', (select eur from fx), 'amount', '500', 'effective_date', current_date::text,
      'payer_participant_id', xb, 'receiver_participant_id', xa,
      'expected_positions', v_pos));
    raise exception 'F2: group_payment acepto mas que el neto del par';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') not in ('PAYMENT_NOT_APPLICABLE', 'SETTLEMENT_STALE') then raise exception 'F2: group_payment dio %', sqlerrm::json ->> 'code'; end if;
  end;
  begin
    perform api.record_debt_settlement(jsonb_build_object('client_operation_id', pg_temp.k(305), 'command_contract_version', 1, 'scope_id', g,
      'currency_definition_id', (select eur from fx), 'amount', '500', 'effective_date', current_date::text,
      'debtor_participant_id', xb, 'creditor_participant_id', xa));
    raise exception 'F2: record_debt_settlement acepto mas que el pendiente';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'SETTLEMENT_EXCEEDS_DEBT' then raise exception 'F2: record_debt_settlement dio %', sqlerrm::json ->> 'code'; end if;
  end;
  -- y el exacto entra, y sigue siendo anulable
  r := api.record_debt_settlement(jsonb_build_object('client_operation_id', pg_temp.k(306), 'command_contract_version', 1, 'scope_id', g,
      'currency_definition_id', (select eur from fx), 'amount', '200', 'effective_date', current_date::text,
      'debtor_participant_id', xb, 'creditor_participant_id', xa));
  perform pg_temp.super();
  perform pg_temp.espera('F2 el par queda a cero', pg_temp.neto(g, xb, xa)::text, '0');
  -- Anular ESE pago dejaria el par Aitor→Edu en negativo otra vez (78 de deuda
  -- frente a 80 liquidados): la guarda por delta lo rehusa, como exige
  -- F12/ADR-003 §12 (evidencia 11). No es una regresion: es el tope de F9.
  perform pg_temp.espera('F2 anular lo que reabriria un par en negativo', pg_temp.anular(edu, pg_temp.k(307), (r ->> 'operation_id')::uuid), 'SETTLEMENT_EXCEEDS_DEBT');
  -- Y sobre un par que ninguna transferencia cruzo (Edu paga 10 a medias con
  -- Dan: Dan debe 5) sigue anulable, como en F9.
  perform pg_temp.gasto(edu, g, xb, xd, '1000');
  perform pg_temp.actor(dan);
  r := api.record_debt_settlement(jsonb_build_object('client_operation_id', pg_temp.k(308), 'command_contract_version', 1, 'scope_id', g,
      'currency_definition_id', (select eur from fx), 'amount', '500', 'effective_date', current_date::text,
      'debtor_participant_id', xd, 'creditor_participant_id', xb));
  perform pg_temp.super();
  perform pg_temp.espera('F2 Dan salda los 5', pg_temp.neto(g, xd, xb)::text, '0');
  perform pg_temp.espera('F2 record_debt_settlement sigue anulable', pg_temp.anular(dan, pg_temp.k(309), (r ->> 'operation_id')::uuid), 'ok');
  perform pg_temp.espera('F2 y el par vuelve', pg_temp.neto(g, xd, xb)::text, '500');
  raise notice 'OK · F2 · group_payment y record_debt_settlement conservan su tope y su anulacion: SETTLEMENT_EXCEEDS_DEBT deja de aplicar SOLO a settlement_by_transfer';
end
$f$;

-- ═══════════════════════ G · vistas ═══════════════════════════════════════════
do $g$
declare
  aitor constant uuid := (select aitor from fx); edu constant uuid := (select edu from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); fer constant uuid := (select fer from fx); nadie constant uuid := (select nadie from fx);
  g constant uuid := (select g from fx); pa constant uuid := (select pa from fx);
  v_txt text; v_n integer;
begin
  -- G1 · group_transfer_proposals: el emisor todas con estado y motivo; el receptor solo pending; un miembro ajeno a la pareja nada
  v_txt := pg_temp.vista_propuestas(aitor);
  if v_txt not like '%outgoing:Aitor>Eduardo:8000:accepted%' or v_txt not like '%outgoing:Aitor>Eduardo:11:cancelled·creator%' or v_txt not like '%outgoing:Aitor>Eduardo:12:declined%' then
    raise exception 'G1: Aitor no ve accepted, cancelled·creator y declined: %', v_txt;
  end if;
  if v_txt not like '%outgoing:Aitor>Eduardo:14:pending%' or v_txt not like '%incoming:Eduardo>Aitor:23:pending%' then raise exception 'G1: Aitor no ve sus pending ni la entrante de Edu: %', v_txt; end if;
  -- Cris: sus entrantes ya no estan pending (aceptadas o canceladas) y no creo ninguna
  perform pg_temp.espera('G1 Cris: nada pendiente hacia el, nada suyo', pg_temp.vista_propuestas(cris), '-');
  perform pg_temp.espera('G1 Dan (miembro sin propuestas)', pg_temp.vista_propuestas(dan), '-');
  perform pg_temp.espera('G1 Fer (fuera)', pg_temp.vista_propuestas(fer), '-');
  perform pg_temp.espera('G1 nadie', pg_temp.vista_propuestas(nadie), '-');
  raise notice 'OK · G1 · group_transfer_proposals: el emisor todas con estado y motivo, el receptor solo pending, los demas nada';

  -- G2 · group_transfers: todos los miembros la ven, con partes y nombres; el concepto solo las partes
  perform pg_temp.actor(dan);
  select count(*) into v_n from api.group_transfers where group_scope_id = g;
  if v_n <> 5 then raise exception 'G2: Dan (miembro) ve % transferencias del grupo y son 5', v_n; end if;
  select count(*) into v_n from api.group_transfers where group_scope_id = g and concept is not null;
  if v_n <> 0 then raise exception 'G2: un miembro ajeno a la pareja ve el concepto'; end if;
  perform pg_temp.actor(edu);
  select sender_display_name || '>' || receiver_display_name || ':' || amount || ':' || coalesce(concept, '-') || ':' || is_sender::text || is_receiver::text into v_txt
    from api.group_transfers where proposal_id = pg_temp.pid(pg_temp.k(1));
  perform pg_temp.espera('G2 Edu ve la suya con concepto', v_txt, 'Aitor>Eduardo:8000:Te paso:falsetrue');
  perform pg_temp.actor(fer);
  select count(*) into v_n from api.group_transfers where group_scope_id = g;
  if v_n <> 0 then raise exception 'G2: Fer (fuera) ve transferencias del grupo'; end if;
  perform pg_temp.super();
  raise notice 'OK · G2 · group_transfers: para todos los miembros con partes y nombres; concepto solo para las partes; nadie de fuera';

  -- G3 · my_transfers en el Personal: «Enviaste/Recibiste» con grupo, direccion desde las partes, contraparte actual
  perform pg_temp.actor(aitor);
  select string_agg(direction || ':' || balance_amount || ':' || coalesce(counterpart_handle, '-') || ':' || coalesce(concept, '-') || ':' || (group_scope_id = g)::text || ':' || (group_transfer_proposal_id is not null)::text, ';' order by balance_amount::bigint) into v_txt
    from api.my_transfers where group_scope_id is not null and group_scope_id = g;
  perform pg_temp.super();
  perform pg_temp.espera('G3 Aitor', v_txt, 'outgoing:-8000:edu_gt:Te paso:true:true;outgoing:-3000:cris_gt:-:true:true;outgoing:-1000:cris_gt:-:true:true;outgoing:-500:cris_gt:-:true:true');
  perform pg_temp.actor(edu);
  perform api.change_username('{"handle":"edu_nuevo"}'::jsonb);
  perform pg_temp.actor(aitor);
  select counterpart_handle into v_txt from api.my_transfers where group_transfer_proposal_id = pg_temp.pid(pg_temp.k(1));
  select count(*) into v_n from api.my_transfers t where t.scope_id <> pa or (t.direction = 'outgoing') <> (t.balance_amount::bigint < 0);
  perform pg_temp.super();
  perform pg_temp.espera('G3 handle actual de la contraparte', v_txt, 'edu_nuevo');
  if v_n <> 0 then raise exception 'G3: ambito ajeno o direccion incoherente con el signo'; end if;
  raise notice 'OK · G3 · my_transfers: la settlement_by_transfer en el Personal con grupo, direccion por partes y contraparte actual; solo el ambito propio';
end
$g$;

-- ═══════════════════════ H · el cliente no alcanza core ═══════════════════════
do $h$
begin
  perform pg_temp.actor((select aitor from fx));
  begin
    perform count(*) from core.group_transfer_proposal;
    raise exception 'H: authenticated lee core.group_transfer_proposal';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from core.group_departure;
    raise exception 'H: authenticated lee core.group_departure';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · H · el cliente no llega a core';
end
$h$;

rollback;
