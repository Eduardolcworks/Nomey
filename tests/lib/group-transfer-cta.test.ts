import { describe, expect, it } from 'vitest';

import {
  transferSubmission,
  type TransferCandidate,
  transferableCandidates,
} from '../../src/features/groups/group-transfer';
import {
  type AmountEntry,
  applyAmountInput,
  EMPTY_AMOUNT,
} from '../../src/ui/components/amount-entry';

/**
 * EL BOTÓN DE «REGISTRAR TRANSFERENCIA» (F12/ADR-007, F12.C3).
 *
 * ═══════════ POR QUÉ ESTE FICHERO EXISTE ═══════════
 *
 * Porque la regla se rompió en producción y ninguna prueba pudo verlo. La
 * pantalla cerraba el paso con `amountComplete`, que **no** significa «hay un
 * importe» sino «los decimales están TERMINADOS». Y como la cifra se pinta con
 * los céntimos completados (`amountParts` los rellena con ceros), quien
 * escribía `10` veía **`10,00 €`** en pantalla con `entry.fraction === ''`: un
 * importe válido delante y el botón apagado para siempre.
 *
 * Mientras la condición vivía suelta entre ternarios dentro del render, no
 * había nada que ejecutar. Ahora es `transferSubmission`, una función pura, y
 * estos casos la ejecutan de verdad.
 *
 * **Y lo que se fija no es sólo que funcione, sino QUÉ puede bloquear**: el
 * importe, cuántos hay marcados y si alcanza a repartirse. Nada más. Una
 * cuenta, un username, un Modo Personal o una amistad del receptor no entran
 * en esta función — no podrían, no los recibe.
 */

/**
 * Teclear una cifra como se teclea de verdad.
 *
 * `applyAmountInput` recibe la CADENA ENTERA que queda en el campo —es un
 * `TextInput` y lo que llega es su nuevo valor—, no la tecla suelta. Así que
 * se alimenta acumulando, que es exactamente lo que ocurre al escribir.
 */
function typed(keys: string, scale: number): AmountEntry {
  let entry = EMPTY_AMOUNT;
  for (let i = 1; i <= keys.length; i += 1) {
    entry = applyAmountInput(entry, keys.slice(0, i), scale);
  }
  return entry;
}

const EUR = 2;
const JPY = 0;

describe('el importe: lo que se ve es lo que vale', () => {
  /**
   * EL CASO DEL BUG, exactamente. Se teclea `10`, la pantalla enseña `10,00 €`
   * y el total tiene que ser 1000 unidades menores.
   */
  it('«10» sin céntimos tecleados YA es un importe: 10,00 €', () => {
    const entry = typed('10', EUR);
    expect(entry.fraction).toBe('');
    const out = transferSubmission(entry, EUR, 1);
    expect(out.totalMinor).toBe(1000n);
    expect(out.blocker).toBeNull();
  });

  it('con los céntimos tecleados da lo mismo', () => {
    expect(transferSubmission(typed('10.00', EUR), EUR, 1).totalMinor).toBe(1000n);
  });

  it('y a medio teclear también: «10,5» son 10,50 €', () => {
    const entry = typed('10.5', EUR);
    const out = transferSubmission(entry, EUR, 1);
    expect(out.totalMinor).toBe(1050n);
    expect(out.blocker).toBeNull();
  });

  it('vacío no es un importe', () => {
    const out = transferSubmission(EMPTY_AMOUNT, EUR, 1);
    expect(out.totalMinor).toBeNull();
    expect(out.blocker).toBe('amount');
  });

  it('cero tampoco: una transferencia de nada no es una transferencia', () => {
    const out = transferSubmission(typed('0', EUR), EUR, 1);
    expect(out.totalMinor).toBeNull();
    expect(out.blocker).toBe('amount');
  });

  /** Una moneda sin decimales no puede quedarse bloqueada por no tenerlos. */
  it('una moneda de escala 0 funciona igual', () => {
    const out = transferSubmission(typed('500', JPY), JPY, 1);
    expect(out.totalMinor).toBe(500n);
    expect(out.blocker).toBeNull();
  });
});

describe('los destinatarios', () => {
  it('sin nadie marcado no se envía, y se dice cuál es el motivo', () => {
    const out = transferSubmission(typed('10', EUR), EUR, 0);
    expect(out.totalMinor).toBe(1000n);
    expect(out.shares).toBeNull();
    expect(out.blocker).toBe('recipients');
  });

  it('con uno marcado se envía entero', () => {
    const out = transferSubmission(typed('10', EUR), EUR, 1);
    expect(out.shares).toEqual([1000n]);
    expect(out.blocker).toBeNull();
  });

  it('con varios se reparte, y el céntimo que sobra va al primero', () => {
    const out = transferSubmission(typed('10', EUR), EUR, 3);
    expect(out.shares).toEqual([334n, 333n, 333n]);
    expect(out.blocker).toBeNull();
    expect((out.shares ?? []).reduce((a, b) => a + b, 0n)).toBe(1000n);
  });
});

describe('el importe que no alcanza', () => {
  it('2 céntimos entre tres se bloquea', () => {
    const out = transferSubmission(typed('0.02', EUR), EUR, 3);
    expect(out.totalMinor).toBe(2n);
    expect(out.shares).toBeNull();
    expect(out.blocker).toBe('too-small');
  });

  /** Justo en el límite SÍ: una unidad menor para cada uno. */
  it('3 céntimos entre tres se envía, y deja a cada uno con uno', () => {
    const out = transferSubmission(typed('0.03', EUR), EUR, 3);
    expect(out.blocker).toBeNull();
    expect(out.shares).toEqual([1n, 1n, 1n]);
  });

  it('un céntimo entre dos se bloquea; entre uno, no', () => {
    expect(transferSubmission(typed('0.01', EUR), EUR, 2).blocker).toBe('too-small');
    expect(transferSubmission(typed('0.01', EUR), EUR, 1).blocker).toBeNull();
  });
});

/**
 * ═══════════ FANTASMA Y VINCULADO, LA MISMA PUERTA ═══════════
 *
 * Éste es el caso obligatorio: lo que motivó el contrato de F12/ADR-007 fue
 * que un participante sin cuenta no llegaba siquiera a la lista. Ahora llega,
 * y hay que fijar que tampoco cambia nada aguas abajo.
 */
describe('el receptor no cambia la puerta', () => {
  const GHOST: TransferCandidate = {
    participantId: 'p-gus',
    displayName: 'Gus',
    state: 'ready',
    netMinor: '0',
  };
  const LINKED: TransferCandidate = {
    participantId: 'p-aitor',
    displayName: 'Aitor',
    state: 'ready',
    netMinor: '2500',
  };

  it('los dos llegan a la lista: `ready` es `ready`', () => {
    expect(transferableCandidates([GHOST, LINKED]).map((one) => one.displayName)).toEqual([
      'Gus',
      'Aitor',
    ]);
  });

  /**
   * 10,00 € + fantasma marcado + nada en vuelo → SE PUEDE ENVIAR. El caso
   * literal del informe del iPhone.
   */
  it('10,00 € a un FANTASMA: nada lo bloquea', () => {
    const out = transferSubmission(typed('10', EUR), EUR, [GHOST].length);
    expect(out.totalMinor).toBe(1000n);
    expect(out.shares).toEqual([1000n]);
    expect(out.blocker).toBeNull();
  });

  it('10,00 € a un VINCULADO: exactamente lo mismo', () => {
    const out = transferSubmission(typed('10', EUR), EUR, [LINKED].length);
    expect(out.totalMinor).toBe(1000n);
    expect(out.shares).toEqual([1000n]);
    expect(out.blocker).toBeNull();
  });

  /**
   * Y LA COMPROBACIÓN DE FONDO: la puerta no puede distinguirlos, porque **no
   * recibe nada de ellos**. Sólo cuántos hay. Un `blocker` que dependiera de
   * quién es el receptor tendría que llegar por un parámetro que no existe.
   */
  it('la puerta sólo sabe CUÁNTOS hay, no quiénes son', () => {
    expect(transferSubmission(typed('10', EUR), EUR, 1)).toEqual(
      transferSubmission(typed('10', EUR), EUR, 1),
    );
    // Mezclar fantasma y vinculado es un caso de dos, y se reparte como tal.
    const mixed = transferSubmission(typed('10', EUR), EUR, [GHOST, LINKED].length);
    expect(mixed.shares).toEqual([500n, 500n]);
    expect(mixed.blocker).toBeNull();
  });
});
