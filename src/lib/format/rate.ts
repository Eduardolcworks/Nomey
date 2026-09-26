import type { FormatLocale } from '../i18n/locales';

import { groupDigits, numberPattern } from './pattern';

/**
 * Turns an exact exchange rate into a localised string.
 *
 * A frozen rate is `(coefficient, scale)` — F03/ADR-012 — with up to twelve
 * decimals, and it crosses the boundary as TEXT for the same reason an amount
 * does: a JavaScript `number` cannot hold `0.005600358423` exactly. So, like
 * `formatMoney`, **no arithmetic happens here and nothing becomes a `number`**:
 * the digits of the coefficient are placed, not computed.
 *
 * Trailing zeros of the fraction are dropped — `12` at scale `1` is `1,2`, not
 * `1,20` — because a rate has no currency scale to pad to. Dropping a trailing
 * zero changes no value, so this stays exact.
 *
 * ═══════════ AND THE FRACTION IS CAPPED AT FOUR DIGITS ═══════════
 *
 * A frozen rate is stored at up to twelve decimals and every one of them is
 * real, but `1 USD = 0,876962202929 EUR` is not a figure anybody reads: it is
 * fourteen characters of noise next to an amount that only has two. Four is
 * what a rate is quoted at, and it is what this shows.
 *
 * **This is presentation and nothing else** (`AGENTS.md` §1, the boundary
 * rule). The rounding NEVER feeds back into a value of record: the converted
 * amount that sits above this line was computed on the server from the full
 * coefficient and travels as text, and the rate itself stays exact in
 * `core.frozen_conversion`. Nothing here is ever an input to anything.
 *
 * It rounds **half up on the digits**, with the carry propagated by exact
 * integer arithmetic — `bigint`, never a `number` — so `0,99996` becomes `1`
 * and not `0,9999`. Truncating would have been simpler and would have made
 * every rate read low.
 *
 * The consequence, stated rather than hidden: for a currency worth very little
 * against the base the displayed rate goes coarse — `1 COP = 0,0002 EUR`. The
 * converted amount next to it is exact, so nothing about the money is
 * misrepresented; what is lost is only the precision of the quote.
 *
 * Returns `null` for anything that is not a plain non-negative integer string
 * with a sane scale: a malformed rate is shown as nothing rather than as a
 * figure that looks right.
 */
export function formatRate(
  coefficient: string,
  scale: number,
  locale: FormatLocale,
): string | null {
  if (!/^[0-9]+$/.test(coefficient) || !Number.isInteger(scale) || scale < 0 || scale > 18) {
    return null;
  }

  const capped = capFraction(coefficient, scale);

  const pattern = numberPattern(locale, 0, null, 'auto');
  const padded = capped.coefficient.padStart(capped.scale + 1, '0');
  const integerDigits = padded.slice(0, padded.length - capped.scale).replace(/^0+(?=[0-9])/, '');
  const fractionDigits = (
    capped.scale === 0 ? '' : padded.slice(padded.length - capped.scale)
  ).replace(/0+$/, '');

  const integer = groupDigits(integerDigits, pattern);
  return fractionDigits === '' ? integer : `${integer}${pattern.decimalSeparator}${fractionDigits}`;
}

/** Cuántos decimales se enseñan de un tipo, como mucho. */
export const RATE_FRACTION_DIGITS = 4;

/**
 * Recorta la fracción a `RATE_FRACTION_DIGITS`, redondeando media arriba.
 *
 * Todo en `bigint`: el coeficiente puede pasar de `2^53` —`9223372036854775807`
 * es un caso de prueba— y con `number` el recorte devolvería otra cifra sin
 * avisar. El acarreo sube solo, porque sumar uno a un entero ya lo propaga.
 */
function capFraction(coefficient: string, scale: number) {
  if (scale <= RATE_FRACTION_DIGITS) return { coefficient, scale };

  const exact = BigInt(coefficient);
  const dropped = BigInt(scale - RATE_FRACTION_DIGITS);
  const divisor = 10n ** dropped;
  const whole = exact / divisor;
  const rest = exact % divisor;
  const half = 5n * 10n ** (dropped - 1n);
  const capped = rest >= half ? whole + 1n : whole;

  /*
   * UN TIPO QUE NO ES CERO NO SE ENSEÑA COMO CERO.
   *
   * Por debajo de `0,00005` el recorte da `0`, y `1 XYZ = 0 EUR` es una cifra
   * FALSA —dice que no vale nada—, no una aproximada. Ninguno de los veinte
   * pares del catálogo cae ahí hoy, pero el recorte no puede depender de eso.
   * En ese caso se enseña el tipo entero: preferible largo a mentiroso, que es
   * el mismo criterio por el que un tipo malformado no se enseña en absoluto.
   */
  if (capped === 0n && exact !== 0n) return { coefficient, scale };

  return { coefficient: capped.toString(), scale: RATE_FRACTION_DIGITS };
}
