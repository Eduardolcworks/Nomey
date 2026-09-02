#!/usr/bin/env bash
#
# Que `writer-debt-concurrency.sh` no toque una sola fila ajena.
#
# **Por que existe.** Aquel script limpiaba con borrados de tabla entera. En CI
# no se notaba —la base se levanta desde cero y el script es su unico
# habitante—, pero sobre una base con datos borro treinta y siete operaciones
# reales. Buscar `delete from core.x;` en el fuente no habria bastado: la
# proxima forma de arrasar la base no tiene por que parecerse a esa cadena.
#
# Asi que esto comprueba COMPORTAMIENTO. Siembra un centinela que no pertenece
# al fixture, ejecuta la prueba de concurrencia entera y exige dos cosas:
#
#   1. el centinela sigue EXACTAMENTE igual — mismas filas y mismos importes;
#   2. el fixture no deja residuos, que es lo que aquel script ya prometia.
#
# Uso, con el stack levantado:
#
#   ./scripts/writer-debt-isolation.sh
#
# NO ES UNA MIGRACION. Siembra y retira lo suyo, acotado a sus identificadores.

set -uo pipefail

# shellcheck source=scripts/local-db-guard.sh
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }
trim()  { tr -d '[:space:]'; }

# EL CENTINELA. Identificadores propios, distintos de los del fixture que se
# esta vigilando: si alguno coincidiera, su borrado seria legitimo y la prueba
# no probaria nada.
CEUR=deadbeef-0000-4000-8000-00000000e001
CU=deadbeef-0000-4000-8000-00000000c001
CS=deadbeef-0000-4000-8000-00000000c0a1
GOTR=4ed30a44-9f82-578f-828c-b491a25ebdd9

sembrar_centinela() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${CEUR}','EUR',2)
  on conflict do nothing;
insert into core.scope (id,kind,base_currency_definition_id,owner_user_id)
  values ('${CS}','personal','${CEUR}','${CU}');
insert into core.membership (scope_id, user_id) values ('${CS}','${CU}');
commit;
SQL

  local n
  for n in 1 2 3; do
    "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${CU}"}', true);
select api.record_personal_expense(jsonb_build_object(
  'client_operation_id','deadbeef-0000-4000-8000-00000000d00${n}',
  'command_contract_version',2,
  'effective_date','2026-07-0${n}','effective_time','1${n}:00',
  'scope_id','${CS}','amount','${n}500','currency_definition_id','${CEUR}',
  'concept','Centinela ${n}','category_id','${GOTR}'));
commit;
SQL
  done
}

# LA HUELLA DEL CENTINELA: no un recuento, sino sus filas y sus importes. Un
# recuento igual podria esconder que se borro una y se creo otra.
huella_centinela() {
  "${DBQ[@]}" <<SQL 2>/dev/null
select coalesce(string_agg(t, '|' order by t), 'VACIO') from (
  select 'op:'  || o.id || ':' || o.operation_class || ':' || o.current_version_id as t
    from core.operation o where o.created_by = '${CU}'
  union all
  select 'ver:' || v.id || ':' || v.version_no || ':' || v.original_amount
    from core.operation_version v where v.created_by = '${CU}'
  union all
  select 'ef:'  || e.id || ':' || coalesce(e.balance_amount::text,'-')
                              || ':' || coalesce(e.economic_amount::text,'-')
    from core.effect e where e.scope_id = '${CS}'
  union all
  select 'cmd:' || c.client_operation_id || ':' || c.command_type
    from core.client_command c where c.created_by = '${CU}'
  union all
  select 'amb:' || s.id || ':' || s.kind from core.scope s where s.id = '${CS}'
  union all
  select 'mem:' || m.scope_id from core.membership m where m.scope_id = '${CS}'
) x;
SQL
}

retirar_centinela() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.client_command where created_by = '${CU}';
delete from core.balance_observation where scope_id = '${CS}';
delete from core.expense_category x using core.operation_version ov
  where ov.id = x.operation_version_id and ov.created_by = '${CU}';
delete from core.movement_detail d using core.operation_version ov
  where ov.id = d.operation_version_id and ov.created_by = '${CU}';
delete from core.effect where scope_id = '${CS}';
delete from core.operation_version where created_by = '${CU}';
delete from core.operation where created_by = '${CU}';
delete from core.membership where scope_id = '${CS}';
delete from core.scope where id = '${CS}';
delete from core.currency_definition where id = '${CEUR}';
commit;
SQL
}

echo "== aislamiento de writer-debt-concurrency.sh =="

retirar_centinela
sembrar_centinela

antes=$(huella_centinela | trim)
if [ -z "${antes}" ] || [ "${antes}" = "VACIO" ]; then
  echo "  FALLO: el centinela no llego a sembrarse; la prueba no probaria nada"
  retirar_centinela
  exit 1
fi
ok "centinela sembrado: $(tr -cd '|' <<<"${antes}" | wc -c) filas vigiladas"

echo ""
echo "== se ejecuta la prueba de concurrencia entera =="
# Se captura su salida en vez de enmudecerla: si falla CON el centinela
# presente y pasa sin el, lo que hay que ver es exactamente que asercion cae.
salida=$("${RAIZ}/scripts/writer-debt-concurrency.sh" 2>&1)
if [ $? -eq 0 ]; then
  ok "la prueba de concurrencia paso"
else
  fallo "la prueba de concurrencia fallo"
  grep -E 'FALLO|ERROR' <<<"${salida}" | head -8 | sed 's/^/        /'
fi

echo ""
echo "== el centinela, despues =="
despues=$(huella_centinela | trim)

if [ "${antes}" = "${despues}" ]; then
  ok "intacto: mismas filas y mismos importes"
else
  fallo "el centinela CAMBIO"
  echo "        antes:   ${antes}"
  echo "        despues: ${despues}"
fi

echo ""
echo "== residuos del fixture =="
resto=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select (select count(*) from core.operation
         where created_by in ('11111111-1111-4111-8111-111111111111',
                              '22222222-2222-4222-8222-222222222222'))
     + (select count(*) from core.scope
         where id in ('a0000000-0000-4000-8000-0000000000a1',
                      'a0000000-0000-4000-8000-0000000000b1',
                      'a0000000-0000-4000-8000-0000000000f1',
                      'a0000000-0000-4000-8000-0000000000f2',
                      'a0000000-0000-4000-8000-0000000000f3'))
     + (select count(*) from core.participant
         where id in ('b0000000-0000-4000-8000-0000000000a1',
                      'b0000000-0000-4000-8000-0000000000b1',
                      'b0000000-0000-4000-8000-0000000000a2',
                      'b0000000-0000-4000-8000-0000000000b2',
                      'b0000000-0000-4000-8000-0000000000a3',
                      'b0000000-0000-4000-8000-0000000000b3'));
SQL
)
resto=$(trim <<<"${resto}")
[ "${resto}" = "0" ] && ok "el fixture no dejo residuos" || fallo "quedaron ${resto} filas del fixture"

retirar_centinela

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la prueba de concurrencia no toca ninguna fila ajena"
  exit 0
fi
echo "FALLOS: ${fallos}"
exit 1
