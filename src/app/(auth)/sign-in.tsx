import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AuthField,
  AuthScreen,
  missingFields,
  SignInForm,
  signIn,
  signInAnonymously,
  useAuthSubmit,
} from '@/features/auth';
import { useSession } from '@/features/session';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, ErrorState, ThemedText } from '@/ui/components';
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
  const router = useRouter();
  const { state: session, retry } = useSession();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  /*
   * THE GUEST'S NAME, asked before the anonymous session exists. A guest with
   * no name could not create a group (the creator needs one) and would show
   * up nameless to whoever it invites; so the grey link opens this one
   * question, and the name travels with the sign-up as `user_metadata`.
   */
  const [naming, setNaming] = useState(false);
  const [guestName, setGuestName] = useState('');

  /*
   * The session could not be resolved at startup.
   *
   * **The notice accompanies the form; it does not replace it.** An earlier
   * version returned early here and rendered the error alone, which was wrong
   * for a reason that only shows up on a device: `unavailable` means "we could
   * not check whether a session was already stored", and that says nothing
   * about whether signing in with an email and a password would work. Walling
   * off the form turned a recoverable, ten-second failure into a screen with
   * no way forward - exactly the state that has to have an exit.
   *
   * Measured, with the real client against a real stack: an unreachable
   * backend resolves to `unavailable` at 10s while the stored session is
   * deliberately KEPT, because nothing proved it invalid. A session that IS
   * provably invalid - a revoked refresh token - resolves to `signed-out` in
   * about 10ms and clears the storage. So `unavailable` is never a verdict on
   * the credentials, and the form has no reason to disappear.
   *
   * The retry stays visible, and it is the real one: `retry` restarts the
   * whole lifecycle. If the backend is genuinely down, a sign-in attempt
   * simply fails with its own message, which is honest and actionable.
   */
  const sessionUnavailable = session.status === 'unavailable';

  async function onSubmit() {
    const missing = missingFields({ email, password });
    setIncomplete(missing.length > 0);
    if (missing.length > 0) return;

    clearError();
    await submit(() => signIn({ email, password }));
    // No navigation on success. See the note above.
  }

  /*
   * «ENTRAR COMO INVITADO»: a real anonymous session, through the same
   * service and the same event path as a password sign-in. No navigation
   * here either: the public branch goes away, the tabs mount, and the tabs
   * layout starts a guest on Grupos (`initialRouteName`). Nothing to select,
   * nothing to explain, no screen in between.
   */
  async function onGuest() {
    setIncomplete(false);
    clearError();
    await submit(() => signInAnonymously(guestName));
  }

  const error =
    state.status === 'failed'
      ? t(state.messageKey)
      : incomplete
        ? t('auth.missingFields')
        : undefined;

  return (
    <AuthScreen>
      {sessionUnavailable ? (
        <ErrorState
          title={t('session.unavailableTitle')}
          description={t('session.unavailableBody')}
          retry={{ label: t('action.retry'), onPress: retry }}
        />
      ) : null}

      {/*
       * The form is presentation only (`SignInForm`): what "Entrar" means is
       * decided here, against the real Auth. The grey guest link is the real
       * door (F05: Anonymous Auth) and opens the name step below. Providers
       * (Apple, Google) are F8.B: no button and no slot until then.
       */}
      {naming ? (
        <>
          <View style={styles.heading}>
            <ThemedText variant="display">{t('auth.guestNameTitle')}</ThemedText>
          </View>
          <AuthField
            label={t('auth.name')}
            placeholder={t('auth.namePlaceholder')}
            value={guestName}
            onChangeText={setGuestName}
            editable={!running}
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="go"
            onSubmitEditing={() => void onGuest()}
          />
          {state.status === 'failed' ? (
            <ThemedText
              variant="bodySmall"
              themeColor="negative"
              accessibilityLiveRegion="polite"
              accessibilityRole="alert">
              {t(state.messageKey)}
            </ThemedText>
          ) : null}
          <ActionButton
            label={running ? t('auth.working') : t('auth.guestAction')}
            onPress={() => void onGuest()}
            tone="primary"
            disabled={running}
            busy={running}
          />
          <ThemedText
            variant="bodySmall"
            themeColor="textTertiary"
            accessibilityRole="link"
            onPress={() => {
              clearError();
              setNaming(false);
            }}
            style={styles.back}>
            {t('auth.guestNameBack')}
          </ThemedText>
        </>
      ) : (
        <SignInForm
          email={email}
          password={password}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={() => void onSubmit()}
          busy={running}
          error={error}
          onCreateAccount={() => router.push('/(auth)/sign-up')}
          onForgotPassword={() => router.push('/(auth)/forgot-password')}
          onGuest={() => {
            clearError();
            setNaming(true);
          }}
        />
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.xs },
  back: { textAlign: 'center', paddingVertical: Spacing.sm },
});
