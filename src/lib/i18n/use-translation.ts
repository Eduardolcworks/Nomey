import { useCallback, useSyncExternalStore } from 'react';

import { getActiveLocale, subscribeToLocale } from './active-locale';
import type { Locale } from './locales';
import type { MessageKey } from './messages';
import { translate, type TranslationParams } from './translate';

/** The active locale, re-rendering when a future language picker changes it. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeToLocale, getActiveLocale, getActiveLocale);
}

/**
 * The hook every screen uses.
 *
 * `t` is bound to the active locale, so a component never handles a locale
 * itself - which is what keeps the override a one-line change later.
 */
export function useTranslation(): {
  t: (key: MessageKey, params?: TranslationParams) => string;
  locale: Locale;
} {
  const locale = useLocale();

  const t = useCallback(
    (key: MessageKey, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  );

  return { t, locale };
}
