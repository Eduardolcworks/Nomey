#!/usr/bin/env bash
#
# La frontera COMPLETA, extremo a extremo y por HTTP · cierre de la Fase 3.
#
#   cliente HTTP -> Kong -> GoTrue (JWT real) -> PostgREST -> api.* -> writer -> RLS/core
#
# Por que existe, y por que no puede ser un fichero de `supabase/checks/`: todo
# lo demas mide a nivel SQL con `set_config('request.jwt.claims', ...)`, que
# SIMULA la identidad. Eso deja sin comprobar cuatro cosas que solo existen en la
# ruta real:
#
#   1. que un JWT emitido por Auth resuelve al rol `authenticated`;
#   2. que PostgREST entrega el `jsonb` CONSERVANDO EL TIPO JSON ORIGINAL, que
#      es lo que F03/ADR-005 §3 exige y E14 midio sobre una maqueta;
#   3. que `RAISE sqlstate 'PGRST'` viaja como el estado HTTP y el cuerpo que
#      F03/ADR-006 §9 fija, contra las funciones REALES y no las de E15;
#   4. que `core` no es alcanzable por la Data API, en comportamiento.
#
# Uso, con el stack levantado Y con GoTrue arrancado:
#
#   ./scripts/http-boundary-check.sh
#
# SIN SECRETOS EN EL REPOSITORIO. La clave publicable se lee EN EJECUCION de la
# configuracion del Kong que esta corriendo, de modo que aqui no hay ninguna
# credencial escrita. Es ademas la clave compartida por defecto del stack local,
# que el propio `supabase start` imprime y declara no apta para produccion.
#
# Escribe filas confirmadas —una peticion HTTP es su propia transaccion— y las
# retira al terminar, comprobando que no queda ninguna. NO ES UNA MIGRACION.

set -uo pipefail

# shellcheck source=scripts/local-db-guard.sh
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
# Pila configurable, por la misma via que los scripts de carreras: por omision
# la local; NOMEY_DB_CONTAINER / NOMEY_KONG_CONTAINER / NOMEY_API_URL para una
# pila aislada. Las guardas reciben la misma pila que luego se usa.
API="${NOMEY_API_URL:-http://127.0.0.1:54321}"
# El buzon local (Mailpit, [local_smtp]): solo la seccion 14 lo lee, para
# seguir el enlace de confirmacion que convierte a un invitado en cuenta.
MAIL="${NOMEY_MAIL_URL:-http://127.0.0.1:54324}"
# Los invitados de la seccion 14: sin correo hasta convertirse, asi que la
# retirada los reconoce por id ademas de por correo.
GUEST_UID=00000000-0000-4000-8000-000000000000
GUEST2_UID=00000000-0000-4000-8000-000000000000
DB_CONTAINER="${NOMEY_DB_CONTAINER:-supabase_db_Nomey}"
KONG_CONTAINER="${NOMEY_KONG_CONTAINER:-supabase_kong_Nomey}"
exigir_base_local "${DB_CONTAINER}" || exit 1
# Este script habla por la frontera: sin gateway no hay nada que comprobar, y
# fallar aqui es legible. Fallar en el primer curl, no.
exigir_frontera_http "${API}" || exit 1

DB=(docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: falta $1 en el PATH" >&2; exit 127; }; }
need curl
need node
need docker

# Extrae un campo anidado de un JSON que llega por stdin. Vacio si no esta.
jget() {
  node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        let v = JSON.parse(s);
        for (const k of process.argv[1].split(".")) v = (v === null || v === undefined) ? undefined : v[k];
        console.log(v === undefined || v === null ? "" : String(v));
      } catch { console.log(""); }
    });' "$1"
}

# ------------------------------------------------------------- la clave -----
# De la configuracion del Kong en marcha, no del repositorio.
# El `sh -c` no es adorno: Git Bash reescribe las rutas absolutas del comando
# antes de pasarlas a Docker, y `/home/kong/kong.yml` se convertiria en una ruta
# de Windows. Dentro de comillas para la shell del contenedor, no la toca.
KEY=$(docker exec "${KONG_CONTAINER}" \
        sh -c "grep -o 'sb_publishable_[A-Za-z0-9_-]*' /home/kong/kong.yml | head -1" 2>/dev/null)
if [ -z "${KEY}" ]; then
  echo "error: no se pudo leer la clave publicable del Kong en marcha." >&2
  echo "       Levanta el stack SIN excluir gotrue:" >&2
  echo "       ./scripts/supabase-cli.sh start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor" >&2
  exit 1
fi

if ! curl -fsS -o /dev/null "${API}/auth/v1/health" 2>/dev/null; then
  echo "error: GoTrue no responde en ${API}/auth/v1/health." >&2
  echo "       Este check EXIGE Auth real: no simula identidad." >&2
  exit 1
fi

# -------------------------------------------------------------- peticion ----
# Imprime "<estado> <cuerpo-en-una-linea>". `tok` vacio = sin JWT.
rpc() {
  local fn="$1" tok="$2" body="$3" cuerpo estado
  cuerpo=$(mktemp)
  if [ -n "${tok}" ]; then
    estado=$(curl -s -o "${cuerpo}" -w '%{http_code}' \
      -X POST "${API}/rest/v1/rpc/${fn}" \
      -H "apikey: ${KEY}" -H "Authorization: Bearer ${tok}" \
      -H 'Content-Type: application/json' --data-binary "${body}")
  else
    estado=$(curl -s -o "${cuerpo}" -w '%{http_code}' \
      -X POST "${API}/rest/v1/rpc/${fn}" \
      -H "apikey: ${KEY}" \
      -H 'Content-Type: application/json' --data-binary "${body}")
  fi
  printf '%s %s\n' "${estado}" "$(tr -d '\n' <"${cuerpo}")"
  rm -f "${cuerpo}"
}

estado_de() { printf '%s' "${1%% *}"; }
cuerpo_de() { printf '%s' "${1#* }"; }

# El payload de una intencion viaja SIEMPRE dentro de `payload`, porque
# F03/ADR-006 §2 fija un unico parametro `jsonb` por funcion.
env_payload() { printf '{"payload":%s}' "$1"; }

# ------------------------------------------------------------- usuarios -----
# Reales, emitidos por GoTrue. Con `enable_confirmations = true` en config.toml
# —obligatoria, y la misma postura que en produccion— el alta YA NO devuelve
# sesion: responde el usuario con `confirmation_sent_at` y sin `access_token`.
# Medido contra este stack.
#
# Asi que el JWT se obtiene en tres pasos en vez de uno: alta, confirmacion y
# password grant. La confirmacion se hace por SQL como `postgres` —el mismo
# camino que ya usaba `borrar_usuarios`— en vez de leer el buzon: depende de
# menos piezas y no cambia lo que este check mide, que es la frontera HTTP y no
# el correo.
#
# PERO el servicio de correo TIENE que estar arrancado, y la distincion importa
# porque costo un CI en rojo: este check no lee el buzon, pero **GoTrue envia el
# correo de confirmacion durante el propio alta** y, si no tiene a donde
# entregarlo, responde `500 unexpected_failure: Error sending confirmation
# email` y no llega a crear al usuario. Confirmar despues por SQL no ayuda,
# porque el alta ya ha fallado. Reproducido excluyendo el servicio y volviendo a
# incluirlo.
#
# `[auth.email.smtp]` esta comentado entero, asi que `[local_smtp]` es el UNICO
# destino que GoTrue tiene. Por eso no se excluye del arranque, ni aqui ni en CI.
#
# Lo que NO se hace, y conviene que se vea: no se desactivan las confirmaciones
# durante el test, no se inventa una identidad y no se toca la aplicacion. El
# usuario que sale de aqui es uno real de GoTrue, confirmado, con su JWT real.
EMAIL_A=nomey-http-a@example.test
EMAIL_B=nomey-http-b@example.test
# El tercero existe solo para la seccion 8: es el unico cuyo Modo Personal NO se
# siembra a mano, porque lo crea el provisioning real por HTTP.
EMAIL_C=nomey-http-c@example.test
PASS='Nomey-http-check-2026!'

borrar_usuarios() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
delete from auth.users where email in ('${EMAIL_A}','${EMAIL_B}','${EMAIL_C}','nomey-http-guest@example.test') or id in ('${GUEST_UID}','${GUEST2_UID}');
SQL
}

# Desde F12/ADR-001 §5 (20260924120000) un alta por correo SIN username la
# rehusa el hook before_user_created: cada alta manda su nombre y su username
# (`data`, como la app), y el hook reserva el handle 7 dias en la misma
# transaccion. Los handles son deterministas y distintos por usuario.
alta() { # $1 email, $2 username
  curl -s -X POST "${API}/auth/v1/signup" \
    -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
    --data-binary "{\"email\":\"$1\",\"password\":\"${PASS}\",\"data\":{\"display_name\":\"Cuenta $2\",\"requested_username\":\"$2\"}}"
}

# Marca el correo como confirmado. `email_confirmed_at` es la columna escribible;
# `confirmed_at` es GENERATED ALWAYS y escribirla es un error — comprobado en el
# catalogo de este stack.
confirmar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
update auth.users set email_confirmed_at = now() where email = '$1' and email_confirmed_at is null;
SQL
}

# El JWT real, por la misma via que usara la app: contrasena contra GoTrue.
sesion() {
  curl -s -X POST "${API}/auth/v1/token?grant_type=password" \
    -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
    --data-binary "{\"email\":\"$1\",\"password\":\"${PASS}\"}"
}

# --------------------------------------------------------------- fixture ----
# Categorias SEMBRADAS POR MIGRACION, no del fixture: `Otros` de cada familia.
# Se referencian por su identidad fija, que es lo que la migracion garantiza.
CAT_GASTO=4ed30a44-9f82-578f-828c-b491a25ebdd9

EUR=cccccccc-cccc-4ccc-8ccc-cccccccccccc
USD=dddddddd-dddd-4ddd-8ddd-dddddddddddd
PA=a0000000-0000-4000-8000-00000000aa01
PB=a0000000-0000-4000-8000-00000000bb01
GX=a0000000-0000-4000-8000-00000000ff01
GY=a0000000-0000-4000-8000-00000000ff02
GZ=a0000000-0000-4000-8000-00000000ff03   # seccion 13: dejar la instancia de vinculo (F10/ADR-001)
XA=b0000000-0000-4000-8000-00000000aa01
XB=b0000000-0000-4000-8000-00000000bb01
YA=b0000000-0000-4000-8000-00000000aa02
YB=b0000000-0000-4000-8000-00000000bb02
ZA=b0000000-0000-4000-8000-00000000aa03
ZB=b0000000-0000-4000-8000-00000000bb03

retirar() {
  # SIN enmudecer el error: una retirada que falla en silencio deja residuo
  # que luego se atribuye al check siguiente. Si esto se rompe, se ve aqui.
  # TODO VA ACOTADO A SUS PROPIOS FIXTURES, y no es estilo.
  #
  # Aqui hubo doce borrados de tabla entera. En CI daba igual —la base se
  # levanta desde cero y el check es su unico habitante—, pero sobre una base
  # con datos arrasaba el ledger completo. El mismo defecto que tenia
  # `writer-debt-concurrency.sh`, y con el mismo remedio.
  #
  # Dos asideros, y ninguno inventado: los USUARIOS de este check se reconocen
  # por su correo —los crea GoTrue, asi que sus identificadores son dinamicos— y
  # sus AMBITOS son los cuatro sembrados mas los que el provisioning real cree
  # en la seccion 8, que se identifican por su dueno.
  #
  # El orden importa: esto corre ANTES de `borrar_usuarios`, asi que las
  # subconsultas sobre `auth.users` todavia resuelven.
  local ACTORES="select id from auth.users where email like 'nomey-http-%' or id in ('${GUEST_UID}','${GUEST2_UID}')"
  local MIOS="select id from core.scope where id in ('${PA}','${PB}','${GX}','${GY}','${GZ}','a0000000-0000-4000-8000-00000000ff04') or owner_user_id in (${ACTORES})"

  "${DB[@]}" -v ON_ERROR_STOP=1 >/dev/null <<SQL
begin;
set constraints all deferred;
-- F12/ADR-001 (20260921120000): la identidad publica de estos actores y el
-- diario de sus handles (seccion 16).
delete from core.account_handle_event where user_id in (${ACTORES}) or actor_user_id in (${ACTORES});
delete from core.username_lookup_attempt where user_id in (${ACTORES});
delete from core.account_handle where user_id in (${ACTORES});
delete from core.account_identity where user_id in (${ACTORES});
delete from core.client_command where created_by in (${ACTORES});
-- Avisos del grupo, antes que el ambito que referencian.
delete from core.group_notice where scope_id in (${MIOS});
delete from core.split_participant where scope_id in (${MIOS});
delete from core.split where scope_id in (${MIOS});
delete from core.balance_observation where scope_id in (${MIOS});
delete from core.adjustment_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by in (${ACTORES});
delete from core.expense_category x using core.operation_version ov
  where ov.id = x.operation_version_id and ov.created_by in (${ACTORES});
delete from core.movement_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by in (${ACTORES});
delete from core.effect where scope_id in (${MIOS});
-- F12/ADR-002 (20260926120000): las partes de las transferencias y las
-- propuestas de estos actores (la propuesta referencia la operacion aceptada).
delete from core.transfer_part tp using core.operation_version ov
  where ov.id = tp.operation_version_id and ov.created_by in (${ACTORES});
delete from core.transfer_proposal where created_by in (${ACTORES}) or target_user_id in (${ACTORES});
-- F12/ADR-004 (20260927120000): las solicitudes de pago de estos actores y
-- los apuntes de su previsualizacion.
delete from core.payment_request_attempt where user_id in (${ACTORES});
delete from core.payment_request where created_by in (${ACTORES}) or paid_by in (${ACTORES});
-- F12/ADR-003 (20260928120000): las propuestas de grupo de estos actores.
delete from core.group_transfer_proposal where created_by in (${ACTORES}) or target_user_id in (${ACTORES});
-- F10/ADR-001 (20260915120000): linea base y sujetos de las instancias creadas por
-- estos actores, antes que sus versiones y participantes.
delete from core.link_baseline b using core.operation o where o.id = b.operation_id and o.created_by in (${ACTORES});
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id in (${MIOS});
delete from core.operation_version where created_by in (${ACTORES});
delete from core.operation where created_by in (${ACTORES});
delete from core.participant_period where participant_id in
  (select id from core.participant where scope_id in (${MIOS}));
-- Invitaciones (seccion 14: un invitado invita), antes que su ambito.
delete from core.group_invitation where scope_id in (${MIOS});
-- F10/ADR-003: el vinculo historico apunta a la salida (seccion 20 sale por
-- HTTP de verdad); el vinculo primero, la salida despues, y esta antes que el
-- participante que referencia.
delete from core.participant_user_link where scope_id in (${MIOS});
delete from core.group_departure where scope_id in (${MIOS});
-- F10/ADR-005: la decision de inicio del Personal referencia el ambito.
delete from core.personal_start where scope_id in (${MIOS});
delete from core.provisioning_command where created_by in (${ACTORES});
delete from core.membership where scope_id in (${MIOS});
-- El perfil del grupo que un invitado creo por HTTP (seccion 14).
delete from core.group_profile where scope_id in (${MIOS});
delete from core.participant where scope_id in (${MIOS});
delete from core.scope where id in (${MIOS});
-- SOLO las dos definiciones de este check. Desde la Fase 6.A el catalogo
-- monetario esta SEMBRADO POR MIGRACION y un borrado sin filtro lo arrasaria.
delete from core.category where owner_user_id in (select id from auth.users where email like 'nomey-http-%');
delete from core.currency_definition where id in ('${EUR}','${USD}');
commit;
SQL
}

# El estado previo se siembra como `postgres`, que es exactamente lo que hara el
# provisioning cuando exista (F4+). Lo que este check exige que sea REAL es la
# llamada del cliente, el JWT, PostgREST, los permisos y la RLS.
sembrar() {
  local ua="$1" ub="$2"
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${EUR}','EUR',2), ('${USD}','USD',2);
insert into core.scope (id,kind,base_currency_definition_id,owner_user_id) values
  ('${PA}','personal','${EUR}','${ua}'), ('${PB}','personal','${EUR}','${ub}');
insert into core.scope (id,kind,base_currency_definition_id) values
  ('${GX}','group','${EUR}'), ('${GY}','group','${EUR}');
insert into core.participant (id, scope_id, display_name) values
  ('${XA}','${GX}','A'), ('${XB}','${GX}','B'),
  ('${YA}','${GY}','A'), ('${YB}','${GY}','B');
-- La membresia del PROPIO Modo Personal no es redundante con la propiedad, y
-- descubrirlo costo un fallo de este check: `owner_user_id` es ATRIBUCION
-- economica durable (F03/ADR-013) y `core.membership` es AUTORIZACION actual
-- (F03/ADR-004). La policy de lectura de `core.effect` se resuelve por membresia,
-- asi que sin esta fila el dueno no ve sus propios efectos. Son dos preguntas
-- distintas a proposito, y el provisioning tendra que crear las dos.
insert into core.membership (scope_id, user_id) values
  ('${PA}','${ua}'), ('${PB}','${ub}'),
  ('${GX}','${ua}'), ('${GX}','${ub}'), ('${GY}','${ua}'), ('${GY}','${ub}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values
  ('${XA}','${GX}','${ua}'), ('${XB}','${GX}','${ub}'),
  ('${YA}','${GY}','${ua}'), ('${YB}','${GY}','${ub}');
insert into core.participant_period (participant_id, valid_from, valid_until) values
  ('${XA}','2020-01-01',null), ('${XB}','2020-01-01',null),
  ('${YA}','2020-01-01',null), ('${YB}','2020-01-01',null);
-- GZ, para la seccion 13: dos vinculos bien formados (F10/ADR-001 §1, §3) —S0 =
-- el propio participante, linea base vacia, como los de un create/new— sin
-- origen: la siembra no pasa por ningun comando.
insert into core.scope (id,kind,base_currency_definition_id) values ('${GZ}','group','${EUR}');
insert into core.participant (id, scope_id, display_name) values ('${ZA}','${GZ}','A'), ('${ZB}','${GZ}','B');
insert into core.membership (scope_id, user_id) values ('${GZ}','${ua}'), ('${GZ}','${ub}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values
  ('${ZA}','${GZ}','${ua}'), ('${ZB}','${GZ}','${ub}');
insert into core.link_baseline_subject (link_id, participant_id)
  select l.link_id, l.participant_id from core.participant_user_link l where l.scope_id = '${GZ}';
insert into core.participant_period (participant_id, valid_from, valid_until) values
  ('${ZA}','2020-01-01',null), ('${ZB}','2020-01-01',null);
commit;
SQL
}

echo "== preparando =="
retirar
borrar_usuarios

# 1 · alta. Con confirmacion obligatoria esto NO trae token, y el `id` viaja en
#     la raiz de la respuesta en vez de bajo `user`.
RA=$(alta "${EMAIL_A}" http_ana)
RB=$(alta "${EMAIL_B}" http_bea)
UID_A=$(printf '%s' "${RA}" | jget id)
UID_B=$(printf '%s' "${RB}" | jget id)

if [ -z "${UID_A}" ] || [ -z "${UID_B}" ]; then
  echo "  FALLO: GoTrue no dio de alta al usuario. Respuesta A: $(printf '%s' "${RA}" | head -c 300)"
  exit 1
fi

# La otra mitad del invariante, y la que de verdad hace falta comprobar: el alta
# NO puede traer sesion. Si algun dia vuelve a traerla, la confirmacion
# obligatoria se ha caido y nadie se enteraria por ningun otro sitio.
if [ -n "$(printf '%s' "${RA}" | jget access_token)" ]; then
  echo "  FALLO: el alta devolvio sesion. \`enable_confirmations\` no esta activo."
  exit 1
fi
ok "el alta no emite sesion: la confirmacion de correo es obligatoria"

# 2 · confirmacion    3 · sesion por contrasena
confirmar "${EMAIL_A}"
confirmar "${EMAIL_B}"
TOK_A=$(sesion "${EMAIL_A}" | jget access_token)
TOK_B=$(sesion "${EMAIL_B}" | jget access_token)

if [ -z "${TOK_A}" ] || [ -z "${TOK_B}" ]; then
  echo "  FALLO: sin JWT tras confirmar el correo y pedir sesion con contrasena."
  exit 1
fi
ok "dos usuarios reales, confirmados, con JWT obtenido por contrasena"
sembrar "${UID_A}" "${UID_B}"

# ============================================================================
echo ""
echo "== 1 · el JWT real resuelve al rol authenticated =="
# El `sub` del token es lo que `sec.request_actor_id()` lee del GUC, y es lo que
# acaba en `operation.created_by`. Si el JWT no llegara, o llegara como `anon`,
# no habria identidad y la operacion no existiria.
r=$(rpc record_adjustment "${TOK_A}" "$(env_payload "{
  \"client_operation_id\":\"a0000000-0000-4000-8000-000000000001\",
  \"command_contract_version\":2,\"effective_date\":\"2026-01-10\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"50000\",\"currency_definition_id\":\"${EUR}\"}")")
est=$(estado_de "${r}"); cue=$(cuerpo_de "${r}")
OP_AJUSTE=$(printf '%s' "${cue}" | jget operation_id)
[ "${est}" = "200" ] && ok "record_adjustment por HTTP: 200" || fallo "record_adjustment devolvio ${est}: ${cue}"

atribuida=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.operation where id = '${OP_AJUSTE}' and created_by = '${UID_A}';
SQL
)
[ "$(tr -d '[:space:]' <<<"${atribuida}")" = "1" ] \
  && ok "la operacion quedo atribuida al sub del JWT, no a un actor simulado" \
  || fallo "la operacion no quedo atribuida al usuario del token"

rol=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select count(*) from information_schema.role_routine_grants
 where routine_schema='api' and routine_name like 'record\_%' and grantee='authenticated';
SQL
)
[ "$(tr -d '[:space:]' <<<"${rol}")" = "9" ] \
  && ok "las nueve funciones estan concedidas a authenticated y a ningun otro rol cliente" \
  || fallo "los grants de api.record_* a authenticated son $(tr -d '[:space:]' <<<"${rol}") y deben ser 9"

# ============================================================================
echo ""
echo "== 2 · sin JWT no se escribe =="
r=$(rpc record_adjustment "" "$(env_payload "{
  \"client_operation_id\":\"a0000000-0000-4000-8000-0000000000f0\",
  \"command_contract_version\":2,\"effective_date\":\"2026-01-10\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"1\",\"currency_definition_id\":\"${EUR}\"}")")
est=$(estado_de "${r}")
case "${est}" in
  200|201) fallo "se acepto una escritura SIN JWT (${est})" ;;
  *)       ok "sin JWT la llamada se rechaza con ${est}, y el rol anon no llega a la funcion" ;;
esac

# ============================================================================
echo ""
echo "== 3 · el payload jsonb conserva el tipo JSON original =="
# F03/ADR-005 §3. E14 midio sobre una maqueta que un parametro `text` NO lo conserva
# y que `jsonb` SI; esto lo comprueba contra la funcion real, por la ruta real.
r=$(rpc record_adjustment "${TOK_A}" "$(env_payload "{
  \"client_operation_id\":\"a0000000-0000-4000-8000-000000000002\",
  \"command_contract_version\":2,\"effective_date\":\"2026-01-10\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":50000,\"currency_definition_id\":\"${EUR}\"}")")
est=$(estado_de "${r}"); cue=$(cuerpo_de "${r}")
if [ "${est}" = "400" ] && printf '%s' "${cue}" | grep -q PAYLOAD_INVALID; then
  ok "un importe enviado como NUMBER se rechaza con PAYLOAD_INVALID · 400"
else
  fallo "el number JSON no se distinguio del string: ${est} ${cue}"
fi

r=$(rpc record_adjustment "${TOK_A}" "$(env_payload "{
  \"client_operation_id\":\"a0000000-0000-4000-8000-000000000003\",
  \"command_contract_version\":2,\"effective_date\":\"2026-01-10\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"9007199254740993\",\"currency_definition_id\":\"${EUR}\"}")")
est=$(estado_de "${r}")
guardado=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select original_amount from core.operation_version where original_amount > 9007199254740000;
SQL
)
if [ "${est}" = "200" ] && [ "$(tr -d '[:space:]' <<<"${guardado}")" = "9007199254740993" ]; then
  ok "un entero por encima de 2^53 cruza HTTP y se persiste EXACTO"
else
  fallo "el entero grande se degrado: estado ${est}, persistido '$(tr -d '[:space:]' <<<"${guardado}")'"
fi

# ============================================================================
echo ""
echo "== 4 · las funciones publicas de escritura, por HTTP y con JWT real (cinco aqui; §18 y §20 escriben las dos de dos voluntades) =="

# El cuerpo sale por una GLOBAL y no por stdout: `ok` y `fallo` tambien escriben
# ahi, y capturarlo con $( ) mezclaria el diagnostico con el JSON.
ULTIMO_CUERPO=''
llamada() {
  local nombre="$1" fn="$2" tok="$3" intencion="$4" esperado="${5:-200}"
  local rr ee cc
  rr=$(rpc "${fn}" "${tok}" "$(env_payload "${intencion}")")
  ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  ULTIMO_CUERPO="${cc}"
  if [ "${ee}" = "${esperado}" ]; then
    ok "${nombre}: ${ee}"
  else
    fallo "${nombre} devolvio ${ee} y se esperaba ${esperado}: ${cc}"
  fi
}

llamada "record_adjustment" record_adjustment "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000001\",
  \"command_contract_version\":2,\"effective_date\":\"2026-02-01\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"100000\",\"currency_definition_id\":\"${EUR}\"}"

llamada "record_personal_expense" record_personal_expense "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000002\",
  \"command_contract_version\":2,\"effective_date\":\"2026-02-02\",\"effective_time\":\"09:30\",
  \"scope_id\":\"${PA}\",\"amount\":\"2000\",\"currency_definition_id\":\"${EUR}\",
  \"concept\":\"Compra\",\"category_id\":\"${CAT_GASTO}\"}"

llamada "record_external_transfer" record_external_transfer "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000003\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-03\",
  \"scope_id\":\"${PA}\",\"delta\":\"-3000\",\"currency_definition_id\":\"${EUR}\"}"

# record_internal_transfer ya no se escribe aqui: desde F12.B1 (F12/ADR-002)
# nace de una PROPUESTA que el receptor acepta, y A y B todavia no tienen su
# username definitivo (lo reclaman en §17). La sexta clase se escribe en
# §18 y la septima en §20; cada una vuelve a contar las suyas.

llamada "record_group_expense" record_group_expense "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000005\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-05\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"10000\",
  \"concept\":\"Cena\",\"category_id\":\"${CAT_GASTO}\",
  \"payer_participant_id\":\"${XA}\",
  \"participants\":[\"${XA}\",\"${XB}\"],
  \"split_method\":{\"kind\":\"equal\"}}"
OP_GASTO=$(printf '%s' "${ULTIMO_CUERPO}" | jget operation_id)

# B debe 5000 a A en GX. Marca 3000 como saldados: la liquidacion la puede
# registrar cualquier integrante, y aqui la registra el propio deudor.
llamada "record_debt_settlement" record_debt_settlement "${TOK_B}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000006\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-06\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",
  \"debtor_participant_id\":\"${XB}\",\"creditor_participant_id\":\"${XA}\"}"

# En GY paga B, asi que A es el deudor y SOLO A puede pagar por transferencia.
llamada "gasto previo en GY" record_group_expense "${TOK_B}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000007\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-07\",
  \"scope_id\":\"${GY}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"6000\",
  \"concept\":\"Taxi\",\"category_id\":\"${CAT_GASTO}\",
  \"payer_participant_id\":\"${YB}\",
  \"participants\":[\"${YB}\",\"${YA}\"],
  \"split_method\":{\"kind\":\"equal\"}}"

# record_settlement_by_transfer tampoco se escribe aqui: desde F12.B3
# (F12/ADR-003) nace de una PROPUESTA de grupo que el receptor acepta, y A y B
# reclaman su username en §17. La deuda de GY (A debe 30 a B) queda viva para
# §20, que la cruza (30 + 40 → B debe 10).

# EL RECUENTO TAMBIEN VA ACOTADO. Contaba las clases de la tabla entera, que
# era exacto mientras el script fuera el unico habitante de la base. Sobre una
# base con datos, una clase ajena —un `personal_income` cualquiera— hace ocho de
# siete y declara roto un script que se comporto bien. Es el mismo supuesto que
# rompio la lectura de `writer-debt-concurrency.sh`, encontrado por el mismo
# camino; este no llego a fallar en CI, y se acota antes de que lo haga.
#
# Las clases las escriben ${UID_A} y ${UID_B} por la ruta HTTP, asi que
# acotar por ellos no relaja nada: sigue exigiendo que se persistan. CINCO
# aqui; la internal_transfer en §18 y la settlement_by_transfer en §20.
ejercitadas=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(distinct operation_class) from core.operation
 where created_by in ('${UID_A}','${UID_B}');
SQL
)
[ "$(tr -d '[:space:]' <<<"${ejercitadas}")" = "5" ] \
  && ok "CINCO clases de operacion quedaron escritas por la ruta HTTP (la sexta en §18, la septima en §20)" \
  || fallo "solo $(tr -d '[:space:]' <<<"${ejercitadas}") clases distintas llegaron a persistirse y se esperaban 5"

# ============================================================================
echo ""
echo "== 5 · replay por HTTP =="
r=$(rpc record_group_expense "${TOK_A}" "$(env_payload "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000005\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-05\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"10000\",
  \"concept\":\"Cena\",\"category_id\":\"${CAT_GASTO}\",
  \"payer_participant_id\":\"${XA}\",
  \"participants\":[\"${XA}\",\"${XB}\"],
  \"split_method\":{\"kind\":\"equal\"}}")")
est=$(estado_de "${r}"); cue=$(cuerpo_de "${r}")
op_repetida=$(printf '%s' "${cue}" | jget operation_id)
proc=$(printf '%s' "${cue}" | jget already_processed)
if [ "${est}" = "200" ] && [ "${op_repetida}" = "${OP_GASTO}" ] && [ "${proc}" = "true" ]; then
  ok "mismo operation_id y already_processed=true"
else
  fallo "el replay por HTTP devolvio ${est} ${cue}"
fi

# ============================================================================
echo ""
echo "== 6 · los codigos de error viajan con su estado HTTP =="
# F03/ADR-006 §9 y E15: el codigo propio va en el CUERPO y el estado en `detail`.
# Esto lo comprueba contra las funciones reales, no contra las de la sonda.

comprobar_error() {
  local nombre="$1" fn="$2" tok="$3" intencion="$4" codigo="$5" estado="$6"
  local rr ee cc
  rr=$(rpc "${fn}" "${tok}" "$(env_payload "${intencion}")")
  ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  if [ "${ee}" = "${estado}" ] && printf '%s' "${cc}" | grep -q "${codigo}"; then
    ok "${nombre}: ${codigo} · ${ee}"
  else
    fallo "${nombre}: se esperaba ${codigo} · ${estado} y llego ${ee} ${cc}"
  fi
}

comprobar_error "campo desconocido" record_adjustment "${TOK_A}" "{
  \"client_operation_id\":\"a2000000-0000-4000-8000-000000000001\",
  \"command_contract_version\":2,\"effective_date\":\"2026-03-01\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"1\",\"currency_definition_id\":\"${EUR}\",\"ordinal\":\"3\"}" \
  PAYLOAD_INVALID 400

comprobar_error "actor suplantado" record_adjustment "${TOK_A}" "{
  \"client_operation_id\":\"a2000000-0000-4000-8000-000000000002\",
  \"command_contract_version\":2,\"effective_date\":\"2026-03-02\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"1\",\"currency_definition_id\":\"${EUR}\",
  \"created_by\":\"${UID_B}\"}" \
  PAYLOAD_INVALID 400

# B no es dueno del Modo Personal de A, y la propiedad es la autorizacion.
comprobar_error "ambito ajeno" record_adjustment "${TOK_B}" "{
  \"client_operation_id\":\"a2000000-0000-4000-8000-000000000003\",
  \"command_contract_version\":2,\"effective_date\":\"2026-03-03\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"1\",\"currency_definition_id\":\"${EUR}\"}" \
  NOT_AUTHORIZED 403

# La misma clave con OTRA intencion.
comprobar_error "clave reutilizada" record_adjustment "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000001\",
  \"command_contract_version\":2,\"effective_date\":\"2026-02-01\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"999999\",\"currency_definition_id\":\"${EUR}\"}" \
  IDEMPOTENCY_KEY_REUSED 409

# Correccion contra una version que no es la vigente.
comprobar_error "CAS obsoleto" record_group_expense "${TOK_A}" "{
  \"client_operation_id\":\"a2000000-0000-4000-8000-000000000005\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-05\",
  \"operation_id\":\"${OP_GASTO}\",
  \"expected_version_id\":\"a9999999-9999-4999-8999-999999999999\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"8000\",
  \"concept\":\"Cena\",\"category_id\":\"${CAT_GASTO}\",
  \"payer_participant_id\":\"${XA}\",
  \"participants\":[\"${XA}\",\"${XB}\"],
  \"split_method\":{\"kind\":\"equal\"}}" \
  VERSION_CONFLICT 409

# La moneda de la operacion no es la base del ambito alcanzado.
comprobar_error "FX sin regla" record_adjustment "${TOK_A}" "{
  \"client_operation_id\":\"a2000000-0000-4000-8000-000000000006\",
  \"command_contract_version\":2,\"effective_date\":\"2026-03-06\",\"effective_time\":\"09:00\",
  \"scope_id\":\"${PA}\",\"delta\":\"1\",\"currency_definition_id\":\"${USD}\"}" \
  CURRENCY_CONVERSION_UNSUPPORTED 422

# Y un codigo de DOMINIO, que conserva el suyo (F03/ADR-006 §9).
comprobar_error "sobrepago" record_debt_settlement "${TOK_B}" "{
  \"client_operation_id\":\"a2000000-0000-4000-8000-000000000007\",
  \"command_contract_version\":1,\"effective_date\":\"2026-03-07\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"999999\",
  \"debtor_participant_id\":\"${XB}\",\"creditor_participant_id\":\"${XA}\"}" \
  SETTLEMENT_EXCEEDS_DEBT 422

# ============================================================================
echo ""
echo "== 7 · el cliente no alcanza core, y si alcanza api =="
sonda() {
  curl -s -o /dev/null -w '%{http_code}' \
    "${API}/rest/v1/$1?select=*&limit=1" \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}"
}
for rel in effect operation scope participant membership client_command; do
  e=$(sonda "${rel}")
  case "${e}" in
    200|201|206) fallo "el cliente alcanzo core.${rel} por la Data API (${e})" ;;
    *)           : ;;
  esac
done
ok "ninguna tabla de core es alcanzable por la Data API"

e=$(sonda personal_effect)
case "${e}" in
  200|206) ok "la superficie api.personal_effect si responde (${e})" ;;
  *)       fallo "api.personal_effect devolvio ${e}" ;;
esac

# Y la lectura pasa por la RLS: A ve lo suyo y nada de B.
ajenos=$(curl -s "${API}/rest/v1/personal_effect?select=scope_id" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.filter(x=>x.scope_id!=="'"${PA}"'").length)}catch{console.log("err")}})')
[ "${ajenos}" = "0" ] \
  && ok "por HTTP, A solo ve efectos de su propio Modo Personal" \
  || fallo "A alcanzo ${ajenos} efectos de otro ambito"

propios=$(curl -s "${API}/rest/v1/personal_effect?select=id" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(0)}})')
[ "${propios}" -gt 0 ] 2>/dev/null \
  && ok "y el caso POSITIVO tambien: ve ${propios} efectos suyos, asi que no es una tabla vacia" \
  || fallo "A no ve ninguno de sus propios efectos: el test de aislamiento seria vacio"

# Los importes salen como TEXTO, nunca como number JSON (F03/ADR-005 §1).
tipos=$(curl -s "${API}/rest/v1/personal_effect?select=balance_amount&limit=5" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.every(x=>x.balance_amount===null||typeof x.balance_amount==="string")?"ok":"number")}catch{console.log("err")}})')
[ "${tipos}" = "ok" ] \
  && ok "los importes cruzan HTTP como string JSON, nunca como number" \
  || fallo "algun importe salio como number JSON (${tipos})"

# ============================================================================
echo ""
echo "== 8 · provisioning del Modo Personal, por HTTP y de extremo a extremo =="
#
# Es la UNICA seccion en la que el estado previo NO se siembra como `postgres`:
# el ambito de C lo crea el provisioning real, por HTTP y con su JWT. Todo lo
# demas del check sigue sembrando a mano, porque lo que mide es otra cosa.

RC=$(alta "${EMAIL_C}" http_c)
UID_C=$(printf '%s' "${RC}" | jget id)
confirmar "${EMAIL_C}"
TOK_C=$(sesion "${EMAIL_C}" | jget access_token)

if [ -z "${TOK_C}" ]; then
  fallo "no se pudo obtener JWT del tercer usuario"
else
  # 8.1 · antes de nada, C no tiene Modo Personal. Es el estado con el que
  #       termina la Fase 5, y lo que hace necesaria esta fase.
  n=$(curl -s "${API}/rest/v1/personal_scope?select=id" \
        -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_C}" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log("err")}})')
  [ "${n}" = "0" ] \
    && ok "una cuenta recien confirmada NO tiene Modo Personal" \
    || fallo "la cuenta nueva ya tenia ${n} ambitos"

  # 8.2 · el provisioning, con la moneda recomendada por la Region.
  r=$(rpc ensure_personal_scope "${TOK_C}" "$(env_payload '{"currency_code":"MXN"}')")
  e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
  SC=$(printf '%s' "${c}" | jget scope_id)
  if [ "${e}" = "200" ] && [ -n "${SC}" ] \
     && [ "$(printf '%s' "${c}" | jget currency_code)" = "MXN" ] \
     && [ "$(printf '%s' "${c}" | jget created)" = "true" ]; then
    ok "ensure_personal_scope creo el ambito con la moneda recomendada (MXN)"
  else
    fallo "ensure_personal_scope devolvio ${e} ${c}"
  fi

  # 8.3 · las DOS filas. Sin la membresia, el dueno no ve ni sus propios
  #       efectos (invariante 11), y la vista del cliente lo demuestra por HTTP.
  n=$(curl -s "${API}/rest/v1/personal_scope?select=id,currency_code,currency_scale" \
        -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_C}" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.length===1&&a[0].currency_code==="MXN"&&a[0].currency_scale===2?"ok":JSON.stringify(a))}catch{console.log("err")}})')
  [ "${n}" = "ok" ] \
    && ok "api.personal_scope devuelve SU ambito, con su moneda y su escala" \
    || fallo "api.personal_scope devolvio ${n}"

  # 8.4 · idempotencia por HTTP, y con OTRA moneda: no crea y no la cambia.
  r=$(rpc ensure_personal_scope "${TOK_C}" "$(env_payload '{"currency_code":"JPY"}')")
  c=$(cuerpo_de "${r}")
  if [ "$(printf '%s' "${c}" | jget created)" = "false" ] \
     && [ "$(printf '%s' "${c}" | jget scope_id)" = "${SC}" ] \
     && [ "$(printf '%s' "${c}" | jget currency_code)" = "MXN" ]; then
    ok "una segunda llamada no crea nada y NO deshace la moneda elegida"
  else
    fallo "la segunda llamada devolvio ${c}"
  fi

  # 8.5 · el catalogo, que es lo que alimenta el selector de divisa.
  #
  # NO se cuenta el total: este mismo check siembra dos definiciones propias
  # —con codigos EUR y USD y otra identidad—, que es justo el caso que F03/ADR-001
  # describe. Se comprueba que las VEINTE SEMBRADAS POR MIGRACION estan, por su
  # identidad y con su escala, que es lo que de verdad importa.
  n=$(curl -s "${API}/rest/v1/currency_definition?select=id,code,scale" \
        -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_C}" \
      | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const esperado={"830e6f7e-2e33-564e-9ea3-f6c2023af1fe":["EUR",2],"34cb8424-2243-52d8-be99-e2b7d22884b8":["USD",2],
    "fe22eeff-f72b-50ce-9b37-6033833df95e":["GBP",2],"c8483062-e215-5da5-850e-cd7bfda52eff":["CHF",2],
    "f981b2f9-a022-5de8-aa6d-3af277d9dcd3":["JPY",0],"6cfbf3ad-967d-50ba-9822-f1afbb10f7f5":["CAD",2],
    "c9203a94-12aa-5d7f-8703-2ee17e524dca":["AUD",2],"c3d5768c-33be-5ab8-896e-38203ac5cc48":["NZD",2],
    "f725bdd8-5690-53a8-85c0-eabed7405c10":["SEK",2],"f2fe8324-641c-548d-b3af-411db0d39448":["NOK",2],
    "31f1a13d-3829-5af9-9b65-e5da1181b9ac":["DKK",2],"a280144a-a4a0-55cd-98db-7b8acf25a638":["PLN",2],
    "d281d5cf-cdd5-5207-93a5-df1f80e6de84":["CZK",2],"8b951c59-bbd1-539b-9336-4174fbf47bdb":["HUF",2],
    "8b33cd38-5e20-5145-bee9-c0b81c9a81ba":["RON",2],"b500e177-a2ff-5a55-b0b6-868dc91a10f6":["MXN",2],
    "50850a6c-39ff-5f35-85aa-afd6ea3732e6":["BRL",2],"6cbdabc6-2d2f-5090-a063-3a366f9fd23d":["ARS",2],
    "3304aa15-10b1-5eca-a6c8-3c149a9f91f1":["COP",2],"a85ae854-0a0d-51de-bb34-4b7a20229bb9":["CLP",0]};
  try{
    const m=new Map(JSON.parse(s).map(x=>[x.id,[x.code,x.scale]]));
    const faltan=Object.entries(esperado).filter(([id,[c,e]])=>{
      const v=m.get(id); return !v||v[0]!==c||v[1]!==e;});
    console.log(faltan.length===0?"ok":"faltan "+faltan.map(f=>f[1][0]).join(","));
  }catch{console.log("err")}});')
  [ "${n}" = "ok" ] \
    && ok "api.currency_definition entrega las 20 definiciones sembradas, con su identidad y su escala" \
    || fallo "api.currency_definition: ${n}"

  # 8.6 · cambio de moneda con el ambito VACIO. JPY es escala 0 a proposito.
  JPY_ID=f981b2f9-a022-5de8-aa6d-3af277d9dcd3
  r=$(rpc set_personal_base_currency "${TOK_C}" \
        "$(env_payload "{\"currency_definition_id\":\"${JPY_ID}\"}")")
  e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
  if [ "${e}" = "200" ] && [ "$(printf '%s' "${c}" | jget changed)" = "true" ] \
     && [ "$(printf '%s' "${c}" | jget currency_scale)" = "0" ]; then
    ok "la moneda base cambia mientras el ambito esta vacio, con su escala 0"
  else
    fallo "set_personal_base_currency devolvio ${e} ${c}"
  fi

  # 8.7 · el primer movimiento REAL, por el writer, en la moneda recien elegida.
  #       Prueba de paso que el catalogo sembrado es utilizable por el writer.
  r=$(rpc record_personal_expense "${TOK_C}" \
        "$(env_payload "{\"client_operation_id\":\"c0000000-0000-4000-8000-00000000c001\",\"command_contract_version\":2,\"effective_date\":\"2026-08-28\",\"effective_time\":\"09:30\",\"scope_id\":\"${SC}\",\"currency_definition_id\":\"${JPY_ID}\",\"amount\":\"1200\",\"concept\":\"Compra\",\"category_id\":\"${CAT_GASTO}\"}")")
  e=$(estado_de "${r}")
  [ "${e}" = "200" ] \
    && ok "el writer escribe en el ambito recien creado por el provisioning" \
    || fallo "record_personal_expense sobre el ambito provisionado devolvio ${e} $(cuerpo_de "${r}")"

  # 8.8 · y desde ese primer movimiento, la moneda queda bloqueada.
  EUR_ID=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
  r=$(rpc set_personal_base_currency "${TOK_C}" \
        "$(env_payload "{\"currency_definition_id\":\"${EUR_ID}\"}")")
  e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
  if [ "${e}" = "409" ] && printf '%s' "${c}" | grep -q 'BASE_CURRENCY_LOCKED'; then
    ok "con un movimiento existente, el cambio de moneda es 409 BASE_CURRENCY_LOCKED"
  else
    fallo "el cambio bloqueado devolvio ${e} ${c}"
  fi

  # 8.9 · y tras el rechazo la moneda sigue siendo la de antes. Ningun cambio
  #       parcial: o se cambia entera, o no se cambia.
  n=$(curl -s "${API}/rest/v1/personal_scope?select=currency_code,currency_scale" \
        -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_C}" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a[0].currency_code==="JPY"&&a[0].currency_scale===0?"ok":JSON.stringify(a))}catch{console.log("err")}})')
  [ "${n}" = "ok" ] \
    && ok "tras el 409 la moneda sigue siendo JPY con su escala 0" \
    || fallo "la vista devolvio ${n}"

  # 8.10 · aislamiento: A no ve el ambito de C.
  n=$(curl -s "${API}/rest/v1/personal_scope?select=id" \
        -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.filter(x=>x.id==="'"${SC}"'").length)}catch{console.log("err")}})')
  [ "${n}" = "0" ] \
    && ok "A no alcanza el Modo Personal de C" \
    || fallo "A alcanzo el ambito de C"

  # 8.11 · sin JWT no hay provisioning.
  r=$(rpc ensure_personal_scope "" "$(env_payload '{}')")
  e=$(estado_de "${r}")
  case "${e}" in
    200|201) fallo "se creo un Modo Personal SIN JWT (${e})" ;;
    *)       ok "sin JWT, el provisioning no responde 200 (${e})" ;;
  esac

  # 8.12 · LOS TRES RESULTADOS DE FX, POR HTTP (F11/ADR-001 §6). Es la
  #        verificacion que ningun check SQL puede dar: que PostgREST entrega
  #        cada codigo con SU estado, y en particular que «todavia no
  #        disponible» llega como 5xx, que el cliente vigente clasifica como
  #        reintentable con la misma clave, y no como rechazo terminal.
  #
  #        Solo errores: no se siembra ningun dia fijado, asi que el camino con
  #        exito no se ejerce aqui —lo cubre fx-personal-writers.sql— y la
  #        fuente `ecb` de esta base no se toca.
  #
  #        El ambito de C es el unico con una moneda del catalogo real (JPY),
  #        que es lo que la cobertura del BCE necesita.
  USD_REAL=34cb8424-2243-52d8-be99-e2b7d22884b8
  ARS_REAL=6cbdabc6-2d2f-5090-a063-3a366f9fd23d
  JPY_REAL=f981b2f9-a022-5de8-aa6d-3af277d9dcd3

  comprobar_error "FX sin fijar" record_personal_expense "${TOK_C}" "{
    \"client_operation_id\":\"c0000000-0000-4000-8000-0000000f0c01\",
    \"command_contract_version\":2,\"effective_date\":\"2099-12-31\",\"effective_time\":\"10:00\",
    \"scope_id\":\"${SC}\",\"currency_definition_id\":\"${USD_REAL}\",\"amount\":\"1000\",
    \"expected_base_currency_definition_id\":\"${JPY_REAL}\",
    \"concept\":\"Compra\",\"category_id\":\"${CAT_GASTO}\"}" \
    FX_RATE_NOT_YET_AVAILABLE 503

  # ... y el 503 no quema la clave: el reintento vuelve a esperar, no choca.
  comprobar_error "FX sin fijar, reintento con la misma clave" record_personal_expense "${TOK_C}" "{
    \"client_operation_id\":\"c0000000-0000-4000-8000-0000000f0c01\",
    \"command_contract_version\":2,\"effective_date\":\"2099-12-31\",\"effective_time\":\"10:00\",
    \"scope_id\":\"${SC}\",\"currency_definition_id\":\"${USD_REAL}\",\"amount\":\"1000\",
    \"expected_base_currency_definition_id\":\"${JPY_REAL}\",
    \"concept\":\"Compra\",\"category_id\":\"${CAT_GASTO}\"}" \
    FX_RATE_NOT_YET_AVAILABLE 503

  comprobar_error "FX sin cobertura" record_personal_income "${TOK_C}" "{
    \"client_operation_id\":\"c0000000-0000-4000-8000-0000000f0c02\",
    \"command_contract_version\":1,\"effective_date\":\"2099-12-31\",\"effective_time\":\"10:00\",
    \"scope_id\":\"${SC}\",\"currency_definition_id\":\"${ARS_REAL}\",\"amount\":\"1000\",
    \"expected_base_currency_definition_id\":\"${JPY_REAL}\",\"concept\":\"Cobro\"}" \
    FX_CURRENCY_NOT_COVERED 422

  comprobar_error "FX con otra base asumida" record_personal_expense "${TOK_C}" "{
    \"client_operation_id\":\"c0000000-0000-4000-8000-0000000f0c03\",
    \"command_contract_version\":2,\"effective_date\":\"2099-12-31\",\"effective_time\":\"10:00\",
    \"scope_id\":\"${SC}\",\"currency_definition_id\":\"${USD_REAL}\",\"amount\":\"1000\",
    \"expected_base_currency_definition_id\":\"${USD_REAL}\",
    \"concept\":\"Compra\",\"category_id\":\"${CAT_GASTO}\"}" \
    CURRENCY_CONVERSION_UNSUPPORTED 422
fi

# ============================================================================
echo ""
echo "== 9 · anatomia del movimiento, por HTTP =="
#
# Lo que solo esta ruta puede demostrar: que los campos nuevos sobreviven al
# viaje por PostgREST con sus tipos, que la vista del catalogo responde con la
# RLS del actor, y que la guarda de clase produce el estado HTTP correcto.

# 9.1 · EL CATALOGO, por la Data API. Ya no hay familias: `applies_to` no
# existe, y lo que llega son las de gasto y nada mas. Las cinco dadas de baja
# SIGUEN siendo legibles —el historico las necesita para mostrarse— pero no
# usables, que es lo que comprueba 9.10.
n=$(curl -s "${API}/rest/v1/category?select=id,message_key,icon,is_active,is_custom&order=ordinal" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);
const act=a.filter(x=>x.is_active), ing=a.filter(x=>x.message_key.startsWith("category.income."));
const iconos=a.every(x=>/^[a-z]+$/.test(x.icon));
console.log(a.length===15&&act.length===10&&ing.length===3&&ing.every(x=>!x.is_active)&&iconos
  &&a.every(x=>x.is_custom===false)&&!("applies_to" in a[0])?"ok":JSON.stringify({n:a.length,act:act.length,iconos}))}catch{console.log("err")}})')
[ "${n}" = "ok" ] \
  && ok "api.category: 10 de gasto vigentes, sin applies_to y con iconos semanticos" \
  || fallo "api.category devolvio ${n}"

# 9.2 · UN INGRESO SIN CATEGORIA, por la ruta real. Es el caso nominal ahora:
# la categoria clasifica el gasto, y el ingreso no la tiene.
r=$(rpc record_personal_income "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000001\",\"command_contract_version\":2,\"effective_date\":\"2026-02-10\",\"effective_time\":\"08:15\",\"scope_id\":\"${PA}\",\"amount\":\"150000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Nomina agosto\"}")")
e=$(estado_de "${r}"); OP_ING=$(printf '%s' "$(cuerpo_de "${r}")" | jget operation_id)
[ "${e}" = "200" ] && [ -n "${OP_ING}" ] \
  && ok "record_personal_income sin categoria: 200 por HTTP" \
  || fallo "record_personal_income devolvio ${e} $(cuerpo_de "${r}")"

# y no adquiere ninguna fila de categoria por el camino.
n=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.expense_category x
  join core.operation o on o.current_version_id = x.operation_version_id
 where o.id = '${OP_ING}';
SQL
)
[ "$(tr -d '[:space:]' <<<"${n}")" = "0" ] \
  && ok "el ingreso no deja fila en core.expense_category" \
  || fallo "el ingreso dejo ${n} filas de categoria"

# 9.3 · concepto vacio: rechazado con su estado.
r=$(rpc record_personal_income "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000002\",\"command_contract_version\":2,\"effective_date\":\"2026-02-10\",\"effective_time\":\"08:15\",\"scope_id\":\"${PA}\",\"amount\":\"1000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"   \"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "concepto en blanco: PAYLOAD_INVALID · 400"
else
  fallo "el concepto en blanco devolvio ${e} ${c}"
fi

# 9.4 · UN INGRESO CON CATEGORIA SE RECHAZA EN LA FORMA DEL PAYLOAD, no en una
# validacion posterior. `category_id` ya no es un campo admisible de esta clase,
# asi que el 400 llega antes de mirar a que apunta —y por eso el uuid de abajo
# es uno REAL Y VIGENTE: si el rechazo dependiera de la categoria, este pasaria.
r=$(rpc record_personal_income "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000003\",\"command_contract_version\":2,\"effective_date\":\"2026-02-10\",\"effective_time\":\"08:15\",\"scope_id\":\"${PA}\",\"amount\":\"1000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"X\",\"category_id\":\"${CAT_GASTO}\"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "categoria en un ingreso: PAYLOAD_INVALID · 400"
else
  fallo "el ingreso con categoria devolvio ${e} ${c}"
fi

# 9.5 · LA GUARDA DE CLASE, por HTTP y con el expected_version_id correcto.
V_ING=$("${DBQ[@]}" <<SQL 2>/dev/null
select current_version_id from core.operation where id = '${OP_ING}';
SQL
)
V_ING=$(tr -d '[:space:]' <<<"${V_ING}")
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000004\",\"command_contract_version\":2,\"effective_date\":\"2026-02-11\",\"effective_time\":\"08:15\",\"scope_id\":\"${PA}\",\"amount\":\"1000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Colado\",\"category_id\":\"${CAT_GASTO}\",\"operation_id\":\"${OP_ING}\",\"expected_version_id\":\"${V_ING}\"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "422" ] && printf '%s' "${c}" | grep -q 'OPERATION_CLASS_MISMATCH'; then
  ok "el writer de gasto no corrige un ingreso: OPERATION_CLASS_MISMATCH · 422"
else
  fallo "la correccion cruzada de clase devolvio ${e} ${c}"
fi

# 9.6 · IDEMPOTENCIA DEL INGRESO SOBRE LA INTENCION CANONICA NUEVA. La categoria
# salio de la intencion del ingreso, asi que hay que volver a medir las tres
# respuestas: reintento identico, importe distinto y concepto distinto.
BASE_ING="{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000005\",\"command_contract_version\":2,\"effective_date\":\"2026-02-12\",\"effective_time\":\"08:15\",\"scope_id\":\"${PA}\",\"currency_definition_id\":\"${EUR}\""
r=$(rpc record_personal_income "${TOK_A}" "$(env_payload "${BASE_ING},\"amount\":\"2000\",\"concept\":\"Uno\"}")")
[ "$(estado_de "${r}")" = "200" ] || fallo "el ingreso base de 9.6 devolvio $(estado_de "${r}") $(cuerpo_de "${r}")"
r=$(rpc record_personal_income "${TOK_A}" "$(env_payload "${BASE_ING},\"amount\":\"2000\",\"concept\":\"Uno\"}")")
[ "$(printf '%s' "$(cuerpo_de "${r}")" | jget already_processed)" = "true" ] \
  && ok "reintento identico: replay" || fallo "el reintento identico no fue replay"
r=$(rpc record_personal_income "${TOK_A}" "$(env_payload "${BASE_ING},\"amount\":\"2500\",\"concept\":\"Uno\"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "409" ] && printf '%s' "${c}" | grep -q 'IDEMPOTENCY_KEY_REUSED'; then
  ok "misma clave con otro importe: IDEMPOTENCY_KEY_REUSED · 409"
else
  fallo "el conflicto por importe devolvio ${e} ${c}"
fi
r=$(rpc record_personal_income "${TOK_A}" "$(env_payload "${BASE_ING},\"amount\":\"2000\",\"concept\":\"Otro\"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "409" ] && printf '%s' "${c}" | grep -q 'IDEMPOTENCY_KEY_REUSED'; then
  ok "misma clave con otro concepto: IDEMPOTENCY_KEY_REUSED · 409"
else
  fallo "el conflicto por concepto devolvio ${e} ${c}"
fi

# 9.7 · UNA CATEGORIA PROPIA SE CREA SIN FAMILIA, y con una clave de icono del
# vocabulario. No hay forma de pedir una «de ingreso»: el campo que lo permitia
# ya no se admite, asi que mandarlo es un payload invalido.
r=$(rpc create_custom_category "${TOK_A}" \
      "$(env_payload '{"applies_to":"income","label":"Alquiler","icon":"home"}')")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "no hay forma de crear una categoria de ingreso: PAYLOAD_INVALID · 400"
else
  fallo "create_custom_category acepto applies_to: ${e} ${c}"
fi

# una clave de icono fuera del vocabulario tampoco. En particular un nombre de
# SF Symbol, que es justo lo que este contrato acaba de dejar de ser.
r=$(rpc create_custom_category "${TOK_A}" \
      "$(env_payload '{"label":"Coladero","icon":"figure.run"}')")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "un nombre de SF Symbol como icono: PAYLOAD_INVALID · 400"
else
  fallo "el icono de plataforma devolvio ${e} ${c}"
fi

r=$(rpc create_custom_category "${TOK_A}" \
      "$(env_payload '{"label":"Gimnasio","icon":"leisure"}')")
e=$(estado_de "${r}"); CAT_MIA=$(printf '%s' "$(cuerpo_de "${r}")" | jget category_id)
[ "${e}" = "200" ] && [ -n "${CAT_MIA}" ] \
  && [ "$(printf '%s' "$(cuerpo_de "${r}")" | jget icon)" = "leisure" ] \
  && ok "create_custom_category con clave semantica: 200 por HTTP" \
  || fallo "create_custom_category devolvio ${e} $(cuerpo_de "${r}")"

n=$(curl -s "${API}/rest/v1/category?select=id,label,icon,is_custom&id=eq.${CAT_MIA}" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.length===1&&a[0].is_custom===true&&a[0].label==="Gimnasio"&&a[0].icon==="leisure"?"ok":JSON.stringify(a))}catch{console.log("err")}})')
[ "${n}" = "ok" ] && ok "A ve su categoria propia como is_custom" || fallo "la propia devolvio ${n}"

n=$(curl -s "${API}/rest/v1/category?select=id&id=eq.${CAT_MIA}" \
      -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_B}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log("err")}})')
[ "${n}" = "0" ] \
  && ok "B no alcanza la categoria personalizada de A: ni su existencia" \
  || fallo "B vio ${n} categorias ajenas"

# 9.8 · renombrar alcanza al historico, y el cliente no puede escribir la vista.
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000006\",\"command_contract_version\":2,\"effective_date\":\"2026-02-13\",\"effective_time\":\"20:00\",\"scope_id\":\"${PA}\",\"amount\":\"5000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Cuota\",\"category_id\":\"${CAT_MIA}\"}")")
[ "$(estado_de "${r}")" = "200" ] || fallo "el gasto con categoria propia devolvio $(estado_de "${r}") $(cuerpo_de "${r}")"
r=$(rpc rename_custom_category "${TOK_A}" \
      "$(env_payload "{\"category_id\":\"${CAT_MIA}\",\"label\":\"Deporte\"}")")
[ "$(estado_de "${r}")" = "200" ] || fallo "rename_custom_category devolvio $(estado_de "${r}") $(cuerpo_de "${r}")"
n=$("${DBQ[@]}" <<SQL 2>/dev/null
select c.label from core.expense_category x
  join core.category c on c.id = x.category_id
 where x.category_id = '${CAT_MIA}' limit 1;
SQL
)
[ "$(tr -d '[:space:]' <<<"${n}")" = "Deporte" ] \
  && ok "el renombrado alcanza al movimiento historico" \
  || fallo "el historico muestra '${n}' tras renombrar"

# 9.9 · UN GASTO SIN CATEGORIA SE RECHAZA. Es la pata de frontera del invariante
# «todo gasto tiene categoria»: el resto lo sostiene el cierre de escrituras a
# `core`, no una restriccion —ninguna FK puede exigir que la fila exista.
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000007\",\"command_contract_version\":2,\"effective_date\":\"2026-02-14\",\"effective_time\":\"20:00\",\"scope_id\":\"${PA}\",\"amount\":\"1000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Sin categoria\"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "un gasto sin categoria: PAYLOAD_INVALID · 400"
else
  fallo "el gasto sin categoria devolvio ${e} ${c}"
fi

# 9.10 · LAS TRES CATEGORIAS QUE NO SIRVEN, y las tres con el mismo codigo:
# inexistente, ajena y dada de baja. Que inexistente y ajena compartan mensaje
# es deliberado —distinguirlas revelaria que la de otra persona existe.
CAT_BAJA=$("${DBQ[@]}" <<SQL 2>/dev/null
select id from core.category
 where owner_user_id is null and not is_active and message_key = 'category.expense.utilities';
SQL
)
CAT_BAJA=$(tr -d '[:space:]' <<<"${CAT_BAJA}")
# Cada caso lleva su propio identificador escrito entero: un contador de dos
# digitos rompia el ultimo grupo del uuid, y el 400 resultante se parecia lo
# bastante a un rechazo legitimo como para pasar por uno.
for caso in "inexistente|00000000-0000-4000-8000-0000000000ff|a9000000-0000-4000-8000-000000000011" \
            "ajena|${CAT_MIA}|a9000000-0000-4000-8000-000000000012" \
            "de-baja|${CAT_BAJA}|a9000000-0000-4000-8000-000000000013"; do
  etiqueta="${caso%%|*}"; resto="${caso#*|}"; cid="${resto%%|*}"; coid="${resto##*|}"
  tok="${TOK_A}"; amb="${PA}"
  if [ "${etiqueta}" = "ajena" ]; then tok="${TOK_B}"; amb="${PB}"; fi
  r=$(rpc record_personal_expense "${tok}" \
        "$(env_payload "{\"client_operation_id\":\"${coid}\",\"command_contract_version\":2,\"effective_date\":\"2026-02-15\",\"effective_time\":\"20:00\",\"scope_id\":\"${amb}\",\"amount\":\"1000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Prueba\",\"category_id\":\"${cid}\"}")")
  e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
  if [ "${e}" = "422" ] && printf '%s' "${c}" | grep -q 'CATEGORY_NOT_USABLE'; then
    ok "categoria ${etiqueta}: CATEGORY_NOT_USABLE · 422"
  else
    fallo "la categoria ${etiqueta} devolvio ${e} ${c}"
  fi
done

# ...y la vigente generica si sirve, que es lo que hace falsables a las tres de
# arriba: sin este caso, un writer que rechazara todo tambien pasaria.
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"a9000000-0000-4000-8000-000000000020\",\"command_contract_version\":2,\"effective_date\":\"2026-02-15\",\"effective_time\":\"20:00\",\"scope_id\":\"${PA}\",\"amount\":\"1000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Con Otros\",\"category_id\":\"${CAT_GASTO}\"}")")
[ "$(estado_de "${r}")" = "200" ] \
  && ok "la categoria «Otros» vigente si sirve" \
  || fallo "el gasto con Otros devolvio $(estado_de "${r}") $(cuerpo_de "${r}")"

e=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API}/rest/v1/category" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
      -H 'Content-Type: application/json' \
      --data-binary '{"label":"Directa","icon":"tag"}')
case "${e}" in
  200|201) fallo "el cliente ESCRIBIO directamente en api.category (${e})" ;;
  *)       ok "el cliente no puede escribir api.category por la Data API (${e})" ;;
esac

# ============================================================================
echo ""
echo "== 10 · saldo objetivo y anulacion, por HTTP =="
#
# Lo que solo esta ruta demuestra: que el objetivo viaja como STRING —es un
# importe exacto y F03/ADR-005 §1 no admite otra cosa—, que el delta lo deriva el
# servidor, y que anular responde por PostgREST con el estado correcto.

# 10.1 · el saldo de partida de A, derivado.
SALDO_0=$("${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(sum(e.balance_amount),0) from core.current_effect e
 where e.scope_id = '${PA}' and e.balance_amount is not null;
SQL
)
SALDO_0=$(tr -d '[:space:]' <<<"${SALDO_0}")

# 10.2 · ajuste por OBJETIVO. El cliente no calcula ningun delta.
r=$(rpc record_adjustment "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000001\",\"command_contract_version\":2,\"effective_date\":\"2026-03-01\",\"effective_time\":\"18:00\",\"scope_id\":\"${PA}\",\"currency_definition_id\":\"${EUR}\",\"target_balance\":\"777700\"}")")
e=$(estado_de "${r}")
SALDO_1=$("${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(sum(e.balance_amount),0) from core.current_effect e
 where e.scope_id = '${PA}' and e.balance_amount is not null;
SQL
)
SALDO_1=$(tr -d '[:space:]' <<<"${SALDO_1}")
if [ "${e}" = "200" ] && [ "${SALDO_1}" = "777700" ]; then
  ok "record_adjustment con target_balance: el saldo pasa de ${SALDO_0} a ${SALDO_1}"
else
  fallo "el ajuste por objetivo devolvio ${e} y dejo el saldo en ${SALDO_1}"
fi

# 10.3 · el objetivo como NUMBER JSON se rechaza: es un importe exacto.
r=$(rpc record_adjustment "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000002\",\"command_contract_version\":2,\"effective_date\":\"2026-03-01\",\"effective_time\":\"18:00\",\"scope_id\":\"${PA}\",\"currency_definition_id\":\"${EUR}\",\"target_balance\":777700}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "un objetivo como number JSON se rechaza: PAYLOAD_INVALID · 400"
else
  fallo "el objetivo numerico devolvio ${e} ${c}"
fi

# 10.4 · delta Y objetivo a la vez.
r=$(rpc record_adjustment "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000003\",\"command_contract_version\":2,\"effective_date\":\"2026-03-01\",\"effective_time\":\"18:00\",\"scope_id\":\"${PA}\",\"currency_definition_id\":\"${EUR}\",\"delta\":\"100\",\"target_balance\":\"100\"}")")
[ "$(estado_de "${r}")" = "400" ] \
  && ok "delta y objetivo a la vez: 400" \
  || fallo "delta y objetivo a la vez devolvio $(estado_de "${r}")"

# 10.5 · ANULAR un gasto por HTTP, y el saldo vuelve.
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000004\",\"command_contract_version\":2,\"effective_date\":\"2026-03-02\",\"effective_time\":\"19:00\",\"scope_id\":\"${PA}\",\"amount\":\"5000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Se anula\",\"category_id\":\"${CAT_GASTO}\"}")")
OP_ANU=$(printf '%s' "$(cuerpo_de "${r}")" | jget operation_id)
V_ANU=$("${DBQ[@]}" <<SQL 2>/dev/null
select current_version_id from core.operation where id = '${OP_ANU}';
SQL
)
V_ANU=$(tr -d '[:space:]' <<<"${V_ANU}")

r=$(rpc annul_operation "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000005\",\"command_contract_version\":1,\"operation_id\":\"${OP_ANU}\",\"expected_version_id\":\"${V_ANU}\"}")")
e=$(estado_de "${r}")
SALDO_2=$("${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(sum(e.balance_amount),0) from core.current_effect e
 where e.scope_id = '${PA}' and e.balance_amount is not null;
SQL
)
SALDO_2=$(tr -d '[:space:]' <<<"${SALDO_2}")
if [ "${e}" = "200" ] && [ "${SALDO_2}" = "777700" ]; then
  ok "annul_operation: 200, y el saldo vuelve a ${SALDO_2}"
else
  fallo "la anulacion devolvio ${e} y dejo el saldo en ${SALDO_2}"
fi

# 10.6 · nada se borro.
n=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.effect e
  join core.operation_version ov on ov.id = e.operation_version_id
 where ov.operation_id = '${OP_ANU}';
SQL
)
[ "$(tr -d '[:space:]' <<<"${n}")" = "1" ] \
  && ok "el efecto historico de la operacion anulada sigue ahi" \
  || fallo "quedan $(tr -d '[:space:]' <<<"${n}") efectos historicos y deberia quedar 1"

# 10.7 · terminal: no se corrige una operacion anulada.
V_ANU2=$("${DBQ[@]}" <<SQL 2>/dev/null
select current_version_id from core.operation where id = '${OP_ANU}';
SQL
)
V_ANU2=$(tr -d '[:space:]' <<<"${V_ANU2}")
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000006\",\"command_contract_version\":2,\"effective_date\":\"2026-03-02\",\"effective_time\":\"19:00\",\"scope_id\":\"${PA}\",\"amount\":\"6000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Resucitar\",\"category_id\":\"${CAT_GASTO}\",\"operation_id\":\"${OP_ANU}\",\"expected_version_id\":\"${V_ANU2}\"}")")
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "409" ] && printf '%s' "${c}" | grep -q 'OPERATION_ANNULLED'; then
  ok "corregir una operacion anulada: OPERATION_ANNULLED · 409"
else
  fallo "corregir una anulada devolvio ${e} ${c}"
fi

# 10.8 · B no puede anular una operacion de A.
r=$(rpc annul_operation "${TOK_B}" \
      "$(env_payload "{\"client_operation_id\":\"aa000000-0000-4000-8000-000000000007\",\"command_contract_version\":1,\"operation_id\":\"${OP_ANU}\",\"expected_version_id\":\"${V_ANU}\"}")")
case "$(estado_de "${r}")" in
  200|201) fallo "B anulo una operacion de A" ;;
  *)       ok "B no puede anular una operacion de A ($(estado_de "${r}"))" ;;
esac

# ============================================================================
echo ""
echo "== 11 · la superficie de lectura del Modo Personal, por HTTP =="
#
# Lo que solo esta ruta demuestra, y ningun check SQL puede: que PostgREST sirve
# las tres vistas y la funcion de lote con un JWT REAL, que los importes cruzan
# como STRING —A9 cuenta columnas `bigint`, pero quien decide como se serializa
# es PostgREST—, y que un identificador ajeno enviado por la red devuelve
# 200 con lista vacia en vez de un error del que deducir existencia.

jarr() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(eval(process.argv[1]))}catch{console.log("err")}})' "$1"; }

GA=(-H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}")
GB=(-H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_B}")

# 11.1 · la lista responde, y no trae ninguna clase fuera de la lista blanca:
# las tres de F6 mas las dos que F9 publica en Personal (gasto de grupo con
# cuota, 20260909120000; pago declarado, 20260912170000 / F09/ADR-007).
lista=$(curl -s "${API}/rest/v1/personal_operation?select=operation_id,operation_class,balance_amount,original_amount,version_no,previous_version_id,concept,target_balance" "${GA[@]}")
n=$(printf '%s' "${lista}" | jarr 'a.length')
malas=$(printf '%s' "${lista}" | jarr 'a.filter(x=>!["personal_expense","personal_income","adjustment","group_expense","group_payment"].includes(x.operation_class)).length')
if [ "${n}" != "err" ] && [ "${n}" -gt 0 ] 2>/dev/null && [ "${malas}" = "0" ]; then
  ok "api.personal_operation responde con ${n} operaciones, todas de las clases publicadas"
else
  fallo "la lista devolvio n=${n} y ${malas} clases fuera de la lista blanca"
fi

# 11.2 · LOS IMPORTES CRUZAN COMO STRING. Es la mitad de F03/ADR-005 §1 que solo la
# ruta real comprueba: el catalogo dice que no hay columnas `bigint`, pero que
# PostgREST no los reserialice como number lo demuestra este byte.
tipos=$(printf '%s' "${lista}" | jarr 'a.every(x=>typeof x.balance_amount==="string" && typeof x.original_amount==="string")?"ok":"number"')
[ "${tipos}" = "ok" ] \
  && ok "balance_amount y original_amount cruzan como string JSON" \
  || fallo "algun importe de la lista salio como number JSON (${tipos})"

# 11.3 · LA ANULADA NO ASOMA, ni por la lista ni por el historial. Es la
# obligacion de F06/ADR-006 comprobada sobre la ruta real y no sobre `set_config`.
enlista=$(printf '%s' "${lista}" | jarr 'a.filter(x=>x.operation_id==="'"${OP_ANU}"'").length')
enhist=$(curl -s "${API}/rest/v1/personal_operation_version?select=operation_version_id&operation_id=eq.${OP_ANU}" "${GA[@]}" | jarr 'a.length')
if [ "${enlista}" = "0" ] && [ "${enhist}" = "0" ]; then
  ok "la operacion anulada no aparece ni en la lista ni en el historial"
else
  fallo "la anulada asoma: ${enlista} en la lista, ${enhist} en el historial"
fi

# 11.4 · EL SALDO. Una sola fila, y coincide EXACTAMENTE con el derivado por SQL
# de la proyeccion canonica. Si divergieran, la vista habria dejado de derivar.
saldo=$(curl -s "${API}/rest/v1/personal_balance?select=scope_id,balance_amount" "${GA[@]}")
filas=$(printf '%s' "${saldo}" | jarr 'a.length')
cifra=$(printf '%s' "${saldo}" | jarr 'a.length?a[0].balance_amount:"-"')
derivado=$("${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(sum(e.balance_amount),0) from core.current_effect e
 where e.scope_id = '${PA}' and e.balance_amount is not null;
SQL
)
derivado=$(tr -d '[:space:]' <<<"${derivado}")
if [ "${filas}" = "1" ] && [ "${cifra}" = "${derivado}" ]; then
  ok "api.personal_balance devuelve una fila y su saldo es el derivado: ${cifra}"
else
  fallo "el saldo devolvio ${filas} filas con ${cifra} y el derivado es ${derivado}"
fi

# 11.5 · CORREGIR, Y LEER EL «EDITADO» EN UNA SOLA CONSULTA POR PAGINA.
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"ab000000-0000-4000-8000-000000000001\",\"command_contract_version\":2,\"effective_date\":\"2026-03-03\",\"effective_time\":\"10:00\",\"scope_id\":\"${PA}\",\"amount\":\"3000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Antes\",\"category_id\":\"${CAT_GASTO}\"}")")
OP_ED=$(printf '%s' "$(cuerpo_de "${r}")" | jget operation_id)
V_ED=$("${DBQ[@]}" <<SQL 2>/dev/null
select current_version_id from core.operation where id = '${OP_ED}';
SQL
)
V_ED=$(tr -d '[:space:]' <<<"${V_ED}")
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"ab000000-0000-4000-8000-000000000002\",\"command_contract_version\":2,\"effective_date\":\"2026-03-03\",\"effective_time\":\"20:00\",\"scope_id\":\"${PA}\",\"amount\":\"4500\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Despues\",\"operation_id\":\"${OP_ED}\",\"expected_version_id\":\"${V_ED}\"}")")
# La correccion de arriba iba SIN categoria, y por eso se rechaza: corregir un
# gasto es declarar la version entera, no un delta, asi que la categoria vuelve
# a ser obligatoria en cada correccion. La de verdad la lleva.
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
if [ "${e}" = "400" ] && printf '%s' "${c}" | grep -q 'PAYLOAD_INVALID'; then
  ok "corregir un gasto sin categoria: PAYLOAD_INVALID · 400"
else
  fallo "la correccion sin categoria devolvio ${e} ${c}"
fi
r=$(rpc record_personal_expense "${TOK_A}" \
      "$(env_payload "{\"client_operation_id\":\"ab000000-0000-4000-8000-000000000003\",\"command_contract_version\":2,\"effective_date\":\"2026-03-03\",\"effective_time\":\"20:00\",\"scope_id\":\"${PA}\",\"amount\":\"4500\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Despues\",\"category_id\":\"${CAT_GASTO}\",\"operation_id\":\"${OP_ED}\",\"expected_version_id\":\"${V_ED}\"}")")
[ "$(estado_de "${r}")" = "200" ] || fallo "la correccion por HTTP devolvio $(estado_de "${r}")"

fila=$(curl -s "${API}/rest/v1/personal_operation?select=version_no,previous_version_id,original_amount,concept&operation_id=eq.${OP_ED}" "${GA[@]}")
vno=$(printf '%s' "${fila}" | jarr 'a.length?a[0].version_no:"-"')
prev=$(printf '%s' "${fila}" | jarr 'a.length?(a[0].previous_version_id||"-"):"-"')
if [ "${vno}" = "2" ] && [ "${prev}" != "-" ]; then
  ok "la lista marca la operacion como editada y publica su predecesor"
else
  fallo "la operacion corregida devolvio version_no=${vno} previous=${prev}"
fi

# LA CONSULTA UNICA POR PAGINA: `in.(...)` sobre los predecesores. Es lo que
# evita una llamada por fila para pintar la linea tachada.
ant=$(curl -s "${API}/rest/v1/personal_operation_version?select=original_amount,concept,is_current&operation_version_id=in.(${prev})" "${GA[@]}")
ant_imp=$(printf '%s' "${ant}" | jarr 'a.length?a[0].original_amount:"-"')
ant_con=$(printf '%s' "${ant}" | jarr 'a.length?a[0].concept:"-"')
ant_cur=$(printf '%s' "${ant}" | jarr 'a.length?String(a[0].is_current):"-"')
if [ "${ant_imp}" = "3000" ] && [ "${ant_con}" = "Antes" ] && [ "${ant_cur}" = "false" ]; then
  ok "el predecesor se resuelve en UNA consulta y conserva importe y concepto anteriores"
else
  fallo "el predecesor devolvio importe=${ant_imp} concepto=${ant_con} is_current=${ant_cur}"
fi

# 11.6 · EL HISTORIAL COMPLETO al abrir el movimiento.
hist=$(curl -s "${API}/rest/v1/personal_operation_version?select=version_no,original_amount,is_current&operation_id=eq.${OP_ED}&order=version_no.desc" "${GA[@]}")
hn=$(printf '%s' "${hist}" | jarr 'a.length')
hc=$(printf '%s' "${hist}" | jarr 'a.filter(x=>x.is_current).length')
if [ "${hn}" = "2" ] && [ "${hc}" = "1" ]; then
  ok "el detalle trae las 2 versiones y solo una es la vigente"
else
  fallo "el historial devolvio ${hn} versiones con ${hc} vigentes"
fi

# 11.7 · LA OBSERVACION POR LOTE, en una sola llamada para varias operaciones.
r=$(rpc observed_balance "${TOK_A}" "{\"p_operation_ids\":[\"${OP_ED}\"]}")
e=$(estado_de "${r}")
obs=$(cuerpo_de "${r}")
on=$(printf '%s' "${obs}" | jarr 'a.length')
otipo=$(printf '%s' "${obs}" | jarr 'a.every(x=>typeof x.observed_balance_before==="string"&&typeof x.observed_balance_after==="string")?"ok":"number"')
if [ "${e}" = "200" ] && [ "${on}" = "2" ] && [ "${otipo}" = "ok" ]; then
  ok "api.observed_balance devuelve por lote las 2 observaciones, como string"
else
  fallo "la observacion por lote devolvio ${e} con n=${on} tipos=${otipo}"
fi

# 11.8 · Y SIN ARGUMENTO no falla: devuelve las del actor.
r=$(rpc observed_balance "${TOK_A}" '{}')
[ "$(estado_de "${r}")" = "200" ] \
  && ok "observed_balance sin argumento responde 200 con las del actor" \
  || fallo "observed_balance sin argumento devolvio $(estado_de "${r}")"

# 11.9 · AISLAMIENTO POR LA RUTA REAL. B no ve nada de A por ninguna de las tres
# vistas, y su saldo es el suyo.
bl=$(curl -s "${API}/rest/v1/personal_operation?select=operation_id" "${GB[@]}" | jarr 'a.filter(x=>x.operation_id==="'"${OP_ED}"'").length')
bh=$(curl -s "${API}/rest/v1/personal_operation_version?select=operation_id&operation_id=eq.${OP_ED}" "${GB[@]}" | jarr 'a.length')
bs=$(curl -s "${API}/rest/v1/personal_balance?select=scope_id" "${GB[@]}" | jarr 'a.filter(x=>x.scope_id==="'"${PA}"'").length')
if [ "${bl}" = "0" ] && [ "${bh}" = "0" ] && [ "${bs}" = "0" ]; then
  ok "por HTTP, B no alcanza ni la lista, ni el historial, ni el saldo de A"
else
  fallo "B alcanzo lista=${bl} historial=${bh} saldo=${bs} de A"
fi

# 11.10 · NO ES UN ORACULO. B pide por la red la observacion de una operacion de
# A: tiene que responder 200 con lista VACIA, no un error. Un 403 o un 404 ya
# serian una senal de que la operacion existe.
r=$(rpc observed_balance "${TOK_B}" "{\"p_operation_ids\":[\"${OP_ED}\"]}")
e=$(estado_de "${r}"); n=$(printf '%s' "$(cuerpo_de "${r}")" | jarr 'a.length')
if [ "${e}" = "200" ] && [ "${n}" = "0" ]; then
  ok "un identificador ajeno devuelve 200 con lista vacia: no hay oraculo de existencia"
else
  fallo "un identificador ajeno devolvio ${e} con ${n} filas"
fi

# 11.11 · Y SIN JWT NO SE LLEGA A NADA. Medido: con la clave publicable sola,
# PostgREST resuelve al rol `anon`, que no tiene ni USAGE sobre `api`, y
# responde `401` con `42501`. No es una lista vacia: es la puerta cerrada antes
# de que la RLS tenga nada que decidir.
sin_cuerpo=$(mktemp)
for v in personal_operation personal_operation_version personal_balance; do
  sin=$(curl -s -o "${sin_cuerpo}" -w '%{http_code}' "${API}/rest/v1/${v}?select=*&limit=1" -H "apikey: ${KEY}")
  sinn=$(jarr 'a.length' <"${sin_cuerpo}")
  if [ "${sin}" = "200" ] && [ "${sinn}" != "0" ] && [ "${sinn}" != "err" ]; then
    fallo "sin JWT, api.${v} devolvio ${sin} con ${sinn} filas"
  else
    ok "sin JWT, api.${v} no entrega filas (${sin})"
  fi
done
rm -f "${sin_cuerpo}"

# ============================================================================
echo ""
echo "== 12 · las estadisticas agregadas, por HTTP =="
#
# Lo que solo esta ruta demuestra: que los importes viajan como STRING TAMBIEN
# DENTRO DEL `jsonb` —el check de catalogo cuenta columnas `bigint` y no ve
# dentro de un jsonb—, y que el intervalo llega como fecha de calendario y no
# como instante.

# 12.1 · el intervalo cerrado responde con la forma acordada.
r=$(rpc personal_statistics "${TOK_A}" '{"p_from":"2026-03-01","p_to":"2026-03-31"}')
e=$(estado_de "${r}"); c=$(cuerpo_de "${r}")
forma=$(printf '%s' "${c}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(["scope_id","currency_definition_id","income_total","expense_total","categories"].every(k=>k in o)?"ok":"faltan")}catch{console.log("err")}})')
if [ "${e}" = "200" ] && [ "${forma}" = "ok" ]; then
  ok "api.personal_statistics responde 200 con ambito, moneda, totales y categorias"
else
  fallo "la estadistica devolvio ${e} forma=${forma}: ${c}"
fi

# 12.2 · LOS IMPORTES SON CADENAS, tambien los de dentro del array.
tipos=$(printf '%s' "${c}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const t=typeof o.income_total==="string"&&typeof o.expense_total==="string"&&(o.categories||[]).every(x=>typeof x.expense_total==="string"&&typeof x.operation_count==="number");console.log(t?"ok":"number")}catch{console.log("err")}})')
[ "${tipos}" = "ok" ] \
  && ok "los totales y los importes por categoria cruzan como string JSON" \
  || fallo "algun importe de la estadistica salio como number JSON (${tipos})"

# 12.3 · el reparto CUADRA con el total. Es la afirmacion central de F06/ADR-008
# —dos superficies, un solo conjunto de hechos— comprobada sobre la ruta real.
cuadra=$(printf '%s' "${c}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const sum=(o.categories||[]).reduce((a,x)=>a+BigInt(x.expense_total),0n);console.log(sum===BigInt(o.expense_total)?"ok":sum+" vs "+o.expense_total)}catch{console.log("err")}})')
[ "${cuadra}" = "ok" ] \
  && ok "la suma de las categorias es identica al total de gastos" \
  || fallo "el reparto no cuadra con el total (${cuadra})"

# 12.4 · `Todo`: sin limites, y sigue respondiendo.
r=$(rpc personal_statistics "${TOK_A}" '{}')
[ "$(estado_de "${r}")" = "200" ] \
  && ok "sin limites -el caso Todo- responde 200" \
  || fallo "el caso Todo devolvio $(estado_de "${r}")"

# 12.5 · AISLAMIENTO: B no recibe ni un euro de A.
r=$(rpc personal_statistics "${TOK_B}" '{}')
ajeno=$(printf '%s' "$(cuerpo_de "${r}")" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(o===null?"sin-ambito":o.scope_id)}catch{console.log("err")}})')
if [ "${ajeno}" != "${PA}" ]; then
  ok "B no recibe las estadisticas del ambito de A"
else
  fallo "B recibio el ambito de A"
fi

# 12.6 · sin JWT, la puerta cerrada antes de que la RLS decida nada.
sin=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API}/rest/v1/rpc/personal_statistics" \
        -H "apikey: ${KEY}" -H 'Content-Type: application/json' --data-binary '{}')
case "${sin}" in
  200|201) fallo "sin JWT se obtuvieron estadisticas (${sin})" ;;
  *)       ok "sin JWT la estadistica no responde (${sin})" ;;
esac

# ============================================================================
echo ""
# ============================================================================
echo ""
echo "== 13 · la identidad es permanente: la frontera no ofrece ninguna baja (F10/ADR-002) =="
# Lo que solo la ruta real demuestra: que ni el contrato de F9 (`unclaim`) ni
# el de F10.A2 (`unlink`) existen para PostgREST, y que la fila propia de
# api.group_participant no publica la instancia (`link_id`) ni la procedencia
# (`claim_command_id`): la identidad de un miembro no se cita para deshacerla.
comprobar_error "unlink_participant no existe" unlink_participant "${TOK_B}" "{
  \"client_command_id\":\"a2000000-0000-4000-8000-0000000000d1\",\"command_contract_version\":1,
  \"scope_id\":\"${GZ}\",\"participant_id\":\"${ZB}\",\"link_id\":\"a2000000-0000-4000-8000-0000000000d2\"}" \
  PGRST202 404
comprobar_error "unclaim_participant no existe" unclaim_participant "${TOK_B}" "{
  \"client_command_id\":\"a2000000-0000-4000-8000-0000000000d3\",\"command_contract_version\":1,
  \"scope_id\":\"${GZ}\",\"participant_id\":\"${ZB}\",\"claim_command_id\":\"a2000000-0000-4000-8000-0000000000d4\"}" \
  PGRST202 404
v=$(curl -s "${API}/rest/v1/group_participant?scope_id=eq.${GZ}&select=*" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_A}" \
      | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const a=JSON.parse(s), mine=a.find(r=>r.is_self===true);
  // F10/ADR-003: is_departed se publica (falso para dos identidades activas); ended_at y departure_id no salen.
  console.log(a.length===2 && mine && a.every(r=>r.is_departed===false && !("link_id" in r) && !("claim_command_id" in r) && !("ended_at" in r) && !("departure_id" in r) && Object.keys(r).every(k=>!/user/.test(k))) ? "ok" : JSON.stringify(a));
})')
[ "${v}" = "ok" ] && ok "api.group_participant publica is_self e is_departed y nunca link_id, claim_command_id, ended_at, departure_id ni columna de usuario" || fallo "group_participant: ${v}"
n=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.participant_user_link where scope_id = '${GZ}';
SQL
)
[ "$(tr -d '[:space:]' <<<"${n}")" = "2" ] && ok "los dos vinculos de GZ siguen intactos" || fallo "vinculos en GZ: $(tr -d '[:space:]' <<<"${n}")"


# ============================================================================
echo ""
echo "== 14 · el modo Invitado es una sesion anonima REAL (F05), y convertirla conserva el id =="
# Lo que solo la ruta real demuestra: que GoTrue emite una sesion anonima con
# `role: authenticated` e `is_anonymous: true`, que PostgREST, la RLS y el
# writer la tratan como a cualquier actor (Personal interno, grupo,
# invitacion, gasto), y que `PUT /user` convierte ESE usuario en cuenta —mismo
# `auth.users.id` antes, durante y despues de confirmar el correo— sin mover
# una sola fila. Y, como evidencia de por que la app FALLA CERRADO al entrar
# en una cuenta existente desde un invitado: el password grant emite OTRO
# `sub`, y lo del invitado se queda con el primero.
EMAIL_G=nomey-http-guest@example.test
GQ=a0000000-0000-4000-8000-00000000ff04
GQ_YO=b0000000-0000-4000-8000-00000000aa04
GQ_ANA=b0000000-0000-4000-8000-00000000bb04
# La MXN del catalogo sembrado por migracion (la misma que la seccion 8): el
# Personal del invitado y su grupo en la misma moneda, sin ambiguedad con la
# EUR de este check.
MXN=b500e177-a2ff-5a55-b0b6-868dc91a10f6

RG=$(curl -s -X POST "${API}/auth/v1/signup" -H "apikey: ${KEY}" -H 'Content-Type: application/json' --data-binary '{}')
GUEST_UID=$(printf '%s' "${RG}" | jget user.id)
TOK_G=$(printf '%s' "${RG}" | jget access_token)
RT_G=$(printf '%s' "${RG}" | jget refresh_token)
if [ -z "${GUEST_UID}" ] || [ -z "${TOK_G}" ]; then
  fallo "GoTrue no emitio sesion anonima (enable_anonymous_sign_ins): $(printf '%s' "${RG}" | head -c 200)"
else
  v=$(printf '%s' "${RG}" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s), p=JSON.parse(Buffer.from(r.access_token.split(".")[1],"base64").toString());
  console.log(r.user.is_anonymous===true && p.is_anonymous===true && p.role==="authenticated" && p.sub===r.user.id && (r.user.email||"")==="" ? "ok" : JSON.stringify({u:r.user.is_anonymous,p:p.is_anonymous,role:p.role}));
})')
  [ "${v}" = "ok" ] && ok "sesion anonima real: is_anonymous en el usuario y en el JWT, role authenticated, sin email" || fallo "claims del invitado: ${v}"

  # El Personal interno: el modelo economico lo necesita (caja de pagos) y el invitado no lo ve.
  rr=$(rpc ensure_personal_scope "${TOK_G}" '{"payload":{"currency_code":"MXN"}}')
  [ "$(estado_de "${rr}")" = "200" ] && ok "ensure_personal_scope como invitado: $(cuerpo_de "${rr}" | jget created)" || fallo "ensure_personal_scope como invitado: ${rr}"
  # Un grupo REAL: crear, invitar, gastar, leer.
  # La presencia del creador abre HOY (fecha del servidor, UTC): el gasto se fecha igual.
  HOY_UTC=$(date -u +%F)
  llamada "create_group como invitado" create_group "${TOK_G}" "{
    \"client_command_id\":\"a1400000-0000-4000-8000-000000000001\",\"command_contract_version\":1,
    \"client_group_id\":\"${GQ}\",\"display_name\":\"Invitados\",\"emoji\":\"GRP\",\"currency_definition_id\":\"${MXN}\",
    \"creator_participant_id\":\"${GQ_YO}\",\"creator_display_name\":\"Yo\",
    \"participants\":[{\"client_participant_id\":\"${GQ_ANA}\",\"display_name\":\"Ana\"}]}"
  llamada "create_group_invitation como invitado" create_group_invitation "${TOK_G}" "{
    \"client_command_id\":\"a1400000-0000-4000-8000-000000000002\",\"command_contract_version\":1,\"scope_id\":\"${GQ}\"}"
  llamada "record_group_expense como invitado" record_group_expense "${TOK_G}" "{
    \"client_operation_id\":\"a1400000-0000-4000-8000-000000000003\",\"command_contract_version\":1,
    \"scope_id\":\"${GQ}\",\"currency_definition_id\":\"${MXN}\",\"total\":\"3000\",\"effective_date\":\"${HOY_UTC}\",
    \"concept\":\"Cena\",\"category_id\":\"${CAT_GASTO}\",\"payer_participant_id\":\"${GQ_YO}\",
    \"participants\":[\"${GQ_YO}\",\"${GQ_ANA}\"],\"split_method\":{\"kind\":\"equal\"}}"
  v=$(curl -s "${API}/rest/v1/group_balance?scope_id=eq.${GQ}&select=display_name,net_position,is_self" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G}" \
    | jarr 'a.length===2 && a.some(r=>r.is_self===true && r.net_position==="1500") ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "Saldos del grupo, leidos como invitado: dos filas, la propia a +1500" || fallo "group_balance como invitado: ${v}"

  # La huella del actor ANTES de convertir: todo cuelga de GUEST_UID.
  huella_guest() {
    "${DBQ[@]}" <<SQL 2>/dev/null | tr -d '[:space:]'
select 'memb='||(select count(*) from core.membership where user_id='${GUEST_UID}')
    ||' links='||(select count(*) from core.participant_user_link where user_id='${GUEST_UID}')
    ||' personal='||(select count(*) from core.scope where owner_user_id='${GUEST_UID}' and kind='personal')
    ||' ops='||(select count(*) from core.operation where created_by='${GUEST_UID}')
    ||' cmds='||(select count(*) from core.provisioning_command where created_by='${GUEST_UID}');
SQL
  }
  antes=$(huella_guest)
  [ "${antes}" = "memb=2links=1personal=1ops=1cmds=2" ] && ok "huella del invitado: ${antes}" || fallo "huella del invitado inesperada: ${antes}"

  # CONVERTIR: PUT /user sobre la sesion anonima. Mismo id; el correo queda pendiente de confirmar.
  RC=$(curl -s -X PUT "${API}/auth/v1/user" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G}" -H 'Content-Type: application/json' \
    --data-binary "{\"email\":\"${EMAIL_G}\",\"password\":\"${PASS}\",\"data\":{\"display_name\":\"Invitado\"}}")
  cid=$(printf '%s' "${RC}" | jget id)
  [ "${cid}" = "${GUEST_UID}" ] && ok "PUT /user responde el MISMO id (${GUEST_UID})" || fallo "PUT /user cambio o no devolvio el id: $(printf '%s' "${RC}" | head -c 200)"
  [ "$(printf '%s' "${RC}" | jget new_email)" = "${EMAIL_G}" ] && ok "el correo queda pendiente de confirmar (new_email), como exige enable_confirmations" || fallo "sin new_email pendiente: $(printf '%s' "${RC}" | head -c 200)"
  # Mientras no se confirme, sigue siendo invitado: nada se ha perdido ni movido.
  v=$("${DBQ[@]}" <<SQL 2>/dev/null | tr -d '[:space:]'
select is_anonymous::text || '/' || (email_change = '${EMAIL_G}')::text || '/' || (encrypted_password <> '')::text from auth.users where id = '${GUEST_UID}';
SQL
)
  [ "${v}" = "true/true/true" ] && ok "auth.users: sigue anonimo, con el cambio de correo pendiente y la contrasena ya puesta" || fallo "auth.users tras PUT /user: ${v}"

  # CONFIRMAR: el enlace del correo, tal como lo manda GoTrue (Mailpit, [local_smtp]).
  LINK=$(curl -s "${MAIL}/api/v1/messages?limit=5" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const m=JSON.parse(s).messages.find(x=>x.To.some(t=>t.Address===process.argv[1]));
  console.log(m?m.ID:"");
})' "${EMAIL_G}")
  if [ -z "${LINK}" ]; then
    fallo "no llego el correo de confirmacion a Mailpit (${MAIL})"
  else
    URL=$(curl -s "${MAIL}/api/v1/message/${LINK}" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const m=JSON.parse(s); const t=(m.Text||"")+" "+(m.HTML||""); const u=t.match(/https?:\/\/[^\s"<]+/g)||[];
  console.log(u.find(x=>x.includes("/auth/v1/verify"))||"");
})')
    est=$(curl -s -o /dev/null -w '%{http_code}' "${URL}")
    [ "${est}" = "303" ] && ok "el enlace de confirmacion del correo verifica (303)" || fallo "verify respondio ${est}"
  fi
  v=$("${DBQ[@]}" <<SQL 2>/dev/null | tr -d '[:space:]'
select is_anonymous::text || '/' || email || '/' || (email_confirmed_at is not null)::text from auth.users where id = '${GUEST_UID}';
SQL
)
  [ "${v}" = "false/${EMAIL_G}/true" ] && ok "auth.users: ya NO es anonimo, con el correo confirmado, y el id no ha cambiado" || fallo "auth.users tras confirmar: ${v}"

  # LA COPIA DEL DISPOSITIVO SE QUEDA VIEJA, Y COMO SE DESCUBRE (F05/ADR-003 §3):
  # el JWT anonimo guardado sigue diciendo anonimo; GET /user con ESE token ya
  # dice cuenta (autoritativo, sin rotar nada); y reenviar la conversion con la
  # copia vieja responde 422 same_password — el codigo que el cliente mapea.
  v=$(printf '%s' "{\"access_token\":\"${TOK_G}\"}" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(Buffer.from(JSON.parse(s).access_token.split(".")[1],"base64").toString());console.log(p.is_anonymous===true?"ok":"anon="+p.is_anonymous)})')
  [ "${v}" = "ok" ] && ok "el JWT que el dispositivo guardo sigue diciendo is_anonymous=true: una copia" || fallo "JWT guardado: ${v}"
  v=$(curl -s "${API}/auth/v1/user" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G}" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=JSON.parse(s);console.log(u.id===process.argv[1]&&u.is_anonymous===false&&u.email===process.argv[2]?"ok":JSON.stringify({id:u.id,anon:u.is_anonymous,email:u.email}))})' "${GUEST_UID}" "${EMAIL_G}")
  [ "${v}" = "ok" ] && ok "GET /user con el token anonimo guardado ya responde la cuenta (is_anonymous=false, mismo id)" || fallo "GET /user tras confirmar: ${v}"
  v=$(curl -s -X PUT "${API}/auth/v1/user" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G}" -H 'Content-Type: application/json'     --data-binary "{\"email\":\"${EMAIL_G}\",\"password\":\"${PASS}\",\"data\":{\"display_name\":\"Invitado\"}}" | jget error_code)
  [ "${v}" = "same_password" ] && ok "reenviar la conversion con la copia vieja: 422 same_password (medido; el cliente lo mapea y, antes, pregunta con GET /user)" || fallo "segundo PUT /user respondio: ${v}"

  # La sesion que el telefono ya tenia sigue valiendo: el refresh trae la cuenta, mismo sub.
  RR=$(curl -s -X POST "${API}/auth/v1/token?grant_type=refresh_token" -H "apikey: ${KEY}" -H 'Content-Type: application/json' --data-binary "{\"refresh_token\":\"${RT_G}\"}")
  v=$(printf '%s' "${RR}" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s); if(!r.access_token){console.log(JSON.stringify(r));return}
  const p=JSON.parse(Buffer.from(r.access_token.split(".")[1],"base64").toString());
  console.log(p.sub===process.argv[1] && p.is_anonymous===false && r.user.is_anonymous===false && r.user.email===process.argv[2] ? "ok" : JSON.stringify({sub:p.sub,anon:p.is_anonymous}));
})' "${GUEST_UID}" "${EMAIL_G}")
  [ "${v}" = "ok" ] && ok "el refresh token del invitado devuelve la cuenta: mismo sub, is_anonymous false" || fallo "refresh tras convertir: ${v}"
  TOK_G2=$(printf '%s' "${RR}" | jget access_token)
  # Y entrar con la contrasena nueva es la MISMA cuenta.
  v=$(sesion "${EMAIL_G}" | jget user.id)
  [ "${v}" = "${GUEST_UID}" ] && ok "password grant con el correo nuevo: el mismo id" || fallo "password grant devolvio otro id: ${v}"
  # La huella no se ha movido, y la cuenta lee lo que hizo como invitado.
  despues=$(huella_guest)
  [ "${despues}" = "${antes}" ] && ok "huella identica antes y despues de convertir: ${despues}" || fallo "la conversion movio filas: ${antes} → ${despues}"
  v=$(curl -s "${API}/rest/v1/group_profile?scope_id=eq.${GQ}&select=display_name,participant_count" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G2}" \
    | jarr 'a.length===1 && a[0].display_name==="Invitados" && a[0].participant_count===2 ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "la cuenta convertida sigue viendo su grupo con el token refrescado" || fallo "group_profile tras convertir: ${v}"

  # POR QUE LA APP FALLA CERRADO al entrar en una cuenta existente desde un invitado:
  # el password grant emite OTRO sub y lo del invitado se queda con el primero.
  RG2=$(curl -s -X POST "${API}/auth/v1/signup" -H "apikey: ${KEY}" -H 'Content-Type: application/json' --data-binary '{}')
  GUEST2=$(printf '%s' "${RG2}" | jget user.id)
  TOK_G3=$(printf '%s' "${RG2}" | jget access_token)
  rr=$(rpc ensure_personal_scope "${TOK_G3}" '{"payload":{"currency_code":"MXN"}}')
  other=$(sesion "${EMAIL_A}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).user.id))')
  n=$("${DBQ[@]}" <<SQL 2>/dev/null | tr -d '[:space:]'
select count(*) from core.scope where owner_user_id = '${GUEST2}';
SQL
)
  [ -n "${GUEST2}" ] && [ "${other}" = "${UID_A}" ] && [ "${other}" != "${GUEST2}" ] && [ "${n}" = "1" ] \
    && ok "medido: entrar por contrasena desde un invitado seria OTRO sub (${other}); lo del invitado (${n} ambito) se queda con ${GUEST2} — por eso el cliente lo rehusa" \
    || fallo "no se pudo medir el cambio de sub (guest2=${GUEST2}, other=${other}, uid_a=${UID_A}, n=${n})"
  [ -n "${GUEST2}" ] && GUEST2_UID="${GUEST2}"
fi

# ============================================================================
# 15 · el punto de inicio del Modo Personal tras el Invitado (F10/ADR-005)
# ============================================================================
# La cuenta convertida en §14 pago un gasto de grupo siendo invitada: tiene
# historia. La marca de origen nacio con su Personal (ensure_personal_scope
# bajo el JWT anonimo); tras convertir, el servidor pide la decision; `fresh`
# deja esa historia fuera del Personal y no de Saldos; lo posterior entra; la
# decision no se repite; un invitado sin historia se resuelve solo; una cuenta
# normal no tiene esta decision.
echo "== 15 · el punto de inicio del Modo Personal tras el Invitado (F10/ADR-005) =="
if [ -z "${TOK_G2:-}" ]; then
  fallo "sin la cuenta convertida de §14 no se puede medir §15"
else
  GG=(-H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G2}")
  rr=$(rpc ensure_personal_scope "${TOK_G2}" '{"payload":{}}')
  v=$(cuerpo_de "${rr}" | jarr 'a.provisioned_as_guest===true && a.start_mode===null && a.needs_start_decision===true ? "ok" : JSON.stringify({g:a.provisioned_as_guest,m:a.start_mode,n:a.needs_start_decision})')
  [ "$(estado_de "${rr}")" = "200" ] && [ "${v}" = "ok" ] && ok "ensure_personal_scope tras convertir: marca de invitado, sin decision, pide decidir (hay historia)" || fallo "ensure_personal_scope tras convertir: ${rr}"
  v=$(curl -s "${API}/rest/v1/personal_scope?select=provisioned_as_guest,start_mode,needs_start_decision" "${GG[@]}" \
    | jarr 'a.length===1 && a[0].provisioned_as_guest===true && a[0].start_mode===null && a[0].needs_start_decision===true ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "api.personal_scope publica lo mismo" || fallo "personal_scope: ${v}"
  v=$(curl -s "${API}/rest/v1/personal_balance?select=balance_amount" "${GG[@]}" | jarr 'a.length===1 ? a[0].balance_amount : JSON.stringify(a)')
  [ "${v}" = "-3000" ] && ok "antes de decidir, el Personal es el de siempre: Disponible ${v} (la cena que pago como invitado)" || fallo "personal_balance antes: ${v}"
  # Un include AUTOMATICO (primer acceso sin historia) se rehusa: hay historia y decide la persona.
  comprobar_error "include automatico con historia" start_personal_scope "${TOK_G2}" \
    '{"client_command_id":"a1500000-0000-4000-8000-000000000001","command_contract_version":1,"mode":"include","automatic":true}' PERSONAL_START_DECISION_REQUIRED 409
  # fresh: el punto de inicio.
  llamada "empezar desde cero" start_personal_scope "${TOK_G2}" \
    '{"client_command_id":"a1500000-0000-4000-8000-000000000002","command_contract_version":1,"mode":"fresh"}'
  v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.mode==="fresh" && a.already_processed===false && typeof a.started_at==="string" ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "la decision responde el modo y el instante" || fallo "start_personal_scope fresh: ${v}"
  v=$(curl -s "${API}/rest/v1/personal_balance?select=balance_amount" "${GG[@]}" | jarr 'a.length===1 ? a[0].balance_amount : JSON.stringify(a)')
  [ "${v}" = "0" ] && ok "Disponible 0: la caja anterior queda fuera" || fallo "personal_balance tras fresh: ${v}"
  v=$(curl -s "${API}/rest/v1/personal_operation?select=operation_id" "${GG[@]}" | jarr 'a.length')
  [ "${v}" = "0" ] && ok "historial vacio" || fallo "personal_operation tras fresh: ${v} filas"
  rr=$(rpc personal_statistics "${TOK_G2}" '{}')
  v=$(cuerpo_de "${rr}" | jarr 'a.expense_total==="0" && a.categories.length===0 ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "estadisticas a cero" || fallo "personal_statistics tras fresh: ${rr}"
  v=$(curl -s "${API}/rest/v1/group_balance?scope_id=eq.${GQ}&select=net_position,is_self" "${GG[@]}" \
    | jarr 'a.some(r=>r.is_self===true && r.net_position==="1500") ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "Saldos del grupo intactos: la deuda no se filtra (+1500 a favor)" || fallo "group_balance tras fresh: ${v}"
  v=$(curl -s "${API}/rest/v1/personal_scope?select=start_mode,needs_start_decision" "${GG[@]}" \
    | jarr 'a.length===1 && a[0].start_mode==="fresh" && a[0].needs_start_decision===false ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "decidido: no vuelve a preguntar" || fallo "personal_scope tras fresh: ${v}"
  # Idempotente por clave; no se vuelve a decidir.
  llamada "replay de la decision" start_personal_scope "${TOK_G2}" \
    '{"client_command_id":"a1500000-0000-4000-8000-000000000002","command_contract_version":1,"mode":"fresh"}'
  v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.already_processed===true && a.mode==="fresh" ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "el replay devuelve la decision original" || fallo "replay: ${v}"
  comprobar_error "otra decision" start_personal_scope "${TOK_G2}" \
    '{"client_command_id":"a1500000-0000-4000-8000-000000000003","command_contract_version":1,"mode":"include"}' PERSONAL_START_DECIDED 409
  # Lo posterior entra: un gasto de grupo nuevo, pagado por la cuenta.
  llamada "gasto de grupo despues del corte" record_group_expense "${TOK_G2}" "{
    \"client_operation_id\":\"a1500000-0000-4000-8000-000000000004\",\"command_contract_version\":1,
    \"scope_id\":\"${GQ}\",\"currency_definition_id\":\"${MXN}\",\"total\":\"1000\",\"effective_date\":\"${HOY_UTC}\",
    \"concept\":\"Desayuno\",\"category_id\":\"${CAT_GASTO}\",\"payer_participant_id\":\"${GQ_YO}\",
    \"participants\":[\"${GQ_YO}\",\"${GQ_ANA}\"],\"split_method\":{\"kind\":\"equal\"}}"
  v=$(curl -s "${API}/rest/v1/personal_balance?select=balance_amount" "${GG[@]}" | jarr 'a.length===1 ? a[0].balance_amount : JSON.stringify(a)')
  [ "${v}" = "-1000" ] && ok "Disponible -1000: solo lo posterior" || fallo "personal_balance tras el gasto posterior: ${v}"
  v=$(curl -s "${API}/rest/v1/personal_operation?select=operation_id,operation_class" "${GG[@]}" | jarr 'a.length===1 && a[0].operation_class==="group_expense" ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "historial: solo el gasto posterior" || fallo "personal_operation tras el gasto posterior: ${v}"
  # Un invitado SIN historia (el segundo de §14): include automatico, persistido.
  if [ -n "${TOK_G3:-}" ]; then
    llamada "primer acceso sin historia: include automatico" start_personal_scope "${TOK_G3}" \
      '{"client_command_id":"a1500000-0000-4000-8000-000000000005","command_contract_version":1,"mode":"include","automatic":true}'
    v=$(curl -s "${API}/rest/v1/personal_scope?select=provisioned_as_guest,start_mode,needs_start_decision" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_G3}" \
      | jarr 'a.length===1 && a[0].provisioned_as_guest===true && a[0].start_mode==="include" && a[0].needs_start_decision===false ? "ok" : JSON.stringify(a)')
    [ "${v}" = "ok" ] && ok "queda decidido como include: nunca preguntara" || fallo "personal_scope del segundo invitado: ${v}"
  fi
  # Una cuenta normal no tiene esta decision.
  comprobar_error "una cuenta normal" start_personal_scope "${TOK_A}" \
    '{"client_command_id":"a1500000-0000-4000-8000-000000000006","command_contract_version":1,"mode":"include"}' PERSONAL_START_NOT_APPLICABLE 409
  v=$(curl -s "${API}/rest/v1/personal_scope?select=provisioned_as_guest,start_mode,needs_start_decision" "${GA[@]}" \
    | jarr 'a.length===1 && a[0].provisioned_as_guest===false && a[0].start_mode===null && a[0].needs_start_decision===false ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "una cuenta normal: sin marca, sin decision, sin pregunta" || fallo "personal_scope de A: ${v}"
fi

# ============================================================================
echo ""
echo "== 16 · el alta reserva el username: hook before_user_created REAL (F12/ADR-001 §5, F12.A2) =="
# Lo que solo GoTrue demuestra: que el hook corre DENTRO de la transaccion del
# alta como supabase_auth_admin, que un alta por correo sin username, con uno
# invalido, reservado o en uso NO crea la cuenta y no deja ninguna fila, que la
# reserva del alta valido es provisional (claimed_at nulo, 7 dias) y del uid
# que GoTrue emitio, que el anonimo pasa sin tocar nada, y la FORMA EXACTA en
# que el rechazo llega al cliente: {"code":N,"error_code":"unknown","msg":"CODIGO"}.
alta16() { # $1 email, $2 data json (sin email/password); imprime "status cuerpo"
  local cuerpo estado
  cuerpo=$(mktemp)
  estado=$(curl -s -o "${cuerpo}" -w '%{http_code}' -X POST "${API}/auth/v1/signup" \
    -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
    --data-binary "{\"email\":\"$1\",\"password\":\"${PASS}\",\"data\":$2}")
  printf '%s %s\n' "${estado}" "$(tr -d '\n' <"${cuerpo}")"
  rm -f "${cuerpo}"
}
fila16() { # $1 handle → 'uid|reserva|viva|nombre' o '-'
  "${DBQ[@]}" -c "select coalesce((select h.user_id::text || '|' || (h.claimed_at is null)::text || '|' || (h.reserved_until > now())::text || '|' || i.public_name from core.account_handle h join core.account_identity i using (user_id) where h.handle = '$1'), '-');" | tr -d '[:space:]'
}
existe16() { "${DBQ[@]}" -c "select count(*) from auth.users where email = '$1';" | tr -d '[:space:]'; }

# El alta valido de «preparando»: la reserva es del uid que GoTrue emitio,
# provisional y viva, con el nombre del evento; el diario tiene un solo 'reserved'.
v=$(fila16 http_ana)
[ "${v}" = "${UID_A}|true|true|Cuentahttp_ana" ] && ok "http_ana: reservado (claimed_at nulo, 7 dias) para el uid del evento, con el display_name del alta" || fallo "reserva de A tras el alta: ${v}"
v=$("${DBQ[@]}" -c "select string_agg(event, ',' order by id) from core.account_handle_event where handle = 'http_ana';" | tr -d '[:space:]')
[ "${v}" = "reserved" ] && ok "diario de http_ana tras el alta: reserved, y nada mas" || fallo "diario tras el alta: ${v}"
v=$(fila16 http_c)
[ "${v}" = "${UID_C}|true|true|Cuentahttp_c" ] && ok "http_c: la reserva de C tambien nacio con su alta" || fallo "reserva de C: ${v}"

# Los rechazos: status, error_code y msg EXACTOS; sin cuenta y sin filas.
rechazo16() { # $1 nombre, $2 email, $3 data, $4 status, $5 codigo, $6 handle-que-no-debe-existir
  local rr ee cc
  rr=$(alta16 "$2" "$3"); ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  local ec msg
  ec=$(printf '%s' "${cc}" | jget error_code); msg=$(printf '%s' "${cc}" | jget msg)
  if [ "${ee}" = "$4" ] && [ "${ec}" = "unknown" ] && [ "${msg}" = "$5" ]; then
    ok "$1: $4 · error_code=unknown · msg=$5"
  else
    fallo "$1: se esperaba $4/unknown/$5 y llego ${ee} ${cc}"
  fi
  [ "$(existe16 "$2")" = "0" ] && ok "$1: la cuenta NO se creo" || fallo "$1: quedo un auth.users para $2"
  if [ -n "$6" ]; then
    [ "$(fila16 "$6")" = "-" ] && ok "$1: sin fila de handle/identidad" || fallo "$1: quedo fila para $6: $(fila16 "$6")"
  fi
}
IDENT_ANTES=$("${DBQ[@]}" -c "select count(*) from core.account_identity;" | tr -d '[:space:]')
rechazo16 "sin username"   nomey-http-hook-miss@example.test  '{"display_name":"Sin Username"}' 400 USERNAME_REQUIRED ""
rechazo16 "username invalido" nomey-http-hook-inv@example.test '{"display_name":"Inv","requested_username":"ab"}' 400 USERNAME_INVALID ""
rechazo16 "username reservado" nomey-http-hook-res@example.test '{"display_name":"Res","requested_username":"admin_hook"}' 422 USERNAME_RESERVED admin_hook
rechazo16 "username en uso (reserva viva de A)" nomey-http-hook-taken@example.test '{"display_name":"Taken","requested_username":"Http_Ana"}' 409 USERNAME_TAKEN ""
rechazo16 "sin nombre" nomey-http-hook-noname@example.test '{"requested_username":"hook_noname"}' 400 PAYLOAD_INVALID hook_noname
IDENT_DESPUES=$("${DBQ[@]}" -c "select count(*) from core.account_identity;" | tr -d '[:space:]')
[ "${IDENT_ANTES}" = "${IDENT_DESPUES}" ] && ok "ningun rechazo dejo identidad: ${IDENT_ANTES} antes y despues" || fallo "identidades: ${IDENT_ANTES} → ${IDENT_DESPUES}"
v=$(fila16 http_ana)
[ "${v}" = "${UID_A}|true|true|Cuentahttp_ana" ] && ok "la reserva de A sigue intacta tras el choque" || fallo "reserva de A tras el choque: ${v}"

# El alta anonima pasa por el hook sin username y sin tocar nada.
RANON=$(curl -s -w ' %{http_code}' -X POST "${API}/auth/v1/signup" -H "apikey: ${KEY}" -H 'Content-Type: application/json' --data-binary '{"data":{"display_name":"Anon Hook"}}')
ANON_UID=$(printf '%s' "${RANON% *}" | jget user.id)
if [ -n "${ANON_UID}" ] && [ "${RANON##* }" = "200" ]; then
  ok "alta anonima: 200 con sesion, sin username"
  v=$("${DBQ[@]}" -c "select count(*) from core.account_identity where user_id = '${ANON_UID}';" | tr -d '[:space:]')
  [ "${v}" = "0" ] && ok "el invitado no tiene identidad ni reserva: el hook no le pide username" || fallo "el hook creo identidad al invitado"
  "${DB[@]}" >/dev/null 2>&1 <<SQL
delete from auth.users where id = '${ANON_UID}';
SQL
else
  fallo "alta anonima con el hook activo: ${RANON}"
fi

# El hook es la UNICA puerta de supabase_auth_admin a sec, medido en el catalogo vivo.
v=$("${DBQ[@]}" -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sec' and has_function_privilege('supabase_auth_admin', p.oid, 'execute')) || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and has_function_privilege('supabase_auth_admin', p.oid, 'execute')) || '/' || has_schema_privilege('supabase_auth_admin', 'core', 'usage')::text || '/' || pg_get_userbyid((select proowner from pg_proc where oid = 'sec.before_user_created(jsonb)'::regprocedure));" | tr -d '[:space:]')
[ "${v}" = "1/0/false/nomey_provisioner" ] && ok "supabase_auth_admin: 1 funcion de sec, 0 de api, sin core; el hook es del provisioner" || fallo "privilegios de auth_admin: ${v}"

# ============================================================================
echo ""
echo "== 17 · el username por HTTP con JWT real (F12/ADR-001, F12.A1) =="
# Lo que solo la ruta real demuestra: que las cinco funciones del provisioner
# responden por PostgREST con el JWT real, que los codigos viajan con su
# estado, que un JWT ANONIMO real (is_anonymous en el token) reserva y no
# reclama, que la vista propia es solo la fila propia, y que el resolver
# devuelve estados, nunca un identificador interno. A y B llegan con la
# reserva provisional que el hook de alta les hizo (§16): la primera llamada
# de A la RECLAMA (mismo handle), no la crea.
r16() { # $1 nombre, $2 fn, $3 tok, $4 body (ya con el parametro), $5 estado esperado
  local rr ee cc
  rr=$(rpc "$2" "$3" "$4"); ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  ULTIMO_CUERPO="${cc}"
  [ "${ee}" = "$5" ] && ok "$1: ${ee}" || fallo "$1 devolvio ${ee} y se esperaba $5: ${cc}"
}
estado16() { printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.length===1 ? (a[0].handle||"-")+"|"+(a[0].state||"-")+"|"+(a[0].reserved_until?"until":"-")+"|"+(a[0].can_change_at?"can":"-") : JSON.stringify(a)'; }
codigo16() { printf '%s' "${ULTIMO_CUERPO}" | jget code; }

# A reserva: cuenta normal → reclamado en el acto; repetir devuelve el estado.
r16 "reserve_username como A (reclama la reserva del alta)" reserve_username "${TOK_A}" '{"payload":{"handle":" @Http_Ana ","public_name":"Ana"}}' 200
[ "$(estado16)" = "http_ana|claimed|-|can" ] && ok "A: http_ana definitivo, sin reserva provisional" || fallo "estado de A: $(estado16)"
r16 "reserve_username otra vez (idempotente)" reserve_username "${TOK_A}" '{"payload":{"handle":"http_ana"}}' 200
[ "$(estado16)" = "http_ana|claimed|-|can" ] && ok "A: el mismo estado" || fallo "estado de A tras repetir: $(estado16)"
v=$("${DBQ[@]}" -c "select count(*) from core.account_handle_event e join auth.users u on u.id = e.user_id where u.email = '${EMAIL_A}';" | tr -d '[:space:]')
[ "${v}" = "2" ] && ok "A: dos eventos (reserved, claimed) y ninguno por repetir" || fallo "eventos de A tras repetir: ${v}"
r16 "A pide OTRO handle desde reserve" reserve_username "${TOK_A}" '{"payload":{"handle":"http_ana_otra"}}' 400
[ "$(codigo16)" = "PAYLOAD_INVALID" ] && ok "con definitivo, otro handle no es reservar: PAYLOAD_INVALID · 400 (change_username es el comando)" || fallo "codigo: $(codigo16)"
v=$(curl -s "${API}/rest/v1/my_account_handle?select=handle" "${GA[@]}" | jarr 'a.length===1 && a[0].handle==="http_ana" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "A sigue con http_ana" || fallo "vista de A tras el rechazo: ${v}"
# Los codigos, con su estado HTTP.
r16 "B pide el de A" reserve_username "${TOK_B}" '{"payload":{"handle":"HTTP_ANA","public_name":"Bea"}}' 409
[ "$(codigo16)" = "USERNAME_TAKEN" ] && ok "USERNAME_TAKEN · 409" || fallo "codigo: $(codigo16)"
r16 "B pide uno reservado" reserve_username "${TOK_B}" '{"payload":{"handle":"admin_b","public_name":"Bea"}}' 422
[ "$(codigo16)" = "USERNAME_RESERVED" ] && ok "USERNAME_RESERVED · 422" || fallo "codigo: $(codigo16)"
r16 "B pide uno invalido" reserve_username "${TOK_B}" '{"payload":{"handle":"b","public_name":"Bea"}}' 400
[ "$(codigo16)" = "USERNAME_INVALID" ] && ok "USERNAME_INVALID · 400" || fallo "codigo: $(codigo16)"
# B solo tiene la RESERVA del alta: resolver exige un definitivo.
r16 "B resuelve con solo una reserva" resolve_username "${TOK_B}" '{"p_handle":"http_ana"}' 409
[ "$(codigo16)" = "USERNAME_REQUIRED" ] && ok "USERNAME_REQUIRED · 409" || fallo "codigo: $(codigo16)"
# Y la reclama por claim_username, que es lo que hara el ciclo autenticado (F12.A3).
r16 "B reclama la reserva del alta" claim_username "${TOK_B}" '{}' 200
[ "$(estado16)" = "http_bea|claimed|-|can" ] && ok "B: http_bea definitivo por claim" || fallo "estado de B tras claim: $(estado16)"
r16 "B reclama otra vez (idempotente)" claim_username "${TOK_B}" '{}' 200
[ "$(estado16)" = "http_bea|claimed|-|can" ] && ok "B: el mismo estado" || fallo "estado de B tras repetir claim: $(estado16)"
v=$("${DBQ[@]}" -c "select string_agg(event, ',' order by id) from core.account_handle_event where handle = 'http_bea';" | tr -d '[:space:]')
[ "${v}" = "reserved,claimed" ] && ok "diario de http_bea: reserved (hook), claimed (claim); nada por repetir" || fallo "diario de B: ${v}"
# C reclama sin reserva viva: la del alta se retira como fixture → USERNAME_REQUIRED.
"${DB[@]}" >/dev/null 2>&1 <<SQL
delete from core.account_handle_event where handle = 'http_c';
delete from core.account_handle where handle = 'http_c';
SQL
r16 "C reclama sin reserva" claim_username "${TOK_C}" '{}' 409
[ "$(codigo16)" = "USERNAME_REQUIRED" ] && ok "claim sin reserva: USERNAME_REQUIRED · 409" || fallo "codigo: $(codigo16)"
# Cambio y cooldown.
r16 "A cambia" change_username "${TOK_A}" '{"payload":{"handle":"http_ana2"}}' 200
[ "$(estado16)" = "http_ana2|claimed|-|can" ] && ok "A: http_ana2; http_ana queda retenido" || fallo "estado de A tras cambiar: $(estado16)"
r16 "A cambia otra vez" change_username "${TOK_A}" '{"payload":{"handle":"http_ana3"}}' 409
v=$(printf '%s' "${ULTIMO_CUERPO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s);let d={};try{d=JSON.parse(e.details)}catch{};console.log(e.code==="USERNAME_CHANGE_COOLDOWN"&&typeof d.available_at==="string"?"ok":JSON.stringify(e))})')
[ "${v}" = "ok" ] && ok "USERNAME_CHANGE_COOLDOWN · 409 con details.available_at" || fallo "cooldown: ${v}"
r16 "B pide el retenido de A" change_username "${TOK_B}" '{"payload":{"handle":"http_ana"}}' 409
[ "$(codigo16)" = "USERNAME_TAKEN" ] && ok "el retenido no se toma: USERNAME_TAKEN" || fallo "codigo: $(codigo16)"
# Nombre publico.
r16 "A pone nombre publico" set_public_name "${TOK_A}" '{"payload":{"public_name":"  Ana   HTTP "}}' 200
v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.length===1 && a[0].public_name==="Ana HTTP" && a[0].handle==="http_ana2" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "public_name canonico junto al handle" || fallo "set_public_name: ${v}"
# El resolver: estados, y ni un identificador interno.
r16 "B resuelve a A" resolve_username "${TOK_B}" '{"p_handle":"@Http_Ana2"}' 200
v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.length===1 && a[0].state==="found" && a[0].handle==="http_ana2" && a[0].public_name==="Ana HTTP" && Object.keys(a[0]).sort().join(",")==="handle,public_name,state" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "found · http_ana2 · Ana HTTP; solo state, handle y public_name" || fallo "resolve found: ${v}"
r16 "B resuelve el retenido" resolve_username "${TOK_B}" '{"p_handle":"http_ana"}' 200
v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.length===1 && a[0].state==="not_found" && a[0].handle===null ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "retenido: not_found" || fallo "resolve retenido: ${v}"
r16 "B se resuelve" resolve_username "${TOK_B}" '{"p_handle":"http_bea"}' 200
v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.length===1 && a[0].state==="self" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "self" || fallo "resolve self: ${v}"
# El freno: 20 consultas que cuentan en 10 minutos; la siguiente es throttled, con 200.
n=0; est=""
while [ "${n}" -lt 30 ]; do
  n=$((n + 1))
  rr=$(rpc resolve_username "${TOK_B}" "{\"p_handle\":\"nadie_${n}\"}")
  est=$(cuerpo_de "${rr}" | jarr 'a.length===1 ? a[0].state : "err"')
  [ "${est}" = "throttled" ] && break
done
# B ya habia consumido 2 (found + not_found): la 19.a de este bucle es la 21.a y frena.
[ "${est}" = "throttled" ] && [ "${n}" -eq 19 ] && ok "throttled tras 20 consultas que cuentan (la ${n}.a del bucle), con 200" || fallo "freno: estado ${est} en la consulta ${n}"
v=$("${DBQ[@]}" -c "select count(*) from core.username_lookup_attempt a join auth.users u on u.id = a.user_id where u.email = '${EMAIL_B}';" | tr -d '[:space:]')
[ "${v}" = "20" ] && ok "20 apuntes de B, y ninguno mas al frenar" || fallo "apuntes de B: ${v}"
v=$("${DBQ[@]}" -c "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='core' and table_name='username_lookup_attempt';" | tr -d '[:space:]')
[ "${v}" = "attempted_at,user_id" ] && ok "el apunte guarda quien y cuando, nunca lo consultado" || fallo "columnas del apunte: ${v}"
# La vista propia.
v=$(curl -s "${API}/rest/v1/my_account_handle?select=handle,public_name,state,reserved_until,can_change_at" "${GA[@]}" | jarr 'a.length===1 && a[0].handle==="http_ana2" && a[0].state==="claimed" && a[0].public_name==="Ana HTTP" && a[0].reserved_until===null && a[0].can_change_at!==null ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_account_handle de A: su fila y solo la suya" || fallo "vista de A: ${v}"
v=$(curl -s "${API}/rest/v1/my_account_handle?select=handle" "${GB[@]}" | jarr 'a.length===1 && a[0].handle==="http_bea" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_account_handle de B: la suya" || fallo "vista de B: ${v}"
v=$(curl -s -o /dev/null -w '%{http_code}' "${API}/rest/v1/my_account_handle" -H "apikey: ${KEY}")
[ "${v}" != "200" ] && ok "sin JWT la vista no responde 200 (${v})" || fallo "la vista respondio 200 sin JWT"
# El invitado REAL (JWT anonimo del segundo invitado de §14): reserva, y nada mas.
if [ -n "${TOK_G3:-}" ]; then
  r16 "invitado sin public_name la primera vez" reserve_username "${TOK_G3}" '{"payload":{"handle":"http_guest"}}' 400
  [ "$(codigo16)" = "PAYLOAD_INVALID" ] && ok "PAYLOAD_INVALID · 400: la primera reserva trae el nombre" || fallo "codigo: $(codigo16)"
  r16 "invitado reserva" reserve_username "${TOK_G3}" '{"payload":{"handle":"http_guest","public_name":"Invitado"}}' 200
  [ "$(estado16)" = "http_guest|reserved|until|-" ] && ok "invitado: reserva provisional con reserved_until, sin reclamar" || fallo "estado del invitado: $(estado16)"
  r16 "invitado reclama" claim_username "${TOK_G3}" '{}' 403
  [ "$(codigo16)" = "NOT_AUTHORIZED" ] && ok "claim anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo16)"
  r16 "invitado cambia" change_username "${TOK_G3}" '{"payload":{"handle":"http_guest2"}}' 403
  [ "$(codigo16)" = "NOT_AUTHORIZED" ] && ok "change anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo16)"
  r16 "invitado resuelve" resolve_username "${TOK_G3}" '{"p_handle":"http_ana2"}' 403
  [ "$(codigo16)" = "NOT_AUTHORIZED" ] && ok "resolve anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo16)"
  r16 "invitado pone nombre" set_public_name "${TOK_G3}" '{"payload":{"public_name":"X"}}' 403
  [ "$(codigo16)" = "NOT_AUTHORIZED" ] && ok "set_public_name anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo16)"
  r16 "A resuelve la reserva del invitado" resolve_username "${TOK_A}" '{"p_handle":"http_guest"}' 200
  v=$(printf '%s' "${ULTIMO_CUERPO}" | jarr 'a.length===1 && a[0].state==="not_found" ? "ok" : JSON.stringify(a)')
  [ "${v}" = "ok" ] && ok "una reserva sin reclamar no resuelve: not_found" || fallo "resolve reserva: ${v}"
  r16 "B pide la reserva del invitado" change_username "${TOK_B}" '{"payload":{"handle":"http_guest"}}' 409
  [ "$(codigo16)" = "USERNAME_TAKEN" ] && ok "la reserva viva protege el handle: USERNAME_TAKEN" || fallo "codigo: $(codigo16)"
else
  fallo "sin JWT anonimo de la seccion 14: no se midio el invitado en §16"
fi
# Sin JWT, ninguna de las cinco.
for fn in reserve_username claim_username change_username set_public_name resolve_username; do
  rr=$(rpc "${fn}" "" '{}')
  ee=$(estado_de "${rr}")
  case "${ee}" in 200|201) fallo "${fn} se acepto SIN JWT (${ee})" ;; *) ok "${fn} sin JWT: ${ee}" ;; esac
done

# ============================================================================
echo ""
echo "== 18 · transferencias entre usuarios con dos voluntades, por HTTP (F12/ADR-002, F12.B1) =="
# Lo que solo la ruta real demuestra: que la propuesta y su aceptacion
# responden por PostgREST con el JWT real de cada parte, que los codigos
# viajan con su estado, que el estado not_found viaja con 200, que el freno
# compartido del resolver frena tambien aqui (B llega FRENADO de §17), que las
# vistas publican la identidad actual de la contraparte y ni un uid ni un
# ambito ajeno, y que la sexta clase —la que §4 ya no escribe de una sola
# voluntad— queda persistida por A y B. A es http_ana2 (cambio en §17); B,
# http_bea; C no tiene handle (§17 le retiro la reserva).
r18() { # $1 nombre, $2 fn, $3 tok, $4 body (ya con el parametro), $5 estado esperado
  local rr ee cc
  rr=$(rpc "$2" "$3" "$4"); ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  ULTIMO_CUERPO="${cc}"
  [ "${ee}" = "$5" ] && ok "$1: ${ee}" || fallo "$1 devolvio ${ee} y se esperaba $5: ${cc}"
}
codigo18() { printf '%s' "${ULTIMO_CUERPO}" | jget code; }
campo18() { printf '%s' "${ULTIMO_CUERPO}" | jget "$1"; }

# 18.1 · B llega frenado de §17: proponer resuelve con el mismo freno.
r18 "B propone frenado" create_transfer_proposal "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000001\",\"command_contract_version\":1,\"handle\":\"http_ana2\",\"amount\":\"500\",\"currency_definition_id\":\"${EUR}\"}")" 429
[ "$(codigo18)" = "RECIPIENT_LOOKUP_THROTTLED" ] && ok "RECIPIENT_LOOKUP_THROTTLED · 429: el freno del resolver es el mismo" || fallo "codigo: $(codigo18)"
v=$("${DBQ[@]}" -c "select count(*) from core.username_lookup_attempt a join auth.users u on u.id = a.user_id where u.email = '${EMAIL_B}';" | tr -d '[:space:]')
[ "${v}" = "20" ] && ok "frenado no apunta: B sigue en 20" || fallo "apuntes de B: ${v}"

# 18.2 · A propone a @http_bea: 200 con proposal_id y state pending; NINGUNA operacion.
ops_antes=$("${DBQ[@]}" -c "select count(*) from core.operation where operation_class = 'internal_transfer' and created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')
r18 "A propone a B" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000002\",\"command_contract_version\":1,\"handle\":\" @HTTP_BEA \",\"amount\":\"10000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"  Cena  \"}")" 200
PROP_1=$(campo18 proposal_id)
[ "$(campo18 state)" = "pending" ] && [ -n "${PROP_1}" ] && [ "$(campo18 already_processed)" = "false" ] && ok "state pending, proposal_id ${PROP_1:0:8}…, already_processed=false" || fallo "cuerpo de la propuesta: ${ULTIMO_CUERPO}"
v=$(printf '%s' "${ULTIMO_CUERPO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(Object.keys(o).sort().join(","))})')
[ "${v}" = "already_processed,expires_at,proposal_id,state" ] && ok "la respuesta trae exactamente already_processed, expires_at, proposal_id y state: ni uid ni ambito" || fallo "claves de la respuesta: ${v}"
ops_despues=$("${DBQ[@]}" -c "select count(*) from core.operation where operation_class = 'internal_transfer' and created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')
[ "${ops_antes}" = "${ops_despues}" ] && ok "proponer no crea operacion" || fallo "proponer creo una operacion"
r18 "A repite la clave (replay)" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000002\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"10000\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Cena\"}")" 200
[ "$(campo18 proposal_id)" = "${PROP_1}" ] && [ "$(campo18 already_processed)" = "true" ] && ok "replay: la misma propuesta, already_processed=true" || fallo "replay: ${ULTIMO_CUERPO}"
r18 "A misma clave, otra intencion" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000002\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"10001\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Cena\"}")" 409
[ "$(codigo18)" = "IDEMPOTENCY_KEY_REUSED" ] && ok "IDEMPOTENCY_KEY_REUSED · 409" || fallo "codigo: $(codigo18)"

# 18.3 · los rechazos de §5 y §20 con su estado.
r18 "A a si misma" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000003\",\"command_contract_version\":1,\"handle\":\"http_ana2\",\"amount\":\"5\",\"currency_definition_id\":\"${EUR}\"}")" 400
[ "$(codigo18)" = "PAYLOAD_INVALID" ] && ok "a uno mismo: PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo18)"
r18 "A a nadie" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000004\",\"command_contract_version\":1,\"handle\":\"nadie_http\",\"amount\":\"5\",\"currency_definition_id\":\"${EUR}\"}")" 200
[ "$(campo18 state)" = "not_found" ] && [ -z "$(campo18 proposal_id)" ] && ok "nadie tiene ese username: state not_found con 200, sin proposal_id" || fallo "not_found: ${ULTIMO_CUERPO}"
r18 "A con el payload de F3" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000005\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"5\",\"currency_definition_id\":\"${EUR}\",\"from_scope_id\":\"${PA}\"}")" 400
[ "$(codigo18)" = "PAYLOAD_INVALID" ] && ok "from_scope_id ya no es un campo: PAYLOAD_INVALID" || fallo "codigo: $(codigo18)"
r18 "A en otra moneda" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000006\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"5\",\"currency_definition_id\":\"${USD}\"}")" 422
[ "$(codigo18)" = "CURRENCY_CONVERSION_UNSUPPORTED" ] && ok "otra moneda que la base: CURRENCY_CONVERSION_UNSUPPORTED · 422" || fallo "codigo: $(codigo18)"
r18 "C sin handle propone" create_transfer_proposal "${TOK_C}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000007\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"5\",\"currency_definition_id\":\"${EUR}\"}")" 409
[ "$(codigo18)" = "USERNAME_REQUIRED" ] && ok "sin username definitivo: USERNAME_REQUIRED · 409" || fallo "codigo: $(codigo18)"
if [ -n "${TOK_G3:-}" ]; then
  r18 "el invitado propone" create_transfer_proposal "${TOK_G3}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000008\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"5\",\"currency_definition_id\":\"${EUR}\"}")" 403
  [ "$(codigo18)" = "NOT_AUTHORIZED" ] && ok "anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo18)"
fi

# 18.4 · las vistas antes de aceptar: A la ve saliente y pending con la identidad de B; B la ve entrante con la de A (http_ana2, Ana HTTP).
v=$(curl -s "${API}/rest/v1/my_transfer_proposals?select=*" "${GA[@]}" | jarr 'a.length===1 && a[0].direction==="outgoing" && a[0].state==="pending" && a[0].counterpart_handle==="http_bea" && a[0].amount==="10000" && a[0].concept==="Cena" && Object.keys(a[0]).sort().join(",")==="accepted_operation_id,amount,concept,counterpart_handle,counterpart_public_name,created_at,currency_definition_id,direction,expires_at,proposal_id,state" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfer_proposals de A: saliente, pending, @http_bea, importe como texto, sin uid ni ambito" || fallo "vista de A: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfer_proposals?select=direction,state,counterpart_handle,counterpart_public_name" "${GB[@]}" | jarr 'a.length===1 && a[0].direction==="incoming" && a[0].state==="pending" && a[0].counterpart_handle==="http_ana2" && a[0].counterpart_public_name==="Ana HTTP" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfer_proposals de B: entrante, pending, @http_ana2 · Ana HTTP" || fallo "vista de B: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfer_proposals?select=proposal_id" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_C}" | jarr 'a.length===0 ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "C no ve la propuesta de otros" || fallo "vista de C: ${v}"

# 18.5 · aceptar: solo B. C → NOT_AUTHORIZED; A (quien propuso) → NOT_AUTHORIZED; corregir → TRANSFER_NOT_EDITABLE.
r18 "C acepta" record_internal_transfer "${TOK_C}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000011\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_1}\"}")" 403
[ "$(codigo18)" = "NOT_AUTHORIZED" ] && ok "un tercero no acepta: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo18)"
r18 "A acepta la suya" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000012\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_1}\"}")" 403
[ "$(codigo18)" = "NOT_AUTHORIZED" ] && ok "quien propuso no materializa: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo18)"
r18 "B con el payload de F3" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000013\",\"command_contract_version\":1,\"effective_date\":\"2026-02-04\",\"from_scope_id\":\"${PA}\",\"to_scope_id\":\"${PB}\",\"amount\":\"10000\",\"currency_definition_id\":\"${EUR}\"}")" 400
[ "$(codigo18)" = "PAYLOAD_INVALID" ] && ok "el contrato de F3 ya no existe: PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo18)"
SALDO_A18=$("${DBQ[@]}" -c "select coalesce(sum(e.balance_amount),0) from core.current_effect e where e.scope_id = '${PA}' and e.balance_amount is not null;" | tr -d '[:space:]')
r18 "B acepta" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000014\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_1}\"}")" 200
OP_T18=$(campo18 operation_id)
[ -n "${OP_T18}" ] && [ "$(campo18 already_processed)" = "false" ] && ok "aceptada: operation_id ${OP_T18:0:8}…" || fallo "aceptar: ${ULTIMO_CUERPO}"
r18 "B acepta otra vez (replay)" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000014\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_1}\"}")" 200
[ "$(campo18 operation_id)" = "${OP_T18}" ] && [ "$(campo18 already_processed)" = "true" ] && ok "replay: la misma operacion" || fallo "replay: ${ULTIMO_CUERPO}"
r18 "B con otra clave (otro dispositivo)" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000015\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_1}\"}")" 409
[ "$(codigo18)" = "PROPOSAL_ACCEPTED" ] && ok "PROPOSAL_ACCEPTED · 409: una sola operacion" || fallo "codigo: $(codigo18)"
v=$("${DBQ[@]}" -c "select coalesce(sum(e.balance_amount),0) from core.current_effect e where e.scope_id = '${PA}' and e.balance_amount is not null;" | tr -d '[:space:]')
[ "${v}" = "$((SALDO_A18 - 10000))" ] && ok "el Disponible de A baja 10000 (${SALDO_A18} → ${v})" || fallo "saldo de A: ${SALDO_A18} → ${v}"
v=$("${DBQ[@]}" -c "select o.created_by = '${UID_B}' and ov.version_no = 1 and ov.effective_date = current_date and tp.from_scope_id = '${PA}' and tp.to_scope_id = '${PB}' from core.operation o join core.operation_version ov on ov.id = o.current_version_id join core.transfer_part tp on tp.operation_version_id = ov.id where o.id = '${OP_T18}';" | tr -d '[:space:]')
[ "${v}" = "t" ] && ok "created_by = B, una version, fecha del servidor, partes PA → PB" || fallo "anatomia de la transferencia: ${v}"
ejercitadas=$("${DBQ[@]}" -c "select count(*) from core.operation where operation_class = 'internal_transfer' and created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')
[ "${ejercitadas}" = "1" ] && ok "con esta, la sexta clase (internal_transfer) quedo escrita por la ruta HTTP: las cinco de §4 y esta" || fallo "internal_transfer escritas por A y B: ${ejercitadas}, y debia ser 1"

# 18.6 · irreversible: corregir y anular, por las dos partes.
VER_T18=$("${DBQ[@]}" -c "select current_version_id from core.operation where id = '${OP_T18}';" | tr -d '[:space:]')
r18 "B corrige" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000016\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_1}\",\"operation_id\":\"${OP_T18}\",\"expected_version_id\":\"${VER_T18}\"}")" 422
[ "$(codigo18)" = "TRANSFER_NOT_EDITABLE" ] && ok "TRANSFER_NOT_EDITABLE · 422" || fallo "codigo: $(codigo18)"
r18 "B anula" annul_operation "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000017\",\"command_contract_version\":1,\"operation_id\":\"${OP_T18}\",\"expected_version_id\":\"${VER_T18}\"}")" 422
[ "$(codigo18)" = "OPERATION_NOT_ANNULLABLE" ] && ok "anular como receptor: OPERATION_NOT_ANNULLABLE · 422" || fallo "codigo: $(codigo18)"
r18 "A anula" annul_operation "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000018\",\"command_contract_version\":1,\"operation_id\":\"${OP_T18}\",\"expected_version_id\":\"${VER_T18}\"}")" 422
[ "$(codigo18)" = "OPERATION_NOT_ANNULLABLE" ] && ok "anular como emisor: OPERATION_NOT_ANNULLABLE · 422" || fallo "codigo: $(codigo18)"
v=$("${DBQ[@]}" -c "select count(*) from core.operation_version where operation_id = '${OP_T18}';" | tr -d '[:space:]')
[ "${v}" = "1" ] && ok "sigue con una sola version" || fallo "versiones: ${v}"

# 18.7 · rechazar y cancelar: B propone a A (tras vaciar su freno como fixture), A rechaza; A propone, A cancela; codigos cruzados.
"${DB[@]}" >/dev/null 2>&1 <<SQL
delete from core.username_lookup_attempt a using auth.users u where u.id = a.user_id and u.email = '${EMAIL_B}';
SQL
r18 "B propone a A" create_transfer_proposal "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000021\",\"command_contract_version\":1,\"handle\":\"http_ana2\",\"amount\":\"700\",\"currency_definition_id\":\"${EUR}\"}")" 200
PROP_2=$(campo18 proposal_id)
r18 "B rechaza la suya" decline_transfer_proposal "${TOK_B}" "$(env_payload "{\"proposal_id\":\"${PROP_2}\"}")" 403
[ "$(codigo18)" = "NOT_AUTHORIZED" ] && ok "quien propuso no rechaza: NOT_AUTHORIZED" || fallo "codigo: $(codigo18)"
r18 "A cancela la de B" cancel_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${PROP_2}\"}")" 403
[ "$(codigo18)" = "NOT_AUTHORIZED" ] && ok "el receptor no cancela: NOT_AUTHORIZED" || fallo "codigo: $(codigo18)"
r18 "A rechaza" decline_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${PROP_2}\"}")" 200
[ "$(campo18 state)" = "declined" ] && ok "declined" || fallo "rechazar: ${ULTIMO_CUERPO}"
r18 "A rechaza otra vez" decline_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${PROP_2}\"}")" 200
[ "$(campo18 already_processed)" = "true" ] && ok "idempotente por estado" || fallo "repetir rechazo: ${ULTIMO_CUERPO}"
r18 "A acepta la rechazada" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000022\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_2}\"}")" 409
[ "$(codigo18)" = "PROPOSAL_DECLINED" ] && ok "PROPOSAL_DECLINED · 409" || fallo "codigo: $(codigo18)"
r18 "A propone a B otra vez" create_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a1800000-0000-4000-8000-000000000023\",\"command_contract_version\":1,\"handle\":\"http_bea\",\"amount\":\"300\",\"currency_definition_id\":\"${EUR}\"}")" 200
PROP_3=$(campo18 proposal_id)
r18 "A cancela" cancel_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${PROP_3}\"}")" 200
[ "$(campo18 state)" = "cancelled" ] && ok "cancelled" || fallo "cancelar: ${ULTIMO_CUERPO}"
r18 "B acepta la cancelada" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1800000-0000-4000-8000-000000000024\",\"command_contract_version\":1,\"proposal_id\":\"${PROP_3}\"}")" 409
[ "$(codigo18)" = "PROPOSAL_CANCELLED" ] && ok "PROPOSAL_CANCELLED · 409" || fallo "codigo: $(codigo18)"
r18 "B rechaza la cancelada" decline_transfer_proposal "${TOK_B}" "$(env_payload "{\"proposal_id\":\"${PROP_3}\"}")" 409
[ "$(codigo18)" = "PROPOSAL_CANCELLED" ] && ok "rechazar una cancelada: PROPOSAL_CANCELLED · 409" || fallo "codigo: $(codigo18)"

# 18.8 · las vistas despues: A ve sus tres (accepted, cancelled) y la rechazada de B NO (ya no es pending); B ve solo la suya (declined) y ninguna entrante.
v=$(curl -s "${API}/rest/v1/my_transfer_proposals?select=direction,state&order=created_at" "${GA[@]}" | jarr 'a.map(x=>x.direction+":"+x.state).join(";")')
[ "${v}" = "outgoing:accepted;outgoing:cancelled" ] && ok "my_transfer_proposals de A: accepted y cancelled; la entrante rechazada ya no" || fallo "vista de A: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfer_proposals?select=direction,state&order=created_at" "${GB[@]}" | jarr 'a.map(x=>x.direction+":"+x.state).join(";")')
[ "${v}" = "outgoing:declined" ] && ok "my_transfer_proposals de B: su declined; las entrantes no pending, no" || fallo "vista de B: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfers?select=*" "${GA[@]}" | jarr 'a.length===1 && a[0].direction==="outgoing" && a[0].balance_amount==="-10000" && a[0].amount==="10000" && a[0].concept==="Cena" && a[0].counterpart_handle==="http_bea" && a[0].scope_id==="'"${PA}"'" && typeof a[0].balance_amount==="string" && Object.keys(a[0]).sort().join(",")==="amount,balance_amount,concept,counterpart_handle,counterpart_public_name,currency_definition_id,direction,effective_date,effective_time,group_scope_id,group_transfer_proposal_id,operation_created_at,operation_id,payment_request_id,proposal_id,scope_id" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfers de A: saliente -10000 «Cena» a @http_bea, solo su ambito, importes como texto" || fallo "my_transfers de A: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfers?select=direction,balance_amount,counterpart_handle,counterpart_public_name,scope_id" "${GB[@]}" | jarr 'a.length===1 && a[0].direction==="incoming" && a[0].balance_amount==="10000" && a[0].counterpart_handle==="http_ana2" && a[0].counterpart_public_name==="Ana HTTP" && a[0].scope_id==="'"${PB}"'" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfers de B: entrante +10000 de @http_ana2 · Ana HTTP, en su ambito" || fallo "my_transfers de B: ${v}"
v=$(curl -s "${API}/rest/v1/personal_operation?select=operation_class&operation_class=eq.internal_transfer" "${GA[@]}" | jarr 'a.length===0 ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "personal_operation no la lista todavia (lista blanca de F06/ADR-007)" || fallo "personal_operation: ${v}"
for vista in my_transfer_proposals my_transfers; do
  v=$(curl -s -o /dev/null -w '%{http_code}' "${API}/rest/v1/${vista}" -H "apikey: ${KEY}")
  [ "${v}" != "200" ] && ok "${vista} sin JWT no responde 200 (${v})" || fallo "${vista} respondio 200 sin JWT"
done
for fn in create_transfer_proposal cancel_transfer_proposal decline_transfer_proposal; do
  rr=$(rpc "${fn}" "" '{"payload":{}}')
  ee=$(estado_de "${rr}")
  case "${ee}" in 200|201) fallo "${fn} se acepto SIN JWT (${ee})" ;; *) ok "${fn} sin JWT: ${ee}" ;; esac
done

# ============================================================================
echo ""
echo "== 19 · solicitudes de pago mediante enlace, por HTTP (F12/ADR-004, F12.B2) =="
# Lo que solo la ruta real demuestra: que crear entrega el token una vez y el
# replay lo niega, que la previsualizacion devuelve estados con 200 y solo lo
# minimo para pagar, que pagar por token con el JWT del portador materializa
# la transferencia con la autoria correcta, que los codigos viajan con su
# estado, que las vistas de las dos partes publican la identidad actual y
# ni un uid, ni un ambito ajeno, ni el hash. A es http_ana2 (definitivo), B
# es http_bea (definitivo), C no tiene handle, G3 es un JWT anonimo real.
r19() { # $1 nombre, $2 fn, $3 tok, $4 body, $5 estado esperado
  local rr ee cc
  rr=$(rpc "$2" "$3" "$4"); ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  ULTIMO_CUERPO="${cc}"
  [ "${ee}" = "$5" ] && ok "$1: ${ee}" || fallo "$1 devolvio ${ee} y se esperaba $5: ${cc}"
}
codigo19() { printf '%s' "${ULTIMO_CUERPO}" | jget code; }
campo19()  { printf '%s' "${ULTIMO_CUERPO}" | jget "$1"; }
claves19() { printf '%s' "${ULTIMO_CUERPO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(Object.keys(o).sort().join(","))})'; }

# 19.1 · B crea: el token, una vez; el replay lo niega; ninguna operacion.
ops_antes=$("${DBQ[@]}" -c "select count(*) from core.operation where created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')
r19 "B crea una solicitud" create_payment_request "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a1900000-0000-4000-8000-000000000001\",\"command_contract_version\":1,\"amount\":\"4200\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"  Entradas  \"}")" 200
REQ_1=$(campo19 request_id); TOKEN_1=$(campo19 token)
[ -n "${REQ_1}" ] && [ "${#TOKEN_1}" = "43" ] && [ "$(campo19 already_processed)" = "false" ] && ok "request_id ${REQ_1:0:8}… y token de 43 chars base64url" || fallo "crear: ${ULTIMO_CUERPO}"
[ "$(claves19)" = "already_processed,expires_at,request_id,token" ] && ok "la respuesta trae exactamente already_processed, expires_at, request_id y token" || fallo "claves: $(claves19)"
v=$("${DBQ[@]}" -c "select count(*) from core.payment_request where token_hash = sec.invitation_hash('${TOKEN_1}') and created_by = '${UID_B}';" | tr -d '[:space:]')
[ "${v}" = "1" ] && ok "la base guarda el sha256 del token" || fallo "hash: ${v}"
v=$("${DBQ[@]}" -c "select count(*) from core.payment_request where position(convert_to('${TOKEN_1}', 'utf8') in token_hash) > 0;" | tr -d '[:space:]')
[ "${v}" = "0" ] && ok "y no el token en claro" || fallo "token en claro: ${v}"
ops_despues=$("${DBQ[@]}" -c "select count(*) from core.operation where created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')
[ "${ops_antes}" = "${ops_despues}" ] && ok "crear no crea operacion" || fallo "crear creo una operacion"
r19 "B repite la clave (replay)" create_payment_request "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a1900000-0000-4000-8000-000000000001\",\"command_contract_version\":1,\"amount\":\"4200\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Entradas\"}")" 200
[ "$(campo19 request_id)" = "${REQ_1}" ] && [ "$(campo19 already_processed)" = "true" ] && [ -z "$(campo19 token)" ] && ok "replay: la misma solicitud, token null" || fallo "replay: ${ULTIMO_CUERPO}"
r19 "C sin handle crea" create_payment_request "${TOK_C}" "$(env_payload "{\"client_command_id\":\"a1900000-0000-4000-8000-000000000002\",\"command_contract_version\":1,\"amount\":\"1\",\"currency_definition_id\":\"${EUR}\"}")" 409
[ "$(codigo19)" = "USERNAME_REQUIRED" ] && ok "USERNAME_REQUIRED · 409" || fallo "codigo: $(codigo19)"
if [ -n "${TOK_G3:-}" ]; then
  r19 "el invitado crea" create_payment_request "${TOK_G3}" "$(env_payload "{\"client_command_id\":\"a1900000-0000-4000-8000-000000000003\",\"command_contract_version\":1,\"amount\":\"1\",\"currency_definition_id\":\"${EUR}\"}")" 403
  [ "$(codigo19)" = "NOT_AUTHORIZED" ] && ok "anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo19)"
fi

# 19.2 · previsualizar: estados con 200, solo lo minimo.
r19 "A previsualiza" preview_payment_request "${TOK_A}" "{\"p_token\":\"${TOKEN_1}\"}" 200
[ "$(campo19 state)" = "ok" ] && [ "$(campo19 amount)" = "4200" ] && [ "$(campo19 concept)" = "Entradas" ] && [ "$(campo19 creator_handle)" = "http_bea" ] && ok "ok · 4200 · Entradas · @http_bea" || fallo "preview de A: ${ULTIMO_CUERPO}"
[ "$(claves19)" = "amount,concept,creator_handle,creator_public_name,currency_definition_id,state" ] && ok "exactamente amount, concept, creator_handle, creator_public_name, currency_definition_id y state: ni id, ni hash, ni uid" || fallo "claves: $(claves19)"
r19 "B previsualiza la suya" preview_payment_request "${TOK_B}" "{\"p_token\":\"${TOKEN_1}\"}" 200
[ "$(campo19 state)" = "own" ] && ok "own" || fallo "preview de B: ${ULTIMO_CUERPO}"
r19 "C previsualiza (sin handle, con sesion)" preview_payment_request "${TOK_C}" "{\"p_token\":\"${TOKEN_1}\"}" 200
[ "$(campo19 state)" = "ok" ] && ok "ok: previsualizar solo exige sesion normal" || fallo "preview de C: ${ULTIMO_CUERPO}"
r19 "token invalido" preview_payment_request "${TOK_A}" '{"p_token":"nada"}' 200
[ "$(campo19 state)" = "invalid" ] && [ "$(claves19)" = "state" ] && ok "invalid, con 200 y solo state" || fallo "preview invalido: ${ULTIMO_CUERPO}"
v=$("${DBQ[@]}" -c "select count(*) from core.payment_request_attempt a join auth.users u on u.id = a.user_id where u.email = '${EMAIL_A}';" | tr -d '[:space:]')
[ "${v}" = "1" ] && ok "solo el invalid apunto (A: 1)" || fallo "apuntes de A: ${v}"
if [ -n "${TOK_G3:-}" ]; then
  r19 "el invitado previsualiza" preview_payment_request "${TOK_G3}" "{\"p_token\":\"${TOKEN_1}\"}" 403
  [ "$(codigo19)" = "NOT_AUTHORIZED" ] && ok "anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo19)"
fi

# 19.3 · pagar: la autorizacion va ANTES del token (A–F): quien no puede pagar
# recibe lo mismo con el bearer valido o inventado; solo un elegible lo resuelve.
TOKEN_X=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
if [ -n "${TOK_G3:-}" ]; then
  r19 "A · el invitado paga con token valido" record_internal_transfer "${TOK_G3}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000013\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\"}")" 403
  [ "$(codigo19)" = "NOT_AUTHORIZED" ] && ok "anonimo + valido: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo19)"
  r19 "B · el invitado paga con token inventado" record_internal_transfer "${TOK_G3}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000013\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_X}\"}")" 403
  [ "$(codigo19)" = "NOT_AUTHORIZED" ] && ok "anonimo + inventado: el mismo NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo19)"
fi
r19 "C · C sin handle paga con token valido" record_internal_transfer "${TOK_C}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000012\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\"}")" 409
[ "$(codigo19)" = "USERNAME_REQUIRED" ] && ok "sin handle + valido: USERNAME_REQUIRED · 409" || fallo "codigo: $(codigo19)"
r19 "D · C sin handle paga con token inventado" record_internal_transfer "${TOK_C}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000012\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_X}\"}")" 409
[ "$(codigo19)" = "USERNAME_REQUIRED" ] && ok "sin handle + inventado: el mismo USERNAME_REQUIRED · 409" || fallo "codigo: $(codigo19)"
r19 "E · A elegible con token inventado" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000014\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_X}\"}")" 404
[ "$(codigo19)" = "PAYMENT_REQUEST_INVALID" ] && ok "elegible + inventado: PAYMENT_REQUEST_INVALID · 404" || fallo "codigo: $(codigo19)"
r19 "F · B paga la suya" record_internal_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000011\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\"}")" 422
[ "$(codigo19)" = "PAYMENT_REQUEST_OWN" ] && ok "elegible + propia: PAYMENT_REQUEST_OWN · 422" || fallo "codigo: $(codigo19)"
r19 "A con token y proposal_id" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000014\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\",\"proposal_id\":\"${PROP_1}\"}")" 400
[ "$(codigo19)" = "PAYLOAD_INVALID" ] && ok "XOR: los dos origenes es PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo19)"
r19 "A sin origen" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000014\",\"command_contract_version\":1}")" 400
[ "$(codigo19)" = "PAYLOAD_INVALID" ] && ok "XOR: ninguno es PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo19)"
r19 "A con importe en el payload" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000014\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\",\"amount\":\"4200\"}")" 400
[ "$(codigo19)" = "PAYLOAD_INVALID" ] && ok "el importe no viaja: PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo19)"
SALDO_A19=$("${DBQ[@]}" -c "select coalesce(sum(e.balance_amount),0) from core.current_effect e where e.scope_id = '${PA}' and e.balance_amount is not null;" | tr -d '[:space:]')
r19 "A paga" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000015\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\"}")" 200
OP_R19=$(campo19 operation_id)
[ -n "${OP_R19}" ] && [ "$(campo19 already_processed)" = "false" ] && ok "pagada: operation_id ${OP_R19:0:8}…" || fallo "pagar: ${ULTIMO_CUERPO}"
r19 "A paga otra vez (replay)" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000015\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\"}")" 200
[ "$(campo19 operation_id)" = "${OP_R19}" ] && [ "$(campo19 already_processed)" = "true" ] && ok "replay: la misma operacion" || fallo "replay: ${ULTIMO_CUERPO}"
r19 "A con otra clave" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000016\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_1}\"}")" 409
[ "$(codigo19)" = "PAYMENT_REQUEST_ALREADY_PAID" ] && ok "PAYMENT_REQUEST_ALREADY_PAID · 409: una sola operacion" || fallo "codigo: $(codigo19)"
r19 "previsualizar una pagada" preview_payment_request "${TOK_C}" "{\"p_token\":\"${TOKEN_1}\"}" 200
[ "$(campo19 state)" = "paid" ] && ok "paid" || fallo "preview pagada: ${ULTIMO_CUERPO}"
v=$("${DBQ[@]}" -c "select coalesce(sum(e.balance_amount),0) from core.current_effect e where e.scope_id = '${PA}' and e.balance_amount is not null;" | tr -d '[:space:]')
[ "${v}" = "$((SALDO_A19 - 4200))" ] && ok "el Disponible de A baja 4200 (${SALDO_A19} → ${v})" || fallo "saldo de A: ${SALDO_A19} → ${v}"
v=$("${DBQ[@]}" -c "select r.paid_by = '${UID_A}' and o.created_by = '${UID_A}' and ov.created_by = '${UID_A}' and tp.from_scope_id = '${PA}' and tp.to_scope_id = '${PB}' and ov.version_no = 1 and ov.effective_date = current_date from core.payment_request r join core.operation o on o.id = r.paid_operation_id join core.operation_version ov on ov.id = o.current_version_id join core.transfer_part tp on tp.operation_version_id = ov.id where r.id = '${REQ_1}';" | tr -d '[:space:]')
[ "${v}" = "t" ] && ok "paid_by = created_by = pagador, partes PA → PB, una version, fecha del servidor" || fallo "anatomia: ${v}"
VER_R19=$("${DBQ[@]}" -c "select current_version_id from core.operation where id = '${OP_R19}';" | tr -d '[:space:]')
r19 "B anula" annul_operation "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000017\",\"command_contract_version\":1,\"operation_id\":\"${OP_R19}\",\"expected_version_id\":\"${VER_R19}\"}")" 422
[ "$(codigo19)" = "OPERATION_NOT_ANNULLABLE" ] && ok "OPERATION_NOT_ANNULLABLE · 422" || fallo "codigo: $(codigo19)"

# 19.4 · cancelar: solo el creador; una cancelada no se paga; idempotente.
r19 "B crea otra" create_payment_request "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a1900000-0000-4000-8000-000000000021\",\"command_contract_version\":1,\"amount\":\"300\",\"currency_definition_id\":\"${EUR}\"}")" 200
REQ_2=$(campo19 request_id); TOKEN_2=$(campo19 token)
r19 "A cancela la de B" cancel_payment_request "${TOK_A}" "$(env_payload "{\"request_id\":\"${REQ_2}\"}")" 403
[ "$(codigo19)" = "NOT_AUTHORIZED" ] && ok "NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo19)"
r19 "B cancela" cancel_payment_request "${TOK_B}" "$(env_payload "{\"request_id\":\"${REQ_2}\"}")" 200
[ "$(campo19 state)" = "cancelled" ] && ok "cancelled" || fallo "cancelar: ${ULTIMO_CUERPO}"
r19 "B cancela otra vez" cancel_payment_request "${TOK_B}" "$(env_payload "{\"request_id\":\"${REQ_2}\"}")" 200
[ "$(campo19 already_processed)" = "true" ] && ok "idempotente por estado" || fallo "repetir: ${ULTIMO_CUERPO}"
r19 "A paga la cancelada" record_internal_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1900000-0000-4000-8000-000000000022\",\"command_contract_version\":1,\"payment_request_token\":\"${TOKEN_2}\"}")" 409
[ "$(codigo19)" = "PAYMENT_REQUEST_CANCELLED" ] && ok "PAYMENT_REQUEST_CANCELLED · 409" || fallo "codigo: $(codigo19)"
r19 "previsualizar la cancelada" preview_payment_request "${TOK_A}" "{\"p_token\":\"${TOKEN_2}\"}" 200
[ "$(campo19 state)" = "cancelled" ] && ok "cancelled" || fallo "preview cancelada: ${ULTIMO_CUERPO}"
r19 "B cancela la pagada" cancel_payment_request "${TOK_B}" "$(env_payload "{\"request_id\":\"${REQ_1}\"}")" 409
[ "$(codigo19)" = "PAYMENT_REQUEST_ALREADY_PAID" ] && ok "PAYMENT_REQUEST_ALREADY_PAID · 409" || fallo "codigo: $(codigo19)"
r19 "B crea una tercera (queda pendiente)" create_payment_request "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a1900000-0000-4000-8000-000000000023\",\"command_contract_version\":1,\"amount\":\"99\",\"currency_definition_id\":\"${EUR}\",\"concept\":\"Pendiente\"}")" 200

# 19.5 · las vistas: B ve las tres con estado y el pagador actual; A ninguna; my_transfers de las dos partes.
v=$(curl -s "${API}/rest/v1/my_payment_requests?select=*&order=created_at" "${GB[@]}" | jarr 'a.length===3 && a[0].state==="paid" && a[0].amount==="4200" && a[0].concept==="Entradas" && a[0].payer_handle==="http_ana2" && a[0].payer_public_name==="Ana HTTP" && a[1].state==="cancelled" && a[1].payer_handle===null && a[2].state==="pending" && Object.keys(a[0]).sort().join(",")==="amount,concept,created_at,currency_definition_id,expires_at,paid_at,paid_operation_id,payer_handle,payer_public_name,request_id,state" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_payment_requests de B: paid (pagada por @http_ana2), cancelled y pending; sin token, hash ni uid" || fallo "vista de B: ${v}"
v=$(curl -s "${API}/rest/v1/my_payment_requests?select=request_id" "${GA[@]}" | jarr 'a.length===0 ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_payment_requests de A: ninguna (la que pago no es suya)" || fallo "vista de A: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfers?select=direction,balance_amount,concept,counterpart_handle,payment_request_id,proposal_id,scope_id&payment_request_id=eq.${REQ_1}" "${GA[@]}" | jarr 'a.length===1 && a[0].direction==="outgoing" && a[0].balance_amount==="-4200" && a[0].concept==="Entradas" && a[0].counterpart_handle==="http_bea" && a[0].proposal_id===null && a[0].scope_id==="'"${PA}"'" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfers de A: saliente -4200 «Entradas» a @http_bea por la solicitud, en su ambito" || fallo "my_transfers de A: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfers?select=direction,balance_amount,concept,counterpart_handle,scope_id&payment_request_id=eq.${REQ_1}" "${GB[@]}" | jarr 'a.length===1 && a[0].direction==="incoming" && a[0].balance_amount==="4200" && a[0].concept==="Entradas" && a[0].counterpart_handle==="http_ana2" && a[0].scope_id==="'"${PB}"'" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfers de B: entrante +4200 de @http_ana2, en su ambito" || fallo "my_transfers de B: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfers?select=proposal_id,payment_request_id&proposal_id=eq.${PROP_1}" "${GA[@]}" | jarr 'a.length===1 && a[0].payment_request_id===null ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "la transferencia de §18 (propuesta) sigue en la vista, sin solicitud" || fallo "fila de la propuesta: ${v}"
v=$(curl -s -o /dev/null -w '%{http_code}' "${API}/rest/v1/my_payment_requests" -H "apikey: ${KEY}")
[ "${v}" != "200" ] && ok "my_payment_requests sin JWT no responde 200 (${v})" || fallo "la vista respondio 200 sin JWT"
for fn in create_payment_request cancel_payment_request preview_payment_request; do
  rr=$(rpc "${fn}" "" '{}')
  ee=$(estado_de "${rr}")
  case "${ee}" in 200|201) fallo "${fn} se acepto SIN JWT (${ee})" ;; *) ok "${fn} sin JWT: ${ee}" ;; esac
done


# ============================================================================
echo ""
echo "== 20 · transferencias dentro de un grupo con dos voluntades, por HTTP (F12/ADR-003, F12.B3) =="
# Lo que solo la ruta real demuestra: que la propuesta de grupo y su
# aceptacion (record_settlement_by_transfer con el contrato nuevo) responden
# por PostgREST con el JWT de cada parte, que los codigos viajan con su
# estado, que el algebra cruza cero (A debe 30 en GY del gasto de §4; propone
# 40; B acepta; B pasa a deber 10), que una salida REAL invalida la propuesta
# pendiente (PROPOSAL_CANCELLED con reason departure) y que las vistas
# publican participantes y estados sin uid ni Personal ajeno. Es la septima
# clase que §4 dejo de escribir de una sola voluntad. A y B llevan handle
# definitivo desde §17.
r20() { # $1 nombre, $2 fn, $3 tok, $4 body, $5 estado esperado
  local rr ee cc
  rr=$(rpc "$2" "$3" "$4"); ee=$(estado_de "${rr}"); cc=$(cuerpo_de "${rr}")
  ULTIMO_CUERPO="${cc}"
  [ "${ee}" = "$5" ] && ok "$1: ${ee}" || fallo "$1 devolvio ${ee} y se esperaba $5: ${cc}"
}
codigo20() { printf '%s' "${ULTIMO_CUERPO}" | jget code; }
campo20()  { printf '%s' "${ULTIMO_CUERPO}" | jget "$1"; }
razon20()  { printf '%s' "${ULTIMO_CUERPO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=JSON.parse(s);const d=JSON.parse(e.details||"{}");console.log(d.reason||"-")}catch{console.log("-")}})'; }

# 20.1 · el writer ya no acepta el contrato de F3; A propone 40 a B en GY (A le debe 30).
r20 "A con el payload de F3" record_settlement_by_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a1000000-0000-4000-8000-000000000008\",\"command_contract_version\":1,\"effective_date\":\"2026-02-08\",\"debt_scope_id\":\"${GY}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",\"debtor_participant_id\":\"${YA}\",\"creditor_participant_id\":\"${YB}\"}")" 400
[ "$(codigo20)" = "PAYLOAD_INVALID" ] && ok "el contrato de F3 ya no existe: PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo20)"
r20 "A propone 40 a B en GY" create_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000001\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YB}\",\"amount\":\"4000\",\"concept\":\"  Taxi y algo mas  \"}")" 200
GPROP_1=$(campo20 proposal_id)
[ -n "${GPROP_1}" ] && [ "$(campo20 already_processed)" = "false" ] && ok "proposal_id ${GPROP_1:0:8}…" || fallo "crear: ${ULTIMO_CUERPO}"
v=$(printf '%s' "${ULTIMO_CUERPO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(Object.keys(o).sort().join(","))})')
[ "${v}" = "already_processed,expires_at,proposal_id" ] && ok "la respuesta trae exactamente already_processed, expires_at y proposal_id" || fallo "claves: ${v}"
r20 "A repite la clave (replay)" create_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000001\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YB}\",\"amount\":\"4000\",\"concept\":\"Taxi y algo mas\"}")" 200
[ "$(campo20 proposal_id)" = "${GPROP_1}" ] && [ "$(campo20 already_processed)" = "true" ] && ok "replay: la misma propuesta" || fallo "replay: ${ULTIMO_CUERPO}"
r20 "A a si misma" create_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000002\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YA}\",\"amount\":\"1\"}")" 400
[ "$(codigo20)" = "PAYLOAD_INVALID" ] && ok "a uno mismo: PAYLOAD_INVALID · 400" || fallo "codigo: $(codigo20)"
r20 "C (no miembro) propone" create_group_transfer_proposal "${TOK_C}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000003\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YB}\",\"amount\":\"1\"}")" 409
[ "$(codigo20)" = "USERNAME_REQUIRED" ] && ok "C sin handle: USERNAME_REQUIRED · 409 (antes que la membresia)" || fallo "codigo: $(codigo20)"
if [ -n "${TOK_G3:-}" ]; then
  r20 "el invitado propone" create_group_transfer_proposal "${TOK_G3}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000004\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YB}\",\"amount\":\"1\"}")" 403
  [ "$(codigo20)" = "NOT_AUTHORIZED" ] && ok "anonimo: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo20)"
fi
ops_antes=$("${DBQ[@]}" -c "select count(*) from core.operation where created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')

# 20.2 · las vistas antes de aceptar.
v=$(curl -s "${API}/rest/v1/group_transfer_proposals?select=*" "${GA[@]}" | jarr 'a.length===1 && a[0].direction==="outgoing" && a[0].state==="pending" && a[0].cancel_reason===null && a[0].sender_display_name==="A" && a[0].receiver_display_name==="B" && a[0].amount==="4000" && a[0].concept==="Taxi y algo mas" && Object.keys(a[0]).sort().join(",")==="accepted_operation_id,amount,cancel_reason,concept,created_at,currency_definition_id,direction,expires_at,group_scope_id,proposal_id,receiver_display_name,receiver_participant_id,sender_display_name,sender_participant_id,state" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "group_transfer_proposals de A: saliente, pending, A > B, importe como texto, sin uid" || fallo "vista de A: ${v}"
v=$(curl -s "${API}/rest/v1/group_transfer_proposals?select=direction,state" "${GB[@]}" | jarr 'a.length===1 && a[0].direction==="incoming" && a[0].state==="pending" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "group_transfer_proposals de B: entrante, pending" || fallo "vista de B: ${v}"
v=$(curl -s "${API}/rest/v1/group_transfer_proposals?select=proposal_id" -H "apikey: ${KEY}" -H "Authorization: Bearer ${TOK_C}" | jarr 'a.length===0 ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "C no ve propuestas de otros" || fallo "vista de C: ${v}"

# 20.3 · aceptar: solo B; el algebra cruza cero.
r20 "A acepta la suya" record_settlement_by_transfer "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000011\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_1}\"}")" 403
[ "$(codigo20)" = "NOT_AUTHORIZED" ] && ok "quien propuso no materializa: NOT_AUTHORIZED · 403" || fallo "codigo: $(codigo20)"
r20 "B corrige" record_settlement_by_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000012\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_1}\",\"operation_id\":\"${GPROP_1}\",\"expected_version_id\":\"${GPROP_1}\"}")" 422
[ "$(codigo20)" = "TRANSFER_NOT_EDITABLE" ] && ok "TRANSFER_NOT_EDITABLE · 422" || fallo "codigo: $(codigo20)"
NETO_ANTES=$("${DBQ[@]}" -c "select sec.net_debt('${GY}', '${YA}', '${YB}', null);" | tr -d '[:space:]')
[ "${NETO_ANTES}" = "3000" ] && ok "A debe 30 a B en GY antes de aceptar" || fallo "neto antes: ${NETO_ANTES}"
r20 "B acepta" record_settlement_by_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000013\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_1}\"}")" 200
OP_G20=$(campo20 operation_id)
[ -n "${OP_G20}" ] && [ "$(campo20 already_processed)" = "false" ] && ok "aceptada: operation_id ${OP_G20:0:8}…" || fallo "aceptar: ${ULTIMO_CUERPO}"
r20 "B acepta otra vez (replay)" record_settlement_by_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000013\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_1}\"}")" 200
[ "$(campo20 operation_id)" = "${OP_G20}" ] && [ "$(campo20 already_processed)" = "true" ] && ok "replay: la misma operacion" || fallo "replay: ${ULTIMO_CUERPO}"
r20 "B con otra clave" record_settlement_by_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000014\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_1}\"}")" 409
[ "$(codigo20)" = "PROPOSAL_ACCEPTED" ] && ok "PROPOSAL_ACCEPTED · 409: una sola operacion" || fallo "codigo: $(codigo20)"
v=$("${DBQ[@]}" -c "select sec.net_debt('${GY}', '${YA}', '${YB}', null) || '|' || sec.pending_debt('${GY}', '${YB}', '${YA}', null);" | tr -d '[:space:]')
[ "${v}" = "-1000|1000" ] && ok "30 + 40 → B debe 10 a A: net_debt -1000, pending_debt B→A 1000" || fallo "algebra: ${v}"
v=$(curl -s "${API}/rest/v1/group_pending_pair?select=debtor_participant_id,creditor_participant_id,amount&scope_id=eq.${GY}" "${GA[@]}" | jarr 'a.length===1 && a[0].debtor_participant_id==="'"${YB}"'" && a[0].creditor_participant_id==="'"${YA}"'" && a[0].amount==="1000" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "group_pending_pair por HTTP: B > A 10" || fallo "pares: ${v}"
v=$("${DBQ[@]}" -c "select (o.created_by = '${UID_B}' and ov.created_by = '${UID_B}' and ov.version_no = 1 and tp.from_scope_id = '${PA}' and tp.to_scope_id = '${PB}' and tp.group_scope_id = '${GY}' and tp.sender_participant_id = '${YA}' and tp.receiver_participant_id = '${YB}')::text || '|' || (select count(*) from core.effect e where e.operation_version_id = ov.id) from core.operation o join core.operation_version ov on ov.id = o.current_version_id join core.transfer_part tp on tp.operation_version_id = ov.id where o.id = '${OP_G20}';" | tr -d '[:space:]')
[ "${v}" = "true|3" ] && ok "created_by = B (receptor), partes PA → PB con grupo y participantes, tres efectos, una version" || fallo "anatomia: ${v}"
ejercitadas=$("${DBQ[@]}" -c "select count(*) from core.operation where operation_class = 'settlement_by_transfer' and created_by in ('${UID_A}','${UID_B}');" | tr -d '[:space:]')
[ "${ejercitadas}" = "1" ] && ok "con esta, las SIETE clases quedaron escritas por la ruta HTTP (cinco en §4, la internal_transfer en §18 y esta)" || fallo "settlement_by_transfer escritas: ${ejercitadas}"
VER_G20=$("${DBQ[@]}" -c "select current_version_id from core.operation where id = '${OP_G20}';" | tr -d '[:space:]')
r20 "A anula" annul_operation "${TOK_A}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000015\",\"command_contract_version\":1,\"operation_id\":\"${OP_G20}\",\"expected_version_id\":\"${VER_G20}\"}")" 422
[ "$(codigo20)" = "OPERATION_NOT_ANNULLABLE" ] && ok "OPERATION_NOT_ANNULLABLE · 422" || fallo "codigo: $(codigo20)"

# 20.4 · las vistas despues: group_transfers para los dos, my_transfers con grupo.
v=$(curl -s "${API}/rest/v1/group_transfers?select=*&group_scope_id=eq.${GY}" "${GB[@]}" | jarr 'a.length===1 && a[0].sender_display_name==="A" && a[0].receiver_display_name==="B" && a[0].is_sender===false && a[0].is_receiver===true && a[0].amount==="4000" && a[0].concept==="Taxi y algo mas" && a[0].proposal_id==="'"${GPROP_1}"'" && Object.keys(a[0]).sort().join(",")==="amount,concept,currency_definition_id,effective_date,effective_time,group_scope_id,is_receiver,is_sender,operation_created_at,operation_id,proposal_id,receiver_display_name,receiver_participant_id,sender_display_name,sender_participant_id" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "group_transfers de B: A → B 40 «Taxi y algo mas», is_receiver, sin uid ni Personal" || fallo "group_transfers de B: ${v}"
v=$(curl -s "${API}/rest/v1/my_transfers?select=direction,balance_amount,concept,counterpart_handle,group_scope_id,group_transfer_proposal_id,scope_id&group_transfer_proposal_id=eq.${GPROP_1}" "${GA[@]}" | jarr 'a.length===1 && a[0].direction==="outgoing" && a[0].balance_amount==="-4000" && a[0].concept==="Taxi y algo mas" && a[0].counterpart_handle==="http_bea" && a[0].group_scope_id==="'"${GY}"'" && a[0].scope_id==="'"${PA}"'" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "my_transfers de A: saliente -4000 a @http_bea con grupo, en su Personal" || fallo "my_transfers de A: ${v}"
v=$(curl -s "${API}/rest/v1/group_transfer_proposals?select=state,accepted_operation_id" "${GA[@]}" | jarr 'a.length===1 && a[0].state==="accepted" && a[0].accepted_operation_id==="'"${OP_G20}"'" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "group_transfer_proposals de A: accepted, ligada" || fallo "vista de A: ${v}"

# 20.5 · una salida REAL invalida la pendiente: A propone en GZ y B sale de GZ (neto cero); cancel_reason = departure.
r20 "A propone en GZ" create_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000021\",\"command_contract_version\":1,\"group_scope_id\":\"${GZ}\",\"receiver_participant_id\":\"${ZB}\",\"amount\":\"700\"}")" 200
GPROP_2=$(campo20 proposal_id)
sleep 1
r20 "B sale de GZ" leave_group "${TOK_B}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000022\",\"command_contract_version\":1,\"scope_id\":\"${GZ}\"}")" 200
v=$(curl -s "${API}/rest/v1/group_transfer_proposals?select=state,cancel_reason&proposal_id=eq.${GPROP_2}" "${GA[@]}" | jarr 'a.length===1 && a[0].state==="cancelled" && a[0].cancel_reason==="departure" ? "ok" : JSON.stringify(a)')
[ "${v}" = "ok" ] && ok "A la ve cancelled con reason departure" || fallo "vista tras la salida: ${v}"
r20 "A cancela la invalidada" cancel_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${GPROP_2}\"}")" 409
[ "$(codigo20)" = "PROPOSAL_CANCELLED" ] && [ "$(razon20)" = "departure" ] && ok "PROPOSAL_CANCELLED · 409 con details.reason = departure" || fallo "codigo: $(codigo20) / $(razon20)"
r20 "B acepta la invalidada" record_settlement_by_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000023\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_2}\"}")" 409
[ "$(codigo20)" = "PROPOSAL_CANCELLED" ] && ok "aceptar tras la salida: PROPOSAL_CANCELLED · 409" || fallo "codigo: $(codigo20)"

# 20.6 · rechazar y cancelar por HTTP, con sus codigos; sin JWT nada.
r20 "A propone otra en GY" create_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000031\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YB}\",\"amount\":\"100\"}")" 200
GPROP_3=$(campo20 proposal_id)
r20 "A rechaza la suya" decline_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${GPROP_3}\"}")" 403
[ "$(codigo20)" = "NOT_AUTHORIZED" ] && ok "quien propuso no rechaza: NOT_AUTHORIZED" || fallo "codigo: $(codigo20)"
r20 "B rechaza" decline_group_transfer_proposal "${TOK_B}" "$(env_payload "{\"proposal_id\":\"${GPROP_3}\"}")" 200
[ "$(campo20 state)" = "declined" ] && ok "declined" || fallo "rechazar: ${ULTIMO_CUERPO}"
r20 "A cancela la rechazada" cancel_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${GPROP_3}\"}")" 409
[ "$(codigo20)" = "PROPOSAL_DECLINED" ] && ok "PROPOSAL_DECLINED · 409" || fallo "codigo: $(codigo20)"
r20 "A propone y cancela" create_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"client_command_id\":\"a2000000-0000-4000-8000-000000000032\",\"command_contract_version\":1,\"group_scope_id\":\"${GY}\",\"receiver_participant_id\":\"${YB}\",\"amount\":\"200\"}")" 200
GPROP_4=$(campo20 proposal_id)
r20 "A cancela" cancel_group_transfer_proposal "${TOK_A}" "$(env_payload "{\"proposal_id\":\"${GPROP_4}\"}")" 200
[ "$(campo20 state)" = "cancelled" ] && [ "$(campo20 cancel_reason)" = "creator" ] && ok "cancelled · creator" || fallo "cancelar: ${ULTIMO_CUERPO}"
r20 "B acepta la cancelada" record_settlement_by_transfer "${TOK_B}" "$(env_payload "{\"client_operation_id\":\"a2000000-0000-4000-8000-000000000033\",\"command_contract_version\":1,\"proposal_id\":\"${GPROP_4}\"}")" 409
[ "$(codigo20)" = "PROPOSAL_CANCELLED" ] && [ "$(razon20)" = "creator" ] && ok "PROPOSAL_CANCELLED · 409 (creator)" || fallo "codigo: $(codigo20) / $(razon20)"
for vista in group_transfer_proposals group_transfers; do
  v=$(curl -s -o /dev/null -w '%{http_code}' "${API}/rest/v1/${vista}" -H "apikey: ${KEY}")
  [ "${v}" != "200" ] && ok "${vista} sin JWT no responde 200 (${v})" || fallo "${vista} respondio 200 sin JWT"
done
for fn in create_group_transfer_proposal cancel_group_transfer_proposal decline_group_transfer_proposal; do
  rr=$(rpc "${fn}" "" '{"payload":{}}')
  ee=$(estado_de "${rr}")
  case "${ee}" in 200|201) fallo "${fn} se acepto SIN JWT (${ee})" ;; *) ok "${fn} sin JWT: ${ee}" ;; esac
done

echo "== retirada =="
retirar
borrar_usuarios
# SOLO lo que este check crea, no el contenido de la base.
#
# Contaba `core.scope`, `core.operation` y compania GLOBALES, lo que daba por
# residuo cualquier cuenta legitima que hubiera en la base local — la del
# telefono de quien esta probando, por ejemplo. Un fallo falso, y de los caros:
# manda a buscar una fuga de datos donde solo habia una sesion real.
#
# Ceñirlo NO lo debilita. Lo que el check escribe sale de sus cuatro ambitos
# sembrados o de las cuentas `nomey-http-%` que crea el provisioning, asi que
# cualquier fila suya sigue contando.
resto=$("${DBQ[@]}" <<SQL 2>/dev/null
with mios as (
  select id from core.scope
   where id in ('${PA}','${PB}','${GX}','${GY}','${GZ}')
      or owner_user_id in (select id from auth.users where email like 'nomey-http-%')
)
select (select count(*) from core.operation o
         join core.operation_version ov on ov.operation_id = o.id
         join core.effect e on e.operation_version_id = ov.id
        where e.scope_id in (select id from mios))
     + (select count(*) from core.effect where scope_id in (select id from mios))
     + (select count(*) from mios)
     + (select count(*) from core.participant where scope_id in (select id from mios))
     + (select count(*) from core.client_command
         where created_by in (select id from auth.users where email like 'nomey-http-%'))
     + (select count(*) from auth.users where email like 'nomey-http-%')
     + (select count(*) from core.account_handle where handle like 'http\_%')
     + (select count(*) from core.account_handle_event where handle like 'http\_%');
SQL
)
resto=$(tr -d '[:space:]' <<<"${resto}")
[ "${resto}" = "0" ] && ok "sin residuos, ni de datos ni de usuarios" || fallo "quedaron ${resto} filas"

# El catalogo monetario NO es residuo: lo siembra una migracion. Que siga entero
# despues de este check es parte de lo que hay que comprobar, porque la retirada
# borra definiciones y un filtro mal puesto se llevaria las veinte.
cat=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select count(*) from core.currency_definition;
SQL
)
cat=$(tr -d '[:space:]' <<<"${cat}")
[ "${cat}" = "20" ] && ok "el catalogo monetario sigue con sus 20 definiciones" \
                    || fallo "el catalogo quedo con ${cat} definiciones"

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la frontera completa funciona por HTTP con JWT real: Kong, Auth, PostgREST, api, writer y RLS"
  exit 0
fi
echo "FALLOS DE LA FRONTERA HTTP: ${fallos}"
exit 1
