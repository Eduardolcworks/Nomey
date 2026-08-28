-- Comprobaciones de las estadisticas agregadas del Modo Personal.
-- F6.E, contra la base REAL construida por las migraciones.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/personal-statistics.sql
--
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- La seccion que justifica que esta superficie exista es la §F: MAS DE MIL
-- operaciones agregadas sin truncamiento. Es lo que ninguna agregacion en
-- cliente puede hacer contra `max_rows = 1000`, y lo que se midio antes de
-- decidir: PostgREST 16.1 rechaza las funciones de agregado con
-- `PGRST123 · 400`.

\pset pager off
\set ON_ERROR_STOP on

begin;

create temporary table st_fix (k text primary key, v text) on commit drop;
insert into st_fix (k, v) values
  ('U1',   'f1111111-1111-4111-8111-111111111111'),
  ('U2',   'f2222222-2222-4222-8222-222222222222'),
  -- U3 tiene ambito y ni un movimiento; U4 no tiene ambito en absoluto.
  ('U3',   'f3333333-3333-4333-8333-333333333333'),
  ('U4',   'f4444444-4444-4444-8444-444444444444'),
  ('S1',   'f0000000-0000-4000-8000-000000000001'),
  ('S2',   'f0000000-0000-4000-8000-000000000002'),
  ('S3',   'f0000000-0000-4000-8000-000000000003'),
  ('EUR',  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  ('GCOM', '80088454-77aa-51ae-864e-523ca74d66eb'),  -- gasto · alimentacion
  ('GTRA', 'aeb60340-1e68-5e50-a653-905b9ebe287c'),  -- gasto · transporte
  ('GHOG', '0bcc36c9-4307-5ad1-9e55-e71f8b6d0d31'),  -- gasto · hogar
  ('GOCI', '21c05d21-bbd2-5aa3-bd9c-17422a5eccf8'),  -- gasto · ocio
  ('GOTR', '4ed30a44-9f82-578f-828c-b491a25ebdd9'),  -- gasto · otros
  ('ISAL', 'a04cc703-9316-52a0-83f3-9b82933c6702'),  -- ingreso · nomina
  ('IOTR', 'ea9f1167-f497-5edf-af01-c7e1c3a64d9d');  -- ingreso · otros

insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from st_fix where k = s)::uuid, 'personal',
       (select v from st_fix where k = 'EUR')::uuid,
       (select v from st_fix where k = u)::uuid
from (values ('S1','U1'), ('S2','U2'), ('S3','U3')) as t(s, u);

insert into core.membership (scope_id, user_id)
select (select v from st_fix where k = s)::uuid, (select v from st_fix where k = u)::uuid
from (values ('S1','U1'), ('S2','U2'), ('S3','U3')) as t(s, u);

-- ==================== A · estructura, guardas y privilegios ================
do $a$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- A1 · existe, y con la firma acordada.
  if to_regprocedure('api.personal_statistics(date,date)') is null then
    fallos := array_append(fallos, 'A1: no existe api.personal_statistics(date,date)');
  end if;

  -- A2 · NO atraviesa la RLS. Es lo mismo que `api.observed_balance` y lo
  -- contrario de `api.claimed_dimension()`, que si debe atravesarla.
  if exists (select 1 from pg_proc where oid = 'api.personal_statistics(date,date)'::regprocedure
               and prosecdef) then
    fallos := array_append(fallos, 'A2: es SECURITY DEFINER y atravesaria la RLS');
  end if;
  if not exists (select 1 from pg_proc where oid = 'api.personal_statistics(date,date)'::regprocedure
                   and provolatile = 's' and proconfig = array['search_path=""']) then
    fallos := array_append(fallos, 'A2b: no es STABLE con search_path fijado a vacio');
  end if;

  -- A3 · GUARDA DE ADR-013 §9, INTACTA. La funcion se apoya en las vistas de
  -- `api` y NO toca `core.effect`. `BEGIN ATOMIC` es lo que hace comprobable
  -- esta afirmacion: con cuerpo textual el catalogo no registraria nada.
  select count(*) into v_n
    from pg_depend d join pg_proc p on p.oid = d.objid
   where d.refobjid = 'core.effect'::regclass and d.classid = 'pg_proc'::regclass;
  if v_n <> 0 then
    fallos := array_append(fallos, format('A3: %s funciones dependen directamente de core.effect', v_n));
  end if;

  -- A3b · POSITIVO: y SI deja dependencia de las dos superficies que compone.
  -- Sin esto, A3 no estaria vigilando nada de esta funcion.
  foreach v_n in array array[1] loop end loop;
  if not exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.refobjid
     where d.objid = 'api.personal_statistics(date,date)'::regprocedure
       and d.classid = 'pg_proc'::regclass and c.relname = 'personal_effect')
     or not exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.refobjid
     where d.objid = 'api.personal_statistics(date,date)'::regprocedure
       and d.classid = 'pg_proc'::regclass and c.relname = 'personal_operation') then
    fallos := array_append(fallos,
      'A3b: no deja dependencia de catalogo hacia personal_effect y personal_operation; su cuerpo no es BEGIN ATOMIC');
  end if;

  -- A4 · GUARDA DE ADR-023, INTACTA. La observacion sigue sin consumidores
  -- nuevos: la estadistica NO se deriva de ella.
  if exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.refobjid
     where d.objid = 'api.personal_statistics(date,date)'::regprocedure
       and d.classid = 'pg_proc'::regclass and c.relname = 'balance_observation') then
    fallos := array_append(fallos, 'A4: la estadistica depende de la observacion de saldo');
  end if;

  -- A5 · ningun acceso nuevo a `core`, ni schema ni tabla.
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := array_append(fallos, 'A5: authenticated gano USAGE sobre core');
  end if;
  select count(*) into v_n
    from information_schema.table_privileges
   where table_schema = 'core' and grantee in ('anon','authenticated','service_role')
     and privilege_type <> 'SELECT';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5b: los roles cliente tienen %s privilegios de core distintos de SELECT', v_n));
  end if;

  -- A6 · EXECUTE: PUBLIC no, anon no, authenticated si.
  if has_function_privilege('public', 'api.personal_statistics(date,date)', 'execute')
     or has_function_privilege('anon', 'api.personal_statistics(date,date)', 'execute') then
    fallos := array_append(fallos, 'A6: PUBLIC o anon pueden ejecutar la estadistica');
  end if;
  if not has_function_privilege('authenticated', 'api.personal_statistics(date,date)', 'execute') then
    fallos := array_append(fallos, 'A6b: authenticated no puede ejecutarla');
  end if;

  -- A7 · las cuatro superficies de ADR-025 SIGUEN EXISTIENDO. ADR-026 anade una
  -- quinta; no sustituye ninguna.
  foreach v_n in array array[1] loop end loop;
  if to_regclass('api.personal_operation') is null
     or to_regclass('api.personal_operation_version') is null
     or to_regclass('api.personal_balance') is null
     or to_regprocedure('api.observed_balance(uuid[])') is null then
    fallos := array_append(fallos, 'A7: ADR-026 se llevo por delante alguna superficie de ADR-025');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'A · estructura:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · invoker, sin core.effect, sin la observacion, y las cuatro de ADR-025 intactas';
end
$a$;

-- ===================== B · el escenario, y la forma =======================
--
-- Noviembre de 2026 en S1:
--
--   gastos    3 × alimentacion  1000 + 2000 + 3000 = 6000
--             1 × otros                             4000
--             2 × transporte     1500 +  500      = 2000
--             1 × hogar                             100
--             1 × ocio                               50
--                                        TOTAL   = 12150
--   ingresos  nomina 10000 + otros 5000          = 15000
--   ajustes   uno por objetivo y uno por delta   -> NO cuentan
--   anulado   un gasto de 9999                   -> NO cuenta
--   fuera     un gasto de 7777 en diciembre      -> NO cuenta en noviembre
do $b$
declare
  fallos text[] := '{}';
  U1   constant text := (select v from st_fix where k='U1');
  S1   constant text := (select v from st_fix where k='S1');
  EUR  constant text := (select v from st_fix where k='EUR');
  r jsonb; s jsonb; v_op uuid; v_v uuid; i int;
  -- Se resuelven ANTES de cambiar de rol: la tabla temporal pertenece a
  -- `postgres` y `authenticated` no tiene privilegio sobre ella. Esa
  -- separacion es la que estos checks quieren conservar, asi que se respeta
  -- en vez de concederle un GRANT al rol cliente.
  GCOM constant text := (select v from st_fix where k='GCOM');
  GTRA constant text := (select v from st_fix where k='GTRA');
  GHOG constant text := (select v from st_fix where k='GHOG');
  GOCI constant text := (select v from st_fix where k='GOCI');
  GOTR constant text := (select v from st_fix where k='GOTR');
  ISAL constant text := (select v from st_fix where k='ISAL');
  IOTR constant text := (select v from st_fix where k='IOTR');
  c_import constant bigint[] := array[1000,2000,3000,4000,1500,500,100,50];
  c_cat text[];
begin
  c_cat := array[GCOM, GCOM, GCOM, GOTR, GTRA, GTRA, GHOG, GOCI];

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  for i in 1 .. array_length(c_cat, 1) loop
    perform api.record_personal_expense(jsonb_build_object(
      'client_operation_id', ('f1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      'command_contract_version', 2,
      'effective_date', '2026-11-' || lpad(((i % 20) + 1)::text, 2, '0'),
      'effective_time', '09:00',
      'scope_id', S1, 'amount', c_import[i]::text, 'currency_definition_id', EUR,
      'concept', 'Gasto ' || i,
      'category_id', c_cat[i]));
  end loop;

  perform api.record_personal_income(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000101','command_contract_version',2,
    'effective_date','2026-11-01','effective_time','08:00',
    'scope_id',S1,'amount','10000','currency_definition_id',EUR,
    'concept','Nomina','category_id',ISAL));
  perform api.record_personal_income(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000102','command_contract_version',2,
    'effective_date','2026-11-15','effective_time','08:00',
    'scope_id',S1,'amount','5000','currency_definition_id',EUR,
    'concept','Extra','category_id',IOTR));

  -- Los dos ajustes. NINGUNA clausula los excluye: no producen economica.
  perform api.record_adjustment(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000103','command_contract_version',2,
    'effective_date','2026-11-20','effective_time','10:00',
    'scope_id',S1,'currency_definition_id',EUR,'target_balance','50000'));
  perform api.record_adjustment(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000104','command_contract_version',2,
    'effective_date','2026-11-21','effective_time','11:00',
    'scope_id',S1,'currency_definition_id',EUR,'delta','-700'));

  -- Un gasto que se anula: no puede contar en ninguna cifra.
  r := api.record_personal_expense(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000105','command_contract_version',2,
    'effective_date','2026-11-22','effective_time','12:00',
    'scope_id',S1,'amount','9999','currency_definition_id',EUR,
    'concept','Se anula','category_id',GCOM));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  select current_version_id into v_v from core.operation where id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  perform api.annul_operation(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000106','command_contract_version',2,
    'operation_id',v_op,'expected_version_id',v_v));

  -- Y uno en diciembre, para que el intervalo tenga algo que dejar fuera.
  perform api.record_personal_expense(jsonb_build_object(
    'client_operation_id','f1000000-0000-4000-8000-000000000107','command_contract_version',2,
    'effective_date','2026-12-05','effective_time','12:00',
    'scope_id',S1,'amount','7777','currency_definition_id',EUR,
    'concept','Diciembre','category_id',GTRA));

  s := api.personal_statistics('2026-11-01', '2026-11-30');

  -- B1 · la forma, entera.
  if s is null then
    fallos := array_append(fallos, 'B1: devolvio NULL teniendo ambito');
  else
    if (s ->> 'scope_id') is distinct from S1 then
      fallos := array_append(fallos, 'B1b: no identifica el ambito del actor');
    end if;
    if (s ->> 'currency_definition_id') is distinct from EUR then
      fallos := array_append(fallos, 'B1c: no identifica la moneda de los totales');
    end if;
    if (s ->> 'from') is distinct from '2026-11-01' or (s ->> 'to') is distinct from '2026-11-30' then
      fallos := array_append(fallos, 'B1d: no devuelve el intervalo que se le pidio');
    end if;
  end if;

  -- B2 · TODO IMPORTE ES UNA CADENA JSON. El check de catalogo cuenta columnas
  -- `bigint` y no ve dentro de un `jsonb`, asi que se comprueba aqui.
  if jsonb_typeof(s -> 'income_total') <> 'string'
     or jsonb_typeof(s -> 'expense_total') <> 'string' then
    fallos := array_append(fallos, 'B2: un total cruza como number JSON y se degradaria al parsearse');
  end if;
  if exists (select 1 from jsonb_array_elements(s -> 'categories') e
              where jsonb_typeof(e -> 'expense_total') <> 'string') then
    fallos := array_append(fallos, 'B2b: un importe por categoria cruza como number JSON');
  end if;
  -- El contador SI es un numero: no es un importe.
  if exists (select 1 from jsonb_array_elements(s -> 'categories') e
              where jsonb_typeof(e -> 'operation_count') <> 'number') then
    fallos := array_append(fallos, 'B2c: operation_count no es un numero');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'B · forma:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · una sola llamada devuelve ambito, moneda, intervalo y los importes como texto';
end
$b$;

-- ============ C · los totales, y lo que NO los contamina ==================
do $c$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from st_fix where k='U1');
  s jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  s := api.personal_statistics('2026-11-01', '2026-11-30');

  -- C1 · los totales exactos.
  if (s ->> 'income_total') <> '15000' then
    fallos := array_append(fallos, format('C1: los ingresos son %s y deberian ser 15000', s ->> 'income_total'));
  end if;
  if (s ->> 'expense_total') <> '12150' then
    fallos := array_append(fallos, format('C1b: los gastos son %s y deberian ser 12150', s ->> 'expense_total'));
  end if;

  -- C2 · LOS AJUSTES NO CONTAMINAN, y no hay ninguna clausula que los excluya:
  -- no producen dimension economica. Si alguno se colara, el total de gastos
  -- subiria en 700 (el delta negativo) o el de ingresos en 50000 (el objetivo).
  --
  -- FALSIFICADO, y el resultado merece quedar escrito. Ampliar el filtro de
  -- clase a `in ('expense','adjustment')` NO hace fallar nada: `economic_amount
  -- is not null` sigue dejandolos fuera porque un ajuste no tiene esa
  -- dimension. La exclusion no depende de acertar con la clase, y esa es
  -- justamente la propiedad estructural que ADR-002 §4 quiere.
  --
  -- Lo que SI falsifica es sumar desde `balance_amount` en vez de
  -- `economic_amount` —la «segunda aritmetica» que ADR-026 rechaza—: el saldo
  -- lo mueve toda clase, y entonces los ingresos suben a 62150 y los gastos a
  -- 12850. Ahi es donde este bloque muerde.
  --
  -- Se comprueba tambien que el ajuste SI existe y SI mueve el saldo, para que
  -- este bloque no pase por no haber ajustes que ignorar.
  reset role;
  if not exists (select 1 from core.operation where operation_class = 'adjustment') then
    fallos := array_append(fallos, 'C2: no hay ningun ajuste, asi que la comprobacion seria vacia');
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  if (s ->> 'expense_total')::bigint <> 12150 or (s ->> 'income_total')::bigint <> 15000 then
    fallos := array_append(fallos, 'C2b: un ajuste entro en las estadisticas');
  end if;

  -- C3 · LA ANULADA TAMPOCO. Su gasto de 9999 no aparece por ningun lado.
  if (s ->> 'expense_total')::bigint = 12150 + 9999 then
    fallos := array_append(fallos, 'C3: el gasto anulado sigue contando');
  end if;

  -- C4 · y diciembre queda fuera de noviembre.
  if (s ->> 'expense_total')::bigint = 12150 + 7777 then
    fallos := array_append(fallos, 'C4: un gasto de otro mes entro en el intervalo');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'C · totales:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · ingresos y gastos exactos; ajustes, anuladas y otro mes fuera sin clausula que los excluya';
end
$c$;

-- ================== D · el reparto por categoria ==========================
do $d$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from st_fix where k='U1');
  s jsonb; cats jsonb; v_suma bigint; v_top text[];
  -- Resueltos antes del cambio de rol, por el mismo motivo que en §B.
  GCOM constant text := (select v from st_fix where k='GCOM');
  GTRA constant text := (select v from st_fix where k='GTRA');
  GHOG constant text := (select v from st_fix where k='GHOG');
  GOCI constant text := (select v from st_fix where k='GOCI');
  GOTR constant text := (select v from st_fix where k='GOTR');
  ISAL constant text := (select v from st_fix where k='ISAL');
  IOTR constant text := (select v from st_fix where k='IOTR');
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  s := api.personal_statistics('2026-11-01', '2026-11-30');
  cats := s -> 'categories';

  -- D1 · CINCO categorias, el reparto COMPLETO. El top 4 lo decide la
  -- presentacion, no esta funcion: la tarjeta despliega el resto y lo
  -- necesitaria de todas formas.
  if jsonb_array_length(cats) <> 5 then
    fallos := array_append(fallos, format('D1: hay %s categorias y deberian ser 5', jsonb_array_length(cats)));
  end if;

  -- D2 · ORDENADAS de mayor a menor. Es lo que permite que el cliente tome las
  -- cuatro primeras sin reordenar ni volver a decidir nada.
  select array_agg(e ->> 'category_id' order by ord) into v_top
    from jsonb_array_elements(cats) with ordinality as t(e, ord);
  if v_top[1] <> GCOM or v_top[2] <> GOTR or v_top[3] <> GTRA
     or v_top[4] <> GHOG or v_top[5] <> GOCI then
    fallos := array_append(fallos, 'D2: el reparto no viene ordenado de mayor a menor');
  end if;

  -- D3 · los importes de cada una.
  if (cats -> 0 ->> 'expense_total') <> '6000'
     or (cats -> 0 ->> 'operation_count')::int <> 3 then
    fallos := array_append(fallos, 'D3: la categoria mayor no suma 6000 en 3 operaciones');
  end if;
  if (cats -> 2 ->> 'expense_total') <> '2000'
     or (cats -> 2 ->> 'operation_count')::int <> 2 then
    fallos := array_append(fallos, 'D3b: transporte no suma 2000 en 2 operaciones');
  end if;

  -- D4 · LA AFIRMACION CENTRAL DE ADR-026, y la razon por la que componer dos
  -- superficies no crea una segunda autoridad economica:
  --
  --   sum(categorias)  ==  expense_total
  --
  -- La izquierda sale de `api.personal_operation`; la derecha, de
  -- `api.personal_effect`. Si dejaran de coincidir hasta la unidad minima,
  -- alguien habria introducido la segunda verdad que el ADR dice que no existe.
  select coalesce(sum((e ->> 'expense_total')::bigint), 0) into v_suma
    from jsonb_array_elements(cats) e;
  if v_suma <> (s ->> 'expense_total')::bigint then
    fallos := array_append(fallos,
      format('D4: las categorias suman %s y el total de gastos es %s: hay dos autoridades economicas',
             v_suma, s ->> 'expense_total'));
  end if;

  -- D5 · el reparto sale de gastos y SOLO de gastos: ninguna categoria de
  -- ingreso aparece, pese a que los ingresos tambien la llevan.
  if exists (select 1 from jsonb_array_elements(cats) e
              where (e ->> 'category_id') in (ISAL, IOTR)) then
    fallos := array_append(fallos, 'D5: una categoria de ingreso entro en el reparto de gastos');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'D · categorias:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · reparto completo y ordenado, y su suma es IDENTICA al total de gastos';
end
$d$;

-- ================ E · intervalos cerrados, y `Todo` =======================
do $e$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from st_fix where k='U1');
  U3 constant text := (select v from st_fix where k='U3');
  U4 constant text := (select v from st_fix where k='U4');
  s jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- E1 · `Todo`: sin limites, entra tambien diciembre.
  s := api.personal_statistics(null, null);
  if (s ->> 'expense_total')::bigint <> 12150 + 7777 then
    fallos := array_append(fallos,
      format('E1: sin limites los gastos son %s y deberian ser 19927', s ->> 'expense_total'));
  end if;
  if (s -> 'from') <> 'null'::jsonb or (s -> 'to') <> 'null'::jsonb then
    fallos := array_append(fallos, 'E1b: `Todo` no se refleja como intervalo sin limites');
  end if;

  -- E2 · EL INTERVALO ES CERRADO POR LOS DOS EXTREMOS. El gasto del dia 1
  -- —el ingreso de nomina y el primer gasto— tiene que entrar cuando el limite
  -- inferior ES ese dia, y el ultimo dia igual. Con un intervalo semiabierto,
  -- pedir noviembre exigiria pasar el 1 de diciembre.
  s := api.personal_statistics('2026-11-01', '2026-11-01');
  if (s ->> 'income_total')::bigint <> 10000 then
    fallos := array_append(fallos,
      format('E2: un solo dia devuelve %s de ingresos y el limite inferior deberia ser inclusivo', s ->> 'income_total'));
  end if;
  s := api.personal_statistics('2026-12-05', '2026-12-05');
  if (s ->> 'expense_total')::bigint <> 7777 then
    fallos := array_append(fallos, 'E2b: el limite superior no es inclusivo');
  end if;

  -- E3 · un limite solo. `from` sin `to` es «desde entonces».
  s := api.personal_statistics('2026-12-01', null);
  if (s ->> 'expense_total')::bigint <> 7777 then
    fallos := array_append(fallos, 'E3: un intervalo abierto por arriba no funciona');
  end if;
  s := api.personal_statistics(null, '2026-11-30');
  if (s ->> 'expense_total')::bigint <> 12150 then
    fallos := array_append(fallos, 'E3b: un intervalo abierto por abajo no funciona');
  end if;

  -- E4 · un intervalo VACIO devuelve ceros y lista vacia, nunca NULL ni un
  -- porcentaje inventado. Es el caso `expense_total = 0` definido.
  s := api.personal_statistics('2026-01-01', '2026-01-31');
  if s is null then
    fallos := array_append(fallos, 'E4: un intervalo sin movimientos devolvio NULL');
  elsif (s ->> 'expense_total') <> '0' or (s ->> 'income_total') <> '0'
        or jsonb_array_length(s -> 'categories') <> 0 then
    fallos := array_append(fallos, 'E4b: un intervalo sin movimientos no devuelve ceros y lista vacia');
  end if;

  -- E5 · AMBITO SIN MOVIMIENTOS frente a AMBITO INEXISTENTE. Son dos estados
  -- distintos y el cliente los pinta distinto: el segundo es el que dispara el
  -- provisioning.
  perform set_config('request.jwt.claims', json_build_object('sub',U3)::text, true);
  s := api.personal_statistics(null, null);
  if s is null then
    fallos := array_append(fallos, 'E5: un ambito sin movimientos se confundio con un ambito ausente');
  elsif (s ->> 'expense_total') <> '0' or jsonb_array_length(s -> 'categories') <> 0 then
    fallos := array_append(fallos, 'E5b: un ambito sin movimientos no devuelve ceros');
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub',U4)::text, true);
  if api.personal_statistics(null, null) is not null then
    fallos := array_append(fallos, 'E5c: un actor SIN ambito no devuelve NULL');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'E · intervalos:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · intervalo cerrado, limites opcionales, y sin ambito NULL frente a sin movimientos 0';
end
$e$;

-- ============ F · MAS DE MIL OPERACIONES, SIN TRUNCAMIENTO ================
--
-- La seccion que justifica que esta superficie exista. `max_rows = 1000` es un
-- tope DURO de PostgREST por peticion, y las funciones de agregado estan
-- deshabilitadas —medido: `PGRST123 · 400`—, asi que agregar en cliente sobre
-- un año con mas de mil movimientos devolveria una cifra INCOMPLETA que no
-- falla. Aqui se comprueba que la agregacion del servidor no tiene ese techo.
--
-- Las 1200 operaciones se insertan a mano y no por la frontera: 1200 llamadas
-- al writer tardarian minutos y lo que se mide es la AGREGACION, no la
-- escritura, que ya tiene sus propios checks. Se escriben con la misma forma
-- exacta que produce `record_personal_expense`: balance negativo, economica
-- positiva sin participante, clase `expense`, y su fila de detalle.
do $f$
declare
  fallos text[] := '{}';
  U2  constant text := (select v from st_fix where k='U2');
  S2  constant text := (select v from st_fix where k='S2');
  EUR constant text := (select v from st_fix where k='EUR');
  c_n constant int := 1200;
  s jsonb; v_filas int; v_suma bigint;
begin
  -- Importe i para la operacion i: la suma es 1200·1201/2 = 720600, un numero
  -- que solo sale bien si estan las 1200.
  insert into core.operation (id, operation_class, created_by, current_version_id)
  select ('f5000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         'personal_expense', U2::uuid,
         ('f6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
    from generate_series(1, c_n) i;

  insert into core.operation_version
    (id, operation_id, version_no, created_by, effective_date, effective_time,
     original_amount, original_currency_definition_id, economic_rules_version)
  select ('f6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         ('f5000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         1, U2::uuid, date '2026-01-01' + ((i % 365) || ' days')::interval, '09:00',
         i, EUR::uuid, 'v1'
    from generate_series(1, c_n) i;

  insert into core.movement_detail (operation_version_id, concept, category_id, applies_to)
  select ('f6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         'Volumen ' || i,
         -- Dos categorias alternas, para que el reparto tambien se mida a escala.
         case when i % 2 = 0 then (select v from st_fix where k='GCOM')::uuid
                             else (select v from st_fix where k='GTRA')::uuid end,
         'expense'
    from generate_series(1, c_n) i;

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  select ('f7000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         ('f6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         S2::uuid, 'expense', EUR::uuid, -i, i, null
    from generate_series(1, c_n) i;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);

  -- F1 · el control: hay MAS de mil filas, asi que el tope es alcanzable.
  select count(*) into v_filas from api.personal_operation;
  if v_filas <= 1000 then
    fallos := array_append(fallos,
      format('F1: solo hay %s operaciones; por debajo del tope la prueba seria vacia', v_filas));
  end if;

  -- F2 · Y LA AGREGACION LAS VE TODAS. 1+2+...+1200 = 720600.
  s := api.personal_statistics(null, null);
  if (s ->> 'expense_total') <> '720600' then
    fallos := array_append(fallos,
      format('F2: con %s operaciones el total es %s y deberia ser 720600: hay truncamiento',
             v_filas, s ->> 'expense_total'));
  end if;

  -- F3 · y el reparto por categoria tampoco se trunca: sus dos categorias
  -- vuelven a sumar exactamente el total.
  select coalesce(sum((e ->> 'expense_total')::bigint), 0) into v_suma
    from jsonb_array_elements(s -> 'categories') e;
  if v_suma <> 720600 then
    fallos := array_append(fallos,
      format('F3: el reparto suma %s y deberia sumar 720600', v_suma));
  end if;
  if (select sum((e ->> 'operation_count')::int) from jsonb_array_elements(s -> 'categories') e) <> c_n then
    fallos := array_append(fallos, 'F3b: el recuento por categoria no cubre las 1200 operaciones');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'F · volumen:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · 1200 operaciones agregadas sin truncamiento, con max_rows en 1000';
end
$f$;

-- ===================== G · aislamiento entre actores ======================
do $g$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from st_fix where k='U1');
  U2 constant text := (select v from st_fix where k='U2');
  S1 constant text := (select v from st_fix where k='S1');
  s jsonb;
begin
  -- G1 · U1 no ve el volumen de U2, y sigue viendo lo suyo.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  s := api.personal_statistics(null, null);
  if (s ->> 'scope_id') is distinct from S1 then
    fallos := array_append(fallos, 'G1: U1 recibe estadisticas de un ambito ajeno');
  end if;
  if (s ->> 'expense_total')::bigint <> 12150 + 7777 then
    fallos := array_append(fallos,
      format('G1b: los gastos de U1 son %s y las 1200 operaciones de U2 se le colaron', s ->> 'expense_total'));
  end if;

  -- G2 · y U2 no ve nada de U1.
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);
  s := api.personal_statistics(null, null);
  if (s ->> 'expense_total')::bigint <> 720600 then
    fallos := array_append(fallos, 'G2: U2 ve gastos que no son suyos');
  end if;

  -- G3 · SIN IDENTIDAD no hay estadistica. Es la comprobacion que E19 hizo
  -- imprescindible: la cadena de vistas `security_invoker` es lo que la
  -- sostiene, y esta funcion se apoya entera en ella.
  perform set_config('request.jwt.claims', '', true);
  if api.personal_statistics(null, null) is not null then
    fallos := array_append(fallos, 'G3: sin identidad se obtienen estadisticas');
  end if;

  reset role;
  if array_length(fallos, 1) is not null then
    raise exception E'G · aislamiento:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · cada actor recibe lo suyo, y sin identidad no hay estadistica';
end
$g$;

rollback;

\echo 'personal-statistics: OK'
