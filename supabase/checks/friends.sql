-- ============================================================================
-- AMIGOS: amistad simetrica, solicitud dirigida y enlace personal
-- (F12/ADR-005, F12/ADR-006, F12.E.A) contra las funciones reales de
-- 20260930120000, aislado
-- ============================================================================
--
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/checks/friends.sql
--
-- Dentro de UNA transaccion now() no avanza: la caducidad (30 dias), el
-- cooldown (7 dias), la ventana del tope (60 min) y la de las rotaciones
-- (24 h) se fijan como fixture, como postgres, retrasando las marcas de
-- filas que las funciones produjeron. Es lo unico que este check escribe a
-- mano en las tablas de F12.E; el resto del fixture es el de siempre.
--
--   A · estructura: cinco tablas con RLS y sin grant alguno a authenticated;
--       todo del provisioner y nada de postgres; sin BYPASSRLS; EXECUTE por
--       rol; el indice parcial de «una pendiente por pareja» incluye
--       expired_at; ningun handle ni nombre persistido; ninguna vista de api
--       lee core.friend* directamente; ninguna funcion economica ni de
--       ambitos las consulta
--   B · buscar: found con relacion none, self, not_found, throttled a la 21;
--       un apunte por busqueda (compartido con resolve_username); anonimo,
--       sin handle; nunca uid
--   C · crear: pending; replay; a uno mismo; not_found como estado con
--       apunte; friends / incoming_pending / cooldown como estados sin
--       escribir; 30 pendientes (409); 10 en 60 min (429 con retry_at);
--       cancelar no devuelve cuota
--   D · cruzadas: A→B y B→A → una sola pendiente, la segunda recibe
--       incoming_pending con el id de la primera
--   E · aceptar / rechazar / cancelar: quien puede; tercero NOT_AUTHORIZED;
--       idempotencia por estado; codigos cruzados; una amistad por
--       aceptacion; resolved_by y resolution
--   F · caducidad PERSISTIDA: una vencida se terminaliza (expired_at) por el
--       primer comando que toca la pareja (y ese comando responde el ESTADO
--       expired, no una excepcion: si no, la marca no persistiria), y una
--       nueva entra; la vista no la lista aunque nadie la haya terminalizado
--   G · cooldown: 7 dias tras declined, direccional (el otro puede enviar);
--       no tras cancelled; no tras expired; no tras remove
--   H · eliminar: cualquiera de los dos; ended_at/ended_by; idempotente;
--       tercero NOT_AUTHORIZED; volver a solicitar crea otra instancia; no
--       toca operaciones ni ambitos (cuenta antes = despues)
--   I · el enlace: nace al pedirlo, estable, 43 chars, no deriva del uid ni
--       contiene el handle; rotar lo cambia y el viejo es invalid; 5/24 h;
--       preview: ok, own, friends, incoming_pending, mutual_pending, invalid
--       (apunta) y throttled; anonimo y sin handle NO resuelven; sin apunte
--       para lo valido
--   J · responder al enlace: accept → amistad de origen link; con solicitud
--       del dueno → accepted + amistad de origen request; con solicitud
--       propia → accepted_via_link; ya amigos → friends sin escribir;
--       decline → declined si habia suya, dismissed si no; own; cooldown no
--       impide aceptar el enlace
--   K · vistas: my_friends y my_friend_requests solo del actor, sin uid, con
--       el handle NUEVO tras cambiarlo; un tercero nada; terminales fuera
--   L · nada financiero: ser amigo no abre ningun ambito ni efecto ajeno
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  'f1000000-0000-4000-8000-0000000000a1'::uuid as ana,   -- normal, handle
  'f1000000-0000-4000-8000-0000000000b1'::uuid as bea,   -- normal, handle
  'f1000000-0000-4000-8000-0000000000c1'::uuid as cris,  -- normal, handle
  'f1000000-0000-4000-8000-0000000000d1'::uuid as dan,   -- normal, SIN handle
  'f1000000-0000-4000-8000-000000000011'::uuid as inv,   -- invitado con reserva
  'f1c00000-0000-4000-8000-0000000000e1'::uuid as eur,
  'f1a00000-0000-4000-8000-0000000000a1'::uuid as pa,
  'f1a00000-0000-4000-8000-0000000000b1'::uuid as pb;
grant select on fx to authenticated;

insert into core.currency_definition (id, code, scale) select eur, 'EUR', 2 from fx;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  select pa, 'personal', eur, ana from fx union all select pb, 'personal', eur, bea from fx;
insert into core.membership (scope_id, user_id) select pa, ana from fx union all select pb, bea from fx;

create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid, boolean), pg_temp.super() to authenticated;

do $seed$
declare r record;
begin
  perform pg_temp.actor((select ana from fx));  select * into r from api.reserve_username('{"handle":"ana_fr","public_name":"Ana"}');
  perform pg_temp.actor((select bea from fx));  select * into r from api.reserve_username('{"handle":"bea_fr","public_name":"Bea"}');
  perform pg_temp.actor((select cris from fx)); select * into r from api.reserve_username('{"handle":"cris_fr","public_name":"Cris"}');
  perform pg_temp.actor((select inv from fx), true); select * into r from api.reserve_username('{"handle":"inv_fr","public_name":"Inv"}');
  perform pg_temp.super();
end $seed$;

-- helpers: cada uno devuelve 'estado[/replay]' o el codigo
create function pg_temp.k(p_n integer) returns uuid language sql immutable as $$
  select ('f1e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
create function pg_temp.buscar(p_user uuid, p_handle text, p_anon boolean default false) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user, p_anon);
  select state || ':' || coalesce(handle, '-') || ':' || coalesce(public_name, '-') || ':' || case when request_id is null then '-' else 'id' end
    into v from api.lookup_friend_candidate(p_handle);
  perform pg_temp.super();
  return v;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.crear(p_user uuid, p_key uuid, p_handle text, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.create_friend_request(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'handle', p_handle));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.crear_id(p_user uuid, p_key uuid, p_handle text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.create_friend_request(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'handle', p_handle));
  perform pg_temp.super();
  return (r ->> 'request_id')::uuid;
end $$;
create function pg_temp.rid(p_user uuid, p_key uuid) returns uuid language sql as $$
  select r.id from core.friend_request r where r.requester_user_id = p_user and r.client_command_id = p_key;
$$;
create function pg_temp.accion(p_user uuid, p_fn text, p_id uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  if p_fn = 'aceptar' then r := api.accept_friend_request(jsonb_build_object('request_id', p_id));
  elsif p_fn = 'rechazar' then r := api.decline_friend_request(jsonb_build_object('request_id', p_id));
  elsif p_fn = 'cancelar' then r := api.cancel_friend_request(jsonb_build_object('request_id', p_id));
  elsif p_fn = 'eliminar' then r := api.remove_friend(jsonb_build_object('friendship_id', p_id));
  end if;
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.amistad(p_a uuid, p_b uuid) returns uuid language sql as $$
  select f.id from core.friendship f where f.user_low = least(p_a, p_b) and f.user_high = greatest(p_a, p_b) and f.ended_at is null;
$$;
create function pg_temp.amistades(p_a uuid, p_b uuid) returns text language sql as $$
  select coalesce(string_agg(f.origin || ':' || case when f.ended_at is null then 'activa' else 'fin' end, ';' order by f.origin, (f.ended_at is null) desc), '-')
    from core.friendship f where f.user_low = least(p_a, p_b) and f.user_high = greatest(p_a, p_b);
$$;
create function pg_temp.estado(p_id uuid) returns text language sql as $$
  select sec.friend_request_state(r.accepted_at, r.declined_at, r.cancelled_at, r.expired_at, r.expires_at) || ':' || coalesce(r.resolution, '-') || ':' ||
         case when r.resolved_by is null then '-' when r.resolved_by = r.requester_user_id then 'emisor' else 'destinatario' end
    from core.friend_request r where r.id = p_id;
$$;
create function pg_temp.intentos(p_user uuid) returns integer language sql as $$
  select count(*)::integer from core.username_lookup_attempt a where a.user_id = p_user;
$$;
create function pg_temp.apuntes_enlace(p_user uuid) returns integer language sql as $$
  select count(*)::integer from core.friend_link_attempt a where a.user_id = p_user;
$$;
create function pg_temp.enlace(p_user uuid, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.my_friend_link();
  perform pg_temp.super();
  return (r ->> 'token') || ':' || (r ->> 'version');
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.rotar(p_user uuid) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.rotate_friend_link();
  perform pg_temp.super();
  return (r ->> 'token') || ':' || (r ->> 'version');
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.preview(p_user uuid, p_token text, p_anon boolean default false) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user, p_anon);
  select state || ':' || coalesce(handle, '-') || ':' || coalesce(public_name, '-') || ':' || case when request_id is null then '-' else 'id' end
    into v from api.preview_friend_link(p_token);
  perform pg_temp.super();
  return v;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.responder(p_user uuid, p_token text, p_action text, p_anon boolean default false) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user, p_anon);
  r := api.respond_friend_link(jsonb_build_object('token', p_token, 'action', p_action));
  perform pg_temp.super();
  return (r ->> 'state') || case when (r ->> 'already_processed')::boolean then '/replay' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.vista_amigos(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(coalesce(counterpart_handle, '-') || ':' || coalesce(counterpart_public_name, '-'), ';' order by counterpart_handle), '-') into v from api.my_friends;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.vista_solicitudes(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  select coalesce(string_agg(direction || ':' || coalesce(counterpart_handle, '-'), ';' order by created_at, direction), '-') into v from api.my_friend_requests;
  perform pg_temp.super();
  return v;
end $$;
create function pg_temp.espera(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: se esperaba «%» y se obtuvo «%»', p_label, p_want, p_got;
  end if;
end $$;
grant execute on function pg_temp.k(integer), pg_temp.buscar(uuid, text, boolean), pg_temp.crear(uuid, uuid, text, boolean), pg_temp.crear_id(uuid, uuid, text),
  pg_temp.rid(uuid, uuid), pg_temp.accion(uuid, text, uuid, boolean), pg_temp.amistad(uuid, uuid), pg_temp.amistades(uuid, uuid), pg_temp.estado(uuid),
  pg_temp.intentos(uuid), pg_temp.apuntes_enlace(uuid), pg_temp.enlace(uuid, boolean), pg_temp.rotar(uuid), pg_temp.preview(uuid, text, boolean),
  pg_temp.responder(uuid, text, text, boolean), pg_temp.vista_amigos(uuid), pg_temp.vista_solicitudes(uuid), pg_temp.espera(text, text, text) to authenticated;

-- ═══════════════════════ A · estructura ═══════════════════════════════════════
do $a$
declare
  v_n integer;
  v_t text;
  r record;
begin
  for v_t in select unnest(array['friend_request', 'friendship', 'friend_link', 'friend_link_rotation', 'friend_link_attempt']) loop
    if not (select relrowsecurity from pg_class where oid = ('core.' || v_t)::regclass) then
      raise exception 'A: core.% sin RLS', v_t;
    end if;
    -- NINGUN grant al cliente, ni de columna
    if exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'core' and g.table_name = v_t and g.grantee = 'authenticated')
       or exists (select 1 from information_schema.role_column_grants g where g.table_schema = 'core' and g.table_name = v_t and g.grantee = 'authenticated') then
      raise exception 'A: authenticated tiene algun grant sobre core.%', v_t;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name like 'friend%'
              and column_name in ('handle', 'username', 'public_name', 'display_name', 'email')) then
    raise exception 'A: una relacion de F12.E persiste un handle, un nombre o un correo';
  end if;
  -- el indice de «una pendiente» incluye expired_at (F12/ADR-005 §3)
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'friend_request' and indexname = 'friend_request_pendiente_por_pareja'
                  and indexdef ilike '%unique%' and indexdef ilike '%expired_at is null%' and indexdef ilike '%(pair_low, pair_high)%') then
    raise exception 'A: el indice de una pendiente por pareja no es unico sobre la pareja con expired_at';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'friendship' and indexname = 'friendship_activa_por_pareja'
                  and indexdef ilike '%unique%' and indexdef ilike '%ended_at is null%') then
    raise exception 'A: falta el indice unico de amistad activa por pareja';
  end if;
  raise notice 'OK · A1 · cinco tablas con RLS, cero grants al cliente, sin handle ni nombre, indices parciales con la caducidad persistida';

  for r in select n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'api' and p.proname in ('lookup_friend_candidate', 'create_friend_request', 'accept_friend_request', 'decline_friend_request',
                                                        'cancel_friend_request', 'remove_friend', 'my_friend_link', 'rotate_friend_link', 'preview_friend_link', 'respond_friend_link'))
               or (n.nspname = 'sec' and p.proname in ('friend_request_state', 'lock_friend_pair', 'lock_friend_budget', 'assert_friend_actor',
                                                        'expire_friend_requests', 'friend_relation', 'my_friend_rows', 'my_friend_request_rows')) loop
    if r.owner <> 'nomey_provisioner' then raise exception 'A: % es de %, no del provisioner', r.name, r.owner; end if;
    if r.definer <> (r.name like 'api.%' or r.name in ('sec.my_friend_rows', 'sec.my_friend_request_rows')) then
      raise exception 'A: % definer=% no es lo esperado', r.name, r.definer;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname in ('nomey_writer', 'nomey_provisioner') and rolbypassrls) then
    raise exception 'A: un rol de Nomey tiene BYPASSRLS';
  end if;
  raise notice 'OK · A2 · dieciocho funciones del provisioner, definer solo en api y en los dos lectores reducidos, sin BYPASSRLS';

  foreach v_t in array array['api.lookup_friend_candidate(text)', 'api.create_friend_request(jsonb)', 'api.accept_friend_request(jsonb)', 'api.decline_friend_request(jsonb)',
                             'api.cancel_friend_request(jsonb)', 'api.remove_friend(jsonb)', 'api.my_friend_link()', 'api.rotate_friend_link()',
                             'api.preview_friend_link(text)', 'api.respond_friend_link(jsonb)', 'sec.my_friend_rows()', 'sec.my_friend_request_rows()'] loop
    if not has_function_privilege('authenticated', v_t, 'execute') then raise exception 'A: authenticated no ejecuta %', v_t; end if;
    if has_function_privilege('anon', v_t, 'execute') or has_function_privilege('public', v_t, 'execute') then raise exception 'A: anon o public ejecutan %', v_t; end if;
  end loop;
  foreach v_t in array array['sec.friend_request_state(timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)', 'sec.lock_friend_pair(uuid,uuid)', 'sec.lock_friend_budget(uuid)',
                             'sec.assert_friend_actor(uuid,text)', 'sec.expire_friend_requests(uuid,uuid)', 'sec.friend_relation(uuid,uuid)'] loop
    if has_function_privilege('authenticated', v_t, 'execute') or has_function_privilege('nomey_writer', v_t, 'execute') or not has_function_privilege('nomey_provisioner', v_t, 'execute') then
      raise exception 'A: % no la ejecuta exactamente el provisioner', v_t;
    end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and has_function_privilege('supabase_auth_admin', p.oid, 'execute');
  if v_n <> 1 then raise exception 'A: supabase_auth_admin ejecuta % funciones de sec y debe ser 1', v_n; end if;
  raise notice 'OK · A3 · EXECUTE: cliente solo api y los dos lectores; helpers solo del provisioner; supabase_auth_admin sigue con el hook';

  -- ninguna vista de api lee core.friend* directamente: solo por los definers
  select count(*) into v_n from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class join pg_namespace vn on vn.oid = v.relnamespace
    join pg_class t on t.oid = d.refobjid join pg_namespace tn on tn.oid = t.relnamespace
   where vn.nspname = 'api' and v.relkind = 'v' and tn.nspname = 'core' and t.relname like 'friend%';
  if v_n <> 0 then raise exception 'A: % dependencia(s) de vistas de api sobre core.friend*', v_n; end if;
  -- ninguna funcion economica ni de ambitos consulta la amistad (§9 de ADR-005)
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('sec', 'api') and p.proname not like '%friend%'
     and (p.prosrc ilike '%core.friendship%' or p.prosrc ilike '%core.friend_request%' or p.prosrc ilike '%core.friend_link%');
  if v_n <> 0 then raise exception 'A: % funcion(es) ajenas a amigos leen core.friend*', v_n; end if;
  raise notice 'OK · A4 · ninguna vista de api ni funcion ajena toca core.friend*: la amistad no amplia nada';
end
$a$;

-- ═══════════════════════ B · buscar ═══════════════════════════════════════════
do $b$
declare f record; v text; n0 integer;
begin
  select * into f from fx;
  n0 := pg_temp.intentos(f.ana);
  perform pg_temp.espera('B1 found', pg_temp.buscar(f.ana, '@Bea_FR'), 'none:bea_fr:Bea:-');
  perform pg_temp.espera('B1 apunte', (pg_temp.intentos(f.ana) - n0)::text, '1');
  perform pg_temp.espera('B2 self', pg_temp.buscar(f.ana, 'ana_fr'), 'self:-:-:-');
  perform pg_temp.espera('B2 self no apunta', (pg_temp.intentos(f.ana) - n0)::text, '1');
  perform pg_temp.espera('B3 not_found', pg_temp.buscar(f.ana, 'nadie_fr'), 'not_found:-:-:-');
  perform pg_temp.espera('B3 reservado es nadie', pg_temp.buscar(f.ana, 'inv_fr'), 'not_found:-:-:-');
  perform pg_temp.espera('B3 apuntes', (pg_temp.intentos(f.ana) - n0)::text, '3');
  perform pg_temp.espera('B4 sin handle', pg_temp.buscar(f.dan, 'bea_fr'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('B4 anonimo', pg_temp.buscar(f.inv, 'bea_fr', true), 'NOT_AUTHORIZED');
  -- el freno es el del resolver: con 20 apuntes recientes, throttled sin apuntar
  insert into core.username_lookup_attempt (user_id) select f.cris from generate_series(1, 20);
  perform pg_temp.espera('B5 throttled', pg_temp.buscar(f.cris, 'bea_fr'), 'throttled:-:-:-');
  perform pg_temp.espera('B5 no apunta', pg_temp.intentos(f.cris)::text, '20');
  delete from core.username_lookup_attempt where user_id = f.cris;
  -- resolve_username y esto comparten el freno: una busqueda de amigos = un apunte, no dos
  perform pg_temp.actor(f.ana); perform * from api.resolve_username('bea_fr'); perform pg_temp.super();
  perform pg_temp.espera('B6 compartido', (pg_temp.intentos(f.ana) - n0)::text, '4');
  raise notice 'OK · B · buscar: relacion + identidad publica en una llamada y un apunte; self y throttled no apuntan; anonimo y sin handle rehusados';
end
$b$;

-- ═══════════════════════ C · crear ════════════════════════════════════════════
do $c$
declare f record; v text; r uuid; n0 integer; i integer;
begin
  select * into f from fx;
  n0 := pg_temp.intentos(f.ana);
  perform pg_temp.espera('C1 pending', pg_temp.crear(f.ana, pg_temp.k(1), '@Bea_FR'), 'pending');
  r := pg_temp.rid(f.ana, pg_temp.k(1));
  perform pg_temp.espera('C1 estado', pg_temp.estado(r), 'pending:-:-');
  perform pg_temp.espera('C1 apunte', (pg_temp.intentos(f.ana) - n0)::text, '1');
  perform pg_temp.espera('C2 replay', pg_temp.crear(f.ana, pg_temp.k(1), 'bea_fr'), 'pending/replay');
  perform pg_temp.espera('C2 replay no apunta', (pg_temp.intentos(f.ana) - n0)::text, '1');
  -- otra clave a la misma persona: la pendiente que ya hay, sin escribir
  perform pg_temp.espera('C3 ya pendiente', pg_temp.crear(f.ana, pg_temp.k(2), 'bea_fr'), 'pending/replay');
  perform pg_temp.espera('C3 una fila', (select count(*) from core.friend_request where requester_user_id = f.ana)::text, '1');
  perform pg_temp.espera('C4 a uno mismo', pg_temp.crear(f.ana, pg_temp.k(3), 'ana_fr'), 'PAYLOAD_INVALID');
  perform pg_temp.espera('C4 not_found', pg_temp.crear(f.ana, pg_temp.k(4), 'nadie_fr'), 'not_found');
  perform pg_temp.espera('C4 apunto', (pg_temp.intentos(f.ana) - n0)::text, '3');  -- C3 resolvio tambien
  perform pg_temp.espera('C4 anonimo', pg_temp.crear(f.inv, pg_temp.k(5), 'bea_fr', true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('C4 sin handle', pg_temp.crear(f.dan, pg_temp.k(6), 'bea_fr'), 'USERNAME_REQUIRED');
  begin
    perform pg_temp.actor(f.ana);
    perform api.create_friend_request(jsonb_build_object('client_command_id', pg_temp.k(7), 'command_contract_version', 1, 'handle', 'bea_fr', 'amount', '1'));
    raise exception 'C4: una clave extra no fue PAYLOAD_INVALID';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    perform pg_temp.espera('C4 clave extra', sqlerrm::json ->> 'code', 'PAYLOAD_INVALID');
  end;
  -- las vistas: A la ve outgoing, B incoming, C nada
  perform pg_temp.espera('C5 vista A', pg_temp.vista_solicitudes(f.ana), 'outgoing:bea_fr');
  perform pg_temp.espera('C5 vista B', pg_temp.vista_solicitudes(f.bea), 'incoming:ana_fr');
  perform pg_temp.espera('C5 vista C', pg_temp.vista_solicitudes(f.cris), '-');
  perform pg_temp.espera('C5 buscar', pg_temp.buscar(f.ana, 'bea_fr'), 'outgoing_pending:bea_fr:Bea:id');
  perform pg_temp.espera('C5 buscar inverso', pg_temp.buscar(f.bea, 'ana_fr'), 'incoming_pending:ana_fr:Ana:id');
  -- topes: 30 pendientes salientes (fixture: 29 de Cris a cuentas sembradas a mano)
  for i in 1..29 loop
    insert into core.friend_request (requester_user_id, target_user_id, client_command_id)
    values (f.cris, ('f1f00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, pg_temp.k(100 + i));
  end loop;
  update core.friend_request set created_at = now() - interval '2 hours' where requester_user_id = f.cris;
  perform pg_temp.espera('C6 la 30', pg_temp.crear(f.cris, pg_temp.k(130), 'ana_fr'), 'pending');
  perform pg_temp.espera('C6 la 31', pg_temp.crear(f.cris, pg_temp.k(131), 'bea_fr'), 'FRIEND_REQUEST_LIMIT');
  delete from core.friend_request where requester_user_id = f.cris;
  -- 10 en 60 min: nueve recientes de fixture + la decima real; la undecima 429
  for i in 1..9 loop
    insert into core.friend_request (requester_user_id, target_user_id, client_command_id, cancelled_at, resolved_by, resolution)
    values (f.cris, ('f1f00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, pg_temp.k(200 + i), now(), f.cris, 'cancelled');
  end loop;
  perform pg_temp.espera('C7 la decima', pg_temp.crear(f.cris, pg_temp.k(210), 'ana_fr'), 'pending');
  perform pg_temp.espera('C7 la undecima', pg_temp.crear(f.cris, pg_temp.k(211), 'bea_fr'), 'FRIEND_REQUEST_RATE_LIMITED');
  -- cancelar no devuelve cuota
  perform pg_temp.espera('C7 cancelar', pg_temp.accion(f.cris, 'cancelar', pg_temp.rid(f.cris, pg_temp.k(210))), 'cancelled');
  perform pg_temp.espera('C7 sigue frenado', pg_temp.crear(f.cris, pg_temp.k(212), 'bea_fr'), 'FRIEND_REQUEST_RATE_LIMITED');
  -- lo de hace mas de una hora no cuenta
  update core.friend_request set created_at = now() - interval '61 minutes' where requester_user_id = f.cris;
  perform pg_temp.espera('C7 hora despues', pg_temp.crear(f.cris, pg_temp.k(213), 'bea_fr'), 'pending');
  delete from core.friend_request where requester_user_id = f.cris;
  raise notice 'OK · C · crear: pending, replay, ya pendiente, a uno mismo, not_found con apunte, forma; 30 pendientes y 10/60 min exactos; cancelar no devuelve cuota';
end
$c$;

-- ═══════════════════════ D · cruzadas ═════════════════════════════════════════
do $d$
declare f record; r uuid;
begin
  select * into f from fx;
  r := pg_temp.rid(f.ana, pg_temp.k(1));  -- A→B pendiente (de C)
  perform pg_temp.espera('D1 B envia a A', pg_temp.crear(f.bea, pg_temp.k(20), 'ana_fr'), 'incoming_pending');
  perform pg_temp.espera('D1 una sola pendiente', (select count(*) from core.friend_request where pair_low = least(f.ana, f.bea) and pair_high = greatest(f.ana, f.bea)
                          and accepted_at is null and declined_at is null and cancelled_at is null and expired_at is null)::text, '1');
  perform pg_temp.espera('D1 nada de B', (select count(*) from core.friend_request where requester_user_id = f.bea)::text, '0');
  -- el indice parcial por si acaso: una segunda pendiente fisica es imposible
  begin
    insert into core.friend_request (requester_user_id, target_user_id, client_command_id) values (f.bea, f.ana, pg_temp.k(21));
    raise exception 'D2: entro una segunda pendiente en la pareja';
  exception when unique_violation then null;
  end;
  raise notice 'OK · D · cruzada: la segunda no inserta y recibe incoming_pending; el indice rehusa una segunda pendiente fisica';
end
$d$;

-- ═══════════════════════ E · aceptar, rechazar, cancelar ══════════════════════
do $e$
declare f record; r uuid; fid uuid;
begin
  select * into f from fx;
  r := pg_temp.rid(f.ana, pg_temp.k(1));  -- A→B
  perform pg_temp.espera('E1 tercero acepta', pg_temp.accion(f.cris, 'aceptar', r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 el emisor acepta', pg_temp.accion(f.ana, 'aceptar', r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 tercero rechaza', pg_temp.accion(f.cris, 'rechazar', r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 tercero cancela', pg_temp.accion(f.cris, 'cancelar', r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 el destinatario cancela', pg_temp.accion(f.bea, 'cancelar', r), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 inexistente', pg_temp.accion(f.bea, 'aceptar', pg_temp.k(999)), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 anonimo', pg_temp.accion(f.inv, 'aceptar', r, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('E1 sin handle', pg_temp.accion(f.dan, 'aceptar', r), 'USERNAME_REQUIRED');
  perform pg_temp.espera('E2 B acepta', pg_temp.accion(f.bea, 'aceptar', r), 'accepted');
  perform pg_temp.espera('E2 estado', pg_temp.estado(r), 'accepted:accepted:destinatario');
  fid := pg_temp.amistad(f.ana, f.bea);
  perform pg_temp.espera('E2 amistad', (fid is not null)::text, 'true');
  perform pg_temp.espera('E2 origen', (select origin || ':' || (origin_request_id = r)::text || ':' || (created_by = f.bea)::text from core.friendship where id = fid), 'request:true:true');
  perform pg_temp.espera('E2 replay', pg_temp.accion(f.bea, 'aceptar', r), 'accepted/replay');
  perform pg_temp.espera('E2 una amistad', (select count(*) from core.friendship where user_low = least(f.ana, f.bea) and user_high = greatest(f.ana, f.bea))::text, '1');
  perform pg_temp.espera('E2 rechazar aceptada', pg_temp.accion(f.bea, 'rechazar', r), 'FRIEND_REQUEST_ACCEPTED');
  perform pg_temp.espera('E2 cancelar aceptada', pg_temp.accion(f.ana, 'cancelar', r), 'FRIEND_REQUEST_ACCEPTED');
  perform pg_temp.espera('E2 vistas', pg_temp.vista_amigos(f.ana) || '|' || pg_temp.vista_amigos(f.bea) || '|' || pg_temp.vista_amigos(f.cris), 'bea_fr:Bea|ana_fr:Ana|-');
  perform pg_temp.espera('E2 pendientes fuera', pg_temp.vista_solicitudes(f.ana) || '|' || pg_temp.vista_solicitudes(f.bea), '-|-');
  perform pg_temp.espera('E2 buscar', pg_temp.buscar(f.ana, 'bea_fr'), 'friends:bea_fr:Bea:-');
  perform pg_temp.espera('E2 crear a un amigo', pg_temp.crear(f.ana, pg_temp.k(30), 'bea_fr'), 'friends');
  -- rechazar: C→A, A rechaza
  r := pg_temp.crear_id(f.cris, pg_temp.k(31), 'ana_fr');
  perform pg_temp.espera('E3 A rechaza', pg_temp.accion(f.ana, 'rechazar', r), 'declined');
  perform pg_temp.espera('E3 estado', pg_temp.estado(r), 'declined:declined:destinatario');
  perform pg_temp.espera('E3 replay', pg_temp.accion(f.ana, 'rechazar', r), 'declined/replay');
  perform pg_temp.espera('E3 aceptar rechazada', pg_temp.accion(f.ana, 'aceptar', r), 'FRIEND_REQUEST_DECLINED');
  perform pg_temp.espera('E3 cancelar rechazada', pg_temp.accion(f.cris, 'cancelar', r), 'FRIEND_REQUEST_DECLINED');
  perform pg_temp.espera('E3 sin amistad', (pg_temp.amistad(f.ana, f.cris) is null)::text, 'true');
  -- cancelar: C→B, C cancela
  r := pg_temp.crear_id(f.cris, pg_temp.k(32), 'bea_fr');
  perform pg_temp.espera('E4 C cancela', pg_temp.accion(f.cris, 'cancelar', r), 'cancelled');
  perform pg_temp.espera('E4 estado', pg_temp.estado(r), 'cancelled:cancelled:emisor');
  perform pg_temp.espera('E4 replay', pg_temp.accion(f.cris, 'cancelar', r), 'cancelled/replay');
  perform pg_temp.espera('E4 aceptar cancelada', pg_temp.accion(f.bea, 'aceptar', r), 'FRIEND_REQUEST_CANCELLED');
  perform pg_temp.espera('E4 rechazar cancelada', pg_temp.accion(f.bea, 'rechazar', r), 'FRIEND_REQUEST_CANCELLED');
  raise notice 'OK · E · aceptar/rechazar/cancelar: solo quien puede, una amistad de origen request, idempotencia, codigos cruzados, resolved_by y resolution';
end
$e$;

-- ═══════════════════════ F · caducidad persistida ═════════════════════════════
do $f$
declare f record; r uuid; r2 uuid;
begin
  select * into f from fx;
  r := pg_temp.crear_id(f.cris, pg_temp.k(40), 'bea_fr');  -- C→B
  update core.friend_request set created_at = now() - interval '31 days', expires_at = now() - interval '1 day' where id = r;
  perform pg_temp.espera('F1 vista no la lista', pg_temp.vista_solicitudes(f.bea), '-');
  perform pg_temp.espera('F1 lectura la ve expired', pg_temp.estado(r), 'expired:-:-');
  perform pg_temp.espera('F1 aun sin terminalizar', (select (expired_at is null)::text from core.friend_request where id = r), 'true');
  -- el primer comando que toca la pareja la terminaliza: aceptar → FRIEND_REQUEST_EXPIRED y expired_at puesto
  perform pg_temp.espera('F2 aceptar vencida', pg_temp.accion(f.bea, 'aceptar', r), 'expired/replay');
  perform pg_temp.espera('F2 terminalizada', pg_temp.estado(r) || ':' || (select (expired_at is not null)::text from core.friend_request where id = r), 'expired:expired:-:true');
  -- y una nueva entra en la pareja (el indice parcial ya no la bloquea)
  r2 := pg_temp.crear_id(f.cris, pg_temp.k(41), 'bea_fr');
  perform pg_temp.espera('F3 nueva pendiente', pg_temp.estado(r2), 'pending:-:-');
  perform pg_temp.espera('F3 tres filas (con la cancelada de E4)', (select count(*) from core.friend_request where requester_user_id = f.cris and target_user_id = f.bea)::text, '3');
  -- crear con una vencida sin terminalizar: create la caduca y entra
  update core.friend_request set created_at = now() - interval '2 days', expires_at = now() - interval '1 second' where id = r2;
  perform pg_temp.espera('F4 create caduca la vieja', pg_temp.crear(f.cris, pg_temp.k(42), 'bea_fr'), 'pending');
  perform pg_temp.espera('F4 la vieja expired', pg_temp.estado(r2), 'expired:expired:-');
  perform pg_temp.espera('F4 cancelar vencida', pg_temp.accion(f.cris, 'cancelar', r2), 'expired/replay');
  perform pg_temp.espera('F4 rechazar vencida', pg_temp.accion(f.bea, 'rechazar', r2), 'expired/replay');
  raise notice 'OK · F · caducidad persistida: la vista la oculta ya, el primer comando la terminaliza y una nueva entra';
end
$f$;

-- ═══════════════════════ G · cooldown ═════════════════════════════════════════
do $g$
declare f record; r uuid;
begin
  select * into f from fx;
  -- E3 dejo C→A rechazada por A hace «ahora»: C hacia A esta en cooldown
  perform pg_temp.espera('G1 cooldown', pg_temp.crear(f.cris, pg_temp.k(50), 'ana_fr'), 'cooldown');
  perform pg_temp.espera('G1 buscar', pg_temp.buscar(f.cris, 'ana_fr'), 'cooldown:ana_fr:Ana:-');
  perform pg_temp.espera('G1 nada escrito', (select count(*) from core.friend_request where requester_user_id = f.cris and target_user_id = f.ana)::text, '1');
  -- direccional: A si puede pedir a C (y C la ve incoming)
  r := pg_temp.crear_id(f.ana, pg_temp.k(51), 'cris_fr');
  perform pg_temp.espera('G2 el otro sentido', pg_temp.estado(r), 'pending:-:-');
  perform pg_temp.espera('G2 C la ve', pg_temp.vista_solicitudes(f.cris), 'incoming:ana_fr;outgoing:bea_fr');
  perform pg_temp.accion(f.ana, 'cancelar', r);
  -- a los 7 dias, libre
  update core.friend_request set declined_at = now() - interval '7 days 1 second' where requester_user_id = f.cris and target_user_id = f.ana and declined_at is not null;
  perform pg_temp.espera('G3 tras 7 dias', pg_temp.crear(f.cris, pg_temp.k(52), 'ana_fr'), 'pending');
  perform pg_temp.accion(f.cris, 'cancelar', pg_temp.rid(f.cris, pg_temp.k(52)));
  -- NO tras cancelled: C cancela y vuelve a enviar al instante
  perform pg_temp.espera('G4 tras cancelar', pg_temp.crear(f.cris, pg_temp.k(53), 'ana_fr'), 'pending');
  perform pg_temp.accion(f.cris, 'cancelar', pg_temp.rid(f.cris, pg_temp.k(53)));
  -- NO tras expired (F dejo dos caducadas C→B): C envia a B al instante... la de k42 sigue pendiente; cancelarla primero
  perform pg_temp.accion(f.cris, 'cancelar', pg_temp.rid(f.cris, pg_temp.k(42)));
  perform pg_temp.espera('G5 tras caducar y cancelar', pg_temp.crear(f.cris, pg_temp.k(54), 'bea_fr'), 'pending');
  perform pg_temp.accion(f.cris, 'cancelar', pg_temp.rid(f.cris, pg_temp.k(54)));
  raise notice 'OK · G · cooldown de 7 dias solo tras declined y solo de ese emisor hacia ese destinatario; nunca tras cancelled ni expired';
end
$g$;

-- ═══════════════════════ H · eliminar ═════════════════════════════════════════
do $h$
declare f record; fid uuid; r uuid; ops0 bigint; ops1 bigint;
begin
  select * into f from fx;
  fid := pg_temp.amistad(f.ana, f.bea);
  ops0 := (select count(*) from core.operation) + (select count(*) from core.scope) + (select count(*) from core.membership) + (select count(*) from core.effect);
  perform pg_temp.espera('H1 tercero elimina', pg_temp.accion(f.cris, 'eliminar', fid), 'NOT_AUTHORIZED');
  perform pg_temp.espera('H1 inexistente', pg_temp.accion(f.ana, 'eliminar', pg_temp.k(998)), 'NOT_AUTHORIZED');
  perform pg_temp.espera('H2 B elimina', pg_temp.accion(f.bea, 'eliminar', fid), 'ended');
  perform pg_temp.espera('H2 fin', (select (ended_at is not null and ended_by = f.bea)::text from core.friendship where id = fid), 'true');
  perform pg_temp.espera('H2 replay', pg_temp.accion(f.bea, 'eliminar', fid), 'ended/replay');
  perform pg_temp.espera('H2 A tambien replay', pg_temp.accion(f.ana, 'eliminar', fid), 'ended/replay');
  perform pg_temp.espera('H2 vistas', pg_temp.vista_amigos(f.ana) || '|' || pg_temp.vista_amigos(f.bea), '-|-');
  perform pg_temp.espera('H2 buscar', pg_temp.buscar(f.ana, 'bea_fr'), 'none:bea_fr:Bea:-');
  perform pg_temp.espera('H2 la solicitud original sigue', pg_temp.estado(pg_temp.rid(f.ana, pg_temp.k(1))), 'accepted:accepted:destinatario');
  ops1 := (select count(*) from core.operation) + (select count(*) from core.scope) + (select count(*) from core.membership) + (select count(*) from core.effect);
  perform pg_temp.espera('H2 nada economico', ops1::text, ops0::text);
  -- volver a anadirse: sin cooldown (fue remove, no decline), otra instancia
  r := pg_temp.crear_id(f.bea, pg_temp.k(60), 'ana_fr');
  perform pg_temp.espera('H3 A acepta', pg_temp.accion(f.ana, 'aceptar', r), 'accepted');
  perform pg_temp.espera('H3 dos instancias', pg_temp.amistades(f.ana, f.bea), 'request:activa;request:fin');
  perform pg_temp.espera('H3 vistas', pg_temp.vista_amigos(f.ana) || '|' || pg_temp.vista_amigos(f.bea), 'bea_fr:Bea|ana_fr:Ana');
  raise notice 'OK · H · eliminar: cualquiera de los dos, ended_at/ended_by, idempotente, tercero rehusado, nada economico, y una instancia nueva al volver';
end
$h$;

-- ═══════════════════════ I · el enlace ════════════════════════════════════════
do $i$
declare f record; t1 text; t2 text; v text; i integer;
begin
  select * into f from fx;
  perform pg_temp.espera('I1 anonimo', pg_temp.enlace(f.inv, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('I1 sin handle', pg_temp.enlace(f.dan), 'USERNAME_REQUIRED');
  v := pg_temp.enlace(f.ana);
  t1 := split_part(v, ':', 1);
  perform pg_temp.espera('I1 version 1', split_part(v, ':', 2), '1');
  perform pg_temp.espera('I1 43 chars base64url', (t1 ~ '^[A-Za-z0-9_-]{43}$')::text, 'true');
  perform pg_temp.espera('I1 estable', pg_temp.enlace(f.ana), t1 || ':1');
  perform pg_temp.espera('I1 no contiene handle ni uid', (position('ana_fr' in t1) = 0 and position(replace(f.ana::text, '-', '') in t1) = 0)::text, 'true');
  perform pg_temp.espera('I1 sin rotacion', (select count(*) from core.friend_link_rotation where user_id = f.ana)::text, '0');
  -- preview por otros
  perform pg_temp.espera('I2 B ve a A', pg_temp.preview(f.bea, t1), 'friends:ana_fr:Ana:-');
  perform pg_temp.espera('I2 C ve a A', pg_temp.preview(f.cris, t1), 'ok:ana_fr:Ana:-');
  perform pg_temp.espera('I2 A el propio', pg_temp.preview(f.ana, t1), 'own:-:-:-');
  perform pg_temp.espera('I2 anonimo', pg_temp.preview(f.inv, t1, true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('I2 sin handle', pg_temp.preview(f.dan, t1), 'USERNAME_REQUIRED');
  perform pg_temp.espera('I2 sin apuntes', pg_temp.apuntes_enlace(f.cris)::text, '0');
  perform pg_temp.espera('I2 invalido', pg_temp.preview(f.cris, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 'invalid:-:-:-');
  perform pg_temp.espera('I2 apunto', pg_temp.apuntes_enlace(f.cris)::text, '1');
  insert into core.friend_link_attempt (user_id) select f.cris from generate_series(1, 19);
  perform pg_temp.espera('I2 throttled', pg_temp.preview(f.cris, t1), 'throttled:-:-:-');
  perform pg_temp.espera('I2 throttled no apunta', pg_temp.apuntes_enlace(f.cris)::text, '20');
  delete from core.friend_link_attempt where user_id = f.cris;
  -- rotar: nuevo token, version 2, el viejo invalid
  v := pg_temp.rotar(f.ana);
  t2 := split_part(v, ':', 1);
  perform pg_temp.espera('I3 version 2', split_part(v, ':', 2), '2');
  perform pg_temp.espera('I3 distinto', (t2 <> t1)::text, 'true');
  perform pg_temp.espera('I3 el nuevo es el propio', pg_temp.enlace(f.ana), t2 || ':2');
  perform pg_temp.espera('I3 el viejo invalid', pg_temp.preview(f.cris, t1), 'invalid:-:-:-');
  perform pg_temp.espera('I3 el nuevo ok', pg_temp.preview(f.cris, t2), 'ok:ana_fr:Ana:-');
  perform pg_temp.espera('I3 una rotacion', (select count(*) from core.friend_link_rotation where user_id = f.ana)::text, '1');
  -- 5 en 24 h: quedan 4; la sexta 429; ayer no cuenta
  for i in 1..4 loop v := pg_temp.rotar(f.ana); end loop;
  perform pg_temp.espera('I4 la sexta', pg_temp.rotar(f.ana), 'FRIEND_LINK_ROTATION_LIMITED');
  perform pg_temp.espera('I4 version 6', split_part(pg_temp.enlace(f.ana), ':', 2), '6');
  update core.friend_link_rotation set rotated_at = now() - interval '25 hours' where user_id = f.ana and version = 2;
  perform pg_temp.espera('I4 ayer no cuenta', split_part(pg_temp.rotar(f.ana), ':', 2), '7');
  -- el handle cambia y el enlace no
  update core.account_handle set handle = 'ana_nueva' where user_id = f.ana and claimed_at is not null and released_at is null;
  perform pg_temp.espera('I5 handle nuevo, mismo token', pg_temp.preview(f.cris, split_part(pg_temp.enlace(f.ana), ':', 1)), 'ok:ana_nueva:Ana:-');
  update core.account_handle set handle = 'ana_fr' where user_id = f.ana and claimed_at is not null and released_at is null;
  raise notice 'OK · I · el enlace: nace estable y opaco, preview solo para elegibles, invalid apunta y frena, rotar invalida el viejo (5/24 h), el handle no lo toca';
end
$i$;

-- ═══════════════════════ J · responder al enlace ══════════════════════════════
do $j$
declare f record; ta text; tc text; r uuid; fid uuid; n0 integer;
begin
  select * into f from fx;
  ta := split_part(pg_temp.enlace(f.ana), ':', 1);
  tc := split_part(pg_temp.enlace(f.cris), ':', 1);
  begin
    perform pg_temp.actor(f.cris);
    perform api.respond_friend_link(jsonb_build_object('token', ta, 'action', 'maybe'));
    raise exception 'J1: action desconocida no fue PAYLOAD_INVALID';
  exception when sqlstate 'PGRST' then
    perform pg_temp.super();
    perform pg_temp.espera('J1 action', sqlerrm::json ->> 'code', 'PAYLOAD_INVALID');
  end;
  perform pg_temp.espera('J1 anonimo', pg_temp.responder(f.inv, ta, 'accept', true), 'NOT_AUTHORIZED');
  perform pg_temp.espera('J1 sin handle', pg_temp.responder(f.dan, ta, 'accept'), 'USERNAME_REQUIRED');
  perform pg_temp.espera('J1 own', pg_temp.responder(f.ana, ta, 'accept'), 'own');
  perform pg_temp.espera('J1 invalid', pg_temp.responder(f.cris, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'accept'), 'invalid');
  perform pg_temp.espera('J1 apunto', pg_temp.apuntes_enlace(f.cris)::text, '2');  -- I3 dejo uno
  -- sin relacion: decline no persiste nada; accept crea amistad de origen link
  n0 := (select count(*) from core.friend_request where pair_low = least(f.ana, f.cris) and pair_high = greatest(f.ana, f.cris) and resolution is null);
  perform pg_temp.espera('J2 decline sin nada', pg_temp.responder(f.cris, ta, 'decline'), 'dismissed');
  perform pg_temp.espera('J2 nada escrito', (select count(*) from core.friend_request where pair_low = least(f.ana, f.cris) and pair_high = greatest(f.ana, f.cris) and resolution is null)::text, n0::text);
  perform pg_temp.espera('J2 accept', pg_temp.responder(f.cris, ta, 'accept'), 'friends');
  fid := pg_temp.amistad(f.ana, f.cris);
  perform pg_temp.espera('J2 origen link', (select origin || ':' || (origin_request_id is null)::text || ':' || (created_by = f.cris)::text from core.friendship where id = fid), 'link:true:true');
  perform pg_temp.espera('J2 otra vez', pg_temp.responder(f.cris, ta, 'accept'), 'friends/replay');
  perform pg_temp.espera('J2 preview friends', pg_temp.preview(f.cris, ta), 'friends:ana_fr:Ana:-');
  perform pg_temp.espera('J2 una amistad', (select count(*) from core.friendship where user_low = least(f.ana, f.cris) and user_high = greatest(f.ana, f.cris) and ended_at is null)::text, '1');
  perform pg_temp.accion(f.cris, 'eliminar', fid);
  -- con solicitud del dueno hacia mi (A→C pendiente): accept la acepta, origen request
  r := pg_temp.crear_id(f.ana, pg_temp.k(70), 'cris_fr');
  perform pg_temp.espera('J3 preview incoming', pg_temp.preview(f.cris, ta), 'incoming_pending:ana_fr:Ana:id');
  perform pg_temp.espera('J3 accept', pg_temp.responder(f.cris, ta, 'accept'), 'friends');
  perform pg_temp.espera('J3 la solicitud accepted', pg_temp.estado(r), 'accepted:accepted:destinatario');
  fid := pg_temp.amistad(f.ana, f.cris);
  perform pg_temp.espera('J3 origen request', (select origin || ':' || (origin_request_id = r)::text from core.friendship where id = fid), 'request:true');
  perform pg_temp.accion(f.cris, 'eliminar', fid);
  -- con solicitud del dueno hacia mi: decline la rechaza
  r := pg_temp.crear_id(f.ana, pg_temp.k(71), 'cris_fr');
  perform pg_temp.espera('J4 decline', pg_temp.responder(f.cris, ta, 'decline'), 'declined');
  perform pg_temp.espera('J4 la solicitud declined', pg_temp.estado(r), 'declined:declined:destinatario');
  perform pg_temp.espera('J4 sin amistad', (pg_temp.amistad(f.ana, f.cris) is null)::text, 'true');
  -- reciproca: C ya pidio a A (C→A pendiente) y C abre el enlace de A → accepted_via_link, origen link
  update core.friend_request set declined_at = now() - interval '8 days' where id = r;  -- que A no este en cooldown hacia C no importa; C hacia A si: limpiar
  update core.friend_request set declined_at = now() - interval '8 days' where requester_user_id = f.cris and target_user_id = f.ana and declined_at is not null;
  r := pg_temp.crear_id(f.cris, pg_temp.k(72), 'ana_fr');
  perform pg_temp.espera('J5 preview mutual', pg_temp.preview(f.cris, ta), 'mutual_pending:ana_fr:Ana:id');
  perform pg_temp.espera('J5 accept', pg_temp.responder(f.cris, ta, 'accept'), 'friends');
  perform pg_temp.espera('J5 accepted_via_link', pg_temp.estado(r), 'accepted:accepted_via_link:emisor');
  fid := pg_temp.amistad(f.ana, f.cris);
  perform pg_temp.espera('J5 origen link con solicitud', (select origin || ':' || (origin_request_id = r)::text || ':' || (created_by = f.cris)::text from core.friendship where id = fid), 'link:true:true');
  perform pg_temp.espera('J5 vistas', pg_temp.vista_amigos(f.ana) || '|' || pg_temp.vista_solicitudes(f.ana), 'bea_fr:Bea;cris_fr:Cris|-');
  perform pg_temp.accion(f.cris, 'eliminar', fid);
  -- cooldown no impide aceptar el enlace: A rechazo a C hace nada; C abre el enlace de A y acepta
  r := pg_temp.crear_id(f.cris, pg_temp.k(73), 'ana_fr');
  perform pg_temp.accion(f.ana, 'rechazar', r);
  perform pg_temp.espera('J6 cooldown en create', pg_temp.crear(f.cris, pg_temp.k(74), 'ana_fr'), 'cooldown');
  perform pg_temp.espera('J6 el enlace si', pg_temp.responder(f.cris, ta, 'accept'), 'friends');
  perform pg_temp.accion(f.cris, 'eliminar', pg_temp.amistad(f.ana, f.cris));
  -- el enlace de C, abierto por A: simetrico
  perform pg_temp.espera('J7 A abre el de C', pg_temp.responder(f.ana, tc, 'accept'), 'friends');
  perform pg_temp.espera('J7 amistades A-C', pg_temp.amistades(f.ana, f.cris), 'link:activa;link:fin;link:fin;link:fin;request:fin');
  raise notice 'OK · J · responder: accept crea amistad (origen link, request si la habia del dueno, accepted_via_link si era mia), decline rechaza o no escribe, own/invalid/replay';
end
$j$;

-- ═══════════════════════ K · vistas y el handle nuevo ═════════════════════════
do $k$
declare f record;
begin
  select * into f from fx;
  -- A es amigo de B (H3) y de C (J7); B y C no; nadie ve uid
  perform pg_temp.espera('K1 A', pg_temp.vista_amigos(f.ana), 'bea_fr:Bea;cris_fr:Cris');
  perform pg_temp.espera('K1 B', pg_temp.vista_amigos(f.bea), 'ana_fr:Ana');
  perform pg_temp.espera('K1 C', pg_temp.vista_amigos(f.cris), 'ana_fr:Ana');
  perform pg_temp.espera('K1 D nada', pg_temp.vista_amigos(f.dan), '-');
  perform pg_temp.espera('K2 columnas amigos', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'my_friends'),
                         'friendship_id,counterpart_handle,counterpart_public_name,since');
  perform pg_temp.espera('K2 columnas solicitudes', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'my_friend_requests'),
                         'request_id,direction,counterpart_handle,counterpart_public_name,created_at,expires_at');
  -- el handle nuevo aparece; la amistad sigue
  update core.account_handle set handle = 'bea_nueva' where user_id = f.bea and claimed_at is not null and released_at is null;
  perform pg_temp.espera('K3 handle nuevo', pg_temp.vista_amigos(f.ana), 'bea_nueva:Bea;cris_fr:Cris');
  update core.account_handle set handle = 'bea_fr' where user_id = f.bea and claimed_at is not null and released_at is null;
  raise notice 'OK · K · vistas: solo del actor, columnas exactas sin uid, el handle nuevo tras cambiarlo';
end
$k$;

-- ═══════════════════════ L · nada financiero, y el cliente no alcanza core ════
do $l$
declare f record; v_n integer;
begin
  select * into f from fx;
  -- A y B son amigos: A sigue sin ver el Personal de B
  perform pg_temp.actor(f.ana);
  select count(*) into v_n from api.personal_balance where scope_id = f.pb;
  perform pg_temp.espera('L1 Personal ajeno', v_n::text, '0');
  select count(*) into v_n from api.personal_balance;
  perform pg_temp.super();
  perform pg_temp.espera('L1 solo el propio', v_n::text, '1');
  perform pg_temp.actor(f.ana);
  begin
    perform count(*) from core.friendship;
    raise exception 'L2: authenticated lee core.friendship directamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from core.friend_request;
    raise exception 'L2: authenticated lee core.friend_request directamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from core.friend_link;
    raise exception 'L2: authenticated lee core.friend_link directamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sec.friend_relation(f.ana, f.bea);
    raise exception 'L2: authenticated ejecuta sec.friend_relation';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.super();
  raise notice 'OK · L · ser amigo no abre ningun ambito; el cliente no alcanza core.friend* ni la relacion';
end
$l$;

rollback;
