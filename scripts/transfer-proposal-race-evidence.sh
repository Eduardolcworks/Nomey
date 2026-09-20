#!/usr/bin/env bash
#
# Propuestas de transferencia entre usuarios frente a SESIONES REALES ·
# F12/ADR-002 §10 y §18 (F12.B1).
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/transfer-proposal-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# Lo que mide:
#
#   1 · B acepta (retiene 3 s con la fila bloqueada) mientras A cancela: A
#       ESPERA y recibe PROPOSAL_ACCEPTED; UNA operacion.
#   2 · A cancela (retiene 3 s) mientras B acepta: B ESPERA y recibe
#       PROPOSAL_CANCELLED; NINGUNA operacion y ninguna clave reclamada.
#   3 · B rechaza (retiene 3 s) mientras B acepta desde otro dispositivo (otra
#       clave): la aceptacion ESPERA y recibe PROPOSAL_DECLINED; ninguna
#       operacion.
#   4 · doble aceptacion con DOS claves: la segunda ESPERA la fila y recibe
#       PROPOSAL_ACCEPTED; UNA operacion, ligada por accepted_operation_id.
#   5 · retry con la MISMA clave mientras la primera sigue abierta: la segunda
#       ESPERA el indice unico de la clave y responde already_processed=true
#       con la MISMA operacion; UNA operacion, UNA version.
#   6 · presupuesto exacto: con nueve creadas en la hora, dos creaciones
#       simultaneas del mismo emisor dan UNA entrada y UNA
#       PROPOSAL_RATE_LIMITED —no once—; y ONCE simultaneas desde cero dan
#       exactamente DIEZ.
#   7 · emisores distintos no se esperan: A retiene 3 s su cerrojo y B crea
#       la suya sin esperar.
#
# En todos los casos la propuesta acaba con a lo sumo una transicion terminal
# y a lo sumo una operacion, que es el invariante de §10.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

UA=b1c00000-0000-4000-8000-0000000000a1  # Ana, emisora
UB=b1c00000-0000-4000-8000-0000000000b1  # Bea, receptora
UC=b1c00000-0000-4000-8000-0000000000c1  # Cris, receptor (presupuesto)
UD=b1c00000-0000-4000-8000-0000000000d1  # Dan, receptor (presupuesto)
UE=b1c00000-0000-4000-8000-0000000000e1  # Eva, receptora (presupuesto)
USERS="'${UA}','${UB}','${UC}','${UD}','${UE}'"
EUR=b1c00000-0000-4000-8000-00000000eeee
SCOPES="'b1c00000-0000-4000-8000-0000000001a1','b1c00000-0000-4000-8000-0000000001b1','b1c00000-0000-4000-8000-0000000001c1','b1c00000-0000-4000-8000-0000000001d1','b1c00000-0000-4000-8000-0000000001e1'"
PA=b1c00000-0000-4000-8000-0000000001a1
PB=b1c00000-0000-4000-8000-0000000001b1

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.transfer_part tp using core.operation_version ov where ov.id = tp.operation_version_id and ov.created_by in (${USERS});
delete from core.transfer_proposal where created_by in (${USERS}) or target_user_id in (${USERS});
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

# Cinco cuentas normales con handle definitivo y Modo Personal en EUR.
sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${EUR}', 'EUR', 2);
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PA}', 'personal', '${EUR}', '${UA}'),
  ('${PB}', 'personal', '${EUR}', '${UB}'),
  ('b1c00000-0000-4000-8000-0000000001c1', 'personal', '${EUR}', '${UC}'),
  ('b1c00000-0000-4000-8000-0000000001d1', 'personal', '${EUR}', '${UD}'),
  ('b1c00000-0000-4000-8000-0000000001e1', 'personal', '${EUR}', '${UE}');
insert into core.membership (scope_id, user_id) select id, owner_user_id from core.scope where id in (${SCOPES});
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select * from api.reserve_username('{"handle":"race_ana","public_name":"Ana"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select * from api.reserve_username('{"handle":"race_bea","public_name":"Bea"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UC}"}', true);
select * from api.reserve_username('{"handle":"race_cris","public_name":"Cris"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UD}"}', true);
select * from api.reserve_username('{"handle":"race_dan","public_name":"Dan"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UE}"}', true);
select * from api.reserve_username('{"handle":"race_eva","public_name":"Eva"}'::jsonb);
reset role;
commit;
SQL
}
reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

# Sesion real. $1 salida, $2 uid, $3 sentencia, $4 hold (segundos con la transaccion abierta tras la sentencia).
sesion() {
  {
    printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" \
      "select set_config('request.jwt.claims', json_build_object('sub', '$2')::text, true), set_config('role', 'authenticated', true);" \
      "$3" "${ESPERA_SQL}" "select pg_sleep($4);" "commit;"
  } | "${DB[@]}" >"$1" 2>&1 &
}

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }

# Una propuesta A → @handle como fixture (por la funcion real), devuelve su id.
proponer() { # $1 clave, $2 handle, $3 importe
  "${DBQ[@]}" <<SQL | grep -v '^{' | tail -n 1 | tr -d '[:space:]'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_transfer_proposal(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'handle', '$2', 'amount', '$3', 'currency_definition_id', '${EUR}')) ->> 'proposal_id';
reset role;
commit;
SQL
}

aceptar_sql()  { echo "select 'R=' || (r ->> 'operation_id') || ':' || (r ->> 'already_processed') from api.record_internal_transfer(jsonb_build_object('client_operation_id', '$2', 'command_contract_version', 1, 'proposal_id', '$1')) r;"; }
cancelar_sql() { echo "select 'R=' || (r ->> 'state') from api.cancel_transfer_proposal(jsonb_build_object('proposal_id', '$1')) r;"; }
rechazar_sql() { echo "select 'R=' || (r ->> 'state') from api.decline_transfer_proposal(jsonb_build_object('proposal_id', '$1')) r;"; }
crear_sql()    { echo "select 'R=' || (r ->> 'state') from api.create_transfer_proposal(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'handle', '$2', 'amount', '$3', 'currency_definition_id', '${EUR}')) r;"; }

estado()   { q "select sec.transfer_proposal_state(accepted_operation_id, cancelled_at, declined_at, expires_at) from core.transfer_proposal where id = '$1';"; }
ops()      { q "select count(*) from core.operation where operation_class = 'internal_transfer' and created_by in (${USERS});"; }
versiones(){ q "select count(*) from core.operation_version ov join core.operation o on o.id = ov.operation_id where o.operation_class = 'internal_transfer' and o.created_by in (${USERS});"; }
claves()   { q "select count(*) from core.client_command where created_by in (${USERS});"; }
creadas()  { q "select count(*) from core.transfer_proposal where created_by = '$1';"; }
saldo()    { q "select coalesce(sum(e.balance_amount), 0) from core.current_effect e where e.scope_id = '$1' and e.balance_amount is not null;"; }
espero()   { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
no_espero(){ local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e < 1.5) }'; then ok "$2 no espero (${e} s)"; else fallo "$2 espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()  { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

K() { printf 'b1e00000-0000-4000-8000-%012d' "$1"; }

echo "== 1 · B acepta (retiene 3 s) mientras A cancela =="
reiniciar
P=$(proponer "$(K 1)" race_bea 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 101)")" 3
sleep 1
sesion "${t2}" "${UA}" "$(cancelar_sql "${P}")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "la aceptacion entro" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la cancelacion"
grep -q 'PROPOSAL_ACCEPTED' "${t2}" && ok "la cancelacion llego tarde: PROPOSAL_ACCEPTED" || fallo "cancelar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" accepted "estado"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(saldo "${PA}")" -2500 "saldo de A"
rm -f "${t1}" "${t2}"

echo "== 2 · A cancela (retiene 3 s) mientras B acepta =="
reiniciar
P=$(proponer "$(K 2)" race_bea 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(cancelar_sql "${P}")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${P}" "$(K 102)")" 0
wait
grep -q 'R=cancelled' "${t1}" && ok "la cancelacion entro" || fallo "cancelar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la aceptacion"
grep -q 'PROPOSAL_CANCELLED' "${t2}" && ok "la aceptacion llego tarde: PROPOSAL_CANCELLED" || fallo "aceptar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" cancelled "estado"
afirmar "$(ops)" 0 "operaciones"
afirmar "$(claves)" 0 "claves reclamadas (la aceptacion revirtio entera)"
afirmar "$(saldo "${PA}")" 0 "saldo de A"
rm -f "${t1}" "${t2}"

echo "== 3 · B rechaza (retiene 3 s) mientras B acepta desde otro dispositivo =="
reiniciar
P=$(proponer "$(K 3)" race_bea 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(rechazar_sql "${P}")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${P}" "$(K 103)")" 0
wait
grep -q 'R=declined' "${t1}" && ok "el rechazo entro" || fallo "rechazar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la aceptacion"
grep -q 'PROPOSAL_DECLINED' "${t2}" && ok "la aceptacion llego tarde: PROPOSAL_DECLINED" || fallo "aceptar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" declined "estado"
afirmar "$(ops)" 0 "operaciones"
rm -f "${t1}" "${t2}"

echo "== 4 · doble aceptacion con DOS claves (dos dispositivos de B) =="
reiniciar
P=$(proponer "$(K 4)" race_bea 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 104)")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${P}" "$(K 105)")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "la primera entro" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q 'PROPOSAL_ACCEPTED' "${t2}" && ok "la segunda vio la aceptacion: PROPOSAL_ACCEPTED" || fallo "segunda: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(claves)" 1 "claves reclamadas (la segunda revirtio la suya)"
afirmar "$(q "select count(*) from core.transfer_proposal where id = '${P}' and accepted_operation_id = (select id from core.operation where operation_class = 'internal_transfer' and created_by = '${UB}');")" 1 "la propuesta liga la unica operacion"
afirmar "$(saldo "${PB}")" 2500 "saldo de B"
rm -f "${t1}" "${t2}"

echo "== 5 · retry con la MISMA clave mientras la primera sigue abierta =="
reiniciar
P=$(proponer "$(K 5)" race_bea 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 106)")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${P}" "$(K 106)")" 0
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

echo "== 6 · presupuesto exacto: nueve creadas, dos simultaneas; y once desde cero =="
reiniciar
# nueve en la hora: tres por pareja (Bea, Cris, Dan), por la funcion real
n=0
for h in race_bea race_cris race_dan; do
  for i in 1 2 3; do n=$((n + 1)); proponer "$(K $((200 + n)))" "${h}" "${n}" >/dev/null; done
done
afirmar "$(creadas "${UA}")" 9 "creadas de A antes de la carrera"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(crear_sql "$(K 211)" race_eva 11)" 2
sesion "${t2}" "${UA}" "$(crear_sql "$(K 212)" race_eva 12)" 0
wait
e1=0; e2=0; l1=0; l2=0
grep -q 'R=pending' "${t1}" && e1=1; grep -q 'R=pending' "${t2}" && e2=1
grep -q 'PROPOSAL_RATE_LIMITED' "${t1}" && l1=1; grep -q 'PROPOSAL_RATE_LIMITED' "${t2}" && l2=1
[ "$((e1 + e2))" -eq 1 ] && [ "$((l1 + l2))" -eq 1 ] && ok "una entro y una recibio PROPOSAL_RATE_LIMITED" || fallo "entradas=$((e1 + e2)) frenadas=$((l1 + l2)) · $(grep -i 'R=\|error' "${t1}" "${t2}" | head -c 300)"
afirmar "$(creadas "${UA}")" 10 "creadas de A tras la carrera (exacto, sin ±1)"
rm -f "${t1}" "${t2}"

reiniciar
# once a la vez desde cero, repartidas en cuatro parejas para no tocar el tope de 3 pending
declare -a T=()
n=0
for h in race_bea race_cris race_dan race_eva race_bea race_cris race_dan race_eva race_bea race_cris race_dan; do
  n=$((n + 1)); t=$(mktemp); T+=("${t}")
  sesion "${t}" "${UA}" "$(crear_sql "$(K $((300 + n)))" "${h}" "${n}")" 0.3
done
wait
entradas=0; frenadas=0; otros=0
for t in "${T[@]}"; do
  if grep -q 'R=pending' "${t}"; then entradas=$((entradas + 1))
  elif grep -q 'PROPOSAL_RATE_LIMITED' "${t}"; then frenadas=$((frenadas + 1))
  else otros=$((otros + 1)); echo "    sesion sin veredicto: $(grep -i 'R=\|error' "${t}" | head -c 200)"; fi
  rm -f "${t}"
done
[ "${entradas}" -eq 10 ] && [ "${frenadas}" -eq 1 ] && [ "${otros}" -eq 0 ] && ok "once simultaneas: diez entraron y una PROPOSAL_RATE_LIMITED" || fallo "once simultaneas: entradas=${entradas} frenadas=${frenadas} otros=${otros}"
afirmar "$(creadas "${UA}")" 10 "creadas de A"

echo "== 7 · emisores distintos no se esperan =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(crear_sql "$(K 401)" race_bea 1)" 3
sleep 1
sesion "${t2}" "${UB}" "$(crear_sql "$(K 402)" race_ana 2)" 0
wait
grep -q 'R=pending' "${t1}" && ok "A creo la suya" || fallo "A: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
grep -q 'R=pending' "${t2}" && ok "B creo la suya" || fallo "B: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
no_espero "${t2}" "B"
rm -f "${t1}" "${t2}"

echo
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la fila de la propuesta, la clave de idempotencia y el cerrojo por emisor serializan las dos voluntades: a lo sumo una transicion terminal, a lo sumo una operacion, y diez de once"
else
  echo "FALLOS: ${fallos}"; exit 1
fi
