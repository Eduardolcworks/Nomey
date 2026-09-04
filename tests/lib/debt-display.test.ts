import { describe, expect, it } from 'vitest';

import { debtDisplay } from '../../src/features/personal/debt-display';

/**
 * Una deuda desconocida no es una deuda de cero.
 *
 * **El defecto que fija.** La tarjeta llevaba un `DEBT_PLACEHOLDER = '0'` de
 * interfaz como parámetro por defecto, y nadie pasaba la deuda: enseñaba
 * `0,00 €` **siempre**, con servidor y sin él. Se descubrió en F8.A4, en un
 * arranque en frío sin frontera, porque allí el resto de la tarjeta degradaba a
 * `—` y el contraste lo delató — pero la cifra ya era falsa antes, conectada.
 *
 * Las cuatro filas de abajo son los cuatro estados que hay que saber
 * distinguir, y la trampa está en la primera contra la segunda: si alguien
 * volviera a colapsarlas, la pantalla afirmaría que alguien no debe nada sin
 * haberlo derivado de ningún sitio.
 */

describe('qué se puede afirmar sobre la deuda', () => {
  it('1 · sin dato durable, el valor es desconocido', () => {
    // Es el estado de hoy: el Modo Personal no tiene dimensión de deuda hasta
    // F9, así que nadie pasa nada y la tarjeta no debe inventarse un cero.
    expect(debtDisplay(null)).toEqual({ kind: 'unknown' });
    expect(debtDisplay(undefined)).toEqual({ kind: 'unknown' });
  });

  it('2 · con dato fiable a cero, es cero de verdad', () => {
    // «No debes nada» SÍ es una respuesta, y se enseña como cifra.
    expect(debtDisplay('0')).toEqual({ kind: 'amount', minor: 0n });
    expect(debtDisplay('-0')).toEqual({ kind: 'amount', minor: 0n });
  });

  it('3 · con dato fiable distinto de cero, se conserva el importe y su signo', () => {
    // Negativo = debes · positivo = te deben, el mismo criterio que `core`.
    expect(debtDisplay('-4500')).toEqual({ kind: 'amount', minor: -4500n });
    expect(debtDisplay('12000')).toEqual({ kind: 'amount', minor: 12000n });
  });

  it('4 · al llegar el dato, el desconocido se sustituye por la cifra', () => {
    // La recuperación del servidor no es un estado aparte: es pasar de no tener
    // valor a tenerlo, y la función lo refleja sin memoria de por medio.
    const antes = debtDisplay(null);
    const despues = debtDisplay('0');

    expect(antes.kind).toBe('unknown');
    expect(despues).toEqual({ kind: 'amount', minor: 0n });
    expect(despues).not.toEqual(antes);
  });

  it('y un texto ilegible es desconocido, nunca cero', () => {
    /*
     * Es la diferencia con `toMinor`, que devuelve `0n` ante cualquier cosa que
     * no parsee. Esa decisión es correcta para un total de gastos —un cero
     * visible es diagnosticable— y equivocada aquí, donde el cero **es** una de
     * las respuestas legítimas y no puede significar además «no lo sé».
     */
    expect(debtDisplay('')).toEqual({ kind: 'unknown' });
    expect(debtDisplay('4,50')).toEqual({ kind: 'unknown' });
    expect(debtDisplay('no soy un número')).toEqual({ kind: 'unknown' });
  });

  it('no pierde precisión con importes por encima de 2^53', () => {
    // ADR-008 §1 hace que los importes crucen como texto justamente para esto.
    expect(debtDisplay('9007199254740993')).toEqual({
      kind: 'amount',
      minor: 9007199254740993n,
    });
  });
});
