import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, DOCK_HEIGHT } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

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

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <AppHeader title="groups.title" />

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.lg },
          ]}>
          <EmptyState
            symbol="person.2"
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
