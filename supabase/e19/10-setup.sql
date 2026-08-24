-- E19 · Topologia minima para medir una CADENA de dos vistas `security_invoker`
-- y la verificabilidad por catalogo de la proyeccion canonica.
--
-- Reproduce a escala de juguete la forma que D11 propone:
--
--   e19_api.effect_v          vista security_invoker      <- superficie cliente
--        |
--   e19_core.current_effect   vista security_invoker      <- proyeccion canonica
--        |
--   e19_core.effect / operation_version / operation       <- tablas con RLS
--
-- Los importes son BIGINT solo para que el modelo se parezca al real. E19 NO
-- mide la frontera textual de ADR-008: eso lo cerro E14 y aqui no se toca.
--
-- DOS TRANSACCIONES A PROPOSITO. Todo el DDL va en la primera y los datos en la
-- segunda, porque el puntero de vigencia es una FK DIFERIBLE: mientras hay
-- eventos de trigger pendientes, cualquier `ALTER TABLE` sobre la tabla
-- referenciada falla con «cannot ALTER TABLE because it has pending trigger
-- events». Es de la misma familia que la trampa operativa que ya recogia
-- ADR-011 para el borrado.
--
-- Idempotente: hace drop antes de crear. NO ES UNA MIGRACION.

\pset pager off

-- =====================================================================
-- Transaccion 1 · DDL completo: tablas, RLS, politicas y vistas.
-- =====================================================================
begin;

drop schema if exists e19_api  cascade;
drop schema if exists e19_core cascade;

create schema e19_core;
create schema e19_api;

create table e19_core.membership (
  user_id  uuid not null,
  scope_id uuid not null,
  primary key (user_id, scope_id)
);

create table e19_core.operation (
  id                 uuid primary key,
  scope_id           uuid not null,
  current_version_id uuid not null
);

create table e19_core.operation_version (
  id           uuid primary key,
  operation_id uuid not null references e19_core.operation(id),
  version_no   int  not null check (version_no >= 1),
  unique (operation_id, id),
  unique (operation_id, version_no)
);

-- El puntero de vigencia: FK compuesta y diferible, como en ADR-011 §4.
alter table e19_core.operation
  add constraint e19_op_current_version_fk
  foreign key (id, current_version_id)
  references e19_core.operation_version (operation_id, id)
  deferrable initially deferred;

create table e19_core.effect (
  id                   uuid primary key default gen_random_uuid(),
  operation_version_id uuid not null references e19_core.operation_version(id),
  scope_id             uuid not null,
  amount_minor         bigint not null
);

alter table e19_core.membership        enable row level security;
alter table e19_core.operation         enable row level security;
alter table e19_core.operation_version enable row level security;
alter table e19_core.effect            enable row level security;

create policy p_membership_own on e19_core.membership for select
  using (user_id = (select auth.uid()));

create policy p_operation_member on e19_core.operation for select
  using (exists (select 1 from e19_core.membership m
                 where m.scope_id = operation.scope_id
                   and m.user_id  = (select auth.uid())));

create policy p_effect_member on e19_core.effect for select
  using (exists (select 1 from e19_core.membership m
                 where m.scope_id = effect.scope_id
                   and m.user_id  = (select auth.uid())));

-- La version se alcanza por su operacion. Se declara A PROPOSITO para medir si
-- la cadena exige politica en TODAS las relaciones que atraviesa.
create policy p_version_member on e19_core.operation_version for select
  using (exists (select 1 from e19_core.operation o
                 join e19_core.membership m on m.scope_id = o.scope_id
                 where o.id = operation_version.operation_id
                   and m.user_id = (select auth.uid())));

-- NIVEL INTERNO · la proyeccion canonica. El filtro de vigencia vive AQUI y en
-- ningun otro sitio: es la unica razon de existir de esta vista.
create view e19_core.current_effect with (security_invoker = true) as
  select e.id, e.scope_id, e.amount_minor, e.operation_version_id, o.id as operation_id
  from   e19_core.effect e
  join   e19_core.operation_version v on v.id = e.operation_version_id
  join   e19_core.operation o         on o.id = v.operation_id
  where  o.current_version_id = v.id;

-- NIVEL EXTERNO · superficie cliente, tambien invoker.
create view e19_api.effect_v with (security_invoker = true) as
  select id, scope_id, amount_minor from e19_core.current_effect;

-- CONTRASTE · el mismo nivel externo ejecutado como su PROPIETARIO. No declarar
-- `security_invoker` es el comportamiento POR DEFECTO de PostgreSQL.
create view e19_api.effect_owner_v as
  select id, scope_id, amount_minor from e19_core.current_effect;

-- CONTRASTE PARA E19-B · una vista que se salta la proyeccion canonica y toca
-- la tabla base directamente. Es exactamente lo que la guarda debe detectar.
create view e19_api.effect_bypass_v with (security_invoker = true) as
  select id, scope_id, amount_minor from e19_core.effect;

commit;

-- =====================================================================
-- Transaccion 2 · datos. El puntero diferido obliga a que la operacion y su
-- version entren en la misma transaccion.
-- =====================================================================
begin;

-- A pertenece al ambito 1111...; B al ambito 2222.... Ninguno al del otro.
insert into e19_core.membership (user_id, scope_id)
select id, '11111111-1111-1111-1111-111111111111'
from auth.users where email = 'e19-a@probe.local';

insert into e19_core.membership (user_id, scope_id)
select id, '22222222-2222-2222-2222-222222222222'
from auth.users where email = 'e19-b@probe.local';

-- Operacion del ambito de A, corregida: V1 = 60,00 historica; V2 = 75,00 vigente.
insert into e19_core.operation (id, scope_id, current_version_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-0000000000a2');

insert into e19_core.operation_version (id, operation_id, version_no) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1',
   'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('aaaaaaaa-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-000000000001', 2);

-- Operacion del ambito de B, sin correcciones.
insert into e19_core.operation (id, scope_id, current_version_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-0000000000a1');

insert into e19_core.operation_version (id, operation_id, version_no) values
  ('bbbbbbbb-0000-0000-0000-0000000000a1',
   'bbbbbbbb-0000-0000-0000-000000000001', 1);

insert into e19_core.effect (operation_version_id, scope_id, amount_minor) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', 6000),   -- historico: NO debe contar
  ('aaaaaaaa-0000-0000-0000-0000000000a2',
   '11111111-1111-1111-1111-111111111111', 7500),   -- vigente
  ('bbbbbbbb-0000-0000-0000-0000000000a1',
   '22222222-2222-2222-2222-222222222222', 4000);   -- vigente, ambito de B

commit;

\echo ''
\echo '=== Datos crudos: 3 efectos, uno de ellos historico ==='
select e.amount_minor, e.scope_id, v.version_no,
       (o.current_version_id = v.id) as es_vigente
from e19_core.effect e
join e19_core.operation_version v on v.id = e.operation_version_id
join e19_core.operation o on o.id = v.operation_id
order by e.scope_id, v.version_no;

\echo ''
\echo '=== Punto de partida: authenticated no tiene NINGUN privilegio ==='
select has_schema_privilege('authenticated','e19_core','USAGE')            as usage_core,
       has_schema_privilege('authenticated','e19_api','USAGE')             as usage_api,
       has_table_privilege ('authenticated','e19_core.effect','SELECT')    as select_effect,
       has_table_privilege ('authenticated','e19_core.current_effect','SELECT') as select_interna,
       has_table_privilege ('authenticated','e19_api.effect_v','SELECT')   as select_externa;
