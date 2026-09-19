import { describe, expect, it } from 'vitest';
import raw from '../vectors/fx-source-decimal.json';
import { MAX_RATE_SCALE, sourceDecimalToRate } from '../../src/domain';
import { title, type VectorCase } from './vectors';

interface SourceDecimalCase extends VectorCase {
  readonly given: { readonly text: string };
  readonly expect?: { readonly coefficient: string; readonly scale: number };
}

const cases = raw.cases as unknown as readonly SourceDecimalCase[];

describe('tipo de la fuente como decimal exacto · F11/ADR-002 §2', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    const run = () => sourceDecimalToRate(item.given.text);

    if (item.expectError !== undefined) {
      expect(run).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }

    const rate = run();
    expect(rate.coefficient).toBe(BigInt(item.expect?.coefficient ?? 'x'));
    expect(rate.scale).toBe(item.expect?.scale);
  });

  it('el coeficiente es bigint y reconstruye el mismo valor que el texto', () => {
    for (const item of cases.filter((c) => c.expect !== undefined)) {
      const rate = sourceDecimalToRate(item.given.text);
      expect(typeof rate.coefficient).toBe('bigint');
      // Comparación exacta sin coma flotante: texto × 10^s  ==  coeficiente × 10^(s - escala)
      const [whole, fraction = ''] = item.given.text.split('.');
      const written = BigInt(`${whole}${fraction}`);
      const scaled = rate.coefficient * 10n ** BigInt(fraction.length - rate.scale);
      expect(scaled).toBe(written);
    }
  });

  it('ningún resultado supera la escala máxima', () => {
    for (const item of cases.filter((c) => c.expect !== undefined)) {
      expect(sourceDecimalToRate(item.given.text).scale).toBeLessThanOrEqual(MAX_RATE_SCALE);
    }
  });

  it('es determinista', () => {
    for (const item of cases.filter((c) => c.expect !== undefined)) {
      expect(sourceDecimalToRate(item.given.text)).toEqual(sourceDecimalToRate(item.given.text));
    }
  });
});
