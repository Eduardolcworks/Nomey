import { currencySymbol } from '@/lib/format/money';
import type { FormatLocale } from '@/lib/i18n/locales';

import type { CurrencyOption } from './catalogue';

/** Una divisa lista para el menú del sistema: identidad, código y rótulo. */
export type LabelledCurrency = {
  readonly id: string;
  readonly code: string;
  readonly label: string;
};

/**
 * EL RÓTULO DE UNA DIVISA EN EL MENÚ: `símbolo siglas`.
 *
 * `€ EUR`, `US$ USD`, `$ CAD`. El símbolo no se escribe a mano en ninguna parte
 * —`AGENTS.md` §6— sino que sale del MISMO patrón regional con el que se
 * formatean los importes de esa divisa, así que el oblongo compacto y su
 * entrada del menú no pueden discrepar sobre si esta configuración dice `€` o
 * `EUR`.
 *
 * **Sin siglas repetidas.** Para una divisa que ICU no escribe con símbolo en
 * esta configuración —`JPY` en español, sin ir más lejos— el patrón devuelve el
 * propio código, y `JPY JPY` sería ruido. Ahí el rótulo es el código a secas.
 *
 * La escala entra porque es lo que pide `currencySymbol`, no porque se formatee
 * ninguna cifra aquí: pertenece a la definición monetaria y nunca se presupone
 * que sean dos (F02/ADR-001).
 */
export function currencyLabel(locale: FormatLocale, option: CurrencyOption): string {
  const symbol = currencySymbol(locale, option.code, option.scale);
  return symbol === option.code ? option.code : `${symbol} ${option.code}`;
}

/**
 * El catálogo con su rótulo ya resuelto, o `null` tal cual.
 *
 * Se hace aquí y no en el componente porque el patrón regional vive en
 * `lib/format` y `ui/` no lee de `lib/`: lo mismo que ya pasaba con
 * `currencySymbol`, que entra en la hoja ya formateado.
 */
export function labelCurrencies(
  locale: FormatLocale,
  options: readonly CurrencyOption[] | null | undefined,
): readonly LabelledCurrency[] | null {
  if (options === null || options === undefined) return null;
  return options.map((option) => ({
    id: option.id,
    code: option.code,
    label: currencyLabel(locale, option),
  }));
}
