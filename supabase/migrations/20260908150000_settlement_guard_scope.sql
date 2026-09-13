-- ===========================================================================
-- F9 · LA GUARDA DE SOBRELIQUIDACION SOLO MIRA DONDE HAY LIQUIDACIONES
-- ===========================================================================
--
-- ============================ EL DEFECTO, MEDIDO ===========================
--
-- Corregir un gasto —cambiando de pagador o sacando a alguien del reparto— y
-- anular un gasto se rechazaban con `SETTLEMENT_EXCEEDS_DEBT` en un grupo donde
-- **no existia ni una sola liquidacion**. Medido contra este stack: cero filas
-- de clase `debt_settlement` y `settlement_by_transfer` en toda la base.
--
-- ============================ POR QUE PASABA ===============================
--
-- `sec.net_debt(A, B)` es el neto CON SIGNO del par, y suma las dos direcciones:
--
--     net(A->B) = gastos(A->B) - gastos(B->A) - liquidado(A->B) + liquidado(B->A)
--
-- Es decir  net = E - S,  donde E es el neto de los GASTOS y S el de las
-- LIQUIDACIONES. Las dos guardas exigian `net + delta >= 0`, que desarrollado es
-- `S <= E + delta`: «lo liquidado no supera lo debido», que es exactamente
-- `data-model.md` §3.
--
-- **La aritmetica era correcta; su dominio de aplicacion, no.** Con `S = 0` la
-- condicion degenera en `0 <= E + delta`, es decir «el neto de los gastos de A
-- hacia B no puede ser negativo» — y eso no es un invariante de nada: un neto
-- negativo solo significa que quien debe es el otro. En un grupo donde A pago
-- una cena y B pago otra, el par (A->B) ya sale negativo sin que nadie haya
-- liquidado nada, y cualquier correccion que tocara ese par se rechazaba.
--
-- ========================= POR QUE ESTE ARREGLO CONSERVA ===================
-- ========================= LA SEMANTICA DECIDIDA ==========================
--
-- No se toca la aritmetica ni se relaja ninguna restriccion: se acota **cuando
-- se pregunta**. La condicion pasa a ser
--
--     hay liquidaciones en ese par   Y   S > E + delta
--
-- y eso conserva §3 por construccion:
--
-- 1. **Donde hay liquidaciones, la prueba es IDENTICA.** El termino que se anade
--    es una conjuncion, no una tolerancia: ni un caso que antes se rechazaba con
--    `S <> 0` deja de rechazarse. El ejemplo canonico del propio comentario
--    original —deuda 5000, liquidado 4000, corregida a 3000— sigue dando -1000 y
--    sigue siendo `SETTLEMENT_EXCEEDS_DEBT`.
-- 2. **Donde no las hay, el invariante es VACIO.** «Lo liquidado no puede
--    superar lo debido» no afirma nada sobre un par en el que no se ha liquidado
--    nada: no hay liquidacion que pueda quedarse sin respaldo. Rechazar ahi no
--    protegia §3, protegia una lectura equivocada del signo.
-- 3. **El caso que §3 vigila sigue entrando por su otra puerta.** Liquidar de mas
--    lo sigue impidiendo `record_debt_settlement` con `sec.pending_debt`, que no
--    se toca.
--
-- Se descarto la alternativa de comparar deudas y liquidaciones «por separado»
-- —sumar gastos por direccion sin netear— porque cambiaria la semantica
-- decidida: el modelo trata la deuda como un SALDO CONTINUO neteado
-- (`sec.pending_debt`, y la posicion neta de ADR-016), y separarlas convertiria
-- una deuda cruzada en dos obligaciones independientes. Eso es una decision de
-- producto distinta, no un arreglo de este defecto.
-- ===========================================================================

-- ¿Se ha liquidado algo entre estos dos, en cualquiera de las dos direcciones?
--
-- **Por CLASE CONTABLE, no por el signo.** Un efecto de deuda negativo es lo que
-- escribe una liquidacion, pero preguntar por el signo confundiria una futura
-- clase que tambien lo usara; `accounting_class = 'settlement'` es el hecho.
--
-- Sobre `core.current_effect`, como todo lo demas: la version superada de una
-- liquidacion corregida no cuenta (ADR-013 §9).
create function sec.settled_between(
  p_scope           uuid,
  p_a               uuid,
  p_b               uuid,
  p_exclude_version uuid
)
returns bigint
language sql
stable
set search_path = ''
begin atomic
  select coalesce(sum(abs(e.debt_amount)), 0)
    from core.current_effect e
   where e.scope_id = p_scope
     and e.debt_amount is not null
     and e.accounting_class = 'settlement'
     and ((e.debt_debtor_participant_id = p_a and e.debt_creditor_participant_id = p_b)
       or (e.debt_debtor_participant_id = p_b and e.debt_creditor_participant_id = p_a))
     and (p_exclude_version is null or e.operation_version_id <> p_exclude_version);
end;

comment on function sec.settled_between(uuid, uuid, uuid, uuid) is
  'Cuanto se ha liquidado entre dos participantes, en cualquier direccion y en valor absoluto. Acota donde tiene sentido preguntar por sobreliquidacion (data-model.md §3).';

revoke execute on function sec.settled_between(uuid, uuid, uuid, uuid) from public;
grant  execute on function sec.settled_between(uuid, uuid, uuid, uuid) to nomey_writer;

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
begin
  for r in
    with nuevos as (
      select p_scope           as scope_id,
             u.participante    as debtor,
             p_payer           as creditor,
             u.importe         as delta
        from unnest(p_participants, p_resolved) as u(participante, importe)
       where u.participante <> p_payer
         and u.importe > 0
    ),
    viejos as (
      select distinct
             e.scope_id,
             e.debt_debtor_participant_id   as debtor,
             e.debt_creditor_participant_id as creditor,
             0::bigint                      as delta
        from core.current_effect e
       where e.operation_version_id = p_expected_version
         and e.debt_amount is not null
    ),
    pares as (
      select scope_id, debtor, creditor, max(delta) as delta
        from (select * from nuevos union all select * from viejos) t
       group by 1, 2, 3
    )
    select pares.scope_id, pares.debtor, pares.creditor, pares.delta,
           sec.net_debt(pares.scope_id, pares.debtor, pares.creditor, p_expected_version) as ya,
           sec.settled_between(pares.scope_id, pares.debtor, pares.creditor, p_expected_version) as liquidado
      from pares
  loop
    -- SOLO donde hay algo liquidado. Sin liquidaciones el invariante de §3 es
    -- vacio, y un neto negativo solo dice que quien debe es el otro.
    if r.liquidado > 0 and r.ya + r.delta < 0 then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('la correccion dejaria la deuda de %s hacia %s con un pendiente de %s: ya se liquidaron %s y la version corregida solo sostiene %s (data-model.md §3)',
               r.debtor, r.creditor, r.ya + r.delta, r.liquidado, r.delta), 422);
    end if;
  end loop;
end
$fn$;

comment on function sec.assert_correction_leaves_no_oversettled_debt(uuid, uuid, uuid[], bigint[], uuid) is
  'Una correccion no puede dejar una liquidacion sin deuda que la respalde. Solo se pregunta en los pares CON liquidaciones: sin ellas el invariante de data-model.md §3 es vacio.';

-- ==================== y la de la ANULACION =================================
create or replace function sec.assert_annulment_leaves_no_oversettled_debt(p_version uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  r record;
  v_neto bigint;
  v_liquidado bigint;
begin
  for r in
    select distinct e.scope_id, e.debt_debtor_participant_id as deudor,
                    e.debt_creditor_participant_id as acreedor
      from core.current_effect e
     where e.operation_version_id = p_version
       and e.debt_amount is not null
  loop
    v_liquidado := sec.settled_between(r.scope_id, r.deudor, r.acreedor, p_version);
    if v_liquidado = 0 then
      continue;
    end if;

    v_neto := sec.net_debt(r.scope_id, r.deudor, r.acreedor, p_version);
    if v_neto < 0 then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('anular dejaria la deuda del par con %s pendiente, y lo liquidado (%s) no puede superar lo debido', v_neto, v_liquidado),
        422);
    end if;
  end loop;
end
$fn$;

comment on function sec.assert_annulment_leaves_no_oversettled_debt(uuid) is
  'Anular no puede dejar una liquidacion sin deuda que la respalde. Solo se pregunta en los pares CON liquidaciones (ADR-024, data-model.md §3).';
