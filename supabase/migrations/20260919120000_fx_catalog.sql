-- ============================================================================
-- CATALOGO FX Y COBERTURA CURADA · F11/ADR-001 §3.1, §5 · F11/ADR-002 §5
-- Bloque F11.B, M1
-- ============================================================================
--
-- Que trae esta migracion, y nada mas:
--
--   §0  el rol `nomey_fx_ingest` (NOLOGIN, NOBYPASSRLS), sin funciones todavia.
--   §1  `core.fx_source`: la fuente, su pivote y su primera publicacion.
--   §2  `core.fx_coverage`: la correspondencia VERSIONADA definicion -> codigo
--       de la fuente, en intervalos curados de fechas de referencia.
--   §3  privilegios y RLS.
--   §4  la siembra: el BCE y la cobertura de 17 de las 20 definiciones.
--
-- Lo que NO trae: ni observaciones, ni versiones de publicacion, ni dias
-- fijados, ni procedencia, ni resolver, ni ninguna escritura contable. Llegan
-- en las migraciones siguientes de F11.B, cada tabla junto a su unica ruta de
-- escritura. `core.frozen_conversion` no se toca: el writer sigue sin INSERT
-- sobre ella.
--
-- ==================== CATALOGO MONETARIO != COBERTURA FX =====================
--
-- F11/ADR-001 §5.1: `core.currency_definition` NO cambia. La cobertura es un
-- atributo de la FUENTE y se expresa con una correspondencia explicita desde la
-- definicion —la identidad monetaria de Nomey (F02/ADR-001 §3)— hacia el codigo
-- de la fuente. Nunca se resuelve por igualdad de codigos en ejecucion: el
-- codigo ISO de la definicion no interviene en ninguna constraint de aqui.
--
-- ARS, COP y CLP siguen en el catalogo y no tienen ninguna fila: una definicion
-- sin correspondencia no esta cubierta en ningun dia (F11/ADR-002 §5).
--
-- Nada de esta migracion depende de pais, region o ubicacion (F11/ADR-001
-- §5.2): no existe ninguna columna donde pudiera expresarse.
--
-- ============================ QUE ES UN INTERVALO ===========================
--
-- F11/ADR-002 §5: uno o varios intervalos de FECHAS DE REFERENCIA de la fuente,
-- con inicio y fin opcional, y la base y la nota de cada cambio. Semantica
-- CERRADA [valid_from, valid_until]: el fin es la ultima fecha de referencia
-- cubierta (decision de F11.B, aprobada con B1: «R(X) despues del fin» deja el
-- propio fin dentro). Por eso la exclusion usa '[]' y no el '[)' de
-- `core.participant_period`, que modela otra cosa.
--
-- Una retirada registrada es un fin. Prevalece sobre K = 1: si R(X) queda fuera
-- de todo intervalo, la moneda no tiene tipo aunque P(X) la tenga. La definicion
-- retirada SIGUE en el catalogo monetario: esta tabla no tiene ninguna FK que lo
-- impida ni ninguna accion en cascada.
--
-- ============================== INMUTABILIDAD ===============================
--
-- Ningun rol de aplicacion tiene INSERT, UPDATE, DELETE ni TRUNCATE sobre estas
-- tablas. La cobertura es CURADA POR MIGRACION: solo cambia con un fichero
-- versionado y revisado, que es lo que F11/ADR-002 §5 llama «de forma explicita
-- y trazable». Registrar una retirada es una migracion que fija `valid_until` y
-- su base sobre el intervalo abierto; incorporar o reincorporar una moneda es
-- una migracion que inserta un intervalo.
--
-- Pendiente para la migracion de fijacion (B3), y no expresable aqui: el fin de
-- una retirada no puede ser anterior a la ultima fecha de referencia de esa
-- moneda ya usada por alguna fijacion (F11/ADR-002 §5). Hoy no existe ninguna
-- fijacion.
-- ============================================================================

-- ═══════════════════════════════ §0 · el rol ════════════════════════════════
-- Propietario futuro de la ingesta y la fijacion (B3). Mismo molde que
-- `nomey_writer` y `nomey_provisioner`: sin login, sin saltarse la RLS y sin
-- poseer tablas, de modo que sus policies le muerden igual que a cualquiera.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nomey_fx_ingest') then
    create role nomey_fx_ingest nologin nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
end
$$;

comment on role nomey_fx_ingest is
  'Ingesta y fijacion de tipos FX (F11/ADR-002). NOLOGIN, NOBYPASSRLS y no propietario de tablas: la RLS se le aplica igual.';

-- `ALTER FUNCTION ... OWNER TO` exige ser miembro del rol destino (E16). Es el
-- mismo grant que ya tienen los otros dos roles de frontera.
grant nomey_fx_ingest to postgres;

-- ═══════════════════════════════ §1 · la fuente ═════════════════════════════
-- F11/ADR-001 §3.1 y §3.6: una sola fuente, y cualquier otra exige su propio
-- ADR. La tabla existe para que el pivote y la primera publicacion sean DATOS
-- con integridad referencial, no constantes repetidas en cada funcion.

create table core.fx_source (
  id                           text  primary key,
  name                         text  not null,
  -- F11/ADR-001 §5.1: el EUR es el pivote del BCE. Vale 1 y nunca aparece en
  -- las publicaciones.
  pivot_currency_definition_id uuid  not null references core.currency_definition (id),
  -- F11/ADR-002 §1 y §6: sin R(X) antes de esta fecha, la moneda no esta
  -- cubierta (422), nunca «todavia no disponible» (503).
  first_reference_date         date  not null,
  evidence_url                 text  not null,

  constraint fx_source_id_forma check (id ~ '^[a-z][a-z0-9_]*$'),
  constraint fx_source_nombre_no_vacio check (name <> ''),
  constraint fx_source_primera_fecha_finita check (isfinite(first_reference_date)),
  constraint fx_source_evidencia_https check (evidence_url ~ '^https://'),

  -- Destino de la FK compuesta de §2 que ata «sin codigo» a «es el pivote».
  constraint fx_source_pivote_un unique (id, pivot_currency_definition_id)
);

comment on table core.fx_source is
  'Fuente de tipos FX (F11/ADR-001 §3.1). Curada por migracion; ningun rol de aplicacion la escribe.';
comment on column core.fx_source.first_reference_date is
  'Primera fecha de referencia publicada por la fuente. Una fecha efectiva igual o anterior no tiene R(X): FX_CURRENCY_NOT_COVERED (F11/ADR-002 §6).';

-- ═════════════════════════════ §2 · la cobertura ════════════════════════════

create table core.fx_coverage (
  source_id              text  not null references core.fx_source (id),
  currency_definition_id uuid  not null references core.currency_definition (id),
  -- Primera fecha de referencia cubierta por este intervalo, incluida.
  valid_from             date  not null,
  -- Ultima fecha de referencia cubierta, INCLUIDA. Nulo = intervalo abierto.
  valid_until            date,
  -- Codigo de la definicion en la fuente DURANTE este intervalo: la
  -- correspondencia esta versionada por intervalo (F11/ADR-001 §5.1). Nulo solo
  -- para el pivote, que no figura en las publicaciones.
  source_code            text,
  -- F11/ADR-002 §5: la base del cambio y el enlace a la nota de la fuente, para
  -- el inicio y, si existe, para el fin.
  valid_from_basis       text  not null,
  valid_from_evidence    text  not null,
  valid_until_basis      text,
  valid_until_evidence   text,

  -- Solo el pivote carece de codigo. Columna generada para poder expresarlo
  -- como FK: si `source_code` es nulo, la definicion ES el pivote de su fuente.
  pivot_currency_definition_id uuid
    generated always as (case when source_code is null then currency_definition_id end) stored,

  constraint fx_coverage_pk primary key (source_id, currency_definition_id, valid_from),

  constraint fx_coverage_sin_codigo_es_el_pivote
    foreign key (source_id, pivot_currency_definition_id)
    references core.fx_source (id, pivot_currency_definition_id),

  -- F11/ADR-002 §2, condicion 4: tres letras mayusculas.
  constraint fx_coverage_codigo_forma
    check (source_code is null or source_code ~ '^[A-Z]{3}$'),

  constraint fx_coverage_fechas_finitas
    check (isfinite(valid_from) and (valid_until is null or isfinite(valid_until))),

  -- Intervalo cerrado: puede empezar y terminar el mismo dia, nunca al reves.
  constraint fx_coverage_rango_valido
    check (valid_until is null or valid_until >= valid_from),

  -- Un fin sin base ni nota no es trazable; una base de fin sin fin no
  -- significa nada.
  constraint fx_coverage_fin_documentado
    check ((valid_until is null) = (valid_until_basis is null)
       and (valid_until is null) = (valid_until_evidence is null)),

  constraint fx_coverage_base_no_vacia
    check (valid_from_basis <> '' and (valid_until_basis is null or valid_until_basis <> '')),

  constraint fx_coverage_evidencia_https
    check (valid_from_evidence ~ '^https://'
       and (valid_until_evidence is null or valid_until_evidence ~ '^https://')),

  -- Sin solapes para una misma definicion: en cada fecha de referencia hay como
  -- mucho un intervalo, y por tanto un solo codigo. '[]' porque el fin esta
  -- incluido: un intervalo que termina el dia D y otro que empieza el dia D SE
  -- SOLAPAN.
  constraint fx_coverage_sin_solapes
    exclude using gist (
      source_id WITH =,
      currency_definition_id WITH =,
      daterange(valid_from, valid_until, '[]') WITH &&
    ),

  -- Y un mismo codigo de la fuente no corresponde a dos definiciones a la vez:
  -- el tipo publicado para ese codigo en una fecha tendria dos duenos.
  constraint fx_coverage_codigo_sin_solapes
    exclude using gist (
      source_id WITH =,
      source_code WITH =,
      daterange(valid_from, valid_until, '[]') WITH &&
    ) where (source_code is not null)
);

comment on table core.fx_coverage is
  'Cobertura curada: definicion monetaria -> codigo de la fuente, en intervalos cerrados de fechas de referencia (F11/ADR-002 §5). Sin fila = sin cobertura.';
comment on column core.fx_coverage.valid_until is
  'Ultima fecha de referencia cubierta, INCLUIDA. Nulo = abierto. Una retirada registrada fija este fin.';
comment on column core.fx_coverage.source_code is
  'Codigo de la fuente durante el intervalo. Nulo solo para el pivote de la fuente.';
comment on column core.fx_coverage.pivot_currency_definition_id is
  'Generada: la definicion si el intervalo no tiene codigo. Solo existe para la FK que lo ata al pivote de la fuente.';

-- ═════════════════════════ §3 · privilegios y RLS ═══════════════════════════
-- Regla dura: ninguna tabla de `core` nace sin RLS.

alter table core.fx_source   enable row level security;
alter table core.fx_coverage enable row level security;

-- Los roles cliente no reciben nada: ni grant ni policy. `authenticated` ni
-- siquiera tiene USAGE sobre `core` (F03/ADR-002). La cobertura llegara al
-- cliente, si llega, por una superficie de `api` de F11.C.
--
-- Solo LECTURA para los dos roles que la necesitan, y ninguna escritura para
-- nadie salvo el propietario, que es quien ejecuta las migraciones:
--
--   · nomey_fx_ingest: la fijacion del dia X decide, por moneda, si R(X) cae
--     dentro de su cobertura (B3).
--   · nomey_writer: el resolver de los dos writers personales comprueba la
--     correspondencia antes que el dia fijado (F11/ADR-002 §6, paso 5; B4-B5).
--
-- Cada SELECT lleva su policy en la misma migracion: E21 midio que un grant sin
-- policy aplicable devuelve cero filas sin error, y aqui eso declararia «no
-- cubierta» a una moneda cubierta.

grant usage on schema core to nomey_fx_ingest;

grant select on core.fx_source   to nomey_writer, nomey_fx_ingest;
grant select on core.fx_coverage to nomey_writer, nomey_fx_ingest;

-- Catalogo publico por naturaleza para quien ya puede leerlo: sin filtro de
-- filas. Ninguna de las dos aplica a PUBLIC.
create policy fx_source_read on core.fx_source
  for select to nomey_writer, nomey_fx_ingest
  using (true);

create policy fx_coverage_read on core.fx_coverage
  for select to nomey_writer, nomey_fx_ingest
  using (true);

-- Sin INSERT, UPDATE, DELETE ni TRUNCATE para ningun rol de aplicacion, y sin
-- policies de escritura. La ausencia es la decision.

-- ═══════════════════════════════ §4 · siembra ═══════════════════════════════
-- Medido el 2026-09-15 sobre eurofxref-hist.xml (7093 publicaciones, de
-- 1999-01-04 a 2026-09-15): cada codigo de abajo aparece en TODAS las
-- publicaciones desde su primera fecha, sin ningun hueco. Ninguna de las 17
-- definiciones cubiertas tiene hoy una retirada registrada: las retiradas
-- conocidas del BCE (BGN, HRK, RUB) y el hueco de ISK son de monedas que no
-- estan en el catalogo de Nomey.
--
-- RON empieza el 2005-07-01. Hasta el 2005-06-30 el BCE publico ROL, que es otra
-- moneda y no tiene definicion en Nomey: RON nunca usa un tipo de ROL.

insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url)
values (
  'ecb',
  'Tipos de referencia del euro del Banco Central Europeo',
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe',  -- EUR
  '1999-01-04',
  'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'
);

insert into core.fx_coverage
  (source_id, currency_definition_id, source_code, valid_from, valid_from_basis, valid_from_evidence)
select 'ecb', c.id, c.source_code, c.valid_from::date, c.basis,
       'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
from (values
  -- El pivote: sin codigo, cubierto desde la primera publicacion.
  ('830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid, null::text, '1999-01-04',
     'Pivote de la fuente: vale 1 desde la primera publicacion'),
  ('34cb8424-2243-52d8-be99-e2b7d22884b8', 'USD', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('fe22eeff-f72b-50ce-9b37-6033833df95e', 'GBP', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('c8483062-e215-5da5-850e-cd7bfda52eff', 'CHF', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('f981b2f9-a022-5de8-aa6d-3af277d9dcd3', 'JPY', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('6cfbf3ad-967d-50ba-9822-f1afbb10f7f5', 'CAD', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('c9203a94-12aa-5d7f-8703-2ee17e524dca', 'AUD', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('c3d5768c-33be-5ab8-896e-38203ac5cc48', 'NZD', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('f725bdd8-5690-53a8-85c0-eabed7405c10', 'SEK', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('f2fe8324-641c-548d-b3af-411db0d39448', 'NOK', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('31f1a13d-3829-5af9-9b65-e5da1181b9ac', 'DKK', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('a280144a-a4a0-55cd-98db-7b8acf25a638', 'PLN', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('d281d5cf-cdd5-5207-93a5-df1f80e6de84', 'CZK', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('8b951c59-bbd1-539b-9336-4174fbf47bdb', 'HUF', '1999-01-04', 'Publicado desde la primera publicacion'),
  ('8b33cd38-5e20-5145-bee9-c0b81c9a81ba', 'RON', '2005-07-01',
     'Primera publicacion de RON; hasta 2005-06-30 el BCE publicaba ROL, que no es esta definicion'),
  ('b500e177-a2ff-5a55-b0b6-868dc91a10f6', 'MXN', '2008-01-02', 'Primera publicacion de MXN'),
  ('50850a6c-39ff-5f35-85aa-afd6ea3732e6', 'BRL', '2008-01-02', 'Primera publicacion de BRL')
) as c (id, source_code, valid_from, basis);

-- ARS (6cbdabc6-...), COP (3304aa15-...) y CLP (a85ae854-...): sin fila, a
-- proposito. El BCE no las publica (F11/ADR-001 §5.1, medido el 2026-09-13).
