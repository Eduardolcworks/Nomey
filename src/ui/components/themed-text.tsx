import { Text, type TextProps } from 'react-native';

import { type TextColor, Typography, type TypographyRole, useTheme } from '@/ui/theme';

export type ThemedTextProps = TextProps & {
  /**
   * Type role, never a size. See `ui/theme/typography.ts`.
   *
   * Named `variant` and not `role` on purpose: React Native's `TextProps`
   * already carries an ARIA `role`, and intersecting the two collapses this
   * prop to the single value the two unions happen to share - `'heading'` -
   * with an error message that points nowhere near the cause.
   */
  variant?: TypographyRole;
  /** Foreground tokens only. A ground or a border cannot be text. */
  themeColor?: TextColor;
};

export function ThemedText({ style, variant = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text style={[{ color: theme[themeColor ?? 'text'] }, Typography[variant], style]} {...rest} />
  );
}
