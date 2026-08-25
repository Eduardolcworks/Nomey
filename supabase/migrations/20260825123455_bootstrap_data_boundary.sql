-- Bootstrap de la frontera de datos de Nomey.
--
-- Primera migracion real del proyecto. Crea EXCLUSIVAMENTE la infraestructura
-- que debe existir antes de que pueda crearse cualquier tabla de dominio de
-- forma coherente con los ADR aceptados. No crea ninguna tabla, ninguna vista,
-- ninguna funcion y ningun rol de aplicacion: eso llega en migraciones
-- posteriores de la Fase 3.C.
--
-- Fuentes:
--   ADR-005 · topologia de schemas
--   ADR-006 · modelo de privilegios (§1 anon, §2 service_role, §3 authenticated,
--             §4 EXECUTE de PUBLIC, §6 invariante de exposicion, §7 defaults de public)
--   ADR-014 · public fuera de los schemas expuestos

-- ---------------------------------------------------------------- schemas ---
-- ADR-005 §2. Tres schemas con papeles distintos y no intercambiables.

create schema if not exists core;   -- persistencia del dominio. NO expuesta.
create schema if not exists sec;    -- helpers de seguridad.      NO expuesta.
create schema if not exists api;    -- unica superficie de Data API de Nomey.

comment on schema core is
  'Persistencia del dominio de Nomey. No expuesta por la Data API (ADR-005, ADR-006 §6).';
comment on schema sec is
  'Helpers internos de seguridad. No expuesta por la Data API (ADR-005, ADR-006 §6).';
comment on schema api is
  'Unica superficie de Data API de Nomey (ADR-005 §2, ADR-014).';

-- ------------------------------------------------------------ PUBLIC role ---
-- Los schemas nuevos no conceden nada a PUBLIC por defecto en PostgreSQL 15+,
-- pero ADR-006 §7 exige que el saneamiento sea EXPLICITO y verificable por
-- catalogo, no heredado de un comportamiento por defecto que puede cambiar.

revoke all on schema core, sec, api from public;

-- ------------------------------------------------------- roles de cliente ---
-- ADR-006 §1: `anon` sin privilegios sobre objetos de Nomey.
-- ADR-006 §2: `service_role` sin privilegios explicitos. Tiene BYPASSRLS
--             [medido en E12], asi que cada GRANT seria acceso total.
-- Ambos revokes son explicitos por la misma razon que el anterior.

revoke all on schema core, sec, api from anon, service_role;

-- ADR-006 §3: del camino de lectura, lo unico que es estructural y no depende
-- de que existan vistas todavia. `USAGE` sobre `core` NO se concede: E13 midio
-- que no hace falta para el camino de vistas `security_invoker`.

revoke all on schema core, sec from authenticated;
grant usage on schema api to authenticated;

-- ------------------------------- EXECUTE de PUBLIC sobre funciones futuras ---
-- ADR-006 §4, primera de las dos capas: default privilege GLOBAL, no por
-- schema. E12 midio que la forma por schema NO sirve y que la global si.
-- La segunda capa —`revoke execute ... from public` en la misma migracion que
-- crea cada funcion— es responsabilidad de esas migraciones.

alter default privileges for role postgres
  revoke execute on functions from public;

-- ------------------------------------- saneamiento de los defaults de public ---
-- ADR-006 §7. Nomey no coloca objetos en `public`, pero E12 midio que las
-- tablas nuevas de ese schema NACEN con privilegios para los roles cliente por
-- los default privileges de Supabase. El motivo de sanearlo es de futuro:
-- protege contra que alguien cree ahi una tabla meses despues.
--
-- Nota: `public` ya no esta expuesto por la Data API (ADR-014), asi que esto es
-- la segunda capa de esa misma proteccion, no la unica.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
