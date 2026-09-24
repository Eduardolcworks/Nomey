-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  F11 · LA CONVERSION CONGELADA DE UN GASTO DE GRUPO, PARA LEERLA         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- F11.D dejo el gasto de grupo convirtiendo y repartiendo, y `api.group_operation`
-- publica desde entonces `original_currency_definition_id`: se puede enseñar el
-- total DECLARADO con su moneda y la cuota en la del grupo. Lo que no habia era
-- por donde enseñar el TIPO y su FUENTE, que es lo unico que explica por que un
-- total de 150000 JPY movio 840,05 EUR.
--
-- Esta migracion es ADITIVA y no toca nada: ni una tabla, ni una policy, ni un
-- grant sobre `core`. Añade UNA funcion de lectura, calcada de
-- `api.personal_operation_conversion` (F11.C, `20261001120000`) — misma forma,
-- mismas columnas, misma decision sobre que sale y que no.
--
-- ═══════════════ POR QUE UNA FUNCION Y NO UNA VISTA ═══════════════
--
-- Por lo mismo que en F11.C: `core.frozen_conversion` no se expone, y
-- `authenticated` no tiene ni `USAGE` sobre `core` ni `SELECT` sobre esa tabla
-- — ni lo gana aqui. La funcion es `SECURITY DEFINER` propiedad de `postgres`,
-- cruza la RLS como lo hace `api.claimed_dimension` (F03/ADR-013) y **autoriza
-- en su propio cuerpo**.
--
-- ═══════════════ QUIEN PUEDE LEERLA ═══════════════
--
-- `sec.is_member(fc.scope_id)`, que es el helper reducido de F03/ADR-004: toma
-- el ambito y NUNCA una identidad ajena, y resuelve membresia ACTUAL. Es la
-- misma autoridad que la RLS aplica a `api.group_operation`, asi que quien ve
-- el gasto ve su tipo y quien no lo ve, tampoco lo ve aqui. Quien dejo el grupo
-- no es miembro y no lee nada (F10/ADR-003).
--
-- ═══════════════ QUE SALE, Y QUE NO ═══════════════
--
-- **Solo la conversion del ambito del GRUPO** (`s.kind = 'group'`). Un gasto de
-- grupo congela ademas una conversion por cada Personal alcanzado
-- (F11/ADR-003), y esas son de otras cuentas: publicarlas diria que esa persona
-- tiene Modo Personal y en que moneda lo tiene. La propia, si la hay, ya sale
-- por `api.personal_operation_conversion`, que es su sitio.
--
-- Y la LISTA DE COLUMNAS es la frontera de privacidad, igual que en F11.C: las
-- dos monedas, el tipo, la fecha que se resolvio, la fuente y las dos fechas de
-- referencia. **No salen los identificadores de las publicaciones del BCE** ni
-- el metodo, que es un vocabulario de un solo valor.
--
-- El coeficiente cruza como TEXTO: es un `bigint` exacto de hasta 12 decimales
-- de escala, y parsearlo como numero de JSON lo degradaria igual que a un
-- importe (F03/ADR-005 §1, F03/ADR-012).
--
-- **No resuelve nada.** Es la autoridad de lo ya convertido: no consulta al BCE,
-- no llama a `sec.fx_resolve` y no recalcula. Si el tipo de hoy fuera otro, esta
-- funcion sigue diciendo el que se uso (F11/ADR-001 §9).

create function api.group_operation_conversion(p_operation_ids uuid[] default null)
returns table (
  operation_id                  uuid,
  operation_version_id          uuid,
  scope_id                      uuid,
  source_currency_definition_id uuid,
  target_currency_definition_id uuid,
  rate_coefficient              text,
  rate_scale                    smallint,
  resolved_for_date             date,
  source_id                     text,
  origin_reference_date         date,
  target_reference_date         date,
  original_amount               text,
  converted_amount              text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select ov.operation_id,
         fc.operation_version_id,
         fc.scope_id,
         fc.source_currency_definition_id,
         fc.target_currency_definition_id,
         fc.rate_coefficient::text,
         fc.rate_scale,
         fc.resolved_for_date,
         pv.source_id,
         pv.origin_reference_date,
         pv.target_reference_date,
         ov.original_amount::text,
         -- EL TOTAL CONVERTIDO, que es el que se repartio. No se recalcula
         -- aqui: se SUMA lo que el writer asento, que es la dimension
         -- economica del ambito del grupo con su unico redondeo
         -- (F11/ADR-003). Sale de `core.current_effect`, la proyeccion
         -- canonica (F03/ADR-010 §9), y no de `core.effect`.
         (select sum(e.economic_amount)::text
            from core.current_effect e
           where e.operation_version_id = fc.operation_version_id
             and e.scope_id = fc.scope_id
             and e.economic_amount is not null)
    from core.frozen_conversion fc
    join core.frozen_conversion_provenance pv
      on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
    join core.operation_version ov on ov.id = fc.operation_version_id
    join core.operation o on o.id = ov.operation_id
    join core.scope s on s.id = fc.scope_id
   where s.kind = 'group'
     and o.operation_class = 'group_expense'
     -- Solo la version VIGENTE: el historial de un gasto no publica importes
     -- firmados (F06/ADR-007) y tampoco publica los tipos de sus versiones
     -- superadas.
     and o.current_version_id = fc.operation_version_id
     and sec.is_member(fc.scope_id)
     and (p_operation_ids is null or ov.operation_id = any (p_operation_ids));
$fn$;

comment on function api.group_operation_conversion(uuid[]) is
  'La conversion congelada del ambito del grupo en sus gastos convertidos, con su procedencia (F11/ADR-001 §9, F11/ADR-003). Autoridad de lo ya convertido: no resuelve nada. Autoriza en su cuerpo, por membresia actual.';

-- E12 midio que sin el revoke explicito la funcion es invocable por `anon`.
revoke execute on function api.group_operation_conversion(uuid[]) from public;
grant  execute on function api.group_operation_conversion(uuid[]) to authenticated;
