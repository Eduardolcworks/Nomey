-- ============================================================================
-- LAS LECTURAS PERSONALES CON MONEDA EXTRANJERA · F11/ADR-001 §12 · F11.C
-- ============================================================================
--
-- 20260929120000 (F11.B B5) hizo que `personal_expense` y `personal_income`
-- convirtieran. Desde entonces una version puede declarar un importe en una
-- moneda que NO es la base de su ambito, y las dos lecturas que mezclaban esas
-- dos cosas dejaron de ser correctas. Esta migracion las separa.
--
--   §1  api.personal_operation publica la moneda ORIGINAL junto al importe
--       original; `currency_definition_id` sigue siendo la del efecto (la base)
--   §2  api.personal_operation_conversion: el tipo congelado y su procedencia,
--       por funcion lectora controlada
--   §3  api.personal_statistics agrupa por categoria la magnitud CONVERTIDA
--
-- ========================== QUE CANTIDAD ES CADA UNA ========================
--
--   original_amount                  el importe declarado, en su moneda
--   original_currency_definition_id  esa moneda
--   balance_amount / economic_amount el importe ya CONVERTIDO por B5
--   currency_definition_id           la base del ambito, que es la del efecto
--
-- Sin conversion las dos monedas coinciden y ninguna fila cambia de valor.
--
-- ===================== LO QUE UNA LECTURA NO HACE NUNCA =====================
--
-- No llama a `sec.fx_resolve`, no consulta al BCE, no recalcula la conversion
-- ni su redondeo, y no reconstruye el importe convertido a partir del original
-- y del coeficiente. La autoridad es la fila de `core.frozen_conversion` y el
-- importe que B5 dejo asentado en el efecto, que ya incorpora el unico
-- redondeo (F11/ADR-001 §7, §9). Reconstruirlo aqui seria un segundo punto de
-- redondeo, y dos puntos derivan.
--
-- Lo que NO trae: nada de F11.D. `api.group_operation` sigue intacta —ningun
-- gasto de grupo admite otra moneda todavia—, y la cuota de un gasto
-- compartido sigue entrando en las estadisticas en la moneda del grupo, que es
-- el caso que F11.D tiene que resolver. No se toca `core`.
-- ============================================================================

-- ═════════════ §1 · la moneda original, junto al importe original ════════════
--
-- Se ANADE una columna; `currency_definition_id` conserva su significado, que
-- es la moneda del efecto. Renombrarla romperia el contrato publicado y haria
-- ambiguo lo que ya leen el cliente y `api.personal_operation_version`.
--
-- Va la ultima porque `create or replace view` solo admite anadir al final, y
-- el orden de columnas no es contrato: PostgREST las pide por nombre.
--
-- Para las clases que no convierten —ajuste, gasto de grupo, pago de grupo— la
-- moneda original es, por construccion, la misma que la del efecto: sus
-- writers conservan `sec.assert_no_conversion`.
create or replace view api.personal_operation
with (security_invoker = true) as
select o.id as operation_id,
       o.operation_class,
       e.scope_id,
       e.currency_definition_id,
       sum(e.balance_amount)::text as balance_amount,
       ov.original_amount::text as original_amount,
       ov.effective_date,
       ov.effective_time,
       md.concept,
       xc.category_id,
       ad.target_balance::text as target_balance,
       o.current_version_id,
       ov.supersedes_version_id as previous_version_id,
       ov.version_no,
       o.created_at as operation_created_at,
       coalesce(ctx.group_scope_id, pctx.group_scope_id) as group_scope_id,
       coalesce(ctx.group_display_name, pctx.group_display_name) as group_display_name,
       ctx.your_share,
       pctx.counterpart_display_name as payment_counterpart,
       ov.original_currency_definition_id
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category xc on xc.operation_version_id = ov.id
  left join core.adjustment_detail ad on ad.operation_version_id = ov.id
  left join sec.my_group_expense_context() ctx(operation_id, group_scope_id, group_display_name, your_share) on ctx.operation_id = o.id
  left join sec.my_group_payment_context() pctx(operation_id, group_scope_id, group_display_name, counterpart_display_name) on pctx.operation_id = o.id
 where s.kind = 'personal' and s.owner_user_id = (select auth.uid())
   and o.operation_class = any (array['personal_expense', 'personal_income', 'adjustment', 'group_expense', 'group_payment'])
   and ov.version_kind = 'record' and e.balance_amount is not null
   -- F10/ADR-005 §3: con fresh, la historia de grupo anterior al corte no es del Personal.
   and sec.counts_in_personal(e.scope_id, o.id)
 group by o.id, o.operation_class, e.scope_id, e.currency_definition_id, ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, xc.category_id, ad.target_balance, o.current_version_id, ov.supersedes_version_id, ov.version_no, o.created_at,
          ctx.group_scope_id, ctx.group_display_name, ctx.your_share, pctx.group_scope_id, pctx.group_display_name, pctx.counterpart_display_name,
          ov.original_currency_definition_id;

comment on view api.personal_operation is
  'La operacion vigente del Modo Personal. `original_amount` va en `original_currency_definition_id`; `balance_amount`, ya convertido, en `currency_definition_id`, que es la base del ambito (F11/ADR-001 §12).';

-- ══════════════ §2 · el tipo congelado y su procedencia, por lectura ═════════
--
-- `core.frozen_conversion` y `core.frozen_conversion_provenance` no tienen —ni
-- ganan aqui— ningun privilegio de cliente: B5 se los dio solo al writer. La
-- unica via es esta funcion, del mismo patron que `api.claimed_dimension`:
-- SECURITY DEFINER de `postgres`, que es quien posee las tablas y por tanto no
-- esta sujeto a su RLS, y por eso mismo **la autorizacion la hace su cuerpo**.
--
-- Tres cosas la acotan, y ninguna es la RLS:
--
--   · el ambito tiene que ser un Modo Personal cuyo `owner_user_id` sea el
--     actor. Sin JWT, `auth.uid()` es nulo y no hay fila que iguale;
--   · solo la version VIGENTE de la operacion. La conversion de una version
--     superada no sale: el historial publica el importe declarado y nada mas
--     (F03/ADR-010 §3), y ampliarlo seria una decision de producto;
--   · el corte del Personal tras el Invitado, igual que el resto de lecturas.
--
-- Y su LISTA DE COLUMNAS es la frontera de privacidad, como en
-- `api.claimed_dimension`: sale lo que hace falta para presentar la conversion
-- —las dos monedas, el tipo, la fecha que se resolvio, la fuente y las dos
-- fechas de referencia— y no salen los identificadores internos de las
-- publicaciones del BCE ni el metodo, que es un vocabulario de un solo valor.
--
-- El coeficiente cruza como TEXTO. Es un `bigint` exacto de hasta 12 decimales
-- de escala: parsearlo como numero de JSON lo degradaria igual que a un
-- importe (F03/ADR-005 §1, F03/ADR-012).
create function api.personal_operation_conversion(p_operation_ids uuid[] default null)
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
  target_reference_date         date
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
         pv.target_reference_date
    from core.frozen_conversion fc
    join core.frozen_conversion_provenance pv
      on pv.operation_version_id = fc.operation_version_id and pv.scope_id = fc.scope_id
    join core.operation_version ov on ov.id = fc.operation_version_id
    join core.operation o on o.id = ov.operation_id
    join core.scope s on s.id = fc.scope_id
   where s.kind = 'personal'
     and s.owner_user_id = (select auth.uid())
     and o.current_version_id = fc.operation_version_id
     and sec.counts_in_personal(fc.scope_id, ov.operation_id)
     and (p_operation_ids is null or ov.operation_id = any (p_operation_ids));
$fn$;

comment on function api.personal_operation_conversion(uuid[]) is
  'La conversion congelada de las operaciones personales del actor y su procedencia (F11/ADR-001 §9). Autoridad de lo ya convertido: no resuelve nada, no consulta al BCE y no recalcula. Autoriza en su cuerpo, por propiedad del ambito.';

revoke execute on function api.personal_operation_conversion(uuid[]) from public;
grant  execute on function api.personal_operation_conversion(uuid[]) to authenticated;

-- ═══════════ §3 · el desglose por categoria, en la magnitud convertida ═══════
--
-- `expense_total` ya era correcto: suma `economic_amount` del efecto, que B5
-- escribe convertido y en la base. El desglose no lo era, porque sumaba
-- `original_amount`, que desde B5 puede venir en otra moneda y con otra
-- escala. Con un gasto de JPY 150000 en un Personal en EUR, el total iba en
-- euros y la categoria en unidades minimas de yen; ni un error, y el
-- invariante de F06/ADR-008 §6 —la suma del desglose ES `expense_total`—
-- dejaba de cumplirse.
--
-- Ahora el desglose suma la magnitud ASENTADA —`balance_amount` cambiado de
-- signo— por la MISMA superficie de siempre, `api.personal_operation`, con
-- todos sus predicados: la clase, `version_kind` y el corte del Personal. No
-- es reconstruir la conversion: para un gasto personal B5 escribe la caja y la
-- dimension economica desde el mismo importe convertido, `-v` y `v`, asi que
-- es exactamente la cifra que `expense_total` suma por `api.personal_effect`,
-- con su unico redondeo.
--
-- Por que no leer `core.current_effect` directamente: las estadisticas se
-- COMPONEN sobre las superficies de `api` (F03/ADR-010 §9), y
-- personal-statistics.sql A3b lo vigila exigiendo esa dependencia de catalogo.
-- Esa guarda no se relaja.
--
-- La cuota de un gasto compartido se deja EXACTAMENTE como estaba: viene en la
-- moneda del grupo y sumarla a un total en la base del Personal es el defecto
-- que resuelve F11.D, no este bloque.
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
  'Ingresos, gastos y desglose por categoria del Modo Personal, todo en la moneda base: las tres cifras propias salen de la magnitud economica vigente, que ya esta convertida (F06/ADR-008, F11/ADR-001 §12).';
