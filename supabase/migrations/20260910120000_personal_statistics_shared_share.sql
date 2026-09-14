-- ============================================================================
-- MI PARTE DE UN GASTO COMPARTIDO CUENTA EN MIS ESTADISTICAS. Una vez, en su
-- categoria, y sin importar quien pago.
-- ============================================================================
--
-- ═══════════ LA DECISION, Y LO QUE CAMBIA DE ADR-026 ═══════════
--
-- ADR-026 fijo que la dimension economica de un ambito personal la producen
-- exactamente `record_personal_expense` y `record_personal_income`, y que un
-- gasto de grupo mueve la caja del pagador **sin efecto economico en su
-- ambito**. Eso sigue siendo verdad: esta migracion no escribe ni un efecto.
-- Lo que se decide ahora es que las ESTADISTICAS del actor **atribuyen** ademas
-- la cuota economica que tiene en los gastos compartidos —la que ADR-016 ya
-- atribuye por `core.participant_user_link`— y la cuentan en la categoria del
-- gasto y en su fecha efectiva.
--
-- Tres cosas que la aritmetica tiene que respetar, y que la seccion M del check
-- de estadisticas afirma como igualdades:
--
-- - **La cuota, no lo adelantado.** Pago 20,00 entre dos: consumo 10,00. Los
--   20,00 son caja y los otros 10,00 son deuda; ninguno de los dos entra aqui.
-- - **Una vez.** La cuota vive en el ambito del grupo con participante, y la
--   caja en el personal sin el. `api.personal_effect` publica economico SOLO sin
--   participante, asi que la suma personal no la contenia y no puede contenerla
--   dos veces. Por eso se SUMA la atribucion, en vez de tocar la vista.
-- - **Sin importar quien pago.** Participar en un gasto que pago otra persona
--   es consumir igual: la atribucion es por vinculo al participante economico,
--   nunca por quien registro ni por quien puso el dinero.
--
-- ═══════════ POR QUE UN AYUDANTE REDUCIDO Y NO `claimed_dimension` ═══════════
--
-- `api.personal_statistics` corre como QUIEN LLAMA, y `core.participant_user_link`
-- no es legible por el cliente (ADR-012 §1). `api.claimed_dimension()` cruza esa
-- frontera, pero su lista de columnas ES su frontera de privacidad (ADR-016) y
-- no publica ni la categoria ni la operacion. Ensancharla para esto seria una
-- decision de privacidad tomada de paso. En su lugar, un ayudante definer
-- reducido, propiedad de `postgres` como el otro, que filtra por vinculo en su
-- propio cuerpo y publica exactamente lo que la estadistica necesita: clase,
-- fecha, categoria e importe. Nada que el actor no pueda ver ya en
-- `api.group_operation` como miembro.

create function sec.my_shared_expense_shares(p_from date default null, p_to date default null)
returns table (
  operation_id   uuid,
  effective_date date,
  category_id    uuid,
  amount         bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select ov.operation_id,
         ov.effective_date,
         xc.category_id,
         e.economic_amount
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.scope s on s.id = e.scope_id and s.kind = 'group'
    join core.participant_user_link l on l.participant_id = e.economic_participant_id
    left join core.expense_category xc on xc.operation_version_id = ov.id
   where l.user_id = (select auth.uid())
     and e.accounting_class = 'expense'
     and e.economic_amount is not null
     and (p_from is null or ov.effective_date >= p_from)
     and (p_to   is null or ov.effective_date <= p_to);
$fn$;

revoke execute on function sec.my_shared_expense_shares(date, date) from public;
grant  execute on function sec.my_shared_expense_shares(date, date) to authenticated;

comment on function sec.my_shared_expense_shares(date, date) is
  'La cuota economica del actor en gastos compartidos vigentes, por vinculo al '
  'participante economico. Solo grupos, solo gasto: lo que sus estadisticas '
  'personales atribuyen ademas de su propio ambito.';

-- La misma funcion que antes con un sumando mas en el total y en el desglose.
-- `income_total` no cambia: no hay ingresos compartidos.
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
              select po.category_id, po.original_amount::bigint as amount
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
