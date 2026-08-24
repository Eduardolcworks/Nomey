-- E17-B1 y B2 · Reclamar el comando ANTES de que exista su resultado.
--
-- B3 y B4 son concurrentes y viven en 31-command-run.sh.
--
-- NO ES UNA MIGRACION.

\pset pager off

create or replace procedure pg_temp.limpiar() language sql as $$
  delete from e17_effect; delete from e17_client_command;
  delete from e17_operation_version; delete from e17_operation;
$$;

\echo ''
\echo '===== B1 · exito: reclamar, luego crear el resultado ====='
call pg_temp.limpiar();
do $$
declare actor uuid := gen_random_uuid(); k uuid := gen_random_uuid();
        op uuid := gen_random_uuid(); v1 uuid := gen_random_uuid();
begin
  -- 1. Se reclama la clave PRIMERO. Los ids del resultado ya estan generados.
  insert into e17_client_command(actor, client_operation_id, command_type,
                                 contract_version, canonical_intent,
                                 result_operation_id, result_version_id)
  values (actor, k, 'record_group_expense', 1, '{"total":"6000"}'::jsonb, op, v1);
  raise notice 'comando reclamado; el resultado todavia NO existe';

  -- 2. Se crea el resultado.
  insert into e17_operation values (op, 'record_group_expense', actor, v1);
  insert into e17_operation_version(id, operation_id, version_no) values (v1, op, 1);
  insert into e17_effect(id, operation_version_id) values (gen_random_uuid(), v1);

  set constraints all immediate;
  raise notice 'B1 -> resultado creado y restricciones validadas: OK';
end $$;
select 'B1 -> comandos: ' || (select count(*) from e17_client_command)
    || ' · operaciones: ' || (select count(*) from e17_operation)
    || ' · versiones: '   || (select count(*) from e17_operation_version) as resultado;

\echo ''
\echo '===== B2 · fallo posterior: no debe quedar ningun comando ====='
call pg_temp.limpiar();
do $$
declare actor uuid := gen_random_uuid(); k uuid := gen_random_uuid();
        op uuid := gen_random_uuid(); v1 uuid := gen_random_uuid();
begin
  insert into e17_client_command(actor, client_operation_id, command_type,
                                 contract_version, canonical_intent,
                                 result_operation_id, result_version_id)
  values (actor, k, 'record_group_expense', 1, '{"total":"6000"}'::jsonb, op, v1);
  raise notice 'comando reclamado...';
  -- Simulamos un fallo de autorizacion o de validacion de dominio.
  raise exception 'NOT_A_MEMBER';
exception when others then
  raise notice 'B2 -> la operacion aborto: %', sqlerrm;
end $$;
select 'B2 -> comandos que quedan: ' || count(*)
    || case when count(*) = 0 then '  (correcto: solo se persisten comandos aceptados)'
            else '  INESPERADO' end as resultado
from e17_client_command;
