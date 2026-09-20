import { describe, expect, it } from 'vitest';

import {
  amountFontSize,
  BASE_FONT_SIZE,
  figureWidthAt,
  MIN_FONT_SIZE,
} from '../../src/ui/components/amount-figure-size';

/**
 * The size of the amount figure is a rule, not a platform heuristic: full
 * size while the figure fits its slot, smaller only when it would not.
 */
const glyphs = (whole: number, fraction = 0) => ({ whole, fraction, separator: fraction > 0 });

/** The slot an iPhone gives the figure: ~390 wide minus gutters and the currency box. */
const PHONE_SLOT = 240;

describe('el tamaño del importe', () => {
  it('2, 25, 250, 2500 y 25.000,00 van a tamaño completo en la ranura de un teléfono', () => {
    for (const whole of [1, 2, 3, 4, 5]) {
      expect(amountFontSize(PHONE_SLOT, glyphs(whole))).toBe(BASE_FONT_SIZE);
      expect(amountFontSize(PHONE_SLOT, glyphs(whole, 2))).toBe(BASE_FONT_SIZE);
    }
  });

  it('no encoge hasta que el ancho estimado deja de caber, y entonces lo hace en escalones decrecientes', () => {
    let previous = BASE_FONT_SIZE;
    let shrunk = false;
    for (let whole = 1; whole <= 15; whole += 1) {
      const size = amountFontSize(PHONE_SLOT, glyphs(whole, 2));
      expect(size).toBeLessThanOrEqual(previous);
      expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
      if (size < BASE_FONT_SIZE) {
        shrunk = true;
        // At the chosen size the figure fits, or the floor was reached.
        expect(size === MIN_FONT_SIZE || figureWidthAt(size, glyphs(whole, 2)) <= PHONE_SLOT).toBe(
          true,
        );
      }
      previous = size;
    }
    expect(shrunk).toBe(true);
  });

  it('con la ranura sin medir todavía se dibuja a tamaño completo', () => {
    expect(amountFontSize(0, glyphs(12, 2))).toBe(BASE_FONT_SIZE);
  });

  it('el suelo existe: una cifra absurda no baja de lo legible', () => {
    expect(amountFontSize(120, glyphs(15, 3))).toBe(MIN_FONT_SIZE);
  });
});
