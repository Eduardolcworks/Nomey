-- =========================================================================
-- F6.E · Las categorias son EXCLUSIVAMENTE de gasto
--
-- ADR-027, que supersede parcialmente ADR-021. Cinco cambios estructurales:
--
--   1  la categoria sale de `core.movement_detail` a su propia relacion
--   2  `applies_to` desaparece: ya no hay familias que distinguir
--   3  `icon` pasa a ser una CLAVE SEMANTICA, no un nombre de SF Symbol
--   4  `personal_income` deja de aceptar, validar y persistir categoria
--   5  cinco categorias se retiran POR BAJA LOGICA, nunca por DELETE
--
-- ============== POR QUE UNA RELACION APARTE Y NO UN NULO ==================
--
-- ADR-020 §1 ya fijaba el principio: **lo universal y lo que depende de la
-- clase van separados**, y por eso existen `core.split` y
-- `core.adjustment_detail`. `core.movement_detail` mezclaba dos hechos cuyos
-- dominios acaban de dejar de coincidir: el CONCEPTO es de gasto e ingreso, y
-- la CATEGORIA es solo de gasto.
--
-- La alternativa —dejar `category_id` anulable con una restriccion— **no puede
-- ser estructural**, y esa es la razon por la que se rechaza: `movement_detail`
-- no tiene ninguna columna que diga a que clase pertenece, asi que un `CHECK`
-- no tiene contra que comprobar «si es gasto, no nulo». Habria que anadir un
-- discriminante de clase a la fila, duplicando `operation.operation_class`, y
-- el invariante «todo gasto tiene categoria» pasaria del motor al codigo de la
-- frontera. Se habria DEBILITADO una garantia que hoy da PostgreSQL.
--
-- Con la relacion aparte, `category_id` sigue siendo `NOT NULL` y **ningun nulo
-- entra en el modelo**. La AUSENCIA de fila significa exactamente una cosa, y
-- solo una: esta clase de movimiento no admite categoria. Es la misma semantica
-- que ya tiene `adjustment_detail` ausente en un ajuste por delta.
--
-- ============ QUE GARANTIZA «TODO GASTO TIENE CATEGORIA», EXACTAMENTE =======
--
-- Conviene ser preciso, porque `NOT NULL` NO dice lo que parece decir. Medido
-- contra el catalogo y falsificado por las rutas reales:
--
--   COMO MUCHO UNA .... ESTRUCTURAL. La clave primaria sobre
--                       `operation_version_id`. Falsificado: un segundo insert
--                       para la misma version da `duplicate key`.
--
--   LA QUE HAY ES REAL  ESTRUCTURAL. `NOT NULL` mas la FK a `core.category`.
--
--   AL MENOS UNA ...... **NO es estructural.** No hay `CHECK` ni trigger que lo
--                       exija —medido: cero de cada—, y PostgreSQL no puede
--                       expresarlo sin uno: la condicion depende de
--                       `operation.operation_class`, que vive en otra tabla.
--
-- La presencia la garantizan DOS cosas juntas, y ninguna es una restriccion:
--
--   1  LA FRONTERA AUTORITATIVA. `api.record_personal_expense` exige
--      `category_id` en el payload y llama a `sec.persist_expense_category`
--      siempre. Falsificado: omitirla da `PAYLOAD_INVALID`.
--   2  EL CIERRE DE LAS ESCRITURAS DIRECTAS. `authenticated` no tiene `USAGE`
--      sobre `core` —ni un solo privilegio distinto de SELECT, ni una sola
--      policy de escritura—, asi que no hay otra ruta. Falsificado: insertar
--      una version a mano, o borrar la fila de categoria, da «permission denied
--      for schema core».
--
-- Es la misma clase de garantia que ADR-011 §11 ya reserva a la frontera para
-- el linaje de versiones, y se documenta igual de explicita: **decir que una FK
-- lo garantiza seria falso**.
--
-- `Otros` sigue siendo una categoria REAL. No representa el nulo ni lo
-- sustituye: es la categoria de los gastos que no encajan en otra.
-- =========================================================================

-- Las vistas dependen de lo que se va a alterar, asi que se retiran y se
-- vuelven a crear al final. El orden de retirada es el de dependencia.
drop function if exists api.personal_statistics(date, date);
drop function if exists api.observed_balance(uuid[]);
drop view if exists api.personal_operation_version;
drop view if exists api.personal_operation;
drop view if exists api.category;

-- ================== 1 · la categoria del gasto, en su relacion =============

create table core.expense_category (
  operation_version_id uuid not null primary key
    references core.operation_version (id),
  category_id          uuid not null references core.category (id)
);

comment on table core.expense_category is
  'Categoria de una version que es un GASTO. Presente solo donde el hecho existe; su AUSENCIA significa que la clase no admite categoria, nunca gasto sin categorizar (ADR-027).';

alter table core.expense_category enable row level security;

-- Misma regla de visibilidad que `core.movement_detail`: se ve el detalle de
-- una version de la que se ve algun efecto.
grant select on core.expense_category to authenticated;

create policy expense_category_client_select on core.expense_category
  for select to authenticated
  using (
    exists (
      select 1 from core.effect e
      where e.operation_version_id = expense_category.operation_version_id
        and sec.is_member(e.scope_id)
    )
  );

grant select, insert on core.expense_category to nomey_writer;

create policy expense_category_writer_select on core.expense_category
  for select to nomey_writer using (true);

-- Misma forma que `movement_detail_writer_insert`: la version referida debe
-- estar atribuida al actor de la peticion.
create policy expense_category_writer_insert on core.expense_category
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = expense_category.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

-- ==================== 2 · migrar lo que hubiera ===========================
--
-- Hoy no hay ni una fila, y la migracion NO depende de eso: tiene que ser
-- correcta si encuentra datos.
--
-- Solo se traslada la categoria de los GASTOS. La de los ingresos desaparece
-- con la columna, y es deliberado: bajo el modelo nuevo un ingreso no tiene ese
-- concepto de dominio. Es la unica perdida de dato de esta migracion, esta
-- decidida por producto, y se hace antes de que exista produccion.
insert into core.expense_category (operation_version_id, category_id)
select d.operation_version_id, d.category_id
  from core.movement_detail d
 where d.applies_to = 'expense';

-- ============ 3 · `movement_detail` se queda con lo que es suyo =============

alter table core.movement_detail drop constraint movement_detail_categoria_de_su_familia;
alter table core.movement_detail drop constraint movement_detail_familia_valida;
alter table core.movement_detail drop column applies_to;
alter table core.movement_detail drop column category_id;

comment on table core.movement_detail is
  'Concepto de una version que es un MOVIMIENTO. Comun a gasto e ingreso; la categoria vive en core.expense_category porque solo el gasto la tiene (ADR-027).';

-- ================= 4 · `core.category` pierde la familia ==================
--
-- Todas las categorias de Nomey pertenecen al dominio GASTO, asi que
-- `applies_to` seria una columna constante. ADR-021 la eligio como familia
-- CONTABLE para que F9 reutilizara el catalogo sin migrar, y eso sigue siendo
-- cierto: el gasto de Grupo es gasto y usara este mismo catalogo. Lo que ha
-- desaparecido no es el proposito de la columna, sino la segunda familia.
--
-- Con una sola familia, la FK compuesta que fijaba la pertenencia deja de
-- fijar nada: no hay familia ajena en la que caer. La integridad no se debilita
-- porque el conjunto de categorias invalidas para un gasto quedo VACIO.

drop index core.category_propia_nombre_unico;
drop index core.category_familia_orden;
alter table core.category drop constraint category_id_familia_unico;
alter table core.category drop constraint category_familia_valida;
alter table core.category drop column applies_to;

create unique index category_propia_nombre_unico
  on core.category (owner_user_id, lower(btrim(label)))
  where owner_user_id is not null;

create index category_orden on core.category (ordinal);

comment on table core.category is
  'Catalogo de categorias de GASTO. owner_user_id nulo = de sistema. Baja logica, nunca DELETE con historico (ADR-021, ADR-027).';

-- ============== 5 · el icono pasa a ser una clave SEMANTICA ================
--
-- Antes guardaba el nombre de un SF Symbol, y eso convertia una decision de
-- iOS en el contrato universal. Medido: `expo-symbols` SI puede pintar iconos
-- distintos en Android —tiene 4055 simbolos de Material— pero **solo si el
-- nombre llega como objeto `{ ios, android }`**. Con una cadena suelta,
-- Android resuelve a nulo y cae en el mismo recuadro generico para todas.
--
-- Asi que la base guarda la IDENTIDAD SEMANTICA y el cliente la resuelve a la
-- representacion de cada plataforma. Una sola identidad, dos representaciones.
--
-- VOCABULARIO CERRADO, y con `CHECK`: sin el, un nombre de SF Symbol volveria a
-- colarse en cuanto alguien lo escribiera, y el contrato se perderia en
-- silencio. Ampliarlo exige migracion, que es lo correcto para un vocabulario
-- de sistema.
--
-- Las cuatro claves de las categorias retiradas se conservan a proposito: su
-- historico tiene que seguir resolviendo nombre e icono (ADR-021).

update core.category set icon = case message_key
  when 'category.expense.groceries'     then 'groceries'
  when 'category.expense.dining'        then 'dining'
  when 'category.expense.transport'     then 'transport'
  when 'category.expense.housing'       then 'home'
  when 'category.expense.health'        then 'health'
  when 'category.expense.leisure'       then 'leisure'
  when 'category.expense.shopping'      then 'shopping'
  when 'category.expense.subscriptions' then 'subscriptions'
  when 'category.expense.travel'        then 'travel'
  when 'category.expense.other'         then 'other'
  when 'category.expense.utilities'     then 'utilities'
  when 'category.expense.education'     then 'education'
  when 'category.income.salary'         then 'salary'
  when 'category.income.extra'          then 'extra'
  when 'category.income.other'          then 'other'
  else 'tag'
end;

-- Cualquier fila que no fuera de sistema —no hay ninguna hoy— cae en el
-- generico antes de que la restriccion empiece a exigir.
update core.category set icon = 'tag'
 where icon not in ('groceries','dining','transport','home','health','leisure',
                    'shopping','subscriptions','travel','other',
                    'utilities','education','salary','extra','tag');

alter table core.category
  add constraint category_icono_del_vocabulario
  check (icon in ('groceries','dining','transport','home','health','leisure',
                  'shopping','subscriptions','travel','other',
                  'utilities','education','salary','extra','tag'));

comment on column core.category.icon is
  'Clave SEMANTICA de icono, no un nombre de plataforma. El cliente la resuelve a SF Symbol en iOS y a Material Symbol en Android (ADR-027).';

-- ================ 6 · retirada de las cinco, por baja logica ==============
--
-- NUNCA `DELETE`. ADR-021 lo rechaza incluso para categorias sin historico —
-- «dos comportamientos segun los datos, y el borrado real es irreversible»— y
-- la baja logica vale para los dos casos: desaparecen del selector y cualquier
-- movimiento historico sigue resolviendo su nombre y su icono.
--
-- Tiene que ser una migracion y no una llamada en caliente: la policy
-- `category_provisioner_update` lleva `owner_user_id = sec.request_actor_id()`,
-- asi que `api.set_custom_category_active` NO puede tocar una de sistema — la
-- alcanza con cero filas y responde `CATEGORY_NOT_USABLE`. Correcto, y por eso
-- la retirada vive aqui.
--
-- Los UUID permanecen. Son la identidad y ADR-019 prohibe regenerarlos.

update core.category set is_active = false
 where message_key in ('category.expense.utilities',   -- cubierta por Hogar
                       'category.expense.education',   -- poco universal; que la
                                                       -- cree quien la necesite
                       'category.income.salary',       -- el ingreso ya no
                       'category.income.extra',        -- tiene categoria
                       'category.income.other');

-- ==================== 7 · los helpers de escritura ========================
--
-- Se SUELTAN y se recrean, nunca `CREATE OR REPLACE` con firma nueva: F6.B
-- midio que eso no reemplaza, crea una funcion distinta, y conviven las dos.
-- Si la resolucion de sobrecarga eligiera la vieja, el escritor seguiria
-- intentando escribir columnas que ya no existen.

drop function sec.persist_movement_detail(uuid, text, uuid, text);

create function sec.persist_movement_detail(
  p_version uuid,
  p_concept text
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  insert into core.movement_detail (operation_version_id, concept)
  values (p_version, p_concept);
end
$fn$;

comment on function sec.persist_movement_detail(uuid, text) is
  'Persiste el concepto de un movimiento. Comun a gasto e ingreso (ADR-020, ADR-027).';

revoke execute on function sec.persist_movement_detail(uuid, text) from public;
grant  execute on function sec.persist_movement_detail(uuid, text) to nomey_writer;

create function sec.persist_expense_category(
  p_version  uuid,
  p_category uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  insert into core.expense_category (operation_version_id, category_id)
  values (p_version, p_category);
end
$fn$;

comment on function sec.persist_expense_category(uuid, uuid) is
  'Persiste la categoria de un GASTO. Solo la invoca la clase que tiene ese hecho (ADR-027).';

revoke execute on function sec.persist_expense_category(uuid, uuid) from public;
grant  execute on function sec.persist_expense_category(uuid, uuid) to nomey_writer;

-- La familia deja de ser un parametro: no hay familias.
drop function sec.assert_category_usable(uuid, text, uuid, uuid);

create function sec.assert_category_usable(
  p_category   uuid,
  p_actor      uuid,
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
  v_existe boolean;
begin
  select true, c.owner_user_id, c.is_active
    into v_existe, v_owner, v_active
    from core.category c
   where c.id = p_category;

  -- 1 · visibilidad. Mismo mensaje para inexistente y ajena.
  if v_existe is null or (v_owner is not null and v_owner is distinct from p_actor) then
    perform sec.raise_boundary('CATEGORY_NOT_USABLE',
      'esa categoria no existe o no esta disponible para el actor', 422);
  end if;

  -- 2 · baja logica, con la excepcion de conservar la que ya estaba. Sin ella,
  -- dar de baja una categoria dejaria incorregible todo lo que la usara.
  if not v_active then
    if p_supersedes is null then
      perform sec.raise_boundary('CATEGORY_NOT_USABLE',
        'esa categoria esta dada de baja y no puede asignarse', 422);
    end if;
    select x.category_id into v_previa
      from core.expense_category x where x.operation_version_id = p_supersedes;
    if v_previa is distinct from p_category then
      perform sec.raise_boundary('CATEGORY_NOT_USABLE',
        'esa categoria esta dada de baja y no puede asignarse', 422);
    end if;
  end if;
end
$fn$;

comment on function sec.assert_category_usable(uuid, uuid, uuid) is
  'La categoria existe, es del actor o de sistema, y esta activa salvo que ya estuviera puesta. Sin familia: todas son de gasto (ADR-027).';

revoke execute on function sec.assert_category_usable(uuid, uuid, uuid) from public;
grant  execute on function sec.assert_category_usable(uuid, uuid, uuid) to nomey_writer;

-- ================== 8 · el gasto: concepto Y categoria ====================

create or replace function api.record_personal_expense(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id','concept','category_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time;
  v_concept text; v_category uuid;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_time     := sec.payload_time(payload, 'effective_time', true);
  -- OBLIGATORIA. Un gasto sin categoria no existe en Nomey, y `Otros` es la
  -- categoria REAL de los que no encajan en otra.
  v_category := sec.payload_uuid(payload, 'category_id', true);
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un gasto de cero o negativo no es valido (ADR-013 §3)', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'amount',                 payload ->> 'amount',
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'concept',                v_concept,
    'category_id',            v_category::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'personal_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  v_obs := array[v_scope];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.assert_category_usable(v_category, v_actor, v_supersedes);

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_expense', v_date, v_amount, v_currency,
                              v_time);
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
          - v_amount, v_amount, null);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$fn$;

comment on function api.record_personal_expense(jsonb) is
  'Gasto personal: importe, concepto y CATEGORIA obligatoria, persistida en core.expense_category (ADR-027).';

-- ==================== 9 · el ingreso: solo concepto =======================
--
-- `category_id` desaparece del payload admitido, de la validacion, de la
-- INTENCION CANONICA y de la persistencia. Un payload que la mande ya no cae en
-- «categoria invalida»: cae en `PAYLOAD_INVALID`, porque la forma del comando
-- no la contempla — que es lo correcto: dice que ese campo no existe para esta
-- clase, en vez de que su valor este mal.
--
-- CAMBIA EL CONTRATO DE IDEMPOTENCIA, y se hace con los ojos abiertos: hasta
-- ahora un reintento con otra categoria era CONFLICTO; desde ahora no hay
-- categoria que comparar. Se acepta deliberadamente antes de que exista
-- produccion, que es el unico momento en que sale gratis (ADR-027 §9).

create or replace function api.record_personal_income(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','amount','currency_definition_id','concept'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date; v_time time;
  v_concept text;
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_time     := sec.payload_time(payload, 'effective_time', true);
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));

  if v_amount <= 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'un ingreso de cero o negativo no es valido: el signo lo pone la clase', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'amount',                 payload ->> 'amount',
    'currency_definition_id', v_currency::text,
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'concept',                v_concept);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'personal_income', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_owned_personal_scope(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  v_obs := array[v_scope];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_obs);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'personal_income', v_date, v_amount, v_currency,
                              v_time);
  -- Concepto SI, categoria NO. El ingreso no tiene ese concepto de dominio.
  perform sec.persist_movement_detail(v_version, v_concept);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     balance_amount, economic_amount, economic_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'income', v_currency,
          v_amount, v_amount, null);

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$fn$;

comment on function api.record_personal_income(jsonb) is
  'Ingreso personal: importe y concepto. SIN categoria: no es un hecho de esta clase, y su intencion canonica ya no la lleva (ADR-027).';

-- ============ 10 · la creacion de categorias personalizadas ===============
--
-- Pierde `applies_to` —no hay familias— y gana la validacion del vocabulario
-- semantico de iconos: aceptar un nombre de SF Symbol arbitrario contradiria la
-- abstraccion que acaba de introducirse. El defecto pasa de `tag` a `other`,
-- que es la clave que el catalogo ya usa para «lo que no encaja».

create or replace function api.create_custom_category(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['label','icon'];
  c_icons constant text[] := array['groceries','dining','transport','home','health',
                                   'leisure','shopping','subscriptions','travel','other','tag'];
  v_actor  uuid := sec.request_actor_id();
  v_label  text;
  v_icon   text;
  v_id     uuid := gen_random_uuid();
  v_ord    smallint;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_label := normalize(btrim(sec.payload_text(payload, 'label', true)), nfc);
  v_icon  := btrim(coalesce(sec.payload_text(payload, 'icon', false), 'other'));

  if v_label = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'el nombre de la categoria no puede quedar vacio al recortarlo', 400);
  end if;
  if v_icon = '' then v_icon := 'other'; end if;
  if not (v_icon = any(c_icons)) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'icon debe ser una clave semantica del vocabulario de Nomey', 400);
  end if;

  -- Detras de las de sistema, y en el orden en que la persona las crea.
  select coalesce(max(c.ordinal), 0) + 10 into v_ord
    from core.category c where c.owner_user_id = v_actor;
  v_ord := greatest(v_ord, 1000);

  begin
    insert into core.category (id, owner_user_id, label, icon, ordinal)
    values (v_id, v_actor, v_label, v_icon, v_ord);
  exception when unique_violation then
    perform sec.raise_boundary('CATEGORY_NAME_TAKEN',
      'ya tienes una categoria con ese nombre', 409);
  end;

  return jsonb_build_object('category_id', v_id, 'label', v_label, 'icon', v_icon);
end
$fn$;

comment on function api.create_custom_category(jsonb) is
  'Alta de categoria propia. Sin familia -todas son de gasto- y con el icono acotado al vocabulario semantico (ADR-027).';

-- ===================== 11 · las superficies de lectura ====================

create view api.category
with (security_invoker = true) as
select
  c.id,
  c.message_key,
  c.label,
  c.icon,
  c.ordinal,
  c.is_active,
  (c.owner_user_id is not null) as is_custom
from core.category c;

comment on view api.category is
  'Catalogo visible para el actor: de sistema y propias, TODAS de gasto. is_active se proyecta y no se filtra, porque el historico debe resolver tambien las dadas de baja (ADR-021, ADR-027).';

grant select on api.category to authenticated;

-- La lista. El unico cambio es de donde sale la categoria.
--
-- `category_id` NULO significa **que esta clase de operacion no admite
-- categoria** —un ingreso, un ajuste—, y jamas «gasto sin categorizar»: para un
-- `personal_expense` la fila de `core.expense_category` existe siempre, porque
-- el escritor la exige y la columna es `NOT NULL`.
create view api.personal_operation
with (security_invoker = true) as
select
  o.id                        as operation_id,
  o.operation_class,
  e.scope_id,
  e.currency_definition_id,
  sum(e.balance_amount)::text as balance_amount,
  ov.original_amount::text    as original_amount,
  ov.effective_date,
  ov.effective_time,
  md.concept,
  xc.category_id,
  ad.target_balance::text     as target_balance,
  o.current_version_id,
  ov.supersedes_version_id    as previous_version_id,
  ov.version_no,
  o.created_at                as operation_created_at
from core.current_effect e
join core.operation_version ov   on ov.id = e.operation_version_id
join core.operation o            on o.id  = ov.operation_id
join core.scope s                on s.id  = e.scope_id
left join core.movement_detail md   on md.operation_version_id = ov.id
left join core.expense_category xc  on xc.operation_version_id = ov.id
left join core.adjustment_detail ad on ad.operation_version_id = ov.id
where s.kind = 'personal'
  and s.owner_user_id = (select auth.uid())
  and o.operation_class in ('personal_expense', 'personal_income', 'adjustment')
  and ov.version_kind = 'record'
  and e.balance_amount is not null
group by o.id, o.operation_class, e.scope_id, e.currency_definition_id,
         ov.original_amount, ov.effective_date, ov.effective_time,
         md.concept, xc.category_id, ad.target_balance,
         o.current_version_id, ov.supersedes_version_id, ov.version_no,
         o.created_at;

comment on view api.personal_operation is
  'Lista y version vigente del Modo Personal, UNA FILA POR OPERACION. category_id nulo = la clase no admite categoria, NUNCA gasto sin categorizar (ADR-025, ADR-027).';
comment on column api.personal_operation.category_id is
  'Categoria del gasto. NULO en las clases que no la tienen -ingreso, ajuste-. Un personal_expense la lleva SIEMPRE.';

grant select on api.personal_operation to authenticated;

create view api.personal_operation_version
with (security_invoker = true) as
select
  po.operation_id,
  ov.id                              as operation_version_id,
  po.operation_class,
  ov.version_no,
  ov.supersedes_version_id,
  (ov.id = po.current_version_id)    as is_current,
  ov.original_amount::text           as original_amount,
  ov.original_currency_definition_id as currency_definition_id,
  ov.effective_date,
  ov.effective_time,
  md.concept,
  xc.category_id,
  ad.target_balance::text            as target_balance,
  ov.created_at                      as version_created_at
from api.personal_operation po
join core.operation_version ov      on ov.operation_id = po.operation_id
left join core.movement_detail md   on md.operation_version_id = ov.id
left join core.expense_category xc  on xc.operation_version_id = ov.id
left join core.adjustment_detail ad on ad.operation_version_id = ov.id;

comment on view api.personal_operation_version is
  'Historial: toda version de una operacion visible en api.personal_operation. Misma semantica de category_id nulo (ADR-025, ADR-027).';

grant select on api.personal_operation_version to authenticated;

-- La observacion y la estadistica se recrean SIN cambio de cuerpo: dependian de
-- `api.personal_operation` y se soltaron solo para poder recrearla.

create function api.observed_balance(p_operation_ids uuid[] default null)
returns table (
  operation_id            uuid,
  operation_version_id    uuid,
  is_current              boolean,
  scope_id                uuid,
  observed_balance_before text,
  observed_balance_after  text
)
language sql
stable
set search_path = ''
begin atomic
  select po.operation_id,
         bo.operation_version_id,
         (bo.operation_version_id = po.current_version_id),
         bo.scope_id,
         bo.balance_before::text,
         bo.balance_after::text
  from core.balance_observation bo
  join core.operation_version ov on ov.id = bo.operation_version_id
  join api.personal_operation po on po.operation_id = ov.operation_id
                                and po.scope_id     = bo.scope_id
  where p_operation_ids is null
     or po.operation_id = any(p_operation_ids);
end;

comment on function api.observed_balance(uuid[]) is
  'Observacion historica de saldo de ADR-023, por lote. ILUSTRATIVA: el Disponible sale de api.personal_balance y NUNCA de aqui (ADR-025).';

revoke execute on function api.observed_balance(uuid[]) from public;
grant  execute on function api.observed_balance(uuid[]) to authenticated;

create function api.personal_statistics(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
set search_path = ''
begin atomic
  select jsonb_build_object(
    'scope_id',               ps.id,
    'currency_definition_id', ps.base_currency_definition_id,
    'from',                   p_from,
    'to',                     p_to,

    'income_total', coalesce((
      select sum(pe.economic_amount::bigint)
        from api.personal_effect pe
       where pe.scope_id = ps.id
         and pe.accounting_class = 'income'
         and pe.economic_amount is not null
         and (p_from is null or pe.effective_date >= p_from)
         and (p_to   is null or pe.effective_date <= p_to)), 0)::text,

    'expense_total', coalesce((
      select sum(pe.economic_amount::bigint)
        from api.personal_effect pe
       where pe.scope_id = ps.id
         and pe.accounting_class = 'expense'
         and pe.economic_amount is not null
         and (p_from is null or pe.effective_date >= p_from)
         and (p_to   is null or pe.effective_date <= p_to)), 0)::text,

    -- SOLO gastos. Un ingreso no tiene categoria, asi que no puede entrar en el
    -- reparto ni por accidente: la clausula de clase y la ausencia de fila en
    -- `core.expense_category` dicen lo mismo por dos caminos.
    'categories', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'category_id',     g.category_id,
                 'expense_total',   g.total::text,
                 'operation_count', g.operations)
               order by g.total desc, g.category_id)
        from (
          select po.category_id,
                 sum(po.original_amount::bigint) as total,
                 count(*)::integer               as operations
            from api.personal_operation po
           where po.scope_id = ps.id
             and po.operation_class = 'personal_expense'
             and po.category_id is not null
             and (p_from is null or po.effective_date >= p_from)
             and (p_to   is null or po.effective_date <= p_to)
           group by po.category_id
        ) g), '[]'::jsonb)
  )
  from api.personal_scope ps;
end;

comment on function api.personal_statistics(date, date) is
  'Estadisticas del Modo Personal en un intervalo CERRADO de fechas efectivas. Derivada, nunca materializada. NULL = el actor no tiene ambito (ADR-026).';

revoke execute on function api.personal_statistics(date, date) from public;
grant  execute on function api.personal_statistics(date, date) to authenticated;
