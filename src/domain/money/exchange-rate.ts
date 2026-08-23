import { fail } from '../errors';

/**
 * Un tipo de cambio exacto.
 *
 * **No es un `Money`** (ADR-003 §4): es un decimal exacto propio, representado
 * como coeficiente entero sobre una potencia de diez.
 *
 *     0,862034781245  ->  { coefficient: 862034781245n, scale: 12 }
 *
 * Nunca coma flotante binaria.
 */
export interface ExchangeRate {
  readonly coefficient: bigint;
  readonly scale: number;
}

export function exchangeRate(coefficient: bigint, scale: number): ExchangeRate {
  if (coefficient <= 0n) {
    fail(
      'RATE_NOT_POSITIVE',
      `Un tipo de cambio debe ser positivo, recibido: ${coefficient.toString()}`,
    );
  }

  if (!Number.isInteger(scale) || scale < 0) {
    fail(
      'RATE_SCALE_INVALID',
      `La escala de un tipo de cambio debe ser un entero no negativo, recibida: ${String(scale)}`,
    );
  }

  return Object.freeze({ coefficient, scale });
}

/**
 * Construye desde la representación textual del coeficiente.
 *
 * El coeficiente cruza cualquier frontera como texto, por el mismo motivo que
 * los importes.
 */
export function exchangeRateFromStrings(coefficient: string, scale: number): ExchangeRate {
  let parsed: bigint;
  try {
    parsed = BigInt(coefficient);
  } catch {
    fail('RATE_COEFFICIENT_NOT_INTEGER', `El coeficiente no es un entero: "${coefficient}"`);
  }
  return exchangeRate(parsed, scale);
}

/**
 * La cota máxima admitida para la escala **no se valida aquí**.
 *
 * ADR-003 §4 exige que exista una cota declarada pero deja su número al diseño
 * del esquema. Validarla es una responsabilidad de la persistencia, no de la
 * aritmética.
 */
