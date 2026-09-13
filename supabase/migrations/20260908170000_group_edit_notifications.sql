-- ===========================================================================
-- F9 · NOTIFICACION INTERNA AL CORREGIR UN GASTO COMPARTIDO
-- ===========================================================================
--
-- **Dentro de Nomey, en la campana. No hay push, y no se prepara ninguno.**
--
-- ============ POR QUE UNA FILA POR DESTINATARIO Y NO UN EVENTO =============
--
-- El estado leido/no leido es DE CADA UNO. Con una sola fila por edicion habria
-- que guardar quien la ha leido en una relacion aparte —o peor, en un campo
-- compartido— y entonces la RLS tendria que dejar a cada miembro escribir en una
-- fila que tambien ven los demas. Con una fila por destinatario, la politica es
-- la mas simple que existe: **la fila es tuya o no la ves**, y marcarla leida es
-- escribir en lo tuyo.
--
-- El coste es una fila por miembro y edicion. Es el mismo reparto que hace
-- cualquier bandeja de entrada, y hace imposible por construccion que alguien
-- descubra que otro ya la leyo.
--
-- ============ QUIENES LA RECIBEN ==========================================
--
-- **La membresia ACTUAL del ambito, y el editor incluido.** `core.membership` es
-- presencia pura (no historial), asi que responde exactamente a «quien pertenece
-- al grupo AHORA». Quien ya no esta no recibe nada nuevo — y lo que ya recibio
-- se queda suyo, porque su fila no depende de seguir siendo miembro: eso es lo
-- que evita que salir del grupo borre el pasado de nadie.
--
-- **Nadie se inventa.** Un participante sin cuenta no tiene a quien notificar:
-- los destinatarios salen de `membership`, que son cuentas, no de
-- `core.participant`.
--
-- ============ QUE CUENTA, Y DE DONDE SALE =================================
--
-- El grupo, el gasto, QUIEN edito y CUANDO. Los dos ultimos los pone el
-- servidor: el actor es `sec.request_actor_id()` —la identidad autenticada, no
-- una afirmacion del payload— y el instante es `now()` de la transaccion, que no
-- es la fecha de efecto del gasto. Son dos fechas distintas y confundirlas seria
-- decir que el gasto se edito el dia que ocurrio.
--
-- **No lleva importes ni nombres copiados.** Solo identidades: el cliente
-- resuelve el concepto y el nombre contra las superficies que ya puede leer, asi
-- que una notificacion no concede acceso a nada que su destinatario no tuviera
-- ya. Si alguien deja el grupo, sus notificaciones viejas quedan pero el
-- contenido que nombran deja de ser legible por la RLS de siempre — que es el
-- comportamiento correcto y no exige ninguna decision nueva.
--
-- ============ ATOMICIDAD ==================================================
--
-- Se escriben DENTRO de `api.record_group_expense`, en la misma transaccion que
-- la version corregida. No hay trigger, no hay cola y no hay segundo viaje: o
-- existen la version y sus notificaciones, o no existe ninguna de las dos.
-- Un reintento idempotente sale por `already_processed` ANTES de llegar aqui, de
-- modo que no duplica; y un rechazo aborta la transaccion entera.
-- ===========================================================================

create table core.group_edit_notice (
  id                   uuid        primary key default gen_random_uuid(),
  -- El destinatario. La fila es suya: la RLS no mira nada mas para dejarla ver.
  --
  -- **SIN clave ajena a `auth.users`, como todo lo demas en `core`.** Ninguna
  -- relacion de este esquema la tiene —ni `membership.user_id`, ni
  -- `scope.owner_user_id`, ni `participant_user_link.user_id`—: `auth.users` es
  -- de GoTrue, y encadenar la contabilidad a la tabla del proveedor de identidad
  -- la hace depender de sus reglas de borrado. Con `on delete cascade` habria
  -- sido peor todavia: borrar una cuenta habria hecho desaparecer filas del
  -- historico sin que nadie lo decidiera.
  --
  -- La integridad que importa ya esta: el destinatario sale de
  -- `core.membership` y el editor de `sec.request_actor_id()`, asi que los dos
  -- son cuentas reales por construccion.
  recipient_user_id    uuid        not null,
  scope_id             uuid        not null references core.scope(id),
  operation_id         uuid        not null references core.operation(id),
  -- La version que la edicion creo. Con ella se puede reconstruir que cambio
  -- sin guardar aqui ninguna copia del gasto.
  operation_version_id uuid        not null references core.operation_version(id),
  -- QUIEN edito, por su cuenta. Es la identidad autenticada del escritor.
  editor_user_id       uuid        not null,
  -- CUANDO se edito, en hora del servidor. NO es la fecha de efecto del gasto.
  edited_at            timestamptz not null default now(),
  read_at              timestamptz,

  -- Una por destinatario y version. Es lo que hace que un reintento no pueda
  -- duplicar aunque llegara hasta aqui.
  constraint group_edit_notice_una_por_destinatario
    unique (recipient_user_id, operation_version_id)
);

comment on table core.group_edit_notice is
  'Aviso interno de que un gasto compartido se edito. UNA FILA POR DESTINATARIO, para que leido/no leido sea de cada uno. Sin push y sin copias del gasto.';
comment on column core.group_edit_notice.edited_at is
  'Instante del servidor en que se confirmo la edicion. Nunca la fecha de efecto del gasto: son dos fechas distintas.';

create index group_edit_notice_bandeja
  on core.group_edit_notice (recipient_user_id, edited_at desc);

alter table core.group_edit_notice enable row level security;

-- La fila es tuya o no existe para ti. Ni por membresia ni por grupo: por
-- destinatario, que es lo unico que hace aislado el estado de lectura.
create policy group_edit_notice_client_select on core.group_edit_notice
  for select to authenticated
  using (recipient_user_id = sec.request_actor_id());

-- Y marcarla leida es escribir en lo tuyo. `with check` identico al `using`
-- para que nadie pueda cambiar de dueno una fila al actualizarla.
create policy group_edit_notice_client_update on core.group_edit_notice
  for update to authenticated
  using (recipient_user_id = sec.request_actor_id())
  with check (recipient_user_id = sec.request_actor_id());

grant select (id, scope_id, operation_id, operation_version_id, editor_user_id, edited_at, read_at)
  on core.group_edit_notice to authenticated;
grant update (read_at) on core.group_edit_notice to authenticated;

-- El escritor las crea. Y las LEE, aunque solo para el `on conflict`: sin
-- `select` PostgreSQL no puede comprobar el indice unico y responde `permission
-- denied` — medido. No las borra ni las actualiza.
grant insert, select on core.group_edit_notice to nomey_writer;
create policy group_edit_notice_writer_insert on core.group_edit_notice
  for insert to nomey_writer with check (true);
create policy group_edit_notice_writer_select on core.group_edit_notice
  for select to nomey_writer using (true);

-- ------------------------- quien las escribe -------------------------------
--
-- `SECURITY DEFINER` del escritor, como el resto de su superficie: la tabla no
-- es alcanzable por el cliente para escribir, y esta funcion es la unica puerta.
create function sec.notify_group_edit(
  p_scope     uuid,
  p_operation uuid,
  p_version   uuid,
  p_editor    uuid
)
returns void
language sql
volatile
set search_path = ''
begin atomic
  insert into core.group_edit_notice
    (recipient_user_id, scope_id, operation_id, operation_version_id, editor_user_id)
  select m.user_id, p_scope, p_operation, p_version, p_editor
    from core.membership m
   where m.scope_id = p_scope
  -- El editor tambien la recibe: la lista es la membresia entera, sin excluirle.
  on conflict (recipient_user_id, operation_version_id) do nothing;
end;

comment on function sec.notify_group_edit(uuid, uuid, uuid, uuid) is
  'Una notificacion por miembro ACTUAL del ambito, el editor incluido. Sin cuentas inventadas: los destinatarios salen de la membresia, no de los participantes.';

revoke execute on function sec.notify_group_edit(uuid, uuid, uuid, uuid) from public;
grant  execute on function sec.notify_group_edit(uuid, uuid, uuid, uuid) to nomey_writer;

-- ------------------- y el escritor la llama al CORREGIR --------------------
--
-- Solo en una correccion: un alta no es una edicion de nada. Va despues de que
-- la version este escrita y sus efectos asentados, dentro de la misma
-- transaccion — si algo posterior falla, las notificaciones se van con ella.
create or replace function api.record_group_expense(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method',
    'concept','category_id'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_payer uuid;
  v_participants uuid[]; v_method jsonb; v_kind text; v_resolved bigint[];
  v_concept text; v_category uuid;
  v_payer_scope uuid; v_canonical jsonb; v_lock uuid[];
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_i integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_total    := sec.payload_amount(payload, 'total');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_participants := sec.jsonb_uuid_array(payload -> 'participants', 'participants');
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));
  v_category := sec.payload_uuid(payload, 'category_id', true);

  v_method := payload -> 'split_method';
  if v_method is null or jsonb_typeof(v_method) <> 'object' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method debe ser un objeto JSON', 400);
  end if;
  v_kind := v_method ->> 'kind';
  if v_kind is null or not (v_kind = any(array['equal','shares','exact_amounts'])) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method.kind debe ser equal, shares o exact_amounts', 400);
  end if;
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  v_resolved := sec.resolve_split(v_total, v_participants, v_payer, v_method);

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'currency_definition_id', v_currency::text,
    'total',                  payload ->> 'total',
    'effective_date',         v_date::text,
    'payer_participant_id',   v_payer::text,
    'participants',           (select coalesce(jsonb_agg(p::text order by ord), '[]'::jsonb)
                                 from unnest(v_participants) with ordinality as u(p, ord)),
    'split_method',           v_method,
    'concept',                v_concept,
    'category_id',            v_category::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_shared_category_usable(v_category, v_expected);

  foreach v_payer_scope in array v_participants loop
    perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
  end loop;
  v_payer_scope := null;

  v_payer_scope := sec.participant_personal_scope(v_payer);
  if v_payer_scope is not null then
    perform sec.assert_no_conversion(v_payer_scope, v_currency);
  end if;

  v_lock := array[v_scope];
  v_obs := case when v_payer_scope is not null then array[v_payer_scope] else '{}'::uuid[] end;
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  v_lock := v_lock || v_obs;
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved);
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  if v_payer_scope is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_currency, - v_total);
  end if;

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ═══ Y SOLO SI FUE UNA CORRECCION, el aviso interno ═══
  --
  -- Aqui, y no antes: la version ya esta escrita y sus efectos asentados, asi
  -- que ninguna notificacion puede sobrevivir a un rechazo posterior. Un alta no
  -- notifica nada — no es una edicion de nada.
  if v_correction then
    perform sec.notify_group_edit(v_scope, v_operation, v_version, v_actor);
  end if;

  return sec.envelope(v_operation, false);
end
$function$;

alter function api.record_group_expense(jsonb) owner to nomey_writer;

-- ¿Es esta cuenta la mia? Un ayudante REDUCIDO, el patron de ADR-007.
--
-- `sec.request_actor_id()` no es ejecutable por `authenticated` a proposito, y
-- una vista `security_invoker` la llamaria como el cliente — medido:
-- `permission denied for function request_actor_id`. Asi que se envuelve, igual
-- que `sec.is_my_participant`: no acepta comparar a dos terceros, solo responde
-- «¿soy yo?».
create function sec.is_me(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_user = sec.request_actor_id();
$fn$;

comment on function sec.is_me(uuid) is
  'Si esa cuenta es la del actor de la peticion. No compara terceros: solo responde sobre uno mismo (ADR-007).';

revoke execute on function sec.is_me(uuid) from public;
grant  execute on function sec.is_me(uuid) to authenticated;

-- ---------------------- lo que el cliente lee ------------------------------
--
-- Identidades y fechas, nada copiado: el concepto y el nombre del grupo los
-- resuelve el cliente contra las superficies que ya puede leer, asi que esta
-- vista no concede acceso a nada nuevo.
create view api.group_edit_notice
with (security_invoker = true) as
select n.id,
       n.scope_id,
       n.operation_id,
       n.operation_version_id,
       n.editor_user_id,
       -- Si lo edito quien mira. La identidad de OTRO editor no se publica como
       -- tal: solo se dice si fuiste tu, igual que `is_self` en participantes.
       sec.is_me(n.editor_user_id) as edited_by_me,
       n.edited_at,
       n.read_at
  from core.group_edit_notice n;

comment on view api.group_edit_notice is
  'La bandeja de avisos de edicion de quien pregunta. Una fila por destinatario; la RLS de core.group_edit_notice hace el aislamiento.';

grant select on api.group_edit_notice to authenticated;
grant update (read_at) on api.group_edit_notice to authenticated;
