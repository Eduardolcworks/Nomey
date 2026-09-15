#!/usr/bin/env bash
# ============================================================================
# PAGOS REGISTRADOS (F09/ADR-007): CARRERAS ENTRE SALIDA, REGISTRO Y REVISION
# ============================================================================
#
# Con dos sesiones reales y las funciones REALES (20260912170000):
# api.record_group_payment toma el cerrojo de identidad del grupo (rango 1) y
# las filas; api.annul_operation toma el cerrojo; api.leave_group toma el
# cerrojo y comprueba los pares bajo el. Las ayudas de
# supabase/checks/lib/group-payment-helpers.sql solo leen y envuelven. La
# primera sesion retiene 3 s; la segunda arranca 1 s despues y se mide su
# espera.
#
#   1 · pago (retiene) → salir del pagador: salir espera; ya sin pares, sale
#   2 · salir (con pares → bloqueado) → pago: la salida rehusada aborta y no
#       retiene el cerrojo (no hay espera que medir); el pago entra y un
#       reintento de salir, ya a cero, sale
#   3 · doble confirmacion simultanea del mismo pago (dos cuentas, dos claves):
#       una entra, la otra SETTLEMENT_STALE; un solo pago
#   4 · anulacion (retiene) → salir del receptor: salir espera y queda
#       bloqueado por los pares reabiertos
#   5 · salir (retiene, a cero) → anulacion por quien se queda: permitida;
#       la deuda reabierta nombra a quien salio, sin readmitirlo
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
UA=a3c00000-0000-4000-8000-0000000000a1; PSA=a3c00000-0000-4000-8000-0000000000f1; PA=a3c00000-0000-4000-8000-000000000031
UB=a3c00000-0000-4000-8000-0000000000b1; PSB=a3c00000-0000-4000-8000-0000000000f2; PB=a3c00000-0000-4000-8000-000000000032
UC=a3c00000-0000-4000-8000-0000000000c1; PSC=a3c00000-0000-4000-8000-0000000000f3; PC=a3c00000-0000-4000-8000-000000000033
G=a3c00000-0000-4000-8000-000000000010
HOY=$(date +%F)

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.group_notice where scope_id = '${G}';
delete from core.payment_allocation where scope_id = '${G}';
delete from core.payment_detail where scope_id = '${G}';
delete from core.group_departure where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}','${UC}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}','${UC}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.client_command where created_by in ('${UA}','${UB}','${UC}');
-- F10/ADR-001 (20260915120000): linea base y sujetos de cada instancia, insert-only,
-- referencian versiones y participantes: se borran como postgres antes que ellos.
delete from core.link_baseline b using core.link_baseline_subject s, core.participant p where s.link_id = b.link_id and p.id = s.participant_id and p.scope_id = '${G}';
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id = '${G}';
delete from core.operation_version where created_by in ('${UA}','${UB}','${UC}');
delete from core.operation where created_by in ('${UA}','${UB}','${UC}');
delete from core.participant_user_link where scope_id = '${G}';
delete from core.membership where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.participant_period where participant_id in (select id from core.participant where scope_id = '${G}');
delete from core.participant where scope_id = '${G}';
delete from core.group_profile where scope_id = '${G}';
delete from core.provisioning_command where created_by in ('${UA}','${UB}','${UC}');
delete from core.scope where id in ('${G}','${PSA}','${PSB}','${PSC}');
commit;
SQL
}
trap limpiar EXIT
limpiar

CAT=$("${DBQ[@]}" -c "select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null;" | tr -d '[:space:]')

sembrar() { # Ana crea; Bea y Carlos con cuenta; Ana paga 2000 Ana/Carlos → Carlos>Ana 1000
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PSA}','personal','${EUR}','${UA}'), ('${PSB}','personal','${EUR}','${UB}'), ('${PSC}','personal','${EUR}','${UC}');
insert into core.membership (scope_id, user_id) values ('${PSA}','${UA}'), ('${PSB}','${UB}'), ('${PSC}','${UC}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group('{"client_command_id":"a3c00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Carrera","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Ana","participants":[{"client_participant_id":"${PB}","display_name":"Bea"},{"client_participant_id":"${PC}","display_name":"Carlos"}]}'::jsonb);
reset role;
insert into core.membership (scope_id, user_id) values ('${G}','${UB}'), ('${G}','${UC}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values ('${PB}','${G}','${UB}'), ('${PC}','${G}','${UC}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"a3c00000-0000-4000-8000-000000000041","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"2000","effective_date":"${HOY}","concept":"Cena","category_id":"${CAT}","payer_participant_id":"${PA}","participants":["${PA}","${PC}"],"split_method":{"kind":"equal"}}'::jsonb);
reset role;
commit;
SQL
}

reiniciar() { limpiar; sembrar; POS_INICIAL=$(pos_inicial); }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

# Sesion con las ayudas cargadas. $1 salida, $2 cuerpo SQL, $3 hold.
sesion() {
  { cat "${LIB}"; printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" "$2" "${ESPERA_SQL}" "select pg_sleep($3);" "commit;"; } | "${DB[@]}" >"$1" 2>&1 &
}

# La foto de netos que el cliente mandaria antes de nada (Carlos>Ana 1000).
pos_inicial() { { cat "${LIB}"; echo "select pg_temp.gp_expected('${G}'::uuid)::text;"; } | "${DBQ[@]}" 2>/dev/null | tail -n 1 | tr -d '\n'; }
pago_sql()  { echo "select pg_temp.gp_pay('$1'::uuid, '$2'::uuid, '${G}'::uuid, '${PC}'::uuid, '${PA}'::uuid, 1000, '$3'::jsonb);"; }
salir_sql() { echo "select 'SALIDA=' || pg_temp.gp_leave('$1'::uuid, '$3'::uuid, '${G}'::uuid);"; }
anular_sql() { echo "select 'ANULAR=' || pg_temp.gp_annul('$1'::uuid, '$2'::uuid, '$3'::uuid);"; }

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }
miembro()  { q "select count(*) from core.membership where scope_id = '${G}' and user_id = '$1';"; }
pagos()    { q "select count(*) from core.operation o join core.operation_version v on v.id = o.current_version_id where o.operation_class = 'group_payment' and v.version_kind = 'record';"; }
pago_id()  { q "select o.id from core.operation o where o.operation_class = 'group_payment' order by o.created_at limit 1;"; }
pares()    { { cat "${LIB}"; echo "select pg_temp.gp_pairs('${G}'::uuid);"; } | "${DBQ[@]}" 2>/dev/null | tail -n 1 | tr -d '\n'; }
espero()   { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()  { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

echo "== 1 · pago (retiene 3 s) → salir del pagador =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(pago_sql "${UA}" a3c00000-0000-4000-8000-000000000051 "${POS_INICIAL}")" 3
sleep 1
sesion "${t2}" "$(salir_sql "${UC}" "${PC}" a3c00000-0000-4000-8000-000000000061)" 0
wait
grep -q 'OK ' "${t1}" && ok "el pago entro" || fallo "pago: $(grep -i 'error\|gp_pay' "${t1}" | head -c 200)"
espero "${t2}" "salir"
grep -q 'SALIDA=OK' "${t2}" && ok "salir vio cero pares tras el pago y salio" || fallo "salir: $(grep 'SALIDA' "${t2}" | head -c 200)"
afirmar "$(miembro "${UC}")" 0 "membresia de Carlos"
afirmar "$(pares)" "-" "pares"
rm -f "${t1}" "${t2}"

echo "== 2 · salir (con pares → bloqueado; la sesion retiene 3 s) → pago =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(salir_sql "${UC}" "${PC}" a3c00000-0000-4000-8000-000000000062)" 3
sleep 1
sesion "${t2}" "$(pago_sql "${UA}" a3c00000-0000-4000-8000-000000000052 "${POS_INICIAL}")" 0
wait
grep -q 'SALIDA=LEAVE_BLOCKED_DEBT' "${t1}" && ok "salir con pares: bloqueado (LEAVE_BLOCKED_DEBT con los pares)" || fallo "salir: $(grep 'SALIDA' "${t1}" | head -c 200)"
e2=$(grep -o 'ESPERA=[0-9.]*' "${t2}" | cut -d= -f2)
if [ -n "${e2}" ] && awk -v e="${e2}" 'BEGIN { exit !(e < 1.5) }'; then ok "el pago no espero (${e2} s): la salida rehusada aborto su transaccion y solto el cerrojo"; else fallo "el pago espero a una salida rehusada: ESPERA=${e2:-?}"; fi
grep -q 'OK ' "${t2}" && ok "el pago entro" || fallo "pago: $(grep -i 'error\|gp_pay' "${t2}" | head -c 200)"
afirmar "$(miembro "${UC}")" 1 "membresia de Carlos (sigue)"
afirmar "$(pares)" "-" "pares tras el pago"
t3=$(mktemp); sesion "${t3}" "$(salir_sql "${UC}" "${PC}" a3c00000-0000-4000-8000-000000000067)" 0; wait
grep -q 'SALIDA=OK' "${t3}" && ok "el reintento de salir, ya a cero, salio" || fallo "reintento: $(grep SALIDA "${t3}" | head -c 200)"
afirmar "$(miembro "${UC}")" 0 "membresia de Carlos"
rm -f "${t3}"
rm -f "${t1}" "${t2}"

echo "== 3 · doble confirmacion simultanea (Ana y Carlos, claves distintas) =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(pago_sql "${UA}" a3c00000-0000-4000-8000-000000000053 "${POS_INICIAL}")" 3
sleep 1
sesion "${t2}" "$(pago_sql "${UC}" a3c00000-0000-4000-8000-000000000054 "${POS_INICIAL}")" 0
wait
grep -q 'OK ' "${t1}" && ok "la primera confirmacion entro" || fallo "primera: $(grep -i 'error\|gp_pay' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q 'SETTLEMENT_STALE' "${t2}" && ok "la segunda caduco por los netos" || fallo "segunda: $(grep -i 'gp_pay\|OK\|STALE' "${t2}" | head -c 200)"
afirmar "$(pagos)" 1 "pagos registrados"
rm -f "${t1}" "${t2}"

echo "== 4 · anulacion (retiene 3 s) → salir del receptor =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(pago_sql "${UC}" a3c00000-0000-4000-8000-000000000055 "${POS_INICIAL}")" 0; wait
OP=$(pago_id)
sesion "${t1}" "$(anular_sql "${UC}" a3c00000-0000-4000-8000-000000000071 "${OP}")" 3
sleep 1
sesion "${t2}" "$(salir_sql "${UA}" "${PA}" a3c00000-0000-4000-8000-000000000063)" 0
wait
grep -q 'ANULAR=OK' "${t1}" && ok "la anulacion entro" || fallo "anular: $(grep 'ANULAR' "${t1}")"
espero "${t2}" "salir"
grep -q 'SALIDA=LEAVE_BLOCKED_DEBT' "${t2}" && ok "salir vio los pares reabiertos por la anulacion: bloqueado" || fallo "salir: $(grep 'SALIDA' "${t2}" | head -c 200)"
afirmar "$(miembro "${UA}")" 1 "membresia de Ana (sigue)"
afirmar "$(pares)" "Carlos>Ana:1000" "pares reabiertos"
rm -f "${t1}" "${t2}"

echo "== 5 · salir (retiene 3 s, a cero) → anulacion por quien se queda =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "$(pago_sql "${UC}" a3c00000-0000-4000-8000-000000000056 "${POS_INICIAL}")" 0; wait
OP=$(pago_id)
sesion "${t1}" "$(salir_sql "${UC}" "${PC}" a3c00000-0000-4000-8000-000000000064)" 3
sleep 1
sesion "${t2}" "$(anular_sql "${UA}" a3c00000-0000-4000-8000-000000000072 "${OP}")" 0
wait
grep -q 'SALIDA=OK' "${t1}" && ok "Carlos salio a cero" || fallo "salir: $(grep 'SALIDA' "${t1}" | head -c 200)"
espero "${t2}" "la anulacion"
grep -q 'ANULAR=OK' "${t2}" && ok "Ana anulo despues: la deuda reabierta nombra a Carlos, que ya salio" || fallo "anular: $(grep 'ANULAR' "${t2}")"
afirmar "$(miembro "${UC}")" 0 "membresia de Carlos (no readmitido)"
afirmar "$(pares)" "Carlos>Ana:1000" "pares reabiertos"
rm -f "${t1}" "${t2}"

if [ "${fallos}" -eq 0 ]; then echo "OK · cinco carreras con las funciones reales: salida, registro y anulacion se serializan por el cerrojo de identidad; un solo pago por propuesta"; exit 0; fi
echo "FALLOS: ${fallos}"; exit 1
