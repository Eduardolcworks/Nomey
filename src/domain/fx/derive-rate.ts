import { fail } from '../errors';
import type { ExchangeRate } from '../money/exchange-rate';
import { exchangeRate } from '../money/exchange-rate';
import { INT64_MAX } from '../money/int64';
import { divideRoundHalfAwayFromZero } from '../money/rounding';

/** Escala canónica del tipo derivado (F11/ADR-001 §7). */
export const DERIVED_RATE_SCALE = 12;

/** El tipo del pivote de la fuente —EUR para el BCE— contra sí mismo. */
export const PIVOT_QUOTE: ExchangeRate = exchangeRate(1n, 0);

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Deriva el tipo origen → destino a partir de dos cotizaciones de la fuente,
 * expresadas ambas como «unidades de la moneda por una unidad del pivote».
 *
 *     tipo(O → D) = q_D / q_O
 *                 = (c_D / 10^s_D) / (c_O / 10^s_O)
 *
 * F11/ADR-001 §7: **un único cociente racional exacto**, redondeado **una sola
 * vez** a escala 12, _half away from zero_. Directo, inverso y cruzado son la
 * misma fórmula; nunca se invierte y después se multiplica.
 *
 * Las dos cotizaciones pueden tener fechas de referencia distintas
 * (F11/ADR-002 §7): la aritmética no depende de ellas.
 *
 * El resultado debe ser representable como tipo congelado —coeficiente mayor
 * que cero que quepa en 64 bits, con escala 12 (F03/ADR-012)—. Si no lo es, el
 * tipo está fuera de rango.
 */
export function deriveRate(origin: ExchangeRate, target: ExchangeRate): ExchangeRate {
  const numerator = target.coefficient * powerOfTen(origin.scale + DERIVED_RATE_SCALE);
  const denominator = origin.coefficient * powerOfTen(target.scale);
  const coefficient = divideRoundHalfAwayFromZero(numerator, denominator);

  if (coefficient <= 0n || coefficient > INT64_MAX) {
    fail(
      'RATE_OUT_OF_RANGE',
      `El tipo derivado no es representable con escala ${String(DERIVED_RATE_SCALE)}: ${coefficient.toString()}`,
    );
  }

  return exchangeRate(coefficient, DERIVED_RATE_SCALE);
}
