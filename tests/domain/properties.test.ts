import { describe, expect, it } from 'vitest';
import splitVectors from '../vectors/split.json';
import {
  addMoney,
  convert,
  deriveBalance,
  deriveDebtSettlement,
  deriveDebts,
  deriveGroupExpense,
  exchangeRateFromStrings,
  moneyFromMinorString,
  moneyToMinorString,
  negateMoney,
  sharesTotal,
  splitExpense,
  zeroMoney,
} from '../../src/domain';
import type { SplitMethod } from '../../src/domain';
import { currency, participant, scope } from './vectors';

/**
 * Propiedades generales, deterministas y sin librería de property testing.
 *
 * Los vectores comprueban resultados concretos; esto comprueba **invariantes
 * que deben cumplirse siempre**, recorriendo los mismos vectores más entradas
 * construidas a propósito.
 */

interface SplitCase {
  readonly id: string;
  readonly expectError?: string;
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
}

const cases = (splitVectors.cases as unknown as readonly SplitCase[]).filter(
  (item) => item.expectError === undefined,
);

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

function shareAmounts(item: SplitCase): bigint[] {
  const c = currency(item.given.currency);
  return splitExpense({
    total: moneyFromMinorString(item.given.total, c),
    participants: item.given.participants.map(participant),
    payer: participant(item.given.payer),
    method: toMethod(item.given.method),
  }).map((share) => share.amount.minor);
}

const eur = currency('eur');
const usd = currency('usd');

describe('propiedades del reparto', () => {
  it('la suma de las asignaciones equivale exactamente al total', () => {
    for (const item of cases) {
      const c = currency(item.given.currency);
      const total = moneyFromMinorString(item.given.total, c);
      const shares = splitExpense({
        total,
        participants: item.given.participants.map(participant),
        payer: participant(item.given.payer),
        method: toMethod(item.given.method),
      });
      expect(moneyToMinorString(sharesTotal(shares, total)), item.id).toBe(
        moneyToMinorString(total),
      );
    }
  });

  it('ninguna asignación sobre magnitud no negativa resulta negativa', () => {
    for (const item of cases) {
      for (const amount of shareAmounts(item)) {
        expect(amount >= 0n, item.id).toBe(true);
      }
    }
  });

  it('`equal` reparte únicamente la diferencia inevitable de unidades mínimas', () => {
    for (const item of cases) {
      if (item.given.method.kind !== 'equal') continue;
      const amounts = shareAmounts(item);
      const max = amounts.reduce((a, b) => (a > b ? a : b));
      const min = amounts.reduce((a, b) => (a < b ? a : b));
      expect(max - min <= 1n, `${item.id}: diferencia ${String(max - min)}`).toBe(true);
    }
  });

  it('en `equal`, quien recibe la unidad extra la recibe una sola vez', () => {
    for (const item of cases) {
      if (item.given.method.kind !== 'equal') continue;
      const amounts = shareAmounts(item);
      const min = amounts.reduce((a, b) => (a < b ? a : b));
      const extra = amounts.filter((a) => a === min + 1n).length;
      const remainder = BigInt(item.given.total) % BigInt(amounts.length);
      expect(BigInt(extra), item.id).toBe(remainder);
    }
  });

  it('es determinista sobre todos los vectores', () => {
    for (const item of cases) {
      expect(shareAmounts(item).map(String), item.id).toStrictEqual(shareAmounts(item).map(String));
    }
  });
});

describe('propiedades de Money', () => {
  const samples = ['0', '1', '-1', '8620', '-8620', '9007199254740993', '9223372036854775807'];

  it('negate(negate(x)) = x', () => {
    for (const raw of samples) {
      const value = moneyFromMinorString(raw, eur);
      expect(moneyToMinorString(negateMoney(negateMoney(value)))).toBe(raw);
    }
  });

  it('sumar un cero compatible no altera el importe', () => {
    for (const raw of samples) {
      const value = moneyFromMinorString(raw, eur);
      expect(moneyToMinorString(addMoney(value, zeroMoney(eur)))).toBe(raw);
      expect(moneyToMinorString(addMoney(zeroMoney(eur), value))).toBe(raw);
    }
  });

  it('la suma es conmutativa y asociativa', () => {
    const a = moneyFromMinorString('9007199254740993', eur);
    const b = moneyFromMinorString('-42', eur);
    const c = moneyFromMinorString('1', eur);
    expect(moneyToMinorString(addMoney(a, b))).toBe(moneyToMinorString(addMoney(b, a)));
    expect(moneyToMinorString(addMoney(addMoney(a, b), c))).toBe(
      moneyToMinorString(addMoney(a, addMoney(b, c))),
    );
  });

  it('definiciones monetarias incompatibles nunca se agregan en silencio', () => {
    const a = moneyFromMinorString('100', eur);
    const b = moneyFromMinorString('100', usd);
    expect(() => addMoney(a, b)).toThrowError(
      expect.objectContaining({ code: 'MONEY_CURRENCY_MISMATCH' }),
    );
    // El cero tampoco es una excusa para mezclar.
    expect(() => addMoney(zeroMoney(eur), b)).toThrowError(
      expect.objectContaining({ code: 'MONEY_CURRENCY_MISMATCH' }),
    );
  });
});

describe('propiedades de la conversión', () => {
  const rate = exchangeRateFromStrings('8592340000', 10);

  it('convertir conserva la simetría de signo del redondeo', () => {
    for (const raw of ['1', '4', '7', '12345', '999999999999999999']) {
      const positive = convert(moneyFromMinorString(raw, usd), eur, rate);
      const negative = convert(moneyFromMinorString(`-${raw}`, usd), eur, rate);
      expect(moneyToMinorString(negative)).toBe(`-${moneyToMinorString(positive)}`);
    }
  });

  it('convertir cero da cero en la moneda destino', () => {
    const result = convert(moneyFromMinorString('0', usd), eur, rate);
    expect(moneyToMinorString(result)).toBe('0');
    expect(result.currency.id).toBe(eur.id);
  });
});

describe('propiedades contables', () => {
  const grupo = scope('grupo-p');
  const personalA = scope('personal-pA');
  const A = participant('A');
  const B = participant('B');

  const cena = () =>
    deriveGroupExpense({
      groupScope: grupo,
      payerScope: personalA,
      total: moneyFromMinorString('10000', eur),
      paidFromPayerScope: moneyFromMinorString('10000', eur),
      participants: [A, B],
      payer: A,
      method: { kind: 'equal' },
    });

  it('una liquidación no introduce ningún efecto de saldo', () => {
    const effects = deriveDebtSettlement({
      scope: grupo,
      debtor: B,
      creditor: A,
      amount: moneyFromMinorString('5000', eur),
    });

    expect(effects.every((item) => item.balance === null)).toBe(true);
    expect(moneyToMinorString(deriveBalance(effects, grupo, eur))).toBe('0');
    expect(moneyToMinorString(deriveBalance(effects, personalA, eur))).toBe('0');
  });

  it('una liquidación tampoco alimenta estadísticas', () => {
    const effects = deriveDebtSettlement({
      scope: grupo,
      debtor: B,
      creditor: A,
      amount: moneyFromMinorString('5000', eur),
    });
    expect(effects.every((item) => item.economic === null)).toBe(true);
  });

  it('un pago parcial deja exactamente el resto de la deuda', () => {
    for (const paid of ['1', '1234', '4999']) {
      const effects = [
        ...cena(),
        ...deriveDebtSettlement({
          scope: grupo,
          debtor: B,
          creditor: A,
          amount: moneyFromMinorString(paid, eur),
        }),
      ];
      const debts = deriveDebts(effects, grupo, eur);
      expect(debts).toHaveLength(1);
      expect(debts[0].debtor).toBe(B);
      expect(debts[0].creditor).toBe(A);
      expect(moneyToMinorString(debts[0].amount)).toBe(String(5000n - BigInt(paid)));
    }
  });

  it('pagos parciales sucesivos equivalen a un único pago por la suma', () => {
    const partes = ['1000', '2000', '2000'];
    const troceado = [
      ...cena(),
      ...partes.flatMap((amount) =>
        deriveDebtSettlement({
          scope: grupo,
          debtor: B,
          creditor: A,
          amount: moneyFromMinorString(amount, eur),
        }),
      ),
    ];
    const entero = [
      ...cena(),
      ...deriveDebtSettlement({
        scope: grupo,
        debtor: B,
        creditor: A,
        amount: moneyFromMinorString('5000', eur),
      }),
    ];
    expect(deriveDebts(troceado, grupo, eur)).toStrictEqual(deriveDebts(entero, grupo, eur));
  });

  it('un pago parcial nunca invierte la dirección de la deuda', () => {
    for (const paid of ['1', '2500', '4999', '5000']) {
      const effects = [
        ...cena(),
        ...deriveDebtSettlement({
          scope: grupo,
          debtor: B,
          creditor: A,
          amount: moneyFromMinorString(paid, eur),
        }),
      ];
      for (const debt of deriveDebts(effects, grupo, eur)) {
        expect(debt.amount.minor > 0n).toBe(true);
        expect(debt.debtor).toBe(B);
      }
    }
  });

  it('un gasto de grupo deja el saldo del propio Grupo sin tocar', () => {
    expect(moneyToMinorString(deriveBalance(cena(), grupo, eur))).toBe('0');
  });

  it('las deudas derivadas suman exactamente lo que el pagador adelantó por los demás', () => {
    const debts = deriveDebts(cena(), grupo, eur);
    const total = debts.reduce((acc, debt) => acc + debt.amount.minor, 0n);
    expect(total.toString()).toBe('5000');
  });
});
