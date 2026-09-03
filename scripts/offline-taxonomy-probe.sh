#!/usr/bin/env bash
#
# LA PUERTA DE ACEPTACION DE ADR-028 · la tripleta de cada clase de respuesta.
#
#   estado HTTP  ·  codigo de frontera  ·  SQLSTATE
#
# Por que existe. ADR-028 §11 define siete clases y hace depender de ellas la
# decision mas peligrosa de la fase: si se puede o no proponer registrar el gasto
# otra vez. Equivocarse ahi DUPLICA DINERO. El ADR exige por eso medir la
# tripleta contra el stack real antes de escribir el mapa en codigo, en vez de
# deducirla — y en particular prohibe dar por hecho que `42501` significa
# «sesion caducada».
#
# Uso, con el stack levantado:
#
#   ./scripts/offline-taxonomy-probe.sh
#
# FIXTURES PROPIAS. Crea sus usuarios `nomey-f7c-*@example.test`, su ambito
# personal y sus comandos, y al terminar borra EXCLUSIVAMENTE lo suyo. No toca
# ninguna fila que no haya creado, y lo comprueba antes y despues contando lo
# que hay fuera de su prefijo.
#
# SIN SECRETOS EN EL REPOSITORIO: la clave publicable se lee en ejecucion del
# Kong en marcha, igual que en `http-boundary-check.sh`.

set -uo pipefail

# shellcheck source=scripts/local-db-guard.sh
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

API=http://127.0.0.1:54321
DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: falta $1 en el PATH" >&2; exit 127; }; }
need curl
need node
need docker

KEY=$(docker exec supabase_kong_Nomey \
        sh -c "grep -o 'sb_publishable_[A-Za-z0-9_-]*' /home/kong/kong.yml | head -1" 2>/dev/null)
if [ -z "${KEY}" ]; then
  echo "error: no se pudo leer la clave publicable del Kong en marcha." >&2
  exit 1
fi

PREFIJO='nomey-f7c-'
EMAIL_A="${PREFIJO}a@example.test"
EMAIL_B="${PREFIJO}b@example.test"
PASS='Sonda-F7C-2026!'

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

# ------------------------------------------------------- lo ajeno, antes ----
# La prueba de que la sonda no toco los datos de desarrollo: se cuenta lo que
# hay FUERA del prefijo al empezar y al terminar, y las dos cifras tienen que
# coincidir.
censo() {
  "${DBQ[@]}" <<SQL
select (select count(*) from auth.users where email not like '${PREFIJO}%')
    || '/' || (select count(*) from core.operation)
    || '/' || (select count(*) from core.client_command)
    || '/' || (select count(*) from core.scope);
SQL
}

ANTES=$(censo)

alta() {
  curl -s -X POST "${API}/auth/v1/signup" \
    -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"${PASS}\"}" >/dev/null
}

confirmar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
update auth.users set email_confirmed_at = now() where email = '$1' and email_confirmed_at is null;
SQL
}

jwt() {
  curl -s -X POST "${API}/auth/v1/token?grant_type=password" \
    -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"${PASS}\"}" | jget access_token
}

# Borra EXCLUSIVAMENTE lo que creo esta sonda, y nada mas.
#
# Dos cosas que costo descubrir y que conviene no volver a deducir:
#
#   * `core.operation.current_version_id` es NOT NULL, asi que no se puede
#     «soltar» el puntero antes de borrar la version. Un `update ... = null`
#     falla, y con `ON_ERROR_STOP=0` fallaba EN SILENCIO: la operacion
#     sobrevivia y la sonda dejaba basura.
#   * La FK compuesta del puntero es DIFERIBLE (ADR-011 §7), asi que dentro de
#     una transaccion con `set constraints all deferred` se puede borrar la
#     version y despues la operacion; al commit no queda inconsistencia.
#
# `ON_ERROR_STOP=1` a proposito: una limpieza que falla tiene que decirlo.
limpiar() {
  local ACTORES="select id from auth.users where email like '${PREFIJO}%'"
  local MIOS="select id from core.scope where owner_user_id in (${ACTORES})"
  local VERSIONES="select id from core.operation_version where created_by in (${ACTORES})"
  docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by in (${ACTORES});
delete from core.balance_observation where operation_version_id in (${VERSIONES});
delete from core.expense_category where operation_version_id in (${VERSIONES});
delete from core.movement_detail where operation_version_id in (${VERSIONES});
delete from core.effect where operation_version_id in (${VERSIONES});
delete from core.operation_version where created_by in (${ACTORES});
delete from core.operation where created_by in (${ACTORES});
delete from core.membership where scope_id in (${MIOS});
delete from core.participant where scope_id in (${MIOS});
delete from core.scope where owner_user_id in (${ACTORES});
delete from auth.users where email like '${PREFIJO}%';
commit;
SQL
}

trap limpiar EXIT

limpiar
alta "${EMAIL_A}"; confirmar "${EMAIL_A}"; TOKEN_A=$(jwt "${EMAIL_A}")
alta "${EMAIL_B}"; confirmar "${EMAIL_B}"; TOKEN_B=$(jwt "${EMAIL_B}")

if [ -z "${TOKEN_A}" ] || [ -z "${TOKEN_B}" ]; then
  echo "error: no se obtuvo un JWT real. ¿Esta GoTrue arrancado?" >&2
  exit 1
fi

# El ambito personal de cada uno, por su ruta canonica.
ambito() {
  curl -s -X POST "${API}/rest/v1/rpc/ensure_personal_scope" \
    -H "apikey: ${KEY}" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d '{"payload":{"currency_code":"EUR"}}'
}
SCOPE_A=$(ambito "${TOKEN_A}" | jget scope_id)
CUR_A=$(ambito "${TOKEN_A}" | jget base_currency_definition_id)
SCOPE_B=$(ambito "${TOKEN_B}" | jget scope_id)

CAT=$("${DBQ[@]}" <<'SQL'
select id from core.category where message_key = 'category.expense.dining' and is_active limit 1;
SQL
)
OTRA_MONEDA=$("${DBQ[@]}" <<'SQL'
select id from core.currency_definition where code = 'USD' limit 1;
SQL
)

uuid() { node -e 'console.log(crypto.randomUUID())'; }

# --------------------------------------------------------------- la sonda ---
# Manda un payload y devuelve  estado|codigo|sqlstate  en una linea.
#
# El SQLSTATE no viaja en la respuesta HTTP: `sec.raise_boundary` lo convierte
# en estado y cuerpo. Se lee del log de PostgreSQL cuando existe, y si no se
# reporta como `-` en vez de inventarlo.
medir() {
  local etiqueta="$1" token="$2" fn="$3" payload="$4"
  local respuesta estado cuerpo codigo detalle

  respuesta=$(curl -s -w '\n%{http_code}' -X POST "${API}/rest/v1/rpc/${fn}" \
    -H "apikey: ${KEY}" ${token:+-H "Authorization: Bearer ${token}"} \
    -H 'Content-Type: application/json' -d "${payload}")
  estado=$(printf '%s' "${respuesta}" | tail -n1)
  cuerpo=$(printf '%s' "${respuesta}" | sed '$d')
  codigo=$(printf '%s' "${cuerpo}" | jget code)

  # En un exito interesa el sobre —`already_processed` distingue escritura de
  # replay—; en un fallo, el mensaje. Nunca los dos, para que la tabla se lea.
  detalle=$(printf '%s' "${cuerpo}" | jget already_processed)
  if [ -z "${detalle}" ]; then
    detalle=$(printf '%s' "${cuerpo}" | jget message | cut -c1-50)
  else
    detalle="already_processed=${detalle}"
  fi

  printf '%-34s %-4s %-32s %s\n' "${etiqueta}" "${estado}" "${codigo:--}" "${detalle}"
}

gasto() {
  local key="$1" scope="$2" cur="$3" cat="$4" amount="${5:-1234}"
  cat <<JSON
{"payload":{"client_operation_id":"${key}","command_contract_version":2,
"scope_id":"${scope}","currency_definition_id":"${cur}","amount":"${amount}",
"effective_date":"2026-09-03","effective_time":"21:40","concept":"Sonda F7C",
"category_id":"${cat}"}}
JSON
}

echo
echo "=== TRIPLETA MEDIDA · estado HTTP · codigo de frontera ==="
printf '%-34s %-4s %-32s %s\n' 'CLASE' 'HTTP' 'CODIGO' 'MENSAJE'
echo "-------------------------------------------------------------------------------------------"

K1=$(uuid)
medir 'exito (alta)'            "${TOKEN_A}" record_personal_expense "$(gasto "${K1}" "${SCOPE_A}" "${CUR_A}" "${CAT}")"
medir 'replay (misma clave)'    "${TOKEN_A}" record_personal_expense "$(gasto "${K1}" "${SCOPE_A}" "${CUR_A}" "${CAT}")"
medir 'idempotencia · otra int.' "${TOKEN_A}" record_personal_expense "$(gasto "${K1}" "${SCOPE_A}" "${CUR_A}" "${CAT}" 9999)"

medir 'auth · sin JWT'          ""           record_personal_expense "$(gasto "$(uuid)" "${SCOPE_A}" "${CUR_A}" "${CAT}")"
medir 'auth · JWT invalido'     "no.es.un.jwt" record_personal_expense "$(gasto "$(uuid)" "${SCOPE_A}" "${CUR_A}" "${CAT}")"

medir 'autz · ambito ajeno'     "${TOKEN_A}" record_personal_expense "$(gasto "$(uuid)" "${SCOPE_B}" "${CUR_A}" "${CAT}")"

medir 'payload · campo de mas'  "${TOKEN_A}" record_personal_expense \
  "{\"payload\":{\"client_operation_id\":\"$(uuid)\",\"command_contract_version\":2,\"scope_id\":\"${SCOPE_A}\",\"currency_definition_id\":\"${CUR_A}\",\"amount\":\"1234\",\"effective_date\":\"2026-09-03\",\"effective_time\":\"21:40\",\"concept\":\"x\",\"category_id\":\"${CAT}\",\"target_balance\":\"1\"}}"
medir 'payload · ingreso c/ cat' "${TOKEN_A}" record_personal_income "$(gasto "$(uuid)" "${SCOPE_A}" "${CUR_A}" "${CAT}")"
medir 'payload · importe cero'  "${TOKEN_A}" record_personal_expense "$(gasto "$(uuid)" "${SCOPE_A}" "${CUR_A}" "${CAT}" 0)"

medir 'dominio · categoria mala' "${TOKEN_A}" record_personal_expense "$(gasto "$(uuid)" "${SCOPE_A}" "${CUR_A}" "$(uuid)")"

medir 'moneda · no es la base'  "${TOKEN_A}" record_personal_expense "$(gasto "$(uuid)" "${SCOPE_A}" "${OTRA_MONEDA}" "${CAT}")"

echo
echo "=== SQLSTATE observado en el log de PostgreSQL ==="
docker logs supabase_db_Nomey --since 2m 2>&1 \
  | grep -oE 'ERROR:  [A-Z_]+|sqlstate "PGRST"|SQLSTATE [0-9A-Z]+' | sort | uniq -c | tail -10
echo "  (los errores de frontera se emiten con  sqlstate 'PGRST'  y su estado va en DETAIL)"

echo
limpiar
echo "=== los datos de desarrollo siguen intactos ==="
DESPUES=$(censo)
echo "  antes:   ${ANTES}"
echo "  despues: ${DESPUES}   (usuarios ajenos / operaciones / comandos / ambitos)"
