/**
 * The locales Nomey ships.
 *
 * A locale here is a *catalogue*, not every tag a device may report. `es-CL`
 * and `es-ES` both resolve to the `es-ES` catalogue; what changes with the
 * device tag is the formatting locale, which is a separate concern handled in
 * `lib/format`.
 */
export const SUPPORTED_LOCALES = ['es-ES', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Used when the device asks for a language Nomey does not ship.
 *
 * Spanish rather than English on purpose: Nomey is built in Spanish first, and
 * an unsupported language is far more likely to be a Spanish variant than
 * anything else.
 */
export const FALLBACK_LOCALE: Locale = 'es-ES';

/** The language subtag each catalogue answers to. */
const LANGUAGE_TO_LOCALE: Readonly<Record<string, Locale>> = {
  es: 'es-ES',
  en: 'en',
};

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a catalogue for an ordered list of device language tags.
 *
 * The order matters: iOS and Android both expose the user's preferred
 * languages in priority order, so a device set to Catalan first and Spanish
 * second must get Spanish, not the fallback that happens to also be Spanish.
 * Resolving to the first *supported* entry rather than only inspecting the
 * first entry is what makes that work.
 *
 * Matching is by language subtag, case-insensitively: `en-GB`, `en-US` and
 * `EN` all reach the `en` catalogue.
 */
export function resolveLocale(deviceLanguageTags: readonly string[]): Locale {
  for (const tag of deviceLanguageTags) {
    const normalised = tag.trim().toLowerCase();
    if (normalised.length === 0) continue;

    const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalised);
    if (exact !== undefined) return exact;

    const language = normalised.split('-')[0];
    const byLanguage = LANGUAGE_TO_LOCALE[language];
    if (byLanguage !== undefined) return byLanguage;
  }

  return FALLBACK_LOCALE;
}
