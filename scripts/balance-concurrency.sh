#!/usr/bin/env bash
#
# Concurrencia real de la dimension SALDO · F6.C.
#
# No puede ser un fichero de `supabase/checks/`: una sola sesion de `psql` no
# tiene concurrencia, y una simulacion secuencial pasaria tambien con el lock
# quitado. Abre SESIONES SIMULTANEAS de verdad, igual que
# `scripts/writer-debt-concurrency.sh`.
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   ./scripts/balance-concurrency.sh
#
# Escribe filas CONFIRMADAS —un lock de fila solo existe entre transacciones
# distintas— y las retira al terminar. NO ES UNA MIGRACION.
#
# Es la contraparte permanente de `supabase/e22/`, que midio las dos carreras
# ANTES de corregirlas. Lo que alli fallaba, aqui debe estar cerrado:
#
#   1 · Dos ajustes por OBJETIVO simultaneos dejan el saldo EN EL OBJETIVO. Sin
#       el lock, ambos leen el mismo saldo y ambos restan: el resultado no
#       corresponde a ningun orden serial.
#   2 · Dos gastos simultaneos observan CADA UNO el saldo real tras su propia
#       escritura. Sin el lock, al menos uno observa un saldo que deja de ser
#       cierto en cuanto el otro confirma.
#   3 · Un objetivo y un gasto simultaneos terminan en un resultado SERIAL: o el
#       objetivo y luego el gasto, o el gasto y luego el objetivo. Nunca una
#       mezcla.
#   4 · La misma carrera repetida es determinista en su forma.

set -uo pipefail

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }
trim()  { tr -d '[:space:]'; }

EUR=bbbb0000-0000-4000-8000-00000000b601
U1=b6010000-0000-4000-8000-000000000001
S1=b6010000-0000-4000-8000-0000000000a1
GOTR=4ed30a44-9f82-578f-828c-b491a25ebdd9

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
delete from core.balance_observation where scope_id = '${S1}';
delete from core.adjustment_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by = '${U1}';
delete from core.expense_category x using core.operation_version ov
  where ov.id = x.operation_version_id and ov.created_by = '${U1}';
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

# Deja el saldo donde queramos, por la via del delta.
partir_de() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_adjustment(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',2,
  'effective_date','2026-10-01','effective_time','08:00',
  'scope_id','${S1}','delta','${2}','currency_definition_id','${EUR}'));
commit;
SQL
}

# Ajuste por OBJETIVO. La espera esta ANTES de llamar, para que las dos sesiones
# entren en la funcion a la vez y compitan por el lock de verdad.
objetivo() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
select pg_sleep(0.3);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_adjustment(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',2,
  'effective_date','2026-10-02','effective_time','09:00',
  'scope_id','${S1}','target_balance','${2}','currency_definition_id','${EUR}'));
commit;
SQL
}

gasto() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
select pg_sleep(0.3);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.record_personal_expense(jsonb_build_object(
  'client_operation_id','${1}','command_contract_version',2,
  'effective_date','2026-10-03','effective_time','10:00',
  'scope_id','${S1}','amount','${2}','currency_definition_id','${EUR}',
  'concept','Concurrente','category_id','${GOTR}'));
commit;
SQL
}

echo "== concurrencia real de la dimension saldo · F6.C =="
retirar; sembrar

# ================================================================= 1 ========
echo ""
echo "== 1 · dos ajustes por OBJETIVO simultaneos =="
partir_de 'b6010000-0000-4000-8000-000000000101' '12000'
echo "  saldo de partida: $(saldo | trim)   ambas piden objetivo 10000"
objetivo 'b6010000-0000-4000-8000-000000000111' '10000' & p1=$!
objetivo 'b6010000-0000-4000-8000-000000000112' '10000' & p2=$!
wait "${p1}"; wait "${p2}"
r=$(saldo | trim)
[ "${r}" = "10000" ] \
  && ok "saldo final ${r}: el objetivo, no la suma de dos deltas" \
  || fallo "saldo final ${r} y deberia ser 10000 (sin lock salen 8000)"

# El segundo ajuste deriva delta CERO, que es lo correcto y se conserva:
# ADR-013 §8 no prohibe los importes cero.
n=$("${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.current_effect e
  join core.operation o on o.current_version_id = e.operation_version_id
 where e.scope_id = '${S1}' and o.operation_class = 'adjustment' and e.balance_amount = 0;
SQL
)
[ "$(trim <<<"${n}")" = "1" ] \
  && ok "el segundo ajuste derivo delta CERO: leyo el saldo ya ajustado" \
  || fallo "se esperaba exactamente un ajuste de delta cero y hay $(trim <<<"${n}")"

# ================================================================= 2 ========
echo ""
echo "== 2 · dos gastos simultaneos y sus observaciones =="
retirar; sembrar
partir_de 'b6010000-0000-4000-8000-000000000201' '12000'
gasto 'b6010000-0000-4000-8000-000000000211' '2000' & p1=$!
gasto 'b6010000-0000-4000-8000-000000000212' '2000' & p2=$!
wait "${p1}"; wait "${p2}"
r=$(saldo | trim)
echo "  saldo real final: ${r}"

# Las dos observaciones deben formar una CADENA sin huecos: ordenadas, el
# `after` de una es el `before` de la siguiente, y la ultima coincide con el
# saldo real. Es lo que una serializacion correcta garantiza y lo que E22 vio
# romperse.
cadena=$("${DBQ[@]}" <<SQL 2>/dev/null
with o as (
  select bo.balance_before, bo.balance_after,
         row_number() over (order by bo.balance_after desc) as n
    from core.balance_observation bo
    join core.operation_version ov on ov.id = bo.operation_version_id
    join core.operation op on op.current_version_id = ov.id
   where bo.scope_id = '${S1}' and op.operation_class = 'personal_expense')
select case
  when (select count(*) from o) <> 2 then 'observaciones=' || (select count(*) from o)
  when (select balance_before from o where n = 1) <> 12000 then 'primera no parte de 12000'
  when (select balance_after  from o where n = 1) <> (select balance_before from o where n = 2) then 'hueco entre las dos'
  when (select balance_after  from o where n = 2) <> ${r} then 'la ultima no coincide con el saldo real'
  else 'ok' end;
SQL
)
[ "$(trim <<<"${cadena}")" = "ok" ] \
  && ok "las dos observaciones encadenan 12000 -> 10000 -> 8000, sin huecos" \
  || fallo "la cadena de observaciones esta rota: $(trim <<<"${cadena}")"

# ================================================================= 3 ========
echo ""
echo "== 3 · un objetivo y un gasto simultaneos =="
retirar; sembrar
partir_de 'b6010000-0000-4000-8000-000000000301' '12000'
objetivo 'b6010000-0000-4000-8000-000000000311' '10000' & p1=$!
gasto    'b6010000-0000-4000-8000-000000000312' '2000'  & p2=$!
wait "${p1}"; wait "${p2}"
r=$(saldo | trim)
# Dos ordenes seriales posibles, y solo dos:
#   objetivo -> gasto : 12000 -> 10000 -> 8000
#   gasto -> objetivo : 12000 -> 10000 -> 10000
case "${r}" in
  8000|10000) ok "saldo final ${r}: corresponde a un orden serial" ;;
  *)          fallo "saldo final ${r}: no corresponde a ningun orden serial" ;;
esac

# ================================================================= 4 ========
echo ""
echo "== 4 · la misma carrera cinco veces =="
malas=0
for i in 1 2 3 4 5; do
  retirar; sembrar
  partir_de "b6010000-0000-4000-8000-00000000040${i}" '12000'
  objetivo "b6010000-0000-4000-8000-00000000041${i}" '10000' & p1=$!
  objetivo "b6010000-0000-4000-8000-00000000042${i}" '10000' & p2=$!
  wait "${p1}"; wait "${p2}"
  r=$(saldo | trim)
  [ "${r}" = "10000" ] || { malas=$((malas + 1)); echo "   intento ${i}: saldo ${r}"; }
done
[ "${malas}" -eq 0 ] \
  && ok "cinco carreras, siempre el objetivo" \
  || fallo "${malas} carreras de cinco terminaron mal"

# ============================================================================
echo ""
echo "== retirada =="
retirar
resto=$("${DBQ[@]}" <<SQL 2>/dev/null
select (select count(*) from core.scope where id = '${S1}')
     + (select count(*) from core.effect where scope_id = '${S1}')
     + (select count(*) from core.balance_observation where scope_id = '${S1}');
SQL
)
[ "$(trim <<<"${resto}")" = "0" ] && ok "sin residuos" || fallo "quedaron filas"

cat=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select count(*) from core.currency_definition;
SQL
)
[ "$(trim <<<"${cat}")" = "20" ] \
  && ok "el catalogo monetario sigue con sus 20 definiciones" \
  || fallo "el catalogo quedo con $(trim <<<"${cat}")"

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · el saldo se serializa: el objetivo se alcanza y las observaciones no mienten"
  exit 0
fi
echo "FALLOS DE CONCURRENCIA: ${fallos}"
exit 1
