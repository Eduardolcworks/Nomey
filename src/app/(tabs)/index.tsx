import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencyDefinition, money } from '@/domain';
import { AppHeader, DOCK_HEIGHT } from '@/features/shell';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText, ThemedView } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * Inicio: whose money, how much is available, and what has happened lately.
 *
 * The scope switch now sits in the header next to the greeting. Both answer
 * the same question - who is this screen about - and a single switch had no
 * room in the content without leaving a half-empty row where a two-segment
 * control used to be.
 *
 * **The balance is zero because there are no movements.** It would have been
 * easy to invent a number that makes the screen look finished, and it would
 * have been a lie the moment anyone reconciled it. Zero is the honest figure
 * for an app with no data, and it still exercises everything worth checking on
 * a device: the amount role, the tabular figures and the regional formatter.
 */
const PLACEHOLDER_CURRENCY = currencyDefinition({ id: 'shell-eur', code: 'EUR', scale: 2 });

export default function HomeScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <AppHeader greeting />

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.lg },
          ]}>
          <GlassSurface level="regular" style={styles.balance}>
            <ThemedText variant="caption" themeColor="textTertiary">
              {t('home.available')}
            </ThemedText>
            <ThemedText variant="amountHero">
              {format.money(money(0n, PLACEHOLDER_CURRENCY))}
            </ThemedText>
          </GlassSurface>

          <View style={styles.section}>
            <ThemedText variant="subheading">{t('home.activity')}</ThemedText>
            <View style={[styles.empty, { borderColor: theme.border }]}>
              <ThemedText variant="body" themeColor="textSecondary">
                {t('home.activityEmpty')}
              </ThemedText>
              <ThemedText variant="bodySmall" themeColor="textTertiary">
                {t('home.activityHint')}
              </ThemedText>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  balance: {
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  section: {
    gap: Spacing.sm,
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    borderStyle: 'dashed',
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
});
