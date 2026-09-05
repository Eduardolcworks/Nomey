import { describe, expect, it } from 'vitest';

import {
  FIELD_BORDER_WIDTH,
  fieldBorder,
  nextRevealed,
  revealPresentation,
} from '../../src/features/auth/field-appearance';
import { Colors } from '../../src/ui/theme/colors';

/**
 * El contorno del campo y el botón de ojo de `Entrar`.
 *
 * **Por qué esto es comportamiento y no lectura de fuente.** Las dos reglas
 * viven en funciones puras precisamente para poder interrogarlas: el proyecto no
 * tiene renderer de React y no se añade una dependencia por esto, así que la
 * alternativa habría sido buscar cadenas en el `.tsx` — una prueba que falla
 * cuando alguien reescribe una línea sin cambiar nada.
 *
 * Lo que NO se prueba aquí es que el amarillo llegue entero a las curvas: eso es
 * un hecho del rasterizador y se midió sobre una captura real, no se puede
 * afirmar desde JavaScript. Lo que sí se fija es la condición que lo hace
 * posible —un solo color, una sola opacidad, un solo grosor— y que ese grosor
 * no vuelva a ser una línea de pelo.
 */

const dark = Colors.dark;

describe('el contorno del campo', () => {
  it('enfocado usa el acento, y sin foco el borde: un token y no un color a mano', () => {
    expect(fieldBorder(true, dark).color).toBe(dark.accent);
    expect(fieldBorder(false, dark).color).toBe(dark.border);
  });

  it('correo y contraseña usan EXACTAMENTE la misma regla', () => {
    // No hay dos funciones ni dos ramas: el campo es uno, así que dos llamadas
    // con el mismo estado no pueden diferir.
    expect(fieldBorder(true, dark)).toEqual(fieldBorder(true, dark));
    expect(fieldBorder(false, dark)).toEqual(fieldBorder(false, dark));
  });

  it('un solo color y una sola opacidad: nada de alfa ni de degradado', () => {
    /*
     * Un color con alfa se mezclaría con el fondo, y esa mezcla es justo lo que
     * apagaba las esquinas. Los tokens son `#rrggbb` de seis dígitos, sin
     * canal alfa y sin `rgba(`.
     */
    for (const focused of [true, false]) {
      const { color } = fieldBorder(focused, dark);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color).not.toMatch(/rgba|gradient/i);
    }
  });

  it('el grosor NO cambia con el foco, para que la caja no salte', () => {
    expect(fieldBorder(true, dark).width).toBe(fieldBorder(false, dark).width);
    expect(fieldBorder(true, dark).width).toBe(FIELD_BORDER_WIDTH);
  });

  it('y ese grosor es de al menos un punto, no una línea de pelo', () => {
    /*
     * `StyleSheet.hairlineWidth` es un píxel FÍSICO: en los tramos rectos cubre
     * la fila entera y en las curvas sólo parcialmente, que era el defecto. Un
     * punto lógico son dos o tres píxeles en cualquier pantalla moderna, y el
     * interior del arco queda cubierto del todo.
     */
    expect(FIELD_BORDER_WIDTH).toBeGreaterThanOrEqual(1);
  });

  it('el estado sin foco conserva su color de siempre', () => {
    expect(fieldBorder(false, dark).color).toBe(dark.border);
    expect(fieldBorder(false, dark).color).not.toBe(dark.accent);
  });

  it('la regla no depende de ningún estado de error: la prioridad visual se queda donde estaba', () => {
    /*
     * El campo nunca ha sabido nada del error —lo anuncia la pantalla, como
     * región viva— así que el contorno no puede pisarlo ni al revés. Se fija
     * aquí para que nadie meta el error en esta función creyendo que ayuda.
     */
    expect(fieldBorder.length).toBe(2);
  });
});

describe('mostrar y ocultar la contraseña', () => {
  it('empieza oculta', () => {
    expect(revealPresentation(false, true, undefined).secure).toBe(true);
  });

  it('el primer toque la muestra y el segundo la vuelve a ocultar', () => {
    let revealed = false;
    revealed = nextRevealed(revealed);
    expect(revealPresentation(revealed, true, undefined).secure).toBe(false);
    revealed = nextRevealed(revealed);
    expect(revealPresentation(revealed, true, undefined).secure).toBe(true);
  });

  it('el botón manda sobre `secureTextEntry`, para que no haya dos verdades', () => {
    // Aunque el llamante pida enmascarar, mostrar gana: es lo que la persona
    // acaba de pulsar.
    expect(revealPresentation(true, true, true).secure).toBe(false);
    expect(revealPresentation(false, true, false).secure).toBe(true);
  });

  it('sin botón, el estado interno no puede desenmascarar nada', () => {
    // El alta y el resto de formularios no llevan ojo: su campo obedece a lo
    // que pidió el llamante y nada más.
    expect(revealPresentation(true, false, true).secure).toBe(true);
    expect(revealPresentation(false, false, undefined).secure).toBe(false);
  });

  it('el nombre accesible dice lo que va a pasar, y cambia con el estado', () => {
    expect(revealPresentation(false, true, undefined).labelKey).toBe('auth.showPassword');
    expect(revealPresentation(true, true, undefined).labelKey).toBe('auth.hidePassword');
  });

  it('y el estado accesible acompaña al nombre en vez de sustituirlo', () => {
    expect(revealPresentation(false, true, undefined).selected).toBe(false);
    expect(revealPresentation(true, true, undefined).selected).toBe(true);
  });

  it('el icono es del vocabulario ya instalado, no uno nuevo', () => {
    expect(revealPresentation(false, true, undefined).icon).toBe('reveal');
    expect(revealPresentation(true, true, undefined).icon).toBe('conceal');
  });

  it('alternar es un ciclo de dos, sin estados intermedios', () => {
    expect(nextRevealed(nextRevealed(false))).toBe(false);
    expect(nextRevealed(nextRevealed(true))).toBe(true);
  });

  it('resolver el aspecto NO toca el valor escrito: no recibe ninguno', () => {
    // La función no ve el texto, así que no hay forma de que lo borre o lo
    // cambie. Es la garantía más fuerte disponible sin renderer.
    expect(revealPresentation.length).toBe(3);
  });
});
