-- E14 · Objetos desechables para medir la frontera de ESCRITURA.
--
-- Dos funciones de eco que devuelven, sin ambiguedad, lo que realmente llego a
-- PostgreSQL:
--
--   e14_echo_text(text)    -> que texto recibio un parametro SQL `text`
--   e14_echo_jsonb(jsonb)  -> que TIPO JSON tenia el valor antes de convertirse
--
-- Viven en `public` porque es el unico schema expuesto por la Data API en la
-- configuracion por defecto, y la medicion necesita atravesar PostgREST de
-- verdad. Eso no expresa ninguna preferencia de topologia: ADR-005 ya decidio
-- que la persistencia de Nomey no vive en `public`.
--
-- Idempotente: hace drop antes de crear. NO ES UNA MIGRACION.

\pset pager off

begin;

drop function if exists public.e14_echo_text(text);
drop function if exists public.e14_echo_jsonb(jsonb);

-- Que llego a un parametro SQL `text`.
create function public.e14_echo_text(p_value text) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'recibido',  p_value,
    'es_null',   p_value is null,
    'longitud',  coalesce(length(p_value), -1),
    'exacto_2p53_mas_1', p_value is not distinct from '9007199254740993'
  )
$$;

-- Que TIPO JSON tenia el valor. Es la pregunta que un parametro `text` ya no
-- puede responder, porque la conversion a texto ya ocurrio.
create function public.e14_echo_jsonb(p_payload jsonb) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'tipo_json', jsonb_typeof(p_payload -> 'v'),
    'como_texto', p_payload ->> 'v'
  )
$$;

commit;

-- PostgREST cachea el esquema: sin esto, las funciones nuevas dan 404.
notify pgrst, 'reload schema';

\echo ''
\echo '=== funciones de sondeo creadas ==='
select n.nspname || '.' || p.proname as funcion,
       pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname like 'e14%'
order by 1;
