import { describe, expect, it } from 'vitest';

import { actionSurface, tactileState } from '../../src/ui/components/action-button-style';
import { Colors } from '../../src/ui/theme/colors';

/**
 * COMO SE PINTA UN ActionButton, ejecutado de verdad con los tokens reales.
 *
 * Es la decision que el componente aplica en su `style` y en su texto, sacada
 * a una funcion pura para poder afirmarla sin renderer. Lo que fija: que
 * `brand` deshabilitado es GRIS y apagado, que `brand` habilitado es EL
 * amarillo, y que `primary` nunca fue amarillo — la causa de que dos CTA que
 * decian `tone="primary"` se vieran grises en el telefono.
 */
const theme = Colors.dark;
const light = Colors.light;

describe('brand: gris apagado hasta que se puede pulsar, amarillo entonces', () => {
  it('deshabilitado (formulario incompleto): superficie neutra, texto deshabilitado, media opacidad', () => {
    const s = actionSurface({
      tone: 'brand',
      disabled: true,
      pressed: false,
      neutral: false,
      theme,
    });
    expect(s.backgroundColor).toBe(theme.surface);
    expect(s.backgroundColor).not.toBe(theme.accent);
    expect(s.textColor).toBe('textDisabled');
    expect(s.opacity).toBe(0.5);
    expect(s.depth).toBeNull();
  });

  it('habilitado (ready === true): el amarillo de marca, opaco, con el texto sobre acento', () => {
    const s = actionSurface({
      tone: 'brand',
      disabled: false,
      pressed: false,
      neutral: false,
      theme,
    });
    expect(s.backgroundColor).toBe(theme.accent);
    expect(s.textColor).toBe('onAccent');
    expect(s.opacity).toBe(1);
    expect(s.borderColor).toBe('transparent');
    // Nada del estado deshabilitado se queda pegado al habilitar.
    const off = actionSurface({
      tone: 'brand',
      disabled: true,
      pressed: false,
      neutral: false,
      theme,
    });
    expect(s.backgroundColor).not.toBe(off.backgroundColor);
    expect(s.textColor).not.toBe(off.textColor);
    expect(s.opacity).not.toBe(off.opacity);
  });

  it('pulsado usa el acento pulsado, y la transicion vale igual en claro', () => {
    expect(
      actionSurface({ tone: 'brand', disabled: false, pressed: true, neutral: false, theme })
        .backgroundColor,
    ).toBe(theme.accentPressed);
    expect(
      actionSurface({
        tone: 'brand',
        disabled: false,
        pressed: false,
        neutral: false,
        theme: light,
      }).backgroundColor,
    ).toBe(light.accent);
    expect(
      actionSurface({ tone: 'brand', disabled: true, pressed: false, neutral: false, theme: light })
        .backgroundColor,
    ).toBe(light.surface);
  });

  it('`material="control"` no cambia el amarillo: el material neutro nunca aplica a brand', () => {
    const s = actionSurface({
      tone: 'brand',
      disabled: false,
      pressed: false,
      neutral: true,
      theme,
    });
    expect(s.backgroundColor).toBe(theme.accent);
    expect(s.depth).toBeNull();
  });
});

describe('primary y secondary son superficies neutras: nunca el amarillo', () => {
  it('primary en reposo es surfaceRaised con borde interactivo; secondary, surface', () => {
    const p = actionSurface({
      tone: 'primary',
      disabled: false,
      pressed: false,
      neutral: false,
      theme,
    });
    expect(p.backgroundColor).toBe(theme.surfaceRaised);
    expect(p.borderColor).toBe(theme.borderInteractive);
    expect(p.textColor).toBe('text');
    expect(p.depth).toBe('selected');
    const s = actionSurface({
      tone: 'secondary',
      disabled: false,
      pressed: false,
      neutral: false,
      theme,
    });
    expect(s.backgroundColor).toBe(theme.surface);
    for (const one of [p, s]) expect(one.backgroundColor).not.toBe(theme.accent);
  });

  it('deshabilitados bajan la opacidad y el texto; pulsados se hunden', () => {
    const off = actionSurface({
      tone: 'primary',
      disabled: true,
      pressed: false,
      neutral: false,
      theme,
    });
    expect(off.opacity).toBe(0.5);
    expect(off.textColor).toBe('textDisabled');
    const down = actionSurface({
      tone: 'primary',
      disabled: false,
      pressed: true,
      neutral: false,
      theme,
    });
    expect(down.backgroundColor).toBe(theme.surfaceSunken);
  });

  it('el estado tactil: pulsado > seleccionado (primary) > elevado', () => {
    expect(tactileState(true, true)).toBe('pressed');
    expect(tactileState(false, true)).toBe('selected');
    expect(tactileState(false, false)).toBe('raised');
  });
});
