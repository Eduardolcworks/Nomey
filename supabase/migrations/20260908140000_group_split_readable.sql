-- ===========================================================================
-- F9 · QUIEN PAGO, COMO SE REPARTIO, Y QUE VERSION ES LA VIGENTE
-- ===========================================================================
--
-- Tres cosas que el cliente necesita y no podia leer, y ninguna funcion nueva:
-- todo lo que sigue es lectura sobre hechos que el escritor ya persiste.
--
-- ============ 1 · EL REPARTO SE ABRE AL CLIENTE, CON SU RLS ================
--
-- `core.split` y `core.split_participant` no tenian `select` para
-- `authenticated`. Medido en la tanda anterior: con el pagador en la vista,
-- `api.group_operation` respondia `permission denied for table split`, porque
-- una vista `security_invoker` se evalua con los privilegios de QUIEN LLAMA.
-- Entonces se declino ampliar la superficie porque nada lo necesitaba; ahora la
-- tarjeta dice «Pagado por X» y el formulario de correccion tiene que
-- reconstruir el reparto DECLARADO, asi que se abre — con la misma politica que
-- el resto del contenido de una version: **quien es miembro del ambito**.
--
-- **No revela nada que el miembro no viera ya.** `core.current_effect` le
-- publica las cuotas economicas de cada participante de su grupo, y
-- `api.group_participant` sus nombres. Lo que se anade es el METODO y lo
-- DECLARADO —partes o importes exactos—, que es exactamente lo que hace falta
-- para corregir sin aproximar. Y sigue sin publicarse `participant_user_link`:
-- que cuenta global hay detras de cada participante no se dice aqui.
--
-- ============ 2 · Y EL FILTRO POR PERSONA CAMBIA DE SIGNIFICADO ============
--
-- Pasa a ser **por PAGADOR**. `participant_ids` desaparece de la vista en lugar
-- de convivir con la nueva columna: dos maneras de responder «filtra por
-- persona» son dos productos distintos en la misma pantalla, y la que queda es
-- la que el producto quiere.
-- ===========================================================================

grant select on core.split             to authenticated;
grant select on core.split_participant to authenticated;

-- La misma forma que `movement_detail_client_select` y las suyas: se es miembro
-- del ambito o no se ve la fila. Aqui el ambito esta EN la propia tabla, asi
-- que no hace falta pasar por los efectos.
create policy split_client_select on core.split
  for select to authenticated
  using (sec.is_member(scope_id));

create policy split_participant_client_select on core.split_participant
  for select to authenticated
  using (sec.is_member(scope_id));

-- ==================== 3 · lo que la lista publica ahora ====================

drop view if exists api.group_summary;
drop view if exists api.group_operation;

create view api.group_operation
with (security_invoker = true) as
select o.id                     as operation_id,
       -- LA VERSION VIGENTE, por su identidad. Es lo que una correccion manda
       -- como `expected_version_id`: sin ella el cliente no puede declarar
       -- sobre QUE esta corrigiendo, y el CAS de ADR-011 §13 no tendria contra
       -- que comparar.
       ov.id                    as version_id,
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
       -- QUIEN PAGO, y solo eso: no es quien registro la operacion
       -- —`operation.created_by`, que no se publica— ni quien tiene cuota.
       sp.payer_participant_id,
       sp.split_method,
       -- LA CUOTA DE QUIEN MIRA, que NO es el total del gasto ni lo que
       -- adelanto como pagador. Sale del efecto economico de su propio
       -- participante; si no participo, no hay fila y queda nula — que es
       -- distinto de cero.
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
  join core.split sp             on sp.operation_version_id = ov.id and sp.scope_id = e.scope_id
  left join core.movement_detail md  on md.operation_version_id = ov.id
  left join core.expense_category ec on ec.operation_version_id = ov.id
 where s.kind = 'group'
   and o.operation_class = 'group_expense'
   and ov.version_kind = 'record'
 group by o.id, ov.id, e.scope_id, e.currency_definition_id, ov.original_amount,
          ov.effective_date, md.concept, ec.category_id,
          sp.payer_participant_id, sp.split_method,
          ov.supersedes_version_id, ov.version_no, o.created_at;

comment on view api.group_operation is
  'Los gastos de un grupo, UNA FILA POR OPERACION y en su version vigente. `total_amount` es el gasto entero; `your_share` la cuota de quien mira, que no es lo mismo (ADR-025).';
comment on column api.group_operation.version_id is
  'La version VIGENTE. Es el expected_version_id de una correccion o una anulacion (ADR-011 §13).';
comment on column api.group_operation.payer_participant_id is
  'Quien puso el dinero. NO es quien registro la operacion ni quien tiene cuota: son tres preguntas distintas (AGENTS.md §2).';
comment on column api.group_operation.split_method is
  'equal | shares | exact_amounts. El metodo DECLARADO, no una inferencia sobre las cuotas resueltas.';
comment on column api.group_operation.total_order is
  'El mismo importe como entero, solo para ordenar y acotar. Nunca se lee como cifra: la que se lee es total_amount, en texto.';
comment on column api.group_operation.total_amount is
  'Importe DECLARADO del gasto, en la divisa base del grupo. NO es la cuota de nadie.';
comment on column api.group_operation.your_share is
  'La participacion economica del actor en ese gasto. Nula si no participo, que no es cero.';

grant select on api.group_operation to authenticated;

-- ------------------- el reparto declarado, por participante ---------------
--
-- **Lo DECLARADO y lo RESUELTO, cada uno por su lado.** Es lo que permite
-- precargar una correccion sin aproximar: reconstruir «3 partes» dividiendo
-- cuotas resueltas es una inferencia, y ante un resto repartido por el
-- desempate de ADR-002 §5 daria un reparto que nadie escribio.
create view api.group_split_participant
with (security_invoker = true) as
select sp.operation_version_id as version_id,
       sp.scope_id,
       sp.participant_id,
       sp.ordinal,
       sp.split_method,
       sp.declared_weight::text as declared_weight,
       sp.declared_amount::text as declared_amount,
       sp.resolved_amount::text as resolved_amount
  from core.split_participant sp
  join core.scope s on s.id = sp.scope_id
 where s.kind = 'group';

comment on view api.group_split_participant is
  'El reparto DECLARADO de una version, participante a participante. El ordinal es el desempate de ADR-002 §5, no decoracion.';

grant select on api.group_split_participant to authenticated;

-- ------------------------------ el resumen --------------------------------
--
-- Sin cambios de contenido: se recrea porque dependia de la vista anterior.
create view api.group_summary
with (security_invoker = true) as
select e.scope_id,
       e.currency_definition_id,
       coalesce(sum(e.economic_amount) filter (
         where e.economic_amount is not null and e.economic_participant_id is not null
       ), 0)::text as total_amount,
       coalesce(sum(e.economic_amount) filter (
         where e.economic_amount is not null
           and e.economic_participant_id is not null
           and sec.is_my_participant(e.economic_participant_id)
       ), 0)::text as your_share,
       (coalesce(sum(e.debt_amount) filter (
          where e.debt_amount is not null and sec.is_my_participant(e.debt_creditor_participant_id)
        ), 0)
        - coalesce(sum(e.debt_amount) filter (
          where e.debt_amount is not null and sec.is_my_participant(e.debt_debtor_participant_id)
        ), 0))::text as net_position,
       coalesce((select max(go.total_order)
                   from api.group_operation go
                  where go.scope_id = e.scope_id), 0)::text as max_total,
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
