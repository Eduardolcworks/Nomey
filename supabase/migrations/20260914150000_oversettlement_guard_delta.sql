-- ===========================================================================
-- F9 · LA GUARDA DE SOBRELIQUIDACION VIGILA LO QUE LA CORRECCION CAMBIA
-- ===========================================================================
--
-- ============================ EL DEFECTO, MEDIDO ===========================
--
-- Corregir SOLO EL CONCEPTO de un gasto se rechazaba con
-- `SETTLEMENT_EXCEEDS_DEBT` cuando el par del gasto estaba liquidado del todo
-- y despues otro gasto habia creado deuda en sentido contrario. Medido
-- (2026-09-14, sonda `probe-x1.sql` sobre la pila aislada): F pago 900 a tres
-- (Edu>F 300); Edu le pago 300; Edu pago 400 a cuatro (F>Edu 100). Cambiar el
-- concepto del primer gasto: rechazado. Subirlo a 1200: aceptado. Y anular
-- el gasto cruzado (el de 400) tambien se rechazaba.
--
-- ============================ POR QUE PASABA ===============================
--
-- Las dos guardas (20260908150000) exigen, en cada par con liquidaciones,
-- `S <= E + delta`: lo liquidado (neto, S) no supera lo debido (neto de los
-- gastos, E, mas lo que la version nueva aporta). Es data-model.md §3 y se
-- conserva. Dos cosas fallaban en como se preguntaba:
--
-- 1. La condicion era ABSOLUTA sobre el estado, y ese estado puede violarla
--    sin que nadie corrija nada: un gasto nuevo en sentido contrario baja E
--    por debajo de S, y las guardas de alta no lo miran —ni deben: una deuda
--    cruzada nueva es un hecho legitimo—. Desde ese momento CUALQUIER
--    correccion o anulacion que tocara ese par se rechazaba, aunque no
--    cambiara un centimo de deuda o la aumentara.
-- 2. El par se examinaba en la direccion en que la VERSION lo nombra, no en
--    la direccion en que se LIQUIDO. `S <= E + delta` solo tiene sentido en
--    la direccion de las liquidaciones; mirado al reves, un neto negativo
--    solo dice que quien debe es el otro, y se rechazaba anular un gasto
--    cruzado que no dejaba ninguna liquidacion sin respaldo.
--
-- ========================= LO QUE SE DECIDE, Y LO QUE NO ===================
--
-- Se conserva la semantica decidida —deuda como saldo continuo NETEADO por
-- par, la misma de `sec.pending_debt` y de la posicion neta de ADR-016— y la
-- alternativa de comparar por direccion sigue descartada por lo mismo que en
-- 20260908150000. Lo que cambia es COMO se pregunta:
--
-- - El par se orienta por sus liquidaciones: a→b es la direccion en la que
--   se liquido neto (S > 0). Sin liquidaciones netas, no hay nada que vigilar.
-- - Se rechaza solo lo que la propia correccion o anulacion HACE: si deja el
--   neto del par (E − S, mas lo que aporta la version nueva) por debajo de
--   cero Y por debajo de lo que dejaba la version vigente.
--
--     S > 0   Y   neto_despues < 0   Y   neto_despues < neto_antes
--
-- Consecuencias, medidas en supabase/checks/oversettlement-delta.sql:
-- - Deuda 5000, liquidado 4000, corregida a 3000: sigue siendo
--   `SETTLEMENT_EXCEEDS_DEBT` (el ejemplo canonico no cambia); a 4000, vale.
-- - Corregir solo el concepto, o subir el importe, en un par ya sobrepasado
--   por un gasto cruzado: permitido (no empeora nada). Bajarlo: rechazado.
-- - Anular el gasto liquidado: rechazado; anular el gasto cruzado: permitido.
--
-- Con identidad canonica (ADR-040), los pares se comparan por su canonico,
-- como ya hacia 20260914130000.
-- ===========================================================================

-- Lo liquidado NETO de a hacia b (positivo: se liquido de a a b). Sobre
-- core.current_effect, por clase contable; las liquidaciones se escriben con
-- importe negativo en la direccion deudor→acreedor.
create function sec.settled_net(
  p_scope           uuid,
  p_a               uuid,
  p_b               uuid,
  p_exclude_version uuid
)
returns bigint
language sql
stable
set search_path = ''
as $fn$
  select coalesce(sum(case when e.debt_debtor_participant_id = p_a and e.debt_creditor_participant_id = p_b then - e.debt_amount
                           when e.debt_debtor_participant_id = p_b and e.debt_creditor_participant_id = p_a then e.debt_amount
                           else 0 end), 0)::bigint
    from core.current_effect e
   where e.scope_id = p_scope
     and e.debt_amount is not null
     and e.accounting_class = 'settlement'
     and (p_exclude_version is null or e.operation_version_id <> p_exclude_version);
$fn$;
revoke execute on function sec.settled_net(uuid, uuid, uuid, uuid) from public;
grant  execute on function sec.settled_net(uuid, uuid, uuid, uuid) to nomey_writer;

-- La regla, una sola vez para las dos guardas. p_delta_nueva y p_delta_vigente
-- son lo que la version nueva y la vigente aportan al par en la direccion
-- a→b (negativo si aportan deuda cruzada). Devuelve el neto que quedaria si
-- hay que rechazar, o nulo si no.
create function sec.oversettled_after(
  p_scope           uuid,
  p_a               uuid,
  p_b               uuid,
  p_exclude_version uuid,
  p_delta_nueva     bigint,
  p_delta_vigente   bigint
)
returns bigint
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_s bigint; v_a uuid := p_a; v_b uuid := p_b; v_nueva bigint := p_delta_nueva; v_vigente bigint := p_delta_vigente;
  v_ya bigint; v_despues bigint; v_antes bigint;
begin
  v_s := sec.settled_net(p_scope, v_a, v_b, p_exclude_version);
  if v_s = 0 then return null; end if;
  if v_s < 0 then
    -- Se liquido de b hacia a: se orienta el par por sus liquidaciones.
    v_a := p_b; v_b := p_a; v_nueva := - v_nueva; v_vigente := - v_vigente;
  end if;
  v_ya := sec.net_debt(p_scope, v_a, v_b, p_exclude_version);
  v_despues := v_ya + v_nueva;
  v_antes := v_ya + v_vigente;
  if v_despues < 0 and v_despues < v_antes then return v_despues; end if;
  return null;
end
$fn$;
revoke execute on function sec.oversettled_after(uuid, uuid, uuid, uuid, bigint, bigint) from public;
grant  execute on function sec.oversettled_after(uuid, uuid, uuid, uuid, bigint, bigint) to nomey_writer;

-- ==================== la guarda de la CORRECCION ===========================
create or replace function sec.assert_correction_leaves_no_oversettled_debt(
  p_scope            uuid,
  p_expected_version uuid,
  p_participants     uuid[],
  p_resolved         bigint[],
  p_payer            uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  r record;
  v_neto bigint;
begin
  for r in
    with nuevos as (
      -- Lo que la version NUEVA aporta a cada par, por identidad canonica.
      select sec.canonical_participant(u.participante) as debtor,
             sec.canonical_participant(p_payer)        as creditor,
             sum(u.importe)                            as delta
        from unnest(p_participants, p_resolved) as u(participante, importe)
       where sec.canonical_participant(u.participante) <> sec.canonical_participant(p_payer)
         and u.importe > 0
       group by 1, 2
    ),
    vigente as (
      -- Lo que la version VIGENTE aportaba (core.current_effect ya resuelve el canonico).
      select e.debt_debtor_participant_id   as debtor,
             e.debt_creditor_participant_id as creditor,
             sum(e.debt_amount)             as delta
        from core.current_effect e
       where e.operation_version_id = p_expected_version
         and e.debt_amount is not null
         and e.debt_debtor_participant_id <> e.debt_creditor_participant_id
       group by 1, 2
    ),
    -- Cada par UNA vez, sin orientar: a < b por identidad; lo aportado en la
    -- direccion a→b, negativo si es en la contraria.
    aportes as (
      select least(debtor, creditor) as a, greatest(debtor, creditor) as b,
             sum(case when debtor < creditor then delta else - delta end) as nueva, 0::bigint as vigente
        from nuevos group by 1, 2
      union all
      select least(debtor, creditor), greatest(debtor, creditor),
             0, sum(case when debtor < creditor then delta else - delta end)
        from vigente group by 1, 2
    )
    select a, b, sum(nueva)::bigint as nueva, sum(vigente)::bigint as vigente from aportes group by a, b
  loop
    v_neto := sec.oversettled_after(p_scope, r.a, r.b, p_expected_version, r.nueva, r.vigente);
    if v_neto is not null then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('la correccion dejaria la deuda entre %s y %s con un pendiente de %s: lo liquidado no puede superar lo debido (data-model.md §3)',
               r.a, r.b, v_neto), 422);
    end if;
  end loop;
end
$fn$;

comment on function sec.assert_correction_leaves_no_oversettled_debt(uuid, uuid, uuid[], bigint[], uuid) is
  'Una correccion no puede dejar una liquidacion sin deuda que la respalde. Solo se pregunta en los pares CON liquidaciones, orientados por ellas, y solo si la correccion deja el neto por debajo de cero y peor que la version vigente (data-model.md §3).';

-- ==================== y la de la ANULACION =================================
create or replace function sec.assert_annulment_leaves_no_oversettled_debt(p_version uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  r record;
  v_scope uuid;
  v_neto bigint;
begin
  select e.scope_id into v_scope from core.current_effect e
   where e.operation_version_id = p_version and e.debt_amount is not null limit 1;
  if v_scope is null then return; end if;
  for r in
    select least(e.debt_debtor_participant_id, e.debt_creditor_participant_id) as a,
           greatest(e.debt_debtor_participant_id, e.debt_creditor_participant_id) as b,
           sum(case when e.debt_debtor_participant_id < e.debt_creditor_participant_id then e.debt_amount else - e.debt_amount end)::bigint as vigente
      from core.current_effect e
     where e.operation_version_id = p_version
       and e.debt_amount is not null
       and e.debt_debtor_participant_id <> e.debt_creditor_participant_id
     group by 1, 2
  loop
    -- Anular quita lo que la version aportaba: la version nueva aporta cero.
    v_neto := sec.oversettled_after(v_scope, r.a, r.b, p_version, 0, r.vigente);
    if v_neto is not null then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('anular dejaria la deuda del par con %s pendiente: lo liquidado no puede superar lo debido', v_neto),
        422);
    end if;
  end loop;
end
$fn$;

comment on function sec.assert_annulment_leaves_no_oversettled_debt(uuid) is
  'Anular no puede dejar una liquidacion sin deuda que la respalde. Solo se pregunta en los pares CON liquidaciones, orientados por ellas, y solo si anular deja el neto por debajo de cero y peor que con la version (ADR-024, data-model.md §3).';
