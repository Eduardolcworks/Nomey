-- E20-F · La lectura de la versión anterior en una corrección por OTRO actor.
--
-- La decisión de producto dice que la autoría original no da exclusividad para
-- corregir: si Ana crea V1 y Beto está funcionalmente autorizado, Beto crea V2.
--
-- Pero construir V2 exige LEER V1. Las fuentes lo piden explicitamente:
--   ADR-011 §11 · supersedes_version_id debe ser exactamente la version vigente
--   ADR-011 §12 · la frontera "calcula el siguiente version_no"
--   ADR-013 §6  · una correccion HEREDA el FX congelado de la version anterior
--   ADR-013 §7  · conserva la intencion declarada que no se haya corregido
--   ADR-013 §5  · el reparto anterior cuelga de (version, ambito)
--
-- A5 y E2 NO midieron esa lectura: A5 se detuvo en el paso 1 sobre `operation`,
-- y E2 recibio version_no y supersedes como PARAMETROS. Aqui se mide.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== semilla: operacion de Ana con su V1, ambas COMPROMETIDAS ==='
begin;
insert into e20_core.operation (id, operation_class, created_by, current_version_id)
values ('a0000030-0000-4000-8000-000000000000', 'probe',
        '11111111-1111-4111-8111-111111111111',
        'b0000030-0000-4000-8000-000000000000')
on conflict do nothing;
insert into e20_core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by)
values ('b0000030-0000-4000-8000-000000000000',
        'a0000030-0000-4000-8000-000000000000', 1, null,
        '11111111-1111-4111-8111-111111111111')
on conflict do nothing;
commit;

\echo ''
\echo '=== F1 · Beto lee la V1 de Ana con la policy actual USING (created_by = actor) ==='
\echo '    Es la lectura que la frontera necesita para construir V2.'
begin;
do $probe$
declare
  v_beto text := '22222222-2222-4222-8222-222222222222';
  v_n int; v_ver_no int; v_max int;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_beto)::text, true);

  select ov.version_no into v_ver_no
  from e20_core.operation_version ov
  where ov.id = 'b0000030-0000-4000-8000-000000000000';
  get diagnostics v_n = row_count;
  raise notice 'F1a lectura de la V1 de Ana          filas=%  version_no=%',
    v_n, coalesce(v_ver_no::text, '(nulo)');

  select max(ov.version_no) into v_max
  from e20_core.operation_version ov
  where ov.operation_id = 'a0000030-0000-4000-8000-000000000000';
  raise notice 'F1b siguiente version_no calculado   %  <-- lo que insertaria la frontera',
    coalesce((v_max + 1)::text, '(nulo: la frontera creeria que no hay predecesor)');

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== F2 · lo que Beto SI ve de la operacion, para separar los dos caminos ==='
\echo '    El puntero vive en `operation`; los datos heredables, en la version.'
begin;
drop policy p_op_writer_sel on e20_core.operation;
create policy p_op_writer_sel on e20_core.operation
  for select to e20_writer using (true);
do $probe$
declare
  v_beto text := '22222222-2222-4222-8222-222222222222';
  v_ptr uuid; v_n int;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_beto)::text, true);

  select o.current_version_id into v_ptr
  from e20_core.operation o
  where o.id = 'a0000030-0000-4000-8000-000000000000';
  get diagnostics v_n = row_count;
  raise notice 'F2  puntero legible desde operation  filas=%  ->  %', v_n, v_ptr;
  raise notice '    pero la FILA de esa version sigue oculta: el id no es la version';

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== F3 · la misma lectura con la policy de la version ampliada al writer ==='
begin;
drop policy p_op_writer_sel on e20_core.operation;
create policy p_op_writer_sel on e20_core.operation
  for select to e20_writer using (true);
drop policy p_ov_writer_sel on e20_core.operation_version;
create policy p_ov_writer_sel on e20_core.operation_version
  for select to e20_writer using (true);

do $probe$
declare
  v_beto text := '22222222-2222-4222-8222-222222222222';
  v_n int; v_ver_no int; v_max int; v_autor uuid;
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_beto)::text, true);

  select ov.version_no, ov.created_by into v_ver_no, v_autor
  from e20_core.operation_version ov
  where ov.id = 'b0000030-0000-4000-8000-000000000000';
  get diagnostics v_n = row_count;
  raise notice 'F3a lectura de la V1 de Ana          filas=%  version_no=%  autor=%',
    v_n, v_ver_no, v_autor;

  select max(ov.version_no) into v_max
  from e20_core.operation_version ov
  where ov.operation_id = 'a0000030-0000-4000-8000-000000000000';
  raise notice 'F3b siguiente version_no calculado   %', v_max + 1;

  -- F4: Beto crea V2 con lo leido, atribuida a EL.
  begin
    insert into e20_core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by)
    values ('b0000031-0000-4000-8000-000000000000',
            'a0000030-0000-4000-8000-000000000000',
            v_max + 1,
            'b0000030-0000-4000-8000-000000000000',
            v_beto::uuid);
    raise notice 'F4  Beto crea V2 atribuida a el      ACEPTADO';
  exception when others then
    raise notice 'F4  Beto crea V2                     RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  -- F5: el WITH CHECK de effect NO debe aflojarse por ampliar la policy de SELECT.
  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000061-0000-4000-8000-000000000000',
            'b0000030-0000-4000-8000-000000000000',   -- la V1 de ANA
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'F5  efecto de Beto sobre la V1 de Ana  ACEPTADO  <-- LA BARRERA SE CAYO';
  exception when others then
    raise notice 'F5  efecto de Beto sobre la V1 de Ana  RECHAZADO  sqlstate=%  <-- la barrera aguanta', sqlstate;
  end;

  -- F6: y sigue aceptando los efectos de la version que Beto SI creo.
  begin
    insert into e20_core.effect (id, operation_version_id, scope_id)
    values ('c0000062-0000-4000-8000-000000000000',
            'b0000031-0000-4000-8000-000000000000',   -- la V2 de BETO
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise notice 'F6  efecto de Beto sobre su propia V2  ACEPTADO';
  exception when others then
    raise notice 'F6  efecto de Beto sobre su propia V2  RECHAZADO  sqlstate=%  %', sqlstate, sqlerrm;
  end;

  reset role;
end $probe$;
rollback;   -- restaura ambas policies

\echo ''
\echo '=== F7 · con la policy amplia, ¿sigue Beto sin poder atribuirse mal una version? ==='
\echo '    El INSERT de operation_version conserva su WITH CHECK por atribucion.'
begin;
drop policy p_ov_writer_sel on e20_core.operation_version;
create policy p_ov_writer_sel on e20_core.operation_version
  for select to e20_writer using (true);
do $probe$
declare v_beto text := '22222222-2222-4222-8222-222222222222';
begin
  set local role e20_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_beto)::text, true);

  begin
    insert into e20_core.operation_version
      (id, operation_id, version_no, supersedes_version_id, created_by)
    values ('b0000032-0000-4000-8000-000000000000',
            'a0000030-0000-4000-8000-000000000000', 2,
            'b0000030-0000-4000-8000-000000000000',
            '11111111-1111-4111-8111-111111111111');  -- se atribuye a ANA
    raise notice 'F7  Beto crea una version atribuida a Ana  ACEPTADO  <-- FUGA';
  exception when others then
    raise notice 'F7  Beto crea una version atribuida a Ana  RECHAZADO  sqlstate=%', sqlstate;
  end;

  reset role;
end $probe$;
rollback;

\echo ''
\echo '=== policies tras F1-F7 (deben ser las de 10-setup) ==='
select c.relname as tabla, p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                     when 'w' then 'UPDATE' else p.polcmd::text end as comando,
       pg_get_expr(p.polqual, p.polrelid) as using_expr
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'e20_core' and p.polcmd = 'r'
order by 1, 2;
