-- Comprobaciones del saldo objetivo, la observacion historica y la anulacion.
-- F6.C, contra la base REAL construida por las migraciones.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/balance-and-annulment.sql
--
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- Lo que este fichero NO comprueba porque no puede: la CONCURRENCIA. Una sola
-- sesion de `psql` no la tiene, y una simulacion secuencial pasaria tambien con
-- el lock quitado. La miden `scripts/balance-concurrency.sh` con sesiones
-- simultaneas de verdad y `supabase/e22/` con las carreras originales.

\pset pager off
\set ON_ERROR_STOP on

begin;

create temporary table bc_fix (k text primary key, v text) on commit drop;
insert into bc_fix (k, v) values
  ('U1',  'd1111111-1111-4111-8111-111111111111'),
  ('U2',  'd2222222-2222-4222-8222-222222222222'),
  ('S1',  'd0000000-0000-4000-8000-000000000001'),
  ('S2',  'd0000000-0000-4000-8000-000000000002'),
  ('EUR', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  ('GOTR','4ed30a44-9f82-578f-828c-b491a25ebdd9');

insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from bc_fix where k='S1')::uuid, 'personal',
       (select v from bc_fix where k='EUR')::uuid, (select v from bc_fix where k='U1')::uuid;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from bc_fix where k='S2')::uuid, 'personal',
       (select v from bc_fix where k='EUR')::uuid, (select v from bc_fix where k='U2')::uuid;
insert into core.membership (scope_id, user_id)
select (select v from bc_fix where k='S1')::uuid, (select v from bc_fix where k='U1')::uuid;
insert into core.membership (scope_id, user_id)
select (select v from bc_fix where k='S2')::uuid, (select v from bc_fix where k='U2')::uuid;

-- ========================= A · estructura y privilegios ====================
do $a$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- A1 · el lock es UNO, y con nombre agnostico de la dimension.
  if to_regprocedure('sec.lock_debt_scopes(uuid[])') is not null then
    fallos := array_append(fallos, 'A1: sigue existiendo sec.lock_debt_scopes; hay dos nombres para un mecanismo');
  end if;
  if to_regprocedure('sec.lock_scopes(uuid[])') is null then
    fallos := array_append(fallos, 'A1b: no existe sec.lock_scopes');
  end if;

  -- A2 · NINGUNA funcion autoritativa se quedo fuera del protocolo. Las SIETE
  -- que producen saldo observan; `debt_settlement` no, porque no produce saldo.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='api' and p.proname like 'record\_%'
     and p.prosrc like '%observe_balances%';
  if v_n <> 7 then
    fallos := array_append(fallos,
      format('A2: %s funciones observan el saldo y deberian ser 7', v_n));
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='api' and p.proname='record_debt_settlement'
                and p.prosrc like '%observe_balances%') then
    fallos := array_append(fallos, 'A2b: record_debt_settlement observa saldo y no produce ninguno');
  end if;

  -- A2c · y las siete BLOQUEAN. Sin lock, la observacion miente (E22/R2).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='api' and p.proname like 'record\_%'
     and p.prosrc like '%lock_scopes%';
  if v_n <> 8 then
    fallos := array_append(fallos,
      format('A2d: %s funciones bloquean ambitos y deberian ser 8, las 7 de saldo mas la de deuda', v_n));
  end if;

  -- A3 · EXACTAMENTE UNA `sec.persist_version`. Si sobreviviera la de diez
  -- argumentos, las ocho podrian resolverse contra ella y escribir sin la
  -- guarda de clase Y sin la de anulacion.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='sec' and p.proname='persist_version';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A3: hay %s versiones de sec.persist_version', v_n));
  end if;

  -- A4 · la observacion es INSERT-ONLY para todo el mundo, writer incluido.
  if has_table_privilege('nomey_writer','core.balance_observation','UPDATE')
     or has_table_privilege('nomey_writer','core.balance_observation','DELETE')
     or has_table_privilege('authenticated','core.balance_observation','UPDATE')
     or has_table_privilege('authenticated','core.balance_observation','INSERT') then
    fallos := array_append(fallos, 'A4: la observacion de saldo es modificable por alguien');
  end if;
  if has_table_privilege('nomey_writer','core.adjustment_detail','UPDATE')
     or has_table_privilege('nomey_writer','core.adjustment_detail','DELETE') then
    fallos := array_append(fallos, 'A4b: el objetivo declarado es modificable');
  end if;

  -- A5 · GUARDA DE LA OBSERVACION. Ninguna vista ni funcion de `api` puede
  -- depender de `core.balance_observation`: si el Disponible se derivara de
  -- ella, dejaria de ser una observacion y seria una cache.
  select count(*) into v_n
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dep on dep.oid = r.ev_class
  join pg_namespace n on n.oid = dep.relnamespace
  where d.refobjid = 'core.balance_observation'::regclass
    and d.classid = 'pg_rewrite'::regclass
    and n.nspname = 'api';
  if v_n <> 0 then
    fallos := array_append(fallos,
      format('A5: %s vistas de api dependen de la observacion de saldo; seria una segunda fuente de verdad', v_n));
  end if;

  -- A6 · `version_kind` con vocabulario cerrado.
  if not exists (select 1 from pg_constraint
                  where conname = 'operation_version_kind_valida') then
    fallos := array_append(fallos, 'A6: version_kind no tiene vocabulario cerrado');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'A · estructura:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · un solo lock, siete observadores, y la observacion sin consumidores';
end
$a$;

-- ============================ B · el saldo objetivo ========================
do $b$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from bc_fix where k='U1');
  S1 constant text := (select v from bc_fix where k='S1');
  EUR constant text := (select v from bc_fix where k='EUR');
  GOTR constant text := (select v from bc_fix where k='GOTR');
  r jsonb; v_op uuid; v_v1 uuid; v_saldo bigint; v_target bigint; v_delta bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- Partida: un gasto de 20,00 deja el saldo en -2000. Se ajusta a 10000.
  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','d1000000-0000-4000-8000-000000000001',
         'command_contract_version',2,'effective_date','2026-11-01','effective_time','09:00',
         'scope_id',S1,'amount','2000','currency_definition_id',EUR,
         'concept','Partida','category_id',GOTR));

  -- B1 · ni los dos ni ninguno.
  begin
    r := api.record_adjustment(jsonb_build_object(
           'client_operation_id','d1000000-0000-4000-8000-000000000002',
           'command_contract_version',2,'effective_date','2026-11-02','effective_time','10:00',
           'scope_id',S1,'currency_definition_id',EUR,'delta','100','target_balance','100'));
    fallos := array_append(fallos, 'B1: se aceptaron delta y target_balance a la vez');
  exception when sqlstate 'PGRST' then null;
  end;
  begin
    r := api.record_adjustment(jsonb_build_object(
           'client_operation_id','d1000000-0000-4000-8000-000000000003',
           'command_contract_version',2,'effective_date','2026-11-02','effective_time','10:00',
           'scope_id',S1,'currency_definition_id',EUR));
    fallos := array_append(fallos, 'B1b: se acepto un ajuste sin delta ni objetivo');
  exception when sqlstate 'PGRST' then null;
  end;

  -- B2 · el objetivo se alcanza EXACTAMENTE, y el delta es el derivado.
  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','d1000000-0000-4000-8000-000000000004',
         'command_contract_version',2,'effective_date','2026-11-02','effective_time','10:00',
         'scope_id',S1,'currency_definition_id',EUR,'target_balance','10000'));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;

  v_saldo := sec.derive_balance(S1::uuid, null);
  if v_saldo <> 10000 then
    fallos := array_append(fallos, format('B2: el saldo quedo en %s y el objetivo era 10000', v_saldo));
  end if;

  select ov.original_amount into v_delta
    from core.operation_version ov join core.operation o on o.current_version_id=ov.id
   where o.id = v_op;
  if v_delta <> 12000 then
    fallos := array_append(fallos,
      format('B2b: el importe original del ajuste es %s y deberia ser el delta derivado 12000', v_delta));
  end if;

  -- B3 · el OBJETIVO se persiste como intencion, aparte del delta.
  select ad.target_balance into v_target
    from core.adjustment_detail ad join core.operation o on o.current_version_id = ad.operation_version_id
   where o.id = v_op;
  if v_target is distinct from 10000 then
    fallos := array_append(fallos, 'B3: el objetivo declarado no se persistio');
  end if;

  -- B4 · un ajuste por DELTA no deja detalle: no declaro objetivo.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','d1000000-0000-4000-8000-000000000005',
         'command_contract_version',2,'effective_date','2026-11-03','effective_time','11:00',
         'scope_id',S1,'currency_definition_id',EUR,'delta','500'));
  reset role;
  if exists (select 1 from core.adjustment_detail ad
               join core.operation o on o.current_version_id = ad.operation_version_id
              where o.id = (r ->> 'operation_id')::uuid) then
    fallos := array_append(fallos, 'B4: un ajuste por delta invento un objetivo');
  end if;

  -- B5 · CORREGIR el ajuste por objetivo: el saldo vuelve a quedar EXACTAMENTE
  -- en el objetivo nuevo, lo que solo es posible si se excluyo la version
  -- sustituida al derivar el delta.
  select current_version_id into v_v1 from core.operation where id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','d1000000-0000-4000-8000-000000000006',
         'command_contract_version',2,'effective_date','2026-11-02','effective_time','10:00',
         'scope_id',S1,'currency_definition_id',EUR,'target_balance','7000',
         'operation_id',v_op,'expected_version_id',v_v1));
  reset role;
  -- Saldo esperado: EXACTAMENTE 7000, y conviene entender por que no es 7500.
  --
  -- Corregir un objetivo lo REAFIRMA contra el estado actual sin la version
  -- sustituida: -1500 sin ella, mas un delta derivado de 8500, da 7000. El
  -- ajuste por delta de 500 que vino despues **no se suma encima**: queda
  -- absorbido, porque el objetivo es una afirmacion sobre el saldo, no un
  -- incremento.
  --
  -- Es la consecuencia directa de la semantica decidida: `target_balance` es el
  -- saldo que la persona declara tener AL RECONCILIAR, y F6.C **no reconstruye
  -- saldos as-of**. La alternativa —que 7000 significara «lo que habia en aquel
  -- instante» y hubiera que recolocar todo lo posterior— es exactamente la
  -- reconstruccion retroactiva que queda fuera de alcance.
  v_saldo := sec.derive_balance(S1::uuid, null);
  if v_saldo <> 7000 then
    fallos := array_append(fallos,
      format('B5: tras corregir el objetivo el saldo es %s y deberia ser 7000', v_saldo));
  end if;

  -- B5b · y la version anterior NO se muto.
  if not exists (select 1 from core.adjustment_detail where operation_version_id = v_v1
                   and target_balance = 10000) then
    fallos := array_append(fallos, 'B5b: el objetivo de la version anterior desaparecio o cambio');
  end if;

  -- B6 · la intencion canonica lleva el OBJETIVO, no el delta derivado.
  if not exists (select 1 from core.client_command
                  where client_operation_id = 'd1000000-0000-4000-8000-000000000004'
                    and canonical_intent ->> 'target_balance' = '10000') then
    fallos := array_append(fallos, 'B6: la intencion canonica no lleva el objetivo declarado');
  end if;

  -- B7 · reintento con el MISMO objetivo -> replay; con otro -> conflicto.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','d1000000-0000-4000-8000-000000000004',
         'command_contract_version',2,'effective_date','2026-11-02','effective_time','10:00',
         'scope_id',S1,'currency_definition_id',EUR,'target_balance','10000'));
  if (r ->> 'already_processed') <> 'true' then
    fallos := array_append(fallos, 'B7: el reintento con el mismo objetivo no fue replay');
  end if;
  begin
    r := api.record_adjustment(jsonb_build_object(
           'client_operation_id','d1000000-0000-4000-8000-000000000004',
           'command_contract_version',2,'effective_date','2026-11-02','effective_time','10:00',
           'scope_id',S1,'currency_definition_id',EUR,'target_balance','99999'));
    fallos := array_append(fallos, 'B7b: un objetivo distinto con la misma clave hizo replay');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('B7c: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos,1) is not null then
    raise exception E'B · saldo objetivo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · el objetivo se declara, el delta se deriva, y corregir vuelve a acertar';
end
$b$;

-- ======================== C · la observacion historica =====================
do $c$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from bc_fix where k='U1');
  S1 constant text := (select v from bc_fix where k='S1');
  EUR constant text := (select v from bc_fix where k='EUR');
  GOTR constant text := (select v from bc_fix where k='GOTR');
  r jsonb; v_op uuid; v_v1 uuid; v_previa uuid; v_before bigint; v_after bigint; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','d2000000-0000-4000-8000-000000000001',
         'command_contract_version',2,'effective_date','2026-12-01','effective_time','09:00',
         'scope_id',S1,'amount','1000','currency_definition_id',EUR,
         'concept','Observado','category_id',GOTR));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;

  -- C1 · todo movimiento con saldo deja su observacion, y encaja con el saldo.
  select bo.balance_before, bo.balance_after into v_before, v_after
    from core.balance_observation bo
    join core.operation o on o.current_version_id = bo.operation_version_id
   where o.id = v_op;
  if v_after is null then
    fallos := array_append(fallos, 'C1: el gasto no dejo observacion de saldo');
  elsif v_after <> v_before - 1000 then
    fallos := array_append(fallos,
      format('C1b: la observacion dice %s -> %s, y el gasto era de 1000', v_before, v_after));
  end if;

  -- C2 · EL REQUISITO CENTRAL: corregir una operacion ANTERIOR no altera esta
  -- observacion. Es lo que la hace una fotografia y no una derivada.
  -- Los identificadores se leen como `postgres`, ANTES de cambiar de rol:
  -- `authenticated` no tiene USAGE sobre `core` y no debe tenerlo.
  select o.id, o.current_version_id into v_previa, v_v1
    from core.operation o
    join core.client_command c on c.result_operation_id = o.id
   where c.client_operation_id = 'd1000000-0000-4000-8000-000000000001';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','d2000000-0000-4000-8000-000000000002',
         'command_contract_version',2,'effective_date','2026-11-01','effective_time','09:00',
         'scope_id',S1,'amount','9999','currency_definition_id',EUR,
         'concept','Partida corregida','category_id',GOTR,
         'operation_id',v_previa,'expected_version_id',v_v1));
  reset role;

  select bo.balance_before, bo.balance_after into v_before, v_after
    from core.balance_observation bo
    join core.operation o on o.current_version_id = bo.operation_version_id
   where o.id = v_op;
  if v_after <> v_before - 1000 then
    fallos := array_append(fallos,
      'C2: corregir una operacion anterior ALTERO la observacion de otra; deja de ser una fotografia');
  end if;

  -- C3 · una correccion escribe su PROPIA observacion, sin tocar la anterior.
  select count(*) into v_n from core.balance_observation bo
    join core.operation_version ov on ov.id = bo.operation_version_id
   where ov.operation_id = v_previa;
  if v_n <> 2 then
    fallos := array_append(fallos,
      format('C3: la operacion corregida tiene %s observaciones y deberian ser 2, una por version', v_n));
  end if;

  -- C4 · un ambito de GRUPO no recibe observaciones: no tiene saldo propio.
  if exists (select 1 from core.balance_observation bo
               join core.scope s on s.id = bo.scope_id where s.kind = 'group') then
    fallos := array_append(fallos, 'C4: un ambito de grupo recibio observacion de saldo');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'C · observacion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · la observacion se congela: corregir otra operacion no la toca';
end
$c$;

-- Vista efimera para poder EJERCER la RLS como cliente.  lee
-- por  y no tiene USAGE sobre , asi que sin esto no se puede
-- comprobar la visibilidad real de una version. Es , de modo
-- que la policy se evalua con la identidad del actor, y la crea y destruye la
-- propia transaccion: el ROLLBACK la deshace y no queda nada en .
create view api.chk_version_visibility
with (security_invoker = true) as
select ov.id, ov.operation_id, ov.version_kind from core.operation_version ov;
grant select on api.chk_version_visibility to authenticated;

-- ============================== D · la anulacion ===========================
do $d$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from bc_fix where k='U1');
  U2 constant text := (select v from bc_fix where k='U2');
  S1 constant text := (select v from bc_fix where k='S1');
  EUR constant text := (select v from bc_fix where k='EUR');
  GOTR constant text := (select v from bc_fix where k='GOTR');
  r jsonb; v_op uuid; v_v1 uuid; v_v2 uuid;
  v_saldo_antes bigint; v_saldo_despues bigint; v_n int; v_visible int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','d3000000-0000-4000-8000-000000000001',
         'command_contract_version',2,'effective_date','2027-01-01','effective_time','09:00',
         'scope_id',S1,'amount','3000','currency_definition_id',EUR,
         'concept','Se anula','category_id',GOTR));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  v_saldo_antes := sec.derive_balance(S1::uuid, null);
  select current_version_id into v_v1 from core.operation where id = v_op;

  -- D1 · anular.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.annul_operation(jsonb_build_object(
         'client_operation_id','d3000000-0000-4000-8000-000000000002',
         'command_contract_version',1,'operation_id',v_op,'expected_version_id',v_v1));
  reset role;

  -- D2 · el saldo vuelve: la operacion aporta CERO.
  v_saldo_despues := sec.derive_balance(S1::uuid, null);
  if v_saldo_despues <> v_saldo_antes + 3000 then
    fallos := array_append(fallos,
      format('D2: el saldo paso de %s a %s y el gasto anulado era de 3000', v_saldo_antes, v_saldo_despues));
  end if;

  -- D3 · la version vigente es la anulacion, y NO tiene efectos.
  select o.current_version_id into v_v2 from core.operation o where o.id = v_op;
  if not exists (select 1 from core.operation_version where id = v_v2 and version_kind = 'annulment') then
    fallos := array_append(fallos, 'D3: la version vigente no es una anulacion');
  end if;
  if exists (select 1 from core.effect where operation_version_id = v_v2) then
    fallos := array_append(fallos, 'D3b: la anulacion produjo efectos');
  end if;

  -- D4 · NADA SE BORRA: la version anulada y sus efectos siguen ahi.
  if not exists (select 1 from core.operation_version where id = v_v1) then
    fallos := array_append(fallos, 'D4: la version anulada desaparecio');
  end if;
  select count(*) into v_n from core.effect where operation_version_id = v_v1;
  if v_n <> 1 then
    fallos := array_append(fallos, format('D4b: quedan %s efectos historicos y deberia quedar 1', v_n));
  end if;
  if not exists (select 1 from core.movement_detail where operation_version_id = v_v1) then
    fallos := array_append(fallos, 'D4c: el detalle del movimiento anulado desaparecio');
  end if;

  -- D5 · la anulacion CONSERVA el hecho declarado: importe, fecha y hora.
  if not exists (select 1 from core.operation_version
                  where id = v_v2 and original_amount = 3000
                    and effective_date = date '2027-01-01' and effective_time = time '09:00') then
    fallos := array_append(fallos, 'D5: la anulacion no conservo el hecho de la version anulada');
  end if;

  -- D6 · LA VERSION VIGENTE ES LEGIBLE POR EL CLIENTE. Sin la ampliacion de la
  -- RLS, una version sin efectos es invisible y el cliente caeria en la version
  -- anterior: mostraria el movimiento que el usuario acaba de eliminar.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  select count(*) into v_visible from api.chk_version_visibility where id = v_v2;
  reset role;
  if v_visible <> 1 then
    fallos := array_append(fallos,
      'D6: la version de anulacion NO es visible; el cliente mostraria la anterior como vigente');
  end if;

  -- D6b · y sigue sin verla quien no es miembro.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);
  select count(*) into v_visible from api.chk_version_visibility where id = v_v2;
  reset role;
  if v_visible <> 0 then
    fallos := array_append(fallos, 'D6c: un usuario ajeno ve la anulacion');
  end if;

  -- D7 · TERMINAL: la operacion anulada no admite versiones nuevas.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.record_personal_expense(jsonb_build_object(
           'client_operation_id','d3000000-0000-4000-8000-000000000003',
           'command_contract_version',2,'effective_date','2027-01-01','effective_time','09:00',
           'scope_id',S1,'amount','4000','currency_definition_id',EUR,
           'concept','Resucitar','category_id',GOTR,
           'operation_id',v_op,'expected_version_id',v_v2));
    fallos := array_append(fallos, 'D7: se corrigio una operacion ANULADA');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%OPERATION_ANNULLED%' then
      fallos := array_append(fallos, format('D7b: se rechazo, pero no por anulacion: %s', sqlerrm));
    end if;
  end;

  -- D8 · anular dos veces: la segunda con la version vigente correcta tambien
  -- se rechaza, porque la vigente ya es una anulacion.
  begin
    r := api.annul_operation(jsonb_build_object(
           'client_operation_id','d3000000-0000-4000-8000-000000000004',
           'command_contract_version',1,'operation_id',v_op,'expected_version_id',v_v2));
    fallos := array_append(fallos, 'D8: se anulo dos veces la misma operacion');
  exception when sqlstate 'PGRST' then null;
  end;

  -- D9 · replay: la misma clave devuelve la misma operacion sin escribir.
  reset role;
  select count(*) into v_n from core.operation_version where operation_id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.annul_operation(jsonb_build_object(
         'client_operation_id','d3000000-0000-4000-8000-000000000002',
         'command_contract_version',1,'operation_id',v_op,'expected_version_id',v_v1));
  if (r ->> 'already_processed') <> 'true' then
    fallos := array_append(fallos, 'D9: el reintento de la anulacion no fue replay');
  end if;
  reset role;
  if (select count(*) from core.operation_version where operation_id = v_op) <> v_n then
    fallos := array_append(fallos, 'D9b: el replay de la anulacion escribio una version');
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- D10 · CAS obsoleto.
  begin
    r := api.annul_operation(jsonb_build_object(
           'client_operation_id','d3000000-0000-4000-8000-000000000005',
           'command_contract_version',1,'operation_id',v_op,'expected_version_id',v_v1));
    fallos := array_append(fallos, 'D10: se anulo con un expected_version_id obsoleto');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%VERSION_CONFLICT%' then
      fallos := array_append(fallos, format('D10b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- D11 · AUTORIZACION: quien no es miembro del ambito no anula.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);
  begin
    r := api.annul_operation(jsonb_build_object(
           'client_operation_id','d3000000-0000-4000-8000-000000000006',
           'command_contract_version',1,'operation_id',v_op,'expected_version_id',v_v1));
    fallos := array_append(fallos, 'D11: un usuario ajeno anulo la operacion');
  exception when sqlstate 'PGRST' then null;
  end;
  reset role;

  -- D12 · la anulacion deja su propia OBSERVACION: el borrado es justo el
  -- momento donde peor sienta un hueco de auditoria.
  if not exists (select 1 from core.balance_observation
                  where operation_version_id = v_v2 and balance_after = balance_before + 3000) then
    fallos := array_append(fallos, 'D12: la anulacion no dejo observacion, o no cuadra');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'D · anulacion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · anular no borra, deja de contar, es legible y es terminal';
end
$d$;

\echo 'balance-and-annulment: OK'

rollback;
