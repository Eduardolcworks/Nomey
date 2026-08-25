-- Ambito, participante, membresia y efecto.
--
-- Tercera migracion real. Cierra el conjunto minimo que `core.effect` necesita
-- para existir con integridad y con RLS: el ambito al que pertenece cada
-- efecto, el participante contextual al que apuntan sus dimensiones, y la
-- membresia usuario-ambito de la que depende la lectura del cliente.
--
-- Las cuatro relaciones son un bloque, no un apendice: sin `core.scope` y
-- `core.participant` las claves foraneas normativas del efecto no se pueden
-- escribir (ADR-012 §3), y sin la membresia no hay predicado de lectura
-- (ADR-013 §10).
--
-- NO crea `core.participant_period` ni `core.participant_user_link`, y por
-- tanto tampoco `btree_gist`. Ninguna de las dos participa en la integridad de
-- `core.effect`: la elegibilidad historica de ADR-012 §7 es una validacion de
-- la frontera autoritativa, no una restriccion del efecto. Siguen dentro de la
-- Fase 3.C, en el bloque inmediatamente posterior.
--
-- Fuentes:
--   ADR-002 §2, §8 · los tres ambitos y la moneda base inmutable
--   ADR-006 §3     · grants del rol cliente
--   ADR-007        · helper de membresia y RLS
--   ADR-009 §5     · atributos del writer
--   ADR-011 §14    · inmutabilidad: sin UPDATE ni DELETE sobre efectos
--   ADR-011 §15    · ninguna policy de `core` aplicable a PUBLIC
--   ADR-012 §1, §3 · participante contextual por ambito
--   ADR-013 §8     · cabecera del efecto y tres dimensiones independientes
--   ADR-013 §10    · RLS de lectura del cliente y policies del writer

-- ============================================================== ambito ======
-- ADR-002 §2: tres ambitos conceptualmente distintos. Lo que esta tabla
-- representa es el ambito COMO ANCLA CONTABLE Y DE AUTORIZACION, no el producto
-- Grupo ni el producto Modo Pareja: sus atributos propios —nombre visible,
-- estado de cierre— llegan en sus fases, por migracion, tal como fija el
-- roadmap.
--
-- Sin `created_by`: el creador no participa en la autorizacion, ni en la
-- propiedad, ni en la moneda, ni en los efectos, ni en la identidad del ambito.
-- Anadirlo crearia una segunda semantica implicita de "dueno" que el modelo no
-- necesita y que la membresia no expresa.

create table core.scope (
  id                          uuid        primary key,
  kind                        text        not null,
  base_currency_definition_id uuid        not null
                                references core.currency_definition (id),
  created_at                  timestamptz not null default now(),

  -- Vocabulario cerrado, a diferencia de `operation.operation_class`. La
  -- diferencia no es de estilo: ADR-002 §2 fija TRES ambitos como invariante de
  -- producto, mientras que ADR-013 §2 dice expresamente que no se prejuzga que
  -- clases de operacion existiran. Un cuarto tipo de ambito exige una migracion
  -- deliberada, que es justo lo que este check obliga.
  constraint scope_kind_valida check (kind in ('personal', 'group', 'couple')),

  -- Destino de la clave foranea compuesta de `core.effect`. Redundante como
  -- restriccion —`id` ya es clave— y necesaria como destino. Mismo patron que
  -- `operation_version_op_id_unico`.
  constraint scope_id_moneda_unico unique (id, base_currency_definition_id)
);

comment on table core.scope is
  'Ambito financiero: ancla contable y de autorizacion de los efectos (ADR-002 §2). Los atributos de Grupo y Modo Pareja llegan en sus fases.';
comment on column core.scope.kind is
  'personal | group | couple. Vocabulario cerrado por ADR-002 §2; un cuarto tipo exige migracion deliberada.';
comment on column core.scope.base_currency_definition_id is
  'Moneda base del ambito. Inmutable tras la primera operacion (ADR-002 §8, invariante 12); lo hace cumplir la FK compuesta de core.effect.';

-- ========================================================= participante =====
-- ADR-012 §1: el participante es CONTEXTUAL POR AMBITO, no global, y su
-- identidad es opaca y estable. Puede existir sin cuenta desde que alguien lo
-- anade, y participantes de ambitos distintos NUNCA se correlacionan
-- automaticamente.
--
-- Por eso aqui no hay email, ni telefono, ni alias correlacionable: la forma
-- mas segura de no correlacionar lo que ADR-012 §1 prohibe correlacionar es no
-- almacenar el material con el que se correlacionaria. `display_name` es dato
-- de presentacion DE ESE AMBITO, y no constituye identidad.
--
-- Sin `joined_at` ni `left_at`: es la alternativa E de ADR-012, descartada
-- expresamente porque solo admite un periodo y romperia entrar -> salir ->
-- volver. La temporalidad vive en `core.participant_period`, que llega en el
-- bloque siguiente.

create table core.participant (
  id           uuid        primary key,
  scope_id     uuid        not null references core.scope (id),
  display_name text        not null,
  created_at   timestamptz not null default now(),

  constraint participant_display_name_no_vacio check (display_name <> ''),

  -- Destino de las FK compuestas de `core.effect` y del futuro
  -- `core.participant_user_link` (ADR-012 §6).
  constraint participant_id_scope_unico unique (id, scope_id)
);

comment on table core.participant is
  'Sujeto economico contextual a un ambito. Puede existir sin cuenta (ADR-012 §1). Los efectos apuntan SIEMPRE aqui, nunca a un usuario (ADR-012 §3).';
comment on column core.participant.display_name is
  'Dato de presentacion del ambito. NO es identidad y no correlaciona participantes de ambitos distintos (ADR-012 §1).';

-- ============================================================ membresia =====
-- ADR-012 §4: participante, periodo de presencia y membresia de usuario son
-- TRES relaciones distintas. Esta responde solo a "que puede ver o hacer AHORA
-- una cuenta autenticada".
--
-- SEMANTICA DE PRESENCIA PURA: la fila existe <=> la membresia esta activa
-- ahora. NO es un historial de membresias, y no debe reinterpretarse como tal.
-- Si en el futuro hiciera falta historial, se modela conscientemente en su
-- propia relacion; anadir aqui un `until` en silencio cambiaria el significado
-- de todas las filas ya escritas.
--
-- Sin columna de rol: ningun ADR fija roles dentro de un ambito, y la migracion
-- no inventa semantica que ningun ADR haya fijado.
--
-- `user_id` no lleva FK a `auth.users` a proposito, por el mismo motivo que
-- `operation.created_by`: obligaria a decidir aqui el comportamiento ante el
-- borrado de una cuenta, y la retencion y la purga estan expresamente abiertas.
-- No abre acceso: sin cuenta no hay JWT, asi que una fila huerfana no es una
-- sesion.

create table core.membership (
  scope_id   uuid        not null references core.scope (id),
  user_id    uuid        not null,
  created_at timestamptz not null default now(),

  -- Es tambien el indice exacto del helper: (scope_id, user_id) en ese orden.
  constraint membership_pk primary key (scope_id, user_id)
);

comment on table core.membership is
  'Autorizacion ACTUAL de una cuenta sobre un ambito. Presencia pura: la fila existe = membresia activa. NO es historial (ADR-012 §4).';

-- ================================================ helper de membresia =======
-- ADR-007 §2. Helper REDUCIDO: acepta el ambito, deriva el usuario de
-- `auth.uid()` internamente y devuelve solo la decision minima.
--
-- Que NO acepte un `user_id` arbitrario no es cosmetica: `is_member(scope, user)`
-- seria un oraculo de pertenencia gratuito para cualquiera que pudiera
-- invocarlo.
--
-- Rompe la recursion que ADR-007 describe: una policy sobre `core.effect`
-- necesita saber si el actor pertenece al ambito, y consultar la tabla de
-- membresia con una policy que a su vez mire "los ambitos a los que pertenezco"
-- fallaria con 42P17.
--
-- `BEGIN ATOMIC` en vez de cuerpo textual: E19 midio que solo esa forma deja
-- dependencias analizables en el catalogo. La ganancia aqui es concreta —
-- `core.membership` no puede caer sin CASCADE mientras el helper la use— y se
-- comprobo contra el stack real, no se adopto por estetica.
--
-- `search_path = ''` y no `= core`: el `extra_search_path` de la Data API
-- incluye `public` siempre (ADR-007 §2).

create function sec.is_member(p_scope_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
begin atomic
  select exists (
    select 1
    from core.membership m
    where m.scope_id = p_scope_id
      -- InitPlan evaluado una vez por consulta, no una vez por fila.
      and m.user_id  = (select auth.uid())
  );
end;

comment on function sec.is_member(uuid) is
  'Decide si el actor de la peticion es miembro ACTUAL del ambito dado. Helper reducido de ADR-007 §2: nunca acepta identidad ajena.';

-- ADR-006 §4, segunda capa: revoke explicito ademas del default global.
revoke execute on function sec.is_member(uuid) from public;

-- ADR-007 §3: EXECUTE al rol cliente, y NINGUN `USAGE` sobre `sec`. E13 midio
-- que la policy almacenada si puede usar el helper mientras el usuario NO puede
-- invocarlo por nombre. Se obtiene la funcion sin regalar el oraculo.
grant execute on function sec.is_member(uuid) to authenticated;

-- No se concede a `nomey_writer`: E16 midio que `auth.uid()` no es invocable
-- por el writer, asi que el helper no le serviria. El writer resuelve la
-- membresia leyendo la tabla con `sec.request_actor_id()`.

-- =============================================================== efecto =====
-- ADR-013 §8: cabecera —ambito, clase contable, definicion monetaria y version—
-- mas TRES DIMENSIONES INDEPENDIENTES.
--
-- Una unica columna comun de importe NO representa un efecto: un gasto personal
-- produce saldo -20,00 y economica +20,00 en la MISMA fila. Con una sola
-- columna eso solo se expresa mediante una convencion de signo por clase que el
-- lector tiene que recordar, y las convenciones que hay que recordar son el
-- modo de fallo contra el que existe este modelo.
--
-- Sin `operation_id`: la ruta normalizada es efecto -> version -> operacion, y
-- una redundancia que solo ahorra un join es una optimizacion sin evidencia
-- (ADR-013 §8).
--
-- Sin `user_id`: los efectos apuntan al participante contextual (ADR-012 §3).
-- El riesgo de que alguien use el usuario "porque es mas comodo" se mitiga
-- estructuralmente: no hay donde.

create table core.effect (
  id                     uuid   primary key,
  operation_version_id   uuid   not null references core.operation_version (id),
  scope_id               uuid   not null references core.scope (id),
  accounting_class       text   not null,
  currency_definition_id uuid   not null,

  -- Dimension SALDO. Sin identidad propia: el ambito es el del efecto.
  balance_amount               bigint,

  -- Dimension ECONOMICA. El participante es LEGITIMAMENTE NULO: el Modo
  -- Personal no nomina participante, asi que la presencia de la dimension NO se
  -- infiere del participante sino del importe.
  economic_amount              bigint,
  economic_participant_id      uuid,

  -- Dimension DEUDA. Importe con signo, deudor y acreedor: todos o ninguno.
  debt_amount                  bigint,
  debt_debtor_participant_id   uuid,
  debt_creditor_participant_id uuid,

  constraint effect_clase_no_vacia check (accounting_class <> ''),

  -- ADR-013 §8: el importe determina la presencia de cada dimension, y al menos
  -- una debe existir.
  constraint effect_alguna_dimension
    check (num_nonnulls(balance_amount, economic_amount, debt_amount) >= 1),

  -- Participante economico nulo es valido; participante sin importe no lo es.
  constraint effect_participante_exige_importe
    check (economic_participant_id is null or economic_amount is not null),

  -- La dimension de deuda es todo o nada.
  constraint effect_deuda_todo_o_nada
    check (num_nonnulls(debt_amount,
                        debt_debtor_participant_id,
                        debt_creditor_participant_id) in (0, 3)),

  -- `debtor <> creditor`, que el dominio ya exige. Se condiciona a que la
  -- dimension exista: `NULL is distinct from NULL` es FALSE, de modo que la
  -- forma incondicional rechazaria todo efecto SIN deuda, que es la mayoria.
  constraint effect_deuda_partes_distintas
    check (debt_amount is null
           or debt_debtor_participant_id <> debt_creditor_participant_id),

  -- NO hay ningun `<> 0`: ADR-013 §8 no prohibe globalmente los importes cero y
  -- exige CONSERVAR los ceros economicos resueltos por indivisibilidad.

  -- El efecto esta resuelto en la MONEDA BASE de su ambito (ADR-002 §8,
  -- invariante 12). La FK compuesta hace dos cosas a la vez: impide un efecto
  -- en otra moneda, e impide cambiar la moneda base del ambito mientras existan
  -- efectos, que es la inmutabilidad "tras la primera operacion".
  --
  -- No lleva ademas FK directa a `core.currency_definition`: seria redundante,
  -- porque `core.scope.base_currency_definition_id` ya la tiene.
  constraint effect_moneda_del_ambito
    foreign key (scope_id, currency_definition_id)
    references core.scope (id, base_currency_definition_id),

  -- Los tres participantes nombrados pertenecen al ambito DEL EFECTO. Es lo que
  -- hace estructural que el participante sea contextual (ADR-012 §1): un
  -- identificador contextual en una fila que no declara su contexto invita a
  -- leerlo, compararlo o indexarlo fuera de el.
  --
  -- MATCH SIMPLE (por defecto) es justo lo que se quiere: con el participante
  -- nulo la comprobacion no se hace, que es la semantica del participante
  -- economico legitimamente nulo.
  constraint effect_participante_del_ambito
    foreign key (economic_participant_id, scope_id)
    references core.participant (id, scope_id),

  constraint effect_deudor_del_ambito
    foreign key (debt_debtor_participant_id, scope_id)
    references core.participant (id, scope_id),

  constraint effect_acreedor_del_ambito
    foreign key (debt_creditor_participant_id, scope_id)
    references core.participant (id, scope_id)
);

comment on table core.effect is
  'Hecho contable de una version, con tres dimensiones independientes. Los historicos permanecen; solo los de la version vigente cuentan (ADR-011 §3, ADR-013 §8).';
comment on column core.effect.currency_definition_id is
  'Moneda base del ambito, garantizada por FK compuesta. Los importes son enteros exactos en unidad minima y nunca cruzan JSON como numero (ADR-003 §1, ADR-008).';
comment on column core.effect.economic_participant_id is
  'Participante contextual. NULO es valido: el Modo Personal no nomina participante (ADR-013 §8).';

-- Sin indices de rendimiento. El handoff separa los indices de correccion y de
-- unicidad —que si estan— de los de rendimiento puro, que quedan APLAZADOS
-- HASTA MEDIR. Las policies de lectura de `operation` y `operation_version`
-- recorren `core.effect`; si eso resulta caro, se mide y se anade entonces.

-- =========================================================== grants =========
-- ADR-006 §3. El rol cliente recibe SELECT sobre las tablas concretas que
-- necesitan las vistas de `api`, y NADA mas. Sin `USAGE` sobre `core`: E13
-- midio que no hace falta para el camino de vistas `security_invoker`.
--
-- `core.membership` NO entra: ADR-007 §4 midio que usando el helper el rol
-- cliente no necesita leerla, y no concedersela reduce el privilegio necesario.
-- `core.client_command` tampoco: el cliente no lee su propia canonicalizacion.

grant select on core.scope               to authenticated;
grant select on core.participant         to authenticated;
grant select on core.effect              to authenticated;
grant select on core.operation           to authenticated;
grant select on core.operation_version   to authenticated;
grant select on core.currency_definition to authenticated;

-- El writer necesita contexto completo para validar y para derivar, no solo sus
-- propias filas. La razon concreta esta en cada policy de mas abajo.
grant select on core.scope       to nomey_writer;
grant select on core.participant to nomey_writer;
grant select on core.membership  to nomey_writer;
grant select on core.effect      to nomey_writer;

-- INSERT unicamente sobre `core.effect` en este bloque. Las altas de ambito,
-- participante y membresia llegan con los comandos que las ejecutan: hoy ningun
-- ADR fija un predicado `WITH CHECK` para ellas, y colocar ahora un
-- `with check (true)` aparentaria una barrera que no existe.
grant insert on core.effect to nomey_writer;

-- Sin UPDATE y sin DELETE sobre ninguna de las cuatro (ADR-011 §14). La
-- ausencia es la decision.

-- ============================================================== RLS =========
-- Regla dura: ninguna tabla de `core` nace sin RLS.

alter table core.scope       enable row level security;
alter table core.participant enable row level security;
alter table core.membership  enable row level security;
alter table core.effect      enable row level security;

-- --------------------------------------------- lectura del rol cliente -----
-- ADR-013 §10, tal cual:
--   effect            -> membresia del ambito
--   operation_version -> existe al menos un efecto visible DE ESA VERSION
--   operation         -> existe al menos un efecto visible de ALGUNA version
--
-- No recursa: el helper `SECURITY DEFINER` rompe la cadena y `core.effect` no
-- referencia `core.operation`.

create policy scope_client_select on core.scope
  for select to authenticated
  using (sec.is_member(id));

create policy participant_client_select on core.participant
  for select to authenticated
  using (sec.is_member(scope_id));

create policy effect_client_select on core.effect
  for select to authenticated
  using (sec.is_member(scope_id));

-- El predicado filtra POR FILA, de modo que ver un efecto de una operacion NO
-- hace visibles los demas efectos de esa operacion en ambitos ajenos. Es la
-- propiedad que hace utilizable el permiso de ADR-002 §10, que permite
-- deliberadamente que una operacion produzca efectos sobre el ambito de otro.
create policy operation_version_client_select on core.operation_version
  for select to authenticated
  using (
    exists (
      select 1
      from core.effect e
      where e.operation_version_id = operation_version.id
        and sec.is_member(e.scope_id)
    )
  );

-- ADR-013 §2: quien ve al menos un efecto de una operacion puede conocer su
-- CLASE, porque sin ella su propio efecto queda sin interpretar. Esa regla no
-- concede nada mas: ni el ambito contextual, ni sus miembros, ni sus otros
-- efectos.
--
-- La visibilidad del historial sale de los efectos HISTORICOS, no solo de los
-- vigentes: la RLS filtra por ambito, no por vigencia.
create policy operation_client_select on core.operation
  for select to authenticated
  using (
    exists (
      select 1
      from core.operation_version ov
      join core.effect e on e.operation_version_id = ov.id
      where ov.operation_id = operation.id
        and sec.is_member(e.scope_id)
    )
  );

-- Catalogo. No hay nada que aislar por ambito en una definicion monetaria, y el
-- cliente necesita `code` y `scale` para poder formatear cualquier importe.
create policy currency_definition_client_select on core.currency_definition
  for select to authenticated
  using (true);

-- `core.membership` se queda SIN grant y SIN policy para el rol cliente. La
-- lectura visible de los miembros de un grupo se hara por la superficie de
-- `api` correspondiente, con su propia autorizacion, y no por acceso directo
-- (ADR-007 §4).

-- ------------------------------------------------- policies del writer -----
-- ADR-013 §10. Las permisivas se combinan con OR SOLO entre las aplicables al
-- rol actual, asi que una policy dirigida a `nomey_writer` no amplia lo que
-- puede el cliente (ADR-011 §15, medido en E17).

-- El unico `WITH CHECK` normativo del bloque, medido en E20: existe una
-- version, referida por el efecto, ATRIBUIDA AL ACTOR DE LA PETICION. Es
-- satisfacible dentro de la transaccion porque la subconsulta ve la version
-- insertada y aun no confirmada.
--
-- Es una segunda barrera de integridad, NO autorizacion por ambito: ADR-002 §10
-- permite deliberadamente producir efectos sobre el ambito de otro usuario, de
-- modo que exigir membresia del actor rechazaria escrituras legitimas.
create policy effect_writer_insert on core.effect
  for insert to nomey_writer
  with check (
    exists (
      select 1
      from core.operation_version ov
      where ov.id         = effect.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

-- Amplio POR NECESIDAD MEDIDA. Derivar la deuda vigente de un ambito —paso 4
-- del protocolo de ADR-013 §11— exige leer los efectos de TODOS los actores: la
-- deuda de un ambito no es de quien la escribio. E20 midio que una lectura
-- estrecha no da error, devuelve NULL, y la frontera concluiria que no hay
-- deuda. Las policies de SELECT del writer son PORTANTES de la escritura.
create policy effect_writer_select on core.effect
  for select to nomey_writer
  using (true);

-- El writer valida contexto ajeno al actor: que el pagador es miembro, que los
-- participantes del reparto son del ambito, cual es la moneda base. Y no puede
-- usar `sec.is_member`, porque E16 midio que `auth.uid()` no es invocable por
-- el writer. De ahi que estas tres sean amplias.
create policy scope_writer_select on core.scope
  for select to nomey_writer
  using (true);

create policy participant_writer_select on core.participant
  for select to nomey_writer
  using (true);

create policy membership_writer_select on core.membership
  for select to nomey_writer
  using (true);

-- Correccion de una incompletitud de la migracion anterior, no una decision
-- nueva: `core.currency_definition` nacio con RLS activada, con `GRANT SELECT`
-- a `nomey_writer` y SIN NINGUNA POLICY, de modo que esa lectura devolveria
-- CERO FILAS SIN ERROR en cuanto exista la primera funcion autoritativa. Es el
-- mismo modo de fallo silencioso que E20 midio sobre las versiones.
create policy currency_definition_writer_select on core.currency_definition
  for select to nomey_writer
  using (true);

-- Sin policies de UPDATE ni de DELETE para nadie sobre las cuatro tablas
-- nuevas. La policy de UPDATE de `core.scope` que necesitara el protocolo de
-- serializacion de la deuda —y el `GRANT UPDATE` por columna que
-- `SELECT ... FOR UPDATE` exige ademas de ella— llegan con el writer
-- autoritativo, que es quien la ejerce.
