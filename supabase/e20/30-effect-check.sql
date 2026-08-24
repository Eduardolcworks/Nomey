-- E20-B · La pregunta central: ¿puede existir un WITH CHECK no trivial y util
-- sobre `effect` durante la secuencia autoritativa?
--
-- El predicado candidato instalado en 10-setup.sql es:
--   el efecto cuelga de una version atribuida al MISMO actor de la peticion.
--
-- Se mide si es satisfacible con filas insertadas en la misma transaccion, si
-- rechaza lo que debe rechazar, si acepta lo que ADR-002 §10 exige aceptar, y
-- que privilegios son realmente necesarios para que se evalue.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== semilla: una operacion y una version COMPROMETIDAS del actor B ==='
\echo '    Se insertan como propietario, que no esta sujeto a RLS (sin FORCE).'
begin;
insert into e20_core.operation (id, operation_class, created_by, current_version_id)
values ('a0000020-0000-4000-8000-000000000000', 'probe',
        '22222222-2222-4222-8222-222222222222',
        'b0000020-0000-4000-8000-000000000000')
on conflict do nothing;
insert into e20_core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by)
values ('b0000020-0000-4000-8000-000000000000',
        'a0000020-0000-4000-8000-000000000000', 1, null,
        '22222222-2222-4222-8222-222222222222')
on conflict do nothing;
commit;

\echo ''
\echo '=== B1 · efecto que cuelga de una version insertada EN LA MISMA TRANSACCION ==='
\echo '    Es la pregunta operativa: ¿ve el subselect de la politica una fila'
\echo '    que la propia transaccion acaba de insertar y aun no ha confirmado?'
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  insert into e20_core.operation (id, operation_class, created_by, current_version_id)
  values ('a0000021-0000-4000-8000-000000000000', 'probe', v_actor::uuid,
          'b0000021-0000-4000-8000-000000000000');
  insert into e20_core.operation_version
    (id, operation_id, version_no, supersedes_version_id, created_by)
  values ('b0000021-0000-4000-8000-000000000000',
          'a0000021-0000-4000-8000-000000000000', 1, null, v_actor::uuid);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000021-0000-4000-8000-000000000000',
            'b0000021-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'B1  ACEPTADO   <-- el WITH CHECK ve la version no confirmada';
  exception when others then
    raise notice 'B1  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== B2 · efecto que cuelga de una version COMPROMETIDA DE OTRO ACTOR ==='
\echo '    Es lo que el predicado debe rechazar.'
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000022-0000-4000-8000-000000000000',
            'b0000020-0000-4000-8000-000000000000',   -- version del actor B
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'B2  ACEPTADO   <-- el predicado NO discrimina';
  exception when others then
    raise notice 'B2  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== B3 · efecto que cuelga de una version PROPIA ya comprometida ==='
\echo '    Comprueba que el predicado no es "misma transaccion" sino "misma'
\echo '    atribucion": debe aceptarse.'
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000023-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',   -- V1 de A1, ya confirmada
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'B3  ACEPTADO';
  exception when others then
    raise notice 'B3  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== B4 · efecto sobre un AMBITO AJENO, colgando de una version propia ==='
\echo '    ADR-002 §10 permite deliberadamente producir efectos sobre el ambito'
\echo '    de otro. Un predicado correcto DEBE aceptarlo.'
begin;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000024-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');  -- ambito ajeno
    raise notice 'B4  ACEPTADO';
  exception when others then
    raise notice 'B4  RECHAZADO  sqlstate=%  %  <-- rechazaria escrituras legitimas', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== B5 · minimalidad: sin la POLITICA de SELECT del writer sobre la version ==='
\echo '    El WITH CHECK de effect lee operation_version. Si esa lectura pasa por'
\echo '    la RLS, retirar la politica lo vuelve insatisfacible.'
begin;
drop policy p_ov_writer_sel on e20_core.operation_version;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000025-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'B5  ACEPTADO   <-- el subselect de la politica NO pasa por la RLS';
  exception when others then
    raise notice 'B5  RECHAZADO  sqlstate=%  %  <-- la politica de SELECT es portante', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- restaura la politica

\echo ''
\echo '=== B6 · minimalidad: sin el GRANT SELECT del writer sobre la version ==='
begin;
revoke select on e20_core.operation_version from e20_writer;
do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000026-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'B6  ACEPTADO   <-- el subselect no exige el grant';
  exception when others then
    raise notice 'B6  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- restaura el grant

\echo ''
\echo '=== B7 · el predicado que ADR-013 descarta: aislamiento por AMBITO ==='
\echo '    Se instala temporalmente "el actor es miembro del ambito del efecto"'
\echo '    y se repite B4. Si lo rechaza, queda medido por que no sirve.'
begin;
create table e20_core.scope_membership (
  scope_id uuid not null,
  user_id  uuid not null,
  primary key (scope_id, user_id)
);
insert into e20_core.scope_membership values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');
grant select on e20_core.scope_membership to e20_writer;

drop policy p_ef_writer_ins on e20_core.effect;
create policy p_ef_writer_ins on e20_core.effect
  for insert to e20_writer
  with check (
    exists (select 1 from e20_core.scope_membership m
             where m.scope_id = effect.scope_id
               and m.user_id  = e20_sec.request_actor_id())
  );

do $probe$
declare v_actor text := '11111111-1111-4111-8111-111111111111';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000027-0000-4000-8000-000000000000',
            'b0000001-0000-4000-8000-000000000000',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');  -- ambito ajeno, legitimo
    raise notice 'B7  ACEPTADO';
  exception when others then
    raise notice 'B7  RECHAZADO  sqlstate=%  %  <-- confirma ADR-013 §10', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- retira la tabla y restaura la politica original

\echo ''
\echo '=== politica de effect vigente tras B5-B7 (debe ser la original) ==='
select p.polname,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check
from pg_policy p
where p.polrelid = 'e20_core.effect'::regclass;

\echo ''
\echo '=== efectos realmente persistidos (todos los casos B hicieron rollback) ==='
select e.id, e.operation_version_id, e.scope_id from e20_core.effect e order by 1;
