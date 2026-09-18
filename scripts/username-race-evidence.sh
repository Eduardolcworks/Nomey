#!/usr/bin/env bash
#
# El ciclo de vida del username frente a DOS SESIONES REALES · F12/ADR-001
# §2, §6, §9 (F12.A1).
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/username-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# Lo que mide:
#
#   1 · dos cambios de username de la MISMA cuenta a la vez: el primero
#       (retiene 3 s con el cerrojo de la identidad) entra; el segundo ESPERA
#       y, cuando entra, ve el cambio y se rehusa con USERNAME_CHANGE_COOLDOWN
#       —no con un USERNAME_REQUIRED falso—; queda un solo handle vivo.
#   2 · un invitado reserva un handle (retiene 3 s) y una cuenta normal pide
#       el mismo: la segunda ESPERA al indice unico y recibe USERNAME_TAKEN;
#       la reserva del invitado sigue viva.
#   3 · una reserva CADUCADA: un tercero la desaloja y toma el handle
#       (retiene 3 s) mientras su dueño intenta reclamarla: el dueño ESPERA y
#       recibe USERNAME_REQUIRED; el handle es del tercero.
#   4 · dos cuentas normales piden el mismo handle a la vez: una lo tiene, la
#       otra recibe USERNAME_TAKEN; una sola fila.
#
# En los cuatro casos el resultado es un orden serial que los instantes
# reflejan: nadie se cuela y nadie acaba con dos handles vivos.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

UB=a6c00000-0000-4000-8000-0000000000b1  # Bea, normal
UC=a6c00000-0000-4000-8000-0000000000c1  # Cris, normal
UD=a6c00000-0000-4000-8000-0000000000d1  # Dan, invitado
USERS="'${UB}','${UC}','${UD}'"
HANDLES="'bea_race','cris_race','cris_uno','cris_dos','disputado','caduca','mismo'"

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
delete from core.account_handle_event where user_id in (${USERS}) or actor_user_id in (${USERS}) or handle in (${HANDLES});
delete from core.username_lookup_attempt where user_id in (${USERS});
delete from core.account_handle where user_id in (${USERS}) or handle in (${HANDLES});
delete from core.account_identity where user_id in (${USERS});
commit;
SQL
}
trap limpiar EXIT
limpiar

# Bea y Cris con handle definitivo; Dan sin nada (reserva lo que cada caso pida).
sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select * from api.reserve_username('{"handle":"bea_race","public_name":"Bea"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UC}"}', true);
select * from api.reserve_username('{"handle":"cris_race","public_name":"Cris"}'::jsonb);
reset role;
commit;
SQL
}
reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

# Sesion real. $1 salida, $2 uid, $3 anonimo (true|false), $4 sentencia, $5 hold.
sesion() {
  {
    printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" \
      "select set_config('request.jwt.claims', json_build_object('sub', '$2', 'is_anonymous', $3)::text, true), set_config('role', 'authenticated', true);" \
      "$4" "${ESPERA_SQL}" "select pg_sleep($5);" "commit;"
  } | "${DB[@]}" >"$1" 2>&1 &
}

cambio_sql()  { echo "select 'R=' || handle || ':' || state from api.change_username('{\"handle\":\"$1\"}'::jsonb);"; }
reserva_sql() { echo "select 'R=' || handle || ':' || state from api.reserve_username('{\"handle\":\"$1\",\"public_name\":\"$2\"}'::jsonb);"; }
reclamo_sql() { echo "select 'R=' || handle || ':' || state from api.claim_username();"; }

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }
vivos()   { q "select coalesce(string_agg(handle || '/' || case when claimed_at is null then 'reserved' else 'claimed' end, ',' order by handle), '-') from core.account_handle where user_id = '$1' and released_at is null;"; }
dueno()   { q "select coalesce((select user_id::text || '/' || case when claimed_at is null then 'reserved' else 'claimed' end from core.account_handle where handle = '$1'), '-');"; }
filas()   { q "select count(*) from core.account_handle where handle = '$1';"; }
diario()  { q "select coalesce(string_agg(event, ',' order by id), '-') from core.account_handle_event where handle = '$1';"; }
espero()  { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

echo "== 1 · dos cambios de la misma cuenta a la vez =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UC}" false "$(cambio_sql cris_uno)" 3
sleep 1
sesion "${t2}" "${UC}" false "$(cambio_sql cris_dos)" 0
wait
grep -q 'R=cris_uno:claimed' "${t1}" && ok "el primer cambio entro" || fallo "primero: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "el segundo"
grep -q 'USERNAME_CHANGE_COOLDOWN' "${t2}" && ok "el segundo vio el cambio: USERNAME_CHANGE_COOLDOWN" || fallo "segundo: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(vivos "${UC}")" "cris_uno/claimed" "handles vivos de Cris"
afirmar "$(filas cris_dos)" 0 "filas de cris_dos"
afirmar "$(diario cris_race)" "reserved,claimed,released" "diario de cris_race"
rm -f "${t1}" "${t2}"

echo "== 2 · invitado reserva (retiene 3 s) → cuenta normal pide el mismo =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UD}" true "$(reserva_sql disputado Dan)" 3
sleep 1
sesion "${t2}" "${UB}" false "$(cambio_sql disputado)" 0
wait
grep -q 'R=disputado:reserved' "${t1}" && ok "la reserva del invitado entro" || fallo "invitado: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la cuenta normal"
grep -q 'USERNAME_TAKEN' "${t2}" && ok "la cuenta normal se rehuso: USERNAME_TAKEN" || fallo "normal: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(dueno disputado)" "${UD}/reserved" "dueño de disputado"
afirmar "$(vivos "${UB}")" "bea_race/claimed" "Bea sigue con el suyo"
rm -f "${t1}" "${t2}"

echo "== 3 · reserva caducada: un tercero la desaloja (retiene 3 s) → su dueño reclama =="
reiniciar
"${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UD}","is_anonymous":true}', true);
select * from api.reserve_username('{"handle":"caduca","public_name":"Dan"}'::jsonb);
reset role;
update core.account_handle set reserved_at = now() - interval '8 days', reserved_until = now() - interval '1 second' where handle = 'caduca';
commit;
SQL
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" false "$(cambio_sql caduca)" 3
sleep 1
sesion "${t2}" "${UD}" false "$(reclamo_sql)" 0
wait
grep -q 'R=caduca:claimed' "${t1}" && ok "el tercero desalojo y tomo el handle" || fallo "tercero: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "el dueño"
grep -q 'USERNAME_REQUIRED' "${t2}" && ok "el dueño llego tarde: USERNAME_REQUIRED" || fallo "dueño: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(dueno caduca)" "${UB}/claimed" "dueño de caduca"
afirmar "$(vivos "${UD}")" "-" "Dan sin handle vivo"
afirmar "$(diario caduca)" "reserved,evicted,claimed" "diario de caduca"
rm -f "${t1}" "${t2}"

echo "== 4 · dos cuentas normales piden el mismo handle a la vez =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" false "$(cambio_sql mismo)" 3
sleep 1
sesion "${t2}" "${UC}" false "$(cambio_sql mismo)" 0
wait
grep -q 'R=mismo:claimed' "${t1}" && ok "la primera lo tiene" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q 'USERNAME_TAKEN' "${t2}" && ok "la segunda se rehuso: USERNAME_TAKEN" || fallo "segunda: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(filas mismo)" 1 "filas de mismo"
afirmar "$(dueno mismo)" "${UB}/claimed" "dueño de mismo"
afirmar "$(vivos "${UC}")" "cris_race/claimed" "Cris sigue con el suyo (su cambio se revirtio entero)"
rm -f "${t1}" "${t2}"

echo
if [ "${fallos}" -eq 0 ]; then
  echo "OK · el indice unico y el cerrojo de la identidad serializan el ciclo de vida del username; nadie acaba con dos handles vivos"
else
  echo "FALLOS: ${fallos}"; exit 1
fi
