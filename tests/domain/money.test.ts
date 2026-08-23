import { describe, expect, it } from 'vitest';
import raw from '../vectors/money.json';
import {
  addMoney,
  compareMoney,
  moneyFromMinorString,
  moneyToMinorString,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from '../../src/domain';
import { currency, title, type VectorCase } from './vectors';

interface MoneyCase extends VectorCase {
  readonly given: {
    readonly op: string;
    readonly a: string;
    readonly b?: string;
    readonly times?: number;
    readonly currency?: string;
    readonly currencyA?: string;
    readonly currencyB?: string;
  };
  readonly expect?: { readonly result: string };
}

const cases = raw.cases as unknown as readonly MoneyCase[];

function run(item: MoneyCase): string {
  const { given } = item;

  switch (given.op) {
    case 'add': {
      const c = currency(given.currency as string);
      return moneyToMinorString(
        addMoney(moneyFromMinorString(given.a, c), moneyFromMinorString(given.b as string, c)),
      );
    }
    case 'subtract': {
      const c = currency(given.currency as string);
      return moneyToMinorString(
        subtractMoney(moneyFromMinorString(given.a, c), moneyFromMinorString(given.b as string, c)),
      );
    }
    case 'repeatedAdd': {
      const c = currency(given.currency as string);
      const unit = moneyFromMinorString(given.a, c);
      let acc = zeroMoney(c);
      for (let i = 0; i < (given.times as number); i += 1) acc = addMoney(acc, unit);
      return moneyToMinorString(acc);
    }
    case 'compare': {
      const c = currency(given.currency as string);
      return String(
        compareMoney(moneyFromMinorString(given.a, c), moneyFromMinorString(given.b as string, c)),
      );
    }
    case 'addCrossCurrency':
      return moneyToMinorString(
        addMoney(
          moneyFromMinorString(given.a, currency(given.currencyA as string)),
          moneyFromMinorString(given.b as string, currency(given.currencyB as string)),
        ),
      );
    case 'compareCrossCurrency':
      return String(
        compareMoney(
          moneyFromMinorString(given.a, currency(given.currencyA as string)),
          moneyFromMinorString(given.b as string, currency(given.currencyB as string)),
        ),
      );
    case 'parse':
      return moneyToMinorString(moneyFromMinorString(given.a, currency(given.currency as string)));
    default:
      throw new Error(`Operación desconocida en los vectores: ${given.op}`);
  }
}

describe('aritmética monetaria exacta · ADR-003 §2 §3', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    if (item.expectError !== undefined) {
      expect(() => run(item)).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }
    expect(run(item)).toBe(item.expect?.result);
  });

  it('sumar una lista vacía sin decir la definición monetaria es un error, no un cero inventado', () => {
    expect(() => sumMoney([])).toThrowError(
      expect.objectContaining({ code: 'MONEY_SUM_WITHOUT_CURRENCY' }),
    );
    expect(moneyToMinorString(sumMoney([], currency('eur')))).toBe('0');
  });

  it('rechaza una escala de definición monetaria inválida', () => {
    expect(() => currency('inexistente')).toThrowError();
  });
});
