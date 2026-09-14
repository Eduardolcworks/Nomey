-- ============================================================================
-- LA CAMPANA DA POR VISTOS LOS AVISOS AL ABRIRSE (ADR-034 §7, complemento)
-- ============================================================================
--
-- Entrar en la campana marca como leidos los avisos que estaban pendientes en
-- ese momento, sin abrir cada uno. La frontera es UN aviso, el mas reciente que
-- el cliente tenia cargado: se marcan los suyos con `occurred_at` menor o
-- igual que el de ese aviso, esten o no en la pagina que el cliente pidio.
-- Un aviso posterior queda fuera y vuelve a encender el punto, aunque esta
-- llamada llegue tarde por una red lenta: la frontera es un hecho del
-- servidor, no un reloj del telefono.
--
-- El aviso frontera tiene que ser del propio actor: si no lo es, no hay
-- frontera y no se marca nada. `sec.is_member` deja fuera los grupos de los
-- que ya no es miembro, igual que la lectura y que `mark_group_notice_read`.
-- Nada se borra: `read_at` es lo unico que cambia, y solo donde era nulo.
create function api.mark_group_notices_seen(p_newest uuid)
returns integer
language sql
security definer
set search_path = ''
as $fn$
  with cutoff as (
    select n.occurred_at
      from core.group_notice n
     where n.id = p_newest
       and n.recipient_user_id = (select auth.uid())
  ),
  done as (
    update core.group_notice n
       set read_at = now()
     where n.recipient_user_id = (select auth.uid())
       and n.read_at is null
       and n.occurred_at <= (select occurred_at from cutoff)
       and sec.is_member(n.scope_id)
    returning 1
  )
  select count(*)::integer from done;
$fn$;
revoke execute on function api.mark_group_notices_seen(uuid) from public;
grant execute on function api.mark_group_notices_seen(uuid) to authenticated;
