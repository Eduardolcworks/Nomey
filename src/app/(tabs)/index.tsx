import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencyDefinition, money } from '@/domain';
import { useSession } from '@/features/session';
import { AppHeader, DOCK_HEIGHT } from '@/features/shell';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, GlassSurface, Section, ThemedText, ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * Inicio: whose money, how much is available, and what has happened lately.
 *
 * **The balance is zero because there are no movements.** Inventing a figure
 * would make the screen look finished and be a lie the moment anyone
 * reconciled it. Zero is honest, and it still exercises the amount role, the
 * tabular figures and the regional formatter on a device.
 */
const PLACEHOLDER_CURRENCY = currencyDefinition({ id: 'shell-eur', code: 'EUR', scale: 2 });

export default function HomeScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const insets = useSafeAreaInsets();
  const { state } = useSession();

  /*
   * The route composes the two features, because neither may import the
   * other: the shell renders a header, the session knows who is signed in,
   * and joining them is what a route is for.
   *
   * Derived on every render rather than copied into state, so a later
   * USER_UPDATED or a refreshed session moves the greeting on its own.
   */
  const greetingName = state.status === 'signed-in' ? state.identity.displayName : null;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <AppHeader greeting greetingName={greetingName} />

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

          <Section title={t('home.activity')}>
            <EmptyState
              symbol="tray"
              title={t('home.activityEmpty')}
              description={t('home.activityHint')}
            />
          </Section>
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
});
