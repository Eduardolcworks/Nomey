-- Comprobaciones del provisioning del Modo Personal y del catalogo monetario,
-- contra la base REAL construida por las migraciones.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/personal-provisioning.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- Evidencia de la que sale el diseno: `supabase/e21/`.
--
-- Lo que este fichero NO comprueba porque ya lo hace otro, y no se duplica: que
-- ninguna vista de `api` dependa directamente de `core.effect` saltandose la
-- proyeccion canonica. Lo vigilan `canonical-attribution.sql` A3 y
-- `authoritative-writer-debt.sql` I1, y detectaron una version anterior de
-- `api.personal_scope` que lo hacia. Ver el comentario de la vista en su
-- migracion.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- Identidades simuladas. Los checks siembran como `postgres`, que es
-- exactamente lo que hace el provisioning real.
create temporary table pp_actor (k text primary key, v uuid) on commit drop;
insert into pp_actor (k, v) values
  ('u1', 'a1111111-1111-4111-8111-111111111111'),
  ('u2', 'a2222222-2222-4222-8222-222222222222');

-- ====================== A · catalogo monetario y superficie ================
do $a$
declare
  fallos text[] := '{}';
  v_n int;
  v_t text;
  -- La tabla exacta aprobada por producto, con sus UUID v5 reproducibles.
  -- Si esto deja de cuadrar, o se regenero un identificador —que parte los
  -- entornos en silencio— o se cambio una escala sin decidirlo.
  esperado constant text[][] := array[
    ['830e6f7e-2e33-564e-9ea3-f6c2023af1fe','EUR','2'],
    ['34cb8424-2243-52d8-be99-e2b7d22884b8','USD','2'],
    ['fe22eeff-f72b-50ce-9b37-6033833df95e','GBP','2'],
    ['c8483062-e215-5da5-850e-cd7bfda52eff','CHF','2'],
    ['f981b2f9-a022-5de8-aa6d-3af277d9dcd3','JPY','0'],
    ['6cfbf3ad-967d-50ba-9822-f1afbb10f7f5','CAD','2'],
    ['c9203a94-12aa-5d7f-8703-2ee17e524dca','AUD','2'],
    ['c3d5768c-33be-5ab8-896e-38203ac5cc48','NZD','2'],
    ['f725bdd8-5690-53a8-85c0-eabed7405c10','SEK','2'],
    ['f2fe8324-641c-548d-b3af-411db0d39448','NOK','2'],
    ['31f1a13d-3829-5af9-9b65-e5da1181b9ac','DKK','2'],
    ['a280144a-a4a0-55cd-98db-7b8acf25a638','PLN','2'],
    ['d281d5cf-cdd5-5207-93a5-df1f80e6de84','CZK','2'],
    ['8b951c59-bbd1-539b-9336-4174fbf47bdb','HUF','2'],
    ['8b33cd38-5e20-5145-bee9-c0b81c9a81ba','RON','2'],
    ['b500e177-a2ff-5a55-b0b6-868dc91a10f6','MXN','2'],
    ['50850a6c-39ff-5f35-85aa-afd6ea3732e6','BRL','2'],
    ['6cbdabc6-2d2f-5090-a063-3a366f9fd23d','ARS','2'],
    ['3304aa15-10b1-5eca-a6c8-3c149a9f91f1','COP','2'],
    ['a85ae854-0a0d-51de-bb34-4b7a20229bb9','CLP','0']];
  i int;
begin
  -- A1 · las veinte definiciones, con SU identidad y SU escala.
  for i in 1 .. array_length(esperado, 1) loop
    if not exists (
      select 1 from core.currency_definition c
       where c.id = esperado[i][1]::uuid
         and c.code = esperado[i][2]
         and c.scale = esperado[i][3]::smallint
    ) then
      fallos := array_append(fallos,
        format('A1: falta o no coincide la definicion %s (%s escala %s)',
               esperado[i][2], esperado[i][1], esperado[i][3]));
    end if;
  end loop;

  select count(*) into v_n from core.currency_definition;
  if v_n <> array_length(esperado, 1) then
    fallos := array_append(fallos,
      format('A1b: el catalogo tiene %s definiciones y se esperaban %s', v_n, array_length(esperado, 1)));
  end if;

  -- A2 · codigos unicos. Es la PRECONDICION de sec.resolve_recommended_currency:
  -- con dos definiciones para un mismo codigo, la recomendacion por Region deja
  -- de tener respuesta y la funcion se niega (ADR-004).
  select count(*) into v_n from (
    select code from core.currency_definition group by code having count(*) > 1
  ) d;
  if v_n <> 0 then
    fallos := array_append(fallos,
      format('A2: %s codigos ISO duplicados en el catalogo; la recomendacion por Region deja de ser resoluble', v_n));
  end if;

  -- A3 · las dos vistas existen y son security_invoker. E19: sin eso, el camino
  -- de lectura pierde la RLS y SIGUE devolviendo filas creibles.
  for v_t in select unnest(array['currency_definition','personal_scope']) loop
    if to_regclass('api.' || v_t) is null then
      fallos := array_append(fallos, format('A3: no existe la vista api.%s', v_t));
    end if;
  end loop;

  for v_t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'api' and c.relname in ('currency_definition','personal_scope')
       and not coalesce((select option_value = 'true' from pg_options_to_table(c.reloptions)
                         where option_name = 'security_invoker'), false)
  loop
    fallos := array_append(fallos, format('A3b: api.%s NO es security_invoker', v_t));
  end loop;

  -- A3c · el cliente solo LEE las dos vistas. `api.currency_definition` es una
  -- vista simple sobre una tabla, asi que PostgreSQL la considera
  -- AUTO-ACTUALIZABLE —el tipado generado le pone `Insert` y `Update`—: si
  -- alguien le concediera escritura, el cliente podria sembrar definiciones
  -- monetarias. Lo unico que hoy lo impide es la ausencia del grant.
  for v_t in select unnest(array['currency_definition','personal_scope']) loop
    if has_table_privilege('authenticated', 'api.' || v_t, 'INSERT')
       or has_table_privilege('authenticated', 'api.' || v_t, 'UPDATE')
       or has_table_privilege('authenticated', 'api.' || v_t, 'DELETE') then
      fallos := array_append(fallos, format('A3c: authenticated puede ESCRIBIR en api.%s', v_t));
    end if;
  end loop;

  -- A4 · `owner_user_id` no se proyecta: es identidad, y el cliente no la
  -- necesita para leer lo suyo.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'api' and table_name = 'personal_scope'
       and column_name = 'owner_user_id'
  ) then
    fallos := array_append(fallos, 'A4: api.personal_scope proyecta owner_user_id');
  end if;

  if array_length(fallos, 1) > 0 then
    raise exception E'A · catalogo y superficie:\n%', array_to_string(fallos, E'\n');
  end if;
end
$a$;

-- ========================== B · el rol y sus privilegios ===================
do $b$
declare
  fallos text[] := '{}';
  v_rel text;
  v_n int;
begin
  -- B1 · forma del rol. NOBYPASSRLS es lo que mantiene la RLS como segunda
  -- barrera tambien para el provisioning.
  if not exists (
    select 1 from pg_roles
     where rolname = 'nomey_provisioner'
       and rolcanlogin = false and rolbypassrls = false and rolsuper = false
  ) then
    fallos := array_append(fallos, 'B1: nomey_provisioner no existe o no es NOLOGIN/NOBYPASSRLS/NOSUPERUSER');
  end if;

  -- B2 · ninguna escritura contable. El provisioning no es un hecho contable.
  for v_rel in select unnest(array[
      'core.operation','core.operation_version','core.effect','core.client_command',
      'core.split','core.split_participant','core.frozen_conversion',
      'core.participant','core.participant_user_link','core.participant_period'])
  loop
    if has_table_privilege('nomey_provisioner', v_rel, 'INSERT')
       or has_table_privilege('nomey_provisioner', v_rel, 'UPDATE')
       or has_table_privilege('nomey_provisioner', v_rel, 'DELETE') then
      fallos := array_append(fallos, format('B2: nomey_provisioner puede escribir en %s', v_rel));
    end if;
  end loop;

  -- B2b · ni DELETE sobre lo suyo.
  if has_table_privilege('nomey_provisioner', 'core.scope', 'DELETE')
     or has_table_privilege('nomey_provisioner', 'core.membership', 'DELETE') then
    fallos := array_append(fallos, 'B2b: nomey_provisioner puede borrar ambitos o membresias');
  end if;

  -- B3 · GUARDA CONTRA EL MODO DE FALLO SILENCIOSO. E21 lo midio tres veces:
  -- con GRANT y sin policy aplicable, la lectura devuelve CERO FILAS SIN ERROR.
  -- Toda tabla con RLS sobre la que el rol tenga SELECT debe tener policy.
  for v_rel in
    select n.nspname || '.' || c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'core' and c.relkind = 'r' and c.relrowsecurity
       and has_table_privilege('nomey_provisioner', c.oid, 'SELECT')
       and not exists (
         select 1 from pg_policy p
          where p.polrelid = c.oid
            and 'nomey_provisioner' = any (select rolname from pg_roles where oid = any (p.polroles)))
  loop
    fallos := array_append(fallos,
      format('B3: nomey_provisioner tiene SELECT sobre %s SIN policy aplicable: devolveria cero filas sin error', v_rel));
  end loop;

  -- B4 · el escritor contable sigue sin poder hacer nada de esto.
  if has_table_privilege('nomey_writer', 'core.scope', 'INSERT')
     or has_table_privilege('nomey_writer', 'core.membership', 'INSERT') then
    fallos := array_append(fallos, 'B4: nomey_writer puede crear ambitos o membresias');
  end if;

  -- Y su policy sobre scope sigue siendo "puedo bloquear, no puedo escribir".
  select count(*) into v_n
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'scope' and p.polname = 'scope_writer_lock'
     and pg_get_expr(p.polwithcheck, p.polrelid) = 'false';
  if v_n <> 1 then
    fallos := array_append(fallos, 'B4b: scope_writer_lock ya no tiene WITH CHECK (false)');
  end if;

  -- B5 · `anon` no ejecuta ninguna de las dos; `authenticated` si.
  if has_function_privilege('anon', 'api.ensure_personal_scope(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'api.set_personal_base_currency(jsonb)', 'EXECUTE') then
    fallos := array_append(fallos, 'B5: anon puede ejecutar las funciones de provisioning');
  end if;
  if not has_function_privilege('authenticated', 'api.ensure_personal_scope(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'api.set_personal_base_currency(jsonb)', 'EXECUTE') then
    fallos := array_append(fallos, 'B5b: authenticated no puede ejecutar las funciones de provisioning');
  end if;

  -- B6 · las dos funciones son SECURITY DEFINER de nomey_provisioner, no de
  -- postgres. Una ESCRITURA nunca debe quedar por encima de la RLS.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'api'
       and p.proname in ('ensure_personal_scope','set_personal_base_currency')
       and (p.prosecdef = false or pg_get_userbyid(p.proowner) <> 'nomey_provisioner')
  ) then
    fallos := array_append(fallos, 'B6: alguna funcion de provisioning no es SECURITY DEFINER de nomey_provisioner');
  end if;

  -- B7 · ninguna policy nueva aplica a PUBLIC.
  select count(*) into v_n
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where p.polname like '%provisioner%' and p.polroles = '{0}';
  if v_n <> 0 then
    fallos := array_append(fallos, format('B7: %s policies del provisioner aplican a PUBLIC', v_n));
  end if;

  if array_length(fallos, 1) > 0 then
    raise exception E'B · rol y privilegios:\n%', array_to_string(fallos, E'\n');
  end if;
end
$b$;

-- ============================ C · provisioning funcional ===================
do $c$
declare
  fallos text[] := '{}';
  v_u1 uuid := (select v from pp_actor where k = 'u1');
  v_u2 uuid := (select v from pp_actor where k = 'u2');
  v_r  jsonb;
  v_s1 uuid;
  v_n  int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1::text)::text, true);

  -- C1 · cuenta nueva: ambito y membresia, las DOS. Sin la segunda, la RLS no
  -- reconoce al dueno y no ve ni sus propios efectos (invariante 11).
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{"currency_code":"EUR"}'::jsonb);
  perform set_config('role', 'postgres', true);

  if (v_r ->> 'created') <> 'true' then
    fallos := array_append(fallos, 'C1: la primera invocacion no reporta created=true');
  end if;
  v_s1 := (v_r ->> 'scope_id')::uuid;

  if not exists (select 1 from core.scope where id = v_s1
                   and kind = 'personal' and owner_user_id = v_u1) then
    fallos := array_append(fallos, 'C1b: no se creo el ambito personal del actor');
  end if;
  if not exists (select 1 from core.membership where scope_id = v_s1 and user_id = v_u1) then
    fallos := array_append(fallos, 'C1c: no se creo la MEMBRESIA del dueno; sin ella no ve sus propios efectos');
  end if;
  if (v_r ->> 'currency_code') <> 'EUR' or (v_r ->> 'currency_scale') <> '2' then
    fallos := array_append(fallos, 'C1d: la moneda resuelta no es EUR/2');
  end if;

  -- C2 · idempotencia por estado: segunda invocacion, mismo ambito, sin crear.
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{"currency_code":"EUR"}'::jsonb);
  perform set_config('role', 'postgres', true);
  if (v_r ->> 'created') <> 'false' or (v_r ->> 'scope_id')::uuid <> v_s1 then
    fallos := array_append(fallos, 'C2: la segunda invocacion no es idempotente');
  end if;
  select count(*) into v_n from core.scope where owner_user_id = v_u1;
  if v_n <> 1 then
    fallos := array_append(fallos, format('C2b: el actor tiene %s ambitos personales', v_n));
  end if;

  -- C3 · y con OTRA moneda tampoco toca la base. Es lo que permite invocarla en
  -- cada arranque sin deshacer una eleccion del usuario.
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{"currency_code":"JPY"}'::jsonb);
  perform set_config('role', 'postgres', true);
  if (v_r ->> 'currency_code') <> 'EUR' then
    fallos := array_append(fallos, 'C3: una invocacion posterior CAMBIO la moneda base');
  end if;

  -- C4 · campo desconocido en el payload: se invalida, no se ignora.
  begin
    perform set_config('role', 'authenticated', true);
    v_r := api.ensure_personal_scope('{"scope_id":"x"}'::jsonb);
    perform set_config('role', 'postgres', true);
    fallos := array_append(fallos, 'C4: se acepto un campo desconocido en el payload');
  exception when others then
    perform set_config('role', 'postgres', true);
  end;

  -- C5 · sin identidad en la peticion, falla cerrado.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform set_config('role', 'authenticated', true);
    v_r := api.ensure_personal_scope('{}'::jsonb);
    perform set_config('role', 'postgres', true);
    fallos := array_append(fallos, 'C5: se creo un ambito SIN identidad en la peticion');
  exception when others then
    perform set_config('role', 'postgres', true);
  end;

  -- C6 · aislamiento: u2 no ve el ambito de u1 por la vista del cliente.
  perform set_config('request.jwt.claims', json_build_object('sub', v_u2::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.personal_scope;
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    fallos := array_append(fallos, format('C6: u2 ve %s ambitos ajenos en api.personal_scope', v_n));
  end if;

  if array_length(fallos, 1) > 0 then
    raise exception E'C · provisioning:\n%', array_to_string(fallos, E'\n');
  end if;
end
$c$;

-- ================================ D · la moneda ============================
do $d$
declare
  fallos text[] := '{}';
  v_u2 uuid := (select v from pp_actor where k = 'u2');
  v_u1 uuid := (select v from pp_actor where k = 'u1');
  v_r  jsonb;
  v_s2 uuid;
  v_s1 uuid := (select id from core.scope where owner_user_id = (select v from pp_actor where k='u1'));
  v_jpy uuid := (select id from core.currency_definition where code = 'JPY');
  v_usd uuid := (select id from core.currency_definition where code = 'USD');
  v_eur uuid := (select id from core.currency_definition where code = 'EUR');
  v_op uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();
  v_v2 uuid := gen_random_uuid();
  v_code text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_u2::text)::text, true);

  -- D1 · codigo soportado -> esa definicion, no otra.
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{"currency_code":"JPY"}'::jsonb);
  perform set_config('role', 'postgres', true);
  v_s2 := (v_r ->> 'scope_id')::uuid;
  if (v_r ->> 'currency_code') <> 'JPY' or (v_r ->> 'currency_scale') <> '0' then
    fallos := array_append(fallos, 'D1: no se resolvio JPY/0, que es la moneda de escala 0 del catalogo');
  end if;

  -- D2 · el cambio con el ambito VACIO.
  perform set_config('role', 'authenticated', true);
  v_r := api.set_personal_base_currency(jsonb_build_object('currency_definition_id', v_usd));
  perform set_config('role', 'postgres', true);
  if (v_r ->> 'changed') <> 'true' or (v_r ->> 'currency_code') <> 'USD' then
    fallos := array_append(fallos, 'D2: no se pudo cambiar la moneda de un ambito vacio');
  end if;

  -- D3 · la MISMA moneda: exito sin escritura.
  perform set_config('role', 'authenticated', true);
  v_r := api.set_personal_base_currency(jsonb_build_object('currency_definition_id', v_usd));
  perform set_config('role', 'postgres', true);
  if (v_r ->> 'changed') <> 'false' then
    fallos := array_append(fallos, 'D3: fijar la misma moneda no es un no-op');
  end if;

  -- D4 · definicion inexistente.
  begin
    perform set_config('role', 'authenticated', true);
    v_r := api.set_personal_base_currency(
             jsonb_build_object('currency_definition_id', '00000000-0000-4000-8000-000000000000'::uuid));
    perform set_config('role', 'postgres', true);
    fallos := array_append(fallos, 'D4: se acepto una definicion monetaria que no existe');
  exception when others then
    perform set_config('role', 'postgres', true);
    if position('CURRENCY_NOT_SUPPORTED' in sqlerrm) = 0 then
      fallos := array_append(fallos, format('D4b: codigo de error inesperado: %s', sqlerrm));
    end if;
  end;

  -- D5 · un efecto de una version SUPERADA —la forma que tendra una anulacion—
  -- tambien bloquea. Es la razon de mirar `core.effect` y NO
  -- `core.current_effect`: la proyeccion vigente estaria vacia y los efectos
  -- historicos seguirian en la moneda vieja.
  insert into core.operation (id, operation_class, created_by, current_version_id)
  values (v_op, 'personal_expense', v_u2, v_v2);
  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, original_amount, original_currency_definition_id, economic_rules_version)
  values (v_v1, v_op, 1, null, v_u2, date '2026-08-28', 2000, v_usd, 'v1'),
         (v_v2, v_op, 2, v_v1,  v_u2, date '2026-08-28', 2000, v_usd, 'v1');
  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_v1, v_s2, 'expense', v_usd, -2000);

  if exists (select 1 from core.current_effect where scope_id = v_s2) then
    fallos := array_append(fallos, 'D5a: la proyeccion vigente no esta vacia; el escenario no prueba lo que dice probar');
  end if;

  begin
    perform set_config('role', 'authenticated', true);
    v_r := api.set_personal_base_currency(jsonb_build_object('currency_definition_id', v_eur));
    perform set_config('role', 'postgres', true);
    fallos := array_append(fallos, 'D5: se cambio la moneda de un ambito con efectos historicos');
  exception when others then
    perform set_config('role', 'postgres', true);
    if position('BASE_CURRENCY_LOCKED' in sqlerrm) = 0 then
      fallos := array_append(fallos, format('D5b: se rechazo, pero no con BASE_CURRENCY_LOCKED: %s', sqlerrm));
    end if;
  end;

  -- D6 · y la moneda sigue siendo la de antes.
  select c.code into v_code from core.scope s
    join core.currency_definition c on c.id = s.base_currency_definition_id
   where s.id = v_s2;
  if v_code <> 'USD' then
    fallos := array_append(fallos, format('D6: la moneda base quedo en %s tras el rechazo', v_code));
  end if;

  -- D7 · sin Modo Personal, la funcion no es un oraculo de existencia.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid()::text)::text, true);
  begin
    perform set_config('role', 'authenticated', true);
    v_r := api.set_personal_base_currency(jsonb_build_object('currency_definition_id', v_eur));
    perform set_config('role', 'postgres', true);
    fallos := array_append(fallos, 'D7: se acepto un cambio de moneda sin ambito');
  exception when others then
    perform set_config('role', 'postgres', true);
    if position('NOT_AUTHORIZED' in sqlerrm) = 0 then
      fallos := array_append(fallos, format('D7b: codigo inesperado sin ambito: %s', sqlerrm));
    end if;
  end;

  -- D8 · codigo NO soportado -> fallback EUR, y sin inventar una definicion.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{"currency_code":"XYZ"}'::jsonb);
  perform set_config('role', 'postgres', true);
  if (v_r ->> 'currency_code') <> 'EUR' then
    fallos := array_append(fallos, format('D8: el fallback de una moneda no soportada dio %s', v_r ->> 'currency_code'));
  end if;

  -- D9 · sin codigo -> el mismo fallback.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{}'::jsonb);
  perform set_config('role', 'postgres', true);
  if (v_r ->> 'currency_code') <> 'EUR' then
    fallos := array_append(fallos, 'D9: sin codigo, el fallback no dio EUR');
  end if;

  if array_length(fallos, 1) > 0 then
    raise exception E'D · moneda:\n%', array_to_string(fallos, E'\n');
  end if;
end
$d$;

-- ====================== E · regresiones deliberadas ========================
-- Las dos comprueban que las policies del provisioner no son decorativas.
-- Cada bloque deshace su propio dano con un savepoint.
do $e$
declare
  fallos text[] := '{}';
  v_u3 uuid := gen_random_uuid();
  v_r  jsonb;
  v_s3 uuid;
  v_eur uuid := (select id from core.currency_definition where code = 'EUR');
  v_jpy uuid := (select id from core.currency_definition where code = 'JPY');
  v_op uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_u3::text)::text, true);
  perform set_config('role', 'authenticated', true);
  v_r := api.ensure_personal_scope('{"currency_code":"EUR"}'::jsonb);
  perform set_config('role', 'postgres', true);
  v_s3 := (v_r ->> 'scope_id')::uuid;

  insert into core.operation (id, operation_class, created_by, current_version_id)
  values (v_op, 'personal_expense', v_u3, v_v1);
  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, original_amount, original_currency_definition_id, economic_rules_version)
  values (v_v1, v_op, 1, null, v_u3, date '2026-08-28', 500, v_eur, 'v1');
  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_v1, v_s3, 'expense', v_eur, -500);

  -- E1 · SIN la policy de SELECT del provisioner sobre core.effect, la
  -- comprobacion de vacio ve CERO FILAS SIN ERROR y deja pasar el cambio. Lo
  -- que debe seguir deteniendolo es la FK compuesta, con 23503 en vez del 409.
  -- El fallo cambia de FORMA, nunca de RESULTADO. Si esto empezara a devolver
  -- BASE_CURRENCY_LOCKED, la comprobacion habria dejado de depender de la
  -- policy y la regresion ya no probaria nada.
  begin
    drop policy effect_provisioner_select on core.effect;
    begin
      perform set_config('role', 'authenticated', true);
      v_r := api.set_personal_base_currency(jsonb_build_object('currency_definition_id', v_jpy));
      perform set_config('role', 'postgres', true);
      fallos := array_append(fallos,
        'E1: sin la policy de effect, el cambio de moneda PASO. La FK no lo detuvo');
    exception when others then
      perform set_config('role', 'postgres', true);
      if position('effect_moneda_del_ambito' in sqlerrm) = 0 then
        fallos := array_append(fallos,
          format('E1b: se rechazo, pero no por la FK compuesta. Era: %s', left(sqlerrm, 120)));
      end if;
    end;
    create policy effect_provisioner_select on core.effect
      for select to nomey_provisioner
      using (exists (select 1 from core.scope s
                      where s.id = effect.scope_id and s.kind = 'personal'
                        and s.owner_user_id = sec.request_actor_id()));
  end;

  -- E2 · SIN la policy de SELECT sobre core.scope, la subconsulta del WITH
  -- CHECK de la membresia no ve la fila y el provisioning LEGITIMO se rechaza.
  -- Falla cerrado, que es la direccion segura, pero demuestra que las dos
  -- policies se disenan juntas.
  begin
    drop policy scope_provisioner_select on core.scope;
    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', gen_random_uuid()::text)::text, true);
      perform set_config('role', 'authenticated', true);
      v_r := api.ensure_personal_scope('{"currency_code":"EUR"}'::jsonb);
      perform set_config('role', 'postgres', true);
      fallos := array_append(fallos,
        'E2: sin la policy de select sobre scope, el provisioning siguio funcionando');
    exception when others then
      perform set_config('role', 'postgres', true);
    end;
    create policy scope_provisioner_select on core.scope
      for select to nomey_provisioner
      using (kind = 'personal' and owner_user_id = sec.request_actor_id());
  end;

  if array_length(fallos, 1) > 0 then
    raise exception E'E · regresiones deliberadas:\n%', array_to_string(fallos, E'\n');
  end if;
end
$e$;

\echo 'personal-provisioning: OK'

rollback;
