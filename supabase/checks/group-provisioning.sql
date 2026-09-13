-- Comprobaciones del provisioning de Grupo, contra la base REAL construida por
-- las migraciones.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/group-provisioning.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK, asi que **no
-- deja ni una fila**: el censo previo de la base no se toca.
--
-- La identidad y el rol se simulan con `set_config`, igual que en el resto de
-- los checks: es lo unico que `sec.request_actor_id()` mira, y se deshace con el
-- ROLLBACK sin necesitar ningun grant.
--
-- Lo que este fichero NO comprueba porque no puede: dos llamadas SIMULTANEAS
-- con la misma clave. Una sola sesion de `psql` no tiene concurrencia real, y
-- eso vive en `scripts/group-concurrency.sh`, igual que las carreras de deuda.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ================== A · estructura, privilegios y aislamiento ==============
do $a$
declare
  fallos text[] := '{}';
  v_n int;
  v_t text;
begin
  -- A1 · las dos relaciones existen con RLS activada.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relname in ('group_profile','provisioning_command')
     and c.relrowsecurity;
  if v_n <> 2 then fallos := array_append(fallos, 'A1 falta RLS en group_profile o provisioning_command'); end if;

  -- A2 · `core.scope` NO gano ni nombre ni emoji. La separacion es el ADR.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'core' and table_name = 'scope'
     and column_name in ('display_name','emoji','name');
  if v_n <> 0 then fallos := array_append(fallos, 'A2 core.scope gano un atributo de presentacion'); end if;

  -- A3 · NINGUNA columna de rol en ninguna relacion de grupo. Es el invariante
  -- del ADR: no hay owner, no hay admin, y no aparecen por descuido.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'core'
     and table_name in ('group_profile','membership','participant','participant_user_link')
     and column_name in ('role','rol','is_admin','is_owner','admin','owner');
  if v_n <> 0 then fallos := array_append(fallos, 'A3 aparecio una columna de rol'); end if;

  -- A4 · un perfil solo puede colgar de un ambito de tipo grupo, y es
  -- ESTRUCTURAL: CHECK sobre la columna redundante mas FK compuesta.
  select count(*) into v_n from pg_constraint
   where conrelid = 'core.group_profile'::regclass
     and conname in ('group_profile_solo_grupo','group_profile_ambito_de_grupo');
  if v_n <> 2 then fallos := array_append(fallos, 'A4 el perfil puede colgar de un ambito que no es grupo'); end if;

  -- A5 · el cliente NO puede escribir ninguna de las dos tablas nuevas.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name in ('group_profile','provisioning_command')
     and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE');
  if v_n <> 0 then fallos := array_append(fallos, 'A5 authenticated puede escribir una tabla de provisioning'); end if;

  -- A6 · y `provisioning_command` no es legible por el cliente en absoluto: dice
  -- que claves ha usado alguien, y eso no es asunto suyo.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'provisioning_command' and grantee = 'authenticated';
  if v_n <> 0 then fallos := array_append(fallos, 'A6 authenticated alcanza provisioning_command'); end if;

  -- A7 · la frontera fija su `search_path`, es definer y la posee el provisioner.
  select p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || pg_get_userbyid(p.proowner)
    into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'create_group';
  if v_t is distinct from 'true|search_path=""|nomey_provisioner' then
    fallos := array_append(fallos, ('A7 create_group mal configurada: ' || coalesce(v_t, 'ausente')));
  end if;

  -- A8 · no la ejecuta cualquiera, y si la ejecuta quien ha iniciado sesion.
  if has_function_privilege('anon', 'api.create_group(jsonb)', 'EXECUTE') then
    fallos := array_append(fallos, 'A8 anon puede crear grupos');
  end if;
  if not has_function_privilege('authenticated', 'api.create_group(jsonb)', 'EXECUTE') then
    fallos := array_append(fallos, 'A8 authenticated no puede crear grupos');
  end if;

  -- A9 · el provisioner sigue sin poder escribir NADA contable.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and grantee = 'nomey_provisioner'
     and table_name in ('operation','operation_version','effect','client_command','split','split_participant')
     and privilege_type in ('INSERT','UPDATE','DELETE');
  if v_n <> 0 then fallos := array_append(fallos, 'A9 el provisioner gano escritura contable'); end if;

  -- A10 · el vinculo participante-cuenta sigue sin publicarse al cliente.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'participant_user_link' and grantee = 'authenticated';
  if v_n <> 0 then fallos := array_append(fallos, 'A10 el vinculo participante-cuenta es alcanzable'); end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'api' and table_name = 'group_participant' and column_name like '%user%';
  if v_n <> 0 then fallos := array_append(fallos, 'A10 la vista de participantes publica la cuenta'); end if;

  if array_length(fallos, 1) is not null then
    raise exception 'A · estructura: %', array_to_string(fallos, ' | ');
  end if;
  raise notice 'A · estructura, privilegios y aislamiento: OK';
end
$a$;

-- ===================== B · creacion, idempotencia y contrato ===============
do $b$
declare
  fallos text[] := '{}';
  v_creador uuid := 'b1111111-1111-4111-8111-111111111111';
  v_ajeno   uuid := 'b3333333-3333-4333-8333-333333333333';
  v_eur     uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_g1      uuid := 'd1111111-1111-4111-8111-111111111111';
  v_g2      uuid := 'd2222222-2222-4222-8222-222222222222';
  v_c1      uuid := 'c1111111-1111-4111-8111-111111111111';
  v_c2      uuid := 'c2222222-2222-4222-8222-222222222222';
  v_pcre1   uuid := 'f1111111-1111-4111-8111-111111111111';
  v_pana1   uuid := 'f2222222-2222-4222-8222-222222222222';
  v_pcre2   uuid := 'f3333333-3333-4333-8333-333333333333';
  v_base    jsonb;
  v_out     jsonb;
  v_n       int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_creador::text)::text, true);

  v_base := jsonb_build_object(
    'client_command_id', v_c1, 'command_contract_version', 1,
    'client_group_id', v_g1, 'display_name', '  Viaje  a   Lisboa ', 'emoji', 'GRP',
    'currency_definition_id', v_eur,
    'creator_participant_id', v_pcre1, 'creator_display_name', ' Edu ',
    'participants', jsonb_build_array(jsonb_build_object(
      'client_participant_id', v_pana1, 'display_name', ' Ana ')));

  -- B1 · creacion completa, con el nombre canonicalizado por el SERVIDOR.
  --
  -- `sec.canonical_display_name` normaliza a NFC, colapsa los espacios de
  -- dentro, recorta y rechaza el vacio. **El servidor no confia en que el
  -- cliente lo haya hecho**: lo que se almacena sale de ahi.
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group(v_base);
  perform set_config('role', 'postgres', true);

  if (v_out ->> 'replay')::boolean then fallos := array_append(fallos, 'B1 la primera llamada dice replay'); end if;
  if (v_out ->> 'display_name') <> 'Viaje a Lisboa' then
    fallos := array_append(fallos, ('B1 nombre sin normalizar: ' || (v_out ->> 'display_name')));
  end if;
  if (v_out ->> 'participant_count')::int <> 2 then
    fallos := array_append(fallos, ('B1 cuenta mal: ' || (v_out ->> 'participant_count')));
  end if;

  -- B2 · las seis filas de la creacion existen, y ni una de mas.
  select count(*) into v_n from core.scope s
   where s.id = v_g1 and s.kind = 'group' and s.owner_user_id is null;
  if v_n <> 1 then fallos := array_append(fallos, 'B2 el ambito no es un grupo sin owner'); end if;
  select count(*) into v_n from core.group_profile g
   where g.scope_id = v_g1 and g.created_by = v_creador and g.emoji = 'GRP';
  if v_n <> 1 then fallos := array_append(fallos, 'B2 falta el perfil o su atribucion'); end if;
  select count(*) into v_n from core.membership m where m.scope_id = v_g1 and m.user_id = v_creador;
  if v_n <> 1 then fallos := array_append(fallos, 'B2 falta la membresia del creador'); end if;
  select count(*) into v_n from core.participant p where p.scope_id = v_g1;
  if v_n <> 2 then fallos := array_append(fallos, 'B2 el numero de participantes no es 2'); end if;
  select count(*) into v_n from core.participant_user_link l
   where l.scope_id = v_g1 and l.participant_id = v_pcre1 and l.user_id = v_creador;
  if v_n <> 1 then fallos := array_append(fallos, 'B2 el vinculo del creador no es exactamente uno'); end if;
  select count(*) into v_n from core.provisioning_command pc
   where pc.created_by = v_creador and pc.client_command_id = v_c1
     and pc.result_scope_id = v_g1 and pc.command_type = 'group.create';
  if v_n <> 1 then fallos := array_append(fallos, 'B2 falta el registro de idempotencia'); end if;

  -- B3 · las identidades del CLIENTE se conservan tal cual, y el nombre del
  -- participante tambien llega normalizado.
  select count(*) into v_n from core.participant p
   where p.scope_id = v_g1 and p.id in (v_pcre1, v_pana1);
  if v_n <> 2 then fallos := array_append(fallos, 'B3 se regeneraron identidades de participante'); end if;
  select count(*) into v_n from core.participant p
   where p.id = v_pana1 and p.display_name = 'Ana';
  if v_n <> 1 then fallos := array_append(fallos, 'B3 el nombre del participante no se normalizo'); end if;

  -- B4 · replay: misma clave, misma intencion, mismo grupo y sin duplicar nada.
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group(v_base);
  perform set_config('role', 'postgres', true);

  if not (v_out ->> 'replay')::boolean then fallos := array_append(fallos, 'B4 el replay no se declara'); end if;
  if (v_out ->> 'scope_id')::uuid <> v_g1 then fallos := array_append(fallos, 'B4 el replay devuelve otro grupo'); end if;
  select count(*) into v_n from core.participant p where p.scope_id = v_g1;
  if v_n <> 2 then fallos := array_append(fallos, 'B4 el replay duplico participantes'); end if;
  -- Se cuentan SOLO los de esta prueba. Contar todos los grupos de la base daba
  -- por supuesta una base desde cero: en CI lo es, y en una poblada la
  -- afirmacion resultaba falsa sin que nada estuviera mal.
  select count(*) into v_n from core.scope s where s.kind = 'group' and s.id in (v_g1, v_g2);
  if v_n <> 1 then fallos := array_append(fallos, 'B4 el replay creo un segundo ambito'); end if;
  select count(*) into v_n from core.membership m where m.scope_id = v_g1;
  if v_n <> 1 then fallos := array_append(fallos, 'B4 el replay duplico la membresia'); end if;

  -- B5 · misma clave, intencion DISTINTA: se rechaza, no se adopta.
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(jsonb_set(v_base, '{display_name}', '"Otro viaje"'));
    fallos := array_append(fallos, 'B5 una intencion distinta con la misma clave no fallo');
  exception when others then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, ('B5 codigo inesperado: ' || left(sqlerrm, 50)));
    end if;
  end;
  perform set_config('role', 'postgres', true);

  -- B6 · dos grupos LEGITIMOS con el mismo nombre y claves distintas.
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', v_c2, 'command_contract_version', 1,
    'client_group_id', v_g2, 'display_name', 'Viaje a Lisboa', 'emoji', 'GRP',
    'currency_definition_id', v_eur,
    'creator_participant_id', v_pcre2, 'creator_display_name', 'Edu',
    'participants', '[]'::jsonb));
  perform set_config('role', 'postgres', true);

  if (v_out ->> 'replay')::boolean then fallos := array_append(fallos, 'B6 un grupo gemelo se tomo por replay'); end if;
  select count(*) into v_n from core.scope s where s.kind = 'group' and s.id in (v_g1, v_g2);
  if v_n <> 2 then fallos := array_append(fallos, 'B6 no hay dos grupos'); end if;

  -- B7 · un identificador de ambito ya ocupado se rechaza, no se adopta.
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(jsonb_build_object(
      'client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'client_group_id', v_g1, 'display_name', 'Secuestro', 'emoji', 'X',
      'currency_definition_id', v_eur,
      'creator_participant_id', gen_random_uuid(), 'creator_display_name', 'Edu',
      'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'B7 se adopto un ambito ya existente');
  exception when others then
    if sqlerrm not like '%SCOPE_ID_TAKEN%' then
      fallos := array_append(fallos, ('B7 codigo inesperado: ' || left(sqlerrm, 50)));
    end if;
  end;
  perform set_config('role', 'postgres', true);

  -- B8 · la moneda tiene que estar en el catalogo REAL.
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(jsonb_build_object(
      'client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'client_group_id', gen_random_uuid(), 'display_name', 'X', 'emoji', 'X',
      'currency_definition_id', '00000000-0000-4000-8000-000000000000',
      'creator_participant_id', gen_random_uuid(), 'creator_display_name', 'Edu',
      'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'B8 acepto una moneda fuera del catalogo');
  exception when others then
    if sqlerrm not like '%CURRENCY_NOT_SUPPORTED%' then
      fallos := array_append(fallos, ('B8 codigo inesperado: ' || left(sqlerrm, 50)));
    end if;
  end;
  perform set_config('role', 'postgres', true);

  -- B9 · contrato del payload: un campo no declarado dentro de un participante.
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(jsonb_set(v_base, '{participants}',
      jsonb_build_array(jsonb_build_object('client_participant_id', gen_random_uuid(),
        'display_name', 'A', 'rol', 'admin'))));
    fallos := array_append(fallos, 'B9 acepto un campo no declarado en un participante');
  exception when others then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, ('B9 sobrante: ' || left(sqlerrm, 50)));
    end if;
  end;
  perform set_config('role', 'postgres', true);

  -- B10 · un nombre en blanco no nombra nada.
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(jsonb_build_object(
      'client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'client_group_id', gen_random_uuid(), 'display_name', '   ', 'emoji', 'X',
      'currency_definition_id', v_eur,
      'creator_participant_id', gen_random_uuid(), 'creator_display_name', 'Edu',
      'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'B10 acepto un nombre en blanco');
  exception when others then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, ('B10 blanco: ' || left(sqlerrm, 50)));
    end if;
  end;
  perform set_config('role', 'postgres', true);

  -- B11 · el actor sale de la SESION: un `created_by` del cliente ni se admite.
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(v_base || jsonb_build_object('created_by', v_ajeno));
    fallos := array_append(fallos, 'B11 acepto un created_by del cliente');
  exception when others then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, ('B11 codigo inesperado: ' || left(sqlerrm, 50)));
    end if;
  end;
  perform set_config('role', 'postgres', true);

  if array_length(fallos, 1) is not null then
    raise exception 'B · creacion e idempotencia: %', array_to_string(fallos, ' | ');
  end if;
  raise notice 'B · creacion, idempotencia y contrato: OK';
end
$b$;

-- ======================= C · permisos, lectura y aislamiento ===============
--
-- El segundo miembro se prepara con un fixture privilegiado: el flujo de union
-- todavia no existe, y esta seccion comprueba el MODELO de permisos, no como se
-- llega a el.
do $c$
declare
  fallos text[] := '{}';
  v_creador uuid := 'b1111111-1111-4111-8111-111111111111';
  v_miembro uuid := 'b2222222-2222-4222-8222-222222222222';
  v_ajeno   uuid := 'b3333333-3333-4333-8333-333333333333';
  v_g1      uuid := 'd1111111-1111-4111-8111-111111111111';
  v_ana     uuid := 'f2222222-2222-4222-8222-222222222222';
  v_n int;
begin
  -- El segundo miembro reclama el participante «Ana»: vinculo mas membresia,
  -- que es exactamente lo que hara F10. Se siembra como `postgres`.
  insert into core.participant_user_link (participant_id, scope_id, user_id)
  values (v_ana, v_g1, v_miembro);
  insert into core.membership (scope_id, user_id) values (v_g1, v_miembro);

  -- C1 · el creador lee su grupo por la superficie publica.
  perform set_config('request.jwt.claims', json_build_object('sub', v_creador::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_profile;
  perform set_config('role', 'postgres', true);
  if v_n <> 2 then fallos := array_append(fallos, ('C1 el creador no ve sus dos grupos: ' || v_n)); end if;

  -- C2 · el segundo miembro lee el grupo IGUAL: la misma fila y los mismos
  -- participantes. No hay ninguna columna que lo declare de segunda.
  perform set_config('request.jwt.claims', json_build_object('sub', v_miembro::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_profile;
  perform set_config('role', 'postgres', true);
  if v_n <> 1 then fallos := array_append(fallos, 'C2 el segundo miembro no lee el grupo'); end if;

  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_participant;
  perform set_config('role', 'postgres', true);
  if v_n <> 2 then fallos := array_append(fallos, 'C2 el segundo miembro no ve a los participantes'); end if;

  -- C3 · el ajeno no ve NADA.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ajeno::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_profile;
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then fallos := array_append(fallos, 'C3 un ajeno lee grupos que no son suyos'); end if;

  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_participant;
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then fallos := array_append(fallos, 'C3 un ajeno lee participantes ajenos'); end if;

  -- C4 · y tampoco escribe el perfil por la puerta de atras.
  begin
    perform set_config('role', 'authenticated', true);
    update core.group_profile set display_name = 'secuestrado' where scope_id = v_g1;
    get diagnostics v_n = row_count;
    if v_n <> 0 then fallos := array_append(fallos, 'C4 un ajeno modifico el perfil'); end if;
  exception when insufficient_privilege then
    null;  -- lo esperado: ni privilegio tiene
  end;
  perform set_config('role', 'postgres', true);

  -- C5 · un participante SIN cuenta no puede actuar: no hay ninguna fila que le
  -- de acceso, y el recuento de membresias frente al de participantes lo dice.
  select count(*) into v_n from core.membership m where m.scope_id = v_g1;
  if v_n <> 2 then fallos := array_append(fallos, 'C5 hay mas membresias que cuentas vinculadas'); end if;
  select count(*) into v_n from core.participant p where p.scope_id = v_g1;
  if v_n <> 2 then fallos := array_append(fallos, 'C5 cambio el numero de participantes'); end if;

  if array_length(fallos, 1) is not null then
    raise exception 'C · permisos y aislamiento: %', array_to_string(fallos, ' | ');
  end if;
  raise notice 'C · permisos, lectura y aislamiento: OK';
end
$c$;

-- ============================ D · atomicidad ===============================
-- Un fallo a mitad no puede dejar medio grupo. Se provoca con un participante
-- que repite la identidad del creador, que revienta el contrato despues de que
-- la funcion ya haya leido y compuesto todo.
do $d$
declare
  fallos text[] := '{}';
  v_creador uuid := 'b1111111-1111-4111-8111-111111111111';
  v_eur     uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_roto    uuid := 'd9999999-9999-4999-8999-999999999999';
  v_dup     uuid := 'f9999999-9999-4999-8999-999999999999';
  v_cmd     uuid := 'c9999999-9999-4999-8999-999999999999';
  v_n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_creador::text)::text, true);
  begin
    perform set_config('role', 'authenticated', true);
    perform api.create_group(jsonb_build_object(
      'client_command_id', v_cmd, 'command_contract_version', 1,
      'client_group_id', v_roto, 'display_name', 'A medias', 'emoji', 'X',
      'currency_definition_id', v_eur,
      'creator_participant_id', v_dup, 'creator_display_name', 'Edu',
      'participants', jsonb_build_array(jsonb_build_object(
        'client_participant_id', v_dup, 'display_name', 'Choca'))));
    fallos := array_append(fallos, 'D acepto un participante con la identidad del creador');
  exception when others then
    null;  -- lo esperado
  end;
  perform set_config('role', 'postgres', true);

  -- Ni una fila de ese grupo en NINGUNA relacion, la clave incluida.
  select count(*) into v_n from core.scope where id = v_roto;
  if v_n <> 0 then fallos := array_append(fallos, 'D quedo el ambito'); end if;
  select count(*) into v_n from core.group_profile where scope_id = v_roto;
  if v_n <> 0 then fallos := array_append(fallos, 'D quedo el perfil'); end if;
  select count(*) into v_n from core.membership where scope_id = v_roto;
  if v_n <> 0 then fallos := array_append(fallos, 'D quedo la membresia'); end if;
  select count(*) into v_n from core.participant where scope_id = v_roto;
  if v_n <> 0 then fallos := array_append(fallos, 'D quedaron participantes'); end if;
  select count(*) into v_n from core.provisioning_command where client_command_id = v_cmd;
  if v_n <> 0 then fallos := array_append(fallos, 'D quedo la clave reclamada'); end if;

  if array_length(fallos, 1) is not null then
    raise exception 'D · atomicidad: %', array_to_string(fallos, ' | ');
  end if;
  raise notice 'D · atomicidad: OK';
end
$d$;


-- ============ E · la autorizacion de la PRIMERA membresia ==================
--
-- La primera membresia se autoriza con el RECLAMO de `core.provisioning_command`
-- y no con el estado del ambito. Aqui se demuestra que el reclamo tiene que ser
-- exactamente el de esta creacion: de otro actor, de otro ambito o de otro tipo
-- de comando no autoriza nada.
--
-- Se ataca por donde de verdad importa: intentando la insercion COMO EL
-- PROVISIONER, que es el unico rol que tiene el privilegio. Si la policy no
-- sujetara, esto pasaria.
do $e$
declare
  fallos text[] := '{}';
  v_actor  uuid := 'b1111111-1111-4111-8111-111111111111';
  v_otro   uuid := 'b3333333-3333-4333-8333-333333333333';
  v_scope  uuid := 'd1111111-1111-4111-8111-111111111111';
  v_otroam uuid := 'd2222222-2222-4222-8222-222222222222';
  v_libre  uuid;
  v_n int;
begin
  -- Un ambito de grupo NUEVO y sin membresia, para intentar colarse en el.
  v_libre := gen_random_uuid();
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  values (v_libre, 'group', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe', null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_actor::text)::text, true);

  -- E1 · sin ningun reclamo que apunte a ese ambito: rechazada.
  begin
    perform set_config('role', 'nomey_provisioner', true);
    insert into core.membership (scope_id, user_id) values (v_libre, v_actor);
    fallos := array_append(fallos, 'E1 se creo una membresia sin reclamo');
  exception when others then null;  -- lo esperado
  end;
  perform set_config('role', 'postgres', true);

  -- E2 · con un reclamo de OTRO ACTOR sobre ese mismo ambito: rechazada.
  insert into core.provisioning_command (created_by, client_command_id, command_type,
         command_contract_version, canonical_intent, result_scope_id)
  values (v_otro, gen_random_uuid(), 'group.create', 1, '{}'::jsonb, v_libre);
  begin
    perform set_config('role', 'nomey_provisioner', true);
    insert into core.membership (scope_id, user_id) values (v_libre, v_actor);
    fallos := array_append(fallos, 'E2 el reclamo de otro actor autorizo la membresia');
  exception when others then null;
  end;
  perform set_config('role', 'postgres', true);

  -- E3 · con un reclamo DEL ACTOR pero sobre OTRO AMBITO: rechazada.
  insert into core.provisioning_command (created_by, client_command_id, command_type,
         command_contract_version, canonical_intent, result_scope_id)
  values (v_actor, gen_random_uuid(), 'group.create', 1, '{}'::jsonb, v_otroam);
  begin
    perform set_config('role', 'nomey_provisioner', true);
    insert into core.membership (scope_id, user_id) values (v_libre, v_actor);
    fallos := array_append(fallos, 'E3 un reclamo de otro ambito autorizo la membresia');
  exception when others then null;
  end;
  perform set_config('role', 'postgres', true);

  -- E4 · con un reclamo del actor y del ambito pero de OTRO TIPO: rechazada.
  insert into core.provisioning_command (created_by, client_command_id, command_type,
         command_contract_version, canonical_intent, result_scope_id)
  values (v_actor, gen_random_uuid(), 'otro.comando', 1, '{}'::jsonb, v_libre);
  begin
    perform set_config('role', 'nomey_provisioner', true);
    insert into core.membership (scope_id, user_id) values (v_libre, v_actor);
    fallos := array_append(fallos, 'E4 un reclamo de otro tipo autorizo la membresia');
  exception when others then null;
  end;
  perform set_config('role', 'postgres', true);

  -- E5 · y con el reclamo correcto: SI. Es el control positivo, sin el cual las
  -- cuatro negativas podrian estar pasando por cualquier otro motivo.
  insert into core.provisioning_command (created_by, client_command_id, command_type,
         command_contract_version, canonical_intent, result_scope_id)
  values (v_actor, gen_random_uuid(), 'group.create', 1, '{}'::jsonb, v_libre);
  begin
    perform set_config('role', 'nomey_provisioner', true);
    insert into core.membership (scope_id, user_id) values (v_libre, v_actor);
  exception when others then
    fallos := array_append(fallos, ('E5 el reclamo correcto NO autorizo: ' || left(sqlerrm, 40)));
  end;
  perform set_config('role', 'postgres', true);

  select count(*) into v_n from core.membership m where m.scope_id = v_libre;
  if v_n <> 1 then fallos := array_append(fallos, ('E5 membresias en el ambito libre: ' || v_n)); end if;

  -- E6 · la nueva policy NO deja al provisioner ver un grupo ajeno por el mero
  -- hecho de estar vacio, que es lo que hacia la version anterior.
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro::text)::text, true);
  perform set_config('role', 'nomey_provisioner', true);
  select count(*) into v_n from core.scope s where s.id = v_libre;
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then fallos := array_append(fallos, 'E6 el provisioner ve un grupo del que no es miembro'); end if;

  if array_length(fallos, 1) is not null then
    raise exception 'E · autorizacion de la primera membresia: %', array_to_string(fallos, ' | ');
  end if;
  raise notice 'E · autorizacion de la primera membresia: OK';
end
$e$;


-- ============ F · paridad del nombre canonico con el cliente ===============
--
-- Los MISMOS vectores que `tests/lib/display-name-vectors.test.ts` pasa por
-- `normaliseName`, aqui contra `sec.canonical_display_name`. Ninguna de las dos
-- implementaciones importa a la otra: es el mecanismo de ADR-002 §7 y ADR-009
-- §1 —paridad por vectores, no por codigo compartido— aplicado a los nombres.
--
-- Necesita el prelude, porque `psql` corre dentro del contenedor y no ve el
-- checkout:
--   Encadenado antes del check con scripts/vectors-prelude.sh, tal y como
--     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
-- Sin el prelude la seccion se SALTA con un aviso, para que el fichero siga
-- siendo ejecutable suelto: lo que no puede es fallar en silencio.
do $f$
declare
  fallos text[] := '{}';
  v_doc  jsonb;
  v_caso jsonb;
  v_got  text;
  v_n    int := 0;
begin
  if to_regclass('pg_temp.vector_doc') is null then
    raise notice 'F · paridad del nombre canonico: SALTADA (sin prelude de vectores)';
    return;
  end if;

  execute 'select doc from vector_doc where name = ''display-names''' into v_doc;
  if v_doc is null then
    raise exception 'F · falta el documento display-names en los vectores';
  end if;

  for v_caso in select value from jsonb_array_elements(v_doc -> 'cases') loop
    v_n := v_n + 1;
    begin
      v_got := sec.canonical_display_name(v_caso ->> 'in');
      if v_caso -> 'out' = 'null'::jsonb then
        fallos := array_append(fallos, ((v_caso ->> 'id') || ': deberia rechazarse y devolvio ' || quote_literal(v_got)));
      elsif v_got <> (v_caso ->> 'out') then
        fallos := array_append(fallos, ((v_caso ->> 'id') || ': ' || quote_literal(v_got) || ' <> ' || quote_literal(v_caso ->> 'out')));
      end if;
    exception when others then
      if v_caso -> 'out' <> 'null'::jsonb then
        fallos := array_append(fallos, ((v_caso ->> 'id') || ': fallo y no debia — ' || left(sqlerrm, 40)));
      end if;
    end;
  end loop;

  if v_n < 30 then
    fallos := array_append(fallos, ('F trae solo ' || v_n || ' vectores: no es cobertura'));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception 'F · paridad del nombre canonico: %', array_to_string(fallos, ' | ');
  end if;
  raise notice 'F · paridad del nombre canonico (% vectores): OK', v_n;
end
$f$;


-- ============ U · EDITAR EL PERFIL: permisos, idempotencia, CAS y altas =====
--
-- La escritura que ADR-032 reservo para «su propio paso de F9», con lo que
-- prometio: actor, antes y despues, fecha, historial y aviso. Fixtures propias,
-- en la misma transaccion que termina en ROLLBACK.
--
-- U1 edicion valida · U2 replay sin duplicar, historial y aviso una vez, el
-- gasto anterior con sus dos cuotas, presencia del nuevo desde hoy · U3 misma
-- clave con otra intencion · U4 lectura caducada: PROFILE_CONFLICT, nada
-- escrito y clave sin reclamar · U5 no miembro · U6 la moneda no es del contrato.
do $u$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'ca000000-0000-4000-8000-000000000001';
  v_ub   uuid := 'ca000000-0000-4000-8000-000000000002';
  v_g    uuid := 'cb000000-0000-4000-8000-000000000010';
  v_pa   uuid := 'cb000000-0000-4000-8000-0000000000f1';
  v_p1   uuid := 'cd000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'cd000000-0000-4000-8000-000000000032';
  v_p3   uuid := 'cd000000-0000-4000-8000-000000000033';
  v_cat  uuid;
  v_out  jsonb;
  v_read timestamptz;
  v_n    bigint;
  v_t    text;
  v_op   uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cat from core.category where message_key = 'category.expense.dining' and owner_user_id is null;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values (v_pa, 'personal', v_eur, v_ua);
  insert into core.membership (scope_id, user_id) values (v_pa, v_ua);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'cc000000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', v_g, 'display_name', 'Piso', 'emoji', 'GRP', 'currency_definition_id', v_eur,
    'creator_participant_id', v_p1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', v_p2, 'display_name', 'Ana'))));

  -- un gasto ANTERIOR entre los dos, para comprobar que el alta no lo toca
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'ce000000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '2000',
    'effective_date', current_date::text, 'concept', 'Cena', 'category_id', v_cat,
    'payer_participant_id', v_p1, 'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;

  select updated_at into v_read from api.group_profile where scope_id = v_g;
  -- api.group_profile no publica updated_at? entonces leemos de core como postgres
  if v_read is null then
    perform set_config('role', 'postgres', true);
    select updated_at into v_read from core.group_profile where scope_id = v_g;
    perform set_config('role', 'authenticated', true);
  end if;

  -- U1 · edicion valida: nombre, emoji y un participante nuevo
  v_out := api.update_group_profile(jsonb_build_object(
    'client_command_id', 'cc000000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'display_name', '  Piso   Centro ', 'emoji', 'HOME',
    'expected_updated_at', v_read::text,
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', v_p3, 'display_name', 'Luis'))));
  if (v_out ->> 'display_name') is distinct from 'Piso Centro' then fallos := array_append(fallos, 'U1 nombre: ' || coalesce(v_out ->> 'display_name','nulo')); end if;
  if (v_out ->> 'emoji') is distinct from 'HOME' then fallos := array_append(fallos, 'U1b emoji'); end if;
  if (v_out ->> 'participant_count')::int <> 3 then fallos := array_append(fallos, 'U1c participant_count ' || (v_out ->> 'participant_count')); end if;
  if (v_out ->> 'replay')::boolean then fallos := array_append(fallos, 'U1d replay en la primera'); end if;
  if (v_out ->> 'scope_id')::uuid <> v_g then fallos := array_append(fallos, 'U1e cambio la identidad'); end if;

  -- U2 · replay: misma clave, misma intencion -> mismo sobre, replay=true, sin duplicar
  v_out := api.update_group_profile(jsonb_build_object(
    'client_command_id', 'cc000000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'display_name', '  Piso   Centro ', 'emoji', 'HOME',
    'expected_updated_at', v_read::text,
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', v_p3, 'display_name', 'Luis'))));
  if not (v_out ->> 'replay')::boolean then fallos := array_append(fallos, 'U2 sin replay'); end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.participant where scope_id = v_g;
  if v_n <> 3 then fallos := array_append(fallos, 'U2b participantes tras replay: ' || v_n); end if;
  select count(*) into v_n from core.group_profile_change where scope_id = v_g;
  if v_n <> 1 then fallos := array_append(fallos, 'U2c cambios en historial: ' || v_n); end if;
  select count(*) into v_n from core.group_notice where scope_id = v_g and kind = 'profile';
  if v_n <> 1 then fallos := array_append(fallos, 'U2d avisos (un miembro): ' || v_n); end if;
  -- el gasto anterior sigue con DOS cuotas: el nuevo no entra retroactivamente
  select count(*) into v_n from core.current_effect e join core.operation_version ov on ov.id=e.operation_version_id
   where ov.operation_id = v_op and e.economic_amount is not null;
  if v_n <> 2 then fallos := array_append(fallos, 'U2e el alta toco un reparto anterior: ' || v_n); end if;
  -- presencia del nuevo abierta desde hoy
  select count(*) into v_n from core.participant_period where participant_id = v_p3 and valid_from = current_date and valid_until is null;
  if v_n <> 1 then fallos := array_append(fallos, 'U2f presencia del nuevo no abierta desde hoy'); end if;
  perform set_config('role', 'authenticated', true);

  -- U3 · misma clave, OTRA intencion -> IDEMPOTENCY_KEY_REUSED
  begin
    perform api.update_group_profile(jsonb_build_object(
      'client_command_id', 'cc000000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1,
      'scope_id', v_g, 'display_name', 'Otro', 'emoji', 'HOME', 'expected_updated_at', v_read::text, 'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'U3 se acepto la clave con otra intencion');
  exception when others then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then fallos := array_append(fallos, 'U3b otro error: ' || sqlerrm); end if;
  end;

  -- U4 · CAS: lectura caducada -> PROFILE_CONFLICT, y nada escrito
  begin
    perform api.update_group_profile(jsonb_build_object(
      'client_command_id', 'cc000000-0000-4000-8000-000000000022'::uuid, 'command_contract_version', 1,
      'scope_id', v_g, 'display_name', 'Pisado', 'emoji', 'HOME', 'expected_updated_at', v_read::text, 'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'U4 se piso un cambio concurrente');
  exception when others then
    if sqlerrm not like '%PROFILE_CONFLICT%' then fallos := array_append(fallos, 'U4b otro error: ' || sqlerrm); end if;
  end;
  perform set_config('role', 'postgres', true);
  select display_name into v_t from core.group_profile where scope_id = v_g;
  if v_t <> 'Piso Centro' then fallos := array_append(fallos, 'U4c el conflicto escribio: ' || v_t); end if;
  select count(*) into v_n from core.provisioning_command where client_command_id = 'cc000000-0000-4000-8000-000000000022'::uuid;
  if v_n <> 0 then fallos := array_append(fallos, 'U4d el conflicto dejo la clave reclamada'); end if;
  perform set_config('role', 'authenticated', true);

  -- U5 · NO miembro -> NOT_AUTHORIZED, sin escribir
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub::text)::text, true);
  begin
    perform api.update_group_profile(jsonb_build_object(
      'client_command_id', 'cc000000-0000-4000-8000-000000000023'::uuid, 'command_contract_version', 1,
      'scope_id', v_g, 'display_name', 'Ajeno', 'emoji', 'X', 'expected_updated_at', now()::text, 'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'U5 un no miembro edito el grupo');
  exception when others then
    if sqlerrm not like '%NOT_AUTHORIZED%' then fallos := array_append(fallos, 'U5b otro error: ' || sqlerrm); end if;
  end;

  -- U6 · la moneda no esta en el contrato: se rechaza por forma
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  begin
    perform api.update_group_profile(jsonb_build_object(
      'client_command_id', 'cc000000-0000-4000-8000-000000000024'::uuid, 'command_contract_version', 1,
      'scope_id', v_g, 'display_name', 'Piso', 'emoji', 'HOME', 'currency_definition_id', v_eur,
      'expected_updated_at', now()::text, 'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'U6 se acepto currency_definition_id');
  exception when others then
    if sqlerrm not like '%PAYLOAD_INVALID%' then fallos := array_append(fallos, 'U6b otro error: ' || sqlerrm); end if;
  end;

  if array_length(fallos, 1) is not null then
    raise exception E'U · update_group_profile:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'U · update_group_profile: OK';
end
$u$;


-- ====== V · CATEGORIA PREESTABLECIDA DEL GRUPO: preferencia, no hecho contable =
do $v$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'ea000000-0000-4000-8000-000000000001';
  v_g    uuid := 'eb000000-0000-4000-8000-000000000010';
  v_pa   uuid := 'eb000000-0000-4000-8000-0000000000f1';
  v_p1   uuid := 'ed000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ed000000-0000-4000-8000-000000000032';
  v_cat  uuid;
  v_cat2 uuid;
  v_mia  uuid;
  v_out  jsonb;
  v_read timestamptz;
  v_n    bigint;
  v_t    text;
  v_op   uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cat  from core.category where message_key = 'category.expense.dining' and owner_user_id is null;
  select id into v_cat2 from core.category where owner_user_id is null and is_active and id <> v_cat limit 1;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values (v_pa, 'personal', v_eur, v_ua);
  insert into core.membership (scope_id, user_id) values (v_pa, v_ua);
  -- una categoria PROPIA del actor, que un grupo no puede preestablecer
  insert into core.category (id, message_key, label, icon, is_active, owner_user_id, ordinal)
  values ('ec000000-0000-4000-8000-0000000000c1', null, 'Mia', 'tag', true, v_ua, 999)
  returning id into v_mia;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- V1 · crear con preferencia: viaja en el sobre y en el perfil
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'ec000000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', v_g, 'display_name', 'Cenas', 'emoji', 'GRP', 'currency_definition_id', v_eur,
    'default_category_id', v_cat,
    'creator_participant_id', v_p1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', v_p2, 'display_name', 'Ana'))));
  if (v_out ->> 'default_category_id')::uuid is distinct from v_cat then fallos := array_append(fallos, 'V1 el sobre no lleva la preferencia'); end if;
  select default_category_id::text into v_t from api.group_profile where scope_id = v_g;
  if v_t is distinct from v_cat::text then fallos := array_append(fallos, 'V1b el perfil no la publica'); end if;

  -- V2 · un gasto con OTRA categoria conserva la suya: la preferencia no manda
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'ee000000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '2000',
    'effective_date', current_date::text, 'effective_time', '21:30', 'concept', 'Cena', 'category_id', v_cat2,
    'payer_participant_id', v_p1, 'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;
  select category_id::text into v_t from api.group_operation where operation_id = v_op;
  if v_t is distinct from v_cat2::text then fallos := array_append(fallos, 'V2 el gasto no guardo su propia categoria'); end if;

  -- V3 · cambiar la preferencia NO reclasifica el gasto anterior
  perform set_config('role', 'postgres', true);
  select updated_at into v_read from core.group_profile where scope_id = v_g;
  perform set_config('role', 'authenticated', true);
  v_out := api.update_group_profile(jsonb_build_object(
    'client_command_id', 'ec000000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'display_name', 'Cenas', 'emoji', 'GRP', 'default_category_id', v_cat2,
    'expected_updated_at', v_read::text, 'participants', '[]'::jsonb));
  if (v_out ->> 'default_category_id')::uuid is distinct from v_cat2 then fallos := array_append(fallos, 'V3 la edicion no cambio la preferencia'); end if;
  select category_id::text into v_t from api.group_operation where operation_id = v_op;
  if v_t is distinct from v_cat2::text then fallos := array_append(fallos, 'V3b el gasto cambio de categoria'); end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_profile_change where scope_id = v_g
     and (before_profile ->> 'default_category_id')::uuid = v_cat and (after_profile ->> 'default_category_id')::uuid = v_cat2;
  if v_n <> 1 then fallos := array_append(fallos, 'V3c el historial no recoge antes/despues de la preferencia'); end if;
  select updated_at into v_read from core.group_profile where scope_id = v_g;
  perform set_config('role', 'authenticated', true);

  -- V4 · volver a «Todas»: nula, y el gasto sigue con la suya
  v_out := api.update_group_profile(jsonb_build_object(
    'client_command_id', 'ec000000-0000-4000-8000-000000000022'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'display_name', 'Cenas', 'emoji', 'GRP',
    'expected_updated_at', v_read::text, 'participants', '[]'::jsonb));
  if (v_out -> 'default_category_id') is distinct from 'null'::jsonb then fallos := array_append(fallos, 'V4 «Todas» no es nula en el sobre'); end if;
  select category_id::text into v_t from api.group_operation where operation_id = v_op;
  if v_t is distinct from v_cat2::text then fallos := array_append(fallos, 'V4b el gasto perdio su categoria'); end if;
  perform set_config('role', 'postgres', true);
  select updated_at into v_read from core.group_profile where scope_id = v_g;
  perform set_config('role', 'authenticated', true);

  -- V5 · una categoria PROPIA se rechaza con su codigo
  begin
    perform api.update_group_profile(jsonb_build_object(
      'client_command_id', 'ec000000-0000-4000-8000-000000000023'::uuid, 'command_contract_version', 1,
      'scope_id', v_g, 'display_name', 'Cenas', 'emoji', 'GRP', 'default_category_id', v_mia,
      'expected_updated_at', v_read::text, 'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'V5 se acepto una categoria propia');
  exception when others then
    if sqlerrm not like '%CATEGORY_NOT_SHAREABLE%' then fallos := array_append(fallos, 'V5b otro error: ' || sqlerrm); end if;
  end;

  -- V6 · una inexistente se rechaza, y al crear tambien
  begin
    perform api.create_group(jsonb_build_object(
      'client_command_id', 'ec000000-0000-4000-8000-000000000024'::uuid, 'command_contract_version', 1,
      'client_group_id', 'eb000000-0000-4000-8000-000000000011'::uuid, 'display_name', 'X', 'emoji', 'GRP',
      'currency_definition_id', v_eur, 'default_category_id', 'ec000000-0000-4000-8000-0000000000ff'::uuid,
      'creator_participant_id', 'ed000000-0000-4000-8000-000000000041'::uuid, 'creator_display_name', 'Edu',
      'participants', '[]'::jsonb));
    fallos := array_append(fallos, 'V6 se acepto una categoria inexistente al crear');
  exception when others then
    if sqlerrm not like '%CATEGORY_NOT_USABLE%' then fallos := array_append(fallos, 'V6b otro error: ' || sqlerrm); end if;
  end;

  -- V7 · la HORA del gasto: persistida en la version y publicada en las dos lecturas
  select effective_time::text into v_t from api.group_operation where operation_id = v_op;
  if v_t is distinct from '21:30:00' then fallos := array_append(fallos, 'V7 group_operation no publica la hora: ' || coalesce(v_t,'nula')); end if;
  select effective_time::text into v_t from api.personal_operation where operation_id = v_op;
  if v_t is distinct from '21:30:00' then fallos := array_append(fallos, 'V7b personal_operation no publica la hora: ' || coalesce(v_t,'nula')); end if;
  -- y corregir SIN mandar hora la deja sin hora: no se conserva a escondidas ni se inventa
  perform set_config('role', 'postgres', true);
  select current_version_id::text into v_t from core.operation where id = v_op;
  perform set_config('role', 'authenticated', true);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'ee000000-0000-4000-8000-000000000042'::uuid, 'command_contract_version', 1,
    'operation_id', v_op, 'expected_version_id', v_t::uuid,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '2000',
    'effective_date', current_date::text, 'effective_time', '21:30', 'concept', 'Cena', 'category_id', v_cat2,
    'payer_participant_id', v_p1, 'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));
  select effective_time::text into v_t from api.group_operation where operation_id = v_op;
  if v_t is distinct from '21:30:00' then fallos := array_append(fallos, 'V7c la correccion perdio la hora enviada'); end if;

  -- V8 · el orden cliente/servidor: grupo 21:30, personal 22:00, grupo 22:15 -> 22:15, 22:00, 21:30
  perform api.record_personal_expense(jsonb_build_object(
    'client_operation_id', 'ee000000-0000-4000-8000-000000000043'::uuid, 'command_contract_version', 2,
    'scope_id', v_pa, 'currency_definition_id', v_eur, 'amount', '500',
    'effective_date', current_date::text, 'effective_time', '22:00', 'concept', 'Personal', 'category_id', v_cat));
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'ee000000-0000-4000-8000-000000000044'::uuid, 'command_contract_version', 1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '300',
    'effective_date', current_date::text, 'effective_time', '22:15', 'concept', 'Cafe', 'category_id', v_cat2,
    'payer_participant_id', v_p1, 'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));
  select string_agg(concept, ' > ' order by effective_date desc, effective_time desc nulls last, operation_created_at desc, operation_id desc)
    into v_t from api.personal_operation;
  if v_t is distinct from 'Cafe > Personal > Cena' then fallos := array_append(fallos, 'V8 orden: ' || coalesce(v_t,'nulo')); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'V · preferencia y hora:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'V · categoria preestablecida y hora del gasto compartido: OK';
end
$v$;

rollback;
