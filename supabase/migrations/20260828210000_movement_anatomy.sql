-- Anatomia del movimiento · F6.B, primera mitad: estructura y catalogo.
--
-- Undecima migracion real. Trae lo que un movimiento de Modo Personal necesita
-- para significar algo para quien lo lee: concepto, categoria y hora efectiva.
--
--   core.operation_version.effective_time   universal, NULLABLE
--   core.category                           catalogo de sistema + personalizadas
--   core.movement_detail                    concepto y categoria, POR VERSION
--
-- La segunda mitad —helpers, writers, superficie `api`— viaja en la migracion
-- siguiente, del mismo commit.
--
-- ============ LO UNIVERSAL Y LO QUE DEPENDE DE LA CLASE, SEPARADO ===========
--
-- ADR-013 §3 enumera el contenido de `core.operation_version` de forma cerrada y
-- dice por que: la version guarda lo que TODA version tiene. Anadir ahi tres
-- columnas anulables cuya obligacion depende de una clase que la fila NO
-- CONTIENE —la clase vive en `core.operation`, y §3 se niega expresamente a
-- duplicarla— dejaria una tabla que no puede explicar sus propios nulos.
--
-- Asi que se separan dos cosas que no son la misma:
--
--   universal        el instante efectivo. Toda operacion ocurre en un momento,
--                    y `effective_date` ya vive en la version. La hora es EL
--                    MISMO HECHO con mas grano, y va a su lado.
--
--   por clase        el concepto y la categoria. Son atributos de un MOVIMIENTO
--                    que alguien lee en un historial. Un ajuste no los tiene:
--                    su linea la deriva el producto —«Saldo ajustado a X»— y no
--                    la escribe nadie. Una liquidacion tampoco.
--
-- **Y no hace falta inventar el patron: ya existe.** `core.split` es exactamente
-- esto —detalle por version, presente solo en las clases que reparten— y su
-- propio comentario lo dice: «Metodo y pagador viven aqui y no en la version».
-- `core.movement_detail` es el mismo patron por el mismo motivo.
--
-- La consecuencia es la que se buscaba: **ninguna clase tiene que inventarse un
-- concepto ni una categoria para satisfacer una restriccion**. Donde el hecho
-- existe, existe la fila y las columnas son NOT NULL; donde no existe, no hay
-- fila. La ausencia es estructural, no un nulo que interpretar.

-- ===================== 1 · la hora efectiva, en la version =================
--
-- NULLABLE, y es una decision, no una comodidad. Ponerla NOT NULL obligaria a
-- las seis clases restantes a aportar una hora HOY, antes de que el producto
-- haya decidido si un ajuste o una liquidacion tienen hora. Eso es exactamente
-- fabricar un dato para satisfacer una constraint.
--
-- NULO SIGNIFICA «SIN HORA REGISTRADA», NUNCA MEDIANOCHE. No se hace `coalesce`
-- a '00:00' en ningun sitio: seria inventar un instante que nadie declaro, y al
-- ordenar pondria esos movimientos los primeros del dia por accidente.
--
-- TIPO `time` SIN ZONA, y tambien es una decision. `timetz` adjunta un
-- desplazamiento UTC, es decir semantica de zona horaria que el producto NO ha
-- definido. El par `(effective_date, effective_time)` es un RELOJ DE PARED
-- LOCAL: «la cena fue el 28 de agosto a las 21:30». Eso es lo que la persona
-- declara y todo lo que se necesita para presentar y para ordenar dentro del
-- dia. Si algun dia hace falta un instante absoluto —una importacion bancaria,
-- F17— se anade aparte y de forma aditiva.
--
-- `effective_date` NO CAMBIA. Sigue siendo `date`, sigue siendo la autoridad de
-- elegibilidad de participantes —`sec.assert_participant_eligible` la compara
-- contra `core.participant_period`, que es `date` PORQUE su unico consumidor es
-- esta columna— y sigue siendo el eje de agrupacion por dia, mes y ano.
-- `core.participant_period` no se toca.

alter table core.operation_version add column effective_time time;

comment on column core.operation_version.effective_time is
  'Hora efectiva local, sin zona. NULA significa SIN HORA REGISTRADA, nunca medianoche. Autoridad de elegibilidad y agrupacion sigue siendo effective_date (ADR-020).';

-- =========================== 2 · catalogo de categorias ====================
--
-- `applies_to` habla en CLASE CONTABLE —`expense` / `income`—, no en clase de
-- operacion. Son vocabularios distintos y elegir el contable no es un detalle:
-- un gasto de grupo de F9 tiene clase de operacion `group_expense` y clase
-- contable `expense`, de modo que reutilizara este mismo catalogo sin migrar
-- nada. Con `operation_class` habria hecho falta una fila por clase nueva.
--
-- SISTEMA frente a PERSONALIZADA, y la diferencia es una sola columna:
-- `owner_user_id` nulo es de sistema. Las de sistema llevan `message_key` y NO
-- texto: ninguna cadena visible vive fuera del catalogo de i18n (`AGENTS.md`
-- §6). Las personalizadas llevan `label` literal, que lo escribe la persona y
-- no se traduce.
--
-- Sin FK a `auth.users`, igual que `membership.user_id`, `operation.created_by`
-- y `scope.owner_user_id`: la retencion y purga de cuentas siguen abiertas.

create table core.category (
  id             uuid     primary key,
  applies_to     text     not null,
  owner_user_id  uuid,
  message_key    text,
  label          text,
  icon           text     not null,
  ordinal        smallint not null,
  -- Baja LOGICA. Nunca se borra una categoria con historico: los movimientos
  -- antiguos la siguen resolviendo, con su nombre y su icono.
  is_active      boolean  not null default true,
  created_at     timestamptz not null default now(),

  -- Vocabulario CERRADO, como `scope.kind`. Una familia nueva exige migracion
  -- deliberada, a diferencia de `operation.operation_class`, que es abierto.
  constraint category_familia_valida check (applies_to in ('expense', 'income')),

  -- Las dos formas son excluyentes y completas: o es de sistema con su clave, o
  -- es de alguien con su texto. No hay una tercera.
  constraint category_sistema_o_propia check (
    (owner_user_id is null     and message_key is not null and label is null)
    or (owner_user_id is not null and message_key is null  and label is not null)
  ),
  constraint category_label_no_vacia   check (label is null or btrim(label) <> ''),
  constraint category_clave_no_vacia   check (message_key is null or message_key <> ''),
  constraint category_icono_no_vacio   check (icon <> ''),

  -- Destino de la FK compuesta de `core.movement_detail`: es lo que hace
  -- ESTRUCTURAL que un movimiento no pueda referenciar una categoria de otra
  -- familia sin declararlo. Redundante como restriccion —`id` ya es clave— y
  -- necesaria como destino, mismo patron que `scope_id_moneda_unico`.
  constraint category_id_familia_unico unique (id, applies_to)
);

comment on table core.category is
  'Catalogo de categorias por familia contable. owner_user_id nulo = de sistema. Baja logica, nunca DELETE con historico (ADR-021).';
comment on column core.category.applies_to is
  'Familia CONTABLE: expense | income. No es la clase de operacion; asi el gasto de grupo de F9 reutiliza el catalogo sin migrar.';
comment on column core.category.message_key is
  'Clave i18n de una categoria de sistema. Ninguna cadena visible vive fuera del catalogo de mensajes.';
comment on column core.category.label is
  'Texto literal de una categoria personalizada, escrito por su propietario. No se traduce.';

-- Dos categorias propias de la misma persona y familia no comparten nombre.
-- `lower(btrim(...))` para que «Gimnasio» y «gimnasio» no convivan: son la misma
-- para quien las lee, y dos entradas indistinguibles en un selector son un
-- defecto, no una libertad.
create unique index category_propia_nombre_unico
  on core.category (owner_user_id, applies_to, lower(btrim(label)))
  where owner_user_id is not null;

-- El selector ordena por `ordinal` dentro de su familia, y `Otros` va al final.
create index category_familia_orden on core.category (applies_to, ordinal);

-- ============================ 3 · detalle del movimiento ===================
--
-- Concepto y categoria, POR VERSION. Corregir cualquiera de los dos crea una
-- version nueva con su propia fila; la anterior no se toca. Es exactamente la
-- semantica de versionado que el producto pide, y sale gratis por estar
-- referenciado a la version y no a la operacion.
--
-- LAS DOS COLUMNAS SON NOT NULL, y pueden serlo precisamente porque la fila solo
-- existe donde el hecho existe.
--
-- `applies_to` SE ALMACENA, y no es una duplicacion ociosa: es lo que permite la
-- FK compuesta de abajo, que hace ESTRUCTURAL que la categoria pertenezca a la
-- familia declarada. Lo que NO puede ser estructural es que esa familia coincida
-- con la clase real de la operacion, y conviene decir por que en vez de
-- disimularlo: haria falta una relacion que mapee `operation_class` a familia
-- contable, y `operation_class` es un vocabulario ABIERTO por decision expresa
-- de ADR-013 §2. Cerrarlo para ganar esta FK seria pagar demasiado. Ese ultimo
-- eslabon lo comprueba la frontera, con un unico helper y una constante por
-- funcion, y tiene regresion.

create table core.movement_detail (
  operation_version_id uuid not null primary key
    references core.operation_version (id),
  concept              text not null,
  category_id          uuid not null,
  -- Familia contable a la que pertenece la categoria de esta version.
  applies_to           text not null,

  constraint movement_detail_concepto_no_vacio check (btrim(concept) <> ''),
  constraint movement_detail_familia_valida    check (applies_to in ('expense', 'income')),

  -- La categoria pertenece a la familia declarada. Estructural.
  constraint movement_detail_categoria_de_su_familia
    foreign key (category_id, applies_to)
    references core.category (id, applies_to)
);

comment on table core.movement_detail is
  'Concepto y categoria de una version que es un MOVIMIENTO. Mismo patron que core.split: detalle por version, presente solo en las clases que lo tienen (ADR-020).';
comment on column core.movement_detail.concept is
  'Texto libre obligatorio, ya canonicalizado por la frontera: recortado y en NFC. Sin plegado de mayusculas.';
comment on column core.movement_detail.applies_to is
  'Familia de la categoria. Existe para que la FK compuesta la haga estructural; que coincida con la clase real de la operacion lo comprueba la frontera.';

-- ================================ 4 · siembra ==============================
--
-- Doce categorias de gasto y tres de ingreso. UUID v5 reproducibles, misma
-- receta que el catalogo monetario: namespace DNS de RFC 4122 y nombre
-- `category.nomey.app/<familia>/<slug>`.
--
-- NUNCA SE REGENERAN. `core.movement_detail` los referencia, asi que un
-- identificador distinto por entorno rompe la portabilidad de cualquier dato.
--
-- `Otros` es una categoria REAL en las dos familias, con su fila y su
-- identidad. No es la ausencia de categoria: por eso `category_id` puede ser
-- NOT NULL y no existe el caso nulo en toda la UX.
--
-- Las cadenas visibles NO estan aqui: llegan al catalogo de i18n con la pantalla
-- que las muestre. Anadirlas ahora crearia claves sin consumidor, que es
-- exactamente lo que `tests/lib/i18n-usage.test.ts` prohibe y por buen motivo:
-- copy que nadie renderiza no lo revisa nadie.
--
-- El icono es un nombre de simbolo del sistema, que es lo que consume
-- `expo-symbols`. Se guarda como texto y la UI lo resuelve.

insert into core.category (id, applies_to, message_key, icon, ordinal) values
  ('80088454-77aa-51ae-864e-523ca74d66eb', 'expense', 'category.expense.groceries',     'fork.knife',                   10),
  ('92fcc25f-ad95-57a3-aba8-4756ce5b8cca', 'expense', 'category.expense.dining',        'cup.and.saucer',               20),
  ('aeb60340-1e68-5e50-a653-905b9ebe287c', 'expense', 'category.expense.transport',     'car',                          30),
  ('0bcc36c9-4307-5ad1-9e55-e71f8b6d0d31', 'expense', 'category.expense.housing',       'house',                        40),
  ('704087d6-6bb0-517b-a371-24ed190665b4', 'expense', 'category.expense.utilities',     'bolt',                         50),
  ('aa873ad8-607d-5499-845b-b04f0d2882d4', 'expense', 'category.expense.health',        'cross.case',                   60),
  ('21c05d21-bbd2-5aa3-bd9c-17422a5eccf8', 'expense', 'category.expense.leisure',       'gamecontroller',               70),
  ('0335241b-872a-54b7-af83-028b116bdee7', 'expense', 'category.expense.shopping',      'bag',                          80),
  ('61c1c15a-145f-53ac-afc7-a31e8fc8178e', 'expense', 'category.expense.education',     'book',                         90),
  ('aa08a0c3-0b75-5f6e-9eb6-5d2d78693a8a', 'expense', 'category.expense.subscriptions', 'arrow.triangle.2.circlepath', 100),
  ('2dc197f7-d2bb-5a12-a218-dc8563575426', 'expense', 'category.expense.travel',        'airplane',                    110),
  ('4ed30a44-9f82-578f-828c-b491a25ebdd9', 'expense', 'category.expense.other',         'ellipsis.circle',             120),
  ('a04cc703-9316-52a0-83f3-9b82933c6702', 'income',  'category.income.salary',         'banknote',                     10),
  ('3592beae-a025-5ab2-a0bc-38efb7b6579b', 'income',  'category.income.extra',          'plus.circle',                  20),
  ('ea9f1167-f497-5edf-af01-c7e1c3a64d9d', 'income',  'category.income.other',          'ellipsis.circle',              30);

-- ================================== 5 · RLS ================================
-- ADR-006 §4 y la regla de `AGENTS.md`: ninguna tabla nace sin su policy en la
-- misma migracion, y ninguna policy aplica a PUBLIC.

alter table core.category        enable row level security;
alter table core.movement_detail enable row level security;

-- El cliente ve las de SISTEMA y las SUYAS. Ni una ajena, ni siquiera su
-- existencia: la policy filtra filas, asi que una personalizada de otro no es
-- enumerable ni contable.
--
-- Las INACTIVAS tambien se leen, y es necesario: un movimiento historico que
-- referencia una categoria dada de baja tiene que seguir resolviendo su nombre y
-- su icono. Quien las oculta del selector es la superficie de lectura, que
-- filtra por `is_active`, no la RLS.
grant select on core.category to authenticated;

create policy category_client_select on core.category
  for select to authenticated
  using (owner_user_id is null or owner_user_id = (select auth.uid()));

-- El detalle se ve si se ve algun efecto de su version, que es la misma regla
-- que ya gobierna `core.operation_version`. Se deriva de los efectos y no de la
-- membresia directa para no inventar una segunda nocion de visibilidad.
grant select on core.movement_detail to authenticated;

create policy movement_detail_client_select on core.movement_detail
  for select to authenticated
  using (
    exists (
      select 1 from core.effect e
      where e.operation_version_id = movement_detail.operation_version_id
        and sec.is_member(e.scope_id)
    )
  );

comment on policy movement_detail_client_select on core.movement_detail is
  'Misma regla de visibilidad que core.operation_version: se ve el detalle de una version de la que se ve algun efecto.';
