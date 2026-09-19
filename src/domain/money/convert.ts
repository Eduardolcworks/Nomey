import { fail } from '../errors';
import type { CurrencyDefinition } from './currency-definition';
import { assertCurrencyDefinitionCoherent } from './currency-definition';
import type { ExchangeRate } from './exchange-rate';
import { isInt64 } from './int64';
import type { Money } from './money';
import { money } from './money';
import { divideRoundHalfAwayFromZero } from './rounding';

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Convierte un importe a otra definición monetaria.
 *
 * F02/ADR-001 T12: el resultado previo al redondeo se mantiene como **cociente
 * racional exacto**, y solo al producir las unidades mínimas del destino se
 * aplica el redondeo (T10). **Un único redondeo, al final.**
 *
 *     minor_destino = redondear(
 *       minor_origen × coeficiente × 10^escala_destino
 *       ─────────────────────────────────────────────────
 *              10^escala_origen × 10^escala_tipo
 *     )
 *
 * No interviene `Number`, `parseFloat` ni `Math.round` en ningún punto.
 */
export function convert(amount: Money, target: CurrencyDefinition, rate: ExchangeRate): Money {
  assertCurrencyDefinitionCoherent(amount.currency, target);

  const numerator = amount.minor * rate.coefficient * powerOfTen(target.scale);
  const denominator = powerOfTen(amount.currency.scale) * powerOfTen(rate.scale);

  return money(divideRoundHalfAwayFromZero(numerator, denominator), target);
}

/**
 * `convert`, exigiendo además que el resultado quepa en 64 bits.
 *
 * Es la conversión que usa la multimoneda: el importe convertido acaba en un
 * efecto de `bigint`, y F11/ADR-001 §7 exige que un resultado que no cabe sea
 * **fuera de rango** en las dos implementaciones, nunca un valor truncado. La
 * aritmética es la misma y el redondeo sigue siendo uno solo.
 *
 * Un resultado de 0 unidades mínimas es válido y se devuelve tal cual.
 */
export function convertWithinRange(
  amount: Money,
  target: CurrencyDefinition,
  rate: ExchangeRate,
): Money {
  const result = convert(amount, target, rate);
  if (!isInt64(result.minor)) {
    fail(
      'CONVERSION_OUT_OF_RANGE',
      `El importe convertido no cabe en 64 bits: ${result.minor.toString()}`,
    );
  }
  return result;
}

/**
 * El residuo descartado por el redondeo **no genera ningún efecto** (F02/ADR-001
 * §5). No se expone como valor de dominio a propósito: exponerlo invitaría a
 * compensarlo, y compensarlo sería representar un movimiento que no ocurrió.
 */
