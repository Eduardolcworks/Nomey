/**
 * Errores de dominio.
 *
 * El **código** es el contrato. Lo comparten la implementación de referencia,
 * los vectores de prueba y, en su momento, la implementación autoritativa del
 * servidor: un vector puede afirmar «esta entrada debe fallar con
 * `SPLIT_EXACT_AMOUNTS_MISMATCH`» y comprobarse en ambas.
 *
 * **El mensaje humano no es contrato.** Puede cambiar sin romper nada; el
 * código, no.
 */

export const DOMAIN_ERROR_CODES = [
  // Definición monetaria
  'CURRENCY_DEFINITION_ID_EMPTY',
  'CURRENCY_DEFINITION_CODE_EMPTY',
  'CURRENCY_DEFINITION_SCALE_INVALID',
  'CURRENCY_DEFINITION_INCONSISTENT',

  // Money
  'MONEY_CURRENCY_MISMATCH',
  'MONEY_MINOR_NOT_INTEGER',
  'MONEY_SUM_WITHOUT_CURRENCY',

  // Tipo de cambio
  'RATE_COEFFICIENT_NOT_INTEGER',
  'RATE_NOT_POSITIVE',
  'RATE_SCALE_INVALID',

  // Reparto por mayor resto
  'ALLOCATION_NEGATIVE_TOTAL',
  'ALLOCATION_NO_WEIGHTS',
  'ALLOCATION_WEIGHT_NOT_POSITIVE',
  'ALLOCATION_PRIORITY_LENGTH_MISMATCH',

  // Reparto de un gasto
  'SPLIT_NO_PARTICIPANTS',
  'SPLIT_DUPLICATE_PARTICIPANT',
  'SPLIT_PAYER_NOT_PARTICIPANT',
  'SPLIT_NEGATIVE_TOTAL',
  'SPLIT_WEIGHTS_LENGTH_MISMATCH',
  'SPLIT_SHARE_NOT_POSITIVE',
  'SPLIT_AMOUNTS_LENGTH_MISMATCH',
  'SPLIT_EXACT_AMOUNT_NOT_POSITIVE',
  'SPLIT_EXACT_AMOUNTS_MISMATCH',

  // Deudas y liquidaciones
  'DEBT_SELF_REFERENCE',
  'DEBT_AMOUNT_NOT_POSITIVE',
  'SETTLEMENT_AMOUNT_NOT_POSITIVE',
  'SETTLEMENT_EXCEEDS_DEBT',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function fail(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
