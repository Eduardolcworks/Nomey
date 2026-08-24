#!/usr/bin/env bash
# E15-C · Dos liquidaciones de 2000 sobre una deuda pendiente de 3000, a la vez.
#
# Correcto: una ACEPTADA y otra RECHAZADA, pendiente final 1000.
# Incorrecto: las dos ACEPTADAS, pendiente final -1000 (sobrepago silencioso).
#
# NO ES UNA MIGRACION.
set -u
DB="docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0"

reset_deuda() {
  cat <<'EOF' | $DB >/dev/null 2>&1
truncate public.e15_debt_effect;
insert into public.e15_debt_effect(scope_id, debtor, creditor, delta)
values ('33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555', 3000);
EOF
}

probar() {
  local modo="$1"
  reset_deuda
  echo ""
  echo "===== modo: $modo ====="
  ( echo "begin; select public.e15_settle('$modo', 2000); commit;" | $DB 2>&1 | grep -v '^$' | sed 's/^/    [1] /' ) &
  ( echo "begin; select public.e15_settle('$modo', 2000); commit;" | $DB 2>&1 | grep -v '^$' | sed 's/^/    [2] /' ) &
  wait
  local pend
  pend=$(echo "select coalesce(sum(delta),0) from public.e15_debt_effect;" | $DB)
  echo "    pendiente final: $pend   $( [ "$pend" -lt 0 ] && echo '<-- SOBREPAGO' || echo '<-- correcto' )"
}

probar ninguno
probar fila
probar advisory
