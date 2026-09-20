#!/usr/bin/env bash
#
# Propuestas de transferencia DENTRO DE UN GRUPO frente a SESIONES REALES ·
# F12/ADR-003 §6, §14, §18 y §20 (F12.B3).
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/group-transfer-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# Lo que mide (la salida es la REAL, api.leave_group, que exige neto cero):
#
#   1 · aceptar (retiene 3 s: fila + rango 1) mientras el emisor sale: la
#       salida ESPERA el rango 1, entra con neto cero (la aceptacion ya
#       incluyo el settlement) y la propuesta sigue accepted con su operacion.
#   2 · salir (retiene 3 s el rango 1) mientras el receptor acepta: la
#       aceptacion ESPERA y recibe PROPOSAL_CANCELLED (departure); ninguna
#       operacion, ninguna clave.
#   3 · rechazar vs salir, en los dos ordenes: el primero decide.
#   4 · cancelar (creador) vs salir, en los dos ordenes: el primero decide.
#   5 · aceptar vs cancelar (creador): el primero decide; una operacion a lo
#       sumo.
#   6 · doble aceptacion con DOS claves: una operacion, ligada.
#   7 · caducada (fixture) y despues salida: expired por precedencia.
#   8 · presupuesto MIXTO exacto: nueve creadas (Personal y grupo mezcladas)
#       y una Personal y una de grupo simultaneas: UNA entra y UNA recibe
#       PROPOSAL_RATE_LIMITED; quedan diez.
#   9 · volver (rejoin real) tras cancelled·departure: no revive; aceptar
#       sigue siendo PROPOSAL_CANCELLED.
#
# En todos los casos: a lo sumo una transicion terminal, a lo sumo una
# operacion, y el estado final es el del primero en confirmar (§18).

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

UA=b3c00000-0000-4000-8000-0000000000a1  # Aitor, emisor
UB=b3c00000-0000-4000-8000-0000000000b1  # Edu, receptor
UC=b3c00000-0000-4000-8000-0000000000c1  # Cris, tercero (invita al que vuelve)
UF=b3c00000-0000-4000-8000-0000000000f1  # Fer, destino de propuestas Personales
USERS="'${UA}','${UB}','${UC}','${UF}'"
EUR=b3c00000-0000-4000-8000-00000000eeee
PA=b3c00000-0000-4000-8000-0000000001a1
PB=b3c00000-0000-4000-8000-0000000001b1
PC=b3c00000-0000-4000-8000-0000000001c1
PF=b3c00000-0000-4000-8000-0000000001f1
G=b3c00000-0000-4000-8000-0000000002a1
XA=b3c00000-0000-4000-8000-0000000003a1
XB=b3c00000-0000-4000-8000-0000000003b1
XC=b3c00000-0000-4000-8000-0000000003c1
SCOPES="'${PA}','${PB}','${PC}','${PF}','${G}'"
CAT=4ed30a44-9f82-578f-828c-b491a25ebdd9

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.transfer_part tp using core.operation_version ov where ov.id = tp.operation_version_id and ov.created_by in (${USERS});
delete from core.group_transfer_proposal where created_by in (${USERS});
delete from core.transfer_proposal where created_by in (${USERS}) or target_user_id in (${USERS});
delete from core.group_notice where scope_id in (${SCOPES});
delete from core.group_invitation where scope_id in (${SCOPES});
delete from core.balance_observation where scope_id in (${SCOPES});
delete from core.split_participant where scope_id in (${SCOPES});
delete from core.split where scope_id in (${SCOPES});
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in (${USERS});
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in (${USERS});
delete from core.effect where scope_id in (${SCOPES});
delete from core.link_baseline b using core.operation o where o.id = b.operation_id and o.created_by in (${USERS});
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id in (${SCOPES});
delete from core.operation_version where created_by in (${USERS});
delete from core.operation where created_by in (${USERS});
delete from core.client_command where created_by in (${USERS});
delete from core.provisioning_command where created_by in (${USERS});
delete from core.participant_period where participant_id in (select id from core.participant where scope_id in (${SCOPES}));
delete from core.participant_user_link where scope_id in (${SCOPES});
delete from core.group_departure where scope_id in (${SCOPES});
delete from core.invitation_attempt where user_id in (${USERS});
delete from core.username_lookup_attempt where user_id in (${USERS});
delete from core.account_handle_event where user_id in (${USERS}) or actor_user_id in (${USERS});
delete from core.account_handle where user_id in (${USERS});
delete from core.account_identity where user_id in (${USERS});
delete from core.membership where scope_id in (${SCOPES});
delete from core.group_profile where scope_id in (${SCOPES});
delete from core.participant where scope_id in (${SCOPES});
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
  ('${PA}', 'personal', '${EUR}', '${UA}'), ('${PB}', 'personal', '${EUR}', '${UB}'),
  ('${PC}', 'personal', '${EUR}', '${UC}'), ('${PF}', 'personal', '${EUR}', '${UF}');
insert into core.scope (id, kind, base_currency_definition_id) values ('${G}', 'group', '${EUR}');
insert into core.group_profile (scope_id, display_name, emoji, created_by) values ('${G}', 'Carrera B3', 'GRP', '${UC}');
insert into core.membership (scope_id, user_id) values
  ('${PA}', '${UA}'), ('${PB}', '${UB}'), ('${PC}', '${UC}'), ('${PF}', '${UF}'),
  ('${G}', '${UA}'), ('${G}', '${UB}'), ('${G}', '${UC}');
insert into core.participant (id, scope_id, display_name) values ('${XA}', '${G}', 'Aitor'), ('${XB}', '${G}', 'Edu'), ('${XC}', '${G}', 'Cris');
insert into core.participant_user_link (participant_id, scope_id, user_id) values ('${XA}', '${G}', '${UA}'), ('${XB}', '${G}', '${UB}'), ('${XC}', '${G}', '${UC}');
insert into core.participant_period (participant_id, valid_from) values ('${XA}', date '2020-01-01'), ('${XB}', date '2020-01-01'), ('${XC}', date '2020-01-01');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select * from api.reserve_username('{"handle":"gt_aitor","public_name":"Aitor"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select * from api.reserve_username('{"handle":"gt_edu","public_name":"Edu"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UC}"}', true);
select * from api.reserve_username('{"handle":"gt_cris","public_name":"Cris"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UF}"}', true);
select * from api.reserve_username('{"handle":"gt_fer","public_name":"Fer"}'::jsonb);
reset role;
commit;
SQL
}
reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

sesion() { # $1 salida, $2 uid, $3 sentencia, $4 hold
  {
    printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" \
      "select set_config('request.jwt.claims', json_build_object('sub', '$2')::text, true), set_config('role', 'authenticated', true);" \
      "$3" "${ESPERA_SQL}" "select pg_sleep($4);" "commit;"
  } | "${DB[@]}" >"$1" 2>&1 &
}

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }
como() { # $1 uid, $2 sentencia; imprime la ultima fila
  "${DBQ[@]}" <<SQL | grep -v '^{' | tail -n 1 | tr -d '[:space:]'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1"}', true);
$2
reset role;
commit;
SQL
}

# Fixtures por las funciones reales.
gasto() { como "${UB}" "select api.record_group_expense(jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1, 'effective_date', current_date::text, 'scope_id', '${G}', 'currency_definition_id', '${EUR}', 'total', '$1', 'concept', 'Gasto', 'category_id', '${CAT}', 'payer_participant_id', '${XB}', 'participants', jsonb_build_array('${XB}', '${XA}'), 'split_method', jsonb_build_object('kind', 'equal'))) ->> 'operation_id';"; }
proponer() { como "${UA}" "select api.create_group_transfer_proposal(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'group_scope_id', '${G}', 'receiver_participant_id', '${XB}', 'amount', '$2')) ->> 'proposal_id';"; }
proponer_personal() { como "${UA}" "select api.create_transfer_proposal(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'handle', 'gt_fer', 'amount', '$2', 'currency_definition_id', '${EUR}')) ->> 'proposal_id';"; }
salir_ahora() { como "$1" "select api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', '${G}')) ->> 'already_processed';"; }

aceptar_sql()  { echo "select 'R=' || (r ->> 'operation_id') || ':' || (r ->> 'already_processed') from api.record_settlement_by_transfer(jsonb_build_object('client_operation_id', '$2', 'command_contract_version', 1, 'proposal_id', '$1')) r;"; }
cancelar_sql() { echo "select 'R=' || (r ->> 'state') from api.cancel_group_transfer_proposal(jsonb_build_object('proposal_id', '$1')) r;"; }
rechazar_sql() { echo "select 'R=' || (r ->> 'state') from api.decline_group_transfer_proposal(jsonb_build_object('proposal_id', '$1')) r;"; }
salir_sql()    { echo "select 'R=salio' from api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', '${G}')) r;"; }
crear_g_sql()  { echo "select 'R=creada' from api.create_group_transfer_proposal(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'group_scope_id', '${G}', 'receiver_participant_id', '${XC}', 'amount', '$2')) r;"; }
crear_p_sql()  { echo "select 'R=creada' from api.create_transfer_proposal(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'handle', 'gt_cris', 'amount', '$2', 'currency_definition_id', '${EUR}')) r;"; }

estado()   { q "select st.state || coalesce('·' || st.cancel_reason, '') from core.group_transfer_proposal g cross join lateral sec.derive_group_transfer_proposal_state(g.group_scope_id, g.sender_participant_id, g.receiver_participant_id, g.created_at, g.expires_at, g.accepted_operation_id, g.declined_at, g.cancelled_at) st where g.id = '$1';"; }
ops()      { q "select count(*) from core.operation where operation_class = 'settlement_by_transfer' and created_by in (${USERS});"; }
claves()   { q "select count(*) from core.client_command where created_by in (${USERS}) and command_type like 'settlement_by_transfer%';"; }
miembro()  { q "select exists (select 1 from core.membership where scope_id = '${G}' and user_id = '$1');"; }
neto()     { q "select sec.net_debt('${G}', '${XA}', '${XB}', null);"; }
creadas()  { q "select (select count(*) from core.transfer_proposal where created_by = '${UA}') + (select count(*) from core.group_transfer_proposal where created_by = '${UA}');"; }
espero()   { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()  { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }
K() { printf 'b3e00000-0000-4000-8000-%012d' "$1"; }

echo "== 1 · aceptar (retiene 3 s) mientras el emisor sale =="
reiniciar
gasto 5000 >/dev/null          # Aitor debe 25 a Edu
P=$(proponer "$(K 1)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 101)")" 3
sleep 1
sesion "${t2}" "${UA}" "$(salir_sql)" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "la aceptacion entro" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la salida"
grep -q 'R=salio' "${t2}" && ok "la salida entro despues, con neto cero" || fallo "salir: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" accepted "estado"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(neto)" 0 "neto Aitor→Edu"
afirmar "$(miembro "${UA}")" f "Aitor sigue siendo miembro"
rm -f "${t1}" "${t2}"

echo "== 2 · salir (retiene 3 s) mientras el receptor acepta =="
reiniciar
P=$(proponer "$(K 2)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(salir_sql)" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${P}" "$(K 102)")" 0
wait
grep -q 'R=salio' "${t1}" && ok "la salida entro" || fallo "salir: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la aceptacion"
grep -q 'PROPOSAL_CANCELLED' "${t2}" && grep -q 'departure' "${t2}" && ok "la aceptacion llego tarde: PROPOSAL_CANCELLED (departure)" || fallo "aceptar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" "cancelled·departure" "estado"
afirmar "$(ops)" 0 "operaciones"
afirmar "$(claves)" 0 "claves"
rm -f "${t1}" "${t2}"

echo "== 3 · rechazar vs salir, dos ordenes =="
reiniciar
P=$(proponer "$(K 3)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(rechazar_sql "${P}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(salir_sql)" 0
wait
grep -q 'R=declined' "${t1}" && ok "el rechazo entro" || fallo "rechazar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la salida"
afirmar "$(estado "${P}")" declined "estado (rechazo primero)"
rm -f "${t1}" "${t2}"
reiniciar
P=$(proponer "$(K 4)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(salir_sql)" 3
sleep 1
sesion "${t2}" "${UB}" "$(rechazar_sql "${P}")" 0
wait
espero "${t2}" "el rechazo"
grep -q 'PROPOSAL_CANCELLED' "${t2}" && ok "el rechazo llego tarde: PROPOSAL_CANCELLED" || fallo "rechazar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" "cancelled·departure" "estado (salida primero)"
rm -f "${t1}" "${t2}"

echo "== 4 · cancelar (creador) vs salir del receptor, dos ordenes =="
reiniciar
P=$(proponer "$(K 5)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(cancelar_sql "${P}")" 3
sleep 1
sesion "${t2}" "${UB}" "$(salir_sql)" 0
wait
grep -q 'R=cancelled' "${t1}" && ok "la cancelacion entro" || fallo "cancelar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la salida"
afirmar "$(estado "${P}")" "cancelled·creator" "estado (cancelacion primero)"
rm -f "${t1}" "${t2}"
reiniciar
P=$(proponer "$(K 6)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(salir_sql)" 3
sleep 1
sesion "${t2}" "${UA}" "$(cancelar_sql "${P}")" 0
wait
espero "${t2}" "la cancelacion"
grep -q 'PROPOSAL_CANCELLED' "${t2}" && ok "la cancelacion llego tarde: PROPOSAL_CANCELLED (departure)" || fallo "cancelar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" "cancelled·departure" "estado (salida primero)"
rm -f "${t1}" "${t2}"

echo "== 5 · aceptar vs cancelar (creador) =="
reiniciar
P=$(proponer "$(K 7)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 107)")" 3
sleep 1
sesion "${t2}" "${UA}" "$(cancelar_sql "${P}")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "la aceptacion entro" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la cancelacion"
grep -q 'PROPOSAL_ACCEPTED' "${t2}" && ok "la cancelacion llego tarde: PROPOSAL_ACCEPTED" || fallo "cancelar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(estado "${P}")" accepted "estado"
afirmar "$(ops)" 1 "operaciones"
rm -f "${t1}" "${t2}"

echo "== 6 · doble aceptacion con DOS claves =="
reiniciar
P=$(proponer "$(K 8)" 2500)
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 108)")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${P}" "$(K 109)")" 0
wait
grep -q 'R=.*:false' "${t1}" && ok "la primera entro" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q 'PROPOSAL_ACCEPTED' "${t2}" && ok "la segunda vio la aceptacion: PROPOSAL_ACCEPTED" || fallo "segunda: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(ops)" 1 "operaciones"
afirmar "$(claves)" 1 "claves (la segunda revirtio la suya)"
afirmar "$(q "select count(*) from core.group_transfer_proposal where id = '${P}' and accepted_operation_id = (select id from core.operation where operation_class = 'settlement_by_transfer' and created_by = '${UB}');")" 1 "la propuesta liga la unica operacion"
rm -f "${t1}" "${t2}"

echo "== 7 · caducada y despues salida: expired por precedencia =="
reiniciar
P=$(proponer "$(K 9)" 2500)
"${DB[@]}" >/dev/null 2>&1 <<SQL
update core.group_transfer_proposal set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where id = '${P}';
SQL
afirmar "$(salir_ahora "${UA}")" false "Aitor sale"
afirmar "$(estado "${P}")" expired "estado"
t1=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 110)")" 0
wait
grep -q 'PROPOSAL_EXPIRED' "${t1}" && ok "aceptar una caducada: PROPOSAL_EXPIRED" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
rm -f "${t1}"

echo "== 8 · presupuesto MIXTO exacto: nueve previas, Personal y grupo simultaneas =="
reiniciar
# nueve: 3 Personales a Fer (tope de pareja) + 6 de grupo (3 a Edu, 3 a Cris)
proponer_personal "$(K 201)" 1 >/dev/null; proponer_personal "$(K 202)" 2 >/dev/null; proponer_personal "$(K 203)" 3 >/dev/null
proponer "$(K 204)" 4 >/dev/null; proponer "$(K 205)" 5 >/dev/null; proponer "$(K 206)" 6 >/dev/null
como "${UA}" "select api.create_group_transfer_proposal(jsonb_build_object('client_command_id', '$(K 207)', 'command_contract_version', 1, 'group_scope_id', '${G}', 'receiver_participant_id', '${XC}', 'amount', '7')) ->> 'proposal_id';" >/dev/null
como "${UA}" "select api.create_group_transfer_proposal(jsonb_build_object('client_command_id', '$(K 208)', 'command_contract_version', 1, 'group_scope_id', '${G}', 'receiver_participant_id', '${XC}', 'amount', '8')) ->> 'proposal_id';" >/dev/null
# la novena, Personal a Edu. En la carrera: la Personal va a Cris (pareja libre) y la de grupo a Cris (dos pendientes: cabe una).
como "${UA}" "select api.create_transfer_proposal(jsonb_build_object('client_command_id', '$(K 209)', 'command_contract_version', 1, 'handle', 'gt_edu', 'amount', '9', 'currency_definition_id', '${EUR}')) ->> 'proposal_id';" >/dev/null
afirmar "$(creadas)" 9 "creadas de Aitor antes de la carrera (Personal + grupo)"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(crear_p_sql "$(K 210)" 10)" 2
sesion "${t2}" "${UA}" "$(crear_g_sql "$(K 211)" 11)" 0
wait
e1=0; e2=0; l1=0; l2=0
grep -q 'R=creada' "${t1}" && e1=1; grep -q 'R=creada' "${t2}" && e2=1
grep -q 'PROPOSAL_RATE_LIMITED' "${t1}" && l1=1; grep -q 'PROPOSAL_RATE_LIMITED' "${t2}" && l2=1
[ "$((e1 + e2))" -eq 1 ] && [ "$((l1 + l2))" -eq 1 ] && ok "una entro (Personal o grupo) y una recibio PROPOSAL_RATE_LIMITED" || fallo "entradas=$((e1 + e2)) frenadas=$((l1 + l2)) · $(grep -i 'R=\|error' "${t1}" "${t2}" | head -c 300)"
afirmar "$(creadas)" 10 "creadas de Aitor tras la carrera (exacto, un solo contador)"
rm -f "${t1}" "${t2}"

echo "== 9 · volver (rejoin real) tras cancelled·departure: no revive =="
reiniciar
P=$(proponer "$(K 12)" 2500)
afirmar "$(salir_ahora "${UA}")" false "Aitor sale"
afirmar "$(estado "${P}")" "cancelled·departure" "estado tras salir"
TOK=$(como "${UC}" "select api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', '${G}')) ->> 'token';")
R=$(como "${UA}" "select api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', '${TOK}', 'choice', 'rejoin')) ->> 'state';")
afirmar "${R}" ok "Aitor vuelve con su identidad"
afirmar "$(miembro "${UA}")" t "Aitor es miembro otra vez"
afirmar "$(estado "${P}")" "cancelled·departure" "la propuesta sigue cancelled·departure"
t1=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${P}" "$(K 112)")" 0
wait
grep -q 'PROPOSAL_CANCELLED' "${t1}" && ok "aceptar tras volver: PROPOSAL_CANCELLED" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
afirmar "$(ops)" 0 "operaciones"
rm -f "${t1}"

echo
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la fila de la propuesta, el rango 1 y el cerrojo por emisor serializan la transferencia de grupo con la salida: el primero en confirmar decide, a lo sumo una operacion, y el presupuesto Personal + grupo es uno"
else
  echo "FALLOS: ${fallos}"; exit 1
fi
