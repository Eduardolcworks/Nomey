import { describe, expect, it } from 'vitest';
import raw from '../vectors/split.json';
import {
  moneyFromMinorString,
  moneyToMinorString,
  sharesTotal,
  splitExpense,
} from '../../src/domain';
import type { SplitMethod } from '../../src/domain';
import { currency, participant, title, type VectorCase } from './vectors';

interface SplitCase extends VectorCase {
  readonly given: {
    readonly total: string;
    readonly currency: string;
    readonly participants: readonly string[];
    readonly payer: string;
    readonly method:
      | { readonly kind: 'equal' }
      | { readonly kind: 'shares'; readonly weights: readonly string[] }
      | { readonly kind: 'exact_amounts'; readonly amounts: readonly string[] };
  };
  readonly expect?: { readonly shares: readonly string[] };
}

const cases = raw.cases as unknown as readonly SplitCase[];

function toMethod(method: SplitCase['given']['method']): SplitMethod {
  switch (method.kind) {
    case 'equal':
      return { kind: 'equal' };
    case 'shares':
      return { kind: 'shares', weights: method.weights.map((w) => BigInt(w)) };
    case 'exact_amounts':
      return { kind: 'exact_amounts', amounts: method.amounts.map((a) => BigInt(a)) };
  }
}

function run(item: SplitCase): string[] {
  const c = currency(item.given.currency);
  const shares = splitExpense({
    total: moneyFromMinorString(item.given.total, c),
    participants: item.given.participants.map(participant),
    payer: participant(item.given.payer),
    method: toMethod(item.given.method),
  });
  return shares.map((share) => moneyToMinorString(share.amount));
}

describe('reparto de un gasto · ADR-002 §5 · ADR-003 T11', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    if (item.expectError !== undefined) {
      expect(() => run(item)).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }
    expect(run(item)).toStrictEqual([...(item.expect?.shares ?? [])]);
  });

  it('la suma de las participaciones cuadra exactamente con el total, en todos los vectores válidos', () => {
    for (const item of cases) {
      if (item.expectError !== undefined) continue;
      const c = currency(item.given.currency);
      const total = moneyFromMinorString(item.given.total, c);
      const shares = splitExpense({
        total,
        participants: item.given.participants.map(participant),
        payer: participant(item.given.payer),
        method: toMethod(item.given.method),
      });
      expect(moneyToMinorString(sharesTotal(shares, total))).toBe(moneyToMinorString(total));
    }
  });

  it('ninguna participación calculada es negativa', () => {
    for (const item of cases) {
      if (item.expectError !== undefined) continue;
      for (const value of run(item)) {
        expect(BigInt(value) >= 0n).toBe(true);
      }
    }
  });

  it('es determinista: la misma entrada produce el mismo reparto', () => {
    for (const item of cases) {
      if (item.expectError !== undefined) continue;
      expect(run(item)).toStrictEqual(run(item));
    }
  });
});
