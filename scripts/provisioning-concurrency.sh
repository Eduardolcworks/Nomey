#!/usr/bin/env bash
#
# Concurrencia real del provisioning del Modo Personal · F6.A.
#
# No puede ser un fichero de `supabase/checks/`: una sola sesion de `psql` no
# tiene concurrencia, y una simulacion secuencial pasaria tambien sin el indice
# unico y sin el manejo de `unique_violation`. Esto abre SESIONES SIMULTANEAS de
# verdad, igual que `writer-debt-concurrency.sh`.
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   ./scripts/provisioning-concurrency.sh
#
# Escribe filas CONFIRMADAS —una carrera solo existe entre transacciones
# distintas— y las retira al final, comprobando que no queda ninguna. Sale con
# codigo distinto de cero si alguna asercion falla, para que CI lo detecte.
#
# NO ES UNA MIGRACION y no crea ningun objeto de esquema.
#
# Lo que comprueba, y por que cada cosa importa:
#
#   1 · Dos `ensure_personal_scope` simultaneos del MISMO actor producen UN
#       ambito. Lo garantiza el indice unico `scope_un_personal_por_usuario` mas
#       el unico `exception when unique_violation` de la funcion.
#   2 · Y ese ambito tiene SU MEMBRESIA. Es el fallo peor de esta carrera: un
#       ambito sin membresia deja al dueno sin ver sus propios efectos
#       (invariante 11), y no lanza nada.
#   3 · Dos `set_personal_base_currency` simultaneos con destinos distintos
#       dejan la moneda en UNO de los dos, nunca en un estado mezclado.
#   4 · La carrera repetida es determinista en su forma: siempre un ambito.

set -uo pipefail

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

# Actores de prueba. No colisionan con los de `writer-debt-concurrency.sh`.
U1=c1111111-1111-4111-8111-111111111111
U2=c2222222-2222-4222-8222-222222222222

# --------------------------------------------------------------- utilidades --
# Ejecuta una llamada en su propia transaccion, como `authenticated` y con el
# actor indicado. Imprime lo que devuelva PostgreSQL, error incluido.
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

contar() {
  "${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.scope where owner_user_id = '${1}';
SQL
}

contar_membresias() {
  "${DBQ[@]}" <<SQL 2>/dev/null
select count(*) from core.membership m
  join core.scope s on s.id = m.scope_id
 where s.owner_user_id = '${1}' and m.user_id = '${1}';
SQL
}

moneda() {
  "${DBQ[@]}" <<SQL 2>/dev/null
select c.code from core.scope s
  join core.currency_definition c on c.id = s.base_currency_definition_id
 where s.owner_user_id = '${1}';
SQL
}

retirar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
delete from core.membership where scope_id in
  (select id from core.scope where owner_user_id in ('${U1}','${U2}'));
delete from core.scope where owner_user_id in ('${U1}','${U2}');
commit;
SQL
}

limpiar() { retirar; }

trim() { tr -d '[:space:]'; }

echo "== provisioning concurrente · Fase 6.A =="
limpiar

# ============================================================== 1 y 2 ========
echo ""
echo "== dos ensure_personal_scope simultaneos del mismo actor =="
s1=$(mktemp); s2=$(mktemp)
llamar "${U1}" ensure_personal_scope '{"currency_code":"EUR"}' >"${s1}" 2>&1 &
p1=$!
llamar "${U1}" ensure_personal_scope '{"currency_code":"USD"}' >"${s2}" 2>&1 &
p2=$!
wait "${p1}"; wait "${p2}"

# Ninguna de las dos debe ERRORAR: la perdedora hace replay del estado, no falla.
erroneas=0
for f in "${s1}" "${s2}"; do
  grep -qiE 'error|ERROR' "${f}" && { erroneas=$((erroneas + 1)); echo "   salida: $(tr -d '\n' < "${f}")"; }
done
[ "${erroneas}" -eq 0 ] && ok "ninguna de las dos llamadas erroro" \
                        || fallo "${erroneas} llamadas erroraron; la perdedora debe releer, no fallar"
rm -f "${s1}" "${s2}"

n=$(contar "${U1}" | trim)
[ "${n}" = "1" ] && ok "un unico ambito personal" || fallo "el actor tiene ${n} ambitos personales"

m=$(contar_membresias "${U1}" | trim)
[ "${m}" = "1" ] && ok "y su membresia, que es lo que la RLS exige" \
                 || fallo "membresias del dueno: ${m}; sin ella no ve ni sus propios efectos"

# ================================================================= 3 =========
echo ""
echo "== dos set_personal_base_currency simultaneos con destinos distintos =="
JPY=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select id from core.currency_definition where code = 'JPY';
SQL
)
GBP=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select id from core.currency_definition where code = 'GBP';
SQL
)
JPY=$(trim <<<"${JPY}"); GBP=$(trim <<<"${GBP}")

s1=$(mktemp); s2=$(mktemp)
llamar "${U1}" set_personal_base_currency "{\"currency_definition_id\":\"${JPY}\"}" >"${s1}" 2>&1 &
p1=$!
llamar "${U1}" set_personal_base_currency "{\"currency_definition_id\":\"${GBP}\"}" >"${s2}" 2>&1 &
p2=$!
wait "${p1}"; wait "${p2}"
rm -f "${s1}" "${s2}"

code=$(moneda "${U1}" | trim)
case "${code}" in
  JPY|GBP) ok "la moneda quedo en ${code}: uno de los dos destinos, sin mezcla" ;;
  *)       fallo "la moneda quedo en '${code}', que no es ninguno de los dos destinos" ;;
esac

n=$(contar "${U1}" | trim)
[ "${n}" = "1" ] && ok "y sigue habiendo un unico ambito" || fallo "quedaron ${n} ambitos"

# ================================================================= 4 =========
echo ""
echo "== la misma carrera cinco veces =="
malas=0
for intento in 1 2 3 4 5; do
  limpiar
  s1=$(mktemp); s2=$(mktemp)
  llamar "${U2}" ensure_personal_scope '{"currency_code":"EUR"}' >"${s1}" 2>&1 &
  p1=$!
  llamar "${U2}" ensure_personal_scope '{"currency_code":"EUR"}' >"${s2}" 2>&1 &
  p2=$!
  wait "${p1}"; wait "${p2}"
  rm -f "${s1}" "${s2}"
  n=$(contar "${U2}" | trim); m=$(contar_membresias "${U2}" | trim)
  if [ "${n}" != "1" ] || [ "${m}" != "1" ]; then
    malas=$((malas + 1)); echo "   intento ${intento}: ambitos=${n} membresias=${m}"
  fi
done
[ "${malas}" -eq 0 ] && ok "cinco carreras, siempre un ambito con su membresia" \
                     || fallo "${malas} carreras de cinco terminaron mal"

# ============================================================================
echo ""
echo "== retirada =="
retirar
resto=$("${DBQ[@]}" <<SQL 2>/dev/null
select (select count(*) from core.scope where owner_user_id in ('${U1}','${U2}'))
     + (select count(*) from core.membership where user_id in ('${U1}','${U2}'));
SQL
)
resto=$(trim <<<"${resto}")
[ "${resto}" = "0" ] && ok "sin residuos" || fallo "quedaron ${resto} filas"

# El catalogo monetario NO es residuo: lo siembra una migracion y debe seguir
# entero despues de este script.
cat=$("${DBQ[@]}" <<'SQL' 2>/dev/null
select count(*) from core.currency_definition;
SQL
)
cat=$(trim <<<"${cat}")
[ "${cat}" = "20" ] && ok "el catalogo monetario sigue con sus 20 definiciones" \
                    || fallo "el catalogo quedo con ${cat} definiciones; algo lo borro"

echo ""
if [ "${fallos}" -eq 0 ]; then
  echo "OK · provisioning concurrente: un ambito, su membresia y ninguna mezcla de moneda"
  exit 0
fi
echo "FALLOS DE CONCURRENCIA: ${fallos}"
exit 1
