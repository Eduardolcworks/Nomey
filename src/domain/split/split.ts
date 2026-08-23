import { fail } from '../errors';
import type { ParticipantId } from '../ids';
import type { Money } from '../money/money';
import { money, sumMoney } from '../money/money';
import { allocateByLargestRemainder } from './largest-remainder';

/**
 * Métodos de reparto de ADR-002 §5. Se conservan **intención y resultado**: el
 * método forma parte de la operación, porque un 30/30/30/30 no distingue «a
 * partes iguales entre cuatro» de «cuatro importes fijos», y esa diferencia
 * decide si una corrección posterior recalcula.
 */
export type SplitMethod =
  | { readonly kind: 'equal' }
  | { readonly kind: 'shares'; readonly weights: readonly bigint[] }
  | { readonly kind: 'exact_amounts'; readonly amounts: readonly bigint[] };

export interface Share {
  readonly participant: ParticipantId;
  readonly amount: Money;
}

export interface SplitInput {
  /** Total ya expresado en la moneda base del ámbito. */
  readonly total: Money;
  /** Participantes en el **orden estable guardado con la operación**. */
  readonly participants: readonly ParticipantId[];
  readonly payer: ParticipantId;
  readonly method: SplitMethod;
}

/**
 * Reparte un gasto entre sus participantes.
 *
 * **Una participación calculada puede resultar `0`** por indivisibilidad: con
 * `equal`, 0,01 € entre tres da 0,01 / 0 / 0, y la unidad va al pagador por el
 * desempate. No es un error. Lo que sí debe ser estrictamente positivo es lo
 * **declarado**: los pesos de `shares` y los importes de `exact_amounts`.
 * Ver `data-model.md` §5.
 *
 * El total llega **ya convertido** a la moneda del ámbito: convertir una vez y
 * repartir después es lo que garantiza que la suma cuadre (ADR-003 §5).
 */
export function splitExpense(input: SplitInput): Share[] {
  const { total, participants, payer, method } = input;

  if (participants.length === 0) {
    fail('SPLIT_NO_PARTICIPANTS', 'Un reparto necesita al menos un participante');
  }

  if (new Set(participants).size !== participants.length) {
    fail(
      'SPLIT_DUPLICATE_PARTICIPANT',
      'Un participante no puede figurar dos veces en la misma operación',
    );
  }

  const payerIndex = participants.indexOf(payer);
  if (payerIndex === -1) {
    fail('SPLIT_PAYER_NOT_PARTICIPANT', 'El pagador debe figurar siempre entre los participantes');
  }

  if (total.minor < 0n) {
    fail(
      'SPLIT_NEGATIVE_TOTAL',
      `El total de un reparto no puede ser negativo: ${total.minor.toString()}`,
    );
  }

  const amounts = allocate(total, participants, payerIndex, method);

  return participants.map((participant, index) =>
    Object.freeze({ participant, amount: money(amounts[index], total.currency) }),
  );
}

function allocate(
  total: Money,
  participants: readonly ParticipantId[],
  payerIndex: number,
  method: SplitMethod,
): bigint[] {
  switch (method.kind) {
    case 'equal':
      return allocateByLargestRemainder(
        total.minor,
        participants.map(() => 1n),
        tieBreakPriority(participants.length, payerIndex),
      );

    case 'shares': {
      if (method.weights.length !== participants.length) {
        fail(
          'SPLIT_WEIGHTS_LENGTH_MISMATCH',
          `Hay ${participants.length} participantes y ${method.weights.length} pesos`,
        );
      }
      for (const weight of method.weights) {
        if (weight <= 0n) {
          fail(
            'SPLIT_SHARE_NOT_POSITIVE',
            `Los pesos declarados deben ser enteros > 0, recibido: ${weight.toString()}`,
          );
        }
      }
      return allocateByLargestRemainder(
        total.minor,
        method.weights,
        tieBreakPriority(participants.length, payerIndex),
      );
    }

    case 'exact_amounts': {
      if (method.amounts.length !== participants.length) {
        fail(
          'SPLIT_AMOUNTS_LENGTH_MISMATCH',
          `Hay ${participants.length} participantes y ${method.amounts.length} importes`,
        );
      }
      for (const amount of method.amounts) {
        // Participante de una operación = persona con participación económica
        // declarada en ella. Quien declara 0 no participa.
        if (amount <= 0n) {
          fail(
            'SPLIT_EXACT_AMOUNT_NOT_POSITIVE',
            `Todo participante de un reparto exacto declara un importe > 0, recibido: ${amount.toString()}`,
          );
        }
      }

      const declared = method.amounts.reduce((acc, amount) => acc + amount, 0n);
      if (declared !== total.minor) {
        // Sin corrección silenciosa (ADR-002 §5).
        fail(
          'SPLIT_EXACT_AMOUNTS_MISMATCH',
          `Los importes declarados suman ${declared.toString()} y el total es ${total.minor.toString()}`,
        );
      }

      return [...method.amounts];
    }
  }
}

/**
 * Prioridad de desempate: el pagador primero, después el orden estable
 * guardado con la operación (ADR-002 §5, pasos 4 y 5).
 */
function tieBreakPriority(count: number, payerIndex: number): number[] {
  return Array.from({ length: count }, (_, index) => (index === payerIndex ? -1 : index));
}

/** Comprobación de la propiedad que hace útil el reparto: la suma cuadra. */
export function sharesTotal(shares: readonly Share[], total: Money): Money {
  return sumMoney(
    shares.map((share) => share.amount),
    total.currency,
  );
}
