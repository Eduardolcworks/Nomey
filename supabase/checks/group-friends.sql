-- ============================================================================
-- AMIGOS DESDE UN PARTICIPANTE DE GRUPO (F12.E.D) contra las funciones reales
-- de 20261004120000, aislado
-- ============================================================================
--
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/checks/group-friends.sql
--
-- Lo que se demuestra, y en que orden:
--
--   A · catalogo: las dos funciones de api son definers del provisioner con
--       EXECUTE solo para authenticated; sec.participant_account es definer
--       del WRITER y NO lo ejecuta authenticated; authenticated sigue sin
--       USAGE sobre sec; ninguna relacion ni columna nueva; origin sigue
--       siendo exactamente {username, group}
--   B · EL PIN DE PRIVACIDAD: api.group_participant no publica ni una
--       columna nueva —ni uid, ni email, ni handle, ni nombre publico de la
--       cuenta— y su lista es EXACTAMENTE la de F10; sec.is_member no
--       menciona amistad; el tipo de salida de api.group_friend_status no
--       puede llevar identidad (tres columnas, y la unica de texto es el
--       estado)
--   C · UN SOLO NUCLEO (§8 del encargo): api.create_friend_request ya NO
--       contiene el cerrojo, los topes ni el insert, sino la llamada a
--       sec.create_friend_request_core; la entrada por participante llama al
--       MISMO; y el contrato publico por @handle sigue intacto
--   D · estados: miembro + vinculado → none; crear → pending; el otro ve
--       incoming_pending; aceptar → friends por los dos lados; cancelar y
--       rechazar; self; fantasma e invitado → unavailable
--   E · quien salio del grupo SIGUE siendo amistable (§4): vinculo
--       historico, identidad permanente
--   F · seguridad (§10, §19): participante de OTRO grupo → NOT_AUTHORIZED
--       para crear y ninguna fila para leer; un no-miembro lee cero filas;
--       el mapa no contiene uid, correo ni handle de nadie
--   G · el nucleo de verdad: una cruzada por @handle y por participante deja
--       UNA sola pendiente; dos claves distintas no dejan dos; el cooldown y
--       el tope por hora se aplican igual por participante; origin = group
--   H · nada financiero: hacerse amigo no crea ni una operacion, ni un
--       efecto, ni una membresia, ni un ambito
\pset pager off
\set ON_ERROR_STOP on
begin;

-- ═══════════════ fixture ════════════════════════════════════════════════════
create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'f4000000-0000-4000-8000-0000000000a1'::uuid as edu,    -- crea el grupo
  'f4000000-0000-4000-8000-0000000000a2'::uuid as aitor,  -- entra, con handle
  'f4000000-0000-4000-8000-0000000000a3'::uuid as dora,   -- entra y SALE
  'f4000000-0000-4000-8000-0000000000a4'::uuid as cris,   -- otro grupo
  'f4000000-0000-4000-8000-0000000000a5'::uuid as nora,   -- con handle, sin grupo
  'f4000000-0000-4000-8000-0000000000a6'::uuid as bruno,  -- en el grupo; para el tope
  'f4000000-0000-4000-8000-0000000000b1'::uuid as inv,    -- INVITADO (anonimo)
  'f4000000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'f4000000-0000-4000-8000-0000000000f2'::uuid as s_aitor,
  'f4000000-0000-4000-8000-0000000000f3'::uuid as s_dora,
  'f4000000-0000-4000-8000-0000000000f4'::uuid as s_cris,
  'f4000000-0000-4000-8000-0000000000f5'::uuid as s_nora,
  'f4000000-0000-4000-8000-0000000000f6'::uuid as s_inv,
  'f4000000-0000-4000-8000-0000000000f7'::uuid as s_bruno,
  'f4000000-0000-4000-8000-000000000010'::uuid as g,      -- el grupo
  'f4000000-0000-4000-8000-000000000011'::uuid as g2,     -- el grupo de Cris
  'f4000000-0000-4000-8000-000000000031'::uuid as p_edu,
  'f4000000-0000-4000-8000-000000000032'::uuid as p_gus,  -- FANTASMA, sin cuenta
  'f4000000-0000-4000-8000-000000000041'::uuid as p_cris,
  null::uuid as p_aitor, null::uuid as p_dora, null::uuid as p_inv, null::uuid as p_bruno,
  null::text as token, null::text as token2;
grant select, update on fx to authenticated;

create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
create function pg_temp.call(p_fn text, p_payload jsonb, p_who uuid, p_anon boolean default false) returns text
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_who, p_anon);
  execute format('select api.%I($1)', p_fn) into v using p_payload;
  perform pg_temp.super();
  return v::text;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return 'ERR ' || (sqlerrm::json ->> 'code');
end $$;
create function pg_temp.espera(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: se esperaba «%» y se obtuvo «%»', p_label, p_want, p_got;
  end if;
end $$;
grant execute on function pg_temp.actor(uuid, boolean), pg_temp.super(), pg_temp.call(text, jsonb, uuid, boolean),
  pg_temp.espera(text, text, text) to authenticated;

-- EL MAPA COMO LO LEE EL CLIENTE: «nombre:estado[:id]» por participante.
create function pg_temp.mapa(p_scope uuid, p_who uuid, p_anon boolean default false) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_who, p_anon);
  select coalesce(string_agg(n.display_name || ':' || s.state || case when s.request_id is null then '' else ':id' end, ' ' order by n.display_name), '-')
    into v from api.group_friend_status(p_scope) s
    -- por api.group_participant, que es de donde el cliente saca el nombre:
    -- leer core directamente ni siquiera le esta permitido (medido: el
    -- primer intento de este check fallo con «permission denied for schema
    -- core», que es exactamente la garantia).
    join api.group_participant n on n.participant_id = s.participant_id;
  perform pg_temp.super();
  return v;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return 'ERR ' || (sqlerrm::json ->> 'code');
end $$;
-- El estado de UN participante, sin el nombre.
create function pg_temp.est(p_scope uuid, p_who uuid, p_participant uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_who);
  select s.state into v from api.group_friend_status(p_scope) s where s.participant_id = p_participant;
  perform pg_temp.super();
  return coalesce(v, '-');
end $$;
create function pg_temp.pedir(p_who uuid, p_key uuid, p_participant uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_who, p_anon);
  r := api.create_friend_request_to_participant(jsonb_build_object(
         'client_command_id', p_key, 'command_contract_version', 1, 'participant_id', p_participant));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.pedir_handle(p_who uuid, p_key uuid, p_handle text) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_who);
  r := api.create_friend_request(jsonb_build_object(
         'client_command_id', p_key, 'command_contract_version', 1, 'handle', p_handle));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.accion(p_who uuid, p_fn text, p_id uuid) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_who);
  if p_fn = 'aceptar' then r := api.accept_friend_request(jsonb_build_object('request_id', p_id));
  elsif p_fn = 'rechazar' then r := api.decline_friend_request(jsonb_build_object('request_id', p_id));
  elsif p_fn = 'cancelar' then r := api.cancel_friend_request(jsonb_build_object('request_id', p_id));
  end if;
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.rid(p_scope uuid, p_who uuid, p_participant uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.actor(p_who);
  select s.request_id into v from api.group_friend_status(p_scope) s where s.participant_id = p_participant;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.k(p_n integer) returns uuid language sql immutable as $$
  select ('f4e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.mapa(uuid, uuid, boolean), pg_temp.est(uuid, uuid, uuid), pg_temp.pedir(uuid, uuid, uuid, boolean),
  pg_temp.pedir_handle(uuid, uuid, text), pg_temp.accion(uuid, text, uuid), pg_temp.rid(uuid, uuid, uuid), pg_temp.k(integer) to authenticated;

do $f$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  perform pg_temp.super();
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_aitor, 'personal', r.eur, r.aitor),
    (r.s_dora, 'personal', r.eur, r.dora), (r.s_cris, 'personal', r.eur, r.cris),
    (r.s_nora, 'personal', r.eur, r.nora), (r.s_inv, 'personal', r.eur, r.inv),
    (r.s_bruno, 'personal', r.eur, r.bruno);
  insert into core.membership (scope_id, user_id) values
    (r.s_edu, r.edu), (r.s_aitor, r.aitor), (r.s_dora, r.dora), (r.s_cris, r.cris),
    (r.s_nora, r.nora), (r.s_inv, r.inv), (r.s_bruno, r.bruno);

  -- Identidad publica: todos menos el invitado, que nunca reserva ni reclama.
  perform pg_temp.actor(r.edu);   perform api.reserve_username('{"handle":"edu_gf","public_name":"Edu"}');
  perform pg_temp.actor(r.aitor); perform api.reserve_username('{"handle":"aitor_gf","public_name":"Aitor"}');
  perform pg_temp.actor(r.dora);  perform api.reserve_username('{"handle":"dora_gf","public_name":"Dora"}');
  perform pg_temp.actor(r.cris);  perform api.reserve_username('{"handle":"cris_gf","public_name":"Cris"}');
  perform pg_temp.actor(r.nora);  perform api.reserve_username('{"handle":"nora_gf","public_name":"Nora"}');
  perform pg_temp.actor(r.bruno); perform api.reserve_username('{"handle":"bruno_gf","public_name":"Bruno"}');
  perform pg_temp.super();

  -- EL GRUPO: Edu (creador, con cuenta) y Gus (fantasma, sin cuenta).
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', pg_temp.k(1), 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Cena', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_gus, 'display_name', 'Gus'))), r.edu);
  if v like 'ERR%' then raise exception 'fixture create_group: %', v; end if;

  v := pg_temp.call('create_group_invitation', jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'scope_id', r.g), r.edu);
  update fx set token = v::jsonb ->> 'token';
  select * into r from fx;

  -- Aitor, Dora y el INVITADO entran como nuevos.
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(3), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Aitor'), r.aitor);
  if v like 'ERR%' then raise exception 'fixture redeem aitor: %', v; end if;
  update fx set p_aitor = (v::jsonb ->> 'participant_id')::uuid;
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(4), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Dora'), r.dora);
  if v like 'ERR%' then raise exception 'fixture redeem dora: %', v; end if;
  update fx set p_dora = (v::jsonb ->> 'participant_id')::uuid;
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(5), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Inv'), r.inv, true);
  if v like 'ERR%' then raise exception 'fixture redeem invitado: %', v; end if;
  update fx set p_inv = (v::jsonb ->> 'participant_id')::uuid;
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(7), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Bruno'), r.bruno);
  if v like 'ERR%' then raise exception 'fixture redeem bruno: %', v; end if;
  update fx set p_bruno = (v::jsonb ->> 'participant_id')::uuid;
  select * into r from fx;

  -- EL OTRO GRUPO, de Cris. Edu no es miembro.
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', pg_temp.k(6), 'command_contract_version', 1,
    'client_group_id', r.g2, 'display_name', 'Otro', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_cris, 'creator_display_name', 'Cris',
    'participants', '[]'::jsonb), r.cris);
  if v like 'ERR%' then raise exception 'fixture create_group g2: %', v; end if;
end
$f$;

-- ═══════════════ A · catalogo y privilegios ═════════════════════════════════
do $a$
declare fallos text[] := '{}'; v text; v_n int; r record;
begin
  perform pg_temp.super();

  -- A1 · las dos de api: definer, del provisioner, EXECUTE solo authenticated.
  for r in select * from (values
      ('api.group_friend_status(uuid)'),
      ('api.create_friend_request_to_participant(jsonb)'),
      ('api.create_friend_request(jsonb)')) as t(name) loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = r.name::regprocedure) <> 'nomey_provisioner' then
      fallos := array_append(fallos, 'A1 ' || r.name || ' no es del provisioner');
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = r.name::regprocedure) then
      fallos := array_append(fallos, 'A1 ' || r.name || ' no es SECURITY DEFINER');
    end if;
    if not has_function_privilege('authenticated', r.name, 'execute') then
      fallos := array_append(fallos, 'A1 authenticated no ejecuta ' || r.name);
    end if;
    if has_function_privilege('anon', r.name, 'execute') then
      fallos := array_append(fallos, 'A1 anon ejecuta ' || r.name);
    end if;
  end loop;

  -- A2 · sec.participant_account: definer del WRITER, y el cliente NO llega.
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'sec.participant_account(uuid)'::regprocedure) <> 'nomey_writer' then
    fallos := array_append(fallos, 'A2 sec.participant_account no es del writer');
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'sec.participant_account(uuid)'::regprocedure) then
    fallos := array_append(fallos, 'A2 sec.participant_account no es definer');
  end if;
  if has_function_privilege('authenticated', 'sec.participant_account(uuid)', 'execute')
     or has_function_privilege('anon', 'sec.participant_account(uuid)', 'execute') then
    fallos := array_append(fallos, 'A2 el cliente puede ejecutar sec.participant_account');
  end if;
  if not has_function_privilege('nomey_provisioner', 'sec.participant_account(uuid)', 'execute') then
    fallos := array_append(fallos, 'A2 el provisioner no puede ejecutar sec.participant_account');
  end if;

  -- A3 · los tres ayudantes nuevos del provisioner: solo el provisioner.
  for r in select * from (values
      ('sec.friend_request_replay(uuid,uuid)'),
      ('sec.create_friend_request_core(uuid,uuid,uuid,text)'),
      ('sec.participant_friendable(uuid)')) as t(name) loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = r.name::regprocedure) <> 'nomey_provisioner' then
      fallos := array_append(fallos, 'A3 ' || r.name || ' no es del provisioner');
    end if;
    if has_function_privilege('authenticated', r.name, 'execute') then
      fallos := array_append(fallos, 'A3 authenticated ejecuta ' || r.name);
    end if;
  end loop;

  -- A4 · authenticated sigue sin USAGE sobre sec, que es lo que hace
  --      inalcanzable al resolutor participante → cuenta.
  if has_schema_privilege('authenticated', 'sec', 'usage') then
    fallos := array_append(fallos, 'A4 authenticated tiene USAGE sobre sec');
  end if;

  -- A5 · ninguna relacion ni columna nueva: origin sigue siendo exactamente
  --      {username, group}, y no aparecio origin_participant_id.
  select pg_get_constraintdef(oid) into v from pg_constraint
   where conrelid = 'core.friend_request'::regclass and conname = 'friend_request_origen';
  if v is distinct from 'CHECK ((origin = ANY (ARRAY[''username''::text, ''group''::text])))' then
    fallos := array_append(fallos, 'A5 el CHECK de origin cambio: ' || coalesce(v, 'ausente'));
  end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'core' and table_name = 'friend_request';
  if v_n <> 15 then fallos := array_append(fallos, 'A5 core.friend_request ya no tiene 15 columnas: ' || v_n); end if;

  -- A6 · ningun rol de Nomey gano BYPASSRLS por el camino.
  if exists (select 1 from pg_roles where rolname like 'nomey_%' and rolbypassrls) then
    fallos := array_append(fallos, 'A6 un rol de Nomey tiene BYPASSRLS');
  end if;

  if cardinality(fallos) > 0 then raise exception 'A · catalogo: %', array_to_string(fallos, ' | '); end if;
  raise notice 'OK · A · catalogo: definers, propietarios, EXECUTE por rol, sec inalcanzable, sin relaciones ni columnas nuevas';
end
$a$;

-- ═══════════════ B · EL PIN DE PRIVACIDAD ═══════════════════════════════════
-- Lo que este bloque impide es que, por comodidad, algun dia aparezca el
-- @handle o el uid en la fila del grupo. El nombre visible es y sigue siendo
-- `participant.display_name`.
do $b$
declare fallos text[] := '{}'; v text; v_n int;
begin
  perform pg_temp.super();

  -- B1 · la lista EXACTA de api.group_participant, la de F10. Ni una mas.
  select string_agg(column_name, ',' order by ordinal_position) into v
    from information_schema.columns where table_schema = 'api' and table_name = 'group_participant';
  if v is distinct from 'participant_id,scope_id,display_name,created_at,is_self,is_active,eligible_until,is_retired,is_linked,has_history,merged_into_participant_id,is_departed' then
    fallos := array_append(fallos, 'B1 api.group_participant cambio de columnas: ' || coalesce(v, 'ausente'));
  end if;

  -- B2 · y ninguna vista ni funcion de api publica identidad de cuenta en el
  --      contexto de grupo: ni uid, ni email, ni handle, ni nombre publico.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'api' and table_name like 'group%'
     and (column_name ~ '(^|_)(uid|user_id|email|handle)$' or column_name in ('public_name', 'account_id'));
  if v_n <> 0 then fallos := array_append(fallos, 'B2 una vista api.group* publica identidad de cuenta: ' || v_n); end if;

  -- B3 · el tipo de salida del estado social NO puede llevar identidad: tres
  --      columnas, dos uuid (participante y solicitud) y UN texto (el estado).
  v := pg_get_function_result('api.group_friend_status(uuid)'::regprocedure);
  if v is distinct from 'TABLE(participant_id uuid, state text, request_id uuid)' then
    fallos := array_append(fallos, 'B3 la salida del estado social cambio: ' || coalesce(v, 'ausente'));
  end if;

  -- B4 · sec.is_member NO se amplio: no menciona amistad por ningun lado.
  if pg_get_functiondef('sec.is_member(uuid)'::regprocedure) ~* 'friend' then
    fallos := array_append(fallos, 'B4 sec.is_member menciona la amistad');
  end if;

  -- B5 · y a la inversa: la amistad no consulta ambitos ni efectos.
  if pg_get_functiondef('sec.friend_relation(uuid,uuid)'::regprocedure) ~* '(core\.scope|core\.effect|core\.membership|core\.operation)' then
    fallos := array_append(fallos, 'B5 sec.friend_relation consulta el modelo economico');
  end if;

  -- B6 · la policy de lectura del provisioner sobre el vinculo sigue siendo
  --      SOLO la propia: nada se relajo para resolver el participante ajeno.
  select count(*) into v_n from pg_policies
   where schemaname = 'core' and tablename = 'participant_user_link' and cmd = 'SELECT' and 'nomey_provisioner' = any(roles);
  if v_n <> 1 then fallos := array_append(fallos, 'B6 el provisioner tiene ' || v_n || ' policies de lectura sobre el vinculo, no 1'); end if;
  select qual into v from pg_policies
   where schemaname = 'core' and tablename = 'participant_user_link' and cmd = 'SELECT' and 'nomey_provisioner' = any(roles);
  if v !~ 'request_actor_id' then
    fallos := array_append(fallos, 'B6 la policy de lectura del vinculo ya no es la propia: ' || coalesce(v, 'ausente'));
  end if;

  if cardinality(fallos) > 0 then raise exception 'B · privacidad: %', array_to_string(fallos, ' | '); end if;
  raise notice 'OK · B · privacidad: group_participant intacta, sin identidad de cuenta en api.group*, salida sin identidad, is_member sin tocar, policy del vinculo sin relajar';
end
$b$;

-- ═══════════════ C · UN SOLO NUCLEO ═════════════════════════════════════════
do $c$
declare fallos text[] := '{}'; v_handle text; v_part text; v_core text;
begin
  perform pg_temp.super();
  v_handle := pg_get_functiondef('api.create_friend_request(jsonb)'::regprocedure);
  v_part   := pg_get_functiondef('api.create_friend_request_to_participant(jsonb)'::regprocedure);
  v_core   := pg_get_functiondef('sec.create_friend_request_core(uuid,uuid,uuid,text)'::regprocedure);

  -- C1 · LAS DOS llaman al nucleo, y ninguna de las dos lo reimplementa.
  if position('sec.create_friend_request_core(' in v_handle) = 0 then
    fallos := array_append(fallos, 'C1 la entrada por handle no llama al nucleo');
  end if;
  if position('sec.create_friend_request_core(' in v_part) = 0 then
    fallos := array_append(fallos, 'C1 la entrada por participante no llama al nucleo');
  end if;
  for v_handle in select unnest(array['sec.lock_friend_pair(', 'sec.lock_friend_budget(', 'FRIEND_REQUEST_LIMIT',
                                      'FRIEND_REQUEST_RATE_LIMITED', 'insert into core.friend_request']) loop
    if position(v_handle in pg_get_functiondef('api.create_friend_request(jsonb)'::regprocedure)) <> 0 then
      fallos := array_append(fallos, 'C1 la entrada por handle todavia contiene «' || v_handle || '»');
    end if;
    if position(v_handle in v_part) <> 0 then
      fallos := array_append(fallos, 'C1 la entrada por participante contiene «' || v_handle || '»');
    end if;
    if position(v_handle in v_core) = 0 then
      fallos := array_append(fallos, 'C1 el nucleo NO contiene «' || v_handle || '»');
    end if;
  end loop;

  -- C2 · y el replay tambien es compartido.
  v_handle := pg_get_functiondef('api.create_friend_request(jsonb)'::regprocedure);
  if position('sec.friend_request_replay(' in v_handle) = 0
     or position('sec.friend_request_replay(' in v_part) = 0 then
    fallos := array_append(fallos, 'C2 alguna entrada no usa el replay compartido');
  end if;

  -- C3 · lo que SOLO tiene la entrada por handle: el freno del resolver.
  if position('RECIPIENT_LOOKUP_THROTTLED' in v_handle) = 0 then
    fallos := array_append(fallos, 'C3 la entrada por handle perdio el freno del resolver');
  end if;
  if position('username_lookup_attempt' in v_part) <> 0 then
    fallos := array_append(fallos, 'C3 la entrada por participante consume el freno del resolver');
  end if;

  if cardinality(fallos) > 0 then raise exception 'C · nucleo: %', array_to_string(fallos, ' | '); end if;
  raise notice 'OK · C · un solo nucleo: cerrojos, topes e insert viven SOLO en sec.create_friend_request_core; el freno del resolver solo en la entrada por handle';
end
$c$;

-- ═══════════════ D · los estados ════════════════════════════════════════════
do $d$
declare r fx%rowtype; v_id uuid;
begin
  select * into r from fx;

  -- D1 · el mapa de Edu recien creado el grupo: el fantasma y el invitado no
  --      son amistables, el propio es self, Aitor y Dora estan a cero.
  perform pg_temp.espera('D1 mapa de Edu',
    pg_temp.mapa(r.g, r.edu), 'Aitor:none Bruno:none Dora:none Edu:self Gus:unavailable Inv:unavailable');

  -- D2 · Edu pide a Aitor. Sale pendiente por los dos lados, con su id.
  perform pg_temp.espera('D2 pedir', pg_temp.pedir(r.edu, pg_temp.k(10), r.p_aitor), 'pending');
  perform pg_temp.espera('D2 Edu ve saliente', pg_temp.est(r.g, r.edu, r.p_aitor), 'outgoing_pending');
  perform pg_temp.espera('D2 Aitor ve entrante', pg_temp.est(r.g, r.aitor, r.p_edu), 'incoming_pending');
  perform pg_temp.espera('D2 el id viaja',
    pg_temp.mapa(r.g, r.aitor), 'Aitor:self Bruno:none Dora:none Edu:incoming_pending:id Gus:unavailable Inv:unavailable');

  -- D3 · repetir con OTRA clave no crea una segunda: contesta la que hay.
  perform pg_temp.espera('D3 segunda clave', pg_temp.pedir(r.edu, pg_temp.k(11), r.p_aitor), 'pending/replay');
  perform pg_temp.espera('D3 misma clave', pg_temp.pedir(r.edu, pg_temp.k(10), r.p_aitor), 'pending/replay');
  perform pg_temp.super();
  if (select count(*) from core.friend_request where pair_low = least(r.edu, r.aitor) and pair_high = greatest(r.edu, r.aitor)) <> 1 then
    raise exception 'D3 hay mas de una solicitud para la pareja';
  end if;
  -- y quedo auditada como nacida en un grupo.
  if (select origin from core.friend_request where requester_user_id = r.edu and target_user_id = r.aitor) <> 'group' then
    raise exception 'D3 la solicitud no quedo con origin = group';
  end if;

  -- D4 · Aitor acepta desde el grupo. Los dos se ven «friends».
  v_id := pg_temp.rid(r.g, r.aitor, r.p_edu);
  perform pg_temp.espera('D4 aceptar', pg_temp.accion(r.aitor, 'aceptar', v_id), 'accepted');
  perform pg_temp.espera('D4 Edu', pg_temp.est(r.g, r.edu, r.p_aitor), 'friends');
  perform pg_temp.espera('D4 Aitor', pg_temp.est(r.g, r.aitor, r.p_edu), 'friends');

  -- D5 · Edu pide a Dora y CANCELA: vuelve a none por los dos lados.
  perform pg_temp.espera('D5 pedir', pg_temp.pedir(r.edu, pg_temp.k(12), r.p_dora), 'pending');
  v_id := pg_temp.rid(r.g, r.edu, r.p_dora);
  perform pg_temp.espera('D5 cancelar', pg_temp.accion(r.edu, 'cancelar', v_id), 'cancelled');
  perform pg_temp.espera('D5 Edu', pg_temp.est(r.g, r.edu, r.p_dora), 'none');
  perform pg_temp.espera('D5 Dora', pg_temp.est(r.g, r.dora, r.p_edu), 'none');

  -- D6 · Dora pide a Edu y Edu RECHAZA. Para Dora el cooldown se contesta
  --      como `none` en el mapa —no se le recuerda cada vez que abre el
  --      grupo—, pero el comando SI le dice cooldown si vuelve a pulsar.
  perform pg_temp.espera('D6 pedir', pg_temp.pedir(r.dora, pg_temp.k(13), r.p_edu), 'pending');
  v_id := pg_temp.rid(r.g, r.edu, r.p_dora);
  perform pg_temp.espera('D6 rechazar', pg_temp.accion(r.edu, 'rechazar', v_id), 'declined');
  perform pg_temp.espera('D6 el mapa de Dora no lo recuerda', pg_temp.est(r.g, r.dora, r.p_edu), 'none');
  perform pg_temp.espera('D6 el comando si', pg_temp.pedir(r.dora, pg_temp.k(14), r.p_edu), 'cooldown');
  -- y es DIRECCIONAL: Edu puede pedirselo a ella.
  perform pg_temp.espera('D6 al reves no hay cooldown', pg_temp.pedir(r.edu, pg_temp.k(15), r.p_dora), 'pending');
  v_id := pg_temp.rid(r.g, r.edu, r.p_dora);
  perform pg_temp.espera('D6 limpiar', pg_temp.accion(r.edu, 'cancelar', v_id), 'cancelled');

  -- D7 · el fantasma y el invitado no se pueden pedir, y el invitado no
  --      puede pedir a nadie: su mapa entero es unavailable.
  perform pg_temp.espera('D7 fantasma', pg_temp.pedir(r.edu, pg_temp.k(16), r.p_gus), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D7 invitado como destino', pg_temp.pedir(r.edu, pg_temp.k(17), r.p_inv), 'unavailable');
  perform pg_temp.espera('D7 invitado como emisor', pg_temp.pedir(r.inv, pg_temp.k(18), r.p_edu, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('D7 el mapa del invitado',
    pg_temp.mapa(r.g, r.inv, true), 'Aitor:unavailable Bruno:unavailable Dora:unavailable Edu:unavailable Gus:unavailable Inv:unavailable');

  -- D8 · a uno mismo, ni por el mapa ni por el comando.
  perform pg_temp.espera('D8 self en el mapa', pg_temp.est(r.g, r.edu, r.p_edu), 'self');
  perform pg_temp.espera('D8 self por comando', pg_temp.pedir(r.edu, pg_temp.k(19), r.p_edu), 'PAYLOAD_INVALID');

  raise notice 'OK · D · estados: none, pending por los dos lados, friends, cancelar, rechazar + cooldown direccional, fantasma, invitado y self';
end
$d$;

-- ═══════════════ E · quien salio del grupo ══════════════════════════════════
-- La amistad es entre CUENTAS. Haber compartido gastos con alguien no deja de
-- ser cierto porque se haya ido, y su vinculo sigue existiendo como historico
-- (F10/ADR-003). Lo unico que decide si se le puede preguntar es si el grupo
-- sigue publicando su fila, que es una decision del grupo y no de aqui.
do $e$
declare r fx%rowtype; v text; v_id uuid;
begin
  select * into r from fx;
  v := pg_temp.call('leave_group', jsonb_build_object('client_command_id', pg_temp.k(20), 'command_contract_version', 1, 'scope_id', r.g), r.dora);
  if v like 'ERR%' then raise exception 'E leave_group: %', v; end if;

  perform pg_temp.super();
  -- El vinculo sigue ahi, terminado: historico, no borrado.
  if not exists (select 1 from core.participant_user_link l where l.participant_id = r.p_dora and l.user_id = r.dora and l.ended_at is not null) then
    raise exception 'E el vinculo de quien salio no quedo historico';
  end if;
  -- El grupo sigue publicando su fila, marcada.
  perform pg_temp.actor(r.edu);
  if not exists (select 1 from api.group_participant where participant_id = r.p_dora and is_departed) then
    perform pg_temp.super();
    raise exception 'E el grupo dejo de publicar a quien salio';
  end if;
  perform pg_temp.super();

  -- Y SE LE PUEDE PEDIR AMISTAD: sigue siendo la misma cuenta.
  perform pg_temp.espera('E quien salio sigue en el mapa', pg_temp.est(r.g, r.edu, r.p_dora), 'none');
  perform pg_temp.espera('E se le puede pedir', pg_temp.pedir(r.edu, pg_temp.k(21), r.p_dora), 'pending');
  v_id := pg_temp.rid(r.g, r.edu, r.p_dora);
  perform pg_temp.espera('E y ella acepta', pg_temp.accion(r.dora, 'aceptar', v_id), 'accepted');
  perform pg_temp.espera('E amigos', pg_temp.est(r.g, r.edu, r.p_dora), 'friends');

  raise notice 'OK · E · quien salio: vinculo historico conservado, fila publicada con is_departed, amistad posible y aceptada';
end
$e$;

-- ═══════════════ F · seguridad ══════════════════════════════════════════════
do $f2$
declare r fx%rowtype; v text;
begin
  select * into r from fx;

  -- F1 · un participante de OTRO grupo: para crear, NOT_AUTHORIZED; y no se
  --      distingue de uno inexistente.
  perform pg_temp.espera('F1 participante ajeno', pg_temp.pedir(r.edu, pg_temp.k(30), r.p_cris), 'NOT_AUTHORIZED');
  perform pg_temp.espera('F1 participante inexistente',
    pg_temp.pedir(r.edu, pg_temp.k(31), 'f4000000-0000-4000-8000-000000009999'::uuid), 'NOT_AUTHORIZED');

  -- F2 · leer el estado de un ambito ajeno: CERO filas, no un error. Edu no
  --      aprende ni quien esta en el grupo de Cris ni que relacion tiene.
  perform pg_temp.espera('F2 ambito ajeno', pg_temp.mapa(r.g2, r.edu), '-');
  perform pg_temp.espera('F2 ambito inexistente',
    pg_temp.mapa('f4000000-0000-4000-8000-000000008888'::uuid, r.edu), '-');
  -- Y Cris, que SI es miembro del suyo, lo lee.
  perform pg_temp.espera('F2 su duena si', pg_temp.mapa(r.g2, r.cris), 'Cris:self');

  -- F3 · ser amigo NO abre el grupo. Edu y Aitor son amigos desde D4; Nora,
  --      que no esta en ningun grupo, no ve nada de este aunque pidiera.
  perform pg_temp.espera('F3 una amiga fuera del grupo no lo ve', pg_temp.mapa(r.g, r.nora), '-');
  perform pg_temp.super();
  if exists (select 1 from core.membership m where m.scope_id = r.g and m.user_id = r.nora) then
    raise exception 'F3 la amistad creo una membresia';
  end if;

  -- F4 · el resolutor participante → cuenta no es alcanzable por el cliente
  --      ni siquiera por nombre completo.
  perform pg_temp.actor(r.edu);
  begin
    perform sec.participant_account(r.p_aitor);
    perform pg_temp.super();
    raise exception 'F4 el cliente pudo ejecutar sec.participant_account';
  exception when insufficient_privilege then
    perform pg_temp.super();
  end;

  raise notice 'OK · F · seguridad: participante ajeno e inexistente indistinguibles, ambito ajeno sin filas, la amistad no abre nada, el resolutor inalcanzable';
end
$f2$;

-- ═══════════════ G · el nucleo, de verdad ═══════════════════════════════════
do $g$
declare r fx%rowtype; v_id uuid;
begin
  select * into r from fx;

  -- G1 · CRUZADA entre las dos entradas: Nora pide a Edu por @handle y Edu le
  --      pide a ella... no puede, no comparten grupo. Se hace al reves: Edu
  --      pide a Aitor por handle cuando ya son amigos → `friends`, sin
  --      escribir. Es el mismo nucleo contestando por la otra puerta.
  perform pg_temp.espera('G1 por handle, ya amigos', pg_temp.pedir_handle(r.edu, pg_temp.k(40), 'aitor_gf'), 'friends');
  perform pg_temp.super();
  if (select count(*) from core.friend_request where pair_low = least(r.edu, r.aitor) and pair_high = greatest(r.edu, r.aitor)) <> 1 then
    raise exception 'G1 la entrada por handle escribio una segunda solicitud';
  end if;

  -- G2 · LA CRUZADA REAL, una por cada puerta: Nora pide a Edu por @handle;
  --      Edu, que la tiene en ningun grupo, no puede responderle por
  --      participante, pero SI puede pedirsela por handle y recibe la suya.
  perform pg_temp.espera('G2 Nora por handle', pg_temp.pedir_handle(r.nora, pg_temp.k(41), 'edu_gf'), 'pending');
  perform pg_temp.espera('G2 Edu recibe la suya', pg_temp.pedir_handle(r.edu, pg_temp.k(42), 'nora_gf'), 'incoming_pending');
  perform pg_temp.super();
  if (select count(*) from core.friend_request where pair_low = least(r.edu, r.nora) and pair_high = greatest(r.edu, r.nora)) <> 1 then
    raise exception 'G2 una cruzada dejo dos pendientes';
  end if;

  -- G3 · LA CRUZADA ENTRE PUERTAS. Aitor pide a Dora por PARTICIPANTE —su
  --      fila sigue publicada aunque ella saliera—, y Dora se la pide a el
  --      por @HANDLE: recibe `incoming_pending` con el id de la de Aitor y
  --      no se inserta una segunda. Las dos puertas, la misma pareja, UNA
  --      sola fila.
  --
  --      Y de paso queda medido lo contrario: Dora NO puede pedir por
  --      participante en un grupo del que salio, porque el resolutor exige
  --      que el ACTOR sea miembro ACTUAL. Salir quita la puerta del grupo;
  --      no quita la amistad ni el @handle, que es como se le sigue
  --      llegando.
  perform pg_temp.espera('G3 quien salio ya no usa esa puerta',
    pg_temp.pedir(r.dora, pg_temp.k(43), r.p_aitor), 'NOT_AUTHORIZED');
  perform pg_temp.espera('G3 Aitor por participante', pg_temp.pedir(r.aitor, pg_temp.k(44), r.p_dora), 'pending');
  perform pg_temp.espera('G3 Dora por handle', pg_temp.pedir_handle(r.dora, pg_temp.k(45), 'aitor_gf'), 'incoming_pending');
  perform pg_temp.super();
  if (select count(*) from core.friend_request where pair_low = least(r.aitor, r.dora) and pair_high = greatest(r.aitor, r.dora)) <> 1 then
    raise exception 'G3 la cruzada entre puertas dejo dos pendientes';
  end if;
  -- Y la que hay es la de Aitor, nacida en el grupo.
  if (select origin from core.friend_request where requester_user_id = r.aitor and target_user_id = r.dora) <> 'group' then
    raise exception 'G3 la pendiente no es la de Aitor, o no quedo con origin = group';
  end if;

  -- G4 · EL TOPE POR HORA ES UN SOLO CONTADOR para las dos puertas. A Edu
  --      se le llevan las filas a diez con origen 'username', y la
  --      siguiente —por PARTICIPANTE, a Bruno, con quien no tiene nada—
  --      cae por ese mismo tope. Si cada puerta contara aparte, pasaria.
  perform pg_temp.super();
  insert into core.friend_request (requester_user_id, target_user_id, origin, client_command_id, cancelled_at, resolved_by, resolution)
  select r.edu, gen_random_uuid(), 'username', gen_random_uuid(), now(), r.edu, 'cancelled'
    from generate_series(1, 10 - (select count(*) from core.friend_request where requester_user_id = r.edu));
  perform pg_temp.espera('G4 el tope cuenta las dos puertas',
    pg_temp.pedir(r.edu, pg_temp.k(46), r.p_bruno), 'FRIEND_REQUEST_RATE_LIMITED');

  raise notice 'OK · G · nucleo compartido: ya-amigos por la otra puerta sin escribir, cruzadas por handle y entre puertas con UNA sola pendiente, tope por hora comun';
end
$g$;

-- ═══════════════ H · nada financiero ════════════════════════════════════════
do $h$
declare r fx%rowtype; v_ops int; v_ef int; v_sc int; v_mem int;
begin
  select * into r from fx;
  perform pg_temp.super();
  select count(*) into v_ops from core.operation;
  select count(*) into v_ef  from core.effect;
  select count(*) into v_sc  from core.scope;
  select count(*) into v_mem from core.membership;

  -- Una amistad mas, creada ahora mismo entre dos cuentas que no comparten
  -- nada: ni una operacion, ni un efecto, ni un ambito, ni una membresia.
  perform pg_temp.espera('H pedir', pg_temp.pedir_handle(r.cris, pg_temp.k(50), 'nora_gf'), 'pending');
  perform pg_temp.espera('H aceptar', pg_temp.accion(r.nora, 'aceptar',
    (select id from core.friend_request where requester_user_id = r.cris and target_user_id = r.nora)), 'accepted');

  perform pg_temp.super();
  if (select count(*) from core.operation)  <> v_ops then raise exception 'H la amistad creo operaciones'; end if;
  if (select count(*) from core.effect)     <> v_ef  then raise exception 'H la amistad creo efectos'; end if;
  if (select count(*) from core.scope)      <> v_sc  then raise exception 'H la amistad creo ambitos'; end if;
  if (select count(*) from core.membership) <> v_mem then raise exception 'H la amistad creo membresias'; end if;

  -- Y Cris sigue sin ver el grupo de Edu, ni Nora el de Cris.
  perform pg_temp.espera('H amigos, pero sin acceso', pg_temp.mapa(r.g, r.cris), '-');
  perform pg_temp.espera('H ni al reves', pg_temp.mapa(r.g2, r.nora), '-');

  raise notice 'OK · H · nada financiero: ni operaciones, ni efectos, ni ambitos, ni membresias; y ningun grupo se abre';
end
$h$;

rollback;
