#!/usr/bin/env bash
#
# Concurrencia real del protocolo de serializacion de la deuda · 7b.
#
# ADR-013 §11 no se puede comprobar desde `supabase/checks/`: una sola sesion de
# `psql` no tiene concurrencia, y una simulacion secuencial pasaria tambien con
# el lock quitado. Esto abre SESIONES SIMULTANEAS de verdad, como hizo E15-C.
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   ./scripts/writer-debt-concurrency.sh
#
# Escribe datos CONFIRMADOS —el lock solo existe entre transacciones distintas—
# y los retira al final, comprobando que no queda ninguno. Sale con codigo
# distinto de cero si alguna asercion falla, para que CI lo detecte.
#
# NO ES UNA MIGRACION y no crea ningun objeto de esquema.
#
# **TODA LIMPIEZA VA ACOTADA A SUS PROPIOS IDENTIFICADORES**, y no es una
# preferencia de estilo. Aqui hubo `delete from core.operation;` sin `where`,
# junto con otros doce borrados de tabla entera. En CI daba igual —la base se
# levanta desde cero y el script es su unico habitante—, pero sobre una base con
# datos borro treinta y siete operaciones reales. Un script de prueba no puede
# tocar una sola fila que no haya creado el.
#
# La guarda de `local-db-guard.sh` es la OTRA proteccion, y no sustituye a esta:
# aquella impide trabajar sobre la base equivocada, esta impide destrozar la
# correcta.

set -uo pipefail

# shellcheck source=scripts/local-db-guard.sh
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

EUR=cccccccc-cccc-4ccc-8ccc-cccccccccccc
UA=11111111-1111-4111-8111-111111111111
UB=22222222-2222-4222-8222-222222222222
PA=a0000000-0000-4000-8000-0000000000a1
PB=a0000000-0000-4000-8000-0000000000b1
GX=a0000000-0000-4000-8000-0000000000f1
GY=a0000000-0000-4000-8000-0000000000f2
GZ=a0000000-0000-4000-8000-0000000000f3
XA=b0000000-0000-4000-8000-0000000000a1
XB=b0000000-0000-4000-8000-0000000000b1
YA=b0000000-0000-4000-8000-0000000000a2
YB=b0000000-0000-4000-8000-0000000000b2
ZA=b0000000-0000-4000-8000-0000000000a3
ZB=b0000000-0000-4000-8000-0000000000b3

# LAS DOS LISTAS QUE ACOTAN TODA LIMPIEZA, escritas una vez. Cualquier borrado
# de este script se ata a una de ellas o al actor que lo creo; ninguno va suelto.
AMBITOS="'${PA}','${PB}','${GX}','${GY}','${GZ}'"
PARTICIPANTES="'${XA}','${XB}','${YA}','${YB}','${ZA}','${ZB}'"

# --------------------------------------------------------------- utilidades --
# Ejecuta una llamada autoritativa en su propia transaccion, como `authenticated`
# y con el actor indicado. Imprime lo que devuelva PostgreSQL, error incluido.
llamar() {
  local actor="$1" fn="$2" payload="$3"
  "${DB[@]}" <<SQL 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${actor}"}', true);
select api.${fn}('${payload}'::jsonb);
commit;
SQL
}

pendiente() {
  local scope="$1" deudor="$2" acreedor="$3"
  "${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(sum(case when e.debt_debtor_participant_id = '${deudor}' then e.debt_amount
                         else - e.debt_amount end), 0)
  from core.current_effect e
 where e.scope_id = '${scope}' and e.debt_amount is not null
   and array[e.debt_debtor_participant_id, e.debt_creditor_participant_id]
       <@ array['${deudor}'::uuid, '${acreedor}'::uuid];
SQL
}

# ------------------------------------------------------------------ fixture --
sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${EUR}','EUR',2)
  on conflict do nothing;
insert into core.scope (id,kind,base_currency_definition_id,owner_user_id) values
  ('${PA}','personal','${EUR}','${UA}'), ('${PB}','personal','${EUR}','${UB}');
insert into core.scope (id,kind,base_currency_definition_id) values
  ('${GX}','group','${EUR}'), ('${GY}','group','${EUR}'), ('${GZ}','group','${EUR}');
insert into core.participant (id, scope_id, display_name) values
  ('${XA}','${GX}','A'), ('${XB}','${GX}','B'),
  ('${YA}','${GY}','A'), ('${YB}','${GY}','B'),
  ('${ZA}','${GZ}','A'), ('${ZB}','${GZ}','B');
insert into core.membership (scope_id, user_id) values
  ('${GX}','${UA}'), ('${GX}','${UB}'),
  ('${GY}','${UA}'), ('${GY}','${UB}'),
  ('${GZ}','${UA}'), ('${GZ}','${UB}');
insert into core.participant_user_link (participant_id, scope_id, user_id) values
  ('${XA}','${GX}','${UA}'), ('${XB}','${GX}','${UB}'),
  ('${YA}','${GY}','${UA}'), ('${YB}','${GY}','${UB}'),
  ('${ZA}','${GZ}','${UA}'), ('${ZB}','${GZ}','${UB}');
insert into core.participant_period (participant_id, valid_from, valid_until) values
  ('${XA}','2020-01-01',null), ('${XB}','2020-01-01',null),
  ('${YA}','2020-01-01',null), ('${YB}','2020-01-01',null),
  ('${ZA}','2020-01-01',null), ('${ZB}','2020-01-01',null);
commit;
SQL
}

# Las FK diferibles rompen el borrado por sentencias sueltas: hay que hacerlo
# dentro de una transaccion. Es una de las trampas conocidas del proyecto.
# El heredoc va SIN comillas a proposito: necesita interpolar los
# identificadores para acotar cada borrado. Con 'SQL' entrecomillado no se
# expandian, que es como acabaron siendo borrados de tabla entera.
limpiar_operaciones() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by in ('${UA}','${UB}');
delete from core.balance_observation where scope_id in (${AMBITOS});
delete from core.adjustment_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.expense_category x using core.operation_version ov
  where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.movement_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.split_participant where scope_id in (${AMBITOS});
delete from core.split where scope_id in (${AMBITOS});
delete from core.effect where scope_id in (${AMBITOS});
update core.operation o set current_version_id = v.id
  from core.operation_version v
 where v.operation_id = o.id and v.version_no = 1
   and o.created_by in ('${UA}','${UB}');
delete from core.operation_version where created_by in ('${UA}','${UB}');
delete from core.operation where created_by in ('${UA}','${UB}');
commit;
SQL
}

retirar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by in ('${UA}','${UB}');
delete from core.balance_observation where scope_id in (${AMBITOS});
delete from core.adjustment_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.expense_category x using core.operation_version ov
  where ov.id = x.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.movement_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by in ('${UA}','${UB}');
delete from core.split_participant where scope_id in (${AMBITOS});
delete from core.split where scope_id in (${AMBITOS});
delete from core.effect where scope_id in (${AMBITOS});
delete from core.operation_version where created_by in ('${UA}','${UB}');
delete from core.operation where created_by in ('${UA}','${UB}');
delete from core.participant_period where participant_id in (${PARTICIPANTES});
delete from core.participant_user_link where scope_id in (${AMBITOS});
delete from core.membership where scope_id in (${AMBITOS});
delete from core.participant where scope_id in (${AMBITOS});
delete from core.scope where id in (${AMBITOS});
-- SOLO su propia definicion. Desde la Fase 6.A el catalogo monetario esta
-- SEMBRADO POR MIGRACION, y un borrado sin filtro lo arrasaria: los checks
-- posteriores dejarian de encontrar las veinte definiciones y el provisioning
-- se quedaria sin moneda que resolver.
delete from core.currency_definition where id = '${EUR}';
commit;
SQL
}

gasto() {
  local clave="$1" scope="$2" pagador="$3" p1="$4" p2="$5" total="$6"
  llamar "${UA}" record_group_expense \
    "{\"client_operation_id\":\"${clave}\",\"command_contract_version\":1,\"effective_date\":\"2026-10-01\",\"scope_id\":\"${scope}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"${total}\",\"payer_participant_id\":\"${pagador}\",\"participants\":[\"${p1}\",\"${p2}\"],\"split_method\":{\"kind\":\"equal\"}}"
}

echo "== preparando =="
retirar
sembrar

# ============================================================================
echo ""
echo "== 1 · dos liquidaciones simultaneas sobre la misma deuda =="
echo "   E15-C midio que SIN serializar, dos liquidaciones de 2000 sobre una"
echo "   deuda de 3000 pasan las dos y dejan un pendiente de -1000."

gasto 90000000-0000-4000-8000-000000000001 "${GX}" "${XA}" "${XA}" "${XB}" 10000 >/dev/null

liq() {
  llamar "${UA}" record_debt_settlement \
    "{\"client_operation_id\":\"$1\",\"command_contract_version\":1,\"effective_date\":\"2026-10-02\",\"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",\"debtor_participant_id\":\"${XB}\",\"creditor_participant_id\":\"${XA}\"}"
}

tmp1=$(mktemp); tmp2=$(mktemp)
liq 90000000-0000-4000-8000-000000000002 >"${tmp1}" 2>&1 &
p1=$!
liq 90000000-0000-4000-8000-000000000003 >"${tmp2}" 2>&1 &
p2=$!
wait "${p1}"; wait "${p2}"

aceptadas=0
rechazadas=0
for f in "${tmp1}" "${tmp2}"; do
  if grep -q 'SETTLEMENT_EXCEEDS_DEBT' "${f}"; then rechazadas=$((rechazadas + 1))
  elif grep -q 'already_processed' "${f}"; then aceptadas=$((aceptadas + 1))
  else echo "   salida inesperada:"; sed 's/^/     /' "${f}"; fi
  if grep -q '40P01' "${f}"; then fallo "hubo deadlock"; fi
done
rm -f "${tmp1}" "${tmp2}"

[ "${aceptadas}" -eq 1 ]  && ok "exactamente una liquidacion aceptada" \
                          || fallo "se aceptaron ${aceptadas} liquidaciones y debia ser 1"
[ "${rechazadas}" -eq 1 ] && ok "exactamente una rechazada por SETTLEMENT_EXCEEDS_DEBT" \
                          || fallo "se rechazaron ${rechazadas} y debia ser 1"

pend=$(pendiente "${GX}" "${XB}" "${XA}")
[ "${pend}" = "2000" ] && ok "pendiente final 2000, sin sobrepago" \
                       || fallo "pendiente final ${pend}; con sobrepago seria negativo"

# ============================================================================
echo ""
echo "== 2 · el mismo par de ambitos, nombrados en orden contrario =="
echo "   Dos correcciones que cruzan GX y GY. El orden ASCENDENTE por"
echo "   identificador es lo que impide el ciclo."

limpiar_operaciones

gasto 90000000-0000-4000-8000-000000000010 "${GX}" "${XA}" "${XA}" "${XB}" 6000 >/dev/null
gasto 90000000-0000-4000-8000-000000000011 "${GY}" "${YA}" "${YA}" "${YB}" 8000 >/dev/null

leer_op() {
  "${DBQ[@]}" <<SQL 2>/dev/null
select o.id || ' ' || o.current_version_id
  from core.operation o
  join core.operation_version v on v.id = o.current_version_id
 where v.original_amount = $1;
SQL
}
read -r OP1 V1 <<<"$(leer_op 6000)"
read -r OP2 V2 <<<"$(leer_op 8000)"

# La correccion de OP1 lo mueve de GX a GY, y la de OP2 de GY a GX. Cada una
# bloquea los DOS ambitos: el de la intencion nueva y el que llevaba deuda en la
# version vigente. Sin la union, sacar un ambito de una correccion lo dejaria
# fuera del lock justo cuando su deuda cambia.
mover() {
  local clave="$1" op="$2" ver="$3" scope="$4" pagador="$5" p1="$6" p2="$7"
  llamar "${UA}" record_group_expense \
    "{\"client_operation_id\":\"${clave}\",\"command_contract_version\":1,\"effective_date\":\"2026-10-01\",\"operation_id\":\"${op}\",\"expected_version_id\":\"${ver}\",\"scope_id\":\"${scope}\",\"currency_definition_id\":\"${EUR}\",\"total\":\"4000\",\"payer_participant_id\":\"${pagador}\",\"participants\":[\"${p1}\",\"${p2}\"],\"split_method\":{\"kind\":\"equal\"}}"
}

deadlocks=0
for intento in 1 2 3 4 5; do
  limpiar_operaciones
  gasto "90000000-0000-4000-8000-0000000001${intento}0" "${GX}" "${XA}" "${XA}" "${XB}" 6000 >/dev/null
  gasto "90000000-0000-4000-8000-0000000001${intento}1" "${GY}" "${YA}" "${YA}" "${YB}" 8000 >/dev/null
  read -r OP1 V1 <<<"$(leer_op 6000)"
  read -r OP2 V2 <<<"$(leer_op 8000)"
  t1=$(mktemp); t2=$(mktemp)
  mover "90000000-0000-4000-8000-0000000002${intento}0" "${OP1}" "${V1}" "${GY}" "${YA}" "${YA}" "${YB}" >"${t1}" 2>&1 &
  q1=$!
  mover "90000000-0000-4000-8000-0000000002${intento}1" "${OP2}" "${V2}" "${GX}" "${XA}" "${XA}" "${XB}" >"${t2}" 2>&1 &
  q2=$!
  wait "${q1}"; wait "${q2}"
  for f in "${t1}" "${t2}"; do
    grep -q '40P01\|deadlock' "${f}" && deadlocks=$((deadlocks + 1))
    grep -q 'already_processed' "${f}" || { echo "   intento ${intento}, salida inesperada:"; sed 's/^/     /' "${f}"; }
  done
  rm -f "${t1}" "${t2}"
done
[ "${deadlocks}" -eq 0 ] && ok "cinco intentos cruzados, ningun deadlock" \
                         || fallo "hubo ${deadlocks} deadlocks"

# ============================================================================
echo ""
echo "== 3 · una correccion que reduce la deuda, contra una liquidacion =="
echo "   Es el caso que ADR-013 §11 llama 'serializacion parcial': si solo la"
echo "   liquidacion bloqueara, la correccion no esperaria a nadie."

limpiar_operaciones
gasto 90000000-0000-4000-8000-000000000030 "${GZ}" "${ZA}" "${ZA}" "${ZB}" 10000 >/dev/null
read -r OP3 V3 <<<"$(
  "${DBQ[@]}" <<SQL 2>/dev/null
select o.id || ' ' || o.current_version_id from core.operation o;
SQL
)"

# Sesion X: toma el lock del ambito, espera, y CORRIGE el gasto a la baja.
# El bloqueo manual es solo para hacer determinista lo que en produccion decide
# el azar; la correccion vuelve a pedirlo dentro de la misma transaccion.
tx=$(mktemp); ty=$(mktemp); tz=$(mktemp)
"${DB[@]}" >"${tx}" 2>&1 <<SQL &
begin;
select 1 from core.scope where id = '${GZ}' for update;
select pg_sleep(3);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.record_group_expense('{"client_operation_id":"90000000-0000-4000-8000-000000000031","command_contract_version":1,"effective_date":"2026-10-01","operation_id":"${OP3}","expected_version_id":"${V3}","scope_id":"${GZ}","currency_definition_id":"${EUR}","total":"4000","payer_participant_id":"${ZA}","participants":["${ZA}","${ZB}"],"split_method":{"kind":"equal"}}'::jsonb);
reset role;
commit;
SQL
px=$!

sleep 1

# Sesion Y: liquida 3000. Con la deuda actual (5000) seria valida; tras la
# correccion (2000) no lo es. Debe ESPERAR al lock y validar despues.
llamar "${UA}" record_debt_settlement \
  "{\"client_operation_id\":\"90000000-0000-4000-8000-000000000032\",\"command_contract_version\":1,\"effective_date\":\"2026-10-02\",\"scope_id\":\"${GZ}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",\"debtor_participant_id\":\"${ZB}\",\"creditor_participant_id\":\"${ZA}\"}" >"${ty}" 2>&1 &
py=$!

# Sesion Z: CONTROL NEGATIVO. Lee la deuda SIN tomar el lock, mientras X lo
# tiene. Es lo que pasaria si los pasos 2 y 4 de ADR-013 §11 se invirtieran.
sleep 1
pendiente "${GZ}" "${ZB}" "${ZA}" >"${tz}" 2>&1

wait "${px}"; wait "${py}"

if grep -q 'SETTLEMENT_EXCEEDS_DEBT' "${ty}"; then
  ok "la liquidacion espero al lock y se valido contra la deuda YA corregida"
else
  fallo "la liquidacion no vio la correccion; salida: $(tr -d '\n' <"${ty}" | head -c 300)"
fi

sucio=$(tr -d '[:space:]' <"${tz}")
if [ "${sucio}" = "5000" ]; then
  ok "el control negativo leyo 5000 sin el lock: leer antes de bloquear reintroduce la carrera"
else
  echo "  nota: el control negativo leyo '${sucio}' en vez de 5000 (temporizacion)"
fi
rm -f "${tx}" "${ty}" "${tz}"

pend=$(pendiente "${GZ}" "${ZB}" "${ZA}")
[ "${pend}" = "2000" ] && ok "pendiente final 2000: la correccion se aplico y la liquidacion no" \
                       || fallo "pendiente final ${pend}"

# ============================================================================
echo ""
echo "== 4 · determinismo: la misma carrera, cinco veces =="
malas=0
for intento in 1 2 3 4 5; do
  limpiar_operaciones
  gasto "90000000-0000-4000-8000-0000000004${intento}0" "${GX}" "${XA}" "${XA}" "${XB}" 10000 >/dev/null
  s1=$(mktemp); s2=$(mktemp)
  llamar "${UA}" record_debt_settlement \
    "{\"client_operation_id\":\"90000000-0000-4000-8000-0000000005${intento}0\",\"command_contract_version\":1,\"effective_date\":\"2026-10-02\",\"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",\"debtor_participant_id\":\"${XB}\",\"creditor_participant_id\":\"${XA}\"}" >"${s1}" 2>&1 &
  r1=$!
  llamar "${UA}" record_debt_settlement \
    "{\"client_operation_id\":\"90000000-0000-4000-8000-0000000005${intento}1\",\"command_contract_version\":1,\"effective_date\":\"2026-10-02\",\"scope_id\":\"${GX}\",\"currency_definition_id\":\"${EUR}\",\"amount\":\"3000\",\"debtor_participant_id\":\"${XB}\",\"creditor_participant_id\":\"${XA}\"}" >"${s2}" 2>&1 &
  r2=$!
  wait "${r1}"; wait "${r2}"
  rm -f "${s1}" "${s2}"
  p=$(pendiente "${GX}" "${XB}" "${XA}")
  [ "${p}" = "2000" ] || { malas=$((malas + 1)); echo "   intento ${intento}: pendiente ${p}"; }
done
[ "${malas}" -eq 0 ] && ok "cinco carreras, siempre 2000" \
                     || fallo "${malas} carreras de cinco terminaron mal"

# ============================================================================
echo ""
echo "== retirada =="
retirar
# EL RECUENTO TAMBIEN VA ACOTADO, y por la misma razon que los borrados: contar
# las tablas enteras da por residuo propio cualquier fila ajena, asi que sobre
# una base con datos este script se declaraba roto comportandose bien. Lo
# descubrio `writer-debt-isolation.sh` al sembrar su centinela.
resto=$("${DBQ[@]}" <<SQL 2>/dev/null
select (select count(*) from core.operation where created_by in ('${UA}','${UB}'))
     + (select count(*) from core.effect where scope_id in (${AMBITOS}))
     + (select count(*) from core.scope where id in (${AMBITOS}))
     + (select count(*) from core.participant where scope_id in (${AMBITOS}))
     + (select count(*) from core.client_command where created_by in ('${UA}','${UB}'));
SQL
)
resto=$(tr -d '[:space:]' <<<"${resto}")
[ "${resto}" = "0" ] && ok "sin residuos" || fallo "quedaron ${resto} filas"

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · concurrencia real: serializacion, ausencia de deadlock y ningun sobrepago"
  exit 0
fi
echo "FALLOS DE CONCURRENCIA: ${fallos}"
exit 1
