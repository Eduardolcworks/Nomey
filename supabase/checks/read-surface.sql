-- Comprobaciones de la superficie de lectura del Modo Personal.
-- F6.D, contra la base REAL construida por las migraciones.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/read-surface.sql
--
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- Lo que este fichero NO comprueba porque no puede: que la RLS aguante con una
-- IDENTIDAD REAL. Aqui la identidad se simula con `set_config`, que es lo que
-- hace todo check SQL del proyecto. La frontera entera —Kong, GoTrue,
-- PostgREST, `api` y la RLS con un JWT de verdad— la mide
-- `scripts/http-boundary-check.sh`, y esta superficie tiene su bloque alli.

\pset pager off
\set ON_ERROR_STOP on

begin;

create temporary table rs_fix (k text primary key, v text) on commit drop;
insert into rs_fix (k, v) values
  ('U1',   'e1111111-1111-4111-8111-111111111111'),
  ('U2',   'e2222222-2222-4222-8222-222222222222'),
  -- U3 tiene ambito y NUNCA ha registrado nada: es el caso del saldo cero.
  ('U3',   'e3333333-3333-4333-8333-333333333333'),
  ('S1',   'e0000000-0000-4000-8000-000000000001'),
  ('S2',   'e0000000-0000-4000-8000-000000000002'),
  ('S3',   'e0000000-0000-4000-8000-000000000003'),
  ('EUR',  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  -- Categorias sembradas por la migracion de F6.B. NUNCA se regeneran.
  ('GOTR', '4ed30a44-9f82-578f-828c-b491a25ebdd9'),
  ('GCOM', '80088454-77aa-51ae-864e-523ca74d66eb'),
  ('IOTR', 'ea9f1167-f497-5edf-af01-c7e1c3a64d9d');

insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from rs_fix where k=s)::uuid, 'personal',
       (select v from rs_fix where k='EUR')::uuid,
       (select v from rs_fix where k=u)::uuid
from (values ('S1','U1'), ('S2','U2'), ('S3','U3')) as t(s, u);

insert into core.membership (scope_id, user_id)
select (select v from rs_fix where k=s)::uuid, (select v from rs_fix where k=u)::uuid
from (values ('S1','U1'), ('S2','U2'), ('S3','U3')) as t(s, u);

-- ==================== A · estructura, guardas y privilegios ================
do $a$
declare
  fallos text[] := '{}';
  v_n int;
  v_t text;
begin
  -- A1 · las tres vistas y la funcion existen.
  foreach v_t in array array['personal_operation','personal_operation_version','personal_balance']
  loop
    if to_regclass('api.' || v_t) is null then
      fallos := array_append(fallos, format('A1: no existe la vista api.%s', v_t));
    end if;
  end loop;
  if to_regprocedure('api.observed_balance(uuid[])') is null then
    fallos := array_append(fallos, 'A1b: no existe api.observed_balance(uuid[])');
  end if;

  -- A2 · LAS TRES SON `security_invoker`. E19 midio que en una cadena decide el
  -- eslabon mas cercano a las tablas, y que sin el se filtran filas de otro
  -- ambito INCLUSO SIN SESION. `personal_operation_version` se apoya en
  -- `personal_operation`, asi que la cadena de dos vistas es literalmente el
  -- caso medido y las dos tienen que llevarlo.
  for v_t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'api'
               and c.relname in ('personal_operation','personal_operation_version','personal_balance')
               and not coalesce((select option_value = 'true' from pg_options_to_table(c.reloptions)
                                 where option_name = 'security_invoker'), false)
  loop
    fallos := array_append(fallos, format('A2: la vista api.%s NO es security_invoker', v_t));
  end loop;

  -- A3 · LA OBSERVACION NO ES `SECURITY DEFINER`, y es lo contrario de
  -- `api.claimed_dimension()` a proposito: una lectura de reclamacion debe
  -- ATRAVESAR la RLS, esta NO debe atravesarla.
  if exists (select 1 from pg_proc where oid = 'api.observed_balance(uuid[])'::regprocedure
               and prosecdef) then
    fallos := array_append(fallos, 'A3: api.observed_balance es SECURITY DEFINER y atravesaria la RLS');
  end if;
  if not exists (select 1 from pg_proc where oid = 'api.observed_balance(uuid[])'::regprocedure
                   and provolatile = 's' and proconfig = array['search_path=""']) then
    fallos := array_append(fallos, 'A3b: api.observed_balance no es STABLE con search_path fijado a vacio');
  end if;

  -- A4 · GUARDA DE ADR-023, INTACTA. Sigue habiendo CERO vistas de `api` que
  -- dependan de la observacion. Se reafirma aqui y no solo en
  -- balance-and-annulment.sql porque este es el bloque que estrena consumidor.
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
      format('A4: %s vistas de api dependen de la observacion; el Disponible dejaria de ser derivado', v_n));
  end if;

  -- A5 · GUARDA NUEVA, y es la que este bloque aporta. EXACTAMENTE UNA funcion
  -- de `api` puede depender de la observacion, y es `api.observed_balance`. No
  -- se relaja nada: A4 sigue exigiendo cero vistas, y esto ACOTA la unica via
  -- que se abre. Una segunda funcion aqui seria el principio de la cache que
  -- ADR-023 existe para impedir.
  select count(*) into v_n
  from pg_depend d
  join pg_proc p on p.oid = d.objid
  join pg_namespace n on n.oid = p.pronamespace
  where d.refobjid = 'core.balance_observation'::regclass
    and d.classid = 'pg_proc'::regclass
    and n.nspname = 'api'
    and p.oid <> 'api.observed_balance(uuid[])'::regprocedure;
  if v_n <> 0 then
    fallos := array_append(fallos,
      format('A5: %s funciones de api ademas de observed_balance dependen de la observacion', v_n));
  end if;
  -- A5b · POSITIVO: y `api.observed_balance` SI deja la dependencia analizable,
  -- que es lo que ADR-013 §9 exige con `BEGIN ATOMIC`. Sin ella la guarda de
  -- arriba no vigilaria nada.
  if not exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.refobjid
    where d.objid = 'api.observed_balance(uuid[])'::regprocedure
      and d.classid = 'pg_proc'::regclass
      and c.relname = 'balance_observation'
  ) then
    fallos := array_append(fallos,
      'A5b: api.observed_balance no deja dependencia de catalogo; su cuerpo no es BEGIN ATOMIC y la guarda no la cubre');
  end if;

  -- A6 · GUARDA DE ADR-013 §9, INTACTA. Nada de la superficie nueva depende de
  -- `core.effect`: ni vista ni funcion.
  select count(*) into v_n
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dep on dep.oid = r.ev_class
  where d.refobjid = 'core.effect'::regclass
    and d.classid = 'pg_rewrite'::regclass
    and dep.relkind = 'v'
    and dep.oid <> 'core.current_effect'::regclass;
  if v_n <> 0 then
    fallos := array_append(fallos,
      format('A6: %s vistas dependen directamente de core.effect saltandose la proyeccion canonica', v_n));
  end if;
  select count(*) into v_n
  from pg_depend d join pg_proc p on p.oid = d.objid
  where d.refobjid = 'core.effect'::regclass and d.classid = 'pg_proc'::regclass;
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6b: %s funciones dependen directamente de core.effect', v_n));
  end if;

  -- A7 · ADR-008 §1: ningun importe cruza `api` como numero JSON.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'api' and data_type = 'bigint';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A7: %s columnas de api son bigint y se degradarian al parsearse', v_n));
  end if;
  if pg_get_function_result('api.observed_balance(uuid[])'::regprocedure) like '%bigint%' then
    fallos := array_append(fallos, 'A7b: api.observed_balance devuelve bigint en vez de texto');
  end if;

  -- A8 · la propiedad durable no se proyecta en ninguna superficie nueva.
  if exists (select 1 from information_schema.columns
             where table_schema = 'api' and column_name = 'owner_user_id') then
    fallos := array_append(fallos, 'A8: owner_user_id esta expuesto en una superficie de api');
  end if;

  -- A9 · privilegios: PUBLIC no, anon no, authenticated si. Y ningun acceso
  -- nuevo a `core`: esta superficie no necesito ni un GRANT.
  if has_function_privilege('public', 'api.observed_balance(uuid[])', 'execute')
     or has_function_privilege('anon', 'api.observed_balance(uuid[])', 'execute') then
    fallos := array_append(fallos, 'A9: PUBLIC o anon pueden ejecutar api.observed_balance');
  end if;
  if not has_function_privilege('authenticated', 'api.observed_balance(uuid[])', 'execute') then
    fallos := array_append(fallos, 'A9b: authenticated no puede ejecutar api.observed_balance');
  end if;
  foreach v_t in array array['personal_operation','personal_operation_version','personal_balance']
  loop
    if not has_table_privilege('authenticated', 'api.' || v_t, 'select') then
      fallos := array_append(fallos, format('A9c: authenticated no puede leer api.%s', v_t));
    end if;
    if has_table_privilege('anon', 'api.' || v_t, 'select') then
      fallos := array_append(fallos, format('A9d: anon puede leer api.%s', v_t));
    end if;
  end loop;
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := array_append(fallos, 'A9e: authenticated gano USAGE sobre core');
  end if;

  -- A10 · EL CRITERIO DE EXCLUSION SIGUE DECLARADO. Es la unica comprobacion
  -- TEXTUAL del fichero, y es el instrumento correcto justamente aqui: lo que
  -- se protege ES la presencia del criterio, no su efecto.
  --
  -- Medido: `ov.version_kind = 'record'` es HOY REDUNDANTE. Quitandolo, todo lo
  -- demas pasa igual, porque una anulacion no tiene efectos y la proyeccion
  -- canonica no le aporta fila. Se conserva porque ADR-024 §2 exige que las
  -- anuladas se excluyan POR `version_kind` y no por ausencia de efectos, y
  -- porque sin la clausula el criterio queda implicito: quien cambie la relacion
  -- base de la vista y vea reaparecer las anuladas ira a buscar un `NOT EXISTS`
  -- sobre `core.effect`, que es lo que la guarda A6 rechaza.
  if pg_get_viewdef('api.personal_operation'::regclass) not like '%version_kind%' then
    fallos := array_append(fallos,
      'A10: api.personal_operation ya no declara el criterio version_kind; las anuladas quedarian excluidas solo por ausencia de efectos (ADR-024 §2)');
  end if;
  -- A10b · y la lista blanca de clases tampoco puede desaparecer sin que se vea.
  if pg_get_viewdef('api.personal_operation'::regclass) not like '%personal_expense%' then
    fallos := array_append(fallos,
      'A10b: api.personal_operation perdio la lista blanca de clases de F6');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'A · estructura:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · tres vistas invoker, una sola funcion sobre la observacion, y ninguna guarda relajada';
end
$a$;

-- ======================= B · la lista normal ===============================
--
-- Escenario de U1 sobre S1, y cada paso existe para comprobar algo:
--
--   1  gasto 20,00 «Compra»            saldo -2000
--   2  ingreso 100,00 «Nomina»         saldo  8000
--   3  CORRECCION del gasto a 25,00, otro concepto, otra categoria y otra hora
--   4  ajuste POR OBJETIVO a 10000     el delta lo deriva el servidor
--   5  ajuste POR DELTA de -500        saldo  9500
--   6  gasto 10,00 que luego se ANULA  el saldo vuelve
--   7  una operacion de clase NO soportada, insertada a mano
do $b$
declare
  fallos text[] := '{}';
  U1   constant text := (select v from rs_fix where k='U1');
  S1   constant text := (select v from rs_fix where k='S1');
  EUR  constant text := (select v from rs_fix where k='EUR');
  GOTR constant text := (select v from rs_fix where k='GOTR');
  GCOM constant text := (select v from rs_fix where k='GCOM');
  IOTR constant text := (select v from rs_fix where k='IOTR');
  r jsonb;
  v_gasto uuid; v_ingreso uuid; v_obj uuid; v_delta uuid; v_anulado uuid;
  v_v1 uuid; v_n int; v_row record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000001',
         'command_contract_version',2,'effective_date','2026-11-01','effective_time','09:00',
         'scope_id',S1,'amount','2000','currency_definition_id',EUR,
         'concept','Compra','category_id',GOTR));
  v_gasto := (r ->> 'operation_id')::uuid;

  r := api.record_personal_income(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000002',
         'command_contract_version',2,'effective_date','2026-11-02','effective_time','08:00',
         'scope_id',S1,'amount','10000','currency_definition_id',EUR,
         'concept','Nomina','category_id',IOTR));
  v_ingreso := (r ->> 'operation_id')::uuid;
  reset role;

  -- CORREGIR el gasto cambiando CUATRO cosas a la vez: importe, concepto,
  -- categoria y hora. Es lo que despues prueba que el historial conserva «que
  -- cambio» y no solo el importe.
  select current_version_id into v_v1 from core.operation where id = v_gasto;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000003',
         'command_contract_version',2,'effective_date','2026-11-01','effective_time','19:30',
         'scope_id',S1,'amount','2500','currency_definition_id',EUR,
         'concept','Compra grande','category_id',GCOM,
         'operation_id',v_gasto,'expected_version_id',v_v1));

  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000004',
         'command_contract_version',2,'effective_date','2026-11-03','effective_time','10:00',
         'scope_id',S1,'currency_definition_id',EUR,'target_balance','10000'));
  v_obj := (r ->> 'operation_id')::uuid;

  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000005',
         'command_contract_version',2,'effective_date','2026-11-04','effective_time','11:00',
         'scope_id',S1,'currency_definition_id',EUR,'delta','-500'));
  v_delta := (r ->> 'operation_id')::uuid;

  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000006',
         'command_contract_version',2,'effective_date','2026-11-05','effective_time','12:00',
         'scope_id',S1,'amount','1000','currency_definition_id',EUR,
         'concept','Se anula','category_id',GOTR));
  v_anulado := (r ->> 'operation_id')::uuid;
  -- `authenticated` NO tiene USAGE sobre `core` —A9e lo comprueba—, asi que
  -- leer el puntero exige salir del rol. Es la propiedad que hace que el
  -- cliente solo pueda entrar por `api`.
  reset role;
  select current_version_id into v_v1 from core.operation where id = v_anulado;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.annul_operation(jsonb_build_object(
         'client_operation_id','e1000000-0000-4000-8000-000000000007',
         'command_contract_version',2,
         'operation_id',v_anulado,'expected_version_id',v_v1));
  reset role;

  insert into rs_fix (k, v) values
    ('OP_GASTO',   v_gasto::text),
    ('OP_INGRESO', v_ingreso::text),
    ('OP_OBJ',     v_obj::text),
    ('OP_DELTA',   v_delta::text),
    ('OP_ANULADO', v_anulado::text);

  -- Una operacion de clase NO SOPORTADA, con dimension de saldo en S1. Se
  -- inserta a mano porque en F6 ninguna funcion la produce todavia sobre un
  -- Modo Personal, y es exactamente el caso que la lista blanca existe para
  -- atajar: sin ella apareceria en la lista en cuanto F9 o F12 la hagan
  -- alcanzable, antes de que el producto sepa representarla.
  insert into core.operation (id, operation_class, created_by, current_version_id)
  values ('e9000000-0000-4000-8000-000000000001', 'internal_transfer', U1::uuid,
          'e9000000-0000-4000-8000-000000000002');
  insert into core.operation_version
    (id, operation_id, version_no, created_by, effective_date, effective_time,
     original_amount, original_currency_definition_id, economic_rules_version)
  values ('e9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000001',
          1, U1::uuid, '2026-11-06', '13:00', 300, EUR::uuid, 'v1');
  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values ('e9000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-000000000002',
          S1::uuid, 'transfer', EUR::uuid, 300);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- B1 · UNA FILA POR OPERACION, y las cuatro que el producto sabe representar.
  -- La anulada fuera; la clase no soportada fuera.
  select count(*) into v_n from api.personal_operation;
  if v_n <> 4 then
    fallos := array_append(fallos,
      format('B1: la lista devuelve %s filas y deberian ser 4 (gasto, ingreso y los dos ajustes)', v_n));
  end if;
  select count(*) into v_n
    from (select operation_id from api.personal_operation group by operation_id having count(*) > 1) d;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B1b: %s operaciones aparecen en mas de una fila', v_n));
  end if;

  -- B2 · LA ANULADA NO ESTA, y la clase no soportada tampoco.
  if exists (select 1 from api.personal_operation where operation_id = v_anulado) then
    fallos := array_append(fallos, 'B2: una operacion anulada aparece en la lista normal');
  end if;
  if exists (select 1 from api.personal_operation
              where operation_class not in ('personal_expense','personal_income','adjustment')) then
    fallos := array_append(fallos, 'B2b: una clase fuera de la lista blanca de F6 aparece en la lista');
  end if;

  -- B3 · EL GASTO CORREGIDO muestra la version VIGENTE, con los dos importes en
  -- su unidad: el saldo firmado y el declarado en positivo.
  select * into v_row from api.personal_operation where operation_id = v_gasto;
  if v_row.balance_amount <> '-2500' then
    fallos := array_append(fallos, format('B3: el saldo del gasto es %s y deberia ser -2500', v_row.balance_amount));
  end if;
  if v_row.original_amount <> '2500' then
    fallos := array_append(fallos, format('B3b: el importe declarado del gasto es %s y deberia ser 2500', v_row.original_amount));
  end if;
  if v_row.concept <> 'Compra grande' or v_row.category_id <> GCOM::uuid then
    fallos := array_append(fallos, 'B3c: la lista no muestra el concepto y la categoria de la version vigente');
  end if;
  if v_row.effective_time <> '19:30'::time then
    fallos := array_append(fallos, 'B3d: la lista no muestra la hora de la version vigente');
  end if;
  -- B3e · «Editado»: version_no > 1 Y el predecesor publicado. El identificador
  -- y no `version_no - 1`, porque ADR-011 §11 no hizo estructural que el
  -- predecesor sea la version anterior.
  if v_row.version_no <> 2 or v_row.previous_version_id is null then
    fallos := array_append(fallos, 'B3e: el gasto corregido no se distingue como editado');
  end if;

  -- B4 · EL INGRESO: saldo positivo y sin predecesor.
  select * into v_row from api.personal_operation where operation_id = v_ingreso;
  if v_row.balance_amount <> '10000' or v_row.original_amount <> '10000' then
    fallos := array_append(fallos, 'B4: el ingreso no suma en positivo');
  end if;
  if v_row.previous_version_id is not null or v_row.version_no <> 1 then
    fallos := array_append(fallos, 'B4b: un ingreso sin corregir aparece como editado');
  end if;

  -- B5 · AJUSTE POR OBJETIVO: sin concepto ni categoria inventados, con el
  -- objetivo declarado, y con el delta DERIVADO como importe.
  select * into v_row from api.personal_operation where operation_id = v_obj;
  if v_row.concept is not null or v_row.category_id is not null then
    fallos := array_append(fallos, 'B5: el ajuste tiene concepto o categoria inventados');
  end if;
  if v_row.target_balance <> '10000' then
    fallos := array_append(fallos, format('B5b: el objetivo declarado es %s y deberia ser 10000', v_row.target_balance));
  end if;
  -- Saldo antes del ajuste: -2500 + 10000 = 7500. Delta derivado: 2500.
  if v_row.original_amount <> '2500' or v_row.balance_amount <> '2500' then
    fallos := array_append(fallos, format('B5c: el delta derivado es %s y deberia ser 2500', v_row.original_amount));
  end if;

  -- B6 · AJUSTE POR DELTA: la otra forma, distinguible por `target_balance`
  -- nulo, y con el delta declarado CON SU SIGNO. Es lo que hace representable
  -- un ajuste manual por importe sin inventarle nada.
  select * into v_row from api.personal_operation where operation_id = v_delta;
  if v_row.target_balance is not null then
    fallos := array_append(fallos, 'B6: un ajuste por delta declara objetivo');
  end if;
  if v_row.original_amount <> '-500' or v_row.balance_amount <> '-500' then
    fallos := array_append(fallos, format('B6b: el delta declarado es %s y deberia ser -500 con su signo', v_row.original_amount));
  end if;
  if v_row.operation_class <> 'adjustment' then
    fallos := array_append(fallos, 'B6c: el ajuste por delta no se distingue como adjustment');
  end if;

  -- B7 · EL ORDEN CANONICO es expresable con las columnas publicadas, y es
  -- TOTAL: cuatro filas distintas, sin empates sin resolver.
  select count(*) into v_n from (
    select row_number() over (order by effective_date desc,
                                       effective_time desc nulls last,
                                       operation_created_at desc,
                                       operation_id desc) as rn,
           operation_id
    from api.personal_operation) t;
  if v_n <> 4 then
    fallos := array_append(fallos, 'B7: el orden canonico no cubre todas las filas');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'B · lista:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · una fila por operacion, las clases de F6, y el ajuste sin nada inventado';
end
$b$;

-- ===================== C · el historial de correcciones ====================
do $c$
declare
  fallos text[] := '{}';
  U1        constant text := (select v from rs_fix where k='U1');
  GOTR      constant text := (select v from rs_fix where k='GOTR');
  v_gasto   constant uuid := (select v from rs_fix where k='OP_GASTO')::uuid;
  v_ingreso constant uuid := (select v from rs_fix where k='OP_INGRESO')::uuid;
  v_obj     constant uuid := (select v from rs_fix where k='OP_OBJ')::uuid;
  v_anulado constant uuid := (select v from rs_fix where k='OP_ANULADO')::uuid;
  v_prev uuid; v_n int; v_row record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- C1 · el gasto corregido tiene DOS versiones, y solo una es la vigente.
  select count(*) into v_n from api.personal_operation_version where operation_id = v_gasto;
  if v_n <> 2 then
    fallos := array_append(fallos, format('C1: el historial del gasto tiene %s versiones y deberian ser 2', v_n));
  end if;
  select count(*) into v_n from api.personal_operation_version
   where operation_id = v_gasto and is_current;
  if v_n <> 1 then
    fallos := array_append(fallos, format('C1b: %s versiones se declaran vigentes y solo puede haber una', v_n));
  end if;

  -- C2 · LA VERSION ANTERIOR CONSERVA LO QUE CAMBIO, y no solo el importe:
  -- importe, concepto, categoria y hora, cada uno tal como aquella version lo
  -- declaro. Es lo que permite pintar la linea tachada del «Editado» y, al
  -- abrir, un diff de verdad.
  select * into v_row from api.personal_operation_version
   where operation_id = v_gasto and not is_current;
  if v_row.original_amount <> '2000' then
    fallos := array_append(fallos, format('C2: la version anterior declara %s y declaraba 2000', v_row.original_amount));
  end if;
  if v_row.concept <> 'Compra' then
    fallos := array_append(fallos, 'C2b: la version anterior perdio su concepto');
  end if;
  if v_row.category_id <> GOTR::uuid then
    fallos := array_append(fallos, 'C2c: la version anterior perdio su categoria');
  end if;
  if v_row.effective_time <> '09:00'::time then
    fallos := array_append(fallos, 'C2d: la version anterior perdio su hora');
  end if;
  if v_row.version_no <> 1 or v_row.supersedes_version_id is not null then
    fallos := array_append(fallos, 'C2e: el linaje de la version anterior no es el esperado');
  end if;

  -- C3 · LA VIA DE UNA SOLA CONSULTA POR PAGINA: el `previous_version_id` que
  -- publica la lista trae exactamente esa fila del historial. Sin esto habria
  -- que llamar una vez por operacion.
  select previous_version_id into v_prev from api.personal_operation where operation_id = v_gasto;
  select count(*) into v_n from api.personal_operation_version
   where operation_version_id = any (array[v_prev]);
  if v_n <> 1 then
    fallos := array_append(fallos, 'C3: previous_version_id no resuelve contra el historial en una sola consulta');
  end if;

  -- C4 · una operacion sin corregir tiene UNA version, y es la vigente.
  select count(*) into v_n from api.personal_operation_version where operation_id = v_ingreso;
  if v_n <> 1 then
    fallos := array_append(fallos, format('C4: el ingreso tiene %s versiones y deberia tener 1', v_n));
  end if;

  -- C5 · el objetivo declarado viaja tambien por version, no solo en la lista.
  select * into v_row from api.personal_operation_version where operation_id = v_obj and is_current;
  if v_row.target_balance <> '10000' then
    fallos := array_append(fallos, 'C5: el historial no conserva el objetivo declarado del ajuste');
  end if;

  -- C6 · LA ANULADA NO TIENE HISTORIAL EN `api`, y es lo decidido: ADR-024 dice
  -- que su trazabilidad solo es alcanzable por VIA INTERNA, y convertirla en
  -- historial la devolveria a la superficie normal por la puerta de atras.
  -- Que la trazabilidad sigue completa lo comprueba §E.
  if exists (select 1 from api.personal_operation_version where operation_id = v_anulado) then
    fallos := array_append(fallos, 'C6: una operacion anulada aparece en el historial de api');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'C · historial:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · el historial conserva importe, concepto, categoria y hora de cada version';
end
$c$;

-- ============================ D · el saldo =================================
do $d$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from rs_fix where k='U1');
  U3 constant text := (select v from rs_fix where k='U3');
  S1 constant text := (select v from rs_fix where k='S1');
  v_n int; v_saldo text; v_derivado bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- D1 · UNA fila, la del ambito del actor.
  select count(*) into v_n from api.personal_balance;
  if v_n <> 1 then
    fallos := array_append(fallos, format('D1: el saldo devuelve %s filas y deberia devolver 1', v_n));
  end if;

  -- D2 · el saldo es el DERIVADO, y coincide exactamente con la proyeccion
  -- canonica. 9500 de las cuatro operaciones + 300 de la clase no soportada.
  select balance_amount into v_saldo from api.personal_balance;
  reset role;
  v_derivado := sec.derive_balance(S1::uuid, null);
  if v_saldo <> v_derivado::text then
    fallos := array_append(fallos,
      format('D2: el saldo expuesto es %s y el derivado es %s', v_saldo, v_derivado));
  end if;
  if v_saldo <> '9800' then
    fallos := array_append(fallos, format('D2b: el saldo es %s y deberia ser 9800', v_saldo));
  end if;

  -- D2c · LA LISTA BLANCA ACOTA LA LISTA, NUNCA EL SALDO. Los 300 de la clase
  -- no soportada NO salen en la lista y SI cuentan en el saldo, que es lo
  -- correcto: el Disponible se deriva de TODOS los efectos vigentes
  -- (ADR-013 §1). Truncarlo a las clases representables daria una cifra falsa
  -- que no falla.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  select coalesce(sum(balance_amount::bigint), 0) into v_derivado from api.personal_operation;
  if v_derivado <> 9500 then
    fallos := array_append(fallos,
      format('D2c: la lista suma %s y deberia sumar 9500, sin la clase no representable', v_derivado));
  end if;

  -- D3 · UN AMBITO SIN EFECTOS DEVUELVE UNA FILA CON 0, no cero filas. Sin
  -- esto, «todavia no hay movimientos» y «no hay Modo Personal» se leerian
  -- igual, y son dos estados que el cliente pinta distinto.
  perform set_config('request.jwt.claims', json_build_object('sub',U3)::text, true);
  select count(*) into v_n from api.personal_balance;
  if v_n <> 1 then
    fallos := array_append(fallos,
      format('D3: un ambito sin efectos devuelve %s filas y deberia devolver 1', v_n));
  end if;
  select balance_amount into v_saldo from api.personal_balance;
  if v_saldo is distinct from '0' then
    fallos := array_append(fallos, format('D3b: un ambito sin efectos devuelve %s y deberia devolver 0', v_saldo));
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'D · saldo:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · el Disponible es derivado, la lista no lo acota, y sin efectos es 0 y no vacio';
end
$d$;

-- ============= E · la anulada: fuera de `api`, intacta en `core` ============
--
-- Es la obligacion de ADR-024 y del handoff: «las anuladas se excluyen de la
-- superficie normal, y debe existir una VIA INTERNA COMPROBABLE de que la
-- trazabilidad permanece». Esta seccion ES esa comprobacion.
do $e$
declare
  fallos text[] := '{}';
  U1        constant text := (select v from rs_fix where k='U1');
  v_anulado constant uuid := (select v from rs_fix where k='OP_ANULADO')::uuid;
  v_n int;
begin
  -- E1 · fuera de LAS TRES superficies de `api`, sin excepcion.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  select (select count(*) from api.personal_operation where operation_id = v_anulado)
       + (select count(*) from api.personal_operation_version where operation_id = v_anulado)
       + (select count(*) from api.observed_balance(array[v_anulado]))
    into v_n;
  if v_n <> 0 then
    fallos := array_append(fallos, format('E1: la anulada asoma %s veces por api', v_n));
  end if;
  reset role;

  -- E2 · NADA SE BORRO. La operacion, sus DOS versiones, los efectos historicos
  -- de la anulada y su detalle siguen todos ahi.
  select count(*) into v_n from core.operation_version where operation_id = v_anulado;
  if v_n <> 2 then
    fallos := array_append(fallos, format('E2: quedan %s versiones de la anulada y deberian ser 2', v_n));
  end if;
  select count(*) into v_n from core.effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_anulado;
  if v_n <> 1 then
    fallos := array_append(fallos, format('E2b: quedan %s efectos historicos de la anulada y deberia quedar 1', v_n));
  end if;
  select count(*) into v_n from core.movement_detail md
    join core.operation_version ov on ov.id = md.operation_version_id
   where ov.operation_id = v_anulado;
  if v_n <> 1 then
    fallos := array_append(fallos, 'E2c: el concepto y la categoria de la anulada se perdieron');
  end if;

  -- E3 · la version vigente ES la anulacion, sin efectos propios.
  if not exists (select 1 from core.operation o join core.operation_version ov on ov.id = o.current_version_id
                  where o.id = v_anulado and ov.version_kind = 'annulment') then
    fallos := array_append(fallos, 'E3: la version vigente de la anulada no es una anulacion');
  end if;

  -- E4 · QUE ES LA «VIA INTERNA», Y QUE NO ES. NO es el cliente leyendo `core`:
  -- `authenticated` no tiene USAGE sobre ese schema (A9e), asi que su unica
  -- puerta es `api` y por ahi la anulada no asoma (E1). La via interna es que
  -- el hecho permanece INTEGRO en `core`, alcanzable por acceso privilegiado
  -- —lo que esta seccion comprueba— y que la version de anulacion sigue siendo
  -- LEGIBLE BAJO RLS por su dueno, que es lo que mide `balance-and-annulment.sql`
  -- §D6 con su vista auxiliar, y cuya falsificacion ya esta registrada en
  -- ADR-024: sin el disyunto de la policy, el cliente mostraria la version
  -- anterior como vigente.
  --
  -- E4b · la observacion de la anulacion sigue existiendo: ADR-023 §4 la escribe
  -- a proposito porque «el borrado es donde peor sienta un hueco de auditoria».
  select count(*) into v_n from core.balance_observation bo
    join core.operation_version ov on ov.id = bo.operation_version_id
   where ov.operation_id = v_anulado and ov.version_kind = 'annulment';
  if v_n <> 1 then
    fallos := array_append(fallos, 'E4b: la anulacion no dejo observacion de saldo');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'E · anulacion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · la anulada no asoma por api, no se borro nada, y la via interna la alcanza entera';
end
$e$;

-- ==================== F · la observacion, por lote =========================
do $f$
declare
  fallos text[] := '{}';
  U1        constant text := (select v from rs_fix where k='U1');
  U2        constant text := (select v from rs_fix where k='U2');
  v_gasto   constant uuid := (select v from rs_fix where k='OP_GASTO')::uuid;
  v_ingreso constant uuid := (select v from rs_fix where k='OP_INGRESO')::uuid;
  v_obj     constant uuid := (select v from rs_fix where k='OP_OBJ')::uuid;
  v_n int; v_before text; v_after text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- F1 · EL LOTE: dos operaciones, UNA llamada. Es lo que evita la N+1 al
  -- pintar una pagina.
  select count(distinct operation_id) into v_n
    from api.observed_balance(array[v_gasto, v_ingreso]);
  if v_n <> 2 then
    fallos := array_append(fallos, format('F1: el lote de dos devuelve %s operaciones', v_n));
  end if;

  -- F1b · y EL DETALLE REUTILIZA LA MISMA SUPERFICIE con un array de uno.
  select count(*) into v_n from api.observed_balance(array[v_obj]);
  if v_n < 1 then
    fallos := array_append(fallos, 'F1b: el detalle de una sola operacion no devuelve su observacion');
  end if;

  -- F2 · el gasto CORREGIDO tiene observacion de sus DOS versiones, y solo una
  -- se declara vigente. Cada una es del instante en que su version se escribio.
  select count(*) into v_n from api.observed_balance(array[v_gasto]);
  if v_n <> 2 then
    fallos := array_append(fallos, format('F2: el gasto corregido tiene %s observaciones y deberian ser 2', v_n));
  end if;
  select count(*) into v_n from api.observed_balance(array[v_gasto]) where is_current;
  if v_n <> 1 then
    fallos := array_append(fallos, 'F2b: is_current no separa la observacion de la version vigente');
  end if;

  -- F3 · EL «ANTES» DEL AJUSTE POR OBJETIVO. Saldo antes: -2500 + 10000 = 7500.
  -- Despues: el objetivo, 10000. Es la fotografia con la que el producto pinta
  -- la linea tachada, y sale de la observacion y NO del Disponible.
  select observed_balance_before, observed_balance_after into v_before, v_after
    from api.observed_balance(array[v_obj]) where is_current;
  if v_before <> '7500' or v_after <> '10000' then
    fallos := array_append(fallos,
      format('F3: la observacion del ajuste es %s -> %s y deberia ser 7500 -> 10000', v_before, v_after));
  end if;

  -- F4 · sin argumento devuelve las del actor, y NINGUNA de la anulada ni de la
  -- clase no soportada: hereda el ancla de `api.personal_operation`.
  select count(distinct operation_id) into v_n from api.observed_balance();
  if v_n <> 4 then
    fallos := array_append(fallos,
      format('F4: sin argumento devuelve %s operaciones y deberian ser las 4 de la lista', v_n));
  end if;

  -- F5 · NO ES UN ORACULO. Un identificador ajeno —y uno inventado— devuelven
  -- CERO FILAS SIN ERROR: no hay canal de error del que deducir existencia.
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);
  begin
    select count(*) into v_n from api.observed_balance(array[v_gasto, v_obj]);
    if v_n <> 0 then
      fallos := array_append(fallos, format('F5: un actor ajeno alcanza %s observaciones', v_n));
    end if;
  exception when others then
    fallos := array_append(fallos, 'F5b: un identificador ajeno produce ERROR, que es un oraculo de existencia');
  end;
  begin
    select count(*) into v_n from api.observed_balance(array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid]);
    if v_n <> 0 then
      fallos := array_append(fallos, 'F5c: un identificador inventado devuelve filas');
    end if;
  exception when others then
    fallos := array_append(fallos, 'F5d: un identificador inventado produce ERROR');
  end;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'F · observacion:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · la observacion sale por lote, separa la vigente, y un id ajeno da cero filas sin error';
end
$f$;

-- ===================== G · aislamiento entre actores =======================
do $g$
declare
  fallos text[] := '{}';
  U2 constant text := (select v from rs_fix where k='U2');
  S2 constant text := (select v from rs_fix where k='S2');
  v_n int; v_saldo text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);

  -- G1 · U2 no ve NI UNA fila de U1 por ninguna de las tres vistas.
  select (select count(*) from api.personal_operation)
       + (select count(*) from api.personal_operation_version)
    into v_n;
  if v_n <> 0 then
    fallos := array_append(fallos, format('G1: U2 alcanza %s filas de operaciones ajenas', v_n));
  end if;

  -- G2 · y su saldo es el SUYO: una fila, cero, no el de U1.
  select count(*) into v_n from api.personal_balance;
  if v_n <> 1 then
    fallos := array_append(fallos, format('G2: U2 ve %s ambitos y deberia ver el suyo', v_n));
  end if;
  select balance_amount into v_saldo from api.personal_balance;
  if v_saldo is distinct from '0' then
    fallos := array_append(fallos, format('G2b: el saldo de U2 es %s y deberia ser 0', v_saldo));
  end if;
  if not exists (select 1 from api.personal_balance where scope_id = S2::uuid) then
    fallos := array_append(fallos, 'G2c: el ambito que U2 ve no es el suyo');
  end if;

  -- G3 · SIN IDENTIDAD no se ve nada. Es la comprobacion que E19 hizo
  -- imprescindible: sin `security_invoker` se filtraban filas de otro ambito
  -- INCLUSO SIN SESION.
  perform set_config('request.jwt.claims', '', true);
  select (select count(*) from api.personal_operation)
       + (select count(*) from api.personal_operation_version)
       + (select count(*) from api.personal_balance)
    into v_n;
  if v_n <> 0 then
    fallos := array_append(fallos, format('G3: sin identidad se alcanzan %s filas', v_n));
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'G · aislamiento:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · cada actor ve lo suyo, y sin identidad no se ve nada';
end
$g$;

rollback;

\echo 'read-surface: OK'
