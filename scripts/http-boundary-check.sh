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
#      es lo que ADR-008 §3 exige y E14 midio sobre una maqueta;
#   3. que `RAISE sqlstate 'PGRST'` viaja como el estado HTTP y el cuerpo que
#      ADR-009 §9 fija, contra las funciones REALES y no las de E15;
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
exigir_base_local || exit 1
# Este script habla por la frontera: sin gateway no hay nada que comprobar, y
# fallar aqui es legible. Fallar en el primer curl, no.
exigir_frontera_http || exit 1

API=http://127.0.0.1:54321
DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

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
KEY=$(docker exec supabase_kong_Nomey \
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
# ADR-009 §2 fija un unico parametro `jsonb` por funcion.
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
delete from auth.users where email in ('${EMAIL_A}','${EMAIL_B}','${EMAIL_C}');
SQL
}

alta() {
  curl -s -X POST "${API}/auth/v1/signup" \
    -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
    --data-binary "{\"email\":\"$1\",\"password\":\"${PASS}\"}"
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
XA=b0000000-0000-4000-8000-00000000aa01
XB=b0000000-0000-4000-8000-00000000bb01
YA=b0000000-0000-4000-8000-00000000aa02
YB=b0000000-0000-4000-8000-00000000bb02

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
  local ACTORES="select id from auth.users where email like 'nomey-http-%'"
  local MIOS="select id from core.scope where id in ('${PA}','${PB}','${GX}','${GY}') or owner_user_id in (${ACTORES})"

  "${DB[@]}" -v ON_ERROR_STOP=1 >/dev/null <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by in (${ACTORES});
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
delete from core.operation_version where created_by in (${ACTORES});
delete from core.operation where created_by in (${ACTORES});
delete from core.participant_period where participant_id in
  (select id from core.participant where scope_id in (${MIOS}));
delete from core.participant_user_link where scope_id in (${MIOS});
delete from core.membership where scope_id in (${MIOS});
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
-- economica durable (ADR-016) y `core.membership` es AUTORIZACION actual
-- (ADR-007). La policy de lectura de `core.effect` se resuelve por membresia,
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
commit;
SQL
}

echo "== preparando =="
retirar
borrar_usuarios

# 1 · alta. Con confirmacion obligatoria esto NO trae token, y el `id` viaja en
#     la raiz de la respuesta en vez de bajo `user`.
RA=$(alta "${EMAIL_A}")
RB=$(alta "${EMAIL_B}")
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
[ "$(tr -d '[:space:]' <<<"${rol}")" = "8" ] \
  && ok "las ocho funciones estan concedidas a authenticated y a ningun otro rol cliente" \
  || fallo "los grants de api.record_* a authenticated son $(tr -d '[:space:]' <<<"${rol}") y deben ser 8"

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
# ADR-008 §3. E14 midio sobre una maqueta que un parametro `text` NO lo conserva
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
echo "== 4 · las SIETE funciones publicas, por HTTP y con JWT real =="

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

llamada "record_internal_transfer" record_internal_transfer "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000004\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-04\",
  \"from_scope_id\":\"${PA}\",\"to_scope_id\":\"${PB}\",\"amount\":\"10000\",
  \"currency_definition_id\":\"${EUR}\"}"

llamada "record_group_expense" record_group_expense "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000005\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-05\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"10000\",
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
  \"payer_participant_id\":\"${YB}\",
  \"participants\":[\"${YB}\",\"${YA}\"],
  \"split_method\":{\"kind\":\"equal\"}}"

llamada "record_settlement_by_transfer" record_settlement_by_transfer "${TOK_A}" "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000008\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-08\",
  \"debt_scope_id\":\"${GY}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",
  \"debtor_participant_id\":\"${YA}\",\"creditor_participant_id\":\"${YB}\"}"

# EL RECUENTO TAMBIEN VA ACOTADO. Contaba las clases de la tabla entera, que
# era exacto mientras el script fuera el unico habitante de la base. Sobre una
# base con datos, una clase ajena —un `personal_income` cualquiera— hace ocho de
# siete y declara roto un script que se comporto bien. Es el mismo supuesto que
# rompio la lectura de `writer-debt-concurrency.sh`, encontrado por el mismo
# camino; este no llego a fallar en CI, y se acota antes de que lo haga.
#
# Las SIETE clases las escriben ${UID_A} y ${UID_B} por la ruta HTTP, asi que
# acotar por ellos no relaja nada: sigue exigiendo que las siete se persistan.
ejercitadas=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(distinct operation_class) from core.operation
 where created_by in ('${UID_A}','${UID_B}');
SQL
)
[ "$(tr -d '[:space:]' <<<"${ejercitadas}")" = "7" ] \
  && ok "las SIETE clases de operacion quedaron escritas por la ruta HTTP" \
  || fallo "solo $(tr -d '[:space:]' <<<"${ejercitadas}") clases distintas llegaron a persistirse"

# ============================================================================
echo ""
echo "== 5 · replay por HTTP =="
r=$(rpc record_group_expense "${TOK_A}" "$(env_payload "{
  \"client_operation_id\":\"a1000000-0000-4000-8000-000000000005\",
  \"command_contract_version\":1,\"effective_date\":\"2026-02-05\",
  \"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"10000\",
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
# ADR-009 §9 y E15: el codigo propio va en el CUERPO y el estado en `detail`.
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

# Y un codigo de DOMINIO, que conserva el suyo (ADR-009 §9).
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

# Los importes salen como TEXTO, nunca como number JSON (ADR-008 §1).
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

RC=$(alta "${EMAIL_C}")
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
  # —con codigos EUR y USD y otra identidad—, que es justo el caso que ADR-004
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
# importe exacto y ADR-008 §1 no admite otra cosa—, que el delta lo deriva el
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

# 11.1 · la lista responde, y no trae ninguna clase fuera de las de F6.
lista=$(curl -s "${API}/rest/v1/personal_operation?select=operation_id,operation_class,balance_amount,original_amount,version_no,previous_version_id,concept,target_balance" "${GA[@]}")
n=$(printf '%s' "${lista}" | jarr 'a.length')
malas=$(printf '%s' "${lista}" | jarr 'a.filter(x=>!["personal_expense","personal_income","adjustment"].includes(x.operation_class)).length')
if [ "${n}" != "err" ] && [ "${n}" -gt 0 ] 2>/dev/null && [ "${malas}" = "0" ]; then
  ok "api.personal_operation responde con ${n} operaciones, todas de las clases de F6"
else
  fallo "la lista devolvio n=${n} y ${malas} clases fuera de la lista blanca"
fi

# 11.2 · LOS IMPORTES CRUZAN COMO STRING. Es la mitad de ADR-008 §1 que solo la
# ruta real comprueba: el catalogo dice que no hay columnas `bigint`, pero que
# PostgREST no los reserialice como number lo demuestra este byte.
tipos=$(printf '%s' "${lista}" | jarr 'a.every(x=>typeof x.balance_amount==="string" && typeof x.original_amount==="string")?"ok":"number"')
[ "${tipos}" = "ok" ] \
  && ok "balance_amount y original_amount cruzan como string JSON" \
  || fallo "algun importe de la lista salio como number JSON (${tipos})"

# 11.3 · LA ANULADA NO ASOMA, ni por la lista ni por el historial. Es la
# obligacion de ADR-024 comprobada sobre la ruta real y no sobre `set_config`.
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

# 12.3 · el reparto CUADRA con el total. Es la afirmacion central de ADR-026
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
   where id in ('${PA}','${PB}','${GX}','${GY}')
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
     + (select count(*) from auth.users where email like 'nomey-http-%');
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
