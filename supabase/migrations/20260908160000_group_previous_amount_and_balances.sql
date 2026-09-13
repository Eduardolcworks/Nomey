-- ===========================================================================
-- F9 · EL IMPORTE ANTERIOR DE UN GASTO CORREGIDO, Y LOS SALDOS DEL GRUPO
-- ===========================================================================
--
-- Dos lecturas, ninguna relacion nueva y ningun agregado guardado.
--
-- ============ 1 · EL IMPORTE ANTERIOR SALE DE LA VERSION ANTERIOR ==========
--
-- Y no de un saldo ni de un resumen: es el `original_amount` DECLARADO de la
-- version que la vigente supera, leido de `core.operation_version`, que el
-- cliente ya alcanza. Asi la tarjeta lo enseña igual tras recargar y desde otra
-- cuenta autorizada, sin depender de que este aparato presenciara la edicion.
--
-- **Es el mismo criterio que F6.D fijo para el Modo Personal**: se compara
-- `original_amount` con `original_amount` y nadie fabrica el signo, porque los
-- efectos de una version superada viven en `core.effect`, que ninguna vista
-- puede leer. Con varias ediciones sucesivas se enseña **la inmediatamente
-- anterior**, no la primera: es la que dice que cambio en el ultimo cambio.
--
-- **Que exista otra version no significa que el importe cambiara.** Corregir la
-- categoria, el concepto o el reparto es una edicion y deja version nueva con el
-- MISMO `original_amount`. Quien pinta decide comparar; aqui solo se publica el
-- dato, para no esconder la diferencia entre «hubo edicion» y «cambio el total».
--
-- ============ 2 · LOS SALDOS, DERIVADOS Y CON SUMA CERO ====================
--
-- La posicion neta de cada participante del grupo: lo que le deben menos lo que
-- debe, sobre los efectos VIGENTES. Las liquidaciones entran solas — son efectos
-- de deuda con importe negativo (`accounting_class = 'settlement'`), asi que
-- restan sin ninguna clausula especial.
--
-- **Suma exactamente cero por construccion.** Cada efecto de deuda aporta
-- `+amount` a su acreedor y `-amount` a su deudor; sumando todos los
-- participantes, cada efecto se cancela consigo mismo. No es una comprobacion
-- que haya que hacer: es la forma de la agregacion.
--
-- **Y sale de la posicion, no del gasto.** Lo que alguien consumio
-- —`economic_amount`— y lo que adelanto como pagador son otras dos cifras;
-- confundirlas es el defecto que `AGENTS.md` §2 existe para impedir.
-- ===========================================================================

drop view if exists api.group_summary;
drop view if exists api.group_operation;

create view api.group_operation
with (security_invoker = true) as
select o.id                     as operation_id,
       ov.id                    as version_id,
       e.scope_id,
       e.currency_definition_id,
       ov.original_amount::text as total_amount,
       ov.original_amount        as total_order,
       ov.effective_date,
       md.concept,
       ec.category_id,
       sp.payer_participant_id,
       sp.split_method,
       (select ee.economic_amount::text
          from core.current_effect ee
         where ee.operation_version_id = ov.id
           and ee.economic_amount is not null
           and ee.economic_participant_id is not null
           and sec.is_my_participant(ee.economic_participant_id)
         limit 1)               as your_share,
       ov.supersedes_version_id as previous_version_id,
       -- EL IMPORTE DE LA VERSION ANTERIOR, declarado. Nulo en un alta.
       (select prev.original_amount::text
          from core.operation_version prev
         where prev.id = ov.supersedes_version_id) as previous_amount,
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
comment on column api.group_operation.previous_amount is
  'Importe DECLARADO de la version inmediatamente anterior. Nulo en un alta. Que exista no implica que el importe cambiara: corregir el concepto deja el mismo.';
comment on column api.group_operation.version_id is
  'La version VIGENTE. Es el expected_version_id de una correccion o una anulacion (ADR-011 §13).';
comment on column api.group_operation.payer_participant_id is
  'Quien puso el dinero. NO es quien registro la operacion ni quien tiene cuota: son tres preguntas distintas (AGENTS.md §2).';
comment on column api.group_operation.split_method is
  'equal | shares | exact_amounts. El metodo DECLARADO, no una inferencia sobre las cuotas resueltas.';
comment on column api.group_operation.total_order is
  'El mismo importe como entero, solo para ordenar y acotar. Nunca se lee como cifra: la que se lee es total_amount, en texto.';
comment on column api.group_operation.your_share is
  'La participacion economica del actor en ese gasto. Nula si no participo, que no es cero.';

grant select on api.group_operation to authenticated;

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

-- ---------------------- la posicion de cada participante -------------------
--
-- **TODOS los participantes del grupo, tengan cuenta o no**, y por eso se parte
-- de `core.participant` y no de los efectos: quien no aparece en ninguna deuda
-- tiene posicion CERO CONOCIDO, que es un hecho y no una ausencia.
create view api.group_balance
with (security_invoker = true) as
select p.scope_id,
       p.id                as participant_id,
       p.display_name,
       s.base_currency_definition_id as currency_definition_id,
       -- Sobre uno mismo y nada mas, igual que `api.group_participant`.
       sec.is_my_participant(p.id) as is_self,
       (coalesce((select sum(e.debt_amount) from core.current_effect e
                   where e.scope_id = p.scope_id and e.debt_amount is not null
                     and e.debt_creditor_participant_id = p.id), 0)
        - coalesce((select sum(e.debt_amount) from core.current_effect e
                     where e.scope_id = p.scope_id and e.debt_amount is not null
                       and e.debt_debtor_participant_id = p.id), 0))::text as net_position
  from core.participant p
  join core.scope s on s.id = p.scope_id
 where s.kind = 'group';

comment on view api.group_balance is
  'La posicion NETA de cada participante del grupo: lo que le deben menos lo que debe, sobre los efectos vigentes. Las liquidaciones entran solas, con su importe negativo. La suma del grupo es cero por construccion.';
comment on column api.group_balance.net_position is
  'Con signo: positivo = le deben, negativo = debe, cero = saldado. NO es su gasto economico ni lo que adelanto (AGENTS.md §2).';

grant select on api.group_balance to authenticated;
