#!/usr/bin/env bash
# ============================================================================
# EL CERROJO DE IDENTIDAD DEL GRUPO, CON DOS SESIONES REALES
# ============================================================================
#
# Protocolo (migracion 20260912150000): clave de idempotencia → cerrojo de
# identidad del grupo (sec.lock_participant_claims) → filas de ambito
# (sec.lock_scopes) → fila de la operacion. Lo toman reclamar, retirar,
# «Saldado», salir y los dos writers que resuelven un Personal por vinculo.
# Rectificar es api.unclaim_participant (F09/ADR-006, migracion 20260912160000),
# llamada como la cuenta que reclamo: clave → cerrojo → membresia vigente →
# vinculo y su procedencia → caja del grupo en el Personal → borrar vinculo y
# membresia.
#
# Ocho carreras, dos por pareja y en las dos direcciones; la primera sesion
# entra y RETIENE sus bloqueos 3 s antes de confirmar; la segunda arranca 1 s
# despues. De cada una se comprueban tres cosas: que la segunda ESPERO (medido:
# clock_timestamp() − now() dentro de su transaccion ≥ 1,5 s: arranca 1 s despues y la primera retiene 3), que el resultado
# es el de un orden serial (primera, segunda) y que ninguna caja queda perdida
# ni atribuida a una cuenta desvinculada.
#
#   1a reclamar → gasto con Ana pagadora     1b gasto con Ana pagadora → reclamar
#   2a rectificar → gasto con Ana pagadora   2b gasto con Ana pagadora → rectificar
#   3a rectificar → transferencia de Ana     3b transferencia de Ana → rectificar
#   4a rectificar → salir Ana                4b salir Ana → rectificar
#
# 1b y 2a son ademas «el vinculo cambia entre la resolucion y la escritura»:
# el writer resuelve a la pagadora bajo el cerrojo y el cambio de vinculo no
# puede entrar hasta su commit, y se mide que no entro.
#
# Escribe filas confirmadas y las retira despues, acotadas. Solo base local.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

EUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
UA=a3a00000-0000-4000-8000-0000000000a1   # Edu: crea e invita
UB=a3a00000-0000-4000-8000-0000000000b1   # reclama a Ana, y despues «se equivoco»
PSA=a3a00000-0000-4000-8000-0000000000f1
PSB=a3a00000-0000-4000-8000-0000000000f2
G=a3a00000-0000-4000-8000-000000000010
PA=a3a00000-0000-4000-8000-000000000031
PB=a3a00000-0000-4000-8000-000000000032
HOY=$(date +%F)

limpiar_actividad() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.group_notice where scope_id = '${G}';
delete from core.group_departure where scope_id = '${G}';
delete from core.participant_unclaim where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSA}','${PSB}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSA}','${PSB}');
delete from core.client_command where created_by in ('${UA}','${UB}') and command_type <> 'group.create';
-- F10/ADR-001 (20260915120000): la linea base y los sujetos de cada instancia
-- son insert-only y referencian versiones y participantes; la fixture los
-- borra como postgres antes que a sus destinos. Ana (PB) tiene una instancia
-- por carrera; la de Edu (PA) se conserva con el grupo.
delete from core.link_baseline b using core.operation o where o.id = b.operation_id and o.created_by in ('${UA}','${UB}');
delete from core.link_baseline_subject where participant_id = '${PB}';
delete from core.operation_version where created_by in ('${UA}','${UB}');
delete from core.operation where created_by in ('${UA}','${UB}');
delete from core.participant_user_link where scope_id = '${G}' and user_id = '${UB}';
delete from core.membership where scope_id = '${G}' and user_id = '${UB}';
update core.participant_period set valid_until = null where participant_id = '${PB}';
delete from core.provisioning_command where created_by = '${UB}';
commit;
SQL
}

limpiar() {
  limpiar_actividad
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.invitation_attempt where user_id in ('${UA}','${UB}');
delete from core.group_invitation where scope_id = '${G}';
delete from core.client_command where created_by in ('${UA}','${UB}');
delete from core.participant_retirement where scope_id = '${G}';
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id = '${G}';
delete from core.participant_user_link where scope_id = '${G}';
delete from core.membership where scope_id in ('${G}','${PSA}','${PSB}');
delete from core.participant_period where participant_id in (select id from core.participant where scope_id = '${G}');
delete from core.participant where scope_id = '${G}';
delete from core.group_profile where scope_id = '${G}';
delete from core.provisioning_command where created_by in ('${UA}','${UB}');
delete from core.scope where id in ('${G}','${PSA}','${PSB}');
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
  ('${PSA}', 'personal', '${EUR}', '${UA}'), ('${PSB}', 'personal', '${EUR}', '${UB}');
insert into core.membership (scope_id, user_id) values ('${PSA}', '${UA}'), ('${PSB}', '${UB}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group('{"client_command_id":"a3a00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Unclaim","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Edu","participants":[{"client_participant_id":"${PB}","display_name":"Ana"}]}'::jsonb);
reset role;
commit;
SQL

TOKEN=$("${DBQ[@]}" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group_invitation('{"client_command_id":"a3a00000-0000-4000-8000-000000000021","command_contract_version":1,"scope_id":"${G}"}'::jsonb) ->> 'token';
commit;
SQL
)
TOKEN=$(echo "${TOKEN}" | tail -n 1 | tr -d '[:space:]')

# ─── sesiones ───────────────────────────────────────────────────────────────
# Cada una es una transaccion real; `hold` segundos de retencion tras la
# operacion, y ESPERA = segundos entre el inicio de la transaccion y el final
# de la operacion (lo que estuvo bloqueada, mas lo que tardo).
ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

reclamar() { # salida clave hold
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.redeem_invitation('{"client_command_id":"$2","command_contract_version":1,"token":"${TOKEN}","choice":"claim","participant_id":"${PB}"}'::jsonb);
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

gasto() { # salida clave pagador hold  (Edu registra; participan los dos, a medias)
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"$2","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"2000","effective_date":"${HOY}","concept":"Cena","category_id":"${CAT}","payer_participant_id":"$3","participants":["${PA}","${PB}"],"split_method":{"kind":"equal"}}'::jsonb);
${ESPERA_SQL}
select pg_sleep($4);
reset role;
commit;
SQL
}

transferencia() { # salida clave hold  (Ana paga 500 a Edu por transferencia)
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.record_settlement_by_transfer('{"client_operation_id":"$2","command_contract_version":1,"debt_scope_id":"${G}","currency_definition_id":"${EUR}","amount":"500","effective_date":"${HOY}","debtor_participant_id":"${PB}","creditor_participant_id":"${PA}"}'::jsonb);
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

salir() { # salida clave hold  (Ana sale del grupo)
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.leave_group('{"client_command_id":"$2","command_contract_version":1,"scope_id":"${G}"}'::jsonb);
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

# LA RECTIFICACION REAL, como la cuenta que reclamo (UB), contra la
# reclamacion que creo su vinculo (CLAIM: la clave del `reclamar` de partida).
rectificar() { # salida clave hold
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.unclaim_participant('{"client_command_id":"$2","command_contract_version":1,"scope_id":"${G}","participant_id":"${PB}","claim_command_id":"${CLAIM}"}'::jsonb);
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

# ─── medidas ────────────────────────────────────────────────────────────────
q() { "${DBQ[@]}" <<SQL | tr -d '[:space:]'
$1
SQL
}
caja_ana()    { q "select coalesce(sum(balance_amount), 0) from core.current_effect where scope_id = '${PSB}' and balance_amount is not null;"; }
vinculo_ana() { q "select count(*) from core.participant_user_link where participant_id = '${PB}' and user_id = '${UB}';"; }
miembro_ana() { q "select count(*) from core.membership where scope_id = '${G}' and user_id = '${UB}';"; }
salidas()     { q "select count(*) from core.group_departure where scope_id = '${G}' and user_id = '${UB}';"; }
gastos()      { q "select count(*) from core.operation o join core.operation_version v on v.id = o.current_version_id join core.split s on s.operation_version_id = v.id where s.scope_id = '${G}';"; }
espera_de()   { grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2; }
espero() { # fichero descripcion
  local e; e=$(espera_de "$1")
  if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero al cerrojo (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(tr -d '\n' <"$1" | head -c 160)"; fi
}
esperar() { local a="$1" b="$2"; wait "${a}"; wait "${b}"; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

n_clave=80
CLAVE=""
CLAIM=""
clave() { n_clave=$((n_clave + 1)); CLAVE=$(printf 'a3a00000-0000-4000-8000-0000000000%02x' "${n_clave}"); }

preparar() { # con_reclamacion con_deuda
  limpiar_actividad
  local t
  if [ "$1" = 1 ]; then
    t=$(mktemp); clave; CLAIM="${CLAVE}"; reclamar "${t}" "${CLAVE}" 0; wait $!
    grep -q '"participant_id"' "${t}" || fallo "la reclamacion de partida fallo: $(grep -i 'error\|detail' "${t}" | tr -d '\n' | head -c 600)"
    rm -f "${t}"
  fi
  if [ "$2" = 1 ]; then
    t=$(mktemp); clave; gasto "${t}" "${CLAVE}" "${PA}" 0; wait $!
    grep -q 'operation_id' "${t}" || fallo "el gasto de partida fallo: $(tr -d '\n' <"${t}" | head -c 160)"
    rm -f "${t}"
  fi
}

t1=""; t2=""
carrera() { echo "== $1 =="; t1=$(mktemp); t2=$(mktemp); }
fin() { rm -f "${t1}" "${t2}"; }

# ─── 1 · reclamar ↔ gasto con Ana pagadora ─────────────────────────────────
carrera "1a · reclamar (retiene 3 s) → gasto con Ana pagadora"
preparar 0 0
clave; reclamar "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; gasto "${t2}" "${CLAVE}" "${PB}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"participant_id"' "${t1}" && ok "la reclamacion entro" || fallo "reclamar: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "el gasto"
grep -q 'operation_id' "${t2}" && ok "el gasto entro despues" || fallo "gasto: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(caja_ana)" "-2000" "caja de Ana (pagadora YA vinculada: orden serial reclamar, gasto)"
afirmar "$(vinculo_ana)" 1 "vinculo"
fin

carrera "1b · gasto con Ana pagadora (retiene 3 s; Ana sin cuenta al resolver) → reclamar"
preparar 0 0
clave; gasto "${t1}" "${CLAVE}" "${PB}" 3; p1=$!
sleep 1
clave; reclamar "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "el gasto entro" || fallo "gasto: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la reclamacion"
grep -q '"participant_id"' "${t2}" && ok "la reclamacion entro despues" || fallo "reclamar: $(tr -d '\n' <"${t2}" | head -c 160)"
# Orden serial (gasto, reclamar): la pagadora no tenia cuenta al escribirse el
# gasto, luego esa caja no es de nadie (F03/ADR-013) y reclamar no la fabrica.
afirmar "$(caja_ana)" "0" "caja de Ana (la reclamacion no entro entre la resolucion y la escritura)"
afirmar "$(vinculo_ana)" 1 "vinculo"
fin

# ─── 2 · rectificar ↔ gasto con Ana pagadora ───────────────────────────────
carrera "2a · rectificar (retiene 3 s) → gasto con Ana pagadora"
preparar 1 0
clave; rectificar "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; gasto "${t2}" "${CLAVE}" "${PB}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q "already_processed" "${t1}" && ! grep -q ERROR "${t1}" && ok "rectificar sin caja previa borro vinculo y membresia" || fallo "rectificar: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "el gasto"
grep -q 'operation_id' "${t2}" && ok "el gasto entro despues, con Ana ya sin cuenta" || fallo "gasto: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(caja_ana)" "0" "caja de Ana (ninguna caja a una cuenta desvinculada)"
afirmar "$(vinculo_ana)" 0 "vinculo"
afirmar "$(gastos)" 1 "gastos del grupo (el gasto existe, con Ana pagadora sin cuenta)"
fin

carrera "2b · gasto con Ana pagadora (retiene 3 s) → rectificar"
preparar 1 0
clave; gasto "${t1}" "${CLAVE}" "${PB}" 3; p1=$!
sleep 1
clave; rectificar "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "el gasto entro" || fallo "gasto: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "rectificar"
grep -q 'UNCLAIM_BLOCKED_CASH' "${t2}" && ok "rectificar vio la caja vigente y se rehuso" || fallo "rectificar: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(caja_ana)" "-2000" "caja de Ana (sigue vinculada)"
afirmar "$(vinculo_ana)" 1 "vinculo"
afirmar "$(miembro_ana)" 1 "membresia"
fin

# ─── 3 · rectificar ↔ transferencia de Ana ─────────────────────────────────
carrera "3a · rectificar (retiene 3 s) → transferencia de Ana a Edu"
preparar 1 1
clave; rectificar "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; transferencia "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q "already_processed" "${t1}" && ! grep -q ERROR "${t1}" && ok "rectificar borro vinculo y membresia (la deuda de Ana no es caja)" || fallo "rectificar: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la transferencia"
grep -q 'NOT_AUTHORIZED' "${t2}" && ok "la transferencia se rehuso: Ana ya no es la deudora vinculada" || fallo "transferencia: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(caja_ana)" "0" "caja de Ana"
afirmar "$(vinculo_ana)" 0 "vinculo"
fin

carrera "3b · transferencia de Ana (retiene 3 s) → rectificar"
preparar 1 1
clave; transferencia "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; rectificar "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "la transferencia entro" || fallo "transferencia: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "rectificar"
grep -q 'UNCLAIM_BLOCKED_CASH' "${t2}" && ok "rectificar vio la caja de la transferencia y se rehuso" || fallo "rectificar: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(caja_ana)" "-500" "caja de Ana (la transferencia, atribuida a quien sigue vinculada)"
afirmar "$(vinculo_ana)" 1 "vinculo"
fin

# ─── 4 · rectificar ↔ salir ────────────────────────────────────────────────
carrera "4a · rectificar (retiene 3 s) → salir Ana"
preparar 1 0
clave; rectificar "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; salir "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q "already_processed" "${t1}" && ! grep -q ERROR "${t1}" && ok "rectificar borro vinculo y membresia" || fallo "rectificar: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "salir"
grep -q 'NOT_AUTHORIZED' "${t2}" && ok "salir se rehuso: ya no era miembro" || fallo "salir: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(salidas)" 0 "salidas registradas"
afirmar "$(vinculo_ana)" 0 "vinculo"
afirmar "$(miembro_ana)" 0 "membresia"
fin

carrera "4b · salir Ana (retiene 3 s) → rectificar"
preparar 1 0
clave; salir "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; rectificar "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q "already_processed" "${t1}" && ! grep -q ERROR "${t1}" && ok "salir entro" || fallo "salir: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "rectificar"
grep -q 'NOT_AUTHORIZED' "${t2}" && ok "rectificar leyo la membresia BAJO el cerrojo: ya no era miembro, se rehuso" || fallo "rectificar: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(salidas)" 1 "salidas registradas"
afirmar "$(vinculo_ana)" 1 "vinculo (quien salio conserva el suyo, F09/ADR-003)"
afirmar "$(miembro_ana)" 0 "membresia"
fin

if [ "${fallos}" -eq 0 ]; then
  echo "OK · ocho carreras: cada resultado es un orden serial, ninguna caja perdida ni atribuida a una cuenta desvinculada"; exit 0
fi
echo "FALLOS: ${fallos}"; exit 1
