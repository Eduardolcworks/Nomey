import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SCOPE_AVAILABLE, SCOPE_LABEL, useScope } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText, ThemedView } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * The surface the action button opens. A placeholder, and honest about it.
 *
 * **It states its own scope in its header.** The action inherits context from
 * where it was pressed, and a sheet that trusted the user to remember the
 * selector behind it is how a couple's dinner ends up in someone's personal
 * books - a plausible figure in both places, and nothing throws. So the scope
 * is repeated here, where the movement would actually be recorded.
 *
 * **Nothing is preselected when it comes from Grupos.** With several groups,
 * defaulting to the last one used would silently attribute an expense to the
 * wrong set of debts, discovered only when settling. Choosing the group will
 * be required rather than defaulted, and that is the semantics this
 * placeholder encodes for F7 to implement.
 */
export default function AddScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { scope } = useScope();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const fromGroups = from === 'groups';
  const available = fromGroups || SCOPE_AVAILABLE[scope];

  const title = fromGroups
    ? t('action.addToGroups')
    : t('action.addTo', { scope: t(SCOPE_LABEL[scope]) });

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <ThemedText variant="title" style={styles.title}>
            {title}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.close')}
            hitSlop={Spacing.sm}
            onPress={() => {
              router.back();
            }}
            style={styles.close}>
            <SymbolView
              name="xmark"
              size={20}
              tintColor={theme.textSecondary}
              fallback={<View style={[styles.fallback, { borderColor: theme.textSecondary }]} />}
            />
          </Pressable>
        </View>

        <View style={styles.body}>
          <GlassSurface level="heavy" style={styles.placeholder}>
            <ThemedText variant="body" themeColor={available ? 'textSecondary' : 'textTertiary'}>
              {fromGroups ? t('groups.emptyHint') : t('home.activityHint')}
            </ThemedText>
            <ThemedText variant="label" themeColor="accent">
              {t('action.soon')}
            </ThemedText>
          </GlassSurface>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  title: {
    flexShrink: 1,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  body: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  placeholder: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  fallback: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
});
