import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from './themed-text';
import { Spacing } from '@/ui/theme';

export type SectionProps = {
  title: string;
  children: ReactNode;
  style?: ViewStyle;
};

/**
 * A titled block of content.
 *
 * Barely more than a heading and a gap, which is exactly why it earns its
 * place: three screens had each chosen their own spacing between a subheading
 * and what it introduces, and the difference was visible when they sat next to
 * each other.
 *
 * The heading is a real heading for accessibility, so a screen reader can jump
 * between sections instead of walking every line.
 */
export function Section({ title, children, style }: SectionProps) {
  return (
    <View style={[styles.section, style]}>
      <ThemedText variant="subheading" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
});
