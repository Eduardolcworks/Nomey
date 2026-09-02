import { describe, expect, it } from 'vitest';

import type { BoxShadowValue } from 'react-native';

import {
  RimBlurAndroid,
  RimBlurIOS,
  TactileAndroid,
  TactileIOS,
} from '../../src/ui/theme/elevation';

/** Ensancha los literales del token a su tipo declarado. */
const capas = (x: readonly unknown[]): readonly BoxShadowValue[] => x as readonly BoxShadowValue[];

/**
 * LA CALIBRACIÓN DE ANDROID, COMPROBADA COMO ESTRUCTURA.
 *
 * **Esto no afirma que las dos plataformas se vean igual.** No puede: la
 * paridad visual sólo se valida en un aparato. Lo que se fija aquí es lo
 * comprobable — que Android tiene su propia calibración, que es de las mismas
 * capas y con el mismo papel, que iOS conserva EXACTAMENTE sus valores, y que
 * la de Android es más discreta en todo lo que producía los anillos negros.
 */

/** Suma de opacidades de un estado, como medida de cuánto pesa. */
function peso(lista: readonly BoxShadowValue[]): number {
  return lista.reduce((total, capa) => {
    const alfa = /rgba\([^)]*,\s*([\d.]+)\)/.exec(String(capa.color))?.[1];
    return total + Number(alfa ?? '1');
  }, 0);
}

const ESTADOS = ['raised', 'selected', 'pressed', 'well'] as const;

describe('los tokens aprobados de iOS', () => {
  /**
   * **Son la referencia, y no se tocan.** Se midieron sobre el iPhone; Android
   * se parece a ellos, no al revés. Fijarlos aquí es lo que hace que calibrar
   * Android no pueda arrastrarlos.
   */
  it.each([
    ['raised', -10, 14, 0.45, 8, 20, 0.65],
    ['selected', -12, 16, 0.38, 10, 26, 0.75],
    ['well', 5, 8, 0.5, 2, 6, 0.35],
  ] as const)('%s conserva sus valores exactos', (estado, y1, b1, a1, y2, b2, a2) => {
    const [dentro, fuera] = TactileIOS[estado];
    expect(dentro.offsetY).toBe(y1);
    expect(dentro.blurRadius).toBe(b1);
    expect(dentro.color).toBe(`rgba(0, 0, 0, ${a1 === 0.5 ? '0.50' : a1})`);
    expect(dentro.inset).toBe(true);
    expect(fuera.offsetY).toBe(y2);
    expect(fuera.blurRadius).toBe(b2);
    expect(fuera.color).toBe(`rgba(0, 0, 0, ${a2})`);
  });

  it('el rim de iOS sigue sin difuminar', () => {
    expect(RimBlurIOS.catch).toBe(0);
    expect(RimBlurIOS.soft).toBe(4);
  });
});

describe('la calibración de Android', () => {
  /**
   * Android cubre TODOS los estados de iOS, y encima uno más.
   *
   * `disabled` es exclusivo de Android: darle una entrada a `TactileIOS` habría
   * descongelado su token para una variante que iOS no usa, porque allí lo
   * deshabilitado se dice con la opacidad de quien llama.
   */
  it('cubre los estados de iOS, y añade disabled', () => {
    for (const estado of ESTADOS) expect(Object.keys(TactileAndroid)).toContain(estado);
    expect(Object.keys(TactileAndroid).sort()).toEqual([...ESTADOS, 'disabled'].sort());
  });

  /**
   * **LAS DOS FUNCIONES EXISTEN EN ANDROID, y ésa es la corrección.**
   *
   * Quitarle el relieve interior dejaba el material plano. Lo que Android no
   * sabe hacer es FUNDIR varias sombras sobre la misma vista —las apila, y de
   * ahí el anillo negro—, así que las dos capas siguen estando y se reparten en
   * vistas distintas. Quién las reparte es `GlassSurface`; aquí sólo se fija
   * que el token conserve ambas.
   */
  it.each(ESTADOS)('%s conserva su capa interior', (estado) => {
    expect(capas(TactileAndroid[estado]).filter((c) => c.inset === true).length).toBeGreaterThan(0);
  });

  /**
   * **QUIÉN PROYECTA, MEDIDO SOBRE EL APARATO Y NO DEDUCIDO DE iOS.**
   *
   * Se probó a darle a cada estado la misma pareja de capas que en iOS y el
   * resultado, capturado por ADB, fue una placa negra bajo cada control de la
   * ventana: una segunda píldora bajo el selector, una plancha bajo Concepto y
   * siluetas sueltas bajo moneda, categoría y calendario. Con el `cast`
   * desactivado desaparecían todas — ése fue el paso A del diagnóstico.
   *
   * De ahí la regla: **sólo proyecta lo que está por encima del panel.** Un
   * control hundido (`well`) o sostenido (`pressed`) no arroja sombra, y decirlo
   * aquí impide que alguien «restaure la simetría» con iOS y traiga las placas
   * de vuelta.
   */
  const PROYECTAN = ['raised', 'selected'] as const;
  const NO_PROYECTAN = ['pressed', 'well'] as const;

  it.each(PROYECTAN)('%s proyecta exactamente una vez', (estado) => {
    expect(capas(TactileAndroid[estado]).filter((c) => c.inset !== true)).toHaveLength(1);
  });

  it.each(NO_PROYECTAN)('%s no proyecta nada', (estado) => {
    expect(capas(TactileAndroid[estado]).every((c) => c.inset === true)).toBe(true);
  });

  /** El pulsado sigue sin proyectar: sus dos capas van hacia dentro. */
  it('pulsado no proyecta', () => {
    expect(capas(TactileAndroid.pressed).every((c) => c.inset === true)).toBe(true);
  });

  /**
   * **Y pesa menos en todos los estados**, que es la corrección: con los
   * valores de iOS, Android dibujaba anillos negros y sombras del doble.
   */
  it.each(ESTADOS)('%s es más discreto que el de iOS', (estado) => {
    expect(peso(capas(TactileAndroid[estado]))).toBeLessThan(peso(capas(TactileIOS[estado])));
  });

  /** La jerarquía se mantiene: elegido pesa más que en reposo, hundido menos. */
  it('conserva la jerarquía entre estados', () => {
    expect(peso(capas(TactileAndroid.selected))).toBeGreaterThan(peso(capas(TactileAndroid.well)));
    expect(peso(capas(TactileAndroid.raised))).toBeGreaterThan(peso(capas(TactileAndroid.well)));
  });

  /** Y el rim deja de ser una línea dura sin dejar de ser luz. */
  it('el rim de Android se difumina lo justo', () => {
    expect(RimBlurAndroid.catch).toBeGreaterThan(RimBlurIOS.catch);
    expect(RimBlurAndroid.catch).toBeLessThan(RimBlurAndroid.soft);
    expect(RimBlurAndroid.soft).toBe(RimBlurIOS.soft);
  });

  /** Ningún desplazamiento de Android supera al de iOS: sombras más cortas. */
  it.each(ESTADOS)('%s no proyecta más lejos que iOS', (estado) => {
    const maxIOS = Math.max(
      ...capas(TactileIOS[estado]).map((c) => Math.abs(Number(c.offsetY ?? 0))),
    );
    const maxAnd = Math.max(
      ...capas(TactileAndroid[estado]).map((c) => Math.abs(Number(c.offsetY ?? 0))),
    );
    expect(maxAnd).toBeLessThanOrEqual(maxIOS);
  });
});
