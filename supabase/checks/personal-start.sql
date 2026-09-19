-- ============================================================================
-- PUNTO DE INICIO DEL MODO PERSONAL TRAS EL INVITADO (F10/ADR-005) · contra
-- las funciones reales, aislado
-- ============================================================================
--
-- api.ensure_personal_scope / api.start_personal_scope (migracion
-- 20260919120000) llamadas como cada cuenta —con y sin el claim is_anonymous—,
-- y las lecturas del Personal leidas como su dueño. Las ayudas de
-- lib/group-payment-helpers.sql solo leen y envuelven. Todo en rollback.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/personal-start.sql; } | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
-- Dentro de UNA transaccion now() no avanza: started_at y created_at de todo
-- lo escrito aqui coinciden, y «en o despues del corte» cuenta. Lo ANTERIOR al
-- corte se fija como fixture, como postgres, retrasando created_at de las
-- operaciones que hacen de historia (una hora); es el unico dato que este
-- check escribe a mano sobre lo que producen las funciones.
--
--   A · estructura: la marca, la decision insert-only, el predicado, un solo
--       escritor, ningun update/delete
--   B · provisioning: la marca nace del claim; needs_start_decision solo con
--       marca, sin decision y con historia
--   C · include: identidad exacta con lo de antes; idempotente por clave y por
--       estado; no se vuelve a decidir; una cuenta sin marca no decide
--   D · fresh: saldo 0, sin historial, sin estadisticas, sin cuotas; la deuda
--       sigue; la atribucion no cambia; derive_balance = personal_balance
--   E · despues del corte: pago de una deuda anterior, gasto nuevo,
--       correccion y anulacion de operaciones anteriores (siguen fuera;
--       Grupos cambia), ajuste por objetivo coherente con la cifra vista,
--       effective_date no manda
--   F · asociar despues del corte a un fantasma con historia anterior: esa
--       historia sigue fuera; la posterior entra
--   G · primer acceso sin historia: include automatico persistido; la
--       actividad posterior no reabre la pregunta; automatico con historia
--       se rehusa; fresh sin historia se rehusa; forma del payload
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a5000000-0000-4000-8000-0000000000a1'::uuid as inv,   -- nacio como invitado, con historia
  'a5000000-0000-4000-8000-0000000000b1'::uuid as bea,   -- cuenta normal
  'a5000000-0000-4000-8000-0000000000c1'::uuid as nadie, -- nacio como invitado, sin historia
  'a5000000-0000-4000-8000-0000000000d1'::uuid as nadie2,
  'a5000000-0000-4000-8000-000000000010'::uuid as g1,
  'a5000000-0000-4000-8000-000000000311'::uuid as p_inv,
  'a5000000-0000-4000-8000-000000000321'::uuid as p_ana,  -- fantasma
  'a5000000-0000-4000-8000-000000000331'::uuid as p_bea,
  null::uuid as cat, null::uuid as s_inv, null::uuid as s_bea, null::uuid as s_nadie, null::uuid as s_nadie2,
  null::uuid as e0, null::uuid as e1, null::uuid as e2, null::uuid as p1;
grant select, update on fx to authenticated;

-- Como p_user, con o sin el claim anonimo (lo que GoTrue pone en el JWT).
create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
-- ensure_personal_scope como p_user: 'guest=<t|f> modo=<include|fresh|-> needs=<t|f>'.
create function pg_temp.ambito(p_user uuid, p_anon boolean default false) returns text language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  v := api.ensure_personal_scope('{}'::jsonb);
  perform pg_temp.gp_super();
  return 'guest=' || (v ->> 'provisioned_as_guest') || ' modo=' || coalesce(v ->> 'start_mode', '-') || ' needs=' || (v ->> 'needs_start_decision');
end $$;
-- start_personal_scope como p_user: 'OK <modo>' / 'REPLAY <modo>' / codigo.
create function pg_temp.iniciar(p_user uuid, p_key uuid, p_mode text, p_auto boolean default false) returns text language plpgsql as $$
declare v jsonb; v_payload jsonb;
begin
  v_payload := jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'mode', p_mode);
  if p_auto then v_payload := v_payload || jsonb_build_object('automatic', true); end if;
  perform pg_temp.actor(p_user);
  v := api.start_personal_scope(v_payload);
  perform pg_temp.gp_super();
  return case when (v ->> 'already_processed')::boolean then 'REPLAY ' else 'OK ' end || (v ->> 'mode');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.gasto(p_who uuid, p_key uuid, p_payer uuid, p_parts uuid[], p_total bigint,
                              p_concept text default 'Gasto', p_op uuid default null, p_date date default current_date) returns text language plpgsql as $$
declare r fx%rowtype; v jsonb; v_payload jsonb;
begin
  select * into r from fx;
  v_payload := jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', r.g1, 'currency_definition_id', r.eur, 'total', p_total::text, 'effective_date', p_date::text,
    'concept', p_concept, 'category_id', r.cat, 'payer_participant_id', p_payer,
    'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal'));
  if p_op is not null then
    v_payload := v_payload || jsonb_build_object('operation_id', p_op,
      'expected_version_id', (select current_version_id from core.operation where id = p_op));
  end if;
  perform pg_temp.actor(p_who);
  v := api.record_group_expense(v_payload);
  perform pg_temp.gp_super();
  return 'OK ' || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- Ajuste por OBJETIVO como p_who, sobre su Personal: 'OK' / codigo.
create function pg_temp.ajuste(p_who uuid, p_key uuid, p_target bigint) returns text language plpgsql as $$
declare r fx%rowtype; v jsonb; v_scope uuid;
begin
  select * into r from fx;
  select s.id into v_scope from core.scope s where s.kind = 'personal' and s.owner_user_id = p_who;
  perform pg_temp.actor(p_who);
  v := api.record_adjustment(jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 2,
    'scope_id', v_scope, 'currency_definition_id', r.eur, 'target_balance', p_target::text,
    'effective_date', current_date::text, 'effective_time', '12:00'));
  perform pg_temp.gp_super();
  return 'OK ' || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.asociar(p_who uuid, p_key uuid, p_source uuid) returns text language plpgsql as $$
declare r fx%rowtype; v jsonb;
begin
  select * into r from fx;
  perform pg_temp.actor(p_who);
  v := api.associate_participant(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'scope_id', r.g1, 'participant_id', p_source));
  perform pg_temp.gp_super();
  return 'OK ' || (v ->> 'incorporated_versions');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- EL PERSONAL, como su dueño: 'saldo=<n> ops=<n> efectos=<n> gastos=<total> cats=<n> cuotas=<n>'.
create function pg_temp.personal(p_who uuid) returns text language plpgsql as $$
declare v text; s jsonb;
begin
  perform pg_temp.actor(p_who);
  s := api.personal_statistics(null, null);
  v := 'saldo=' || (select balance_amount from api.personal_balance)
    || ' ops=' || (select count(*) from api.personal_operation)
    || ' efectos=' || (select count(*) from api.personal_effect)
    || ' gastos=' || (s ->> 'expense_total')
    || ' cats=' || jsonb_array_length(s -> 'categories')
    || ' cuotas=' || (select count(*) from api.personal_expense_share(null, null));
  perform pg_temp.gp_super();
  return v;
end $$;
-- La cifra del WRITER frente a la vista: 'derive=<n> vista=<n>'.
create function pg_temp.saldos(p_who uuid) returns text language plpgsql as $$
declare v_scope uuid; v_vista text;
begin
  select s.id into v_scope from core.scope s where s.kind = 'personal' and s.owner_user_id = p_who;
  perform pg_temp.actor(p_who);
  select balance_amount into v_vista from api.personal_balance;
  perform pg_temp.gp_super();
  return 'derive=' || sec.derive_balance(v_scope, null) || ' vista=' || v_vista;
end $$;
-- Deudas como Inicio las lee (group_summary), y la atribucion (claimed_dimension), como p_who.
create function pg_temp.deuda(p_who uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_who);
  select coalesce(string_agg(net_position, ',' order by scope_id), '-') into v from api.group_summary;
  perform pg_temp.gp_super();
  return v;
end $$;
create function pg_temp.atribucion(p_who uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_who);
  select coalesce(string_agg(accounting_class || '/' || dimension || '=' || total, ' ' order by accounting_class, dimension), '-') into v
    from (select accounting_class, dimension, sum(amount::numeric) as total from api.claimed_dimension() group by 1, 2) t;
  perform pg_temp.gp_super();
  return v;
end $$;
-- La historia anterior: created_at una hora antes, como postgres (fixture).
create function pg_temp.antes(p_ops uuid[]) returns void language sql as $$
  update core.operation set created_at = now() - interval '1 hour' where id = any (p_ops);
$$;
grant execute on function pg_temp.actor(uuid, boolean), pg_temp.ambito(uuid, boolean), pg_temp.iniciar(uuid, uuid, text, boolean),
  pg_temp.gasto(uuid, uuid, uuid, uuid[], bigint, text, uuid, date), pg_temp.ajuste(uuid, uuid, bigint), pg_temp.asociar(uuid, uuid, uuid),
  pg_temp.personal(uuid), pg_temp.saldos(uuid), pg_temp.deuda(uuid), pg_temp.atribucion(uuid) to authenticated;

-- ============================ A · estructura =================================
do $a$
declare fallos text[] := '{}'; v_n int;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'scope' and column_name = 'provisioned_as_guest' and data_type = 'boolean') then
    fallos := array_append(fallos, 'A1: falta core.scope.provisioned_as_guest');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.personal_start'::regclass and conname = 'personal_start_mode_conocido') then
    fallos := array_append(fallos, 'A2: falta el CHECK del modo');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.personal_start'::regclass and contype = 'p') then
    fallos := array_append(fallos, 'A3: personal_start sin clave primaria (un hecho por ambito)');
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'personal_start'
              and privilege_type in ('UPDATE', 'DELETE') and grantee <> 'postgres') then
    fallos := array_append(fallos, 'A4: alguien puede actualizar o borrar personal_start: la decision es insert-only');
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'personal_start'
              and privilege_type = 'INSERT' and grantee not in ('postgres', 'nomey_provisioner')) then
    fallos := array_append(fallos, 'A5: alguien mas que el provisioner puede escribir personal_start');
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'core' and c.relname = 'personal_start' and c.relrowsecurity) then
    fallos := array_append(fallos, 'A6: personal_start sin RLS');
  end if;
  -- UN solo escritor en api: la unica funcion de api cuyo cuerpo inserta en personal_start.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%insert into core.personal_start%';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A7: %s funciones de api escriben personal_start y debe ser una', v_n));
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = 'api.start_personal_scope(jsonb)'::regprocedure)) <> 'nomey_provisioner' then
    fallos := array_append(fallos, 'A8: start_personal_scope no es del provisioner');
  end if;
  -- El predicado lo usan la cifra del writer y las lecturas del Personal.
  if pg_get_functiondef('sec.derive_balance(uuid,uuid)'::regprocedure) not ilike '%counts_in_personal%' then
    fallos := array_append(fallos, 'A9: sec.derive_balance no aplica el predicado');
  end if;
  if pg_get_viewdef('api.personal_balance'::regclass) not ilike '%counts_in_personal%'
     or pg_get_viewdef('api.personal_effect'::regclass) not ilike '%counts_in_personal%'
     or pg_get_viewdef('api.personal_operation'::regclass) not ilike '%counts_in_personal%'
     or pg_get_functiondef('sec.my_shared_expense_shares(date,date)'::regprocedure) not ilike '%counts_in_personal%' then
    fallos := array_append(fallos, 'A10: alguna lectura del Personal no aplica el predicado');
  end if;
  if pg_get_functiondef('api.claimed_dimension()'::regprocedure) ilike '%counts_in_personal%' then
    fallos := array_append(fallos, 'A11: claimed_dimension aplica el corte y no debe: es atribucion');
  end if;
  if array_length(fallos, 1) is not null then
    raise exception E'A · estructura:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · marca, decision insert-only, un escritor, predicado en la cifra y en las lecturas';
end
$a$;

-- ============================ fixture ========================================
do $f$
declare r fx%rowtype; v jsonb; v_id uuid;
begin
  select * into r from fx;
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  -- Los Personales, por la funcion real: dos nacen bajo el claim anonimo.
  perform pg_temp.actor(r.inv, true);   v := api.ensure_personal_scope('{"currency_code":"EUR"}'); update fx set s_inv = (v ->> 'scope_id')::uuid;
  perform pg_temp.actor(r.bea, false);  v := api.ensure_personal_scope('{"currency_code":"EUR"}'); update fx set s_bea = (v ->> 'scope_id')::uuid;
  perform pg_temp.actor(r.nadie, true); v := api.ensure_personal_scope('{"currency_code":"EUR"}'); update fx set s_nadie = (v ->> 'scope_id')::uuid;
  perform pg_temp.actor(r.nadie2, true); v := api.ensure_personal_scope('{"currency_code":"EUR"}'); update fx set s_nadie2 = (v ->> 'scope_id')::uuid;
  -- El grupo del invitado, con Ana (fantasma) y Bea (cuenta, vinculada como en los demas checks).
  perform pg_temp.actor(r.inv, true);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'a5000000-0000-4000-8000-000000000101', 'command_contract_version', 1,
    'client_group_id', r.g1, 'display_name', 'Viaje', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_inv, 'creator_display_name', 'Inv',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_ana, 'display_name', 'Ana'),
                                      jsonb_build_object('client_participant_id', r.p_bea, 'display_name', 'Bea'))));
  perform pg_temp.gp_super();
  insert into core.membership (scope_id, user_id) values (r.g1, r.bea);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.p_bea, r.g1, r.bea);
  -- Presencias abiertas hace 40 dias: E6 fecha un gasto hace un mes.
  update core.participant_period pp set valid_from = current_date - 40 from core.participant p where p.id = pp.participant_id and p.scope_id = r.g1;
end $f$;
select * from fx \gset
-- LA HISTORIA ANTERIOR (todo se retrasa una hora despues):
--   E0  Ana paga 800 para Ana e Inv   → cuota Inv 400 · Inv>Ana 400 · caja de Ana (sin cuenta: en ningun Personal)
--   E1  Inv paga 3000 para Inv,Ana,Bea → caja Inv −3000 · cuota 1000 · Ana>Inv 1000, Bea>Inv 1000
--   E2  Bea paga 6000 para Inv y Bea   → cuota Inv 3000 · Inv>Bea 3000
--   P1  Inv paga 500 a Bea             → caja Inv −500
do $h$
declare r fx%rowtype; t text;
begin
  select * into r from fx;
  t := pg_temp.gasto(r.inv, 'a5000000-0000-4000-8000-000000000200', r.p_ana, array[r.p_ana, r.p_inv], 800, 'Taxi');
  if t not like 'OK %' then raise exception 'fixture E0: %', t; end if; update fx set e0 = substr(t, 4)::uuid;
  t := pg_temp.gasto(r.inv, 'a5000000-0000-4000-8000-000000000201', r.p_inv, array[r.p_inv, r.p_ana, r.p_bea], 3000, 'Cena');
  if t not like 'OK %' then raise exception 'fixture E1: %', t; end if; update fx set e1 = substr(t, 4)::uuid;
  t := pg_temp.gasto(r.bea, 'a5000000-0000-4000-8000-000000000202', r.p_bea, array[r.p_inv, r.p_bea], 6000, 'Hotel');
  if t not like 'OK %' then raise exception 'fixture E2: %', t; end if; update fx set e2 = substr(t, 4)::uuid;
  t := pg_temp.gp_pay(r.inv, 'a5000000-0000-4000-8000-000000000203', r.g1, r.p_inv, r.p_bea, 500);
  if t not like 'OK %' then raise exception 'fixture P1: %', t; end if; update fx set p1 = substr(t, 4)::uuid;
  select * into r from fx;
  perform pg_temp.antes(array[r.e0, r.e1, r.e2, r.p1]);
end $h$;
select * from fx \gset

-- ============================ B · provisioning ===============================
do $b$
declare r fx%rowtype; fallos text[] := '{}'; t text;
begin
  select * into r from fx;
  if not (select provisioned_as_guest from core.scope where id = r.s_inv) then
    fallos := array_append(fallos, 'B1: el Personal creado bajo el claim anonimo no lleva la marca');
  end if;
  if (select provisioned_as_guest from core.scope where id = r.s_bea) then
    fallos := array_append(fallos, 'B2: el Personal creado sin el claim lleva la marca');
  end if;
  -- La conversion no borra la marca: el mismo actor vuelve SIN claim anonimo.
  t := pg_temp.ambito(r.inv, false);
  if t <> 'guest=true modo=- needs=true' then
    fallos := array_append(fallos, 'B3: con historia y sin decision, la cuenta convertida deberia pedir la decision: ' || t);
  end if;
  t := pg_temp.ambito(r.nadie, false);
  if t <> 'guest=true modo=- needs=false' then
    fallos := array_append(fallos, 'B4: sin historia no se pregunta: ' || t);
  end if;
  t := pg_temp.ambito(r.bea, false);
  if t <> 'guest=false modo=- needs=false' then
    fallos := array_append(fallos, 'B5: una cuenta normal nunca pregunta: ' || t);
  end if;
  -- api.personal_scope publica lo mismo.
  perform pg_temp.actor(r.inv);
  select 'guest=' || provisioned_as_guest || ' modo=' || coalesce(start_mode, '-') || ' needs=' || needs_start_decision into t from api.personal_scope;
  perform pg_temp.gp_super();
  if t <> 'guest=true modo=- needs=true' then
    fallos := array_append(fallos, 'B6: api.personal_scope no coincide con ensure_personal_scope: ' || t);
  end if;
  -- Y lo de siempre, antes de decidir: la historia de grupo ESTA en Personal.
  t := pg_temp.personal(r.inv);
  if t <> 'saldo=-3500 ops=2 efectos=2 gastos=4400 cats=1 cuotas=3' then
    fallos := array_append(fallos, 'B7: el Personal antes de decidir no es el de siempre: ' || t);
  end if;
  if array_length(fallos, 1) is not null then
    raise exception E'B · provisioning:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · la marca nace del claim y sobrevive a la conversion; se pregunta solo con marca, sin decision y con historia';
end
$b$;

-- ============================ C · include ====================================
savepoint c;
do $c$
declare r fx%rowtype; fallos text[] := '{}'; t text; v_antes text; v_deuda text; v_atrib text;
begin
  select * into r from fx;
  v_antes := pg_temp.personal(r.inv); v_deuda := pg_temp.deuda(r.inv); v_atrib := pg_temp.atribucion(r.inv);
  t := pg_temp.iniciar(r.bea, 'a5000000-0000-4000-8000-000000000401', 'include');
  if t <> 'PERSONAL_START_NOT_APPLICABLE' then fallos := array_append(fallos, 'C1: una cuenta sin marca decidio: ' || t); end if;
  t := pg_temp.iniciar(r.inv, 'a5000000-0000-4000-8000-000000000402', 'include');
  if t <> 'OK include' then fallos := array_append(fallos, 'C2: include: ' || t); end if;
  if pg_temp.personal(r.inv) <> v_antes then fallos := array_append(fallos, 'C3: include cambio el Personal: ' || pg_temp.personal(r.inv)); end if;
  if pg_temp.deuda(r.inv) <> v_deuda or pg_temp.atribucion(r.inv) <> v_atrib then fallos := array_append(fallos, 'C4: include toco deuda o atribucion'); end if;
  if pg_temp.ambito(r.inv) <> 'guest=true modo=include needs=false' then fallos := array_append(fallos, 'C5: tras decidir sigue pidiendo decision: ' || pg_temp.ambito(r.inv)); end if;
  t := pg_temp.iniciar(r.inv, 'a5000000-0000-4000-8000-000000000402', 'include');
  if t <> 'REPLAY include' then fallos := array_append(fallos, 'C6: el replay con la misma clave no fue replay: ' || t); end if;
  t := pg_temp.iniciar(r.inv, 'a5000000-0000-4000-8000-000000000403', 'include');
  if t <> 'REPLAY include' then fallos := array_append(fallos, 'C7: la misma decision con otra clave no es idempotente por estado: ' || t); end if;
  t := pg_temp.iniciar(r.inv, 'a5000000-0000-4000-8000-000000000404', 'fresh');
  if t <> 'PERSONAL_START_DECIDED' then fallos := array_append(fallos, 'C8: se volvio a decidir: ' || t); end if;
  t := pg_temp.iniciar(r.inv, 'a5000000-0000-4000-8000-000000000402', 'fresh');
  if t <> 'IDEMPOTENCY_KEY_REUSED' then fallos := array_append(fallos, 'C9: clave reutilizada con otra intencion: ' || t); end if;
  if (select count(*) from core.personal_start where scope_id = r.s_inv) <> 1 then fallos := array_append(fallos, 'C10: mas de una decision'); end if;
  if array_length(fallos, 1) is not null then
    raise exception E'C · include:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · include es identidad; idempotente por clave y por estado; no se vuelve a decidir; sin marca no hay decision';
end
$c$;
rollback to savepoint c;

-- ============================ D · fresh ======================================
do $d$
declare r fx%rowtype; fallos text[] := '{}'; t text; v_deuda text; v_atrib text;
begin
  select * into r from fx;
  v_deuda := pg_temp.deuda(r.inv); v_atrib := pg_temp.atribucion(r.inv);
  t := pg_temp.iniciar(r.inv, 'a5000000-0000-4000-8000-000000000411', 'fresh');
  if t <> 'OK fresh' then fallos := array_append(fallos, 'D1: fresh: ' || t); end if;
  t := pg_temp.personal(r.inv);
  if t <> 'saldo=0 ops=0 efectos=0 gastos=0 cats=0 cuotas=0' then
    fallos := array_append(fallos, 'D2: la historia anterior sigue en el Personal: ' || t);
  end if;
  if pg_temp.deuda(r.inv) <> v_deuda or v_deuda <> '-900' then
    fallos := array_append(fallos, 'D3: la deuda pendiente cambio o no es la esperada: ' || pg_temp.deuda(r.inv) || ' (antes ' || v_deuda || ')');
  end if;
  if pg_temp.atribucion(r.inv) <> v_atrib then
    fallos := array_append(fallos, 'D4: claimed_dimension cambio con el corte: ' || pg_temp.atribucion(r.inv));
  end if;
  t := pg_temp.saldos(r.inv);
  if t <> 'derive=0 vista=0' then fallos := array_append(fallos, 'D5: el writer y la vista no ven la misma cifra: ' || t); end if;
  if pg_temp.ambito(r.inv) <> 'guest=true modo=fresh needs=false' then fallos := array_append(fallos, 'D6: ' || pg_temp.ambito(r.inv)); end if;
  -- Bea, que no decidio nada, sigue viendo su Personal de siempre (su caja de E2 y el cobro de P1).
  t := pg_temp.personal(r.bea);
  if t <> 'saldo=-5500 ops=2 efectos=2 gastos=4000 cats=1 cuotas=2' then
    fallos := array_append(fallos, 'D7: el corte de Inv toco el Personal de Bea: ' || t);
  end if;
  if array_length(fallos, 1) is not null then
    raise exception E'D · fresh:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · fresh: saldo 0, sin historial ni estadisticas ni cuotas; la deuda y la atribucion siguen; derive_balance = vista';
end
$d$;

-- ============================ E · despues del corte ==========================
do $e$
declare r fx%rowtype; fallos text[] := '{}'; t text; v_op uuid; v_deuda_antes text;
begin
  select * into r from fx;
  -- E1 · pago de la deuda anterior: entra (es una operacion nueva).
  t := pg_temp.gp_pay(r.inv, 'a5000000-0000-4000-8000-000000000501', r.g1, r.p_inv, r.p_bea, 500);
  if t not like 'OK %' then fallos := array_append(fallos, 'E1: el pago posterior fallo: ' || t); end if;
  t := pg_temp.personal(r.inv);
  if t <> 'saldo=-500 ops=1 efectos=1 gastos=0 cats=0 cuotas=0' then fallos := array_append(fallos, 'E1b: el pago posterior no entro como debe: ' || t); end if;
  if pg_temp.deuda(r.inv) <> '-400' then fallos := array_append(fallos, 'E1c: la deuda no bajo con el pago: ' || pg_temp.deuda(r.inv)); end if;
  -- E2 · gasto nuevo: caja, cuota y categoria.
  t := pg_temp.gasto(r.inv, 'a5000000-0000-4000-8000-000000000502', r.p_inv, array[r.p_inv, r.p_bea], 900, 'Cafe');
  if t not like 'OK %' then fallos := array_append(fallos, 'E2: ' || t); end if;
  t := pg_temp.personal(r.inv);
  if t <> 'saldo=-1400 ops=2 efectos=2 gastos=450 cats=1 cuotas=1' then fallos := array_append(fallos, 'E2b: el gasto posterior no entro entero: ' || t); end if;
  -- E3 · corregir E1 (anterior) despues del corte: sigue fuera; Grupos cambia.
  v_deuda_antes := pg_temp.deuda(r.inv);
  t := pg_temp.gasto(r.inv, 'a5000000-0000-4000-8000-000000000503', r.p_inv, array[r.p_inv, r.p_ana, r.p_bea], 3300, 'Cena corregida', r.e1);
  if t not like 'OK %' then fallos := array_append(fallos, 'E3: ' || t); end if;
  if pg_temp.personal(r.inv) <> 'saldo=-1400 ops=2 efectos=2 gastos=450 cats=1 cuotas=1' then
    fallos := array_append(fallos, 'E3b: corregir una operacion anterior la resucito: ' || pg_temp.personal(r.inv));
  end if;
  if pg_temp.deuda(r.inv) = v_deuda_antes then fallos := array_append(fallos, 'E3c: la correccion no cambio la deuda del grupo'); end if;
  -- E4 · anular P1 (anterior) despues del corte: sigue fuera; la deuda reabre.
  v_deuda_antes := pg_temp.deuda(r.inv);
  t := pg_temp.gp_annul(r.inv, 'a5000000-0000-4000-8000-000000000504', r.p1);
  if t not like 'OK%' then fallos := array_append(fallos, 'E4: ' || t); end if;
  if pg_temp.personal(r.inv) <> 'saldo=-1400 ops=2 efectos=2 gastos=450 cats=1 cuotas=1' then
    fallos := array_append(fallos, 'E4b: anular una operacion anterior toco el Personal: ' || pg_temp.personal(r.inv));
  end if;
  if pg_temp.deuda(r.inv) = v_deuda_antes then fallos := array_append(fallos, 'E4c: la anulacion no reabrio la deuda'); end if;
  -- E5 · ajuste por objetivo: el delta sale de la cifra que se ve (−1400 → 0 = +1400).
  t := pg_temp.ajuste(r.inv, 'a5000000-0000-4000-8000-000000000505', 0);
  if t not like 'OK %' then fallos := array_append(fallos, 'E5: ' || t); end if;
  v_op := substr(t, 4)::uuid;
  if pg_temp.saldos(r.inv) <> 'derive=0 vista=0' then fallos := array_append(fallos, 'E5b: tras el ajuste: ' || pg_temp.saldos(r.inv)); end if;
  if (select balance_amount from core.effect e join core.operation_version ov on ov.id = e.operation_version_id where ov.operation_id = v_op and e.scope_id = r.s_inv) <> 1400 then
    fallos := array_append(fallos, 'E5c: el delta no se derivo de la cifra filtrada');
  end if;
  perform pg_temp.actor(r.inv);
  select 'antes=' || observed_balance_before || ' despues=' || observed_balance_after into t from api.observed_balance(array[v_op]);
  perform pg_temp.gp_super();
  if t <> 'antes=-1400 despues=0' then fallos := array_append(fallos, 'E5d: la observacion no coincide con lo visto: ' || t); end if;
  -- E6 · effective_date no manda: un gasto de HOY fechado hace un mes cuenta.
  t := pg_temp.gasto(r.inv, 'a5000000-0000-4000-8000-000000000506', r.p_inv, array[r.p_inv, r.p_bea], 200, 'Atrasado', null, current_date - 30);
  if t not like 'OK %' then fallos := array_append(fallos, 'E6: ' || t); end if;
  if pg_temp.personal(r.inv) <> 'saldo=-200 ops=4 efectos=4 gastos=550 cats=1 cuotas=2' then
    fallos := array_append(fallos, 'E6b: un gasto posterior fechado antes del corte quedo fuera: ' || pg_temp.personal(r.inv));
  end if;
  if array_length(fallos, 1) is not null then
    raise exception E'E · despues del corte:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · lo posterior entra (pago, gasto, ajuste coherente, fecha efectiva irrelevante); lo anterior editado o anulado sigue fuera y Grupos cambia';
end
$e$;

-- ============================ F · asociar despues del corte ==================
do $f2$
declare r fx%rowtype; fallos text[] := '{}'; t text; v_antes text;
begin
  select * into r from fx;
  v_antes := pg_temp.personal(r.inv);
  -- Ana pago E0 (anterior) y tiene cuota anterior. Inv la asocia AHORA.
  t := pg_temp.asociar(r.inv, 'a5000000-0000-4000-8000-000000000601', r.p_ana);
  if t <> 'OK 1' then fallos := array_append(fallos, 'F1: asociar no incorporo la caja de E0: ' || t); end if;
  if pg_temp.personal(r.inv) <> v_antes then
    fallos := array_append(fallos, 'F2: la historia anterior de Ana reaparecio en el Personal por asociarla despues del corte: ' || pg_temp.personal(r.inv) || ' (antes ' || v_antes || ')');
  end if;
  -- El efecto incorporado existe, cuelga de la operacion original, y el predicado lo deja fuera.
  if not exists (select 1 from core.effect e join core.operation_version ov on ov.id = e.operation_version_id where ov.operation_id = r.e0 and e.scope_id = r.s_inv and e.balance_amount = -800) then
    fallos := array_append(fallos, 'F3: la caja incorporada no cuelga de E0');
  end if;
  if sec.counts_in_personal(r.s_inv, r.e0) then fallos := array_append(fallos, 'F4: counts_in_personal deja pasar E0'); end if;
  if pg_temp.saldos(r.inv) <> 'derive=-200 vista=-200' then fallos := array_append(fallos, 'F5: ' || pg_temp.saldos(r.inv)); end if;
  if array_length(fallos, 1) is not null then
    raise exception E'F · asociar despues del corte:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · asociar despues del corte no resucita la historia anterior: la caja incorporada cuelga de la operacion original';
end
$f2$;

-- ============================ G · primer acceso sin historia =================
do $g$
declare r fx%rowtype; fallos text[] := '{}'; t text;
begin
  select * into r from fx;
  -- Nadie: nacio como invitado, sin historia → include automatico, persistido.
  t := pg_temp.iniciar(r.nadie, 'a5000000-0000-4000-8000-000000000701', 'include', true);
  if t <> 'OK include' then fallos := array_append(fallos, 'G1: el include automatico fallo: ' || t); end if;
  if not (select automatic from core.personal_start where scope_id = r.s_nadie) then fallos := array_append(fallos, 'G2: no quedo marcado como automatico'); end if;
  if pg_temp.ambito(r.nadie) <> 'guest=true modo=include needs=false' then fallos := array_append(fallos, 'G3: ' || pg_temp.ambito(r.nadie)); end if;
  -- Actividad de grupo POSTERIOR: no reabre la pregunta y cuenta.
  perform pg_temp.gp_super();
  insert into core.membership (scope_id, user_id) values (r.g1, r.nadie);
  insert into core.participant (id, scope_id, display_name) values ('a5000000-0000-4000-8000-000000000341', r.g1, 'Nadie');
  insert into core.participant_period (participant_id, valid_from, valid_until) values ('a5000000-0000-4000-8000-000000000341', current_date - 40, null);
  insert into core.participant_user_link (participant_id, scope_id, user_id) values ('a5000000-0000-4000-8000-000000000341', r.g1, r.nadie);
  t := pg_temp.gasto(r.nadie, 'a5000000-0000-4000-8000-000000000702', 'a5000000-0000-4000-8000-000000000341', array['a5000000-0000-4000-8000-000000000341'::uuid, r.p_bea], 400, 'Helado');
  if t not like 'OK %' then fallos := array_append(fallos, 'G4: ' || t); end if;
  if pg_temp.ambito(r.nadie) <> 'guest=true modo=include needs=false' then fallos := array_append(fallos, 'G5: la actividad posterior reabrio la pregunta: ' || pg_temp.ambito(r.nadie)); end if;
  if pg_temp.personal(r.nadie) <> 'saldo=-400 ops=1 efectos=1 gastos=200 cats=1 cuotas=1' then fallos := array_append(fallos, 'G6: ' || pg_temp.personal(r.nadie)); end if;
  -- Un include automatico con historia se rehusa: la persona decide.
  t := pg_temp.iniciar(r.bea, 'a5000000-0000-4000-8000-000000000703', 'include', true);
  if t <> 'PERSONAL_START_NOT_APPLICABLE' then fallos := array_append(fallos, 'G7: sin marca: ' || t); end if;
  perform pg_temp.gp_super();
  update core.scope set provisioned_as_guest = true where id = r.s_bea;  -- fixture: Bea como si hubiera nacido invitada
  t := pg_temp.iniciar(r.bea, 'a5000000-0000-4000-8000-000000000704', 'include', true);
  if t <> 'PERSONAL_START_DECISION_REQUIRED' then fallos := array_append(fallos, 'G8: un include automatico con historia deberia pedir decision: ' || t); end if;
  if exists (select 1 from core.personal_start where scope_id = r.s_bea) then fallos := array_append(fallos, 'G9: el rechazo escribio la decision'); end if;
  -- fresh sin historia no tiene sentido; la forma del payload.
  t := pg_temp.iniciar(r.nadie2, 'a5000000-0000-4000-8000-000000000705', 'fresh');
  if t <> 'PERSONAL_START_NOT_APPLICABLE' then fallos := array_append(fallos, 'G10: fresh sin historia: ' || t); end if;
  t := pg_temp.iniciar(r.nadie2, 'a5000000-0000-4000-8000-000000000706', 'fresh', true);
  if t <> 'PAYLOAD_INVALID' then fallos := array_append(fallos, 'G11: automatic con fresh: ' || t); end if;
  t := pg_temp.iniciar(r.nadie2, 'a5000000-0000-4000-8000-000000000707', 'reset');
  if t <> 'PAYLOAD_INVALID' then fallos := array_append(fallos, 'G12: modo desconocido: ' || t); end if;
  if array_length(fallos, 1) is not null then
    raise exception E'G · primer acceso sin historia:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · sin historia, include automatico persistido y la actividad posterior no reabre nada; con historia, la persona decide';
end
$g$;

rollback;
