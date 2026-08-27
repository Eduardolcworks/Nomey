import { getLocales } from 'expo-localization';

import { type Locale, resolveLocale } from './locales';

/**
 * Which locale the app is using right now, and the one place that decides it.
 *
 * Nomey follows the system language. The override below is the seam that lets
 * a language picker land in Ajustes later without reopening i18n: the picker
 * will call `setLocaleOverride`, persist the choice, and restore it at start
 * up. Nothing else has to change - no screen reads a locale directly.
 *
 * Persistence is deliberately NOT here. Storing a preference needs a storage
 * decision that belongs with the settings feature, and guessing it now would
 * mean writing a migration later.
 */

let override: Locale | null = null;

const listeners = new Set<() => void>();

/**
 * The device's preferred languages, read once.
 *
 * `getLocales()` is synchronous and reflects the OS setting at startup. It is
 * cached because resolving on every render would re-read native state to
 * produce a value that only changes when the user leaves the app to change a
 * system setting - which restarts it on both platforms.
 */
let deviceLocale: Locale | null = null;

function resolveDeviceLocale(): Locale {
  deviceLocale ??= resolveLocale(getLocales().map((locale) => locale.languageTag));
  return deviceLocale;
}

/** The device's own language tag, unresolved. For diagnostics only. */
export function deviceLanguageTag(): string {
  return getLocales()[0]?.languageTag ?? 'unknown';
}

export function getActiveLocale(): Locale {
  return override ?? resolveDeviceLocale();
}

/** `null` restores the system language. */
export function setLocaleOverride(locale: Locale | null): void {
  if (override === locale) return;
  override = locale;
  for (const listener of listeners) listener();
}

export function getLocaleOverride(): Locale | null {
  return override;
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
