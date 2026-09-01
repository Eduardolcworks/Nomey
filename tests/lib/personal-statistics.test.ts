import { describe, expect, it } from 'vitest';

import {
  categorySlices,
  sliceAngles,
  splitTop,
  type StatisticsCategory,
  toMinor,
  TOP_CATEGORIES,
} from '../../src/features/personal/statistics';

const category = (id: string, total: string, count = 1): StatisticsCategory => ({
  category_id: id,
  expense_total: total,
  operation_count: count,
});

describe('toMinor', () => {
  /**
   * `BigInt` y nunca `Number`. ADR-008 §1 hace que los importes crucen como
   * texto precisamente para que nadie los pase por un `double`, y E11 midió que
   * un `int8` por encima de 2^53 se degrada en silencio al parsearse.
   */
  it('conserva importes por encima de 2^53', () => {
    const huge = '9007199254740993'; // 2^53 + 1
    expect(toMinor(huge)).toBe(9007199254740993n);
    expect(toMinor(huge).toString()).toBe(huge);
    // La prueba de que hacía falta: por el camino de `number` se pierde.
    expect(String(Number(huge))).not.toBe(huge);
  });

  it('acepta el signo negativo, que un ajuste por delta puede llevar', () => {
    expect(toMinor('-700')).toBe(-700n);
  });

  it('un texto ilegible vale cero y no revienta la pantalla', () => {
    expect(toMinor('x')).toBe(0n);
    expect(toMinor(null)).toBe(0n);
    expect(toMinor(undefined)).toBe(0n);
  });
});

describe('categorySlices', () => {
  const categories = [
    category('a', '6000', 3),
    category('b', '4000'),
    category('c', '2000', 2),
    category('d', '100'),
    category('e', '50'),
  ];

  it('calcula la cuota de cada categoría sobre el total', () => {
    const slices = categorySlices(categories, '12150');

    expect(slices).toHaveLength(5);
    expect(slices[0]).toMatchObject({ categoryId: 'a', expenseMinor: 6000n, operationCount: 3 });
    expect(slices[0].share).toBeCloseTo(6000 / 12150, 10);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 10);
  });

  it('conserva el orden que llega del servidor y no vuelve a ordenar', () => {
    // El servidor ya devuelve de mayor a menor con desempate por identificador.
    // Reordenar aquí sería una segunda opinión sobre el mismo dato.
    const shuffled = [category('z', '1'), category('y', '9')];
    expect(categorySlices(shuffled, '10').map((slice) => slice.categoryId)).toEqual(['z', 'y']);
  });

  /**
   * El caso `expense_total = 0`, definido y sin porcentajes inventados.
   *
   * Es el estado normal de un intervalo sin gastos, no un caso defensivo
   * abstracto: dividir ahí daría `NaN`, que React pinta como texto vacío o como
   * `NaN%` según dónde caiga.
   */
  it('con total cero no produce ninguna porción', () => {
    expect(categorySlices(categories, '0')).toEqual([]);
    expect(categorySlices([], '0')).toEqual([]);
  });

  it('un total negativo tampoco produce porciones', () => {
    expect(categorySlices(categories, '-100')).toEqual([]);
  });
});

describe('splitTop', () => {
  const slices = categorySlices(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => category(id, '100')),
    '600',
  );

  it('deja cuatro a la vista y el resto detrás del desplegable', () => {
    const { top, rest } = splitTop(slices);
    expect(TOP_CATEGORIES).toBe(4);
    expect(top.map((slice) => slice.categoryId)).toEqual(['a', 'b', 'c', 'd']);
    expect(rest.map((slice) => slice.categoryId)).toEqual(['e', 'f']);
  });

  it('con cuatro o menos no queda resto que desplegar', () => {
    const { top, rest } = splitTop(slices.slice(0, 3));
    expect(top).toHaveLength(3);
    expect(rest).toEqual([]);
  });
});

describe('sliceAngles', () => {
  it('reparte los 360 grados en proporción a las cuotas', () => {
    const angles = sliceAngles(categorySlices([category('a', '3'), category('b', '1')], '4'));

    expect(angles[0].start).toBe(0);
    expect(angles[0].sweep).toBeCloseTo(270, 6);
    expect(angles[1].start).toBeCloseTo(270, 6);
  });

  /**
   * El círculo cierra EXACTAMENTE.
   *
   * Multiplicar cada cuota por 360 e ir sumando deja una rendija visible cuando
   * los redondeos no cuadran; el último sector se estira hasta 360 a propósito.
   */
  it('el último sector cierra el círculo sin dejar rendija', () => {
    const thirds = categorySlices(
      [category('a', '1'), category('b', '1'), category('c', '1')],
      '3',
    );
    const angles = sliceAngles(thirds);
    const last = angles[angles.length - 1];

    expect(last.start + last.sweep).toBe(360);
  });

  it('una sola categoría ocupa el círculo entero', () => {
    const angles = sliceAngles(categorySlices([category('a', '10')], '10'));
    expect(angles).toEqual([{ start: 0, sweep: 360 }]);
  });

  it('sin categorías no hay sectores', () => {
    expect(sliceAngles([])).toEqual([]);
  });
});
