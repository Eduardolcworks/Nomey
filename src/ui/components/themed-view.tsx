import { View, type ViewProps } from 'react-native';

import { type ThemeColor, useTheme } from '@/ui/theme';

export type ThemedViewProps = ViewProps & {
  /** Which theme surface this view paints. Defaults to the app ground. */
  surface?: ThemeColor;
};

export function ThemedView({ style, surface, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return (
    <View style={[{ backgroundColor: theme[surface ?? 'background'] }, style]} {...otherProps} />
  );
}
