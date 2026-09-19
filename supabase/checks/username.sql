-- ============================================================================
-- USERNAME: IDENTIDAD PUBLICA, CICLO DE VIDA Y RESOLVER (F12/ADR-001, F12.A1)
-- contra las funciones reales de 20260921120000, aislado
-- ============================================================================
--
--   { ./scripts/vectors-prelude.sh ; cat supabase/checks/username.sql ; } | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
-- Dentro de UNA transaccion now() no avanza: los plazos (7 dias de reserva,
-- 30 de cooldown, 90 de retencion) se fijan como fixture, como postgres,
-- retrasando las marcas de las filas que las funciones produjeron. Es lo
-- unico que este check escribe a mano.
--
--   A · estructura: tablas, RLS, indices, CHECKs, propietarios (todo del
--       provisioner, nada de postgres), definer/invoker, EXECUTE por rol,
--       la vista security_invoker, supabase_auth_admin sigue sin nada en sec
--   B · vectores: normalize_handle y assert_handle_valid reproducen los 69
--       casos; los reservados sembrados son los 25 exactos y 4 prefijos
--   C · reservar y reclamar: normal reclama en el acto; anonimo solo reserva
--       (7 dias) y sustituye su reserva viva; TAKEN sobre una reserva ajena;
--       idempotente por estado; caducada → USERNAME_REQUIRED sin leer Auth;
--       desalojo perezoso por un tercero; INVALID y RESERVED; sin
--       public_name la primera vez → PAYLOAD_INVALID; con definitivo, el
--       mismo handle es idempotente sin escribir y otro es PAYLOAD_INVALID
--   D · cambiar: cooldown 30 (details.available_at), retencion 90, retenido
--       no reservable ni resoluble, recuperado por su dueño (cuenta como
--       cambio), liberado tras 90 y reclamado por otro; sin definitivo →
--       USERNAME_REQUIRED
--   E · nombre publico: 1:1 con la cuenta, sin instantaneas en los handles,
--       no unico
--   F · resolver: found | not_found | self | throttled; 20/10 min contando
--       found y not_found, self no cuenta, throttled no apunta; ningun texto
--       consultado se guarda; poda > 1 dia; ni uid ni scope en la salida;
--       reserva y retenido no resuelven; actor sin definitivo → REQUIRED
--   G · RLS y permisos: la vista es solo la fila propia; el cliente no llega a
--       core; el provisioner no toca filas ajenas vigentes ni el diario;
--       public_identity resuelve uid → identidad actual
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  'a6000000-0000-4000-8000-0000000000b1'::uuid as bea,   -- cuenta normal
  'a6000000-0000-4000-8000-0000000000c1'::uuid as cris,  -- cuenta normal
  'a6000000-0000-4000-8000-0000000000d1'::uuid as dan,   -- nace invitado, reserva y la deja caducar
  'a6000000-0000-4000-8000-0000000000e1'::uuid as inv,   -- nace invitado, reserva y reclama
  'a6000000-0000-4000-8000-0000000000f1'::uuid as nadie; -- sin identidad
grant select on fx to authenticated;

create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.provisioner(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'nomey_provisioner', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid, boolean), pg_temp.provisioner(uuid), pg_temp.super() to authenticated, nomey_provisioner;

-- Un comando de estado como p_user: 'handle|state|reserved_until?|can_change_at?' o el codigo.
create function pg_temp.estado(p_handle text, p_state text, p_until timestamptz, p_can timestamptz) returns text language sql as $$
  select coalesce(p_handle, '-') || '|' || coalesce(p_state, '-')
      || '|' || case when p_until is null then '-' when p_until = now() + interval '7 days' then '+7d' else 'otro' end
      || '|' || case when p_can is null then '-' when p_can <= now() then 'ya' else 'despues' end;
$$;
create function pg_temp.reservar(p_user uuid, p_handle text, p_name text default null, p_anon boolean default false) returns text language plpgsql as $$
declare r record; v jsonb := jsonb_build_object('handle', p_handle);
begin
  if p_name is not null then v := v || jsonb_build_object('public_name', p_name); end if;
  perform pg_temp.actor(p_user, p_anon);
  select * into r from api.reserve_username(v);
  perform pg_temp.super();
  return pg_temp.estado(r.handle, r.state, r.reserved_until, r.can_change_at);
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.reclamar(p_user uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r record;
begin
  perform pg_temp.actor(p_user, p_anon);
  select * into r from api.claim_username();
  perform pg_temp.super();
  return pg_temp.estado(r.handle, r.state, r.reserved_until, r.can_change_at);
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.cambiar(p_user uuid, p_handle text, p_anon boolean default false) returns text language plpgsql as $$
declare r record;
begin
  perform pg_temp.actor(p_user, p_anon);
  select * into r from api.change_username(jsonb_build_object('handle', p_handle));
  perform pg_temp.super();
  return pg_temp.estado(r.handle, r.state, r.reserved_until, r.can_change_at);
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return (sqlerrm::json ->> 'code') || coalesce(' ' || (sqlerrm::json ->> 'details'), '');
end $$;
create function pg_temp.nombrar(p_user uuid, p_name text, p_anon boolean default false) returns text language plpgsql as $$
declare r record;
begin
  perform pg_temp.actor(p_user, p_anon);
  select * into r from api.set_public_name(jsonb_build_object('public_name', p_name));
  perform pg_temp.super();
  return coalesce(r.public_name, '-') || '|' || coalesce(r.handle, '-');
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- resolve_username como p_user: 'state[ handle Nombre]' o el codigo.
create function pg_temp.resolver(p_user uuid, p_handle text, p_anon boolean default false) returns text language plpgsql as $$
declare r record;
begin
  perform pg_temp.actor(p_user, p_anon);
  select * into r from api.resolve_username(p_handle);
  perform pg_temp.super();
  return r.state || coalesce(' ' || r.handle || ' ' || r.public_name, '');
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
-- La fila propia por la vista, como p_user.
create function pg_temp.vista(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(coalesce(handle, '-') || '|' || public_name || '|' || coalesce(state, '-'), ';'), 'sin fila') into v from api.my_account_handle;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.diario(p_handle text) returns text language sql as $$
  select coalesce(string_agg(e.event, ',' order by e.id), '-') from core.account_handle_event e where e.handle = p_handle;
$$;
create function pg_temp.intentos(p_user uuid) returns integer language sql as $$
  select count(*)::integer from core.username_lookup_attempt a where a.user_id = p_user;
$$;
grant execute on function pg_temp.estado(text, text, timestamptz, timestamptz), pg_temp.reservar(uuid, text, text, boolean), pg_temp.reclamar(uuid, boolean),
  pg_temp.cambiar(uuid, text, boolean), pg_temp.nombrar(uuid, text, boolean), pg_temp.resolver(uuid, text, boolean), pg_temp.vista(uuid),
  pg_temp.diario(text), pg_temp.intentos(uuid) to authenticated;

create function pg_temp.espera(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: se esperaba «%» y se obtuvo «%»', p_label, p_want, p_got;
  end if;
end $$;

-- ═══════════════════════ A · estructura ═══════════════════════════════════════
do $a$
declare
  v_n integer;
  v_t text;
  r record;
begin
  for v_t in select unnest(array['reserved_handle', 'account_identity', 'account_handle', 'account_handle_event', 'username_lookup_attempt']) loop
    if not (select relrowsecurity from pg_class where oid = ('core.' || v_t)::regclass) then
      raise exception 'A: core.% sin RLS', v_t;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'account_handle'
                  and indexdef ilike '%unique%' and indexdef ilike '%(user_id)%' and indexdef ilike '%released_at is null%') then
    raise exception 'A: falta el indice unico parcial (user_id) where released_at is null';
  end if;
  select count(*) into v_n from pg_constraint where conrelid = 'core.account_handle'::regclass and contype = 'c';
  if v_n < 6 then raise exception 'A: core.account_handle tiene % CHECKs, se esperaban al menos 6', v_n; end if;
  -- una fila de handle NO lleva nombre: el nombre es de la identidad (1:1)
  if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'account_handle' and column_name in ('public_name', 'display_name', 'name')) then
    raise exception 'A: core.account_handle lleva un nombre; el nombre publico vive en core.account_identity';
  end if;
  -- el apunte del freno no lleva el texto consultado
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.columns
   where table_schema = 'core' and table_name = 'username_lookup_attempt';
  if v_t <> 'attempted_at,user_id' then raise exception 'A: username_lookup_attempt guarda mas que quien y cuando: %', v_t; end if;
  raise notice 'OK · A1 · cinco tablas con RLS, indice unico parcial, CHECKs, sin nombre en el handle ni texto en el apunte';

  -- propietarios: TODO del provisioner, NADA de postgres
  for r in select n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'api' and p.proname in ('reserve_username', 'claim_username', 'change_username', 'set_public_name', 'resolve_username'))
               or (n.nspname = 'sec' and p.proname in ('normalize_handle', 'assert_handle_valid', 'evict_expired_handle', 'account_handle_state', 'public_identity')) loop
    if r.owner <> 'nomey_provisioner' then raise exception 'A: % es de %, no del provisioner', r.name, r.owner; end if;
    if r.definer <> (r.name like 'api.%' or r.name = 'sec.public_identity') then
      raise exception 'A: % definer=% no es lo esperado', r.name, r.definer;
    end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'api' and p.proname in ('reserve_username', 'claim_username', 'change_username', 'set_public_name', 'resolve_username'))
      or (n.nspname = 'sec' and p.proname in ('normalize_handle', 'assert_handle_valid', 'evict_expired_handle', 'account_handle_state', 'public_identity'));
  if v_n <> 10 then raise exception 'A: se esperaban 10 funciones nuevas y hay %', v_n; end if;
  if (select rolbypassrls from pg_roles where rolname = 'nomey_provisioner') then raise exception 'A: el provisioner tiene BYPASSRLS'; end if;
  raise notice 'OK · A2 · diez funciones del provisioner (definer solo las cinco de api y public_identity), sin BYPASSRLS';

  -- EXECUTE por rol
  for v_t in select unnest(array['api.reserve_username(jsonb)', 'api.claim_username()', 'api.change_username(jsonb)', 'api.set_public_name(jsonb)', 'api.resolve_username(text)']) loop
    if not has_function_privilege('authenticated', v_t, 'execute') then raise exception 'A: authenticated no ejecuta %', v_t; end if;
    if has_function_privilege('anon', v_t, 'execute') then raise exception 'A: anon ejecuta %', v_t; end if;
    if has_function_privilege('nomey_writer', v_t, 'execute') then raise exception 'A: el writer ejecuta %', v_t; end if;
  end loop;
  for v_t in select unnest(array['sec.normalize_handle(text)', 'sec.assert_handle_valid(text)', 'sec.evict_expired_handle(text)', 'sec.account_handle_state(uuid)', 'sec.public_identity(uuid)']) loop
    if has_function_privilege('authenticated', v_t, 'execute') or has_function_privilege('anon', v_t, 'execute') then
      raise exception 'A: el cliente ejecuta %', v_t;
    end if;
    if not has_function_privilege('nomey_provisioner', v_t, 'execute') then raise exception 'A: el provisioner no ejecuta %', v_t; end if;
  end loop;
  if not has_function_privilege('nomey_writer', 'sec.public_identity(uuid)', 'execute') then raise exception 'A: el writer no ejecuta public_identity'; end if;
  for v_t in select unnest(array['sec.normalize_handle(text)', 'sec.assert_handle_valid(text)', 'sec.evict_expired_handle(text)', 'sec.account_handle_state(uuid)']) loop
    if has_function_privilege('nomey_writer', v_t, 'execute') then raise exception 'A: el writer ejecuta %', v_t; end if;
  end loop;
  -- supabase_auth_admin: nada todavia (el hook es F12.A2)
  if has_schema_privilege('supabase_auth_admin', 'sec', 'usage') then raise exception 'A: supabase_auth_admin tiene USAGE en sec antes de F12.A2'; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and has_function_privilege('supabase_auth_admin', p.oid, 'execute');
  if v_n <> 0 then raise exception 'A: supabase_auth_admin ejecuta % funciones de sec', v_n; end if;
  -- el cliente no llega a core, ni al diario, ni a los apuntes, ni a los reservados
  if has_schema_privilege('authenticated', 'core', 'usage') or has_schema_privilege('anon', 'core', 'usage') then raise exception 'A: el cliente tiene USAGE en core'; end if;
  for v_t in select unnest(array['core.account_handle_event', 'core.username_lookup_attempt', 'core.reserved_handle']) loop
    if has_table_privilege('authenticated', v_t, 'select') then raise exception 'A: authenticated lee %', v_t; end if;
  end loop;
  if has_table_privilege('nomey_provisioner', 'core.account_handle_event', 'update') or has_table_privilege('nomey_provisioner', 'core.account_handle_event', 'delete')
     or has_table_privilege('nomey_provisioner', 'core.account_handle_event', 'select') then
    raise exception 'A: el diario no es insert-only para el provisioner';
  end if;
  -- la vista es security_invoker y solo del cliente
  select coalesce(array_to_string(c.reloptions, ','), '') into v_t from pg_class c where c.oid = 'api.my_account_handle'::regclass;
  if v_t not like '%security_invoker=true%' then raise exception 'A: api.my_account_handle no es security_invoker (%)', v_t; end if;
  if not has_table_privilege('authenticated', 'api.my_account_handle', 'select') or has_table_privilege('anon', 'api.my_account_handle', 'select') then
    raise exception 'A: el SELECT de la vista no es el esperado';
  end if;
  raise notice 'OK · A3 · EXECUTE y SELECT por rol; auth_admin sin nada en sec; el diario insert-only; la vista security_invoker';
end
$a$;

-- ═══════════════════════ B · vectores ═════════════════════════════════════════
do $b$
declare
  v_doc jsonb := (select doc from vector_doc where name = 'username');
  c jsonb;
  v_got text;
  v_code text;
  v_n integer := 0;
begin
  if v_doc is null then raise exception 'B: falta el vector username (scripts/vectors-prelude.sh)'; end if;
  for c in select * from jsonb_array_elements(v_doc -> 'cases') loop
    v_n := v_n + 1;
    v_got := sec.normalize_handle(c ->> 'in');
    if v_got is distinct from (c ->> 'out') then
      raise exception 'B: normalize_handle(%) = «%», el vector dice «%»', c ->> 'id', v_got, c ->> 'out';
    end if;
    begin
      v_got := sec.assert_handle_valid(c ->> 'in');
      v_code := null;
    exception when sqlstate 'PGRST' then
      v_code := sqlerrm::json ->> 'code';
    end;
    if (c ->> 'problem') is null and (v_code is not null or v_got <> (c ->> 'out')) then
      raise exception 'B: assert_handle_valid(%) rehuso con % un caso valido', c ->> 'id', v_code;
    elsif (c ->> 'problem') = 'invalid' and v_code is distinct from 'USERNAME_INVALID' then
      raise exception 'B: assert_handle_valid(%) dio % en vez de USERNAME_INVALID', c ->> 'id', v_code;
    elsif (c ->> 'problem') = 'reserved' and v_code is distinct from 'USERNAME_RESERVED' then
      raise exception 'B: assert_handle_valid(%) dio % en vez de USERNAME_RESERVED', c ->> 'id', v_code;
    end if;
  end loop;
  if v_n < 60 then raise exception 'B: solo % casos', v_n; end if;
  raise notice 'OK · B1 · % vectores reproducidos por normalize_handle y assert_handle_valid', v_n;

  if (select count(*) from core.reserved_handle where kind = 'exact') <> 25 or (select count(*) from core.reserved_handle where kind = 'prefix') <> 4 then
    raise exception 'B: la siembra no tiene 25 exactos y 4 prefijos';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_doc -> 'reserved' -> 'exact') x
              where not exists (select 1 from core.reserved_handle r where r.handle = x and r.kind = 'exact'))
     or exists (select 1 from jsonb_array_elements_text(v_doc -> 'reserved' -> 'prefixes') x
              where not exists (select 1 from core.reserved_handle r where r.handle = x and r.kind = 'prefix')) then
    raise exception 'B: la siembra de reservados no coincide con el vector';
  end if;
  if (select count(*) from core.reserved_handle) <> jsonb_array_length(v_doc -> 'reserved' -> 'exact') + jsonb_array_length(v_doc -> 'reserved' -> 'prefixes') then
    raise exception 'B: la siembra tiene reservados que el vector no tiene';
  end if;
  raise notice 'OK · B2 · los reservados sembrados son exactamente los del vector';
end
$b$;

-- ═══════════════════════ C · reservar y reclamar ══════════════════════════════
do $c$
declare
  f fx%rowtype := (select fx from fx);
  v_n integer;
  v_t text;
begin
  -- normal: reserva y reclama en el acto
  perform pg_temp.espera('C1 bea reserva', pg_temp.reservar(f.bea, ' @Bea ', 'Bea López'), 'bea|claimed|-|ya');
  perform pg_temp.espera('C1 diario', pg_temp.diario('bea'), 'reserved,claimed');
  perform pg_temp.espera('C1 idempotente', pg_temp.reservar(f.bea, 'bea'), 'bea|claimed|-|ya');
  perform pg_temp.espera('C1 idempotente mayusculas', pg_temp.reservar(f.bea, 'BEA'), 'bea|claimed|-|ya');
  perform pg_temp.espera('C1 diario sin repetir', pg_temp.diario('bea'), 'reserved,claimed');
  perform pg_temp.espera('C1 reclamar ya definitivo', pg_temp.reclamar(f.bea), 'bea|claimed|-|ya');
  -- MISMO handle con definitivo: exito idempotente, y NADA cambia — ni la fila
  -- del handle, ni la identidad (cooldown, updated_at), ni el diario.
  select h.claimed_at::text || i.updated_at::text || coalesce(i.handle_changed_at::text, '-') || (select count(*) from core.account_handle_event)::text
    into v_t from core.account_handle h join core.account_identity i on i.user_id = h.user_id where h.handle = 'bea';
  perform pg_temp.espera('C1 mismo handle con nombre igual', pg_temp.reservar(f.bea, '@BEA', 'Bea López'), 'bea|claimed|-|ya');
  if v_t <> (select h.claimed_at::text || i.updated_at::text || coalesce(i.handle_changed_at::text, '-') || (select count(*) from core.account_handle_event)::text
               from core.account_handle h join core.account_identity i on i.user_id = h.user_id where h.handle = 'bea') then
    raise exception 'C1: el mismo handle sobre un definitivo escribio algo';
  end if;
  -- OTRO handle con definitivo: no es reservar sino cambiar → PAYLOAD_INVALID, y nada escrito
  perform pg_temp.espera('C1 otro handle con definitivo', pg_temp.reservar(f.bea, 'otra_bea'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('C1 otro handle con definitivo y nombre', pg_temp.reservar(f.bea, 'otra_bea', 'Otra'), 'PAYLOAD_INVALID');
  if exists (select 1 from core.account_handle where handle = 'otra_bea') then raise exception 'C1: reserve escribio sobre un definitivo'; end if;
  if (select public_name from core.account_identity where user_id = f.bea) <> 'Bea López' then raise exception 'C1: el nombre cambio pese al rechazo'; end if;
  perform pg_temp.espera('C1 diario intacto', pg_temp.diario('bea'), 'reserved,claimed');
  raise notice 'OK · C1 · normal reserva y reclama en el acto; con definitivo, el mismo handle es idempotente sin escribir y otro es PAYLOAD_INVALID';

  -- anonimo: solo reserva, 7 dias; sustituye su reserva viva
  perform pg_temp.espera('C2 inv reserva anonimo', pg_temp.reservar(f.inv, 'inv_uno', 'Inv', true), 'inv_uno|reserved|+7d|-');
  perform pg_temp.espera('C2 inv misma reserva', pg_temp.reservar(f.inv, 'inv_uno', null, true), 'inv_uno|reserved|+7d|-');
  perform pg_temp.espera('C2 inv sustituye', pg_temp.reservar(f.inv, 'inv_dos', null, true), 'inv_dos|reserved|+7d|-');
  if exists (select 1 from core.account_handle where handle = 'inv_uno') then raise exception 'C2: la reserva sustituida sigue'; end if;
  perform pg_temp.espera('C2 diario sustituida', pg_temp.diario('inv_uno'), 'reserved,replaced');
  perform pg_temp.espera('C2 anonimo no reclama', pg_temp.reclamar(f.inv, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('C2 anonimo no cambia', pg_temp.cambiar(f.inv, 'inv_tres', true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('C2 anonimo sin nombre publico', pg_temp.nombrar(f.inv, 'Otro', true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('C2 anonimo no resuelve', pg_temp.resolver(f.inv, 'bea', true), 'NOT_AUTHORIZED');
  -- la reserva viva protege el handle frente a otra cuenta
  perform pg_temp.espera('C2 cris choca con la reserva', pg_temp.reservar(f.cris, 'inv_dos', 'Cris'), 'USERNAME_TAKEN');
  perform pg_temp.espera('C2 cris choca con bea', pg_temp.reservar(f.cris, 'Bea', 'Cris'), 'USERNAME_TAKEN');
  -- ya convertido en cuenta normal: reclama; repetir devuelve el estado
  perform pg_temp.espera('C2 inv reclama', pg_temp.reclamar(f.inv), 'inv_dos|claimed|-|ya');
  perform pg_temp.espera('C2 inv reclama otra vez', pg_temp.reclamar(f.inv), 'inv_dos|claimed|-|ya');
  perform pg_temp.espera('C2 diario', pg_temp.diario('inv_dos'), 'reserved,claimed');
  raise notice 'OK · C2 · anonimo reserva 7 dias, sustituye la suya, no reclama ni cambia ni resuelve; TAKEN para terceros; luego reclama una vez';

  -- sin identidad: reclamar → REQUIRED; reservar sin nombre → PAYLOAD_INVALID
  perform pg_temp.espera('C3 nadie reclama', pg_temp.reclamar(f.nadie), 'USERNAME_REQUIRED');
  perform pg_temp.espera('C3 nadie sin nombre', pg_temp.reservar(f.nadie, 'nadie'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('C3 nadie sin fila', pg_temp.vista(f.nadie), 'sin fila');
  perform pg_temp.espera('C3 nadie resuelve sin handle', pg_temp.resolver(f.nadie, 'bea'), 'USERNAME_REQUIRED');
  -- forma y reservados por el comando
  perform pg_temp.espera('C3 invalido', pg_temp.reservar(f.cris, 'Ab', 'Cris'), 'USERNAME_INVALID');
  perform pg_temp.espera('C3 reservado', pg_temp.reservar(f.cris, 'admin_cris', 'Cris'), 'USERNAME_RESERVED');
  perform pg_temp.espera('C3 cris reserva', pg_temp.reservar(f.cris, 'cris', 'Cris'), 'cris|claimed|-|ya');
  raise notice 'OK · C3 · sin identidad → REQUIRED y PAYLOAD_INVALID; INVALID y RESERVED por el comando';

  -- caducidad: independiente de Auth (nadie lee auth.users), perezosa
  perform pg_temp.espera('C4 dan reserva anonimo', pg_temp.reservar(f.dan, 'dan', 'Dan', true), 'dan|reserved|+7d|-');
  update core.account_handle set reserved_at = now() - interval '8 days', reserved_until = now() - interval '1 second' where handle = 'dan';
  perform pg_temp.espera('C4 dan caducada reclama', pg_temp.reclamar(f.dan), 'USERNAME_REQUIRED');
  if not exists (select 1 from core.account_handle where handle = 'dan') then raise exception 'C4: reclamar borro la reserva caducada (el desalojo es de quien la pide)'; end if;
  perform pg_temp.espera('C4 dan vista caducada', pg_temp.vista(f.dan), 'dan|Dan|reserved');
  -- un tercero pide el handle: desalojo perezoso y suyo
  perform pg_temp.espera('C4 cris desaloja', pg_temp.cambiar(f.cris, 'dan'), 'dan|claimed|-|despues');
  perform pg_temp.espera('C4 diario dan', pg_temp.diario('dan'), 'reserved,evicted,claimed');
  select count(*) into v_n from core.account_handle_event where handle = 'dan' and event = 'evicted' and user_id = f.dan and actor_user_id = f.cris;
  if v_n <> 1 then raise exception 'C4: el desalojo no queda apuntado con dueño dan y actor cris'; end if;
  perform pg_temp.espera('C4 dan ya sin handle', pg_temp.vista(f.dan), '-|Dan|-');
  perform pg_temp.espera('C4 dan vuelve a reservar', pg_temp.reservar(f.dan, 'dan_bis', null, true), 'dan_bis|reserved|+7d|-');
  -- deshacer el cambio de cris para D (cris vuelve a ser cris): fixture, como postgres
  update core.account_identity set handle_changed_at = null where user_id = f.cris;
  raise notice 'OK · C4 · reserva caducada: REQUIRED al reclamar sin leer Auth; desalojada por quien la pide, con apunte';
end
$c$;

-- ═══════════════════════ D · cambiar ══════════════════════════════════════════
do $d$
declare
  f fx%rowtype := (select fx from fx);
  v text;
  v_claimed timestamptz;
begin
  -- cris tiene «dan» (C4); vuelve a «cris» → «dan» queda retenido
  perform pg_temp.espera('D1 cris cambia', pg_temp.cambiar(f.cris, 'cris'), 'cris|claimed|-|despues');
  if not exists (select 1 from core.account_handle where handle = 'dan' and user_id = f.cris and released_at = now() and held_until = now() + interval '90 days' and claimed_at is not null) then
    raise exception 'D1: el anterior no quedo liberado y retenido 90 dias';
  end if;
  if (select handle_changed_at from core.account_identity where user_id = f.cris) <> now() then raise exception 'D1: handle_changed_at no es ahora'; end if;
  perform pg_temp.espera('D1 diario dan', pg_temp.diario('dan'), 'reserved,evicted,claimed,released');
  perform pg_temp.espera('D1 vista', pg_temp.vista(f.cris), 'cris|Cris|claimed');
  -- cooldown con la fecha
  v := pg_temp.cambiar(f.cris, 'cris_dos');
  if v not like 'USERNAME_CHANGE_COOLDOWN %' or (substring(v from 26)::jsonb ->> 'available_at')::timestamptz <> now() + interval '30 days' then
    raise exception 'D2: se esperaba USERNAME_CHANGE_COOLDOWN con available_at = +30d y se obtuvo %', v;
  end if;
  perform pg_temp.espera('D2 mismo handle idempotente', pg_temp.cambiar(f.cris, 'cris'), 'cris|claimed|-|despues');
  -- el retenido: ni reservable ni resoluble por otros
  perform pg_temp.espera('D2 bea no toma el retenido', pg_temp.reservar(f.bea, 'dan'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('D2 bea no cambia al retenido', left(pg_temp.cambiar(f.bea, 'dan'), 14), 'USERNAME_TAKEN');
  perform pg_temp.espera('D2 retenido no resuelve', pg_temp.resolver(f.bea, 'dan'), 'not_found');
  raise notice 'OK · D1-D2 · cambio con liberacion y retencion 90; cooldown 30 con available_at; retenido no se toma ni resuelve';

  -- recuperar el propio retenido: es un cambio (cooldown) y reactiva la MISMA fila
  update core.account_identity set handle_changed_at = now() - interval '31 days' where user_id = f.cris;
  select claimed_at into v_claimed from core.account_handle where handle = 'dan';
  perform pg_temp.espera('D3 cris recupera', pg_temp.cambiar(f.cris, 'dan'), 'dan|claimed|-|despues');
  if not exists (select 1 from core.account_handle where handle = 'dan' and user_id = f.cris and released_at is null and held_until is null and claimed_at = v_claimed) then
    raise exception 'D3: la fila recuperada no es la misma reactivada';
  end if;
  if not exists (select 1 from core.account_handle where handle = 'cris' and user_id = f.cris and released_at = now() and held_until = now() + interval '90 days') then
    raise exception 'D3: el que deja no quedo retenido';
  end if;
  perform pg_temp.espera('D3 diario', pg_temp.diario('dan'), 'reserved,evicted,claimed,released,recovered');
  perform pg_temp.espera('D3 cooldown de nuevo', left(pg_temp.cambiar(f.cris, 'cris'), 24), 'USERNAME_CHANGE_COOLDOWN');
  raise notice 'OK · D3 · recuperar el propio retenido reactiva la misma fila y cuenta como cambio';

  -- liberado tras 90 dias: otro lo toma, y el historial sigue en el diario
  update core.account_handle set released_at = now() - interval '91 days', held_until = now() - interval '1 day' where handle = 'cris';
  perform pg_temp.espera('D4 bea toma el liberado', pg_temp.cambiar(f.bea, 'cris'), 'cris|claimed|-|despues');
  if not exists (select 1 from core.account_handle where handle = 'cris' and user_id = f.bea and claimed_at = now()) then raise exception 'D4: bea no tiene cris'; end if;
  perform pg_temp.espera('D4 diario cris', pg_temp.diario('cris'), 'reserved,claimed,released,recovered,released,evicted,claimed');
  if (select count(*) from core.account_handle_event where handle = 'cris' and user_id = f.cris) <> 6 then raise exception 'D4: el historial de cris se perdio'; end if;
  perform pg_temp.espera('D4 bea retenido', (select string_agg(handle, ',' order by handle) from core.account_handle where user_id = f.bea and released_at is not null), 'bea');
  -- sin definitivo: no se cambia
  perform pg_temp.espera('D4 dan sin definitivo', pg_temp.cambiar(f.dan, 'dan_tres'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('D4 nadie sin identidad', pg_temp.cambiar(f.nadie, 'nadie'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('D4 cambio invalido', pg_temp.cambiar(f.cris, 'x'), 'USERNAME_INVALID');
  perform pg_temp.espera('D4 cambio reservado', left(pg_temp.cambiar(f.cris, 'soporte'), 17), 'USERNAME_RESERVED');
  raise notice 'OK · D4 · liberado tras 90 dias lo toma otro; el diario conserva el historial; sin definitivo → REQUIRED';
end
$d$;

-- ═══════════════════════ E · nombre publico ═══════════════════════════════════
do $e$
declare
  f fx%rowtype := (select fx from fx);
begin
  perform pg_temp.espera('E1 bea renombra', pg_temp.nombrar(f.bea, '  Bea   L. '), 'Bea L.|cris');
  perform pg_temp.espera('E1 vista', pg_temp.vista(f.bea), 'cris|Bea L.|claimed');
  if (select count(*) from core.account_identity where user_id = f.bea) <> 1 then raise exception 'E1: mas de una identidad'; end if;
  perform pg_temp.espera('E1 no unico', pg_temp.nombrar(f.cris, 'Bea L.'), 'Bea L.|dan');
  perform pg_temp.espera('E1 vacio', pg_temp.nombrar(f.cris, '   '), 'PAYLOAD_INVALID');
  perform pg_temp.espera('E1 sin handle tambien tiene nombre', pg_temp.nombrar(f.nadie, 'Nadie'), 'Nadie|-');
  perform pg_temp.espera('E1 vista sin handle', pg_temp.vista(f.nadie), '-|Nadie|-');
  raise notice 'OK · E · public_name 1:1 con la cuenta, canonico, no unico, sin handle tambien';
end
$e$;

-- ═══════════════════════ F · resolver ═════════════════════════════════════════
do $f$
declare
  f fx%rowtype := (select fx from fx);
  v_t text;
  i integer;
begin
  -- estado actual: bea=@cris «Bea L.», cris=@dan «Bea L.», inv=@inv_dos «Inv», dan reserva @dan_bis, nadie sin handle
  perform pg_temp.espera('F1 found', pg_temp.resolver(f.inv, ' @Cris '), 'found cris Bea L.');
  perform pg_temp.espera('F1 found dan', pg_temp.resolver(f.inv, 'DAN'), 'found dan Bea L.');
  perform pg_temp.espera('F1 self', pg_temp.resolver(f.inv, 'inv_dos'), 'self');
  perform pg_temp.espera('F1 not_found', pg_temp.resolver(f.inv, 'nadie_aqui'), 'not_found');
  perform pg_temp.espera('F1 reserva no resuelve', pg_temp.resolver(f.inv, 'dan_bis'), 'not_found');
  perform pg_temp.espera('F1 retenido no resuelve', pg_temp.resolver(f.inv, 'bea'), 'not_found');
  perform pg_temp.espera('F1 invalido es not_found', pg_temp.resolver(f.inv, 'no vale'), 'not_found');
  perform pg_temp.espera('F1 reservado es not_found', pg_temp.resolver(f.inv, 'help'), 'not_found');
  -- cuentan found y not_found (7), self no
  perform pg_temp.espera('F1 apuntes', pg_temp.intentos(f.inv)::text, '7');
  -- la salida no lleva identificadores internos
  select string_agg(a.attname, ',' order by a.n) into v_t
    from pg_proc p, unnest(p.proallargtypes, p.proargmodes, p.proargnames) with ordinality as a(t, m, attname, n)
   where p.oid = 'api.resolve_username(text)'::regprocedure and a.m = 't';
  if v_t <> 'state,handle,public_name' then raise exception 'F1: resolve_username publica %', v_t; end if;
  raise notice 'OK · F1 · found | not_found | self; reserva y retenido no resuelven; self no cuenta; solo estado, handle y nombre';

  -- freno: 20 en 10 minutos; el 21 es throttled y no apunta; el freno tambien alcanza a self
  for i in 8..20 loop perform pg_temp.resolver(f.inv, 'x_' || i); end loop;
  perform pg_temp.espera('F2 veinte', pg_temp.intentos(f.inv)::text, '20');
  perform pg_temp.espera('F2 throttled', pg_temp.resolver(f.inv, 'cris'), 'throttled');
  perform pg_temp.espera('F2 throttled self', pg_temp.resolver(f.inv, 'inv_dos'), 'throttled');
  perform pg_temp.espera('F2 sin apunte nuevo', pg_temp.intentos(f.inv)::text, '20');
  -- otra cuenta no esta frenada
  perform pg_temp.espera('F2 bea libre', pg_temp.resolver(f.bea, 'inv_dos'), 'found inv_dos Inv');
  -- poda: un apunte de hace dos dias desaparece cuando cualquiera resuelve
  insert into core.username_lookup_attempt (user_id, attempted_at) values (f.inv, now() - interval '2 days');
  perform pg_temp.espera('F2 apunte viejo', pg_temp.intentos(f.inv)::text, '21');
  perform pg_temp.resolver(f.bea, 'quien_sea');
  perform pg_temp.espera('F2 podado', pg_temp.intentos(f.inv)::text, '20');
  -- tras la ventana, inv vuelve a poder (fixture: los apuntes envejecen 11 minutos)
  update core.username_lookup_attempt set attempted_at = attempted_at - interval '11 minutes' where user_id = f.inv;
  perform pg_temp.espera('F2 tras la ventana', pg_temp.resolver(f.inv, 'cris'), 'found cris Bea L.');
  raise notice 'OK · F2 · 20 consultas / 10 min; throttled no apunta; otra cuenta libre; poda > 1 dia; la ventana pasa';
end
$f$;

-- ═══════════════════════ G · RLS y permisos ═══════════════════════════════════
do $g$
declare
  f fx%rowtype := (select fx from fx);
  v_n integer;
  v_t text;
begin
  -- la vista: solo la fila propia
  perform pg_temp.espera('G1 vista bea', pg_temp.vista(f.bea), 'cris|Bea L.|claimed');
  perform pg_temp.espera('G1 vista dan', pg_temp.vista(f.dan), 'dan_bis|Dan|reserved');
  -- el cliente no llega a core
  perform pg_temp.actor(f.bea);
  begin
    execute 'select count(*) from core.account_handle';
    raise exception 'G1: el cliente lee core.account_handle';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select count(*) from core.account_identity';
    raise exception 'G1: el cliente lee core.account_identity';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select * from sec.public_identity($1)' using f.cris;
    raise exception 'G1: el cliente ejecuta sec.public_identity';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · G1 · la vista solo ensena la fila propia; el cliente no llega a core ni a public_identity';

  -- el provisioner, como bea, no toca lo ajeno vigente
  perform pg_temp.provisioner(f.bea);
  update core.account_handle set claimed_at = now() where user_id = f.cris;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'G2: el provisioner actualizo un handle ajeno'; end if;
  delete from core.account_handle where handle = 'dan';           -- definitivo vigente de cris
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'G2: el provisioner borro un definitivo ajeno'; end if;
  delete from core.account_handle where handle = 'dan_bis';       -- reserva VIVA de dan
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'G2: el provisioner borro una reserva viva ajena'; end if;
  delete from core.account_handle where handle = 'cris';          -- el propio definitivo vigente
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'G2: el provisioner borro el propio definitivo'; end if;
  update core.account_identity set public_name = 'X' where user_id = f.cris;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'G2: el provisioner renombro a otro'; end if;
  begin
    insert into core.account_identity (user_id, public_name) values (f.nadie, 'Falso');
    raise exception 'G2: el provisioner creo una identidad ajena';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into core.username_lookup_attempt (user_id) values (f.cris);
    raise exception 'G2: el provisioner apunto un intento a otro';
  exception when insufficient_privilege then null;
  end;
  delete from core.username_lookup_attempt where attempted_at > now() - interval '1 hour';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'G2: el provisioner borro apuntes recientes'; end if;
  begin
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values ('dan', f.cris, 'released', f.cris);
    raise exception 'G2: el provisioner firmo el diario como otro';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'update core.account_handle_event set event = $1' using 'evicted';
    raise exception 'G2: el provisioner edita el diario';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'delete from core.account_handle_event';
    raise exception 'G2: el provisioner borra el diario';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · G2 · el provisioner no toca handles ni identidades ajenas, ni apuntes de otros, ni el diario';

  -- uid → identidad actual (lo que leeran los historicos, §13)
  select coalesce(public_name, '-') || '|' || coalesce(handle, '-') into v_t from sec.public_identity(f.bea);
  perform pg_temp.espera('G3 bea actual', v_t, 'Bea L.|cris');
  select coalesce(public_name, '-') || '|' || coalesce(handle, '-') into v_t from sec.public_identity(f.dan);
  perform pg_temp.espera('G3 dan solo nombre (reserva)', v_t, 'Dan|-');
  select coalesce(public_name, '-') || '|' || coalesce(handle, '-') into v_t from sec.public_identity(f.nadie);
  perform pg_temp.espera('G3 nadie sin handle', v_t, 'Nadie|-');
  if exists (select 1 from sec.public_identity('a6000000-0000-4000-8000-000000000099')) then raise exception 'G3: una cuenta desconocida tiene identidad'; end if;
  select string_agg(a.attname, ',' order by a.n) into v_t
    from pg_proc p, unnest(p.proallargtypes, p.proargmodes, p.proargnames) with ordinality as a(t, m, attname, n)
   where p.oid = 'sec.public_identity(uuid)'::regprocedure and a.m = 't';
  if v_t <> 'public_name,handle' then raise exception 'G3: public_identity publica %', v_t; end if;
  raise notice 'OK · G3 · public_identity: nombre y handle definitivo actual, nunca una reserva ni un liberado';
end
$g$;

rollback;
