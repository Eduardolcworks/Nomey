/**
 * Locale patterns, derived from `Intl` by probing it with `format` alone.
 *
 * **The problem.** `Intl.NumberFormat.format` takes a `number`, and a Nomey
 * amount is a `bigint` of minor units. Above 2^53 that conversion drops digits
 * silently, which is the failure ADR-003 exists to prevent - a wrong figure
 * that never throws. So the amount is never handed to `Intl` at all: `Intl` is
 * asked what the locale *looks like*, and the digits are supplied from the
 * `bigint`.
 *
 * **Why `format` and not `formatToParts`.** Reading parts is the obvious way
 * to learn a locale's shape, and it is what this file did first. It crashes on
 * an iPhone. Hermes does not bundle ICU - it borrows each platform's own
 * formatters - and its own documentation is explicit that
 * `Intl.NumberFormat.prototype.formatToParts` is "supported on Android only".
 * On iOS the property is simply absent, so calling it fails with `undefined is
 * not a function` before the first screen paints.
 *
 * The same page rules out a second thing this file used to rely on:
 * `signDisplay` is unsupported on Apple platforms. That one is worse than a
 * crash, because it is ignored rather than rejected - a forced `+` would have
 * silently disappeared on device while every test on Node kept passing.
 *
 * **What is left is `format`, and it is enough.** Six probes at fixed, safe
 * magnitudes reveal the group separator, the group sizes, the digit count at
 * which grouping starts, the decimal separator, and the text that sits either
 * side of the number - symbol, spacing and sign included. Everything is
 * inferred from where the ASCII digits land, so nothing depends on an API
 * beyond the one method every runtime has.
 *
 * **One path, on every runtime.** There is no branch for a device that has
 * `formatToParts`: a second path would mean the tests exercise one
 * implementation and the phone runs the other, which is precisely how this bug
 * shipped. `formatToParts` is now reported as an optional capability that
 * Nomey does not use.
 */

/** How a locale arranges the pieces of a formatted amount. */
export interface NumberPattern {
  /** Text before and after the digits of a positive amount. */
  readonly positivePrefix: string;
  readonly positiveSuffix: string;
  /** The same for a negative one, sign included. */
  readonly negativePrefix: string;
  readonly negativeSuffix: string;
  /** What the negative form adds ahead of the positive prefix. */
  readonly minusLead: string;
  /** The locale's plus glyph, for when a sign is forced on a positive. */
  readonly plusSign: string;
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
   * four digits renders every four-digit Spanish amount wrong.
   */
  readonly groupingThreshold: number;
  /** How this locale writes the currency: a symbol for some, a code for others. */
  readonly currencyText: string;
}

/**
 * Probe magnitudes, all far below 2^53 and therefore exact as `number`s.
 *
 * `12345678` is the smallest shape showing three groups, which is what
 * separates a locale that repeats its group size from one that does not -
 * en-IN groups 1,23,45,678. `1234` answers the threshold question above.
 */
const SHAPE_PROBE = 12345678;
const THRESHOLD_PROBE = 1234;
const DECIMAL_PROBE = 1.5;

const DIGIT = /[0-9]/;

type SignMode = 'auto' | 'always';

const cache = new Map<string, NumberPattern>();

/** Test seam: probes are cached per locale, and a stubbed runtime needs a clean one. */
export function resetPatternCache(): void {
  cache.clear();
}

function currencyOptions(scale: number, currencyCode: string | null): Intl.NumberFormatOptions {
  return {
    ...(currencyCode === null ? {} : { style: 'currency', currency: currencyCode }),
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  };
}

/** Splits a formatted number into what precedes and follows its digits. */
function affixes(text: string): { prefix: string; suffix: string } {
  let first = -1;
  let last = -1;
  for (let index = 0; index < text.length; index++) {
    if (DIGIT.test(text[index])) {
      if (first === -1) first = index;
      last = index;
    }
  }
  if (first === -1) return { prefix: text, suffix: '' };
  return { prefix: text.slice(0, first), suffix: text.slice(last + 1) };
}

/** The runs of digits in a formatted integer, left to right. */
function digitRuns(text: string): string[] {
  return text.split(/[^0-9]+/).filter((run) => run.length > 0);
}

/** The first character that is not a digit, which is the separator in use. */
function separatorIn(text: string): string {
  const match = /[^0-9]/.exec(text.trim());
  return match?.[0] ?? '';
}

/**
 * Reads a locale's shape, once, and remembers it.
 *
 * Throws only if the locale itself is unusable. An unknown currency code is
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

  const integerOnly = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const grouped = integerOnly.format(SHAPE_PROBE);
  const runs = digitRuns(grouped);
  const groupSeparator = runs.length > 1 ? separatorIn(grouped) : '';

  // Runs come left to right; group sizes are counted from the right.
  const fromRight = runs.map((run) => run.length).reverse();
  const primaryGroupSize = fromRight[0] ?? 3;
  const secondaryGroupSize = fromRight[1] ?? primaryGroupSize;

  const groupsAtFourDigits = digitRuns(integerOnly.format(THRESHOLD_PROBE)).length > 1;

  const decimalSeparator = separatorIn(
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    }).format(DECIMAL_PROBE),
  );

  const currency = new Intl.NumberFormat(locale, currencyOptions(scale, currencyCode));
  const positive = affixes(currency.format(SHAPE_PROBE));
  const negative = affixes(currency.format(-SHAPE_PROBE));

  // What the negative form prepends is the sign, whatever glyph the locale
  // uses for it - some are not ASCII hyphen.
  const minusLead = negative.prefix.endsWith(positive.prefix)
    ? negative.prefix.slice(0, negative.prefix.length - positive.prefix.length)
    : '';

  const pattern: NumberPattern = {
    positivePrefix: positive.prefix,
    positiveSuffix: positive.suffix,
    negativePrefix: negative.prefix,
    negativeSuffix: negative.suffix,
    minusLead,
    plusSign: probePlusSign(locale),
    groupSeparator,
    decimalSeparator,
    primaryGroupSize,
    secondaryGroupSize,
    groupingThreshold: groupsAtFourDigits ? primaryGroupSize + 1 : primaryGroupSize + 2,
    currencyText: `${positive.prefix}${positive.suffix}`.replace(/[\s  ]/g, ''),
  };

  cache.set(key, pattern);
  return pattern;
}

/**
 * The locale's plus glyph.
 *
 * `signDisplay` is unsupported on Apple platforms, where it is ignored rather
 * than rejected, so this probe simply may not answer. When it does not, ASCII
 * `+` is used - which is what CLDR gives for every locale Nomey ships, and the
 * fallback is visible rather than silent because the probe is one line here
 * instead of an assumption spread through the formatter.
 */
function probePlusSign(locale: string): string {
  try {
    const formatted = new Intl.NumberFormat(locale, {
      signDisplay: 'always',
      maximumFractionDigits: 0,
    }).format(1);
    const leading = formatted.slice(0, formatted.search(DIGIT));
    return leading.length > 0 ? leading : '+';
  } catch {
    return '+';
  }
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

/** Wraps exact, already-grouped digits in the locale's own affixes. */
export function renderPattern(
  pattern: NumberPattern,
  value: { negative: boolean; forceSign: boolean; integer: string; fraction: string },
): string {
  const prefix = value.negative
    ? pattern.negativePrefix
    : value.forceSign
      ? `${pattern.plusSign}${pattern.positivePrefix}`
      : pattern.positivePrefix;

  const suffix = value.negative ? pattern.negativeSuffix : pattern.positiveSuffix;
  const fraction = value.fraction === '' ? '' : `${pattern.decimalSeparator}${value.fraction}`;

  return `${prefix}${value.integer}${fraction}${suffix}`;
}
