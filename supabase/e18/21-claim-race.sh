#!/usr/bin/env bash
# E18-A5 · Dos usuarios reclaman el mismo participant a la vez.
# Debe ganar exactamente uno.
#
# NO ES UNA MIGRACION.
set -u
DB="docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0"
P='c1230000-0000-0000-0000-000000000123'
S='aaaa0000-0000-0000-0000-000000000001'
U1='11110000-0000-0000-0000-000000000001'
U2='22220000-0000-0000-0000-000000000002'

echo "delete from e18_participant_user_link;" | $DB >/dev/null 2>&1

reclama() {
  cat <<EOF | $DB 2>&1 | grep -v '^$' | sed "s/^/    [$2] /"
begin;
do \$\$
begin
  insert into e18_participant_user_link(participant_id, scope_id, user_id)
  values ('$P','$S','$1');
  raise notice 'GANA el claim en %', to_char(clock_timestamp(),'SS.MS');
  perform pg_sleep(2);
exception when unique_violation then
  raise notice 'PIERDE en % -> ya reclamado por otro', to_char(clock_timestamp(),'SS.MS');
end \$\$;
commit;
EOF
}

echo ""
echo "===== A5 · dos claims simultaneos sobre el mismo participant ====="
reclama "$U1" 1 & reclama "$U2" 2 & wait
echo "    vinculos sobre P123: $(echo "select count(*) from e18_participant_user_link where participant_id='$P';" | $DB)"
echo "    ganador: $(echo "select u.name from e18_participant_user_link l join e18_user u on u.id=l.user_id where l.participant_id='$P';" | $DB)"
