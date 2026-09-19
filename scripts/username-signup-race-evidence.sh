#!/usr/bin/env bash
#
# Dos altas REALES por GoTrue a la vez, con correos distintos y el MISMO
# username · F12/ADR-001 §5 (F12.A2, hook before_user_created).
#
# Uso, con el stack levantado (hook activo en config.toml) y las migraciones
# aplicadas:
#
#   bash scripts/username-signup-race-evidence.sh
#
# Escribe usuarios (sin confirmar) en auth.users y sus filas de identidad, y los
# retira al final. NO ES UNA MIGRACION.
#
# Lo que mide: el indice unico de core.account_handle arbitra DENTRO de la
# transaccion de alta de GoTrue. Exactamente una de las dos altas crea el
# usuario y se lleva la reserva; la otra recibe 409 USERNAME_TAKEN y NO deja
# auth.users, ni identidad, ni handle, ni apunte en el diario. Sin precheck de
# cliente: las dos peticiones salen a la vez y PostgreSQL decide.
#
# Se repite tres veces con handles distintos: una unica carrera es un dato,
# tres son evidencia de que el resultado no depende de quien llegue primero
# al proceso, sino de quien confirme primero.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1
API="${NOMEY_API_URL:-http://127.0.0.1:54321}"
exigir_frontera_http "${API}" || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)
KEY=$(docker exec supabase_kong_Nomey sh -c 'grep -o "sb_publishable_[A-Za-z0-9_-]*" /home/kong/kong.yml | head -1')
PASS='Nomey-race-check-2026!'
PREFIJO=nomey-race-signup-

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }
q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
delete from core.account_handle_event where user_id in (select id from auth.users where email like '${PREFIJO}%');
delete from core.account_handle where user_id in (select id from auth.users where email like '${PREFIJO}%');
delete from core.account_identity where user_id in (select id from auth.users where email like '${PREFIJO}%');
delete from auth.users where email like '${PREFIJO}%';
commit;
SQL
}
trap limpiar EXIT
limpiar

alta() { # $1 salida, $2 email, $3 username → "status cuerpo" en $1
  {
    curl -s -w '\n%{http_code}' -X POST "${API}/auth/v1/signup" \
      -H "apikey: ${KEY}" -H 'Content-Type: application/json' \
      --data-binary "{\"email\":\"$2\",\"password\":\"${PASS}\",\"data\":{\"display_name\":\"Carrera\",\"requested_username\":\"$3\"}}"
  } >"$1" 2>&1 &
}
estado()  { tail -n 1 "$1"; }
cuerpo()  { head -n 1 "$1"; }
jget()    { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];console.log(v??"")}catch{console.log("")}})' "$1"; }

for i in 1 2 3; do
  H="race_${i}_$(date +%s | tail -c 5)"
  E1="${PREFIJO}${i}a@example.test"; E2="${PREFIJO}${i}b@example.test"
  echo "== ${i} · dos altas a la vez con @${H} =="
  t1=$(mktemp); t2=$(mktemp)
  alta "${t1}" "${E1}" "${H}"
  alta "${t2}" "${E2}" "${H}"
  wait
  s1=$(estado "${t1}"); s2=$(estado "${t2}")
  ok1=0; [ "${s1}" = "200" ] && ok1=1
  ok2=0; [ "${s2}" = "200" ] && ok2=1
  if [ $((ok1 + ok2)) -eq 1 ]; then ok "exactamente una alta entro (${s1} / ${s2})"; else fallo "altas: ${s1} / ${s2} · $(cuerpo "${t1}" | head -c 150) · $(cuerpo "${t2}" | head -c 150)"; fi
  if [ "${ok1}" -eq 1 ]; then WIN="${E1}"; LOSE="${E2}"; tw="${t1}"; tl="${t2}"; else WIN="${E2}"; LOSE="${E1}"; tw="${t2}"; tl="${t1}"; fi
  code=$(cuerpo "${tl}" | jget msg); ec=$(cuerpo "${tl}" | jget error_code); st=$(estado "${tl}")
  [ "${st}" = "409" ] && [ "${code}" = "USERNAME_TAKEN" ] && [ "${ec}" = "unknown" ] && ok "la perdedora: 409 · error_code=unknown · msg=USERNAME_TAKEN" || fallo "perdedora: ${st} ${code} ${ec}"
  WUID=$(cuerpo "${tw}" | jget id)
  [ "$(q "select count(*) from auth.users where email = '${LOSE}';")" = "0" ] && ok "la perdedora no dejo auth.users" || fallo "quedo un usuario para ${LOSE}"
  [ "$(q "select count(*) from auth.users where email = '${WIN}';")" = "1" ] && ok "la ganadora existe en auth.users" || fallo "la ganadora no existe"
  v=$(q "select user_id::text || '|' || (claimed_at is null)::text || '|' || (reserved_until > now())::text from core.account_handle where handle = '${H}';")
  [ "${v}" = "${WUID}|true|true" ] && ok "la reserva de @${H} es de la ganadora, provisional y viva" || fallo "reserva: ${v} (ganadora ${WUID})"
  [ "$(q "select count(*) from core.account_handle where handle = '${H}';")" = "1" ] && ok "una sola fila de handle" || fallo "filas de handle: $(q "select count(*) from core.account_handle where handle = '${H}';")"
  [ "$(q "select count(*) from core.account_identity where user_id = '${WUID}';")" = "1" ] && ok "una identidad, la de la ganadora" || fallo "identidades de la ganadora"
  [ "$(q "select count(*) from core.account_identity i where not exists (select 1 from auth.users u where u.id = i.user_id) and i.created_at > now() - interval '1 minute';")" = "0" ] && ok "ninguna identidad huerfana (sin auth.users) en el ultimo minuto" || fallo "identidad huerfana: la transaccion de la perdedora dejo filas"
  [ "$(q "select string_agg(event, ',' order by id) from core.account_handle_event where handle = '${H}';")" = "reserved" ] && ok "diario: un solo reserved" || fallo "diario: $(q "select string_agg(event, ',' order by id) from core.account_handle_event where handle = '${H}';")"
  rm -f "${t1}" "${t2}"
done

echo
if [ "${fallos}" -eq 0 ]; then
  echo "OK · dos altas simultaneas con el mismo username: una cuenta, una reserva, un 409 USERNAME_TAKEN sin residuo; el indice unico arbitra dentro de la transaccion de GoTrue"
else
  echo "FALLOS: ${fallos}"; exit 1
fi
