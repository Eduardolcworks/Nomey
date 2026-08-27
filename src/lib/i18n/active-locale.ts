import { getLocales } from 'expo-localization';

import {
  type FormatLocale,
  type MessageLocale,
  resolveFormatLocale,
  resolveMessageLocale,
} from './locales';

/**
 * The language preference, and the two locales it resolves to.
 *
 * Ajustes will offer exactly three states - Automatic, Español, English - and
 * this is them. Automatic is the default and follows the device; the other two
 * pin the catalogue.
 *
 * **The preference never touches the region.** Forcing English on a Spanish
 * phone changes which catalogue is read and nothing else: amounts and dates
 * keep Spanish conventions, because the user moved to another language, not to
 * another country.
 */
export type LanguagePreference = 'system' | MessageLocale;

let preference: LanguagePreference = 'system';

const listeners = new Set<() => void>();

/**
 * The device's preferred languages, read once.
 *
 * `getLocales()` is synchronous and reflects the OS setting at startup. It is
 * cached because resolving on every render would re-read native state for a
 * value that only changes when the user leaves the app to change a system
 * setting - which restarts it on both platforms.
 */
let deviceTags: string[] | null = null;

function tags(): string[] {
  deviceTags ??= getLocales().map((locale) => locale.languageTag);
  return deviceTags;
}

/** The device's own language tag, unresolved. For diagnostics only. */
export function deviceLanguageTag(): string {
  return tags()[0] ?? 'unknown';
}

/** Which catalogue is read. */
export function getMessageLocale(): MessageLocale {
  return preference === 'system' ? resolveMessageLocale(tags()) : preference;
}

/** How numbers, money and dates are written. Never affected by the preference. */
export function getFormatLocale(): FormatLocale {
  return resolveFormatLocale(tags());
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

/**
 * The single entry point a language picker needs.
 *
 * **Persistence is deliberately absent.** Storing a preference needs a storage
 * decision that belongs with the settings feature, and guessing it now would
 * mean writing a migration later. When that arrives, restoring a saved choice
 * is one call to this function at startup, and saving it is one call in the
 * picker's handler. Nothing else changes, because no screen reads a locale
 * directly.
 */
export function setLanguagePreference(next: LanguagePreference): void {
  if (preference === next) return;
  preference = next;
  for (const listener of listeners) listener();
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: device tags are read once, and a fake device needs a fresh read. */
export function resetLocaleState(): void {
  preference = 'system';
  deviceTags = null;
}
