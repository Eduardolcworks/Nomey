import { describe, expect, it } from 'vitest';

import { splitEvenly, tooSmallToSplit } from '../../src/domain';

/**
 * EL REPARTO A PARTES IGUALES DE F12.C3.
 *
 * Los 22 vectores compartidos ya comprueban `allocateByLargestRemainder`
 * contra el servidor, y `splitEvenly` no es otro algoritmo: es ése con los
 * pesos a uno. Lo que estos casos fijan es lo que la pantalla de
 * transferencias apoya encima — **que la suma cierra al céntimo, que el
 * céntimo que sobra cae siempre en el mismo sitio, y que nadie sale con
 * cero** cuando no hay unidades menores para todos.
 *
 * Todo en `bigint`, como el resto del dinero de Nomey: ni un `number` entra
 * ni sale de aquí (F02/ADR-001).
 */
describe('splitEvenly · el reparto de una transferencia múltiple', () => {
  /** 10,00 € a una sola persona: no se reparte nada. */
  it('uno solo se lo lleva entero', () => {
    expect(splitEvenly(1000n, 1)).toEqual([1000n]);
  });

  /** 10,00 € entre dos: cabe exacto, sin resto que colocar. */
  it('divisible entre dos: mitades iguales', () => {
    expect(splitEvenly(1000n, 2)).toEqual([500n, 500n]);
  });

  /**
   * 10,00 € entre tres es el caso interesante: 3,33 · 3 = 9,99 y sobra un
   * céntimo. **Va al primero**, porque con pesos iguales todos los restos
   * empatan y el desempate de F01/ADR-001 §5 es el orden de entrada.
   */
  it('indivisible entre tres: el céntimo que sobra va al PRIMERO', () => {
    expect(splitEvenly(1000n, 3)).toEqual([334n, 333n, 333n]);
  });

  /** 100,00 € entre tres: el mismo reparto una magnitud más arriba. */
  it('100,00 entre tres reparte igual, con el resto también al primero', () => {
    expect(splitEvenly(10000n, 3)).toEqual([3334n, 3333n, 3333n]);
  });

  /**
   * DOS CÉNTIMOS DE RESTO, DOS PERSONAS DISTINTAS. 10,01 entre tres deja
   * dos unidades sobrantes, y caen en los dos primeros — no las dos en el
   * mismo.
   */
  it('con dos unidades de resto las reparte a dos personas, no a una', () => {
    expect(splitEvenly(1001n, 3)).toEqual([334n, 334n, 333n]);
  });

  /**
   * LA SUMA ES EL TOTAL, SIEMPRE. Es la propiedad por la que la pantalla
   * puede decir «se reparte entre los seleccionados» sin mentir: lo que se
   * propone en las N propuestas es exactamente lo que se escribió arriba.
   */
  it('la suma de las cuotas es EXACTAMENTE el total, en todos los tamaños', () => {
    for (const total of [1n, 2n, 7n, 100n, 999n, 1000n, 123_456n, 10n ** 15n]) {
      for (const count of [1, 2, 3, 4, 5, 7, 11]) {
        if (tooSmallToSplit(total, count)) continue;
        const shares = splitEvenly(total, count);
        expect(shares).toHaveLength(count);
        expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
      }
    }
  });

  /**
   * NINGUNA CUOTA NEGATIVA, y ninguna a cero mientras haya con qué. Una
   * propuesta de cero la rehúsa el servidor (`amount > 0`), así que una
   * cuota a cero sería una fila que no llega a existir.
   */
  it('ninguna cuota es negativa, y ninguna es cero si hay unidades para todos', () => {
    for (const total of [3n, 10n, 1000n, 1001n, 99_999n]) {
      for (const count of [1, 2, 3, 5]) {
        if (tooSmallToSplit(total, count)) continue;
        for (const share of splitEvenly(total, count)) {
          expect(share > 0n).toBe(true);
        }
      }
    }
  });

  /**
   * DETERMINISTA. La misma entrada da la misma salida, que es lo que hace
   * que reintentar las propuestas que fallaron mande **las mismas cifras**
   * y no un reparto nuevo.
   */
  it('es determinista: misma entrada, misma salida', () => {
    const once = splitEvenly(1000n, 7);
    for (let i = 0; i < 5; i += 1) expect(splitEvenly(1000n, 7)).toEqual(once);
  });

  /** Un total de cero no es un caso de la pantalla, pero no inventa dinero. */
  it('cero reparte ceros, sin fabricar unidades', () => {
    expect(splitEvenly(0n, 3)).toEqual([0n, 0n, 0n]);
  });
});

/**
 * EL BLOQUEO, que es lo que evita que los ceros de arriba lleguen a
 * proponerse. La pantalla lo consulta antes de dejar enviar.
 */
describe('tooSmallToSplit · menos unidades menores que destinatarios', () => {
  it('0,01 € entre dos NO se puede repartir', () => {
    expect(tooSmallToSplit(1n, 2)).toBe(true);
  });

  it('0,02 € entre tres tampoco', () => {
    expect(tooSmallToSplit(2n, 3)).toBe(true);
  });

  /** Justo en el límite sí: una unidad menor para cada uno. */
  it('0,03 € entre tres sí, y deja a cada uno con un céntimo', () => {
    expect(tooSmallToSplit(3n, 3)).toBe(false);
    expect(splitEvenly(3n, 3)).toEqual([1n, 1n, 1n]);
  });

  it('con un solo destinatario basta una unidad menor', () => {
    expect(tooSmallToSplit(1n, 1)).toBe(false);
  });

  /** Sin nadie marcado no hay reparto que juzgar: lo bloquea otra condición. */
  it('sin destinatarios no dice que sea demasiado pequeño', () => {
    expect(tooSmallToSplit(0n, 0)).toBe(false);
  });

  /**
   * Y el bloqueo es exactamente la frontera del cero: si NO bloquea, nadie
   * sale con una cuota de cero.
   */
  it('cuando no bloquea, nunca queda una cuota a cero', () => {
    for (let total = 1n; total <= 40n; total += 1n) {
      for (const count of [1, 2, 3, 4, 5, 6, 7]) {
        if (tooSmallToSplit(total, count)) continue;
        expect(splitEvenly(total, count).every((s) => s > 0n)).toBe(true);
      }
    }
  });
});
