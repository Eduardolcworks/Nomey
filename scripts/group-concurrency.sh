#!/usr/bin/env bash
#
# Concurrencia real de la creacion de Grupo · F9.
#
# No puede ser un fichero de `supabase/checks/`: una sola sesion de `psql` no
# tiene concurrencia, y una simulacion secuencial pasaria tambien sin la clave
# primaria de `core.provisioning_command` y sin el unico
# `exception when unique_violation` de la funcion. Esto abre SESIONES
# SIMULTANEAS de verdad, igual que `provisioning-concurrency.sh`.
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   ./scripts/group-concurrency.sh
#
# Escribe filas CONFIRMADAS —una carrera solo existe entre transacciones
# distintas— y las retira al final, comprobando que no queda ninguna y que el
# censo previo del stack no se toca. Sale con codigo distinto de cero si alguna
# asercion falla, para que CI lo detecte.
#
# NO ES UNA MIGRACION y no crea ningun objeto de esquema.
#
# Lo que comprueba, y por que cada cosa importa:
#
#   1 · Dos `create_group` SIMULTANEOS con la MISMA clave y la MISMA intencion
#       producen UN grupo. Lo garantiza la PK de `core.provisioning_command` mas
#       el unico `unique_violation` capturado; una de las dos vuelve como replay
#       o como COMMAND_IN_FLIGHT, y ninguna crea un segundo ambito.
#   2 · Y ese grupo esta COMPLETO: perfil, membresia, participantes y vinculo.
#       Es el fallo peor de esta carrera —un ambito a medias no lanza nada— y es
#       justo lo que la atomicidad tiene que impedir.
#   3 · Dos simultaneos con la MISMA clave y DISTINTA intencion no mezclan nada:
#       una gana y la otra se rechaza. Nunca quedan dos grupos ni un grupo con
#       datos de las dos.
#   4 · Dos simultaneos con claves DISTINTAS crean DOS grupos: la exclusion es
#       de la clave, no del nombre ni de la gente.
#   5 · La carrera repetida es determinista EN SU FORMA: siempre un grupo.

set -uo pipefail

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

# Actores de prueba. No colisionan con los de los otros scripts de concurrencia.
U1=e1111111-1111-4111-8111-111111111111
EUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe

# Censo previo, para demostrar al final que no se ha tocado nada ajeno.
censo_antes=$("${DBQ[@]}" -c "select count(*) from core.scope where kind <> 'group';")

# --------------------------------------------------------------- utilidades --
# Ejecuta una creacion en su propia transaccion, como `authenticated`. Imprime
# lo que devuelva PostgreSQL, error incluido.
crear() {
  local cmd="$1" grupo="$2" nombre="$3" pcre="$4" pana="$5"
  "${DB[@]}" <<SQL 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${U1}"}', true);
select api.create_group(jsonb_build_object(
  'client_command_id',        '${cmd}',
  'command_contract_version', 1,
  'client_group_id',          '${grupo}',
  'display_name',             '${nombre}',
  'emoji',                    'GRP',
  'currency_definition_id',   '${EUR}',
  'creator_participant_id',   '${pcre}',
  'creator_display_name',     'Edu',
  'participants', jsonb_build_array(jsonb_build_object(
    'client_participant_id', '${pana}', 'display_name', 'Ana'))));
commit;
SQL
}

contar() {
  "${DBQ[@]}" -c "$1" 2>/dev/null | tr -d '[:space:]'
}

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
delete from core.participant_user_link where scope_id in (select id from core.scope where kind = 'group');
delete from core.participant          where scope_id in (select id from core.scope where kind = 'group');
delete from core.membership           where scope_id in (select id from core.scope where kind = 'group');
delete from core.group_profile;
delete from core.provisioning_command;
delete from core.scope where kind = 'group';
SQL
}

# ============================================================================
echo "== 1 · misma clave, misma intencion, dos sesiones simultaneas =============="
limpiar
CMD=aa000000-0000-4000-8000-000000000001
GRP=ab000000-0000-4000-8000-000000000001
P1=ac000000-0000-4000-8000-000000000001
P2=ac000000-0000-4000-8000-000000000002

crear "$CMD" "$GRP" 'Viaje' "$P1" "$P2" > /tmp/g1.a 2>&1 &
crear "$CMD" "$GRP" 'Viaje' "$P1" "$P2" > /tmp/g1.b 2>&1 &
wait

n=$(contar "select count(*) from core.scope where kind = 'group';")
[ "$n" = "1" ] && ok "un solo ambito de grupo" || fallo "ambitos de grupo: $n (esperado 1)"

n=$(contar "select count(*) from core.group_profile;")
[ "$n" = "1" ] && ok "un solo perfil" || fallo "perfiles: $n (esperado 1)"

n=$(contar "select count(*) from core.membership m join core.scope s on s.id = m.scope_id where s.kind = 'group';")
[ "$n" = "1" ] && ok "una sola membresia" || fallo "membresias de grupo: $n (esperado 1)"

n=$(contar "select count(*) from core.participant p join core.scope s on s.id = p.scope_id where s.kind = 'group';")
[ "$n" = "2" ] && ok "dos participantes, sin duplicar" || fallo "participantes: $n (esperado 2)"

n=$(contar "select count(*) from core.participant_user_link;")
[ "$n" = "1" ] && ok "un solo vinculo con la cuenta" || fallo "vinculos: $n (esperado 1)"

n=$(contar "select count(*) from core.provisioning_command;")
[ "$n" = "1" ] && ok "una sola clave reclamada" || fallo "claves: $n (esperado 1)"

# Una de las dos tuvo que resolverse como replay o como COMMAND_IN_FLIGHT; la
# otra creo. Lo que NO puede haber es dos creaciones.
creadas=$(grep -cE '"replay"[[:space:]]*:[[:space:]]*false' /tmp/g1.a /tmp/g1.b 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
[ "$creadas" = "1" ] && ok "exactamente una sesion creo" || fallo "sesiones que crearon: $creadas (esperado 1)"

# ============================================================================
echo "== 2 · misma clave, intencion DISTINTA, simultaneas ========================"
limpiar
CMD=aa000000-0000-4000-8000-000000000002
GRP=ab000000-0000-4000-8000-000000000002

crear "$CMD" "$GRP" 'Viaje' "$P1" "$P2" > /tmp/g2.a 2>&1 &
crear "$CMD" "$GRP" 'Otro'  "$P1" "$P2" > /tmp/g2.b 2>&1 &
wait

n=$(contar "select count(*) from core.scope where kind = 'group';")
[ "$n" = "1" ] && ok "un solo ambito pese a dos intenciones" || fallo "ambitos: $n (esperado 1)"

n=$(contar "select count(distinct display_name) from core.group_profile;")
[ "$n" = "1" ] && ok "un solo nombre: no se mezclaron" || fallo "nombres distintos: $n (esperado 1)"

rechazos=$(grep -cE 'IDEMPOTENCY_KEY_REUSED|COMMAND_IN_FLIGHT' /tmp/g2.a /tmp/g2.b 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
[ "$rechazos" -ge 1 ] && ok "la segunda intencion se rechazo" || fallo "ninguna sesion fue rechazada"

# ============================================================================
echo "== 3 · claves DISTINTAS, simultaneas: dos grupos legitimos ================="
limpiar
crear aa000000-0000-4000-8000-000000000003 ab000000-0000-4000-8000-000000000003 'Viaje' \
      ac000000-0000-4000-8000-000000000003 ac000000-0000-4000-8000-000000000004 > /dev/null 2>&1 &
crear aa000000-0000-4000-8000-000000000004 ab000000-0000-4000-8000-000000000004 'Viaje' \
      ac000000-0000-4000-8000-000000000005 ac000000-0000-4000-8000-000000000006 > /dev/null 2>&1 &
wait

n=$(contar "select count(*) from core.scope where kind = 'group';")
[ "$n" = "2" ] && ok "dos grupos con el mismo nombre y claves distintas" || fallo "ambitos: $n (esperado 2)"

# ============================================================================
echo "== 4 · la carrera repetida es determinista en su forma ====================="
determinista=1
for i in 1 2 3 4 5; do
  limpiar
  CMD="aa000000-0000-4000-8000-00000000010$i"
  GRP="ab000000-0000-4000-8000-00000000010$i"
  crear "$CMD" "$GRP" 'Repetida' "$P1" "$P2" > /dev/null 2>&1 &
  crear "$CMD" "$GRP" 'Repetida' "$P1" "$P2" > /dev/null 2>&1 &
  wait
  n=$(contar "select count(*) from core.scope where kind = 'group';")
  [ "$n" = "1" ] || { fallo "vuelta $i: $n ambitos"; determinista=0; }
done
[ "$determinista" = "1" ] && ok "cinco vueltas, un ambito cada vez"

# ============================================================================
echo "== 5 · limpieza y censo ajeno =============================================="
limpiar

for t in "core.scope where kind = 'group'" "core.group_profile" "core.provisioning_command"; do
  n=$(contar "select count(*) from $t;")
  [ "$n" = "0" ] && ok "sin residuo en $t" || fallo "quedan $n filas en $t"
done

censo_despues=$(contar "select count(*) from core.scope where kind <> 'group';")
[ "$censo_antes" = "$censo_despues" ] \
  && ok "censo ajeno intacto: $censo_despues ambitos no-grupo" \
  || fallo "el censo ajeno cambio: $censo_antes -> $censo_despues"

echo
if [ "$fallos" -eq 0 ]; then
  echo "CONCURRENCIA DE GRUPO: OK"
  exit 0
fi
echo "CONCURRENCIA DE GRUPO: $fallos fallo(s)"
exit 1
