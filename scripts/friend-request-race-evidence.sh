#!/usr/bin/env bash
#
# Amigos frente a SESIONES REALES · F12/ADR-005 §4 y F12/ADR-006 §4, §6
# (F12.E.A).
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/friend-request-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# Lo que mide (cada carrera: la primera sesion retiene el cerrojo 3 s tras su
# sentencia; la segunda tiene que ESPERAR y recibir el estado real):
#
#   A · A→B y B→A a la vez: UNA pendiente; la segunda llamada recibe
#       incoming_pending con el id de la primera; ninguna amistad.
#   B · aceptar (retiene 3 s) mientras el emisor cancela: la cancelacion
#       ESPERA y recibe FRIEND_REQUEST_ACCEPTED; una amistad; y al reves,
#       cancelar (retiene) mientras el destinatario acepta: FRIEND_REQUEST_
#       CANCELLED y ninguna amistad.
#   C · doble aceptacion del destinatario a la vez: la segunda ESPERA y
#       responde already_processed=true con la MISMA amistad; una amistad.
#   D · PRECISION SOBRE «accept || remove». Esa carrera NO es construible
#       contra el contrato real: api.remove_friend recibe un friendship_id, y
#       ese id no existe hasta que la aceptacion CONFIRMA. Quien llegara con
#       uno inventado recibe NOT_AUTHORIZED sin tocar nada (lo mide
#       friends.sql H1), asi que no habria concurrencia que medir. Lo que si
#       existe —la serializacion de la pareja alrededor de una amistad viva—
#       se mide aqui en su forma real: aceptar, y en cuanto la amistad existe,
#       eliminar (retiene 3 s) mientras el emisor vuelve a enviar: la nueva
#       solicitud ESPERA y entra pending sobre una amistad ya terminada; una
#       activa, una historica. Con E (crear || eliminar), B (aceptar ||
#       cancelar en los dos ordenes) y C (doble aceptacion), la propiedad
#       queda cubierta sin inventar una carrera imposible.
#   E · eliminar (retiene) || nueva solicitud del otro: la solicitud ESPERA y
#       entra pending (la amistad quedo terminada); sin cooldown.
#   F · una pendiente VENCIDA (fixture) || nueva solicitud: la vieja queda
#       expired_at (persistida) y la nueva entra; una sola pendiente.
#   G · tope exacto: con 9 creadas en la hora, dos creaciones simultaneas del
#       mismo emisor dan UNA pending y UNA FRIEND_REQUEST_RATE_LIMITED: 10.
#   H · rotar el enlace (retiene 3 s) || responder con el token viejo: responder
#       ESPERA y recibe invalid; ninguna amistad. Y al reves: responder
#       (retiene) || rotar: rotar ESPERA; la amistad existe con el token que
#       era valido; el viejo deja de valer despues.
#   I · reciproca: B→A pendiente y B abre el enlace de A y acepta (retiene)
#       mientras A acepta la B→A: A ESPERA y recibe already_processed=true
#       sobre la MISMA amistad; la solicitud queda accepted_via_link.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

UA=f2c00000-0000-4000-8000-0000000000a1  # Ana
UB=f2c00000-0000-4000-8000-0000000000b1  # Bea
UC=f2c00000-0000-4000-8000-0000000000c1  # Cris
USERS="'${UA}','${UB}','${UC}'"

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
delete from core.friendship where user_low in (${USERS}) or user_high in (${USERS});
delete from core.friend_request where requester_user_id in (${USERS}) or target_user_id in (${USERS});
delete from core.friend_link_rotation where user_id in (${USERS});
delete from core.friend_link_attempt where user_id in (${USERS});
delete from core.friend_link where user_id in (${USERS});
delete from core.username_lookup_attempt where user_id in (${USERS});
delete from core.account_handle_event where user_id in (${USERS}) or actor_user_id in (${USERS});
delete from core.account_handle where user_id in (${USERS});
delete from core.account_identity where user_id in (${USERS});
commit;
SQL
}
trap limpiar EXIT
limpiar

sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select * from api.reserve_username('{"handle":"frr_ana","public_name":"Ana"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select * from api.reserve_username('{"handle":"frr_bea","public_name":"Bea"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UC}"}', true);
select * from api.reserve_username('{"handle":"frr_cris","public_name":"Cris"}'::jsonb);
reset role;
commit;
SQL
}
reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

# Sesion real. $1 salida, $2 uid, $3 sentencia, $4 hold.
sesion() {
  {
    printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" \
      "select set_config('request.jwt.claims', json_build_object('sub', '$2')::text, true), set_config('role', 'authenticated', true);" \
      "$3" "${ESPERA_SQL}" "select pg_sleep($4);" "commit;"
  } | "${DB[@]}" >"$1" 2>&1 &
}

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }

# Una sentencia como uid, confirmada; imprime lo que devuelva.
como() { # $1 uid, $2 sentencia
  "${DBQ[@]}" <<SQL | tail -n 1 | tr -d '\r'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1"}', true);
$2
reset role;
commit;
SQL
}

crear_sql()    { echo "select 'R=' || (r ->> 'state') || ':' || coalesce(r ->> 'request_id', '-') || ':' || (r ->> 'already_processed') from api.create_friend_request(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'handle', '$2')) r;"; }
aceptar_sql()  { echo "select 'R=' || (r ->> 'state') || ':' || coalesce(r ->> 'friendship_id', '-') || ':' || (r ->> 'already_processed') from api.accept_friend_request(jsonb_build_object('request_id', '$1')) r;"; }
cancelar_sql() { echo "select 'R=' || (r ->> 'state') || ':' || (r ->> 'already_processed') from api.cancel_friend_request(jsonb_build_object('request_id', '$1')) r;"; }
eliminar_sql() { echo "select 'R=' || (r ->> 'state') || ':' || (r ->> 'already_processed') from api.remove_friend(jsonb_build_object('friendship_id', '$1')) r;"; }
rotar_sql()    { echo "select 'R=' || (r ->> 'version') from api.rotate_friend_link() r;"; }
responder_sql(){ echo "select 'R=' || (r ->> 'state') || ':' || coalesce(r ->> 'friendship_id', '-') || ':' || (r ->> 'already_processed') from api.respond_friend_link(jsonb_build_object('token', '$1', 'action', 'accept')) r;"; }

crear()    { como "$1" "select (r ->> 'request_id') from api.create_friend_request(jsonb_build_object('client_command_id', '$2', 'command_contract_version', 1, 'handle', '$3')) r;"; }
aceptar()  { como "$1" "select (r ->> 'friendship_id') from api.accept_friend_request(jsonb_build_object('request_id', '$2')) r;"; }
enlace()   { como "$1" "select (r ->> 'token') from api.my_friend_link() r;"; }

pendientes() { q "select count(*) from core.friend_request where pair_low = least('$1'::uuid, '$2'::uuid) and pair_high = greatest('$1'::uuid, '$2'::uuid) and accepted_at is null and declined_at is null and cancelled_at is null and expired_at is null;"; }
amistades()  { q "select count(*) from core.friendship where user_low = least('$1'::uuid, '$2'::uuid) and user_high = greatest('$1'::uuid, '$2'::uuid) and ended_at is null;"; }
historicas() { q "select count(*) from core.friendship where user_low = least('$1'::uuid, '$2'::uuid) and user_high = greatest('$1'::uuid, '$2'::uuid) and ended_at is not null;"; }
estado()     { q "select sec.friend_request_state(accepted_at, declined_at, cancelled_at, expired_at, expires_at) || ':' || coalesce(resolution, '-') from core.friend_request where id = '$1';"; }
creadas()    { q "select count(*) from core.friend_request where requester_user_id = '$1' and created_at > now() - interval '60 minutes';"; }
espero()     { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()    { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }
K() { printf 'f2e00000-0000-4000-8000-%012d' "$1"; }

echo "== A · A→B y B→A a la vez =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(crear_sql "$(K 1)" frr_bea)" 3
sleep 1
sesion "${t2}" "${UB}" "$(crear_sql "$(K 2)" frr_ana)" 0
wait
grep -q 'R=pending:.*:false' "${t1}" && ok "A creo la pendiente" || fallo "A: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "B"
grep -q 'R=incoming_pending:' "${t2}" && ok "B recibio incoming_pending (la de A)" || fallo "B: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(pendientes "${UA}" "${UB}")" 1 "pendientes de la pareja"
afirmar "$(q "select count(*) from core.friend_request where requester_user_id = '${UB}';")" 0 "filas de B"
afirmar "$(amistades "${UA}" "${UB}")" 0 "amistades"
rm -f "${t1}" "${t2}"

echo "== B · aceptar (retiene) || cancelar; y cancelar (retiene) || aceptar =="
reiniciar
R=$(crear "${UA}" "$(K 3)" frr_bea)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${R}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(cancelar_sql "${R}")" 0
wait
grep -q 'R=accepted:.*:false' "${t1}" && ok "B acepto" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la cancelacion"
grep -q 'FRIEND_REQUEST_ACCEPTED' "${t2}" && ok "cancelar llego tarde: FRIEND_REQUEST_ACCEPTED" || fallo "cancelar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" accepted:accepted "estado"
afirmar "$(amistades "${UA}" "${UB}")" 1 "amistades"
rm -f "${t1}" "${t2}"
reiniciar
R=$(crear "${UA}" "$(K 4)" frr_bea)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(cancelar_sql "${R}")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${R}")" 0
wait
grep -q 'R=cancelled:false' "${t1}" && ok "A cancelo" || fallo "cancelar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la aceptacion"
grep -q 'FRIEND_REQUEST_CANCELLED' "${t2}" && ok "aceptar llego tarde: FRIEND_REQUEST_CANCELLED" || fallo "aceptar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" cancelled:cancelled "estado"
afirmar "$(amistades "${UA}" "${UB}")" 0 "amistades"
rm -f "${t1}" "${t2}"

echo "== C · doble aceptacion a la vez =="
reiniciar
R=$(crear "${UA}" "$(K 5)" frr_bea)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${R}")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${R}")" 0
wait
F1=$(grep -o 'R=accepted:[^:]*:false' "${t1}" | cut -d: -f2)
F2=$(grep -o 'R=accepted:[^:]*:true' "${t2}" | cut -d: -f2)
[ -n "${F1}" ] && ok "la primera acepto (${F1:0:8}…)" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
[ -n "${F2}" ] && [ "${F1}" = "${F2}" ] && ok "la segunda: already_processed con la MISMA amistad" || fallo "segunda: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(amistades "${UA}" "${UB}")" 1 "amistades"
rm -f "${t1}" "${t2}"

echo "== D · eliminar (retiene) || el otro vuelve a solicitar =="
reiniciar
R=$(crear "${UA}" "$(K 6)" frr_bea)
F=$(aceptar "${UB}" "${R}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(eliminar_sql "${F}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(crear_sql "$(K 7)" frr_bea)" 0
wait
grep -q 'R=ended:false' "${t1}" && ok "B elimino" || fallo "eliminar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la nueva solicitud"
grep -q 'R=pending:.*:false' "${t2}" && ok "la nueva solicitud entro pending (la amistad ya estaba terminada)" || fallo "crear: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(amistades "${UA}" "${UB}")" 0 "amistades activas"
afirmar "$(historicas "${UA}" "${UB}")" 1 "historicas"
afirmar "$(pendientes "${UA}" "${UB}")" 1 "pendientes"
rm -f "${t1}" "${t2}"

echo "== E · nueva solicitud (retiene) || eliminar la amistad =="
reiniciar
R=$(crear "${UA}" "$(K 8)" frr_bea)
F=$(aceptar "${UB}" "${R}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(crear_sql "$(K 9)" frr_bea)" 3
sleep 1
sesion "${t2}" "${UB}" "$(eliminar_sql "${F}")" 0
wait
grep -q 'R=friends:-:false' "${t1}" && ok "crear con la amistad viva: friends, nada escrito" || fallo "crear: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "eliminar"
grep -q 'R=ended:false' "${t2}" && ok "eliminar entro despues" || fallo "eliminar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(pendientes "${UA}" "${UB}")" 0 "pendientes"
afirmar "$(amistades "${UA}" "${UB}")" 0 "amistades activas"
# y sin cooldown, A vuelve a pedir al instante
R2=$(crear "${UA}" "$(K 10)" frr_bea)
[ -n "${R2}" ] && ok "tras eliminar, la solicitud entra sin cooldown" || fallo "no entro la solicitud tras eliminar"
rm -f "${t1}" "${t2}"

echo "== F · pendiente vencida || nueva solicitud =="
reiniciar
R=$(crear "${UA}" "$(K 11)" frr_bea)
"${DB[@]}" -c "update core.friend_request set created_at = now() - interval '31 days', expires_at = now() - interval '1 day' where id = '${R}';" >/dev/null
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${R}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(crear_sql "$(K 12)" frr_bea)" 0
wait
grep -q 'R=expired:-:true' "${t1}" && ok "aceptar la vencida: estado expired (terminalizada)" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la nueva"
grep -q 'R=pending:.*:false' "${t2}" && ok "la nueva entro pending" || fallo "crear: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" expired:expired "la vieja"
afirmar "$(q "select (expired_at is not null)::text from core.friend_request where id = '${R}';")" true "expired_at persistido"
afirmar "$(pendientes "${UA}" "${UB}")" 1 "pendientes"
rm -f "${t1}" "${t2}"

echo "== G · tope exacto: 9 creadas + dos a la vez =="
reiniciar
"${DB[@]}" >/dev/null <<SQL
insert into core.friend_request (requester_user_id, target_user_id, client_command_id, cancelled_at, resolved_by, resolution)
select '${UA}', ('f2f00000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ('f2e00000-0000-4000-8000-' || lpad((900 + g)::text, 12, '0'))::uuid, now(), '${UA}', 'cancelled'
  from generate_series(1, 9) g;
SQL
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(crear_sql "$(K 13)" frr_bea)" 3
sleep 1
sesion "${t2}" "${UA}" "$(crear_sql "$(K 14)" frr_cris)" 0
wait
grep -q 'R=pending:' "${t1}" && ok "la decima entro" || fallo "decima: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la undecima"
grep -q 'FRIEND_REQUEST_RATE_LIMITED' "${t2}" && ok "la undecima: FRIEND_REQUEST_RATE_LIMITED" || fallo "undecima: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(creadas "${UA}")" 10 "creadas en la hora"
rm -f "${t1}" "${t2}"

echo "== H · rotar (retiene) || responder con el token viejo; y responder (retiene) || rotar =="
reiniciar
T=$(enlace "${UA}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(rotar_sql)" 3
sleep 1
sesion "${t2}" "${UB}" "$(responder_sql "${T}")" 0
wait
grep -q 'R=2' "${t1}" && ok "A roto (version 2)" || fallo "rotar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "responder"
grep -q 'R=invalid:-:false' "${t2}" && ok "responder con el viejo: invalid" || fallo "responder: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(amistades "${UA}" "${UB}")" 0 "amistades"
rm -f "${t1}" "${t2}"
reiniciar
T=$(enlace "${UA}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(responder_sql "${T}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(rotar_sql)" 0
wait
grep -q 'R=friends:.*:false' "${t1}" && ok "B respondio con el token valido: friends" || fallo "responder: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "rotar"
grep -q 'R=2' "${t2}" && ok "rotar entro despues (version 2)" || fallo "rotar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(amistades "${UA}" "${UB}")" 1 "amistades"
afirmar "$(q "select count(*) from core.friend_link where user_id = '${UA}' and token = '${T}';")" 0 "el token viejo ya no existe"
rm -f "${t1}" "${t2}"

echo "== I · reciproca: B→A pendiente; B acepta por el enlace de A (retiene) || A acepta la B→A =="
reiniciar
T=$(enlace "${UA}")
R=$(crear "${UB}" "$(K 15)" frr_ana)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(responder_sql "${T}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(aceptar_sql "${R}")" 0
wait
F1=$(grep -o 'R=friends:[^:]*:false' "${t1}" | cut -d: -f2)
F2=$(grep -o 'R=accepted:[^:]*:true' "${t2}" | cut -d: -f2)
[ -n "${F1}" ] && ok "B: friends por el enlace (${F1:0:8}…)" || fallo "responder: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "A"
[ -n "${F2}" ] && [ "${F1}" = "${F2}" ] && ok "A: already_processed sobre la MISMA amistad" || fallo "aceptar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" accepted:accepted_via_link "la B→A"
afirmar "$(amistades "${UA}" "${UB}")" 1 "amistades"
afirmar "$(q "select origin from core.friendship where id = '${F1}';")" link "origen"
rm -f "${t1}" "${t2}"

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · amigos: nueve carreras con sesiones reales, una pendiente por pareja y una amistad por pareja en todas"
  exit 0
fi
echo "FALLOS: ${fallos}"
exit 1
