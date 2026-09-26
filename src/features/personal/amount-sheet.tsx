import { type CurrencyOption, labelCurrencies } from '@/lib/currency';
import { currencySymbol, useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import {
  AmountSheet as SharedAmountSheet,
  type AmountSheetProps as SharedAmountSheetProps,
} from '@/ui/components';

export { SaveButton } from '@/ui/components';

/**
 * LA VENTANA DE UNA CIFRA, con los textos y el patrón regional del Modo Personal.
 *
 * **La composición ya no vive aquí**: está en `ui/components/amount-sheet.tsx`,
 * porque el alta de un gasto compartido monta exactamente la misma y una feature
 * no puede leer de otra. Lo que queda en este archivo es lo único que era de
 * Personal: **qué textos lleva y de qué catálogo salen**.
 *
 * Los cuatro valores que se resuelven aquí son los que el diseño no puede
 * calcular por sí mismo sin leer de infraestructura:
 *
 *   el símbolo de la moneda     `lib/format`, por patrón regional
 *   el separador decimal        `lib/format`, formateando un cero de esa escala
 *   la etiqueta del control     `lib/i18n`
 *   la nota de moneda fija      `lib/i18n`
 *   el título del menú          `lib/i18n`
 *   el rótulo de cada divisa    `lib/format`, por patrón regional
 *
 * Las tres pantallas que ya la usaban —«Añadir movimiento», «Editar movimiento»
 * y «Editar disponible»— siguen importando `AmountSheet` de aquí con las mismas
 * `props` que antes: la mudanza no cambia una sola línea de las tres.
 */
export type AmountSheetProps = Omit<
  SharedAmountSheetProps,
  | 'currencySymbol'
  | 'decimalSeparator'
  | 'currencyLabel'
  | 'currencyNote'
  | 'currencyTitle'
  | 'currencyOptions'
> & {
  /**
   * EL CATÁLOGO TAL COMO SALE DE `lib/currency`, sin rótulos.
   *
   * El rótulo del menú —`€ EUR`— lo compone este envoltorio, que es quien tiene
   * el patrón regional; la hoja de `ui/` lo recibe ya resuelto, igual que el
   * símbolo. Quien monta la pantalla no tiene que saber nada de eso.
   */
  readonly currencyOptions?: readonly CurrencyOption[] | null;
};

export function AmountSheet(props: AmountSheetProps) {
  const { t } = useTranslation();
  const format = useFormat();

  const scale = props.currency?.scale ?? 2;

  /*
   * EL SEPARADOR SALE DE LA CONFIGURACIÓN REGIONAL, no de un literal.
   *
   * Se formatea un cero con la escala pedida y se lee de ahí el primer carácter
   * que no es dígito: viene bien en euros —`0,00`—, en yenes —`0`, sin
   * separador— y en dinares —`0,000`—. Un `','` escrito a mano sería una coma en
   * inglés y unos decimales donde no los hay.
   */
  const zero = format.number(0, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const cut = zero.search(/[^0-9]/);

  return (
    <SharedAmountSheet
      {...props}
      currencySymbol={
        props.currency === null
          ? ''
          : currencySymbol(format.locale, props.currency.code, props.currency.scale)
      }
      decimalSeparator={cut === -1 ? '' : zero.slice(cut, cut + 1)}
      currencyLabel={t('entry.currencyLabel', { code: props.currency?.code ?? '' })}
      /*
       * DOS NOTAS DISTINTAS, porque son dos situaciones distintas. Sin
       * `currencyOptions` esta pantalla no ofrece elegir —editar el Disponible—
       * y la nota es la de siempre. Con `null` sí ofrecía y el catálogo no
       * llegó: decir «de momento se usa la tuya» sería describir una decisión
       * de producto donde lo que hay es una consulta que falló.
       */
      currencyNote={t(
        props.currencyOptions === null ? 'entry.currencyUnavailable' : 'entry.currencyFixed',
      )}
      currencyTitle={t('entry.currencyTitle')}
      currencyOptions={labelCurrencies(format.locale, props.currencyOptions)}
    />
  );
}
