-- ============================================================================
-- INGESTA Y FIJACION DEL TIPO DEL DIA · F11/ADR-002 §1-§5 · Bloque F11.B, M2
-- ============================================================================
--
-- Parte del estado que dejo 20260922120000 (catalogo y cobertura curada).
--
--   §0  las tablas de la ingesta y la fijacion, cada una con su RLS:
--         core.fx_observation              cada lectura de la fuente
--         core.fx_publication              cada VERSION de una fecha de referencia
--         core.fx_publication_rate         los tipos de una version
--         core.fx_observation_publication  que versiones contenia cada lectura
--         core.fx_day                      el dia X, fijado una sola vez
--         core.fx_day_rate                 el tipo de cada moneda ese dia
--   §1  privilegios y policies: solo `nomey_fx_ingest` escribe, y solo INSERT.
--   §2  sec.fx_ingest_at y sec.fx_ingest, la unica ruta de escritura.
--   §3  la guarda de la cobertura curada: una retirada no puede dejar fuera de
--       cobertura una fecha que una fijacion ya uso (F11/ADR-002 §5).
--
-- Lo que NO trae: ni resolver, ni lectura para el writer, ni conversion, ni
-- procedencia, ni superficie de `api`. `core.frozen_conversion` no se toca.
--
-- ================================ AUTORIDAD ================================
--
-- F11/ADR-002 decision 1: MANDA LA OBSERVACION DE NOMEY. La hora de la
-- observacion es el reloj del servidor en la transaccion que ingiere; quien
-- llama nunca la aporta para la fuente real. `Last-Modified` y `ETag` se
-- guardan como evidencia y no intervienen en nada.
--
-- Una observacion INCOMPLETA (§2) se registra con su motivo y no escribe nada
-- mas: ni versiones ni dias. Un dia ya fijado no cambia nunca: no hay UPDATE
-- ni DELETE para nadie salvo el propietario.
--
-- ============================ QUE ES «EL DIA X» ============================
--
-- X es una fecha efectiva. Se fija con la primera observacion completa hecha a
-- partir de las 00:00 de X en Europe/Berlin (F11/ADR-001 §3.2, F11/ADR-002 §4).
-- Para esa observacion:
--
--   R(X) = la fecha de referencia mas reciente estrictamente anterior a X;
--   P(X) = la inmediatamente anterior a R(X), si R(X) no es la primera de la
--          fuente. Si la observacion no contiene P(X), NO fija X (condicion 7):
--          el dia sigue sin fijar, y la observacion es igualmente completa.
--
-- Por moneda con cobertura cuyo intervalo contiene R(X): el pivote vale 1; si
-- no, su tipo en R(X) o, si falta y P(X) no es anterior al inicio de su
-- intervalo, su tipo en P(X). Si no, NO HAY FILA: esa moneda no tiene tipo ese
-- dia (422), y eso tambien queda fijado porque el dia no vuelve a fijarse.
-- Es la misma regla que `selectDayRate` en src/domain/fx/day-rate.ts.
--
-- Los dias iguales o anteriores a la primera publicacion de la fuente no se
-- fijan nunca: no tienen R(X), y el resolver responde 422 por regla.
-- ============================================================================

-- ═════════════════════════════ §0 · las tablas ══════════════════════════════

create table core.fx_observation (
  id                    uuid        primary key default gen_random_uuid(),
  source_id             text        not null references core.fx_source (id),
  -- Reloj del servidor en la transaccion que ingiere (salvo en fuentes de
  -- prueba, ver sec.fx_ingest_at).
  observed_at           timestamptz not null,
  -- Evidencia de la descarga (condicion 1). No es autoridad de nada.
  document_url          text        not null,
  http_status           integer     not null,
  last_modified         text,
  etag                  text,
  document_sha256       text        not null,
  document_bytes        integer     not null,
  -- Ventana del documento; nula si no llego a leerse.
  first_reference_date  date,
  last_reference_date   date,
  reference_date_count  integer     not null default 0,
  -- La validez SI es autoridad: solo una observacion completa fija dias.
  complete              boolean     not null,
  invalid_reason        text,

  constraint fx_observation_fuente_un unique (id, source_id),
  -- La URL que se leyo, sea o no la oficial: si no lo es, la observacion es
  -- incompleta y la URL queda como evidencia de por que.
  constraint fx_observation_url_no_vacia check (document_url <> ''),
  constraint fx_observation_estado_http check (http_status between 100 and 599),
  constraint fx_observation_hash_forma check (document_sha256 ~ '^[0-9a-f]{64}$'),
  constraint fx_observation_tamano check (document_bytes >= 0),
  constraint fx_observation_hora_finita check (isfinite(observed_at)),
  constraint fx_observation_motivo_si_incompleta
    check (complete = (invalid_reason is null)),
  constraint fx_observation_ventana_si_completa
    check (not complete
           or (first_reference_date is not null and last_reference_date is not null
               and first_reference_date <= last_reference_date
               and reference_date_count > 0)),
  -- Vocabulario cerrado: cada motivo es una condicion de F11/ADR-002 §2.
  constraint fx_observation_motivo_conocido check (invalid_reason is null or invalid_reason in (
    'http_not_ok',                   -- 1
    'unexpected_url',                -- 1
    'empty_document',                -- 1
    'doctype_present',               -- 2
    'not_well_formed',               -- 2
    'not_source_document',           -- 2
    'unexpected_structure',          -- 2
    'no_reference_dates',            -- 3
    'reference_date_invalid',        -- 3
    'reference_date_duplicated',     -- 3
    'reference_date_in_future',      -- 3
    'reference_date_before_source',  -- 3
    'reference_date_without_rates',  -- 3
    'currency_code_invalid',         -- 4
    'currency_code_duplicated',      -- 4
    'rate_decimal_invalid',          -- 4
    'rate_not_positive',             -- 4
    'rate_out_of_range',             -- 4
    'gap_from_source_start',         -- 5
    'gap_after_stored',              -- 5
    'older_than_stored',             -- 6
    'stored_date_missing'            -- 6
  ))
);

comment on table core.fx_observation is
  'Cada lectura de la fuente (F11/ADR-002 §1-§2). Insert-only. Solo una observacion completa escribe versiones y fija dias.';
comment on column core.fx_observation.last_modified is
  'Evidencia HTTP. Nunca autoridad (F11/ADR-002, decision 1).';

create table core.fx_publication (
  id                    uuid  primary key default gen_random_uuid(),
  source_id             text  not null references core.fx_source (id),
  reference_date        date  not null,
  -- sha256 del contenido NORMALIZADO: codigo, coeficiente y escala de cada
  -- tipo, ordenados. Dos textos del mismo valor (0.85580 y 0.8558) son la
  -- misma version; un valor distinto es una version nueva (una enmienda).
  content_sha256        text  not null,
  rate_count            integer not null,
  first_observation_id  uuid  not null,

  constraint fx_publication_version_un unique (source_id, reference_date, content_sha256),
  constraint fx_publication_fuente_un unique (id, source_id),
  constraint fx_publication_fecha_un unique (id, source_id, reference_date),
  constraint fx_publication_primera_observacion
    foreign key (first_observation_id, source_id) references core.fx_observation (id, source_id),
  constraint fx_publication_hash_forma check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint fx_publication_con_tipos check (rate_count > 0),
  constraint fx_publication_fecha_finita check (isfinite(reference_date))
);

comment on table core.fx_publication is
  'Version de una fecha de referencia, identificada por su contenido (F11/ADR-002 §1). Inmutable.';

create table core.fx_publication_rate (
  publication_id  uuid     not null references core.fx_publication (id),
  source_code     text     not null,
  -- El mismo tipo exacto que sourceDecimalToRate (src/domain/fx/source-decimal.ts):
  -- ceros finales fuera, escala maxima 12, coeficiente > 0 que cabe en 64 bits.
  coefficient     bigint   not null,
  scale           smallint not null,
  -- El texto tal como lo publico la fuente: evidencia, nunca se usa para calcular.
  source_text     text     not null,

  constraint fx_publication_rate_pk primary key (publication_id, source_code),
  constraint fx_publication_rate_codigo_forma check (source_code ~ '^[A-Z]{3}$'),
  constraint fx_publication_rate_coeficiente_positivo check (coefficient > 0),
  constraint fx_publication_rate_escala_acotada check (scale between 0 and 12),
  constraint fx_publication_rate_texto_forma check (source_text ~ '^[0-9]+(\.[0-9]+)?$')
);

comment on table core.fx_publication_rate is
  'Tipos de una version: unidades de la moneda por una unidad del pivote, como (coeficiente, escala) exactos.';

create table core.fx_observation_publication (
  observation_id  uuid not null,
  publication_id  uuid not null,
  source_id       text not null,

  constraint fx_observation_publication_pk primary key (observation_id, publication_id),
  constraint fx_observation_publication_observacion
    foreign key (observation_id, source_id) references core.fx_observation (id, source_id),
  constraint fx_observation_publication_version
    foreign key (publication_id, source_id) references core.fx_publication (id, source_id)
);

create index fx_observation_publication_por_version on core.fx_observation_publication (publication_id);

comment on table core.fx_observation_publication is
  'Que version de cada fecha contenia cada observacion completa. Es lo que permite reproducir una fijacion (F11/ADR-002 §2, condicion 6).';

create table core.fx_day (
  source_id                text        not null references core.fx_source (id),
  day                      date        not null,
  -- R(X) y P(X) de la observacion que fijo el dia.
  reference_date           date        not null,
  previous_reference_date  date,
  observation_id           uuid        not null,
  fixed_at                 timestamptz not null default now(),

  constraint fx_day_pk primary key (source_id, day),
  constraint fx_day_observacion
    foreign key (observation_id, source_id) references core.fx_observation (id, source_id),
  constraint fx_day_fecha_finita check (isfinite(day)),
  -- Nunca una publicacion de fecha X o posterior (F11/ADR-002 §3).
  constraint fx_day_r_anterior check (reference_date < day),
  constraint fx_day_p_anterior check (previous_reference_date is null or previous_reference_date < reference_date),

  -- Destinos de las FK de fx_day_rate: la fecha usada por una moneda es R(X) o
  -- P(X) de SU dia, y la version pertenece a la observacion que lo fijo.
  constraint fx_day_r_un unique (source_id, day, reference_date),
  constraint fx_day_p_un unique (source_id, day, previous_reference_date),
  constraint fx_day_observacion_un unique (source_id, day, observation_id)
);

comment on table core.fx_day is
  'Dia X fijado una sola vez por la primera observacion completa posterior a las 00:00 de X en Francfort (F11/ADR-002 §4). Sin fila: no fijado (503) o sin R(X) (422).';

create table core.fx_day_rate (
  source_id               text  not null,
  day                     date  not null,
  currency_definition_id  uuid  not null references core.currency_definition (id),
  -- De donde sale el tipo: R(X), P(X) o el pivote (que vale 1).
  position                text  not null,
  reference_date          date  not null,
  observation_id          uuid  not null,
  publication_id          uuid,
  source_code             text,

  r_reference_date date generated always as
    (case when position in ('R', 'pivot') then reference_date end) stored,
  p_reference_date date generated always as
    (case when position = 'P' then reference_date end) stored,
  pivot_currency_definition_id uuid generated always as
    (case when position = 'pivot' then currency_definition_id end) stored,

  constraint fx_day_rate_pk primary key (source_id, day, currency_definition_id),
  constraint fx_day_rate_dia
    foreign key (source_id, day, observation_id) references core.fx_day (source_id, day, observation_id),
  constraint fx_day_rate_posicion check (position in ('R', 'P', 'pivot')),
  -- El pivote no tiene version ni codigo; las demas, las dos cosas.
  constraint fx_day_rate_pivote_sin_version
    check ((position = 'pivot') = (publication_id is null)
       and (publication_id is null) = (source_code is null)),

  -- La fecha es R(X) o P(X) de ese dia, segun la posicion.
  constraint fx_day_rate_fecha_r
    foreign key (source_id, day, r_reference_date) references core.fx_day (source_id, day, reference_date),
  constraint fx_day_rate_fecha_p
    foreign key (source_id, day, p_reference_date) references core.fx_day (source_id, day, previous_reference_date),
  -- Solo el pivote de la fuente puede ser pivote.
  constraint fx_day_rate_pivote_de_la_fuente
    foreign key (source_id, pivot_currency_definition_id)
    references core.fx_source (id, pivot_currency_definition_id),
  -- La version es de esa fuente y de esa fecha, la contenia la observacion que
  -- fijo el dia, y trae ese codigo.
  constraint fx_day_rate_version_de_la_fecha
    foreign key (publication_id, source_id, reference_date)
    references core.fx_publication (id, source_id, reference_date),
  constraint fx_day_rate_version_observada
    foreign key (observation_id, publication_id)
    references core.fx_observation_publication (observation_id, publication_id),
  constraint fx_day_rate_tipo_existente
    foreign key (publication_id, source_code)
    references core.fx_publication_rate (publication_id, source_code)
);

comment on table core.fx_day_rate is
  'Tipo de una moneda el dia X (F11/ADR-002 §3). Referencia la version usada, sin copiar valores. Sin fila en un dia fijado: la moneda no tiene tipo ese dia (422).';

-- ════════════════════════ §1 · privilegios y policies ═══════════════════════
-- Regla dura: ninguna tabla de `core` nace sin RLS.

alter table core.fx_observation             enable row level security;
alter table core.fx_publication             enable row level security;
alter table core.fx_publication_rate        enable row level security;
alter table core.fx_observation_publication enable row level security;
alter table core.fx_day                     enable row level security;
alter table core.fx_day_rate                enable row level security;

-- Solo la ingesta, y solo lectura e insercion. Nadie mas recibe nada aqui: la
-- lectura del writer llega con el resolver (M3), junto a su ruta.
grant usage on schema sec to nomey_fx_ingest;

grant select, insert on core.fx_observation             to nomey_fx_ingest;
grant select, insert on core.fx_publication             to nomey_fx_ingest;
grant select, insert on core.fx_publication_rate        to nomey_fx_ingest;
grant select, insert on core.fx_observation_publication to nomey_fx_ingest;
grant select, insert on core.fx_day                     to nomey_fx_ingest;
grant select, insert on core.fx_day_rate                to nomey_fx_ingest;

-- La ingesta lee lo guardado (condiciones 5 y 6, versiones ya vistas, dias ya
-- fijados): lectura completa.
create policy fx_observation_ingest_read on core.fx_observation
  for select to nomey_fx_ingest using (true);
create policy fx_publication_ingest_read on core.fx_publication
  for select to nomey_fx_ingest using (true);
create policy fx_publication_rate_ingest_read on core.fx_publication_rate
  for select to nomey_fx_ingest using (true);
create policy fx_observation_publication_ingest_read on core.fx_observation_publication
  for select to nomey_fx_ingest using (true);
create policy fx_day_ingest_read on core.fx_day
  for select to nomey_fx_ingest using (true);
create policy fx_day_rate_ingest_read on core.fx_day_rate
  for select to nomey_fx_ingest using (true);

-- Registrar una observacion, completa o no, es siempre posible: es evidencia.
create policy fx_observation_ingest_insert on core.fx_observation
  for insert to nomey_fx_ingest with check (true);

-- SEGUNDA BARRERA: nada que derive de una observacion incompleta puede
-- escribirse, aunque la funcion fallara. Las FK ya atan fuente, version y dia;
-- esto ata la VALIDEZ, que ninguna FK expresa.
create policy fx_publication_ingest_insert on core.fx_publication
  for insert to nomey_fx_ingest
  with check (exists (select 1 from core.fx_observation o
                       where o.id = fx_publication.first_observation_id and o.complete));

create policy fx_observation_publication_ingest_insert on core.fx_observation_publication
  for insert to nomey_fx_ingest
  with check (exists (select 1 from core.fx_observation o
                       where o.id = fx_observation_publication.observation_id and o.complete));

create policy fx_publication_rate_ingest_insert on core.fx_publication_rate
  for insert to nomey_fx_ingest
  with check (exists (select 1 from core.fx_publication p
                        join core.fx_observation o on o.id = p.first_observation_id
                       where p.id = fx_publication_rate.publication_id and o.complete));

-- Un dia se fija con una observacion completa, y no antes de las 00:00 de ese
-- dia en Europe/Berlin (F11/ADR-001 §3.2).
create policy fx_day_ingest_insert on core.fx_day
  for insert to nomey_fx_ingest
  with check (exists (select 1 from core.fx_observation o
                       where o.id = fx_day.observation_id and o.complete
                         and o.observed_at >= (fx_day.day::timestamp at time zone 'Europe/Berlin')));

create policy fx_day_rate_ingest_insert on core.fx_day_rate
  for insert to nomey_fx_ingest with check (true);

-- Sin UPDATE, DELETE ni TRUNCATE para nadie salvo el propietario.

-- ═══════════════════ §2 · la unica ruta de escritura ═════════════════════════

-- Ingesta con un instante explicito. Existe para las pruebas, que necesitan
-- fijar dias concretos con documentos sinteticos, y por eso NO acepta otro
-- instante que now() para la fuente real: una observacion del BCE nunca lleva
-- una hora que no sea la del servidor. Las pruebas usan fuentes de fixture.
--
-- Nunca captura excepciones. Lo que un documento tenga de malo se detecta con
-- predicados que no lanzan (xml_is_well_formed_document, expresiones
-- regulares, pg_input_is_valid) y se REGISTRA como observacion incompleta; lo
-- que lanza es un error de programacion de quien llama.
create function sec.fx_ingest_at(
  p_source       text,
  p_document     text,
  p_evidence     jsonb,
  p_observed_at  timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_ns   constant text[] := array[array['g', 'http://www.gesmes.org/xml/2002-08-01'],
                                  array['e', 'http://www.ecb.int/vocabulary/2002-08-01/eurofxref']];
  c_urls constant text[] := array['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
                                  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
                                  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'];
  c_int64_max constant numeric := 9223372036854775807;
  v_first       date;
  v_today       date;
  v_url         text;
  v_status      integer;
  v_doc         xml;
  v_reason      text;
  v_min         date;
  v_max         date;
  v_count       integer := 0;
  v_stored_max  date;
  v_obs         uuid;
  v_versions    integer := 0;
  v_days        integer := 0;
  v_rates       integer := 0;
  v_unfixed     integer := 0;
begin
  -- ── llamada ────────────────────────────────────────────────────────────
  if p_source is null or p_document is null or p_evidence is null or p_observed_at is null then
    raise exception 'sec.fx_ingest_at: argumentos nulos' using errcode = '22004';
  end if;
  if jsonb_typeof(p_evidence) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_evidence) k
                 where k not in ('url', 'status', 'last_modified', 'etag'))
     or jsonb_typeof(p_evidence -> 'url') is distinct from 'string'
     or p_evidence ->> 'url' = ''
     or jsonb_typeof(p_evidence -> 'status') is distinct from 'number'
     or coalesce(jsonb_typeof(p_evidence -> 'last_modified'), 'string') not in ('string', 'null')
     or coalesce(jsonb_typeof(p_evidence -> 'etag'), 'string') not in ('string', 'null') then
    raise exception 'sec.fx_ingest_at: evidencia HTTP mal formada' using errcode = '22023';
  end if;
  v_url := p_evidence ->> 'url';
  if (p_evidence ->> 'status') !~ '^[0-9]{3}$' then
    raise exception 'sec.fx_ingest_at: estado HTTP mal formado' using errcode = '22023';
  end if;
  v_status := (p_evidence ->> 'status')::integer;
  if not isfinite(p_observed_at) then
    raise exception 'sec.fx_ingest_at: instante no finito' using errcode = '22023';
  end if;
  -- El instante del dia y la lectura de lo guardado dependen de ver lo que
  -- confirmo la ingesta anterior DESPUES de tomar el candado.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'sec.fx_ingest_at exige READ COMMITTED' using errcode = '25000';
  end if;

  select s.first_reference_date into v_first from core.fx_source s where s.id = p_source;
  if not found then
    raise exception 'sec.fx_ingest_at: la fuente % no existe', p_source using errcode = '23503';
  end if;
  if p_source = 'ecb' and p_observed_at <> now() then
    raise exception 'sec.fx_ingest_at: la fuente real solo se observa con el reloj del servidor'
      using errcode = '42501';
  end if;

  -- Una ingesta por fuente a la vez. La segunda espera y, al entrar, ve los
  -- dias que fijo la primera.
  perform pg_advisory_xact_lock(hashtextextended('nomey.fx_ingest:' || p_source, 0));

  v_today := (p_observed_at at time zone 'Europe/Berlin')::date;

  -- ── condicion 1 · llego bien ───────────────────────────────────────────
  if v_status <> 200 then
    v_reason := 'http_not_ok';
  elsif not (v_url = any (c_urls)) then
    v_reason := 'unexpected_url';
  elsif p_document = '' then
    v_reason := 'empty_document';
  -- ── condicion 2 · documento entero, bien formado y de la fuente ───────
  -- Sin DTD: no se expanden entidades externas (medido en B0), pero un
  -- documento de la fuente no la trae y no hay motivo para admitirla.
  elsif p_document ~* '<!(DOCTYPE|ENTITY)' then
    v_reason := 'doctype_present';
  elsif not xml_is_well_formed_document(p_document) then
    v_reason := 'not_well_formed';
  end if;

  if v_reason is null then
    v_doc := xmlparse(document p_document);
    if (xpath('local-name(/*)', v_doc))[1]::text <> 'Envelope'
       or (xpath('namespace-uri(/*)', v_doc))[1]::text <> c_ns[1][2]
       or (xpath('count(/g:Envelope/g:Sender/g:name)', v_doc, c_ns))[1]::text <> '1'
       or coalesce((xpath('/g:Envelope/g:Sender/g:name/text()', v_doc, c_ns))[1]::text, '')
          <> 'European Central Bank'
       or (xpath('count(/g:Envelope/e:Cube)', v_doc, c_ns))[1]::text <> '1' then
      v_reason := 'not_source_document';
    -- Bajo el Cube raiz solo hay dias con fecha; bajo cada dia, solo tipos con
    -- codigo y valor; y nada por debajo de un tipo.
    elsif (xpath('count(/g:Envelope/e:Cube/*) = count(/g:Envelope/e:Cube/e:Cube[@time])'
                 || ' and count(/g:Envelope/e:Cube/*/*) = count(/g:Envelope/e:Cube/e:Cube/e:Cube[@currency][@rate])'
                 || ' and count(/g:Envelope/e:Cube/*/*/*) = 0',
                 v_doc, c_ns))[1]::text <> 'true' then
      v_reason := 'unexpected_structure';
    end if;
  end if;

  -- ── extraccion, una sola vez ──────────────────────────────────────────
  -- Tablas de trabajo de la transaccion, borradas al confirmar. Una segunda
  -- ingesta en la misma transaccion las reutiliza vacias.
  if to_regclass('pg_temp.fx_ingest_day') is null then
    create temp table fx_ingest_day (ref text) on commit drop;
    create temp table fx_ingest_rate (ref text, code text, rate text) on commit drop;
    create temp table fx_ingest_version
      (ref date, sha text, rate_count integer, publication_id uuid) on commit drop;
  end if;
  truncate pg_temp.fx_ingest_day, pg_temp.fx_ingest_rate, pg_temp.fx_ingest_version;

  if v_reason is null then
    insert into pg_temp.fx_ingest_day (ref)
    select x.ref
      from xmltable(xmlnamespaces('http://www.gesmes.org/xml/2002-08-01' as g,
                                  'http://www.ecb.int/vocabulary/2002-08-01/eurofxref' as e),
                    '/g:Envelope/e:Cube/e:Cube' passing v_doc
                    columns ref text path '@time') x;
    insert into pg_temp.fx_ingest_rate (ref, code, rate)
    select x.ref, x.code, x.rate
      from xmltable(xmlnamespaces('http://www.gesmes.org/xml/2002-08-01' as g,
                                  'http://www.ecb.int/vocabulary/2002-08-01/eurofxref' as e),
                    '/g:Envelope/e:Cube/e:Cube/e:Cube' passing v_doc
                    columns ref  text path '../@time',
                            code text path '@currency',
                            rate text path '@rate') x;

    -- ── condicion 3 · fechas coherentes ──────────────────────────────────
    select count(*) into v_count from pg_temp.fx_ingest_day;
    if v_count = 0 then
      v_reason := 'no_reference_dates';
    elsif exists (select 1 from pg_temp.fx_ingest_day d
                   where d.ref is null or d.ref !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                      or not pg_input_is_valid(d.ref, 'date')) then
      v_reason := 'reference_date_invalid';
    elsif exists (select 1 from pg_temp.fx_ingest_day d group by d.ref having count(*) > 1) then
      v_reason := 'reference_date_duplicated';
    elsif exists (select 1 from pg_temp.fx_ingest_day d where d.ref::date > v_today) then
      v_reason := 'reference_date_in_future';
    elsif exists (select 1 from pg_temp.fx_ingest_day d where d.ref::date < v_first) then
      v_reason := 'reference_date_before_source';
    elsif exists (select 1 from pg_temp.fx_ingest_day d
                   where not exists (select 1 from pg_temp.fx_ingest_rate r where r.ref = d.ref)) then
      v_reason := 'reference_date_without_rates';
    -- ── condicion 4 · todos los tipos presentes son validos ──────────────
    elsif exists (select 1 from pg_temp.fx_ingest_rate r
                   where r.code is null or r.code !~ '^[A-Z]{3}$') then
      v_reason := 'currency_code_invalid';
    elsif exists (select 1 from pg_temp.fx_ingest_rate r group by r.ref, r.code having count(*) > 1) then
      v_reason := 'currency_code_duplicated';
    -- Misma regla que sourceDecimalToRate: forma, como mucho 12 decimales
    -- significativos, mayor que cero y dentro de 64 bits.
    elsif exists (select 1 from pg_temp.fx_ingest_rate r
                   where r.rate is null or r.rate !~ '^[0-9]+(\.[0-9]+)?$'
                      or length(rtrim(split_part(r.rate, '.', 2), '0')) > 12) then
      v_reason := 'rate_decimal_invalid';
    elsif exists (select 1 from pg_temp.fx_ingest_rate r
                   where ltrim(split_part(r.rate, '.', 1) || rtrim(split_part(r.rate, '.', 2), '0'), '0') = '') then
      v_reason := 'rate_not_positive';
    elsif exists (select 1 from pg_temp.fx_ingest_rate r
                   where (split_part(r.rate, '.', 1) || rtrim(split_part(r.rate, '.', 2), '0'))::numeric
                         > c_int64_max) then
      v_reason := 'rate_out_of_range';
    end if;
  end if;

  if v_reason is null then
    select min(d.ref::date), max(d.ref::date) into v_min, v_max from pg_temp.fx_ingest_day d;
    select max(p.reference_date) into v_stored_max
      from core.fx_publication p where p.source_id = p_source;

    -- ── condicion 5 · sin huecos respecto a lo guardado ──────────────────
    if v_stored_max is null and v_min <> v_first then
      v_reason := 'gap_from_source_start';
    elsif v_stored_max is not null and v_min > v_stored_max then
      v_reason := 'gap_after_stored';
    -- ── condicion 6 · no mas viejo que lo guardado ────────────────────────
    elsif v_stored_max is not null and v_max < v_stored_max then
      v_reason := 'older_than_stored';
    elsif exists (select 1 from core.fx_publication p
                   where p.source_id = p_source
                     and p.reference_date between v_min and v_max
                     and not exists (select 1 from pg_temp.fx_ingest_day d
                                      where d.ref::date = p.reference_date)) then
      v_reason := 'stored_date_missing';
    end if;
  end if;

  -- ── la observacion, completa o no ─────────────────────────────────────
  insert into core.fx_observation
    (source_id, observed_at, document_url, http_status, last_modified, etag,
     document_sha256, document_bytes, first_reference_date, last_reference_date,
     reference_date_count, complete, invalid_reason)
  values
    (p_source, p_observed_at, v_url, v_status,
     p_evidence ->> 'last_modified', p_evidence ->> 'etag',
     encode(sha256(convert_to(p_document, 'UTF8')), 'hex'), octet_length(p_document),
     case when v_reason is null then v_min end,
     case when v_reason is null then v_max end,
     case when v_reason is null then v_count else 0 end,
     v_reason is null, v_reason)
  returning id into v_obs;

  if v_reason is not null then
    return jsonb_build_object('observation_id', v_obs, 'complete', false, 'reason', v_reason);
  end if;

  -- ── versiones ─────────────────────────────────────────────────────────
  insert into pg_temp.fx_ingest_version (ref, sha, rate_count)
  select n.ref,
         encode(sha256(convert_to(string_agg(n.code || '=' || n.coefficient || 'e' || n.scale, ';'
                                             order by n.code), 'UTF8')), 'hex'),
         count(*)
    from (select r.ref::date as ref, r.code,
                 (split_part(r.rate, '.', 1) || rtrim(split_part(r.rate, '.', 2), '0'))::bigint as coefficient,
                 length(rtrim(split_part(r.rate, '.', 2), '0')) as scale
            from pg_temp.fx_ingest_rate r) n
   group by n.ref;

  insert into core.fx_publication (source_id, reference_date, content_sha256, rate_count, first_observation_id)
  select p_source, v.ref, v.sha, v.rate_count, v_obs
    from pg_temp.fx_ingest_version v
   order by v.ref
  on conflict (source_id, reference_date, content_sha256) do nothing;
  get diagnostics v_versions = row_count;

  update pg_temp.fx_ingest_version v
     set publication_id = p.id
    from core.fx_publication p
   where p.source_id = p_source and p.reference_date = v.ref and p.content_sha256 = v.sha;

  insert into core.fx_publication_rate (publication_id, source_code, coefficient, scale, source_text)
  select p.id, r.code,
         (split_part(r.rate, '.', 1) || rtrim(split_part(r.rate, '.', 2), '0'))::bigint,
         length(rtrim(split_part(r.rate, '.', 2), '0')),
         r.rate
    from pg_temp.fx_ingest_rate r
    join core.fx_publication p
      on p.source_id = p_source and p.reference_date = r.ref::date and p.first_observation_id = v_obs;

  insert into core.fx_observation_publication (observation_id, publication_id, source_id)
  select v_obs, v.publication_id, p_source
    from pg_temp.fx_ingest_version v;

  -- ── fijacion ──────────────────────────────────────────────────────────
  -- Cada fecha d del documento es R(X) de los dias X en (d, siguiente], y su
  -- anterior en el documento es P(X). Solo dias sin fijar, no posteriores a
  -- hoy en Europe/Berlin, y con P(X) presente salvo que R(X) sea la primera
  -- publicacion de la fuente.
  insert into core.fx_day (source_id, day, reference_date, previous_reference_date, observation_id)
  select p_source, x.day, w.ref, w.prev, v_obs
    from (select v.ref,
                 lag(v.ref)  over (order by v.ref) as prev,
                 lead(v.ref) over (order by v.ref) as next
            from pg_temp.fx_ingest_version v) w
    cross join lateral generate_series(1, least(coalesce(w.next, v_today), v_today) - w.ref) k(n)
    cross join lateral (select w.ref + k.n as day) x
   where (w.prev is not null or w.ref = v_first)
     and not exists (select 1 from core.fx_day f where f.source_id = p_source and f.day = x.day)
   order by 2;
  get diagnostics v_days = row_count;

  -- Por moneda: el intervalo de cobertura que contiene R(X) decide si tiene
  -- tipo; dentro de el, R(X) si la trae, si no P(X) si no es anterior al
  -- inicio del intervalo y la trae. El pivote vale 1 sin version.
  insert into core.fx_day_rate
    (source_id, day, currency_definition_id, position, reference_date,
     observation_id, publication_id, source_code)
  select p_source, f.day, c.currency_definition_id, s.position,
         case s.position when 'P' then f.previous_reference_date else f.reference_date end,
         v_obs, s.publication_id, c.source_code
    from core.fx_day f
    join core.fx_coverage c
      on c.source_id = f.source_id
     and c.valid_from <= f.reference_date
     and (c.valid_until is null or f.reference_date <= c.valid_until)
    join pg_temp.fx_ingest_version vr on vr.ref = f.reference_date
    left join pg_temp.fx_ingest_version vp on vp.ref = f.previous_reference_date
    cross join lateral (
      select case
               when c.source_code is null then 'pivot'
               when exists (select 1 from core.fx_publication_rate pr
                             where pr.publication_id = vr.publication_id
                               and pr.source_code = c.source_code) then 'R'
               when vp.publication_id is not null
                    and f.previous_reference_date >= c.valid_from
                    and exists (select 1 from core.fx_publication_rate pr
                                 where pr.publication_id = vp.publication_id
                                   and pr.source_code = c.source_code) then 'P'
             end as position
    ) k
    cross join lateral (
      select k.position,
             case k.position when 'R' then vr.publication_id
                             when 'P' then vp.publication_id end as publication_id
    ) s
   where f.source_id = p_source
     and f.observation_id = v_obs
     and s.position is not null;
  get diagnostics v_rates = row_count;

  -- Dias que siguen sin fijar desde la primera publicacion hasta hoy: los que
  -- esta observacion no alcanza (su R(X) o su P(X) quedan fuera del documento).
  -- Quien ejecuta la ingesta decide si necesita un documento mas largo.
  if v_today > v_first then
    select (v_today - v_first) - count(*) into v_unfixed
      from core.fx_day f
     where f.source_id = p_source and f.day > v_first and f.day <= v_today;
  end if;

  return jsonb_build_object(
    'observation_id', v_obs,
    'complete', true,
    'first_reference_date', v_min,
    'last_reference_date', v_max,
    'reference_dates', v_count,
    'versions_new', v_versions,
    'days_fixed', v_days,
    'day_rates_fixed', v_rates,
    'days_unfixed', v_unfixed);
end
$fn$;

comment on function sec.fx_ingest_at(text, text, jsonb, timestamptz) is
  'Ingesta y fijacion (F11/ADR-002 §2-§5) con instante explicito. Solo fuentes de prueba aceptan un instante distinto de now().';

-- La ruta de la fuente real: el BCE, con el reloj del servidor.
create function sec.fx_ingest(p_document text, p_evidence jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select sec.fx_ingest_at('ecb', p_document, p_evidence, now());
$fn$;

comment on function sec.fx_ingest(text, jsonb) is
  'Ingesta del BCE con la hora del servidor (F11/ADR-002, decision 1). Solo la ejecuta el propietario de las migraciones.';

-- Propiedad: la ingesta, que esta DEBAJO de la RLS. Ningun EXECUTE para nadie:
-- solo `postgres`, por ser miembro del rol propietario, puede invocarlas.
revoke execute on function sec.fx_ingest_at(text, text, jsonb, timestamptz) from public;
revoke execute on function sec.fx_ingest(text, jsonb) from public;

grant create on schema sec to nomey_fx_ingest;
alter function sec.fx_ingest_at(text, text, jsonb, timestamptz) owner to nomey_fx_ingest;
alter function sec.fx_ingest(text, jsonb) owner to nomey_fx_ingest;
revoke create on schema sec from nomey_fx_ingest;

-- ═════════════ §3 · la cobertura no puede desdecir una fijacion ══════════════
--
-- F11/ADR-002 §5: «el fin [de una retirada] no puede ser anterior a la ultima
-- fecha de referencia de esa moneda que ya haya usado alguna fijacion». Un dia
-- fijado no cambia nunca, asi que una cobertura que se estrechara por detras
-- dejaria filas de `core.fx_day_rate` apuntando a un tipo que la cobertura dice
-- que esa moneda no tenia. No cambiaria ningun importe ya congelado: haria que
-- la cobertura y la historia se contradijeran, en silencio.
--
-- **Por que un trigger, contra la preferencia general del proyecto.** El
-- invariante cruza dos tablas —la cobertura y las fijaciones— y ninguna
-- constraint puede expresarlo: un CHECK solo ve su propia fila y una FK solo
-- comprueba igualdad contra una clave, no la pertenencia a un intervalo. Es la
-- misma razon por la que otras reglas de este proyecto viven en la frontera
-- autoritativa; aqui no hay frontera, porque la cobertura la escriben las
-- migraciones.
--
-- Es un CONSTRAINT TRIGGER DIFERIDO a proposito: una migracion puede cerrar un
-- intervalo y abrir el siguiente en dos sentencias, y lo que tiene que ser
-- coherente es el estado final, no cada paso. Se comprueba al confirmar, o
-- antes con `SET CONSTRAINTS ALL IMMEDIATE`.
--
-- No entra en INSERT: un intervalo nuevo solo puede anadir cobertura.

create function sec.fx_coverage_keeps_fixations() returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  -- La fila de antes y, si la hubo, la de despues: cambiar la fuente o la
  -- moneda de un intervalo deja huerfanas las dos parejas. `new` solo se toca
  -- en UPDATE; en DELETE no existe.
  v_source_old   text := old.source_id;
  v_currency_old uuid := old.currency_definition_id;
  v_source_new   text;
  v_currency_new uuid;
  v_source       text;
  v_currency     uuid;
  v_date         date;
begin
  if tg_op = 'UPDATE' then
    v_source_new := new.source_id;
    v_currency_new := new.currency_definition_id;
  end if;

  select r.source_id, r.currency_definition_id, max(r.reference_date)
    into v_source, v_currency, v_date
    from core.fx_day_rate r
   where (r.source_id, r.currency_definition_id) in
         ((v_source_old, v_currency_old),
          (coalesce(v_source_new, v_source_old), coalesce(v_currency_new, v_currency_old)))
     and not exists (
       select 1 from core.fx_coverage c
        where c.source_id = r.source_id
          and c.currency_definition_id = r.currency_definition_id
          and c.valid_from <= r.reference_date
          and (c.valid_until is null or r.reference_date <= c.valid_until))
   group by r.source_id, r.currency_definition_id
   limit 1;

  if v_date is not null then
    raise exception
      'la cobertura de % en % dejaria fuera la fecha %, que una fijacion ya uso',
      v_currency, v_source, v_date
      using errcode = '23514',
            hint = 'F11/ADR-002 §5: una retirada no puede ser anterior a lo ya fijado';
  end if;
  return null;
end
$fn$;

comment on function sec.fx_coverage_keeps_fixations() is
  'Guarda de F11/ADR-002 §5: ninguna fecha de referencia ya usada por una fijacion puede quedar fuera de la cobertura curada.';

revoke execute on function sec.fx_coverage_keeps_fixations() from public;

create constraint trigger fx_coverage_respeta_fijaciones
  after update or delete on core.fx_coverage
  deferrable initially deferred
  for each row execute function sec.fx_coverage_keeps_fixations();
