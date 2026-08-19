-- E11 · Separación de los cuatro niveles de alcance
--
-- Objetivo: NO atribuir a PostgREST un comportamiento que en realidad venga de
-- privilegios de PostgreSQL o de RLS. Cada tabla aísla un nivel:
--
--   1. schema expuesto por la Data API   -> l1_hidden_schema
--   2. objeto existente en ese schema    -> las tres de `public`
--   3. GRANT para anon / authenticated   -> l3_no_grant
--   4. RLS y sus políticas               -> l4_rls_sin_politica
--
-- Es un sondeo desechable. No deduce ninguna estrategia de schemas ni de grants
-- para Nomey: solo mide qué hace el stack tal y como lo deja `supabase init`.

begin;

drop schema if exists e11_hidden cascade;
drop table if exists public.e11_l3_no_grant;
drop table if exists public.e11_l4_rls_sin_politica;
drop table if exists public.e11_l4_rls_con_politica;

-- NIVEL 1 · Schema no listado en `api.schemas` de config.toml.
-- Se le dan grants completos y RLS permisiva a propósito: si aun así resulta
-- inalcanzable, lo que lo impide es la exposición del schema, no el privilegio.
create schema e11_hidden;
grant usage on schema e11_hidden to anon, authenticated;

create table e11_hidden.secreto (id integer primary key, dato text);
insert into e11_hidden.secreto values (1, 'no deberia verse');
alter table e11_hidden.secreto enable row level security;
create policy todo on e11_hidden.secreto for select using (true);
grant select on e11_hidden.secreto to anon, authenticated;

-- NIVEL 3 · Tabla en `public` (schema expuesto) SIN grant a los roles cliente.
create table public.e11_l3_no_grant (id integer primary key, dato text);
insert into public.e11_l3_no_grant values (1, 'sin grant');
alter table public.e11_l3_no_grant enable row level security;
create policy todo on public.e11_l3_no_grant for select using (true);
-- deliberadamente sin GRANT

-- NIVEL 4a · Con grant, RLS activada, SIN ninguna política.
create table public.e11_l4_rls_sin_politica (id integer primary key, dato text);
insert into public.e11_l4_rls_sin_politica values (1, 'rls sin politica');
alter table public.e11_l4_rls_sin_politica enable row level security;
grant select on public.e11_l4_rls_sin_politica to anon, authenticated;

-- NIVEL 4b · Con grant, RLS activada, política que filtra por valor.
create table public.e11_l4_rls_con_politica (id integer primary key, dato text);
insert into public.e11_l4_rls_con_politica values (1, 'visible'), (2, 'oculta');
alter table public.e11_l4_rls_con_politica enable row level security;
create policy solo_visible on public.e11_l4_rls_con_politica
  for select using (dato = 'visible');
grant select on public.e11_l4_rls_con_politica to anon, authenticated;

commit;
