#!/usr/bin/env bash
#
# Que `http-boundary-check.sh` no toque una sola fila ajena.
#
# **Por que existe.** Aquel check limpiaba con doce borrados de tabla entera. En
# CI no se notaba —la base se levanta desde cero y el check es su unico
# habitante—, pero sobre una base con datos habria arrasado el ledger completo.
# Es el mismo defecto que tenia `writer-debt-concurrency.sh`, encontrado en la
# auditoria que aquel provoco.
#
# Comprueba COMPORTAMIENTO, no texto: buscar `delete from core.x;` en el fuente
# no habria bastado, porque la proxima forma de arrasar la base no tiene por que
# parecerse a esa cadena.
#
# Siembra un centinela que no pertenece al fixture, ejecuta el check HTTP
# entero, y exige dos cosas:
#
#   1. el centinela sigue EXACTAMENTE igual — mismas filas y mismos importes;
#   2. el fixture HTTP no deja residuos, ni de datos ni de usuarios.
#
# Uso, con el stack levantado y GoTrue arrancado:
#
#   ./scripts/http-boundary-isolation.sh
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

# EL CENTINELA. Identificadores propios, y un correo que NO casa con el patron
# `nomey-http-%` del check vigilado: si casara, borrarlo seria legitimo y esta
# prueba no probaria nada.
# LA MONEDA ES UNA SEMBRADA POR MIGRACION, no una propia, y es deliberado: el
# check vigilado comprueba que el catalogo conserva sus VEINTE definiciones
# —una guarda legitima, y de las buenas: protege justo contra arrasar lo que
# siembra una migracion—. Un centinela con moneda propia la haria veintiuna y
# rompiria esa asercion sin que nada estuviera mal.
CEUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
CU=deadbeef-0000-4000-8000-00000000c002
CS=deadbeef-0000-4000-8000-00000000c0a2
GOTR=4ed30a44-9f82-578f-828c-b491a25ebdd9

sembrar_centinela() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
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
  'client_operation_id','deadbeef-0000-4000-8000-00000000e10${n}',
  'command_contract_version',2,
  'effective_date','2026-07-1${n}','effective_time','1${n}:30',
  'scope_id','${CS}','amount','${n}700','currency_definition_id','${CEUR}',
  'concept','Centinela HTTP ${n}','category_id','${GOTR}'));
commit;
SQL
  done
}

# LA HUELLA: sus filas y sus importes, no un recuento. Un recuento igual podria
# esconder que se borro una fila y se creo otra.
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
  select 'obs:' || b.operation_version_id || ':' || b.balance_after
    from core.balance_observation b where b.scope_id = '${CS}'
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
-- La moneda NO se borra: es del catalogo sembrado, no del centinela.
commit;
SQL
}

echo "== aislamiento de http-boundary-check.sh =="

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
echo "== se ejecuta la frontera HTTP entera =="
# Se captura su salida en vez de enmudecerla: si falla CON el centinela
# presente y pasa sin el, lo que hay que ver es exactamente que asercion cae.
salida=$("${RAIZ}/scripts/http-boundary-check.sh" 2>&1)
if [ $? -eq 0 ]; then
  ok "la frontera HTTP paso"
else
  fallo "la frontera HTTP fallo"
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
echo "== residuos del fixture HTTP =="
resto=$("${DBQ[@]}" <<'SQL' 2>/dev/null
with mios as (
  select id from core.scope
   where id in ('a0000000-0000-4000-8000-00000000aa01',
                'a0000000-0000-4000-8000-00000000bb01',
                'a0000000-0000-4000-8000-00000000ff01',
                'a0000000-0000-4000-8000-00000000ff02')
      or owner_user_id in (select id from auth.users where email like 'nomey-http-%')
)
select (select count(*) from mios)
     + (select count(*) from core.effect where scope_id in (select id from mios))
     + (select count(*) from core.participant where scope_id in (select id from mios))
     + (select count(*) from core.client_command
         where created_by in (select id from auth.users where email like 'nomey-http-%'))
     + (select count(*) from auth.users where email like 'nomey-http-%')
     + (select count(*) from core.currency_definition
         where id in ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
SQL
)
resto=$(trim <<<"${resto}")
[ "${resto}" = "0" ] && ok "el fixture HTTP no dejo residuos" || fallo "quedaron ${resto} filas del fixture"

retirar_centinela

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · la frontera HTTP no toca ninguna fila ajena"
  exit 0
fi
echo "FALLOS: ${fallos}"
exit 1
