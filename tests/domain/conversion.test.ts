import { describe, expect, it } from 'vitest';
import raw from '../vectors/conversion.json';
import {
  convert,
  exchangeRateFromStrings,
  moneyFromMinorString,
  moneyToMinorString,
} from '../../src/domain';
import { currency, title, type VectorCase } from './vectors';

interface ConversionCase extends VectorCase {
  readonly given: {
    readonly amount: string;
    readonly from: string;
    readonly to: string;
    readonly rate: { readonly coefficient: string; readonly scale: number };
  };
  readonly expect?: { readonly result: string };
}

const cases = raw.cases as unknown as readonly ConversionCase[];

describe('conversión exacta con un único redondeo · ADR-003 T12', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    const run = () =>
      convert(
        moneyFromMinorString(item.given.amount, currency(item.given.from)),
        currency(item.given.to),
        exchangeRateFromStrings(item.given.rate.coefficient, item.given.rate.scale),
      );

    if (item.expectError !== undefined) {
      expect(run).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }

    const result = run();
    expect(moneyToMinorString(result)).toBe(item.expect?.result);
    expect(result.currency.id).toBe(currency(item.given.to).id);
  });

  it('convertir a la misma escala con tipo 1 devuelve el mismo importe', () => {
    const eur = currency('eur');
    const one = exchangeRateFromStrings('1', 0);
    const amount = moneyFromMinorString('123456789012345678', eur);
    expect(moneyToMinorString(convert(amount, eur, one))).toBe('123456789012345678');
  });

  it('rechaza un tipo de cambio no positivo', () => {
    expect(() => exchangeRateFromStrings('0', 10)).toThrowError(
      expect.objectContaining({ code: 'RATE_NOT_POSITIVE' }),
    );
    expect(() => exchangeRateFromStrings('-1', 10)).toThrowError(
      expect.objectContaining({ code: 'RATE_NOT_POSITIVE' }),
    );
  });

  it('rechaza una escala de tipo inválida', () => {
    expect(() => exchangeRateFromStrings('1', -1)).toThrowError(
      expect.objectContaining({ code: 'RATE_SCALE_INVALID' }),
    );
    expect(() => exchangeRateFromStrings('1', 1.5)).toThrowError(
      expect.objectContaining({ code: 'RATE_SCALE_INVALID' }),
    );
  });

  it('rechaza un coeficiente que no es entero', () => {
    expect(() => exchangeRateFromStrings('0.86', 2)).toThrowError(
      expect.objectContaining({ code: 'RATE_COEFFICIENT_NOT_INTEGER' }),
    );
  });
});
