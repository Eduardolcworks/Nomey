import type { CurrencyDefinition } from './currency-definition';
import { assertCurrencyDefinitionCoherent } from './currency-definition';
import type { ExchangeRate } from './exchange-rate';
import type { Money } from './money';
import { money } from './money';
import { divideRoundHalfAwayFromZero } from './rounding';

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Convierte un importe a otra definición monetaria.
 *
 * ADR-003 T12: el resultado previo al redondeo se mantiene como **cociente
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
 * El residuo descartado por el redondeo **no genera ningún efecto** (ADR-003
 * §5). No se expone como valor de dominio a propósito: exponerlo invitaría a
 * compensarlo, y compensarlo sería representar un movimiento que no ocurrió.
 */
