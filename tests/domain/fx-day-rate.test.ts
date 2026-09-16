import { describe, expect, it } from 'vitest';
import raw from '../vectors/fx-day.json';
import { selectDayRate } from '../../src/domain';
import type { CurrencyCoverage, DayRateSelection, ObservedPublication } from '../../src/domain';
import { title, type VectorCase } from './vectors';

interface DayRateCase extends VectorCase {
  readonly given: {
    readonly history: string;
    readonly effectiveDate: string;
    readonly coverage: string;
  };
  readonly expect?: DayRateSelection;
}

const file = raw as unknown as {
  readonly sourceFirstReferenceDate: string;
  readonly coverages: Readonly<Record<string, CurrencyCoverage | null>>;
  readonly histories: Readonly<Record<string, readonly ObservedPublication[]>>;
  readonly cases: readonly DayRateCase[];
};

function history(name: string): readonly ObservedPublication[] {
  const found = file.histories[name];
  if (found === undefined) throw new Error(`Historia desconocida en fx-day.json: ${name}`);
  return found;
}

function coverage(name: string): CurrencyCoverage | null {
  if (!(name in file.coverages)) throw new Error(`Cobertura desconocida en fx-day.json: ${name}`);
  return file.coverages[name] ?? null;
}

function run(item: DayRateCase, publications = history(item.given.history)): DayRateSelection {
  return selectDayRate({
    effectiveDate: item.given.effectiveDate,
    publications,
    sourceFirstReferenceDate: file.sourceFirstReferenceDate,
    coverage: coverage(item.given.coverage),
  });
}

describe('tipo del día por moneda, R/P y K=1 · F11/ADR-002', () => {
  it.each(file.cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    if (item.expectError !== undefined) {
      expect(() => run(item)).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }
    expect(run(item)).toEqual(item.expect);
  });

  it('no depende del orden de las publicaciones', () => {
    for (const item of file.cases.filter((c) => c.expectError === undefined)) {
      const reversed = [...history(item.given.history)].reverse();
      expect(run(item, reversed)).toEqual(run(item));
    }
  });

  it('nunca selecciona una fecha de referencia igual o posterior a la fecha efectiva', () => {
    for (const item of file.cases) {
      if (item.expectError !== undefined) continue;
      const result = run(item);
      if (result.kind === 'selected') {
        expect(result.referenceDate < item.given.effectiveDate).toBe(true);
      }
    }
  });

  it('K=1: una moneda nunca va más de una publicación por detrás de R(X)', () => {
    for (const item of file.cases) {
      if (item.expectError !== undefined) continue;
      const result = run(item);
      if (result.kind !== 'selected') continue;
      const earlier = history(item.given.history)
        .map((p) => p.referenceDate)
        .filter((d) => d < item.given.effectiveDate)
        .sort()
        .reverse();
      expect(earlier.slice(0, 2)).toContain(result.referenceDate);
    }
  });

  it('una publicación posterior a X no cambia el resultado de X', () => {
    for (const item of file.cases.filter((c) => c.expectError === undefined)) {
      const later: ObservedPublication = {
        referenceDate: '9999-12-31',
        sourceCodes: ['USD', 'NOK', 'BRL', 'RON', 'ISK'],
      };
      expect(run(item, [...history(item.given.history), later])).toEqual(run(item));
    }
  });
});
