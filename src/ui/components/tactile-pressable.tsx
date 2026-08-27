import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from 'react-native';

import { Radius, Tactile, useTheme } from '@/ui/theme';

export type TactilePressableProps = Omit<PressableProps, 'style'> & {
  /** Chosen. Depth marks it, but never on its own. */
  selected?: boolean;
  /** A recessed control rather than a raised one: tracks, wells, inputs. */
  sunken?: boolean;
  radius?: number;
  style?: ViewStyle;
};

/**
 * A control with depth, restrained.
 *
 * The rule that survives every visual revision: **depth reinforces an
 * affordance, it never carries one.** So pressing changes the surface colour
 * as well as the shadow, and `selected` changes the surface as well - a state
 * expressed only as a shadow is invisible to anyone who cannot see shadows,
 * and nearly invisible on a black OLED panel to everyone else.
 *
 * `accessibilityState.selected` is set from the same prop, so the selection is
 * announced rather than merely drawn.
 *
 * Restraint is the point: a thin inset highlight along the top edge and a
 * contained shadow below. The soft 2020 neumorphism - large blurry shadows,
 * inflated surfaces, low contrast - is what design-direction.md rules out.
 */
export function TactilePressable({
  selected = false,
  sunken = false,
  radius = Radius.md,
  style,
  ...rest
}: TactilePressableProps) {
  const theme = useTheme();

  const restingShadow = sunken ? Tactile.well : selected ? Tactile.selected : Tactile.raised;

  return (
    <Pressable
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.control,
        {
          borderRadius: radius,
          backgroundColor: pressed
            ? theme.surfaceSunken
            : selected
              ? theme.surfaceRaised
              : theme.surface,
          borderColor: selected ? theme.borderStrong : theme.border,
          boxShadow: pressed ? Tactile.pressed : restingShadow,
        },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  control: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
