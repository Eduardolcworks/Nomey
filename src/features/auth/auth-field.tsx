import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { ThemedText } from '@/ui/components';
import { Radius, Spacing, Tactile, Typography, useTheme } from '@/ui/theme';

/**
 * A labelled text field, local to this feature on purpose.
 *
 * `src/ui/` is the design system, and a component earns a place there by
 * having more than one consumer - `ui/components/README` and the primitives
 * test both say so. Right now the only screens with a form are the two in
 * this folder. When a third appears somewhere else, this moves; guessing now
 * would be inventing a second consumer rather than answering one.
 */
export type AuthFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  readonly label: string;
};

export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { label, editable = true, ...input },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <ThemedText variant="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {/*
       * The depth lives on the wrapper rather than on the input. React
       * Native's `TextStyle` types `boxShadow` as a string, so the token - an
       * array of shadow objects - only type-checks on a `ViewStyle`. Putting
       * it here is also the more honest structure: the surface is a box, the
       * input is the text inside it.
       */}
      <View
        style={[
          styles.surface,
          {
            backgroundColor: theme.surface,
            // Focus is not signalled by colour alone: the surface sinks as
            // well, so the field reads as active without depending on hue.
            borderColor: focused ? theme.accent : theme.border,
            boxShadow: focused ? Tactile.pressed : Tactile.raised,
          },
        ]}>
        <TextInput
          ref={ref}
          {...input}
          editable={editable}
          // The label is already next to the field visually; naming it here is
          // what makes the two one control for a screen reader.
          accessibilityLabel={label}
          onFocus={(event) => {
            setFocused(true);
            input.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            input.onBlur?.(event);
          }}
          placeholderTextColor={theme.textDisabled}
          style={[
            styles.input,
            Typography.body,
            { color: editable ? theme.text : theme.textSecondary },
          ]}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: Spacing.xs },
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  input: {
    // 52pt, comfortably over the 44pt minimum touch target.
    minHeight: 52,
    paddingHorizontal: Spacing.md,
  },
});
