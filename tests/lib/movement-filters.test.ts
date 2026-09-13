import { describe, expect, it } from 'vitest';

import {
  allOf,
  indexOf,
  isUnrestricted,
  minorAt,
  type MovementFilters,
  RANGE_STEPS,
  sameFilters,
  stepsFor,
} from '../../src/features/groups/movement-filters';

/**
 * EL INTERVALO DE IMPORTE, Y LA FRONTERA ENTRE GEOMETRÍA Y DINERO.
 *
 * Arrastrar un dedo es aproximado; un importe de registro no lo es. Estas
 * pruebas fijan exactamente dónde está esa costura: la barra devuelve
 * posiciones, `minorAt` las convierte en `bigint` exactos, y **los dos extremos
 * son literales** — «desde cero» y «hasta el máximo» no se aproximan nunca.
 */

const EUR_10 = 1000n;

describe('cuántas posiciones tiene la barra', () => {
  /**
   * Hasta mil unidades menores, UNA POSICIÓN POR UNIDAD: en euros eso es cada
   * céntimo hasta 10,00 €, así que cualquier importe se acota exactamente.
   */
  it('una por unidad mientras el recorrido es corto', () => {
    expect(stepsFor(1000n)).toBe(1000);
    expect(stepsFor(250n)).toBe(250);
    expect(stepsFor(1n)).toBe(1);
  });

  it('y mil repartidas cuando es largo', () => {
    expect(stepsFor(1001n)).toBe(RANGE_STEPS);
    expect(stepsFor(9_999_999n)).toBe(RANGE_STEPS);
  });

  /**
   * **Sin recorrido la barra se apaga, y no se inventa uno.** Un grupo sin
   * gastos y un máximo que no se pudo leer llegan los dos aquí, y ninguno de los
   * dos admite un intervalo.
   */
  it('y ninguna cuando no hay recorrido', () => {
    expect(stepsFor(0n)).toBe(0);
    expect(stepsFor(null)).toBe(0);
    expect(stepsFor(-5n)).toBe(0);
  });
});

describe('de posición a importe exacto', () => {
  /** Los dos extremos son LITERALES, nunca el resultado de una división. */
  it('los extremos no se aproximan', () => {
    expect(minorAt(0, EUR_10, 1000)).toBe(0n);
    expect(minorAt(1000, EUR_10, 1000)).toBe(EUR_10);
  });

  it('y con una posición por unidad, cada céntimo es alcanzable', () => {
    expect(minorAt(250, EUR_10, 1000)).toBe(250n);
    expect(minorAt(999, EUR_10, 1000)).toBe(999n);
  });

  /**
   * Con un recorrido largo la barra deja de poder señalar cualquier céntimo:
   * es una limitación de la GEOMETRÍA y no del dato. Lo que sale sigue siendo un
   * `bigint` exacto, calculado con división entera y sin coma flotante.
   */
  it('con recorrido largo el paso es mayor, y el resultado sigue siendo exacto', () => {
    const max = 1_234_567n;
    expect(minorAt(0, max, RANGE_STEPS)).toBe(0n);
    expect(minorAt(RANGE_STEPS, max, RANGE_STEPS)).toBe(max);
    expect(minorAt(500, max, RANGE_STEPS)).toBe((max * 500n) / 1000n);
    // Un `bigint`, nunca un `number`: el importe no pasa por coma flotante.
    expect(typeof minorAt(500, max, RANGE_STEPS)).toBe('bigint');
  });

  it('y una posición fuera de rango se recorta en vez de extrapolar', () => {
    expect(minorAt(-40, EUR_10, 1000)).toBe(0n);
    expect(minorAt(4000, EUR_10, 1000)).toBe(EUR_10);
  });

  it('sin recorrido devuelve cero y no lanza', () => {
    expect(minorAt(7, 0n, 0)).toBe(0n);
    expect(minorAt(7, EUR_10, 0)).toBe(0n);
  });
});

describe('y de importe a posición, sólo para dibujar', () => {
  it('los extremos se anclan, para que un intervalo completo se vea completo', () => {
    expect(indexOf(0n, EUR_10, 1000)).toBe(0);
    expect(indexOf(EUR_10, EUR_10, 1000)).toBe(1000);
    expect(indexOf(99_999n, EUR_10, 1000)).toBe(1000);
  });

  it('y la ida y la vuelta se conservan cuando hay una posición por unidad', () => {
    for (const minor of [0n, 1n, 250n, 999n, 1000n]) {
      expect(minorAt(indexOf(minor, EUR_10, 1000), EUR_10, 1000)).toBe(minor);
    }
  });
});

describe('¿esta selección esconde algo?', () => {
  const base = allOf();

  it('el intervalo entero y las dos listas completas, no', () => {
    expect(isUnrestricted(base, EUR_10)).toBe(true);
  });

  /**
   * Se pregunta por el EFECTO, no por si alguien tocó algo: mover un extremo y
   * devolverlo a su sitio no deja ningún gasto fuera, así que el embudo no debe
   * decir que sí.
   */
  it('pero subir el mínimo o bajar el máximo, sí', () => {
    expect(isUnrestricted({ ...base, minMinor: 1n }, EUR_10)).toBe(false);
    expect(isUnrestricted({ ...base, maxMinor: 999n }, EUR_10)).toBe(false);
  });

  it('y elegir una categoría o un pagador, también', () => {
    expect(isUnrestricted({ ...base, categoryId: 'c' }, EUR_10)).toBe(false);
    expect(isUnrestricted({ ...base, payerId: 'p' }, EUR_10)).toBe(false);
  });

  /**
   * **Sin máximo leído no hay restricción de importe que afirmar.** «Hasta el
   * tope» sólo se sabe sabiendo cuál es el tope; decir que hay filtro puesto
   * porque el tope todavía es cero encendería el embudo sobre nada.
   */
  it('y un tope puesto sin máximo leído NO se puede afirmar como «todo»', () => {
    expect(isUnrestricted(allOf(), null)).toBe(true);
    expect(isUnrestricted({ ...allOf(), categoryId: 'c' }, null)).toBe(false);
    /* Con tope pero sin saber cuál es el máximo, no hay forma de decir que no
     * deja nada fuera: se responde que sí restringe, que es lo prudente. */
    expect(isUnrestricted({ ...allOf(), maxMinor: 500n }, null)).toBe(false);
  });

  it('un tope por encima del máximo sigue siendo «todo»', () => {
    expect(isUnrestricted({ ...base, maxMinor: EUR_10 * 2n }, EUR_10)).toBe(true);
  });
});

describe('sin restricción', () => {
  /**
   * **«Sin tope» es `null`, y no el máximo del grupo.** No necesita saber cuál
   * es el máximo, que es la mitad de la gracia: «enseñarlo todo» se puede
   * afirmar antes de haber leído nada del servidor, y no cambia de significado
   * cuando el máximo llega. Con un tope de cero, el embudo se encendía al
   * entrar al grupo sin que nadie hubiera filtrado nada — medido en el
   * emulador.
   */
  it('arranca sin tope y sin categoría ni persona', () => {
    expect(allOf()).toEqual<MovementFilters>({
      minMinor: 0n,
      maxMinor: null,
      categoryId: null,
      payerId: null,
    });
  });

  /** Y por eso vale igual con máximo conocido y sin él. */
  it('y equivale a «todo» se sepa o no el máximo', () => {
    expect(isUnrestricted(allOf(), EUR_10)).toBe(true);
    expect(isUnrestricted(allOf(), null)).toBe(true);
  });
});

describe('si el borrador está tocado', () => {
  const base = allOf();

  it('lo mismo es lo mismo', () => {
    expect(sameFilters(base, allOf())).toBe(true);
  });

  it('y cualquiera de los cuatro campos lo cambia', () => {
    expect(sameFilters(base, { ...base, minMinor: 1n })).toBe(false);
    expect(sameFilters(base, { ...base, maxMinor: 1n })).toBe(false);
    expect(sameFilters(base, { ...base, categoryId: 'c' })).toBe(false);
    expect(sameFilters(base, { ...base, payerId: 'p' })).toBe(false);
  });
});
