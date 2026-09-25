-- ============================================================================
-- EL ALTA YA NO EXIGE USERNAME: el hook lo deja pasar · F12/ADR-008
-- ============================================================================
--
-- Supersede el paso 4 de F12/ADR-001 §5 y NADA MAS. Lo que cambia es una sola
-- rama de `sec.before_user_created`:
--
--   antes:  alta email/password sin `requested_username` → USERNAME_REQUIRED
--           y GoTrue aborta su transaccion: la cuenta NO nace.
--   ahora:  alta email/password sin `requested_username` → `{}`.
--           La cuenta nace sin identidad publica y el gate la pide despues de
--           confirmar el correo (F12/ADR-001 §7, que no cambia).
--
-- Todo lo demas del hook se conserva palabra por palabra: con
-- `requested_username` presente valida, normaliza, crea `core.account_identity`
-- con el nombre y reserva el handle 7 dias, con los mismos codigos de rechazo
-- (USERNAME_INVALID, USERNAME_RESERVED, USERNAME_TAKEN, PAYLOAD_INVALID).
--
-- Esa rama se conserva aunque hoy ningun formulario de Nomey la ejerza: el
-- invitado reserva por `api.reserve_username` ANTES de `updateUser` (§8) y no
-- pasa por el hook. Retirarla convertiria un alta con username en una cuenta
-- sin el, en silencio, y eso no lo ha pedido nadie.
--
-- ─────────────────────────── QUE NO SE TOCA ───────────────────────────
--
-- Ni una tabla, ni una policy, ni un grant. `reserve_username`,
-- `claim_username`, `change_username` y `set_public_name` quedan exactamente
-- como estaban: el gate ya crea la identidad publica cuando no existe, que es
-- justo el camino que este cambio convierte en el normal.
--
-- La propiedad y los privilegios tampoco se repiten aqui: `create or replace`
-- conserva el owner (`nomey_provisioner`) y los grants existentes
-- (`supabase_auth_admin` con USAGE en `sec` y EXECUTE en esta funcion, y nadie
-- mas). Volver a concederlos seria ruido; `username.sql` sigue guardando que
-- `supabase_auth_admin` ejecuta EXACTAMENTE una funcion de `sec`.
--
-- ───────────────────── EL INVARIANTE QUE SUSTITUYE ─────────────────────
--
-- Deja de ser cierto que «ninguna cuenta se CREA sin username». Pasa a ser
-- «ninguna cuenta ENTRA en la aplicacion sin nombre y username», y quien lo
-- hace cumplir es el cliente: `needsUsernameGate` monta el gate EN LUGAR de
-- las pestañas y `canEnterApp` se lo niega mientras el servidor responda
-- `USERNAME_REQUIRED` a `claim_username`.
--
-- Una cuenta con el correo confirmado y sin `core.account_identity` es, por
-- tanto, un estado VALIDO y transitorio. No puede escribir nada: cada comando
-- de F12 que necesita identidad publica —amistades, propuestas de
-- transferencia— ya exige un handle definitivo y responde `USERNAME_REQUIRED`
-- por su cuenta, y las pantallas que los usan no se montan. Este cambio no
-- relaja ninguna de esas comprobaciones.
--
-- ──────────────────────── LA RESERVA DE 7 DIAS ────────────────────────
--
-- Para un alta por correo ya no hay nada que reservar: el username se elige
-- despues. La reserva provisional de §6 sigue existiendo y sigue siendo la del
-- invitado (`api.reserve_username`, §8) y la de cualquier alta que traiga
-- username. Consecuencia: entre el alta y el gate nadie retiene ningun handle,
-- porque nadie ha elegido ninguno todavia.

create or replace function sec.before_user_created(event jsonb)
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

  -- ═══════════════ LO UNICO QUE CAMBIA (F12/ADR-008) ═══════════════
  --
  -- Sin username el alta PASA. No se crea identidad, no se reserva handle y
  -- no se escribe ninguna fila: el paso 1 del alta es correo y contraseña, y
  -- el nombre y el username los pide el gate cuando la cuenta vuelve con el
  -- correo confirmado.
  --
  -- Se devuelve `{}` y no un error, que es lo que hace que GoTrue siga: cree
  -- la cuenta y envie el correo de confirmacion.
  if v_raw is null or btrim(v_raw) = '' then
    return '{}'::jsonb;
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
  'F12/ADR-008 (supersede el paso 4 de F12/ADR-001 §5): hook before_user_created de GoTrue. Un alta email/password SIN requested_username pasa sin escribir nada y el gate pide nombre y username tras confirmar el correo; CON requested_username conserva el contrato de A2 (valida, crea la identidad publica y reserva el handle 7 dias). Anonimo y otros proveedores pasan sin tocar nada. Devuelve {"error":{"http_code","message"}} para rehusar. La unica funcion que ejecuta supabase_auth_admin.';
