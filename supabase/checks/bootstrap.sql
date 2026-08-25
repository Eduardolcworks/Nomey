-- Comprobaciones del bootstrap de la frontera de datos, contra la base REAL.
--
-- No es una sonda: `supabase/e11`–`e20` eran evidencia desechable sobre
-- maquetas. Esto valida la migracion de verdad, despues de aplicarla.
--
-- Complementa a `tests/infra/exposed-schemas.test.ts`, que comprueba la
-- configuracion versionada sin base de datos. Aqui se comprueba el catalogo.
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/bootstrap.sql
--
-- Falla con codigo distinto de cero en la primera violacion.

\pset pager off
\set ON_ERROR_STOP on

do $$
declare
  v_falta text;
begin
  -- ADR-005 §2 · los tres schemas existen.
  select string_agg(s, ', ') into v_falta
  from unnest(array['core','sec','api']) s
  where not exists (select 1 from pg_namespace where nspname = s);
  if v_falta is not null then
    raise exception 'FALLO: faltan schemas: %', v_falta;
  end if;

  -- ADR-006 §7 · PUBLIC no tiene nada sobre ellos.
  select string_agg(s, ', ') into v_falta
  from unnest(array['core','sec','api']) s
  where has_schema_privilege('public', s, 'USAGE')
     or has_schema_privilege('public', s, 'CREATE');
  if v_falta is not null then
    raise exception 'FALLO: PUBLIC tiene privilegios sobre: %', v_falta;
  end if;

  -- ADR-006 §1 y §2 · `anon` y `service_role` sin privilegios de Nomey.
  select string_agg(r || '->' || s, ', ') into v_falta
  from unnest(array['anon','service_role']) r,
       unnest(array['core','sec','api']) s
  where has_schema_privilege(r, s, 'USAGE')
     or has_schema_privilege(r, s, 'CREATE');
  if v_falta is not null then
    raise exception 'FALLO: rol cliente con privilegios de schema: %', v_falta;
  end if;

  -- ADR-006 §3 y §6 · `authenticated` llega a `api` y NO a la persistencia.
  if not has_schema_privilege('authenticated', 'api', 'USAGE') then
    raise exception 'FALLO: authenticated no tiene USAGE sobre api';
  end if;
  select string_agg(s, ', ') into v_falta
  from unnest(array['core','sec']) s
  where has_schema_privilege('authenticated', s, 'USAGE');
  if v_falta is not null then
    raise exception 'FALLO: authenticated alcanza la persistencia: %', v_falta;
  end if;

  -- Nadie puede crear objetos en los schemas de Nomey salvo el propietario.
  select string_agg(r || '->' || s, ', ') into v_falta
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['core','sec','api']) s
  where has_schema_privilege(r, s, 'CREATE');
  if v_falta is not null then
    raise exception 'FALLO: rol cliente con CREATE: %', v_falta;
  end if;

  -- ADR-006 §4 · default privilege GLOBAL: PUBLIC sin EXECUTE en funciones
  -- futuras creadas por el rol de las migraciones. E12 midio que la forma por
  -- schema NO sirve, asi que se comprueba la global (defaclnamespace = 0).
  -- En un aclitem, PUBLIC es el concedido vacio: se representa como `=X/rol`.
  if exists (
    select 1
    from pg_default_acl d, unnest(d.defaclacl) a
    where d.defaclnamespace = 0
      and d.defaclobjtype = 'f'
      and pg_get_userbyid(d.defaclrole) = 'postgres'
      and a::text like '=%'
  ) then
    raise exception 'FALLO: PUBLIC conserva EXECUTE en el default global';
  end if;
  if not exists (
    select 1 from pg_default_acl
    where defaclnamespace = 0
      and defaclobjtype = 'f'
      and pg_get_userbyid(defaclrole) = 'postgres'
  ) then
    raise exception 'FALLO: no existe el default privilege global de funciones';
  end if;

  -- ADR-006 §7 · los defaults de `public` para el rol de las migraciones ya no
  -- conceden nada a los roles cliente.
  select string_agg(defaclobjtype::text, ', ') into v_falta
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and pg_get_userbyid(d.defaclrole) = 'postgres'
    and (array_to_string(d.defaclacl, ',') like '%anon=%'
      or array_to_string(d.defaclacl, ',') like '%authenticated=%'
      or array_to_string(d.defaclacl, ',') like '%service_role=%');
  if v_falta is not null then
    raise exception 'FALLO: defaults de public siguen concediendo a roles cliente: %', v_falta;
  end if;

  -- Deliberadamente NO se comprueba que core/sec/api esten vacios: hoy lo
  -- estan, pero la proxima migracion los llenara y esa asercion habria que
  -- borrarla. Que el bootstrap sea minimo se sostiene revisando la migracion,
  -- no con una comprobacion que caduca.

  raise notice 'OK · bootstrap verificado contra el catalogo real';
end $$;
