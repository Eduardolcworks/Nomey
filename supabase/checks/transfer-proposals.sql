-- ============================================================================
-- TRANSFERENCIAS ENTRE USUARIOS CON DOS VOLUNTADES (F12/ADR-002, F12.B1)
-- contra las funciones reales de 20260926120000, aislado
-- ============================================================================
--
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/checks/transfer-proposals.sql
--
-- Dentro de UNA transaccion now() no avanza: la caducidad (7 dias) y la
-- ventana del presupuesto (60 min) se fijan como fixture, como postgres,
-- retrasando las marcas de filas que las funciones produjeron. Es lo unico
-- que este check escribe a mano en las tablas de F12.B1 (el resto del
-- fixture —monedas, ambitos, membresias, identidades— es el de siempre).
--
--   A · estructura: dos tablas con RLS; propietarios (provisioner lo de la
--       propuesta, writer lo contable, nada nuevo de postgres); definer donde
--       toca y solo ahi; EXECUTE por rol; el cliente sin created_by ni
--       target_user_id; las policies created_by = actor intactas (evidencia
--       10); ninguna vista nueva deriva el rol de created_by (evidencia 14);
--       las nueve api.record_* siguen siendo nueve
--   B · crear: ni operacion ni efecto ni saldo; replay y clave reutilizada;
--       anonimo, sin handle, sin Personal, moneda distinta de la base, a uno
--       mismo, importe no positivo, campos de F3; destinatario inexistente,
--       reservado, retenido, invalido, sin Personal; el freno compartido del
--       resolver: found y not_found apuntan, uno mismo y frenado no, 20 →
--       RECIPIENT_LOOKUP_THROTTLED sin apuntar; presupuesto MIXTO 15 + 5 = 20
--       y la 21.a frenada por cualquiera de los dos comandos
--   C · anti-spam: 3 pending por pareja (la cuarta 409); cancelada,
--       rechazada, caducada y aceptada dejan de contar; 10 creadas / 60 min
--       (la undecima 429 con retry_at); lo rehusado antes de crear no
--       consume; lo de hace mas de una hora no cuenta
--   D · aceptar: solo el receptor; tercero y creador NOT_AUTHORIZED; -N/+N;
--       las partes dicen from = Personal del creador y to = del aceptante;
--       created_by = receptor; fecha del servidor; replay; segunda clave →
--       PROPOSAL_ACCEPTED; caducada / cancelada / rechazada → su codigo sin
--       escribir; en negativo se ejecuta; bases distintas → CURRENCY_
--       CONVERSION_UNSUPPORTED sin escribir; el handle se resolvio UNA vez
--   E · cancelar y rechazar: quien puede, idempotencia por estado, codigos
--       cruzados, tercero NOT_AUTHORIZED
--   F · irreversibilidad: correccion → TRANSFER_NOT_EDITABLE antes de la
--       clave; anulacion por las dos partes → OPERATION_NOT_ANNULLABLE;
--       sec.persist_version lo respalda; una sola version
--   G · vistas: emisor todas, receptor solo pending; direccion y contraparte;
--       el handle nuevo tras cambiarlo; my_transfers con signo por lado;
--       tercero nada; personal_operation no la lista y personal_balance si
--       la suma; counts_in_personal con fresh; sin uid ni ambito ajeno
--   H · el cliente no alcanza core
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  'b1000000-0000-4000-8000-0000000000a1'::uuid as ana,   -- normal, handle, Personal EUR
  'b1000000-0000-4000-8000-0000000000b1'::uuid as bea,   -- normal, handle, Personal EUR
  'b1000000-0000-4000-8000-0000000000c1'::uuid as cris,  -- normal, handle, Personal EUR
  'b1000000-0000-4000-8000-0000000000d1'::uuid as dan,   -- normal, SIN handle, Personal EUR
  'b1000000-0000-4000-8000-0000000000e1'::uuid as eva,   -- normal, handle, SIN Personal
  'b1000000-0000-4000-8000-0000000000f1'::uuid as fer,   -- normal, handle, Personal USD
  'b1000000-0000-4000-8000-000000000011'::uuid as inv,   -- invitado con reserva
  'b1000000-0000-4000-8000-000000000021'::uuid as nadie, -- sin nada
  'b1c00000-0000-4000-8000-0000000000e1'::uuid as eur,
  'b1c00000-0000-4000-8000-0000000000d1'::uuid as usd,
  'b1a00000-0000-4000-8000-0000000000a1'::uuid as pa,
  'b1a00000-0000-4000-8000-0000000000b1'::uuid as pb,
  'b1a00000-0000-4000-8000-0000000000c1'::uuid as pc,
  'b1a00000-0000-4000-8000-0000000000d1'::uuid as pd,
  'b1a00000-0000-4000-8000-0000000000f1'::uuid as pf;
grant select on fx to authenticated;

insert into core.currency_definition (id, code, scale) select eur, 'EUR', 2 from fx union all select usd, 'USD', 2 from fx;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  select pa, 'personal', eur, ana from fx union all
  select pb, 'personal', eur, bea from fx union all
  select pc, 'personal', eur, cris from fx union all
  select pd, 'personal', eur, dan from fx union all
  select pf, 'personal', usd, fer from fx;
insert into core.membership (scope_id, user_id)
  select pa, ana from fx union all select pb, bea from fx union all select pc, cris from fx
  union all select pd, dan from fx union all select pf, fer from fx;

create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid, boolean), pg_temp.super() to authenticated;

-- Identidades por las funciones reales de A1: normal reserva y reclama.
do $seed$
declare r record;
begin
  perform pg_temp.actor((select ana from fx));  select * into r from api.reserve_username('{"handle":"ana_tp","public_name":"Ana"}');
  perform pg_temp.actor((select bea from fx));  select * into r from api.reserve_username('{"handle":"bea_tp","public_name":"Bea"}');
  perform pg_temp.actor((select cris from fx)); select * into r from api.reserve_username('{"handle":"cris_tp","public_name":"Cris"}');
  perform pg_temp.actor((select eva from fx));  select * into r from api.reserve_username('{"handle":"eva_tp","public_name":"Eva"}');
  perform pg_temp.actor((select fer from fx));  select * into r from api.reserve_username('{"handle":"fer_tp","public_name":"Fer"}');
  perform pg_temp.actor((select inv from fx), true); select * into r from api.reserve_username('{"handle":"inv_tp","public_name":"Inv"}');
  perform pg_temp.super();
end $seed$;

-- crear como p_user: 'ok' (o 'replay') o el codigo.
create function pg_temp.crear(p_user uuid, p_key uuid, p_handle text, p_amount text, p_currency uuid default null, p_concept text default null, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb; v jsonb;
begin
  v := jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'handle', p_handle, 'amount', p_amount,
                          'currency_definition_id', coalesce(p_currency, (select eur from fx)));
  if p_concept is not null then v := v || jsonb_build_object('concept', p_concept); end if;
  perform pg_temp.actor(p_user, p_anon);
  r := api.create_transfer_proposal(v);
  perform pg_temp.super();
  return case when (r ->> 'state') = 'not_found' then 'not_found' || case when (r ->> 'already_processed')::boolean then '/replay' else '' end
              when (r ->> 'already_processed')::boolean then 'replay' else 'ok' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- la propuesta creada con esa clave por ese emisor
create function pg_temp.pid(p_user uuid, p_key uuid) returns uuid language sql as $$
  select p.id from core.transfer_proposal p where p.created_by = p_user and p.client_command_id = p_key;
$$;
-- aceptar como p_user: 'ok' | 'replay' | codigo
create function pg_temp.aceptar(p_user uuid, p_key uuid, p_proposal uuid, p_extra jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.record_internal_transfer(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1, 'proposal_id', p_proposal) || p_extra);
  perform pg_temp.super();
  return case when (r ->> 'already_processed')::boolean then 'replay' else 'ok' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.op_de(p_proposal uuid) returns uuid language sql as $$
  select accepted_operation_id from core.transfer_proposal where id = p_proposal;
$$;
create function pg_temp.cancelar(p_user uuid, p_proposal uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.cancel_transfer_proposal(jsonb_build_object('proposal_id', p_proposal));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.rechazar(p_user uuid, p_proposal uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.decline_transfer_proposal(jsonb_build_object('proposal_id', p_proposal));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- anular como p_user: 'ok' o codigo
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
create function pg_temp.estado(p_proposal uuid) returns text language sql as $$
  select sec.transfer_proposal_state(p.accepted_operation_id, p.cancelled_at, p.declined_at, p.expires_at) from core.transfer_proposal p where p.id = p_proposal;
$$;
create function pg_temp.saldo(p_scope uuid) returns bigint language sql as $$
  select coalesce(sum(e.balance_amount), 0) from core.current_effect e where e.scope_id = p_scope and e.balance_amount is not null;
$$;
create function pg_temp.intentos(p_user uuid) returns integer language sql as $$
  select count(*)::integer from core.username_lookup_attempt a where a.user_id = p_user;
$$;
create function pg_temp.ops() returns integer language sql as $$
  select count(*)::integer from core.operation where operation_class = 'internal_transfer';
$$;
-- las propuestas propias por la vista, como p_user: 'direction:handle:state;...' ordenadas
create function pg_temp.vista_propuestas(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(direction || ':' || coalesce(counterpart_handle, '-') || ':' || state || ':' || amount, ';' order by created_at, amount), '-') into v from api.my_transfer_proposals;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.vista_transferencias(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(direction || ':' || coalesce(counterpart_handle, '-') || ':' || balance_amount || ':' || coalesce(concept, '-'), ';' order by operation_created_at, balance_amount::bigint), '-') into v from api.my_transfers;
  perform pg_temp.super();
  return v;
end $$;
grant execute on function pg_temp.crear(uuid, uuid, text, text, uuid, text, boolean), pg_temp.pid(uuid, uuid), pg_temp.aceptar(uuid, uuid, uuid, jsonb),
  pg_temp.op_de(uuid), pg_temp.cancelar(uuid, uuid, boolean), pg_temp.rechazar(uuid, uuid, boolean), pg_temp.anular(uuid, uuid, uuid), pg_temp.estado(uuid),
  pg_temp.saldo(uuid), pg_temp.intentos(uuid), pg_temp.ops(), pg_temp.vista_propuestas(uuid), pg_temp.vista_transferencias(uuid) to authenticated;

create function pg_temp.espera(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: se esperaba «%» y se obtuvo «%»', p_label, p_want, p_got;
  end if;
end $$;
-- una clave determinista por numero
create function pg_temp.k(p_n integer) returns uuid language sql immutable as $$
  select ('b1e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.k(integer), pg_temp.espera(text, text, text) to authenticated;

-- ═══════════════════════ A · estructura ═══════════════════════════════════════
do $a$
declare
  v_n integer;
  v_t text;
  r record;
begin
  for v_t in select unnest(array['transfer_proposal', 'transfer_part']) loop
    if not (select relrowsecurity from pg_class where oid = ('core.' || v_t)::regclass) then
      raise exception 'A: core.% sin RLS', v_t;
    end if;
  end loop;
  select count(*) into v_n from pg_constraint where conrelid = 'core.transfer_proposal'::regclass and contype = 'c';
  if v_n < 6 then raise exception 'A: core.transfer_proposal tiene % CHECKs, se esperaban al menos 6', v_n; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'transfer_proposal'
                  and indexdef ilike '%unique%' and indexdef ilike '%(accepted_operation_id)%') then
    raise exception 'A: falta el indice unico de accepted_operation_id';
  end if;
  -- la propuesta persiste uid, NUNCA handle ni nombre (ADR-002 §19)
  if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name in ('transfer_proposal', 'transfer_part')
              and column_name in ('handle', 'username', 'public_name', 'display_name')) then
    raise exception 'A: una relacion de F12.B1 persiste un handle o un nombre';
  end if;
  raise notice 'OK · A1 · dos tablas con RLS, CHECKs, indice unico de la operacion, sin handle ni nombre persistidos';

  -- propietarios: la propuesta del provisioner, lo contable del writer, NADA nuevo de postgres
  for r in select n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'api' and p.proname in ('create_transfer_proposal', 'cancel_transfer_proposal', 'decline_transfer_proposal', 'record_internal_transfer', 'annul_operation'))
               or (n.nspname = 'sec' and p.proname in ('transfer_proposal_state', 'lock_proposal_budget', 'assert_proposal_budget', 'handle_owner', 'has_personal_scope', 'my_transfer_counterparts')) loop
    if r.name in ('api.record_internal_transfer', 'api.annul_operation', 'sec.has_personal_scope') then
      if r.owner <> 'nomey_writer' then raise exception 'A: % es de %, no del writer', r.name, r.owner; end if;
    elsif r.owner <> 'nomey_provisioner' then
      raise exception 'A: % es de %, no del provisioner', r.name, r.owner;
    end if;
    if r.definer <> (r.name like 'api.%' or r.name in ('sec.has_personal_scope', 'sec.my_transfer_counterparts')) then
      raise exception 'A: % definer=% no es lo esperado', r.name, r.definer;
    end if;
  end loop;
  -- sec.persist_version se recreo, no nacio: sigue siendo de postgres y sin definer
  if (select pg_get_userbyid(proowner) || ':' || prosecdef::text from pg_proc where oid = 'sec.persist_version(uuid,uuid,uuid,integer,uuid,text,date,bigint,uuid,time,text)'::regprocedure) <> 'postgres:false' then
    raise exception 'A: sec.persist_version cambio de propietario o de definer al recrearse';
  end if;
  -- ningun BYPASSRLS
  if exists (select 1 from pg_roles where rolname in ('nomey_writer', 'nomey_provisioner') and rolbypassrls) then
    raise exception 'A: un rol de Nomey tiene BYPASSRLS';
  end if;
  raise notice 'OK · A2 · propietarios: provisioner la propuesta, writer lo contable, persist_version intacta, sin BYPASSRLS';

  -- EXECUTE por rol
  foreach v_t in array array['api.create_transfer_proposal(jsonb)', 'api.cancel_transfer_proposal(jsonb)', 'api.decline_transfer_proposal(jsonb)', 'api.record_internal_transfer(jsonb)'] loop
    if not has_function_privilege('authenticated', v_t, 'execute') then raise exception 'A: authenticated no ejecuta %', v_t; end if;
    if has_function_privilege('anon', v_t, 'execute') or has_function_privilege('public', v_t, 'execute') then raise exception 'A: anon o public ejecutan %', v_t; end if;
  end loop;
  if has_function_privilege('authenticated', 'sec.handle_owner(text)', 'execute') or has_function_privilege('nomey_writer', 'sec.handle_owner(text)', 'execute')
     or not has_function_privilege('nomey_provisioner', 'sec.handle_owner(text)', 'execute') then
    raise exception 'A: sec.handle_owner lo ejecuta alguien distinto del provisioner';
  end if;
  if has_function_privilege('authenticated', 'sec.has_personal_scope(uuid)', 'execute') or not has_function_privilege('nomey_provisioner', 'sec.has_personal_scope(uuid)', 'execute') then
    raise exception 'A: sec.has_personal_scope no la ejecuta exactamente el provisioner';
  end if;
  if has_function_privilege('authenticated', 'sec.assert_proposal_budget(uuid)', 'execute') or has_function_privilege('authenticated', 'sec.lock_proposal_budget(uuid)', 'execute') then
    raise exception 'A: el cliente ejecuta el presupuesto o su cerrojo';
  end if;
  if not has_function_privilege('authenticated', 'sec.my_transfer_counterparts()', 'execute') or not has_function_privilege('authenticated', 'sec.transfer_proposal_state(uuid,timestamptz,timestamptz,timestamptz)', 'execute') then
    raise exception 'A: las vistas invoker no podrian evaluarse: falta EXECUTE del cliente sobre counterparts o state';
  end if;
  -- ninguna funcion de sec nueva la ejecuta anon; supabase_auth_admin sigue con solo el hook
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and has_function_privilege('supabase_auth_admin', p.oid, 'execute');
  if v_n <> 1 then raise exception 'A: supabase_auth_admin ejecuta % funciones de sec y debe ser 1', v_n; end if;
  raise notice 'OK · A3 · EXECUTE: cliente solo api (+ counterparts y state para las vistas); handle_owner y has_personal_scope solo del provisioner';

  -- el cliente NO tiene privilegio sobre las columnas de uid de la propuesta
  if exists (select 1 from information_schema.column_privileges where table_schema = 'core' and table_name = 'transfer_proposal'
              and grantee = 'authenticated' and column_name in ('created_by', 'target_user_id')) then
    raise exception 'A: authenticated puede leer created_by o target_user_id de core.transfer_proposal';
  end if;
  -- y el writer solo puede escribir las marcas de aceptacion; el provisioner, las de cancelar y rechazar
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.column_privileges
   where table_schema = 'core' and table_name = 'transfer_proposal' and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_t <> 'accepted_at,accepted_operation_id' then raise exception 'A: el writer actualiza % de la propuesta', v_t; end if;
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.column_privileges
   where table_schema = 'core' and table_name = 'transfer_proposal' and grantee = 'nomey_provisioner' and privilege_type = 'UPDATE';
  if v_t <> 'cancelled_at,declined_at' then raise exception 'A: el provisioner actualiza % de la propuesta', v_t; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name in ('transfer_proposal', 'transfer_part')
              and grantee in ('authenticated', 'nomey_provisioner', 'nomey_writer') and privilege_type = 'DELETE') then
    raise exception 'A: alguien puede borrar propuestas o partes';
  end if;
  raise notice 'OK · A4 · columnas: el cliente sin uid; writer solo accepted_*; provisioner solo cancelled_at/declined_at; nadie borra';

  -- evidencia 10: las policies created_by = actor del writer, intactas
  for v_t in select unnest(array['operation', 'operation_version', 'client_command', 'effect']) loop
    if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = v_t and roles = '{nomey_writer}' and cmd = 'INSERT'
                    and with_check ilike '%created_by = sec.request_actor_id()%') then
      raise exception 'A: la policy de INSERT del writer sobre core.% ya no exige created_by = actor', v_t;
    end if;
  end loop;
  -- evidencia 14: ninguna vista nueva deriva el rol de created_by
  for v_t in select unnest(array['my_transfer_proposals', 'my_transfers']) loop
    if pg_get_viewdef(('api.' || v_t)::regclass) ilike '%created_by%' then
      raise exception 'A: api.% deriva algo de created_by', v_t;
    end if;
    if not exists (select 1 from pg_class where oid = ('api.' || v_t)::regclass and reloptions @> array['security_invoker=true']) then
      raise exception 'A: api.% no es security_invoker', v_t;
    end if;
  end loop;
  -- ni publican uid ni ambito ajeno: la lista de columnas es la frontera
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'my_transfer_proposals';
  if v_t <> 'proposal_id,direction,counterpart_handle,counterpart_public_name,amount,currency_definition_id,concept,created_at,expires_at,state,accepted_operation_id' then
    raise exception 'A: columnas de api.my_transfer_proposals: %', v_t;
  end if;
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'my_transfers';
  if v_t <> 'operation_id,scope_id,currency_definition_id,balance_amount,direction,amount,effective_date,effective_time,concept,counterpart_handle,counterpart_public_name,proposal_id,operation_created_at' then
    raise exception 'A: columnas de api.my_transfers: %', v_t;
  end if;
  -- la superficie de escritura sigue siendo enumerable: NUEVE record_*
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname like 'record\_%';
  if v_n <> 9 then raise exception 'A: hay % api.record_* y deben seguir siendo 9', v_n; end if;
  raise notice 'OK · A5 · policies created_by = actor intactas; vistas invoker sin created_by, sin uid ni ambito ajeno; nueve record_*';
end
$a$;

-- ═══════════════════════ B · crear ════════════════════════════════════════════
do $b$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); eva constant uuid := (select eva from fx); fer constant uuid := (select fer from fx);
  inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  usd constant uuid := (select usd from fx); pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx);
  v_p uuid; v_n integer; i integer; v_txt text;
begin
  -- B1 · crear no toca contabilidad; replay; forma
  perform pg_temp.espera('B1 crear', pg_temp.crear(ana, pg_temp.k(1), ' @Bea_TP ', '2500', null, '  Cena  '), 'ok');
  v_p := pg_temp.pid(ana, pg_temp.k(1));
  if v_p is null then raise exception 'B1: la propuesta no se persistio'; end if;
  perform pg_temp.espera('B1 estado', pg_temp.estado(v_p), 'pending');
  if (select concept from core.transfer_proposal where id = v_p) <> 'Cena' then raise exception 'B1: el concepto no se canonicalizo'; end if;
  if (select target_user_id from core.transfer_proposal where id = v_p) <> bea then raise exception 'B1: el handle no resolvio a Bea'; end if;
  if (select expires_at - created_at from core.transfer_proposal where id = v_p) <> interval '7 days' then raise exception 'B1: la caducidad no es de 7 dias'; end if;
  if pg_temp.ops() <> 0 or pg_temp.saldo(pa) <> 0 or pg_temp.saldo(pb) <> 0 then raise exception 'B1: crear una propuesta toco la contabilidad'; end if;
  if exists (select 1 from core.effect) or exists (select 1 from core.balance_observation) then raise exception 'B1: crear escribio efectos u observaciones'; end if;
  perform pg_temp.espera('B1 replay (otra grafia del handle, misma intencion)', pg_temp.crear(ana, pg_temp.k(1), 'bea_tp', '2500', null, 'Cena'), 'replay');
  perform pg_temp.espera('B1 misma clave, otra intencion', pg_temp.crear(ana, pg_temp.k(1), 'bea_tp', '2600', null, 'Cena'), 'IDEMPOTENCY_KEY_REUSED');
  if (select count(*) from core.transfer_proposal where created_by = ana) <> 1 then raise exception 'B1: el replay creo otra propuesta'; end if;
  raise notice 'OK · B1 · crear persiste la intencion (uid resuelto, concepto canonico, 7 dias) sin tocar contabilidad; replay e IDEMPOTENCY_KEY_REUSED';

  -- B2 · forma y actor
  perform pg_temp.espera('B2 negativo', pg_temp.crear(ana, pg_temp.k(2), 'bea_tp', '-5'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B2 cero', pg_temp.crear(ana, pg_temp.k(2), 'bea_tp', '0'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B2 a uno mismo', pg_temp.crear(ana, pg_temp.k(2), '@ANA_TP', '100'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B2 anonimo', pg_temp.crear(inv, pg_temp.k(2), 'bea_tp', '100', null, null, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B2 sin handle definitivo', pg_temp.crear(dan, pg_temp.k(2), 'bea_tp', '100'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('B2 sin Personal', pg_temp.crear(eva, pg_temp.k(2), 'bea_tp', '100'), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B2 moneda distinta de la base', pg_temp.crear(ana, pg_temp.k(2), 'bea_tp', '100', usd), 'CURRENCY_CONVERSION_UNSUPPORTED');
  begin
    perform pg_temp.actor(ana);
    perform api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'handle', 'bea_tp', 'amount', '100',
      'currency_definition_id', (select eur from fx), 'from_scope_id', pa, 'to_scope_id', pb));
    raise exception 'B2: se acepto el payload de F3';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PAYLOAD_INVALID' then raise exception 'B2: payload de F3 dio %', sqlerrm::json ->> 'code'; end if;
  end;
  begin
    perform pg_temp.actor(ana);
    perform api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'handle', 'bea_tp', 'amount', 100, 'currency_definition_id', (select eur from fx)));
    raise exception 'B2: se acepto el importe como number JSON';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PAYLOAD_INVALID' then raise exception 'B2: importe number dio %', sqlerrm::json ->> 'code'; end if;
  end;
  if (select count(*) from core.transfer_proposal) <> 1 or (select count(*) from core.provisioning_command where command_type = 'transfer_proposal.create') <> 1 then
    raise exception 'B2: un rechazo dejo una propuesta o un comando';
  end if;
  -- ninguno de esos rechazos consumio el freno de resolucion (solo B1 apunto una vez)
  perform pg_temp.espera('B2 apuntes de Ana', pg_temp.intentos(ana)::text, '1');
  raise notice 'OK · B2 · forma y emisor: negativo, cero, a uno mismo y payload de F3 → PAYLOAD_INVALID; anonimo y sin Personal → NOT_AUTHORIZED; sin handle → USERNAME_REQUIRED; otra moneda → CURRENCY_CONVERSION_UNSUPPORTED; nada persiste ni apunta';

  -- B3 · el destinatario: inexistente, invitado con reserva, retenido, invalido, sin Personal
  perform pg_temp.espera('B3 inexistente', pg_temp.crear(ana, pg_temp.k(30), 'nadie_tp', '100'), 'not_found');
  perform pg_temp.espera('B3 reserva de invitado', pg_temp.crear(ana, pg_temp.k(31), 'inv_tp', '100'), 'not_found');
  perform pg_temp.espera('B3 sintaxis invalida', pg_temp.crear(ana, pg_temp.k(32), 'no válido', '100'), 'not_found');
  perform pg_temp.espera('B3 sin Personal', pg_temp.crear(ana, pg_temp.k(34), 'eva_tp', '100'), 'RECIPIENT_WITHOUT_PERSONAL_SCOPE');
  -- retenido: Cris cambia de handle; cris_tp queda retenido 90 dias y no nombra a nadie
  perform pg_temp.actor(cris);
  perform api.change_username('{"handle":"cris_nuevo"}'::jsonb);
  perform pg_temp.super();
  perform pg_temp.espera('B3 retenido', pg_temp.crear(ana, pg_temp.k(33), 'cris_tp', '100'), 'not_found');
  perform pg_temp.espera('B3 el nuevo si', pg_temp.crear(ana, pg_temp.k(3), 'cris_nuevo', '100'), 'ok');
  -- cada resolucion (found o not_found) apunto UNA vez: 1 (B1) + 5 aqui = 6. La de
  -- Eva NO: RECIPIENT_WITHOUT_PERSONAL_SCOPE es una excepcion y revierte su apunte;
  -- solo alcanza a cuentas con handle definitivo y sin Personal, que el ciclo
  -- autenticado de la app no produce (ensure_personal_scope corre antes).
  perform pg_temp.espera('B3 apuntes de Ana', pg_temp.intentos(ana)::text, '6');
  -- el replay de un «nadie» es not_found otra vez, sin propuesta y sin apuntar
  perform pg_temp.espera('B3 replay de nadie', pg_temp.crear(ana, pg_temp.k(31), 'inv_tp', '100'), 'not_found/replay');
  perform pg_temp.espera('B3 apuntes tras el replay', pg_temp.intentos(ana)::text, '6');
  if (select count(*) from core.transfer_proposal where created_by = ana) <> 2 then raise exception 'B3: un not_found dejo propuesta'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'username_lookup_attempt' and column_name not in ('user_id', 'attempted_at')) then
    raise exception 'B3: el apunte del freno guarda mas que quien y cuando';
  end if;
  raise notice 'OK · B3 · destinatario: inexistente, reserva, retenido e invalido son el estado not_found sin distinguirlos (y apuntan); sin Personal es RECIPIENT_WITHOUT_PERSONAL_SCOPE; cada resolucion apunta una vez';

  -- B4 · el freno compartido: Bea llega a 20 apuntes con resolve_username y ya no puede resolver ni proponer; frenado no apunta
  perform pg_temp.actor(bea);
  for i in 1 .. 20 loop
    perform * from api.resolve_username('nadie_' || i);
  end loop;
  perform pg_temp.super();
  perform pg_temp.espera('B4 apuntes de Bea', pg_temp.intentos(bea)::text, '20');
  perform pg_temp.espera('B4 frenada al proponer', pg_temp.crear(bea, pg_temp.k(4), 'ana_tp', '100'), 'RECIPIENT_LOOKUP_THROTTLED');
  perform pg_temp.espera('B4 frenada no apunta', pg_temp.intentos(bea)::text, '20');
  perform pg_temp.espera('B4 a uno mismo tampoco apunta ni frena distinto', pg_temp.crear(bea, pg_temp.k(4), 'bea_tp', '100'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B4 apuntes de Bea tras uno mismo', pg_temp.intentos(bea)::text, '20');
  -- los apuntes envejecen: fuera de la ventana de 10 min, vuelve a poder
  update core.username_lookup_attempt set attempted_at = now() - interval '11 minutes' where user_id = bea;
  perform pg_temp.espera('B4 pasada la ventana', pg_temp.crear(bea, pg_temp.k(4), 'ana_tp', '100'), 'ok');
  perform pg_temp.espera('B4 y apunta otra vez', pg_temp.intentos(bea)::text, '21');
  raise notice 'OK · B4 · el freno es el del resolver (20 / 10 min, compartido): frenado → RECIPIENT_LOOKUP_THROTTLED sin apuntar; pasada la ventana, entra y apunta';

  -- B5 · presupuesto MIXTO: 15 por resolve_username + 5 por create (not_found) = 20; la 21.a se frena por
  --      cualquiera de los dos; el replay de un not_found no apunta; el ABI de resolve_username no cambia
  perform pg_temp.espera('B5 Cris parte de cero', pg_temp.intentos(cris)::text, '0');
  perform pg_temp.actor(cris);
  for i in 1 .. 15 loop
    perform * from api.resolve_username('mixto_' || i);
  end loop;
  perform pg_temp.super();
  for i in 1 .. 5 loop
    perform pg_temp.espera('B5 create not_found ' || i, pg_temp.crear(cris, pg_temp.k(500 + i), 'mixto_c' || i, '1'), 'not_found');
  end loop;
  perform pg_temp.espera('B5 = 20 (15 resolve + 5 create)', pg_temp.intentos(cris)::text, '20');
  perform pg_temp.espera('B5 21.a por create', pg_temp.crear(cris, pg_temp.k(506), 'ana_tp', '1'), 'RECIPIENT_LOOKUP_THROTTLED');
  perform pg_temp.actor(cris);
  select state into v_txt from api.resolve_username('ana_tp');
  perform pg_temp.super();
  perform pg_temp.espera('B5 21.a por resolve', v_txt, 'throttled');
  perform pg_temp.espera('B5 replay de un not_found frenado no apunta', pg_temp.crear(cris, pg_temp.k(501), 'mixto_c1', '1'), 'not_found/replay');
  perform pg_temp.espera('B5 sigue en 20', pg_temp.intentos(cris)::text, '20');
  if (select count(*) from core.transfer_proposal where created_by = cris) <> 0 then raise exception 'B5: un not_found dejo propuesta'; end if;
  -- resolve_username sigue devolviendo (state, handle, public_name) y nada mas
  select string_agg(p.proname || ':' || pg_get_function_result(p.oid), ';') into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = 'resolve_username';
  perform pg_temp.espera('B5 ABI de resolve_username', v_txt, 'resolve_username:TABLE(state text, handle text, public_name text)');
  -- los apuntes de Cris envejecen como fixture: las secciones siguientes lo necesitan sin frenar
  update core.username_lookup_attempt set attempted_at = now() - interval '11 minutes' where user_id = cris;
  raise notice 'OK · B5 · el presupuesto es UNO para los dos comandos: 15 + 5 = 20 y la 21.a se frena por cualquiera; replay no apunta; el ABI del resolver no cambia';
end
$b$;

-- ═══════════════════════ C · anti-spam ════════════════════════════════════════
do $c$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  fer constant uuid := (select fer from fx);
  v_p uuid; v_txt text; i integer; v_creadas integer;
begin
  -- C1 · tres pending por pareja; la cuarta 409; cancelar libera la pareja pero NO el presupuesto
  -- Ana ya tiene una pending hacia Bea (B1) y una hacia Cris (B3).
  perform pg_temp.espera('C1 segunda a Bea', pg_temp.crear(ana, pg_temp.k(11), 'bea_tp', '11'), 'ok');
  perform pg_temp.espera('C1 tercera a Bea', pg_temp.crear(ana, pg_temp.k(12), 'bea_tp', '12'), 'ok');
  perform pg_temp.espera('C1 cuarta a Bea', pg_temp.crear(ana, pg_temp.k(13), 'bea_tp', '13'), 'PROPOSAL_LIMIT_PER_TARGET');
  perform pg_temp.espera('C1 a otro si', pg_temp.crear(ana, pg_temp.k(13), 'fer_tp', '13'), 'ok');
  -- cancelada deja de contar en la pareja
  perform pg_temp.espera('C1 cancelar la segunda', pg_temp.cancelar(ana, pg_temp.pid(ana, pg_temp.k(11))), 'cancelled');
  perform pg_temp.espera('C1 vuelve a caber una', pg_temp.crear(ana, pg_temp.k(14), 'bea_tp', '14'), 'ok');
  -- rechazada deja de contar
  perform pg_temp.espera('C1 Bea rechaza la tercera', pg_temp.rechazar(bea, pg_temp.pid(ana, pg_temp.k(12))), 'declined');
  perform pg_temp.espera('C1 vuelve a caber otra', pg_temp.crear(ana, pg_temp.k(15), 'bea_tp', '15'), 'ok');
  -- caducada deja de contar (fixture)
  v_p := pg_temp.pid(ana, pg_temp.k(14));
  update core.transfer_proposal set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where id = v_p;
  perform pg_temp.espera('C1 la caducada ya no es pending', pg_temp.estado(v_p), 'expired');
  perform pg_temp.espera('C1 vuelve a caber otra mas', pg_temp.crear(ana, pg_temp.k(16), 'bea_tp', '16'), 'ok');
  perform pg_temp.espera('C1 y la cuarta pending otra vez 409', pg_temp.crear(ana, pg_temp.k(17), 'bea_tp', '17'), 'PROPOSAL_LIMIT_PER_TARGET');
  raise notice 'OK · C1 · tres pending por pareja; cancelada, rechazada y caducada dejan de contar; a otro destinatario no afecta';

  -- C2 · 10 creadas / 60 min por emisor, contando TODAS las persistidas (la caducada del fixture salio de la ventana a proposito)
  select count(*) into v_creadas from core.transfer_proposal where created_by = ana and created_at > now() - interval '60 minutes';
  -- Ana lleva 7 en ventana: k1, k3(cris_nuevo), k11(cancelada), k12(rechazada), k13(fer), k15, k16
  perform pg_temp.espera('C2 creadas en ventana', v_creadas::text, '7');
  -- tres mas hacia Fer (pareja distinta; hay sitio) → 10
  perform pg_temp.espera('C2 octava', pg_temp.crear(ana, pg_temp.k(21), 'fer_tp', '21'), 'ok');
  perform pg_temp.espera('C2 novena', pg_temp.crear(ana, pg_temp.k(22), 'fer_tp', '22'), 'ok');
  -- la pareja con Fer esta llena (k13, k21, k22): la decima va a Cris (k3 pending → cabe)
  perform pg_temp.espera('C2 decima', pg_temp.crear(ana, pg_temp.k(23), 'cris_nuevo', '23'), 'ok');
  begin
    perform pg_temp.actor(ana);
    perform api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(24), 'command_contract_version', 1, 'handle', 'cris_nuevo', 'amount', '24', 'currency_definition_id', (select eur from fx)));
    raise exception 'C2: la undecima entro';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PROPOSAL_RATE_LIMITED' then raise exception 'C2: la undecima dio %', sqlerrm::json ->> 'code'; end if;
    if ((sqlerrm::json ->> 'details')::json ->> 'retry_at') is null then raise exception 'C2: PROPOSAL_RATE_LIMITED sin details.retry_at'; end if;
  end;
  -- lo rehusado no consumio: siguen 10 en ventana; y la pareja llena se rehusa ANTES que el presupuesto
  perform pg_temp.espera('C2 siguen 10', (select count(*) from core.transfer_proposal where created_by = ana and created_at > now() - interval '60 minutes')::text, '10');
  perform pg_temp.espera('C2 pareja antes que presupuesto', pg_temp.crear(ana, pg_temp.k(25), 'fer_tp', '25'), 'PROPOSAL_LIMIT_PER_TARGET');
  -- cancelar no devuelve cuota
  perform pg_temp.espera('C2 cancelar una', pg_temp.cancelar(ana, pg_temp.pid(ana, pg_temp.k(21))), 'cancelled');
  perform pg_temp.espera('C2 sigue frenada', pg_temp.crear(ana, pg_temp.k(26), 'cris_nuevo', '26'), 'PROPOSAL_RATE_LIMITED');
  -- otro emisor no comparte el presupuesto
  perform pg_temp.espera('C2 otro emisor', pg_temp.crear(cris, pg_temp.k(27), 'ana_tp', '27'), 'ok');
  -- una creada hace mas de una hora sale de la ventana (fixture) y vuelve a caber una
  update core.transfer_proposal set created_at = now() - interval '61 minutes', expires_at = now() + interval '6 days' where id = pg_temp.pid(ana, pg_temp.k(15));
  perform pg_temp.espera('C2 fuera de ventana, cabe otra', pg_temp.crear(ana, pg_temp.k(26), 'cris_nuevo', '26'), 'ok');
  perform pg_temp.espera('C2 y la siguiente no', pg_temp.crear(ana, pg_temp.k(28), 'fer_tp', '28'), 'PROPOSAL_RATE_LIMITED');
  raise notice 'OK · C2 · 10 creadas / 60 min por emisor: la undecima PROPOSAL_RATE_LIMITED con retry_at; rechazar antes de crear no consume; cancelar no devuelve; por emisor; la ventana envejece';
end
$c$;

-- ═══════════════════════ D · aceptar ══════════════════════════════════════════
do $d$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); fer constant uuid := (select fer from fx); nadie constant uuid := (select nadie from fx);
  pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx); pc constant uuid := (select pc from fx); pf constant uuid := (select pf from fx);
  v_p uuid; v_op uuid; v_ver uuid; v_n integer; v_txt text; v_bal_a bigint; v_bal_b bigint;
begin
  v_p := pg_temp.pid(ana, pg_temp.k(1));  -- Ana → Bea, 2500, «Cena»
  -- D1 · solo el receptor: un tercero, el propio creador y alguien sin nada → NOT_AUTHORIZED; nada escrito
  perform pg_temp.espera('D1 tercero', pg_temp.aceptar(cris, pg_temp.k(101), v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D1 el creador', pg_temp.aceptar(ana, pg_temp.k(101), v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D1 nadie', pg_temp.aceptar(nadie, pg_temp.k(101), v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D1 inexistente', pg_temp.aceptar(bea, pg_temp.k(101), gen_random_uuid()), 'NOT_AUTHORIZED');
  if pg_temp.ops() <> 0 or exists (select 1 from core.client_command) then raise exception 'D1: un rechazo dejo operacion o clave'; end if;
  perform pg_temp.espera('D1 sigue pending', pg_temp.estado(v_p), 'pending');
  raise notice 'OK · D1 · aceptar es solo del receptor: tercero, creador, desconocido e inexistente → NOT_AUTHORIZED sin escribir';

  -- D2 · Bea acepta: -2500 en PA, +2500 en PB; partes; autoria; fecha del servidor; transicion; replay
  v_bal_a := pg_temp.saldo(pa); v_bal_b := pg_temp.saldo(pb);
  perform pg_temp.espera('D2 aceptar', pg_temp.aceptar(bea, pg_temp.k(102), v_p), 'ok');
  v_op := pg_temp.op_de(v_p);
  if v_op is null then raise exception 'D2: la propuesta no quedo ligada a la operacion'; end if;
  perform pg_temp.espera('D2 estado', pg_temp.estado(v_p), 'accepted');
  if (select accepted_at from core.transfer_proposal where id = v_p) is null then raise exception 'D2: sin accepted_at'; end if;
  perform pg_temp.espera('D2 saldo A', (pg_temp.saldo(pa) - v_bal_a)::text, '-2500');
  perform pg_temp.espera('D2 saldo B', (pg_temp.saldo(pb) - v_bal_b)::text, '2500');
  select o.current_version_id into v_ver from core.operation o where o.id = v_op;
  select count(*) into v_n from core.effect e where e.operation_version_id = v_ver;
  if v_n <> 2 then raise exception 'D2: % efectos y deben ser 2', v_n; end if;
  if exists (select 1 from core.effect e where e.operation_version_id = v_ver and (e.economic_amount is not null or e.debt_amount is not null or e.accounting_class <> 'transfer')) then
    raise exception 'D2: la transferencia produjo dimension economica o de deuda, o no es transfer';
  end if;
  -- partes (§14): from = Personal del creador, to = del aceptante
  select from_scope_id::text || '>' || to_scope_id::text into v_txt from core.transfer_part where operation_version_id = v_ver;
  perform pg_temp.espera('D2 partes', v_txt, pa::text || '>' || pb::text);
  -- autoria (§12): quien escribio es el receptor
  if (select created_by from core.operation where id = v_op) <> bea or (select created_by from core.operation_version where id = v_ver) <> bea then
    raise exception 'D2: created_by no es el receptor que materializo';
  end if;
  -- fecha e instante del servidor (§21); importe y moneda de la propuesta; version record, la unica
  if (select effective_date from core.operation_version where id = v_ver) <> current_date then raise exception 'D2: la fecha efectiva no es la de la aceptacion'; end if;
  if (select effective_time from core.operation_version where id = v_ver) is null then raise exception 'D2: sin hora efectiva'; end if;
  if (select original_amount || '|' || original_currency_definition_id::text || '|' || version_kind || '|' || version_no from core.operation_version where id = v_ver)
     <> '2500|' || (select eur from fx)::text || '|record|1' then
    raise exception 'D2: la version no reproduce la propuesta';
  end if;
  -- sin concepto ni categoria en la version (§7)
  if exists (select 1 from core.movement_detail where operation_version_id = v_ver) or exists (select 1 from core.expense_category where operation_version_id = v_ver) then
    raise exception 'D2: la version lleva concepto o categoria';
  end if;
  -- observaciones de saldo en los dos ambitos
  select count(*) into v_n from core.balance_observation where operation_version_id = v_ver;
  if v_n <> 2 then raise exception 'D2: % observaciones de saldo y deben ser 2', v_n; end if;
  -- replay: misma clave, misma operacion, nada nuevo
  perform pg_temp.espera('D2 replay', pg_temp.aceptar(bea, pg_temp.k(102), v_p), 'replay');
  perform pg_temp.espera('D2 una operacion', pg_temp.ops()::text, '1');
  -- segunda clave (otro dispositivo): la propuesta ya esta aceptada
  perform pg_temp.espera('D2 segunda clave', pg_temp.aceptar(bea, pg_temp.k(103), v_p), 'PROPOSAL_ACCEPTED');
  perform pg_temp.espera('D2 sigue una operacion', pg_temp.ops()::text, '1');
  raise notice 'OK · D2 · aceptar: -N/+N, dos efectos transfer sin economica ni deuda, partes from/to, created_by = receptor, fecha del servidor, una version record, replay, PROPOSAL_ACCEPTED con otra clave';

  -- D3 · terminales: caducada, cancelada, rechazada → su codigo, sin escribir
  v_p := pg_temp.pid(ana, pg_temp.k(14));  -- caducada (fixture de C1)
  perform pg_temp.espera('D3 caducada', pg_temp.aceptar(bea, pg_temp.k(104), v_p), 'PROPOSAL_EXPIRED');
  v_p := pg_temp.pid(ana, pg_temp.k(11));  -- cancelada
  perform pg_temp.espera('D3 cancelada', pg_temp.aceptar(bea, pg_temp.k(105), v_p), 'PROPOSAL_CANCELLED');
  v_p := pg_temp.pid(ana, pg_temp.k(12));  -- rechazada
  perform pg_temp.espera('D3 rechazada', pg_temp.aceptar(bea, pg_temp.k(106), v_p), 'PROPOSAL_DECLINED');
  perform pg_temp.espera('D3 sigue una operacion', pg_temp.ops()::text, '1');
  if exists (select 1 from core.client_command where client_operation_id in (pg_temp.k(104), pg_temp.k(105), pg_temp.k(106))) then
    raise exception 'D3: un rechazo dejo su clave reclamada';
  end if;
  raise notice 'OK · D3 · caducada, cancelada y rechazada no se aceptan: su codigo, y ninguna escritura';

  -- D4 · en negativo se ejecuta (§15): Ana ya esta en -2500 y otra sale igual
  v_p := pg_temp.pid(ana, pg_temp.k(16));  -- Ana → Bea, 16
  perform pg_temp.espera('D4 aceptar en negativo', pg_temp.aceptar(bea, pg_temp.k(107), v_p), 'ok');
  perform pg_temp.espera('D4 saldo A', pg_temp.saldo(pa)::text, '-2516');
  raise notice 'OK · D4 · sin validacion de fondos: el Disponible del emisor queda en -2516';

  -- D5 · bases distintas (§20): Fer (USD) no puede aceptar una propuesta en EUR; nada escrito
  v_p := pg_temp.pid(ana, pg_temp.k(13));  -- Ana → Fer, 13 EUR
  perform pg_temp.espera('D5 moneda', pg_temp.aceptar(fer, pg_temp.k(108), v_p), 'CURRENCY_CONVERSION_UNSUPPORTED');
  perform pg_temp.espera('D5 sigue pending', pg_temp.estado(v_p), 'pending');
  perform pg_temp.espera('D5 dos operaciones', pg_temp.ops()::text, '2');
  raise notice 'OK · D5 · la base del receptor no es la moneda de la propuesta → CURRENCY_CONVERSION_UNSUPPORTED sin escribir';

  -- D6 · el handle se resolvio UNA vez (§4): Bea cambia de username y la propuesta sigue siendo suya;
  --      su handle viejo, liberado y tomado por otra cuenta, no arrastra la propuesta
  v_p := pg_temp.pid(ana, pg_temp.k(15));  -- Ana → Bea, 15, pending
  perform pg_temp.actor(bea);
  perform api.change_username('{"handle":"bea_nueva"}'::jsonb);
  perform pg_temp.super();
  perform pg_temp.espera('D6 sigue dirigida a Bea', (select target_user_id from core.transfer_proposal where id = v_p)::text, bea::text);
  -- bea_tp retenido → vencido (fixture) → Dan lo toma
  update core.account_handle set released_at = now() - interval '91 days', held_until = now() - interval '1 day' where handle = 'bea_tp';
  perform pg_temp.actor(dan);
  perform api.reserve_username('{"handle":"bea_tp","public_name":"Dan"}'::jsonb);
  perform pg_temp.super();
  if (select user_id from core.account_handle where handle = 'bea_tp' and released_at is null) <> dan then raise exception 'D6: Dan no obtuvo bea_tp'; end if;
  perform pg_temp.espera('D6 Dan no la acepta', pg_temp.aceptar(dan, pg_temp.k(109), v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D6 Dan no la ve', pg_temp.vista_propuestas(dan), '-');
  perform pg_temp.espera('D6 Bea si', pg_temp.aceptar(bea, pg_temp.k(109), v_p), 'ok');
  -- y una propuesta nueva a @bea_tp va a Dan, no a Bea
  perform pg_temp.espera('D6 propuesta nueva a bea_tp', pg_temp.crear(cris, pg_temp.k(110), 'bea_tp', '10'), 'ok');
  perform pg_temp.espera('D6 va a Dan', (select target_user_id from core.transfer_proposal where id = pg_temp.pid(cris, pg_temp.k(110)))::text, dan::text);
  raise notice 'OK · D6 · el uid se fijo al crear: el cambio de handle no mueve la propuesta; el handle reutilizado por otra cuenta no la arrastra ni la enseña';
end
$d$;

-- ═══════════════════════ E · cancelar y rechazar ══════════════════════════════
do $e$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  v_p uuid; v_q uuid;
begin
  v_p := pg_temp.pid(cris, pg_temp.k(27));  -- Cris → Ana, 27, pending
  perform pg_temp.espera('E1 tercero cancela', pg_temp.cancelar(bea, v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 receptor cancela', pg_temp.cancelar(ana, v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 tercero rechaza', pg_temp.rechazar(bea, v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 creador rechaza', pg_temp.rechazar(cris, v_p), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 anonimo cancela', pg_temp.cancelar(inv, v_p, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 inexistente', pg_temp.cancelar(cris, gen_random_uuid()), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 sigue pending', pg_temp.estado(v_p), 'pending');
  perform pg_temp.espera('E1 el creador cancela', pg_temp.cancelar(cris, v_p), 'cancelled');
  perform pg_temp.espera('E1 otra vez: idempotente', pg_temp.cancelar(cris, v_p), 'cancelled/replay');
  perform pg_temp.espera('E1 rechazar una cancelada', pg_temp.rechazar(ana, v_p), 'PROPOSAL_CANCELLED');
  perform pg_temp.espera('E1 aceptar una cancelada', pg_temp.aceptar(ana, pg_temp.k(201), v_p), 'PROPOSAL_CANCELLED');
  if (select cancelled_at is not null and declined_at is null and accepted_at is null from core.transfer_proposal where id = v_p) is not true then
    raise exception 'E1: la cancelada lleva otra marca';
  end if;
  raise notice 'OK · E1 · cancelar es solo del creador, idempotente; una cancelada ni se rechaza ni se acepta';

  v_q := pg_temp.pid(ana, pg_temp.k(22));  -- Ana → Fer, 22, pending
  perform pg_temp.espera('E2 receptor rechaza', pg_temp.rechazar((select fer from fx), v_q), 'declined');
  perform pg_temp.espera('E2 otra vez: idempotente', pg_temp.rechazar((select fer from fx), v_q), 'declined/replay');
  perform pg_temp.espera('E2 cancelar una rechazada', pg_temp.cancelar(ana, v_q), 'PROPOSAL_DECLINED');
  perform pg_temp.espera('E2 cancelar una aceptada', pg_temp.cancelar(ana, pg_temp.pid(ana, pg_temp.k(1))), 'PROPOSAL_ACCEPTED');
  perform pg_temp.espera('E2 rechazar una aceptada', pg_temp.rechazar(bea, pg_temp.pid(ana, pg_temp.k(1))), 'PROPOSAL_ACCEPTED');
  perform pg_temp.espera('E2 cancelar una caducada', pg_temp.cancelar(ana, pg_temp.pid(ana, pg_temp.k(14))), 'PROPOSAL_EXPIRED');
  perform pg_temp.espera('E2 rechazar una caducada', pg_temp.rechazar(bea, pg_temp.pid(ana, pg_temp.k(14))), 'PROPOSAL_EXPIRED');
  -- ninguna terminal vuelve a pending: a lo sumo una marca en toda la tabla
  if exists (select 1 from core.transfer_proposal where (accepted_at is not null)::int + (declined_at is not null)::int + (cancelled_at is not null)::int > 1) then
    raise exception 'E2: una propuesta lleva dos marcas terminales';
  end if;
  raise notice 'OK · E2 · rechazar es solo del receptor, idempotente; terminales excluyentes y ninguna vuelve a pending';
end
$e$;

-- ═══════════════════════ F · irreversibilidad ═════════════════════════════════
do $f$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  v_p uuid; v_op uuid; v_ver uuid; v_n integer;
begin
  v_p := pg_temp.pid(ana, pg_temp.k(1)); v_op := pg_temp.op_de(v_p);
  select current_version_id into v_ver from core.operation where id = v_op;
  -- F1 · corregir: antes de la clave (no queda client_command)
  perform pg_temp.espera('F1 corregir', pg_temp.aceptar(bea, pg_temp.k(301), v_p, jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver)), 'TRANSFER_NOT_EDITABLE');
  perform pg_temp.espera('F1 corregir como emisor', pg_temp.aceptar(ana, pg_temp.k(301), v_p, jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver)), 'TRANSFER_NOT_EDITABLE');
  if exists (select 1 from core.client_command where client_operation_id = pg_temp.k(301)) then raise exception 'F1: la correccion reclamo la clave'; end if;
  -- F2 · anular, por las dos partes y por un tercero
  perform pg_temp.espera('F2 anula el receptor', pg_temp.anular(bea, pg_temp.k(302), v_op), 'OPERATION_NOT_ANNULLABLE');
  perform pg_temp.espera('F2 anula el emisor', pg_temp.anular(ana, pg_temp.k(303), v_op), 'OPERATION_NOT_ANNULLABLE');
  perform pg_temp.espera('F2 anula un tercero', pg_temp.anular(cris, pg_temp.k(304), v_op), 'OPERATION_NOT_ANNULLABLE');
  select count(*) into v_n from core.operation_version where operation_id = v_op;
  if v_n <> 1 then raise exception 'F2: la transferencia tiene % versiones', v_n; end if;
  if (select current_version_id from core.operation where id = v_op) <> v_ver then raise exception 'F2: la version vigente cambio'; end if;
  -- F3 · el respaldo: sec.persist_version rehusa una version 2 de la clase, sea correccion o anulacion
  begin
    perform sec.persist_version(bea, v_op, gen_random_uuid(), 2, v_ver, 'internal_transfer', current_date, 2500, (select eur from fx), null, 'record');
    raise exception 'F3: persist_version acepto una correccion de internal_transfer';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'TRANSFER_NOT_EDITABLE' then raise exception 'F3: correccion dio %', sqlerrm::json ->> 'code'; end if;
  end;
  begin
    perform sec.persist_version(bea, v_op, gen_random_uuid(), 2, v_ver, 'internal_transfer', current_date, 2500, (select eur from fx), null, 'annulment');
    raise exception 'F3: persist_version acepto una anulacion de internal_transfer';
  exception when sqlstate 'PGRST' then
    if (sqlerrm::json ->> 'code') <> 'OPERATION_NOT_ANNULLABLE' then raise exception 'F3: anulacion dio %', sqlerrm::json ->> 'code'; end if;
  end;
  -- F4 · una segunda propuesta es el camino de la devolucion: Bea → Ana sin ninguna marca ni enlace obligatorio
  perform pg_temp.espera('F4 devolucion', pg_temp.crear(bea, pg_temp.k(305), 'ana_tp', '2500', null, 'Devolucion cena'), 'ok');
  perform pg_temp.espera('F4 Ana acepta', pg_temp.aceptar(ana, pg_temp.k(306), pg_temp.pid(bea, pg_temp.k(305))), 'ok');
  perform pg_temp.espera('F4 saldo A vuelve', (pg_temp.saldo((select pa from fx)))::text, '-31');  -- -2500 -16 -15 +2500
  raise notice 'OK · F · una internal_transfer tiene exactamente una version: corregir → TRANSFER_NOT_EDITABLE antes de la clave; anular → OPERATION_NOT_ANNULLABLE para todos; persist_version lo respalda; la devolucion es otra transferencia';
end
$f$;

-- ═══════════════════════ G · vistas ═══════════════════════════════════════════
do $g$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); fer constant uuid := (select fer from fx); nadie constant uuid := (select nadie from fx);
  pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx);
  v_txt text; v_n integer; v_bal text;
begin
  -- G1 · el emisor ve TODAS las suyas con estado y el handle ACTUAL de la contraparte; el receptor solo las pending
  v_txt := pg_temp.vista_propuestas(ana);
  if v_txt not like '%outgoing:bea_nueva:accepted:2500%' then raise exception 'G1: Ana no ve su aceptada con el handle nuevo de Bea: %', v_txt; end if;
  if v_txt like '%bea_tp%' then raise exception 'G1: Ana sigue viendo el handle viejo de Bea: %', v_txt; end if;
  if v_txt not like '%outgoing:bea_nueva:cancelled:11%' or v_txt not like '%outgoing:bea_nueva:declined:12%' or v_txt not like '%outgoing:bea_nueva:expired:14%' then
    raise exception 'G1: Ana no ve cancelada, rechazada y caducada: %', v_txt;
  end if;
  if v_txt not like '%outgoing:fer_tp:pending:13%' or v_txt not like '%outgoing:cris_nuevo:pending:100%' then raise exception 'G1: Ana no ve sus pending: %', v_txt; end if;
  -- de las entrantes de Ana solo la pending de Bea (k4); la cancelada de Cris y la aceptada de Bea no
  if (length(v_txt) - length(replace(v_txt, 'incoming:', ''))) / length('incoming:') <> 1 or v_txt not like '%incoming:bea_nueva:pending:100%' then
    raise exception 'G1: las entrantes de Ana no son exactamente la pending de Bea: %', v_txt;
  end if;
  perform pg_temp.espera('G1 Fer: solo su pending entrante', pg_temp.vista_propuestas(fer), 'incoming:ana_tp:pending:13');
  perform pg_temp.espera('G1 Dan: la de Cris a @bea_tp', pg_temp.vista_propuestas(dan), 'incoming:cris_nuevo:pending:10');
  perform pg_temp.espera('G1 un tercero: nada', pg_temp.vista_propuestas(nadie), '-');
  raise notice 'OK · G1 · el emisor ve todas con estado y la identidad ACTUAL de la contraparte; el receptor solo las pending; un tercero nada';

  -- G2 · las transferencias en cada Personal: direccion desde las partes, signo del lado, concepto de la propuesta
  perform pg_temp.espera('G2 Ana', pg_temp.vista_transferencias(ana),
    'outgoing:bea_nueva:-2500:Cena;outgoing:bea_nueva:-16:-;outgoing:bea_nueva:-15:-;incoming:bea_nueva:2500:Devolucion cena');
  perform pg_temp.espera('G2 Bea', pg_temp.vista_transferencias(bea),
    'outgoing:ana_tp:-2500:Devolucion cena;incoming:ana_tp:15:-;incoming:ana_tp:16:-;incoming:ana_tp:2500:Cena');
  perform pg_temp.espera('G2 Cris: ninguna', pg_temp.vista_transferencias(cris), '-');
  perform pg_temp.espera('G2 un tercero: ninguna', pg_temp.vista_transferencias(nadie), '-');
  -- solo el ambito PROPIO, y los importes cruzan como texto
  perform pg_temp.actor(ana);
  select count(*) into v_n from api.my_transfers where scope_id <> pa;
  if v_n <> 0 then raise exception 'G2: my_transfers publica un ambito ajeno'; end if;
  select count(*) into v_n from api.my_transfers where amount <> abs(balance_amount::bigint)::text;
  if v_n <> 0 then raise exception 'G2: amount no es el valor absoluto del efecto propio'; end if;
  perform pg_temp.super();
  raise notice 'OK · G2 · my_transfers: una fila por transferencia en el Personal propio, signo por lado, concepto y contraparte de la propuesta, sin ambito ajeno';

  -- G3 · personal_operation NO la lista (lista blanca de F06/ADR-007) y personal_balance SI la suma
  perform pg_temp.actor(ana);
  select count(*) into v_n from api.personal_operation where operation_class = 'internal_transfer';
  select balance_amount into v_bal from api.personal_balance;
  perform pg_temp.super();
  if v_n <> 0 then raise exception 'G3: personal_operation lista internal_transfer'; end if;
  perform pg_temp.espera('G3 Disponible de Ana', v_bal, '-31');
  raise notice 'OK · G3 · la lista del Personal no la enseña todavia (lista blanca) y el Disponible ya la cuenta: -31';

  -- G4 · counts_in_personal con fresh (§21, evidencia 16): sin efecto de grupo, la transferencia cuenta siempre
  insert into core.personal_start (scope_id, mode, started_at, automatic, decided_by, client_command_id)
  values (pa, 'fresh', now() + interval '1 hour', false, ana, gen_random_uuid());
  perform pg_temp.actor(ana);
  select count(*) into v_n from api.my_transfers;
  select balance_amount into v_bal from api.personal_balance;
  perform pg_temp.super();
  if v_n <> 4 then raise exception 'G4: con fresh, my_transfers enseña % filas y deben ser 4', v_n; end if;
  perform pg_temp.espera('G4 Disponible con fresh', v_bal, '-31');
  raise notice 'OK · G4 · con inicio fresh la transferencia sigue contando en el Personal: sin efecto de grupo no hay corte';
end
$g$;

-- ═══════════════════════ H · el cliente no alcanza core ═══════════════════════
do $h$
begin
  perform pg_temp.actor((select ana from fx));
  begin
    perform count(*) from core.transfer_proposal;
    raise exception 'H: authenticated lee core.transfer_proposal directamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from core.transfer_part;
    raise exception 'H: authenticated lee core.transfer_part directamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sec.handle_owner('ana_tp');
    raise exception 'H: authenticated ejecuta sec.handle_owner';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · H · el cliente no llega a core ni resuelve handles a uid';
end
$h$;

rollback;
