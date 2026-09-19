-- ============================================================================
-- EL USERNAME SE RESERVA EN EL ALTA: hook before_user_created de GoTrue.
-- F12/ADR-001 §5 (F12.A2). Precisa F03/ADR-003: supabase_auth_admin ejecuta
-- EXACTAMENTE UNA funcion de sec, y no tiene nada mas.
-- ============================================================================
--
-- GoTrue llama a sec.before_user_created(event) DENTRO de la transaccion que
-- crea el usuario, como supabase_auth_admin, sin JWT. El evento medido contra
-- gotrue v2.195.0 (2026-09-19) tiene esta forma:
--
--   { "user": { "id": "<uuid>", "email": "...", "is_anonymous": false,
--               "app_metadata": { "provider": "email", "providers": ["email"] },
--               "user_metadata": { "display_name": "...", "requested_username": "..." },
--               "aud": "authenticated", "role": "", "identities": [], ... },
--     "metadata": { "name": "before-user-created", "time": "...", "uuid": "...", "ip_address": "..." } }
--
--   anonimo:  "is_anonymous": true, "email": "", "app_metadata": {}
--
-- Que hace:
--   · alta anonima (Invitado)            → nada; la conversion reserva despues
--                                          por api.reserve_username (A1 §8)
--   · alta que no es email/password      → nada; F12.A3 la lleva al gate
--   · alta email/password                → exige requested_username y
--                                          display_name, normaliza y valida
--                                          (A1), crea core.account_identity con
--                                          el nombre, RESERVA el handle 7 dias
--                                          (claimed_at nulo: reclamar es del
--                                          primer ciclo autenticado, A3) y lo
--                                          apunta en el diario
--
-- Rehusar es DEVOLVER {"error": {"http_code": N, "message": "CODIGO"}}, no
-- lanzar: una excepcion sin capturar la convierte GoTrue en un 500 opaco.
-- Con el error devuelto GoTrue aborta su transaccion: la cuenta no nace y no
-- queda ninguna fila nuestra. Codigos: USERNAME_REQUIRED · 400,
-- USERNAME_INVALID · 400, USERNAME_RESERVED · 422, USERNAME_TAKEN · 409, y
-- PAYLOAD_INVALID · 400 si falta el nombre.
--
-- El actor: no hay JWT. El uid AUTORITATIVO es event.user.id, y la funcion lo
-- fija en request.jwt.claims con set_config(..., true) —local a la
-- transaccion de GoTrue, se revierte solo— para que las politicas de A1
-- (user_id = sec.request_actor_id()) se cumplan tal cual, sin abrir ninguna
-- politica nueva. Propietaria: nomey_provisioner, definer, sin BYPASSRLS: las
-- mismas politicas que api.reserve_username, medido.

create function sec.before_user_created(event jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user     jsonb := event -> 'user';
  v_uid      uuid;
  v_anon     boolean;
  v_provider text;
  v_raw      text;
  v_handle   text;
  v_name     text;
  v_detail   text;
begin
  -- Sin usuario o sin id no hay nada que reservar ni que rehusar: GoTrue
  -- decide. Un evento asi no es una alta email/password de esta app.
  if v_user is null or jsonb_typeof(v_user) <> 'object' or (v_user ->> 'id') is null then
    return '{}'::jsonb;
  end if;
  v_uid      := (v_user ->> 'id')::uuid;
  v_anon     := coalesce((v_user ->> 'is_anonymous')::boolean, false);
  v_provider := v_user -> 'app_metadata' ->> 'provider';

  if v_anon or v_provider is distinct from 'email' then
    return '{}'::jsonb;
  end if;

  v_raw := v_user -> 'user_metadata' ->> 'requested_username';
  if v_raw is null or btrim(v_raw) = '' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'USERNAME_REQUIRED'));
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);

  begin
    v_handle := sec.assert_handle_valid(v_raw);
    v_name   := sec.canonical_display_name(coalesce(v_user -> 'user_metadata' ->> 'display_name', ''));

    insert into core.account_identity (user_id, public_name) values (v_uid, v_name);
    perform sec.evict_expired_handle(v_handle);
    insert into core.account_handle (handle, user_id, reserved_until) values (v_handle, v_uid, now() + interval '7 days');
    insert into core.account_handle_event (handle, user_id, event, actor_user_id) values (v_handle, v_uid, 'reserved', v_uid);
  exception
    when unique_violation then
      return jsonb_build_object('error', jsonb_build_object('http_code', 409, 'message', 'USERNAME_TAKEN'));
    when sqlstate 'PGRST' then
      -- raise_boundary: {"code","message"} en el mensaje, {"status"} en el detalle
      get stacked diagnostics v_detail = pg_exception_detail;
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', coalesce((v_detail::json ->> 'status')::integer, 400),
        'message',   coalesce(sqlerrm::json ->> 'code', 'PAYLOAD_INVALID')));
  end;

  return '{}'::jsonb;
end
$fn$;
comment on function sec.before_user_created(jsonb) is
  'F12/ADR-001 §5: hook before_user_created de GoTrue. En un alta email/password exige requested_username, crea la identidad publica y reserva el handle 7 dias en la misma transaccion; anonimo y otros proveedores pasan sin tocar nada. Devuelve {"error":{"http_code","message"}} para rehusar. La unica funcion que ejecuta supabase_auth_admin.';

-- Propietaria: el provisioner (patron de A1), no postgres.
grant create on schema sec to nomey_provisioner;
alter function sec.before_user_created(jsonb) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;

-- LO UNICO que supabase_auth_admin recibe: USAGE en sec y EXECUTE en esta
-- funcion. Ni api, ni core, ni otra funcion de sec (username.sql lo guarda:
-- exactamente una). anon y authenticated no la ejecutan: la llama GoTrue.
revoke execute on function sec.before_user_created(jsonb) from public;
grant usage on schema sec to supabase_auth_admin;
grant execute on function sec.before_user_created(jsonb) to supabase_auth_admin;
