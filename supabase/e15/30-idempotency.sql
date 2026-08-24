-- E15-B · Modelo minimo para medir la concurrencia de la clave de idempotencia.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off
begin;

drop table if exists public.e15_op;

create table public.e15_op (
  id                  bigserial primary key,
  created_by          uuid not null,
  client_operation_id uuid not null,
  payload             text not null,
  constraint e15_op_client_key_unique unique (created_by, client_operation_id)
);

commit;

\echo '=== tabla creada, con la restriccion de unicidad por actor ==='
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.e15_op'::regclass and contype = 'u';
