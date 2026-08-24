#!/usr/bin/env bash
# E15-B · Dos transacciones simultaneas con la MISMA (created_by, client_operation_id).
#
# Compara dos patrones razonables. En ambos, la sesion A abre transaccion,
# inserta y retiene 3 s antes de confirmar; la sesion B entra 1 s despues.
#
# Lo que queremos saber de cada patron:
#   · ¿se crea exactamente UNA fila?
#   · ¿el competidor ESPERA correctamente en vez de fallar antes de tiempo?
#   · ¿puede recuperar la fila original despues?
#   · ¿depende de un SELECT previo? (no debe)
#
# NO ES UNA MIGRACION.
set -u
DB="docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0 -t -A"
ACTOR='11111111-1111-1111-1111-111111111111'
KEY='22222222-2222-2222-2222-222222222222'

reset_tabla() { echo "truncate public.e15_op;" | $DB >/dev/null 2>&1; }

sesion_a() {
  cat <<EOF | $DB 2>&1 | sed 's/^/    [A] /'
begin;
insert into public.e15_op(created_by, client_operation_id, payload)
values ('$ACTOR','$KEY','intento A');
select 'insertada, reteniendo la transaccion 3 s';
select pg_sleep(3);
commit;
select 'confirmada';
EOF
}

sesion_b_on_conflict() {
  cat <<EOF | $DB 2>&1 | sed 's/^/    [B] /'
select 'arranca en ' || to_char(clock_timestamp(),'SS.MS');
begin;
insert into public.e15_op(created_by, client_operation_id, payload)
values ('$ACTOR','$KEY','intento B')
on conflict (created_by, client_operation_id) do nothing
returning 'INSERTO id=' || id::text;
select 'el insert retorno en ' || to_char(clock_timestamp(),'SS.MS');
select 'lectura del original: ' || coalesce(
  (select payload from public.e15_op
    where created_by='$ACTOR' and client_operation_id='$KEY'), '(no visible)');
commit;
EOF
}

sesion_b_captura() {
  cat <<EOF | $DB 2>&1 | sed 's/^/    [B] /'
select 'arranca en ' || to_char(clock_timestamp(),'SS.MS');
do \$\$
declare v_payload text;
begin
  insert into public.e15_op(created_by, client_operation_id, payload)
  values ('$ACTOR','$KEY','intento B');
  raise notice 'INSERTO (no hubo conflicto)';
exception when unique_violation then
  select payload into v_payload from public.e15_op
    where created_by='$ACTOR' and client_operation_id='$KEY';
  raise notice 'unique_violation capturada en %, original recuperado: %',
    to_char(clock_timestamp(),'SS.MS'), coalesce(v_payload,'(no visible)');
end \$\$;
EOF
}

echo ""
echo "===== PATRON 1 · INSERT ... ON CONFLICT DO NOTHING ====="
reset_tabla
sesion_a & sleep 1; sesion_b_on_conflict; wait
echo "    filas finales: $(echo 'select count(*) from public.e15_op;' | $DB)"

echo ""
echo "===== PATRON 2 · INSERT + captura de unique_violation ====="
reset_tabla
sesion_a & sleep 1; sesion_b_captura; wait
echo "    filas finales: $(echo 'select count(*) from public.e15_op;' | $DB)"
