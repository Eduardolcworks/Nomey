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
  /** Backdrop blur radius, for the platforms that can blur. */
  readonly blurRadius: number;
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
 * They used to be `rgba(10, 10, 10, …)`, which over a pure black ground
 * composites to `#070707` - a measured 1.04:1 against the background. That is
 * the same colour as the background. The surfaces were not subtle, they were
 * absent, and the only thing separating a control from the void was a 10%
 * hairline. It is why the whole dock read as flat at rest while the pressed
 * state - an inner dark shadow, which needs a lighter surface to show against
 * - read fine.
 *
 * Lifted, they compose to `#1a1a1c` and up: 1.2-1.3:1 against the ground,
 * which is what makes an object look like it is in front of something. White
 * text on them still measures 16-17:1 over black and 11.5:1 over white, so
 * nothing was traded away for it.
 */
export type GlassLevel = 'regular' | 'bar' | 'heavy' | 'action';

export const Glass: Record<GlassLevel, GlassToken> = {
  /** Cards, panels, controls at rest. */
  regular: {
    tint: 'rgba(30, 30, 32, 0.88)',
    blurRadius: 20,
    border: 'rgba(255, 255, 255, 0.14)',
    highlight: 'rgba(255, 255, 255, 0.16)',
  },
  /** Floating elements that pass over scrolling content. */
  bar: {
    tint: 'rgba(24, 24, 27, 0.90)',
    blurRadius: 28,
    border: 'rgba(255, 255, 255, 0.10)',
    highlight: 'rgba(255, 255, 255, 0.10)',
  },
  /** Sheets, modals, menus: they must dominate whatever they cover. */
  heavy: {
    tint: 'rgba(25, 25, 25, 0.96)',
    blurRadius: 36,
    border: 'rgba(255, 255, 255, 0.16)',
    highlight: 'rgba(255, 255, 255, 0.18)',
  },
  /**
   * The primary action, and the only glass that is not neutral.
   *
   * The brand yellow at 0.86 rather than flat: measured, near-black on it
   * clears 9:1 against a black backdrop, so the translucency costs nothing
   * legible while letting the button belong to the same material as the
   * controls beside it. The rim and the highlight are stronger here than
   * anywhere else - it is the one object meant to read as lit from above
   * rather than merely present.
   */
  action: {
    tint: 'rgba(253, 197, 6, 0.86)',
    blurRadius: 24,
    border: 'rgba(255, 255, 255, 0.38)',
    highlight: 'rgba(255, 255, 255, 0.55)',
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
     * Three things keep it from becoming a 2008 gel button, and all three are
     * about asymmetry:
     *
     * - **The light is small and high, the shade is large and low.** A
     *   highlight and a shade of equal size meeting at the equator is the
     *   signature of a 2010 bevel. Here the light covers roughly an eighth of
     *   the disc and the shade about a third.
     * - **The lower pole deepens towards amber, not towards black.** Darkening
     *   with black desaturates and drags the brand yellow to olive; darkening
     *   with hue reads as the material absorbing light and keeps it vivid.
     * - **The outer shadow is warm.** A black shadow on a pure black ground
     *   renders nothing at all - the pixel is already off - so the only way
     *   this object can separate itself from the void outside its own edge is
     *   to carry a trace of its own colour. It is kept small and low-alpha on
     *   purpose: the direction rules out filling the interface with glows, and
     *   this has to read as contact, not as neon.
     */
    lens: [
      { offsetX: 0, offsetY: 9, blurRadius: 12, color: 'rgba(255, 255, 255, 0.26)', inset: true },
      { offsetX: 0, offsetY: -16, blurRadius: 22, color: 'rgba(120, 84, 0, 0.42)', inset: true },
      { offsetX: 0, offsetY: 6, blurRadius: 14, color: 'rgba(120, 84, 0, 0.55)' },
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
