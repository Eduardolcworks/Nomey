#!/usr/bin/env bash
#
# E22 · Las dos carreras del saldo, reproducidas ANTES de corregirlas.
#
# ESTO ES EVIDENCIA, NO NORMA, Y NO ES UNA MIGRACION.
#
# No puede ser un fichero de `supabase/checks/`: una sola sesion de `psql` no
# tiene concurrencia, y una simulacion secuencial pasaria tambien sin ningun
# lock. Abre SESIONES SIMULTANEAS de verdad, igual que E15-C y que
# `scripts/writer-debt-concurrency.sh`.
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   ./supabase/e22/balance-races.sh
#
# Escribe filas confirmadas y las retira al terminar.
#
# ============================ LAS DOS PREGUNTAS ============================
#
# R1 · AJUSTE POR OBJETIVO CALCULADO EN EL CLIENTE.
#      Hoy `api.record_adjustment` solo acepta `delta`, asi que un cliente que
#      quisiera «que mi saldo sea X» tendria que leer el saldo y restar. Dos
#      clientes haciendolo a la vez, ¿que saldo dejan?
#
#      Lo que hace peligrosa a esta carrera es que **no tiene equivalente
#      serial**: ningun orden de ejecucion de los dos comandos produce el
#      resultado observado. No es «una de las dos gana», es que las dos pierden.
#
# R2 · OBSERVACION DEL SALDO RESULTANTE.
#      F6.C quiere persistir `Saldo tras el movimiento`. Dos gastos simultaneos
#      que observen su propio resultado, ¿observan la verdad?
#
#      En READ COMMITTED ninguna transaccion ve los efectos no confirmados de la
#      otra, asi que las dos pueden observar el mismo «despues» y equivocarse
#      las dos a la vez.
#
# Ninguna de las dos la cubre la idempotencia, y conviene entender por que: son
# comandos DISTINTOS, con claves distintas e intenciones distintas. La
# idempotencia los acepta a los dos, y hace bien.

set -uo pipefail

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  NO REPRODUCIDO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  reproducido: $*"; }
trim()  { tr -d '[:space:]'; }

EUR=eeee0000-0000-4000-8000-00000000e221
U1=e2210000-0000-4000-8000-000000000001
S1=e2210000-0000-4000-8000-0000000000a1
GOTR=4ed30a44-9f82-578f-828c-b491a25ebdd9   # `Otros` de gasto, sembrada por migracion

sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${EUR}','EUR',2)
  on conflict do nothing;
insert into core.scope (id,kind,base_currency_definition_id,owner_user_id)
  values ('${S1}','personal','${EUR}','${U1}');
insert into core.membership (scope_id, user_id) values ('${S1}','${U1}');
commit;
SQL
}

retirar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by = '${U1}';
delete from core.movement_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by = '${U1}';
delete from core.effect where scope_id = '${S1}';
delete from core.operation_version where created_by = '${U1}';
delete from core.operation where created_by = '${U1}';
delete from core.membership where scope_id = '${S1}';
delete from core.scope where id = '${S1}';
delete from core.currency_definition where id = '${EUR}';
commit;
SQL
}

saldo() {
  "${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(sum(e.balance_amount), 0) from core.current_effect e
 where e.scope_id = '${S1}' and e.balance_amount is not null;
SQL
}

# Un gasto ordinario, para dejar saldo de partida.
gasto() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_personal_expense(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',2,
  'effective_date','2026-09-01','effective_time','09:00',
  'scope_id','${S1}','amount','${2}','currency_definition_id','${EUR}',
  'concept','Semilla','category_id','${GOTR}'));
commit;
SQL
}

# Ajuste con delta positivo, para dejar el saldo donde queramos.
poner_saldo() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_adjustment(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',1,
  'effective_date','2026-09-01',
  'scope_id','${S1}','delta','${2}','currency_definition_id','${EUR}'));
commit;
SQL
}

echo "== E22 · las dos carreras del saldo, sobre el codigo ANTERIOR a F6.C =="
retirar; sembrar

# ============================================================== R1 ==========
echo ""
echo "== R1 · dos ajustes por objetivo calculados en el cliente =="
poner_saldo 'e2210000-0000-4000-8000-000000000101' '12000'
echo "  saldo de partida: $(saldo | trim)  (120,00)"
echo "  las dos sesiones piden: objetivo 10000 (100,00)"

# Cada sesion: LEE el saldo, espera, y escribe el delta que ella calculo. La
# espera dentro de la transaccion es lo que garantiza el entrelazado; sin ella
# el resultado dependeria del planificador y la carrera podria no darse.
objetivo_cliente() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
-- La LECTURA ocurre antes de la espera, y se guarda en una variable de psql:
-- es lo que representa a un cliente que consulto su saldo y luego envio el
-- delta que el mismo calculo. Se lee como \`postgres\` a proposito, para que el
-- experimento mida la carrera y no un problema de privilegios.
select coalesce(sum(e.balance_amount), 0) as leido from core.current_effect e
 where e.scope_id = '${S1}' and e.balance_amount is not null
\\gset
select pg_sleep(1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_adjustment(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',1,
  'effective_date','2026-09-02',
  'scope_id','${S1}',
  'delta', (10000 - :leido)::text,
  'currency_definition_id','${EUR}'));
commit;
SQL
}

objetivo_cliente 'e2210000-0000-4000-8000-000000000111' & p1=$!
objetivo_cliente 'e2210000-0000-4000-8000-000000000112' & p2=$!
wait "${p1}"; wait "${p2}"

r1=$(saldo | trim)
echo "  saldo final: ${r1}"
if [ "${r1}" = "10000" ]; then
  fallo "R1: el saldo quedo en el objetivo; la carrera no se dio"
else
  ok "R1: saldo ${r1} en vez de 10000 — y NINGUN orden serial lo produce"
  echo "     serial A→B: 120,00 → 100,00 → 100,00"
  echo "     serial B→A: 120,00 → 100,00 → 100,00"
  echo "     concurrente: ambas leyeron 120,00 y ambas restaron 20,00"
fi

# ============================================================== R2 ==========
echo ""
echo "== R2 · dos gastos simultaneos observando su propio resultado =="
retirar; sembrar
poner_saldo 'e2210000-0000-4000-8000-000000000201' '12000'
echo "  saldo de partida: $(saldo | trim)  (120,00)"
echo "  las dos sesiones gastan 20,00 y observan el saldo resultante"

# Escribe, espera, y LEE su propio resultado antes de confirmar. Es exactamente
# la forma que tendria una observacion `balance_after` sin lock.
gasto_observando() {
  "${DBQ[@]}" <<SQL 2>/dev/null | grep -o 'OBSERVA=-\?[0-9]*' | head -1 | cut -d= -f2
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_personal_expense(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',2,
  'effective_date','2026-09-03','effective_time','10:00',
  'scope_id','${S1}','amount','2000','currency_definition_id','${EUR}',
  'concept','Concurrente','category_id','${GOTR}'));
-- Escribe, ESPERA, y solo despues lee su propio resultado. Es exactamente la
-- forma que tendria un \`balance_after\` sin lock.
select pg_sleep(1);
reset role;
select 'OBSERVA=' || coalesce(sum(e.balance_amount), 0) from core.current_effect e
 where e.scope_id = '${S1}' and e.balance_amount is not null;
commit;
SQL
}

o1=$(mktemp); o2=$(mktemp)
gasto_observando 'e2210000-0000-4000-8000-000000000211' >"${o1}" 2>&1 & p1=$!
gasto_observando 'e2210000-0000-4000-8000-000000000212' >"${o2}" 2>&1 & p2=$!
wait "${p1}"; wait "${p2}"
obs1=$(trim <"${o1}"); obs2=$(trim <"${o2}")
rm -f "${o1}" "${o2}"

r2=$(saldo | trim)
echo "  observo la sesion 1: ${obs1}"
echo "  observo la sesion 2: ${obs2}"
echo "  saldo real final:    ${r2}"
if [ "${obs1}" = "${r2}" ] && [ "${obs2}" = "${r2}" ]; then
  fallo "R2: las dos observaciones coinciden con el saldo real; la carrera no se dio"
else
  ok "R2: al menos una observacion es FALSA — vieron ${obs1} y ${obs2}, y el saldo es ${r2}"
  echo "     en READ COMMITTED ninguna ve el efecto no confirmado de la otra, asi que"
  echo "     la que termina primero observa un saldo que deja de ser cierto al confirmar"
  echo "     la segunda. Cual de las dos se equivoca depende del planificador: por eso"
  echo "     la asercion es «al menos una», y no un valor concreto."
fi

echo ""
echo "== retirada =="
retirar
resto=$("${DBQ[@]}" <<SQL 2>/dev/null
select (select count(*) from core.scope where id = '${S1}')
     + (select count(*) from core.effect where scope_id = '${S1}');
SQL
)
[ "$(trim <<<"${resto}")" = "0" ] && echo "  sin residuos" || echo "  FALLO: quedaron filas"

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · las dos carreras quedan REPRODUCIDAS sobre el codigo anterior a F6.C"
  exit 0
fi
echo "NO SE REPRODUJERON ${fallos} carreras: revisa el entorno antes de seguir"
exit 1
