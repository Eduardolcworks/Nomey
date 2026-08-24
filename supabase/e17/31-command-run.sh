#!/usr/bin/env bash
# E17-B3 y B4 · Dos peticiones simultaneas por la misma clave de comando.
#
# B3: la primera confirma  -> la segunda debe observar el comando existente.
# B4: la primera revierte  -> la segunda debe poder reclamar la clave y completar.
#
# Nota: la limpieza va DENTRO de una transaccion a proposito. La FK del puntero
# de vigencia es DEFERRABLE INITIALLY DEFERRED, asi que borrar por sentencias
# sueltas la viola al confirmar cada una por separado.
#
# NO ES UNA MIGRACION.
set -u
DB="docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0"
ACTOR='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
KEY='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

limpiar() {
  echo "begin;
        delete from e17_effect; delete from e17_client_command;
        delete from e17_operation_version; delete from e17_operation;
        commit;" | $DB 2>&1 | grep -i error | sed 's/^/    [limpieza] /'
}

# $1 = commit | rollback
primera() {
  cat <<EOF | $DB 2>&1 | grep -v '^$' | sed 's/^/    [1] /'
begin;
insert into e17_client_command(actor, client_operation_id, command_type, contract_version,
                               canonical_intent, result_operation_id, result_version_id)
values ('$ACTOR','$KEY','record_group_expense',1,'{"total":"6000"}'::jsonb,
        '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
select 'clave reclamada, reteniendo 3 s';
select pg_sleep(3);
insert into e17_operation values ('11111111-1111-1111-1111-111111111111','record_group_expense','$ACTOR','22222222-2222-2222-2222-222222222222');
insert into e17_operation_version(id, operation_id, version_no)
values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',1);
$1;
select '$1 ejecutado';
EOF
}

segunda() {
  cat <<EOF | $DB 2>&1 | grep -v '^$' | sed 's/^/    [2] /'
select 'arranca en ' || to_char(clock_timestamp(),'SS.MS');
begin;
do \$\$
declare v_op uuid;
begin
  insert into e17_client_command(actor, client_operation_id, command_type, contract_version,
                                 canonical_intent, result_operation_id, result_version_id)
  values ('$ACTOR','$KEY','record_group_expense',1,'{"total":"6000"}'::jsonb,
          '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
  -- Reclamada: creamos nuestro propio resultado, como haria la frontera real.
  insert into e17_operation values ('33333333-3333-3333-3333-333333333333','record_group_expense','$ACTOR','44444444-4444-4444-4444-444444444444');
  insert into e17_operation_version(id, operation_id, version_no)
  values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',1);
  raise notice 'RECLAMO la clave en % y creo su resultado', to_char(clock_timestamp(),'SS.MS');
exception when unique_violation then
  select result_operation_id into v_op from e17_client_command
    where actor='$ACTOR' and client_operation_id='$KEY';
  raise notice 'CONFLICTO en % -> REPLAY del comando existente, operacion %',
    to_char(clock_timestamp(),'SS.MS'), v_op;
end \$\$;
commit;
EOF
}

echo ""
echo "===== B3 · la primera CONFIRMA ====="
limpiar; primera commit & sleep 1; segunda; wait
echo "    comandos: $(echo 'select count(*) from e17_client_command;' | $DB) · operaciones: $(echo 'select count(*) from e17_operation;' | $DB)"

echo ""
echo "===== B4 · la primera REVIERTE ====="
limpiar; primera rollback & sleep 1; segunda; wait
echo "    comandos: $(echo 'select count(*) from e17_client_command;' | $DB) · operaciones: $(echo 'select count(*) from e17_operation;' | $DB)"
