#!/usr/bin/env bash
# ============================================================================
# RECLAMAR CONTRA RETIRAR, con dos sesiones REALES.
# ============================================================================
#
# Un check en una sola sesion no puede demostrar que api.redeem_invitation y
# api.retire_participant se serializan: aqui una sesion retira a un participante
# sin cuenta y se queda dentro de la transaccion (pg_sleep), mientras otra
# intenta reclamarlo con una invitacion valida. La segunda tiene que ESPERAR al
# cerrojo y ver la retirada (PARTICIPANT_ALREADY_CLAIMED), nunca vincular a un
# retirado. Y al reves: reclamado primero, la retirada ve el vinculo
# (PARTICIPANT_LINKED).
#
# Escribe filas confirmadas y las retira despues, acotadas por identificadores
# propios. Solo contra la base local (local-db-guard).
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

EUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
UA=a3800000-0000-4000-8000-0000000000a1   # crea, invita, retira
UB=a3800000-0000-4000-8000-0000000000b1   # reclama
PSA=a3800000-0000-4000-8000-0000000000f1
PSB=a3800000-0000-4000-8000-0000000000f2
G=a3800000-0000-4000-8000-000000000010
PA=a3800000-0000-4000-8000-000000000031
P1=a3800000-0000-4000-8000-000000000032   # el disputado, carrera 1
P2=a3800000-0000-4000-8000-000000000033   # el disputado, carrera 2

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
delete from core.group_notice where scope_id = '${G}';
delete from core.invitation_attempt where user_id in ('${UA}','${UB}');
delete from core.group_invitation where scope_id = '${G}';
delete from core.participant_retirement where scope_id = '${G}';
-- F10/ADR-001 (20260915120000): sujetos y linea base de las instancias del grupo, antes que sus participantes.
delete from core.link_baseline b using core.link_baseline_subject s, core.participant p where s.link_id = b.link_id and p.id = s.participant_id and p.scope_id = '${G}';
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

# Fixtures confirmados: dos cuentas, un grupo con tres participantes sin cuenta
# ademas del creador, y una invitacion emitida por UA.
"${DB[@]}" >/dev/null <<SQL
begin;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PSA}', 'personal', '${EUR}', '${UA}'), ('${PSB}', 'personal', '${EUR}', '${UB}');
insert into core.membership (scope_id, user_id) values ('${PSA}', '${UA}'), ('${PSB}', '${UB}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group('{"client_command_id":"a3800000-0000-4000-8000-000000000020","command_contract_version":1,"client_group_id":"${G}","display_name":"Carrera","emoji":"GRP","currency_definition_id":"${EUR}","creator_participant_id":"${PA}","creator_display_name":"Edu","participants":[{"client_participant_id":"${P1}","display_name":"Uno"},{"client_participant_id":"${P2}","display_name":"Dos"}]}'::jsonb);
reset role;
commit;
SQL

TOKEN=$("${DBQ[@]}" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group_invitation('{"client_command_id":"a3800000-0000-4000-8000-000000000021","command_contract_version":1,"scope_id":"${G}"}'::jsonb) ->> 'token';
commit;
SQL
)
TOKEN=$(echo "${TOKEN}" | tail -n 1 | tr -d '[:space:]')
if [ -z "${TOKEN}" ]; then echo "no se pudo emitir la invitacion"; exit 1; fi

echo "Carrera 1: retirar primero (dentro de la transaccion), reclamar espera"
t1=$(mktemp); t2=$(mktemp)
"${DB[@]}" >"${t1}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.retire_participant('{"client_operation_id":"a3800000-0000-4000-8000-000000000051","command_contract_version":1,"scope_id":"${G}","participant_id":"${P1}","expected_pairs":[]}'::jsonb);
select pg_sleep(3);
reset role;
commit;
SQL
p1=$!
sleep 1
"${DB[@]}" >"${t2}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.redeem_invitation('{"client_command_id":"a3800000-0000-4000-8000-000000000061","command_contract_version":1,"token":"${TOKEN}","choice":"claim","participant_id":"${P1}"}'::jsonb);
commit;
SQL
p2=$!
wait "${p1}"; wait "${p2}"
if grep -q 'PARTICIPANT_ALREADY_CLAIMED' "${t2}"; then
  ok "reclamar espero al cerrojo y vio la retirada: PARTICIPANT_ALREADY_CLAIMED"
else
  fallo "reclamar no vio la retirada; salida: $(tr -d '\n' <"${t2}" | head -c 300)"
fi
n=$("${DBQ[@]}" <<SQL
select count(*) from core.participant_user_link where participant_id = '${P1}';
SQL
)
[ "$(echo "${n}" | tr -d '[:space:]')" = "0" ] && ok "ningun vinculo sobre el retirado" || fallo "el retirado quedo vinculado"
rm -f "${t1}" "${t2}"

echo "Carrera 2: reclamar primero (dentro de la transaccion), retirar espera"
t1=$(mktemp); t2=$(mktemp)
"${DB[@]}" >"${t1}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select api.redeem_invitation('{"client_command_id":"a3800000-0000-4000-8000-000000000062","command_contract_version":1,"token":"${TOKEN}","choice":"claim","participant_id":"${P2}"}'::jsonb);
select pg_sleep(3);
reset role;
commit;
SQL
p1=$!
sleep 1
"${DB[@]}" >"${t2}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.retire_participant('{"client_operation_id":"a3800000-0000-4000-8000-000000000052","command_contract_version":1,"scope_id":"${G}","participant_id":"${P2}","expected_pairs":[]}'::jsonb);
commit;
SQL
p2=$!
wait "${p1}"; wait "${p2}"
if grep -q 'PARTICIPANT_LINKED' "${t2}"; then
  ok "retirar espero al cerrojo y vio el vinculo: PARTICIPANT_LINKED"
else
  fallo "retirar no vio el vinculo; salida: $(tr -d '\n' <"${t2}" | head -c 300)"
fi
n=$("${DBQ[@]}" <<SQL
select count(*) from core.participant_retirement where participant_id = '${P2}';
SQL
)
[ "$(echo "${n}" | tr -d '[:space:]')" = "0" ] && ok "el reclamado no quedo retirado" || fallo "el reclamado quedo retirado"
rm -f "${t1}" "${t2}"

if [ "${fallos}" -eq 0 ]; then echo "OK · reclamar y retirar se serializan en las dos direcciones"; exit 0; fi
echo "FALLOS: ${fallos}"; exit 1
