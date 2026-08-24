-- E16 · Los cuatro casos, mas dos comprobaciones que aparecieron al medir.
--
-- NO ES UNA MIGRACION.

\pset pager off

create or replace function pg_temp.llamar(etiqueta text) returns text
language plpgsql as $$
declare r jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
  select e16_api.inspeccionar() into r;
  reset role;
  return etiqueta
    || '  | current_user=' || (r->>'current_user')
    || ' session_user='    || (r->>'session_user')
    || ' | filas='         || (r->>'filas_vistas')
    || ' -> '              || (r->>'datos')
    || ' | auth.uid()='    || (r->>'auth_uid')
    || ' | sub por GUC='  || (r->>'sub_por_guc');
exception when others then
  reset role;
  return etiqueta || ' -> ' || sqlstate || ' ' || sqlerrm;
end $$;

-- Ceder la propiedad de una tabla exige CREATE sobre su schema para el nuevo
-- owner. Se concede y se retira alrededor de cada cambio.
create or replace procedure pg_temp.owner_a(p_rol text)
language plpgsql as $$
begin
  execute format('grant create on schema e16_core to %I', p_rol);
  execute format('alter table e16_core.item owner to %I', p_rol);
  execute format('revoke create on schema e16_core from %I', p_rol);
end $$;

\echo ''
\echo '===== CASO A · writer NO owner, NOBYPASSRLS ====='
select pg_temp.llamar('A');

\echo ''
\echo '===== CASO B · writer ES owner de la tabla ====='
call pg_temp.owner_a('e16_writer');
select relowner::regrole::text as owner_actual from pg_class where oid='e16_core.item'::regclass;
select pg_temp.llamar('B');

\echo ''
\echo '===== CASO C · writer owner + FORCE ROW LEVEL SECURITY ====='
alter table e16_core.item force row level security;
select relforcerowsecurity as force_rls from pg_class where oid='e16_core.item'::regclass;
select pg_temp.llamar('C');

\echo ''
\echo '===== CASO D · writer NO owner + politica explicita TO e16_writer ====='
alter table e16_core.item no force row level security;
call pg_temp.owner_a('postgres');
-- Cambiar el owner de ida y vuelta PIERDE los grants explicitos [medido]:
-- mientras el writer fue owner no necesitaba el GRANT, y al devolver la
-- propiedad no reaparece. Hay que reponerlo.
grant select, insert on e16_core.item to e16_writer;

\echo '--- D1 · politica permisiva TO e16_writer que permite TODO ---'
create policy p_writer on e16_core.item for select to e16_writer using (true);
select pg_temp.llamar('D1');

\echo '--- D2 · la misma politica ACOTADA a id=2 ---'
drop policy p_writer on e16_core.item;
create policy p_writer on e16_core.item for select to e16_writer using (id = 2);
select pg_temp.llamar('D2');

\echo '--- D3 · lo mismo, pero sin la politica general permisiva ---'
\echo '        (las politicas permisivas se COMBINAN con OR: añadir una amplia)'
drop policy p_solo_visibles on e16_core.item;
select pg_temp.llamar('D3');

\echo ''
\echo '===== EXTRA 1 · ¿puede el CALLER tocar e16_core directamente? ====='
do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from e16_core.item;
  reset role;
  raise notice 'caller leyo e16_core.item: % filas', n;
exception when others then
  reset role;
  raise notice 'caller NO pudo leer e16_core.item: % %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo '===== EXTRA 2 · auth.uid() dentro del SECURITY DEFINER del writer ====='
\echo '        Sin USAGE sobre el schema auth, falla. Se concede y se repite.'
grant usage on schema auth to e16_writer;
select pg_temp.llamar('con USAGE sobre auth');

\echo ''
\echo '===== EXTRA 3 · ¿puede el writer ESCRIBIR bajo RLS? ====='
create policy p_writer_ins on e16_core.item for insert to e16_writer with check (visible);
do $$
begin
  set local role e16_writer;
  insert into e16_core.item values (3, true, 'insertada por el writer');
  reset role;
  raise notice 'INSERT con visible=true -> PUDO';
exception when others then
  reset role;
  raise notice 'INSERT con visible=true -> % %', sqlstate, sqlerrm;
end $$;
do $$
begin
  set local role e16_writer;
  insert into e16_core.item values (4, false, 'viola el with check');
  reset role;
  raise notice 'INSERT con visible=false -> PUDO (la RLS no lo detuvo)';
exception when others then
  reset role;
  raise notice 'INSERT con visible=false -> % %', sqlstate, sqlerrm;
end $$;
