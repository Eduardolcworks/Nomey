import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIncidents } from '@/features/personal';
import { useSession } from '@/features/session';
import { AppTopBar, DOCK_HEIGHT } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, ThemedView } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * Grupos: the second root world.
 *
 * **"Crear grupo" is the empty state's own action, not the floating `+`.** The
 * `+` adds a movement to where you are; it does not create the place. Leaving
 * it there would make the first-run screen - the one every tester sees - a
 * blank page whose only prominent control cannot do the one thing needed.
 */
export default function GroupsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  /*
   * The same dot as Inicio. The bell is identical in both root destinations on
   * purpose, and an indicator that only appeared in one would make finding an
   * unresolved alert depend on which tab you happened to be looking at.
   */
  const { state } = useSession();
  const incidents = useIncidents(state.status === 'signed-in' ? state.identity.userId : '');

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <AppTopBar title="groups.title" alerts={incidents.unresolved > 0} />

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.lg },
          ]}>
          <EmptyState
            symbol={Symbols.groups}
            title={t('groups.empty')}
            description={t('groups.emptyHint')}
            action={{
              label: t('groups.create'),
              onPress: () => {
                // F4.D is structure. Creating a group belongs to its own phase.
              },
            }}
          />
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
});
