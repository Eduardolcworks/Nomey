#!/usr/bin/env bash
# ============================================================================
# VOLVER A ENTRAR TRAS SALIR, CON DOS SESIONES REALES (F09/ADR-010)
# ============================================================================
#
# api.redeem_invitation con choice 'rejoin' (migracion 20260914140000): clave
# de idempotencia → cerrojo de identidad del grupo (rango 1) → ya miembro /
# vinculo → membresia y periodo. La primera sesion entra y RETIENE sus
# bloqueos 3 s antes de confirmar; la segunda arranca 1 s despues. Se mide que
# la segunda ESPERO (clock_timestamp() − now() ≥ 1,5 s), que el resultado es
# el de un orden serial y que hay UNA membresia y UN periodo abierto.
#
#   1  la misma cuenta, dos claves distintas, dos intentos de volver a la vez
#   2  la misma cuenta, la misma clave, dos veces a la vez (doble pulsacion)
#   3  volver (retiene) → gasto de hoy que lo nombra: entra despues, y vale
#
# Escribe filas confirmadas y las retira despues, acotadas. Solo base local; el
# contenedor se elige con NOMEY_DB_CONTAINER (por defecto supabase_db_Nomey).
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
UA=a9a00000-0000-4000-8000-0000000000a1   # Edu: crea e invita
UB=a9a00000-0000-4000-8000-0000000000b1   # Aitor: sale y vuelve
PSA=a9a00000-0000-4000-8000-0000000000f1
PSB=a9a00000-0000-4000-8000-0000000000f2
G=a9a00000-0000-4000-8000-000000000010
PA=a9a00000-0000-4000-8000-000000000031
PB=a9a00000-0000-4000-8000-000000000032
HOY=$(date +%F)

limpiar_actividad() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.group_notice where scope_id = '${G}';
delete from core.balance_observation where scope_id in ('${G}','${PSA}','${PSB}');
delete from core.expense_category x using core.operation_version ov where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.movement_detail d using core.operation_version ov where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.split_participant where scope_id = '${G}';
delete from core.split where scope_id = '${G}';
delete from core.effect where scope_id in ('${G}','${PSA}','${PSB}');
delete from core.client_command where created_by in ('${UA}','${UB}') and command_type <> 'group.create';
-- F10/ADR-001 (20260915120000): la linea base de una instancia referencia versiones
-- (insert-only): se borra como postgres antes que ellas. Los vinculos y sus sujetos
-- se conservan entre carreras; los borra el limpiado final.
delete from core.link_baseline b using core.operation o where o.id = b.operation_id and o.created_by in ('${UA}','${UB}');
delete from core.operation_version where created_by in ('${UA}','${UB}');
delete from core.operation where created_by in ('${UA}','${UB}');
delete from core.provisioning_command where created_by = '${UB}' and command_type <> 'invitation.redeem'; -- el origen de su instancia (F10/ADR-001) se conserva con el vinculo
delete from core.membership where scope_id = '${G}' and user_id = '${UB}';
delete from core.participant_period where participant_id = '${PB}';
insert into core.participant_period (participant_id, valid_from, valid_until) values ('${PB}', current_date - 10, null);
insert into core.membership (scope_id, user_id) values ('${G}', '${UB}');
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
delete from core.link_baseline b using core.link_baseline_subject s, core.participant p where s.link_id = b.link_id and p.id = s.participant_id and p.scope_id = '${G}';
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id = '${G}';
delete from core.participant_user_link where scope_id = '${G}';
-- F10/ADR-003 (20260918120000): el vinculo historico referencia su salida (departure_id); la salida se borra DESPUES del vinculo.
delete from core.group_departure where scope_id = '${G}';
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
select api.create_group('{"client_command_id":"a9a00000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Vuelta","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Edu","participants":[{"client_participant_id":"${PB}","display_name":"Aitor"}]}'::jsonb);
reset role;
insert into core.membership (scope_id, user_id) values ('${G}', '${UB}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values ('${PB}', '${G}', '${UB}');
update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = '${G}';
commit;
SQL

TOKEN=$("${DBQ[@]}" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group_invitation('{"client_command_id":"a9a00000-0000-4000-8000-000000000021","command_contract_version":1,"scope_id":"${G}"}'::jsonb) ->> 'token';
commit;
SQL
)
TOKEN=$(echo "${TOKEN}" | tail -n 1 | tr -d '[:space:]')

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

volver() { # salida clave hold
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.redeem_invitation('{"client_command_id":"$2","command_contract_version":1,"token":"${TOKEN}","choice":"rejoin"}'::jsonb);
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

salir() { # salida clave  (Aitor sale, sin retener)
  "${DB[@]}" >"$1" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.leave_group('{"client_command_id":"$2","command_contract_version":1,"scope_id":"${G}"}'::jsonb);
reset role;
commit;
SQL
}

gasto() { # salida clave hold  (Edu registra un gasto de HOY con Aitor)
  "${DB[@]}" >"$1" 2>&1 <<SQL &
\set ON_ERROR_ROLLBACK on
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"$2","command_contract_version":1,"scope_id":"${G}","currency_definition_id":"${EUR}","total":"2000","effective_date":"${HOY}","concept":"Cena","category_id":"${CAT}","payer_participant_id":"${PA}","participants":["${PA}","${PB}"],"split_method":{"kind":"equal"}}'::jsonb);
${ESPERA_SQL}
select pg_sleep($3);
reset role;
commit;
SQL
}

q() { "${DBQ[@]}" <<SQL | tr -d '[:space:]'
$1
SQL
}
miembro()  { q "select count(*) from core.membership where scope_id = '${G}' and user_id = '${UB}';"; }
abiertos() { q "select count(*) from core.participant_period where participant_id = '${PB}' and valid_until is null;"; }
periodos() { q "select count(*) from core.participant_period where participant_id = '${PB}';"; }
gastos()   { q "select count(*) from core.operation o join core.operation_version v on v.id = o.current_version_id join core.split s on s.operation_version_id = v.id where s.scope_id = '${G}';"; }
espera_de(){ grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2; }
espero() { local e; e=$(espera_de "$1")
  if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero al cerrojo (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(tr -d '\n' <"$1" | head -c 200)"; fi; }
esperar() { wait "$1"; wait "$2"; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

n_clave=80
CLAVE=""
clave() { n_clave=$((n_clave + 1)); CLAVE=$(printf 'a9a00000-0000-4000-8000-0000000000%02x' "${n_clave}"); }

preparar() { # Aitor dentro y a cero → sale
  limpiar_actividad
  local t; t=$(mktemp); clave; salir "${t}" "${CLAVE}"
  grep -q '"scope_id"' "${t}" || fallo "la salida de partida fallo: $(tr -d '\n' <"${t}" | head -c 200)"
  rm -f "${t}"
  afirmar "$(miembro)" 0 "de partida, fuera"
}
t1=""; t2=""
carrera() { echo "== $1 =="; t1=$(mktemp); t2=$(mktemp); }
fin() { rm -f "${t1}" "${t2}"; }

carrera "1 · volver (retiene 3 s) → volver otra vez, otra clave"
preparar
clave; volver "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; volver "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"rejoined": true' "${t1}" && ok "la primera volvio" || fallo "primera: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q '"already_member": true' "${t2}" && ok "la segunda ya estaba dentro" || fallo "segunda: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(miembro)" 1 "membresias"
afirmar "$(abiertos)" 1 "periodos abiertos"
afirmar "$(periodos)" 2 "periodos (el anterior, cerrado hoy, y el nuevo desde hoy)"
fin

carrera "2 · doble pulsacion: la misma clave K dos veces"
preparar
clave; K="${CLAVE}"
volver "${t1}" "${K}" 3; p1=$!
sleep 1
volver "${t2}" "${K}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"rejoined": true' "${t1}" && ok "la primera volvio" || fallo "primera: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "la segunda"
grep -q '"already_processed": true' "${t2}" && ok "la segunda respondio el resultado original" || fallo "segunda: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(miembro)" 1 "membresias"
afirmar "$(abiertos)" 1 "periodos abiertos"
fin

carrera "3 · volver (retiene 3 s) → gasto de hoy que lo nombra"
preparar
clave; volver "${t1}" "${CLAVE}" 3; p1=$!
sleep 1
clave; gasto "${t2}" "${CLAVE}" 0; p2=$!
esperar "${p1}" "${p2}"
grep -q '"rejoined": true' "${t1}" && ok "volvio" || fallo "volver: $(tr -d '\n' <"${t1}" | head -c 200)"
espero "${t2}" "el gasto"
grep -q 'operation_id' "${t2}" && ok "el gasto entro despues, con Aitor ya presente" || fallo "gasto: $(tr -d '\n' <"${t2}" | head -c 200)"
afirmar "$(gastos)" 1 "gastos vigentes"
fin

echo
if [ "${fallos}" -eq 0 ]; then echo "VOLVER EN CARRERA: OK (3 carreras)"; else echo "VOLVER EN CARRERA: ${fallos} fallo(s)"; exit 1; fi
