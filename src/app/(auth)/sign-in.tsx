import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import { AuthField, AuthScreen, missingFields, signIn, useAuthSubmit } from '@/features/auth';
import { useSession } from '@/features/session';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, ErrorState, ThemedText, ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * Signing in.
 *
 * There is no `router.replace` here, and that is the design rather than an
 * omission. A successful `signInWithPassword` emits an auth event, the
 * provider from F5.B is the single subscriber, the state becomes `signed-in`
 * and `Stack.Protected` swaps the branch. Navigating imperatively as well
 * would be a second mechanism racing the first, and the loser would decide
 * what the user sees.
 *
 * Nothing on this screen keeps a session, a token or a user. It collects two
 * strings and hands them to `features/auth`.
 */
export default function SignInScreen() {
  const { t } = useTranslation();
  const { state: session, retry } = useSession();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const passwordField = useRef<TextInput>(null);

  // The session could not be resolved at startup. Offering a sign-in form on
  // top of that would be asking the user to fix something that is not theirs.
  if (session.status === 'unavailable') {
    return (
      <ThemedView style={styles.screen}>
        <ErrorState
          fill
          title={t('session.unavailableTitle')}
          description={t('session.unavailableBody')}
          retry={{ label: t('action.retry'), onPress: retry }}
        />
      </ThemedView>
    );
  }

  async function onSubmit() {
    const missing = missingFields({ email, password });
    setIncomplete(missing.length > 0);
    if (missing.length > 0) return;

    clearError();
    await submit(() => signIn({ email, password }));
    // No navigation on success. See the note above.
  }

  const error =
    state.status === 'failed'
      ? t(state.messageKey)
      : incomplete
        ? t('auth.missingFields')
        : undefined;

  return (
    <AuthScreen>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('auth.signInTitle')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('auth.signInSubtitle')}
        </ThemedText>
      </View>

      <View style={styles.form}>
        <AuthField
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          editable={!running}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          // Makes "next" mean something. Moving focus from the keyboard
          // instead of tapping is also one fewer chance for the layout to
          // shift under the user's finger.
          onSubmitEditing={() => passwordField.current?.focus()}
          submitBehavior="submit"
        />
        <AuthField
          ref={passwordField}
          label={t('auth.password')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          editable={!running}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
        />
      </View>

      {/*
       * The message is a live region so a screen reader announces a failed
       * attempt, which otherwise happens silently. It is text, never a colour
       * on its own.
       */}
      {error === undefined ? null : (
        <ThemedText
          variant="bodySmall"
          themeColor="negative"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          {error}
        </ThemedText>
      )}

      <ActionButton
        label={running ? t('auth.working') : t('auth.signInAction')}
        onPress={() => void onSubmit()}
        tone="primary"
        disabled={running}
        busy={running}
      />

      <Link href="/(auth)/sign-up" asChild>
        <ThemedText
          variant="bodySmall"
          themeColor="accent"
          accessibilityRole="link"
          style={styles.switch}>
          {t('auth.toSignUp')}
        </ThemedText>
      </Link>

      {/*
       * Below "create an account", and quieter than both.
       *
       * Recovering access is the rarest of the three things this screen can
       * lead to, and the only one that starts from a problem. It gets the
       * tertiary colour rather than the accent so it reads as a way out
       * rather than as a third thing to consider.
       */}
      <Link href="/(auth)/forgot-password" asChild>
        <ThemedText
          variant="bodySmall"
          themeColor="textTertiary"
          accessibilityRole="link"
          style={styles.switch}>
          {t('auth.forgotAction')}
        </ThemedText>
      </Link>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
  switch: { textAlign: 'center', paddingVertical: Spacing.sm },
});
