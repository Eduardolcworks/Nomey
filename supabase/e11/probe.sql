-- E11 · Sondeo de la frontera PostgreSQL -> PostgREST -> supabase-js -> TypeScript
--
-- NO es parte del esquema de Nomey. No vive en supabase/migrations/ a propósito:
-- es una estructura desechable para ejecutar el experimento que ADR-003 exige
-- como puerta de aceptacion. Se aplica y se retira con probe-teardown.sql.
--
-- Se crea en `public` porque es el esquema que la Data API expone por defecto,
-- y el objetivo es medir la frontera POR DEFECTO, no una configurada a medida.

begin;

drop view if exists public.e11_probe_text;
drop table if exists public.e11_probe;

create table public.e11_probe (
  id           integer primary key,
  label        text        not null,
  v_bigint     bigint,
  v_numeric    numeric,
  v_numeric_ps numeric(30, 12),
  v_text       text
);

comment on table public.e11_probe is
  'E11: tabla de sondeo desechable. No forma parte del modelo de Nomey.';

-- Casos. Los valores de v_text replican v_bigint como control: si el string
-- sobrevive y el numero no, la perdida esta en la serializacion, no en el dato.
insert into public.e11_probe (id, label, v_bigint, v_numeric, v_numeric_ps, v_text) values
  (1,  'importe pequeno 86,20 EUR',      8620,                  8620,                    8620,             '8620'),
  (2,  '2^53-1 (MAX_SAFE_INTEGER)',      9007199254740991,      9007199254740991,        null,             '9007199254740991'),
  (3,  '2^53',                           9007199254740992,      9007199254740992,        null,             '9007199254740992'),
  (4,  '2^53+1 (primero inseguro)',      9007199254740993,      9007199254740993,        null,             '9007199254740993'),
  (5,  'int64 maximo',                   9223372036854775807,   9223372036854775807,     null,             '9223372036854775807'),
  (6,  'negativo 2^53+1',               -9007199254740993,     -9007199254740993,        null,             '-9007199254740993'),
  (7,  'techo EUR de E2 (int64/100)',     92233720368547758,     92233720368547758,      null,             '92233720368547758'),
  (8,  'tipo de cambio 12 decimales',     null,                  0.862034781245,          0.862034781245,  '0.862034781245'),
  (9,  'tipo de cambio con ceros finales',null,                  1.163842000000,          1.163842000000,  '1.163842000000'),
  (10, 'numeric grande de E3',            null, 12345678901234567890.123456,              null,            '12345678901234567890.123456');

alter table public.e11_probe enable row level security;

-- Politica permisiva DELIBERADA: es una tabla de sondeo sin datos reales. Aun
-- asi se activa RLS, porque el proyecto no admite una tabla expuesta sin ella
-- ni siquiera como ejemplo temporal.
create policy e11_probe_read_all on public.e11_probe for select using (true);
create policy e11_probe_write_all on public.e11_probe for insert with check (true);

-- Grants explicitos: config.toml deja `auto_expose_new_tables` sin definir, asi
-- que una tabla nueva de `public` NO queda expuesta automaticamente.
grant select, insert on public.e11_probe to anon, authenticated;

-- Frontera alternativa 1: vista que castea a texto en el servidor.
create view public.e11_probe_text as
select
  id,
  label,
  v_bigint::text     as v_bigint_text,
  v_numeric::text    as v_numeric_text,
  v_numeric_ps::text as v_numeric_ps_text
from public.e11_probe;

grant select on public.e11_probe_text to anon, authenticated;

-- Frontera alternativa 2: RPC que devuelve json con los campos ya como texto.
create or replace function public.e11_probe_json(p_id integer)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select json_build_object(
    'id',           p.id,
    'label',        p.label,
    'v_bigint',     p.v_bigint::text,
    'v_numeric',    p.v_numeric::text,
    'v_numeric_ps', p.v_numeric_ps::text
  )
  from public.e11_probe p
  where p.id = p_id;
$$;

grant execute on function public.e11_probe_json(integer) to anon, authenticated;

-- Frontera alternativa 3: RPC que devuelve el tipo nativo sin castear, para
-- comprobar si el camino RPC serializa distinto que el camino tabla.
create or replace function public.e11_probe_raw_bigint(p_id integer)
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.v_bigint from public.e11_probe p where p.id = p_id;
$$;

grant execute on function public.e11_probe_raw_bigint(integer) to anon, authenticated;

-- Destino de la prueba de ida y vuelta de escritura.
drop table if exists public.e11_writeback;

create table public.e11_writeback (
  id           integer primary key,
  note         text,
  v_bigint     bigint,
  v_numeric_ps numeric(30, 12)
);

alter table public.e11_writeback enable row level security;
create policy e11_writeback_all on public.e11_writeback for all using (true) with check (true);
grant select, insert, update, delete on public.e11_writeback to anon, authenticated;

commit;
