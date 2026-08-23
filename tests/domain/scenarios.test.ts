import { describe, expect, it } from 'vitest';
import raw from '../vectors/scenarios.json';
import {
  deriveAdjustment,
  deriveBalance,
  deriveDebtSettlement,
  deriveDebts,
  deriveEconomicTotal,
  deriveExternalTransfer,
  deriveGroupExpense,
  deriveInternalTransfer,
  deriveParticipantExpense,
  derivePersonalExpense,
  deriveSettlementByTransfer,
  moneyFromMinorString,
  moneyToMinorString,
  netDebtPosition,
} from '../../src/domain';
import type { Effect } from '../../src/domain';
import { currency, participant, scope, title, type VectorCase } from './vectors';

type Operation = Record<string, unknown>;

interface Expectation {
  readonly scope: string;
  readonly currency: string;
  readonly amount: string;
  readonly participant?: string;
  readonly debtor?: string;
  readonly creditor?: string;
}

interface ScenarioCase extends VectorCase {
  readonly operations: readonly Operation[];
  readonly expect?: {
    readonly balances?: readonly Expectation[];
    readonly economicExpense?: readonly Expectation[];
    readonly economicIncome?: readonly Expectation[];
    readonly participantExpense?: readonly Expectation[];
    readonly debts?: readonly Expectation[];
    readonly netDebtPosition?: readonly Expectation[];
    readonly balanceEffectScopes?: readonly string[];
  };
}

const cases = raw.cases as unknown as readonly ScenarioCase[];

const str = (op: Operation, key: string): string => op[key] as string;

function applyOperation(op: Operation, prior: readonly Effect[]): Effect[] {
  const c = currency(str(op, 'currency'));

  switch (str(op, 'kind')) {
    case 'personalExpense':
      return derivePersonalExpense({
        scope: scope(str(op, 'scope')),
        amount: moneyFromMinorString(str(op, 'amount'), c),
      });

    case 'adjustment':
      return deriveAdjustment({
        scope: scope(str(op, 'scope')),
        delta: moneyFromMinorString(str(op, 'delta'), c),
      });

    case 'groupExpense': {
      const payerCurrency = op.payerCurrency === undefined ? c : currency(str(op, 'payerCurrency'));
      // Un vector sin payerScope representa un pagador sin Modo Personal.
      const cash =
        op.payerScope === undefined
          ? undefined
          : {
              scope: scope(str(op, 'payerScope')),
              amount: moneyFromMinorString(str(op, 'paidFromPayerScope'), payerCurrency),
            };
      return deriveGroupExpense({
        groupScope: scope(str(op, 'groupScope')),
        total: moneyFromMinorString(str(op, 'total'), c),
        participants: (op.participants as string[]).map(participant),
        payer: participant(str(op, 'payer')),
        method: op.method as { kind: 'equal' },
        payerCashMovement: cash,
      });
    }

    case 'debtSettlement':
      return deriveDebtSettlement({
        scope: scope(str(op, 'scope')),
        debtor: participant(str(op, 'debtor')),
        creditor: participant(str(op, 'creditor')),
        amount: moneyFromMinorString(str(op, 'amount'), c),
        priorEffects: prior,
      });

    case 'internalTransfer':
      return deriveInternalTransfer({
        from: {
          scope: scope(str(op, 'fromScope')),
          amount: moneyFromMinorString(str(op, 'fromAmount'), c),
        },
        to: {
          scope: scope(str(op, 'toScope')),
          amount: moneyFromMinorString(str(op, 'toAmount'), c),
        },
      });

    case 'externalTransfer':
      return deriveExternalTransfer({
        scope: scope(str(op, 'scope')),
        delta: moneyFromMinorString(str(op, 'delta'), c),
      });

    case 'settlementByTransfer':
      return deriveSettlementByTransfer({
        from: {
          scope: scope(str(op, 'fromScope')),
          amount: moneyFromMinorString(str(op, 'fromAmount'), c),
        },
        to: {
          scope: scope(str(op, 'toScope')),
          amount: moneyFromMinorString(str(op, 'toAmount'), c),
        },
        debtScope: scope(str(op, 'debtScope')),
        debtor: participant(str(op, 'debtor')),
        creditor: participant(str(op, 'creditor')),
        settledAmount: moneyFromMinorString(str(op, 'settledAmount'), c),
        priorEffects: prior,
      });

    default:
      throw new Error(`Operación desconocida en los vectores: ${str(op, 'kind')}`);
  }
}

describe('escenarios normativos · data-model.md §4', () => {
  it.each(cases.map((item) => [title(item), item] as const))('%s', (_name, item) => {
    const build = (): Effect[] => {
      const acc: Effect[] = [];
      for (const op of item.operations) acc.push(...applyOperation(op, acc));
      return acc;
    };

    if (item.expectError !== undefined) {
      expect(build).toThrowError(expect.objectContaining({ code: item.expectError }));
      return;
    }

    const effects = build();

    for (const exp of item.expect!.balances ?? []) {
      const value = deriveBalance(effects, scope(exp.scope), currency(exp.currency));
      expect(moneyToMinorString(value), `saldo de ${exp.scope}`).toBe(exp.amount);
    }

    for (const exp of item.expect!.economicExpense ?? []) {
      const value = deriveEconomicTotal(
        effects,
        scope(exp.scope),
        'expense',
        currency(exp.currency),
      );
      expect(moneyToMinorString(value), `gasto económico de ${exp.scope}`).toBe(exp.amount);
    }

    for (const exp of item.expect!.economicIncome ?? []) {
      const value = deriveEconomicTotal(
        effects,
        scope(exp.scope),
        'income',
        currency(exp.currency),
      );
      expect(moneyToMinorString(value), `ingreso económico de ${exp.scope}`).toBe(exp.amount);
    }

    for (const exp of item.expect!.participantExpense ?? []) {
      const value = deriveParticipantExpense(
        effects,
        scope(exp.scope),
        exp.participant as string,
        currency(exp.currency),
      );
      expect(moneyToMinorString(value), `gasto de ${exp.participant}`).toBe(exp.amount);
    }

    if (item.expect!.debts !== undefined) {
      const byScope = new Map<string, Expectation[]>();
      for (const exp of item.expect!.debts) {
        byScope.set(exp.scope, [...(byScope.get(exp.scope) ?? []), exp]);
      }
      const scopes =
        byScope.size === 0
          ? [...new Set(effects.map((e) => e.scope as string))]
          : [...byScope.keys()];

      for (const scopeName of scopes) {
        const expected = byScope.get(scopeName) ?? [];
        const currencyKey = expected[0]?.currency ?? 'eur';
        const actual = deriveDebts(effects, scope(scopeName), currency(currencyKey))
          .map((d) => ({
            debtor: String(d.debtor),
            creditor: String(d.creditor),
            amount: moneyToMinorString(d.amount),
          }))
          .sort((a, b) => `${a.debtor}${a.creditor}`.localeCompare(`${b.debtor}${b.creditor}`));

        const wanted = expected
          .map((e) => ({
            debtor: e.debtor as string,
            creditor: e.creditor as string,
            amount: e.amount,
          }))
          .sort((a, b) => `${a.debtor}${a.creditor}`.localeCompare(`${b.debtor}${b.creditor}`));

        expect(actual, `deudas de ${scopeName}`).toStrictEqual(wanted);
      }
    }

    if (item.expect!.balanceEffectScopes !== undefined) {
      const actual = [
        ...new Set(effects.filter((e) => e.balance !== null).map((e) => String(e.scope))),
      ].sort();
      expect(actual, 'ámbitos con efecto de saldo').toStrictEqual(
        [...item.expect!.balanceEffectScopes].sort(),
      );
    }

    for (const exp of item.expect!.netDebtPosition ?? []) {
      const debts = deriveDebts(effects, scope(exp.scope), currency(exp.currency));
      const value = netDebtPosition(
        debts,
        participant(exp.participant as string),
        currency(exp.currency),
      );
      expect(moneyToMinorString(value), `posición neta de ${exp.participant}`).toBe(exp.amount);
    }
  });
});
