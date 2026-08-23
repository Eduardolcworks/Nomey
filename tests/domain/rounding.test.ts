import { describe, expect, it } from 'vitest';
import raw from '../vectors/rounding.json';
import { divideRoundHalfAwayFromZero } from '../../src/domain';
import { title, type VectorCase } from './vectors';

interface RoundingCase extends VectorCase {
  readonly given: { readonly numerator: string; readonly denominator: string };
  readonly expect?: { readonly result: string };
}

const cases = raw.cases as unknown as readonly RoundingCase[];

describe('redondeo half away from zero · ADR-003 T10', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    const result = divideRoundHalfAwayFromZero(
      BigInt(item.given.numerator),
      BigInt(item.given.denominator),
    );
    expect(result.toString()).toBe(item.expect?.result);
  });

  it('es simétrico respecto al signo: el negativo se aleja del cero igual que el positivo', () => {
    for (const item of cases) {
      const n = BigInt(item.given.numerator);
      const d = BigInt(item.given.denominator);
      expect(divideRoundHalfAwayFromZero(-n, d)).toBe(-divideRoundHalfAwayFromZero(n, d));
    }
  });
});
