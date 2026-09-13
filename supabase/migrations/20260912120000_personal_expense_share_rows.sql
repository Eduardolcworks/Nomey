-- ============================================================================
-- EL DESGLOSE DE GASTOS DE PERSONAL EXPLICA SU TOTAL: una fila por cuota
-- compartida, con lo que la pantalla necesita para pintarla.
-- ============================================================================
--
-- ═══════════ EL FALLO, Y POR QUE NO SE ARREGLA EN `personal_operation` ═══════
--
-- El total de Gastos y el diagrama son la CUOTA ECONOMICA del actor
-- (`api.personal_statistics`, con `sec.my_shared_expense_shares`), pague quien
-- pague. El desplegable reutilizaba la lectura de Movimientos recientes
-- (`api.personal_operation`), que explica la CAJA: un gasto compartido pagado
-- por otro no mueve mi caja y no salia; uno pagado por mi salia por lo que
-- adelante, no por mi cuota. Movimientos recientes sigue siendo caja, y no se
-- toca: lo que faltaba era una lectura de las cuotas con su contexto.
--
-- ═══════════ LA MISMA FUENTE QUE EL TOTAL, POR CONSTRUCCION ═══════════
--
-- `sec.my_shared_expense_share_row` SE APOYA en `sec.my_shared_expense_shares`:
-- el mismo conjunto de filas, el mismo importe y el mismo intervalo que suma
-- el total y agrupa el diagrama. No hay una segunda atribucion que pueda
-- discrepar; la reconciliacion la afirma el check con importes exactos.
--
-- ═══════════ LO QUE PUBLICA, Y POR QUE ES UN DEFINER REDUCIDO ═══════════
--
-- El nombre y el emoji del grupo, el concepto, la categoria, quien pago (su
-- nombre CONTEXTUAL de participante, nunca su cuenta), el total del gasto y la
-- divisa del grupo. Son las columnas que un miembro ya ve en
-- `api.group_operation`; se publican aqui SIN pasar por la RLS de membresia
-- porque ADR-034 §4 conserva el historial personal de quien salio: su cuota
-- sigue siendo suya y sigue teniendo que poder leerse con su contexto. El
-- filtro es el vinculo `core.participant_user_link` al participante economico,
-- en el cuerpo del definer, como en `sec.my_shared_expense_shares`. La lista
-- de columnas ES la frontera de privacidad (ADR-016): ensancharla es una
-- decision de privacidad, no un detalle.
--
-- `api.personal_expense_share` corre como QUIEN LLAMA y solo delega: el patron
-- de `api.personal_statistics`, para que las funciones de `api` sigan siendo
-- invoker salvo `claimed_dimension`. Con `begin atomic`, porque `authenticated`
-- no tiene USAGE sobre `sec` y el cuerpo se resuelve al crearse.
--
-- ═══════════ LO QUE NO CAMBIA ═══════════
--
-- Ni un efecto, ni el total, ni el diagrama, ni Movimientos recientes, ni las
-- politicas de nadie. Multimoneda (F11) no se toca: cada fila lleva SU divisa
-- —la del grupo— y el cliente la formatea en ella; la suma multimoneda del
-- total es el mismo punto abierto que ya tiene `personal_statistics`.

create function sec.my_shared_expense_share_row(p_from date default null, p_to date default null)
returns table (
  operation_id           uuid,
  current_version_id     uuid,
  scope_id               uuid,
  group_display_name     text,
  group_emoji            text,
  concept                text,
  category_id            uuid,
  effective_date         date,
  effective_time         time,
  payer_display_name     text,
  total_amount           text,
  share_amount           text,
  currency_definition_id uuid,
  currency_code          text,
  currency_scale         integer,
  operation_created_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select sh.operation_id,
         o.current_version_id,
         sp.scope_id,
         gp.display_name,
         gp.emoji,
         md.concept,
         sh.category_id,
         sh.effective_date,
         ov.effective_time,
         py.display_name,
         ov.original_amount::text,
         sh.amount::text,
         s.base_currency_definition_id,
         cd.code,
         cd.scale,
         o.created_at
    from sec.my_shared_expense_shares(p_from, p_to) sh
    join core.operation o on o.id = sh.operation_id
    join core.operation_version ov on ov.id = o.current_version_id
    join core.split sp on sp.operation_version_id = ov.id
    join core.scope s on s.id = sp.scope_id
    join core.currency_definition cd on cd.id = s.base_currency_definition_id
    left join core.group_profile gp on gp.scope_id = s.id
    left join core.movement_detail md on md.operation_version_id = ov.id
    left join core.participant py on py.id = sp.payer_participant_id;
$fn$;

revoke execute on function sec.my_shared_expense_share_row(date, date) from public;
grant  execute on function sec.my_shared_expense_share_row(date, date) to authenticated;

comment on function sec.my_shared_expense_share_row(date, date) is
  'Cada cuota del actor en un gasto compartido vigente, con su contexto: las '
  'mismas filas que suma personal_statistics, para que el desglose de Gastos '
  'explique el total. Por vinculo al participante economico, sin membresia: '
  'ADR-034 conserva el historial personal de quien salio.';

create function api.personal_expense_share(p_from date default null, p_to date default null)
returns table (
  operation_id           uuid,
  current_version_id     uuid,
  scope_id               uuid,
  group_display_name     text,
  group_emoji            text,
  concept                text,
  category_id            uuid,
  effective_date         date,
  effective_time         time,
  payer_display_name     text,
  total_amount           text,
  share_amount           text,
  currency_definition_id uuid,
  currency_code          text,
  currency_scale         integer,
  operation_created_at   timestamptz
)
language sql
stable
set search_path = ''
-- `begin atomic`: el cuerpo se resuelve al crearse, como `personal_statistics`,
-- y por eso puede delegar en `sec` sin que `authenticated` tenga USAGE alli.
begin atomic
  select * from sec.my_shared_expense_share_row(p_from, p_to);
end;

revoke execute on function api.personal_expense_share(date, date) from public;
grant  execute on function api.personal_expense_share(date, date) to authenticated;

comment on function api.personal_expense_share(date, date) is
  'Las cuotas del actor en gastos compartidos, con contexto, para el desglose '
  'de Gastos de Personal. Mismo intervalo y mismas filas que personal_statistics.';
