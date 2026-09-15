#!/usr/bin/env bash
# ============================================================================
# SALIDA FRENTE A CORRECCION/ANULACION DE GASTO (F09/ADR-008): SERIALIZACION
# ============================================================================
#
# Con dos sesiones reales y los writers REALES con la guarda de F09/ADR-008
# dentro (20260912170000): se mide que salir y revisar un gasto se serializan
# por el cerrojo de identidad y que la guarda decide sobre el estado posterior.
#
#   1 · salir (retiene 3 s) → corregir gasto (api.record_group_expense REAL):
#       la correccion ESPERA (rango 1), entra con Carlos ya fuera y la guarda
#       la rehusa: DEPARTED_OBLIGATION_CHANGED, sin version nueva.
#   1b · salir (retiene 3 s) → alta retrofechada que nombra a Carlos: espera,
#       la guarda la rehusa y no queda ninguna escritura parcial (ni la clave).
#   2 · corregir (retiene 3 s) → salir: salir espera y comprueba los pares
#       sobre la version ya corregida.
#   2b · alta que nombra a Carlos (retiene 3 s) → salir: salir espera y ve la
#       deuda del alta: LEAVE_BLOCKED_DEBT.
#   3 · salir (retiene 3 s) → anular un gasto que no toca a Carlos
#       (api.annul_operation REAL): la anulacion ESPERA (rango 1) y entra con
#       la salida confirmada; la guarda de F09/ADR-008 no tiene nada que decir.
#       Anular un gasto que si toque a quien sale ya lo rehusa la guarda de
#       sobreliquidacion (sus pares estan liquidados) o la de F09/ADR-008.
#   3b · anular (retiene 3 s) → salir: salir espera y sale a cero.
#
# Escribe filas confirmadas y las retira despues, acotadas. Solo base local.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

LIB="$(dirname "${BASH_SOURCE[0]}")/../supabase/checks/lib/group-payment-helpers.sql"
DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

EUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
UA=a3e00000-0000-4000-8000-0000000000a1; PSA=a3e00000-0000-4000-8000-0000000000f1; PA=a3e00000-0000-4000-8000-000000000031
UC=a3e00000-0000-4000-8000-0000000000c1; PSC=a3e00000-0000-4000-8000-0000000000f3; PC=a3e00000-0000-4000-8000-000000000033
G=a3e00000-0000-4000-8000-000000000010
AYER=$(date -d yesterday +%F 2>/dev/null || date -v-1d +%F)

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.group_notice where scope_id = '${G}';
delete from core.payment_allocation where scope_id = '${G}';
delete from core.payment_detail where scope_id = '${G}';
delete from core.group_departure where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSA}','${PSC}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UC}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UC}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSA}','${PSC}');
delete from core.client_command where created_by in ('${UA}','${UC}');
update core.operation o set current_version_id = v.id from core.operation_version v where v.operation_id = o.id and v.version_no = 1 and o.created_by in ('${UA}','${UC}');
-- F10/ADR-001 (20260915120000): linea base y sujetos de cada instancia, insert-only,
-- referencian versiones y participantes: se borran como postgres antes que ellos.
delete from core.link_baseline b using core.link_baseline_subject s, core.participant p where s.link_id = b.link_id and p.id = s.participant_id and p.scope_id = '${G}';
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id = '${G}';
delete from core.operation_version where created_by in ('${UA}','${UC}');
delete from core.operation where created_by in ('${UA}','${UC}');
delete from core.participant_user_link where scope_id = '${G}';
delete from core.membership where scope_id in ('${G}','${PSA}','${PSC}');
delete from core.participant_period where participant_id in (select id from core.participant where scope_id = '${G}');
delete from core.participant where scope_id = '${G}';
delete from core.group_profile where scope_id = '${G}';
delete from core.provisioning_command where created_by in ('${UA}','${UC}');
delete from core.scope where id in ('${G}','${PSA}','${PSC}');
commit;
SQL
}
trap limpiar EXIT
limpiar

CAT=$("${DBQ[@]}" -c "select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null;" | tr -d '[:space:]')

sembrar() { # Ana crea; Carlos con cuenta; Ana paga 20 Ana/Carlos (ayer) → Carlos>Ana 1000; Carlos paga 1000 (sim) → cero
  { cat "${LIB}"; cat <<SQL; } | "${DB[@]}" >/dev/null 2>&1
begin;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PSA}','personal','${EUR}','${UA}'), ('${PSC}','personal','${EUR}','${UC}');
insert into core.membership (scope_id, user_id) values ('${PSA}','${UA}'), ('${PSC}','${UC}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group('{"client_command_id":"a3e00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Salida","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Ana","participants":[{"client_participant_id":"${PC}","display_name":"Carlos"}]}'::jsonb);
reset role;
insert into core.membership (scope_id, user_id) values ('${G}','${UC}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values ('${PC}','${G}','${UC}');
update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = '${G}';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"a3e00000-0000-4000-8000-000000000045","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"1000","effective_date":"${AYER}","concept":"Solo Ana","category_id":"${CAT}","payer_participant_id":"${PA}","participants":["${PA}"],"split_method":{"kind":"equal"}}'::jsonb);
select api.record_group_expense('{"client_operation_id":"a3e00000-0000-4000-8000-000000000041","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"2000","effective_date":"${AYER}","concept":"Cena","category_id":"${CAT}","payer_participant_id":"${PA}","participants":["${PA}","${PC}"],"split_method":{"kind":"equal"}}'::jsonb);
reset role;
select pg_temp.gp_pay('${UC}'::uuid, 'a3e00000-0000-4000-8000-000000000051'::uuid, '${G}'::uuid, '${PC}'::uuid, '${PA}'::uuid, 1000, pg_temp.gp_expected('${G}'::uuid));
commit;
SQL
}
reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"
sesion() { # salida cuerpo hold
  { cat "${LIB}"; printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" "$2" "${ESPERA_SQL}" "select pg_sleep($3);" "commit;"; } | "${DB[@]}" >"$1" 2>&1 &
}
q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }
op_g1()   { q "select o.id from core.operation o join core.operation_version v on v.id = o.current_version_id join core.movement_detail d on d.operation_version_id = v.id where d.concept = 'Cena' and o.created_by = '${UA}' limit 1;"; }
op_x()    { q "select o.id from core.operation o join core.operation_version v on v.id = o.current_version_id join core.movement_detail d on d.operation_version_id = v.id where d.concept = 'Solo Ana' limit 1;"; }
ver_g1()  { q "select current_version_id from core.operation where id = '$1';"; }
miembro() { q "select count(*) from core.membership where scope_id = '${G}' and user_id = '$1';"; }
pares()   { { cat "${LIB}"; echo "select pg_temp.gp_pairs('${G}'::uuid);"; } | "${DBQ[@]}" 2>/dev/null | tail -n 1 | tr -d '\n'; }
guarda()  { # lo que sec.departed_effects_of_version dice de dos versiones
  "${DBQ[@]}" -c "select case when sec.departed_effects_of_version('$1'::uuid) <> sec.departed_effects_of_version('$2'::uuid) then 'DEPARTED_OBLIGATION_CHANGED' else 'OK' end;" 2>/dev/null | tail -n 1 | tr -d '\n'
}
espero() { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?}"; fi; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

salir_sql() { echo "select 'SALIDA=' || pg_temp.gp_leave('${UC}'::uuid, '$1'::uuid, '${G}'::uuid);"; }
corregir_sql() { cat <<SQL
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"$1","command_contract_version":1,"operation_id":"$2","expected_version_id":"$3","scope_id":"${G}","currency_definition_id":"${EUR}","total":"4000","effective_date":"${AYER}","concept":"Cena","category_id":"${CAT}","payer_participant_id":"${PA}","participants":["${PA}","${PC}"],"split_method":{"kind":"equal"}}'::jsonb);
reset role;
SQL
}
alta_sql() { cat <<SQL
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"$1","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"3000","effective_date":"${AYER}","concept":"Retro","category_id":"${CAT}","payer_participant_id":"${PA}","participants":["${PA}","${PC}"],"split_method":{"kind":"equal"}}'::jsonb);
reset role;
SQL
}
anular_sql() { cat <<SQL
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.annul_operation('{"client_operation_id":"$1","command_contract_version":2,"operation_id":"$2","expected_version_id":"$3"}'::jsonb);
reset role;
SQL
}

echo "== 1 · salir (retiene 3 s) → corregir el gasto de 20 a 40 =="
reiniciar; OP=$(op_g1); V0=$(ver_g1 "${OP}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(salir_sql a3e00000-0000-4000-8000-000000000061)" 3
sleep 1
sesion "${t2}" "$(corregir_sql a3e00000-0000-4000-8000-000000000042 "${OP}" "${V0}")" 0
wait
grep -q 'SALIDA=OK' "${t1}" && ok "Carlos salio a cero" || fallo "salir: $(grep SALIDA "${t1}")"
espero "${t2}" "la correccion"
grep -q 'DEPARTED_OBLIGATION_CHANGED' "${t2}" && ok "la correccion entro DESPUES de la salida y la guarda la rehuso (DEPARTED_OBLIGATION_CHANGED)" || fallo "correccion: $(grep -i 'error\|operation_id' "${t2}" | head -c 200)"
afirmar "$(ver_g1 "${OP}")" "${V0}" "version vigente de G1 (sin cambios)"
afirmar "$(pares)" "-" "pares (Carlos fuera y a cero)"
rm -f "${t1}" "${t2}"

echo "== 1b · salir (retiene 3 s) → alta retrofechada que nombra a Carlos =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(salir_sql a3e00000-0000-4000-8000-000000000064)" 3
sleep 1
sesion "${t2}" "$(alta_sql a3e00000-0000-4000-8000-000000000046)" 0
wait
grep -q 'SALIDA=OK' "${t1}" && ok "Carlos salio a cero" || fallo "salir: $(grep SALIDA "${t1}")"
espero "${t2}" "el alta"
grep -q 'DEPARTED_OBLIGATION_CHANGED' "${t2}" && ok "el alta entro DESPUES de la salida y la guarda la rehuso (DEPARTED_OBLIGATION_CHANGED)" || fallo "alta: $(grep -i 'error|operation_id' "${t2}" | head -c 200)"
afirmar "$(q "select count(*) from core.operation where created_by = '${UA}' and id not in (select operation_id from core.operation_version);")" 0 "operaciones sin version (escrituras parciales)"
afirmar "$(q "select count(*) from core.movement_detail d join core.operation_version v on v.id = d.operation_version_id where d.concept = 'Retro';")" 0 "versiones del alta rehusada"
afirmar "$(q "select count(*) from core.client_command where created_by = '${UA}' and client_operation_id = 'a3e00000-0000-4000-8000-000000000046';")" 0 "clave de idempotencia del alta rehusada (rollback completo)"
afirmar "$(pares)" "-" "pares (Carlos fuera y a cero)"
rm -f "${t1}" "${t2}"

echo "== 2 · corregir (retiene 3 s) → salir =="
reiniciar; OP=$(op_g1); V0=$(ver_g1 "${OP}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(corregir_sql a3e00000-0000-4000-8000-000000000043 "${OP}" "${V0}")" 3
sleep 1
sesion "${t2}" "$(salir_sql a3e00000-0000-4000-8000-000000000062)" 0
wait
grep -q 'operation_id' "${t1}" && ok "la correccion entro (Carlos activo)" || fallo "correccion: $(grep -i error "${t1}" | head -c 200)"
espero "${t2}" "salir"
grep -q 'SALIDA=LEAVE_BLOCKED_DEBT' "${t2}" && ok "salir vio la deuda de la version corregida: bloqueado" || fallo "salir: $(grep SALIDA "${t2}")"
afirmar "$(miembro "${UC}")" 1 "membresia de Carlos (sigue)"
rm -f "${t1}" "${t2}"

echo "== 2b · alta que nombra a Carlos (retiene 3 s) → salir =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(alta_sql a3e00000-0000-4000-8000-000000000047)" 3
sleep 1
sesion "${t2}" "$(salir_sql a3e00000-0000-4000-8000-000000000065)" 0
wait
grep -q 'operation_id' "${t1}" && ok "el alta entro (Carlos activo)" || fallo "alta: $(grep -i error "${t1}" | head -c 200)"
espero "${t2}" "salir"
grep -q 'SALIDA=LEAVE_BLOCKED_DEBT' "${t2}" && ok "salir vio la deuda del alta: bloqueado" || fallo "salir: $(grep SALIDA "${t2}")"
afirmar "$(miembro "${UC}")" 1 "membresia de Carlos (sigue)"
afirmar "$(pares)" "Carlos>Ana:1500" "pares"
rm -f "${t1}" "${t2}"

echo "== 3 · salir (retiene 3 s) → anular un gasto que no toca a Carlos: annul_operation espera al cerrojo de identidad =="
reiniciar; OP=$(op_x); V0=$(ver_g1 "${OP}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(salir_sql a3e00000-0000-4000-8000-000000000063)" 3
sleep 1
sesion "${t2}" "$(anular_sql a3e00000-0000-4000-8000-000000000044 "${OP}" "${V0}")" 0
wait
grep -q 'SALIDA=OK' "${t1}" && ok "Carlos salio a cero" || fallo "salir: $(grep SALIDA "${t1}")"
espero "${t2}" "la anulacion (annul_operation toma ahora el rango 1)"
grep -q 'operation_id' "${t2}" && ok "la anulacion entro despues de la salida: el gasto no atribuye nada a Carlos" || fallo "anulacion: $(grep -i error "${t2}" | head -c 200)"
afirmar "$(miembro "${UC}")" 0 "membresia de Carlos"
V1=$(ver_g1 "${OP}")
afirmar "$(guarda "${V1}" "${V0}")" "OK" "la guarda de F09/ADR-008 sobre un gasto que no atribuye nada a Carlos"
rm -f "${t1}" "${t2}"

echo "== 3b · anular un gasto que no toca a Carlos (retiene 3 s) → salir =="
reiniciar; OP=$(op_x); V0=$(ver_g1 "${OP}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(anular_sql a3e00000-0000-4000-8000-000000000048 "${OP}" "${V0}")" 3
sleep 1
sesion "${t2}" "$(salir_sql a3e00000-0000-4000-8000-000000000066)" 0
wait
grep -q 'operation_id' "${t1}" && ok "la anulacion entro" || fallo "anulacion: $(grep -i error "${t1}" | head -c 200)"
espero "${t2}" "salir"
grep -q 'SALIDA=OK' "${t2}" && ok "salir espero a la anulacion y salio a cero" || fallo "salir: $(grep SALIDA "${t2}")"
afirmar "$(miembro "${UC}")" 0 "membresia de Carlos"
rm -f "${t1}" "${t2}"

if [ "${fallos}" -eq 0 ]; then
  echo "OK · salir, corregir y anular se serializan por el cerrojo de identidad, y la guarda de F09/ADR-008 decide sobre el estado posterior"; exit 0
fi
echo "FALLOS: ${fallos}"; exit 1
