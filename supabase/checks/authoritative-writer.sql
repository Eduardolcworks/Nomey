-- Comprobaciones de la frontera autoritativa de escritura · 7a.
--
-- Uso, desde Ubuntu y con el stack levantado. EXIGE el prologo de vectores,
-- porque la seccion F los compara contra la implementacion de PostgreSQL:
--
--   { ./scripts/vectors-prelude.sh ; cat supabase/checks/authoritative-writer.sql ; } \
--     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--         -X -q -v ON_ERROR_STOP=1
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ============================ A · catalogo y privilegios ===================
do $estructura$
declare
  fallos text[] := '{}';
  v_fn text;
  v_n int;
begin
  -- A1 · la superficie de escritura completa, y nada mas. Eran cuatro con 7a;
  -- son SIETE desde 7b, que anadio las tres clases con deuda. La cifra se
  -- actualiza aqui a proposito en vez de relajar la comprobacion a «al menos»:
  -- lo que este test protege es que la superficie sea ENUMERABLE.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname like 'record\_%';
  if v_n <> 8 then
    fallos := array_append(fallos, format('A1: hay %s funciones api.record_* y deberian ser 8', v_n));
  end if;

  -- A2 · atributos exigidos por ADR-009 §4 y §5, una por una.
  foreach v_fn in array array['api.record_adjustment(jsonb)',
                              'api.record_personal_expense(jsonb)',
                              'api.record_external_transfer(jsonb)',
                              'api.record_internal_transfer(jsonb)']
  loop
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure and prosecdef) then
      fallos := array_append(fallos, format('A2: %s no es SECURITY DEFINER', v_fn));
    end if;
    -- El owner es el WRITER, no postgres: es lo que la mantiene DEBAJO de la
    -- RLS. E16 midio que una policy WITH CHECK detuvo una escritura indebida
    -- que el codigo habria dejado pasar.
    if (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn::regprocedure) <> 'nomey_writer' then
      fallos := array_append(fallos, format('A2b: el owner de %s no es nomey_writer', v_fn));
    end if;
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure
                     and provolatile = 'v' and proconfig = array['search_path=""']) then
      fallos := array_append(fallos, format('A2c: %s no es VOLATILE con search_path vacio', v_fn));
    end if;
    if has_function_privilege('public', v_fn, 'execute') then
      fallos := array_append(fallos, format('A2d: PUBLIC puede ejecutar %s', v_fn));
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      fallos := array_append(fallos, format('A2e: anon puede ejecutar %s', v_fn));
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      fallos := array_append(fallos, format('A2f: authenticated no puede ejecutar %s', v_fn));
    end if;
  end loop;

  -- A3 · el writer sigue sin poder saltarse la RLS ni poseer tablas.
  if exists (select 1 from pg_roles
             where rolname = 'nomey_writer'
               and (rolbypassrls or rolcanlogin or rolsuper)) then
    fallos := array_append(fallos, 'A3: nomey_writer dejo de ser NOLOGIN NOBYPASSRLS NOSUPERUSER');
  end if;
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and c.relkind = 'r'
    and pg_get_userbyid(c.relowner) = 'nomey_writer';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A3b: nomey_writer posee %s tablas de core', v_n));
  end if;

  -- A4 · REVOCACIONES que siguen vivas: privilegios sin ruta autoritativa.
  --
  -- 7a revoco el INSERT sobre `frozen_conversion`, `split` y
  -- `split_participant`. Los dos ultimos VOLVIERON en 7b, porque
  -- `api.record_group_expense` los ejerce; el primero no vuelve mientras el FX
  -- cross-currency siga sin regla de resolucion (ADR-009 §8). Comprobar hoy los
  -- tres seria comprobar que 7b no existe.
  if has_table_privilege('nomey_writer', 'core.frozen_conversion', 'insert') then
    fallos := array_append(fallos,
      'A4: nomey_writer tiene INSERT sobre core.frozen_conversion y ninguna ruta autoritativa lo ejerce');
  end if;

  -- A4b · pero las policies de INSERT ya disenadas siguen intactas: son
  -- decisiones razonadas de ADR-013 §10 y volveran a hacer falta en 7b.
  select count(*) into v_n
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core'
    and c.relname in ('frozen_conversion','split','split_participant')
    and p.polcmd = 'a';
  if v_n <> 3 then
    fallos := array_append(fallos, format('A4b: quedan %s policies de INSERT de las 3 que deben conservarse', v_n));
  end if;

  -- A5 · el cliente NO gana escritura directa sobre core.
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core' and grantee in ('anon','authenticated','service_role')
    and privilege_type <> 'SELECT';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5: los roles cliente tienen %s privilegios de core distintos de SELECT', v_n));
  end if;
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := array_append(fallos, 'A5b: authenticated gano USAGE sobre core');
  end if;
  if has_schema_privilege('authenticated', 'sec', 'usage') then
    fallos := array_append(fallos, 'A5c: authenticated gano USAGE sobre sec');
  end if;

  -- A6 · nadie mas puede ejecutar los helpers internos.
  if has_function_privilege('public', 'sec.begin_command(jsonb, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'sec.begin_command(jsonb, text, jsonb)', 'execute') then
    fallos := array_append(fallos, 'A6: sec.begin_command es alcanzable por PUBLIC o por el cliente');
  end if;

  -- A7 · el UPDATE sobre `core.scope` llego con 7b y SOLO por el lock de deuda,
  -- asi que aqui se comprueba que sigue acotado a una sola columna. Su
  -- inocuidad real —que `WITH CHECK (false)` impide la modificacion— la mide el
  -- check de 7b, que es donde vive la decision.
  select count(*) into v_n
  from information_schema.column_privileges
  where table_schema = 'core' and table_name = 'scope'
    and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_n <> 1 then
    fallos := array_append(fallos,
      format('A7: el writer tiene UPDATE sobre %s columnas de core.scope y deberia ser 1, la del lock', v_n));
  end if;

  -- A8 · el UPDATE del writer sigue acotado por columna al puntero de vigencia.
  select count(*) into v_n
  from information_schema.column_privileges
  where table_schema = 'core' and table_name = 'operation'
    and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A8: el writer tiene UPDATE sobre %s columnas de operation y deberia ser 1', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CATALOGO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · catalogo, propiedad, privilegios y revocaciones';
end
$estructura$;

-- ================================================================ fixture ===
insert into core.currency_definition (id, code, scale) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','EUR',2),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','USD',2),
  -- Escala CERO, para que los vectores de ingreso en JPY se ejecuten tambien
  -- por la ruta real y no solo en TypeScript.
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','JPY',0);

insert into core.scope (id,kind,base_currency_definition_id,owner_user_id) values
  ('a0000000-0000-4000-8000-0000000000a1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000b1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000c1','personal','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','44444444-4444-4444-8444-444444444444');
insert into core.scope (id,kind,base_currency_definition_id) values
  ('a0000000-0000-4000-8000-0000000000f1','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

-- ============================ B · las cuatro clases, en positivo ===========
do $clases$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  SPB constant text := 'a0000000-0000-4000-8000-0000000000b1';
  r jsonb; v_n int; v_bal bigint; v_eco bigint; v_class text;
begin
  -- Las llamadas van como `authenticated`; las verificaciones NO pueden, porque
  -- ese rol no tiene USAGE sobre `core`. Se alterna explicitamente.
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- B1 · adjustment. `data-model.md` §4.11: la declaracion inicial ES el primer
  -- ajuste. Signo libre, porque ADR-013 §3 admite el ajuste negativo.
  r := api.record_adjustment(jsonb_build_object(
        'client_operation_id','10000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-01-10',
        'scope_id',SPA,'delta','50000','currency_definition_id',EUR));
  if (r ->> 'already_processed')::boolean then
    fallos := array_append(fallos, 'B1: la primera ejecucion se marco como replay');
  end if;

  r := api.record_personal_expense(jsonb_build_object(
        'client_operation_id','10000000-0000-4000-8000-000000000002',
        'command_contract_version',1,'effective_date','2026-01-11',
        'scope_id',SPA,'amount','2000','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));

  r := api.record_external_transfer(jsonb_build_object(
        'client_operation_id','10000000-0000-4000-8000-000000000003',
        'command_contract_version',1,'effective_date','2026-01-12',
        'scope_id',SPA,'delta','-3000','currency_definition_id',EUR));

  r := api.record_internal_transfer(jsonb_build_object(
        'client_operation_id','10000000-0000-4000-8000-000000000004',
        'command_contract_version',1,'effective_date','2026-01-13',
        'from_scope_id',SPA,'to_scope_id',SPB,'amount','10000',
        'currency_definition_id',EUR));

  reset role;

  -- B2 · gasto personal: saldo negativo y economica positiva SIN participante.
  select e.balance_amount, e.economic_amount into v_bal, v_eco
    from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
   where o.operation_class = 'personal_expense';
  if v_bal <> -2000 or v_eco <> 2000 then
    fallos := array_append(fallos, format('B2: gasto personal dio saldo=%s economica=%s', v_bal, v_eco));
  end if;
  if exists (select 1 from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
             join core.operation o on o.id = ov.operation_id
             where o.operation_class = 'personal_expense' and e.economic_participant_id is not null) then
    fallos := array_append(fallos, 'B2b: el Modo Personal nomino participante y ADR-013 §8 dice que no lo hace');
  end if;

  -- B3 · transferencia externa: un unico extremo, delta CON signo.
  select count(*), min(e.balance_amount) into v_n, v_bal
    from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
   where o.operation_class = 'external_transfer';
  if v_n <> 1 or v_bal <> -3000 then
    fallos := array_append(fallos, format('B3: transferencia externa dio %s efectos con saldo %s', v_n, v_bal));
  end if;

  -- B4 · transferencia interna: exactamente una salida y una entrada (inv. 4).
  select count(*), sum(e.balance_amount) into v_n, v_bal
    from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
   where o.operation_class = 'internal_transfer';
  if v_n <> 2 then
    fallos := array_append(fallos, format('B4: transferencia interna dio %s efectos y deberian ser 2', v_n));
  end if;
  if v_bal <> 0 then
    fallos := array_append(fallos, format('B4b: los dos extremos no se compensan: %s', v_bal));
  end if;

  -- B5 · las cuatro `operation_class` estan en snake_case y son las esperadas.
  for v_class in select distinct operation_class from core.operation loop
    if not (v_class = any(array['adjustment','personal_expense','external_transfer','internal_transfer'])) then
      fallos := array_append(fallos, format('B5: operation_class inesperada: %s', v_class));
    end if;
  end loop;
  select count(distinct operation_class) into v_n from core.operation;
  if v_n <> 4 then
    fallos := array_append(fallos, format('B5b: hay %s clases distintas y deberian ser 4', v_n));
  end if;

  -- B6 · toda operacion queda atribuida al actor de la peticion.
  if exists (select 1 from core.operation where created_by <> '11111111-1111-4111-8111-111111111111') then
    fallos := array_append(fallos, 'B6: alguna operacion quedo atribuida a otro actor');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE LAS CLASES:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · las cuatro clases producen exactamente los efectos del dominio';
end
$clases$;

-- ============================ C · idempotencia =============================
do $idem$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  r jsonb; v_before int; v_after int; v_op uuid;
begin
  -- Las cuentas se leen como propietario: `authenticated` no tiene USAGE
  -- sobre `core` y no puede verificar nada.
  select count(*) into v_before from core.operation;

  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- C1 · REPLAY IDENTICO: mismo resultado, y NADA nuevo escrito.
  r := api.record_adjustment(jsonb_build_object(
        'client_operation_id','10000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-01-10',
        'scope_id',SPA,'delta','50000','currency_definition_id',EUR));
  if not (r ->> 'already_processed')::boolean then
    fallos := array_append(fallos, 'C1: el replay no se marco como ya procesado');
  end if;
  reset role;
  select count(*) into v_after from core.operation;
  if v_after <> v_before then
    fallos := array_append(fallos, format('C1b: el replay creo %s operaciones', v_after - v_before));
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- C1c · UN IMPORTE ESCRITO DE OTRA FORMA ES OTRA INTENCION. ADR-011 §8 dice
  -- que la canonicalizacion «no degrada ni REFORMATEA los valores exactos», asi
  -- que "0050000" y "50000" no convergen: el importe entra tal como llego.
  --
  -- Es un fallo ruidoso y no silencioso, que es el lado correcto en el que
  -- equivocarse: ADR-010 §3 dice que devolver el original ante una intencion
  -- distinta seria «lo peor de las tres opciones». Y ADR-010 §1 obliga al
  -- cliente a reenviar exactamente la misma intencion.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','10000000-0000-4000-8000-000000000001',
          'command_contract_version',1,'effective_date','2026-01-10',
          'scope_id',SPA,'delta','0050000','currency_definition_id',EUR));
    fallos := array_append(fallos,
      'C1c: un importe con otra representacion textual se acepto como replay; la canonicalizacion esta reformateando valores exactos');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('C1c: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- C1d · lo que SI converge son las identidades y la fecha, porque no son
  -- «valores exactos» en el sentido de ADR-003 y normalizarlas es materializar
  -- los defaults semanticos. Un UUID en mayusculas es el mismo replay.
  r := api.record_adjustment(jsonb_build_object(
        'client_operation_id','10000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-01-10',
        'scope_id',upper(SPA),'delta','50000','currency_definition_id',EUR));
  if not (r ->> 'already_processed')::boolean then
    fallos := array_append(fallos, 'C1d: un UUID en mayusculas produjo conflicto falso');
  end if;

  -- C2 · misma clave, INTENCION distinta -> conflicto, nunca sobrescritura.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','10000000-0000-4000-8000-000000000001',
          'command_contract_version',1,'effective_date','2026-01-10',
          'scope_id',SPA,'delta','99999','currency_definition_id',EUR));
    fallos := array_append(fallos, 'C2: la misma clave con otra intencion fue aceptada');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('C2: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- C3 · misma clave, CLASE de comando distinta -> conflicto (ADR-010 §3).
  begin
    r := api.record_personal_expense(jsonb_build_object(
          'client_operation_id','10000000-0000-4000-8000-000000000001',
          'command_contract_version',1,'effective_date','2026-01-10',
          'scope_id',SPA,'amount','50000','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
    fallos := array_append(fallos, 'C3: la misma clave con otra clase fue aceptada');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('C3: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- C4 · otro actor SI puede usar el mismo UUID: la unicidad es por actor.
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','10000000-0000-4000-8000-000000000001',
          'command_contract_version',1,'effective_date','2026-01-10',
          'scope_id','a0000000-0000-4000-8000-0000000000b1',
          'delta','1000','currency_definition_id',EUR));
    if (r ->> 'already_processed')::boolean then
      fallos := array_append(fallos, 'C4: el comando de otro actor se leyo como replay del primero');
    end if;
  exception when others then
    fallos := array_append(fallos, format('C4: otro actor no pudo usar el mismo UUID: %s', sqlerrm));
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE IDEMPOTENCIA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · replay, conflicto por intencion y por clase, y unicidad por actor';
end
$idem$;

-- ============================ D · CAS y correcciones =======================
do $cas$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  A constant uuid := '11111111-1111-4111-8111-111111111111';
  r jsonb; v_op uuid; v_v1 uuid; v_v2 uuid; v_n int; v_creator uuid; v_bal bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- Alta que luego se corrige.
  r := api.record_personal_expense(jsonb_build_object(
        'client_operation_id','20000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-02-01',
        'scope_id',SPA,'amount','6000','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  select current_version_id into v_v1 from core.operation where id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- D1 · CAS correcto: la correccion restata la intencion COMPLETA.
  r := api.record_personal_expense(jsonb_build_object(
        'client_operation_id','20000000-0000-4000-8000-000000000002',
        'command_contract_version',1,'effective_date','2026-02-01',
        'operation_id',v_op,'expected_version_id',v_v1,
        'scope_id',SPA,'amount','7500','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
  if (r ->> 'operation_id')::uuid <> v_op then
    fallos := array_append(fallos, 'D1: la correccion devolvio otra operacion');
  end if;
  reset role;
  select current_version_id into v_v2 from core.operation where id = v_op;
  if v_v2 = v_v1 then
    fallos := array_append(fallos, 'D1b: el puntero de vigencia no se movio');
  end if;

  -- D2 · linaje: version_no y supersedes salen de la version BLOQUEADA.
  select version_no into v_n from core.operation_version where id = v_v2;
  if v_n <> 2 then
    fallos := array_append(fallos, format('D2: version_no = %s y deberia ser 2', v_n));
  end if;
  if (select supersedes_version_id from core.operation_version where id = v_v2) is distinct from v_v1 then
    fallos := array_append(fallos, 'D2b: supersedes_version_id no es la version vigente anterior');
  end if;

  -- D3 · solo V2 cuenta. La proyeccion canonica excluye la superada.
  select count(*) into v_n from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op;
  if v_n <> 1 then
    fallos := array_append(fallos, format('D3: la proyeccion tiene %s efectos vigentes de la operacion corregida', v_n));
  end if;
  select e.balance_amount into v_bal from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op;
  if v_bal <> -7500 then
    fallos := array_append(fallos, format('D3b: el efecto vigente es %s y deberia ser -7500', v_bal));
  end if;

  -- D4 · CAS OBSOLETO: corregir contra la version ya superada.
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  begin
    r := api.record_personal_expense(jsonb_build_object(
          'client_operation_id','20000000-0000-4000-8000-000000000003',
          'command_contract_version',1,'effective_date','2026-02-01',
          'operation_id',v_op,'expected_version_id',v_v1,
          'scope_id',SPA,'amount','9000','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
    fallos := array_append(fallos, 'D4: se acepto una correccion contra una version obsoleta');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%VERSION_CONFLICT%' then
      fallos := array_append(fallos, format('D4: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- D5 · EL REPLAY TIENE PRIORIDAD SOBRE EL CAS. Reintentar la correccion
  -- original, ahora que su expected_version_id ya no es la vigente, devuelve su
  -- resultado y NO falla como edicion obsoleta. Es el caso que ADR-011 §13
  -- existe para proteger.
  r := api.record_personal_expense(jsonb_build_object(
        'client_operation_id','20000000-0000-4000-8000-000000000002',
        'command_contract_version',1,'effective_date','2026-02-01',
        'operation_id',v_op,'expected_version_id',v_v1,
        'scope_id',SPA,'amount','7500','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
  if not (r ->> 'already_processed')::boolean then
    fallos := array_append(fallos, 'D5: el reintento de la correccion no se resolvio como replay');
  end if;
  reset role;
  select count(*) into v_n from core.operation_version where operation_id = v_op;
  if v_n <> 2 then
    fallos := array_append(fallos, format('D5b: el replay dejo %s versiones y deberian seguir siendo 2', v_n));
  end if;

  -- D6 · `operation.created_by` NO cambia: quien creo la operacion lo sigue
  -- siendo para siempre (`data-model.md` §7).
  select created_by into v_creator from core.operation where id = v_op;
  if v_creator <> A then
    fallos := array_append(fallos, 'D6: operation.created_by cambio al corregir');
  end if;

  -- D6b · y cada version conserva SU propia atribucion.
  if (select created_by from core.operation_version where id = v_v2) <> A then
    fallos := array_append(fallos, 'D6b: la version de la correccion no quedo atribuida al actor que la creo');
  end if;

  -- D7 · corregir una operacion ajena: en 7a NINGUNA de las cuatro clases lo
  -- permite, porque las cuatro se anclan a un Modo Personal cuyo dueno es el
  -- actor. Se comprueba que el rechazo es de AUTORIZACION y no de autoria.
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  begin
    r := api.record_personal_expense(jsonb_build_object(
          'client_operation_id','20000000-0000-4000-8000-000000000004',
          'command_contract_version',1,'effective_date','2026-02-01',
          'operation_id',v_op,'expected_version_id',v_v2,
          'scope_id',SPA,'amount','1000','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
    fallos := array_append(fallos, 'D7: otro actor corrigio un gasto del Modo Personal ajeno');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('D7: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CAS:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · CAS, linaje, replay con prioridad sobre el CAS y atribucion por version';
end
$cas$;

-- ============================ E · payload hostil ===========================
do $hostil$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  USD constant text := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  SPB constant text := 'a0000000-0000-4000-8000-0000000000b1';
  GRP constant text := 'a0000000-0000-4000-8000-0000000000f1';
  r jsonb; v_before int; v_after int;
begin
  select count(*) into v_before from core.effect;
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- E1 · campo desconocido.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000001',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id',SPA,'delta','100','currency_definition_id',EUR,
          'sobra','x'));
    fallos := array_append(fallos, 'E1: se acepto un campo desconocido');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('E1: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E2 · `created_by` NO se ignora: invalida.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000002',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id',SPA,'delta','100','currency_definition_id',EUR,
          'created_by','22222222-2222-4222-8222-222222222222'));
    fallos := array_append(fallos, 'E2: se acepto created_by en el payload');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('E2: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E3 · importe como NUMBER JSON. Es la comprobacion que ADR-008 §3 exige y
  -- que un parametro `text` no permitiria: E14 midio que PostgREST coacciona el
  -- numero a texto y la degradacion pasaria inadvertida.
  begin
    r := api.record_adjustment(('{"client_operation_id":"30000000-0000-4000-8000-000000000003",'
      || '"command_contract_version":1,"effective_date":"2026-03-01",'
      || '"scope_id":"' || SPA || '","delta":100,'
      || '"currency_definition_id":"' || EUR || '"}')::jsonb);
    fallos := array_append(fallos, 'E3: se acepto un importe como number JSON');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('E3: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E4 · CROSS-CURRENCY -> capacidad no disponible, no payload invalido.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000004',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id',SPA,'delta','100','currency_definition_id',USD));
    fallos := array_append(fallos, 'E4: se acepto una operacion cross-currency');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CURRENCY_CONVERSION_UNSUPPORTED%' then
      fallos := array_append(fallos, format('E4: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E5 · ambito ajeno.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000005',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id',SPB,'delta','100','currency_definition_id',EUR));
    fallos := array_append(fallos, 'E5: se escribio en el Modo Personal de otro');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('E5: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E5b · ambito inexistente: MISMO error que el ajeno, para no convertir la
  -- funcion en un oraculo de existencia de ambitos.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000006',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id','a0000000-0000-4000-8000-0000000000ff','delta','100',
          'currency_definition_id',EUR));
    fallos := array_append(fallos, 'E5b: se acepto un ambito inexistente');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('E5b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E6 · un Grupo no tiene saldo propio (`data-model.md` §2).
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000007',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id',GRP,'delta','100','currency_definition_id',EUR));
    fallos := array_append(fallos, 'E6: se registro un saldo en un ambito group');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('E6: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E7 · gasto de cero o negativo (ADR-013 §3).
  begin
    r := api.record_personal_expense(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000008',
          'command_contract_version',1,'effective_date','2026-03-01',
          'scope_id',SPA,'amount','0','currency_definition_id',EUR,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));
    fallos := array_append(fallos, 'E7: se acepto un gasto de cero');
  exception when sqlstate 'PGRST' then null;
  end;

  -- E8 · transferencia interna con importe negativo: invertiria la direccion y
  -- sacaria dinero del ambito del tercero. Es la primitiva de apropiacion que
  -- `data-model.md` §8 prohibe.
  begin
    r := api.record_internal_transfer(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-000000000009',
          'command_contract_version',1,'effective_date','2026-03-01',
          'from_scope_id',SPB,'to_scope_id',SPA,'amount','-5000',
          'currency_definition_id',EUR));
    fallos := array_append(fallos, 'E8: se acepto un importe negativo en una transferencia interna');
  exception when sqlstate 'PGRST' then null;
  end;

  -- E8b · y tampoco puede originarse desde el ambito de otro (invariante 14).
  begin
    r := api.record_internal_transfer(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-00000000000a',
          'command_contract_version',1,'effective_date','2026-03-01',
          'from_scope_id',SPB,'to_scope_id',SPA,'amount','5000',
          'currency_definition_id',EUR));
    fallos := array_append(fallos, 'E8b: se origino una salida desde el Modo Personal de otro');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('E8b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E9 · correccion sin expected_version_id.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','30000000-0000-4000-8000-00000000000b',
          'command_contract_version',1,'effective_date','2026-03-01',
          'operation_id','20000000-0000-4000-8000-000000000001',
          'scope_id',SPA,'delta','100','currency_definition_id',EUR));
    fallos := array_append(fallos, 'E9: se acepto una correccion sin expected_version_id');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('E9: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- E10 · ATOMICIDAD: ninguno de los rechazos dejo escritura parcial, ni
  -- siquiera un comando huerfano.
  reset role;
  select count(*) into v_after from core.effect;
  if v_after <> v_before then
    fallos := array_append(fallos, format('E10: los rechazos dejaron %s efectos nuevos', v_after - v_before));
  end if;
  if exists (select 1 from core.client_command
             where client_operation_id::text like '30000000%') then
    fallos := array_append(fallos, 'E10b: quedo un comando reclamado de una peticion rechazada');
  end if;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PAYLOAD HOSTIL:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · payload hostil rechazado antes de escribir, y sin escritura parcial';
end
$hostil$;

-- ============================ F · replay tras perder la autorizacion =======
-- ADR-010 §5 distingue dos casos y prohibe aplicarles la misma regla: una
-- operacion NUEVA exige la autorizacion actual completa, mientras que una
-- intencion YA PROCESADA puede devolver su envelope «aunque el actor haya
-- perdido despues el acceso al ambito».
--
-- Aplicar la autorizacion actual tambien al replay «romperia la idempotencia:
-- el reintento fallaria, el cliente seguiria sin saber si la operacion se
-- proceso, y podria acabar generando una intencion nueva».
--
-- Esto lo PRUEBA, en vez de inferirlo del orden del codigo: se retira la
-- autorizacion que permitio la primera ejecucion y se comprueba que el replay
-- sigue funcionando y que un comando nuevo del mismo actor ya no.
do $perdida$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  C   constant uuid := '33333333-3333-4333-8333-333333333333';
  K   constant text := '50000000-0000-4000-8000-000000000001';
  r jsonb; v_op uuid; v_op2 uuid;
  v_ops int; v_vers int; v_efs int; v_cmds int;
  v_ops2 int; v_vers2 int; v_efs2 int; v_cmds2 int;
begin
  -- 1 · A ejecuta correctamente y obtiene su operation_id.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_adjustment(jsonb_build_object(
        'client_operation_id', K,
        'command_contract_version', 1, 'effective_date', '2026-05-01',
        'scope_id', SPA, 'delta', '12345', 'currency_definition_id', EUR));
  v_op := (r ->> 'operation_id')::uuid;
  if (r ->> 'already_processed')::boolean then
    fallos := array_append(fallos, 'F1: la primera ejecucion se marco como replay');
  end if;
  reset role;

  select count(*) into v_ops  from core.operation;
  select count(*) into v_vers from core.operation_version;
  select count(*) into v_efs  from core.effect;
  select count(*) into v_cmds from core.client_command;

  -- 2 · Se RETIRA la autorizacion que permitio esa ejecucion. Para estas cuatro
  -- clases la autorizacion es la PROPIEDAD del Modo Personal (ADR-016), asi que
  -- se transfiere a un tercero. A deja de estar autorizado sobre ese ambito.
  update core.scope set owner_user_id = C where id = SPA::uuid;

  -- 3 · A repite EXACTAMENTE la misma clave y la misma intencion.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id', K,
          'command_contract_version', 1, 'effective_date', '2026-05-01',
          'scope_id', SPA, 'delta', '12345', 'currency_definition_id', EUR));
  exception when others then
    r := null;
    fallos := array_append(fallos,
      format('F3: el replay fallo tras perder la autorizacion, lo que rompe la idempotencia de ADR-010 §5: %s', sqlerrm));
  end;

  -- 4 · Mismo operation_id, y marcado como ya procesado.
  if r is not null then
    if (r ->> 'operation_id')::uuid is distinct from v_op then
      fallos := array_append(fallos, 'F4: el replay devolvio otra operacion');
    end if;
    if not (r ->> 'already_processed')::boolean then
      fallos := array_append(fallos, 'F4b: el replay no se marco como ya procesado');
    end if;
    -- El envelope no lleva nada mas: ADR-010 §5 acota lo que puede devolverse a
    -- quien ya no tiene acceso al contenido.
    if (select count(*) from jsonb_object_keys(r)) <> 2 then
      fallos := array_append(fallos,
        format('F4c: el envelope del replay lleva %s campos y debe llevar exactamente 2',
               (select count(*) from jsonb_object_keys(r))));
    end if;
  end if;

  -- 6 · un comando NUEVO del mismo actor, ya sin autorizacion, SI se rechaza.
  begin
    r := api.record_adjustment(jsonb_build_object(
          'client_operation_id','50000000-0000-4000-8000-000000000002',
          'command_contract_version', 1, 'effective_date', '2026-05-02',
          'scope_id', SPA, 'delta', '999', 'currency_definition_id', EUR));
    v_op2 := (r ->> 'operation_id')::uuid;
    fallos := array_append(fallos,
      'F6: un comando NUEVO se acepto pese a que el actor ya no esta autorizado');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('F6: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- 5 · ni el replay ni el rechazo escribieron nada.
  select count(*) into v_ops2  from core.operation;
  select count(*) into v_vers2 from core.operation_version;
  select count(*) into v_efs2  from core.effect;
  select count(*) into v_cmds2 from core.client_command;
  if (v_ops2, v_vers2, v_efs2, v_cmds2) is distinct from (v_ops, v_vers, v_efs, v_cmds) then
    fallos := array_append(fallos, format(
      'F5: el replay o el rechazo escribieron: operaciones %s->%s, versiones %s->%s, efectos %s->%s, comandos %s->%s',
      v_ops, v_ops2, v_vers, v_vers2, v_efs, v_efs2, v_cmds, v_cmds2));
  end if;

  update core.scope set owner_user_id = A where id = SPA::uuid;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE REPLAY SIN AUTORIZACION:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · el replay se resuelve ANTES de la autorizacion actual, y un comando nuevo no';
end
$perdida$;

-- ============================ G · paridad con los vectores =================
-- ADR-002 §7 obliga a que la frontera reproduzca EXACTAMENTE los vectores
-- compartidos, y ADR-009 §1 asume que el calculo se escribe por segunda vez y
-- que **la paridad se garantiza con los vectores, no compartiendo codigo**.
--
-- Las expectativas salen de `tests/vectors/scenarios.json`, no de este fichero:
-- si alguien cambia el vector, este check cambia con el.
do $vectores$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_case jsonb; v_op jsonb; v_exp jsonb;
  v_scope text; v_actor text; v_key int := 0; v_fecha date;
  v_got bigint; v_want bigint;
  v_ids jsonb := jsonb_build_object(
    'personal-A','a0000000-0000-4000-8000-0000000000a1',
    'personal-B','a0000000-0000-4000-8000-0000000000b1',
    'personal-JPY','a0000000-0000-4000-8000-0000000000c1');
  v_owner jsonb := jsonb_build_object(
    'personal-A','11111111-1111-4111-8111-111111111111',
    'personal-B','22222222-2222-4222-8222-222222222222',
    'personal-JPY','44444444-4444-4444-8444-444444444444');
  -- La moneda del vector se resuelve a la definicion del AMBITO, no a EUR
  -- siempre: sin esto un vector en JPY entraria con la moneda equivocada y lo
  -- rechazaria `assert_no_conversion` en vez de ejecutarse.
  v_cur jsonb := jsonb_build_object(
    'eur','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'jpy','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  v_moneda text;
  v_seen int := 0;
begin
  if to_regclass('pg_temp.vector_doc') is null then
    raise exception 'FALTA EL PROLOGO DE VECTORES: ejecuta ./scripts/vectors-prelude.sh antes de este check';
  end if;

  for v_case in
    select c from jsonb_array_elements((select doc -> 'cases' from vector_doc where name = 'scenarios')) as c
  loop
    -- Solo los escenarios cuyas operaciones son TODAS de las cuatro clases de
    -- 7a. Los demas necesitan `group_expense` o `debt_settlement`, que son 7b.
    continue when exists (
      select 1 from jsonb_array_elements(v_case -> 'operations') o
       where not (o ->> 'kind' = any(array['adjustment','personalExpense','personalIncome','internalTransfer'])));

    v_seen := v_seen + 1;
    v_fecha := date '2026-04-01' + (v_seen - 1);

    for v_op in select o from jsonb_array_elements(v_case -> 'operations') as o loop
      v_key := v_key + 1;
      v_scope := coalesce(v_op ->> 'scope', v_op ->> 'fromScope');
      v_actor := v_owner ->> v_scope;
      v_moneda := v_cur ->> coalesce(v_op ->> 'currency', 'eur');
      set local role authenticated;
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_actor)::text, true);

      if v_op ->> 'kind' = 'adjustment' then
        perform api.record_adjustment(jsonb_build_object(
          'client_operation_id', ('40000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
          'command_contract_version', 1, 'effective_date', v_fecha::text,
          'scope_id', v_ids ->> v_scope,
          'delta', v_op ->> 'delta',
          'currency_definition_id', v_moneda));

      elsif v_op ->> 'kind' = 'personalExpense' then
        perform api.record_personal_expense(jsonb_build_object(
          'client_operation_id', ('40000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
          'command_contract_version', 2, 'effective_date', v_fecha::text,
          'scope_id', v_ids ->> v_scope,
          'amount', v_op ->> 'amount',
          'currency_definition_id', v_moneda,
          'effective_time','09:30',
          'concept','Compra','category_id','4ed30a44-9f82-578f-828c-b491a25ebdd9'));

      elsif v_op ->> 'kind' = 'personalIncome' then
        perform api.record_personal_income(jsonb_build_object(
          'client_operation_id', ('40000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
          'command_contract_version', 1, 'effective_date', v_fecha::text,
          'scope_id', v_ids ->> v_scope,
          'amount', v_op ->> 'amount',
          'currency_definition_id', v_moneda,
          'effective_time','09:30',
          'concept','Nomina','category_id','ea9f1167-f497-5edf-af01-c7e1c3a64d9d'));

      elsif v_op ->> 'kind' = 'internalTransfer' then
        -- 7a solo cubre el caso sin conversion, en el que los dos importes del
        -- vector son el mismo numero. Si el vector los separase, no seria
        -- expresable todavia y hay que verlo, no ignorarlo.
        if (v_op ->> 'fromAmount') is distinct from (v_op ->> 'toAmount') then
          fallos := array_append(fallos,
            format('G: el escenario %s tiene importes distintos por extremo y 7a no soporta conversion', v_case ->> 'id'));
          continue;
        end if;
        perform api.record_internal_transfer(jsonb_build_object(
          'client_operation_id', ('40000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
          'command_contract_version', 1, 'effective_date', v_fecha::text,
          'from_scope_id', v_ids ->> (v_op ->> 'fromScope'),
          'to_scope_id',   v_ids ->> (v_op ->> 'toScope'),
          'amount', v_op ->> 'fromAmount',
          'currency_definition_id', v_moneda));
      end if;
      reset role;
    end loop;

    -- Comparacion contra lo que el vector espera. Los saldos se derivan de la
    -- PROYECCION CANONICA, nunca reimplementando el filtro de vigencia.
    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'balances', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      select coalesce(sum(e.balance_amount), 0) into v_got
        from core.current_effect e
        join core.operation_version ov on ov.id = e.operation_version_id
       where e.scope_id = (v_ids ->> (v_exp ->> 'scope'))::uuid
         and ov.effective_date = v_fecha;
      if v_got <> v_want then
        fallos := array_append(fallos, format('G/%s: saldo de %s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'scope', v_got, v_want));
      end if;
    end loop;

    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'economicExpense', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      select coalesce(sum(e.economic_amount), 0) into v_got
        from core.current_effect e
        join core.operation_version ov on ov.id = e.operation_version_id
       where e.scope_id = (v_ids ->> (v_exp ->> 'scope'))::uuid
         and e.accounting_class = 'expense'
         and e.economic_amount is not null
         and ov.effective_date = v_fecha;
      if v_got <> v_want then
        fallos := array_append(fallos, format('G/%s: economica de %s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'scope', v_got, v_want));
      end if;
    end loop;

    -- Sin limpieza entre escenarios: cada uno vive en su PROPIA fecha
    -- efectiva, asi que las agregaciones no se mezclan. De paso comprueba que
    -- la fecha efectiva viaja intacta desde el payload hasta la version.
  end loop;

  -- Los escenarios alcanzables por esta mitad. Eran tres; con el ingreso de
  -- F6.B son SIETE, porque sus cuatro vectores nuevos solo usan clases de aqui.
  -- `externalTransfer` sigue sin tener ninguno propio: su unico caso, 4.7, es
  -- compuesto y necesita `group_expense` y `debt_settlement`, asi que su vector
  -- se ejercita en 7b.
  if v_seen <> 7 then
    fallos := array_append(fallos, format('G: se ejercitaron %s escenarios de vectores y deberian ser 7', v_seen));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PARIDAD CON LOS VECTORES:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · la implementacion de PostgreSQL reproduce los vectores compartidos';
end
$vectores$;

-- ============================ H · correspondencia de vocabulario ===========
-- La union entre los `kind` en camelCase de los vectores y los
-- `operation_class` en snake_case que persiste el writer. Es la unica pieza que
-- vive en dos sitios, asi que se comprueba en vez de confiarse.
do $vocab$
declare
  fallos text[] := '{}';
  v_kind text;
  v_map jsonb := jsonb_build_object(
    'adjustment',           'adjustment',
    'personalExpense',      'personal_expense',
    'personalIncome',       'personal_income',
    'externalTransfer',     'external_transfer',
    'internalTransfer',     'internal_transfer',
    'groupExpense',         'group_expense',
    'debtSettlement',       'debt_settlement',
    'settlementByTransfer', 'settlement_by_transfer');
begin
  for v_kind in
    select distinct o ->> 'kind'
      from jsonb_array_elements((select doc -> 'cases' from vector_doc where name = 'scenarios')) c,
           jsonb_array_elements(c -> 'operations') o
  loop
    if v_map ->> v_kind is null then
      fallos := array_append(fallos,
        format('H: el vector usa el kind %s y no hay operation_class que le corresponda', v_kind));
    end if;
  end loop;

  -- Y al reves: toda clase que 7a persiste esta en la correspondencia.
  for v_kind in select distinct operation_class from core.operation loop
    if not (v_kind = any(array(select jsonb_array_elements_text(
              (select jsonb_agg(value) from jsonb_each_text(v_map)))))) then
      fallos := array_append(fallos,
        format('H2: se persistio la clase %s y no corresponde a ningun kind de los vectores', v_kind));
    end if;
  end loop;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE VOCABULARIO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · H · la correspondencia kind camelCase <-> operation_class snake_case es completa';
end
$vocab$;

rollback;
