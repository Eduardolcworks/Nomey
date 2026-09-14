-- ============================================================================
-- LA ULTIMA ACTIVIDAD DE UN GRUPO, para ordenar la lista.
-- ============================================================================
--
-- Un grupo sube al primer puesto cuando se registra un movimiento NUEVO en el.
-- La referencia es el momento REAL de registro de la operacion —`core.operation.created_at`,
-- el instante en que nacio en el servidor—, y no:
--
-- - la fecha efectiva del gasto: un gasto registrado hoy con fecha de ayer es
--   actividad de hoy;
-- - el momento de lectura, refresco o sincronizacion: eso es del aparato;
-- - la version: corregir un gasto no crea operacion y no cuenta como alta;
--   `operation_version.created_at` cambiaria y `operation.created_at` no;
-- - un reintento idempotente: responde `replay` sin crear operacion, asi que
--   no mueve nada;
-- - editar nombre, emoji o categoria preestablecida: no es un movimiento.
--
-- Se publica en `api.group_profile` como una columna mas, para que la lista la
-- reciba en la MISMA lectura de conjunto que ya hace —sin una consulta por
-- tarjeta ni un maximo sobre una pagina de movimientos—. Nula para un grupo
-- sin movimientos: el cliente cae a `created_at` y desempata por identidad.
--
-- Las operaciones anuladas no tienen efectos vigentes y salen del maximo. Es
-- coherente con lo que la lista ensena: un grupo cuyo unico gasto se anulo
-- vuelve a ser un grupo sin movimientos.

create or replace view api.group_profile
with (security_invoker = true) as
select g.scope_id,
       g.display_name,
       g.emoji,
       s.base_currency_definition_id,
       c.code  as currency_code,
       c.scale as currency_scale,
       (select count(*) from core.participant p where p.scope_id = g.scope_id) as participant_count,
       g.created_at,
       g.updated_at,
       g.default_category_id,
       -- Al FINAL, como las anteriores: `create or replace view` solo admite
       -- columnas nuevas al final.
       (select max(o.created_at)
          from core.current_effect e
          join core.operation_version ov on ov.id = e.operation_version_id
          join core.operation o on o.id = ov.operation_id
         where e.scope_id = g.scope_id) as last_activity_at
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id;
