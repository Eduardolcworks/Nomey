-- E12 · Objetos desechables del sondeo. Idempotente: hace drop antes de crear.
--
-- Aisla las variables de D4:
--   public   vs  schema propio no expuesto      -> pregunta 4
--   tabla    vs  funcion  vs  secuencia         -> forma del objeto
--   anon     vs  authenticated                  -> pregunta 5
--
-- Ningun GRANT explicito a roles cliente, salvo los del banco de pruebas
-- `e12_playground`, que existe solo para poder intentar operaciones COMO anon.
--
-- NO ES UNA MIGRACION.

\pset pager off

begin;

drop schema if exists e12_internal cascade;
drop schema if exists e12_playground cascade;
drop table if exists public.e12_public_plain cascade;
drop table if exists public.e12_public_rls cascade;
drop table if exists public.e12_public_serial cascade;
drop function if exists public.e12_public_fn();

-- ---------------------------------------------------------------------------
-- A · public, tabla normal, SIN ningun grant escrito por nosotros
-- ---------------------------------------------------------------------------
create table public.e12_public_plain (id integer primary key, dato text);
insert into public.e12_public_plain values (1, 'fila de sondeo');

-- ---------------------------------------------------------------------------
-- B · public, tabla con RLS ACTIVADA y SIN ninguna politica
--     Sirve para separar "la RLS protege" de "el privilegio no existe".
-- ---------------------------------------------------------------------------
create table public.e12_public_rls (id integer primary key, dato text);
insert into public.e12_public_rls values (1, 'protegida por RLS sin politica');
alter table public.e12_public_rls enable row level security;

-- ---------------------------------------------------------------------------
-- C · public, tabla con secuencia propia (bigserial)
-- ---------------------------------------------------------------------------
create table public.e12_public_serial (id bigserial primary key, dato text);
insert into public.e12_public_serial (dato) values ('con secuencia');

-- ---------------------------------------------------------------------------
-- D · public, funcion SIN grant explicito
-- ---------------------------------------------------------------------------
create function public.e12_public_fn() returns text
language sql stable
as $$ select 'ejecutada en public'::text $$;

-- ---------------------------------------------------------------------------
-- E · schema propio NO expuesto por la Data API, con tabla y funcion
--     Sin USAGE para roles cliente: es el control de la pregunta 4.
-- ---------------------------------------------------------------------------
create schema e12_internal;

create table e12_internal.e12_internal_plain (id integer primary key, dato text);
insert into e12_internal.e12_internal_plain values (1, 'fila interna');

create function e12_internal.e12_internal_fn() returns text
language sql stable
as $$ select 'ejecutada en e12_internal'::text $$;

-- ---------------------------------------------------------------------------
-- F · schema propio con USAGE concedido, para separar dos hipotesis:
--     "no llega porque falta USAGE" vs "no llega porque falta EXECUTE".
-- ---------------------------------------------------------------------------
create schema e12_playground;
grant usage on schema e12_playground to anon, authenticated;

create function e12_playground.e12_usable_fn() returns text
language sql stable
as $$ select 'ejecutada en e12_playground'::text $$;

create table e12_playground.e12_trigger_log (
  id serial primary key,
  quien text,
  cuando timestamptz default now()
);
-- El log lo escribe un trigger creado por anon; anon necesita poder insertar.
grant insert, select on e12_playground.e12_trigger_log to anon, authenticated;
grant usage, select on sequence e12_playground.e12_trigger_log_id_seq to anon, authenticated;

-- CREATE en el banco de pruebas: sin esto no se puede intentar REFERENCES ni
-- TRIGGER como anon, y confundiriamos "no puede crear objetos" con "no tiene
-- el privilegio que estamos midiendo".
grant create on schema e12_playground to anon;

commit;

\echo '=== objetos e12 creados ==='
select n.nspname, c.relname, c.relkind, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relname like 'e12%' or n.nspname like 'e12%'
order by 1, 2;
