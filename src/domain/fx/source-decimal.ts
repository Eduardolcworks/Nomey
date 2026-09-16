import { fail } from '../errors';
import type { ExchangeRate } from '../money/exchange-rate';
import { exchangeRate } from '../money/exchange-rate';
import { INT64_MAX } from '../money/int64';

/**
 * Escala máxima de un tipo de cambio en Nomey (F03/ADR-012). Un valor de la
 * fuente que necesite más decimales no es representable y se rechaza.
 */
export const MAX_RATE_SCALE = 12;

/**
 * Forma admitida para un tipo publicado por la fuente (F11/ADR-002 §2,
 * condición 4): dígitos, y opcionalmente un punto seguido de dígitos. Nada de
 * signo, exponente, espacios, `NaN`, `Infinity`, `.5` ni `5.`.
 */
const SOURCE_DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

/**
 * Convierte el texto de un tipo publicado por la fuente —«178.56»— en un
 * `ExchangeRate` exacto: `{ coefficient: 17856n, scale: 2 }`.
 *
 * Solo trabaja sobre el texto y `bigint`: ningún paso pasa por coma flotante.
 * Los ceros finales de la parte decimal no aportan valor y se quitan antes de
 * fijar la escala, así que `0.85580` y `0.8558` dan el mismo tipo. Si, tras
 * quitarlos, hacen falta más de 12 decimales, el valor no es representable.
 *
 * Un valor que no cumple el contrato hace inválida la observación entera
 * (F11/ADR-002 §2); aquí solo se señala con su código.
 */
export function sourceDecimalToRate(text: string): ExchangeRate {
  if (!SOURCE_DECIMAL.test(text)) {
    fail('RATE_DECIMAL_INVALID', `No es un decimal válido de la fuente: "${text}"`);
  }

  const [whole, fraction = ''] = text.split('.');
  const significant = fraction.replace(/0+$/, '');

  if (significant.length > MAX_RATE_SCALE) {
    fail(
      'RATE_DECIMAL_INVALID',
      `El tipo "${text}" necesita más de ${String(MAX_RATE_SCALE)} decimales`,
    );
  }

  const coefficient = BigInt(`${whole}${significant}`);

  if (coefficient <= 0n) {
    fail('RATE_NOT_POSITIVE', `Un tipo de la fuente debe ser mayor que cero, recibido: "${text}"`);
  }

  if (coefficient > INT64_MAX) {
    fail('RATE_OUT_OF_RANGE', `El coeficiente del tipo "${text}" no cabe en 64 bits`);
  }

  return exchangeRate(coefficient, significant.length);
}
