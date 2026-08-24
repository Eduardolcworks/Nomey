-- E20 · Montaje minimo para medir las politicas RLS del writer autoritativo
-- durante la secuencia de escritura, y en particular el WITH CHECK de effect.
--
-- Maqueta a escala de juguete de la forma que fijan ADR-011 y ADR-013. Las
-- columnas de negocio NO estan: no se mide contabilidad, se miden politicas.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off

-- Teardown previo para poder reaplicar.
drop schema if exists e20_api  cascade;
drop schema if exists e20_sec  cascade;
drop schema if exists e20_core cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'e20_writer') then
    execute 'drop owned by e20_writer cascade';
    execute 'drop role e20_writer';
  end if;
end $$;

begin;

create schema e20_core;
create schema e20_sec;
create schema e20_api;

-- El writer de ADR-009 §5: NOLOGIN, NOBYPASSRLS, no propietario, sin DDL.
create role e20_writer nologin nobypassrls nosuperuser nocreatedb nocreaterole;

-- Ceder la propiedad de una funcion exige ser miembro del rol destino, y
-- `postgres` NO es superusuario en este stack (medido en E16 y E17).
grant e20_writer to postgres;

-- ---------------------------------------------------------------- tablas ---
-- Forma de ADR-011 §4 y ADR-013 §2, §3 y §8, reducida a lo que interviene en
-- la secuencia. Sin importes, sin dimensiones, sin ambito en operation.

create table e20_core.operation (
  id                 uuid primary key,
  operation_class    text not null,
  created_by         uuid not null,
  current_version_id uuid not null            -- NOT NULL desde el primer INSERT
);

create table e20_core.operation_version (
  id                    uuid primary key,
  operation_id          uuid not null references e20_core.operation(id),
  version_no            int  not null,
  supersedes_version_id uuid,
  created_by            uuid not null,
  constraint e20_ov_op_id_unique      unique (operation_id, id),
  constraint e20_ov_version_no_unico  unique (operation_id, version_no),
  constraint e20_ov_version_positivo  check  (version_no >= 1),
  constraint e20_ov_primera_version   check  ((version_no = 1) = (supersedes_version_id is null)),
  constraint e20_ov_supersedes_misma_op foreign key (operation_id, supersedes_version_id)
    references e20_core.operation_version (operation_id, id)
);

-- El puntero de vigencia: FK compuesta y DIFERIBLE (ADR-011 §4, medido en E17).
alter table e20_core.operation
  add constraint e20_op_current_version_fk
  foreign key (id, current_version_id)
  references e20_core.operation_version (operation_id, id)
  deferrable initially deferred;

create table e20_core.effect (
  id                   uuid primary key,
  operation_version_id uuid not null references e20_core.operation_version(id),
  scope_id             uuid not null
);

alter table e20_core.operation         enable row level security;
alter table e20_core.operation_version enable row level security;
alter table e20_core.effect            enable row level security;

-- ---------------------------------------------------------------- helper ---
-- Equivalente reducido de sec.request_actor_id() (ADR-009 §3): STABLE,
-- SECURITY INVOKER, sin parametro de usuario, y falla cerrado.

create function e20_sec.request_actor_id() returns uuid
language plpgsql stable security invoker set search_path = ''
as $fn$
declare v_raw text; v_sub text;
begin
  v_raw := nullif(current_setting('request.jwt.claims', true), '');
  if v_raw is null then
    raise exception 'sin identidad en la peticion' using errcode = '42501';
  end if;
  v_sub := (v_raw::jsonb) ->> 'sub';
  if v_sub is null then
    raise exception 'claims sin sub' using errcode = '42501';
  end if;
  return v_sub::uuid;
end $fn$;

revoke execute on function e20_sec.request_actor_id() from public;
grant  execute on function e20_sec.request_actor_id() to e20_writer;
-- USAGE se concede porque el CUERPO de la funcion autoritativa invoca el helper
-- directamente. 50-helper.sql mide que la evaluacion DENTRO de una politica no
-- lo necesita.
grant usage on schema e20_sec to e20_writer;

-- ------------------------------------------------- privilegios del writer ---
grant usage on schema e20_core to e20_writer;

grant select, insert on e20_core.operation         to e20_writer;
grant select, insert on e20_core.operation_version to e20_writer;
grant select, insert on e20_core.effect            to e20_writer;

-- El estrechamiento por COLUMNA es un grant, no una politica: la RLS decide
-- filas y no puede ocultar ni proteger columnas. 40- lo mide.
grant update (current_version_id) on e20_core.operation to e20_writer;

-- ------------------------------------------- politicas minimas del writer ---
-- Separadas POR COMANDO y POR ROL (ADR-013 §10). Ninguna aplicable a PUBLIC.

-- operation
create policy p_op_writer_ins on e20_core.operation
  for insert to e20_writer
  with check (created_by = e20_sec.request_actor_id());

-- OJO: estas dos son la LINEA BASE MEDIDA, no la politica decidida. Derivan de
-- la autoria original, y 60-attribution.sql mide que eso impide que otro actor
-- autorizado corrija la operacion. ADR-013 §10 decidio lo contrario: ninguna
-- politica del writer deriva de `operation.created_by`. Se conservan aqui
-- porque son lo que midieron A1-A5; NO se copian a una migracion.
create policy p_op_writer_sel on e20_core.operation
  for select to e20_writer
  using (created_by = e20_sec.request_actor_id());

-- WITH CHECK omitido a proposito: PostgreSQL lo hace igual al USING. Se mide.
create policy p_op_writer_upd on e20_core.operation
  for update to e20_writer
  using (created_by = e20_sec.request_actor_id());

-- operation_version
create policy p_ov_writer_ins on e20_core.operation_version
  for insert to e20_writer
  with check (created_by = e20_sec.request_actor_id());

-- OJO: tambien es LINEA BASE MEDIDA, no la politica decidida. 70-cross-author.sql
-- mide que restringir esta lectura por atribucion impide corregir la version de
-- otro actor, y que el fallo es NULL en vez de error. ADR-013 §10 decidio una
-- lectura amplia para el writer. Se conserva porque es lo que midieron B5 y F1.
create policy p_ov_writer_sel on e20_core.operation_version
  for select to e20_writer
  using (created_by = e20_sec.request_actor_id());

-- effect  <-- LA PREGUNTA CENTRAL DE E20
-- El predicado NO aisla por ambito: ADR-002 §10 permite efectos sobre el
-- ambito de otro. Lo que comprueba es que el efecto cuelga de una version
-- atribuida al mismo actor de la peticion, leyendo filas que la propia
-- transaccion acaba de insertar.
create policy p_ef_writer_ins on e20_core.effect
  for insert to e20_writer
  with check (
    exists (
      select 1
      from e20_core.operation_version ov
      where ov.id = effect.operation_version_id
        and ov.created_by = e20_sec.request_actor_id()
    )
  );

-- Deliberadamente SIN politica de SELECT sobre effect: 40- mide si
-- INSERT ... RETURNING la exige.

-- ----------------------------------------- la frontera autoritativa (API) ---
-- OJO: esta funcion NO valida que la atribucion coincida con el actor. La
-- frontera real SI lo hace (primera barrera, ADR-009 §6). Se omite A PROPOSITO
-- para que la segunda barrera —la RLS— sea observable.

create function e20_api.run_sequence(
  p_op        uuid,
  p_ver       uuid,
  p_eff       uuid,
  p_scope     uuid,
  p_attr      uuid    default null,   -- atribucion; null = actor de la peticion
  p_eff_ver   uuid    default null,   -- version del efecto; null = p_ver
  p_returning boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_actor  uuid;
  v_attr   uuid;
  v_effver uuid;
  v_paso   text := '(ninguno)';
  v_leida  uuid;
  v_ret    uuid;
begin
  v_actor  := e20_sec.request_actor_id();
  v_attr   := coalesce(p_attr, v_actor);
  v_effver := coalesce(p_eff_ver, p_ver);

  begin
    v_paso := '1 INSERT operation';
    insert into e20_core.operation (id, operation_class, created_by, current_version_id)
    values (p_op, 'probe', v_attr, p_ver);

    v_paso := '2 INSERT operation_version';
    insert into e20_core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by)
    values (p_ver, p_op, 1, null, v_attr);

    v_paso := '3 INSERT effect';
    if p_returning then
      insert into e20_core.effect (id, operation_version_id, scope_id)
      values (p_eff, v_effver, p_scope)
      returning id into v_ret;
    else
      insert into e20_core.effect (id, operation_version_id, scope_id)
      values (p_eff, v_effver, p_scope);
    end if;

    v_paso := '4 SELECT ... FOR UPDATE';
    select o.current_version_id into v_leida
    from e20_core.operation o where o.id = p_op for update;

    v_paso := '5 UPDATE current_version_id';
    update e20_core.operation set current_version_id = p_ver where id = p_op;

    return jsonb_build_object(
      'resultado', 'OK', 'actor', v_actor, 'atribucion', v_attr,
      'leido_paso_4', v_leida, 'returning', v_ret);
  exception when others then
    return jsonb_build_object(
      'resultado', 'ERROR', 'paso', v_paso, 'sqlstate', sqlstate,
      'mensaje', sqlerrm, 'actor', v_actor, 'atribucion', v_attr);
  end;
end $fn$;

-- Correccion: crea V2 y MUEVE el puntero. Es el unico UPDATE del modelo.
create function e20_api.run_correction(
  p_op        uuid,
  p_prev_ver  uuid,
  p_new_ver   uuid,
  p_eff       uuid,
  p_scope     uuid,
  p_version_no int
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare v_actor uuid; v_paso text := '(ninguno)'; v_lock uuid;
begin
  v_actor := e20_sec.request_actor_id();
  begin
    v_paso := '1 SELECT ... FOR UPDATE sobre operation';
    select o.current_version_id into v_lock
    from e20_core.operation o where o.id = p_op for update;
    if v_lock is null then
      return jsonb_build_object('resultado','ERROR','paso',v_paso,
        'sqlstate','(sin excepcion)',
        'mensaje','0 filas visibles bajo la RLS del writer');
    end if;

    v_paso := '2 INSERT operation_version V2';
    insert into e20_core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by)
    values (p_new_ver, p_op, p_version_no, p_prev_ver, v_actor);

    v_paso := '3 INSERT effect de V2';
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values (p_eff, p_new_ver, p_scope);

    v_paso := '4 UPDATE current_version_id -> V2';
    update e20_core.operation set current_version_id = p_new_ver where id = p_op;

    return jsonb_build_object('resultado','OK','actor',v_actor,'puntero_previo',v_lock);
  exception when others then
    return jsonb_build_object('resultado','ERROR','paso',v_paso,
      'sqlstate',sqlstate,'mensaje',sqlerrm);
  end;
end $fn$;

-- Intento de tocar una columna que NO es el puntero.
create function e20_api.probe_update_class(p_op uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare v_n int;
begin
  update e20_core.operation set operation_class = 'MUTADA' where id = p_op;
  get diagnostics v_n = row_count;
  return jsonb_build_object('resultado','OK','filas_actualizadas',v_n);
exception when others then
  return jsonb_build_object('resultado','ERROR','sqlstate',sqlstate,'mensaje',sqlerrm);
end $fn$;

-- Lectura del estado bajo la RLS del writer.
create function e20_api.probe_state() returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
begin
  return jsonb_build_object(
    'actor',                e20_sec.request_actor_id(),
    'operaciones_visibles', (select count(*) from e20_core.operation),
    'versiones_visibles',   (select count(*) from e20_core.operation_version));
exception when others then
  return jsonb_build_object('resultado','ERROR','sqlstate',sqlstate,'mensaje',sqlerrm);
end $fn$;

-- Propiedad de las funciones: el writer. Ceder exige CREATE sobre el schema,
-- que se concede solo durante el despliegue y se retira acto seguido (E16).
grant create on schema e20_api to e20_writer;
alter function e20_api.run_sequence(uuid,uuid,uuid,uuid,uuid,uuid,boolean) owner to e20_writer;
alter function e20_api.run_correction(uuid,uuid,uuid,uuid,uuid,int)            owner to e20_writer;
alter function e20_api.probe_update_class(uuid)                            owner to e20_writer;
alter function e20_api.probe_state()                                       owner to e20_writer;
revoke create on schema e20_api from e20_writer;

-- Superficie del caller. El rol cliente NO recibe grants sobre e20_core.
grant usage on schema e20_api to authenticated;
revoke execute on function e20_api.run_sequence(uuid,uuid,uuid,uuid,uuid,uuid,boolean) from public;
revoke execute on function e20_api.run_correction(uuid,uuid,uuid,uuid,uuid,int)            from public;
revoke execute on function e20_api.probe_update_class(uuid)                            from public;
revoke execute on function e20_api.probe_state()                                       from public;
grant execute on function e20_api.run_sequence(uuid,uuid,uuid,uuid,uuid,uuid,boolean) to authenticated;
grant execute on function e20_api.run_correction(uuid,uuid,uuid,uuid,uuid,int)            to authenticated;
grant execute on function e20_api.probe_update_class(uuid)                            to authenticated;
grant execute on function e20_api.probe_state()                                       to authenticated;

commit;

\echo ''
\echo '=== atributos del writer ==='
select rolname, rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'e20_writer';

\echo ''
\echo '=== propiedad y RLS ==='
select c.relname as objeto, c.relowner::regrole::text as owner,
       c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'e20_core' and c.relkind = 'r'
order by 1;

\echo ''
\echo '=== politicas instaladas, y a quien aplican ==='
select c.relname as tabla, p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                     when 'w' then 'UPDATE' when 'd' then 'DELETE'
                     else 'ALL' end as comando,
       case when 0 = any(p.polroles) then 'PUBLIC  <-- PROHIBIDO en core'
            else (select string_agg(r.rolname, ', ')
                  from unnest(p.polroles) o join pg_roles r on r.oid = o) end as aplicable_a,
       pg_get_expr(p.polqual,      p.polrelid) is not null as tiene_using,
       pg_get_expr(p.polwithcheck, p.polrelid) is not null as tiene_with_check
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'e20_core'
order by 1, 3, 2;

\echo ''
\echo '=== grants de tabla del writer sobre e20_core ==='
select table_name, privilege_type
from information_schema.table_privileges
where grantee = 'e20_writer' and table_schema = 'e20_core'
order by 1, 2;

\echo ''
\echo '=== grants de COLUMNA (UPDATE) del writer ==='
select table_name, column_name, privilege_type
from information_schema.column_privileges
where grantee = 'e20_writer' and table_schema = 'e20_core' and privilege_type = 'UPDATE'
order by 1, 2;
