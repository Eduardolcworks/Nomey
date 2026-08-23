import type { ParticipantId, ScopeId } from '../ids';
import type { Money } from '../money/money';

/**
 * Clases contables de ADR-002 §3.
 *
 * **La clase no determina qué dimensiones toca el efecto.** Existe un `expense`
 * que no mueve saldo y un `settlement` que no toca caja. Por eso las
 * dimensiones son campos independientes y no un discriminante.
 */
export type AccountingClass = 'income' | 'expense' | 'transfer' | 'adjustment' | 'settlement';

/** Cuánto consumió o ingresó realmente alguien. En Modo Personal no hay participante nominado. */
export interface EconomicImpact {
  readonly participant: ParticipantId | null;
  readonly amount: Money;
}

/** Cuánto cambia una obligación entre dos participantes. Positivo = nace o crece. */
export interface DebtImpact {
  readonly debtor: ParticipantId;
  readonly creditor: ParticipantId;
  readonly delta: Money;
}

/**
 * Un hecho concreto que cambia algo, con sus dimensiones separadas.
 *
 * `balance` es el **cambio de saldo del ámbito**, y el invariante 4 exige que
 * cada cambio de saldo se represente exactamente una vez: por eso el pago de
 * una cena de 120 produce un único efecto de −120 y no se descompone en −30 de
 * gasto más −90 de transferencia.
 */
export interface Effect {
  readonly scope: ScopeId;
  readonly accountingClass: AccountingClass;
  readonly balance: Money | null;
  readonly economic: EconomicImpact | null;
  readonly debt: DebtImpact | null;
}

export function effect(input: {
  scope: ScopeId;
  accountingClass: AccountingClass;
  balance?: Money | null;
  economic?: EconomicImpact | null;
  debt?: DebtImpact | null;
}): Effect {
  return Object.freeze({
    scope: input.scope,
    accountingClass: input.accountingClass,
    balance: input.balance ?? null,
    economic: input.economic ?? null,
    debt: input.debt ?? null,
  });
}

/**
 * Clases que alimentan estadísticas. **Lista de admitidos, no de excluidos**
 * (ADR-002 §4): una clase nueva queda fuera por defecto, de modo que un olvido
 * produzca «falta un dato» y nunca «el dato miente».
 */
const STATISTICAL_CLASSES: readonly AccountingClass[] = ['income', 'expense'];

export function feedsStatistics(value: Effect): boolean {
  return STATISTICAL_CLASSES.includes(value.accountingClass) && value.economic !== null;
}
