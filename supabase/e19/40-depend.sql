-- E19-B · Verificabilidad por catalogo de la proyeccion canonica.
--
-- La pregunta: ¿puede una consulta al catalogo distinguir una vista que
-- referencia DIRECTAMENTE la tabla base de otra que pasa por la proyeccion
-- canonica? Si el catalogo no lo distingue, la unica mitigacion del riesgo
-- dominante de D11 no es verificable y hay que buscar otra.
--
-- Es el mismo tipo de comprobacion que E17 diseno para las politicas con
-- `0 = ANY(polroles)`: se afirma la SEMANTICA, no la sintaxis.
--
-- NO ES UNA MIGRACION.

\pset pager off

\echo ''
\echo '=== B1 · Dependencias que registra el catalogo para cada vista ==='
\echo '    Si la dependencia fuera transitiva, effect_v apareceria colgando de effect.'
select dep.relname     as vista,
       ref_ns.nspname || '.' || ref.relname as referencia,
       case ref.relkind when 'r' then 'tabla' when 'v' then 'vista' end as tipo_ref,
       count(*)        as columnas
from   pg_depend d
join   pg_rewrite r    on r.oid = d.objid
join   pg_class   dep  on dep.oid = r.ev_class
join   pg_class   ref  on ref.oid = d.refobjid
join   pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
join   pg_namespace dep_ns on dep_ns.oid = dep.relnamespace
where  d.classid    = 'pg_rewrite'::regclass
  and  d.refclassid = 'pg_class'::regclass
  and  dep.oid <> ref.oid
  and  dep_ns.nspname in ('e19_core','e19_api')
group by 1,2,3
order by 1,2;

\echo ''
\echo '=== B2 · La guarda candidata ==='
\echo '    Regla: la UNICA relacion que puede depender directamente de e19_core.effect'
\echo '    es la proyeccion canonica e19_core.current_effect. Cualquier otra es violacion.'
select dep_ns.nspname || '.' || dep.relname as vista_infractora
from   pg_depend d
join   pg_rewrite r    on r.oid = d.objid
join   pg_class   dep  on dep.oid = r.ev_class
join   pg_namespace dep_ns on dep_ns.oid = dep.relnamespace
where  d.classid    = 'pg_rewrite'::regclass
  and  d.refclassid = 'pg_class'::regclass
  and  d.refobjid   = 'e19_core.effect'::regclass
  and  dep.relkind  = 'v'                              -- solo vistas: no indices ni constraints
  and  dep.oid     <> 'e19_core.current_effect'::regclass   -- la canonica es la excepcion
group by 1
order by 1;

\echo ''
\echo '    ^ Debe listar EXACTAMENTE e19_api.effect_bypass_v, y nada mas.'

\echo ''
\echo '=== B3 · Ruido que la guarda NO debe contar como violacion ==='
\echo '    Todo lo que depende de e19_core.effect por cualquier via, sin filtrar.'
select d.classid::regclass          as clase_dependiente,
       coalesce(dep.relkind::text, '-') as relkind,
       coalesce(dep_ns.nspname || '.' || dep.relname, d.objid::text) as objeto,
       count(*)                     as filas
from   pg_depend d
left   join pg_rewrite r   on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
left   join pg_class   dep on dep.oid = coalesce(r.ev_class, case when d.classid='pg_class'::regclass then d.objid end)
left   join pg_namespace dep_ns on dep_ns.oid = dep.relnamespace
where  d.refclassid = 'pg_class'::regclass
  and  d.refobjid   = 'e19_core.effect'::regclass
group by 1,2,3
order by 1,3;

\echo ''
\echo '=== B4 · Funciones: que registra el catalogo de una que menciona la tabla ==='
create or replace function e19_core.total_saltandose_la_canonica(target uuid)
returns bigint language sql stable security definer set search_path = ''
as $$ select coalesce(sum(e.amount_minor), 0) from e19_core.effect e where e.scope_id = target $$;

create or replace function e19_core.total_por_la_canonica(target uuid)
returns bigint language sql stable security definer set search_path = ''
as $$ select coalesce(sum(c.amount_minor), 0) from e19_core.current_effect c where c.scope_id = target $$;

\echo '    Las dos devuelven cifras distintas sobre los mismos datos:'
select e19_core.total_saltandose_la_canonica('11111111-1111-1111-1111-111111111111') as sin_filtro_vigencia,
       e19_core.total_por_la_canonica       ('11111111-1111-1111-1111-111111111111') as con_filtro_vigencia;

\echo ''
\echo '    ¿Aparece alguna de las dos en pg_depend colgando de e19_core.effect?'
select p.proname
from   pg_depend d
join   pg_proc p on p.oid = d.objid
where  d.classid    = 'pg_proc'::regclass
  and  d.refclassid = 'pg_class'::regclass
  and  d.refobjid   = 'e19_core.effect'::regclass;

\echo '    ^ Si sale vacio, la guarda por catalogo NO cubre funciones.'

\echo ''
\echo '=== B5 · Lo unico que el catalogo ofrece para funciones es el texto ==='
select p.proname,
       (position('e19_core.effect' in p.prosrc) > 0)         as menciona_tabla_base,
       (position('e19_core.current_effect' in p.prosrc) > 0) as menciona_canonica
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'e19_core'
order by p.proname;

\echo ''
\echo '    ^ Notese que `current_effect` CONTIENE la subcadena `effect`: una regla'
\echo '      ingenua por subcadena marcaria como infractora a la funcion correcta.'

\echo ''
\echo '=== B6 · Cuerpo SQL estandar (BEGIN ATOMIC): ¿lo registra el catalogo? ==='
\echo '    A diferencia del cuerpo entre $$, un cuerpo BEGIN ATOMIC se analiza al'
\echo '    crear la funcion, asi que sus referencias podrian quedar en pg_depend.'

create or replace function e19_core.total_atomic_saltandose(target uuid)
returns bigint language sql stable
begin atomic
  select coalesce(sum(e.amount_minor), 0) from e19_core.effect e where e.scope_id = target;
end;

create or replace function e19_core.total_atomic_canonica(target uuid)
returns bigint language sql stable
begin atomic
  select coalesce(sum(c.amount_minor), 0) from e19_core.current_effect c where c.scope_id = target;
end;

create or replace function e19_core.total_plpgsql_saltandose(target uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$ declare t bigint; begin
  select coalesce(sum(e.amount_minor), 0) into t from e19_core.effect e where e.scope_id = target;
  return t; end $$;

\echo ''
\echo '    Funciones que pg_depend SI cuelga de e19_core.effect:'
select p.proname, l.lanname as lenguaje
from   pg_depend d
join   pg_proc p on p.oid = d.objid
join   pg_language l on l.oid = p.prolang
where  d.classid    = 'pg_proc'::regclass
  and  d.refclassid = 'pg_class'::regclass
  and  d.refobjid   = 'e19_core.effect'::regclass;

\echo ''
\echo '    Funciones que pg_depend cuelga de la proyeccion canonica:'
select p.proname, l.lanname as lenguaje
from   pg_depend d
join   pg_proc p on p.oid = d.objid
join   pg_language l on l.oid = p.prolang
where  d.classid    = 'pg_proc'::regclass
  and  d.refclassid = 'pg_class'::regclass
  and  d.refobjid   = 'e19_core.current_effect'::regclass;

\echo ''
\echo '    Inventario: que funciones existen y con que forma de cuerpo'
select p.proname, l.lanname as lenguaje,
       (p.prosqlbody is not null) as cuerpo_analizado
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
join   pg_language l  on l.oid = p.prolang
where  n.nspname = 'e19_core'
order by p.proname;
