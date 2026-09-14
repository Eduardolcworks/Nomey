import type { ParticipantId, ScopeId } from '../ids';
import type { CurrencyDefinition } from '../money/currency-definition';
import { sameCurrencyDefinition } from '../money/currency-definition';
import { fail } from '../errors';
import type { Money } from '../money/money';
import { money, zeroMoney } from '../money/money';
import type { Effect } from './effect';

/** Una obligación neta entre dos participantes, siempre con importe positivo. */
export interface Debt {
  readonly debtor: ParticipantId;
  readonly creditor: ParticipantId;
  readonly amount: Money;
}

/**
 * Deudas netas derivadas de los efectos de un ámbito.
 *
 * **La deuda es un saldo continuo, no una máquina de estados** (F01/ADR-001,
 * consecuencias): una liquidación es un efecto con delta negativo sobre el
 * mismo par, así que **los pagos parciales salen gratis** — pagar 30 de 100
 * deja 70 sin ningún concepto adicional.
 *
 * Los pares se netean en ambas direcciones: si A debe 50 a B y B debe 20 a A,
 * el resultado es una única deuda de 30 de A a B.
 */
export function deriveDebts(
  effects: readonly Effect[],
  scope: ScopeId,
  currency: CurrencyDefinition,
): Debt[] {
  // Clave canónica del par, independiente de la dirección. El signo acumulado
  // indica quién debe a quién al final.
  const net = new Map<string, { first: ParticipantId; second: ParticipantId; amount: bigint }>();

  for (const item of effects) {
    if (item.scope !== scope || item.debt === null) continue;

    const { debtor, creditor, delta } = item.debt;

    if (debtor === creditor) {
      fail('DEBT_SELF_REFERENCE', 'Una deuda no puede tener el mismo deudor y acreedor');
    }

    if (!sameCurrencyDefinition(delta.currency, currency)) {
      fail(
        'MONEY_CURRENCY_MISMATCH',
        `La deuda usa la definición ${delta.currency.id} y el ámbito ${currency.id}`,
      );
    }

    const forward = debtor < creditor;
    const first = forward ? debtor : creditor;
    const second = forward ? creditor : debtor;
    const key = `${first} ${second}`;
    const signed = forward ? delta.minor : -delta.minor;

    const current = net.get(key);
    if (current === undefined) {
      net.set(key, { first, second, amount: signed });
    } else {
      current.amount += signed;
    }
  }

  const debts: Debt[] = [];
  for (const { first, second, amount } of net.values()) {
    if (amount === 0n) continue;
    debts.push(
      Object.freeze(
        amount > 0n
          ? { debtor: first, creditor: second, amount: money(amount, currency) }
          : { debtor: second, creditor: first, amount: money(-amount, currency) },
      ),
    );
  }

  return debts;
}

/**
 * Posición neta de un participante frente a los demás: lo que le deben menos
 * lo que debe.
 *
 * Es el componente de deuda de `Disponible tras saldar`. **No calcula esa
 * magnitud completa**: sumarle el disponible actual cruza ámbitos y exige
 * reglas de agregación que F02/ADR-001 §3 no permite aplicar en silencio.
 */
export function netDebtPosition(
  debts: readonly Debt[],
  participant: ParticipantId,
  currency: CurrencyDefinition,
): Money {
  let total = 0n;

  for (const debt of debts) {
    if (debt.creditor === participant) total += debt.amount.minor;
    if (debt.debtor === participant) total -= debt.amount.minor;
  }

  return total === 0n ? zeroMoney(currency) : money(total, currency);
}
