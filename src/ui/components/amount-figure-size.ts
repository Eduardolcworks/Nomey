/**
 * HOW BIG THE FIGURE IS, decided here and not by the platform.
 *
 * The figure used `adjustsFontSizeToFit`, which hands the decision to the
 * native text view: iOS fits the text to the frame it happens to have at that
 * layout pass, and on the device a `2` could come out tiny while a longer
 * number came out full size. What the person sees should not depend on a
 * layout race, so the size is computed from two known things — how many
 * glyphs the figure has and how wide its slot is — with one rule:
 *
 *   full size while it fits; smaller, progressively, only when it would not.
 *
 * `2`, `25`, `250`, `2500` are all full size in any slot a phone offers. A
 * figure with nine or ten integer digits shrinks just enough to fit, never
 * below `MIN_FONT_SIZE`, and the decimals keep their proportion to the
 * integer part.
 *
 * The width estimate uses a glyph advance of 0.62 em for the digits, a
 * conservative figure for the tabular digits of SF Pro and Roboto at
 * semibold weight: estimating a little wide shrinks a little early, which is
 * invisible; estimating narrow would overflow, which is not.
 */
export const BASE_FONT_SIZE = 56;
export const MIN_FONT_SIZE = 24;
/** Decimals are half the integers, as the figure has always drawn them. */
export const DECIMALS_RATIO = 0.5;

const GLYPH_ADVANCE = 0.62;
/** The figure's own tracking, per glyph, at base size (see the style). */
const INTEGER_TRACKING = -1.5;
const DECIMALS_TRACKING = -0.5;

/** The width the figure needs at a given integer font size. */
export function figureWidthAt(
  fontSize: number,
  glyphs: { readonly whole: number; readonly fraction: number; readonly separator: boolean },
): number {
  const integers = glyphs.whole * (fontSize * GLYPH_ADVANCE + INTEGER_TRACKING);
  const decimalSize = fontSize * DECIMALS_RATIO;
  const decimalGlyphs = glyphs.fraction + (glyphs.separator ? 1 : 0);
  const decimals = decimalGlyphs * (decimalSize * GLYPH_ADVANCE + DECIMALS_TRACKING);
  return integers + decimals;
}

/**
 * The font size for the integer part: `BASE_FONT_SIZE` when the figure fits
 * the slot, otherwise the largest size at which it does, floored at
 * `MIN_FONT_SIZE`. A slot of unknown width (`0`, before the first layout)
 * gets full size: nothing is known that would justify shrinking.
 */
export function amountFontSize(
  availableWidth: number,
  glyphs: { readonly whole: number; readonly fraction: number; readonly separator: boolean },
): number {
  if (availableWidth <= 0) return BASE_FONT_SIZE;
  if (figureWidthAt(BASE_FONT_SIZE, glyphs) <= availableWidth) return BASE_FONT_SIZE;
  // Width is linear in the font size, so the fitting size is one division
  // away; the tracking terms make it slightly optimistic, hence the floor
  // and the final guard.
  const perEm = figureWidthAt(1, glyphs) - figureWidthAt(0, glyphs);
  if (perEm <= 0) return BASE_FONT_SIZE;
  const fitting = Math.floor((availableWidth - figureWidthAt(0, glyphs)) / perEm);
  return Math.max(MIN_FONT_SIZE, Math.min(BASE_FONT_SIZE, fitting));
}
