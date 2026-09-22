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

  const pattern = numberPattern(locale, 0, null, 'auto');
  const padded = coefficient.padStart(scale + 1, '0');
  const integerDigits = padded.slice(0, padded.length - scale).replace(/^0+(?=[0-9])/, '');
  const fractionDigits = (scale === 0 ? '' : padded.slice(padded.length - scale)).replace(
    /0+$/,
    '',
  );

  const integer = groupDigits(integerDigits, pattern);
  return fractionDigits === '' ? integer : `${integer}${pattern.decimalSeparator}${fractionDigits}`;
}
