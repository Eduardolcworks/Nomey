import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type MessageKey, useTranslation } from '@/lib/i18n';
import { ThemedText, ThemedView } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * A pushed screen with a title, a back control and whatever the caller shows.
 *
 * Shared by the surfaces that exist to prove the hierarchy navigates rather
 * than to do anything: notifications and profile. Keeping them identical is
 * the point - it makes it obvious on a device that they are the same kind of
 * place, one level down from a root destination.
 *
 * It lives in the shell feature and not in `ui/` because it reads the
 * catalogue, and `ui/` may not import `lib/`.
 */
export function PlaceholderScreen({
  title,
  body,
  children,
}: {
  title: MessageKey;
  body?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.close')}
            hitSlop={Spacing.sm}
            onPress={() => {
              router.back();
            }}
            style={styles.back}>
            <SymbolView
              name="chevron.left"
              size={20}
              tintColor={theme.text}
              fallback={<View style={[styles.fallback, { borderColor: theme.text }]} />}
            />
          </Pressable>
          <ThemedText variant="title">{t(title)}</ThemedText>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {body === undefined ? null : (
            <ThemedText variant="body" themeColor="textSecondary">
              {body}
            </ThemedText>
          )}
          {children}
        </ScrollView>
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
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  fallback: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
});
