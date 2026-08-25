-- Nucleo de operacion, version y comando cliente.
--
-- Segunda migracion real. Materializa la espina dorsal del versionado contable:
-- la operacion estable, sus versiones inmutables y la unidad de idempotencia
-- del origen cliente, mas el catalogo de definiciones monetarias del que cuelga
-- el importe original.
--
-- NO crea `core.effect`. La razon esta al final de este fichero y en
-- docs/architecture/phase-3c-handoff.md: no es alcance, es integridad.
--
-- Fuentes:
--   ADR-003 §1 · importes en unidad minima como entero exacto
--   ADR-004    · identidad de la definicion monetaria como UUID fijo y sembrado
--   ADR-006    · privilegios minimos y EXECUTE fuera de PUBLIC
--   ADR-009 §3 · identidad del actor desde la peticion
--   ADR-009 §5 · atributos del writer
--   ADR-010    · idempotencia del origen cliente
--   ADR-011    · operacion, version, linaje y comando cliente
--   ADR-013 §2, §3, §4, §10 · que contiene cada relacion y las policies del writer

-- ============================================================ catalogo ======
-- ADR-004: la identidad es un UUID fijo y sembrado, opaco. `code` y `scale` son
-- atributos visibles, NO la identidad: dos definiciones pueden compartir codigo
-- y no ser la misma (ADR-003 §3), por eso `code` no es unico.
--
-- Las validaciones reproducen exactamente las de la implementacion de
-- referencia en src/domain/money/currency-definition.ts, que ADR-002 §7 obliga
-- a reproducir: codigo no vacio y escala entero no negativo. No se inventa ni
-- un patron ISO ni una cota superior que el dominio no impone.

create table core.currency_definition (
  id    uuid     primary key,
  code  text     not null,
  scale smallint not null,
  constraint currency_definition_code_no_vacio check (code <> ''),
  constraint currency_definition_scale_no_negativa check (scale >= 0)
);

comment on table core.currency_definition is
  'Catalogo de definiciones monetarias. La identidad es el UUID; `code` y `scale` son atributos (ADR-003 §3, ADR-004).';
comment on column core.currency_definition.code is
  'Codigo ISO 4217 visible. NO es la identidad: dos definiciones pueden compartirlo.';

-- =========================================================== operacion ======
-- ADR-013 §2: identidad, clase, atribucion inicial, instante y puntero de
-- vigencia. Y nada mas: sin ambito, sin importe, sin client_operation_id.
--
-- `created_by` no lleva clave foranea a `auth.users` a proposito: obligaria a
-- decidir aqui el comportamiento ante el borrado de una cuenta, y la retencion
-- y purga estan expresamente abiertas. Se anadira cuando esa decision exista.

create table core.operation (
  id                 uuid        primary key,
  operation_class    text        not null,
  created_by         uuid        not null,
  created_at         timestamptz not null default now(),
  -- ADR-013 §4: estado autoritativo persistido, no una cache de MAX(version_no).
  current_version_id uuid        not null,
  constraint operation_class_no_vacia check (operation_class <> '')
);

comment on table core.operation is
  'Operacion contable estable. Una sola tabla para todas las clases (ADR-011 §1, ADR-013 §2).';
comment on column core.operation.current_version_id is
  'Estado autoritativo: selecciona que version cuenta. No es una cache de MAX(version_no) (ADR-013 §4).';

-- ============================================================= version ======
-- ADR-013 §3. No contiene clase —se hereda—, ni ambito, ni metodo de reparto,
-- ni pagador.

create table core.operation_version (
  id                        uuid        primary key,
  operation_id              uuid        not null references core.operation (id),
  version_no                integer     not null,
  supersedes_version_id     uuid,
  created_by                uuid        not null,
  created_at                timestamptz not null default now(),
  effective_date            date        not null,
  -- ADR-003 §1: entero en unidad minima. Exactamente uno por version.
  original_amount           bigint      not null,
  original_currency_definition_id uuid  not null references core.currency_definition (id),
  -- ADR-013 §7: bajo que contrato de derivacion nacio esta version.
  economic_rules_version    text        not null,

  -- Destino de las claves foraneas compuestas de `operation` y `client_command`.
  constraint operation_version_op_id_unico unique (operation_id, id),

  -- Linaje (ADR-011 §11, las seis restricciones medidas en E17).
  constraint operation_version_no_positivo   check (version_no >= 1),
  constraint operation_version_no_unico      unique (operation_id, version_no),
  constraint operation_version_primera       check ((version_no = 1) = (supersedes_version_id is null)),
  constraint operation_version_no_autoref    check (supersedes_version_id is distinct from id),
  -- El predecesor pertenece a la MISMA operacion. Compuesta, por eso cubre
  -- tambien el caso de apuntar a una version de otra operacion.
  -- OJO: es lo UNICO del linaje que se garantiza estructuralmente. Estas
  -- restricciones NO impiden que una V3 supersede a V1 saltandose la V2, ni que
  -- dos versiones supersedan a la misma. ADR-011 §11 reserva expresamente ese
  -- invariante —que el predecesor sea la version vigente anterior— a la
  -- frontera autoritativa, y no se simula aqui.
  constraint operation_version_supersedes_misma_op
    foreign key (operation_id, supersedes_version_id)
    references core.operation_version (operation_id, id),

  constraint operation_version_reglas_no_vacias check (economic_rules_version <> '')
);

comment on table core.operation_version is
  'Version inmutable de una operacion. Corregir crea una version nueva; el historial no se muta (ADR-011, ADR-013 §3).';
comment on column core.operation_version.original_amount is
  'Importe original en unidad minima, entero exacto. Nunca cruza JSON como numero (ADR-003 §1, ADR-008).';

-- El puntero de vigencia: compuesta —no puede apuntar a la version de otra
-- operacion— y DIFERIBLE —permite insertar la operacion antes que su V1—.
-- ADR-011 §4, medido en E17.
alter table core.operation
  add constraint operation_current_version_fk
  foreign key (id, current_version_id)
  references core.operation_version (operation_id, id)
  deferrable initially deferred;

-- ====================================================== comando cliente =====
-- ADR-010 y ADR-011 §5. La unidad de idempotencia es el COMANDO, no la
-- operacion: K1 crea A, K2 y K3 la corrigen, y son tres comandos sobre una sola
-- operacion. Por eso `client_operation_id` no vive en `core.operation`.

create table core.client_command (
  created_by               uuid        not null,
  client_operation_id      uuid        not null,
  command_type             text        not null,
  command_contract_version integer     not null,
  canonical_intent         jsonb       not null,
  result_operation_id      uuid        not null,
  result_version_id        uuid        not null,
  created_at               timestamptz not null default now(),

  -- ADR-010: unicidad TRANSVERSAL a clases. `command_type` NUNCA entra aqui.
  constraint client_command_pk primary key (created_by, client_operation_id),

  constraint client_command_type_no_vacio check (command_type <> ''),
  constraint client_command_contrato_positivo check (command_contract_version >= 1),

  -- El resultado apunta a una version DE ESA operacion. Diferible porque el
  -- comando se reclama antes de que exista su resultado (ADR-011 §5, E17).
  constraint client_command_result_fk
    foreign key (result_operation_id, result_version_id)
    references core.operation_version (operation_id, id)
    deferrable initially deferred
);

comment on table core.client_command is
  'Unidad fisica de idempotencia del origen cliente. Unicidad transversal a clases (ADR-010, ADR-011 §5).';

-- ============================================ helper de identidad del actor ==
-- ADR-009 §3: lee los claims verificados de la peticion, nunca el payload.
-- SECURITY INVOKER porque no necesita privilegios sobre tablas. Falla cerrado.
--
-- Valida el UUID explicitamente en vez de dejar que lo haga el cast: E20 midio
-- que un `sub` malformado sale como `22P02`, un error de dato, y no como el
-- `42501` uniforme que corresponde a "no hay identidad valida".

create function sec.request_actor_id() returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_raw text;
  v_sub text;
begin
  v_raw := nullif(current_setting('request.jwt.claims', true), '');
  if v_raw is null then
    raise exception 'sin identidad en la peticion' using errcode = '42501';
  end if;

  begin
    v_sub := (v_raw::jsonb) ->> 'sub';
  exception when others then
    raise exception 'claims de la peticion ilegibles' using errcode = '42501';
  end;

  if v_sub is null then
    raise exception 'claims sin sub' using errcode = '42501';
  end if;

  -- Sin esta comprobacion, un `sub` malformado saldria como 22P02.
  if v_sub !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'sub de la peticion no es un UUID' using errcode = '42501';
  end if;

  return v_sub::uuid;
end
$fn$;

comment on function sec.request_actor_id() is
  'Actor autoritativo derivado de los claims de la peticion. Falla cerrado con 42501 (ADR-009 §3).';

-- ADR-006 §4, segunda capa: revoke explicito ademas del default global.
revoke execute on function sec.request_actor_id() from public;

-- ================================================== writer autoritativo =====
-- ADR-009 §5. Se crea el ROL con sus atributos; las funciones autoritativas que
-- seran de su propiedad llegan con la frontera de escritura, no aqui.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nomey_writer') then
    create role nomey_writer nologin nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
end $$;

comment on role nomey_writer is
  'Writer autoritativo: NOLOGIN, no propietario, NOBYPASSRLS, minimo privilegio (ADR-009 §5).';

-- Ceder la propiedad de las funciones autoritativas al writer exigira que quien
-- ejecuta las migraciones sea miembro del rol: E16 midio que `postgres` no es
-- superusuario en este stack y que sin la pertenencia falla con
-- `must be able to SET ROLE`. Es una consecuencia operativa real de ADR-009 §4,
-- no una comodidad de test.
grant nomey_writer to postgres;

-- Privilegios minimos. USAGE sobre `sec` porque el cuerpo de las funciones
-- autoritativas invocara el helper directamente; E20 midio que la evaluacion
-- dentro de una policy no lo necesita, pero la invocacion directa si.
grant usage on schema core to nomey_writer;
grant usage on schema sec  to nomey_writer;
grant execute on function sec.request_actor_id() to nomey_writer;

grant select, insert on core.operation         to nomey_writer;
grant select, insert on core.operation_version to nomey_writer;
grant select, insert on core.client_command    to nomey_writer;
grant select          on core.currency_definition to nomey_writer;

-- ADR-011 §14 · la RLS acota filas, nunca columnas: limitar la escritura al
-- puntero de vigencia es un GRANT POR COLUMNA. Medido en E20 (C5/C6).
grant update (current_version_id) on core.operation to nomey_writer;

-- Sin UPDATE ni DELETE sobre versiones ni efectos, y sin DELETE en ningun sitio
-- (ADR-011 §14). No se conceden: la ausencia es la decision.

-- =========================================================== RLS ============
-- Regla dura: ninguna tabla de `core` nace sin RLS.

alter table core.currency_definition enable row level security;
alter table core.operation           enable row level security;
alter table core.operation_version   enable row level security;
alter table core.client_command      enable row level security;

-- Los roles cliente NO reciben grants de escritura ni policies de escritura
-- (ADR-002 §7, ADR-013 §10). Tampoco reciben todavia grants de lectura: sus
-- policies de lectura dependen de `core.effect`, que no existe aun. Con RLS
-- activada y sin policy el resultado es denegacion total, que es el estado
-- seguro y no un estado invalido.

-- ---------------------------------------------------------- operation ------
-- ADR-013 §10. La atribucion inicial ES el actor de la peticion, asi que este
-- WITH CHECK no introduce ninguna regla de producto.
create policy operation_writer_insert on core.operation
  for insert to nomey_writer
  with check (created_by = sec.request_actor_id());

-- USING amplio y deliberado. La autoria original NO concede exclusividad de
-- correccion: `data-model.md` §7 dice que corrige cualquier integrante con
-- derecho, y E20 midio que derivar esta policy de `created_by` impide corregir
-- la operacion de otro. El derecho de correccion es funcional y vive en la
-- frontera autoritativa.
create policy operation_writer_select on core.operation
  for select to nomey_writer
  using (true);

-- El UPDATE tampoco deriva de la autoria. Lo util se traslada al WITH CHECK
-- explicito: el puntero solo puede moverse a una version atribuida al actor que
-- lo mueve. Medido en E20 (E2 acepta la correccion cross-author, E3 rechaza
-- mover el puntero a una version ajena).
--
-- El USING es ademas lo que hace posible `SELECT ... FOR UPDATE`: E20 midio que
-- sin policy de UPDATE el bloqueo devuelve CERO FILAS SIN ERROR (C4b).
create policy operation_writer_update on core.operation
  for update to nomey_writer
  using (true)
  with check (
    exists (
      select 1
      from core.operation_version ov
      where ov.id           = operation.current_version_id
        and ov.operation_id = operation.id
        and ov.created_by   = sec.request_actor_id()
    )
  );

-- --------------------------------------------------- operation_version -----
create policy operation_version_writer_insert on core.operation_version
  for insert to nomey_writer
  with check (created_by = sec.request_actor_id());

-- Amplio por necesidad medida, no por comodidad: construir V2 exige LEER V1
-- —el siguiente `version_no` se calcula, el FX congelado se hereda, la
-- intencion no corregida se conserva—, y E20 midio que restringir esta lectura
-- por atribucion deja invisible la V1 de otro actor y devuelve NULL sin error.
-- Ampliarla no afloja la escritura: los WITH CHECK siguen mordiendo.
create policy operation_version_writer_select on core.operation_version
  for select to nomey_writer
  using (true);

-- ------------------------------------------------------- client_command ----
create policy client_command_writer_insert on core.client_command
  for insert to nomey_writer
  with check (created_by = sec.request_actor_id());

-- Aqui SI es correcto acotar por actor: la unicidad de ADR-010 es
-- `(created_by, client_operation_id)`, de modo que un comando pertenece por
-- definicion a su actor y el replay solo puede resolverlo contra los suyos.
create policy client_command_writer_select on core.client_command
  for select to nomey_writer
  using (created_by = sec.request_actor_id());

-- ==================================================== por que no `effect` ===
--
-- `core.effect` NO entra en esta migracion, y no por acotar el alcance.
--
-- Sus claves foraneas normativas exigen `core.scope` y `core.participant`
-- —ADR-012 §3: los efectos referencian SIEMPRE al participante contextual, que
-- es contextual POR AMBITO— y su policy de lectura de cliente es la MEMBRESIA
-- DEL AMBITO mediante el helper de ADR-007 §2 (ADR-013 §10), que necesita la
-- relacion de membresia usuario-ambito. Son tres relaciones mas, con su propia
-- RLS: un bloque, no un apendice de este.
--
-- Esas tres relaciones pertenecen a la Fase 3.C, NO a una fase posterior: el
-- roadmap incluye "Auth tecnico con usuarios reales" en el alcance de 3.C, y la
-- Fase 5 depende de "F3.C (Auth tecnico y RLS)". Lo que llega en F5 es la
-- experiencia de identidad —registro, login, recuperacion, sesion—, no la
-- relacion fisica que la RLS necesita.
--
-- No hay estado intermedio invalido por esperar al bloque siguiente: `effect`
-- simplemente todavia no existe, igual que `operation` no existia antes de esta
-- migracion. Las policies de lectura de cliente de `operation` y
-- `operation_version` —que derivan de los efectos visibles— llegan alli, junto
-- con los grants de lectura correspondientes.
