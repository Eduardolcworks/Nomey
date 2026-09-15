#!/usr/bin/env bash
# ============================================================================
# ASOCIAR UN FANTASMA A MI CUENTA, CON DOS SESIONES REALES (F09/ADR-009, borrador)
# ============================================================================
#
# api.associate_participant (borrador 20260914130000): clave de idempotencia →
# cerrojo de identidad del grupo (sec.lock_participant_claims, rango 1) →
# vinculo propio, origen libre → fusion → caja historica (writer, rango 2 del
# grupo y del Personal). La primera sesion entra y RETIENE sus bloqueos 3 s
# antes de confirmar; la segunda arranca 1 s despues. De cada carrera se mide
# que la segunda ESPERO (clock_timestamp() − now() ≥ 1,5 s), que el resultado
# es el de un orden serial y que la caja del fantasma llega a UN Personal y
# una sola vez.
#
#   1  dos cuentas asocian al mismo fantasma a la vez
#   2  la misma cuenta, la misma clave, dos veces a la vez (doble pulsacion)
#   3a asociar → gasto que nombra al fantasma     3b gasto con el fantasma → asociar
#
# Escribe filas confirmadas y las retira despues, acotadas. Solo base local; el
# contenedor se elige con NOMEY_DB_CONTAINER (por defecto supabase_db_Nomey;
# mientras el borrador no este aplicado a la base local, supabase_db_NomeyIso).
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
C="${NOMEY_DB_CONTAINER:-supabase_db_Nomey}"
exigir_base_local "${C}" || exit 1

DB=(docker exec -i "${C}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i "${C}" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

EUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
UA=a7a00000-0000-4000-8000-0000000000a1   # Edu: crea el grupo y añade al fantasma
UB=a7a00000-0000-4000-8000-0000000000b1   # Aitor («Soy nuevo»)
UC=a7a00000-0000-4000-8000-0000000000c1   # Ana
PSA=a7a00000-0000-4000-8000-0000000000f1
PSB=a7a00000-0000-4000-8000-0000000000f2
PSC=a7a00000-0000-4000-8000-0000000000f3
G=a7a00000-0000-4000-8000-000000000010
PA=a7a00000-0000-4000-8000-000000000031
PB=a7a00000-0000-4000-8000-000000000032
PC=a7a00000-0000-4000-8000-000000000033
PF=a7a00000-0000-4000-8000-000000000034   # el fantasma
HOY=$(date +%F)

limpiar_actividad() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.participant_merge where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}','${UC}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}','${UC}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.client_command where created_by in ('${UA}','${UB}','${UC}') and command_type <> 'group.create';
-- F10/ADR-001 (20260915120000): la linea base de una instancia referencia versiones
-- (insert-only): se borra como postgres antes que ellas. Los vinculos y sus sujetos
-- se conservan entre carreras; los borra el limpiado final.
delete from core.link_baseline b using core.operation o where o.id = b.operation_id and o.created_by in ('${UA}','${UB}','${UC}');
delete from core.operation_version where created_by in ('${UA}','${UB}','${UC}');
delete from core.operation where created_by in ('${UA}','${UB}','${UC}');
delete from core.provisioning_command where created_by in ('${UB}','${UC}') and command_type <> 'invitation.redeem'; -- el origen de sus instancias (F10/ADR-001) se conserva con el vinculo
commit;
SQL
}

limpiar() {
  limpiar_actividad
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by in ('${UA}','${UB}','${UC}');
delete from core.link_baseline b using core.link_baseline_subject s, core.participant p where s.link_id = b.link_id and p.id = s.participant_id and p.scope_id = '${G}';
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id = '${G}';
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

CAT=$("${DBQ[@]}" <<SQL
select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null;
SQL
)
CAT=$(echo "${CAT}" | tr -d '[:space:]')

"${DB[@]}" >/dev/null <<SQL
begin;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PSA}', 'personal', '${EUR}', '${UA}'), ('${PSB}', 'personal', '${EUR}', '${UB}'), ('${PSC}', 'personal', '${EUR}', '${UC}');
insert into core.membership (scope_id, user_id) values ('${PSA}', '${UA}'), ('${PSB}', '${UB}'), ('${PSC}', '${UC}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group('{"client_command_id":"a7a00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Asociar","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Edu","participants":[{"client_participant_id":"${PB}","display_name":"Aitor"},{"client_participant_id":"${PC}","display_name":"Ana"},{"client_participant_id":"${PF}","display_name":"Aitor F"}]}'::jsonb);
reset role;
insert into core.membership (scope_id, user_id) values ('${G}', '${UB}'), ('${G}', '${UC}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values ('${PB}', '${G}', '${UB}'), ('${PC}', '${G}', '${UC}');
update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = '${G}';
commit;
SQL

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

asociar() { # salida cuenta clave hold
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$2"}', true);
select api.associate_participant('{"client_command_id":"$3","command_contract_version":1,"scope_id":"${G}","participant_id":"${PF}"}'::jsonb);
${ESPERA_SQL}
select pg_sleep($4);
reset role;
commit;
SQL
}

gasto_f() { # salida clave total hold  (Edu registra; el fantasma paga; participan F, Aitor y Ana)
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"$2","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"$3","effective_date":"${HOY}","concept":"Cena","category_id":"${CAT}","payer_participant_id":"${PF}","participants":["${PF}","${PB}","${PC}"],"split_method":{"kind":"equal"}}'::jsonb);
${ESPERA_SQL}
select pg_sleep($4);
reset role;
commit;
SQL
}

q() { "${DBQ[@]}" <<SQL | tr -d '[:space:]'
$1
SQL
}
caja()     { q "select coalesce(sum(balance_amount), 0) from core.current_effect where scope_id = '$1' and balance_amount is not null;"; }
fusiones() { q "select count(*) || ':' || coalesce(string_agg(case target_participant_id when '${PB}' then 'Aitor' when '${PC}' then 'Ana' end, ','), '-') from core.participant_merge where scope_id = '${G}';"; }
efectos_b(){ q "select count(*) from core.effect where scope_id = '${PSB}';"; }
gastos()   { q "select count(*) from core.operation o join core.operation_version v on v.id = o.current_version_id join core.split s on s.operation_version_id = v.id where s.scope_id = '${G}';"; }
espera_de(){ grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2; }
espero() { local e; e=$(espera_de "$1")
  if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero al cerrojo (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(tr -d '\n' <"$1" | head -c 200)"; fi; }
esperar() { wait "$1"; wait "$2"; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }
codigo()  { grep -o '"code" : "[A-Z_]*"' "$1" | head -1 | cut -d'"' -f4; }

n_clave=80
CLAVE=""
clave() { n_clave=$((n_clave + 1)); CLAVE=$(printf 'a7a00000-0000-4000-8000-0000000000%02x' "${n_clave}"); }

preparar() { # gasto de partida del fantasma (900)
  limpiar_actividad
  local t; t=$(mktemp); clave; gasto_f "${t}" "${CLAVE}" 900 0; wait $!
  grep -q 'operation_id' "${t}" || fallo "el gasto de partida fallo: $(tr -d '\n' <"${t}" | head -c 200)"
  rm -f "${t}"
}
t1=""; t2=""
carrera() { echo "== $1 =="; t1=$(mktemp); t2=$(mktemp); }
fin() { rm -f "${t1}" "${t2}"; }

# ─── 1 · dos cuentas, el mismo fantasma ─────────────────────────────────────
carrera "1 · Aitor asocia (retiene 3 s) → Ana asocia al mismo fantasma"
preparar
clave; asociar "${t1}" "${UB}" "${CLAVE}" 3; p1=$!
sleep 1
clave; asociar "${t2}" "${UC}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"incorporated_versions": 1' "${t1}" && ok "Aitor asocio e incorporo 1 version" || fallo "Aitor: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "Ana"
afirmar "$(codigo "${t2}")" "PARTICIPANT_MERGED" "Ana ve el hecho bajo el cerrojo"
afirmar "$(fusiones)" "1:Aitor" "fusiones"
afirmar "$(caja "${PSB}")" "-900" "caja de Aitor (la cena que pago el fantasma)"
afirmar "$(caja "${PSC}")" "0" "caja de Ana"
fin

# ─── 2 · doble pulsacion: misma cuenta, misma clave ─────────────────────────
carrera "2 · Aitor asocia con la clave K (retiene 3 s) → Aitor, la misma clave K"
preparar
clave; K="${CLAVE}"
asociar "${t1}" "${UB}" "${K}" 3; p1=$!
sleep 1
asociar "${t2}" "${UB}" "${K}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"incorporated_versions": 1' "${t1}" && ok "la primera asocio" || fallo "primera: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q '"already_processed": true' "${t2}" && ok "la segunda respondio el resultado original (already_processed)" || fallo "segunda: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(fusiones)" "1:Aitor" "fusiones"
afirmar "$(efectos_b)" "1" "efectos en el Personal de Aitor (la caja, una vez)"
fin

# ─── 3 · asociar ↔ gasto que nombra al fantasma ─────────────────────────────
carrera "3a · asociar (retiene 3 s) → gasto con el fantasma como pagador"
preparar
clave; asociar "${t1}" "${UB}" "${CLAVE}" 3; p1=$!
sleep 1
clave; gasto_f "${t2}" "${CLAVE}" 300 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"incorporated_versions": 1' "${t1}" && ok "asocio" || fallo "asociar: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "el gasto"
afirmar "$(codigo "${t2}")" "PARTICIPANT_MERGED" "el gasto ya no puede nombrar al origen"
afirmar "$(gastos)" "1" "gastos vigentes"
afirmar "$(caja "${PSB}")" "-900" "caja de Aitor"
fin

carrera "3b · gasto con el fantasma como pagador (retiene 3 s) → asociar"
preparar
clave; gasto_f "${t1}" "${CLAVE}" 300 3; p1=$!
sleep 1
clave; asociar "${t2}" "${UB}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "el gasto entro" || fallo "gasto: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "asociar"
grep -q '"incorporated_versions": 2' "${t2}" && ok "asocio despues e incorporo las DOS versiones" || fallo "asociar: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(caja "${PSB}")" "-1200" "caja de Aitor (900 + 300, una vez cada una)"
afirmar "$(efectos_b)" "2" "efectos en el Personal de Aitor"
fin

echo
if [ "${fallos}" -eq 0 ]; then echo "ASOCIAR EN CARRERA: OK (4 carreras)"; else echo "ASOCIAR EN CARRERA: ${fallos} fallo(s)"; exit 1; fi
