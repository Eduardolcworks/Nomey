-- E17 · Modelo minimo para medir el ciclo operation/version y la reclamacion
-- del comando cliente antes de que exista su resultado.
--
-- Es una maqueta a escala de juguete de la forma que D9 propone. Las columnas
-- de negocio NO estan: no se mide contabilidad, se miden restricciones.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off
begin;

drop table if exists e17_client_command cascade;
drop table if exists e17_effect          cascade;
drop table if exists e17_operation_version cascade;
drop table if exists e17_operation       cascade;

create table e17_operation (
  id                 uuid primary key,
  operation_class    text not null,
  created_by         uuid not null,
  current_version_id uuid not null          -- NOT NULL desde el principio
);

create table e17_operation_version (
  id                    uuid primary key,
  operation_id          uuid not null references e17_operation(id),
  version_no            int  not null,
  supersedes_version_id uuid,
  -- Destino de las FK compuestas.
  constraint e17_ov_op_id_unique unique (operation_id, id),
  -- Lineage.
  constraint e17_ov_version_no_positivo check (version_no >= 1),
  constraint e17_ov_version_no_unico    unique (operation_id, version_no),
  constraint e17_ov_primera_version     check ((version_no = 1) = (supersedes_version_id is null)),
  constraint e17_ov_no_autoreferencia   check (supersedes_version_id is distinct from id),
  -- El predecesor pertenece a la MISMA operacion.
  constraint e17_ov_supersedes_misma_op foreign key (operation_id, supersedes_version_id)
    references e17_operation_version (operation_id, id)
);

-- El puntero de vigencia: FK COMPUESTA y DIFERIBLE.
-- Compuesta => no puede apuntar a una version de otra operacion.
-- Diferible  => permite insertar la operacion antes que su version V1.
alter table e17_operation
  add constraint e17_op_current_version_fk
  foreign key (id, current_version_id)
  references e17_operation_version (operation_id, id)
  deferrable initially deferred;

create table e17_effect (
  id                   uuid primary key,
  operation_version_id uuid not null references e17_operation_version(id)
);

create table e17_client_command (
  actor               uuid not null,
  client_operation_id uuid not null,
  command_type        text not null,
  contract_version    int  not null,
  canonical_intent    jsonb not null,
  result_operation_id uuid not null,
  result_version_id   uuid not null,
  created_at          timestamptz not null default now(),
  primary key (actor, client_operation_id),
  -- El resultado apunta a una version DE ESA operacion. Diferible porque el
  -- comando se reclama antes de crear el resultado.
  constraint e17_cc_result_fk foreign key (result_operation_id, result_version_id)
    references e17_operation_version (operation_id, id)
    deferrable initially deferred
);

commit;

\echo ''
\echo '=== restricciones creadas ==='
select conrelid::regclass::text as tabla, conname,
       case contype when 'f' then 'FK' when 'u' then 'UNIQUE' when 'c' then 'CHECK'
                    when 'p' then 'PK' end as tipo,
       condeferrable as diferible
from pg_constraint
where conrelid::regclass::text like 'e17%'
order by 1, 3, 2;
