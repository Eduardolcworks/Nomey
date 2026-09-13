import { describe, expect, it } from 'vitest';

import { currencyDefinition, money } from '../../src/domain';
import {
  GROUP_EXPENSE_SHARES,
  GROUP_EXPENSE_TOTALS,
  GROUP_MOVEMENTS,
  groupAmount,
  groupSummary,
} from '../../src/features/groups/group-summary';
import { formatMoney } from '../../src/lib/format/money';
import { formatLocale } from '../../src/lib/i18n/locales';

/**
 * LAS TRES CIFRAS DE LA CABECERA DE UN GRUPO.
 *
 * Lo que se protege aquí es que sigan siendo tres preguntas distintas y que
 * ninguna de ellas pueda afirmar un cero que no ha derivado.
 */

const ES = formatLocale('es-ES');
const plano = (texto: string) => texto.replace(/[   ]/g, ' ');

const EUR = currencyDefinition({ id: 'eur', code: 'EUR', scale: 2 });
const JPY = currencyDefinition({ id: 'jpy', code: 'JPY', scale: 0 });
const BHD = currencyDefinition({ id: 'bhd', code: 'BHD', scale: 3 });

describe('la suma de una magnitud del grupo', () => {
  it('suma exacto, y sin pasar por coma flotante', () => {
    expect(groupAmount(['2500', '4000', '1'])).toEqual({ kind: 'amount', minor: 6501n });
    expect(groupAmount(['9007199254740993'])).toEqual({
      kind: 'amount',
      minor: 9007199254740993n,
    });
  });

  it('vacía es cero de verdad; ausente es NO DISPONIBLE', () => {
    expect(groupAmount([])).toEqual({ kind: 'amount', minor: 0n });
    expect(groupAmount(null)).toEqual({ kind: 'unavailable' });
    expect(groupAmount(undefined)).toEqual({ kind: 'unavailable' });
  });

  it('y un solo importe ilegible tumba la cifra entera', () => {
    expect(groupAmount(['2500', 'doce'])).toEqual({ kind: 'unavailable' });
    expect(groupAmount(['2500', '25.00'])).toEqual({ kind: 'unavailable' });
    expect(groupAmount([''])).toEqual({ kind: 'unavailable' });
    expect(groupAmount(['   '])).toEqual({ kind: 'unavailable' });
  });
});

describe('el resumen de hoy', () => {
  const SALDADO = { kind: 'net', minor: 0n } as const;

  it('las tres cifras son cero, y por ausencia real', () => {
    expect(GROUP_EXPENSE_SHARES).toEqual([]);
    expect(GROUP_EXPENSE_TOTALS).toEqual([]);
    expect(groupSummary(SALDADO)).toEqual({
      position: { kind: 'net', minor: 0n },
      youSpent: { kind: 'amount', minor: 0n },
      total: { kind: 'amount', minor: 0n },
    });
  });

  it('la posición NO se recalcula: llega de la proyección tal cual', () => {
    /*
     * Es la misma que pinta la tarjeta de la lista. Recalcularla aquí sería una
     * segunda respuesta a la misma pregunta, y las dos podrían discrepar.
     */
    const posicion = { kind: 'net', minor: -1234n } as const;
    expect(groupSummary(posicion).position).toBe(posicion);
  });

  it('y las tres son independientes: un ledger ilegible no contamina a las otras', () => {
    const resumen = groupSummary(SALDADO, ['roto'], ['5000']);
    expect(resumen.youSpent).toEqual({ kind: 'unavailable' });
    expect(resumen.total).toEqual({ kind: 'amount', minor: 5000n });
    expect(resumen.position).toEqual({ kind: 'net', minor: 0n });
  });

  it('un grupo con operaciones no interpretables NO se declara saldado', () => {
    const resumen = groupSummary({ kind: 'unavailable' }, null, null);
    expect(resumen.position.kind).toBe('unavailable');
    expect(resumen.youSpent.kind).toBe('unavailable');
    expect(resumen.total.kind).toBe('unavailable');
  });
});

describe('«Tú gastaste» es MI PARTE, no lo que adelanté', () => {
  it('el ejemplo canónico: pago 100 para cuatro, y gasté 25', () => {
    /*
     * `AGENTS.md` §2: movimiento de caja, gasto económico y deuda son tres
     * hechos distintos del mismo gasto. Quien paga adelanta 100 —caja—, consume
     * 25 —económico— y queda con +75 a favor —deuda—. La tarjeta enseña la
     * segunda cifra en `Tú gastaste` y la tercera en la posición.
     */
    const miParte = groupAmount(['2500']);
    const total = groupAmount(['10000']);
    const posicion = { kind: 'net', minor: 7500n } as const;

    const resumen = groupSummary(posicion, ['2500'], ['10000']);
    expect(resumen.youSpent).toEqual(miParte);
    expect(resumen.total).toEqual(total);
    expect(resumen.position).toEqual(posicion);

    // Y las tres son distintas: ninguna es sustituto de otra.
    const valores = [2500n, 10000n, 7500n];
    expect(new Set(valores).size).toBe(3);
  });
});

describe('las tres cifras en la divisa base del grupo', () => {
  it('respetan su escala: EUR 2, JPY 0, BHD 3', () => {
    expect(plano(formatMoney(money(0n, EUR), ES))).toBe('0,00 €');
    expect(plano(formatMoney(money(0n, JPY), ES))).toBe('0 JPY');
    expect(plano(formatMoney(money(0n, BHD), ES))).toBe('0,000 BHD');
  });

  it('y un importe largo sigue siendo exacto en las tres', () => {
    expect(plano(formatMoney(money(123456789n, EUR), ES))).toBe('1.234.567,89 €');
    expect(plano(formatMoney(money(123456789n, JPY), ES))).toBe('123.456.789 JPY');
    expect(plano(formatMoney(money(123456789n, BHD), ES))).toBe('123.456,789 BHD');
  });
});

describe('los contratos del listado futuro', () => {
  /**
   * **El de SALDOS ya no está**, y esa es la afirmación: `GROUP_BALANCES`
   * declaraba una colección vacía «por estructura» mientras nada sabía derivar
   * las posiciones. `api.group_balance` las publica, así que el marcador se
   * retiró en vez de quedarse al lado — dos formas de responder «cuánto debe
   * cada uno» son dos verdades que pueden discrepar.
   */
  it('el de movimientos sigue declarado y vacío; el de saldos ya no existe', async () => {
    expect(GROUP_MOVEMENTS).toEqual([]);
    const modulo = await import('../../src/features/groups/group-summary');
    expect(Object.keys(modulo)).not.toContain('GROUP_BALANCES');
  });

  it('y su forma admite lo que la lista necesitará, sin inventar el modelo', () => {
    /*
     * No se implementa el gasto compartido: se fija la forma mínima para que la
     * lista pueda existir sin rehacerse. `amountMinor` es el importe del gasto,
     * no la parte de quien mira — son dos cifras distintas.
     */
    const movimiento = {
      operationId: '11111111-1111-4111-8111-111111111111',
      concept: 'Cena',
      payerName: 'Ana',
      amountMinor: 8640n,
      effectiveDate: '2026-09-07',
    };
    expect([...GROUP_MOVEMENTS, movimiento]).toHaveLength(1);
  });
});
