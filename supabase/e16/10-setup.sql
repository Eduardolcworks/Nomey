-- E16 · ¿La RLS protege dentro de un SECURITY DEFINER cuyo owner NO es superusuario?
--
-- El analisis de D7 afirmaba que "dentro de un SECURITY DEFINER la RLS de core no
-- protege nada". Esa afirmacion se hizo suponiendo un owner privilegiado. Aqui se
-- mide con un rol dedicado de minimo privilegio.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off

-- Teardown previo para poder reaplicar.
drop schema if exists e16_api  cascade;
drop schema if exists e16_core cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'e16_writer') then
    execute 'drop owned by e16_writer cascade';
    execute 'drop role e16_writer';
  end if;
end $$;

begin;

create schema e16_core;
create schema e16_api;

-- El rol dedicado: NOLOGIN, NOBYPASSRLS, sin DDL, sin superusuario.
create role e16_writer nologin nobypassrls nosuperuser nocreatedb nocreaterole;

-- Para poder ceder la PROPIEDAD de la funcion al writer, quien la crea debe ser
-- miembro del rol. `postgres` NO es superusuario en este stack [medido], asi que
-- sin esto `alter function ... owner to` falla con
-- `must be able to SET ROLE`. Es una consecuencia operativa real: las
-- migraciones tendran que hacerlo.
grant e16_writer to postgres;

create table e16_core.item (
  id      int primary key,
  visible boolean not null,
  dato    text not null
);

insert into e16_core.item values
  (1, true,  'fila VISIBLE'),
  (2, false, 'fila OCULTA');

alter table e16_core.item enable row level security;

-- Politica general: solo las filas marcadas visibles. Se aplica a cualquier rol
-- que ESTE sujeto a RLS.
create policy p_solo_visibles on e16_core.item
  for select using (visible);

-- Privilegios minimos del writer: USAGE sobre el schema y SELECT/INSERT sobre la
-- tabla. Nada mas. No es propietario de nada.
grant usage  on schema e16_core to e16_writer;
grant select, insert on e16_core.item to e16_writer;

-- Funcion autoritativa: propiedad del writer, search_path vacio, nombres
-- totalmente cualificados.
create function e16_api.inspeccionar() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_filas int; v_datos text; v_uid text; v_claims text;
begin
  select count(*), coalesce(string_agg(i.dato, ' | ' order by i.id), '(ninguna)')
    into v_filas, v_datos
  from e16_core.item i;

  begin
    v_uid := auth.uid()::text;
  exception when others then
    v_uid := 'ERROR: ' || sqlerrm;
  end;

  -- Via alternativa: leer el GUC directamente, sin tocar el schema auth.
  begin
    v_claims := current_setting('request.jwt.claims', true);
  exception when others then
    v_claims := 'ERROR: ' || sqlerrm;
  end;

  return jsonb_build_object(
    'current_user',  current_user,
    'session_user',  session_user,
    'filas_vistas',  v_filas,
    'datos',         v_datos,
    'auth_uid',      coalesce(v_uid, '(nulo)'),
    'sub_por_guc',   coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub', v_claims, '(nulo)')
  );
end $$;

-- Ceder la propiedad exige que el NUEVO owner tenga CREATE sobre el schema
-- [medido]. Se concede solo durante el despliegue y se retira acto seguido:
-- el writer queda sin DDL en regimen normal.
grant create on schema e16_api to e16_writer;
alter function e16_api.inspeccionar() owner to e16_writer;
revoke create on schema e16_api from e16_writer;

-- La superficie que invoca el caller. El caller NO recibe grants sobre e16_core.
grant usage on schema e16_api to authenticated;
revoke execute on function e16_api.inspeccionar() from public;
grant  execute on function e16_api.inspeccionar() to authenticated;

commit;

\echo ''
\echo '=== atributos del rol writer ==='
select rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
from pg_roles where rolname = 'e16_writer';

\echo ''
\echo '=== propiedad de los objetos ==='
select 'tabla e16_core.item' as objeto, relowner::regrole::text as owner,
       relrowsecurity as rls, relforcerowsecurity as force_rls
from pg_class where oid = 'e16_core.item'::regclass
union all
select 'funcion e16_api.inspeccionar', proowner::regrole::text, prosecdef, null
from pg_proc where proname = 'inspeccionar';

\echo ''
\echo '=== privilegios del caller sobre e16_core: deben ser NINGUNO ==='
select has_schema_privilege('authenticated','e16_core','USAGE')       as usage_core,
       has_table_privilege ('authenticated','e16_core.item','SELECT') as select_item;
