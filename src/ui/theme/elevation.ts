import type { BoxShadowValue } from 'react-native';

/**
 * Depth tokens: glass surfaces and tactile (neumorphic) interaction.
 *
 * These are the two depth devices of design-direction.md, and they are NOT
 * interchangeable:
 *
 *   glass    -> surfaces that contain things: cards, panels, sheets, bars
 *   tactile  -> controls that respond: buttons, toggles, chips, tabs
 *
 * Applying either mechanically to everything is the failure mode the direction
 * warns about. A surface that does not contain, and a control that does not
 * respond, get neither.
 *
 * Tokens only. Nothing here decides which component gets which; that is F4.D,
 * against a real consumer.
 */

/**
 * The measured floor for a glass tint's opacity.
 *
 * Glass is translucent, so its effective background is the backdrop showing
 * through it - and a tab bar can sit over anything, including a full-bleed
 * accent surface. White text over a 7%-white tint measured 1.6:1 against a
 * yellow backdrop and 4.4:1 against a white one: both fail.
 *
 * A DARK tint at 0.72 was the lowest value that held >= 4.5:1 for white text
 * against every backdrop tested - black 20.1, yellow 10.4, white 8.2, green
 * 11.4. That is why Nomey's glass is a dark veil with real opacity rather than
 * a thin transparency, and why lowering this number is an accessibility
 * decision and not a styling tweak.
 */
export const MinGlassTintAlpha = 0.72;

type GlassToken = {
  /** Fallback and tint colour. Opaque enough to keep text legible alone. */
  readonly tint: string;
  /** Backdrop blur radius, for the platforms that can blur. */
  readonly blurRadius: number;
  /** Hairline edge that separates the surface from what is behind it. */
  readonly border: string;
  /** Top-edge light catch. Ornamental; never carries meaning. */
  readonly highlight: string;
};

export const Glass = {
  /** Cards, panels, inline containers. */
  regular: {
    tint: `rgba(10, 10, 10, ${MinGlassTintAlpha})`,
    blurRadius: 20,
    border: 'rgba(255, 255, 255, 0.10)',
    highlight: 'rgba(255, 255, 255, 0.06)',
  },
  /** Bars and floating elements that pass over scrolling content. */
  bar: {
    tint: 'rgba(10, 10, 10, 0.80)',
    blurRadius: 28,
    border: 'rgba(255, 255, 255, 0.08)',
    highlight: 'rgba(255, 255, 255, 0.05)',
  },
  /** Sheets, modals, menus: they must dominate whatever they cover. */
  heavy: {
    tint: 'rgba(10, 10, 10, 0.92)',
    blurRadius: 36,
    border: 'rgba(255, 255, 255, 0.12)',
    highlight: 'rgba(255, 255, 255, 0.07)',
  },
} as const satisfies Record<string, GlassToken>;

export type GlassLevel = keyof typeof Glass;

/**
 * Tactile depth.
 *
 * Restrained on purpose. The direction rules out the soft 2020 neumorphism -
 * large blurry shadows, inflated surfaces, low contrast - so these use a thin
 * inset highlight along the top edge plus a contained shadow below, which
 * reads as raised without inflating anything.
 *
 * The hard rule that survives every visual revision: **depth may reinforce an
 * affordance, never carry it alone.** A control still needs a label, an icon,
 * a colour change or a position. That is design-direction.md section 8 and it
 * is the reason `pressed` also changes surface colour rather than only its
 * shadow.
 *
 * Expressed as `boxShadow` arrays, which React Native 0.86 types with multiple
 * layers and an `inset` flag. Their rendering is unverified on device until a
 * component consumes them in F4.C/F4.D.
 */
export const Tactile = {
  /** Resting state of a control that invites a press. */
  raised: [
    { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255, 255, 255, 0.07)', inset: true },
    { offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(0, 0, 0, 0.55)' },
  ],
  /** Held down. Pair with `surfaceSunken`; the shadow is not the only signal. */
  pressed: [
    { offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.65)', inset: true },
    { offsetX: 0, offsetY: -1, blurRadius: 0, color: 'rgba(255, 255, 255, 0.04)', inset: true },
  ],
  /** Chosen. Never expressed by depth alone - accent and label carry it. */
  selected: [
    { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255, 255, 255, 0.10)', inset: true },
    { offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.50)' },
  ],
  /** Recessed wells: inputs, tracks, progress grooves. */
  well: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0, 0, 0, 0.70)', inset: true }],
} as const satisfies Record<string, readonly BoxShadowValue[]>;

export type TactileState = keyof typeof Tactile;
