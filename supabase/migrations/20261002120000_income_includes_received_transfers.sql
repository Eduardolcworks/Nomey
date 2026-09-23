-- ============================================================================
-- LA TRANSFERENCIA PERSONAL RECIBIDA CUENTA EN «INGRESOS» (F12.E, 2026-09-22)
-- ============================================================================
--
-- DECISION DE PRODUCTO, no un ADR nuevo: una transferencia Personal → Personal
-- ACEPTADA contribuye al agregado de Ingresos de quien la recibe, sin
-- convertirse en una segunda operacion de ingreso.
--
-- ═══════════ QUE CAMBIA, Y QUE NO ═══════════
--
-- Cambia UN sumando de `income_total`. No cambia:
--
--   · la operacion: sigue siendo un `internal_transfer` con UNA version, dos
--     efectos de SALDO (−N / +N) y ningun efecto economico. No se escribe
--     nada nuevo, no se duplica nada y el Disponible sigue derivandose igual;
--   · `api.personal_operation`, que sigue sin listar la clase (su lista
--     blanca no cambia). La fila «Recibiste 25,00 € de Edu» sigue saliendo de
--     `api.my_transfers`, una sola vez;
--   · `expense_total`, ni las categorias. Enviar NO es gasto todavia: esa
--     decision no se ha tomado, y tomarla de paso aqui seria inventarla.
--
-- ═══════════ POR QUE `internal_transfer` Y NO «toda transferencia» ═══════════
--
-- `settlement_by_transfer` (F12/ADR-003) tambien produce efectos de clase
-- `transfer` en los dos Personales, y **no puede contar**: es el pago de una
-- deuda de grupo, y F01/ADR-001 lo fija sin ambiguedad — una liquidacion no es
-- un ingreso; cuando vuelven los 90 cancelan una deuda, no son ganancias
-- nuevas. Sumar por `accounting_class = 'transfer'` habria metido justo eso.
-- Por eso el ayudante filtra por CLASE DE OPERACION y no por clase contable, y
-- el check lo mide con un `settlement_by_transfer` de verdad.
--
-- ═══════════ POR QUE UN AYUDANTE REDUCIDO ═══════════
--
-- El mismo motivo que `sec.my_shared_expense_shares` (20260910120000):
-- `api.personal_statistics` corre como QUIEN LLAMA y no alcanza `core`, donde
-- vive `operation_class`. `api.my_transfers` si es legible, pero no publica la
-- clase: distinguirla por `group_scope_id is null` seria un proxy —correcto
-- hoy por el CHECK `transfer_part_grupo_todo_o_nada`, pero un proxy—, y la
-- regla merece decirse entera. El ayudante publica exactamente tres columnas
-- del ambito PROPIO del actor, todas las cuales ya puede leer en
-- `api.my_transfers`: no abre ninguna informacion nueva.
--
-- La fecha es `effective_date`, la MISMA con la que el agregado acota su
-- intervalo, y la misma que `api.my_transfers` publica. No se inventa
-- ninguna: `record_internal_transfer` la escribe como `current_date` en la
-- transaccion de la aceptacion (§21 de F12/ADR-002), asi que el dia del
-- agregado y el instante que ordena la lista son el mismo hecho.
--
-- La moneda tampoco necesita decision: `sec.assert_no_conversion` rehusa la
-- aceptacion salvo que la divisa sea la BASE de los dos Personales, de modo
-- que lo recibido ya esta en la base de quien recibe. No hay FX que resolver
-- aqui, y este cambio no abre ninguno.

-- ══════════════════════ 1 · el ayudante reducido ════════════════════════════
create function sec.my_received_transfers(p_from date default null, p_to date default null)
returns table (
  operation_id   uuid,
  effective_date date,
  amount         bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select ov.operation_id,
         ov.effective_date,
         e.balance_amount
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
    join core.scope s on s.id = e.scope_id
   where s.kind = 'personal'
     and s.owner_user_id = (select auth.uid())
     -- SOLO la transferencia entre Personales. La de grupo es una liquidacion.
     and o.operation_class = 'internal_transfer'
     and ov.version_kind = 'record'
     -- El lado RECIBIDO. El del emisor es negativo y queda fuera por esto
     -- mismo: enviar no resta de Ingresos ni suma en ningun sitio.
     and e.balance_amount > 0
     and (p_from is null or ov.effective_date >= p_from)
     and (p_to   is null or ov.effective_date <= p_to)
     -- F10/ADR-005 §3: con `fresh`, lo anterior al corte no es de este Personal.
     and sec.counts_in_personal(e.scope_id, o.id);
$fn$;

revoke execute on function sec.my_received_transfers(date, date) from public;
grant  execute on function sec.my_received_transfers(date, date) to authenticated;

comment on function sec.my_received_transfers(date, date) is
  'Las transferencias Personal → Personal ACEPTADAS y RECIBIDAS por el actor en su propio '
  'ambito, por intervalo de effective_date. Solo internal_transfer: settlement_by_transfer es '
  'el pago de una deuda de grupo y una liquidacion no es un ingreso (F01/ADR-001). Solo el lado '
  'positivo: lo enviado no entra. Lo consume api.personal_statistics.';

-- ══════════════════════ 2 · el agregado, con un sumando mas ══════════════════
--
-- LA BASE ES 20261001120000 (F11.C), NO 20260910120000. Esta migracion nacio
-- sobre la definicion anterior y se rehizo sobre la de F11.C al integrarse
-- aquella primero: las dos hacen `create or replace` de la MISMA funcion, y
-- la segunda en aplicarse pisa entera a la primera. Reutilizar el cuerpo viejo
-- habria borrado en silencio el §3 de F11.C —el desglose por categoria en la
-- magnitud ASENTADA (`- balance_amount`) en vez de la declarada, que es lo
-- que lo arregla cuando el gasto venia en otra moneda—.
--
-- Asi que lo que sigue es la funcion de F11.C **literal**, con CINCO lineas
-- anadidas y ninguna quitada: el sumando de `income_total`. `expense_total`,
-- las categorias y todo lo demas quedan exactamente como F11.C los dejo.
create or replace function api.personal_statistics(p_from date default null, p_to date default null)
returns jsonb
language sql
stable
set search_path = ''
begin atomic
  select jsonb_build_object(
    'scope_id', ps.id,
    'currency_definition_id', ps.base_currency_definition_id,
    'from', p_from,
    'to',   p_to,
    'income_total', (
      coalesce((select sum(pe.economic_amount::bigint)
                  from api.personal_effect pe
                 where pe.scope_id = ps.id
                   and pe.accounting_class = 'income'
                   and pe.economic_amount is not null
                   and (p_from is null or pe.effective_date >= p_from)
                   and (p_to   is null or pe.effective_date <= p_to)), 0)
      -- F12.E: lo recibido por transferencia entre Personales. Una sola vez:
      -- un internal_transfer no produce dimension economica, asi que el
      -- sumando de arriba no puede haberlo contado ya.
      + coalesce((select sum(rt.amount)
                    from sec.my_received_transfers(p_from, p_to) rt), 0)
    )::text,
    'expense_total', (
      coalesce((select sum(pe.economic_amount::bigint)
                  from api.personal_effect pe
                 where pe.scope_id = ps.id
                   and pe.accounting_class = 'expense'
                   and pe.economic_amount is not null
                   and (p_from is null or pe.effective_date >= p_from)
                   and (p_to   is null or pe.effective_date <= p_to)), 0)
      + coalesce((select sum(sh.amount)
                    from sec.my_shared_expense_shares(p_from, p_to) sh), 0)
    )::text,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'category_id',     g.category_id,
               'expense_total',   g.total::text,
               'operation_count', g.operations)
             order by g.total desc, g.category_id)
        from (
          -- Las dos fuentes, unidas ANTES de agrupar: una categoria con gasto
          -- propio y cuota compartida sale una vez, con la suma de ambas.
          select u.category_id, sum(u.amount) as total, count(*)::integer as operations
            from (
              -- La magnitud ASENTADA del gasto personal, no la declarada.
              select po.category_id, - po.balance_amount::bigint as amount
                from api.personal_operation po
               where po.scope_id = ps.id
                 and po.operation_class = 'personal_expense'
                 and po.category_id is not null
                 and (p_from is null or po.effective_date >= p_from)
                 and (p_to   is null or po.effective_date <= p_to)
              union all
              select sh.category_id, sh.amount
                from sec.my_shared_expense_shares(p_from, p_to) sh
               where sh.category_id is not null
            ) u
           group by u.category_id
        ) g), '[]'::jsonb)
  ) from api.personal_scope ps;
end;
comment on function api.personal_statistics(date, date) is
  'Ingresos, gastos y desglose por categoria del Modo Personal, todo en la moneda base: las '
  'tres cifras propias salen de la magnitud economica vigente, que ya esta convertida '
  '(F06/ADR-008, F11/ADR-001 §12). income_total suma ademas las transferencias Personal '
  'RECIBIDAS y aceptadas (decision de producto de F12.E, 2026-09-22: contribuyen al agregado sin '
  'ser una segunda operacion). Enviar no es gasto: esa decision no esta tomada.';
