import { describe, expect, it } from 'vitest';

import { currencyDefinition, money, moneyFromMinorString } from '../../src/domain';
import { formatDate, monthNames } from '../../src/lib/format/date';
import { currencySymbol, formatMoney } from '../../src/lib/format/money';
import { formatNumber, formatPercent } from '../../src/lib/format/number';

/**
 * Formateo localizado.
 *
 * Estos tests corren sobre el `Intl` de Node (V8), no sobre el de Hermes. Lo
 * que fijan es el **contrato**: qué escala se respeta, qué no se convierte
 * nunca a `number` y qué separa a un locale de otro. La medición del `Intl`
 * real del dispositivo es otra cosa y vive en la pantalla de diagnóstico.
 */

const EUR = currencyDefinition({ id: 'eur-1', code: 'EUR', scale: 2 });
const JPY = currencyDefinition({ id: 'jpy-1', code: 'JPY', scale: 0 });
const BHD = currencyDefinition({ id: 'bhd-1', code: 'BHD', scale: 3 });

/** Quita los espacios finos y duros que usa CLDR, para comparar sin sorpresas. */
const plain = (text: string) => text.replace(/[   ]/g, ' ');

describe('importe monetario', () => {
  it('el mismo importe cambia de forma con el locale', () => {
    const value = money(5000n, EUR);
    expect(plain(formatMoney(value, 'es-ES'))).toBe('50,00 €');
    expect(plain(formatMoney(value, 'en'))).toBe('€50.00');
  });

  it('agrupa y separa según el locale, no según un formato inventado', () => {
    const value = money(123456789n, EUR);
    expect(plain(formatMoney(value, 'es-ES'))).toBe('1.234.567,89 €');
    expect(plain(formatMoney(value, 'en'))).toBe('€1,234,567.89');
  });

  it('la escala sale de la definición monetaria, nunca de un 2 fijo', () => {
    // 5000 unidades mínimas son 50,00 € y 5000 ¥: el mismo entero, distinta
    // escala. Es el invariante de AGENTS.md section 1.
    expect(plain(formatMoney(money(5000n, EUR), 'en'))).toBe('€50.00');
    expect(plain(formatMoney(money(5000n, JPY), 'en'))).toBe('¥5,000');
    expect(plain(formatMoney(money(5000n, BHD), 'en'))).toBe('BHD 5.000');
  });

  it('respeta el umbral de agrupación de cada locale', () => {
    // es-ES no agrupa cuatro dígitos: 5000 JPY, no 5.000 JPY. Suponer que la
    // agrupación empieza siempre en cuatro dígitos rompe justo este caso.
    expect(plain(formatMoney(money(5000n, JPY), 'es-ES'))).toBe('5000 JPY');
    expect(plain(formatMoney(money(50000n, JPY), 'es-ES'))).toBe('50.000 JPY');
    // en sí agrupa desde cuatro.
    expect(plain(formatMoney(money(5000n, JPY), 'en'))).toBe('¥5,000');
  });

  it('coloca el signo donde lo pone el locale', () => {
    const negative = money(-123456n, EUR);
    // Sin separador en es-ES: cuatro dígitos no llegan al umbral de agrupación.
    expect(plain(formatMoney(negative, 'es-ES'))).toBe('-1234,56 €');
    expect(plain(formatMoney(negative, 'en'))).toBe('-€1,234.56');
    expect(plain(formatMoney(money(-1234567n, EUR), 'es-ES'))).toBe('-12.345,67 €');
  });

  it('puede forzar el signo, que es la señal no cromática de entra/sale', () => {
    // design-direction.md section 8: el color nunca es la única señal.
    expect(plain(formatMoney(money(2500n, EUR), 'es-ES', { sign: 'always' }))).toBe('+25,00 €');
    expect(plain(formatMoney(money(-2500n, EUR), 'es-ES', { sign: 'always' }))).toBe('-25,00 €');
    expect(plain(formatMoney(money(0n, EUR), 'es-ES', { sign: 'always' }))).toBe('+0,00 €');
  });

  it('puede omitir la moneda para una columna que ya la declara', () => {
    expect(plain(formatMoney(money(123456n, EUR), 'es-ES', { currencyDisplay: 'none' }))).toBe(
      '1234,56',
    );
    expect(plain(formatMoney(money(1234567n, EUR), 'es-ES', { currencyDisplay: 'none' }))).toBe(
      '12.345,67',
    );
  });

  it('formatea el cero con su escala', () => {
    expect(plain(formatMoney(money(0n, EUR), 'es-ES'))).toBe('0,00 €');
    expect(plain(formatMoney(money(0n, JPY), 'en'))).toBe('¥0');
  });

  it('rellena cuando hay menos dígitos que escala', () => {
    expect(plain(formatMoney(money(7n, EUR), 'es-ES'))).toBe('0,07 €');
    expect(plain(formatMoney(money(-7n, EUR), 'es-ES'))).toBe('-0,07 €');
    expect(plain(formatMoney(money(5n, BHD), 'en'))).toBe('BHD 0.005');
  });

  it('no rompe con un código que ICU no conoce', () => {
    // El código es un atributo del catálogo, no un valor que ICU valide.
    const unknown = currencyDefinition({ id: 'x-1', code: 'XYZ', scale: 2 });
    expect(() => formatMoney(money(123n, unknown), 'es-ES')).not.toThrow();
  });

  it('expone el texto de moneda del locale', () => {
    expect(currencySymbol('en', 'EUR', 2)).toBe('€');
    expect(currencySymbol('en', 'JPY', 0)).toBe('¥');
    expect(currencySymbol('es-ES', 'JPY', 0)).toBe('JPY');
  });
});

describe('exactitud por encima de 2^53', () => {
  /**
   * El límite del problema. `Number.MAX_SAFE_INTEGER` es 9007199254740991, así
   * que a partir de ahí convertir a `number` pierde dígitos en silencio: es
   * exactamente el fallo que ADR-003 existe para impedir.
   */
  it('conserva todos los dígitos de un importe mayor que MAX_SAFE_INTEGER', () => {
    const huge = moneyFromMinorString('123456789012345678901', EUR);
    const formatted = plain(formatMoney(huge, 'en'));

    expect(formatted).toBe('€1,234,567,890,123,456,789.01');
    // Y la prueba directa: los dígitos sobreviven al viaje.
    expect(formatted.replace(/[^\d]/g, '')).toBe('123456789012345678901');
  });

  it('la vía ingenua sí habría perdido dígitos', () => {
    // Se deja escrito lo que NO se hace, porque el fallo es silencioso.
    const naive = Number(123456789012345678901n) / 100;
    expect(naive.toFixed(2)).not.toBe('1234567890123456789.01');
  });

  it('conserva los dígitos también en es-ES y con escala 0', () => {
    expect(plain(formatMoney(moneyFromMinorString('98765432109876543210', JPY), 'es-ES'))).toBe(
      '98.765.432.109.876.543.210 JPY',
    );
  });

  it('conserva los dígitos de un negativo enorme', () => {
    const formatted = plain(formatMoney(moneyFromMinorString('-90071992547409910', EUR), 'en'));
    expect(formatted).toBe('-€900,719,925,474,099.10');
  });
});

describe('número y porcentaje', () => {
  it('usa los separadores del locale', () => {
    expect(plain(formatNumber(1234567.89, 'es-ES'))).toBe('1.234.567,89');
    expect(plain(formatNumber(1234567.89, 'en'))).toBe('1,234,567.89');
  });

  it('formatea un porcentaje desde el ratio', () => {
    expect(plain(formatPercent(0.65, 'es-ES'))).toBe('65 %');
    expect(plain(formatPercent(0.65, 'en'))).toBe('65%');
    expect(plain(formatPercent(0.6543, 'en', 1))).toBe('65.4%');
  });
});

describe('fecha', () => {
  it('formatea una fecha de calendario según el locale', () => {
    expect(plain(formatDate('2026-08-27', 'es-ES', 'medium'))).toMatch(/27/);
    expect(plain(formatDate('2026-08-27', 'en', 'medium'))).toMatch(/27/);
    expect(formatDate('2026-08-27', 'es-ES', 'long')).toContain('agosto');
    expect(formatDate('2026-08-27', 'en', 'long')).toContain('August');
  });

  it('no desplaza el día por zona horaria', () => {
    // Es el fallo que motiva parsear y formatear en UTC: al oeste de UTC, un
    // 2026-01-01 tratado como instante local se muestra como 31 de diciembre.
    for (const locale of ['es-ES', 'en']) {
      expect(formatDate('2026-01-01', locale, 'medium')).toMatch(/\b1\b/);
      expect(formatDate('2026-01-01', locale, 'medium')).toMatch(/2026/);
      expect(formatDate('2026-12-31', locale, 'medium')).toMatch(/31/);
      expect(formatDate('2026-12-31', locale, 'medium')).toMatch(/2026/);
    }
  });

  it('devuelve la entrada intacta si no es una fecha de calendario', () => {
    expect(formatDate('', 'es-ES')).toBe('');
    expect(formatDate('27/08/2026', 'es-ES')).toBe('27/08/2026');
    expect(formatDate('2026-08-27T10:00:00Z', 'es-ES')).toBe('2026-08-27T10:00:00Z');
  });

  it('da los nombres de mes del locale', () => {
    expect(monthNames('es-ES')[0]).toBe('enero');
    expect(monthNames('en')[0]).toBe('January');
    expect(monthNames('es-ES')).toHaveLength(12);
  });
});

describe('fidelidad frente a ICU', () => {
  /**
   * La prueba de fondo del diseño.
   *
   * `formatMoney` no delega en `Intl.format`: reconstruye la cadena a partir de
   * los dígitos exactos y de la forma que `formatToParts` describe. Eso solo
   * vale si el resultado es **idéntico** al que ICU daría cuando ICU sí puede
   * hacerlo, es decir con valores por debajo del límite seguro.
   *
   * Si algún día divergen, es este test el que lo dice, y no una captura de
   * pantalla seis meses después.
   */
  const CASES: readonly [string, bigint][] = [
    ['cero', 0n],
    ['una unidad mínima', 1n],
    ['por debajo de la escala', 7n],
    ['dos dígitos', 42n],
    ['tres dígitos', 999n],
    ['justo bajo el umbral', 123456n],
    ['justo sobre el umbral', 1234567n],
    ['siete grupos', 1234567890123n],
    ['negativo pequeño', -5n],
    ['negativo grande', -987654321n],
  ];

  for (const locale of ['es-ES', 'en']) {
    for (const currency of [EUR, JPY, BHD]) {
      it.each(CASES)(`${locale} · ${currency.code} · %s`, (_name, minor) => {
        const expected = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency.code,
          minimumFractionDigits: currency.scale,
          maximumFractionDigits: currency.scale,
        }).format(Number(minor) / 10 ** currency.scale);

        expect(formatMoney(money(minor, currency), locale)).toBe(expected);
      });
    }
  }
});
