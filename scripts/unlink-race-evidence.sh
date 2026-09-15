#!/usr/bin/env bash
# ============================================================================
# DEJAR UNA INSTANCIA DE VINCULO, CON DOS SESIONES REALES (F10/ADR-001 §9)
# ============================================================================
#
# api.unlink_participant (migracion 20260916120000) delega en
# sec.unlink_instance: clave de idempotencia (0) → cerrojo de identidad del
# grupo (1) → membresia → vinculo propio con ese link_id → regla economica de
# la instancia (§2) → caja → hecho, avisos, borrado del vinculo y de la
# membresia. Sin rango 2. La primera sesion entra y RETIENE sus bloqueos 3 s
# antes de confirmar; la segunda arranca 1 s despues. Cuando la primera ENTRO,
# se mide que la segunda ESPERO (clock_timestamp() − now() ≥ 1,5 s); cuando la
# primera fue rehusada su cerrojo se solto con el error y no hay espera que
# medir. En todos los casos el resultado es el de un orden serial.
#
# Ana (UB) reclamo a su participante (PB) con la invitacion de Edu (UA), que
# creo el grupo con Ana y con Gus (PF, sin cuenta). Bea (UC) tiene la misma
# invitacion. «Baja» es Ana dejando su instancia, citando el link_id que lee en
# api.group_participant.
#
#   1a baja → gasto que nombra a Ana         1b gasto que nombra a Ana → baja
#   2a baja → correccion que sube su cuota   2b correccion que sube → baja
#                                            2c correccion que la quita → baja
#   3a baja → transferencia de Ana           3b transferencia de Ana → baja
#   4a anulacion de lo nacido durante → baja 4b baja → anulacion, y reintento
#   5a baja → salir                          5b salir → baja
#   6a baja → volver                         6b volver (ya miembro) → baja
#   7a baja → Bea reclama a PB               7b Bea reclama a PB → baja
#   8a baja → Ana asocia a Gus               8b Ana asocia a Gus (con deuda) → baja
#   9a baja → Edu retira a PB                9b Edu retira a PB → baja
#  10a doble baja, misma clave (replay)     10b doble baja, claves distintas
#  11  dos llamadas al wrapper legado a la vez, misma clave (un hecho, un comando, la otra replay)
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
UA=a3b00000-0000-4000-8000-0000000000a1   # Edu: crea e invita
UB=a3b00000-0000-4000-8000-0000000000b1   # Ana: reclama a PB y deja la instancia
UC=a3b00000-0000-4000-8000-0000000000c1   # Bea: reclama a PB despues
PSA=a3b00000-0000-4000-8000-0000000000f1
PSB=a3b00000-0000-4000-8000-0000000000f2
PSC=a3b00000-0000-4000-8000-0000000000f3
G=a3b00000-0000-4000-8000-000000000010
PA=a3b00000-0000-4000-8000-000000000031
PB=a3b00000-0000-4000-8000-000000000032
PF=a3b00000-0000-4000-8000-000000000033   # Gus, sin cuenta
HOY=$(date +%F)

limpiar_actividad() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.group_notice where scope_id = '${G}';
delete from core.group_departure where scope_id = '${G}';
delete from core.participant_unlink where scope_id = '${G}';
delete from core.participant_merge where scope_id = '${G}';
delete from core.participant_retirement where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}','${UC}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}','${UC}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSA}','${PSB}','${PSC}');
delete from core.client_command where created_by in ('${UA}','${UB}','${UC}') and command_type <> 'group.create';
-- La linea base y los sujetos de cada instancia son insert-only y referencian
-- versiones y participantes: se borran como postgres antes que sus destinos.
-- PB tiene una instancia por carrera (de Ana o de Bea); la de Edu se conserva.
delete from core.link_baseline b using core.operation o where o.id = b.operation_id and o.created_by in ('${UA}','${UB}','${UC}');
delete from core.link_baseline_subject where participant_id in ('${PB}','${PF}');
delete from core.operation_version where created_by in ('${UA}','${UB}','${UC}');
delete from core.operation where created_by in ('${UA}','${UB}','${UC}');
delete from core.participant_user_link where scope_id = '${G}' and user_id in ('${UB}','${UC}');
delete from core.membership where scope_id = '${G}' and user_id in ('${UB}','${UC}');
update core.participant_period set valid_until = null where participant_id in ('${PB}','${PF}');
delete from core.provisioning_command where created_by in ('${UB}','${UC}');
commit;
SQL
}

limpiar() {
  limpiar_actividad
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.invitation_attempt where user_id in ('${UA}','${UB}','${UC}');
delete from core.group_invitation where scope_id = '${G}';
delete from core.client_command where created_by in ('${UA}','${UB}','${UC}');
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
select api.create_group('{"client_command_id":"a3b00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Unlink","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Edu","participants":[{"client_participant_id":"${PB}","display_name":"Ana"},{"client_participant_id":"${PF}","display_name":"Gus"}]}'::jsonb);
reset role;
commit;
SQL

TOKEN=$("${DBQ[@]}" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group_invitation('{"client_command_id":"a3b00000-0000-4000-8000-000000000021","command_contract_version":1,"scope_id":"${G}"}'::jsonb) ->> 'token';
commit;
SQL
)
TOKEN=$(echo "${TOKEN}" | tail -n 1 | tr -d '[:space:]')

# ─── sesiones ───────────────────────────────────────────────────────────────
# Cada una es una transaccion real; `hold` segundos de retencion tras la
# operacion, y ESPERA = segundos entre el inicio de la transaccion y el final
# de la operacion (lo que se espero al cerrojo).
ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

sesion() { # salida usuario hold sql
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$2"}', true);
$4
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

# La baja de Ana, con el link_id que ELLA lee en su fila (api.group_participant);
# un cuarto argumento cita otro link_id a proposito.
baja() { # salida clave hold [link_id]
  local link="${4:-}"
  local expr="(select link_id from api.group_participant where participant_id = '${PB}')"
  [ -n "${link}" ] && expr="'${link}'"
  sesion "$1" "${UB}" "$3" "select api.unlink_participant(jsonb_build_object('client_command_id', '$2', 'command_contract_version', 1, 'scope_id', '${G}', 'participant_id', '${PB}', 'link_id', ${expr}));"
}
reclamar()  { sesion "$1" "${UB}" "$3" "select api.redeem_invitation('{\"client_command_id\":\"$2\",\"command_contract_version\":1,\"token\":\"${TOKEN}\",\"choice\":\"claim\",\"participant_id\":\"${PB}\"}'::jsonb);"; }
reclama_bea() { sesion "$1" "${UC}" "$3" "select api.redeem_invitation('{\"client_command_id\":\"$2\",\"command_contract_version\":1,\"token\":\"${TOKEN}\",\"choice\":\"claim\",\"participant_id\":\"${PB}\"}'::jsonb);"; }
volver()    { sesion "$1" "${UB}" "$3" "select api.redeem_invitation('{\"client_command_id\":\"$2\",\"command_contract_version\":1,\"token\":\"${TOKEN}\",\"choice\":\"rejoin\"}'::jsonb);"; }
salir()     { sesion "$1" "${UB}" "$3" "select api.leave_group('{\"client_command_id\":\"$2\",\"command_contract_version\":1,\"scope_id\":\"${G}\"}'::jsonb);"; }
gasto()     { # salida clave hold participantes_json  (Edu paga 2000 a partes iguales)
  sesion "$1" "${UA}" "$3" "select api.record_group_expense('{\"client_operation_id\":\"$2\",\"command_contract_version\":1,\"scope_id\":\"${G}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"2000\",\"effective_date\":\"${HOY}\",\"concept\":\"Cena\",\"category_id\":\"${CAT}\",\"payer_participant_id\":\"${PA}\",\"participants\":$4,\"split_method\":{\"kind\":\"equal\"}}'::jsonb);"
}
corregir()  { # salida clave hold total participantes_json  (Edu corrige la Cena vigente)
  sesion "$1" "${UA}" "$3" "select api.record_group_expense(jsonb_build_object('client_operation_id', '$2', 'command_contract_version', 1, 'operation_id', '${OP}', 'expected_version_id', '${VER}', 'scope_id', '${G}', 'currency_definition_id', '${EUR}', 'total', '$4', 'effective_date', '${HOY}', 'concept', 'Cena', 'category_id', '${CAT}', 'payer_participant_id', '${PA}', 'participants', '$5'::jsonb, 'split_method', jsonb_build_object('kind', 'equal')));"
}
anular()    { sesion "$1" "${UA}" "$3" "select api.annul_operation('{\"client_operation_id\":\"$2\",\"command_contract_version\":1,\"operation_id\":\"${OP}\",\"expected_version_id\":\"${VER}\"}'::jsonb);"; }
transferencia() { sesion "$1" "${UB}" "$3" "select api.record_settlement_by_transfer('{\"client_operation_id\":\"$2\",\"command_contract_version\":1,\"debt_scope_id\":\"${G}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"500\",\"effective_date\":\"${HOY}\",\"debtor_participant_id\":\"${PB}\",\"creditor_participant_id\":\"${PA}\"}'::jsonb);"; }
asociar()   { sesion "$1" "${UB}" "$3" "select api.associate_participant('{\"client_command_id\":\"$2\",\"command_contract_version\":1,\"scope_id\":\"${G}\",\"participant_id\":\"${PF}\"}'::jsonb);"; }
retirar()   { sesion "$1" "${UA}" "$3" "select api.retire_participant('{\"client_operation_id\":\"$2\",\"command_contract_version\":1,\"scope_id\":\"${G}\",\"participant_id\":\"${PB}\",\"expected_pairs\":[]}'::jsonb);"; }
rectificar() { sesion "$1" "${UB}" "$3" "select api.unclaim_participant('{\"client_command_id\":\"$2\",\"command_contract_version\":1,\"scope_id\":\"${G}\",\"participant_id\":\"${PB}\",\"claim_command_id\":\"${CLAIM}\"}'::jsonb);"; }

# ─── medidas ────────────────────────────────────────────────────────────────
q() { "${DBQ[@]}" <<SQL | tr -d '[:space:]'
$1
SQL
}
vinculo_pb()  { q "select count(*) from core.participant_user_link where participant_id = '${PB}';"; }
vinculo_ana() { q "select count(*) from core.participant_user_link where participant_id = '${PB}' and user_id = '${UB}';"; }
link_pb()     { q "select coalesce(link_id::text, '') from core.participant_user_link where participant_id = '${PB}';"; }
miembro_ana() { q "select count(*) from core.membership where scope_id = '${G}' and user_id = '${UB}';"; }
hechos_ana()  { q "select count(*) from core.participant_unlink where scope_id = '${G}' and user_id = '${UB}';"; }
salidas()     { q "select count(*) from core.group_departure where scope_id = '${G}' and user_id = '${UB}';"; }
fusiones()    { q "select count(*) from core.participant_merge where scope_id = '${G}';"; }
retirados()   { q "select count(*) from core.participant_retirement where scope_id = '${G}' and participant_id = '${PB}';"; }
gastos()      { q "select count(*) from core.operation o join core.operation_version v on v.id = o.current_version_id join core.split s on s.operation_version_id = v.id where s.scope_id = '${G}';"; }
versiones()   { q "select count(*) from core.operation_version where operation_id = '${OP}';"; }
deuda_pb()    { q "select coalesce(sum(debt_amount), 0) from core.current_effect where scope_id = '${G}' and debt_debtor_participant_id = '${PB}';"; }
caja_ana()    { q "select coalesce(sum(balance_amount), 0) from core.current_effect where scope_id = '${PSB}' and balance_amount is not null;"; }
espera_de()   { grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2; }
espero() { # fichero descripcion
  local e; e=$(espera_de "$1")
  if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero al cerrojo (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(tr -d '\n' <"$1" | head -c 160)"; fi
}
esperar() { local a="$1" b="$2"; wait "${a}"; wait "${b}"; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }
entro()   { grep -q "already_processed" "$1" && ! grep -q ERROR "$1" && ok "$2" || fallo "$2 · $(tr -d '\n' <"$1" | head -c 200)"; }
rehusado() { grep -q "$2" "$1" && ok "$3" || fallo "$3 · $(tr -d '\n' <"$1" | head -c 200)"; }

n_clave=80
CLAVE=""
CLAIM=""
OP=""; VER=""
clave() { n_clave=$((n_clave + 1)); CLAVE=$(printf 'a3b00000-0000-4000-8000-0000000000%02x' "${n_clave}"); }

reclamacion_de_partida() {
  local t; t=$(mktemp); clave; CLAIM="${CLAVE}"; reclamar "${t}" "${CLAVE}" 0; wait $!
  grep -q '"participant_id"' "${t}" || fallo "la reclamacion de partida fallo: $(grep -i 'error\|detail' "${t}" | tr -d '\n' | head -c 600)"
  rm -f "${t}"
}
gasto_de_partida() { # participantes_json  (Edu paga 2000 a partes iguales; queda OP/VER)
  local t; t=$(mktemp); clave; gasto "${t}" "${CLAVE}" 0 "$1"; wait $!
  grep -q 'operation_id' "${t}" || fallo "el gasto de partida fallo: $(tr -d '\n' <"${t}" | head -c 200)"
  rm -f "${t}"
  OP=$(q "select o.id from core.operation o join core.operation_version v on v.id = o.current_version_id join core.split s on s.operation_version_id = v.id where s.scope_id = '${G}' order by o.created_at desc limit 1;")
  VER=$(q "select current_version_id from core.operation where id = '${OP}';")
}
preparar() { # [previa|durante|gus]: deuda de Ana antes de reclamar, despues, o de Gus antes
  limpiar_actividad
  case "${1:-}" in
    previa)  gasto_de_partida "[\"${PA}\",\"${PB}\"]"; reclamacion_de_partida ;;
    durante) reclamacion_de_partida; gasto_de_partida "[\"${PA}\",\"${PB}\"]" ;;
    gus)     gasto_de_partida "[\"${PA}\",\"${PF}\"]"; reclamacion_de_partida ;;
    *)       reclamacion_de_partida ;;
  esac
}

t1=""; t2=""
carrera() { echo "== $1 =="; t1=$(mktemp); t2=$(mktemp); }
fin() { rm -f "${t1}" "${t2}"; }

# ─── 1 · baja ↔ gasto nuevo que nombra a Ana ───────────────────────────────
carrera "1a · baja (retiene 3 s) → gasto que nombra a Ana"
preparar
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; gasto "${t2}" "${CLAVE}" 0 "[\"${PA}\",\"${PB}\"]"; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro: sin atribucion nacida durante"
espero "${t2}" "el gasto"
grep -q 'operation_id' "${t2}" && ok "el gasto entro despues: nombra a un fantasma" || fallo "gasto: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
afirmar "$(miembro_ana)" 0 "membresia de Ana"
afirmar "$(deuda_pb)" 1000 "deuda de PB (sigue al participante, sin cuenta)"
afirmar "$(hechos_ana)" 1 "hecho de baja"
fin

carrera "1b · gasto que nombra a Ana (retiene 3 s) → baja"
preparar
clave; gasto "${t1}" "${CLAVE}" 3 "[\"${PA}\",\"${PB}\"]"; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "el gasto entro" || fallo "gasto: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
rehusado "${t2}" 'UNLINK_BLOCKED_ATTRIBUTION' "la baja leyo el gasto BAJO el cerrojo: nacido durante la instancia, bloquea (§2.2)"
grep -q 'attribution' "${t2}" && ok "motivo: attribution" || fallo "motivo: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(vinculo_ana)" 1 "vinculo de Ana"
afirmar "$(hechos_ana)" 0 "hecho de baja"
fin

# ─── 2 · baja ↔ correccion de una operacion historica ──────────────────────
carrera "2a · baja (retiene 3 s) → correccion que sube la cuota de Ana"
preparar previa
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; corregir "${t2}" "${CLAVE}" 0 4000 "[\"${PA}\",\"${PB}\"]"; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro: la deuda previa esta en la linea base y no bloquea"
espero "${t2}" "la correccion"
grep -q 'operation_id' "${t2}" && ok "la correccion entro despues, sobre un fantasma" || fallo "correccion: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
afirmar "$(versiones)" 2 "versiones de la Cena"
afirmar "$(deuda_pb)" 2000 "deuda de PB"
fin

carrera "2b · correccion que sube la cuota de Ana (retiene 3 s) → baja"
preparar previa
clave; corregir "${t1}" "${CLAVE}" 3 4000 "[\"${PA}\",\"${PB}\"]"; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "la correccion entro" || fallo "correccion: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
rehusado "${t2}" 'UNLINK_BLOCKED_ATTRIBUTION' "la baja vio la version vigente: 1000 → 2000 sobre la base, bloquea (§2.2)"
afirmar "$(vinculo_ana)" 1 "vinculo de Ana"
fin

carrera "2c · correccion que quita a Ana (retiene 3 s) → baja"
preparar previa
clave; corregir "${t1}" "${CLAVE}" 3 2000 "[\"${PA}\"]"; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "la correccion entro" || fallo "correccion: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
entro "${t2}" "la baja entro: Ana dejo de figurar (cur ∅ < base), pasa (§2.5)"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
afirmar "$(deuda_pb)" 0 "deuda de PB"
fin

# ─── 3 · baja ↔ settlement con Ana como parte ──────────────────────────────
carrera "3a · baja (retiene 3 s) → transferencia de Ana a Edu"
preparar previa
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; transferencia "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro"
espero "${t2}" "la transferencia"
rehusado "${t2}" 'NOT_AUTHORIZED' "la transferencia se rehuso: Ana ya no es la deudora vinculada"
afirmar "$(caja_ana)" 0 "caja de Ana"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
fin

carrera "3b · transferencia de Ana a Edu (retiene 3 s) → baja"
preparar previa
clave; transferencia "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "la transferencia entro" || fallo "transferencia: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
rehusado "${t2}" 'UNLINK_BLOCKED_ATTRIBUTION' "la baja vio el settlement nacido durante: bloquea por politica (§2.3; su caja bloquearia igual, §2.4)"
grep -q 'policy' "${t2}" && ok "motivo: policy" || fallo "motivo: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(caja_ana)" "-500" "caja de Ana (sigue vinculada)"
afirmar "$(vinculo_ana)" 1 "vinculo de Ana"
fin

# ─── 4 · baja ↔ anulacion de lo nacido durante ─────────────────────────────
carrera "4a · anulacion del gasto nacido durante (retiene 3 s) → baja"
preparar durante
clave; anular "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'operation_id' "${t1}" && ok "la anulacion entro" || fallo "anulacion: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
entro "${t2}" "la baja entro: solo cuenta la version vigente, y la anulada no atribuye nada (§2.5)"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
afirmar "$(deuda_pb)" 0 "deuda de PB"
fin

carrera "4b · baja (rehusada) → anulacion, y reintento de la baja"
preparar durante
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; anular "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
rehusado "${t1}" 'UNLINK_BLOCKED_ATTRIBUTION' "la baja se rehuso: el gasto nacio durante la instancia"
grep -q 'operation_id' "${t2}" && ok "la anulacion entro (el rechazo solto el cerrojo)" || fallo "anulacion: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(hechos_ana)" 0 "hecho de baja (el rechazo no escribio nada)"
clave; baja "${t1}" "${CLAVE}" 0; wait $!
entro "${t1}" "el reintento con clave nueva entro tras la anulacion"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
fin

# ─── 5 · baja ↔ salir ──────────────────────────────────────────────────────
carrera "5a · baja (retiene 3 s) → salir"
preparar
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; salir "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro"
espero "${t2}" "salir"
rehusado "${t2}" 'NOT_AUTHORIZED' "salir se rehuso: ya no era miembro"
afirmar "$(salidas)" 0 "salidas registradas"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
afirmar "$(miembro_ana)" 0 "membresia de Ana"
fin

carrera "5b · salir (retiene 3 s) → baja"
preparar
clave; salir "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "salir entro"
espero "${t2}" "la baja"
rehusado "${t2}" 'NOT_AUTHORIZED' "la baja leyo la membresia BAJO el cerrojo: quien salio conserva su vinculo y no puede dejarlo (§5)"
afirmar "$(salidas)" 1 "salidas registradas"
afirmar "$(vinculo_ana)" 1 "vinculo de Ana"
afirmar "$(miembro_ana)" 0 "membresia de Ana"
fin

# ─── 6 · baja ↔ volver ─────────────────────────────────────────────────────
carrera "6a · baja (retiene 3 s) → volver"
preparar
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; volver "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro"
espero "${t2}" "volver"
rehusado "${t2}" 'REJOIN_NOT_AVAILABLE' "volver se rehuso: sin vinculo no hay identidad a la que volver (§6)"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
afirmar "$(miembro_ana)" 0 "membresia de Ana"
fin

carrera "6b · volver siendo miembro (retiene 3 s) → baja"
preparar
clave; volver "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'already_member' "${t1}" && ok "volver siendo miembro no creo nada" || fallo "volver: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
entro "${t2}" "la baja entro despues"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
fin

# ─── 7 · baja ↔ reclamacion ajena del mismo participante ───────────────────
carrera "7a · baja (retiene 3 s) → Bea reclama a PB"
preparar
LINK_ANA=$(link_pb)
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; reclama_bea "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro"
espero "${t2}" "la reclamacion de Bea"
grep -q '"participant_id"' "${t2}" && ! grep -q ERROR "${t2}" && ok "Bea reclamo despues: el participante quedo disponible (§6)" || fallo "Bea: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(q "select count(*) from core.participant_user_link where participant_id = '${PB}' and user_id = '${UC}';")" 1 "vinculo de Bea sobre PB"
[ "$(link_pb)" != "${LINK_ANA}" ] && ok "instancia nueva: link_id distinto" || fallo "la instancia de Bea reutilizo el link_id de Ana"
afirmar "$(q "select count(*) from core.participant_unlink where link_id = '${LINK_ANA}' and user_id = '${UB}';")" 1 "hecho de Ana con SU instancia"
fin

carrera "7b · Bea reclama a PB (rehusada: vinculado) → baja, y Bea reintenta"
preparar
clave; reclama_bea "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
rehusado "${t1}" 'PARTICIPANT_ALREADY_CLAIMED' "Bea se rehuso: PB estaba vinculado a Ana"
entro "${t2}" "la baja entro"
clave; reclama_bea "${t1}" "${CLAVE}" 0; wait $!
grep -q '"participant_id"' "${t1}" && ! grep -q ERROR "${t1}" && ok "el reintento de Bea entro" || fallo "Bea: $(tr -d '\n' <"${t1}" | head -c 160)"
afirmar "$(vinculo_pb)" 1 "vinculo de PB (de Bea)"
fin

# ─── 8 · baja ↔ asociar un fantasma a Ana ──────────────────────────────────
carrera "8a · baja (retiene 3 s) → Ana asocia a Gus"
preparar gus
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; asociar "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro"
espero "${t2}" "asociar"
rehusado "${t2}" 'NOT_AUTHORIZED' "asociar se rehuso: ya no era miembro"
afirmar "$(fusiones)" 0 "fusiones"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
fin

carrera "8b · Ana asocia a Gus, que debe (retiene 3 s) → baja"
preparar gus
clave; asociar "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q 'already_processed' "${t1}" && ! grep -q ERROR "${t1}" && ok "asociar entro" || fallo "asociar: $(tr -d '\n' <"${t1}" | head -c 160)"
espero "${t2}" "la baja"
rehusado "${t2}" 'UNLINK_BLOCKED_ATTRIBUTION' "la baja vio la fusion BAJO el cerrojo: la deuda de Gus, absorbida durante la instancia, bloquea (§4)"
afirmar "$(fusiones)" 1 "fusiones"
afirmar "$(vinculo_ana)" 1 "vinculo de Ana"
fin

# ─── 9 · baja ↔ retirada de PB por otro miembro ────────────────────────────
carrera "9a · baja (retiene 3 s) → Edu retira a PB"
preparar
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; retirar "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la baja entro"
espero "${t2}" "retirar"
grep -q 'operation_id' "${t2}" && ok "retirar entro despues: PB ya no tenia cuenta (§6: retirable)" || fallo "retirar: $(tr -d '\n' <"${t2}" | head -c 160)"
afirmar "$(retirados)" 1 "retirada de PB"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
fin

carrera "9b · Edu retira a PB (rehusada: vinculado) → baja, y reintento"
preparar
clave; retirar "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
rehusado "${t1}" 'PARTICIPANT_LINKED' "retirar se rehuso: PB tenia cuenta"
entro "${t2}" "la baja entro"
clave; retirar "${t1}" "${CLAVE}" 0; wait $!
grep -q 'operation_id' "${t1}" && ok "el reintento de retirar entro" || fallo "retirar: $(tr -d '\n' <"${t1}" | head -c 160)"
afirmar "$(retirados)" 1 "retirada de PB"
fin

# ─── 10 · doble baja ───────────────────────────────────────────────────────
carrera "10a · doble baja con la MISMA clave (doble pulsacion)"
preparar
clave; K="${CLAVE}"
baja "${t1}" "${K}" 3; p1=$!
sleep 1
baja "${t2}" "${K}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la primera entro"
espero "${t2}" "la segunda"
grep -q '"already_processed" *: *true' "${t2}" && ! grep -q ERROR "${t2}" && ok "la segunda es replay: el resultado original, sin segundo hecho" || fallo "segunda: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(hechos_ana)" 1 "hechos de baja"
afirmar "$(q "select count(*) from core.group_notice where scope_id = '${G}' and kind = 'identity_released';")" 1 "avisos identity_released (a Edu, una vez)"
fin

carrera "10b · doble baja con claves DISTINTAS"
preparar
LINK_ANA=$(link_pb)
clave; baja "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; baja "${t2}" "${CLAVE}" 0 "${LINK_ANA}"; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la primera entro"
espero "${t2}" "la segunda"
rehusado "${t2}" 'LINK_SUPERSEDED' "la segunda, con clave nueva y el link_id ya terminado: LINK_SUPERSEDED (§9), sin escribir"
afirmar "$(hechos_ana)" 1 "hechos de baja"
afirmar "$(q "select count(*) from core.provisioning_command where created_by = '${UB}' and command_type = 'participant.unlink';")" 1 "claves de baja (el rechazo no dejo la suya)"
fin

# ─── 11 · dos llamadas al wrapper legado a la vez ──────────────────────────
carrera "11 · api.unclaim_participant dos veces a la vez con la MISMA clave (doble pulsacion del cliente vigente)"
preparar
clave; K="${CLAVE}"
rectificar "${t1}" "${K}" 3; p1=$!
sleep 1
rectificar "${t2}" "${K}" 0; p2=$!
esperar "${p1}" "${p2}"
entro "${t1}" "la primera entro"
espero "${t2}" "la segunda"
grep -q '"already_processed" *: *true' "${t2}" && ! grep -q ERROR "${t2}" && ok "la segunda espero a la clave y es replay del mismo hecho (§11)" || fallo "segunda: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(hechos_ana)" 1 "hechos de baja"
afirmar "$(q "select count(*) from core.participant_unlink where scope_id = '${G}' and user_id = '${UB}' and origin_command_id = '${CLAIM}';")" 1 "el hecho cita el origen (la reclamacion)"
afirmar "$(q "select count(*) from core.participant_unlink where scope_id = '${G}' and user_id = '${UB}' and client_command_id = '${K}';")" 1 "el hecho cita la clave del cliente como comando de baja"
afirmar "$(q "select count(*) from core.provisioning_command where created_by = '${UB}' and command_type = 'participant.unlink';")" 1 "comandos de baja (uno, sin huerfanos)"
afirmar "$(vinculo_pb)" 0 "vinculo de PB"
fin

if [ "${fallos}" -eq 0 ]; then
  echo "OK · veintiuna carreras: cada resultado es un orden serial; lo nacido durante la instancia bloquea, la historia previa no, y ningun rechazo escribe"; exit 0
fi
echo "FALLOS: ${fallos}"; exit 1
