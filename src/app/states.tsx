import { ScrollView, StyleSheet } from 'react-native';

import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, ErrorState, LoadingState, Section } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * The three common states, side by side, on the real device.
 *
 * Deliberately the smallest thing that answers the question. A component
 * catalogue would be infrastructure to maintain, and the question here is
 * narrow: do these three read as different from one another under the actual
 * theme, the actual safe areas and the actual panel?
 *
 * It is reachable only from the development rows in Perfil, exactly like the
 * F4.B diagnostic, so nothing in the product links to it.
 */
export default function StatesScreen() {
  const { t } = useTranslation();

  return (
    <PlaceholderScreen title="dev.states">
      <ScrollView contentContainerStyle={styles.content}>
        <Section title={t('state.loading')}>
          <LoadingState label={t('state.loading')} />
        </Section>

        <Section title={t('home.activity')}>
          <EmptyState
            symbol={Symbols.empty}
            title={t('home.activityEmpty')}
            description={t('home.activityHint')}
          />
        </Section>

        <Section title={t('groups.title')}>
          <EmptyState
            symbol={Symbols.groups}
            title={t('groups.empty')}
            description={t('groups.emptyHint')}
            action={{ label: t('groups.create'), onPress: () => undefined }}
          />
        </Section>

        <Section title={t('state.errorTitle')}>
          <ErrorState
            title={t('state.errorTitle')}
            description={t('state.errorBody')}
            retry={{ label: t('state.retry'), onPress: () => undefined }}
          />
        </Section>
      </ScrollView>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
});
