-- Vinculo participante-cuenta y periodos de presencia.
--
-- Cuarta migracion real. Materializa las DOS relaciones que ADR-012 separa
-- expresamente de `core.participant` y de `core.membership`, y que responden a
-- preguntas distintas que no deben colapsarse (ADR-012 §4):
--
--   core.membership            -> que puede ver o hacer AHORA una cuenta
--   core.participant_user_link -> que cuenta es esa identidad contextual
--   core.participant_period    -> cuando era elegible ese participante
--
-- Un invitado sin cuenta tiene participante y periodos, y NO tiene vinculo ni
-- membresia. Colapsar dos de las tres es el error que ADR-012 existe para
-- evitar.
--
-- Trae ademas `btree_gist`, que es la dependencia de esquema que la exclusion
-- de solapes necesita y que hasta ahora se habia aplazado por no tener quien la
-- usara.
--
-- Fuentes:
--   ADR-006 §3, §4 · grants minimos del rol cliente
--   ADR-007        · la RLS de `core` es la autoridad por fila
--   ADR-009 §5     · atributos del writer
--   ADR-011 §15    · ninguna policy de `core` aplicable a PUBLIC
--   ADR-012 §2     · el vinculo vive en una relacion separada
--   ADR-012 §5     · periodos separados, semantica [valid_from, valid_until)
--   ADR-012 §6     · las tres cardinalidades del vinculo
--   ADR-012 §7     · elegibilidad historica
--   ADR-012 §8     · el claim establece identidad, NO autorizacion
--   ADR-012 §10    · auditabilidad minima

-- ========================================================== btree_gist ======
-- ADR-012 §5 la registra como dependencia explicita DEL ESQUEMA, no de la
-- aplicacion. E18 midio, y se reprodujo contra este stack antes de escribir
-- esta migracion, que sin ella `EXCLUDE USING gist (uuid WITH =, ...)` falla
-- con `42704 · data type uuid has no default operator class for access method
-- "gist"`. No es una optimizacion: es lo que hace declarativa la exclusion.
--
-- Va al schema `extensions`, que es donde este stack ya instala `pgcrypto`,
-- `uuid-ossp` y `pg_stat_statements`. No es una decision nueva: es la
-- convencion medida del stack.
--
-- PREFLIGHT DE PRODUCCION, todavia vivo: la documentacion publica de Supabase
-- no enumera esta extension, asi que su disponibilidad en el proyecto objetivo
-- NO esta demostrada por documentacion y debe comprobarse contra ese proyecto
-- antes de desplegar. El procedimiento esta en docs/runbooks/local-setup.md.
-- Si algun entorno objetivo no la ofreciera, ADR-012 §5 obliga a REVISAR el
-- mecanismo, no a sustituirlo preventivamente por validacion procedural.

create extension if not exists btree_gist with schema extensions;

-- =============================================== vinculo participante-cuenta =
-- ADR-012 §2: una RELACION SEPARADA, y no una columna `user_id` nullable dentro
-- del participante.
--
-- El motivo no es de estilo. Una columna no registra el vinculo COMO HECHO
-- —cuando, quien lo autorizo, con que prueba—, que es exactamente lo que F10
-- necesitara, y no puede expresar limpiamente la segunda cardinalidad. Y hay
-- una asimetria que decide: migrar de columna a relacion obligaria a INVENTAR
-- cuando y con que prueba se establecieron los vinculos existentes, es decir a
-- fabricar una autorizacion que nadie dio. Migrar en sentido contrario es tirar
-- una tabla.
--
-- `scope_id` esta aqui A PROPOSITO aunque el participante ya lo tenga: sin el
-- no se puede expresar "un usuario, como maximo un participante por ambito", y
-- la FK compuesta impide que diverja del participante. Es el mismo patron que
-- `core.effect`.
--
-- `user_id` no lleva FK a `auth.users`, igual que `core.membership.user_id` y
-- que `core.operation.created_by`: la retencion y la purga de cuentas siguen
-- expresamente abiertas y no deben decidirse de refilon mediante una FK.

create table core.participant_user_link (
  -- ADR-012 §6, cardinalidad 1: un participante, como maximo un usuario.
  participant_id uuid        primary key,
  scope_id       uuid        not null,
  user_id        uuid        not null,
  -- ADR-012 §10 fija AHORA como propiedad universal el instante del vinculo.
  linked_at      timestamptz not null default now(),

  -- ADR-012 §6, cardinalidad 2: un usuario, como maximo un participante POR
  -- AMBITO. Es INDEPENDIENTE de la primera; ninguna implica la otra.
  constraint participant_user_link_usuario_unico_por_ambito
    unique (scope_id, user_id),

  -- ADR-012 §6, cardinalidad 3: el ambito del vinculo no diverge del ambito del
  -- participante.
  constraint participant_user_link_participante_del_ambito
    foreign key (participant_id, scope_id)
    references core.participant (id, scope_id)

  -- NO se anade `UNIQUE (user_id, participant_id)`. ADR-012 §6 lo retira
  -- expresamente: como `participant_id` ya es clave, ese indice no anade
  -- restriccion alguna y ni siquiera menciona el ambito.
);

comment on table core.participant_user_link is
  'Vinculo entre una identidad contextual y una cuenta. Establece IDENTIDAD, no autorizacion: no concede membresia ni acceso RLS (ADR-012 §8).';
comment on column core.participant_user_link.scope_id is
  'Redundante con participant.scope_id y necesario: sin el no se puede expresar UNIQUE (scope_id, user_id). La FK compuesta impide que diverja.';
comment on column core.participant_user_link.linked_at is
  'Instante del vinculo. Unica columna de auditoria que ADR-012 §10 fija ahora; el actor y la procedencia los define F10.';

-- > REQUISITO PARA F10, y la razon de que esta tabla nazca sin mas columnas de
-- > auditoria. ADR-012 §10 exige que un vinculo aceptado permita determinar
-- > QUE ACTOR O PROCESO AUTORITATIVO lo establecio y QUE PROCEDENCIA lo
-- > justifico, pero fija como normativo solo el instante, y advierte de que
-- > fijar `proof_kind` y `proof_ref` ahora prejuzgaria la forma de la prueba.
-- >
-- > Anadir esas columnas mas tarde NO reproduce la asimetria de ADR-012 §2,
-- > porque esta relacion NO PUEDE RECIBIR NINGUNA FILA todavia: nadie tiene
-- > INSERT sobre ella, ni el rol cliente ni el writer, y no existe comando
-- > autoritativo que la escriba. No hay historial que inventar sobre cero
-- > filas. Ese vacio es estructural y esta comprobado por los checks.
-- >
-- > Antes de habilitar claims reales en produccion debe existir una
-- > representacion persistente suficiente de la procedencia y la evidencia.

-- ==================================================== periodos de presencia ==
-- ADR-012 §5. Relacion SEPARADA de periodos, no `joined_at` / `left_at` en el
-- participante: esa es la alternativa E del ADR, descartada porque solo admite
-- UN periodo, de modo que entrar -> salir -> volver exigiria una identidad
-- nueva, que es justo lo que ADR-012 existe para evitar.
--
-- La granularidad es DATE, no timestamptz, y la decision se sigue del unico
-- consumidor que existe: la elegibilidad se evalua contra la FECHA EFECTIVA de
-- una operacion (`data-model.md` §7, ADR-012 §7), y
-- `core.operation_version.effective_date` es `date`. Comparar una fecha con un
-- instante introduciria una pregunta de zona horaria que ningun ADR ha
-- decidido. Consecuencia aceptada: dos periodos del mismo participante no
-- pueden empezar el mismo dia, lo cual es indistinguible para la unica
-- pregunta que los periodos responden.

create table core.participant_period (
  participant_id uuid not null references core.participant (id),
  valid_from     date not null,
  valid_until    date,

  -- Implicada por la exclusion —dos periodos que empiezan el mismo dia se
  -- solapan siempre— y declarada explicitamente porque es la clave natural y
  -- el indice de la consulta de elegibilidad.
  constraint participant_period_pk primary key (participant_id, valid_from),

  -- ADR-012 §5: `valid_until` nulo es un periodo ABIERTO, y cuando existe es
  -- estrictamente posterior. Impide el intervalo vacio.
  constraint participant_period_rango_valido
    check (valid_until is null or valid_until > valid_from),

  -- ADR-012 §5. Semantica [valid_from, valid_until): inicio incluido, final
  -- excluido, de modo que UN PERIODO PUEDE TERMINAR EXACTAMENTE CUANDO EMPIEZA
  -- OTRO sin solaparse.
  --
  -- Se usa la EXPRESION `daterange(...)` y no una columna generada: la forma de
  -- la relacion sigue siendo exactamente la que ADR-012 §5 describe
  -- —participante, `valid_from`, `valid_until` nullable— sin un tercer sitio
  -- donde el mismo dato pueda decir otra cosa.
  constraint participant_period_sin_solapes
    exclude using gist (
      participant_id WITH =,
      daterange(valid_from, valid_until, '[)') WITH &&
    )
);

comment on table core.participant_period is
  'Elegibilidad historica de un participante, en intervalos [valid_from, valid_until). Soporta entrar, salir y volver con la MISMA identidad (ADR-012 §5).';
comment on column core.participant_period.valid_until is
  'Nulo = periodo abierto. Cuando existe, estrictamente posterior a valid_from y EXCLUIDO del intervalo.';

-- Ni el vinculo ni los periodos son un hecho contable. No producen efectos, no
-- participan en saldos y no se someten a versiones ni a linaje: ADR-012
-- descarto expresamente modelarlos como operacion versionada. Un claim
-- posterior NO crea `operation_version`, NO modifica efectos, NO mueve
-- `current_version_id` y NO crea periodos retroactivos (ADR-012 §3, §7).

-- ============================================================== RLS =========
-- Regla dura: ninguna tabla de `core` nace sin RLS.

alter table core.participant_user_link enable row level security;
alter table core.participant_period    enable row level security;

-- --------------------------------------------------------- rol cliente -----
-- NINGUN grant y NINGUNA policy para `authenticated`. Con RLS activada y sin
-- policy el resultado es denegacion total, que es el estado seguro y el mismo
-- con el que nacieron `core.operation` y `core.operation_version`.
--
-- No es una omision, son dos negativas razonadas:
--
-- 1. EL VINCULO. Responde a "cuales de estos efectos son mios" (ADR-012 §8), y
--    ADR-012 delego esa pregunta en la proyeccion canonica de D11 — que ADR-013
--    NO llego a resolver y que todavia no existe. Exponerlo hoy revelaria ademas
--    que CUENTA GLOBAL hay detras de cada identidad contextual, y ADR-012 §1
--    hace del no correlacionar identidades el motivo mismo de que el
--    participante sea contextual. Conceder lectura antes de que exista la
--    superficie que la justifique seria decidir por adelantado algo que
--    pertenece a un ADR.
--
-- 2. LOS PERIODOS. Son entradas de una VALIDACION AUTORITATIVA (ADR-012 §7), no
--    de una pantalla: nada de lo que hoy existe los lee desde el cliente.
--
-- Cuando alguna funcionalidad concreta los necesite, se concederan por la
-- superficie de `api` correspondiente, con su politica y su autorizacion, que
-- es lo que ADR-007 §4 fija para la membresia por la misma razon.

-- ------------------------------------------------------------- writer ------
-- Solo LECTURA, y solo la que el writer necesitara: resolver cuenta <->, y
-- comprobar la elegibilidad de un participante en la fecha efectiva.
--
-- Amplias por la misma necesidad medida que en el bloque anterior: la
-- validacion alcanza a participantes que NO son el actor —el pagador, los
-- demas participantes del reparto— y el writer no puede usar `sec.is_member`
-- porque E16 midio que `auth.uid()` no es invocable por el.

grant select on core.participant_user_link to nomey_writer;
grant select on core.participant_period    to nomey_writer;

create policy participant_user_link_writer_select on core.participant_user_link
  for select to nomey_writer
  using (true);

create policy participant_period_writer_select on core.participant_period
  for select to nomey_writer
  using (true);

-- SIN `INSERT`, `UPDATE` ni `DELETE` para nadie, y sin sus policies.
--
-- No es cautela: es que no existe todavia ningun comando autoritativo que
-- escriba estas relaciones. Crear el vinculo exige una PRUEBA DE AUTORIZACION
-- cuyo mecanismo pertenece a F10 (ADR-012 §9), y abrir o cerrar periodos
-- pertenece a los comandos de alta y baja de participantes, que tampoco
-- existen. Conceder la escritura ahora, con un `with check (true)` por no haber
-- predicado que escribir, aparentaria una barrera inexistente.
--
-- Consecuencia deliberada y comprobada por los checks: hoy NADIE puede escribir
-- estas dos tablas por el camino normal, asi que nacen y permanecen vacias
-- hasta que llegue su comando.
