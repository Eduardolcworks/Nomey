/**
 * Plain numbers: counts, percentages, chart labels.
 *
 * Unlike an amount, these are approximate by nature - AGENTS.md section 1
 * allows floating point for exactly this kind of value, provided it never
 * feeds back into a value of record. Nothing here does; it produces strings.
 *
 * An amount never comes through here. It goes to `formatMoney`, which takes
 * the exact `bigint` and its currency definition.
 */
export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * A ratio as a percentage: `0.65` becomes `65 %` or `65%` per the locale.
 *
 * Takes the ratio, not the percentage, because that is what `Intl` expects and
 * because a caller computing `value * 100` first would be doing arithmetic in
 * the presentation layer.
 */
export function formatPercent(ratio: number, locale: string, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}
