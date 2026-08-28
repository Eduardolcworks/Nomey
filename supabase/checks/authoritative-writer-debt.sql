-- Comprobaciones de la frontera autoritativa de escritura · 7b.
--
-- Uso, desde Ubuntu y con el stack levantado. EXIGE el prologo de vectores,
-- porque la seccion J los compara contra la implementacion de PostgreSQL:
--
--   { ./scripts/vectors-prelude.sh ; cat supabase/checks/authoritative-writer-debt.sql ; } \
--     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--         -X -q -v ON_ERROR_STOP=1
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- LO QUE ESTE CHECK NO PUEDE PROBAR, y por eso existe ademas
-- `scripts/writer-debt-concurrency.sh`: una sola sesion de `psql` no tiene
-- concurrencia. El lock del protocolo de ADR-013 §11 se comprueba aqui por
-- CATALOGO y por CAPACIDAD —que existe, que no permite escribir— y por
-- COMPORTAMIENTO en ese script, con sesiones realmente simultaneas.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ================== A · catalogo, privilegios y el lock =====================
do $estructura$
declare
  fallos text[] := '{}';
  v_fn text;
  v_n int;
begin
  -- A1 · las tres funciones publicas de 7b existen y tienen los atributos que
  -- ADR-009 §4 y §5 exigen, una por una.
  foreach v_fn in array array['api.record_group_expense(jsonb)',
                              'api.record_debt_settlement(jsonb)',
                              'api.record_settlement_by_transfer(jsonb)']
  loop
    if to_regprocedure(v_fn) is null then
      fallos := array_append(fallos, format('A1: no existe %s', v_fn));
      continue;
    end if;
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure and prosecdef) then
      fallos := array_append(fallos, format('A1b: %s no es SECURITY DEFINER', v_fn));
    end if;
    -- El owner es el WRITER y no `postgres`: es lo que la mantiene DEBAJO de la
    -- RLS. Lo contrario que `api.claimed_dimension()`, y deliberado (E16).
    if (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn::regprocedure) <> 'nomey_writer' then
      fallos := array_append(fallos, format('A1c: el owner de %s no es nomey_writer', v_fn));
    end if;
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure
                     and provolatile = 'v' and proconfig = array['search_path=""']) then
      fallos := array_append(fallos, format('A1d: %s no es VOLATILE con search_path vacio', v_fn));
    end if;
    if has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute') then
      fallos := array_append(fallos, format('A1e: %s es invocable por PUBLIC o por anon', v_fn));
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      fallos := array_append(fallos, format('A1f: authenticated no puede ejecutar %s', v_fn));
    end if;
  end loop;

  -- A2 · la superficie de escritura completa son OCHO funciones y ninguna mas.
  -- Eran siete hasta que F6.B trajo el ingreso, que es la clase contable que el
  -- modelo contempla desde la Fase 1 y que no tenia ruta de escritura.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname like 'record\_%';
  if v_n <> 8 then
    fallos := array_append(fallos, format('A2: hay %s funciones api.record_* y deberian ser 8', v_n));
  end if;

  -- A3 · los privilegios que VUELVEN, porque ahora tienen ruta.
  if not has_table_privilege('nomey_writer', 'core.split', 'insert')
     or not has_table_privilege('nomey_writer', 'core.split_participant', 'insert') then
    fallos := array_append(fallos, 'A3: el writer no puede insertar el reparto que record_group_expense escribe');
  end if;
  -- Y el que NO vuelve: sin regla de resolucion de FX no hay ruta que escriba
  -- una conversion congelada (ADR-009 §8).
  if has_table_privilege('nomey_writer', 'core.frozen_conversion', 'insert') then
    fallos := array_append(fallos, 'A3b: el writer recupero INSERT sobre core.frozen_conversion y ninguna ruta lo ejerce');
  end if;

  -- A4 · la proyeccion canonica es alcanzable por el writer. Sin este grant, la
  -- derivacion de deuda fallaria con 42501 —o peor, alguien la sustituiria por
  -- una lectura directa de core.effect y perderia el filtro de vigencia.
  if not has_table_privilege('nomey_writer', 'core.current_effect', 'select') then
    fallos := array_append(fallos, 'A4: el writer no puede leer la proyeccion canonica');
  end if;

  -- A5 · EL LOCK. Las dos mitades, que hacen cosas distintas.
  select count(*) into v_n
  from information_schema.column_privileges
  where table_schema = 'core' and table_name = 'scope'
    and grantee = 'nomey_writer' and privilege_type = 'UPDATE';
  if v_n <> 1 then
    fallos := array_append(fallos,
      format('A5: el writer tiene UPDATE sobre %s columnas de core.scope y debe ser 1', v_n));
  end if;
  if not exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'core' and table_name = 'scope' and column_name = 'base_currency_definition_id'
       and grantee = 'nomey_writer' and privilege_type = 'UPDATE') then
    fallos := array_append(fallos, 'A5b: la columna del UPDATE del writer no es base_currency_definition_id');
  end if;
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relname = 'scope' and p.polcmd = 'w'
      and p.polname = 'scope_writer_lock') then
    fallos := array_append(fallos,
      'A5c: falta la policy de UPDATE de core.scope; E20 midio que sin ella el bloqueo devuelve CERO FILAS SIN ERROR');
  end if;
  -- El `WITH CHECK (false)` es lo que separa «poder bloquear» de «poder
  -- escribir». Se comprueba por catalogo y, en A8, por comportamiento.
  if (select pg_get_expr(p.polwithcheck, p.polrelid)
        from pg_policy p join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'core' and c.relname = 'scope' and p.polname = 'scope_writer_lock') <> 'false' then
    fallos := array_append(fallos, 'A5d: la policy del lock no lleva WITH CHECK (false)');
  end if;

  -- A6 · y no se le fue la mano: ninguna policy de core es aplicable a PUBLIC.
  select count(*) into v_n
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and 0 = any(coalesce(p.polroles, '{}'));
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6: %s policies de core son aplicables a PUBLIC', v_n));
  end if;

  -- A7 · el cliente no gana NADA de escritura sobre core, ni el UPDATE nuevo.
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core' and grantee in ('anon','authenticated','service_role')
    and privilege_type <> 'SELECT';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A7: los roles cliente tienen %s privilegios de core distintos de SELECT', v_n));
  end if;
  if has_table_privilege('authenticated', 'core.scope', 'update')
     or has_table_privilege('anon', 'core.scope', 'update') then
    fallos := array_append(fallos, 'A7b: un rol cliente gano UPDATE sobre core.scope');
  end if;

  -- A8 · los helpers internos siguen sin ser alcanzables desde fuera.
  foreach v_fn in array array['sec.lock_scopes(uuid[])',
                              'sec.pending_debt(uuid, uuid, uuid, uuid)',
                              'sec.resolve_split(bigint, uuid[], uuid, jsonb)',
                              'sec.allocate_by_largest_remainder(bigint, bigint[], integer[])',
                              'sec.participant_personal_scope(uuid)']
  loop
    if has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      fallos := array_append(fallos, format('A8: %s es alcanzable por PUBLIC o por el cliente', v_fn));
    end if;
    if not has_function_privilege('nomey_writer', v_fn, 'execute') then
      fallos := array_append(fallos, format('A8b: el writer no puede ejecutar %s', v_fn));
    end if;
  end loop;

  -- A9 · el writer sigue sin poder saltarse la RLS ni poseer tablas.
  if exists (select 1 from pg_roles where rolname = 'nomey_writer'
               and (rolbypassrls or rolcanlogin or rolsuper)) then
    fallos := array_append(fallos, 'A9: nomey_writer dejo de ser NOLOGIN NOBYPASSRLS NOSUPERUSER');
  end if;
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and c.relkind = 'r'
    and pg_get_userbyid(c.relowner) = 'nomey_writer';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A9b: nomey_writer posee %s tablas de core', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CATALOGO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · catalogo, privilegios devueltos y las dos mitades del lock';
end
$estructura$;

-- ============ A bis · el lock, medido por comportamiento =====================
-- Lo que A5 comprueba por catalogo, esto lo comprueba ejerciendolo. Son las
-- cuatro mediciones que decidieron la forma del bloque 1 de la migracion.
do $lock$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G   constant text := 'a0000000-0000-4000-8000-0000000000f1';
  v_n int;
begin
  insert into core.currency_definition (id, code, scale) values (EUR::uuid, 'EUR', 2);
  insert into core.scope (id, kind, base_currency_definition_id) values (G::uuid, 'group', EUR::uuid);

  -- 1 · el bloqueo funciona, y sobre un ambito que el writer no posee. Es
  -- imprescindible: la deuda de un Grupo no es de quien la escribio.
  set local role nomey_writer;
  select count(*) into v_n from (select 1 from core.scope where id = G::uuid for update) s;
  if v_n <> 1 then
    fallos := array_append(fallos,
      format('Abis1: SELECT ... FOR UPDATE devolvio %s filas; cero significa policy o privilegio ausentes, y NO da error', v_n));
  end if;

  -- 2 · pero NO se puede modificar de verdad, ni siquiera al mismo valor.
  begin
    update core.scope set base_currency_definition_id = base_currency_definition_id where id = G::uuid;
    fallos := array_append(fallos, 'Abis2: el writer modifico base_currency_definition_id; WITH CHECK (false) no muerde');
  exception when others then
    if sqlstate <> '42501' then
      fallos := array_append(fallos, format('Abis2b: el rechazo del UPDATE no fue 42501 sino %s', sqlstate));
    end if;
  end;

  -- 3 · ninguna otra columna, ni DELETE, ni INSERT. Lo acota el GRANT por
  -- columna, no la policy: la RLS acota filas y no columnas (E20).
  begin
    update core.scope set kind = 'couple' where id = G::uuid;
    fallos := array_append(fallos, 'Abis3: el writer modifico core.scope.kind');
  exception when insufficient_privilege then null;
  end;
  begin
    delete from core.scope where id = G::uuid;
    fallos := array_append(fallos, 'Abis3b: el writer borro un ambito');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into core.scope (id, kind, base_currency_definition_id)
    values ('a0000000-0000-4000-8000-0000000000f9', 'group', EUR::uuid);
    fallos := array_append(fallos, 'Abis3c: el writer creo un ambito');
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 4 · el helper del protocolo bloquea varios en orden y no se queja.
  set local role nomey_writer;
  perform sec.lock_scopes(array[G::uuid, G::uuid, null::uuid]);
  reset role;

  delete from core.scope where id = G::uuid;
  delete from core.currency_definition where id = EUR::uuid;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DEL LOCK:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A bis · el privilegio concede EXACTAMENTE poder bloquear, y ninguna escritura';
end
$lock$;

-- ================================================================ fixture ===
-- Escenario estable de las secciones B a I. Las relaciones que 3.C todavia no
-- deja escribir a nadie —participante, membresia, vinculo y periodo— se siembran
-- aqui COMO `postgres`, que es exactamente lo que hara el provisioning cuando
-- exista. Sembrarlas no concede ninguna ruta: los grants del writer siguen
-- siendo de SELECT, y la seccion A lo comprueba.

insert into core.currency_definition (id, code, scale) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','EUR',2),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','USD',2);

-- Modos Personales de A, B, C y D. Marta (E) no tiene cuenta: no se le inventa.
insert into core.scope (id,kind,base_currency_definition_id,owner_user_id) values
  ('a0000000-0000-4000-8000-0000000000a1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000b1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000c1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333'),
  ('a0000000-0000-4000-8000-0000000000d1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','44444444-4444-4444-8444-444444444444');

-- UN GRUPO POR SECCION, y no uno compartido. La razon es la deuda: los saldos
-- se pueden aislar por fecha efectiva, pero LA DEUDA PENDIENTE DE UN AMBITO ES
-- ACUMULADA y no se filtra por fecha, asi que dos secciones en el mismo Grupo se
-- contaminan y una validacion de sobrepago dejaria de probar lo que dice probar.
insert into core.scope (id,kind,base_currency_definition_id) values
  ('a0000000-0000-4000-8000-0000000000f1','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('a0000000-0000-4000-8000-0000000000f2','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('a0000000-0000-4000-8000-0000000000f3','group','dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ('a0000000-0000-4000-8000-0000000000f4','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('a0000000-0000-4000-8000-0000000000f5','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('a0000000-0000-4000-8000-0000000000f6','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('a0000000-0000-4000-8000-0000000000f7','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

-- Participantes de G1: qA qB qC qD, mas Marta (qE, sin cuenta) y Z (qF, con un
-- periodo cerrado, para la elegibilidad).
insert into core.participant (id, scope_id, display_name) values
  ('b0000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-0000000000f1','A'),
  ('b0000000-0000-4000-8000-0000000000b1','a0000000-0000-4000-8000-0000000000f1','B'),
  ('b0000000-0000-4000-8000-0000000000c1','a0000000-0000-4000-8000-0000000000f1','C'),
  ('b0000000-0000-4000-8000-0000000000d1','a0000000-0000-4000-8000-0000000000f1','D'),
  ('b0000000-0000-4000-8000-0000000000e1','a0000000-0000-4000-8000-0000000000f1','Marta'),
  ('b0000000-0000-4000-8000-0000000000f1','a0000000-0000-4000-8000-0000000000f1','Z'),
  ('b0000000-0000-4000-8000-0000000000a2','a0000000-0000-4000-8000-0000000000f2','A'),
  ('b0000000-0000-4000-8000-0000000000b2','a0000000-0000-4000-8000-0000000000f2','B'),
  ('b0000000-0000-4000-8000-0000000000a3','a0000000-0000-4000-8000-0000000000f3','A'),
  ('b0000000-0000-4000-8000-0000000000b3','a0000000-0000-4000-8000-0000000000f3','B'),
  ('b0000000-0000-4000-8000-0000000000a4','a0000000-0000-4000-8000-0000000000f4','A'),
  ('b0000000-0000-4000-8000-0000000000b4','a0000000-0000-4000-8000-0000000000f4','B'),
  ('b0000000-0000-4000-8000-0000000000e4','a0000000-0000-4000-8000-0000000000f4','Marta'),
  ('b0000000-0000-4000-8000-0000000000a5','a0000000-0000-4000-8000-0000000000f5','A'),
  ('b0000000-0000-4000-8000-0000000000b5','a0000000-0000-4000-8000-0000000000f5','B'),
  ('b0000000-0000-4000-8000-0000000000c5','a0000000-0000-4000-8000-0000000000f5','C'),
  ('b0000000-0000-4000-8000-0000000000a6','a0000000-0000-4000-8000-0000000000f6','A'),
  ('b0000000-0000-4000-8000-0000000000b6','a0000000-0000-4000-8000-0000000000f6','B'),
  ('b0000000-0000-4000-8000-0000000000a7','a0000000-0000-4000-8000-0000000000f7','A'),
  ('b0000000-0000-4000-8000-0000000000b7','a0000000-0000-4000-8000-0000000000f7','B');

insert into core.membership (scope_id, user_id) values
  ('a0000000-0000-4000-8000-0000000000f1','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f1','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f1','33333333-3333-4333-8333-333333333333'),
  ('a0000000-0000-4000-8000-0000000000f2','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f2','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f3','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f3','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f4','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f4','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f5','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f5','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f5','33333333-3333-4333-8333-333333333333'),
  ('a0000000-0000-4000-8000-0000000000f6','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f6','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f7','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000f7','22222222-2222-4222-8222-222222222222');

-- El vinculo. `core.participant_user_link` no tiene ruta de escritura en 3.C
-- —la prueba de autorizacion es F10— pero SI existe, y la frontera lo usa para
-- responder a «que Modo Personal es el de este participante». Sembrarlo aqui es
-- lo unico que permite ejercitar hoy esa derivacion.
insert into core.participant_user_link (participant_id, scope_id, user_id) values
  ('b0000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-0000000000f1','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b1','a0000000-0000-4000-8000-0000000000f1','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000c1','a0000000-0000-4000-8000-0000000000f1','33333333-3333-4333-8333-333333333333'),
  ('b0000000-0000-4000-8000-0000000000d1','a0000000-0000-4000-8000-0000000000f1','44444444-4444-4444-8444-444444444444'),
  ('b0000000-0000-4000-8000-0000000000a2','a0000000-0000-4000-8000-0000000000f2','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b2','a0000000-0000-4000-8000-0000000000f2','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000a3','a0000000-0000-4000-8000-0000000000f3','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b3','a0000000-0000-4000-8000-0000000000f3','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000a4','a0000000-0000-4000-8000-0000000000f4','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b4','a0000000-0000-4000-8000-0000000000f4','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000a5','a0000000-0000-4000-8000-0000000000f5','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b5','a0000000-0000-4000-8000-0000000000f5','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000c5','a0000000-0000-4000-8000-0000000000f5','33333333-3333-4333-8333-333333333333'),
  ('b0000000-0000-4000-8000-0000000000a6','a0000000-0000-4000-8000-0000000000f6','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b6','a0000000-0000-4000-8000-0000000000f6','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000a7','a0000000-0000-4000-8000-0000000000f7','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b7','a0000000-0000-4000-8000-0000000000f7','22222222-2222-4222-8222-222222222222');

-- Periodos de presencia. Z tiene uno CERRADO a proposito.
insert into core.participant_period (participant_id, valid_from, valid_until) values
  ('b0000000-0000-4000-8000-0000000000a1','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b1','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000c1','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000d1','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000e1','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000f1','2020-01-01','2021-01-01'),
  ('b0000000-0000-4000-8000-0000000000a2','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b2','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000a3','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b3','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000a4','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b4','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000e4','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000a5','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b5','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000c5','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000a6','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b6','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000a7','2020-01-01',null),
  ('b0000000-0000-4000-8000-0000000000b7','2020-01-01',null);

-- ================== B · gasto de grupo, en positivo =========================
do $grupo$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G1  constant text := 'a0000000-0000-4000-8000-0000000000f1';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  QA  constant text := 'b0000000-0000-4000-8000-0000000000a1';
  QB  constant text := 'b0000000-0000-4000-8000-0000000000b1';
  QC  constant text := 'b0000000-0000-4000-8000-0000000000c1';
  QE  constant text := 'b0000000-0000-4000-8000-0000000000e1';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  r jsonb; v_op uuid; v_ver uuid; v_n int; v_got bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);

  -- B1 · `equal`: 10,00 entre tres es 3,34 / 3,33 / 3,33 con el centimo al
  -- pagador, y el pagador tiene ademas UN UNICO movimiento de caja por el total.
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','60000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-02-01',
        'scope_id',G1,'currency_definition_id',EUR,'total','1000',
        'payer_participant_id',QA,
        'participants', jsonb_build_array(QA,QB,QC),
        'split_method', jsonb_build_object('kind','equal')));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;

  select o.current_version_id into v_ver from core.operation o where o.id = v_op;

  -- Economicas: una por participante, ceros incluidos, con participante nominado.
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and economic_amount is not null;
  if v_n <> 3 then
    fallos := array_append(fallos, format('B1: hay %s efectos economicos y deberian ser 3', v_n));
  end if;
  select economic_amount into v_got from core.effect
   where operation_version_id = v_ver and economic_participant_id = QA::uuid;
  if v_got <> 334 then
    fallos := array_append(fallos, format('B1b: el pagador se quedo con %s y el desempate le da 334', v_got));
  end if;
  select economic_amount into v_got from core.effect
   where operation_version_id = v_ver and economic_participant_id = QB::uuid;
  if v_got <> 333 then
    fallos := array_append(fallos, format('B1c: B tiene %s y deberia tener 333', v_got));
  end if;

  -- Deudas: los que no pagaron, frente al pagador.
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and debt_amount is not null;
  if v_n <> 2 then
    fallos := array_append(fallos, format('B1d: hay %s efectos de deuda y deberian ser 2', v_n));
  end if;
  if exists (select 1 from core.effect
             where operation_version_id = v_ver and debt_amount is not null
               and debt_creditor_participant_id <> QA::uuid) then
    fallos := array_append(fallos, 'B1e: alguna deuda no tiene al pagador como acreedor');
  end if;

  -- Caja: exactamente UNA, por el total, en el Modo Personal del pagador. No se
  -- descompone en gasto mas transferencia (invariante 4).
  select count(*), coalesce(min(balance_amount), 0) into v_n, v_got from core.effect
   where operation_version_id = v_ver and balance_amount is not null;
  if v_n <> 1 or v_got <> -1000 then
    fallos := array_append(fallos, format('B1f: hay %s efectos de caja con importe %s; se espera 1 de -1000', v_n, v_got));
  end if;
  if not exists (select 1 from core.effect
                 where operation_version_id = v_ver and balance_amount is not null
                   and scope_id = SPA::uuid) then
    fallos := array_append(fallos, 'B1g: el movimiento de caja no cayo en el Modo Personal del pagador');
  end if;

  -- El reparto persistido: cabecera con metodo y pagador, y una fila por
  -- participante con ORDINAL en el orden declarado.
  if not exists (select 1 from core.split
                 where operation_version_id = v_ver and scope_id = G1::uuid
                   and split_method = 'equal' and payer_participant_id = QA::uuid) then
    fallos := array_append(fallos, 'B1h: no se persistio la cabecera de reparto');
  end if;
  select count(*) into v_n from core.split_participant where operation_version_id = v_ver;
  if v_n <> 3 then
    fallos := array_append(fallos, format('B1i: el reparto tiene %s filas y deberia tener 3', v_n));
  end if;
  if (select ordinal from core.split_participant
       where operation_version_id = v_ver and participant_id = QC::uuid) <> 2 then
    fallos := array_append(fallos, 'B1j: el ordinal no sigue el orden estable declarado por el cliente');
  end if;
  -- `equal` no declara nada: la inclusion ES la declaracion.
  if exists (select 1 from core.split_participant
             where operation_version_id = v_ver
               and (declared_weight is not null or declared_amount is not null)) then
    fallos := array_append(fallos, 'B1k: un reparto equal declaro peso o importe');
  end if;

  -- B2 · `shares`. 100,00 en 1:2:3 = 16,67 / 33,33 / 50,00.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','60000000-0000-4000-8000-000000000002',
        'command_contract_version',1,'effective_date','2026-02-02',
        'scope_id',G1,'currency_definition_id',EUR,'total','10000',
        'payer_participant_id',QA,
        'participants', jsonb_build_array(QA,QB,QC),
        'split_method', jsonb_build_object('kind','shares','weights',jsonb_build_array('1','2','3'))));
  reset role;
  select o.current_version_id into v_ver from core.operation o
   where o.id = (r ->> 'operation_id')::uuid;
  select economic_amount into v_got from core.effect
   where operation_version_id = v_ver and economic_participant_id = QA::uuid;
  if v_got <> 1667 then
    fallos := array_append(fallos, format('B2: shares 1:2:3 dio %s al primero y deberia dar 1667', v_got));
  end if;
  if (select declared_weight from core.split_participant
       where operation_version_id = v_ver and participant_id = QC::uuid) <> 3 then
    fallos := array_append(fallos, 'B2b: el peso declarado no se persistio');
  end if;

  -- B3 · `exact_amounts`. Declarado y resuelto coinciden, por definicion del
  -- metodo, y hay un CHECK en la tabla que lo impone.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','60000000-0000-4000-8000-000000000003',
        'command_contract_version',1,'effective_date','2026-02-03',
        'scope_id',G1,'currency_definition_id',EUR,'total','10000',
        'payer_participant_id',QA,
        'participants', jsonb_build_array(QA,QB,QC),
        'split_method', jsonb_build_object('kind','exact_amounts','amounts',jsonb_build_array('3000','3000','4000'))));
  reset role;
  select o.current_version_id into v_ver from core.operation o
   where o.id = (r ->> 'operation_id')::uuid;
  select economic_amount into v_got from core.effect
   where operation_version_id = v_ver and economic_participant_id = QC::uuid;
  if v_got <> 4000 then
    fallos := array_append(fallos, format('B3: exact_amounts dio %s a C y declaro 4000', v_got));
  end if;

  -- B4 · pagador SIN Modo Personal: la participacion economica y la deuda se
  -- derivan igual, y NO hay ningun efecto de caja. No se le inventa un ambito.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','60000000-0000-4000-8000-000000000004',
        'command_contract_version',1,'effective_date','2026-02-04',
        'scope_id',G1,'currency_definition_id',EUR,'total','6000',
        'payer_participant_id',QE,
        'participants', jsonb_build_array(QE,QA),
        'split_method', jsonb_build_object('kind','equal')));
  reset role;
  select o.current_version_id into v_ver from core.operation o
   where o.id = (r ->> 'operation_id')::uuid;
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and balance_amount is not null;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B4: se inventaron %s efectos de caja para un pagador sin Modo Personal', v_n));
  end if;
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and debt_amount is not null;
  if v_n <> 1 then
    fallos := array_append(fallos, format('B4b: hay %s deudas y deberia haber 1', v_n));
  end if;

  -- B5 · indivisibilidad: 0,01 entre tres deja dos participaciones en CERO, que
  -- se conservan, y NO nace ninguna deuda de cero.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','60000000-0000-4000-8000-000000000005',
        'command_contract_version',1,'effective_date','2026-02-05',
        'scope_id',G1,'currency_definition_id',EUR,'total','1',
        'payer_participant_id',QA,
        'participants', jsonb_build_array(QA,QB,QC),
        'split_method', jsonb_build_object('kind','equal')));
  reset role;
  select o.current_version_id into v_ver from core.operation o
   where o.id = (r ->> 'operation_id')::uuid;
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and economic_amount = 0;
  if v_n <> 2 then
    fallos := array_append(fallos, format('B5: hay %s participaciones en cero y deberian conservarse 2', v_n));
  end if;
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and debt_amount is not null;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B5b: se inventaron %s deudas de cero', v_n));
  end if;

  -- B6 · la clase de operacion es la de 7b, en snake_case.
  select count(*) into v_n from core.operation where operation_class <> 'group_expense';
  if v_n <> 0 then
    fallos := array_append(fallos, format('B6: hay %s operaciones que no son group_expense en esta seccion', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DEL GASTO DE GRUPO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · el gasto de grupo deriva economicas, deudas, caja y reparto';
end
$grupo$;

-- ================== C · liquidacion ==========================================
do $liquidacion$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G2  constant text := 'a0000000-0000-4000-8000-0000000000f2';
  RA  constant text := 'b0000000-0000-4000-8000-0000000000a2';
  RB  constant text := 'b0000000-0000-4000-8000-0000000000b2';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  B   constant uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; v_ver uuid; v_n int; v_got bigint; v_before int;
begin
  -- Gasto de 100,00 a partes iguales entre A y B, paga A: B le debe 50,00.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  perform api.record_group_expense(jsonb_build_object(
        'client_operation_id','61000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-03-01',
        'scope_id',G2,'currency_definition_id',EUR,'total','10000',
        'payer_participant_id',RA,
        'participants', jsonb_build_array(RA,RB),
        'split_method', jsonb_build_object('kind','equal')));

  -- C1 · liquidacion PARCIAL: pagar 30 de 50 deja 20. Sin concepto adicional.
  r := api.record_debt_settlement(jsonb_build_object(
        'client_operation_id','61000000-0000-4000-8000-000000000002',
        'command_contract_version',1,'effective_date','2026-03-02',
        'scope_id',G2,'currency_definition_id',EUR,'amount','3000',
        'debtor_participant_id',RB,'creditor_participant_id',RA));
  reset role;

  select o.current_version_id into v_ver from core.operation o
   where o.id = (r ->> 'operation_id')::uuid;

  -- UN SOLO efecto, de deuda, con delta negativo. Y NINGUN efecto de saldo
  -- (invariante 6): marcar una deuda saldada no mueve caja.
  select count(*) into v_n from core.effect where operation_version_id = v_ver;
  if v_n <> 1 then
    fallos := array_append(fallos, format('C1: la liquidacion produjo %s efectos y debe producir 1', v_n));
  end if;
  select debt_amount into v_got from core.effect where operation_version_id = v_ver;
  if v_got <> -3000 then
    fallos := array_append(fallos, format('C1b: el delta de deuda es %s y debe ser -3000', v_got));
  end if;
  if exists (select 1 from core.effect where operation_version_id = v_ver and balance_amount is not null) then
    fallos := array_append(fallos, 'C1c: la liquidacion movio saldo, contra el invariante 6');
  end if;
  if (select accounting_class from core.effect where operation_version_id = v_ver) <> 'settlement' then
    fallos := array_append(fallos, 'C1d: la clase contable de la liquidacion no es settlement');
  end if;

  -- C2 · el pendiente quedo en 2000, derivado de la proyeccion canonica.
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G2::uuid, RB::uuid, RA::uuid, null);
  reset role;
  if v_got <> 2000 then
    fallos := array_append(fallos, format('C2: el pendiente es %s y deberia ser 2000', v_got));
  end if;

  select count(*) into v_before from core.effect;

  -- C3 · SOBREPAGO por una unidad minima. Pagar 20,01 de 20,00 es invalido: el
  -- exceso pertenece a una transferencia, no a una liquidacion.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','61000000-0000-4000-8000-000000000003',
      'command_contract_version',1,'effective_date','2026-03-03',
      'scope_id',G2,'currency_definition_id',EUR,'amount','2001',
      'debtor_participant_id',RB,'creditor_participant_id',RA));
    fallos := array_append(fallos, 'C3: se acepto un sobrepago de una unidad minima');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, format('C3b: codigo inesperado en el sobrepago: %s', sqlerrm));
    end if;
  end;

  -- C4 · DIRECCION CONTRARIA. B debe a A; liquidar de A hacia B no es un pago
  -- parcial: no hay nada pendiente en esa direccion, y el neteo devuelve cero.
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','61000000-0000-4000-8000-000000000004',
      'command_contract_version',1,'effective_date','2026-03-04',
      'scope_id',G2,'currency_definition_id',EUR,'amount','1',
      'debtor_participant_id',RA,'creditor_participant_id',RB));
    fallos := array_append(fallos, 'C4: se acepto una liquidacion en la direccion contraria');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, format('C4b: codigo inesperado en la direccion contraria: %s', sqlerrm));
    end if;
  end;

  -- C5 · importe no positivo.
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','61000000-0000-4000-8000-000000000005',
      'command_contract_version',1,'effective_date','2026-03-05',
      'scope_id',G2,'currency_definition_id',EUR,'amount','0',
      'debtor_participant_id',RB,'creditor_participant_id',RA));
    fallos := array_append(fallos, 'C5: se acepto una liquidacion de cero');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_AMOUNT_NOT_POSITIVE%' then
      fallos := array_append(fallos, format('C5b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- C6 · deudor = acreedor.
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','61000000-0000-4000-8000-000000000006',
      'command_contract_version',1,'effective_date','2026-03-06',
      'scope_id',G2,'currency_definition_id',EUR,'amount','100',
      'debtor_participant_id',RB,'creditor_participant_id',RB));
    fallos := array_append(fallos, 'C6: se acepto una deuda de alguien consigo mismo');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%DEBT_SELF_REFERENCE%' then
      fallos := array_append(fallos, format('C6b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- C7 · liquidacion EXACTA: salda la deuda y la deja en cero.
  r := api.record_debt_settlement(jsonb_build_object(
        'client_operation_id','61000000-0000-4000-8000-000000000007',
        'command_contract_version',1,'effective_date','2026-03-07',
        'scope_id',G2,'currency_definition_id',EUR,'amount','2000',
        'debtor_participant_id',RB,'creditor_participant_id',RA));
  reset role;

  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G2::uuid, RB::uuid, RA::uuid, null);
  reset role;
  if v_got <> 0 then
    fallos := array_append(fallos, format('C7: tras la liquidacion exacta el pendiente es %s', v_got));
  end if;

  -- C8 · ninguno de los cuatro rechazos escribio nada, ni dejo comando huerfano.
  select count(*) into v_n from core.effect;
  if v_n <> v_before + 1 then
    fallos := array_append(fallos,
      format('C8: los rechazos escribieron efectos: %s antes, %s despues del unico exito posterior', v_before, v_n));
  end if;
  if exists (
    select 1 from core.client_command c
     where not exists (select 1 from core.operation_version ov where ov.id = c.result_version_id)) then
    fallos := array_append(fallos, 'C8b: quedo un comando huerfano, es decir, una escritura parcial');
  end if;

  -- C9 · no eres miembro del ambito: no puedes liquidar en el.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub','99999999-9999-4999-8999-999999999999')::text, true);
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','61000000-0000-4000-8000-000000000008',
      'command_contract_version',1,'effective_date','2026-03-08',
      'scope_id',G2,'currency_definition_id',EUR,'amount','1',
      'debtor_participant_id',RB,'creditor_participant_id',RA));
    fallos := array_append(fallos, 'C9: un extrano liquido una deuda ajena');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('C9b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE LA LIQUIDACION:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · parcial, exacta, sobrepago, direccion contraria y sin deuda';
end
$liquidacion$;

-- ================== D · liquidacion mediante transferencia ==================
do $transferencia$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G1  constant text := 'a0000000-0000-4000-8000-0000000000f4';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  SPB constant text := 'a0000000-0000-4000-8000-0000000000b1';
  QA  constant text := 'b0000000-0000-4000-8000-0000000000a4';
  QB  constant text := 'b0000000-0000-4000-8000-0000000000b4';
  QE  constant text := 'b0000000-0000-4000-8000-0000000000e4';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  B   constant uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; v_ver uuid; v_n int; v_got bigint;
begin
  -- Cena de 60,00 entre B y A, paga B: A le debe 30,00.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', B)::text, true);
  perform api.record_group_expense(jsonb_build_object(
        'client_operation_id','62000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-04-01',
        'scope_id',G1,'currency_definition_id',EUR,'total','6000',
        'payer_participant_id',QB,
        'participants', jsonb_build_array(QB,QA),
        'split_method', jsonb_build_object('kind','equal')));
  reset role;

  -- D1 · el ACREEDOR no puede originarla. B no puede registrar «A me ha pagado»
  -- y provocar una salida en el Modo Personal de A (invariante 14).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', B)::text, true);
  begin
    perform api.record_settlement_by_transfer(jsonb_build_object(
      'client_operation_id','62000000-0000-4000-8000-000000000002',
      'command_contract_version',1,'effective_date','2026-04-02',
      'debt_scope_id',G1,'currency_definition_id',EUR,'amount','3000',
      'debtor_participant_id',QA,'creditor_participant_id',QB));
    fallos := array_append(fallos, 'D1: el acreedor origino una salida en el Modo Personal del deudor');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%NOT_AUTHORIZED%' then
      fallos := array_append(fallos, format('D1b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- D2 · el DEUDOR si. Tres efectos: dos de saldo y uno de liquidacion, y no se
  -- fusionan (ADR-002 §3).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_settlement_by_transfer(jsonb_build_object(
        'client_operation_id','62000000-0000-4000-8000-000000000003',
        'command_contract_version',1,'effective_date','2026-04-03',
        'debt_scope_id',G1,'currency_definition_id',EUR,'amount','3000',
        'debtor_participant_id',QA,'creditor_participant_id',QB));
  reset role;

  select o.current_version_id into v_ver from core.operation o
   where o.id = (r ->> 'operation_id')::uuid;
  select count(*) into v_n from core.effect where operation_version_id = v_ver;
  if v_n <> 3 then
    fallos := array_append(fallos, format('D2: produjo %s efectos y deben ser 3', v_n));
  end if;
  select balance_amount into v_got from core.effect
   where operation_version_id = v_ver and scope_id = SPA::uuid;
  if v_got <> -3000 then
    fallos := array_append(fallos, format('D2b: el saldo del deudor cambio en %s y debe ser -3000', v_got));
  end if;
  select balance_amount into v_got from core.effect
   where operation_version_id = v_ver and scope_id = SPB::uuid;
  if v_got <> 3000 then
    fallos := array_append(fallos, format('D2c: el saldo del acreedor cambio en %s y debe ser 3000', v_got));
  end if;
  select debt_amount into v_got from core.effect
   where operation_version_id = v_ver and debt_amount is not null;
  if v_got <> -3000 then
    fallos := array_append(fallos, format('D2d: el delta de deuda es %s y debe ser -3000', v_got));
  end if;
  -- Los dos extremos de saldo son transferencia; el de deuda es liquidacion.
  select count(*) into v_n from core.effect
   where operation_version_id = v_ver and accounting_class = 'transfer';
  if v_n <> 2 then
    fallos := array_append(fallos, format('D2e: hay %s efectos de clase transfer y deben ser 2', v_n));
  end if;

  -- D3 · la deuda quedo saldada.
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G1::uuid, QA::uuid, QB::uuid, null);
  reset role;
  if v_got <> 0 then
    fallos := array_append(fallos, format('D3: el pendiente tras el pago es %s', v_got));
  end if;

  -- D4 · si el ACREEDOR no tiene Modo Personal no hay segundo extremo interno, y
  -- esta clase no es la que corresponde: ese caso es transferencia EXTERNA mas
  -- liquidacion, y son dos operaciones (`data-model.md` §4.7).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_settlement_by_transfer(jsonb_build_object(
      'client_operation_id','62000000-0000-4000-8000-000000000004',
      'command_contract_version',1,'effective_date','2026-04-04',
      'debt_scope_id',G1,'currency_definition_id',EUR,'amount','1',
      'debtor_participant_id',QA,'creditor_participant_id',QE));
    fallos := array_append(fallos, 'D4: se invento un Modo Personal para un acreedor que no tiene cuenta');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CREDITOR_WITHOUT_PERSONAL_SCOPE%' then
      fallos := array_append(fallos, format('D4b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE LA LIQUIDACION POR TRANSFERENCIA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · tres efectos, y solo la origina el deudor';
end
$transferencia$;

-- ================== E · correcciones, CAS y cross-author ====================
-- Es la PRIMERA vez que la capacidad cross-author de ADR-013 §10 —medida en E20
-- y no ejercitada por 7a, porque sus cuatro clases se anclan a un Modo Personal
-- cuyo dueno es el actor— tiene una ruta real.
do $correccion$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G1  constant text := 'a0000000-0000-4000-8000-0000000000f5';
  QA  constant text := 'b0000000-0000-4000-8000-0000000000a5';
  QB  constant text := 'b0000000-0000-4000-8000-0000000000b5';
  QC  constant text := 'b0000000-0000-4000-8000-0000000000c5';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  C   constant uuid := '33333333-3333-4333-8333-333333333333';
  r jsonb; v_op uuid; v_v1 uuid; v_v2 uuid; v_n int; v_got bigint;
begin
  -- V1: A registra una cena de 90,00 entre A, B y C.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','63000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-05-01',
        'scope_id',G1,'currency_definition_id',EUR,'total','9000',
        'payer_participant_id',QA,
        'participants', jsonb_build_array(QA,QB,QC),
        'split_method', jsonb_build_object('kind','equal')));
  reset role;
  v_op := (r ->> 'operation_id')::uuid;
  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;

  -- E1 · CORRECCION CROSS-AUTHOR: la corrige C, que NO es el autor y NO es el
  -- pagador, pero SI es integrante del ambito. `data-model.md` §7: «el derecho a
  -- corregir no deriva de haber creado la operacion».
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', C)::text, true);
  begin
    r := api.record_group_expense(jsonb_build_object(
          'client_operation_id','63000000-0000-4000-8000-000000000002',
          'command_contract_version',1,'effective_date','2026-05-01',
          'operation_id', v_op, 'expected_version_id', v_v1,
          'scope_id',G1,'currency_definition_id',EUR,'total','6000',
          'payer_participant_id',QA,
          'participants', jsonb_build_array(QA,QB,QC),
          'split_method', jsonb_build_object('kind','equal')));
  exception when others then
    r := null;
    fallos := array_append(fallos, format('E1: la correccion cross-author fallo: %s', sqlerrm));
  end;
  reset role;

  if r is not null then
    if (r ->> 'operation_id')::uuid is distinct from v_op then
      fallos := array_append(fallos, 'E1b: la correccion creo otra operacion en vez de una version nueva');
    end if;
    select o.current_version_id into v_v2 from core.operation o where o.id = v_op;
    if v_v2 = v_v1 then
      fallos := array_append(fallos, 'E1c: el puntero de vigencia no se movio');
    end if;

    -- La ATRIBUCION es por version: la operacion sigue siendo de A y la V2 es de
    -- C. Quien creo la operacion lo sigue siendo para siempre.
    if (select created_by from core.operation where id = v_op) <> A then
      fallos := array_append(fallos, 'E1d: la correccion cambio la autoria de la operacion');
    end if;
    if (select created_by from core.operation_version where id = v_v2) <> C then
      fallos := array_append(fallos, 'E1e: la version nueva no quedo atribuida a quien la creo');
    end if;

    -- El linaje: V2 supersede EXACTAMENTE a la vigente anterior. Ninguna
    -- constraint lo cubre; sale de que la fila se leyo BLOQUEADA (ADR-011 §11).
    if (select supersedes_version_id from core.operation_version where id = v_v2) is distinct from v_v1 then
      fallos := array_append(fallos, 'E1f: la V2 no supersede a la version vigente anterior');
    end if;
    if (select version_no from core.operation_version where id = v_v2) <> 2 then
      fallos := array_append(fallos, 'E1g: el version_no de la correccion no es 2');
    end if;

    -- Los efectos de V1 PERMANECEN y dejan de contar; solo cuentan los de V2.
    select count(*) into v_n from core.effect where operation_version_id = v_v1;
    if v_n = 0 then
      fallos := array_append(fallos, 'E1h: la correccion borro los efectos historicos');
    end if;
    select coalesce(sum(economic_amount), 0) into v_got
      from core.current_effect where operation_version_id = v_v1;
    if v_got <> 0 then
      fallos := array_append(fallos, 'E1i: la proyeccion canonica sigue contando la version superseded');
    end if;

    -- Y el reparto de V1 tambien permanece, intacto y en su propia clave.
    select count(*) into v_n from core.split_participant where operation_version_id = v_v1;
    if v_n <> 3 then
      fallos := array_append(fallos, format('E1j: el reparto de V1 tiene %s filas y deberia conservar 3', v_n));
    end if;
  end if;

  -- E2 · CAS OBSOLETO: quien reintente contra la V1 ya superada obtiene
  -- conflicto, no una bifurcacion.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id','63000000-0000-4000-8000-000000000003',
      'command_contract_version',1,'effective_date','2026-05-01',
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id',G1,'currency_definition_id',EUR,'total','3000',
      'payer_participant_id',QA,
      'participants', jsonb_build_array(QA,QB,QC),
      'split_method', jsonb_build_object('kind','equal')));
    fallos := array_append(fallos, 'E2: se acepto una correccion sobre una version ya superada');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%VERSION_CONFLICT%' then
      fallos := array_append(fallos, format('E2b: codigo inesperado en el CAS obsoleto: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- E3 · la deuda vigente refleja SOLO la version vigente: 60,00 entre tres deja
  -- 20,00 por cabeza, no los 30,00 de la V1.
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G1::uuid, QC::uuid, QA::uuid, null);
  reset role;
  if v_got <> 2000 then
    fallos := array_append(fallos, format('E3: la deuda vigente es %s y deberia ser 2000; el filtro de vigencia falla', v_got));
  end if;

  -- E4 · corregir una LIQUIDACION se valida excluyendo la version que supersede.
  -- Sin esa exclusion, subir de 2000 a 2500 se comprobaria contra una deuda que
  -- todavia incluye los 2000 que la propia correccion retira.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_debt_settlement(jsonb_build_object(
        'client_operation_id','63000000-0000-4000-8000-000000000010',
        'command_contract_version',1,'effective_date','2026-05-02',
        'scope_id',G1,'currency_definition_id',EUR,'amount','2000',
        'debtor_participant_id',QC,'creditor_participant_id',QA));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','63000000-0000-4000-8000-000000000011',
      'command_contract_version',1,'effective_date','2026-05-02',
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id',G1,'currency_definition_id',EUR,'amount','1000',
      'debtor_participant_id',QC,'creditor_participant_id',QA));
  exception when others then
    fallos := array_append(fallos,
      format('E4: corregir una liquidacion a la baja fallo, asi que no se excluye la version superseded: %s', sqlerrm));
  end;

  reset role;

  -- Y subir por encima del pendiente REAL sigue rechazandose.
  select o.current_version_id into v_v2 from core.operation o where o.id = v_op;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','63000000-0000-4000-8000-000000000012',
      'command_contract_version',1,'effective_date','2026-05-02',
      'operation_id', v_op, 'expected_version_id', v_v2,
      'scope_id',G1,'currency_definition_id',EUR,'amount','2001',
      'debtor_participant_id',QC,'creditor_participant_id',QA));
    fallos := array_append(fallos, 'E4b: una correccion pudo sobrepagar la deuda');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, format('E4c: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CORRECCION Y CAS:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · correccion cross-author, linaje, CAS obsoleto y vigencia de la deuda';
end
$correccion$;

-- ========= E bis · una correccion no puede dejar deuda sobreliquidada =======
-- `data-model.md` §3: una liquidacion nunca supera el importe pendiente de esa
-- deuda. `record_debt_settlement` lo comprueba al liquidar; una CORRECCION que
-- reduce el gasto puede violar el MISMO invariante desde el otro lado, sin que
-- ninguna liquidacion nueva ocurra.
--
--   deuda original 5000 · ya liquidado 4000 · nueva deuda 3000  ->  -1000
--
-- En producto las liquidaciones se hacen al cerrar el grupo, con los gastos ya
-- revisados, de modo que esto es el caso raro. Se RECHAZA y nada mas: sin deuda
-- inversa, sin compensacion automatica, sin reapertura y sin estados de cierre.
do $sobreliquidado$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G7  constant text := 'a0000000-0000-4000-8000-0000000000f7';
  QA  constant text := 'b0000000-0000-4000-8000-0000000000a7';
  QB  constant text := 'b0000000-0000-4000-8000-0000000000b7';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  r jsonb; v_op uuid; v_v1 uuid; v_vigente uuid; v_got bigint;
  v_ops int; v_vers int; v_efs int; v_cmds int; v_splits int;
  v_ops2 int; v_vers2 int; v_efs2 int; v_cmds2 int; v_splits2 int;
begin
  -- Gasto de 100,00 entre A y B, paga A: B le debe 50,00.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(jsonb_build_object(
        'client_operation_id','67000000-0000-4000-8000-000000000001',
        'command_contract_version',1,'effective_date','2026-11-01',
        'scope_id',G7,'currency_definition_id',EUR,'total','10000',
        'payer_participant_id',QA,
        'participants', jsonb_build_array(QA,QB),
        'split_method', jsonb_build_object('kind','equal')));
  v_op := (r ->> 'operation_id')::uuid;

  -- B liquida 40,00 de los 50,00. Quedan 10,00 pendientes.
  perform api.record_debt_settlement(jsonb_build_object(
        'client_operation_id','67000000-0000-4000-8000-000000000002',
        'command_contract_version',1,'effective_date','2026-11-02',
        'scope_id',G7,'currency_definition_id',EUR,'amount','4000',
        'debtor_participant_id',QB,'creditor_participant_id',QA));
  reset role;

  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;

  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G7::uuid, QB::uuid, QA::uuid, null);
  reset role;
  if v_got <> 1000 then
    fallos := array_append(fallos, format('Ebis0: el pendiente de partida es %s y deberia ser 1000', v_got));
  end if;

  select count(*) into v_ops    from core.operation;
  select count(*) into v_vers   from core.operation_version;
  select count(*) into v_efs    from core.effect;
  select count(*) into v_cmds   from core.client_command;
  select count(*) into v_splits from core.split_participant;

  -- EL CASO: corregir el gasto a 60,00 dejaria la deuda en 30,00, y ya se
  -- liquidaron 40,00. Pendiente resultante -10,00.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id','67000000-0000-4000-8000-000000000003',
      'command_contract_version',1,'effective_date','2026-11-01',
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id',G7,'currency_definition_id',EUR,'total','6000',
      'payer_participant_id',QA,
      'participants', jsonb_build_array(QA,QB),
      'split_method', jsonb_build_object('kind','equal')));
    fallos := array_append(fallos,
      'Ebis1: se acepto una correccion que deja la deuda con pendiente negativo por liquidaciones ya realizadas');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, format('Ebis1b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- CERO ESCRITURAS PARCIALES, y ningun comando huerfano.
  select count(*) into v_ops2    from core.operation;
  select count(*) into v_vers2   from core.operation_version;
  select count(*) into v_efs2    from core.effect;
  select count(*) into v_cmds2   from core.client_command;
  select count(*) into v_splits2 from core.split_participant;
  if (v_ops2, v_vers2, v_efs2, v_cmds2, v_splits2) is distinct from (v_ops, v_vers, v_efs, v_cmds, v_splits) then
    fallos := array_append(fallos, format(
      'Ebis2: el rechazo escribio: operaciones %s->%s, versiones %s->%s, efectos %s->%s, comandos %s->%s, reparto %s->%s',
      v_ops, v_ops2, v_vers, v_vers2, v_efs, v_efs2, v_cmds, v_cmds2, v_splits, v_splits2));
  end if;

  -- LA DEUDA PERMANECE en 1000.
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G7::uuid, QB::uuid, QA::uuid, null);
  reset role;
  if v_got <> 1000 then
    fallos := array_append(fallos, format('Ebis3: la deuda quedo en %s y debia permanecer en 1000', v_got));
  end if;

  -- Y LA VERSION VIGENTE DEL GASTO NO CAMBIA.
  select o.current_version_id into v_vigente from core.operation o where o.id = v_op;
  if v_vigente is distinct from v_v1 then
    fallos := array_append(fallos, 'Ebis4: el puntero de vigencia se movio pese al rechazo');
  end if;

  -- El limite es EXACTO, no una prohibicion de corregir a la baja: bajar hasta
  -- justo lo liquidado —deuda 4000, liquidado 4000, pendiente 0— SI se acepta.
  -- Sin este positivo, la regla podria estar rechazando de mas y el negativo de
  -- arriba seguiria en verde.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id','67000000-0000-4000-8000-000000000004',
      'command_contract_version',1,'effective_date','2026-11-01',
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id',G7,'currency_definition_id',EUR,'total','8000',
      'payer_participant_id',QA,
      'participants', jsonb_build_array(QA,QB),
      'split_method', jsonb_build_object('kind','equal')));
  exception when others then
    fallos := array_append(fallos,
      format('Ebis5: se rechazo una correccion que deja el pendiente exactamente en cero: %s', sqlerrm));
  end;
  reset role;

  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  v_got := sec.pending_debt(G7::uuid, QB::uuid, QA::uuid, null);
  reset role;
  if v_got <> 0 then
    fallos := array_append(fallos, format('Ebis6: tras corregir a 8000 el pendiente es %s y deberia ser 0', v_got));
  end if;

  -- Y sacar a B del gasto tampoco vale: su aportacion pasaria a cero y los
  -- 4000 liquidados se quedarian sin nada que respaldar. Es el mismo invariante
  -- para el par que DESAPARECE del reparto nuevo.
  select o.current_version_id into v_vigente from core.operation o where o.id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id','67000000-0000-4000-8000-000000000005',
      'command_contract_version',1,'effective_date','2026-11-01',
      'operation_id', v_op, 'expected_version_id', v_vigente,
      'scope_id',G7,'currency_definition_id',EUR,'total','8000',
      'payer_participant_id',QA,
      'participants', jsonb_build_array(QA),
      'split_method', jsonb_build_object('kind','equal')));
    fallos := array_append(fallos,
      'Ebis7: se saco del gasto a un participante cuya deuda ya estaba liquidada');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, format('Ebis7b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- Lo que NO cambia: liquidar sigue funcionando igual. El pendiente es 0, asi
  -- que cualquier importe lo excede, exactamente como antes de este bloque.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_debt_settlement(jsonb_build_object(
      'client_operation_id','67000000-0000-4000-8000-000000000006',
      'command_contract_version',1,'effective_date','2026-11-03',
      'scope_id',G7,'currency_definition_id',EUR,'amount','1',
      'debtor_participant_id',QB,'creditor_participant_id',QA));
    fallos := array_append(fallos, 'Ebis8: se liquido sobre una deuda ya saldada');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, format('Ebis8b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CORRECCION SOBRELIQUIDADA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E bis · una correccion no deja deuda con pendiente negativo, y el limite es exacto';
end
$sobreliquidado$;

-- ================== F · idempotencia ========================================
do $idem$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  G1  constant text := 'a0000000-0000-4000-8000-0000000000f6';
  QA  constant text := 'b0000000-0000-4000-8000-0000000000a6';
  QB  constant text := 'b0000000-0000-4000-8000-0000000000b6';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  K   constant text := '64000000-0000-4000-8000-000000000001';
  r jsonb; v_op uuid; v_cur uuid; v_n int;
  v_ops int; v_vers int; v_efs int; v_cmds int; v_splits int;
  v_ops2 int; v_vers2 int; v_efs2 int; v_cmds2 int; v_splits2 int;
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'client_operation_id', K,
    'command_contract_version',1,'effective_date','2026-06-01',
    'scope_id',G1,'currency_definition_id',EUR,'total','5000',
    'payer_participant_id',QA,
    'participants', jsonb_build_array(QA,QB),
    'split_method', jsonb_build_object('kind','equal'));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(v_payload);
  v_op := (r ->> 'operation_id')::uuid;
  reset role;

  select count(*) into v_ops    from core.operation;
  select count(*) into v_vers   from core.operation_version;
  select count(*) into v_efs    from core.effect;
  select count(*) into v_cmds   from core.client_command;
  select count(*) into v_splits from core.split_participant;

  -- F1 · REPLAY: misma clave, misma intencion. Mismo operation_id, marcado, y
  -- sin recalcular reparto ni deuda —lo demuestra que no escribe ni una fila—.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  r := api.record_group_expense(v_payload);
  reset role;
  if (r ->> 'operation_id')::uuid is distinct from v_op then
    fallos := array_append(fallos, 'F1: el replay devolvio otra operacion');
  end if;
  if not (r ->> 'already_processed')::boolean then
    fallos := array_append(fallos, 'F1b: el replay no se marco como ya procesado');
  end if;

  -- F2 · REPLAY DESPUES DE CAMBIOS POSTERIORES. Se corrige la operacion, y el
  -- reintento tardio del comando original sigue devolviendo su envelope: la
  -- idempotencia se resuelve ANTES del CAS (ADR-011 §13), asi que no falla como
  -- edicion obsoleta ni induce al cliente a generar una intencion nueva.
  select current_version_id into v_cur from core.operation where id = v_op;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id','64000000-0000-4000-8000-000000000002',
    'command_contract_version',1,'effective_date','2026-06-01',
    'operation_id', v_op,
    'expected_version_id', v_cur,
    'scope_id',G1,'currency_definition_id',EUR,'total','7000',
    'payer_participant_id',QA,
    'participants', jsonb_build_array(QA,QB),
    'split_method', jsonb_build_object('kind','equal')));
  reset role;

  select count(*) into v_ops    from core.operation;
  select count(*) into v_vers   from core.operation_version;
  select count(*) into v_efs    from core.effect;
  select count(*) into v_cmds   from core.client_command;
  select count(*) into v_splits from core.split_participant;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    r := api.record_group_expense(v_payload);
  exception when others then
    r := null;
    fallos := array_append(fallos,
      format('F2: el replay tardio fallo tras una correccion posterior: %s', sqlerrm));
  end;
  reset role;
  if r is not null then
    if (r ->> 'operation_id')::uuid is distinct from v_op or not (r ->> 'already_processed')::boolean then
      fallos := array_append(fallos, 'F2b: el replay tardio no devolvio el mismo resultado marcado como procesado');
    end if;
  end if;

  select count(*) into v_ops2    from core.operation;
  select count(*) into v_vers2   from core.operation_version;
  select count(*) into v_efs2    from core.effect;
  select count(*) into v_cmds2   from core.client_command;
  select count(*) into v_splits2 from core.split_participant;
  if (v_ops2, v_vers2, v_efs2, v_cmds2, v_splits2) is distinct from (v_ops, v_vers, v_efs, v_cmds, v_splits) then
    fallos := array_append(fallos, 'F2c: el replay escribio algo');
  end if;

  -- F3 · la MISMA clave con OTRA intencion es conflicto, y los valores exactos
  -- se conservan VERBATIM: «05000» no es «5000», asi que son intenciones
  -- distintas aunque el numero sea el mismo.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_group_expense(v_payload || jsonb_build_object('total','05000'));
    fallos := array_append(fallos,
      'F3: «05000» y «5000» se trataron como la misma intencion; la canonicalizacion esta reformateando el importe');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('F3b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- F3c · y el ORDEN de los participantes es intencion, no presentacion: es el
  -- desempate del paso 5 de ADR-002 §5.
  begin
    perform api.record_group_expense(
      v_payload || jsonb_build_object('participants', jsonb_build_array(QB,QA)));
    fallos := array_append(fallos, 'F3c: cambiar el orden estable no produjo conflicto');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('F3d: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- F4 · en cambio un identificador en MAYUSCULAS es el mismo replay: los UUID
  -- son identidades y normalizarlos es materializar el default semantico.
  begin
    r := api.record_group_expense(
      v_payload || jsonb_build_object('scope_id', upper(G1)));
    if not (r ->> 'already_processed')::boolean then
      fallos := array_append(fallos, 'F4: un UUID en mayusculas no se reconocio como el mismo replay');
    end if;
  exception when others then
    fallos := array_append(fallos, format('F4b: el replay con UUID en mayusculas fallo: %s', sqlerrm));
  end;

  -- F5 · reutilizar la clave de un ALTA para CORREGIR es conflicto, no replay:
  -- lo distingue el `command_type`.
  begin
    perform api.record_group_expense(v_payload || jsonb_build_object(
      'operation_id', v_op, 'expected_version_id', v_cur));
    fallos := array_append(fallos, 'F5: la clave de un alta sirvio para corregir');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('F5b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE IDEMPOTENCIA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · replay, replay tardio, conflicto por intencion y verbatim de los exactos';
end
$idem$;

-- ================== G · payload hostil y sin escritura parcial ==============
do $hostil$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  USD constant text := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  G1  constant text := 'a0000000-0000-4000-8000-0000000000f1';
  G3  constant text := 'a0000000-0000-4000-8000-0000000000f3';
  SPA constant text := 'a0000000-0000-4000-8000-0000000000a1';
  QA  constant text := 'b0000000-0000-4000-8000-0000000000a1';
  QB  constant text := 'b0000000-0000-4000-8000-0000000000b1';
  QF  constant text := 'b0000000-0000-4000-8000-0000000000f1';
  QA3 constant text := 'b0000000-0000-4000-8000-0000000000a3';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  base jsonb;
  v_ops int; v_vers int; v_efs int; v_cmds int; v_splits int;
  v_ops2 int; v_vers2 int; v_efs2 int; v_cmds2 int; v_splits2 int;
  v_case record;
  v_key int := 0;
begin
  base := jsonb_build_object(
    'command_contract_version',1,'effective_date','2026-07-01',
    'scope_id',G1,'currency_definition_id',EUR,'total','1000',
    'payer_participant_id',QA,
    'participants', jsonb_build_array(QA,QB),
    'split_method', jsonb_build_object('kind','equal'));

  select count(*) into v_ops    from core.operation;
  select count(*) into v_vers   from core.operation_version;
  select count(*) into v_efs    from core.effect;
  select count(*) into v_cmds   from core.client_command;
  select count(*) into v_splits from core.split_participant;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);

  for v_case in
    select * from (values
      -- el importe como NUMBER: ADR-008 §3, y es lo unico que el `jsonb`
      -- permite distinguir y un parametro `text` no (E14)
      ('total como number',          jsonb_build_object('total', 1000),                                  'PAYLOAD_INVALID'),
      ('peso como number',           jsonb_build_object('split_method', jsonb_build_object('kind','shares','weights',jsonb_build_array(1,2))), 'PAYLOAD_INVALID'),
      ('actor suplantado',           jsonb_build_object('created_by', '99999999-9999-4999-8999-999999999999'), 'PAYLOAD_INVALID'),
      ('campo desconocido',          jsonb_build_object('ordinal', '3'),                                  'PAYLOAD_INVALID'),
      -- el cliente NO envia efectos ni ordinales resueltos: son campos que
      -- ninguna funcion declara, asi que el rechazo es por forma
      ('efectos calculados',         jsonb_build_object('effects', jsonb_build_array()),                  'PAYLOAD_INVALID'),
      ('participantes no es array',  jsonb_build_object('participants', to_jsonb('nope'::text)),          'PAYLOAD_INVALID'),
      ('metodo inexistente',         jsonb_build_object('split_method', jsonb_build_object('kind','percent')), 'PAYLOAD_INVALID'),
      ('equal con pesos',            jsonb_build_object('split_method', jsonb_build_object('kind','equal','weights',jsonb_build_array('1','1'))), 'PAYLOAD_INVALID'),
      ('correccion sin CAS',         jsonb_build_object('operation_id','65000000-0000-4000-8000-00000000000f'), 'PAYLOAD_INVALID'),
      -- dominio
      ('sin participantes',          jsonb_build_object('participants', jsonb_build_array()),             'SPLIT_NO_PARTICIPANTS'),
      ('participante duplicado',     jsonb_build_object('participants', jsonb_build_array(QA,QA)),        'SPLIT_DUPLICATE_PARTICIPANT'),
      ('pagador fuera',              jsonb_build_object('payer_participant_id', QB, 'participants', jsonb_build_array(QA)), 'SPLIT_PAYER_NOT_PARTICIPANT'),
      ('total negativo',             jsonb_build_object('total','-1000'),                                 'SPLIT_NEGATIVE_TOTAL'),
      ('pesos de otra longitud',     jsonb_build_object('split_method', jsonb_build_object('kind','shares','weights',jsonb_build_array('1'))), 'SPLIT_WEIGHTS_LENGTH_MISMATCH'),
      ('peso cero',                  jsonb_build_object('split_method', jsonb_build_object('kind','shares','weights',jsonb_build_array('1','0'))), 'SPLIT_SHARE_NOT_POSITIVE'),
      ('exactos que no suman',       jsonb_build_object('split_method', jsonb_build_object('kind','exact_amounts','amounts',jsonb_build_array('300','300'))), 'SPLIT_EXACT_AMOUNTS_MISMATCH'),
      ('exacto de cero',             jsonb_build_object('split_method', jsonb_build_object('kind','exact_amounts','amounts',jsonb_build_array('1000','0'))), 'SPLIT_EXACT_AMOUNT_NOT_POSITIVE'),
      -- contexto
      ('participante de otro ambito', jsonb_build_object('participants', jsonb_build_array(QA, QA3)),     'PARTICIPANT_NOT_IN_SCOPE'),
      ('participante no elegible',   jsonb_build_object('participants', jsonb_build_array(QA, QF)),       'PARTICIPANT_NOT_ELIGIBLE'),
      ('ambito personal',            jsonb_build_object('scope_id', SPA),                                 'NOT_AUTHORIZED'),
      -- FX: la intencion es valida y el actor esta autorizado; falta una
      -- CAPACIDAD, asi que no es PAYLOAD_INVALID
      ('moneda que no es la base',   jsonb_build_object('currency_definition_id', USD),                   'CURRENCY_CONVERSION_UNSUPPORTED')
    ) as t(nombre, parche, codigo)
  loop
    v_key := v_key + 1;
    begin
      perform api.record_group_expense(
        base || v_case.parche
             || jsonb_build_object('client_operation_id',
                  ('65000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid));
      fallos := array_append(fallos, format('G/%s: se acepto', v_case.nombre));
    exception when sqlstate 'PGRST' then
      if sqlerrm not like '%' || v_case.codigo || '%' then
        fallos := array_append(fallos,
          format('G/%s: se esperaba %s y salio %s', v_case.nombre, v_case.codigo, sqlerrm));
      end if;
    end;
  end loop;
  reset role;

  -- Ninguno de los rechazos escribio NADA, ni dejo un comando huerfano.
  select count(*) into v_ops2    from core.operation;
  select count(*) into v_vers2   from core.operation_version;
  select count(*) into v_efs2    from core.effect;
  select count(*) into v_cmds2   from core.client_command;
  select count(*) into v_splits2 from core.split_participant;
  if (v_ops2, v_vers2, v_efs2, v_cmds2, v_splits2) is distinct from (v_ops, v_vers, v_efs, v_cmds, v_splits) then
    fallos := array_append(fallos, format(
      'G: hubo escritura parcial: operaciones %s->%s, versiones %s->%s, efectos %s->%s, comandos %s->%s, reparto %s->%s',
      v_ops, v_ops2, v_vers, v_vers2, v_efs, v_efs2, v_cmds, v_cmds2, v_splits, v_splits2));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PAYLOAD HOSTIL:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · veintiun rechazos, ninguno con escritura parcial';
end
$hostil$;

-- ================== H · FX en las tres clases ===============================
-- 3.C no resuelve conversion. Las tres rutas exigen que la moneda de la
-- operacion sea la base de TODOS los ambitos alcanzados, incluido el Modo
-- Personal del pagador, que el cliente ni siquiera nombra.
do $fx$
declare
  fallos text[] := '{}';
  EUR constant text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  USD constant text := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  G3  constant text := 'a0000000-0000-4000-8000-0000000000f3';
  QA3 constant text := 'b0000000-0000-4000-8000-0000000000a3';
  QB3 constant text := 'b0000000-0000-4000-8000-0000000000b3';
  A   constant uuid := '11111111-1111-4111-8111-111111111111';
  v_efs int; v_efs2 int;
begin
  select count(*) into v_efs from core.effect;

  -- El Grupo esta en USD y el Modo Personal del pagador en EUR: la conversion
  -- haria falta en el extremo de caja, y no existe.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id','66000000-0000-4000-8000-000000000001',
      'command_contract_version',1,'effective_date','2026-08-01',
      'scope_id',G3,'currency_definition_id',USD,'total','9185',
      'payer_participant_id',QA3,
      'participants', jsonb_build_array(QA3,QB3),
      'split_method', jsonb_build_object('kind','equal')));
    fallos := array_append(fallos,
      'H1: se acepto un gasto cuyo extremo de caja exige conversion, y 3.C no tiene con que resolverla');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CURRENCY_CONVERSION_UNSUPPORTED%' then
      fallos := array_append(fallos, format('H1b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  select count(*) into v_efs2 from core.effect;
  if v_efs2 <> v_efs then
    fallos := array_append(fallos, 'H2: el rechazo por FX escribio efectos');
  end if;

  -- Y ninguna ruta escribe conversiones congeladas, porque no hay ninguna.
  if (select count(*) from core.frozen_conversion) <> 0 then
    fallos := array_append(fallos, 'H3: se persistio una conversion congelada y ninguna ruta deberia poder');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE FX:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · H · el FX cross-currency se rechaza explicitamente y sin escribir';
end
$fx$;

-- ================== I · la deuda sale de la proyeccion canonica =============
do $vigencia$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- I1 · la guarda de ADR-013 §9 sigue intacta: ninguna vista nueva depende
  -- directamente de core.effect, y ninguna funcion tampoco.
  select count(*) into v_n
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dep on dep.oid = rw.ev_class
  where d.refobjid = 'core.effect'::regclass
    and d.classid = 'pg_rewrite'::regclass
    and dep.relkind = 'v'
    and dep.oid <> 'core.current_effect'::regclass;
  if v_n <> 0 then
    fallos := array_append(fallos, format('I1: %s vistas se saltan la proyeccion canonica', v_n));
  end if;

  -- I2 · los helpers de deuda del writer SI dejan dependencia analizable, porque
  -- tienen cuerpo `BEGIN ATOMIC`. Es lo que ADR-013 §9 pide para que la guarda
  -- estructural los cubra, y lo que distingue «lee la proyeccion» de «lee la
  -- tabla» sin mirar el texto.
  --
  -- El neteo esta en UN SOLO sitio, `sec.net_debt`, que es quien toca la
  -- proyeccion; `sec.pending_debt` solo lo acota a cero. La cadena tiene dos
  -- eslabones y se comprueban los dos, porque E19 midio que las dependencias
  -- del catalogo son DIRECTAS y no transitivas.
  if not exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.refobjid
    where d.objid = 'sec.net_debt(uuid, uuid, uuid, uuid)'::regprocedure
      and d.classid = 'pg_proc'::regclass and c.relname = 'current_effect') then
    fallos := array_append(fallos,
      'I2: sec.net_debt no deja dependencia hacia la proyeccion canonica; podria estar leyendo core.effect');
  end if;
  if not exists (
    select 1 from pg_depend d
    where d.objid = 'sec.pending_debt(uuid, uuid, uuid, uuid)'::regprocedure
      and d.classid = 'pg_proc'::regclass
      and d.refobjid = 'sec.net_debt(uuid, uuid, uuid, uuid)'::regprocedure) then
    fallos := array_append(fallos,
      'I2b: sec.pending_debt dejo de derivar de sec.net_debt, asi que el neteo vive en dos sitios');
  end if;
  if not exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.refobjid
    where d.objid = 'sec.debt_scopes_of_version(uuid)'::regprocedure
      and d.classid = 'pg_proc'::regclass and c.relname = 'current_effect') then
    fallos := array_append(fallos,
      'I2c: sec.debt_scopes_of_version no deja dependencia hacia la proyeccion canonica');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE VIGENCIA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · I · la deuda se deriva de la proyeccion canonica, y la guarda lo comprueba';
end
$vigencia$;


-- ================== J · paridad con los vectores compartidos =================
-- ADR-002 §7 obliga a que la frontera reproduzca EXACTAMENTE los vectores, y
-- ADR-009 §1 asume que el calculo se escribe por segunda vez PRECISAMENTE
-- porque son los vectores —y no el codigo compartido— los que detectan la
-- deriva. Las expectativas salen de `tests/vectors/`, no de este fichero.
--
-- CADA ESCENARIO ESTRENA SU PROPIO GRUPO, con sus participantes, su membresia,
-- su vinculo y su periodo, sembrados como `postgres`. Dos motivos:
--
--   · la deuda de un ambito es acumulada y no se filtra por fecha, asi que
--     compartir Grupo mezclaria escenarios y una validacion de sobrepago
--     dejaria de probar nada;
--   · el mismo nombre significa cosas distintas segun el escenario: la «M» de
--     4.4 TIENE Modo Personal y la de 4.7 NO. El vector lo dice en su propia
--     forma —lleva `payerScope` o no lo lleva— y de ahi sale si el participante
--     se vincula a una cuenta.
--
-- Los saldos de los Modos Personales SI se comparten entre escenarios, y se
-- aislan por FECHA EFECTIVA, que de paso comprueba que la fecha viaja intacta
-- desde el payload hasta la version.
do $vectores$
declare
  fallos text[] := '{}';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  U1  constant uuid := '11111111-1111-4111-8111-111111111111';
  U2  constant uuid := '22222222-2222-4222-8222-222222222222';
  U3  constant uuid := '33333333-3333-4333-8333-333333333333';
  U4  constant uuid := '44444444-4444-4444-8444-444444444444';
  v_scope_map constant jsonb := jsonb_build_object(
    'personal-A','a0000000-0000-4000-8000-0000000000a1',
    'personal-B','a0000000-0000-4000-8000-0000000000b1',
    -- «M» reutiliza la cuenta de D: ningun escenario nombra a las dos.
    'personal-M','a0000000-0000-4000-8000-0000000000d1');
  v_user_map constant jsonb := jsonb_build_object(
    'A', U1::text, 'B', U2::text, 'C', U3::text, 'D', U4::text, 'M', U4::text);

  v_case jsonb; v_op jsonb; v_exp jsonb;
  v_seen int := 0; v_key int := 0;
  v_fecha date; v_group uuid;
  v_letters text[]; v_unlinked text[]; v_letter text; v_pid uuid;
  v_kind text; v_actor uuid; v_err text; v_want bigint; v_got bigint; v_n int;
  v_expect_error text;
begin
  if to_regclass('pg_temp.vector_doc') is null then
    raise exception 'FALTA EL PROLOGO DE VECTORES: ejecuta ./scripts/vectors-prelude.sh antes de este check';
  end if;

  for v_case in
    select c from jsonb_array_elements((select doc -> 'cases' from vector_doc where name = 'scenarios')) as c
  loop
    -- El unico escenario que 3.C NO puede reproducir: `gasto-de-grupo-con-tres-
    -- monedas` exige conversion, y ADR-009 §8 deja la regla de resolucion como
    -- decision de producto pendiente. Se detecta por la FORMA del vector —lleva
    -- moneda del pagador distinta— y no por su identificador, de modo que un
    -- escenario nuevo con FX tampoco se colaria en silencio.
    continue when exists (
      select 1 from jsonb_array_elements(v_case -> 'operations') o
       where (o ? 'payerCurrency') or coalesce(o ->> 'currency', 'eur') <> 'eur');

    v_seen  := v_seen + 1;
    v_fecha := date '2026-09-01' + (v_seen - 1);
    v_group := ('a0000000-0000-4000-8000-' || lpad((900000 + v_seen)::text, 12, '0'))::uuid;
    v_expect_error := v_case ->> 'expectError';
    v_err := null;

    -- Letras que el escenario nombra, en cualquier papel.
    select array_agg(distinct l) into v_letters from (
      select jsonb_array_elements_text(coalesce(o -> 'participants', '[]'::jsonb)) as l
        from jsonb_array_elements(v_case -> 'operations') o
      union all
      select x from jsonb_array_elements(v_case -> 'operations') o,
                    lateral (values (o ->> 'payer'), (o ->> 'debtor'), (o ->> 'creditor')) as v(x)
    ) s where l is not null;

    -- Sin cuenta: el pagador de un gasto de Grupo que el vector declara SIN
    -- `payerScope`. Es la unica fuente de esa informacion, y es la correcta:
    -- «no se le inventa ningun Modo Personal» (`data-model.md` §4.7).
    select coalesce(array_agg(o ->> 'payer'), '{}') into v_unlinked
      from jsonb_array_elements(v_case -> 'operations') o
     where o ->> 'kind' = 'groupExpense' and not (o ? 'payerScope');

    insert into core.scope (id, kind, base_currency_definition_id)
    values (v_group, 'group', EUR);
    insert into core.membership (scope_id, user_id)
    select v_group, u from unnest(array[U1, U2, U3, U4]) as u;

    foreach v_letter in array coalesce(v_letters, '{}') loop
      v_pid := ('c0000000-0000-4000-8000-'
                || lpad((v_seen * 10 + strpos('ABCDM', v_letter))::text, 12, '0'))::uuid;
      insert into core.participant (id, scope_id, display_name)
      values (v_pid, v_group, v_letter);
      insert into core.participant_period (participant_id, valid_from, valid_until)
      values (v_pid, '2020-01-01', null);
      if not (v_letter = any(v_unlinked)) then
        insert into core.participant_user_link (participant_id, scope_id, user_id)
        values (v_pid, v_group, (v_user_map ->> v_letter)::uuid);
      end if;
    end loop;

    -- ------------------------------------------------ ejecutar el escenario --
    for v_op in select o from jsonb_array_elements(v_case -> 'operations') as o loop
      v_key  := v_key + 1;
      v_kind := v_op ->> 'kind';

      -- El actor. Para las clases de 7a es el dueno del ambito de salida; para
      -- las de 7b, un integrante — salvo la liquidacion por transferencia, que
      -- SOLO la origina el deudor.
      v_actor := case
        when v_kind in ('adjustment','personalExpense','personalIncome','externalTransfer')
          then (select owner_user_id from core.scope
                 where id = (v_scope_map ->> (v_op ->> 'scope'))::uuid)
        when v_kind = 'internalTransfer'
          then (select owner_user_id from core.scope
                 where id = (v_scope_map ->> (v_op ->> 'fromScope'))::uuid)
        when v_kind = 'settlementByTransfer'
          then (v_user_map ->> (v_op ->> 'debtor'))::uuid
        -- 4.3 es «el mismo gasto registrado por OTRO miembro». El vector es
        -- identico a 4.2 a proposito: el autor no es un parametro de la
        -- derivacion. Registrarlo con otro actor es lo que lo comprueba.
        when v_case ->> 'id' like '4.3-%' then U2
        else U1
      end;

      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);
      begin
        if v_kind = 'adjustment' then
          perform api.record_adjustment(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 2, 'effective_date', v_fecha::text, 'effective_time','09:00',
            'scope_id', v_scope_map ->> (v_op ->> 'scope'),
            'delta', v_op ->> 'delta', 'currency_definition_id', EUR::text));

        elsif v_kind = 'personalExpense' then
          perform api.record_personal_expense(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 2, 'effective_date', v_fecha::text,
            'effective_time', '09:30',
            'scope_id', v_scope_map ->> (v_op ->> 'scope'),
            'amount', v_op ->> 'amount', 'currency_definition_id', EUR::text,
            'concept', 'Compra',
            'category_id', '4ed30a44-9f82-578f-828c-b491a25ebdd9'));

        elsif v_kind = 'personalIncome' then
          perform api.record_personal_income(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 1, 'effective_date', v_fecha::text,
            'effective_time', '09:30',
            'scope_id', v_scope_map ->> (v_op ->> 'scope'),
            'amount', v_op ->> 'amount', 'currency_definition_id', EUR::text,
            'concept', 'Nomina',
            'category_id', 'ea9f1167-f497-5edf-af01-c7e1c3a64d9d'));

        elsif v_kind = 'externalTransfer' then
          perform api.record_external_transfer(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 1, 'effective_date', v_fecha::text,
            'scope_id', v_scope_map ->> (v_op ->> 'scope'),
            'delta', v_op ->> 'delta', 'currency_definition_id', EUR::text));

        elsif v_kind = 'internalTransfer' then
          if (v_op ->> 'fromAmount') is distinct from (v_op ->> 'toAmount') then
            fallos := array_append(fallos, format(
              'J/%s: los dos extremos llevan importes distintos y 3.C no soporta conversion', v_case ->> 'id'));
          end if;
          perform api.record_internal_transfer(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 1, 'effective_date', v_fecha::text,
            'from_scope_id', v_scope_map ->> (v_op ->> 'fromScope'),
            'to_scope_id',   v_scope_map ->> (v_op ->> 'toScope'),
            'amount', v_op ->> 'fromAmount', 'currency_definition_id', EUR::text));

        elsif v_kind = 'groupExpense' then
          perform api.record_group_expense(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 1, 'effective_date', v_fecha::text,
            'scope_id', v_group::text, 'currency_definition_id', EUR::text,
            'total', v_op ->> 'total',
            'payer_participant_id',
              ('c0000000-0000-4000-8000-'
               || lpad((v_seen * 10 + strpos('ABCDM', v_op ->> 'payer'))::text, 12, '0')),
            'participants',
              (select jsonb_agg('c0000000-0000-4000-8000-'
                       || lpad((v_seen * 10 + strpos('ABCDM', l))::text, 12, '0') order by ord)
                 from jsonb_array_elements_text(v_op -> 'participants') with ordinality as u(l, ord)),
            'split_method', v_op -> 'method'));

        elsif v_kind = 'debtSettlement' then
          perform api.record_debt_settlement(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 1, 'effective_date', v_fecha::text,
            'scope_id', v_group::text, 'currency_definition_id', EUR::text,
            'amount', v_op ->> 'amount',
            'debtor_participant_id',
              ('c0000000-0000-4000-8000-'
               || lpad((v_seen * 10 + strpos('ABCDM', v_op ->> 'debtor'))::text, 12, '0')),
            'creditor_participant_id',
              ('c0000000-0000-4000-8000-'
               || lpad((v_seen * 10 + strpos('ABCDM', v_op ->> 'creditor'))::text, 12, '0'))));

        elsif v_kind = 'settlementByTransfer' then
          -- Un solo importe: transferir mas de lo debido no es una liquidacion
          -- mayor, y `operation_version` lleva EXACTAMENTE un importe original.
          if (v_op ->> 'fromAmount') is distinct from (v_op ->> 'toAmount')
             or (v_op ->> 'fromAmount') is distinct from (v_op ->> 'settledAmount') then
            fallos := array_append(fallos, format(
              'J/%s: transferido y liquidado difieren, y 3.C no lo representa en una sola version', v_case ->> 'id'));
          end if;
          perform api.record_settlement_by_transfer(jsonb_build_object(
            'client_operation_id', ('70000000-0000-4000-8000-' || lpad(v_key::text, 12, '0'))::uuid,
            'command_contract_version', 1, 'effective_date', v_fecha::text,
            'debt_scope_id', v_group::text, 'currency_definition_id', EUR::text,
            'amount', v_op ->> 'settledAmount',
            'debtor_participant_id',
              ('c0000000-0000-4000-8000-'
               || lpad((v_seen * 10 + strpos('ABCDM', v_op ->> 'debtor'))::text, 12, '0')),
            'creditor_participant_id',
              ('c0000000-0000-4000-8000-'
               || lpad((v_seen * 10 + strpos('ABCDM', v_op ->> 'creditor'))::text, 12, '0'))));

        else
          fallos := array_append(fallos, format('J/%s: kind desconocido %s', v_case ->> 'id', v_kind));
        end if;
      exception when sqlstate 'PGRST' then
        v_err := sqlerrm;
      end;
      reset role;

      exit when v_err is not null;
    end loop;

    -- --------------------------------------------------------- comparacion --
    if v_expect_error is not null then
      -- El vector espera un codigo de dominio concreto, y ese codigo ES el
      -- contrato compartido entre la implementacion de referencia y esta.
      if v_err is null then
        fallos := array_append(fallos,
          format('J/%s: se esperaba %s y la operacion se acepto', v_case ->> 'id', v_expect_error));
      elsif v_err not like '%' || v_expect_error || '%' then
        fallos := array_append(fallos,
          format('J/%s: se esperaba %s y salio %s', v_case ->> 'id', v_expect_error, v_err));
      end if;
      continue;
    end if;

    if v_err is not null then
      fallos := array_append(fallos, format('J/%s: fallo inesperado: %s', v_case ->> 'id', v_err));
      continue;
    end if;

    -- Saldos. Salen de la PROYECCION CANONICA, nunca reimplementando el filtro
    -- de vigencia (ADR-013 §9).
    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'balances', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      select coalesce(sum(e.balance_amount), 0) into v_got
        from core.current_effect e
        join core.operation_version ov on ov.id = e.operation_version_id
       where e.scope_id = coalesce((v_scope_map ->> (v_exp ->> 'scope'))::uuid, v_group)
         and ov.effective_date = v_fecha;
      if v_got <> v_want then
        fallos := array_append(fallos, format('J/%s: saldo de %s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'scope', v_got, v_want));
      end if;
    end loop;

    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'economicExpense', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      select coalesce(sum(e.economic_amount), 0) into v_got
        from core.current_effect e
        join core.operation_version ov on ov.id = e.operation_version_id
       where e.scope_id = coalesce((v_scope_map ->> (v_exp ->> 'scope'))::uuid, v_group)
         and e.accounting_class = 'expense' and e.economic_amount is not null
         and ov.effective_date = v_fecha;
      if v_got <> v_want then
        fallos := array_append(fallos, format('J/%s: economica de %s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'scope', v_got, v_want));
      end if;
    end loop;

    -- Participacion economica POR PARTICIPANTE. Es la prueba de que el reparto
    -- por mayor resto se reprodujo exactamente, hasta la unidad minima.
    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'participantExpense', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      select coalesce(sum(e.economic_amount), 0) into v_got
        from core.current_effect e
       where e.scope_id = v_group
         and e.economic_participant_id = ('c0000000-0000-4000-8000-'
              || lpad((v_seen * 10 + strpos('ABCDM', v_exp ->> 'participant'))::text, 12, '0'))::uuid;
      if v_got <> v_want then
        fallos := array_append(fallos, format('J/%s: participacion de %s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'participant', v_got, v_want));
      end if;
    end loop;

    -- Deudas netas del par, en ambas direcciones.
    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'debts', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      select coalesce(sum(
               case when e.debt_debtor_participant_id = ('c0000000-0000-4000-8000-'
                        || lpad((v_seen * 10 + strpos('ABCDM', v_exp ->> 'debtor'))::text, 12, '0'))::uuid
                    then e.debt_amount else - e.debt_amount end), 0) into v_got
        from core.current_effect e
       where e.scope_id = v_group and e.debt_amount is not null
         and array[e.debt_debtor_participant_id, e.debt_creditor_participant_id] <@ array[
               ('c0000000-0000-4000-8000-' || lpad((v_seen * 10 + strpos('ABCDM', v_exp ->> 'debtor'))::text, 12, '0'))::uuid,
               ('c0000000-0000-4000-8000-' || lpad((v_seen * 10 + strpos('ABCDM', v_exp ->> 'creditor'))::text, 12, '0'))::uuid];
      if v_got <> v_want then
        fallos := array_append(fallos, format('J/%s: deuda %s->%s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'debtor', v_exp ->> 'creditor', v_got, v_want));
      end if;
    end loop;

    -- Y NINGUNA deuda de mas: si el vector enumera dos pares no nulos, tiene que
    -- haber exactamente dos. Es lo que detecta una deuda de cero inventada.
    if v_case -> 'expect' ? 'debts' then
      select count(*) into v_n from (
        select 1 from core.current_effect e
         where e.scope_id = v_group and e.debt_amount is not null
         group by least(e.debt_debtor_participant_id, e.debt_creditor_participant_id),
                  greatest(e.debt_debtor_participant_id, e.debt_creditor_participant_id)
        having sum(case when e.debt_debtor_participant_id < e.debt_creditor_participant_id
                        then e.debt_amount else - e.debt_amount end) <> 0
      ) t;
      if v_n <> jsonb_array_length(v_case -> 'expect' -> 'debts') then
        fallos := array_append(fallos, format('J/%s: hay %s pares con deuda no nula y el vector enumera %s',
          v_case ->> 'id', v_n, jsonb_array_length(v_case -> 'expect' -> 'debts')));
      end if;
    end if;

    -- Posicion neta: lo que le deben menos lo que debe.
    for v_exp in select e from jsonb_array_elements(coalesce(v_case -> 'expect' -> 'netDebtPosition', '[]'::jsonb)) as e loop
      v_want := (v_exp ->> 'amount')::bigint;
      v_pid  := ('c0000000-0000-4000-8000-'
                 || lpad((v_seen * 10 + strpos('ABCDM', v_exp ->> 'participant'))::text, 12, '0'))::uuid;
      select coalesce(sum(case when e.debt_creditor_participant_id = v_pid then  e.debt_amount
                               when e.debt_debtor_participant_id   = v_pid then - e.debt_amount
                               else 0 end), 0) into v_got
        from core.current_effect e
       where e.scope_id = v_group and e.debt_amount is not null;
      if v_got <> v_want then
        fallos := array_append(fallos, format('J/%s: posicion neta de %s = %s y el vector espera %s',
          v_case ->> 'id', v_exp ->> 'participant', v_got, v_want));
      end if;
    end loop;

    -- En que ambitos hubo movimiento de caja. Con la lista vacia, en ninguno: es
    -- el contraste entre «el pagador tiene Modo Personal» y «no se le inventa».
    if v_case -> 'expect' ? 'balanceEffectScopes' then
      select count(distinct e.scope_id) into v_n
        from core.current_effect e
        join core.operation_version ov on ov.id = e.operation_version_id
       where e.balance_amount is not null and ov.effective_date = v_fecha;
      if v_n <> jsonb_array_length(v_case -> 'expect' -> 'balanceEffectScopes') then
        fallos := array_append(fallos, format('J/%s: hubo caja en %s ambitos y el vector enumera %s',
          v_case ->> 'id', v_n, jsonb_array_length(v_case -> 'expect' -> 'balanceEffectScopes')));
      end if;
      for v_letter in select e from jsonb_array_elements_text(v_case -> 'expect' -> 'balanceEffectScopes') as e loop
        if not exists (
          select 1 from core.current_effect e2
          join core.operation_version ov on ov.id = e2.operation_version_id
          where e2.balance_amount is not null and ov.effective_date = v_fecha
            and e2.scope_id = coalesce((v_scope_map ->> v_letter)::uuid, v_group)) then
          fallos := array_append(fallos, format('J/%s: no hubo movimiento de caja en %s',
            v_case ->> 'id', v_letter));
        end if;
      end loop;
    end if;
  end loop;

  -- Diecinueve de los veinte escenarios. El que falta —`gasto-de-grupo-con-tres-
  -- monedas`— exige conversion, y la seccion H comprueba que se RECHAZA en vez
  -- de resolverse mal. Es una limitacion real de 3.C, dicha y no rellenada.
  -- Eran 19; con los vectores de ingreso de F6.B son 22. El de escala cero se
  -- excluye solo, por la misma regla de FORMA que aparta el de tres monedas:
  -- este runner solo siembra EUR, y el vector en JPY lo ejercita el check de 7a,
  -- cuyo fixture si tiene un ambito de escala cero.
  if v_seen <> 22 then
    fallos := array_append(fallos,
      format('J: se ejercitaron %s escenarios y deberian ser 22; los excluidos son el de tres monedas y el de escala cero', v_seen));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PARIDAD CON LOS VECTORES:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · J · los 22 escenarios alcanzables se reproducen exactamente';
end
$vectores$;

-- ================== K · paridad con los vectores de reparto =================
-- Los 22 casos de `tests/vectors/split.json`, contra la traduccion PL/pgSQL del
-- dominio. Se ejercitan sobre el helper y no sobre la funcion publica: son
-- vectores del REPARTO, y hacerlos pasar por una operacion completa obligaria a
-- fabricar un Grupo, participantes y monedas por caso sin probar nada mas.
--
-- Las monedas del vector —eur, jpy, bhd— no cambian el reparto: ADR-003 T11 lo
-- define sobre la magnitud en unidad minima, que ya viene escalada. Lo que la
-- escala decide es cuantas unidades hay, y eso ya esta en `total`.
do $split$
declare
  fallos text[] := '{}';
  v_case jsonb; v_n int := 0;
  v_participants uuid[]; v_payer uuid; v_got bigint[]; v_want bigint[];
  v_ids constant jsonb := jsonb_build_object(
    'A','d0000000-0000-4000-8000-00000000000a',
    'B','d0000000-0000-4000-8000-00000000000b',
    'C','d0000000-0000-4000-8000-00000000000c',
    'D','d0000000-0000-4000-8000-00000000000d');
  v_err text;
begin
  if to_regclass('pg_temp.vector_doc') is null then
    raise exception 'FALTA EL PROLOGO DE VECTORES';
  end if;

  -- Sin cambio de rol: `sec.resolve_split` no toca ninguna tabla, asi que la
  -- RLS no interviene y el reparto es exactamente el mismo lo invoque quien lo
  -- invoque. Es la propiedad que hace comparables las dos implementaciones.
  for v_case in
    select c from jsonb_array_elements((select doc -> 'cases' from vector_doc where name = 'split')) as c
  loop
    v_n := v_n + 1;
    v_err := null;
    select coalesce(array_agg((v_ids ->> l)::uuid order by ord), '{}')
      into v_participants
      from jsonb_array_elements_text(v_case -> 'given' -> 'participants') with ordinality as u(l, ord);
    v_payer := (v_ids ->> (v_case -> 'given' ->> 'payer'))::uuid;

    begin
      v_got := sec.resolve_split((v_case -> 'given' ->> 'total')::bigint,
                                 v_participants, v_payer, v_case -> 'given' -> 'method');
    exception when sqlstate 'PGRST' then
      v_got := null;
      v_err := sqlerrm;
    end;

    if v_case ? 'expectError' then
      if v_err is null then
        fallos := array_append(fallos, format('K/%s: se esperaba %s y el reparto se acepto',
          v_case ->> 'id', v_case ->> 'expectError'));
      elsif v_err not like '%' || (v_case ->> 'expectError') || '%' then
        fallos := array_append(fallos, format('K/%s: se esperaba %s y salio %s',
          v_case ->> 'id', v_case ->> 'expectError', v_err));
      end if;
    elsif v_err is not null then
      fallos := array_append(fallos, format('K/%s: fallo inesperado: %s', v_case ->> 'id', v_err));
    else
      select array_agg(x::bigint order by ord) into v_want
        from jsonb_array_elements_text(v_case -> 'expect' -> 'shares') with ordinality as u(x, ord);
      if v_got is distinct from v_want then
        fallos := array_append(fallos, format('K/%s: el reparto dio %s y el vector espera %s',
          v_case ->> 'id', v_got::text, v_want::text));
      end if;
    end if;
  end loop;

  if v_n <> 22 then
    fallos := array_append(fallos, format('K: se ejercitaron %s vectores de reparto y hay 22', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PARIDAD DEL REPARTO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · K · los 22 vectores de reparto se reproducen exactamente';
end
$split$;

-- ================== L · correspondencia de vocabulario ======================
-- La union entre los `kind` en camelCase de los vectores y los
-- `operation_class` en snake_case. Con 7b, las SIETE clases tienen ruta, asi que
-- la correspondencia se puede comprobar completa y en las dos direcciones.
do $vocab$
declare
  fallos text[] := '{}';
  v_kind text;
  v_map constant jsonb := jsonb_build_object(
    'adjustment',           'adjustment',
    'personalExpense',      'personal_expense',
    'personalIncome',       'personal_income',
    'externalTransfer',     'external_transfer',
    'internalTransfer',     'internal_transfer',
    'groupExpense',         'group_expense',
    'debtSettlement',       'debt_settlement',
    'settlementByTransfer', 'settlement_by_transfer');
  v_fn text;
begin
  for v_kind in
    select distinct o ->> 'kind'
      from jsonb_array_elements((select doc -> 'cases' from vector_doc where name = 'scenarios')) c,
           jsonb_array_elements(c -> 'operations') o
  loop
    if v_map ->> v_kind is null then
      fallos := array_append(fallos,
        format('L: el vector usa el kind %s y no hay operation_class que le corresponda', v_kind));
    end if;
  end loop;

  -- Y al reves: toda clase de la correspondencia tiene su funcion publica.
  for v_kind in select value from jsonb_each_text(v_map) loop
    v_fn := format('api.record_%s(jsonb)', v_kind);
    if to_regprocedure(v_fn) is null then
      fallos := array_append(fallos, format('L2: no existe %s para la clase %s', v_fn, v_kind));
    end if;
  end loop;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE VOCABULARIO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · L · las ocho clases del vocabulario tienen ruta autoritativa';
end
$vocab$;

rollback;
