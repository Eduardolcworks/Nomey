import { describe, expect, it } from 'vitest';

import { glassEdgeStyle } from '../../src/ui/components/glass-pressable-style';
import { Colors } from '../../src/ui/theme/colors';

/**
 * EL BORDE DE LA OPCIÓN ELEGIDA («¿Cómo quieres empezar tu Modo Personal?»).
 *
 * Regla visual: la no seleccionada conserva el borde del material; la
 * seleccionada lleva el rim con EL amarillo oficial (`accent`). Nada más
 * cambia — ni fondo, ni texto, ni tamaño — y el estado accesible sigue
 * saliendo de `selected`, no del color.
 */
describe('el borde de un GlassPressable', () => {
  it('sin `edge` no añade nada: el borde es el del material', () => {
    expect(glassEdgeStyle(undefined, Colors.dark.accent)).toBeNull();
  });

  it("con `edge = 'accent'` el borde es el amarillo oficial, de un píxel", () => {
    const style = glassEdgeStyle('accent', Colors.dark.accent);
    expect(style).toEqual({ borderWidth: 1, borderColor: Colors.dark.accent });
    // Y es el mismo token que los CTA, no un amarillo propio.
    expect(Colors.dark.accent).toBe('#FDC506');
  });

  it('sólo toca el borde: ni fondo, ni opacidad, ni medidas', () => {
    const style = glassEdgeStyle('accent', Colors.dark.accent);
    expect(Object.keys(style ?? {}).sort()).toEqual(['borderColor', 'borderWidth']);
  });
});
