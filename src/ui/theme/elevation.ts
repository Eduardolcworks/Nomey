import type { BoxShadowValue } from 'react-native';

/**
 * Depth tokens: glass surfaces and tactile interaction.
 *
 * These are the two depth devices of design-direction.md, and they are NOT
 * interchangeable:
 *
 *   glass    -> surfaces that contain things: cards, panels, sheets, controls
 *   tactile  -> how those surfaces respond: raised, selected, pressed, sunken
 *
 * Applying either mechanically to everything is the failure mode the direction
 * warns about. A surface that does not contain, and a control that does not
 * respond, get neither.
 *
 * **Everything here is designed for a pure black ground, and that changes the
 * physics.** A drop shadow is black on black - it renders nothing. Depth on
 * this ground can only come from the surface being *lighter* than what is
 * behind it, from a highlight along the top edge where the light lands, and
 * from an inner shade along the bottom where it does not. The outer shadows
 * below are kept for surfaces that float over content rather than over the
 * ground, where they do show.
 */

/**
 * The measured floor for how opaque a glass tint must be.
 *
 * Glass is translucent, so its effective background is whatever shows through
 * it - and a floating control can sit over anything, including a full-bleed
 * accent surface. A thin tint measured 1.6:1 for white text against a yellow
 * backdrop: unreadable.
 *
 * The tints below all sit at or above this, and every one keeps white text
 * past 11:1 against the worst backdrop tested.
 */
export const MinGlassTintAlpha = 0.72;

type GlassToken = {
  /** Fallback and tint colour. Opaque enough to keep text legible alone. */
  readonly tint: string;
  /** The rim. On a black ground this is most of what separates the object. */
  readonly border: string;
  /** Light along the top edge, applied as an inset by `GlassSurface`. */
  readonly highlight: string;
  /**
   * Broad inner shading, for a surface meant to read as a lens rather than a
   * fill. Only the levels that need volume carry one; a hairline highlight is
   * enough for a flat panel, and spreading light across a card would look like
   * a bevel rather than like glass.
   */
  readonly lens?: readonly BoxShadowValue[];
};

/**
 * **The tints are lifted charcoals, not near-blacks.**
 *
 * A near-black tint over a pure black ground composites to itself: `rgba(10,
 * 10, 10, 0.88)` measures 1.04:1 against the background, which is to say the
 * surface is the background and a hairline is all that separates a control
 * from the void. Lifted, these compose to `#1a1a1c` and up - 1.2-1.3:1 - which
 * is what makes an object look like it is in front of something.
 *
 * Nothing was traded for it: white text on them still measures 16-17:1 over
 * black and 11.5:1 over the worst backdrop tested.
 */
export type GlassLevel = 'regular' | 'bar' | 'heavy' | 'action';

export const Glass: Record<GlassLevel, GlassToken> = {
  /** Cards, panels, controls at rest. */
  regular: {
    tint: 'rgba(30, 30, 32, 0.88)',
    border: 'rgba(255, 255, 255, 0.14)',
    highlight: 'rgba(255, 255, 255, 0.16)',
  },
  /** Floating elements that pass over scrolling content. */
  bar: {
    tint: 'rgba(24, 24, 27, 0.90)',
    border: 'rgba(255, 255, 255, 0.10)',
    highlight: 'rgba(255, 255, 255, 0.10)',
  },
  /** Sheets, modals, menus: they must dominate whatever they cover. */
  heavy: {
    tint: 'rgba(25, 25, 25, 0.96)',
    border: 'rgba(255, 255, 255, 0.16)',
    highlight: 'rgba(255, 255, 255, 0.18)',
  },
  /**
   * The primary action: warm glass, not a yellow disc.
   *
   * **The brand colour is no longer the fill.** Filling the shape with it
   * produced a paint swatch that no amount of shading rescued - every effect
   * read as something applied on top of a solid object rather than as the
   * object's own material. So the body is dark amber-tinted glass, and the
   * yellow moves to where a real tinted lens actually shows its colour: the
   * rim that catches the light, the glow held inside the upper half, the halo
   * it casts, and the glyph itself.
   *
   * That inversion is what makes it a piece of glass with light in it instead
   * of a coloured circle. It also buys genuine translucency: at 0.78 the
   * ground and any content scrolling behind really do come through, which was
   * impossible while the surface had to stay opaque enough to keep a
   * near-black glyph legible.
   *
   * Measured, because the body is now barely brighter than the navigation
   * pills beside it - 1.4 points of luminance - and could have stopped reading
   * as the primary action. It does not, because none of what distinguishes it
   * is luminance: hue (warm against neutral), a rim at 10.2:1 on the ground, a
   * yellow glyph at 8.9:1 on the body, its own halo, and its shape and size.
   */
  action: {
    tint: 'rgba(90, 74, 32, 0.80)',
    /**
     * The lit edge. Deliberately dimmer than the glyph: a rim as bright as
     * the mark on it reads as a ring or a toggle, and an outlined circle is
     * the vocabulary of a secondary control in almost every system.
     */
    border: 'rgba(253, 197, 6, 0.58)',
    /** Light catching the top rim, warmed by the glass it passes through. */
    highlight: 'rgba(255, 236, 170, 0.60)',
    /**
     * What turns the disc into a lens.
     *
     * Measured first, because the obvious move is wrong: over a pure black
     * ground, lowering the yellow's alpha does not make it look like glass, it
     * makes it olive - 0.72 composites to #b68e04 and 0.55 to #8b6c03, which
     * is a loss of the brand rather than a gain in material. Translucency is
     * kept real but modest at 0.86, and what actually reads as glass is done
     * here: a wide wash of light down from the top and a contained shade up
     * from the bottom, so the surface varies across its own diameter instead
     * of being one flat value.
     *
     * The colour lives in here, and three asymmetries keep it from becoming a
     * 2008 gel button:
     *
     * - **The glow is small and high, the shade is large and low.** A
     *   highlight and a shade of equal size meeting at the equator is the
     *   signature of a 2010 bevel. Here the light covers roughly an eighth of
     *   the disc and the shade about a third.
     * - **The diffuse layers are a pale warm, not the brand yellow.** Brand
     *   yellow at low alpha over a dark body composes to olive - measured,
     *   #755f1f - which muddies the glass and drags the glyph towards its own
     *   colour field. Saturation belongs where the alpha is high, in the rim
     *   and the glyph; the washes get a pale amber that stays warm when thin.
     * - **The shade deepens towards amber, not towards black.** Darkening with
     *   black desaturates; darkening with hue reads as the material absorbing
     *   light.
     *
     * The blurs are wide on purpose - half the diameter and more. A short blur
     * produces a second hard edge just inside the border, which reads as a
     * double stroke rather than as depth. With no gradients available, a
     * large-radius inset shadow **is** the gradient, and it only becomes a
     * field instead of an edge past roughly 40% of the diameter.
     *
     * Two numbers are held by measurement rather than taste. The body composes
     * to #483b1a: 1.92:1 against the ground, which is what stops the disc from
     * dissolving into a floating ring and a glyph, and 3.5 luminance points
     * above the pills beside it, so it reads as raised rather than as a hole.
     * And the inner glow stops at 0.12, because the glyph measures 4.8:1 over
     * it at 0.14 and 4.3:1 at 0.18 - past the line.
     *
     * The outer halo is warm for a reason that is not decorative: a black
     * shadow on a pure black ground renders nothing, because the pixel is
     * already off. Carrying a trace of its own colour is the only way the
     * object can separate itself from the void outside its own edge. Bounded
     * and low-alpha - the direction rules out filling the interface with
     * glows, and this has to read as light held by glass, not as neon.
     */
    lens: [
      { offsetX: 0, offsetY: 12, blurRadius: 28, color: 'rgba(255, 224, 138, 0.12)', inset: true },
      { offsetX: 0, offsetY: -18, blurRadius: 26, color: 'rgba(20, 15, 0, 0.45)', inset: true },
      // Pushed down rather than centred: a halo hugging the whole rim raises
      // the ground right where the top edge needs to cut against it.
      { offsetX: 0, offsetY: 10, blurRadius: 24, color: 'rgba(255, 224, 138, 0.16)' },
    ],
  },
};

/**
 * Tactile depth, as inner shading.
 *
 * **Rest is raised and a press pushes it down**, not the other way round. The
 * previous set only became visible on press, because its resting shadow was
 * black on a black ground and its inner highlight was painted on a parent that
 * the surface then covered. So the control looked like a flat rectangle that
 * grew depth when touched, which is backwards.
 *
 * Every state is expressed as inner shading against the surface's own colour,
 * which is the only thing that works when there is nothing behind to cast onto.
 * The light is always from above: a raised object is shaded along its lower
 * inside edge, a pressed one along its upper inside edge, and the inversion is
 * what the eye reads as a push.
 *
 * The hard rule that survives every visual revision: **depth may reinforce an
 * affordance, never carry it alone.** Colour, weight and label still do their
 * share; this only makes the object feel like an object.
 *
 * These arrays go on the view that paints the surface - `GlassSurface` applies
 * them - and never on a transparent parent, where an inset shadow is drawn and
 * then covered by the child.
 */
export const Tactile = {
  /** At rest, in front of the ground. */
  raised: [
    { offsetX: 0, offsetY: -10, blurRadius: 14, color: 'rgba(0, 0, 0, 0.45)', inset: true },
    { offsetX: 0, offsetY: 8, blurRadius: 20, color: 'rgba(0, 0, 0, 0.65)' },
  ],
  /** Chosen: further forward, and lit a little harder. */
  selected: [
    { offsetX: 0, offsetY: -12, blurRadius: 16, color: 'rgba(0, 0, 0, 0.38)', inset: true },
    { offsetX: 0, offsetY: 10, blurRadius: 26, color: 'rgba(0, 0, 0, 0.75)' },
  ],
  /** Held down: the shading flips to the top and the outer shadow goes. */
  pressed: [
    { offsetX: 0, offsetY: 8, blurRadius: 12, color: 'rgba(0, 0, 0, 0.62)', inset: true },
    { offsetX: 0, offsetY: -2, blurRadius: 2, color: 'rgba(255, 255, 255, 0.06)', inset: true },
  ],
  /** Recessed at rest: still an object, just set back. */
  well: [
    { offsetX: 0, offsetY: 5, blurRadius: 8, color: 'rgba(0, 0, 0, 0.50)', inset: true },
    { offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.35)' },
  ],
} as const satisfies Record<string, readonly BoxShadowValue[]>;

export type TactileState = keyof typeof Tactile;
