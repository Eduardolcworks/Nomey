-- E19-A · Una cadena de DOS vistas `security_invoker`.
--
-- E13 midio UN nivel: `api` -> tabla de `core`. La forma que propone D11 tiene
-- dos, porque la proyeccion canonica de efectos vigentes se interpone. Que la
-- RLS de la tabla base siga aplicandose a traves de dos niveles NO se sigue de
-- lo medido en E13: es una pregunta distinta y aqui se mide.
--
-- Se concede de una en una para ver SUFICIENCIA, y despues se revoca cada
-- pieza por separado para ver MINIMALIDAD: conceder en orden solo demuestra lo
-- primero.
--
-- NO ES UNA MIGRACION.

\pset pager off
\set QUIET on
select id as uid_a from auth.users where email='e19-a@probe.local' \gset
select id as uid_b from auth.users where email='e19-b@probe.local' \gset
\set QUIET off

-- Consulta una relacion cualquiera como `authenticated` con el JWT de `uid`.
create or replace function pg_temp.ver(etiqueta text, rel text, uid uuid) returns text
language plpgsql as $$
declare n int; importes text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    case when uid is null then '{"role":"authenticated"}'
         else json_build_object('sub', uid::text, 'role', 'authenticated')::text end, true);
  execute format('select count(*), coalesce(string_agg(amount_minor::text, '' | '' order by amount_minor), ''(ninguno)'') from %s', rel)
    into n, importes;
  reset role;
  return rpad(etiqueta, 46) || ' -> OK, ' || n || ' fila(s): ' || importes;
exception when others then
  reset role;
  return rpad(etiqueta, 46) || ' -> ' || sqlstate || ' ' || sqlerrm;
end $$;

\echo ''
\echo '=== A1 · SUFICIENCIA: privilegios de la cadena, concedidos de uno en uno ==='
select pg_temp.ver('1 · sin ningun privilegio', 'e19_api.effect_v', :'uid_a');

grant usage on schema e19_api to authenticated;
grant select on e19_api.effect_v to authenticated;
select pg_temp.ver('2 · USAGE api + SELECT vista externa', 'e19_api.effect_v', :'uid_a');

grant usage on schema e19_core to authenticated;
select pg_temp.ver('3 · + USAGE core', 'e19_api.effect_v', :'uid_a');

grant select on e19_core.current_effect to authenticated;
select pg_temp.ver('4 · + SELECT vista interna', 'e19_api.effect_v', :'uid_a');

grant select on e19_core.effect to authenticated;
select pg_temp.ver('5 · + SELECT effect', 'e19_api.effect_v', :'uid_a');

grant select on e19_core.operation_version to authenticated;
select pg_temp.ver('6 · + SELECT operation_version', 'e19_api.effect_v', :'uid_a');

grant select on e19_core.operation to authenticated;
select pg_temp.ver('7 · + SELECT operation', 'e19_api.effect_v', :'uid_a');

grant select on e19_core.membership to authenticated;
select pg_temp.ver('8 · + SELECT membership', 'e19_api.effect_v', :'uid_a');

\echo ''
\echo '=== A2 · MINIMALIDAD: se revoca cada pieza por separado ==='
revoke usage on schema e19_core from authenticated;
select pg_temp.ver('sin USAGE core', 'e19_api.effect_v', :'uid_a');
grant usage on schema e19_core to authenticated;

revoke select on e19_core.current_effect from authenticated;
select pg_temp.ver('sin SELECT vista interna', 'e19_api.effect_v', :'uid_a');
grant select on e19_core.current_effect to authenticated;

revoke select on e19_core.effect from authenticated;
select pg_temp.ver('sin SELECT effect', 'e19_api.effect_v', :'uid_a');
grant select on e19_core.effect to authenticated;

revoke select on e19_core.operation from authenticated;
select pg_temp.ver('sin SELECT operation', 'e19_api.effect_v', :'uid_a');
grant select on e19_core.operation to authenticated;

revoke select on e19_core.membership from authenticated;
select pg_temp.ver('sin SELECT membership', 'e19_api.effect_v', :'uid_a');
grant select on e19_core.membership to authenticated;

\echo ''
\echo '=== A3 · AISLAMIENTO a traves de los DOS niveles ==='
\echo '    Esperado: A ve 7500 (su V2 vigente, NO su V1 de 6000); B ve 4000; sin sesion, nada.'
select pg_temp.ver('A por la vista externa',  'e19_api.effect_v',      :'uid_a');
select pg_temp.ver('B por la vista externa',  'e19_api.effect_v',      :'uid_b');
select pg_temp.ver('sin sesion',              'e19_api.effect_v',      null);
select pg_temp.ver('A por la vista interna',  'e19_core.current_effect', :'uid_a');
select pg_temp.ver('A por la tabla base',     'e19_core.effect',       :'uid_a');

\echo ''
\echo '=== A4 · VIGENCIA: el filtro vive en la vista interna, no en quien pregunta ==='
\echo '    La tabla base tiene 2 efectos del ambito de A; la proyeccion canonica, 1.'
select pg_temp.ver('A ve en la tabla base (V1 + V2)', 'e19_core.effect', :'uid_a');
select pg_temp.ver('A ve en current_effect (solo V2)', 'e19_core.current_effect', :'uid_a');

\echo ''
\echo '=== A5 · CONTRASTE: el mismo nivel externo ejecutado como PROPIETARIO ==='
\echo '    Sin security_invoker la vista corre como su owner y la RLS de core no se aplica.'
grant select on e19_api.effect_owner_v to authenticated;
select pg_temp.ver('A por la vista propietario', 'e19_api.effect_owner_v', :'uid_a');
select pg_temp.ver('B por la vista propietario', 'e19_api.effect_owner_v', :'uid_b');
select pg_temp.ver('sin sesion, vista propietario', 'e19_api.effect_owner_v', null);

\echo ''
\echo '=== A6 · La vista que se salta la proyeccion canonica ==='
\echo '    Sigue respetando la RLS, pero suma historia y vigente: la cifra es falsa y no falla.'
grant select on e19_api.effect_bypass_v to authenticated;
select pg_temp.ver('A por la vista que evita current_effect', 'e19_api.effect_bypass_v', :'uid_a');

\echo ''
\echo '=== A7 · Propietarios de cada eslabon ==='
select n.nspname || '.' || c.relname as objeto,
       pg_get_userbyid(c.relowner)   as propietario,
       case c.relkind when 'v' then 'vista' when 'r' then 'tabla' end as tipo,
       case when c.relkind = 'v'
            then coalesce((select option_value from pg_options_to_table(c.reloptions)
                           where option_name = 'security_invoker'), 'false')
       end as security_invoker
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('e19_core','e19_api') and c.relkind in ('r','v')
order by n.nspname, c.relname;
