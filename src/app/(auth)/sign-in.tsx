import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/session';
import { useTranslation } from '@/lib/i18n';
import { ErrorState, Section, ThemedText, ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * The public destination, and provisional on purpose.
 *
 * F5.B needs a real public branch to have something to protect the rest of the
 * tree against - without one, "signed out" has nowhere to go. It is NOT the
 * sign-in flow: there is no form, no `signInWithPassword`, no sign-up, no
 * recovery and no validation. All of that is F5.C, which will replace the body
 * of this screen rather than work around it.
 *
 * What it does carry is the one branch that has to behave correctly today: if
 * the session could not be resolved, this is where the user lands, and it must
 * offer a way out rather than a dead end.
 */
export default function SignInScreen() {
  const { t } = useTranslation();
  const { state, retry } = useSession();

  if (state.status === 'unavailable') {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.safe}>
          <ErrorState
            title={t('session.unavailableTitle')}
            description={t('session.unavailableBody')}
            retry={{ label: t('action.retry'), onPress: retry }}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ThemedText variant="display">{t('auth.welcomeTitle')}</ThemedText>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.welcomeBody')}
          </ThemedText>

          <Section title={t('auth.comingSoon')}>
            <ThemedText variant="caption" themeColor="textTertiary">
              {t('auth.comingSoonHint')}
            </ThemedText>
          </Section>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
});
