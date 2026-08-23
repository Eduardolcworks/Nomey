import type { ScopeId } from '../ids';
import type { CurrencyDefinition } from '../money/currency-definition';
import type { Money } from '../money/money';
import { sumMoney, zeroMoney } from '../money/money';
import type { AccountingClass, Effect } from './effect';
import { feedsStatistics } from './effect';

/**
 * Saldo derivado de un ámbito.
 *
 * **Se deriva, no se almacena.** ADR-002 §7 y `data-model.md` §7: saldos y
 * estadísticas salen de la versión vigente de cada operación. Un saldo
 * guardado sería una segunda fuente de verdad.
 *
 * `currency` es obligatorio: sin efectos no hay de dónde deducir la definición
 * monetaria del cero, y suponerla sería agregación silenciosa. Si algún efecto
 * pertenece a otra definición, `sumMoney` falla con `MONEY_CURRENCY_MISMATCH`,
 * que es exactamente lo que ADR-003 §3 exige.
 */
export function deriveBalance(
  effects: readonly Effect[],
  scope: ScopeId,
  currency: CurrencyDefinition,
): Money {
  const deltas = effects
    .filter((item) => item.scope === scope && item.balance !== null)
    .map((item) => item.balance as Money);

  return sumMoney(deltas, currency);
}

/**
 * Total económico de un ámbito para una clase contable.
 *
 * Solo `income` y `expense` alimentan estadísticas, y solo cuentan los efectos
 * con **impacto económico**: el movimiento de caja del pagador de una cena no
 * es su gasto económico, y por eso su efecto de saldo no tiene dimensión
 * económica y no suma aquí.
 */
export function deriveEconomicTotal(
  effects: readonly Effect[],
  scope: ScopeId,
  accountingClass: Extract<AccountingClass, 'income' | 'expense'>,
  currency: CurrencyDefinition,
): Money {
  const amounts = effects
    .filter(
      (item) =>
        item.scope === scope && item.accountingClass === accountingClass && feedsStatistics(item),
    )
    .map((item) => (item.economic as { amount: Money }).amount);

  return sumMoney(amounts, currency);
}

/** Gasto económico atribuido a un participante concreto dentro de un ámbito. */
export function deriveParticipantExpense(
  effects: readonly Effect[],
  scope: ScopeId,
  participant: string,
  currency: CurrencyDefinition,
): Money {
  const amounts = effects
    .filter(
      (item) =>
        item.scope === scope &&
        item.accountingClass === 'expense' &&
        feedsStatistics(item) &&
        item.economic?.participant === participant,
    )
    .map((item) => (item.economic as { amount: Money }).amount);

  return amounts.length === 0 ? zeroMoney(currency) : sumMoney(amounts, currency);
}
