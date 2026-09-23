#!/usr/bin/env bash
#
# AMISTAD DESDE UN PARTICIPANTE DE GRUPO frente a SESIONES REALES ·
# F12/ADR-005 §4, §7 (F12.E.D).
#
# Uso, con el stack levantado y las migraciones aplicadas:
#
#   bash scripts/group-friend-race-evidence.sh
#
# Escribe filas CONFIRMADAS y las retira al final. NO ES UNA MIGRACION.
#
# QUE ES LO QUE HAY QUE DEMOSTRAR, y por que no basta con la suite de E.A.
#
# F12.E.D anade una SEGUNDA PUERTA a la misma tabla: se puede pedir amistad
# por @handle o por participante de grupo. Las propiedades de E.A —una sola
# pendiente por pareja, cruzadas que no duplican, topes exactos, idempotencia
# por clave— ya estan medidas contra sesiones reales en
# friend-request-race-evidence.sh, y no se repiten aqui. Lo que NO estaba
# medido, y es lo unico que esta migracion pone en riesgo, es que las DOS
# puertas compartan de verdad el cerrojo y el contador: si cada una tomara el
# suyo, dos sesiones simultaneas por puertas distintas se colarian.
#
#   A · CRUZADA ENTRE PUERTAS. A pide a B por @handle (retiene 3 s el cerrojo
#       de la pareja) mientras B le pide a A POR PARTICIPANTE: la segunda
#       ESPERA —prueba de que es el MISMO cerrojo— y recibe incoming_pending
#       con el id de la primera. UNA sola pendiente, ninguna amistad.
#   B · CREAR POR PARTICIPANTE || ACEPTAR LA ENTRANTE. B tiene una pendiente
#       de A. A acepta... no puede: acepta B. Se mide el orden real: B acepta
#       (retiene) mientras A vuelve a pedirle por participante; la creacion
#       ESPERA y recibe el estado ya serializado (friends), sin escribir una
#       segunda fila. Y al reves: crear (retiene) mientras el otro acepta.
#   C · DOS CLAVES DISTINTAS A LA VEZ, las dos por participante. Es la unica
#       forma de que el indice parcial «una pendiente por pareja» se vea
#       forzado: dos comandos legitimos, ninguno replay del otro. Una entra
#       pending y la otra ESPERA y recibe la misma (already_processed). UNA
#       fila.
#   D · EL CICLO DE VIDA ALREDEDOR DE LA CREACION.
#       D1 · el DESTINATARIO sale del grupo (retiene 3 s) mientras el actor
#            le pide por participante: la peticion entra igual, porque el
#            vinculo queda historico y la amistad es entre CUENTAS (§4 del
#            encargo). El resultado es coherente mande quien mande primero.
#       D2 · el ACTOR sale del grupo (retiene 3 s) mientras pide por
#            participante desde otra sesion: la que estaba en vuelo termina
#            con el estado que le corresponda, y —lo que importa— una vez
#            confirmada la salida, la puerta del grupo SE CIERRA:
#            NOT_AUTHORIZED, indistinguible de un participante inventado. No
#            se filtra ni que existiera.
#   E · EL CONTADOR ES UNO SOLO. Con nueve creadas en la hora, dos creaciones
#       simultaneas del mismo emisor POR PUERTAS DISTINTAS —una por @handle y
#       otra por participante— dan UNA pending y UNA
#       FRIEND_REQUEST_RATE_LIMITED. Si cada puerta contara aparte, pasarian
#       las dos y quedarian once.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
exigir_base_local || exit 1

DB=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

UA=f5c00000-0000-4000-8000-0000000000a1  # Edu, crea el grupo
UB=f5c00000-0000-4000-8000-0000000000b1  # Aitor, entra en el grupo
UC=f5c00000-0000-4000-8000-0000000000c1  # Cris, relleno del tope
USERS="'${UA}','${UB}','${UC}'"

EUR=f5c00000-0000-4000-8000-0000000000e1
PA=f5c00000-0000-4000-8000-0000000000f1
PB=f5c00000-0000-4000-8000-0000000000f2
PC=f5c00000-0000-4000-8000-0000000000f3
G=f5c00000-0000-4000-8000-000000000010
SCOPES="'${PA}','${PB}','${PC}','${G}'"
XA=f5c00000-0000-4000-8000-000000000031  # participante de Edu
XB=f5c00000-0000-4000-8000-000000000032  # participante de Aitor

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set constraints all deferred;
delete from core.friendship where user_low in (${USERS}) or user_high in (${USERS});
delete from core.friend_request where requester_user_id in (${USERS}) or target_user_id in (${USERS});
delete from core.friend_link_rotation where user_id in (${USERS});
delete from core.friend_link_attempt where user_id in (${USERS});
delete from core.friend_link where user_id in (${USERS});
delete from core.group_notice where scope_id in (${SCOPES});
delete from core.group_invitation where scope_id in (${SCOPES});
delete from core.link_baseline_subject s using core.participant p where p.id = s.participant_id and p.scope_id in (${SCOPES});
delete from core.participant_period where participant_id in (select id from core.participant where scope_id in (${SCOPES}));
delete from core.participant_user_link where scope_id in (${SCOPES});
delete from core.group_departure where scope_id in (${SCOPES});
-- el mando de aprovisionamiento va DESPUES de todo lo que lo referencia:
-- participant_user_link lo nombra por (created_by, client_command_id).
delete from core.provisioning_command where created_by in (${USERS});
delete from core.invitation_attempt where user_id in (${USERS});
delete from core.username_lookup_attempt where user_id in (${USERS});
delete from core.account_handle_event where user_id in (${USERS}) or actor_user_id in (${USERS});
delete from core.account_handle where user_id in (${USERS});
delete from core.account_identity where user_id in (${USERS});
delete from core.membership where scope_id in (${SCOPES});
delete from core.group_profile where scope_id in (${SCOPES});
delete from core.participant where scope_id in (${SCOPES});
delete from core.scope where id in (${SCOPES});
delete from core.currency_definition where id = '${EUR}';
commit;
SQL
}
trap limpiar EXIT
limpiar

# EL GRUPO SE MONTA CON LAS FUNCIONES REALES —create_group, la invitacion y
# redeem_invitation—, no a mano: lo que se mide depende del vinculo que ellas
# crean, y sembrarlo con inserts probaria el fixture y no el producto.
sembrar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
insert into core.currency_definition (id, code, scale) values ('${EUR}', 'EUR', 2);
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
  ('${PA}', 'personal', '${EUR}', '${UA}'), ('${PB}', 'personal', '${EUR}', '${UB}'),
  ('${PC}', 'personal', '${EUR}', '${UC}');
insert into core.membership (scope_id, user_id) values ('${PA}', '${UA}'), ('${PB}', '${UB}'), ('${PC}', '${UC}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select * from api.reserve_username('{"handle":"gfr_edu","public_name":"Edu"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
select * from api.reserve_username('{"handle":"gfr_aitor","public_name":"Aitor"}'::jsonb);
select set_config('request.jwt.claims', '{"sub":"${UC}"}', true);
select * from api.reserve_username('{"handle":"gfr_cris","public_name":"Cris"}'::jsonb);
reset role;
commit;
SQL
  local token
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
select api.create_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
  'client_group_id', '${G}', 'display_name', 'Carrera ED', 'emoji', 'GRP', 'currency_definition_id', '${EUR}',
  'creator_participant_id', '${XA}', 'creator_display_name', 'Edu', 'participants', '[]'::jsonb));
reset role;
commit;
SQL
  token=$(como "${UA}" "select api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', '${G}')) ->> 'token';")
  como "${UB}" "select api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', '${token}', 'choice', 'new', 'display_name', 'Aitor')) ->> 'participant_id';" >/dev/null
  # El participante de Aitor lo decide redeem_invitation; se lee, no se fija.
  XB=$(q "select id from core.participant where scope_id = '${G}' and display_name = 'Aitor';")
}
reiniciar() { limpiar; sembrar; }

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

sesion() { # $1 salida, $2 uid, $3 sentencia, $4 hold
  {
    printf '%s\n' "\\set ON_ERROR_ROLLBACK on" "begin;" \
      "select set_config('request.jwt.claims', json_build_object('sub', '$2')::text, true), set_config('role', 'authenticated', true);" \
      "$3" "${ESPERA_SQL}" "select pg_sleep($4);" "commit;"
  } | "${DB[@]}" >"$1" 2>&1 &
}

q() { "${DBQ[@]}" -c "$1" | tr -d '[:space:]'; }
como() { # $1 uid, $2 sentencia; imprime la ultima fila
  "${DBQ[@]}" <<SQL | grep -v '^{' | tail -n 1 | tr -d '[:space:]'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1"}', true);
$2
reset role;
commit;
SQL
}

# Las dos puertas, y el resto de comandos, como los llama el cliente.
por_handle_sql()      { echo "select 'R=' || (r ->> 'state') || ':' || coalesce(r ->> 'request_id', '-') || ':' || (r ->> 'already_processed') from api.create_friend_request(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'handle', '$2')) r;"; }
por_participante_sql(){ echo "select 'R=' || (r ->> 'state') || ':' || coalesce(r ->> 'request_id', '-') || ':' || (r ->> 'already_processed') from api.create_friend_request_to_participant(jsonb_build_object('client_command_id', '$1', 'command_contract_version', 1, 'participant_id', '$2')) r;"; }
aceptar_sql()         { echo "select 'R=' || (r ->> 'state') || ':' || coalesce(r ->> 'friendship_id', '-') || ':' || (r ->> 'already_processed') from api.accept_friend_request(jsonb_build_object('request_id', '$1')) r;"; }
salir_sql()           { echo "select 'R=salio' from api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', '${G}')) r;"; }

por_participante() { como "$1" "select (r ->> 'request_id') from api.create_friend_request_to_participant(jsonb_build_object('client_command_id', '$2', 'command_contract_version', 1, 'participant_id', '$3')) r;"; }
estado_de()        { como "$1" "select coalesce((select s.state from api.group_friend_status('${G}') s where s.participant_id = '$2'), 'sin-fila');"; }

pendientes() { q "select count(*) from core.friend_request where pair_low = least('$1'::uuid, '$2'::uuid) and pair_high = greatest('$1'::uuid, '$2'::uuid) and accepted_at is null and declined_at is null and cancelled_at is null and expired_at is null;"; }
filas()      { q "select count(*) from core.friend_request where pair_low = least('$1'::uuid, '$2'::uuid) and pair_high = greatest('$1'::uuid, '$2'::uuid);"; }
amistades()  { q "select count(*) from core.friendship where user_low = least('$1'::uuid, '$2'::uuid) and user_high = greatest('$1'::uuid, '$2'::uuid) and ended_at is null;"; }
origenes()   { q "select coalesce(string_agg(origin, ',' order by origin), '-') from core.friend_request where pair_low = least('$1'::uuid, '$2'::uuid) and pair_high = greatest('$1'::uuid, '$2'::uuid);"; }
creadas()    { q "select count(*) from core.friend_request where requester_user_id = '$1' and created_at > now() - interval '60 minutes';"; }
miembro()    { q "select exists (select 1 from core.membership where scope_id = '${G}' and user_id = '$1');"; }
espero()     { local e; e=$(grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2); if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(grep -i 'error' "$1" | head -c 200)"; fi; }
afirmar()    { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }
K() { printf 'f5e00000-0000-4000-8000-%012d' "$1"; }

echo "== A · cruzada ENTRE PUERTAS: @handle (retiene) || participante =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(por_handle_sql "$(K 1)" gfr_aitor)" 3
sleep 1
sesion "${t2}" "${UB}" "$(por_participante_sql "$(K 2)" "${XA}")" 0
wait
grep -q 'R=pending:.*:false' "${t1}" && ok "Edu creo la pendiente por @handle" || fallo "handle: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la puerta del grupo"
grep -q 'R=incoming_pending:' "${t2}" && ok "por participante recibio incoming_pending (la de Edu)" || fallo "participante: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(pendientes "${UA}" "${UB}")" 1 "pendientes de la pareja"
afirmar "$(filas "${UA}" "${UB}")" 1 "filas de la pareja"
afirmar "$(origenes "${UA}" "${UB}")" username "origen de la unica fila"
afirmar "$(amistades "${UA}" "${UB}")" 0 "amistades"
rm -f "${t1}" "${t2}"

echo "== B · crear por participante || aceptar la entrante, en los dos ordenes =="
reiniciar
R=$(por_participante "${UA}" "$(K 3)" "${XB}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(aceptar_sql "${R}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(por_participante_sql "$(K 4)" "${XB}")" 0
wait
grep -q 'R=accepted:.*:false' "${t1}" && ok "Aitor acepto" || fallo "aceptar: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la creacion"
grep -q 'R=friends:' "${t2}" && ok "la creacion llego tarde y leyo el estado ya serializado: friends" || fallo "crear: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(filas "${UA}" "${UB}")" 1 "filas de la pareja"
afirmar "$(amistades "${UA}" "${UB}")" 1 "amistades"
rm -f "${t1}" "${t2}"
# Y al reves: crear retiene, aceptar espera.
reiniciar
R=$(por_participante "${UA}" "$(K 5)" "${XB}")
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(por_participante_sql "$(K 6)" "${XB}")" 3
sleep 1
sesion "${t2}" "${UB}" "$(aceptar_sql "${R}")" 0
wait
grep -q 'R=pending:.*:true' "${t1}" && ok "la segunda creacion contesto la pendiente que ya habia" || fallo "crear: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la aceptacion"
grep -q 'R=accepted:' "${t2}" && ok "la aceptacion espero y acepto la MISMA" || fallo "aceptar: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(filas "${UA}" "${UB}")" 1 "filas de la pareja"
afirmar "$(amistades "${UA}" "${UB}")" 1 "amistades"
rm -f "${t1}" "${t2}"

echo "== C · dos claves DISTINTAS a la vez, las dos por participante =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(por_participante_sql "$(K 7)" "${XB}")" 3
sleep 1
sesion "${t2}" "${UA}" "$(por_participante_sql "$(K 8)" "${XB}")" 0
wait
I1=$(grep -o 'R=pending:[^:]*:false' "${t1}" | cut -d: -f2)
I2=$(grep -o 'R=pending:[^:]*:true' "${t2}" | cut -d: -f2)
[ -n "${I1}" ] && ok "la primera creo (${I1:0:8}…)" || fallo "primera: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
espero "${t2}" "la segunda"
[ -n "${I2}" ] && [ "${I1}" = "${I2}" ] && ok "la segunda: already_processed con la MISMA solicitud" || fallo "segunda: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(filas "${UA}" "${UB}")" 1 "filas de la pareja"
afirmar "$(pendientes "${UA}" "${UB}")" 1 "pendientes de la pareja"
rm -f "${t1}" "${t2}"

echo "== D1 · el DESTINATARIO sale (retiene) || pedirle por participante =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(salir_sql)" 3
sleep 1
sesion "${t2}" "${UA}" "$(por_participante_sql "$(K 9)" "${XB}")" 0
wait
grep -q 'R=salio' "${t1}" && ok "Aitor salio del grupo" || fallo "salir: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
grep -q 'R=pending:' "${t2}" && ok "la peticion entro igual: el vinculo historico sigue nombrando a la misma cuenta" || fallo "pedir: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
afirmar "$(miembro "${UB}")" f "Aitor sigue siendo miembro"
afirmar "$(pendientes "${UA}" "${UB}")" 1 "pendientes de la pareja"
afirmar "$(origenes "${UA}" "${UB}")" group "origen"
# Y despues de la salida se le puede seguir pidiendo: la fila sigue publicada.
afirmar "$(estado_de "${UA}" "${XB}")" outgoing_pending "lo que Edu ve del que salio"
rm -f "${t1}" "${t2}"

echo "== D2 · el ACTOR sale (retiene) || pedir por participante; y la puerta se cierra =="
reiniciar
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UB}" "$(salir_sql)" 3
sleep 1
sesion "${t2}" "${UB}" "$(por_participante_sql "$(K 10)" "${XA}")" 0
wait
grep -q 'R=salio' "${t1}" && ok "Aitor salio" || fallo "salir: $(grep -i 'R=\|error' "${t1}" | head -c 200)"
# Lo que conteste la que estaba en vuelo es correcto de las dos maneras: o vio
# la membresia de antes y entro, o vio la salida y fue NOT_AUTHORIZED. Lo que
# NO puede pasar es filtrar algo del destinatario por el camino.
if grep -q 'R=pending:' "${t2}"; then
  ok "la que estaba en vuelo entro (vio la membresia anterior)"
elif grep -q 'NOT_AUTHORIZED' "${t2}"; then
  ok "la que estaba en vuelo fue NOT_AUTHORIZED (vio la salida)"
else
  fallo "en vuelo: $(grep -i 'R=\|error' "${t2}" | head -c 200)"
fi
grep -qE 'gfr_edu|'"${UA}" "${t2}" && fallo "la respuesta filtro identidad del destinatario" || ok "la respuesta no nombra al destinatario"
# LA PUERTA, YA CONFIRMADA LA SALIDA: cerrada, e indistinguible de un id inventado.
afirmar "$(miembro "${UB}")" f "Aitor sigue siendo miembro"
afirmar "$(como "${UB}" "select api.create_friend_request_to_participant(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'participant_id', '${XA}'));" 2>&1 | grep -o 'NOT_AUTHORIZED' | head -1)" NOT_AUTHORIZED "pedir tras salir"
afirmar "$(estado_de "${UB}" "${XA}")" sin-fila "lo que ve del grupo que dejo"
rm -f "${t1}" "${t2}"

echo "== E · el contador es UNO: @handle || participante con nueve creadas =="
reiniciar
"${DB[@]}" >/dev/null 2>&1 <<SQL
insert into core.friend_request (requester_user_id, target_user_id, origin, client_command_id, cancelled_at, resolved_by, resolution)
select '${UA}', gen_random_uuid(), 'username', gen_random_uuid(), now(), '${UA}', 'cancelled' from generate_series(1, 9);
SQL
afirmar "$(creadas "${UA}")" 9 "creadas en la hora antes de la carrera"
t1=$(mktemp); t2=$(mktemp)
sesion "${t1}" "${UA}" "$(por_handle_sql "$(K 11)" gfr_cris)" 3
sleep 1
sesion "${t2}" "${UA}" "$(por_participante_sql "$(K 12)" "${XB}")" 0
wait
espero "${t2}" "la segunda puerta"
n_ok=0
grep -q 'R=pending:' "${t1}" && n_ok=$((n_ok + 1))
grep -q 'R=pending:' "${t2}" && n_ok=$((n_ok + 1))
n_no=0
grep -q 'FRIEND_REQUEST_RATE_LIMITED' "${t1}" && n_no=$((n_no + 1))
grep -q 'FRIEND_REQUEST_RATE_LIMITED' "${t2}" && n_no=$((n_no + 1))
afirmar "${n_ok}" 1 "creaciones que entraron"
afirmar "${n_no}" 1 "creaciones frenadas por el tope"
afirmar "$(creadas "${UA}")" 10 "creadas en la hora despues"
rm -f "${t1}" "${t2}"

echo
if [ "${fallos}" -eq 0 ]; then
  echo "TODO OK · las dos puertas comparten cerrojo de pareja y contador; el ciclo de vida del grupo no filtra nada"
  exit 0
fi
echo "FALLOS: ${fallos}"
exit 1
