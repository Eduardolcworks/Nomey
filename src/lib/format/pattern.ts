/**
 * Locale patterns, extracted from `Intl` by probing it.
 *
 * The problem this solves: `Intl.NumberFormat.format` takes a `number`, and a
 * Nomey amount is a `bigint` of minor units. Above 2^53 that conversion loses
 * digits silently, which is the exact failure ADR-003 exists to prevent - a
 * wrong figure that never throws.
 *
 * ES2023 lets `format` take a string and keep every digit, and Node does
 * support it. Hermes is a different implementation and may coerce the string
 * to a number instead, which would lose precision without telling anyone. So
 * that path is measured on the device and reported, and it is not what the
 * formatter depends on.
 *
 * What it depends on is this: `Intl` is asked, once per locale and currency,
 * to format a *safe* probe number, and `formatToParts` is read to learn the
 * locale's shape - where the symbol goes, which separators it uses, how it
 * groups digits, where the sign sits. The digits themselves are then supplied
 * from the exact `bigint`. `Intl` decides the shape, Nomey supplies the value,
 * and no amount is ever converted to a `number`.
 *
 * One path, not two: a formatter that took a fast route for small amounts and
 * a careful one for large ones would render the same locale differently
 * depending on magnitude, and the rare branch would be the untested one.
 */

/** How a locale arranges the pieces of a formatted amount. */
export interface NumberPattern {
  /** Part types in order, with literals resolved. `null` marks a slot. */
  readonly layout: readonly PatternSlot[];
  readonly groupSeparator: string;
  readonly decimalSeparator: string;
  /** Rightmost group size, then the size that repeats leftwards. */
  readonly primaryGroupSize: number;
  readonly secondaryGroupSize: number;
  /**
   * Fewest integer digits before grouping applies at all.
   *
   * CLDR's `minimumGroupingDigits`, and not a detail: Spanish writes 5000
   * without a separator but 50.000 with one, so assuming grouping starts at
   * four digits renders JPY amounts wrong in es-ES.
   */
  readonly groupingThreshold: number;
  /** The locale's own sign glyphs, which are not always ASCII. */
  readonly minusSign: string;
  readonly plusSign: string;
  /** How this locale writes the currency: a symbol for some, a code for others. */
  readonly currencyText: string;
}

export type PatternSlot =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'sign' }
  | { readonly kind: 'integer' }
  | { readonly kind: 'fraction' };

/**
 * Probe magnitudes.
 *
 * `12345678` is the smallest shape that shows three groups, which is what
 * distinguishes a locale that repeats its group size from one that does not -
 * en-IN groups 1,23,45,678. `1234` answers the threshold question above. Both
 * are far below 2^53, so the probes themselves are exact.
 */
const SHAPE_PROBE = 12345678;
const THRESHOLD_PROBE = 1234;

type SignMode = 'auto' | 'always';

const cache = new Map<string, NumberPattern>();

function options(
  scale: number,
  currencyCode: string | null,
  sign: SignMode,
): Intl.NumberFormatOptions {
  return {
    ...(currencyCode === null ? {} : { style: 'currency', currency: currencyCode }),
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
    signDisplay: sign === 'always' ? 'always' : 'auto',
  };
}

/**
 * Reads a locale's shape, once, and remembers it.
 *
 * Throws only if the locale itself is unusable; an unknown currency code is
 * handled by the caller, which retries without the currency style rather than
 * letting a `RangeError` reach a screen.
 */
export function numberPattern(
  locale: string,
  scale: number,
  currencyCode: string | null,
  sign: SignMode = 'auto',
): NumberPattern {
  const key = `${locale}|${String(scale)}|${currencyCode ?? ''}|${sign}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const formatter = new Intl.NumberFormat(locale, options(scale, currencyCode, sign));

  // Negative, so the sign's position is observed rather than assumed: some
  // locales put it after the symbol, some before it.
  const parts = formatter.formatToParts(-SHAPE_PROBE - 0.87);

  const layout: PatternSlot[] = [];
  const integerRuns: number[] = [];
  let groupSeparator = '';
  let decimalSeparator = '';
  let currencyText = '';
  let integerSlotEmitted = false;

  for (const part of parts) {
    switch (part.type) {
      case 'minusSign':
      case 'plusSign':
        layout.push({ kind: 'sign' });
        break;
      case 'integer':
        integerRuns.push(part.value.length);
        if (!integerSlotEmitted) {
          layout.push({ kind: 'integer' });
          integerSlotEmitted = true;
        }
        break;
      case 'group':
        groupSeparator = part.value;
        break;
      case 'decimal':
        decimalSeparator = part.value;
        layout.push({ kind: 'literal', value: part.value });
        break;
      case 'fraction':
        layout.push({ kind: 'fraction' });
        break;
      case 'currency':
        currencyText = part.value;
        layout.push({ kind: 'literal', value: part.value });
        break;
      default:
        // literal, percentSign, nan and the rest are fixed text.
        layout.push({ kind: 'literal', value: part.value });
    }
  }

  // Runs come left to right; group sizes are counted from the right.
  const fromRight = [...integerRuns].reverse();
  const primaryGroupSize = fromRight[0] ?? 3;
  const secondaryGroupSize = fromRight[1] ?? primaryGroupSize;

  const thresholdParts = new Intl.NumberFormat(
    locale,
    options(scale, currencyCode, 'auto'),
  ).formatToParts(THRESHOLD_PROBE);
  const groupsAtFourDigits = thresholdParts.some((part) => part.type === 'group');

  const minusSign = parts.find((part) => part.type === 'minusSign')?.value ?? '-';
  const plusSign =
    sign === 'always'
      ? (new Intl.NumberFormat(locale, options(scale, currencyCode, 'always'))
          .formatToParts(SHAPE_PROBE)
          .find((part) => part.type === 'plusSign')?.value ?? '+')
      : '+';

  const pattern: NumberPattern = {
    layout,
    groupSeparator,
    decimalSeparator,
    primaryGroupSize,
    secondaryGroupSize,
    groupingThreshold: groupsAtFourDigits ? primaryGroupSize + 1 : primaryGroupSize + 2,
    minusSign,
    plusSign,
    currencyText,
  };

  cache.set(key, pattern);
  return pattern;
}

/** Inserts a locale's separators into a run of exact integer digits. */
export function groupDigits(digits: string, pattern: NumberPattern): string {
  if (digits.length < pattern.groupingThreshold || pattern.groupSeparator === '') {
    return digits;
  }

  const groups: string[] = [];
  let rest = digits;
  let size = pattern.primaryGroupSize;

  while (rest.length > size) {
    groups.unshift(rest.slice(rest.length - size));
    rest = rest.slice(0, rest.length - size);
    size = pattern.secondaryGroupSize;
  }
  groups.unshift(rest);

  return groups.join(pattern.groupSeparator);
}

/** Assembles a locale's layout around already-grouped exact digits. */
export function applyPattern(
  pattern: NumberPattern,
  parts: { sign: string; integer: string; fraction: string },
): string {
  let out = '';
  for (const slot of pattern.layout) {
    switch (slot.kind) {
      case 'literal':
        out += slot.value;
        break;
      case 'sign':
        out += parts.sign;
        break;
      case 'integer':
        out += parts.integer;
        break;
      case 'fraction':
        out += parts.fraction;
        break;
    }
  }
  return out;
}
