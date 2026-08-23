import { fail } from '../errors';

/**
 * Redondeo normativo: **half away from zero**, definido sobre la magnitud
 * absoluta y aplicando el signo después.
 *
 * ADR-003 T10. Definirlo sobre la magnitud y no sobre el valor con signo es
 * deliberado: elimina la dependencia del comportamiento de la división entera
 * con operandos negativos, que varía entre lenguajes y que E6 midió que trunca
 * hacia cero en `BigInt`.
 *
 * Redondea el cociente exacto `numerator / denominator`. Todo entero: no hay
 * ningún paso en coma flotante.
 */
export function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    fail('ALLOCATION_NO_WEIGHTS', 'División por cero en el redondeo');
  }

  // Normaliza el signo del denominador para razonar solo sobre magnitudes.
  const negativeDenominator = denominator < 0n;
  const den = negativeDenominator ? -denominator : denominator;
  const num = negativeDenominator ? -numerator : numerator;

  const negative = num < 0n;
  const magnitude = negative ? -num : num;

  const quotient = magnitude / den;
  const remainder = magnitude - quotient * den;

  // «Half away from zero»: el empate exacto sube en magnitud.
  const rounded = remainder * 2n >= den ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}
