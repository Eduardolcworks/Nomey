import { describe, expect, it } from 'vitest';
import raw from '../vectors/fx-dates.json';
import { classifyFxEffectiveDate, isIsoDate } from '../../src/domain';
import { title, type VectorCase } from './vectors';

interface DateCase extends VectorCase {
  readonly scope?: 'domain';
  readonly given: { readonly effectiveDate: string };
  readonly expect?: { readonly classification: string };
}

const file = raw as unknown as {
  readonly sourceFirstReferenceDate: string;
  readonly cases: readonly DateCase[];
};

describe('fecha efectiva en el camino con conversión · decisión F11.B', () => {
  it.each(file.cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    const run = () =>
      classifyFxEffectiveDate(item.given.effectiveDate, file.sourceFirstReferenceDate);

    if (item.expectError !== undefined) {
      expect(run).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }
    expect(run()).toBe(item.expect?.classification);
  });

  it('reconoce todos los días de un año bisiesto y de uno que no lo es', () => {
    const lengths = (year: string) =>
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(
        (month) =>
          ['28', '29', '30', '31'].filter((day) => isIsoDate(`${year}-${month}-${day}`)).length,
      );
    // Días válidos entre el 28 y el 31 de cada mes: 31 → 4, 30 → 3, febrero → 1 o 2.
    expect(lengths('2024')).toEqual([4, 2, 4, 3, 4, 3, 4, 4, 3, 4, 3, 4]);
    expect(lengths('2026')).toEqual([4, 1, 4, 3, 4, 3, 4, 4, 3, 4, 3, 4]);
    expect(lengths('2000')[1]).toBe(2);
    expect(lengths('2100')[1]).toBe(1);
  });
});
