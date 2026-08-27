import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { ThemedText, ThemedView } from '@/ui/components';
import { Colors, Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * Holding screen.
 *
 * TEMPORARY, and replaced wholesale by the navigation shell in F4.C. It exists
 * so the visual foundation can be checked on a real device, which is the only
 * place a black is actually black, a yellow is actually the brand yellow, and
 * a launch either flashes white or does not.
 *
 * It renders no product surface and fakes no feature. The swatch labels are
 * token identifiers, not interface copy, which is why they stay literal; every
 * actual string comes from the catalogues.
 */

/** Colour tokens whose rendering on an OLED panel is worth seeing directly. */
const PROBE: readonly (keyof typeof Colors.dark)[] = [
  'text',
  'textSecondary',
  'textTertiary',
  'accent',
  'positive',
  'negative',
];

export default function HoldingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText variant="display" themeColor="accent">
          Nomey
        </ThemedText>
        <ThemedText variant="caption" themeColor="textTertiary" style={styles.caption}>
          {t('foundation.caption')}
        </ThemedText>

        <View style={[styles.probe, { borderColor: theme.border }]}>
          {PROBE.map((token) => (
            <View key={token} style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: theme[token] }]} />
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {token}
              </ThemedText>
            </View>
          ))}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    marginTop: Spacing.xs,
  },
  probe: {
    marginTop: Spacing.xxl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  swatch: {
    width: Spacing.md,
    height: Spacing.md,
    borderRadius: Radius.sm,
  },
});
