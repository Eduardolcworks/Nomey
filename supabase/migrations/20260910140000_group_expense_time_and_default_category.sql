-- ============================================================================
-- HORA EN EL GASTO COMPARTIDO, Y CATEGORIA PREESTABLECIDA POR GRUPO.
-- ============================================================================
--
-- ═══════════ 1 · effective_time en record_group_expense ═══════════
--
-- El gasto compartido no aceptaba hora, asi que en Personal quedaba al final
-- de su dia por el contrato `nulls last` (ADR-020 §3): correcto, y no lo que
-- la persona ve. Se amplia el contrato con el MISMO modelo temporal que el
-- gasto personal —`time` sin zona, el reloj de pared local del par
-- fecha+hora—, se incluye en la intencion canonica y se persiste en la
-- version por `sec.persist_version`, que ya lo admitia.
--
-- **Opcional, a diferencia del personal.** Los gastos historicos no tienen
-- hora y no se les inventa; corregir uno conserva su ausencia si el cliente
-- no manda hora. `nulls last` sigue siendo el criterio para lo que no la tiene.
--
-- ═══════════ 2 · default_category_id en core.group_profile ═══════════
--
-- Una PREFERENCIA del grupo, no un hecho contable: la categoria con la que
-- se preselecciona un gasto nuevo. Nula es «Todas» —sin preseleccion—. El
-- gasto guarda su propia categoria en `core.expense_category` y no depende
-- de esta columna despues: cambiar la preferencia no reclasifica nada, y la
-- migracion no toca ningun gasto. Los grupos existentes nacen en «Todas».
--
-- La validacion es LA MISMA que la del gasto —`sec.assert_shared_category_usable`:
-- de sistema y activa—; una categoria propia o dada de baja se rechaza con su
-- codigo. Viaja en la intencion canonica de crear y de editar, y en el
-- historial antes/despues del perfil.

alter table core.group_profile
  add column default_category_id uuid references core.category (id);

comment on column core.group_profile.default_category_id is
  'Categoria con la que se preselecciona un gasto NUEVO del grupo. Nula = sin '
  'preseleccion («Todas»). Preferencia, no hecho contable: el gasto guarda la suya.';

-- El sobre y el perfil la publican; `api.group_operation` publica la hora.
create or replace function sec.group_envelope(p_scope uuid, p_replay boolean)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'scope_id',                    g.scope_id,
    'display_name',                g.display_name,
    'emoji',                       g.emoji,
    'base_currency_definition_id', c.id,
    'currency_code',               c.code,
    'currency_scale',              c.scale,
    'default_category_id',         g.default_category_id,
    'participant_count',           (select count(*) from core.participant p
                                     where p.scope_id = g.scope_id),
    'created_at',                  g.created_at,
    'replay',                      p_replay)
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id
  where g.scope_id = p_scope;
$function$;

-- La regla de categoria del gasto la ejecutaba solo el escritor; ahora tambien
-- el provisioner, que valida la preferencia con la MISMA funcion. Sin esta
-- linea, crear un grupo con preferencia fallaba por privilegios: medido.
grant execute on function sec.assert_shared_category_usable(uuid, uuid) to nomey_provisioner;
-- Y la columna nueva entra en el UPDATE por columnas que la edicion ya tenia.
grant update (default_category_id) on core.group_profile to nomey_provisioner;

create or replace view api.group_profile
with (security_invoker = true) as
select g.scope_id,
       g.display_name,
       g.emoji,
       s.base_currency_definition_id,
       c.code  as currency_code,
       c.scale as currency_scale,
       (select count(*) from core.participant p where p.scope_id = g.scope_id) as participant_count,
       g.created_at,
       g.updated_at,
       -- Al FINAL: `create or replace view` solo admite columnas nuevas al final,
       -- y el orden no significa nada para PostgREST.
       g.default_category_id
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id;

create or replace view api.group_operation
with (security_invoker = true) as
select o.id                     as operation_id,
       ov.id                    as version_id,
       e.scope_id,
       e.currency_definition_id,
       ov.original_amount::text as total_amount,
       ov.original_amount       as total_order,
       ov.effective_date,
       md.concept,
       ec.category_id,
       sp.payer_participant_id,
       sp.split_method,
       (select ee.economic_amount::text
          from core.current_effect ee
         where ee.operation_version_id = ov.id
           and ee.economic_amount is not null
           and ee.economic_participant_id is not null
           and sec.is_my_participant(ee.economic_participant_id)
         limit 1)               as your_share,
       ov.supersedes_version_id as previous_version_id,
       (select prev.original_amount::text
          from core.operation_version prev
         where prev.id = ov.supersedes_version_id) as previous_amount,
       ov.version_no,
       o.created_at             as operation_created_at,
       -- Al FINAL, por lo mismo: `api.group_summary` depende de esta vista y
       -- recrearla exigiria recrear tambien aquella.
       ov.effective_time
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  join core.split sp on sp.operation_version_id = ov.id and sp.scope_id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category ec on ec.operation_version_id = ov.id
 where s.kind = 'group'
   and o.operation_class = 'group_expense'
   and ov.version_kind = 'record'
 group by o.id, ov.id, e.scope_id, e.currency_definition_id, ov.original_amount,
          ov.effective_date, ov.effective_time, md.concept, ec.category_id,
          sp.payer_participant_id, sp.split_method, ov.supersedes_version_id,
          ov.version_no, o.created_at;


create or replace function api.record_group_expense(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method',
    'concept','category_id'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_time time; v_payer uuid;
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
  -- OPCIONAL, a diferencia del personal: un gasto historico sin hora se corrige
  -- conservando su ausencia, y nadie le inventa una (ADR-020 §3).
  v_time     := sec.payload_time(payload, 'effective_time', false);
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
    'effective_time',         v_time::text,
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
                              v_supersedes, 'group_expense', v_date, v_total, v_currency,
                              v_time);

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
$function$

;

create or replace function api.create_group(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'client_group_id',
    'display_name', 'emoji', 'currency_definition_id', 'default_category_id',
    'creator_participant_id', 'creator_display_name', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor    uuid;
  v_command  uuid;
  v_version  integer;
  v_scope    uuid;
  v_currency uuid;
  v_name     text;
  v_emoji    text;
  v_default  uuid;
  v_creator  uuid;
  v_creator_name text;
  v_parts    jsonb;
  v_ids      uuid[];
  v_intent   jsonb;
  v_stored   jsonb;
  v_result   uuid;
  v_replay   boolean := false;
  v_item     jsonb;
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  v_actor    := sec.request_actor_id();
  v_command  := sec.payload_uuid(payload, 'client_command_id', true);
  v_version  := sec.payload_contract_version(payload);
  v_scope    := sec.payload_uuid(payload, 'client_group_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_creator  := sec.payload_uuid(payload, 'creator_participant_id', true);
  v_name     := sec.canonical_display_name(sec.payload_text(payload, 'display_name', true));
  v_creator_name := sec.canonical_display_name(sec.payload_text(payload, 'creator_display_name', true));
  v_emoji    := sec.payload_text(payload, 'emoji', true);
  v_parts    := coalesce(payload -> 'participants', '[]'::jsonb);

  perform sec.assert_object_array_shape(v_parts, 'participants', c_participant_fields);

  -- El nombre ya viene comprobado por `sec.canonical_display_name`. El emoji no
  -- se canonicaliza —un emoji no lleva espacios que colapsar— pero si se exige.
  if btrim(v_emoji) = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'emoji no puede quedar vacio', 400);
  end if;

  -- LA CATEGORIA PREESTABLECIDA, opcional. Nula es «Todas»: ningun gasto nuevo
  -- nace con categoria. Si viene, tiene que ser una que un gasto compartido
  -- pueda llevar —de sistema y activa—, con la MISMA regla que el gasto.
  v_default := sec.payload_uuid(payload, 'default_category_id', false);
  if v_default is not null then
    perform sec.assert_shared_category_usable(v_default, null);
  end if;

  -- Las identidades de participante son del cliente y tienen que ser unicas
  -- entre si y distintas de la del creador: dos filas con el mismo id
  -- reventarian a mitad de la insercion, y el rechazo debe ser del contrato.
  select array_agg((p ->> 'client_participant_id')::uuid)
    into v_ids
    from jsonb_array_elements(v_parts) as e(p);
  v_ids := coalesce(v_ids, array[]::uuid[]);

  -- `cardinality` y no `array_length`: el segundo devuelve NULL sobre un array
  -- vacio, y la comparacion daba un falso positivo cuando no habia participantes.
  if cardinality(v_ids) <> cardinality(array(select distinct unnest(v_ids))) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'hay identidades de participante repetidas', 400);
  end if;
  if v_creator = any (v_ids) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un participante repite la identidad del creador', 400);
  end if;

  if not exists (select 1 from core.currency_definition c where c.id = v_currency) then
    perform sec.raise_boundary('CURRENCY_NOT_SUPPORTED',
      'esa definicion monetaria no esta en el catalogo soportado', 422);
  end if;

  -- La intencion CANONICA. El nombre ya normalizado y los participantes con su
  -- nombre normalizado, en el orden en que llegaron: es exactamente lo que se
  -- va a escribir, no lo que se recibio.
  v_intent := jsonb_build_object(
    'client_group_id',        v_scope,
    'display_name',           v_name,
    'emoji',                  v_emoji,
    'default_category_id',    v_default::text,
    'currency_definition_id', v_currency,
    'creator_participant_id', v_creator,
    'creator_display_name',   v_creator_name,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_participant_id', p ->> 'client_participant_id',
               'display_name',          sec.canonical_display_name(p ->> 'display_name'))
               order by ord)
        from jsonb_array_elements(v_parts) with ordinality as e(p, ord)
    ), '[]'::jsonb));

  -- ---------- el reclamo de la clave, antes de crear nada ----------
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.create', v_version, v_intent, v_scope);
  exception when unique_violation then
    -- Ya reclamada. Puede ser un replay legitimo o una reutilizacion.
    v_replay := true;
  end;

  if v_replay then
    select pc.canonical_intent, pc.result_scope_id into v_stored, v_result
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;

    if v_stored is null then
      -- La carrera perdio contra otra sesion que todavia no ha confirmado. No
      -- se inventa nada: el cliente reintenta, que es seguro por definicion.
      perform sec.raise_boundary('COMMAND_IN_FLIGHT',
        'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;

    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED',
        'esa clave ya se uso con una intencion distinta', 409);
    end if;

    return sec.group_envelope(v_result, true);
  end if;

  -- ---------- la creacion, ya con la clave nuestra ----------
  --
  -- Si el ambito ya existe es de otro comando o de otra persona, y en los dos
  -- casos se rechaza: adoptarlo dejaria apuntar a un ambito ajeno.
  --
  -- **Lo detecta la clave primaria, no una lectura previa.** Una lectura la
  -- acota la RLS del provisioner, que a proposito solo alcanza ambitos sin
  -- miembros: preguntarle por un grupo ajeno diria "no existe" y el codigo
  -- seguiria adelante. La PK no se puede acotar.
  --
  -- Se captura para dar el codigo de frontera y se RELANZA acto seguido; no
  -- continua. La regla de ADR-009 §5 existe para que ninguna excepcion
  -- convierta un fallo en escritura parcial, y aqui no hay continuacion.
  begin
    insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
    values (v_scope, 'group', v_currency, null);
  exception when unique_violation then
    perform sec.raise_boundary('SCOPE_ID_TAKEN',
      'ese identificador de ambito ya existe', 409);
  end;

  insert into core.membership (scope_id, user_id) values (v_scope, v_actor);

  insert into core.group_profile (scope_id, display_name, emoji, created_by, default_category_id)
  values (v_scope, v_name, v_emoji, v_actor, v_default);

  -- El participante del creador, y su vinculo con la cuenta. El vinculo es lo
  -- que le da identidad contextual; la membresia de arriba es lo que le da
  -- acceso. Son dos hechos distintos y ADR-012 §4 exige no confundirlos.
  insert into core.participant (id, scope_id, display_name)
  values (v_creator, v_scope, v_creator_name);

  insert into core.participant_user_link (participant_id, scope_id, user_id)
  values (v_creator, v_scope, v_actor);

  -- ============ LA PRESENCIA DEL CREADOR, desde el día de la creación =========
  --
  -- Sin periodo NADIE es elegible en ninguna fecha —`sec.assert_participant_eligible`
  -- lo dice literalmente— y por eso ningún gasto de grupo se podía registrar.
  -- Se abre AQUÍ, en la misma transacción que crea al participante: son el mismo
  -- hecho —«esta persona está en el grupo desde que el grupo existe»— y separarlos
  -- dejaría una ventana en la que el grupo existe y nadie puede gastar.
  --
  -- **`[current_date, ∞)`, abierto por arriba.** Cerrar el periodo exigiría saber
  -- cuándo se va, que es una decisión de ciclo de vida que pertenece a F10.
  --
  -- **Un reintepto idempotente no lo duplica ni lo desplaza**: `sec.claim_provisioning`
  -- devuelve antes de llegar aquí cuando el comando ya se ejecutó, así que este
  -- bloque corre exactamente una vez por grupo.
  insert into core.participant_period (participant_id, valid_from, valid_until)
  values (v_creator, current_date, null);

  -- Los demas: nombre y nada mas. Sin cuenta, sin vinculo y sin capacidad de
  -- actuar hasta que reclamen su nombre (F10).
  for v_item in select value from jsonb_array_elements(v_intent -> 'participants') loop
    insert into core.participant (id, scope_id, display_name)
    values ((v_item ->> 'client_participant_id')::uuid, v_scope, v_item ->> 'display_name');

    -- Y su presencia, con la misma fecha y el mismo criterio que la del creador.
    -- Sin cuenta y sin vínculo, pero presentes: participar en un gasto no exige
    -- tener cuenta (ADR-012 §1), sólo haber estado.
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values ((v_item ->> 'client_participant_id')::uuid, current_date, null);
  end loop;

  return sec.group_envelope(v_scope, false);
end
$function$

;

create or replace function api.update_group_profile(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id',
    'display_name', 'emoji', 'default_category_id', 'expected_updated_at', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor     uuid;
  v_command   uuid;
  v_version   integer;
  v_scope     uuid;
  v_name      text;
  v_emoji     text;
  v_default   uuid;
  v_expected  timestamptz;
  v_parts     jsonb;
  v_intent    jsonb;
  v_stored    jsonb;
  v_replay    boolean := false;
  v_before    core.group_profile%rowtype;
  v_change    uuid;
  v_item      jsonb;
  v_ids       uuid[];
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;

  if v_command is null or v_version is null or v_scope is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version y scope_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;

  v_name  := sec.canonical_display_name(payload ->> 'display_name');
  v_emoji := btrim(coalesce(payload ->> 'emoji', ''));
  if v_emoji = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'emoji no puede quedar vacio', 400);
  end if;

  -- La categoria preestablecida: nula es «Todas». Misma regla que el gasto.
  v_default := sec.payload_uuid(payload, 'default_category_id', false);
  if v_default is not null then
    perform sec.assert_shared_category_usable(v_default, null);
  end if;

  v_expected := (payload ->> 'expected_updated_at')::timestamptz;
  if v_expected is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'expected_updated_at es obligatorio: declara el perfil que leiste', 400);
  end if;

  v_parts := coalesce(payload -> 'participants', '[]'::jsonb);
  if jsonb_typeof(v_parts) <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'participants debe ser una lista', 400);
  end if;
  for v_item in select value from jsonb_array_elements(v_parts) loop
    perform sec.assert_payload_shape(v_item, c_participant_fields);
    if (v_item ->> 'client_participant_id') is null then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'cada participante nuevo lleva su client_participant_id', 400);
    end if;
  end loop;

  -- ---------- la autorizacion: ser miembro, y nada mas (ADR-032 §2) ----------
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;

  -- ---------- la intencion canonica ----------
  v_intent := jsonb_build_object(
    'scope_id',            v_scope,
    'display_name',        v_name,
    'emoji',               v_emoji,
    'default_category_id', v_default::text,
    'expected_updated_at', v_expected,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_participant_id', p ->> 'client_participant_id',
               'display_name',          sec.canonical_display_name(p ->> 'display_name'))
               order by ord)
        from jsonb_array_elements(v_parts) with ordinality as e(p, ord)
    ), '[]'::jsonb));

  -- ---------- el reclamo de la clave, antes de escribir nada (ADR-033) ----------
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.update', v_version, v_intent, v_scope);
  exception when unique_violation then
    v_replay := true;
  end;

  if v_replay then
    select pc.canonical_intent into v_stored
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT',
        'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED',
        'esa clave ya se uso con una intencion distinta', 409);
    end if;
    return sec.group_envelope(v_scope, true);
  end if;

  -- ---------- el CAS, bajo bloqueo de la fila ----------
  select * into v_before from core.group_profile g
   where g.scope_id = v_scope for update;
  if v_before.scope_id is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  if v_before.updated_at <> v_expected then
    perform sec.raise_boundary('PROFILE_CONFLICT',
      'otro miembro ha guardado cambios desde que leiste el grupo; recarga', 409);
  end if;

  -- ---------- el historial, ANTES del cambio: si esto falla, nada cambia ----------
  insert into core.group_profile_change (
    scope_id, changed_by, client_command_id, before_profile, after_profile, added_participants)
  values (
    v_scope, v_actor, v_command,
    jsonb_build_object('display_name', v_before.display_name, 'emoji', v_before.emoji,
                       'default_category_id', v_before.default_category_id),
    jsonb_build_object('display_name', v_name,                'emoji', v_emoji,
                       'default_category_id', v_default),
    v_intent -> 'participants')
  returning id into v_change;

  -- ---------- el perfil ----------
  -- `clock_timestamp()` y no `now()`: el testigo del CAS tiene que ser un
  -- instante DISTINTO en cada guardado, y `now()` es el mismo durante toda
  -- una transaccion. Medido con la fixture: dos guardados en una transaccion
  -- daban el mismo `updated_at` y el segundo pisaba al primero sin conflicto.
  update core.group_profile
     set display_name        = v_name,
         emoji               = v_emoji,
         default_category_id = v_default,
         updated_at          = clock_timestamp()
   where scope_id = v_scope;

  -- ---------- las altas: identidad contextual + presencia desde hoy ----------
  for v_item in select value from jsonb_array_elements(v_intent -> 'participants') loop
    begin
      insert into core.participant (id, scope_id, display_name)
      values ((v_item ->> 'client_participant_id')::uuid, v_scope, v_item ->> 'display_name');
    exception when unique_violation then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'ese client_participant_id ya existe', 409);
    end;
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values ((v_item ->> 'client_participant_id')::uuid, current_date, null);
  end loop;

  -- ---------- el aviso, a todos los miembros, el editor incluido ----------
  insert into core.group_profile_notice (recipient_user_id, scope_id, change_id, editor_user_id)
  select m.user_id, v_scope, v_change, v_actor
    from core.membership m
   where m.scope_id = v_scope
  on conflict (recipient_user_id, change_id) do nothing;

  return sec.group_envelope(v_scope, false);
end
$function$

;
