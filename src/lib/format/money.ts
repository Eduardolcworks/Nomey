import type { Money } from '@/domain';

import { groupDigits, numberPattern, renderPattern } from './pattern';

export interface MoneyFormatOptions {
  /**
   * `'always'` prints the sign on positive amounts too.
   *
   * Not decoration. design-direction.md section 8 forbids colour as the only
   * signal for whether money came in or went out, and a sign is the cheapest
   * reinforcement that is not colour.
   */
  readonly sign?: 'auto' | 'always';
  /**
   * `'none'` drops the currency entirely, for a column that states its
   * currency once in a header rather than on every row.
   */
  readonly currencyDisplay?: 'symbol' | 'none';
}

/**
 * Turns an exact amount into a localised string.
 *
 * **No arithmetic happens here, and no amount becomes a `number`.** The digits
 * come straight out of the `bigint`; the locale only decides where they go.
 * See `pattern.ts` for why that split exists.
 *
 * The decimal position comes from the amount's own currency definition, so EUR
 * shows two decimals and JPY none - `AGENTS.md` section 1 forbids assuming
 * two, and a definition carrying scale 3 works without a change here.
 *
 * `locale` is any BCP-47 tag. Today callers pass the catalogue locale, which
 * is what the product decided and what the tests pin. Formatting by the
 * device's own tag instead - so a Chilean user sees Chilean conventions under
 * Spanish text - is a product decision that is not taken yet, and it is a
 * one-line change at the call site rather than a change here.
 */
export function formatMoney(
  value: Money,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  const { sign = 'auto', currencyDisplay = 'symbol' } = options;
  const { scale, code } = value.currency;

  const pattern = resolvePattern(locale, scale, currencyDisplay === 'none' ? null : code, sign);

  const negative = value.minor < 0n;
  const absolute = (negative ? -value.minor : value.minor).toString();
  const padded = absolute.padStart(scale + 1, '0');
  const integerDigits = padded.slice(0, padded.length - scale);
  const fractionDigits = scale === 0 ? '' : padded.slice(padded.length - scale);

  return renderPattern(pattern, {
    negative,
    forceSign: sign === 'always',
    integer: groupDigits(integerDigits, pattern),
    fraction: fractionDigits,
  });
}

/**
 * An amount's currency code as the locale writes it, for a column header.
 *
 * Derived from the same probe as the amounts below it, so the two cannot
 * disagree about whether this locale says `€` or `EUR`.
 */
export function currencySymbol(locale: string, code: string, scale: number): string {
  const pattern = resolvePattern(locale, scale, code, 'auto');
  return pattern.currencyText;
}

/**
 * An unknown currency code makes `Intl` throw a `RangeError`.
 *
 * A definition whose code ICU does not know is a real possibility - the code
 * is an attribute chosen by the catalogue, not a value ICU validates - and a
 * screen going blank because of it would be worse than showing the code. So
 * the currency style is dropped and the code is appended by the caller's
 * layout instead.
 */
function resolvePattern(
  locale: string,
  scale: number,
  code: string | null,
  sign: 'auto' | 'always',
) {
  if (code === null) return numberPattern(locale, scale, null, sign);

  try {
    return numberPattern(locale, scale, code, sign);
  } catch {
    return numberPattern(locale, scale, null, sign);
  }
}
