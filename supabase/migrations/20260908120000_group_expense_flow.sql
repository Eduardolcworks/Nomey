-- ===========================================================================
-- F9 · EL GASTO COMPARTIDO SE PUEDE REGISTRAR Y SE PUEDE LEER
-- ===========================================================================
--
-- Cierra los cuatro bloqueos que impedian el alta de un gasto de grupo, todos
-- medidos contra este mismo stack antes de tocar nada:
--
--   1. NADIE ERA ELEGIBLE.  `sec.assert_participant_eligible` exige un periodo
--      que cubra la fecha efectiva, y `api.create_group` no abria ninguno:
--      `core.participant_period` estaba VACIA. Cualquier gasto respondia
--      `PARTICIPANT_NOT_ELIGIBLE · 422`.
--   2. EL CLIENTE NO SABIA QUIEN ERA.  `api.group_participant` no publica el
--      vinculo con la cuenta —lo revelaria de TODOS (ADR-012 §1)— asi que no
--      habia forma de preseleccionar al pagador.
--   3. NI CONCEPTO NI CATEGORIA CABIAN.  La lista de campos admitidos de
--      `api.record_group_expense` no los incluia, de modo que conectar el
--      guardado los habria tirado en silencio.
--   4. NO HABIA DONDE LEER LO REGISTRADO.  `api` publicaba `group_profile` y
--      `group_participant` y nada mas: ni operaciones, ni cuotas, ni deuda.
--
-- ============ LAS DOS DECISIONES QUE ESTO APLICA, Y SU ALCANCE ==============
--
-- **A · En un gasto compartido solo caben categorias DE SISTEMA.** No es una
-- regla nueva sobre las categorias: es declinar extender una. `core.category`
-- admite categorias propias por cuenta y `api.category` es `security_invoker`,
-- asi que una categoria propia de quien registra **no la puede nombrar nadie
-- mas del grupo** — verian un identificador, que es exactamente lo que ADR-021
-- prohibe. Las alternativas eran abrir la RLS de una relacion privada a todo un
-- grupo, o denormalizar el nombre en la version, que es lo que F6.D decidio no
-- hacer para que renombrar alcance al historico. Se rechaza en el servidor con
-- `CATEGORY_NOT_SHAREABLE` y el selector del grupo tampoco las ofrece.
--
-- **Es una limitacion provisional, no una prohibicion de producto.** Las
-- categorias propias en grupos quedan como decision APLAZADA: cuando se tome,
-- necesitara su propio ADR sobre visibilidad compartida.
--
-- **B · Las presencias se abren SOLO al crear el grupo.** Los grupos que ya
-- existian se quedan sin periodos y sus gastos siguen rechazandose: rellenarles
-- presencia seria inventar una historia que nadie declaro. Esta migracion no
-- toca ni una fila de datos existente.
--
-- Nada de esto amplia la cola durable ni toca RLS de terceros.
-- ===========================================================================

-- ======================= 1 · presencias al crear el grupo ==================
--
-- El provisioner ya podia crear participantes; ahora abre tambien su periodo.
-- Mismo criterio de minimo privilegio que el resto de su superficie: `insert` y
-- la policy que lo acota, sin `update` ni `delete` — cerrar un periodo pertenece
-- al ciclo de vida de participantes, que es F10.
grant insert on core.participant_period to nomey_provisioner;

create policy participant_period_provisioner_insert on core.participant_period
  for insert to nomey_provisioner
  with check (
    -- Solo dentro de un ambito sin miembros todavia, que es exactamente la
    -- ventana en la que `api.create_group` esta construyendo el grupo. Igual
    -- que la policy del vinculo: fuera de esa ventana no puede escribir nada.
    not exists (
      select 1
        from core.participant p
        join core.membership m on m.scope_id = p.scope_id
       where p.id = participant_period.participant_id
    )
  );
CREATE OR REPLACE FUNCTION api.create_group(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'client_group_id',
    'display_name', 'emoji', 'currency_definition_id',
    'creator_participant_id', 'creator_display_name', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor    uuid;
  v_command  uuid;
  v_version  integer;
  v_scope    uuid;
  v_currency uuid;
  v_name     text;
  v_emoji    text;
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

  insert into core.group_profile (scope_id, display_name, emoji, created_by)
  values (v_scope, v_name, v_emoji, v_actor);

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
$function$;

-- ==================== 2 · quien soy YO dentro de un grupo ==================
--
-- **Una subconsulta dentro de una vista NO basta, y esa es toda la razon de que
-- esto sea una funcion.** `api.group_participant` es `security_invoker`: se
-- evalua con los privilegios del usuario real, y `authenticated` no tiene ni
-- `USAGE` sobre `core` ni `SELECT` sobre `core.participant_user_link`. Una
-- subconsulta ahi no devolveria «falso»: fallaria por permisos.
--
-- Asi que se usa el mismo patron que `sec.is_member` de ADR-007: un helper
-- REDUCIDO, `SECURITY DEFINER`, que **no acepta un usuario arbitrario**. Toma
-- solo el participante y compara contra `sec.request_actor_id()`, de modo que
-- con esta funcion no se puede preguntar «¿de quien es este participante?», solo
-- «¿es mio?». Los vinculos de los demas siguen sin publicarse.
create function sec.is_my_participant(p_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from core.participant_user_link l
     where l.participant_id = p_participant
       and l.user_id = sec.request_actor_id()
  );
$fn$;

comment on function sec.is_my_participant(uuid) is
  'Si ese participante es la identidad contextual del actor de la peticion. No acepta un usuario arbitrario: solo responde sobre uno mismo (ADR-007, ADR-012 §1).';

revoke execute on function sec.is_my_participant(uuid) from public;
grant  execute on function sec.is_my_participant(uuid) to authenticated;

drop view api.group_participant;

create view api.group_participant
with (security_invoker = true) as
select p.id as participant_id,
       p.scope_id,
       p.display_name,
       p.created_at,
       -- Sobre uno mismo y nada mas. Un `true` dice «este soy yo»; un `false`
       -- NO dice de quien es, solo que no es mio.
       sec.is_my_participant(p.id) as is_self
  from core.participant p
  join core.scope s on s.id = p.scope_id
 where s.kind = 'group';

comment on view api.group_participant is
  'Los participantes de los grupos alcanzables. NO publica el vinculo con la cuenta: eso revelaria que identidad global hay detras (ADR-012 §1). `is_self` responde solo sobre el actor.';

grant select on api.group_participant to authenticated;

-- ================= 3 · la categoria de un gasto COMPARTIDO =================
--
-- Misma forma que `sec.assert_category_usable`, con una condicion mas y una
-- menos: no mira al actor —una categoria de sistema es de todos— y **rechaza
-- cualquiera que tenga dueno**.
create function sec.assert_shared_category_usable(
  p_category   uuid,
  p_supersedes uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_owner  uuid;
  v_active boolean;
  v_previa uuid;
begin
  select c.owner_user_id, c.is_active into v_owner, v_active
    from core.category c where c.id = p_category;

  if not found then
    perform sec.raise_boundary('CATEGORY_NOT_USABLE',
      'esa categoria no existe', 422);
  end if;

  -- La condicion propia de lo compartido, con su PROPIO codigo: quien lo reciba
  -- tiene que poder decir «elige otra», no «no existe».
  if v_owner is not null then
    perform sec.raise_boundary('CATEGORY_NOT_SHAREABLE',
      'un gasto compartido solo admite categorias de sistema: una propia no la podrian nombrar los demas miembros', 422);
  end if;

  -- Baja logica, con la misma excepcion de siempre: conservar la que ya estaba.
  if not v_active then
    if p_supersedes is null then
      perform sec.raise_boundary('CATEGORY_NOT_USABLE',
        'esa categoria esta dada de baja y no puede asignarse', 422);
    end if;
    select ec.category_id into v_previa
      from core.expense_category ec where ec.operation_version_id = p_supersedes;
    if v_previa is distinct from p_category then
      perform sec.raise_boundary('CATEGORY_NOT_USABLE',
        'esa categoria esta dada de baja y no puede asignarse', 422);
    end if;
  end if;
end
$fn$;

comment on function sec.assert_shared_category_usable(uuid, uuid) is
  'La categoria de un gasto de grupo: existente, activa y DE SISTEMA. Una propia no la podrian nombrar los demas miembros (ADR-021). Limitacion provisional, no prohibicion definitiva.';

revoke execute on function sec.assert_shared_category_usable(uuid, uuid) from public;
grant  execute on function sec.assert_shared_category_usable(uuid, uuid) to nomey_writer;

-- ================= 4 · el writer acepta concepto y categoria ===============
CREATE OR REPLACE FUNCTION api.record_group_expense(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method',
    -- F9: el gasto compartido describe QUÉ se gastó, igual que el personal.
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
  -- 1 · forma
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
  -- Vocabulario cerrado tambien en las CLAVES: `equal` no declara nada, y
  -- aceptar `weights` junto a `exact_amounts` dejaria creer que se tuvo en
  -- cuenta. Mismo criterio que `created_by` en `sec.assert_payload_shape`.
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  -- El cliente NO envia ordinales ni efectos: el orden estable es el de la
  -- lista y el ordinal lo asigna el servidor (ADR-002 §7, ADR-013 §5).
  v_resolved := sec.resolve_split(v_total, v_participants, v_payer, v_method);

  -- Canonicalizacion: SOLO el servidor (ADR-011 §8). Los valores exactos entran
  -- VERBATIM —«00100» no es «100»— y las identidades y la fecha materializan su
  -- representacion canonica. El orden de `participants` se conserva porque ES
  -- intencion: es el desempate del paso 5 de ADR-002 §5.
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
    -- Los dos entran en la intención canónica: cambiar el concepto o la
    -- categoría es OTRO comando, no un reintento del mismo (ADR-011 §8).
    'concept',                v_concept,
    'category_id',            v_category::text);

  -- 2, 3 y 4 · actor, reclamo y replay o conflicto, SIEMPRE antes del CAS.
  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- 5 · autorizacion actual. Un gasto de Grupo lo registra CUALQUIER INTEGRANTE
  -- —`data-model.md` §8 lo marca «inmediata»— y la autoria original no concede
  -- exclusividad sobre la correccion (`data-model.md` §7). Por eso aqui no se
  -- mira `created_by` de la operacion: se mira la membresia actual del ambito.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  -- La categoría, con la restricción propia de lo COMPARTIDO: sólo de sistema.
  perform sec.assert_shared_category_usable(v_category, v_expected);

  -- Elegibilidad de cada participante en la FECHA EFECTIVA (ADR-012 §7).
  foreach v_payer_scope in array v_participants loop
    perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
  end loop;
  v_payer_scope := null;

  -- El extremo de caja: derivado, opcional, y en la moneda base de su ambito.
  v_payer_scope := sec.participant_personal_scope(v_payer);
  if v_payer_scope is not null then
    perform sec.assert_no_conversion(v_payer_scope, v_currency);
  end if;

  -- 6 · LOCK de los ambitos cuya deuda puede cambiar (ADR-013 §11).
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

  -- 7 · lock de la operacion y CAS.
  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

    -- 8 y 9 · leer la deuda autoritativa DESPUES de los locks, y validar. Un
    -- alta no necesita esta comprobacion: solo suma deuda. Una correccion puede
    -- restarla por debajo de lo ya liquidado, y eso viola el mismo invariante
    -- que `record_debt_settlement` protege al liquidar.
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved);

  -- Concepto y categoría, en las MISMAS relaciones por versión que un gasto
  -- personal: son el mismo hecho —qué se gastó— y no dos parecidos.
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  -- Gasto economico de cada participante, sin cambio de saldo. LOS CEROS SE
  -- CONSERVAN: una participacion calculada en cero por indivisibilidad sigue
  -- siendo una participacion (ADR-013 §8).
  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  -- Derechos del pagador frente al resto. Una participacion calculada en cero NO
  -- genera deuda: no hay obligacion que registrar, y ADR-013 §8 prohibe
  -- inventar deuda de cero donde el dominio la omite.
  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  -- El movimiento de caja: UNO SOLO y por el total (invariante 4). No se
  -- descompone en gasto mas transferencia. Si el pagador no tiene Modo Personal
  -- no hay extremo interno que registrar, igual que en una transferencia
  -- externa (`data-model.md` §4.7).
  if v_payer_scope is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_currency, - v_total);
  end if;

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$;

-- ===================== 5 · la lectura de lo registrado =====================
--
-- **Sobre `core.current_effect`, nunca sobre `core.effect`.** ADR-013 §9 reserva
-- a la proyeccion canonica el derecho a depender de la tabla de efectos, y una
-- comprobacion de catalogo lo vigila. Todo lo que sigue lee de ella.
--
-- **Una fila por OPERACION, en su version vigente.** `current_effect` ya excluye
-- las versiones superadas; `version_kind = 'record'` excluye las anuladas, que
-- son una version sin efectos (ADR-024).

-- **NO PUBLICA QUIEN PAGO, y es una decision de privilegio, no un olvido.**
-- El pagador vive en `core.split`, y una vista `security_invoker` se evalua con
-- los privilegios de QUIEN LLAMA: publicarlo exigiria `grant select on core.split
-- to authenticated` con su politica, es decir, ampliar la superficie que el
-- cliente alcanza. Medido: sin ese grant la vista responde `permission denied
-- for table split`. Ampliarla es una decision que esta tanda no necesita tomar
-- —nada de lo que se pinta muestra el pagador— y tomarla de paso, para una
-- columna que nadie lee, seria exactamente lo contrario de privilegio minimo.
--
-- Cuando haga falta (el detalle de un gasto, la liquidacion) se decide entonces,
-- con su politica escrita en la misma migracion que el grant.
drop view if exists api.group_operation;

create view api.group_operation
with (security_invoker = true) as
select o.id                     as operation_id,
       e.scope_id,
       e.currency_definition_id,
       ov.original_amount::text as total_amount,
       -- EL MISMO IMPORTE, ORDENABLE. `total_amount` sale como texto porque es
       -- dinero exacto y ADR-008 §1 no admite un número donde hay dinero; pero
       -- ordenar por ese texto ordenaría `100` antes que `9`. Esta columna es el
       -- valor, y existe SÓLO para el `order by`: nadie la lee como importe.
       ov.original_amount        as total_order,
       ov.effective_date,
       md.concept,
       ec.category_id,
       -- LA CUOTA DE QUIEN MIRA, que NO es el total del gasto. Sale del efecto
       -- economico de su propio participante; si no participo, no hay fila y
       -- queda nula — que es distinto de cero.
       (select ee.economic_amount::text
          from core.current_effect ee
         where ee.operation_version_id = ov.id
           and ee.economic_amount is not null
           and ee.economic_participant_id is not null
           and sec.is_my_participant(ee.economic_participant_id)
         limit 1)               as your_share,
       ov.supersedes_version_id as previous_version_id,
       ov.version_no,
       o.created_at             as operation_created_at
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o          on o.id  = ov.operation_id
  join core.scope s              on s.id  = e.scope_id
  left join core.movement_detail md  on md.operation_version_id = ov.id
  left join core.expense_category ec on ec.operation_version_id = ov.id
 where s.kind = 'group'
   and o.operation_class = 'group_expense'
   and ov.version_kind = 'record'
 group by o.id, e.scope_id, e.currency_definition_id, ov.id, ov.original_amount,
          ov.effective_date, md.concept, ec.category_id,
          ov.supersedes_version_id, ov.version_no, o.created_at;

comment on view api.group_operation is
  'Los gastos de un grupo, UNA FILA POR OPERACION y en su version vigente. `total_amount` es el gasto entero; `your_share` la cuota de quien mira, que no es lo mismo (ADR-025).';
comment on column api.group_operation.total_order is
  'El mismo importe como entero, sólo para ordenar. Nunca se lee como cifra: la que se lee es total_amount, en texto.';
comment on column api.group_operation.total_amount is
  'Importe DECLARADO del gasto, en la divisa base del grupo. NO es la cuota de nadie.';
comment on column api.group_operation.your_share is
  'La participacion economica del actor en ese gasto. Nula si no participo, que no es cero.';

grant select on api.group_operation to authenticated;

-- ------------------------------ el resumen --------------------------------
--
-- **Agregado en el SERVIDOR, y por la misma razon que `api.personal_statistics`:
-- PostgREST rechaza funciones de agregado pedidas por el cliente (`PGRST123`) y
-- `max_rows` acota una peticion a mil filas.** Sumar en el cliente daria una
-- cifra contable incompleta que no lanza nada — exactamente lo que F6.E midio.
drop view if exists api.group_summary;

create view api.group_summary
with (security_invoker = true) as
select e.scope_id,
       e.currency_definition_id,
       -- TOTAL: lo que el grupo se ha gastado. Suma de la economica de todos.
       coalesce(sum(e.economic_amount) filter (
         where e.economic_amount is not null and e.economic_participant_id is not null
       ), 0)::text as total_amount,
       -- TU GASTASTE: solo las cuotas del actor.
       coalesce(sum(e.economic_amount) filter (
         where e.economic_amount is not null
           and e.economic_participant_id is not null
           and sec.is_my_participant(e.economic_participant_id)
       ), 0)::text as your_share,
       -- POSICION: lo que te deben menos lo que debes. Positivo = te deben.
       (coalesce(sum(e.debt_amount) filter (
          where e.debt_amount is not null and sec.is_my_participant(e.debt_creditor_participant_id)
        ), 0)
        - coalesce(sum(e.debt_amount) filter (
          where e.debt_amount is not null and sec.is_my_participant(e.debt_debtor_participant_id)
        ), 0))::text as net_position
  from core.current_effect e
  join core.scope s on s.id = e.scope_id
 where s.kind = 'group'
 group by e.scope_id, e.currency_definition_id;

comment on view api.group_summary is
  'Las tres cifras de un grupo, agregadas EN EL SERVIDOR sobre la proyeccion canonica. `total_amount` no es la cuota de nadie y `net_position` es te-deben menos debes (ADR-016).';

grant select on api.group_summary to authenticated;
