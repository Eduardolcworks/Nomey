import { describe, expect, it } from 'vitest';

import {
  BACKOFF_CEILING_MS,
  BACKOFF_MINIMUM_MS,
  backoffDelayMs,
  isDue,
  nextAttemptAt,
} from '../../src/lib/offline/backoff';

/**
 * El backoff de ADR-028 §12.
 *
 * Con el RNG inyectado se pueden fijar los DOS extremos en vez de comprobar que
 * el resultado «parece razonable», que es lo que haría un test con
 * `Math.random` de verdad.
 */

const cero = () => 0;
const uno = () => 0.999999;

describe('el suelo efectivo', () => {
  it('CON JITTER MÍNIMO NUNCA BAJA DEL SUELO', () => {
    /*
     * Es la razón de ser del mínimo. Con jitter completo —`aleatorio() ·
     * techo`— esto daría ~0 ms y el backoff dejaría de serlo: una entrada
     * contra un servidor caído se reintentaría en bucle.
     */
    for (let attempts = 0; attempts <= 12; attempts += 1) {
      expect(backoffDelayMs(attempts, cero)).toBe(BACKOFF_MINIMUM_MS);
    }
  });

  it('el primer reintento no depende del azar', () => {
    // Con 0 intentos fallidos el techo es la base, que es el propio suelo.
    expect(backoffDelayMs(0, cero)).toBe(BACKOFF_MINIMUM_MS);
    expect(backoffDelayMs(0, uno)).toBe(BACKOFF_MINIMUM_MS);
  });
});

describe('el techo', () => {
  it('crece exponencialmente y se detiene en el tope', () => {
    expect(backoffDelayMs(1, uno)).toBeCloseTo(2_000, -2);
    expect(backoffDelayMs(2, uno)).toBeCloseTo(4_000, -2);
    expect(backoffDelayMs(3, uno)).toBeCloseTo(8_000, -2);
    expect(backoffDelayMs(30, uno)).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
    expect(backoffDelayMs(99, uno)).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
  });

  it('un número enorme de intentos no desborda ni se hace negativo', () => {
    const delay = backoffDelayMs(1_000, uno);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_MINIMUM_MS);
  });
});

describe('cuándo toca el siguiente intento', () => {
  const clock = { now: () => Date.parse('2026-09-03T21:00:00.000Z') };

  it('suma el retardo al reloj inyectado', () => {
    expect(nextAttemptAt(0, clock, cero)).toBe('2026-09-03T21:00:01.000Z');
  });

  it('sin plazo, se puede ya', () => {
    expect(isDue(null, clock)).toBe(true);
  });

  it('un plazo futuro bloquea; uno pasado, no', () => {
    expect(isDue('2026-09-03T21:00:01.000Z', clock)).toBe(false);
    expect(isDue('2026-09-03T20:59:59.000Z', clock)).toBe(true);
  });

  it('UNA FECHA ILEGIBLE NO BLOQUEA LA ENTRADA PARA SIEMPRE', () => {
    // Preferimos intentar de más a dejar dinero declarado sin salir nunca.
    expect(isDue('no es una fecha', clock)).toBe(true);
  });
});
