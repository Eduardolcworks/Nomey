import type { Colors } from '@/ui/theme/colors';
import type { TactileState } from '@/ui/theme/elevation';

/**
 * How an `ActionButton` looks, decided in one pure place.
 *
 * Extracted from the component so the decision is TESTABLE without a
 * renderer and without React Native: given a tone, the disabled/pressed
 * state and the theme, exactly which fill, edge, depth and text colour
 * result. The component only maps `depth`/`neutralEdge` onto the platform
 * shadow and rim helpers, which is presentation plumbing and not a decision.
 *
 * The one that bit: a `brand` (yellow) button that is disabled must read as
 * a GREY, switched-off control and, the moment it is enabled, as the yellow
 * call to action — never as a washed-out yellow that looks disabled while it
 * works, nor as a yellow that looks live while it does nothing. And
 * `primary` is NOT yellow: it is the lifted neutral surface. Two guest CTAs
 * said `primary` and painted grey on the phone; that is why this exists.
 */
export type ActionTone = 'primary' | 'secondary' | 'brand';

export type ActionSurface = {
  readonly backgroundColor: string;
  /** The raw edge colour; the component wraps it with `controlEdge` when `neutralEdge`. */
  readonly borderColor: string;
  readonly neutralEdge: boolean;
  /** `null` for `brand`: the yellow is opaque and paints itself, no relief on top. */
  readonly depth: TactileState | null;
  readonly opacity: number;
  /** The `ThemedText` token for the label. */
  readonly textColor: 'text' | 'onAccent' | 'textDisabled';
};

export type ActionSurfaceInput = {
  readonly tone: ActionTone;
  readonly disabled: boolean;
  readonly pressed: boolean;
  /** `material="control"`: the Android-neutral rim, never for `brand`. */
  readonly neutral: boolean;
  readonly theme: (typeof Colors)['dark'] | (typeof Colors)['light'];
};

/** The tactile state the shadow and the depth layer share. */
export function tactileState(pressed: boolean, primary: boolean): TactileState {
  if (pressed) return 'pressed';
  return primary ? 'selected' : 'raised';
}

export function actionSurface({
  tone,
  disabled,
  pressed,
  neutral,
  theme,
}: ActionSurfaceInput): ActionSurface {
  const primary = tone === 'primary';

  if (tone === 'brand') {
    /*
     * OFF is grey, not pale yellow. A disabled brand button takes the neutral
     * resting surface and the disabled text, at half opacity: it reads as
     * "not yet", and the yellow is reserved for the moment it can be tapped.
     * Enabled, the yellow is opaque and paints itself: no relief layer on top,
     * pressed = `accentPressed`, the same tokens as the sheet's save button.
     */
    if (disabled) {
      return {
        backgroundColor: theme.surface,
        borderColor: theme.border,
        neutralEdge: false,
        depth: null,
        opacity: 0.5,
        textColor: 'textDisabled',
      };
    }
    return {
      backgroundColor: pressed ? theme.accentPressed : theme.accent,
      borderColor: 'transparent',
      neutralEdge: false,
      depth: null,
      opacity: 1,
      textColor: 'onAccent',
    };
  }

  return {
    backgroundColor: pressed ? theme.surfaceSunken : primary ? theme.surfaceRaised : theme.surface,
    borderColor: primary ? theme.borderInteractive : theme.border,
    neutralEdge: neutral,
    depth: tactileState(pressed, primary),
    opacity: disabled ? 0.5 : 1,
    textColor: disabled ? 'textDisabled' : 'text',
  };
}
