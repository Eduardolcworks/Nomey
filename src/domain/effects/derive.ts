import { fail } from '../errors';
import type { ParticipantId, ScopeId } from '../ids';
import type { Money } from '../money/money';
import { negateMoney } from '../money/money';
import type { SplitMethod } from '../split/split';
import { splitExpense } from '../split/split';
import type { Effect } from './effect';
import { effect } from './effect';
import { deriveDebts } from './debt';

/**
 * Derivación de operación → efectos.
 *
 * Es el cálculo que la frontera de escritura autoritativa del servidor deberá
 * **reproducir exactamente** (ADR-002 §7), y por eso vive aquí junto a los
 * vectores compartidos.
 *
 * **Fuera de esta capa:** quién tiene derecho a registrar cada operación. La
 * autorización pertenece a la frontera de escritura; aquí solo está qué
 * efectos produce una operación válida. El invariante 10 dice que el resultado
 * financiero no depende de quién la registre, así que el autor ni siquiera
 * entra en el cálculo.
 */

/** Escenario 4.1 · gasto personal simple. */
export function derivePersonalExpense(input: { scope: ScopeId; amount: Money }): Effect[] {
  return [
    effect({
      scope: input.scope,
      accountingClass: 'expense',
      balance: negateMoney(input.amount),
      economic: { participant: null, amount: input.amount },
    }),
  ];
}

/** Escenario 4.11 · ajuste, incluida la declaración inicial de saldo. */
export function deriveAdjustment(input: { scope: ScopeId; delta: Money }): Effect[] {
  return [
    effect({
      scope: input.scope,
      accountingClass: 'adjustment',
      balance: input.delta,
    }),
  ];
}

/**
 * El movimiento de caja del pagador: de qué ámbito sale el dinero y cuánto.
 *
 * Van juntos a propósito. El ámbito sin el importe, o al revés, no significa
 * nada, y agruparlos hace ese estado irrepresentable.
 */
export interface PayerCashMovement {
  readonly scope: ScopeId;
  /** Importe en la moneda base del ámbito del pagador, que puede no ser la del Grupo. */
  readonly amount: Money;
}

export interface GroupExpenseInput {
  readonly groupScope: ScopeId;
  /** Total **ya convertido** a la moneda base del Grupo. */
  readonly total: Money;
  readonly participants: readonly ParticipantId[];
  readonly payer: ParticipantId;
  readonly method: SplitMethod;
  /**
   * **Opcional a propósito.** Un participante puede figurar en repartos
   * existiendo **con o sin usuario** (`data-model.md` §6), y el pagador es
   * siempre un participante (ADR-002 §5). Cuando quien pagó no tiene Modo
   * Personal, no hay ningún ámbito interno del que descontar: el gasto es
   * igualmente real, y el dinero salió de un sitio que Nomey no representa.
   *
   * Su ausencia **no** significa «no pagó nadie»: significa que no hay efecto
   * de caja interno que registrar. Los efectos del Grupo —participación
   * económica y deudas— se derivan igual.
   *
   * Esto no implementa nada de participantes sin cuenta —invitación,
   * reclamación, autorización—: solo evita presuponer un ámbito que el modelo
   * nunca garantizó.
   */
  readonly payerCashMovement?: PayerCashMovement;
}

/**
 * Escenarios 4.2, 4.3 y 4.4 · gasto de grupo.
 *
 * El gasto económico corresponde a **todos** los participantes, con
 * independencia de quién pagó (invariante 9). El pagador tiene además el
 * movimiento de caja en su propio ámbito y los derechos frente a los demás.
 *
 * `total` y `paidFromPayerScope` se piden por separado porque una operación
 * puede tener **varias conversiones derivadas**, una por ámbito alcanzado
 * (ADR-003 §1): si el Grupo y el Modo Personal del pagador tienen monedas base
 * distintas, no son el mismo número y ninguno se reconstruye desde el otro.
 */
export function deriveGroupExpense(input: GroupExpenseInput): Effect[] {
  const shares = splitExpense({
    total: input.total,
    participants: input.participants,
    payer: input.payer,
    method: input.method,
  });

  const effects: Effect[] = [];

  // Gasto económico de cada participante, sin cambio de saldo: es la prueba de
  // que separar saldo y economía era necesario y no cómodo (escenario 4.4).
  for (const share of shares) {
    effects.push(
      effect({
        scope: input.groupScope,
        accountingClass: 'expense',
        economic: { participant: share.participant, amount: share.amount },
      }),
    );
  }

  // Derechos del pagador frente al resto. Una participación calculada en cero
  // no genera deuda: no hay obligación que registrar.
  for (const share of shares) {
    if (share.participant === input.payer) continue;
    if (share.amount.minor === 0n) continue;
    effects.push(
      effect({
        scope: input.groupScope,
        accountingClass: 'expense',
        debt: { debtor: share.participant, creditor: input.payer, delta: share.amount },
      }),
    );
  }

  // El movimiento de caja: uno solo, por el total (invariante 4). Si el pagador
  // no tiene Modo Personal, no hay ningún extremo interno que registrar — la
  // misma situación que el invariante 4 admite para una transferencia externa.
  if (input.payerCashMovement !== undefined) {
    effects.push(
      effect({
        scope: input.payerCashMovement.scope,
        accountingClass: 'expense',
        balance: negateMoney(input.payerCashMovement.amount),
      }),
    );
  }

  return effects;
}

export interface DebtSettlementInput {
  readonly scope: ScopeId;
  readonly debtor: ParticipantId;
  readonly creditor: ParticipantId;
  readonly amount: Money;
  /**
   * Efectos ya registrados del ámbito. Son necesarios para conocer **la deuda
   * pendiente**, porque una liquidación no puede superarla.
   */
  readonly priorEffects: readonly Effect[];
}

/**
 * Escenario 4.5 · marcar una deuda como saldada. **No mueve saldo** (invariante 6).
 *
 * **Una liquidación nunca puede superar el importe pendiente de esa deuda**
 * (`data-model.md` §3). Pagar 10 de 30 deja 20; pagar 30 la salda; pagar 31 es
 * inválido. Un envío por encima de lo debido no es una liquidación: es una
 * **transferencia entre usuarios**, que es otro hecho y se registra aparte.
 *
 * La deuda sigue siendo un saldo continuo y esto no introduce ninguna máquina
 * de estados: es una validación en el momento de registrar, no un estado
 * almacenado.
 */
export function deriveDebtSettlement(input: DebtSettlementInput): Effect[] {
  if (input.amount.minor <= 0n) {
    fail(
      'SETTLEMENT_AMOUNT_NOT_POSITIVE',
      `Una liquidación salda un importe positivo, recibido: ${input.amount.minor.toString()}`,
    );
  }

  const pending = pendingDebt(input);

  if (input.amount.minor > pending) {
    fail(
      'SETTLEMENT_EXCEEDS_DEBT',
      `Se intenta liquidar ${input.amount.minor.toString()} sobre una deuda pendiente de ${pending.toString()}`,
    );
  }

  return [
    effect({
      scope: input.scope,
      accountingClass: 'settlement',
      debt: {
        debtor: input.debtor,
        creditor: input.creditor,
        delta: negateMoney(input.amount),
      },
    }),
  ];
}

/** Lo que el deudor debe al acreedor ahora mismo. Cero si no debe nada. */
function pendingDebt(input: DebtSettlementInput): bigint {
  const debts = deriveDebts(input.priorEffects, input.scope, input.amount.currency);
  const match = debts.find(
    (debt) => debt.debtor === input.debtor && debt.creditor === input.creditor,
  );
  return match === undefined ? 0n : match.amount.minor;
}

/**
 * Escenario 4.8 · transferencia interna entre dos ámbitos de Nomey.
 *
 * Exactamente una salida en origen y una entrada en destino (invariante 4).
 * Los importes se piden por separado por la misma razón que en el gasto de
 * grupo: si las monedas base difieren, no son el mismo número.
 */
export function deriveInternalTransfer(input: {
  from: { scope: ScopeId; amount: Money };
  to: { scope: ScopeId; amount: Money };
}): Effect[] {
  return [
    effect({
      scope: input.from.scope,
      accountingClass: 'transfer',
      balance: negateMoney(input.from.amount),
    }),
    effect({
      scope: input.to.scope,
      accountingClass: 'transfer',
      balance: input.to.amount,
    }),
  ];
}

/**
 * Escenario 4.7 · transferencia externa: un único extremo dentro de Nomey.
 *
 * `delta` es negativo al pagar y positivo al reflejar dinero recibido.
 */
export function deriveExternalTransfer(input: { scope: ScopeId; delta: Money }): Effect[] {
  return [
    effect({
      scope: input.scope,
      accountingClass: 'transfer',
      balance: input.delta,
    }),
  ];
}

/**
 * Escenario 4.6 · pagar una deuda mediante transferencia.
 *
 * Una sola operación con dos hechos distintos: la transferencia mueve saldo y
 * la liquidación modifica la deuda. **No se fusionan** (ADR-002 §3).
 */
export function deriveSettlementByTransfer(input: {
  from: { scope: ScopeId; amount: Money };
  to: { scope: ScopeId; amount: Money };
  debtScope: ScopeId;
  debtor: ParticipantId;
  creditor: ParticipantId;
  settledAmount: Money;
  priorEffects: readonly Effect[];
}): Effect[] {
  return [
    ...deriveInternalTransfer({ from: input.from, to: input.to }),
    ...deriveDebtSettlement({
      scope: input.debtScope,
      debtor: input.debtor,
      creditor: input.creditor,
      amount: input.settledAmount,
      priorEffects: input.priorEffects,
    }),
  ];
}
