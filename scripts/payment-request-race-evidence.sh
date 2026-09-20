#!/usr/bin/env bash
#
# Solicitudes de pago mediante enlace frente a SESIONES REALES · F12/ADR-004
# §19 y §23 (F12.B2).
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/payment-request-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# Lo que mide:
#
#   1 · dos pagadores distintos pagan la misma solicitud a la vez (el primero
#       retiene 3 s con la fila bloqueada): el segundo ESPERA y recibe
#       PAYMENT_REQUEST_ALREADY_PAID; UNA operacion, ligada por
#       paid_operation_id; paid_by es el primero.
#   2 · pagar (retiene 3 s) mientras el creador cancela: la cancelacion ESPERA
#       y recibe PAYMENT_REQUEST_ALREADY_PAID; paid permanece.
#   3 · cancelar (retiene 3 s) mientras alguien paga: el pago ESPERA y recibe
#       PAYMENT_REQUEST_CANCELLED; NINGUNA operacion y ninguna clave.
#   4 · doble tap del mismo pagador con la MISMA clave mientras la primera
#       sigue abierta: el retry ESPERA el indice de la clave y responde
#       already_processed=true con la MISMA operacion; una operacion.
#   5 · dos claves distintas del mismo pagador a la vez: la segunda ESPERA la
#       fila y recibe PAYMENT_REQUEST_ALREADY_PAID; una operacion.
#   6 · caducada entre previsualizar y pagar (fixture): PAYMENT_REQUEST_EXPIRED
#       y nada escrito.
#   7 · tope exacto: con 19 pendientes, dos creaciones simultaneas del mismo
#       creador dan UNA entrada y UNA PAYMENT_REQUEST_LIMIT: quedan 20.
#
# En todos los casos la solicitud acaba con a lo sumo una transicion terminal
# y a lo sumo una operacion, que es el invariante de §19.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

UB=b2c00000-0000-4000-8000-0000000000b1  # Bea, creadora
UA=b2c00000-0000-4000-8000-0000000000a1  # Ana, pagadora
UC=b2c00000-0000-4000-8000-0000000000c1  # Cris, pagador
USERS="'${UA}','${UB}','${UC}'"
EUR=b2c00000-0000-4000-8000-00000000eeee
SCOPES="'b2c00000-0000-4000-8000-0000000001a1','b2c00000-0000-4000-8000-0000000001b1','b2c00000-0000-4000-8000-0000000001c1'"
PA=b2c00000-0000-4000-8000-0000000001a1
PB=b2c00000-0000-4000-8000-0000000001b1
PC=b2c00000-0000-4000-8000-0000000001c1

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.transfer_part tp using core.operation_version ov where ov.id = tp.operation_version_id and ov.created_by in (${USERS});
delete from core.payment_request where created_by in (${USERS}) or paid_by in (${USERS});
delete from core.payment_request_attempt where user_id in (${USERS});
delete from core.balance_observation where scope_id in (${SCOPES});
delete from core.effect where scope_id in (${SCOPES});
delete from core.operation_version where created_by in (${USERS});
delete from core.operation where created_by in (${USERS});
delete from core.client_command where created_by in (${USERS});
delete from core.provisioning_command where created_by in (${USERS});
delete from core.username_lookup_attempt where user_id in (${USERS});
delete from core.account_handle_event where user_id in (${USERS}) or actor_user_id in (${USERS});
delete from core.account_handle where user_id in (${USERS});
delete from core.account_identity where user_id in (${USERS});
delete from core.membership where scope_id in (${SCOPES});
delete from core.scope where id in (${SCOPES});
delete from core.currency_definition where id = '${EUR}';
commit;
SQL
}
trap limpiar EXIT
limpiar

sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${EUR}', 'EUR', 2);
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PA}', 'personal', '${EUR}', '${UA}'), ('${PB}', 'personal', '${EUR}', '${UB}'), ('${PC}', 'personal', '${EUR}', '${UC}');
insert into core.membership (scope_id, user_id) select id, owner_user_id from core.scope where id in (${SCOPES});
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select * from api.reserve_username('{"handle":"prq_ana","public_name":"Ana"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select * from api.reserve_username('{"handle":"prq_bea","public_name":"Bea"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UC}"}', true);
select * from api.reserve_username('{"handle":"prq_cris","public_name":"Cris"}'::jsonb);
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

# Una solicitud de Bea como fixture (por la funcion real); imprime "request_id token".
solicitar() { # $1 clave, $2 importe
  "${DBQ[@]}" <<SQL | grep -v '^{' | tail -n 1 | tr -d '\r'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select (r ->> 'request_id') || ' ' || (r ->> 'token') from api.create_payment_request(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'amount', '$2', 'currency_definition_id', '${EUR}')) r;
reset role;
commit;
SQL
}

pagar_sql()    { echo "select 'R=' || (r ->> 'operation_id') || ':' || (r ->> 'already_processed') from api.record_internal_transfer(jsonb_build_object('client_operation_id', '$2', 'command_contract_version', 1, 'payment_request_token', '$1')) r;"; }
cancelar_sql() { echo "select 'R=' || (r ->> 'state') from api.cancel_payment_request(jsonb_build_object('request_id', '$1')) r;"; }
crear_sql()    { echo "select 'R=' || case when (r ->> 'token') is null then 'sin-token' else 'creada' end from api.create_payment_request(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'amount', '$2', 'currency_definition_id', '${EUR}')) r;"; }

estado()   { q "select sec.payment_request_state(paid_operation_id, cancelled_at, expires_at) from core.payment_request where id = '$1';"; }
pagador()  { q "select coalesce(paid_by::text, '-') from core.payment_request where id = '$1';"; }
ops()      { q "select count(*) from core.operation where operation_class = 'internal_transfer' and created_by in (${USERS});"; }
versiones(){ q "select count(*) from core.operation_version ov join core.operation o on o.id = ov.operation_id where o.operation_class = 'internal_transfer' and o.created_by in (${USERS});"; }
claves()   { q "select count(*) from core.client_command where created_by in (${USERS});"; }
pendientes(){ q "select count(*) from core.payment_request r where r.created_by = '$1' and sec.payment_request_state(r.paid_operation_id, r.cancelled_at, r.expires_at) = 'pending';"; }
saldo()    { q "select coalesce(sum(e.balance_amount), 0) from core.current_effect e where e.scope_id = '$1' and e.balance_amount is not null;"; }
espero()   { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()  { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

K() { printf 'b2e00000-0000-4000-8000-%012d' "$1"; }

echo "== 1 · dos pagadores distintos a la vez =="
reiniciar
read -r R T <<<"$(solicitar "$(K 1)" 2500)"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(pagar_sql "${T}" "$(K 101)")" 3
sleep 1
sesion "${t2}" "${UC}" "$(pagar_sql "${T}" "$(K 102)")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "Ana pago" || fallo "Ana: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "Cris"
grep -q 'PAYMENT_REQUEST_ALREADY_PAID' "${t2}" && ok "Cris llego tarde: PAYMENT_REQUEST_ALREADY_PAID" || fallo "Cris: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" paid "estado"
afirmar "$(pagador "${R}")" "${UA}" "paid_by"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(claves)" 1 "claves (la de Cris revirtio)"
afirmar "$(saldo "${PA}")" -2500 "saldo de Ana"
afirmar "$(saldo "${PC}")" 0 "saldo de Cris"
rm -f "${t1}" "${t2}"

echo "== 2 · pagar (retiene 3 s) mientras el creador cancela =="
reiniciar
read -r R T <<<"$(solicitar "$(K 2)" 2500)"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(pagar_sql "${T}" "$(K 103)")" 3
sleep 1
sesion "${t2}" "${UB}" "$(cancelar_sql "${R}")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "el pago entro" || fallo "pago: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la cancelacion"
grep -q 'PAYMENT_REQUEST_ALREADY_PAID' "${t2}" && ok "la cancelacion llego tarde: PAYMENT_REQUEST_ALREADY_PAID" || fallo "cancelar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" paid "estado"
afirmar "$(ops)" 1 "operaciones"
rm -f "${t1}" "${t2}"

echo "== 3 · cancelar (retiene 3 s) mientras alguien paga =="
reiniciar
read -r R T <<<"$(solicitar "$(K 3)" 2500)"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(cancelar_sql "${R}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(pagar_sql "${T}" "$(K 104)")" 0
wait
grep -q 'R=cancelled' "${t1}" && ok "la cancelacion entro" || fallo "cancelar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "el pago"
grep -q 'PAYMENT_REQUEST_CANCELLED' "${t2}" && ok "el pago llego tarde: PAYMENT_REQUEST_CANCELLED" || fallo "pago: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${R}")" cancelled "estado"
afirmar "$(ops)" 0 "operaciones"
afirmar "$(claves)" 0 "claves"
afirmar "$(saldo "${PA}")" 0 "saldo de Ana"
rm -f "${t1}" "${t2}"

echo "== 4 · doble tap: la MISMA clave mientras la primera sigue abierta =="
reiniciar
read -r R T <<<"$(solicitar "$(K 4)" 2500)"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(pagar_sql "${T}" "$(K 105)")" 3
sleep 1
sesion "${t2}" "${UA}" "$(pagar_sql "${T}" "$(K 105)")" 0
wait
op1=$(grep -o 'R=[0-9a-f-]*:false' "${t1}" | cut -d= -f2 | cut -d: -f1)
op2=$(grep -o 'R=[0-9a-f-]*:true' "${t2}" | cut -d= -f2 | cut -d: -f1)
[ -n "${op1}" ] && ok "la primera entro" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "el retry"
[ -n "${op2}" ] && [ "${op1}" = "${op2}" ] && ok "el retry respondio already_processed=true con la MISMA operacion" || fallo "retry: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(versiones)" 1 "versiones"
afirmar "$(claves)" 1 "claves"
rm -f "${t1}" "${t2}"

echo "== 5 · dos claves distintas del mismo pagador a la vez =="
reiniciar
read -r R T <<<"$(solicitar "$(K 5)" 2500)"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(pagar_sql "${T}" "$(K 106)")" 3
sleep 1
sesion "${t2}" "${UA}" "$(pagar_sql "${T}" "$(K 107)")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "la primera entro" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q 'PAYMENT_REQUEST_ALREADY_PAID' "${t2}" && ok "la segunda vio el pago: PAYMENT_REQUEST_ALREADY_PAID" || fallo "segunda: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(claves)" 1 "claves (la segunda revirtio la suya)"
afirmar "$(q "select count(*) from core.payment_request where id = '${R}' and paid_operation_id = (select id from core.operation where operation_class = 'internal_transfer' and created_by = '${UA}');")" 1 "la solicitud liga la unica operacion"
rm -f "${t1}" "${t2}"

echo "== 6 · caducada entre previsualizar y pagar =="
reiniciar
read -r R T <<<"$(solicitar "$(K 6)" 2500)"
"${DB[@]}" >/dev/null 2>&1 <<SQL
update core.payment_request set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where id = '${R}';
SQL
t1=$(mktemp)
sesion "${t1}" "${UA}" "$(pagar_sql "${T}" "$(K 108)")" 0
wait
grep -q 'PAYMENT_REQUEST_EXPIRED' "${t1}" && ok "PAYMENT_REQUEST_EXPIRED" || fallo "pago: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
afirmar "$(estado "${R}")" expired "estado"
afirmar "$(ops)" 0 "operaciones"
afirmar "$(claves)" 0 "claves"
rm -f "${t1}"

echo "== 7 · tope exacto: 19 pendientes y dos creaciones simultaneas =="
reiniciar
n=0
while [ "${n}" -lt 19 ]; do n=$((n + 1)); solicitar "$(K $((200 + n)))" "${n}" >/dev/null; done
afirmar "$(pendientes "${UB}")" 19 "pendientes de Bea antes de la carrera"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(crear_sql "$(K 220)" 20)" 2
sesion "${t2}" "${UB}" "$(crear_sql "$(K 221)" 21)" 0
wait
e1=0; e2=0; l1=0; l2=0
grep -q 'R=creada' "${t1}" && e1=1; grep -q 'R=creada' "${t2}" && e2=1
grep -q 'PAYMENT_REQUEST_LIMIT' "${t1}" && l1=1; grep -q 'PAYMENT_REQUEST_LIMIT' "${t2}" && l2=1
[ "$((e1 + e2))" -eq 1 ] && [ "$((l1 + l2))" -eq 1 ] && ok "una entro y una recibio PAYMENT_REQUEST_LIMIT" || fallo "entradas=$((e1 + e2)) frenadas=$((l1 + l2)) · $(grep -i 'R=\|error' "${t1}" "${t2}" | head -c 300)"
afirmar "$(pendientes "${UB}")" 20 "pendientes de Bea tras la carrera (exacto)"
rm -f "${t1}" "${t2}"

echo
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la fila de la solicitud, la clave de idempotencia y el cerrojo por creador serializan el pago al portador: a lo sumo una transicion terminal, a lo sumo una operacion, y veinte de veintiuna"
else
  echo "FALLOS: ${fallos}"; exit 1
fi
