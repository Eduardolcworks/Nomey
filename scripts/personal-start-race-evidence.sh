#!/usr/bin/env bash
#
# La decision de inicio del Modo Personal frente a un gasto de grupo que
# escribe la misma caja, como DOS SESIONES REALES · F10/ADR-005 §5.
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/personal-start-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# Lo que mide:
#
#   1 · un gasto de grupo pagado por Inv (retiene 3 s bajo el cerrojo de su
#       Personal) → la decision `fresh` ESPERA al cerrojo y, cuando entra, su
#       corte (now() de su transaccion, que empezo despues) deja el gasto —que
#       empezo antes— del lado anterior: el Personal queda a 0.
#   2 · la decision `fresh` (retiene 3 s) → el gasto ESPERA y, cuando entra,
#       queda del lado posterior: el Personal lo cuenta.
#   3 · dos decisiones a la vez con claves distintas (include y fresh): una
#       entra, la otra se rehusa con PERSONAL_START_DECIDED; queda UNA fila.
#
# En los tres casos el resultado es un orden serial que los instantes reflejan.

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
UI=a5c00000-0000-4000-8000-0000000000a1; PSI=a5c00000-0000-4000-8000-0000000000f1; PI=a5c00000-0000-4000-8000-000000000031
UB=a5c00000-0000-4000-8000-0000000000b1; PSB=a5c00000-0000-4000-8000-0000000000f2; PB=a5c00000-0000-4000-8000-000000000032
G=a5c00000-0000-4000-8000-000000000010
HOY=$(date +%F)

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.group_notice where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSI}','${PSB}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UI}','${UB}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UI}','${UB}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSI}','${PSB}');
delete from core.client_command where created_by in ('${UI}','${UB}');
delete from core.link_baseline b using core.link_baseline_subject s, core.participant p where s.link_id = b.link_id and p.id = s.participant_id and p.scope_id = '${G}';
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id = '${G}';
delete from core.operation_version where created_by in ('${UI}','${UB}');
delete from core.operation where created_by in ('${UI}','${UB}');
delete from core.participant_user_link where scope_id = '${G}';
delete from core.membership where scope_id in ('${G}','${PSI}','${PSB}');
delete from core.participant_period where participant_id in (select id from core.participant where scope_id = '${G}');
delete from core.participant where scope_id = '${G}';
delete from core.group_profile where scope_id = '${G}';
delete from core.personal_start where scope_id in ('${PSI}','${PSB}');
delete from core.provisioning_command where created_by in ('${UI}','${UB}');
delete from core.scope where id in ('${G}','${PSI}','${PSB}');
commit;
SQL
}
trap limpiar EXIT
limpiar

CAT=$("${DBQ[@]}" -c "select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null;" | tr -d '[:space:]')

# Inv nacio como invitado (marca), con historia: un gasto anterior pagado por
# el (created_at una hora atras, como fixture). Bea es una cuenta normal.
sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id, provisioned_as_guest) values
  ('${PSI}','personal','${EUR}','${UI}', true), ('${PSB}','personal','${EUR}','${UB}', false);
insert into core.membership (scope_id, user_id) values ('${PSI}','${UI}'), ('${PSB}','${UB}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UI}"}', true);
select api.create_group('{"client_command_id":"a5c00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Carrera","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PI}","creator_display_name":"Inv","participants":[{"client_participant_id":"${PB}","display_name":"Bea"}]}'::jsonb);
select api.record_group_expense('{"client_operation_id":"a5c00000-0000-4000-8000-000000000041","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"2000","effective_date":"${HOY}","concept":"Antes","category_id":"${CAT}","payer_participant_id":"${PI}","participants":["${PI}","${PB}"],"split_method":{"kind":"equal"}}'::jsonb);
reset role;
insert into core.membership (scope_id, user_id) values ('${G}','${UB}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values ('${PB}','${G}','${UB}');
update core.operation set created_at = now() - interval '1 hour' where created_by = '${UI}';
commit;
SQL
}

reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

# Sesion con las ayudas cargadas. $1 salida, $2 cuerpo SQL, $3 hold.
sesion() {
  { cat "${LIB}"; printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" "$2" "${ESPERA_SQL}" "select pg_sleep($3);" "commit;"; } | "${DB[@]}" >"$1" 2>&1 &
}

gasto_sql() { # $1 clave: Inv paga 600 para Inv y Bea (escribe caja en el Personal de Inv)
  echo "select pg_temp.gp_actor('${UI}'::uuid); select 'GASTO=' || (api.record_group_expense('{\"client_operation_id\":\"$1\",\"command_contract_version\":1,\"scope_id\":\"${G}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"600\",\"effective_date\":\"${HOY}\",\"concept\":\"Carrera\",\"category_id\":\"${CAT}\",\"payer_participant_id\":\"${PI}\",\"participants\":[\"${PI}\",\"${PB}\"],\"split_method\":{\"kind\":\"equal\"}}'::jsonb) ->> 'operation_id'); select pg_temp.gp_super();"
}
decision_sql() { # $1 clave, $2 modo
  echo "select pg_temp.gp_actor('${UI}'::uuid); select 'DECISION=' || coalesce((api.start_personal_scope('{\"client_command_id\":\"$1\",\"command_contract_version\":1,\"mode\":\"$2\"}'::jsonb) ->> 'mode'), '?'); select pg_temp.gp_super();"
}

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }
saldo()     { q "select balance_amount from (select coalesce(sum(e.balance_amount),0) as balance_amount from core.current_effect e join core.operation_version ov on ov.id = e.operation_version_id where e.scope_id = '${PSI}' and e.balance_amount is not null and sec.counts_in_personal('${PSI}', ov.operation_id)) t;"; }
derive()    { q "select sec.derive_balance('${PSI}', null);"; }
decisiones(){ q "select count(*) || ':' || coalesce(string_agg(mode, ','), '-') from core.personal_start where scope_id = '${PSI}';"; }
espero()    { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()   { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

echo "== 1 · gasto de grupo (retiene 3 s) → decision fresh =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(gasto_sql a5c00000-0000-4000-8000-000000000051)" 3
sleep 1
sesion "${t2}" "$(decision_sql a5c00000-0000-4000-8000-000000000061 fresh)" 0
wait
grep -q 'GASTO=' "${t1}" && ok "el gasto entro" || fallo "gasto: $(grep -i 'error' "${t1}" | head -c 200)"
espero "${t2}" "la decision"
grep -q 'DECISION=fresh' "${t2}" && ok "la decision entro despues" || fallo "decision: $(grep -i 'DECISION\|error' "${t2}" | head -c 200)"
afirmar "$(saldo)" 0 "Personal de Inv: el gasto que EMPEZO antes queda antes del corte; saldo"
afirmar "$(derive)" 0 "sec.derive_balance"
afirmar "$(decisiones)" "1:fresh" "decisiones"
rm -f "${t1}" "${t2}"

echo "== 2 · decision fresh (retiene 3 s) → gasto de grupo =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(decision_sql a5c00000-0000-4000-8000-000000000062 fresh)" 3
sleep 1
sesion "${t2}" "$(gasto_sql a5c00000-0000-4000-8000-000000000052)" 0
wait
grep -q 'DECISION=fresh' "${t1}" && ok "la decision entro" || fallo "decision: $(grep -i 'DECISION\|error' "${t1}" | head -c 200)"
espero "${t2}" "el gasto"
grep -q 'GASTO=' "${t2}" && ok "el gasto entro despues" || fallo "gasto: $(grep -i 'error' "${t2}" | head -c 200)"
afirmar "$(saldo)" -600 "Personal de Inv: el gasto que EMPEZO despues cuenta; saldo"
afirmar "$(derive)" -600 "sec.derive_balance"
afirmar "$(decisiones)" "1:fresh" "decisiones"
rm -f "${t1}" "${t2}"

echo "== 3 · dos decisiones a la vez (include y fresh, claves distintas) =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(decision_sql a5c00000-0000-4000-8000-000000000063 include)" 3
sleep 1
sesion "${t2}" "$(decision_sql a5c00000-0000-4000-8000-000000000064 fresh)" 0
wait
grep -q 'DECISION=include' "${t1}" && ok "la primera entro (include)" || fallo "primera: $(grep -i 'DECISION\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q 'PERSONAL_START_DECIDED' "${t2}" && ok "la segunda vio la decision y se rehuso: PERSONAL_START_DECIDED" || fallo "segunda: $(grep -i 'DECISION\|error' "${t2}" | head -c 200)"
afirmar "$(decisiones)" "1:include" "decisiones"
afirmar "$(saldo)" -2000 "Personal de Inv con include: lo anterior cuenta; saldo"
rm -f "${t1}" "${t2}"

echo
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la decision y la caja del grupo se serializan por el cerrojo del ambito; el corte refleja el orden serial; una sola decision"
else
  echo "FALLOS: ${fallos}"; exit 1
fi
