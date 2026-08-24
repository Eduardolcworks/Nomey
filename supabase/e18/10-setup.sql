-- E18 · Maqueta minima para D10: identidad del participante, vinculo con una
-- cuenta, y periodos de presencia.
--
-- `e18_user` sustituye a `auth.users` a proposito: lo que se mide son las
-- restricciones del vinculo, no la integracion con GoTrue, y asi el sondeo no
-- crea ni borra usuarios reales.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off
begin;

drop table if exists e18_participant_period    cascade;
drop table if exists e18_participant_user_link cascade;
drop table if exists e18_participant           cascade;
drop table if exists e18_user                  cascade;
drop table if exists e18_scope                 cascade;

create table e18_scope (
  id   uuid primary key,
  name text not null
);

create table e18_user (          -- sustituto local de auth.users
  id   uuid primary key,
  name text not null
);

create table e18_participant (
  id           uuid primary key,
  scope_id     uuid not null references e18_scope(id),
  display_name text not null,
  -- Destino de la FK compuesta del vinculo: impide que el scope diverja.
  constraint e18_participant_id_scope_unique unique (id, scope_id)
);

create table e18_participant_user_link (
  -- Un participant -> como maximo UN usuario.
  participant_id uuid primary key,
  scope_id       uuid not null,
  user_id        uuid not null references e18_user(id),
  linked_at      timestamptz not null default now(),
  linked_by      uuid references e18_user(id),
  -- Un usuario -> como maximo UN participant por scope.
  constraint e18_link_user_por_scope unique (scope_id, user_id),
  -- El scope del vinculo no puede divergir del scope del participant.
  constraint e18_link_scope_coherente foreign key (participant_id, scope_id)
    references e18_participant (id, scope_id)
);

-- Presencia del participante: varios periodos por participante.
create table e18_participant_period (
  id             uuid primary key,
  participant_id uuid not null references e18_participant(id),
  valid_from     date not null,
  valid_until    date,                       -- NULL = periodo abierto
  period         daterange generated always as
                   (daterange(valid_from, valid_until, '[)')) stored,
  constraint e18_period_orden check (valid_until is null or valid_until > valid_from)
);

commit;

\echo ''
\echo '=== restricciones del vinculo ==='
select conname, contype,
       pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'e18_participant_user_link'::regclass
order by contype, conname;
