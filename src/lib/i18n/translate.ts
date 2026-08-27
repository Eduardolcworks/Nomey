import type { Locale } from './locales';
import { FALLBACK_LOCALE } from './locales';
import { CATALOGUES, type MessageKey } from './messages';

export type TranslationParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Resolves a message for a locale.
 *
 * Pure on purpose: no React, no Expo, no module state. That is what lets the
 * catalogues and the interpolation be tested directly, and it keeps the only
 * device-dependent part of i18n - which locale is active - in one other file.
 *
 * Three layers of safety, in order: the key type makes an unknown key a
 * compile error, a missing catalogue entry falls back to Spanish, and a
 * missing entry there returns the key itself. The last one is deliberately
 * ugly - a visible `foundation.caption` on screen is a bug report; an empty
 * string is a mystery.
 */
export function translate(locale: Locale, key: MessageKey, params?: TranslationParams): string {
  const template = CATALOGUES[locale][key] ?? CATALOGUES[FALLBACK_LOCALE][key] ?? key;

  if (params === undefined) return template;

  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params[name];
    // An unresolved placeholder stays visible rather than becoming "undefined",
    // for the same reason a missing key returns the key.
    return value === undefined ? placeholder : String(value);
  });
}
