import type { SymbolViewProps } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';

import { ActionButton } from './action-button';
import { Icon } from './icon';
import { ThemedText } from './themed-text';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * The three states a surface can be in when it has no content to show.
 *
 * They share a layout and differ in what they mean, which is the point: a
 * glance and a screen reader should both be able to tell them apart.
 *
 * **What actually distinguishes them is the symbol, the copy and the
 * announcement - not the edge.** An earlier version leaned on dashed versus
 * solid borders, which does not survive contact with a device: a hairline is
 * a third of a point, `border` measures 1.46:1 against the ground, and iOS
 * renders a dashed border on a rounded box unreliably at sub-pixel widths. So
 * the containers now carry a real background, the error edge has real width,
 * and the meaning rides on channels that hold up in grayscale.
 *
 * The error is deliberately not a wall of red. A failed load is not a
 * destructive action, and spending the strongest visual signal the palette has
 * on "this did not fetch" leaves nothing louder for the things that deserve
 * it. The red appears on the glyph; the rest is shape, weight and words.
 */

type Common = {
  /** Fills its parent when true; sits inline inside a section when false. */
  readonly fill?: boolean;
  readonly style?: ViewStyle;
};

/**
 * Waiting for something.
 *
 * `accessible` matters as much as the role: without it the container is not a
 * single element and the state is not announced. The label is required for the
 * same reason - a spinner with no name tells a screen reader nothing.
 */
export function LoadingState({ label, fill = false, style }: Common & { label: string }) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.border },
        fill && styles.fill,
        style,
      ]}>
      <ActivityIndicator color={theme.textSecondary} />
      <ThemedText variant="bodySmall" themeColor="textSecondary" style={styles.centred}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Nothing to show, and nothing wrong.
 *
 * The action is `primary` because it is the one thing this block is asking
 * for. On an empty Grupos that action is the only way forward, so making it
 * quieter than a retry button elsewhere would have the emphasis exactly
 * backwards.
 */
export function EmptyState({
  symbol,
  title,
  description,
  action,
  fill = false,
  style,
}: Common & {
  symbol?: SymbolViewProps['name'];
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.border },
        fill && styles.fill,
        style,
      ]}>
      {symbol === undefined ? null : <Icon name={symbol} size={30} colour={theme.textTertiary} />}
      <View style={styles.copy}>
        <ThemedText variant="bodyStrong" style={styles.centred}>
          {title}
        </ThemedText>
        {description === undefined ? null : (
          <ThemedText variant="bodySmall" themeColor="textSecondary" style={styles.centred}>
            {description}
          </ThemedText>
        )}
      </View>
      {action === undefined ? null : (
        <ActionButton label={action.label} onPress={action.onPress} tone="primary" />
      )}
    </View>
  );
}

/**
 * Something went wrong.
 *
 * Announced rather than merely drawn: `accessible` plus a composed label plus
 * an assertive live region, because a role alone on a plain container is not
 * exposed as an announcement. Without it a VoiceOver user waits for content
 * that is never coming.
 */
export function ErrorState({
  title,
  description,
  retry,
  fill = false,
  style,
}: Common & {
  title: string;
  description?: string;
  retry?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={description === undefined ? title : `${title}. ${description}`}
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        styles.error,
        { backgroundColor: theme.surfaceRaised, borderColor: theme.borderStrong },
        fill && styles.fill,
        style,
      ]}>
      <Icon name="exclamationmark.triangle" size={30} colour={theme.negative} />
      <View style={styles.copy}>
        <ThemedText variant="bodyStrong" style={styles.centred}>
          {title}
        </ThemedText>
        {description === undefined ? null : (
          <ThemedText variant="bodySmall" themeColor="textSecondary" style={styles.centred}>
            {description}
          </ThemedText>
        )}
      </View>
      {retry === undefined ? null : (
        <ActionButton label={retry.label} onPress={retry.onPress} tone="primary" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** A real point, not a hairline: this edge is meant to be seen. */
  error: {
    borderWidth: 1,
  },
  fill: {
    flex: 1,
  },
  /** Title and description belong together, and closer than to the action. */
  copy: {
    alignSelf: 'stretch',
    gap: Spacing.xxs,
  },
  centred: {
    textAlign: 'center',
    /*
     * A centred line running the full width of a phone is measurably harder to
     * scan. Roughly 32 characters of the body role, which is about where a
     * comfortable measure sits.
     */
    maxWidth: 320,
    alignSelf: 'center',
  },
});
