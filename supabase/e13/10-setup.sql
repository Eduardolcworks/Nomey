-- E13 · Modelo minimo desechable para medir como una superficie en `api` lee
-- una tabla de dominio en `core`.
--
-- Reproduce la topologia de ADR-005 a escala de juguete:
--   e13_core  -> persistencia, NO expuesta
--   e13_api   -> superficie de lectura
--   e13_sec   -> helper de autorizacion
--
-- La columna de datos es TEXTO A PROPOSITO: E13 no mide la frontera textual de
-- ADR-003, que pertenece a D6. Aqui solo se miden ejecucion, RLS y privilegios.
--
-- Idempotente: hace drop antes de crear. NO ES UNA MIGRACION.

\pset pager off

begin;

drop schema if exists e13_api  cascade;
drop schema if exists e13_sec  cascade;
drop schema if exists e13_core cascade;

create schema e13_core;
create schema e13_api;
create schema e13_sec;

-- Membresia minima: quien pertenece a que ambito.
create table e13_core.membership (
  user_id  uuid not null,
  scope_id uuid not null,
  primary key (user_id, scope_id)
);

-- Tabla de dominio.
create table e13_core.item (
  id       uuid primary key default gen_random_uuid(),
  scope_id uuid not null,
  nota     text not null
);

-- El usuario A pertenece al ambito 1111...; el B no pertenece a ninguno.
insert into e13_core.membership (user_id, scope_id)
select id, '11111111-1111-1111-1111-111111111111'
from auth.users where email = 'e13-a@probe.local';

insert into e13_core.item (scope_id, nota) values
  ('11111111-1111-1111-1111-111111111111', 'fila del ambito de A'),
  ('22222222-2222-2222-2222-222222222222', 'fila de un ambito ajeno');

alter table e13_core.membership enable row level security;
alter table e13_core.item       enable row level security;

-- Helper de autorizacion. SECURITY DEFINER, STABLE, search_path vacio y
-- nombres cualificados, como exige AGENTS.md §4.
--
-- No acepta el usuario como parametro a proposito: leyendo auth.uid() por
-- dentro no puede usarse para preguntar por terceros.
create function e13_sec.is_member(target_scope uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from e13_core.membership m
                     where m.scope_id = target_scope
                       and m.user_id  = (select auth.uid())) $$;

revoke execute on function e13_sec.is_member(uuid) from public;

-- Politica FORMA B: join directo contra membership. Requiere que el rol
-- cliente pueda leer membership (medido en 20-privileges.sql).
create policy p_item_join on e13_core.item for select
  using (exists (select 1 from e13_core.membership m
                 where m.scope_id = item.scope_id
                   and m.user_id  = (select auth.uid())));

-- membership se protege SIN subconsulta sobre si misma: no recursa.
create policy p_membership_own on e13_core.membership for select
  using (user_id = (select auth.uid()));

-- Superficie A: vista que se ejecuta como QUIEN CONSULTA.
create view e13_api.item_v with (security_invoker = true) as
  select id, scope_id, nota from e13_core.item;

-- Superficie B: vista que se ejecuta como su PROPIETARIO. `security_invoker`
-- no se declara, que es el comportamiento POR DEFECTO de PostgreSQL.
create view e13_api.item_owner_v as
  select id, scope_id, nota from e13_core.item;

commit;

\echo ''
\echo '=== Punto de partida: authenticated no tiene NINGUN privilegio ==='
select has_schema_privilege('authenticated','e13_core','USAGE')          as usage_core,
       has_schema_privilege('authenticated','e13_api','USAGE')           as usage_api,
       has_schema_privilege('authenticated','e13_sec','USAGE')           as usage_sec,
       has_table_privilege ('authenticated','e13_core.item','SELECT')    as select_item,
       has_table_privilege ('authenticated','e13_api.item_v','SELECT')   as select_vista;
