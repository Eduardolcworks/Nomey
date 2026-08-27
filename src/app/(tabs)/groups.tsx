import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, DOCK_HEIGHT } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { ThemedText, ThemedView } from '@/ui/components';
import { Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

/**
 * Grupos: the second root world.
 *
 * **"Crear grupo" lives in the content, not in the action button.** The `+`
 * adds a movement to where you are; it does not create the place. With no
 * groups yet that would leave the first-run screen - the one every tester sees
 * - as an empty page whose only prominent control cannot do the one thing
 * needed at that moment. So the empty state carries the primary action, and
 * the `+` keeps its single meaning everywhere.
 *
 * The header keeps the same right-hand cluster as Inicio. Notifications in a
 * shared-expense app are born here, so a bell that only existed on Inicio
 * would turn reading them into a detour through the tab bar.
 */
export default function GroupsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <AppHeader title="groups.title" />

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.xl },
          ]}>
          <View style={[styles.empty, { borderColor: theme.border }]}>
            <SymbolView
              name="person.2"
              size={32}
              tintColor={theme.textTertiary}
              fallback={<View style={[styles.fallback, { borderColor: theme.textTertiary }]} />}
            />
            <ThemedText variant="body" themeColor="textSecondary">
              {t('groups.empty')}
            </ThemedText>
            <ThemedText variant="bodySmall" themeColor="textTertiary">
              {t('groups.emptyHint')}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('groups.create')}
            style={({ pressed }) => [
              styles.create,
              {
                borderColor: theme.borderInteractive,
                backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
                boxShadow: pressed ? Tactile.pressed : Tactile.raised,
              },
            ]}>
            <ThemedText variant="label">{t('groups.create')}</ThemedText>
          </Pressable>
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
  empty: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  create: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
  },
  fallback: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
});
