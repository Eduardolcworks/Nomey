#!/usr/bin/env bash
# Emite una invitación de DESARROLLO por el mecanismo real —api.create_group_invitation—
# como la cuenta indicada, sobre el grupo indicado, contra la pila LOCAL. F09/ADR-004.
#
#   ./scripts/dev-invitation.sh <correo-de-la-cuenta> <scope_id-del-grupo> [dias]
#
# Imprime el enlace canónico (esquema de la variante development) y el token
# suelto, que también sirve pegado tal cual. El token sale UNA sola vez: ni la
# base ni este script lo guardan. No toca producción: sólo `supabase_db_Nomey`.
set -euo pipefail

email="${1:?correo de la cuenta que invita}"
scope="${2:?scope_id del grupo}"
days="${3:-7}"
container="${NOMEY_DB_CONTAINER:-supabase_db_Nomey}"

sql=$(cat <<SQL
do \$\$
declare
  v_user uuid;
  v_out  jsonb;
begin
  select id into v_user from auth.users where email = '${email}';
  if v_user is null then
    raise exception 'no existe la cuenta %', '${email}';
  end if;
  -- La misma identidad que llevaría la petición HTTP: ni más ni menos.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group_invitation(jsonb_build_object(
    'client_command_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', '${scope}'::uuid, 'expires_in_days', ${days}));
  raise notice 'LINK nomey-dev://join?t=%', v_out ->> 'token';
  raise notice 'TOKEN %', v_out ->> 'token';
  raise notice 'CADUCA %', v_out ->> 'expires_at';
end
\$\$;
SQL
)

docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "$sql" 2>&1 \
  | sed 's/^NOTICE:  //'
