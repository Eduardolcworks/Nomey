import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencyDefinition, money } from '@/domain';
import {
  AppHeader,
  DOCK_HEIGHT,
  SCOPE_AVAILABLE,
  SCOPE_LABEL,
  SCOPES,
  useScope,
} from '@/features/shell';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, TactilePressable, ThemedText, ThemedView } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * Inicio: the scope, what is available in it, and what has happened lately.
 *
 * **The balance is zero because there are no movements.** It would have been
 * easy to invent a number that makes the screen look finished, and it would
 * have been a lie the moment anyone tried to reconcile it. Zero is the honest
 * figure for an app with no data, and it still exercises everything worth
 * checking on a device: the amount role, the tabular figures and the regional
 * formatter.
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
        <AppHeader />

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.xl },
          ]}>
          <ScopeSelector />

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

/**
 * Personal or Pareja, and which books the action button writes to.
 *
 * Placed directly above the balance rather than in the header, so the thing it
 * governs sits underneath it and the causal link is visible: change the
 * segment, the figure below changes. A selector floating in the header reads
 * as a filter over the whole screen, which is the wrong mental model - these
 * are two different sets of books, not two views of one.
 *
 * Pareja is present and marked as unavailable rather than hidden. Hiding it
 * would make the control a single button with nothing to choose, and the whole
 * point of shipping it now is to judge the choice on a device.
 */
function ScopeSelector() {
  const { t } = useTranslation();
  const { scope, setScope } = useScope();

  return (
    <View style={styles.selector} accessibilityRole="tablist" accessibilityLabel={t('scope.label')}>
      {SCOPES.map((candidate) => {
        const selected = candidate === scope;
        const available = SCOPE_AVAILABLE[candidate];

        return (
          <TactilePressable
            key={candidate}
            selected={selected}
            radius={Radius.full}
            style={styles.segment}
            onPress={() => {
              setScope(candidate);
            }}>
            <ThemedText
              variant="label"
              themeColor={selected ? 'text' : available ? 'textSecondary' : 'textDisabled'}>
              {t(SCOPE_LABEL[candidate])}
            </ThemedText>
            {available ? null : (
              <ThemedText variant="caption" themeColor="textDisabled">
                {t('action.soon')}
              </ThemedText>
            )}
          </TactilePressable>
        );
      })}
    </View>
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
  selector: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
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
