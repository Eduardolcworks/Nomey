import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type MessageKey, useTranslation } from '@/lib/i18n';
import { IconButton, ThemedText, ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * A pushed screen with a title, a back control and whatever the caller shows.
 *
 * Shared by every surface one level down from a root destination. Keeping
 * them identical is the point: it makes it obvious on a device that they are
 * the same kind of place.
 *
 * **The name is now older than the fact.** It was written when notifications
 * and profile existed only to prove the hierarchy navigated; since F5.D,
 * Perfil and Cuenta do real work on it. Renaming it would touch every
 * consumer for no behavioural gain, so the name stays and this note carries
 * the correction - what it provides is pushed-screen chrome, not a
 * placeholder.
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
  const router = useRouter();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <IconButton
            name="chevron.left"
            label={t('action.close')}
            size={20}
            onPress={() => {
              router.back();
            }}
          />
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
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
});
