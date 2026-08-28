-- E21 · La frontera de privilegio del provisioning del Modo Personal.
--
-- Uso, desde Ubuntu o desde Windows con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/e21/privilege-boundary.sql
--
-- ESTO ES EVIDENCIA, NO NORMA, Y NO ES UNA MIGRACION.
--
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK: no crea el rol
-- definitivo, no siembra monedas y no deja ninguna fila. El rol que crea se
-- llama `probe_provisioner` justamente para que no pueda confundirse con el que
-- propondra la migracion.
--
-- Las cinco preguntas, en su forma operativa:
--
--   A · ¿`sec.request_actor_id()` funciona dentro de un SECURITY DEFINER cuyo
--       owner es un rol NOLOGIN/NOBYPASSRLS y no propietario de tablas?
--       E16 midio que `auth.uid()` NO lo hace para `nomey_writer`.
--   B · ¿Funciona ademas dentro de una POLICY RLS evaluada durante esa funcion?
--       De esto depende que la barrera pueda acotarse al actor.
--   C · Con la policy acotada, ¿puede el provisioner crear la membresia del
--       actor en SU ambito y le es imposible crear una ajena? Y antes: ¿que
--       ocurre si la subconsulta de esa policy lee una tabla sobre la que el
--       provisioner NO tiene policy de SELECT?
--   D · Con la policy acotada, ¿puede cambiar la moneda de SU ambito vacio, le
--       es imposible tocar uno ajeno, y la FK compuesta detiene el cambio en
--       cuanto existe un efecto?
--   E · Sin policy de SELECT sobre `core.effect`, ¿la comprobacion de "ambito
--       vacio" devuelve CERO FILAS SIN ERROR? Es el modo de fallo que haria
--       pasar por vacio un ambito ocupado.

\pset pager off
\set ON_ERROR_STOP on

begin;

create temporary table e21_result (
  id      text primary key,
  outcome text not null,
  detail  text
) on commit drop;

-- =========================================================== 0 · montaje ====

create role probe_provisioner nologin nobypassrls nosuperuser nocreatedb nocreaterole;
grant probe_provisioner to postgres;

create schema probe;
grant usage on schema probe to authenticated;

-- Identidades y ambitos de prueba. Se siembra como `postgres`, que es
-- exactamente lo que hoy hacen los checks y lo que hara el provisioning.
create temporary table e21_fixture (k text primary key, v uuid) on commit drop;
insert into e21_fixture (k, v) values
  ('u1',   '11111111-1111-4111-8111-111111111111'),
  ('u2',   '22222222-2222-4222-8222-222222222222'),
  ('cd_a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('cd_b', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('s1',   '55555555-0000-4000-8000-000000000001'),
  ('s2',   '55555555-0000-4000-8000-000000000002'),
  ('op',   '66666666-0000-4000-8000-000000000001'),
  ('ov',   '66666666-0000-4000-8000-000000000002');

insert into core.currency_definition (id, code, scale)
select v, 'AAA', 2 from e21_fixture where k = 'cd_a';
insert into core.currency_definition (id, code, scale)
select v, 'BBB', 2 from e21_fixture where k = 'cd_b';

-- s1 pertenece a u1 y esta VACIO. s2 pertenece a u2.
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from e21_fixture where k = 's1'), 'personal',
       (select v from e21_fixture where k = 'cd_a'),
       (select v from e21_fixture where k = 'u1');
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from e21_fixture where k = 's2'), 'personal',
       (select v from e21_fixture where k = 'cd_a'),
       (select v from e21_fixture where k = 'u2');

-- Privilegios minimos del rol de prueba, calcados de los de `nomey_writer`.
grant usage on schema core to probe_provisioner;
grant usage on schema sec  to probe_provisioner;
grant select on core.scope  to probe_provisioner;
grant select on core.effect to probe_provisioner;
grant insert on core.membership to probe_provisioner;
grant update (base_currency_definition_id) on core.scope to probe_provisioner;

-- ============================================ A · el actor en el definer ====
--
-- A1 mide el caso SIN el `EXECUTE` sobre el helper, para saber si el fallo es
-- de privilegio o de semantica. A2 mide el caso con el grant.

create function probe.actor_no_grant() returns uuid
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  return sec.request_actor_id();
end
$fn$;

create function probe.actor_with_grant() returns uuid
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  return sec.request_actor_id();
end
$fn$;

grant create on schema probe to probe_provisioner;
alter function probe.actor_no_grant()   owner to probe_provisioner;
alter function probe.actor_with_grant() owner to probe_provisioner;
revoke create on schema probe from probe_provisioner;

revoke execute on function probe.actor_no_grant()   from public;
revoke execute on function probe.actor_with_grant() from public;
grant  execute on function probe.actor_no_grant()   to authenticated;
grant  execute on function probe.actor_with_grant() to authenticated;

do $a$
declare
  v_u1  uuid := (select v from e21_fixture where k = 'u1');
  v_got uuid;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_u1::text)::text, true);

  -- A1 · sin EXECUTE sobre sec.request_actor_id().
  begin
    perform set_config('role', 'authenticated', true);
    v_got := probe.actor_no_grant();
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('A1', 'DEVUELVE', v_got::text);
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('A1', 'ERROR', sqlstate || ' ' || sqlerrm);
  end;

  -- A2 · con EXECUTE.
  grant execute on function sec.request_actor_id() to probe_provisioner;
  begin
    perform set_config('role', 'authenticated', true);
    v_got := probe.actor_with_grant();
    perform set_config('role', 'postgres', true);
    insert into e21_result values
      ('A2', case when v_got = v_u1 then 'DEVUELVE-EL-SUB' else 'DEVUELVE-OTRA-COSA' end,
       v_got::text);
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('A2', 'ERROR', sqlstate || ' ' || sqlerrm);
  end;
end
$a$;

-- ======================================= B · el actor dentro de la policy ===
--
-- La pregunta central: una policy ALMACENADA que llama a `sec.request_actor_id()`
-- y que se evalua mientras `current_user` es el owner del definer.

alter table core.membership enable row level security;

create policy probe_membership_insert on core.membership
  for insert to probe_provisioner
  with check (
    user_id = sec.request_actor_id()
    and exists (
      select 1 from core.scope s
      where s.id = membership.scope_id
        and s.kind = 'personal'
        and s.owner_user_id = sec.request_actor_id()
    )
  );

create function probe.add_membership(p_scope uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  insert into core.membership (scope_id, user_id) values (p_scope, p_user);
end
$fn$;

grant create on schema probe to probe_provisioner;
alter function probe.add_membership(uuid, uuid) owner to probe_provisioner;
revoke create on schema probe from probe_provisioner;
revoke execute on function probe.add_membership(uuid, uuid) from public;
grant  execute on function probe.add_membership(uuid, uuid) to authenticated;

do $b$
declare
  v_u1 uuid := (select v from e21_fixture where k = 'u1');
  v_u2 uuid := (select v from e21_fixture where k = 'u2');
  v_s1 uuid := (select v from e21_fixture where k = 's1');
  v_s2 uuid := (select v from e21_fixture where k = 's2');
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_u1::text)::text, true);

  -- B1 · la MISMA insercion legitima, pero SIN policy de SELECT sobre
  -- `core.scope` para el provisioner. La subconsulta del WITH CHECK esta
  -- sujeta a la RLS del rol que la evalua, asi que no ve la fila y el EXISTS
  -- es falso. Falla CERRADO, que es la direccion segura, pero hace imposible
  -- el provisioning con un error que no dice cual es la causa.
  begin
    perform set_config('role', 'authenticated', true);
    perform probe.add_membership(v_s1, v_u1);
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('B1', 'ACEPTADA', 'sin policy de select sobre scope');
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('B1', 'RECHAZADA-FALLA-CERRADO', sqlstate || ' ' || sqlerrm);
  end;

  -- El provisioner necesita ver la fila del ambito para que su propia policy
  -- pueda razonar sobre ella.
  create policy probe_scope_select on core.scope
    for select to probe_provisioner
    using (kind = 'personal' and owner_user_id = sec.request_actor_id());

  -- C1 · la membresia PROPIA en el ambito PROPIO, ya con la policy.
  begin
    perform set_config('role', 'authenticated', true);
    perform probe.add_membership(v_s1, v_u1);
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('C1', 'ACEPTADA', 'propia en ambito propio');
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('C1', 'ERROR', sqlstate || ' ' || sqlerrm);
  end;

  -- C2 · membresia de OTRO usuario en el ambito propio.
  begin
    perform set_config('role', 'authenticated', true);
    perform probe.add_membership(v_s1, v_u2);
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('C2', 'ACEPTADA-FUGA', 'user ajeno en ambito propio');
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('C2', 'RECHAZADA', sqlstate);
  end;

  -- C3 · membresia propia en el ambito de OTRO.
  begin
    perform set_config('role', 'authenticated', true);
    perform probe.add_membership(v_s2, v_u1);
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('C3', 'ACEPTADA-FUGA', 'ambito ajeno');
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('C3', 'RECHAZADA', sqlstate);
  end;
end
$b$;

-- ================================== D · el cambio de moneda, acotado =======

create policy probe_scope_currency on core.scope
  for update to probe_provisioner
  using (kind = 'personal' and owner_user_id = sec.request_actor_id())
  with check (kind = 'personal' and owner_user_id = sec.request_actor_id());

create function probe.set_currency(p_scope uuid, p_currency uuid) returns integer
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_n integer;
begin
  update core.scope set base_currency_definition_id = p_currency where id = p_scope;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

grant create on schema probe to probe_provisioner;
alter function probe.set_currency(uuid, uuid) owner to probe_provisioner;
revoke create on schema probe from probe_provisioner;
revoke execute on function probe.set_currency(uuid, uuid) from public;
grant  execute on function probe.set_currency(uuid, uuid) to authenticated;

do $d$
declare
  v_u1 uuid := (select v from e21_fixture where k = 'u1');
  v_s1 uuid := (select v from e21_fixture where k = 's1');
  v_s2 uuid := (select v from e21_fixture where k = 's2');
  v_b  uuid := (select v from e21_fixture where k = 'cd_b');
  v_a  uuid := (select v from e21_fixture where k = 'cd_a');
  v_n  integer;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_u1::text)::text, true);

  -- D1 · ambito propio y vacio.
  begin
    perform set_config('role', 'authenticated', true);
    v_n := probe.set_currency(v_s1, v_b);
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('D1', case when v_n = 1 then 'CAMBIADA' else 'CERO-FILAS' end, v_n::text);
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('D1', 'ERROR', sqlstate || ' ' || sqlerrm);
  end;

  -- D2 · ambito AJENO. La forma del rechazo importa: una policy USING que no
  -- case NO lanza, devuelve cero filas.
  begin
    perform set_config('role', 'authenticated', true);
    v_n := probe.set_currency(v_s2, v_b);
    perform set_config('role', 'postgres', true);
    insert into e21_result values
      ('D2', case when v_n = 0 then 'CERO-FILAS-SIN-ERROR' else 'CAMBIADA-FUGA' end, v_n::text);
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('D2', 'ERROR', sqlstate || ' ' || sqlerrm);
  end;

  -- Se devuelve s1 a su moneda original y se le pone un efecto.
  update core.scope set base_currency_definition_id = v_a where id = v_s1;

  insert into core.operation (id, operation_class, created_by, current_version_id)
  select (select v from e21_fixture where k = 'op'), 'personal_expense', v_u1,
         (select v from e21_fixture where k = 'ov');
  insert into core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by,
     effective_date, original_amount, original_currency_definition_id, economic_rules_version)
  select (select v from e21_fixture where k = 'ov'), (select v from e21_fixture where k = 'op'),
         1, null, v_u1, date '2026-08-28', 2000, v_a, 'v1';
  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  select gen_random_uuid(), (select v from e21_fixture where k = 'ov'), v_s1,
         'expense', v_a, -2000;

  -- D3 · ambito propio CON un efecto. La FK compuesta es la ultima autoridad.
  begin
    perform set_config('role', 'authenticated', true);
    v_n := probe.set_currency(v_s1, v_b);
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('D3', 'CAMBIADA-FUGA', v_n::text);
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into e21_result values ('D3', 'RECHAZADA-POR-FK', sqlstate || ' ' || sqlerrm);
  end;
end
$d$;

-- ============================ E · el modo de fallo silencioso ===============
--
-- `core.effect` tiene RLS activada. Con GRANT SELECT y SIN policy aplicable, la
-- lectura no falla: devuelve cero filas. Un `NOT EXISTS` construido sobre esa
-- lectura declararia VACIO un ambito que tiene efectos.

create function probe.count_effects(p_scope uuid) returns integer
language plpgsql stable security definer set search_path = ''
as $fn$
declare
  v_n integer;
begin
  select count(*) into v_n from core.effect e where e.scope_id = p_scope;
  return v_n;
end
$fn$;

grant create on schema probe to probe_provisioner;
alter function probe.count_effects(uuid) owner to probe_provisioner;
revoke create on schema probe from probe_provisioner;
revoke execute on function probe.count_effects(uuid) from public;
grant  execute on function probe.count_effects(uuid) to authenticated;

do $e$
declare
  v_u1 uuid := (select v from e21_fixture where k = 'u1');
  v_s1 uuid := (select v from e21_fixture where k = 's1');
  v_n  integer;
  v_real integer;
begin
  select count(*) into v_real from core.effect where scope_id = v_s1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_u1::text)::text, true);

  -- E1 · SIN policy de SELECT sobre core.effect para el provisioner.
  perform set_config('role', 'authenticated', true);
  v_n := probe.count_effects(v_s1);
  perform set_config('role', 'postgres', true);
  insert into e21_result values
    ('E1', case when v_n = 0 and v_real > 0 then 'CERO-FILAS-SIN-ERROR' else 'VE-' || v_n end,
     format('reales=%s vistos=%s', v_real, v_n));

  -- E2 · con la policy.
  create policy probe_effect_select on core.effect
    for select to probe_provisioner using (true);

  perform set_config('role', 'authenticated', true);
  v_n := probe.count_effects(v_s1);
  perform set_config('role', 'postgres', true);
  insert into e21_result values
    ('E2', case when v_n = v_real then 'VE-LOS-REALES' else 'DISCREPA' end,
     format('reales=%s vistos=%s', v_real, v_n));
end
$e$;

-- =============================================================== informe ====

\echo ''
\echo '=================== E21 · frontera de privilegio ==================='
select id, outcome, detail from e21_result order by id;
\echo ''

rollback;
