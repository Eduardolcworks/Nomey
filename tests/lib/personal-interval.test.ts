import { describe, expect, it } from 'vitest';

import {
  INITIAL_INTERVAL,
  INTERVALS,
  rangeKey,
  resolveInterval,
  todayInDeviceCalendar,
} from '../../src/features/personal/interval';
import type { CalendarDate } from '../../src/lib/format';

/**
 * El intervalo que gobierna Inicio.
 *
 * Lo que se comprueba aquí no es aritmética de fechas por gusto: es que la
 * semántica que ADR-020 §3 fija —`effective_date` como eje de agrupación, y la
 * hora como reloj de pared que sólo ordena dentro del día— llega intacta a la
 * consulta. Un error de un día en un límite mueve movimientos de mes sin que
 * nada falle.
 */
describe('resolveInterval', () => {
  const today = '2026-08-29' as CalendarDate;

  it('«Día» es un intervalo cerrado de un solo día', () => {
    expect(resolveInterval('day', today)).toEqual({ from: '2026-08-29', to: '2026-08-29' });
  });

  it('«Mes» va del primero al último día, ambos incluidos', () => {
    expect(resolveInterval('month', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('«Año» va del 1 de enero al 31 de diciembre', () => {
    expect(resolveInterval('year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('«Todo» no pone ningún límite', () => {
    expect(resolveInterval('all', today)).toEqual({ from: null, to: null });
  });

  /**
   * El último día lo calcula la aritmética de calendario, no una tabla.
   *
   * Febrero es el caso que delata una tabla escrita a mano, y el bisiesto el que
   * delata una tabla escrita a mano *con* excepción.
   */
  it.each([
    ['2026-02-10', '2026-02-28'],
    ['2028-02-10', '2028-02-29'],
    ['2026-04-10', '2026-04-30'],
    ['2026-12-31', '2026-12-31'],
    ['2026-01-01', '2026-01-31'],
  ])('el mes de %s termina el %s', (day, last) => {
    expect(resolveInterval('month', day as CalendarDate).to).toBe(last);
  });

  it('los meses y días de un dígito llevan cero delante', () => {
    expect(resolveInterval('day', '2026-01-05' as CalendarDate)).toEqual({
      from: '2026-01-05',
      to: '2026-01-05',
    });
  });

  /**
   * Una fecha ilegible degrada a `Todo`, que muestra de más y nunca de menos.
   * Inventar un intervalo a partir de una fecha rota escondería movimientos.
   */
  it('una fecha ilegible no produce un intervalo inventado', () => {
    expect(resolveInterval('month', 'no-es-una-fecha' as CalendarDate)).toEqual({
      from: null,
      to: null,
    });
  });

  it('el selector abre en el mes', () => {
    expect(INITIAL_INTERVAL).toBe('month');
    expect(INTERVALS).toEqual(['day', 'month', 'year', 'all']);
  });
});

describe('todayInDeviceCalendar', () => {
  /**
   * **La fecha es la del calendario LOCAL, no la de UTC**, y es la decisión que
   * más caro sale equivocar: `effective_date` no lleva zona y el par
   * fecha+hora es un reloj de pared (ADR-020 §3). Un movimiento registrado a
   * las 23:00 en Madrid es del día 29 para su dueño, y en UTC ya es el 30.
   *
   * El instante elegido lo demuestra: 22:30 UTC del 29 es 00:30 del 30 en
   * Madrid. Quien lee esta fecha en UTC pierde el día.
   */
  it('usa el calendario local del dispositivo y no el de UTC', () => {
    const instant = new Date('2026-08-29T22:30:00Z');
    const local = todayInDeviceCalendar(instant);

    const utc = `${instant.getUTCFullYear()}-08-${instant.getUTCDate()}`;
    const expected = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(
      instant.getDate(),
    ).padStart(2, '0')}`;

    expect(local).toBe(expected);
    // Y se afirma la forma, para que el test siga valiendo en cualquier zona.
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utc).toMatch(/^\d{4}-\d{2}-\d+$/);
  });

  it('rellena mes y día a dos dígitos', () => {
    expect(todayInDeviceCalendar(new Date(2026, 0, 3, 12, 0, 0))).toBe('2026-01-03');
  });
});

describe('rangeKey', () => {
  it('distingue intervalos distintos y repite el mismo', () => {
    const august = resolveInterval('month', '2026-08-29' as CalendarDate);
    const september = resolveInterval('month', '2026-09-01' as CalendarDate);

    expect(rangeKey(august)).toBe(rangeKey(resolveInterval('month', '2026-08-01' as CalendarDate)));
    expect(rangeKey(august)).not.toBe(rangeKey(september));
  });

  it('«Todo» tiene su propia clave y no se confunde con un intervalo real', () => {
    expect(rangeKey({ from: null, to: null })).not.toBe(
      rangeKey(resolveInterval('year', '2026-08-29' as CalendarDate)),
    );
  });
});
