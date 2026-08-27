/**
 * Two different locales, and they are not interchangeable.
 *
 * **The message locale** picks a catalogue. Nomey ships two, so it is a closed
 * set of two values.
 *
 * **The format locale** picks how numbers, money and dates are written. It is
 * the device's own regional tag, kept whole: someone in Mexico reading Spanish
 * should see Mexican conventions, and someone in Britain reading Spanish
 * should still see British ones. Collapsing it to the catalogue would tell a
 * Mexican user their money is written the Spanish way because Nomey happens
 * not to ship a Mexican catalogue, which is a different claim entirely.
 *
 * They are branded apart on purpose. `'es-ES'` is a valid value of both, so a
 * plain string type would let the catalogue be passed where the region belongs
 * - which is exactly the bug this replaces, and it would have been invisible
 * on a Spanish phone.
 */

export const MESSAGE_LOCALES = ['es-ES', 'en'] as const;

export type MessageLocale = (typeof MESSAGE_LOCALES)[number];

/**
 * Used when the device asks for a language Nomey does not ship.
 *
 * Spanish rather than English on purpose: Nomey is built in Spanish first, and
 * an unsupported language is more likely to be a Spanish variant than
 * anything else. It affects the catalogue only - the region is left alone.
 */
export const FALLBACK_MESSAGE_LOCALE: MessageLocale = 'es-ES';

declare const FormatLocaleBrand: unique symbol;

/** A BCP-47 tag for formatting. Built through `formatLocale`, never cast. */
export type FormatLocale = string & { readonly [FormatLocaleBrand]: true };

/** The region used when the device offers nothing usable. */
const DEFAULT_FORMAT_TAG = 'es-ES';

/**
 * The fields of a device locale that decide formatting.
 *
 * Structural on purpose, so this module stays pure and testable without the
 * native module. `expo-localization`'s `Locale` satisfies it.
 */
export interface DeviceLocale {
  readonly languageTag: string;
  readonly languageCode: string | null;
  readonly languageScriptCode: string | null;
  readonly regionCode: string | null;
}

/**
 * Builds the tag that actually describes how this device writes things.
 *
 * **`languageTag` is not that tag**, and this is the correction that matters.
 * `expo-localization` exposes two different regions: `languageRegionCode`,
 * which belongs to the preferred *language*, and `regionCode`, which is the
 * Region setting under Language & Region - and its own documentation says to
 * "prefer using `regionCode` for any internalization purposes". `languageTag`
 * carries the first. So a phone set to Spanish (Spain) with the Region moved
 * to Mexico still reports `es-ES`, and reading that tag formats Mexican
 * amounts the Spanish way.
 *
 * The tag is composed rather than parsed, and composed by hand rather than
 * with `Intl.Locale` - which is not verified on this Hermes, and adding an
 * unchecked API is how the last crash happened.
 *
 * The script is kept when the device reports one: dropping it turns
 * `zh-Hant-TW` into `zh-TW` and silently selects the wrong writing system.
 */
export function composeFormatTag(locale: DeviceLocale): string {
  const language = locale.languageCode?.trim().toLowerCase();

  // No language means nothing to compose around; the device's own tag is the
  // best available answer, and inventing one would be worse.
  if (language === undefined || language.length === 0) return locale.languageTag;

  // A null region is not a licence to guess one. Falling back to the tag the
  // device gave keeps whatever region it did know about.
  const region = locale.regionCode?.trim().toUpperCase();
  if (region === undefined || region.length === 0) return locale.languageTag;

  const rawScript = locale.languageScriptCode?.trim();
  const script =
    rawScript === undefined || rawScript.length === 0
      ? null
      : rawScript[0].toUpperCase() + rawScript.slice(1).toLowerCase();

  return script === null ? `${language}-${region}` : `${language}-${script}-${region}`;
}

/** The language subtag each catalogue answers to. */
const LANGUAGE_TO_CATALOGUE: Readonly<Record<string, MessageLocale>> = {
  es: 'es-ES',
  en: 'en',
};

export function isMessageLocale(value: string): value is MessageLocale {
  return (MESSAGE_LOCALES as readonly string[]).includes(value);
}

/**
 * Accepts a tag as a formatting locale.
 *
 * `Intl` rejects a structurally malformed tag with a `RangeError`, which is
 * worth catching here rather than at the first amount rendered. A tag that is
 * well-formed but unknown does not throw - `Intl` resolves it to whatever it
 * has - and that is the intended behaviour, not a fallback: a German device
 * keeps German conventions even though Nomey has no German catalogue.
 */
export function formatLocale(tag: string): FormatLocale {
  const trimmed = tag.trim();
  if (trimmed.length === 0) return DEFAULT_FORMAT_TAG as FormatLocale;

  try {
    new Intl.NumberFormat(trimmed);
    return trimmed as FormatLocale;
  } catch {
    return DEFAULT_FORMAT_TAG as FormatLocale;
  }
}

/**
 * Picks a catalogue for an ordered list of device language tags.
 *
 * The order matters: both platforms expose the user's preferred languages in
 * priority order, so a device set to Catalan first and English second must get
 * English, not the fallback that happens to also be Spanish. Resolving to the
 * first *supported* entry rather than only inspecting the first is what makes
 * that work.
 *
 * Matching is by language subtag, case-insensitively: `en-GB`, `en-US` and
 * `EN` all reach the `en` catalogue.
 */
export function resolveMessageLocale(deviceLanguageTags: readonly string[]): MessageLocale {
  for (const tag of deviceLanguageTags) {
    const normalised = tag.trim().toLowerCase();
    if (normalised.length === 0) continue;

    const exact = MESSAGE_LOCALES.find((locale) => locale.toLowerCase() === normalised);
    if (exact !== undefined) return exact;

    const byLanguage = LANGUAGE_TO_CATALOGUE[normalised.split('-')[0]];
    if (byLanguage !== undefined) return byLanguage;
  }

  return FALLBACK_MESSAGE_LOCALE;
}

/**
 * Keeps the device's own language *and* region for formatting.
 *
 * Unlike the catalogue, this does not care whether Nomey ships the language:
 * the first usable locale wins, region and all, whatever language it names. A
 * German device formats German amounts even though there is no German
 * catalogue, because not shipping a language says nothing about where its
 * speaker lives.
 *
 * Takes the whole locale object rather than a tag, because the tag is exactly
 * the field that does not carry the device's Region.
 */
export function resolveFormatLocale(deviceLocales: readonly DeviceLocale[]): FormatLocale {
  for (const locale of deviceLocales) {
    const composed = composeFormatTag(locale);
    if (composed.trim().length > 0) return formatLocale(composed);
  }
  return DEFAULT_FORMAT_TAG as FormatLocale;
}
