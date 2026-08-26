#!/usr/bin/env bash
#
# Emite el SQL que mete los vectores compartidos en una tabla temporal, para
# que un check pueda comprobarlos contra la implementacion de PostgreSQL.
#
# ADR-002 §7 obliga a que la frontera autoritativa reproduzca EXACTAMENTE los
# vectores de `tests/vectors/`, y ADR-009 §1 asume que el calculo se escribe por
# segunda vez y que **la paridad se garantiza con los vectores, no compartiendo
# codigo**. Este script es lo que hace que esa comprobacion sea posible sin
# duplicar las expectativas dentro del check.
#
# Uso, encadenado antes del check:
#   { ./scripts/vectors-prelude.sh ; cat supabase/checks/<check>.sql ; } \
#     | docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
#         -X -q -v ON_ERROR_STOP=1
#
# `psql` corre DENTRO del contenedor y no ve el checkout, asi que los ficheros
# no pueden leerse con `\copy`: viajan por la misma entrada estandar. No anade
# ninguna dependencia.

set -euo pipefail

cd "$(dirname "$0")/.."

echo 'create temporary table vector_doc (name text primary key, doc jsonb);'

for name in scenarios split conversion rounding; do
  printf "insert into vector_doc values ('%s', \$VEC\$" "$name"
  cat "tests/vectors/${name}.json"
  printf '$VEC$::jsonb);\n'
done
