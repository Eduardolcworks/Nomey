import { describe, expect, it } from 'vitest';

import { currencyDefinition } from '../../src/domain';
import { formatNumber } from '../../src/lib/format/number';
import { formatLocale } from '../../src/lib/i18n/locales';

/**
 * El importe vacío del formulario, y la regresión que provocó.
 *
 * La primera versión componía el `0,00` formateando **un cero de la moneda del
 * ámbito**. En el primer render ese ámbito todavía no ha resuelto —
 * `usePersonalScope` empieza en `idle` y la frontera tarda un viaje de red —,
 * así que el código de moneda llegaba vacío, `currencyDefinition` lanzaba, y la
 * ventana no se montaba: pulsar `+` daba error en vez de abrir.
 *
 * Aquí se fija que el hint **no dependa de la moneda**, porque no la necesita:
 * el símbolo vive en su propio control a la derecha y lo que hace falta es el
 * separador de la configuración regional y la escala.
 */

const ES = formatLocale('es-ES');
const EN = formatLocale('en');

function zero(scale: number, locale: ReturnType<typeof formatLocale>) {
  return formatNumber(0, locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
}

describe('el importe vacío', () => {
  /** La causa exacta de la regresión, para que nadie la reintroduzca. */
  it('una definición monetaria sin código LANZA, que es lo que rompía la ventana', () => {
    expect(() => currencyDefinition({ id: 'hint', code: '', scale: 2 })).toThrowError(
      /código visible/,
    );
  });

  it('y el hint se compone sin tocar ninguna definición monetaria', () => {
    // Sin ámbito, la escala cae en su valor por defecto y esto no lanza: es lo
    // único que el hint necesita para dibujarse desde el primer fotograma.
    expect(() => zero(2, ES)).not.toThrow();
    expect(zero(2, ES)).toBe('0,00');
  });

  it('el separador es el de la configuración regional, no una coma escrita a mano', () => {
    expect(zero(2, EN)).toBe('0.00');
  });

  /** JPY tiene escala 0: escribir «0,00» a mano habría inventado céntimos. */
  it('una moneda sin decimales no muestra decimales', () => {
    expect(zero(0, ES)).toBe('0');
  });

  it('y una de tres los muestra los tres', () => {
    expect(zero(3, ES)).toBe('0,000');
  });

  /**
   * El corte en el primer carácter no numérico es lo que separa los enteros de
   * los céntimos para darles distinto tamaño. Vale en las dos formas.
   */
  it('se parte por el primer carácter que no es un dígito', () => {
    for (const [texto, entero, resto] of [
      ['0,00', '0', ',00'],
      ['0.00', '0', '.00'],
      ['0', '0', ''],
    ] as const) {
      const cut = texto.search(/[^0-9]/);
      expect(cut === -1 ? texto : texto.slice(0, cut), texto).toBe(entero);
      expect(cut === -1 ? '' : texto.slice(cut), texto).toBe(resto);
    }
  });
});
