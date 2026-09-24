-- ============================================================================
-- A QUIEN SE LE PUEDE TRANSFERIR EN UN GRUPO (F12/ADR-007, F12.C3)
-- ============================================================================
--
-- La pantalla necesita una lista, y esa lista tiene que aplicar EXACTAMENTE el
-- mismo veredicto que el comando. Si enseñara a alguien a quien
-- `api.record_group_transfer` va a rehusar, la persona descubriria el limite
-- despues de escribir un importe y elegir; si escondiera a alguien valido,
-- el limite no existiria en ninguna parte salvo en la lista.
--
-- Por eso el veredicto vive UNA vez, en `sec.group_transfer_state`, y la
-- funcion publica lo consume.
--
-- ─── EL VEREDICTO ES EL DEL GRUPO, NO EL DE LAS CUENTAS ─────────────────────
--
-- Recibir una transferencia es recibir una operacion economica nueva del
-- grupo, asi que las condiciones son las de nombrar a alguien en un gasto
-- nuevo (`record_group_expense`) mas la de estar presente ahora
-- (`record_group_payment`):
--
--   * pertenece al ambito;
--   * es elegible HOY (tiene periodo de presencia vigente);
--   * no esta retirado;
--   * no es origen de una fusion;
--   * no es uno mismo.
--
-- Y NINGUNA otra. No se mira cuenta, ni vinculo, ni username, ni Modo
-- Personal, ni amistad, ni la moneda de ningun Personal. **Un participante sin
-- cuenta es un destinatario de pleno derecho**: la transferencia pertenece al
-- libro del grupo y el receptor autoritativo es el participante.
--
-- Esto es lo que cambio respecto de B3, donde recibir exigia cuenta vinculada,
-- username definitivo, Modo Personal y monedas compatibles — porque alli
-- alguien tenia que ACEPTAR y habia que abonarle su Personal. Aqui no hay
-- aceptacion y no se abona nada a nadie.
--
-- ─── EL ORDEN ES PARTE DEL CONTRATO ─────────────────────────────────────────
--
-- `(created_at, id)`: el orden en que las personas entraron al grupo. Es el
-- MISMO orden con el que el writer reparte, y por eso la vista previa del
-- cliente enseña el centimo que sobra en la misma persona que lo recibira.
-- No es cosmetico: cambiarlo cambia quien cobra la unidad menor.
-- ============================================================================

-- ═══════════════════ §1 · el veredicto, una sola vez ════════════════════════
--
-- Definer del WRITER: lee `core.participant_period`, `core.participant_retirement`
-- y `core.participant_merge`, que `authenticated` no alcanza. Devuelve una
-- palabra, nunca una excepcion: quien pinta una lista necesita un estado.
--
-- `unavailable` agrupa a proposito lo que no se puede: salido, retirado,
-- fusionado o sin presencia vigente. La lista no explica por que, y no hace
-- falta que lo haga: `api.group_participant` ya publica `is_active`,
-- `is_retired`, `is_departed` y `merged_into_participant_id` a los miembros.
create function sec.group_transfer_state(
  p_group    uuid,
  p_sender   uuid,
  p_receiver uuid
)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when p_receiver = p_sender then 'self'
    when not exists (select 1 from core.participant p
                      where p.id = p_receiver and p.scope_id = p_group) then 'unavailable'
    when exists (select 1 from core.participant_merge m
                  where m.source_participant_id = p_receiver) then 'unavailable'
    when exists (select 1 from core.participant_retirement r
                  where r.participant_id = p_receiver and r.scope_id = p_group) then 'unavailable'
    when not exists (select 1 from core.participant_period pp
                      where pp.participant_id = p_receiver
                        and pp.valid_from <= current_date
                        and pp.valid_until is null) then 'unavailable'
    else 'ready'
  end;
$fn$;
comment on function sec.group_transfer_state(uuid, uuid, uuid) is
  'F12/ADR-007: si un participante puede RECIBIR una transferencia de grupo hoy. Las reglas del alta de grupo —del ambito, elegible, no retirado, no fusionado, no uno mismo— y ninguna mas: ni cuenta, ni username, ni Personal, ni amistad.';
grant create on schema sec to nomey_writer;
alter function sec.group_transfer_state(uuid, uuid, uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.group_transfer_state(uuid, uuid, uuid) from public;
grant execute on function sec.group_transfer_state(uuid, uuid, uuid) to nomey_writer;


-- ═══════════════════ §2 · la lista ══════════════════════════════════════════
--
-- UNA fila por participante del grupo, con su estado y el neto del par. Quien
-- pinta decide cual enseña —hoy, solo los `ready`—, y devolver tambien los
-- demas es lo que permite distinguir «no hay nadie disponible» de «este grupo
-- no existe» sin inventarse un error.
--
-- El `net_debt` viaja con cada fila para que la vista previa no cueste una
-- consulta por persona marcada: `sec.net_debt` es la UNICA definicion del
-- neto y ya es derivable de Saldos, asi que no publica nada nuevo.
--
-- La barrera es la membresia actual: un ambito ajeno o inexistente devuelve
-- CERO filas, no un error, y los dos casos son indistinguibles.
create function api.group_transfer_candidates(p_group uuid)
returns table (
  participant_id uuid,
  display_name   text,
  state          text,
  net_debt       text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := sec.request_actor_id();
  v_sender uuid;
begin
  if not exists (select 1 from core.membership m
                  where m.scope_id = p_group and m.user_id = v_actor) then
    return;
  end if;
  if not exists (select 1 from core.scope s where s.id = p_group and s.kind = 'group') then
    return;
  end if;

  -- El emisor es la identidad ACTIVA del actor en este grupo (F10/ADR-003),
  -- la misma que resolvera el writer.
  select l.participant_id into v_sender
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = p_group and l.ended_at is null
   limit 1;
  if v_sender is null then
    -- Sin identidad activa no hay emisor, y por tanto nadie a quien mandar.
    return query select p.id, p.display_name, 'unavailable'::text, '0'::text
                   from core.participant p
                  where p.scope_id = p_group
                  order by p.created_at, p.id;
    return;
  end if;

  return query
  select p.id,
         p.display_name,
         sec.group_transfer_state(p_group, v_sender, p.id),
         sec.net_debt(p_group, v_sender, p.id, null)::text
    from core.participant p
   where p.scope_id = p_group
   order by p.created_at, p.id;
end
$fn$;
comment on function api.group_transfer_candidates(uuid) is
  'F12/ADR-007: a quien puede el actor transferir en este grupo, con el MISMO veredicto que record_group_transfer. Una fila por participante —fantasmas incluidos— con su estado y el neto del par, en el ORDEN CANONICO de reparto (entrada al grupo). Cero filas si el actor no es miembro. Publica el display_name del PARTICIPANTE y nunca uid, correo ni handle.';
grant create on schema api to nomey_writer;
alter function api.group_transfer_candidates(uuid) owner to nomey_writer;
revoke create on schema api from nomey_writer;
revoke execute on function api.group_transfer_candidates(uuid) from public;
grant execute on function api.group_transfer_candidates(uuid) to authenticated;
