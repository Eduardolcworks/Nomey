import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatLocale } from '../../src/lib/i18n/locales';
import { currencyDefinition, money, moneyFromMinorString } from '../../src/domain';
import { intlReport } from '../../src/lib/format/intl-report';
import { formatMoney } from '../../src/lib/format/money';
import { resetPatternCache } from '../../src/lib/format/pattern';

/**
 * El runtime degradado: `Intl` sin `formatToParts`.
 *
 * Es el `Intl` real de un iPhone. Hermes no empaqueta ICU —toma el formateador
 * de cada plataforma— y su propia documentación dice que
 * `Intl.NumberFormat.prototype.formatToParts` está «supported on Android
 * only». En iOS la propiedad no existe, y llamarla revienta con «undefined is
 * not a function» antes de pintar la primera pantalla. Eso es exactamente lo
 * que pasó.
 *
 * Estos tests borran el método y comprueban que **la salida no cambia en
 * absoluto**. No prueban un camino alternativo: prueban que no hay dos
 * caminos. Si alguien reintroduce una dependencia de `formatToParts`, aquí se
 * cae, en CI, y no en un iPhone.
 */

const EUR = currencyDefinition({ id: 'eur-1', code: 'EUR', scale: 2 });
const JPY = currencyDefinition({ id: 'jpy-1', code: 'JPY', scale: 0 });

const ES = formatLocale('es-ES');
const EN = formatLocale('en');

const plain = (text: string) => text.replace(/[   ]/g, ' ');

type WithParts = { formatToParts?: unknown };

let saved: unknown;

function withoutFormatToParts() {
  const proto = Intl.NumberFormat.prototype as WithParts;
  saved = proto.formatToParts;
  delete proto.formatToParts;
  // Las sondas se cachean por locale: una cacheada antes de degradar el
  // runtime ocultaría el fallo entero.
  resetPatternCache();
}

function restoreFormatToParts() {
  const proto = Intl.NumberFormat.prototype as WithParts;
  proto.formatToParts = saved;
  resetPatternCache();
}

describe('sin Intl.NumberFormat.prototype.formatToParts', () => {
  beforeEach(withoutFormatToParts);
  afterEach(restoreFormatToParts);

  it('el método está realmente ausente durante estos tests', () => {
    expect((Intl.NumberFormat.prototype as WithParts).formatToParts).toBeUndefined();
    expect(() => new Intl.NumberFormat('en').formatToParts(1)).toThrow();
  });

  it('EUR en es-ES', () => {
    expect(plain(formatMoney(money(5000n, EUR), ES))).toBe('50,00 €');
    expect(plain(formatMoney(money(123456789n, EUR), ES))).toBe('1.234.567,89 €');
  });

  it('EUR en en', () => {
    expect(plain(formatMoney(money(5000n, EUR), EN))).toBe('€50.00');
    expect(plain(formatMoney(money(123456789n, EUR), EN))).toBe('€1,234,567.89');
  });

  it('JPY conserva su escala 0 en los dos idiomas', () => {
    expect(plain(formatMoney(money(5000n, JPY), EN))).toBe('¥5,000');
    expect(plain(formatMoney(money(5000n, JPY), ES))).toBe('5000 JPY');
  });

  it('positivo y negativo', () => {
    expect(plain(formatMoney(money(2500n, EUR), ES))).toBe('25,00 €');
    expect(plain(formatMoney(money(-2500n, EUR), ES))).toBe('-25,00 €');
    expect(plain(formatMoney(money(-2500n, EUR), EN))).toBe('-€25.00');
  });

  it('el signo forzado sigue funcionando sin signDisplay', () => {
    // `signDisplay` tampoco existe en iOS: se ignora en vez de fallar, que es
    // peor que un crash porque el `+` desaparece en silencio.
    expect(plain(formatMoney(money(2500n, EUR), ES, { sign: 'always' }))).toBe('+25,00 €');
    expect(plain(formatMoney(money(-2500n, EUR), ES, { sign: 'always' }))).toBe('-25,00 €');
  });

  it('agrupación de cuatro y de cinco o más cifras', () => {
    // es-ES no agrupa a los cuatro dígitos; en sí.
    expect(plain(formatMoney(money(123456n, EUR), ES))).toBe('1234,56 €');
    expect(plain(formatMoney(money(1234567n, EUR), ES))).toBe('12.345,67 €');
    expect(plain(formatMoney(money(123456n, EUR), EN))).toBe('€1,234.56');
    expect(plain(formatMoney(money(1234567n, EUR), EN))).toBe('€12,345.67');
  });

  it('el cero, con la escala de cada definición', () => {
    expect(plain(formatMoney(money(0n, EUR), ES))).toBe('0,00 €');
    expect(plain(formatMoney(money(0n, JPY), EN))).toBe('¥0');
  });

  it('por encima de 2^53 no pierde un solo dígito', () => {
    const huge = plain(formatMoney(moneyFromMinorString('123456789012345678901', EUR), EN));
    expect(huge).toBe('€1,234,567,890,123,456,789.01');
    expect(huge.replace(/\D/g, '')).toBe('123456789012345678901');

    const esES = plain(formatMoney(moneyFromMinorString('123456789012345678901', EUR), ES));
    expect(esES.replace(/\D/g, '')).toBe('123456789012345678901');
  });

  it('el informe marca formatToParts como ausente y todo lo demás correcto', () => {
    const report = intlReport();
    const parts = report.find((entry) => entry.id === '.formatToParts');
    const exact = report.find((entry) => entry.id === 'exactitud > 2^53');

    expect(parts?.status).toBe('optional-absent');
    expect(exact?.status).toBe('ok');
    // Lo que la pantalla debe poder decir: falta una capability opcional y la
    // ruta de Nomey funciona igual.
    expect(report.filter((entry) => entry.status === 'failed')).toEqual([]);
  });

  it('el informe no lanza aunque falte la capability', () => {
    expect(() => intlReport()).not.toThrow();
  });
});

describe('ningún importe se convierte a number', () => {
  /**
   * La prueba directa, y la única que no se puede falsear leyendo el código.
   *
   * Se instrumenta `Intl.NumberFormat.prototype.format` para anotar cada valor
   * que recibe. Después se formatea un importe de 21 dígitos y se comprueba
   * que **ninguna** de esas llamadas llevaba el importe: solo las sondas de
   * magnitud fija. Si alguien "arreglara" algo pasando el importe a `Intl`,
   * este test lo ve aunque la cadena resultante pareciera correcta.
   */
  const SEEN: unknown[] = [];
  const OriginalNumberFormat = Intl.NumberFormat;

  beforeEach(() => {
    SEEN.length = 0;

    // `format` es un getter del prototipo que devuelve una función ligada, así
    // que no se puede reasignar ahí. Se envuelve el constructor y se define la
    // propiedad sobre cada instancia.
    const wrapped = function NumberFormat(
      ...args: ConstructorParameters<typeof Intl.NumberFormat>
    ) {
      const instance = new OriginalNumberFormat(...args);
      const inner = instance.format.bind(instance);
      Object.defineProperty(instance, 'format', {
        value: (value: number) => {
          SEEN.push(value);
          return inner(value);
        },
      });
      return instance;
    };
    wrapped.prototype = OriginalNumberFormat.prototype;

    (Intl as { NumberFormat: unknown }).NumberFormat = wrapped;
    resetPatternCache();
  });

  afterEach(() => {
    (Intl as { NumberFormat: unknown }).NumberFormat = OriginalNumberFormat;
    resetPatternCache();
  });

  it('solo pasa sondas de magnitud fija a Intl', () => {
    const minor = '123456789012345678901';
    const formatted = formatMoney(moneyFromMinorString(minor, EUR), EN);

    expect(formatted.replace(/\D/g, '')).toBe(minor);
    expect(SEEN.length).toBeGreaterThan(0);

    const PROBES = new Set([12345678, -12345678, 1234, 1.5, 1]);
    for (const value of SEEN) {
      expect(PROBES.has(value as number), `Intl recibió ${String(value)}`).toBe(true);
    }
  });

  it('ninguna llamada lleva el importe ni nada derivado de él', () => {
    const minor = 90071992547409911n; // MAX_SAFE_INTEGER + 920
    formatMoney(money(minor, EUR), ES);

    for (const value of SEEN) {
      expect(String(value)).not.toContain('9007199254740991');
      expect(Math.abs(Number(value))).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });
});
