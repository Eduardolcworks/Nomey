import { useCallback, useSyncExternalStore } from 'react';

import {
  getFormatLocale,
  getLanguagePreference,
  getMessageLocale,
  type LanguagePreference,
  setLanguagePreference,
  subscribeToLocale,
} from './active-locale';
import type { FormatLocale, MessageLocale } from './locales';
import type { MessageKey } from './messages';
import { translate, type TranslationParams } from './translate';

/** Which catalogue is active. Changes when the preference changes. */
export function useMessageLocale(): MessageLocale {
  return useSyncExternalStore(subscribeToLocale, getMessageLocale, getMessageLocale);
}

/**
 * Which region formats numbers, money and dates.
 *
 * Deliberately a separate hook from `useMessageLocale`, and returning a
 * separate type. One hook returning "the locale" is how the catalogue ended up
 * formatting money, and on a Spanish phone nothing looked wrong.
 */
export function useFormatLocale(): FormatLocale {
  return useSyncExternalStore(subscribeToLocale, getFormatLocale, getFormatLocale);
}

/** The three-state preference, for the language picker Ajustes will have. */
export function useLanguagePreference(): [LanguagePreference, (next: LanguagePreference) => void] {
  const preference = useSyncExternalStore(
    subscribeToLocale,
    getLanguagePreference,
    getLanguagePreference,
  );
  return [preference, setLanguagePreference];
}

/**
 * The hook every screen uses for text.
 *
 * `t` is bound to the active catalogue, so a component never handles a locale
 * itself - which is what keeps the picker a one-line change later.
 */
export function useTranslation(): {
  t: (key: MessageKey, params?: TranslationParams) => string;
  locale: MessageLocale;
} {
  const locale = useMessageLocale();

  const t = useCallback(
    (key: MessageKey, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  );

  return { t, locale };
}
