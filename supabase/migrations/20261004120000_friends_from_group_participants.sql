-- ============================================================================
-- AMIGOS DESDE UN PARTICIPANTE DE GRUPO (F12/ADR-005, F12.E.D)
-- ============================================================================
--
-- El problema de producto: para hacerte amigo de alguien con quien YA
-- compartes un grupo habia que salir del grupo, ir a Perfil → Amigos y
-- escribir su @username de memoria. Dentro del grupo la persona ya esta
-- delante, con su nombre visible; lo unico que faltaba era poder pedirselo
-- ahi.
--
-- Lo que esta migracion crea, y por que en este orden:
--
--   sec.friend_request_replay        el replay por clave de comando, que las
--                                    DOS entradas comparten
--   sec.create_friend_request_core   EL NUCLEO AUTORITATIVO: cerrojo de
--                                    pareja, caducidad, relacion, cruzadas,
--                                    topes por emisor e insert. Una sola
--                                    semantica para las dos entradas
--   api.create_friend_request        RECREADA para llamar al nucleo. Mismo
--                                    contrato publico, misma firma, mismos
--                                    estados, mismos codigos: lo unico que
--                                    cambia es de donde sale ese tramo
--
--   sec.participant_account          participante → cuenta vinculada, SOLO
--                                    para un miembro del grupo y solo dentro
--                                    de sec. Definer del writer, como
--                                    sec.has_personal_scope
--   sec.participant_friendable       esa cuenta es apta para amistad
--   api.group_friend_status          el estado social de TODOS los
--                                    participantes de un grupo, en UNA
--                                    llamada
--   api.create_friend_request_to_participant
--                                    crear por participant_id, con origin
--                                    'group' y el MISMO nucleo
--
-- NINGUN codigo de error nuevo. NINGUNA relacion nueva. NINGUNA columna
-- nueva. `core.friend_request.origin` ya admitia 'group' desde F12.E.A por su
-- CHECK: esta migracion es la primera que lo escribe.
--
-- LO QUE NO SE TOCA, y es la mitad del trabajo:
--
--   * `api.group_participant` NO publica ni un dato nuevo. Ni uid, ni email,
--     ni @handle, ni el nombre publico de la cuenta. El nombre que se ve
--     sigue siendo `participant.display_name`, que es del grupo. Hay un guard
--     de catalogo en supabase/checks/group-friends.sql que lo fija.
--   * `sec.is_member` NO se amplia. La amistad no da acceso a ningun ambito,
--     y el ambito no da acceso a ninguna amistad: son dos preguntas distintas
--     que se hacen por separado.
--   * NINGUNA policy se relaja. `core.participant_user_link` sigue con su
--     unica policy de lectura del provisioner —`user_id = actor`, solo la
--     propia— y lo que resuelve el participante ajeno es un definer del
--     WRITER, que ya tenia `select ... using (true)` sobre esa tabla desde
--     20260825152805 para derivar el ambito de caja del pagador.
--
-- ─── POR QUE UN NUCLEO COMPARTIDO Y NO UNA SEGUNDA FUNCION ──────────────────
--
-- Copiar el cuerpo de api.create_friend_request habria dado dos caminos con
-- el mismo cerrojo, los mismos topes y la misma semantica de cruzadas
-- ESCRITOS DOS VECES. El dia que uno de los dos cambie —el tope, el TTL, el
-- cooldown— el otro se queda atras y nadie se entera: las dos entradas
-- escriben en la misma tabla, asi que la divergencia no falla, solo produce
-- dos reglas distintas segun por donde entres. El nucleo es la respuesta: las
-- dos entradas resuelven el destinatario a su manera —una por @handle, otra
-- por participante— y a partir de ahi ejecutan exactamente lo mismo.
--
-- ─── LO QUE CADA ENTRADA HACE POR SU CUENTA, y no es arbitrario ─────────────
--
--   por @handle          por participante
--   ───────────────────  ────────────────────────────────────────────────────
--   freno del resolver   NO. No se resuelve ningun username: el cliente manda
--   (20 / 10 min) +      un participant_id que ya tiene de la pantalla del
--   UN apunte            grupo, y el servidor lo traduce sin publicar nada.
--                        Frenar aqui cobraria cuota de busqueda por algo que
--                        no es una busqueda.
--   not_found como       NOT_AUTHORIZED. Un handle inexistente es un estado
--   ESTADO (200)         porque el que pide no ha hecho nada malo; un
--                        participante que no es de un grupo suyo es un
--                        intento de usar un id ajeno, y un comando que no
--                        puede cumplirse no se contesta con un 200 silencioso
--   origin 'username'    origin 'group'
--
-- ─── SEGURIDAD: participante → cuenta ───────────────────────────────────────
--
-- `sec.participant_account` es el UNICO sitio donde un participant_id se
-- convierte en una cuenta, y no sale nunca de `sec`:
--
--   * `authenticated` NO tiene USAGE sobre el esquema `sec`, y ademas hay
--     revoke explicito y grant solo a `nomey_provisioner`.
--   * exige que el actor sea miembro ACTUAL del ambito de ese participante,
--     leido de `core.membership` con `sec.request_actor_id()`. Un tercero que
--     adivine un participant_id de otro grupo obtiene NULL.
--   * NULL es indistinguible entre «no eres miembro», «ese participante no
--     existe», «no es de un grupo» y «no tiene cuenta». Quien pregunta no
--     puede separar los cuatro.
--   * el uid que devuelve NO sale de la base: `api.group_friend_status` lo
--     usa para resolver la relacion y publica una palabra;
--     `api.create_friend_request_to_participant` lo usa para insertar. Ni una
--     ni otra lo devuelven.
--
-- Y la amistad sigue sin ampliar nada: que dos cuentas sean amigas no hace
-- que ninguna vea el Personal, los grupos, los ambitos ni las operaciones de
-- la otra. Ninguna funcion economica consulta `core.friendship`.
--
-- ─── QUIEN SALIO DEL GRUPO ──────────────────────────────────────────────────
--
-- Un participante que salio conserva su vinculo como HISTORICO (F10/ADR-003:
-- `ended_at` no nulo, la fila nunca se borra), y `sec.participant_account` lo
-- resuelve igual. Es deliberado: la amistad es entre CUENTAS, no entre
-- miembros de un grupo, y haber compartido gastos con alguien no deja de ser
-- cierto porque se haya ido. Lo que NO hace esta migracion es volver visible
-- a nadie: quien pregunta es la pantalla del grupo, y el grupo ya decide a
-- quien publica (`api.group_participant` conserva la fila con `is_departed`;
-- `api.group_balance` no la lista). Si un dia dejara de publicarla, esto
-- dejaria de poder preguntarse por ella sin tocar una linea de aqui.
-- ============================================================================

-- ═══════════════════ §1 · el replay, compartido ══════════════════════════════
-- Lo que se persistio con esa clave de comando, sin escribir ni apuntar nada.
-- Identico para las dos entradas: la clave es del EMISOR, no del
-- destinatario, asi que no depende de como se resolvio a quien se le pide.
--
-- No es definer: corre como el provisioner que la llama, bajo su policy de
-- lectura de `core.friend_request` (solo filas de las que el actor es parte).
create function sec.friend_request_replay(p_actor uuid, p_command uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
           'state', sec.friend_request_state(r.accepted_at, r.declined_at, r.cancelled_at, r.expired_at, r.expires_at),
           'request_id', r.id,
           'expires_at', r.expires_at,
           'already_processed', true)
    from core.friend_request r
   where r.requester_user_id = p_actor and r.client_command_id = p_command;
$fn$;
comment on function sec.friend_request_replay(uuid, uuid) is
  'F12/ADR-005 §6: el replay por clave de comando, compartido por las dos entradas de creacion (handle y participante). NULL si esa clave no ha escrito nada.';
grant create on schema sec to nomey_provisioner;
alter function sec.friend_request_replay(uuid, uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.friend_request_replay(uuid, uuid) from public;
grant execute on function sec.friend_request_replay(uuid, uuid) to nomey_provisioner;

-- ═══════════════════ §2 · EL NUCLEO AUTORITATIVO ═════════════════════════════
-- Desde que se sabe A QUIEN, hasta la fila. Todo lo que F12/ADR-005 §4 y §7
-- deciden vive AQUI y en ningun otro sitio:
--
--   cerrojo de la pareja → caducar lo vencido → relacion real →
--   amigos / cruzada / ya pendiente / cooldown (estados, no errores) →
--   cerrojo por emisor → 30 pendientes → 10 en 60 min → insert
--
-- El orden importa y es el de F12.E.A, sin cambiar una linea: la pareja se
-- serializa ANTES de leer la relacion (si no, dos creaciones simultaneas leen
-- las dos «none» y las dos insertan), y el presupuesto del emisor se cuenta
-- bajo SU cerrojo (si no, once simultaneas pasan diez).
--
-- `p_origin` es lo unico que distingue a las dos entradas en la fila, y es
-- auditoria: nada del producto lo lee.
create function sec.create_friend_request_core(
  p_actor   uuid,
  p_target  uuid,
  p_command uuid,
  p_origin  text
) returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_rel    record;
  v_n      integer;
  v_oldest timestamptz;
  v_id     uuid;
  v_until  timestamptz;
begin
  -- LA PAREJA, SERIALIZADA (§4 de ADR-005): caducar lo vencido y leer la
  -- relacion real. Nada de lo que sigue es un error del que pide.
  perform sec.lock_friend_pair(p_actor, p_target);
  perform sec.expire_friend_requests(p_actor, p_target);
  select * into v_rel from sec.friend_relation(p_actor, p_target);
  if v_rel.relation = 'friends' then
    return jsonb_build_object('state', 'friends', 'already_processed', false);
  elsif v_rel.relation = 'incoming_pending' then
    -- Cruzada: la otra parte ya pidio. No se inserta una segunda; se contesta
    -- la suya (F12/ADR-005 §4: nunca amistad automatica por «enviar»).
    return jsonb_build_object('state', 'incoming_pending', 'request_id', v_rel.request_id, 'already_processed', false);
  elsif v_rel.relation = 'outgoing_pending' then
    return jsonb_build_object('state', 'pending', 'request_id', v_rel.request_id,
      'expires_at', (select r.expires_at from core.friend_request r where r.id = v_rel.request_id), 'already_processed', true);
  elsif v_rel.relation = 'cooldown' then
    return jsonb_build_object('state', 'cooldown', 'already_processed', false);
  end if;

  -- TOPES POR EMISOR (§7), exactos bajo su cerrojo: 30 pendientes salientes;
  -- 10 creadas en 60 min (cualquier estado: cancelar no devuelve cuota).
  perform sec.lock_friend_budget(p_actor);
  select count(*) into v_n from core.friend_request r
   where r.requester_user_id = p_actor
     and sec.friend_request_state(r.accepted_at, r.declined_at, r.cancelled_at, r.expired_at, r.expires_at) = 'pending';
  if v_n >= 30 then
    perform sec.raise_boundary('FRIEND_REQUEST_LIMIT', 'ya tienes treinta solicitudes de amistad pendientes; cancela alguna', 409);
  end if;
  select count(*), min(r.created_at) into v_n, v_oldest from core.friend_request r
   where r.requester_user_id = p_actor and r.created_at > now() - interval '60 minutes';
  if v_n >= 10 then
    perform sec.raise_boundary('FRIEND_REQUEST_RATE_LIMITED',
      'has enviado diez solicitudes de amistad en la ultima hora; espera antes de enviar otra', 429,
      jsonb_build_object('retry_at', v_oldest + interval '60 minutes'));
  end if;

  insert into core.friend_request (requester_user_id, target_user_id, origin, client_command_id)
  values (p_actor, p_target, p_origin, p_command)
  returning id, expires_at into v_id, v_until;
  return jsonb_build_object('state', 'pending', 'request_id', v_id, 'expires_at', v_until, 'already_processed', false);
end
$fn$;
comment on function sec.create_friend_request_core(uuid, uuid, uuid, text) is
  'F12/ADR-005 §4, §7 (F12.E.D): EL nucleo de creacion de solicitudes. Cerrojo de pareja, caducidad, cruzadas, cooldown, topes por emisor e insert. Las dos entradas de api —por @handle y por participante de grupo— terminan aqui: no hay dos semanticas.';
grant create on schema sec to nomey_provisioner;
alter function sec.create_friend_request_core(uuid, uuid, uuid, text) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.create_friend_request_core(uuid, uuid, uuid, text) from public;
grant execute on function sec.create_friend_request_core(uuid, uuid, uuid, text) to nomey_provisioner;

-- ═══════════════════ §3 · la entrada por @handle, sobre el nucleo ════════════
-- MISMO CONTRATO PUBLICO que 20260930120000: misma firma, mismos estados,
-- mismos codigos, mismo orden observable. Lo unico que cambia es que el tramo
-- «desde que se sabe a quien» ya no esta escrito aqui.
create or replace function api.create_friend_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'handle'];
  v_actor    uuid := sec.request_actor_id();
  v_own      text;
  v_command  uuid;
  v_contract integer;
  v_raw      text;
  v_handle   text;
  v_replay   jsonb;
  v_n        integer;
  v_target   uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_command  := sec.payload_uuid(payload, 'client_command_id', true);
  v_contract := sec.payload_contract_version(payload);
  if v_contract <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_raw := sec.payload_text(payload, 'handle', true);
  v_own := sec.assert_friend_actor(v_actor, 'envia solicitudes de amistad');

  -- REPLAY por clave: lo que se persistio con esa clave, sin apuntar ni escribir.
  v_replay := sec.friend_request_replay(v_actor, v_command);
  if v_replay is not null then return v_replay; end if;

  v_handle := sec.normalize_handle(v_raw);
  if v_handle is not null and v_handle = v_own then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes enviarte una solicitud de amistad a ti mismo', 400);
  end if;

  -- EL DESTINATARIO: el freno del resolver (F12/ADR-001 §12). Frenado no
  -- apunta; resolver apunta una vez, encuentre o no.
  select count(*) into v_n from core.username_lookup_attempt a
   where a.user_id = v_actor and a.attempted_at > now() - interval '10 minutes';
  if v_n >= 20 then
    perform sec.raise_boundary('RECIPIENT_LOOKUP_THROTTLED',
      'demasiadas busquedas de username en diez minutos; espera antes de buscar otra', 429);
  end if;
  v_target := sec.handle_owner(v_raw);
  insert into core.username_lookup_attempt (user_id) values (v_actor);
  delete from core.username_lookup_attempt a where a.attempted_at < now() - interval '1 day';
  if v_target is null then
    -- Un ESTADO y no un error, para que el apunte del freno persista
    -- (medido en F12.B1: una excepcion lo revierte y sondear saldria gratis).
    return jsonb_build_object('state', 'not_found', 'already_processed', false);
  end if;
  if v_target = v_actor then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes enviarte una solicitud de amistad a ti mismo', 400);
  end if;

  return sec.create_friend_request_core(v_actor, v_target, v_command, 'username');
end
$fn$;
comment on function api.create_friend_request(jsonb) is
  'F12/ADR-005 §3-§7: enviar una solicitud de amistad a @handle. Resuelve el handle UNA vez en servidor (un apunte del freno). Estados con 200: pending (nueva o ya existente, con request_id), not_found, friends, incoming_pending (cruzada: contesta la suya), cooldown (7 dias tras un rechazo, sin detalle). Errores: NOT_AUTHORIZED, USERNAME_REQUIRED, PAYLOAD_INVALID, RECIPIENT_LOOKUP_THROTTLED, FRIEND_REQUEST_LIMIT, FRIEND_REQUEST_RATE_LIMITED. Idempotente por client_command_id. Desde F12.E.D comparte nucleo con api.create_friend_request_to_participant.';

-- ═══════════════════ §4 · participante → cuenta ══════════════════════════════
-- EL UNICO SITIO donde un participant_id se convierte en una cuenta.
--
-- Definer del WRITER y no del provisioner, por el mismo motivo que
-- sec.has_personal_scope (20260926120000): el provisioner solo ve SU propio
-- vinculo —`participant_user_link_provisioner_self_select` es
-- `user_id = actor`— y ampliar esa policy para esto le daria a TODAS sus
-- funciones la lectura de los vinculos ajenos. El writer ya lee esa tabla
-- entera desde 20260825152805 para derivar el ambito de caja del pagador de
-- un gasto compartido, asi que no se abre nada nuevo: se usa lo que ya
-- estaba, desde una funcion que devuelve UNA cosa y a la que el cliente no
-- llega (authenticated no tiene USAGE sobre `sec`).
--
-- LA BARRERA es la pertenencia del ACTOR al ambito de ese participante,
-- leida aqui dentro con `sec.request_actor_id()`. No con `sec.is_member`,
-- que usa `auth.uid()` y E16 midio que el writer no puede invocarlo.
--
-- NULL para todo lo demas, sin distinguir: no eres miembro, no existe, no es
-- de un grupo, no tiene cuenta.
--
-- El vinculo HISTORICO cuenta (F10/ADR-003): quien salio del grupo sigue
-- siendo la misma cuenta, y la amistad es entre cuentas.
create function sec.participant_account(p_participant uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.user_id
    from core.participant p
    join core.scope s on s.id = p.scope_id and s.kind = 'group'
    join core.participant_user_link l on l.participant_id = p.id
   where p.id = p_participant
     and exists (select 1 from core.membership m
                  where m.scope_id = p.scope_id
                    and m.user_id = sec.request_actor_id());
$fn$;
comment on function sec.participant_account(uuid) is
  'F12.E.D: participante de grupo → cuenta vinculada, SOLO si el actor es miembro actual de ese grupo. Definer del writer para no ampliar las policies del provisioner sobre core.participant_user_link. El uid NUNCA sale de la base: api lo usa para resolver la relacion o para insertar, y publica una palabra. NULL indistinguible entre no-miembro, inexistente, no-grupo y sin cuenta.';
grant create on schema sec to nomey_writer;
alter function sec.participant_account(uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.participant_account(uuid) from public;
grant execute on function sec.participant_account(uuid) to nomey_provisioner;

-- APTA PARA AMISTAD: exactamente lo que F12.E.A ya exigia del destinatario
-- cuando se le llegaba por @handle. `sec.handle_owner` solo devuelve el dueno
-- de un handle DEFINITIVO y ACTIVO, asi que por esa via era imposible pedirle
-- amistad a una cuenta sin username; por participante hay que comprobarlo, y
-- se comprueba con la MISMA condicion, no con una parecida.
--
-- Una sesion anonima (invitado) nunca tiene handle definitivo: el hook de
-- alta de F12.A la deja pasar sin reservar nada y `claim_username` no se le
-- pide nunca. Asi que esta condicion cubre al invitado sin preguntar por
-- `auth.users`, que el provisioner no lee.
create function sec.participant_friendable(p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from core.account_handle h
                  where h.user_id = p_user
                    and h.claimed_at is not null and h.released_at is null);
$fn$;
comment on function sec.participant_friendable(uuid) is
  'F12.E.D: esa cuenta puede ser parte de una amistad, con la MISMA condicion que la entrada por @handle (handle definitivo y activo). Un invitado nunca lo tiene. No es definer: corre bajo la policy de lectura de handles del provisioner.';
grant create on schema sec to nomey_provisioner;
alter function sec.participant_friendable(uuid) owner to nomey_provisioner;
revoke create on schema sec from nomey_provisioner;
revoke execute on function sec.participant_friendable(uuid) from public;
grant execute on function sec.participant_friendable(uuid) to nomey_provisioner;

-- ═══════════════════ §5 · el estado social de un grupo ═══════════════════════
-- POR AMBITO Y NO POR PARTICIPANTE, deliberadamente. La pantalla del grupo ya
-- pinta la lista entera de participantes y necesita saber, para cada uno, si
-- ofrecer «Anadir amigo»: una funcion por participante serian N llamadas para
-- dibujar una pantalla, y la barrera —ser miembro— es la MISMA para todas.
-- Una por ambito es una consulta, un viaje y un solo sitio donde se comprueba
-- la pertenencia.
--
-- Devuelve fila para TODOS los participantes del grupo, incluido uno mismo y
-- los que no tienen cuenta, para que el cliente tenga un mapa total y no
-- tenga que deducir nada. Lo unico que publica de cada uno es una palabra y,
-- si hay una solicitud pendiente, su id —que es lo que aceptar, rechazar y
-- cancelar necesitan, y del que el actor ya es parte—.
--
-- LO QUE NO PUBLICA: uid, email, @handle, nombre publico de la cuenta, sus
-- ambitos, sus grupos, su Personal. El nombre que la pantalla ensena sigue
-- siendo `participant.display_name`, que ya venia de `api.group_participant`.
--
-- `cooldown` se contesta como `none`: es un hecho del PASADO DEL ACTOR —el
-- otro le rechazo hace menos de siete dias— y ensenarlo en la lista del grupo
-- seria recordarselo cada vez que lo abre. Si vuelve a pulsar, el comando le
-- contesta `cooldown` con su frase neutra.
--
-- NO caduca nada: `sec.friend_relation` deriva el estado comparando
-- `expires_at`, asi que una vencida ya no se lee como pendiente.
-- Terminalizar exige cerrojo y escritura, y esto es una lectura.
create function api.group_friend_status(p_scope uuid)
returns table (participant_id uuid, state text, request_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := sec.request_actor_id();
  v_able  boolean;
begin
  -- LA BARRERA, antes de mirar nada: miembro actual de ESE ambito. Un ambito
  -- ajeno o inexistente devuelve CERO filas, no un error: es una lectura, y
  -- los dos casos se contestan igual.
  if not sec.is_member(p_scope) then return; end if;

  -- El ACTOR tambien tiene que poder ser amigo de alguien. Un invitado, o una
  -- cuenta sin username definitivo, no puede: se le contesta el mapa entero
  -- como `unavailable` en vez de un error, porque esto lo pide la pantalla
  -- del grupo al abrirse y un invitado tiene derecho a abrir su grupo.
  v_able := not coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false)
            and sec.participant_friendable(v_actor);

  return query
  select p.id,
         case
           when not v_able                              then 'unavailable'
           when t.target is null                        then 'unavailable'
           when t.target = v_actor                      then 'self'
           when not sec.participant_friendable(t.target) then 'unavailable'
           when r.relation = 'cooldown'                 then 'none'
           when r.relation is null                      then 'unavailable'
           else r.relation
         end,
         case when r.relation in ('outgoing_pending', 'incoming_pending') then r.request_id end
    from core.participant p
    left join lateral (select sec.participant_account(p.id) as target) t on true
    left join lateral (
      select rel.relation, rel.request_id
        from sec.friend_relation(v_actor, t.target) rel
       where v_able and t.target is not null and t.target <> v_actor
         and sec.participant_friendable(t.target)) r on true
   where p.scope_id = p_scope;
end
$fn$;
comment on function api.group_friend_status(uuid) is
  'F12.E.D: el estado de amistad del actor con CADA participante de un grupo suyo, en una llamada. Estados: none | outgoing_pending | incoming_pending | friends | self | unavailable. Publica una palabra y, en las pendientes, el request_id (del que el actor ya es parte). NUNCA uid, email, handle ni nada del ambito ajeno. Cero filas si el actor no es miembro. cooldown se contesta como none: el comando lo dira si vuelve a pulsar.';
grant create on schema api to nomey_provisioner;
alter function api.group_friend_status(uuid) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.group_friend_status(uuid) from public;
grant execute on function api.group_friend_status(uuid) to authenticated;

-- ═══════════════════ §6 · crear por participante ═════════════════════════════
-- payload: { client_command_id, command_contract_version: 1, participant_id }
--
-- Orden: forma → actor → clave (replay sin resolver nada) → participante →
-- a uno mismo → apto → nucleo.
--
-- El participante que no se puede usar es NOT_AUTHORIZED · 403 y no un
-- estado: a diferencia de un @handle que no existe —donde el que pide no ha
-- hecho nada malo y el apunte del freno debe persistir—, aqui el cliente
-- manda un id que solo puede haber sacado de una pantalla suya. Que no lo sea
-- es un intento de usar un id ajeno, y contestarlo con un 200 silencioso
-- dejaria al cliente creyendo que mando algo.
--
-- Un participante vinculado pero no apto —sin username definitivo, invitado—
-- SI es un estado (`unavailable`): el que pide no ha hecho nada malo y la
-- pantalla simplemente deja de ofrecerlo. No se dice por que.
create function api.create_friend_request_to_participant(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'participant_id'];
  v_actor       uuid := sec.request_actor_id();
  v_command     uuid;
  v_contract    integer;
  v_participant uuid;
  v_replay      jsonb;
  v_target      uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_command     := sec.payload_uuid(payload, 'client_command_id', true);
  v_contract    := sec.payload_contract_version(payload);
  if v_contract <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_participant := sec.payload_uuid(payload, 'participant_id', true);
  perform sec.assert_friend_actor(v_actor, 'envia solicitudes de amistad');

  v_replay := sec.friend_request_replay(v_actor, v_command);
  if v_replay is not null then return v_replay; end if;

  v_target := sec.participant_account(v_participant);
  if v_target is null then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'ese participante no es de un grupo tuyo o no tiene cuenta', 403);
  end if;
  if v_target = v_actor then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'no puedes enviarte una solicitud de amistad a ti mismo', 400);
  end if;
  if not sec.participant_friendable(v_target) then
    return jsonb_build_object('state', 'unavailable', 'already_processed', false);
  end if;

  return sec.create_friend_request_core(v_actor, v_target, v_command, 'group');
end
$fn$;
comment on function api.create_friend_request_to_participant(jsonb) is
  'F12/ADR-005 §3-§7 (F12.E.D): enviar una solicitud de amistad a un participante de un grupo propio, sin conocer ni enviar su @handle. MISMO nucleo que api.create_friend_request: mismo cerrojo de pareja, misma caducidad, mismas cruzadas, mismo cooldown, mismos topes, misma idempotencia por client_command_id. Estados con 200: pending, friends, incoming_pending, cooldown, unavailable. Errores: NOT_AUTHORIZED (participante que no es de un grupo tuyo, o sin cuenta), USERNAME_REQUIRED, PAYLOAD_INVALID, FRIEND_REQUEST_LIMIT, FRIEND_REQUEST_RATE_LIMITED. No consume el freno del resolver: no resuelve ningun username. origin = group.';
grant create on schema api to nomey_provisioner;
alter function api.create_friend_request_to_participant(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.create_friend_request_to_participant(jsonb) from public;
grant execute on function api.create_friend_request_to_participant(jsonb) to authenticated;
