import { useMemo } from 'react';

import type { Money } from '@/domain';

import { useFormatLocale } from '../i18n';
import { type DateStyle, formatDate } from './date';
import { formatMoney, type MoneyFormatOptions } from './money';
import { formatNumber, formatPercent } from './number';

/**
 * The formatters, bound to the active locale.
 *
 * Screens use this rather than the bare functions, so no component decides
 * which locale it formats in - the same reason `useTranslation` exists. The
 * day formatting locale stops tracking the catalogue locale, it changes here
 * and nowhere else.
 */
export function useFormat() {
  const locale = useFormatLocale();

  return useMemo(
    () => ({
      locale,
      money: (value: Money, options?: MoneyFormatOptions) => formatMoney(value, locale, options),
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, options),
      percent: (ratio: number, fractionDigits?: number) =>
        formatPercent(ratio, locale, fractionDigits),
      date: (value: string, style?: DateStyle) => formatDate(value, locale, style),
    }),
    [locale],
  );
}
