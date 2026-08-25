-- Reparto contextual y conversion congelada.
--
-- Quinta migracion real. Cierra los CUATRO hechos economicos que faltaban del
-- inventario de persistido autoritativo de ADR-013 §1:
--
--   la cabecera de reparto           -> core.split
--   la intencion declarada           -> core.split_participant
--   el resultado resuelto            -> core.split_participant
--   las conversiones congeladas      -> core.frozen_conversion
--
-- Con esto, todo lo que ADR-013 §1 declara persistido autoritativo EXISTE. Lo
-- que venga despues —proyeccion canonica, vistas de `api`, writer— es derivado
-- o frontera, no un hecho nuevo.
--
-- Fuentes:
--   ADR-002 §5  · metodos de reparto y reparto determinista del resto
--   ADR-003 §4  · el tipo de cambio es coeficiente entero + escala, exacto
--   ADR-003 §5  · convertir una vez al entrar al ambito, repartir despues
--   ADR-008 §4  · el coeficiente cruza como string, la escala como entero acotado
--   ADR-011 §4  · clave foranea compuesta y diferible para el ciclo cabecera-filas
--   ADR-011 §14 · inmutabilidad: sin UPDATE ni DELETE
--   ADR-011 §15 · ninguna policy de `core` aplicable a PUBLIC
--   ADR-012 §1  · el participante es contextual por ambito
--   ADR-013 §5  · el reparto es contextual, no de la version
--   ADR-013 §6  · importe original y conversiones congeladas por valor
--   ADR-013 §10 · policies del writer, por comando y por rol
--   ADR-015     · representacion fisica del tipo congelado

-- ========================== soporte para las FK compuestas de la conversion ==
-- ADR-013 §6 exige dos coincidencias que hasta ahora eran validaciones:
--   1. el origen de la conversion es la moneda del IMPORTE ORIGINAL de su version;
--   2. la fecha para la que se resolvio COINCIDE con la fecha efectiva de esa
--      version — «heredar tras cambiar la fecha efectiva seria
--      representacionalmente imposible».
--
-- Una unica clave compuesta las convierte en las dos en estructura. Es aditiva
-- sobre un superconjunto de la clave primaria: no restringe nada que hoy sea
-- posible.

alter table core.operation_version
  add constraint operation_version_fecha_moneda_unico
  unique (id, effective_date, original_currency_definition_id);

-- ================================================== cabecera de reparto ======
-- ADR-013 §5. El metodo y el pagador SALIERON de `operation_version` a
-- proposito, y el motivo es de autorizacion, no de normalizacion: una policy
-- RLS decide FILAS y no puede ocultar COLUMNAS de una fila. En una fila que
-- porta su ambito, la proteccion del reparto es la misma que la del efecto y
-- pasa a ser estructural.
--
-- La clave primaria compuesta ES la cardinalidad de §5: un reparto ocurre en
-- EXACTAMENTE UN ambito, y una version tiene como maximo uno por ambito.
--
-- No lleva total: es el importe original de la version, convertido a la moneda
-- base del ambito, y persistirlo seria una tercera copia. No lleva moneda: la
-- determina el ambito (§5, «no se duplica»). No lleva clase: se hereda de
-- `core.operation`.

create table core.split (
  operation_version_id uuid not null references core.operation_version (id),
  scope_id             uuid not null references core.scope (id),
  split_method         text not null,
  -- Nulo cuando la clase no requiere pagador. Cuando existe, la FK compuesta
  -- diferible de mas abajo exige que figure ENTRE LOS PARTICIPANTES del
  -- reparto (ADR-013 §5).
  payer_participant_id uuid,

  constraint split_pk primary key (operation_version_id, scope_id),

  -- Vocabulario CERRADO, como `scope.kind` y a diferencia de
  -- `operation.operation_class`. ADR-002 §5 enumera tres metodos y el dominio
  -- los tipa como union cerrada en src/domain/split/split.ts; un cuarto exige
  -- migracion deliberada.
  --
  -- Son estos tres nombres y no otros: `shares` son PESOS ENTEROS POSITIVOS, no
  -- porcentajes, y no existe ningun metodo llamado `equally` ni `parts`.
  constraint split_metodo_valido
    check (split_method in ('equal', 'shares', 'exact_amounts')),

  -- Destino de la FK compuesta que impide que el metodo de una fila diverja del
  -- de su cabecera.
  constraint split_metodo_unico unique (operation_version_id, scope_id, split_method)
);

comment on table core.split is
  'Cabecera de reparto por (version, ambito). Metodo y pagador viven aqui y no en la version, porque la RLS acota filas y no columnas (ADR-013 §5).';
comment on column core.split.split_method is
  'equal | shares | exact_amounts. Vocabulario cerrado por ADR-002 §5; `shares` son pesos enteros, nunca porcentajes.';
comment on column core.split.payer_participant_id is
  'Pagador contextual, nulo cuando la clase no lo requiere. Si existe, figura entre los participantes del reparto.';

-- ============================================= filas de participante =========
-- ADR-013 §5: participante · ordinal · peso declarado cuando el metodo sea
-- `shares` · importe exacto declarado cuando sea `exact_amounts` · RESULTADO
-- RESUELTO.
--
-- `resolved_amount` NO duplica `core.effect.economic_amount`. Coinciden en el
-- gasto de grupo y DIVERGEN en el reparto final del Modo Pareja, donde los
-- resueltos se convierten en efectos de SALDO en dos Modos Personales
-- distintos. Son hechos distintos, y ADR-013 §1 persiste los dos a proposito:
-- ADR-002 §5 exige conservar «intencion Y resultado», porque un 30/30/30/30 no
-- distingue «a partes iguales entre cuatro» de «cuatro importes fijos», y esa
-- diferencia decide si una correccion posterior recalcula.
--
-- La moneda del resultado NO se persiste: la determina la moneda base del
-- ambito de la cabecera (ADR-013 §5).

create table core.split_participant (
  operation_version_id uuid    not null,
  scope_id             uuid    not null,
  participant_id       uuid    not null,
  -- Orden estable guardado con la operacion. NO es decoracion: es la entrada
  -- del paso 5 del desempate de ADR-002 §5. Sin el, un replay podria asignar
  -- el centimo sobrante a otra persona Y LA SUMA SEGUIRIA CUADRANDO.
  ordinal              integer not null,
  -- Copia del metodo, atada por FK compuesta a la cabecera para que no pueda
  -- divergir. Es el mismo recurso que la moneda de `core.effect`: la
  -- redundancia solo es aceptable cuando el motor impide que diga otra cosa.
  split_method         text    not null,
  declared_weight      bigint,
  declared_amount      bigint,
  resolved_amount      bigint  not null,

  -- ADR-013 §5: un participante figura UNA SOLA VEZ en un mismo reparto.
  constraint split_participant_pk
    primary key (operation_version_id, scope_id, participant_id),

  -- ADR-013 §5: el ordinal es unico dentro del reparto.
  constraint split_participant_ordinal_unico
    unique (operation_version_id, scope_id, ordinal),
  constraint split_participant_ordinal_no_negativo check (ordinal >= 0),

  -- La fila cuelga de su cabecera, y arrastra de ella el ambito.
  constraint split_participant_de_su_cabecera
    foreign key (operation_version_id, scope_id)
    references core.split (operation_version_id, scope_id),

  -- El metodo de la fila es el de su cabecera. Estructural, no comentado.
  constraint split_participant_metodo_de_la_cabecera
    foreign key (operation_version_id, scope_id, split_method)
    references core.split (operation_version_id, scope_id, split_method),

  -- ADR-012 §1: el participante pertenece al ambito DEL REPARTO. Un reparto
  -- ocurre entre los participantes de ese ambito, y un identificador contextual
  -- en una fila que no declara su contexto invita a leerlo fuera de el.
  constraint split_participant_del_ambito
    foreign key (participant_id, scope_id)
    references core.participant (id, scope_id),

  -- Cada metodo declara lo suyo, y solo lo suyo.
  --   equal          -> ninguno de los dos: lo declarado es LA INCLUSION misma
  --   shares         -> peso, entero > 0
  --   exact_amounts  -> importe, > 0
  constraint split_participant_peso_solo_en_shares
    check ((split_method = 'shares') = (declared_weight is not null)),
  constraint split_participant_importe_solo_en_exactos
    check ((split_method = 'exact_amounts') = (declared_amount is not null)),

  -- La positividad recae sobre LO DECLARADO. `data-model.md` §5 lo precisa: con
  -- `shares`, un total de 0,01 y pesos 1·2·2 deja al pagador RESUELTO EN 0 y
  -- sigue siendo valido, asi que un check sobre el resultado seria incorrecto.
  constraint split_participant_peso_positivo
    check (declared_weight is null or declared_weight > 0),
  -- En `exact_amounts`, quien declara 0 NO es participante de esa operacion
  -- (decision de producto del 2026-08-20, `data-model.md` §5): no es una fila
  -- con cero, es una fila que no existe.
  constraint split_participant_importe_positivo
    check (declared_amount is null or declared_amount > 0),

  -- ADR-003 T11: el reparto opera sobre magnitud NO NEGATIVA; el signo
  -- financiero pertenece al efecto que lo usa. Y el cero resuelto es valido y
  -- se conserva: es indivisibilidad, no un error (ADR-013 §5).
  constraint split_participant_resuelto_no_negativo check (resolved_amount >= 0),

  -- Invariante LOCAL de `exact_amounts`: el dominio devuelve los declarados tal
  -- cual, asi que declarado y resuelto coinciden siempre. Es comprobable dentro
  -- de la fila, de modo que no se reserva al writer.
  constraint split_participant_exactos_coinciden
    check (split_method <> 'exact_amounts' or resolved_amount = declared_amount)
);

comment on table core.split_participant is
  'Intencion declarada y resultado resuelto de un reparto, por participante. El resuelto NO es el mismo hecho que core.effect.economic_amount (ADR-013 §5).';
comment on column core.split_participant.ordinal is
  'Orden estable de la operacion. Es la entrada del desempate de ADR-002 §5, no un adorno.';
comment on column core.split_participant.resolved_amount is
  'Resultado en unidad minima de la moneda base del ambito. Cero es valido por indivisibilidad y se conserva.';

-- El pagador figura entre los participantes del reparto (ADR-013 §5).
-- Compuesta —no puede apuntar a un participante de otro reparto— y DIFERIBLE,
-- porque la cabecera se inserta antes que sus filas. Es el mismo recurso que
-- ADR-011 §4 usa para `operation.current_version_id`, medido en E17.
alter table core.split
  add constraint split_pagador_del_reparto
  foreign key (operation_version_id, scope_id, payer_participant_id)
  references core.split_participant (operation_version_id, scope_id, participant_id)
  deferrable initially deferred;

-- > CARDINALIDAD MINIMA: NO ES ESTRUCTURAL, Y SE DICE.
-- >
-- > «Todo reparto contiene al menos un participante» es un invariante de la
-- > FRONTERA AUTORITATIVA, no de estas tablas. Una cabecera SIN PAGADOR y sin
-- > filas es fisicamente insertable: la FK diferible solo muerde cuando hay
-- > pagador, y ninguna restriccion declarativa puede exigir la existencia de
-- > filas hijas.
-- >
-- > No se anade un trigger para conseguirlo. Se clasifica, igual que ADR-011
-- > §11 clasifica «el predecesor es exactamente la version anterior»: hay
-- > invariantes que pertenecen a la frontera, y simularlos con maquinaria
-- > declarativa imposible es peor que declararlos.
-- >
-- > Lo que la base SI garantiza: cada fila pertenece a una cabecera · un
-- > participante aparece como maximo una vez · el ordinal es unico · el
-- > pagador, si existe, pertenece al reparto.

-- ================================================ conversion congelada =======
-- ADR-013 §6: «una operacion/version -> exactamente un importe original ->
-- 0..n conversiones derivadas, UNA POR AMBITO ALCANZADO QUE LO REQUIERA».
--
-- Se congela: ambito · definicion origen · definicion destino · coeficiente
-- exacto · escala · fecha para la que se resolvio. Y nada mas.
--
-- LO QUE NO SE PERSISTE, y cada omision tiene su motivo:
--
--   · el IMPORTE CONVERTIDO — es exactamente reproducible desde el importe
--     original, el coeficiente, la escala y la escala de la moneda destino, con
--     UN UNICO redondeo al final (src/domain/money/convert.ts, ADR-003 T12). Y
--     ya esta resuelto en los efectos. Persistirlo seria una segunda fuente de
--     verdad de la misma cifra.
--   · una REFERENCIA A CATALOGO — ADR-013 §6: «se congela el valor, no una
--     referencia». Una fila de catalogo puede corregirse despues y
--     reinterpretaria la historia en silencio, contra el invariante 22.
--   · el PROVEEDOR o cualquier procedencia — §6 la declara opcional y NO
--     autoritativa, y ADR-003 §4 deja el proveedor fuera de alcance. Fijar hoy
--     su forma prejuzgaria esa decision. Se podra anadir despues sin
--     reinterpretar ninguna conversion ya congelada.

create table core.frozen_conversion (
  operation_version_id          uuid     not null,
  scope_id                      uuid     not null references core.scope (id),
  source_currency_definition_id uuid     not null,
  target_currency_definition_id uuid     not null,
  -- ADR-015: la representacion fisica del tipo congelado es (coeficiente,
  -- escala), alineada con ADR-013 §6, con la frontera de ADR-008 §4 y con
  -- `ExchangeRate` del dominio.
  --
  --   0,862034781245  ->  coefficient = 862034781245 , scale = 12
  --
  -- Un `bigint` no puede ser NaN ni Infinity, que es la clase de valor que
  -- ADR-003 §4 dedica un parrafo a temer en `numeric`.
  rate_coefficient              bigint   not null,
  rate_scale                    smallint not null,
  resolved_for_date             date     not null,

  constraint frozen_conversion_pk primary key (operation_version_id, scope_id),

  constraint frozen_conversion_coeficiente_positivo check (rate_coefficient > 0),
  -- ADR-003 §4 EXIGE que la cota exista y delega su valor al esquema. 12 es la
  -- escala MAXIMA, no una escala fija: una tasa de mayor magnitud usa una
  -- escala menor, y la precision disponible depende de ambas conjuntamente.
  constraint frozen_conversion_escala_acotada
    check (rate_scale between 0 and 12),

  -- «Una por ambito alcanzado QUE LO REQUIERA»: convertir una moneda a si misma
  -- no es una conversion.
  constraint frozen_conversion_monedas_distintas
    check (source_currency_definition_id <> target_currency_definition_id),

  -- El DESTINO es la moneda base del ambito. Reutiliza la misma clave que ya
  -- sostiene la moneda de `core.effect`.
  constraint frozen_conversion_destino_es_la_base
    foreign key (scope_id, target_currency_definition_id)
    references core.scope (id, base_currency_definition_id),

  -- El ORIGEN es la moneda del importe original de esa version, y la FECHA DE
  -- RESOLUCION coincide con su fecha efectiva. Las dos cosas, en una sola FK.
  -- ADR-013 §6 llama a lo segundo «representacionalmente imposible» de violar;
  -- aqui lo es de verdad.
  constraint frozen_conversion_origen_y_fecha_de_la_version
    foreign key (operation_version_id, resolved_for_date, source_currency_definition_id)
    references core.operation_version (id, effective_date, original_currency_definition_id)
);

comment on table core.frozen_conversion is
  'Conversion congelada POR VALOR, una por ambito alcanzado que la requiera. Nunca se reconstruye desde un catalogo futuro (ADR-013 §6).';
comment on column core.frozen_conversion.rate_coefficient is
  'Coeficiente entero del tipo exacto. Con `rate_scale` forma el decimal: 862034781245 con escala 12 es 0,862034781245 (ADR-015).';
comment on column core.frozen_conversion.rate_scale is
  'Escala decimal del tipo. Cota maxima 12, no escala fija: mayor magnitud usa menor escala (ADR-003 §4).';
comment on column core.frozen_conversion.resolved_for_date is
  'Fecha para la que se resolvio el tipo. Coincide con la fecha efectiva de su version, por clave foranea.';

-- Una CORRECCION no muta nada de esto. Las tres relaciones llevan
-- `operation_version_id` en su clave primaria, asi que V2 crea LAS SUYAS y las
-- de V1 permanecen intactas. «Heredar» el FX significa COPIAR EL VALOR
-- congelado a la fila de V2, nunca compartir una fila mutable con V1: por eso
-- el writer no recibe UPDATE ni DELETE (ADR-011 §14).

-- =========================================================== grants ==========
-- ADR-013 §10. Solo el writer escribe. Los roles cliente quedan SIN grants y
-- SIN policies: la lectura llegara por la superficie `api`, que no existe
-- todavia, y conceder acceso directo ahora fijaria una superficie antes de que
-- exista la decision que debe darle forma.

grant select, insert on core.split             to nomey_writer;
grant select, insert on core.split_participant to nomey_writer;
grant select, insert on core.frozen_conversion to nomey_writer;

-- Sin UPDATE ni DELETE (ADR-011 §14). La ausencia es la decision.

-- ============================================================== RLS ==========
-- Regla dura: ninguna tabla de `core` nace sin RLS.

alter table core.split             enable row level security;
alter table core.split_participant enable row level security;
alter table core.frozen_conversion enable row level security;

-- --------------------------------------------------- lectura del writer -----
-- Amplia POR NECESIDAD MEDIDA, no por comodidad. Construir V2 EXIGE LEER V1: el
-- reparto anterior cuelga de `(version, ambito)` y el FX congelado se hereda
-- (ADR-013 §5, §6, §10). E20 midio que una lectura restringida por atribucion
-- no da error —devuelve NULL— y la frontera concluiria que no hay predecesor.
-- Las policies de SELECT del writer son PORTANTES de la escritura.

create policy split_writer_select on core.split
  for select to nomey_writer using (true);

create policy split_participant_writer_select on core.split_participant
  for select to nomey_writer using (true);

create policy frozen_conversion_writer_select on core.frozen_conversion
  for select to nomey_writer using (true);

-- -------------------------------------------------- escritura del writer ----
-- El mismo patron que E20 valido para `core.effect`: existe una version,
-- referida por la fila, ATRIBUIDA AL ACTOR DE LA PETICION. Es satisfacible
-- dentro de la transaccion porque la subconsulta ve la version insertada y aun
-- no confirmada.
--
-- Es una segunda barrera de integridad, NO autorizacion por ambito: ADR-002 §10
-- permite deliberadamente que una operacion —y por tanto su reparto— alcance el
-- ambito de otro usuario, de modo que exigir membresia del actor rechazaria
-- escrituras legitimas.

create policy split_writer_insert on core.split
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = split.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

create policy split_participant_writer_insert on core.split_participant
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = split_participant.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

create policy frozen_conversion_writer_insert on core.frozen_conversion
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = frozen_conversion.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

-- Sin policies de UPDATE ni de DELETE para nadie, y ninguna aplicable a PUBLIC.
