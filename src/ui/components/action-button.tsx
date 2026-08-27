import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ThemedText } from './themed-text';
import { Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /**
   * `primary` is a filled control for the one action a surface is asking for;
   * `secondary` is outlined, for anything alongside it.
   */
  tone?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * A labelled action, with the depth the rest of the app uses.
 *
 * Three surfaces had grown their own version of this - the create-group call
 * to action, the retry on an error, the action inside an empty state - each
 * repeating the same resting-raised, pressed-sunken shading and the same 48pt
 * minimum. What it removes is that repetition; what it fixes is that the three
 * had already started to drift apart in radius and padding.
 *
 * The brand accent is deliberately absent. On this shell the filled yellow
 * belongs to the floating action and to nothing else, so a primary button here
 * is a lifted neutral surface with a strong edge, which is enough to read as
 * primary next to an outlined one.
 */
export function ActionButton({
  label,
  onPress,
  tone = 'secondary',
  disabled = false,
  style,
}: ActionButtonProps) {
  const theme = useTheme();
  const primary = tone === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed
            ? theme.surfaceSunken
            : primary
              ? theme.surfaceRaised
              : theme.surface,
          borderColor: primary ? theme.borderInteractive : theme.border,
          boxShadow: pressed ? Tactile.pressed : primary ? Tactile.selected : Tactile.raised,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}>
      <ThemedText variant="label" themeColor={disabled ? 'textDisabled' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
  },
});
