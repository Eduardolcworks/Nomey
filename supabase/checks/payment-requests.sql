-- ============================================================================
-- SOLICITUDES DE PAGO MEDIANTE ENLACE (F12/ADR-004, F12.B2)
-- contra las funciones reales de 20260927120000, aislado
-- ============================================================================
--
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/checks/payment-requests.sql
--
-- Dentro de UNA transaccion now() no avanza: la caducidad (7 dias) y la
-- ventana del freno (10 min) se fijan como fixture, como postgres, retrasando
-- marcas de filas que las funciones produjeron. Es lo unico que este check
-- escribe a mano en las tablas de F12.B2.
--
--   A · estructura: dos tablas con RLS; propietarios (provisioner lo de la
--       solicitud, writer lo contable, nada nuevo de postgres); definer donde
--       toca; EXECUTE por rol; el cliente sin token_hash, created_by ni
--       paid_by; el apunte del freno sin token; policies created_by = actor
--       intactas; ninguna vista deriva el rol de created_by; nueve record_*
--   B · crear: ni operacion ni efecto ni saldo; el token sale UNA vez (43
--       chars base64url, solo su sha256 en la base, nunca el texto); replay
--       → misma solicitud y token null; clave reutilizada; anonimo, sin
--       handle, sin Personal, otra moneda, importe no positivo; tope de 20
--       pendientes (la 21.a PAYMENT_REQUEST_LIMIT), y cancelar, caducar o
--       pagar libera hueco
--   C · previsualizar: ok | own | paid | cancelled | expired | invalid |
--       throttled; en ok/own exactamente amount, currency, concept y la
--       identidad ACTUAL del creador (tras cambiar de username, el nuevo);
--       SOLO invalid apunta y cuenta (20 / 10 min); throttled no apunta; el
--       apunte no lleva token; anonimo NOT_AUTHORIZED
--   D · pagar: -N/+N, dos efectos transfer, partes from = pagador y to =
--       creador, created_by = paid_by = dueno de from (los cuatro coinciden),
--       fecha del servidor, una version; replay; segunda clave →
--       ALREADY_PAID; OWN sin clave; anonimo; sin handle; cancelada y
--       caducada sin escribir; XOR del payload; token invalido; bases
--       distintas; en negativo se ejecuta; la via de B1 (proposal_id) intacta
--   E · cancelar: solo el creador; idempotente en cancelled y expired;
--       ALREADY_PAID; tercero NOT_AUTHORIZED; una cancelada no se paga
--   F · irreversibilidad de la transferencia resultante; la solicitud sigue
--       paid tras una devolucion; el enlace responde paid
--   G · vistas: my_payment_requests solo las propias, con el pagador actual
--       si se pago; my_transfers en los dos Personales con concepto y
--       contraparte de la solicitud y direccion desde las partes;
--       personal_operation no la lista y personal_balance la suma
--   H · el cliente no alcanza core ni el hash
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  'b2000000-0000-4000-8000-0000000000a1'::uuid as ana,   -- normal, handle, Personal EUR (pagadora)
  'b2000000-0000-4000-8000-0000000000b1'::uuid as bea,   -- normal, handle, Personal EUR (creadora)
  'b2000000-0000-4000-8000-0000000000c1'::uuid as cris,  -- normal, handle, Personal EUR
  'b2000000-0000-4000-8000-0000000000d1'::uuid as dan,   -- normal, SIN handle, Personal EUR
  'b2000000-0000-4000-8000-0000000000e1'::uuid as eva,   -- normal, handle, SIN Personal
  'b2000000-0000-4000-8000-0000000000f1'::uuid as fer,   -- normal, handle, Personal USD
  'b2000000-0000-4000-8000-000000000011'::uuid as inv,   -- invitado
  'b2000000-0000-4000-8000-000000000021'::uuid as nadie, -- sin nada
  'b2c00000-0000-4000-8000-0000000000e1'::uuid as eur,
  'b2c00000-0000-4000-8000-0000000000d1'::uuid as usd,
  'b2a00000-0000-4000-8000-0000000000a1'::uuid as pa,
  'b2a00000-0000-4000-8000-0000000000b1'::uuid as pb,
  'b2a00000-0000-4000-8000-0000000000c1'::uuid as pc,
  'b2a00000-0000-4000-8000-0000000000d1'::uuid as pd,
  'b2a00000-0000-4000-8000-0000000000f1'::uuid as pf;
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

do $seed$
declare r record;
begin
  perform pg_temp.actor((select ana from fx));  select * into r from api.reserve_username('{"handle":"ana_pr","public_name":"Ana"}');
  perform pg_temp.actor((select bea from fx));  select * into r from api.reserve_username('{"handle":"bea_pr","public_name":"Bea"}');
  perform pg_temp.actor((select cris from fx)); select * into r from api.reserve_username('{"handle":"cris_pr","public_name":"Cris"}');
  perform pg_temp.actor((select eva from fx));  select * into r from api.reserve_username('{"handle":"eva_pr","public_name":"Eva"}');
  perform pg_temp.actor((select fer from fx));  select * into r from api.reserve_username('{"handle":"fer_pr","public_name":"Fer"}');
  perform pg_temp.super();
end $seed$;

-- Los tokens entregados, por clave, para que las secciones los reutilicen.
create temp table tok (key uuid primary key, token text, request_id uuid);
grant select, insert on tok to authenticated;

-- crear como p_user: 'ok' | 'replay:null' | 'replay:token' | codigo. Guarda el token en tok.
create function pg_temp.crear(p_user uuid, p_key uuid, p_amount text, p_currency uuid default null, p_concept text default null, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb; v jsonb;
begin
  v := jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'amount', p_amount,
                          'currency_definition_id', coalesce(p_currency, (select eur from fx)));
  if p_concept is not null then v := v || jsonb_build_object('concept', p_concept); end if;
  perform pg_temp.actor(p_user, p_anon);
  r := api.create_payment_request(v);
  perform pg_temp.super();
  if (r ->> 'already_processed')::boolean then
    return 'replay:' || case when r ->> 'token' is null then 'null' else 'token' end;
  end if;
  insert into tok (key, token, request_id) values (p_key, r ->> 'token', (r ->> 'request_id')::uuid);
  return 'ok';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.t(p_key uuid) returns text language sql as $$ select token from tok where key = p_key; $$;
create function pg_temp.rid(p_key uuid) returns uuid language sql as $$ select request_id from tok where key = p_key; $$;
-- previsualizar: 'state' o 'state|amount|concept|handle|name' o codigo
create function pg_temp.ver(p_user uuid, p_token text, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.preview_payment_request(p_token);
  perform pg_temp.super();
  if r ? 'amount' then
    return (r ->> 'state') || '|' || (r ->> 'amount') || '|' || coalesce(r ->> 'concept', '-') || '|' || coalesce(r ->> 'creator_handle', '-') || '|' || coalesce(r ->> 'creator_public_name', '-');
  end if;
  return r ->> 'state';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- pagar: 'ok' | 'replay' | codigo
create function pg_temp.pagar(p_user uuid, p_key uuid, p_token text, p_extra jsonb default '{}'::jsonb, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb; v jsonb;
begin
  v := jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1);
  if p_token is not null then v := v || jsonb_build_object('payment_request_token', p_token); end if;
  perform pg_temp.actor(p_user, p_anon);
  r := api.record_internal_transfer(v || p_extra);
  perform pg_temp.super();
  return case when (r ->> 'already_processed')::boolean then 'replay' else 'ok' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.cancelar(p_user uuid, p_request uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.cancel_payment_request(jsonb_build_object('request_id', p_request));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
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
create function pg_temp.estado(p_request uuid) returns text language sql as $$
  select sec.payment_request_state(r.paid_operation_id, r.cancelled_at, r.expires_at) from core.payment_request r where r.id = p_request;
$$;
create function pg_temp.op_de(p_request uuid) returns uuid language sql as $$ select paid_operation_id from core.payment_request where id = p_request; $$;
create function pg_temp.saldo(p_scope uuid) returns bigint language sql as $$
  select coalesce(sum(e.balance_amount), 0) from core.current_effect e where e.scope_id = p_scope and e.balance_amount is not null;
$$;
create function pg_temp.intentos(p_user uuid) returns integer language sql as $$
  select count(*)::integer from core.payment_request_attempt a where a.user_id = p_user;
$$;
create function pg_temp.ops() returns integer language sql as $$
  select count(*)::integer from core.operation where operation_class = 'internal_transfer';
$$;
create function pg_temp.pendientes(p_user uuid) returns integer language sql as $$
  select count(*)::integer from core.payment_request r where r.created_by = p_user and sec.payment_request_state(r.paid_operation_id, r.cancelled_at, r.expires_at) = 'pending';
$$;
create function pg_temp.vista_solicitudes(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(state || ':' || amount || ':' || coalesce(concept, '-') || ':' || coalesce(payer_handle, '-'), ';' order by created_at, amount::bigint), '-') into v from api.my_payment_requests;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.vista_transferencias(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(direction || ':' || coalesce(counterpart_handle, '-') || ':' || balance_amount || ':' || coalesce(concept, '-') || ':' || case when payment_request_id is not null then 'req' when proposal_id is not null then 'prop' else '-' end, ';' order by operation_created_at, balance_amount::bigint), '-') into v from api.my_transfers;
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
  select ('b2e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.crear(uuid, uuid, text, uuid, text, boolean), pg_temp.t(uuid), pg_temp.rid(uuid), pg_temp.ver(uuid, text, boolean),
  pg_temp.pagar(uuid, uuid, text, jsonb, boolean), pg_temp.cancelar(uuid, uuid, boolean), pg_temp.anular(uuid, uuid, uuid), pg_temp.estado(uuid),
  pg_temp.op_de(uuid), pg_temp.saldo(uuid), pg_temp.intentos(uuid), pg_temp.ops(), pg_temp.pendientes(uuid), pg_temp.vista_solicitudes(uuid),
  pg_temp.vista_transferencias(uuid), pg_temp.espera(text, text, text), pg_temp.k(integer) to authenticated;

-- ═══════════════════════ A · estructura ═══════════════════════════════════════
do $a$
declare
  v_n integer;
  v_t text;
  r record;
begin
  for v_t in select unnest(array['payment_request', 'payment_request_attempt']) loop
    if not (select relrowsecurity from pg_class where oid = ('core.' || v_t)::regclass) then
      raise exception 'A: core.% sin RLS', v_t;
    end if;
  end loop;
  select count(*) into v_n from pg_constraint where conrelid = 'core.payment_request'::regclass and contype = 'c';
  if v_n < 6 then raise exception 'A: core.payment_request tiene % CHECKs, se esperaban al menos 6', v_n; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.payment_request'::regclass and contype = 'u' and conname = 'payment_request_token_hash_key') then
    raise exception 'A: token_hash no es unico';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'payment_request'
                  and indexdef ilike '%unique%' and indexdef ilike '%(paid_operation_id)%') then
    raise exception 'A: falta el indice unico de paid_operation_id';
  end if;
  -- ni token en claro, ni handle, ni nombre, en ninguna relacion de B2
  if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name in ('payment_request', 'payment_request_attempt')
              and column_name in ('token', 'handle', 'username', 'public_name', 'display_name', 'token_hash') and not (table_name = 'payment_request' and column_name = 'token_hash')) then
    raise exception 'A: una relacion de F12.B2 persiste el token en claro, un handle o un nombre';
  end if;
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.columns where table_schema = 'core' and table_name = 'payment_request_attempt';
  if v_t <> 'attempted_at,user_id' then raise exception 'A: payment_request_attempt guarda mas que quien y cuando: %', v_t; end if;
  raise notice 'OK · A1 · dos tablas con RLS, CHECKs, hash unico, operacion unica, sin token en claro; el apunte solo quien y cuando';

  for r in select n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'api' and p.proname in ('create_payment_request', 'cancel_payment_request', 'preview_payment_request', 'record_internal_transfer', 'annul_operation'))
               or (n.nspname = 'sec' and p.proname in ('payment_request_state', 'lock_payment_request_cap', 'my_transfer_counterparts')) loop
    if r.name in ('api.record_internal_transfer', 'api.annul_operation') then
      if r.owner <> 'nomey_writer' then raise exception 'A: % es de %, no del writer', r.name, r.owner; end if;
    elsif r.owner <> 'nomey_provisioner' then
      raise exception 'A: % es de %, no del provisioner', r.name, r.owner;
    end if;
    if r.definer <> (r.name like 'api.%' or r.name = 'sec.my_transfer_counterparts') then
      raise exception 'A: % definer=% no es lo esperado', r.name, r.definer;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname in ('nomey_writer', 'nomey_provisioner') and rolbypassrls) then
    raise exception 'A: un rol de Nomey tiene BYPASSRLS';
  end if;
  raise notice 'OK · A2 · propietarios: provisioner la solicitud, writer lo contable; sin BYPASSRLS';

  foreach v_t in array array['api.create_payment_request(jsonb)', 'api.cancel_payment_request(jsonb)', 'api.preview_payment_request(text)', 'api.record_internal_transfer(jsonb)'] loop
    if not has_function_privilege('authenticated', v_t, 'execute') then raise exception 'A: authenticated no ejecuta %', v_t; end if;
    if has_function_privilege('anon', v_t, 'execute') or has_function_privilege('public', v_t, 'execute') then raise exception 'A: anon o public ejecutan %', v_t; end if;
  end loop;
  -- el hash lo calculan provisioner y writer; el cliente no
  if has_function_privilege('authenticated', 'sec.invitation_hash(text)', 'execute') or not has_function_privilege('nomey_writer', 'sec.invitation_hash(text)', 'execute')
     or not has_function_privilege('nomey_provisioner', 'sec.invitation_hash(text)', 'execute') then
    raise exception 'A: EXECUTE de sec.invitation_hash no es exactamente provisioner + writer';
  end if;
  if has_function_privilege('authenticated', 'sec.new_invitation_token()', 'execute') or has_function_privilege('nomey_writer', 'sec.new_invitation_token()', 'execute') then
    raise exception 'A: alguien mas que el provisioner genera tokens';
  end if;
  if has_function_privilege('authenticated', 'sec.lock_payment_request_cap(uuid)', 'execute') then raise exception 'A: el cliente ejecuta el cerrojo del tope'; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and has_function_privilege('supabase_auth_admin', p.oid, 'execute');
  if v_n <> 1 then raise exception 'A: supabase_auth_admin ejecuta % funciones de sec y debe ser 1', v_n; end if;
  raise notice 'OK · A3 · EXECUTE: cliente solo api; hash provisioner + writer; token solo provisioner';

  if exists (select 1 from information_schema.column_privileges where table_schema = 'core' and table_name = 'payment_request'
              and grantee = 'authenticated' and column_name in ('token_hash', 'created_by', 'paid_by')) then
    raise exception 'A: authenticated puede leer token_hash, created_by o paid_by de core.payment_request';
  end if;
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.column_privileges
   where table_schema = 'core' and table_name = 'payment_request' and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_t <> 'paid_at,paid_by,paid_operation_id' then raise exception 'A: el writer actualiza % de la solicitud', v_t; end if;
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.column_privileges
   where table_schema = 'core' and table_name = 'payment_request' and grantee = 'nomey_provisioner' and privilege_type = 'UPDATE';
  if v_t <> 'cancelled_at' then raise exception 'A: el provisioner actualiza % de la solicitud', v_t; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'payment_request'
              and grantee in ('authenticated', 'nomey_provisioner', 'nomey_writer') and privilege_type = 'DELETE') then
    raise exception 'A: alguien puede borrar solicitudes';
  end if;
  raise notice 'OK · A4 · columnas: el cliente sin hash ni uid; writer solo paid_*; provisioner solo cancelled_at; nadie borra';

  for v_t in select unnest(array['operation', 'operation_version', 'client_command', 'effect']) loop
    if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = v_t and roles = '{nomey_writer}' and cmd = 'INSERT'
                    and with_check ilike '%created_by = sec.request_actor_id()%') then
      raise exception 'A: la policy de INSERT del writer sobre core.% ya no exige created_by = actor', v_t;
    end if;
  end loop;
  for v_t in select unnest(array['my_payment_requests', 'my_transfers', 'my_transfer_proposals']) loop
    if pg_get_viewdef(('api.' || v_t)::regclass) ilike '%created_by%' then raise exception 'A: api.% deriva algo de created_by', v_t; end if;
    if not exists (select 1 from pg_class where oid = ('api.' || v_t)::regclass and reloptions @> array['security_invoker=true']) then
      raise exception 'A: api.% no es security_invoker', v_t;
    end if;
  end loop;
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'my_payment_requests';
  if v_t <> 'request_id,amount,currency_definition_id,concept,created_at,expires_at,state,paid_at,paid_operation_id,payer_handle,payer_public_name' then
    raise exception 'A: columnas de api.my_payment_requests: %', v_t;
  end if;
  select string_agg(column_name, ',' order by ordinal_position) into v_t from information_schema.columns where table_schema = 'api' and table_name = 'my_transfers';
  -- F12.B3 (20260928120000) anadio group_scope_id y group_transfer_proposal_id al final.
  if v_t <> 'operation_id,scope_id,currency_definition_id,balance_amount,direction,amount,effective_date,effective_time,concept,counterpart_handle,counterpart_public_name,proposal_id,operation_created_at,payment_request_id,group_scope_id,group_transfer_proposal_id' then
    raise exception 'A: columnas de api.my_transfers: %', v_t;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname like 'record\_%';
  -- F12/ADR-007 (F12.C3): DIEZ desde que la transferencia de grupo de una
  -- voluntad se separó de `settlement_by_transfer` en su propia clase. La
  -- undécima tendrá que justificarse igual que se justificó ésta.
  if v_n <> 10 then raise exception 'A: hay % api.record_* y deben seguir siendo 10', v_n; end if;
  raise notice 'OK · A5 · policies created_by = actor intactas; vistas invoker sin created_by y con sus columnas exactas; nueve record_*';
end
$a$;

-- ═══════════════════════ B · crear ════════════════════════════════════════════
do $b$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); dan constant uuid := (select dan from fx);
  eva constant uuid := (select eva from fx); inv constant uuid := (select inv from fx);
  usd constant uuid := (select usd from fx); pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx);
  v_r uuid; v_tok text; i integer;
begin
  -- B1 · crear: nada contable; el token, una vez; solo el hash en la base
  perform pg_temp.espera('B1 crear', pg_temp.crear(bea, pg_temp.k(1), '2500', null, '  Cena  '), 'ok');
  v_r := pg_temp.rid(pg_temp.k(1)); v_tok := pg_temp.t(pg_temp.k(1));
  if v_r is null or v_tok is null then raise exception 'B1: sin request_id o sin token'; end if;
  perform pg_temp.espera('B1 estado', pg_temp.estado(v_r), 'pending');
  if (select concept from core.payment_request where id = v_r) <> 'Cena' then raise exception 'B1: el concepto no se canonicalizo'; end if;
  if (select expires_at - created_at from core.payment_request where id = v_r) <> interval '7 days' then raise exception 'B1: la caducidad no es de 7 dias'; end if;
  if pg_temp.ops() <> 0 or pg_temp.saldo(pa) <> 0 or pg_temp.saldo(pb) <> 0 then raise exception 'B1: crear toco la contabilidad'; end if;
  if exists (select 1 from core.effect) or exists (select 1 from core.balance_observation) then raise exception 'B1: crear escribio efectos u observaciones'; end if;
  if v_tok !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'B1: el token no es base64url de 43 chars: %', v_tok; end if;
  if (select token_hash from core.payment_request where id = v_r) <> sec.invitation_hash(v_tok) then raise exception 'B1: el hash no es sha256(token)'; end if;
  if exists (select 1 from core.payment_request where token_hash = convert_to(v_tok, 'utf8') or position(convert_to(v_tok, 'utf8') in token_hash) > 0) then
    raise exception 'B1: el token en claro esta en la base';
  end if;
  if (select count(*) from core.provisioning_command where command_type = 'payment_request.create' and canonical_intent::text like '%' || v_tok || '%') <> 0 then
    raise exception 'B1: el token en claro esta en la intencion canonica';
  end if;
  raise notice 'OK · B1 · crear persiste la solicitud (concepto canonico, 7 dias, sha256 del token) sin tocar contabilidad; el token es base64url de 256 bits y no esta en claro en ninguna parte';

  -- B2 · replay: misma solicitud, token null; clave con otra intencion
  perform pg_temp.espera('B2 replay', pg_temp.crear(bea, pg_temp.k(1), '2500', null, 'Cena'), 'replay:null');
  perform pg_temp.espera('B2 otra intencion', pg_temp.crear(bea, pg_temp.k(1), '2600', null, 'Cena'), 'IDEMPOTENCY_KEY_REUSED');
  if (select count(*) from core.payment_request where created_by = bea) <> 1 then raise exception 'B2: el replay creo otra solicitud'; end if;
  raise notice 'OK · B2 · el replay devuelve la misma solicitud con token null; la clave con otra intencion es IDEMPOTENCY_KEY_REUSED';

  -- B3 · forma y creador
  perform pg_temp.espera('B3 negativo', pg_temp.crear(bea, pg_temp.k(2), '-5'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B3 cero', pg_temp.crear(bea, pg_temp.k(2), '0'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('B3 anonimo', pg_temp.crear(inv, pg_temp.k(2), '100', null, null, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B3 sin handle', pg_temp.crear(dan, pg_temp.k(2), '100'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('B3 sin Personal', pg_temp.crear(eva, pg_temp.k(2), '100'), 'NOT_AUTHORIZED');
  perform pg_temp.espera('B3 otra moneda', pg_temp.crear(bea, pg_temp.k(2), '100', usd), 'CURRENCY_CONVERSION_UNSUPPORTED');
  begin
    perform pg_temp.actor(bea);
    perform api.create_payment_request(jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'amount', 100, 'currency_definition_id', (select eur from fx)));
    raise exception 'B3: se acepto el importe como number JSON';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PAYLOAD_INVALID' then raise exception 'B3: importe number dio %', sqlerrm::json ->> 'code'; end if;
  end;
  begin
    perform pg_temp.actor(bea);
    perform api.create_payment_request(jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'amount', '100', 'currency_definition_id', (select eur from fx), 'handle', 'ana_pr'));
    raise exception 'B3: se acepto un destinatario';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    if (sqlerrm::json ->> 'code') <> 'PAYLOAD_INVALID' then raise exception 'B3: destinatario dio %', sqlerrm::json ->> 'code'; end if;
  end;
  if (select count(*) from core.payment_request) <> 1 or (select count(*) from core.provisioning_command where command_type = 'payment_request.create') <> 1 then
    raise exception 'B3: un rechazo dejo una solicitud o un comando';
  end if;
  raise notice 'OK · B3 · forma y creador: no positivo, number y destinatario → PAYLOAD_INVALID; anonimo y sin Personal → NOT_AUTHORIZED; sin handle → USERNAME_REQUIRED; otra moneda → CURRENCY_CONVERSION_UNSUPPORTED; nada persiste';

  -- B4 · tope de 20 pendientes propias; cancelar, caducar o pagar libera hueco
  for i in 2 .. 20 loop
    perform pg_temp.espera('B4 crear ' || i, pg_temp.crear(bea, pg_temp.k(100 + i), i::text), 'ok');
  end loop;
  perform pg_temp.espera('B4 veinte pendientes', pg_temp.pendientes(bea)::text, '20');
  perform pg_temp.espera('B4 la 21.a', pg_temp.crear(bea, pg_temp.k(121), '21'), 'PAYMENT_REQUEST_LIMIT');
  perform pg_temp.espera('B4 cancelar una', pg_temp.cancelar(bea, pg_temp.rid(pg_temp.k(102))), 'cancelled');
  perform pg_temp.espera('B4 vuelve a caber', pg_temp.crear(bea, pg_temp.k(121), '21'), 'ok');
  perform pg_temp.espera('B4 y otra vez no', pg_temp.crear(bea, pg_temp.k(122), '22'), 'PAYMENT_REQUEST_LIMIT');
  update core.payment_request set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where id = pg_temp.rid(pg_temp.k(103));
  perform pg_temp.espera('B4 caducada libera', pg_temp.crear(bea, pg_temp.k(122), '22'), 'ok');
  perform pg_temp.espera('B4 pagar una libera', pg_temp.pagar(ana, pg_temp.k(123), pg_temp.t(pg_temp.k(104))), 'ok');
  perform pg_temp.espera('B4 tras pagar cabe otra', pg_temp.crear(bea, pg_temp.k(124), '24'), 'ok');
  perform pg_temp.espera('B4 otro creador no comparte el tope', pg_temp.crear(ana, pg_temp.k(125), '25'), 'ok');
  -- lo rehusado no dejo comando ni solicitud
  if (select count(*) from core.provisioning_command where command_type = 'payment_request.create' and created_by = bea) <> 23 then
    raise exception 'B4: comandos de Bea: %', (select count(*) from core.provisioning_command where command_type = 'payment_request.create' and created_by = bea);
  end if;
  raise notice 'OK · B4 · 20 pendientes propias; la 21.a PAYMENT_REQUEST_LIMIT; cancelar, caducar y pagar liberan hueco; el tope es por creador';
end
$b$;

-- ═══════════════════════ C · previsualizar ════════════════════════════════════
do $c$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  v_tok text; i integer;
begin
  v_tok := pg_temp.t(pg_temp.k(1));  -- Bea, 2500, Cena, pending
  perform pg_temp.espera('C1 ok', pg_temp.ver(ana, v_tok), 'ok|2500|Cena|bea_pr|Bea');
  perform pg_temp.espera('C1 own', pg_temp.ver(bea, v_tok), 'own|2500|Cena|bea_pr|Bea');
  perform pg_temp.espera('C1 quien sea con sesion normal', pg_temp.ver(nadie, v_tok), 'ok|2500|Cena|bea_pr|Bea');
  perform pg_temp.espera('C1 invalido', pg_temp.ver(ana, 'no-es-un-token'), 'invalid');
  perform pg_temp.espera('C1 invalido con forma', pg_temp.ver(ana, repeat('A', 43)), 'invalid');
  perform pg_temp.espera('C1 nulo', pg_temp.ver(ana, null), 'invalid');
  perform pg_temp.espera('C1 pagada', pg_temp.ver(ana, pg_temp.t(pg_temp.k(104))), 'paid');
  perform pg_temp.espera('C1 cancelada', pg_temp.ver(ana, pg_temp.t(pg_temp.k(102))), 'cancelled');
  perform pg_temp.espera('C1 caducada', pg_temp.ver(ana, pg_temp.t(pg_temp.k(103))), 'expired');
  perform pg_temp.espera('C1 anonimo', pg_temp.ver(inv, v_tok, true), 'NOT_AUTHORIZED');
  -- exactamente las claves publicadas en ok
  perform pg_temp.actor(ana);
  if (select string_agg(k, ',' order by k) from jsonb_object_keys(api.preview_payment_request(v_tok)) k)
     <> 'amount,concept,creator_handle,creator_public_name,currency_definition_id,state' then
    raise exception 'C1: la previsualizacion publica otras claves';
  end if;
  perform pg_temp.super();
  -- solo los invalid apuntaron: Ana 3
  perform pg_temp.espera('C1 apuntes de Ana', pg_temp.intentos(ana)::text, '3');
  perform pg_temp.espera('C1 apuntes de Bea', pg_temp.intentos(bea)::text, '0');
  perform pg_temp.espera('C1 apuntes de nadie', pg_temp.intentos(nadie)::text, '0');
  raise notice 'OK · C1 · siete estados; ok/own publican exactamente amount, currency, concept e identidad del creador; solo invalid apunta';

  -- C2 · freno: 20 invalid / 10 min; throttled no apunta; ok tampoco; pasada la ventana vuelve
  for i in 4 .. 20 loop
    perform pg_temp.espera('C2 invalid ' || i, pg_temp.ver(ana, 'x' || i), 'invalid');
  end loop;
  perform pg_temp.espera('C2 = 20', pg_temp.intentos(ana)::text, '20');
  perform pg_temp.espera('C2 la 21.a', pg_temp.ver(ana, 'x21'), 'throttled');
  perform pg_temp.espera('C2 frenada tambien con token valido', pg_temp.ver(ana, v_tok), 'throttled');
  perform pg_temp.espera('C2 throttled no apunta', pg_temp.intentos(ana)::text, '20');
  update core.payment_request_attempt set attempted_at = now() - interval '11 minutes' where user_id = ana;
  perform pg_temp.espera('C2 pasada la ventana', pg_temp.ver(ana, v_tok), 'ok|2500|Cena|bea_pr|Bea');
  perform pg_temp.espera('C2 ok no apunta', pg_temp.intentos(ana)::text, '20');
  -- el freno es por cuenta: Cris sigue libre
  perform pg_temp.espera('C2 otra cuenta', pg_temp.ver(cris, v_tok), 'ok|2500|Cena|bea_pr|Bea');
  raise notice 'OK · C2 · 20 invalid / 10 min → throttled (sin apuntar, aunque el token sea valido); ok no apunta; por cuenta; la ventana envejece';

  -- C3 · el creador cambia de username: el enlace sigue siendo suyo y enseña el nuevo
  perform pg_temp.actor(bea);
  perform api.change_username('{"handle":"bea_nueva"}'::jsonb);
  perform pg_temp.super();
  perform pg_temp.espera('C3 handle nuevo', pg_temp.ver(cris, v_tok), 'ok|2500|Cena|bea_nueva|Bea');
  raise notice 'OK · C3 · la solicitud apunta a un uid: tras cambiar de username, el enlace enseña el handle nuevo';
end
$c$;

-- ═══════════════════════ D · pagar ════════════════════════════════════════════
do $d$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  dan constant uuid := (select dan from fx); fer constant uuid := (select fer from fx); inv constant uuid := (select inv from fx);
  pa constant uuid := (select pa from fx); pb constant uuid := (select pb from fx); pc constant uuid := (select pc from fx);
  v_tok text; v_r uuid; v_op uuid; v_ver uuid; v_n integer; v_txt text; v_bal_a bigint; v_bal_b bigint; v_prop uuid; v_env jsonb;
begin
  v_tok := pg_temp.t(pg_temp.k(1)); v_r := pg_temp.rid(pg_temp.k(1));  -- Bea, 2500, Cena
  -- D1 · quien no paga: el creador (sin clave), anonimo, sin handle, sin Personal? (no hay: todo Personal existe), tercero SI (portador)
  -- La autorizacion va ANTES del token: quien todavia no puede pagar recibe
  -- la misma respuesta con el bearer valido, con forma pero inexistente, o
  -- sin forma. Solo una cuenta elegible llega a resolverlo (E, F).
  perform pg_temp.espera('D1 A · anonimo + token valido', pg_temp.pagar(inv, pg_temp.k(201), v_tok, '{}'::jsonb, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D1 B · anonimo + token inexistente', pg_temp.pagar(inv, pg_temp.k(201), repeat('B', 43), '{}'::jsonb, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D1 B · anonimo + token sin forma', pg_temp.pagar(inv, pg_temp.k(201), 'no-token', '{}'::jsonb, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D1 C · sin handle + token valido', pg_temp.pagar(dan, pg_temp.k(201), v_tok), 'USERNAME_REQUIRED');
  perform pg_temp.espera('D1 D · sin handle + token inexistente', pg_temp.pagar(dan, pg_temp.k(201), repeat('B', 43)), 'USERNAME_REQUIRED');
  perform pg_temp.espera('D1 D · sin handle + token sin forma', pg_temp.pagar(dan, pg_temp.k(201), 'no-token'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('D1 E · elegible + token sin forma', pg_temp.pagar(ana, pg_temp.k(201), 'no-token'), 'PAYMENT_REQUEST_INVALID');
  perform pg_temp.espera('D1 E · elegible + token con forma pero inexistente', pg_temp.pagar(ana, pg_temp.k(201), repeat('B', 43)), 'PAYMENT_REQUEST_INVALID');
  perform pg_temp.espera('D1 F · elegible + solicitud propia', pg_temp.pagar(bea, pg_temp.k(201), v_tok), 'PAYMENT_REQUEST_OWN');
  perform pg_temp.espera('D1 F · el creador sin forma tampoco distingue de un elegible', pg_temp.pagar(bea, pg_temp.k(201), 'no-token'), 'PAYMENT_REQUEST_INVALID');
  perform pg_temp.espera('D1 XOR: los dos', pg_temp.pagar(ana, pg_temp.k(201), v_tok, jsonb_build_object('proposal_id', gen_random_uuid())), 'PAYLOAD_INVALID');
  perform pg_temp.espera('D1 XOR: ninguno', pg_temp.pagar(ana, pg_temp.k(201), null), 'PAYLOAD_INVALID');
  perform pg_temp.espera('D1 payload de F3', pg_temp.pagar(ana, pg_temp.k(201), v_tok, jsonb_build_object('amount', '2500')), 'PAYLOAD_INVALID');
  perform pg_temp.espera('D1 Fer en USD', pg_temp.pagar(fer, pg_temp.k(201), v_tok), 'CURRENCY_CONVERSION_UNSUPPORTED');
  if exists (select 1 from core.client_command where client_operation_id = pg_temp.k(201)) then raise exception 'D1: un rechazo dejo clave reclamada'; end if;
  perform pg_temp.espera('D1 sigue pending', pg_temp.estado(v_r), 'pending');
  perform pg_temp.espera('D1 una operacion (la de B4)', pg_temp.ops()::text, '1');
  raise notice 'OK · D1 · la autorizacion va antes del token (anonimo y sin handle responden igual con bearer valido o invalido); elegible: INVALID u OWN; XOR, payload de F3 y bases distintas: sin escribir';

  -- D2 · Ana paga: -2500 en PA, +2500 en PB; partes; autoria; paid_by; fecha; una version; replay; segunda clave
  v_bal_a := pg_temp.saldo(pa); v_bal_b := pg_temp.saldo(pb);
  perform pg_temp.espera('D2 pagar', pg_temp.pagar(ana, pg_temp.k(202), v_tok), 'ok');
  v_op := pg_temp.op_de(v_r);
  if v_op is null then raise exception 'D2: la solicitud no quedo ligada'; end if;
  perform pg_temp.espera('D2 estado', pg_temp.estado(v_r), 'paid');
  perform pg_temp.espera('D2 saldo A', (pg_temp.saldo(pa) - v_bal_a)::text, '-2500');
  perform pg_temp.espera('D2 saldo B', (pg_temp.saldo(pb) - v_bal_b)::text, '2500');
  select o.current_version_id into v_ver from core.operation o where o.id = v_op;
  select count(*) into v_n from core.effect e where e.operation_version_id = v_ver;
  if v_n <> 2 then raise exception 'D2: % efectos y deben ser 2', v_n; end if;
  if exists (select 1 from core.effect e where e.operation_version_id = v_ver and (e.economic_amount is not null or e.debt_amount is not null or e.accounting_class <> 'transfer')) then
    raise exception 'D2: la transferencia produjo dimension economica o de deuda';
  end if;
  select from_scope_id::text || '>' || to_scope_id::text into v_txt from core.transfer_part where operation_version_id = v_ver;
  perform pg_temp.espera('D2 partes from = pagador, to = creador', v_txt, pa::text || '>' || pb::text);
  -- los cuatro coinciden: paid_by, dueno de from, operation.created_by, operation_version.created_by
  if not (select r.paid_by = ana and o.created_by = r.paid_by and ov.created_by = r.paid_by and s.owner_user_id = r.paid_by
            from core.payment_request r join core.operation o on o.id = r.paid_operation_id join core.operation_version ov on ov.id = o.current_version_id
            join core.transfer_part tp on tp.operation_version_id = ov.id join core.scope s on s.id = tp.from_scope_id where r.id = v_r) then
    raise exception 'D2: paid_by, dueno de from_scope, operation.created_by y operation_version.created_by no coinciden en el pagador';
  end if;
  if (select paid_at from core.payment_request where id = v_r) is null then raise exception 'D2: sin paid_at'; end if;
  if (select effective_date from core.operation_version where id = v_ver) <> current_date or (select effective_time from core.operation_version where id = v_ver) is null then
    raise exception 'D2: la fecha u hora efectivas no son las del servidor';
  end if;
  if (select original_amount || '|' || original_currency_definition_id::text || '|' || version_kind || '|' || version_no from core.operation_version where id = v_ver)
     <> '2500|' || (select eur from fx)::text || '|record|1' then
    raise exception 'D2: la version no reproduce la solicitud';
  end if;
  if exists (select 1 from core.movement_detail where operation_version_id = v_ver) then raise exception 'D2: la version lleva concepto'; end if;
  select count(*) into v_n from core.balance_observation where operation_version_id = v_ver;
  if v_n <> 2 then raise exception 'D2: % observaciones y deben ser 2', v_n; end if;
  perform pg_temp.espera('D2 replay', pg_temp.pagar(ana, pg_temp.k(202), v_tok), 'replay');
  perform pg_temp.espera('D2 segunda clave del mismo pagador', pg_temp.pagar(ana, pg_temp.k(203), v_tok), 'PAYMENT_REQUEST_ALREADY_PAID');
  perform pg_temp.espera('D2 otro portador', pg_temp.pagar(cris, pg_temp.k(204), v_tok), 'PAYMENT_REQUEST_ALREADY_PAID');
  perform pg_temp.espera('D2 dos operaciones', pg_temp.ops()::text, '2');
  perform pg_temp.espera('D2 el creador tampoco ahora', pg_temp.pagar(bea, pg_temp.k(205), v_tok), 'PAYMENT_REQUEST_OWN');
  raise notice 'OK · D2 · pagar: -N/+N, dos efectos transfer, partes pagador → creador, paid_by = created_by = dueno de from, fecha del servidor, una version, replay, ALREADY_PAID para cualquier otra clave o portador';

  -- D3 · cancelada y caducada: su codigo sin escribir ni reclamar clave
  perform pg_temp.espera('D3 cancelada', pg_temp.pagar(ana, pg_temp.k(206), pg_temp.t(pg_temp.k(102))), 'PAYMENT_REQUEST_CANCELLED');
  perform pg_temp.espera('D3 caducada', pg_temp.pagar(ana, pg_temp.k(207), pg_temp.t(pg_temp.k(103))), 'PAYMENT_REQUEST_EXPIRED');
  if exists (select 1 from core.client_command where client_operation_id in (pg_temp.k(206), pg_temp.k(207))) then raise exception 'D3: un rechazo dejo su clave'; end if;
  perform pg_temp.espera('D3 sigue dos operaciones', pg_temp.ops()::text, '2');
  raise notice 'OK · D3 · cancelada y caducada no se pagan: su codigo y ninguna escritura';

  -- D4 · en negativo se ejecuta: Cris (saldo 0) paga una de Bea
  perform pg_temp.espera('D4 en negativo', pg_temp.pagar(cris, pg_temp.k(208), pg_temp.t(pg_temp.k(105))), 'ok');
  perform pg_temp.espera('D4 saldo C', pg_temp.saldo(pc)::text, '-5');
  raise notice 'OK · D4 · sin validacion de fondos: el Disponible del pagador queda en negativo';

  -- D5 · la via de B1 sigue intacta: propuesta Ana → Cris aceptada por Cris
  perform pg_temp.actor(ana);
  v_env := api.create_transfer_proposal(jsonb_build_object('client_command_id', pg_temp.k(209), 'command_contract_version', 1, 'handle', 'cris_pr', 'amount', '700', 'currency_definition_id', (select eur from fx), 'concept', 'Propuesta'));
  perform pg_temp.super();
  v_prop := (v_env ->> 'proposal_id')::uuid;
  perform pg_temp.espera('D5 aceptar la propuesta', pg_temp.pagar(cris, pg_temp.k(210), null, jsonb_build_object('proposal_id', v_prop)), 'ok');
  if (select accepted_operation_id from core.transfer_proposal where id = v_prop) is null then raise exception 'D5: la propuesta no quedo aceptada'; end if;
  perform pg_temp.espera('D5 saldo C', pg_temp.saldo(pc)::text, '695');
  raise notice 'OK · D5 · la via de B1 (proposal_id) sigue funcionando en la misma funcion';
end
$d$;

-- ═══════════════════════ E · cancelar ═════════════════════════════════════════
do $e$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); inv constant uuid := (select inv from fx); nadie constant uuid := (select nadie from fx);
  v_r uuid;
begin
  v_r := pg_temp.rid(pg_temp.k(106));  -- Bea, 6, pending
  perform pg_temp.espera('E1 tercero', pg_temp.cancelar(ana, v_r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 nadie', pg_temp.cancelar(nadie, v_r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 anonimo', pg_temp.cancelar(inv, v_r, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 inexistente', pg_temp.cancelar(bea, gen_random_uuid()), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 sigue pending', pg_temp.estado(v_r), 'pending');
  perform pg_temp.espera('E1 el creador cancela', pg_temp.cancelar(bea, v_r), 'cancelled');
  perform pg_temp.espera('E1 otra vez: idempotente', pg_temp.cancelar(bea, v_r), 'cancelled/replay');
  perform pg_temp.espera('E1 cancelar una caducada', pg_temp.cancelar(bea, pg_temp.rid(pg_temp.k(103))), 'expired/replay');
  perform pg_temp.espera('E1 cancelar una pagada', pg_temp.cancelar(bea, pg_temp.rid(pg_temp.k(1))), 'PAYMENT_REQUEST_ALREADY_PAID');
  perform pg_temp.espera('E1 pagar la cancelada', pg_temp.pagar(ana, pg_temp.k(301), pg_temp.t(pg_temp.k(106))), 'PAYMENT_REQUEST_CANCELLED');
  if exists (select 1 from core.payment_request where (paid_at is not null)::int + (cancelled_at is not null)::int > 1) then
    raise exception 'E1: una solicitud lleva dos marcas terminales';
  end if;
  raise notice 'OK · E · cancelar es solo del creador; cancelled y expired responden su estado sin escribir; paid es ALREADY_PAID; ninguna terminal vuelve a pending';
end
$e$;

-- ═══════════════════════ F · irreversibilidad ═════════════════════════════════
do $f$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  v_r uuid; v_op uuid; v_ver uuid; v_n integer;
begin
  v_r := pg_temp.rid(pg_temp.k(1)); v_op := pg_temp.op_de(v_r);
  select current_version_id into v_ver from core.operation where id = v_op;
  perform pg_temp.espera('F1 corregir', pg_temp.pagar(ana, pg_temp.k(401), pg_temp.t(pg_temp.k(1)), jsonb_build_object('operation_id', v_op, 'expected_version_id', v_ver)), 'TRANSFER_NOT_EDITABLE');
  if exists (select 1 from core.client_command where client_operation_id = pg_temp.k(401)) then raise exception 'F1: la correccion reclamo la clave'; end if;
  perform pg_temp.espera('F2 anula el pagador', pg_temp.anular(ana, pg_temp.k(402), v_op), 'OPERATION_NOT_ANNULLABLE');
  perform pg_temp.espera('F2 anula el creador', pg_temp.anular(bea, pg_temp.k(403), v_op), 'OPERATION_NOT_ANNULLABLE');
  perform pg_temp.espera('F2 anula un tercero', pg_temp.anular(cris, pg_temp.k(404), v_op), 'OPERATION_NOT_ANNULLABLE');
  select count(*) into v_n from core.operation_version where operation_id = v_op;
  if v_n <> 1 then raise exception 'F2: la transferencia tiene % versiones', v_n; end if;
  -- una devolucion posterior (Bea solicita a Ana... al reves: Ana crea una solicitud y Bea la paga) no reabre nada
  perform pg_temp.espera('F3 Ana solicita la devolucion', pg_temp.crear(ana, pg_temp.k(405), '2500', null, 'Devolucion cena'), 'ok');
  perform pg_temp.espera('F3 Bea paga', pg_temp.pagar(bea, pg_temp.k(406), pg_temp.t(pg_temp.k(405))), 'ok');
  perform pg_temp.espera('F3 la primera sigue paid', pg_temp.estado(v_r), 'paid');
  perform pg_temp.espera('F3 el enlace responde paid', pg_temp.ver(cris, pg_temp.t(pg_temp.k(1))), 'paid');
  perform pg_temp.espera('F3 saldo A vuelve', pg_temp.saldo((select pa from fx))::text, '-704');  -- -4 (B4 k104) -2500 (D2) -700 (D5, propuesta) +2500 (devolucion)
  raise notice 'OK · F · una internal_transfer pagada tiene una version: corregir TRANSFER_NOT_EDITABLE, anular OPERATION_NOT_ANNULLABLE; la devolucion es otra solicitud y la primera sigue paid';
end
$f$;

-- ═══════════════════════ G · vistas ═══════════════════════════════════════════
do $g$
declare
  ana constant uuid := (select ana from fx); bea constant uuid := (select bea from fx); cris constant uuid := (select cris from fx);
  nadie constant uuid := (select nadie from fx); pa constant uuid := (select pa from fx);
  v_txt text; v_n integer; v_bal text;
begin
  -- G1 · my_payment_requests: solo las propias, con estado y pagador actual
  v_txt := pg_temp.vista_solicitudes(bea);
  if v_txt not like '%paid:2500:Cena:ana_pr%' then raise exception 'G1: Bea no ve su pagada con el pagador: %', v_txt; end if;
  if v_txt not like '%cancelled:2:-:-%' or v_txt not like '%expired:3:-:-%' or v_txt not like '%paid:4:-:ana_pr%' or v_txt not like '%paid:5:-:cris_pr%' then
    raise exception 'G1: Bea no ve cancelada, caducada y pagadas: %', v_txt;
  end if;
  if v_txt like '%bea_%' then raise exception 'G1: Bea se ve a si misma como pagadora: %', v_txt; end if;
  perform pg_temp.espera('G1 Ana: la suya (pagada por Bea)', pg_temp.vista_solicitudes(ana), 'pending:25:-:-;paid:2500:Devolucion cena:bea_nueva');
  perform pg_temp.espera('G1 Cris: ninguna', pg_temp.vista_solicitudes(cris), '-');
  perform pg_temp.espera('G1 tercero: ninguna', pg_temp.vista_solicitudes(nadie), '-');
  -- el pagador cambia de username: la fila del creador enseña el nuevo
  perform pg_temp.actor(ana);
  perform api.change_username('{"handle":"ana_nueva"}'::jsonb);
  perform pg_temp.super();
  v_txt := pg_temp.vista_solicitudes(bea);
  if v_txt not like '%paid:2500:Cena:ana_nueva%' or v_txt like '%ana_pr%' then raise exception 'G1: el handle del pagador no es el actual: %', v_txt; end if;
  raise notice 'OK · G1 · my_payment_requests: solo las propias, estado derivado, pagador como identidad ACTUAL; ni token ni uid';

  -- G2 · my_transfers en los dos Personales: direccion desde las partes, concepto y contraparte desde la solicitud
  perform pg_temp.espera('G2 Ana', pg_temp.vista_transferencias(ana),
    'outgoing:bea_nueva:-2500:Cena:req;outgoing:cris_pr:-700:Propuesta:prop;outgoing:bea_nueva:-4:-:req;incoming:bea_nueva:2500:Devolucion cena:req');
  perform pg_temp.espera('G2 Bea', pg_temp.vista_transferencias(bea),
    'outgoing:ana_nueva:-2500:Devolucion cena:req;incoming:ana_nueva:4:-:req;incoming:cris_pr:5:-:req;incoming:ana_nueva:2500:Cena:req');
  perform pg_temp.espera('G2 Cris (solicitud y propuesta)', pg_temp.vista_transferencias(cris), 'outgoing:bea_nueva:-5:-:req;incoming:ana_nueva:700:Propuesta:prop');
  perform pg_temp.espera('G2 tercero', pg_temp.vista_transferencias(nadie), '-');
  -- la direccion sale de las partes: cada fila propia coincide con el signo del efecto y con from/to
  perform pg_temp.actor(ana);
  create temp table g2 as select operation_id, scope_id, direction, balance_amount::bigint as bal from api.my_transfers;
  perform pg_temp.super();
  select count(*) into v_n from g2 t
   where t.scope_id <> pa or (t.direction = 'outgoing') <> (t.bal < 0)
      or t.direction <> (select case when tp.from_scope_id = t.scope_id then 'outgoing' else 'incoming' end
                           from core.transfer_part tp join core.operation o on o.current_version_id = tp.operation_version_id where o.id = t.operation_id);
  if v_n <> 0 then raise exception 'G2: la direccion no sale de las partes o hay un ambito ajeno'; end if;
  perform pg_temp.actor(ana);
  select count(*) into v_n from api.personal_operation where operation_class = 'internal_transfer';
  select balance_amount into v_bal from api.personal_balance;
  perform pg_temp.super();
  if v_n <> 0 then raise exception 'G2: personal_operation lista internal_transfer'; end if;
  perform pg_temp.espera('G2 Disponible de Ana', v_bal, '-704');
  raise notice 'OK · G2 · my_transfers: direccion desde core.transfer_part, concepto y contraparte de la solicitud o la propuesta, solo el ambito propio; personal_balance la suma';
end
$g$;

-- ═══════════════════════ H · el cliente no alcanza core ═══════════════════════
do $h$
begin
  perform pg_temp.actor((select ana from fx));
  begin
    perform count(*) from core.payment_request;
    raise exception 'H: authenticated lee core.payment_request directamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from core.payment_request_attempt;
    raise exception 'H: authenticated lee core.payment_request_attempt';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sec.invitation_hash('x');
    raise exception 'H: authenticated calcula el hash';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · H · el cliente no llega a core ni al hash';
end
$h$;

rollback;
