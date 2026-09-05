import { describe, expect, it } from 'vitest';

import {
  debtDisplay,
  homeDebt,
  PERSONAL_DEBT_AMOUNTS,
} from '../../src/features/personal/debt-display';

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

/**
 * Y lo que de verdad se pinta en Inicio: la deuda resuelta desde el snapshot.
 *
 * **La segunda mitad del mismo defecto.** Quitar el `0,00 €` fijo dejó la
 * tarjeta en `—` para siempre, porque la prop tenía un valor por defecto y nadie
 * la pasaba. Un desconocido permanente es tan falso como un cero permanente: una
 * carga que terminó bien y no encontró ninguna deuda **sabe** que la deuda es
 * cero.
 *
 * **`loaded` es «llegó el dato», no «hay red».** Es la distinción que estas
 * pruebas fijan, y la que impide sustituirla por `isOnline`: un refresco que
 * falla sobre un snapshot ya cargado no vuelve a desconocer nada.
 */
describe('la deuda que Inicio resuelve del snapshot', () => {
  it('carga pendiente o sin snapshot fiable → desconocido', () => {
    expect(homeDebt({ loaded: false })).toEqual({ kind: 'unknown' });
  });

  it('error de carga sin dato fiable → desconocido', () => {
    // Es el mismo estado: lo que decide es que no hay snapshot, no por qué.
    expect(homeDebt({ loaded: false })).toEqual({ kind: 'unknown' });
  });

  it('snapshot cargado y colección de deudas vacía → cero CONOCIDO', () => {
    expect(homeDebt({ loaded: true, amounts: [] })).toEqual({ kind: 'amount', minor: 0n });
    // Y es exactamente el caso del alcance funcional de hoy.
    expect(homeDebt({ loaded: true, amounts: PERSONAL_DEBT_AMOUNTS })).toEqual({
      kind: 'amount',
      minor: 0n,
    });
  });

  it('deuda conocida positiva → importe positivo, y te deben', () => {
    expect(homeDebt({ loaded: true, amounts: ['3000', '1500'] })).toEqual({
      kind: 'amount',
      minor: 4500n,
    });
  });

  it('deuda conocida negativa → importe negativo, y debes', () => {
    expect(homeDebt({ loaded: true, amounts: ['-3000', '-1500'] })).toEqual({
      kind: 'amount',
      minor: -4500n,
    });
  });

  it('recuperación de desconocido a snapshot vacío: de `—` a 0,00 €', () => {
    const antes = homeDebt({ loaded: false });
    const despues = homeDebt({ loaded: true, amounts: [] });

    expect(antes).toEqual({ kind: 'unknown' });
    expect(despues).toEqual({ kind: 'amount', minor: 0n });
  });

  it('recuperación de desconocido a deuda real: de `—` al importe', () => {
    const antes = homeDebt({ loaded: false });
    const despues = homeDebt({ loaded: true, amounts: ['-12000'] });

    expect(antes).toEqual({ kind: 'unknown' });
    expect(despues).toEqual({ kind: 'amount', minor: -12000n });
  });

  it('una cadena vacía o ilegible NUNCA se convierte en cero conocido', () => {
    /*
     * Ni sola ni acompañada. Si una sola cifra de la colección no se puede
     * defender, el total tampoco: dejar fuera la ilegible y sumar el resto daría
     * una cifra creíble y equivocada, que es peor que decir que no se sabe.
     */
    expect(homeDebt({ loaded: true, amounts: [''] })).toEqual({ kind: 'unknown' });
    expect(homeDebt({ loaded: true, amounts: ['4,50'] })).toEqual({ kind: 'unknown' });
    expect(homeDebt({ loaded: true, amounts: ['3000', 'no es un número'] })).toEqual({
      kind: 'unknown',
    });
  });

  it('la colección del alcance actual está vacía, y por eso el cero es conocido', () => {
    // Si alguien la rellenara con un valor de relleno, el cero dejaría de ser
    // derivado y volvería a ser una afirmación.
    expect(PERSONAL_DEBT_AMOUNTS).toEqual([]);
  });
});
