-- E13 · Superficie GraphQL.
--
-- PostgREST ya se mide en 50-http.mjs. Aqui se responde la pregunta anterior:
-- ¿existe siquiera una superficie GraphQL capaz de alcanzar `core`?
--
-- El wrapper `graphql_public.graphql` es SECURITY INVOKER y NO fija
-- `search_path`; delega en `graphql.resolve`, tambien invoker y sin config.
-- Es decir: pg_graphql refleja lo que haya en el search_path de la peticion,
-- que PostgREST toma de `api.extra_search_path` en `config.toml`.
--
-- Este script HABILITA pg_graphql temporalmente y lo retira al final. Es la
-- unica parte de E13 que altera la instalacion, y por eso se deshace aqui
-- mismo. NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== Estado de partida de pg_graphql ==='
select name, default_version, coalesce(installed_version,'(NO instalada)') as instalada
from pg_available_extensions where name = 'pg_graphql';

\echo ''
\echo '=== El wrapper: SECURITY INVOKER y sin search_path fijado ==='
select n.nspname||'.'||p.proname as funcion,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig,' | '),'(sin config)') as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('graphql','graphql_public')
  and p.proname in ('graphql','resolve')
order by 1;

create extension if not exists pg_graphql;

do $$
declare res jsonb; ra text; rb text;
begin
  select json_build_object('sub', id::text, 'role','authenticated')::text into ra
    from auth.users where email = 'e13-a@probe.local';
  select json_build_object('sub', id::text, 'role','authenticated')::text into rb
    from auth.users where email = 'e13-b@probe.local';

  -- 1 · El search_path que fija PostgREST hoy.
  set local role authenticated;
  perform set_config('request.jwt.claims', ra, true);
  perform set_config('search_path', 'public, extensions', true);
  select graphql.resolve('{ itemCollection { edges { node { nota } } } }') into res;
  reset role;
  raise notice '[search_path = public, extensions] -> %', left(res::text, 200);

  -- 2 · Un search_path que incluyera e13_core.
  set local role authenticated;
  perform set_config('request.jwt.claims', ra, true);
  perform set_config('search_path', 'e13_core, public, extensions', true);
  select graphql.resolve('{ itemCollection { edges { node { nota } } } }') into res;
  reset role;
  raise notice '[con e13_core] usuario A (miembro)    -> %', left(res::text, 220);

  -- 3 · El mismo caso con el usuario que NO es miembro.
  set local role authenticated;
  perform set_config('request.jwt.claims', rb, true);
  perform set_config('search_path', 'e13_core, public, extensions', true);
  select graphql.resolve('{ itemCollection { edges { node { nota } } } }') into res;
  reset role;
  raise notice '[con e13_core] usuario B (NO miembro) -> %', left(res::text, 220);

  -- 4 · Una tabla sobre la que el rol no tiene SELECT.
  set local role authenticated;
  perform set_config('request.jwt.claims', ra, true);
  perform set_config('search_path', 'e13_core, public, extensions', true);
  select graphql.resolve('{ membershipCollection { edges { node { scopeId } } } }') into res;
  reset role;
  raise notice '[con e13_core] membership sin SELECT  -> %', left(res::text, 220);
end $$;

-- Se retira la extension: el stack vuelve al estado en que se encontro.
drop extension if exists pg_graphql;

\echo ''
\echo '=== pg_graphql retirada: debe volver a figurar como NO instalada ==='
select name, coalesce(installed_version,'(NO instalada)') as instalada
from pg_available_extensions where name = 'pg_graphql';
