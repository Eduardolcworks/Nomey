import { describe, expect, it } from 'vitest';
import raw from '../vectors/fx-derivation.json';
import {
  convert,
  convertWithinRange,
  currencyDefinition,
  DERIVED_RATE_SCALE,
  deriveRate,
  exchangeRate,
  INT64_MAX,
  INT64_MIN,
  moneyFromMinorString,
  moneyToMinorString,
  PIVOT_QUOTE,
  sourceDecimalToRate,
} from '../../src/domain';
import type { CurrencyDefinition } from '../../src/domain';
import { title, type VectorCase } from './vectors';

interface Side {
  readonly currency: string;
  readonly quote: string;
  readonly referenceDate?: string;
}

interface DerivationCase extends VectorCase {
  readonly given: { readonly origin: Side; readonly target: Side; readonly amount?: string };
  readonly expect?: {
    readonly rate: { readonly coefficient: string; readonly scale: number };
    readonly converted?: string;
  };
  readonly expectConversionError?: string;
}

const catalogue = raw.catalogue as unknown as Readonly<
  Record<string, { id: string; code: string; scale: number }>
>;
const cases = raw.cases as unknown as readonly DerivationCase[];

function definition(key: string): CurrencyDefinition {
  const found = catalogue[key];
  if (found === undefined) throw new Error(`Moneda desconocida en fx-derivation.json: ${key}`);
  return currencyDefinition(found);
}

describe('derivación del tipo y conversión · F11/ADR-001 §7', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    const origin = sourceDecimalToRate(item.given.origin.quote);
    const target = sourceDecimalToRate(item.given.target.quote);
    const derive = () => deriveRate(origin, target);

    if (item.expectError !== undefined) {
      expect(derive).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }

    const rate = derive();
    expect(rate.coefficient).toBe(BigInt(item.expect?.rate.coefficient ?? 'x'));
    expect(rate.scale).toBe(item.expect?.rate.scale);

    if (item.given.amount === undefined) return;

    const amount = moneyFromMinorString(item.given.amount, definition(item.given.origin.currency));
    const convertIt = () =>
      convertWithinRange(amount, definition(item.given.target.currency), rate);

    if (item.expectConversionError !== undefined) {
      expect(convertIt).toThrowError(expect.objectContaining({ code: item.expectConversionError }));
      return;
    }

    const result = convertIt();
    expect(moneyToMinorString(result)).toBe(item.expect?.converted);
    expect(result.currency.id).toBe(catalogue[item.given.target.currency]?.id);
  });

  it('todos los tipos derivados tienen la escala canónica', () => {
    for (const item of cases.filter((c) => c.expectError === undefined)) {
      const rate = deriveRate(
        sourceDecimalToRate(item.given.origin.quote),
        sourceDecimalToRate(item.given.target.quote),
      );
      expect(rate.scale).toBe(DERIVED_RATE_SCALE);
    }
  });

  it('el pivote contra sí mismo es exactamente 1', () => {
    const rate = deriveRate(PIVOT_QUOTE, PIVOT_QUOTE);
    expect(rate.coefficient).toBe(10n ** 12n);
  });

  it('un solo redondeo en la derivación: coincide con el cociente exacto redondeado una vez', () => {
    // c = round(q_D × 10^12 / q_O) calculado por otra vía: comparando el resto
    // con la mitad del divisor sobre la fracción completa.
    for (const item of cases.filter((c) => c.expectError === undefined)) {
      const o = sourceDecimalToRate(item.given.origin.quote);
      const d = sourceDecimalToRate(item.given.target.quote);
      const numerator = d.coefficient * 10n ** BigInt(o.scale + 12);
      const denominator = o.coefficient * 10n ** BigInt(d.scale);
      const floor = numerator / denominator;
      const remainder = numerator - floor * denominator;
      const expected = remainder * 2n >= denominator ? floor + 1n : floor;
      expect(deriveRate(o, d).coefficient).toBe(expected);
    }
  });

  it('la conversión con rango es la misma aritmética que convert, sin segundo redondeo', () => {
    for (const item of cases.filter(
      (c) =>
        c.given.amount !== undefined &&
        c.expectError === undefined &&
        c.expectConversionError === undefined,
    )) {
      const rate = deriveRate(
        sourceDecimalToRate(item.given.origin.quote),
        sourceDecimalToRate(item.given.target.quote),
      );
      const amount = moneyFromMinorString(
        item.given.amount ?? '0',
        definition(item.given.origin.currency),
      );
      const target = definition(item.given.target.currency);
      expect(convertWithinRange(amount, target, rate)).toEqual(convert(amount, target, rate));
    }
  });

  it('los límites de 64 bits son los de bigint en PostgreSQL', () => {
    expect(INT64_MAX).toBe(2n ** 63n - 1n);
    expect(INT64_MIN).toBe(-(2n ** 63n));
  });

  it('el máximo exacto de 64 bits se convierte sin perder precisión', () => {
    const usd = definition('USD');
    const eur = definition('EUR');
    const one = exchangeRate(10n ** 12n, 12);
    const amount = moneyFromMinorString(INT64_MAX.toString(), usd);
    expect(moneyToMinorString(convertWithinRange(amount, eur, one))).toBe(INT64_MAX.toString());
  });

  it('un resultado un solo céntimo por encima del máximo está fuera de rango', () => {
    const eur = definition('EUR');
    const jpy = definition('JPY');
    // 1000 JPY por EUR: cada céntimo son exactamente 10 JPY.
    const tenPerCent = exchangeRate(1000n * 10n ** 12n, 12);
    const fits = moneyFromMinorString((INT64_MAX / 10n).toString(), eur);
    expect(moneyToMinorString(convertWithinRange(fits, jpy, tenPerCent))).toBe(
      ((INT64_MAX / 10n) * 10n).toString(),
    );
    const justOver = moneyFromMinorString((INT64_MAX / 10n + 1n).toString(), eur);
    expect(() => convertWithinRange(justOver, jpy, tenPerCent)).toThrowError(
      expect.objectContaining({ code: 'CONVERSION_OUT_OF_RANGE' }),
    );
  });
});
