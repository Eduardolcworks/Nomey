-- ============================================================================
-- RESOLVER, DERIVACION Y CONVERSION FX · F11/ADR-001 §6-§7 · F11/ADR-002 §3, §6
-- Bloque F11.B, M3 (B4)
-- ============================================================================
--
-- Parte del estado que dejaron 20260922120000 (catalogo y cobertura curada) y
-- 20260923120000 (ingesta y fijacion del dia).
--
--   §0  sec.fx_divide_round   cociente exacto redondeado una vez, half away
--                              from zero
--   §1  sec.fx_derive         tipo origen -> destino a escala 12
--   §2  sec.fx_convert        importe convertido con un unico redondeo
--   §3  sec.fx_resolve        pasos 5-8 del orden de F11/ADR-001 §6
--   §4  privilegios: solo el writer ejecuta, y solo lee lo que resuelve
--
-- Lo que NO trae: ningun writer cambia, `core.frozen_conversion` no se toca y
-- sigue sin INSERT para el writer, no hay procedencia persistida ni
-- superficie de `api`. Tras esta migracion ninguna operacion convierte todavia:
-- toda moneda distinta de la base sigue en `CURRENCY_CONVERSION_UNSUPPORTED`.
-- Los writers llaman al resolver en B5 (M4).
--
-- ============================ PARIDAD CON EL DOMINIO =======================
--
-- Cada funcion reproduce una de src/domain y se comprueba con los mismos
-- vectores (F01/ADR-001 §7, F03/ADR-006 §1), en supabase/checks/fx-resolution.sql:
--
--   sec.fx_divide_round  <->  money/rounding.ts   divideRoundHalfAwayFromZero
--   sec.fx_derive        <->  fx/derive-rate.ts   deriveRate
--   sec.fx_convert       <->  money/convert.ts    convertWithinRange
--   sec.fx_resolve       <->  fx/day-rate.ts y fx/effective-date.ts, sobre lo
--                              que la fijacion (M2) ya dejo guardado
--
-- Todo es aritmetica entera sobre `numeric`, nunca `bigint` en los productos
-- intermedios (F11/ADR-001 §7: el producto de la conversion llega a ~10^37) y
-- nunca coma flotante. La division es `div` + resto, que en `numeric` es exacta;
-- `/` redondearia a una escala implicita y seria un segundo redondeo.
--
-- ======================= DOS CEROS QUE NO SON LO MISMO =====================
--
--   · Un TIPO que redondea a 0 a escala 12 no es representable (F03/ADR-012:
--     coeficiente > 0) y es FX_CONVERSION_OUT_OF_RANGE. Decision de B1.
--   · Un IMPORTE convertido que redondea a 0 unidades minimas SE ACEPTA
--     (decision de F11.B): el tipo es valido, el importe es muy pequeno.
--
-- ================================ AUTORIDAD ================================
--
-- El tipo sale SOLO de lo fijado: `core.fx_day` (el dia X existe),
-- `core.fx_day_rate` (que version y que fecha usa cada moneda ese dia) y
-- `core.fx_publication_rate` (el valor exacto de esa version). La procedencia
-- que devuelve el resolver repite esas referencias para auditarlas despues;
-- nunca se usa para volver a calcular.
-- ============================================================================

-- ═════════════════════ §0 · division exacta, un redondeo ═══════════════════

-- `numerator / denominator` redondeado a entero, half away from zero sobre la
-- magnitud y el signo despues: la misma definicion que
-- divideRoundHalfAwayFromZero (F02/ADR-001 T10). Ambos operandos son enteros.
create function sec.fx_divide_round(p_numerator numeric, p_denominator numeric)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $fn$
declare
  v_num numeric := p_numerator;
  v_den numeric := p_denominator;
  v_quotient  numeric;
  v_remainder numeric;
begin
  if v_num <> trunc(v_num) or v_den <> trunc(v_den) then
    raise exception 'sec.fx_divide_round: operandos no enteros' using errcode = '22023';
  end if;
  if v_den = 0 then
    raise exception 'sec.fx_divide_round: division por cero' using errcode = '22012';
  end if;
  -- El signo del denominador pasa al numerador: se razona solo sobre magnitudes.
  if v_den < 0 then
    v_num := - v_num;
    v_den := - v_den;
  end if;
  v_quotient  := div(abs(v_num), v_den);
  v_remainder := abs(v_num) - v_quotient * v_den;
  if v_remainder * 2 >= v_den then
    v_quotient := v_quotient + 1;
  end if;
  return case when v_num < 0 then - v_quotient else v_quotient end;
end
$fn$;

comment on function sec.fx_divide_round(numeric, numeric) is
  'Cociente exacto de dos enteros redondeado una vez, half away from zero (F02/ADR-001 T10). Paridad: divideRoundHalfAwayFromZero.';

-- 10^n exacto, sin `power`, que en numeric puede arrastrar escala.
create function sec.fx_pow10(p_exponent integer)
returns numeric
language sql
immutable
strict
set search_path = ''
as $fn$
  select ('1' || repeat('0', p_exponent))::numeric;
$fn$;

comment on function sec.fx_pow10(integer) is
  'Potencia exacta de diez, para escalas de importes y tipos. Auxiliar de sec.fx_derive y sec.fx_convert.';

-- ═══════════════════════ §1 · derivacion a escala 12 ═══════════════════════

-- tipo(O -> D) = q_D / q_O, con q_C = coeficiente / 10^escala las unidades de C
-- por una unidad del pivote. Un unico cociente exacto redondeado una vez a
-- escala 12 (F11/ADR-001 §7). Devuelve el coeficiente; la escala es siempre 12.
create function sec.fx_derive(
  p_origin_coefficient bigint,
  p_origin_scale       integer,
  p_target_coefficient bigint,
  p_target_scale       integer
) returns bigint
language plpgsql
immutable
strict
set search_path = ''
as $fn$
declare
  v_coefficient numeric;
begin
  if p_origin_coefficient <= 0 or p_target_coefficient <= 0
     or p_origin_scale not between 0 and 12 or p_target_scale not between 0 and 12 then
    raise exception 'sec.fx_derive: cotizaciones no validas' using errcode = '22023';
  end if;

  v_coefficient := sec.fx_divide_round(
    p_target_coefficient::numeric * sec.fx_pow10(p_origin_scale + 12),
    p_origin_coefficient::numeric * sec.fx_pow10(p_target_scale));

  -- Un tipo 0 no es un tipo (F03/ADR-012), y uno que no cabe en bigint no se
  -- puede congelar.
  if v_coefficient <= 0 or v_coefficient > 9223372036854775807 then
    perform sec.raise_boundary('FX_CONVERSION_OUT_OF_RANGE',
      'el tipo derivado no es representable con escala 12', 422);
  end if;
  return v_coefficient::bigint;
end
$fn$;

comment on function sec.fx_derive(bigint, integer, bigint, integer) is
  'Tipo origen -> destino a escala 12, un unico redondeo (F11/ADR-001 §7). Cero o fuera de bigint: FX_CONVERSION_OUT_OF_RANGE. Paridad: deriveRate.';

-- ═════════════════════ §2 · conversion, un redondeo ═══════════════════════

--   minor_destino = redondear( minor_origen x coeficiente x 10^escala_destino
--                              / (10^escala_origen x 10^escala_tipo) )
--
-- Las escalas salen del catalogo por la identidad de cada definicion, nunca del
-- que llama. El producto intermedio va en numeric. Un resultado de 0 unidades
-- minimas se acepta; uno que no cabe en bigint es FX_CONVERSION_OUT_OF_RANGE.
create function sec.fx_convert(
  p_amount           bigint,
  p_source_currency  uuid,
  p_target_currency  uuid,
  p_rate_coefficient bigint,
  p_rate_scale       integer
) returns bigint
language plpgsql
stable
strict
set search_path = ''
as $fn$
declare
  v_source_scale integer;
  v_target_scale integer;
  v_result numeric;
begin
  if p_rate_coefficient <= 0 or p_rate_scale not between 0 and 12 then
    raise exception 'sec.fx_convert: tipo no valido' using errcode = '22023';
  end if;
  select c.scale into v_source_scale from core.currency_definition c where c.id = p_source_currency;
  select c.scale into v_target_scale from core.currency_definition c where c.id = p_target_currency;
  if v_source_scale is null or v_target_scale is null then
    raise exception 'sec.fx_convert: definicion monetaria desconocida' using errcode = '23503';
  end if;

  v_result := sec.fx_divide_round(
    p_amount::numeric * p_rate_coefficient::numeric * sec.fx_pow10(v_target_scale),
    sec.fx_pow10(v_source_scale) * sec.fx_pow10(p_rate_scale));

  if v_result < -9223372036854775808 or v_result > 9223372036854775807 then
    perform sec.raise_boundary('FX_CONVERSION_OUT_OF_RANGE',
      'el importe convertido no cabe en 64 bits', 422);
  end if;
  return v_result::bigint;
end
$fn$;

comment on function sec.fx_convert(bigint, uuid, uuid, bigint, integer) is
  'Importe convertido con un unico redondeo (F02/ADR-001 §5, F11/ADR-001 §7). 0 se acepta; fuera de bigint: FX_CONVERSION_OUT_OF_RANGE. Paridad: convertWithinRange.';

-- ═══════════════════════ §3 · el resolver, pasos 5-8 ═══════════════════════
--
-- Los pasos 1-4 de F11/ADR-001 §6 —replay, forma del payload, clase sin FX y
-- conflicto de base— son del writer y ocurren antes. Este resolver empieza
-- donde ya se sabe que hay que convertir de `p_origin` a `p_target`:
--
--   0. una fecha no finita no tiene tipo nunca: PAYLOAD_INVALID · 400, solo en
--      este camino (decision de F11.B; `sec.payload_date` no cambia).
--   5. cobertura de la definicion: las dos tienen correspondencia con la
--      fuente. Si no, FX_CURRENCY_NOT_COVERED · 422, sin esperar a nada.
--      Una fecha igual o anterior a la primera publicacion no tiene R(X):
--      tambien 422, y tampoco espera (F11/ADR-002 §6).
--   6. el dia X esta fijado. Si no, FX_RATE_NOT_YET_AVAILABLE · 503: el que
--      llama reintenta con la misma clave. Una fecha futura espera sin limite.
--   7. las dos monedas tienen tipo ese dia (su fila en `core.fx_day_rate`). Si
--      no, FX_CURRENCY_NOT_COVERED · 422, y no cambia con el tiempo.
--   8. derivacion y rango: sec.fx_derive.
--
-- Devuelve el tipo congelable y su procedencia: la fecha de referencia y la
-- version de cada lado (nula para el pivote). La autoridad es lo fijado.
--
-- `p_source` existe para las pruebas con fuentes de fixture; los writers usan
-- la fuente real, que es el valor por defecto.
create function sec.fx_resolve(
  p_effective_date date,
  p_origin         uuid,
  p_target         uuid,
  p_source         text default 'ecb',
  out rate_coefficient      bigint,
  out rate_scale            smallint,
  out source_id             text,
  out origin_reference_date date,
  out origin_publication_id uuid,
  out target_reference_date date,
  out target_publication_id uuid
)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_first    date;
  v_origin   core.fx_day_rate;
  v_target   core.fx_day_rate;
  v_o_coef   bigint;
  v_o_scale  integer;
  v_d_coef   bigint;
  v_d_scale  integer;
begin
  if p_effective_date is null or p_origin is null or p_target is null or p_source is null then
    raise exception 'sec.fx_resolve: argumentos nulos' using errcode = '22004';
  end if;
  if p_origin = p_target then
    raise exception 'sec.fx_resolve: no hay nada que convertir' using errcode = '22023';
  end if;

  -- 0 · fecha no operativa.
  if not isfinite(p_effective_date) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'la fecha efectiva no es una fecha finita', 400);
  end if;

  select s.first_reference_date into v_first from core.fx_source s where s.id = p_source;
  if not found then
    raise exception 'sec.fx_resolve: la fuente % no existe', p_source using errcode = '23503';
  end if;

  -- 5 · cobertura de la definicion.
  if not exists (select 1 from core.fx_coverage c
                  where c.source_id = p_source and c.currency_definition_id = p_origin)
     or not exists (select 1 from core.fx_coverage c
                     where c.source_id = p_source and c.currency_definition_id = p_target) then
    perform sec.raise_boundary('FX_CURRENCY_NOT_COVERED',
      'la moneda no tiene correspondencia con la fuente de tipos', 422);
  end if;
  if p_effective_date <= v_first then
    perform sec.raise_boundary('FX_CURRENCY_NOT_COVERED',
      'no hay ninguna publicacion de la fuente anterior a la fecha efectiva', 422);
  end if;

  -- 6 · el dia X fijado.
  if not exists (select 1 from core.fx_day d
                  where d.source_id = p_source and d.day = p_effective_date) then
    perform sec.raise_boundary('FX_RATE_NOT_YET_AVAILABLE',
      'el tipo de ese dia todavia no esta fijado', 503);
  end if;

  -- 7 · cobertura en la fecha: cada moneda tiene su fila ese dia.
  select * into v_origin from core.fx_day_rate r
   where r.source_id = p_source and r.day = p_effective_date and r.currency_definition_id = p_origin;
  select * into v_target from core.fx_day_rate r
   where r.source_id = p_source and r.day = p_effective_date and r.currency_definition_id = p_target;
  if v_origin.day is null or v_target.day is null then
    perform sec.raise_boundary('FX_CURRENCY_NOT_COVERED',
      'la moneda no tiene tipo ese dia', 422);
  end if;

  -- Los valores exactos de la version que cada moneda usa. El pivote vale 1.
  if v_origin.position = 'pivot' then
    v_o_coef := 1; v_o_scale := 0;
  else
    select pr.coefficient, pr.scale into v_o_coef, v_o_scale
      from core.fx_publication_rate pr
     where pr.publication_id = v_origin.publication_id and pr.source_code = v_origin.source_code;
  end if;
  if v_target.position = 'pivot' then
    v_d_coef := 1; v_d_scale := 0;
  else
    select pr.coefficient, pr.scale into v_d_coef, v_d_scale
      from core.fx_publication_rate pr
     where pr.publication_id = v_target.publication_id and pr.source_code = v_target.source_code;
  end if;
  -- Las FK de fx_day_rate garantizan que existen; si faltaran, la lectura no
  -- ve la tabla (privilegio o policy) y hay que fallar, no convertir con nulos.
  if v_o_coef is null or v_d_coef is null then
    raise exception 'sec.fx_resolve: no se pudo leer el valor de una version fijada' using errcode = '42501';
  end if;

  -- 8 · derivacion y rango.
  rate_coefficient      := sec.fx_derive(v_o_coef, v_o_scale, v_d_coef, v_d_scale);
  rate_scale            := 12;
  source_id             := p_source;
  origin_reference_date := v_origin.reference_date;
  origin_publication_id := v_origin.publication_id;
  target_reference_date := v_target.reference_date;
  target_publication_id := v_target.publication_id;
end
$fn$;

comment on function sec.fx_resolve(date, uuid, uuid, text) is
  'Pasos 5-8 de F11/ADR-001 §6 sobre lo fijado (F11/ADR-002): tipo congelable a escala 12 y su procedencia, que nunca es autoridad. Solo lee.';

-- ═════════════════════════════ §4 · privilegios ════════════════════════════
--
-- Ninguna de estas funciones es SECURITY DEFINER: se ejecutan con los
-- privilegios de quien llama, que sera el writer dentro de sus funciones
-- (propiedad de nomey_writer). Por eso el writer necesita EXECUTE sobre las
-- cinco y LECTURA de lo que el resolver consulta, y nadie mas necesita nada.

revoke execute on function sec.fx_divide_round(numeric, numeric) from public;
revoke execute on function sec.fx_pow10(integer) from public;
revoke execute on function sec.fx_derive(bigint, integer, bigint, integer) from public;
revoke execute on function sec.fx_convert(bigint, uuid, uuid, bigint, integer) from public;
revoke execute on function sec.fx_resolve(date, uuid, uuid, text) from public;

grant execute on function sec.fx_divide_round(numeric, numeric) to nomey_writer;
grant execute on function sec.fx_pow10(integer) to nomey_writer;
grant execute on function sec.fx_derive(bigint, integer, bigint, integer) to nomey_writer;
grant execute on function sec.fx_convert(bigint, uuid, uuid, bigint, integer) to nomey_writer;
grant execute on function sec.fx_resolve(date, uuid, uuid, text) to nomey_writer;

-- Lectura, y solo de lo que el resolver lee: el dia fijado, el tipo de cada
-- moneda ese dia y el valor exacto de la version usada. `core.fx_source` y
-- `core.fx_coverage` ya los lee desde 20260922120000. Nada de observaciones ni
-- de versiones completas: no le hacen falta.
--
-- Cada SELECT con su policy: E21 midio que un grant sin policy devuelve cero
-- filas sin error, y aqui eso haria «no fijado» a un dia fijado.
grant select on core.fx_day              to nomey_writer;
grant select on core.fx_day_rate         to nomey_writer;
grant select on core.fx_publication_rate to nomey_writer;

create policy fx_day_writer_read on core.fx_day
  for select to nomey_writer using (true);
create policy fx_day_rate_writer_read on core.fx_day_rate
  for select to nomey_writer using (true);
create policy fx_publication_rate_writer_read on core.fx_publication_rate
  for select to nomey_writer using (true);

-- Sin INSERT, UPDATE ni DELETE para el writer en nada de FX, y
-- `core.frozen_conversion` sigue sin INSERT: la ruta que lo ejerza llega en M4.
