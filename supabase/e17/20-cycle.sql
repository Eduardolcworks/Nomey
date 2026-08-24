-- E17-A · El ciclo operation <-> operation_version.
--
-- ¿Deja la FK compuesta diferible un invariante FUERTE al commit?
--
-- NO ES UNA MIGRACION.

\pset pager off

create or replace procedure pg_temp.limpiar() language sql as $$
  delete from e17_effect; delete from e17_client_command;
  delete from e17_operation_version; delete from e17_operation;
$$;

\echo ''
\echo '===== A1 · operacion apuntando a una V1 que todavia NO existe ====='
call pg_temp.limpiar();
do $$
declare op uuid := gen_random_uuid(); v1 uuid := gen_random_uuid();
begin
  insert into e17_operation(id, operation_class, created_by, current_version_id)
  values (op, 'group_expense', gen_random_uuid(), v1);
  raise notice 'insertada la operacion apuntando a una version inexistente: OK';
  insert into e17_operation_version(id, operation_id, version_no) values (v1, op, 1);
  raise notice 'insertada V1 despues: OK';
end $$;
select 'A1 -> COMMIT ' || case when count(*) = 1 then 'CORRECTO' else 'inesperado' end as resultado
from e17_operation;

\echo ''
\echo '===== A2 · nunca se inserta V1: el COMMIT debe fallar ====='
call pg_temp.limpiar();
do $$
declare op uuid := gen_random_uuid(); v1 uuid := gen_random_uuid();
begin
  insert into e17_operation(id, operation_class, created_by, current_version_id)
  values (op, 'group_expense', gen_random_uuid(), v1);
  raise notice 'insertada la operacion sin su version...';
  -- Forzamos la comprobacion diferida sin cerrar el bloque:
  set constraints all immediate;
  raise notice 'A2 -> INESPERADO: no fallo';
exception when others then
  raise notice 'A2 -> FALLO al validar, como debe: % %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo '===== A3 · el puntero apunta a una version de OTRA operacion ====='
call pg_temp.limpiar();
do $$
declare opA uuid := gen_random_uuid(); vA uuid := gen_random_uuid();
        opB uuid := gen_random_uuid(); vB uuid := gen_random_uuid();
begin
  -- Operacion A bien formada.
  insert into e17_operation(id, operation_class, created_by, current_version_id)
  values (opA, 'group_expense', gen_random_uuid(), vA);
  insert into e17_operation_version(id, operation_id, version_no) values (vA, opA, 1);
  -- Operacion B apuntando a la version de A.
  insert into e17_operation(id, operation_class, created_by, current_version_id)
  values (opB, 'group_expense', gen_random_uuid(), vA);
  insert into e17_operation_version(id, operation_id, version_no) values (vB, opB, 1);
  set constraints all immediate;
  raise notice 'A3 -> INESPERADO: no fallo';
exception when others then
  raise notice 'A3 -> FALLO al validar, como debe: % %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo '===== Lineage · las cinco restricciones, una a una ====='
call pg_temp.limpiar();
do $$
declare op uuid := gen_random_uuid(); v1 uuid := gen_random_uuid();
        v2 uuid := gen_random_uuid(); otra_op uuid := gen_random_uuid();
        otra_v uuid := gen_random_uuid();
begin
  insert into e17_operation values (op, 'x', gen_random_uuid(), v1);
  insert into e17_operation_version(id, operation_id, version_no) values (v1, op, 1);
  insert into e17_operation values (otra_op, 'x', gen_random_uuid(), otra_v);
  insert into e17_operation_version(id, operation_id, version_no) values (otra_v, otra_op, 1);
  set constraints all immediate;

  begin insert into e17_operation_version(id, operation_id, version_no) values (gen_random_uuid(), op, 0);
    raise notice '  version_no = 0          -> INESPERADO: aceptado';
  exception when others then raise notice '  version_no = 0          -> rechazado (%)' , sqlstate; end;

  begin insert into e17_operation_version(id, operation_id, version_no, supersedes_version_id)
        values (gen_random_uuid(), op, 1, v1);
    raise notice '  version_no duplicado    -> INESPERADO: aceptado';
  exception when others then raise notice '  version_no duplicado    -> rechazado (%)', sqlstate; end;

  begin insert into e17_operation_version(id, operation_id, version_no) values (gen_random_uuid(), op, 2);
    raise notice '  v2 sin supersedes       -> INESPERADO: aceptado';
  exception when others then raise notice '  v2 sin supersedes       -> rechazado (%)', sqlstate; end;

  begin insert into e17_operation_version(id, operation_id, version_no, supersedes_version_id)
        values (v2, op, 2, v2);
    raise notice '  autorreferencia         -> INESPERADO: aceptado';
  exception when others then raise notice '  autorreferencia         -> rechazado (%)', sqlstate; end;

  begin insert into e17_operation_version(id, operation_id, version_no, supersedes_version_id)
        values (gen_random_uuid(), op, 2, otra_v);
    raise notice '  supersedes de otra op   -> INESPERADO: aceptado';
  exception when others then raise notice '  supersedes de otra op   -> rechazado (%)', sqlstate; end;

  begin insert into e17_operation_version(id, operation_id, version_no, supersedes_version_id)
        values (v2, op, 2, v1);
    raise notice '  v2 correcta             -> aceptada';
  exception when others then raise notice '  v2 correcta             -> INESPERADO: % %', sqlstate, sqlerrm; end;
end $$;
