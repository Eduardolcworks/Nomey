-- ============================================================================
-- F9 · LA FOTO DE NETOS DEL PAGO SE COMPARA SOBRE LO QUE EL CLIENTE VE
-- ============================================================================
--
-- ============================ EL DEFECTO, MEDIDO ===========================
--
-- Registrar un pago («Saldado») fallaba SIEMPRE, con cualquier propuesta y en
-- cualquier reintento, en un grupo con un participante asociado (ADR-040) o
-- retirado (ADR-036): `SETTLEMENT_STALE` 409 en cinco intentos seguidos
-- (2026-09-13 19:14–19:15 UTC, grupo con un origen fusionado); nada se
-- escribio (ningun comando `group_payment`, ninguna operacion). Reproducido
-- en la pila aislada (sonda `probe-stale.sql`): con un retirado sin actividad
-- en el grupo, el PRIMER pago con la foto real del cliente ya caduca.
--
-- ============================ POR QUE PASABA ===============================
--
-- El CAS de la propuesta (20260912170000 §3, C2) compara bajo cerrojo el
-- texto canonico de netos `sec.group_positions_text(scope)` con el que el
-- cliente manda en `expected_positions`. El cliente construye la lista con
-- las filas de `api.group_balance` —la vista que enseña los saldos—, que
-- desde 20260911120000 NO lista a los retirados y desde 20260914130000 §5
-- tampoco a los origenes fusionados (su neto es el del destino). El texto del
-- servidor, en cambio, listaba TODOS los `core.participant` del ambito, con
-- el retirado y el origen a `:0`. Dos conjuntos distintos: el texto nunca
-- podia coincidir, y releer no arreglaba nada porque no era una foto vieja
-- sino una foto de otra cosa.
--
-- El check de pagos no lo vio porque su ayuda `gp_expected` reproducia el
-- texto del servidor en vez de leer la vista: probaba el CAS contra si mismo.
-- Ahora lee `api.group_balance`, que es lo que manda el cliente
-- (supabase/checks/lib/group-payment-helpers.sql).
--
-- ========================= LO QUE SE DECIDE, Y LO QUE NO ===================
--
-- El texto se calcula sobre el MISMO conjunto de participantes que publica
-- `api.group_balance`: los del ambito que no estan retirados ni fusionados
-- como origen. El contrato del CAS no cambia —«los netos vigentes son los que
-- el cliente vio»—; cambia que ahora se compara lo comparable. Fuera de la
-- foto quedan identidades cuyo neto es cero por construccion al excluirlas
-- (la retirada exige pares saldados; el origen fusionado no tiene efectos en
-- la proyeccion canonica) y, como la suma de netos del ambito es cero, un
-- cambio posterior en una de ellas mueve alguna visible: la foto lo detecta.
-- El detalle `positions` del error sigue siendo ese texto, ahora legible por
-- el cliente contra su propia lista.
--
-- Evidencia: supabase/checks/associate-participant.sql (retirado en el
-- fixture, pagos antes y despues de asociar; texto = vista), y los demas
-- checks de pagos, que desde este cambio mandan la foto real.
-- ===========================================================================

create or replace function sec.group_positions_text(p_scope uuid)
returns text
language sql
stable
set search_path = ''
as $fn$
  select coalesce(string_agg(p.id::text || ':' || coalesce(n.net, 0)::text, ' ' order by p.id), '')
    from core.participant p
    left join (
      select x.pid, sum(x.amt) net from (
        select e.debt_creditor_participant_id pid, e.debt_amount amt from core.current_effect e where e.scope_id = p_scope and e.debt_amount is not null
        union all
        select e.debt_debtor_participant_id, - e.debt_amount from core.current_effect e where e.scope_id = p_scope and e.debt_amount is not null) x
      group by x.pid) n on n.pid = p.id
   where p.scope_id = p_scope
     -- Las MISMAS exclusiones que api.group_balance (20260911120000, 20260914130000 §5).
     and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
     and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id);
$fn$;

comment on function sec.group_positions_text(uuid) is
  'Los netos del grupo en texto canonico, sobre los participantes que api.group_balance publica (ni retirados ni origenes fusionados): lo que el cliente manda como expected_positions y lo que record_group_payment compara bajo cerrojo. Si la vista cambia su conjunto, esto cambia con ella.';
