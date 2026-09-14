-- ===========================================================================
-- F9 · FILTRAR LOS MOVIMIENTOS DE UN GRUPO
-- ===========================================================================
--
-- Tres columnas nuevas, y ni una relacion ni un permiso nuevos. Todo lo que
-- sigue sale de lo que la vista ya leia; lo unico que cambia es que ahora lo
-- publica, para que el filtrado ocurra **en el servidor y sobre el conjunto
-- completo**, no sobre la pagina descargada.
--
-- ============ POR QUE FILTRAR EN EL CLIENTE NO ERA UNA OPCION ==============
--
-- Es el mismo defecto que F6.E midio con las estadisticas: `max_rows` acota una
-- peticion a mil filas, asi que quedarse con «los que cumplen, de los que
-- llegaron» produce una lista incompleta que no lanza nada. Un filtro que
-- esconde gastos sin decirlo es peor que no tener filtro.
--
-- ============ QUE SE PUBLICA, Y POR QUE NO REVELA NADA NUEVO ===============
--
-- **`participant_ids`** — los participantes que entraron en el reparto de ese
-- gasto. Son identidades CONTEXTUALES del propio ambito (ADR-012 §1), las
-- mismas que `api.group_participant` ya publica con su nombre para quien es
-- miembro; esto solo dice cuales de ellas aparecen en que gasto. **No se toca
-- `core.participant_user_link`**: que cuenta global hay detras de cada
-- participante sigue sin publicarse en ninguna vista.
--
-- Sale del efecto ECONOMICO, que es quien responde «participa en el reparto».
-- No es quien pago —eso vive en `core.split`, que el cliente no alcanza— ni
-- quien lo registro —`operation.created_by`, que es otra pregunta—.
--
-- **`max_total`** — el importe del mayor gasto VIGENTE del grupo, para que el
-- extremo derecho de una barra de intervalo tenga un limite real. Sale de
-- `api.group_operation`, es decir, del conjunto completo y antes de cualquier
-- filtro: tomarlo de la pagina cargada haria que el limite se moviera al
-- filtrar, y tomarlo del resultado filtrado lo haria colapsar sobre si mismo.
--
-- **`expense_count`** — cuantos gastos tiene el grupo, tambien sin filtrar. Es
-- lo unico que permite distinguir «este grupo no tiene movimientos» de «ninguno
-- coincide con el filtro», que son dos estados distintos y se dicen distinto.
--
-- Los dos se apoyan en `api.group_operation`, que ya es `security_invoker`: la
-- RLS se evalua igual, una sola vez, bajo la identidad real de quien pregunta.
-- ===========================================================================

drop view if exists api.group_summary;
drop view if exists api.group_operation;

create view api.group_operation
with (security_invoker = true) as
select o.id                     as operation_id,
       e.scope_id,
       e.currency_definition_id,
       ov.original_amount::text as total_amount,
       -- EL MISMO IMPORTE, ORDENABLE Y FILTRABLE. `total_amount` sale como
       -- texto porque es dinero exacto y ADR-008 §1 no admite un numero donde
       -- hay dinero; pero ordenar o acotar por ese texto pondria `100` antes
       -- que `9`. Esta columna es el valor, y existe SOLO para `order by` y
       -- para los extremos del intervalo: nadie la lee como importe.
       ov.original_amount        as total_order,
       ov.effective_date,
       md.concept,
       ec.category_id,
       -- QUIENES ENTRARON EN EL REPARTO. Identidades contextuales del propio
       -- ambito, no cuentas: el vinculo sigue sin publicarse (ADR-012 §1).
       array_agg(distinct e.economic_participant_id)
         filter (where e.economic_participant_id is not null) as participant_ids,
       -- LA CUOTA DE QUIEN MIRA, que NO es el total del gasto. Sale del efecto
       -- economico de su propio participante; si no participo, no hay fila y
       -- queda nula — que es distinto de cero.
       (select ee.economic_amount::text
          from core.current_effect ee
         where ee.operation_version_id = ov.id
           and ee.economic_amount is not null
           and ee.economic_participant_id is not null
           and sec.is_my_participant(ee.economic_participant_id)
         limit 1)               as your_share,
       ov.supersedes_version_id as previous_version_id,
       ov.version_no,
       o.created_at             as operation_created_at
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o          on o.id  = ov.operation_id
  join core.scope s              on s.id  = e.scope_id
  left join core.movement_detail md  on md.operation_version_id = ov.id
  left join core.expense_category ec on ec.operation_version_id = ov.id
 where s.kind = 'group'
   and o.operation_class = 'group_expense'
   and ov.version_kind = 'record'
 group by o.id, e.scope_id, e.currency_definition_id, ov.id, ov.original_amount,
          ov.effective_date, md.concept, ec.category_id,
          ov.supersedes_version_id, ov.version_no, o.created_at;

comment on view api.group_operation is
  'Los gastos de un grupo, UNA FILA POR OPERACION y en su version vigente. `total_amount` es el gasto entero; `your_share` la cuota de quien mira, que no es lo mismo (ADR-025).';
comment on column api.group_operation.total_order is
  'El mismo importe como entero, solo para ordenar y acotar. Nunca se lee como cifra: la que se lee es total_amount, en texto.';
comment on column api.group_operation.total_amount is
  'Importe DECLARADO del gasto, en la divisa base del grupo. NO es la cuota de nadie.';
comment on column api.group_operation.your_share is
  'La participacion economica del actor en ese gasto. Nula si no participo, que no es cero.';
comment on column api.group_operation.participant_ids is
  'Los participantes que entraron en el REPARTO. No es quien pago ni quien lo registro. Identidades contextuales del ambito; el vinculo con la cuenta sigue sin publicarse (ADR-012 §1).';

grant select on api.group_operation to authenticated;

-- ------------------------------ el resumen --------------------------------
--
-- **Agregado en el SERVIDOR, y por la misma razon que `api.personal_statistics`:
-- PostgREST rechaza funciones de agregado pedidas por el cliente (`PGRST123`) y
-- `max_rows` acota una peticion a mil filas.** Sumar en el cliente daria una
-- cifra contable incompleta que no lanza nada — exactamente lo que F6.E midio.
--
-- **Y NO se filtra.** Las tres cifras describen el grupo entero: un filtro del
-- listado que moviera el `Total` estaria contando otra cosa que la que dice.
create view api.group_summary
with (security_invoker = true) as
select e.scope_id,
       e.currency_definition_id,
       -- TOTAL: lo que el grupo se ha gastado. Suma de la economica de todos.
       coalesce(sum(e.economic_amount) filter (
         where e.economic_amount is not null and e.economic_participant_id is not null
       ), 0)::text as total_amount,
       -- TU GASTO: solo las cuotas del actor.
       coalesce(sum(e.economic_amount) filter (
         where e.economic_amount is not null
           and e.economic_participant_id is not null
           and sec.is_my_participant(e.economic_participant_id)
       ), 0)::text as your_share,
       -- POSICION: lo que te deben menos lo que debes. Positivo = te deben.
       (coalesce(sum(e.debt_amount) filter (
          where e.debt_amount is not null and sec.is_my_participant(e.debt_creditor_participant_id)
        ), 0)
        - coalesce(sum(e.debt_amount) filter (
          where e.debt_amount is not null and sec.is_my_participant(e.debt_debtor_participant_id)
        ), 0))::text as net_position,
       -- EL MAYOR GASTO VIGENTE, SIN FILTRAR NI PAGINAR. Es el limite derecho
       -- de la barra de intervalo: si saliera del resultado filtrado, elegir
       -- una categoria encogeria el maximo y el intervalo dejaria de tener
       -- sentido a mitad de uso.
       coalesce((select max(go.total_order)
                   from api.group_operation go
                  where go.scope_id = e.scope_id), 0)::text as max_total,
       -- CUANTOS GASTOS HAY, tambien sin filtrar. Distingue «este grupo no
       -- tiene movimientos» de «ninguno coincide con el filtro».
       (select count(*)
          from api.group_operation go
         where go.scope_id = e.scope_id)::int as expense_count
  from core.current_effect e
  join core.scope s on s.id = e.scope_id
 where s.kind = 'group'
 group by e.scope_id, e.currency_definition_id;

comment on view api.group_summary is
  'Las tres cifras de un grupo, agregadas EN EL SERVIDOR sobre la proyeccion canonica. `total_amount` no es la cuota de nadie y `net_position` es te-deben menos debes (ADR-016). NO se filtra: describe el grupo entero.';
comment on column api.group_summary.max_total is
  'El mayor gasto vigente del grupo, sin filtrar ni paginar. Limite derecho del intervalo de importe.';
comment on column api.group_summary.expense_count is
  'Cuantos gastos vigentes tiene el grupo, sin filtrar. Distingue un grupo vacio de un filtro sin coincidencias.';

grant select on api.group_summary to authenticated;
