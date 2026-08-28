-- Provisioning del Modo Personal.
--
-- Decima migracion real, y la que abre la Fase 6. Trae la TERCERA frontera de
-- privilegio del proyecto y las dos funciones que crean y configuran el ambito
-- Personal, mas las dos lecturas minimas que el cliente necesita para usarlo.
--
--   api.ensure_personal_scope        crea el ambito y su membresia. Idempotente
--   api.set_personal_base_currency   cambia la moneda MIENTRAS el ambito nunca
--                                    haya tenido un efecto
--   api.personal_scope               vista: el ambito del actor y su moneda
--   api.currency_definition          vista: el catalogo, para el selector
--
-- ADR-019. Evidencia medida: `supabase/e21/`.
--
-- ===================== POR QUE UN TERCER ROL Y NO UNO DE LOS DOS ============
--
-- Los dos owners que ya existen estan ocupados, y por razones opuestas:
--
--   nomey_writer  escribe contabilidad DEBAJO de la RLS. Su unica relacion con
--                 `core.scope` es `GRANT UPDATE (base_currency_definition_id)`
--                 con policy `USING (true) WITH CHECK (false)`: puede BLOQUEAR
--                 la fila para el protocolo de deuda y no puede escribirla.
--                 Ensanchar eso degradaria una barrera medida para las SIETE
--                 funciones contables, no solo para el provisioning.
--
--   postgres      es owner de `api.claimed_dimension()` porque una lectura de
--                 reclamacion debe ATRAVESAR la RLS. Poner ahi una ESCRITURA
--                 seria exactamente lo contrario, y PROJECT_STATE lo dice sin
--                 matices: nunca unificar los dos.
--
-- `nomey_provisioner` es el mismo modelo aplicado a una tercera frontera:
-- NOLOGIN, NOBYPASSRLS, no propietario de tablas, y con el privilegio minimo de
-- SU trabajo. El escritor contable sigue sin poder crear un ambito, y el
-- provisioner no puede escribir ni un solo hecho contable.
--
-- ============================ LA BARRERA VA POR ACTOR ======================
--
-- E21 midio que `sec.request_actor_id()` SI funciona dentro de un definer de un
-- rol asi —lo que impedia a `nomey_writer` usar `auth.uid()` era PRIVILEGIO, no
-- semantica— y, lo que importa, que tambien funciona DENTRO DE UNA POLICY
-- evaluada durante esa funcion.
--
-- Por eso las policies no se quedan en `kind = 'personal'`: se acotan al actor.
-- Un fallo del definer NO puede alcanzar el Modo Personal de otra persona, y lo
-- impide la base de datos y no el codigo. Medido: crear la membresia de otro
-- usuario, o una membresia en un ambito ajeno, se rechazan las dos con 42501.
--
-- E21 midio ademas el precio de esa forma, y hay que tenerlo presente al leer
-- las policies de abajo: **el `WITH CHECK` de `core.membership` consulta
-- `core.scope`, y esa subconsulta esta sujeta a la RLS del propio provisioner.**
-- Sin su policy de SELECT sobre `core.scope`, la insercion LEGITIMA se rechaza.
-- Falla cerrado, que es la direccion segura, pero las dos policies se disenan
-- juntas: quitar la de lectura no endurece nada, rompe el provisioning.

-- ================================ 1 · el rol ===============================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nomey_provisioner') then
    create role nomey_provisioner nologin nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
end
$$;

comment on role nomey_provisioner is
  'Owner de las funciones de provisioning del Modo Personal. NOLOGIN, NOBYPASSRLS y no propietario de tablas: la RLS se le aplica igual (ADR-019).';

-- Necesario para poder cederle la propiedad de las funciones: `ALTER FUNCTION
-- ... OWNER TO` exige ser miembro del rol destino.
grant nomey_provisioner to postgres;

-- ============================== 2 · privilegios ============================
-- Cada grant corresponde a una ruta concreta de una de las dos funciones. No
-- hay ninguno "por si acaso", y en particular:
--
--   · SIN insert/update/delete sobre nada contable —operacion, version, efecto,
--     comando, reparto—. El provisioning no es un hecho contable.
--   · SIN select sobre `core.membership`: no le hace falta. La idempotencia se
--     resuelve leyendo `core.scope`, y en la carrera la resuelve el indice
--     unico `scope_un_personal_por_usuario`.
--   · SIN delete sobre nada.

grant usage on schema core to nomey_provisioner;
grant usage on schema sec  to nomey_provisioner;

-- E21/A: sin este EXECUTE, el helper falla con 42501 dentro del definer. Es el
-- mismo grant que tiene el writer, y por el mismo motivo.
grant execute on function sec.request_actor_id()                  to nomey_provisioner;
grant execute on function sec.raise_boundary(text, text, integer) to nomey_provisioner;
grant execute on function sec.assert_payload_shape(jsonb, text[]) to nomey_provisioner;
grant execute on function sec.payload_uuid(jsonb, text, boolean)  to nomey_provisioner;

grant select on core.scope               to nomey_provisioner;
grant select on core.effect              to nomey_provisioner;
grant select on core.currency_definition to nomey_provisioner;

grant insert on core.scope      to nomey_provisioner;
grant insert on core.membership to nomey_provisioner;

-- Solo la columna de moneda, y solo esa. Concede ademas el `SELECT ... FOR
-- UPDATE` con el que se serializa el cambio.
grant update (base_currency_definition_id) on core.scope to nomey_provisioner;

-- ============================== 3 · policies ===============================
-- Las cinco se acotan al actor salvo la del catalogo, que es publico por
-- naturaleza. NINGUNA aplica a PUBLIC.
--
-- Las tres de SELECT no son comodidad: E21 midio tres veces el mismo modo de
-- fallo —privilegio concedido y policy ausente devuelve CERO FILAS SIN ERROR—.
-- Sobre `core.effect` ese fallo declararia VACIO un ambito ocupado; sobre
-- `core.currency_definition` haria irresoluble cualquier moneda; sobre
-- `core.scope` rompe el `WITH CHECK` de la membresia.

create policy scope_provisioner_select on core.scope
  for select to nomey_provisioner
  using (kind = 'personal' and owner_user_id = sec.request_actor_id());

create policy scope_provisioner_insert on core.scope
  for insert to nomey_provisioner
  with check (kind = 'personal' and owner_user_id = sec.request_actor_id());

-- El cambio de moneda. `USING` decide que fila es alcanzable y `WITH CHECK` que
-- la fila resultante lo siga siendo: sin la segunda, un `UPDATE` podria mover la
-- fila fuera del alcance del actor.
--
-- Esta policy NO codifica la condicion de "ambito vacio", y es deliberado: esa
-- regla la posee la FK compuesta `effect_moneda_del_ambito`, y dos sitios para
-- la misma regla son dos sitios donde puede decir cosas distintas.
create policy scope_provisioner_currency on core.scope
  for update to nomey_provisioner
  using      (kind = 'personal' and owner_user_id = sec.request_actor_id())
  with check (kind = 'personal' and owner_user_id = sec.request_actor_id());

-- La membresia del ACTOR en un ambito personal DEL ACTOR. Las dos mitades hacen
-- falta: sin la primera se podria dar de alta a otro; sin la segunda, a uno
-- mismo en el ambito de otro. E21/C midio las dos negativas.
create policy membership_provisioner_insert on core.membership
  for insert to nomey_provisioner
  with check (
    user_id = sec.request_actor_id()
    and exists (
      select 1 from core.scope s
      where s.id = membership.scope_id
        and s.kind = 'personal'
        and s.owner_user_id = sec.request_actor_id()
    )
  );

-- Solo los efectos del ambito personal DEL ACTOR. Es todo lo que la
-- comprobacion de vacio necesita mirar.
create policy effect_provisioner_select on core.effect
  for select to nomey_provisioner
  using (
    exists (
      select 1 from core.scope s
      where s.id = effect.scope_id
        and s.kind = 'personal'
        and s.owner_user_id = sec.request_actor_id()
    )
  );

-- El catalogo monetario es publico para cualquiera que pueda leerlo: no dice
-- nada de nadie.
create policy currency_definition_provisioner_select on core.currency_definition
  for select to nomey_provisioner
  using (true);

-- ======================= 4 · lectura estricta de texto =====================
-- El unico helper nuevo. `sec.payload_text` completa la familia existente para
-- el codigo ISO recomendado, que es lo unico textual del contrato de F6.A.

create function sec.payload_text(p_payload jsonb, p_key text, p_required boolean)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw jsonb := p_payload -> p_key;
begin
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    if p_required then
      perform sec.raise_boundary('PAYLOAD_INVALID', format('falta el campo %s', p_key), 400);
    end if;
    return null;
  end if;
  if jsonb_typeof(v_raw) <> 'string' then
    perform sec.raise_boundary('PAYLOAD_INVALID', format('%s debe ser un string JSON', p_key), 400);
  end if;
  return p_payload ->> p_key;
end
$fn$;

comment on function sec.payload_text(jsonb, text, boolean) is
  'Lectura estricta de un campo textual del payload. Exige string JSON, como el resto de la familia (ADR-008 §3).';

revoke execute on function sec.payload_text(jsonb, text, boolean) from public;
grant  execute on function sec.payload_text(jsonb, text, boolean) to nomey_provisioner;

-- ================== 5 · resolucion de la moneda recomendada ================
--
-- La Region del dispositivo produce un CODIGO ISO, y el codigo NO es la
-- identidad (ADR-004). Esta funcion lo resuelve a una definicion real, y su
-- forma esta gobernada por esa distincion:
--
--   1 coincidencia   -> esa definicion
--   0 coincidencias  -> EUR, como FALLBACK inicial
--   >1 coincidencias -> se niega, porque ADR-004 dice expresamente que dos
--                       definiciones pueden compartir codigo y F6 no tiene
--                       regla para elegir entre ellas. Hoy no puede ocurrir
--                       —el catalogo sembrado tiene codigos unicos y un check
--                       lo comprueba— y quien introduzca la segunda debera
--                       decidir la regla, no heredar una eleccion silenciosa.
--
-- EL FALLBACK NO CONVIERTE A EUR EN NADA. No es moneda universal del producto ni
-- regla contable: es el valor inicial cuando la moneda regional todavia no forma
-- parte del catalogo soportado, y el usuario puede cambiarlo mientras su ambito
-- este vacio. Se resuelve POR CODIGO contra el catalogo y no como UUID literal,
-- de modo que si EUR desapareciera del catalogo esto fallaria a gritos en vez de
-- apuntar a una fila inexistente.

create function sec.resolve_recommended_currency(p_code text)
returns uuid
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_n    integer;
  v_id   uuid;
begin
  if v_code <> '' then
    select count(*) into v_n from core.currency_definition c where c.code = v_code;

    if v_n > 1 then
      perform sec.raise_boundary('CURRENCY_CODE_AMBIGUOUS',
        format('el catalogo tiene mas de una definicion para %s y no hay regla de seleccion (ADR-004)', v_code), 422);
    end if;

    if v_n = 1 then
      select c.id into v_id from core.currency_definition c where c.code = v_code;
      return v_id;
    end if;
  end if;

  select c.id into v_id from core.currency_definition c where c.code = 'EUR';
  if v_id is null then
    perform sec.raise_boundary('CURRENCY_NOT_SUPPORTED',
      'el catalogo monetario no contiene el fallback EUR', 422);
  end if;
  return v_id;
end
$fn$;

comment on function sec.resolve_recommended_currency(text) is
  'Resuelve un codigo ISO recomendado por la Region a una definicion monetaria real. Fallback EUR; ambiguedad rechazada (ADR-004, ADR-019).';

revoke execute on function sec.resolve_recommended_currency(text) from public;
grant  execute on function sec.resolve_recommended_currency(text) to nomey_provisioner;

-- ============================ 6 · crear el ambito ==========================
--
-- IDEMPOTENTE POR ESTADO, y expresamente FUERA de `core.client_command`:
-- ADR-011 §5 define esa relacion como la unidad de idempotencia del COMANDO
-- CONTABLE de origen cliente, y esto no crea ninguna operacion. Meterlo alli
-- obligaria ademas a inventarle un `command_type` para algo que no lo es.
--
-- Las DOS filas, en la MISMA transaccion. Es el invariante 11 y la migracion de
-- la proyeccion canonica ya lo dejo escrito como pendiente de la frontera:
-- «el dueno de un Modo Personal es TAMBIEN miembro de el; y es su UNICO miembro;
-- propiedad y membresia se crean en la MISMA transaccion». Sin la membresia, la
-- RLS de lectura no reconoce al dueno y no ve ni sus propios efectos.
--
-- NO crea participante, y no es un olvido. Los efectos personales llevan
-- participante LEGITIMAMENTE NULO (ADR-013 §8) y `api.personal_effect` atribuye
-- por PROPIEDAD, no por vinculo. Crear uno especulativo inventaria una identidad
-- contextual que nadie ha reclamado, en contra de ADR-012 §1. Si F10 lo
-- necesita, anadirlo es aditivo.

create function api.ensure_personal_scope(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['currency_code'];
  v_actor    uuid;
  v_scope    uuid;
  v_currency uuid;
  v_created  boolean := false;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor := sec.request_actor_id();

  -- Ya existe: se devuelve tal cual y NO se toca la moneda. Es lo que permite
  -- invocarla en cada arranque sin deshacer una eleccion del usuario.
  select s.id, s.base_currency_definition_id into v_scope, v_currency
    from core.scope s
   where s.owner_user_id = v_actor and s.kind = 'personal';

  if v_scope is null then
    v_currency := sec.resolve_recommended_currency(
                    sec.payload_text(payload, 'currency_code', false));
    v_scope    := gen_random_uuid();

    begin
      insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
      values (v_scope, 'personal', v_currency, v_actor);
      v_created := true;
    exception when unique_violation then
      -- Carrera: otra sesion creo el ambito primero. `scope_un_personal_por_
      -- usuario` la resuelve, y esta es la UNICA excepcion capturada en todo el
      -- camino: cualquier otra convertiria un fallo en escritura parcial.
      select s.id, s.base_currency_definition_id into v_scope, v_currency
        from core.scope s
       where s.owner_user_id = v_actor and s.kind = 'personal';
      v_created := false;
    end;

    if v_created then
      insert into core.membership (scope_id, user_id) values (v_scope, v_actor);
    end if;
  end if;

  if v_scope is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no se pudo resolver el ambito personal', 403);
  end if;

  return (
    select jsonb_build_object(
      'scope_id',                     v_scope,
      'base_currency_definition_id',  c.id,
      'currency_code',                c.code,
      'currency_scale',               c.scale,
      'created',                      v_created)
    from core.currency_definition c where c.id = v_currency
  );
end
$fn$;

-- =========================== 7 · cambiar la moneda =========================
--
-- Solo mientras el ambito NUNCA haya tenido un efecto. El invariante 12 dice
-- «inmutable TRAS SU PRIMERA OPERACION» y es agnostico del tipo de ambito;
-- `data-model.md` §10 ya lo ilustraba con el creador de un Grupo. Esto lo
-- extiende al Modo Personal y NO relaja nada.
--
-- Tres barreras, y solo una es la autoridad:
--
--   1  el bloqueo de la fila, que serializa contra la primera escritura;
--   2  la comprobacion de vacio, que existe para FALLAR BIEN —codigo propio y
--      409— y no para hacer cumplir la regla;
--   3  la FK compuesta `effect_moneda_del_ambito`, que es la que de verdad la
--      hace cumplir. E21/D3 lo midio: con un efecto existente PostgreSQL
--      rechaza el UPDATE con 23503 ejecute el codigo lo que ejecute.
--
-- Se mira `core.effect` y NO `core.current_effect`: un movimiento creado y
-- despues ANULADO deja la proyeccion vigente vacia y la tabla no, y sus efectos
-- historicos siguen en la moneda vieja.
--
-- NO TOCA NADA DE FX. No resuelve tipos, no escribe `core.frozen_conversion` y
-- no altera `sec.assert_no_conversion`: una operacion en moneda distinta de la
-- base sigue devolviendo CURRENCY_CONVERSION_UNSUPPORTED. Aqui no hay nada que
-- convertir porque no hay ningun hecho. F6 implementa ELEGIR; F11 implementara
-- CAMBIAR, que es otro problema porque tiene historia.

create function api.set_personal_base_currency(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['currency_definition_id'];
  v_actor   uuid;
  v_target  uuid;
  v_scope   uuid;
  v_current uuid;
  v_changed boolean := false;
  v_n       integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor  := sec.request_actor_id();
  v_target := sec.payload_uuid(payload, 'currency_definition_id', true);

  if not exists (select 1 from core.currency_definition c where c.id = v_target) then
    perform sec.raise_boundary('CURRENCY_NOT_SUPPORTED',
      'esa definicion monetaria no esta en el catalogo soportado', 422);
  end if;

  -- El ambito se RESUELVE por el actor; no se acepta ni `scope_id` ni `user_id`.
  -- No hay identidad ajena que pasarle y nada que enumerar.
  select s.id, s.base_currency_definition_id into v_scope, v_current
    from core.scope s
   where s.owner_user_id = v_actor and s.kind = 'personal'
   for update;

  if v_scope is null then
    -- El mismo error para «no existe» y «no es tuyo», como el resto de la
    -- frontera: distinguirlos convertiria la funcion en un oraculo.
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no hay un Modo Personal alcanzable para el actor', 403);
  end if;

  if v_current = v_target then
    v_changed := false;
  else
    if exists (select 1 from core.effect e where e.scope_id = v_scope) then
      perform sec.raise_boundary('BASE_CURRENCY_LOCKED',
        'el ambito ya tiene movimientos: cambiar la moneda base exige conversion, que todavia no esta disponible', 409);
    end if;

    update core.scope set base_currency_definition_id = v_target where id = v_scope;
    get diagnostics v_n = row_count;

    -- E21/D2: un UPDATE cuya policy USING no casa devuelve CERO FILAS SIN
    -- ERROR. Sin esta comprobacion, un cambio que no ocurrio se reportaria como
    -- exito.
    if v_n <> 1 then
      perform sec.raise_boundary('NOT_AUTHORIZED', 'el ambito no es alcanzable para el actor', 403);
    end if;
    v_changed := true;
  end if;

  return (
    select jsonb_build_object(
      'scope_id',                    v_scope,
      'base_currency_definition_id', c.id,
      'currency_code',               c.code,
      'currency_scale',              c.scale,
      'changed',                     v_changed)
    from core.currency_definition c where c.id = v_target
  );
end
$fn$;

-- ========================= 8 · propiedad y privilegios =====================
-- Misma mecanica que el writer, y con el mismo cuidado: ceder la propiedad
-- exige CREATE sobre el schema y PIERDE LOS GRANT EXPLICITOS, asi que los
-- grants van DESPUES.

grant create on schema api to nomey_provisioner;

alter function api.ensure_personal_scope(jsonb)      owner to nomey_provisioner;
alter function api.set_personal_base_currency(jsonb) owner to nomey_provisioner;

revoke create on schema api from nomey_provisioner;

-- E12 midio que sin el revoke explicito la funcion es invocable por `anon`.
revoke execute on function api.ensure_personal_scope(jsonb)      from public;
revoke execute on function api.set_personal_base_currency(jsonb) from public;

grant execute on function api.ensure_personal_scope(jsonb)      to authenticated;
grant execute on function api.set_personal_base_currency(jsonb) to authenticated;

comment on function api.ensure_personal_scope(jsonb) is
  'Crea el Modo Personal del actor con su membresia, o lo devuelve si ya existe. Idempotente por estado (ADR-019).';
comment on function api.set_personal_base_currency(jsonb) is
  'Cambia la moneda base del Modo Personal del actor MIENTRAS no haya tenido ningun efecto. La FK compuesta es la autoridad (ADR-019).';

-- ============================== 9 · lectura minima =========================
-- Las dos vistas que F6.A necesita, y ninguna mas. `security_invoker`, porque
-- E19 midio que sin el la cadena pierde la RLS y sigue devolviendo cifras
-- creibles.

create view api.currency_definition
with (security_invoker = true) as
select c.id, c.code, c.scale
from core.currency_definition c;

comment on view api.currency_definition is
  'Catalogo de definiciones monetarias soportadas. `scale` sale como numero: es metadato de la definicion, no un importe (ADR-008 §1 alcanza a los valores monetarios).';

grant select on api.currency_definition to authenticated;

-- El ambito del actor. `owner_user_id` NO se proyecta, igual que en
-- `api.personal_effect`: es identidad, y el cliente no la necesita para leer lo
-- suyo.
--
-- ================== POR QUE NO LLEVA UN `is_currency_locked` ===============
--
-- La primera version de esta vista tenia una columna orientativa que decia si la
-- moneda seguia siendo cambiable, resuelta con
-- `exists (select 1 from core.effect e where e.scope_id = s.id)`.
--
-- **La guarda de catalogo de ADR-013 §9 la rechazo, y con razon.** Esa clausula
-- hace que la vista dependa DIRECTAMENTE de `core.effect`, y la unica relacion
-- autorizada a hacerlo es la proyeccion canonica `core.current_effect`. Los
-- checks `canonical-attribution.sql` A3 y `authoritative-writer-debt.sql` I1 la
-- detectaron en cuanto se ejecutaron.
--
-- Y no se arregla leyendo `core.current_effect` en su lugar: seria INCORRECTO.
-- Lo que bloquea la moneda es haber tenido ALGUN efecto alguna vez, incluidos
-- los de versiones superadas —un movimiento creado y luego anulado deja la
-- proyeccion vigente vacia y sus efectos historicos en la moneda vieja—. Son
-- dos preguntas distintas y la guarda solo conoce una.
--
-- Asi que la columna se retira. Nadie la consume: F6.A no construye pantallas, y
-- la autoridad es `api.set_personal_base_currency`, que revalida bajo bloqueo y
-- devuelve 409. Exponer «¿queda alguna huella contable en este ambito?» como
-- superficie de lectura es una decision propia —o una excepcion nombrada a la
-- guarda, o una funcion con su justificacion— y pertenece a la superficie de
-- lectura de F6.D, no a este bloque.
create view api.personal_scope
with (security_invoker = true) as
select
  s.id,
  s.base_currency_definition_id,
  c.code  as currency_code,
  c.scale as currency_scale
from core.scope s
join core.currency_definition c on c.id = s.base_currency_definition_id
where s.kind = 'personal'
  and s.owner_user_id = (select auth.uid());

comment on view api.personal_scope is
  'El Modo Personal del actor y su moneda base. Si la moneda sigue siendo cambiable lo decide api.set_personal_base_currency bajo bloqueo, no una columna (ADR-019).';

grant select on api.personal_scope to authenticated;
