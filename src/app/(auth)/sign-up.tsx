import { Link, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import {
  AuthField,
  AuthScreen,
  missingFields,
  normaliseEmail,
  passwordProblem,
  signUp,
  useAuthSubmit,
} from '@/features/auth';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, Section, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * Creating an account. **Three fields, and none of them an identity**
 * (F12/ADR-008).
 *
 * Correo · Contraseña · Confirmar contraseña. Name and username used to live
 * here and now belong to the gate, once the address is confirmed and the
 * account exists: creating an account and choosing a public identity are two
 * decisions, and asking for the second before the first exists charged for it
 * too early. The server allows it since `20261008120000`, where
 * `sec.before_user_created` stopped refusing an email sign-up with no
 * `requested_username`.
 *
 * With confirmations mandatory this never produces a session, so unlike
 * sign-in there IS a screen change to make - but it stays inside the public
 * branch: the form gives way to "check your email". The branch swap is still
 * the session provider's job, and it happens later, when the confirmed user
 * signs in — and lands on the gate before the tabs.
 *
 * **The confirmation is not a second password policy.** GoTrue owns length,
 * character classes and everything else, exactly as before. This checks the
 * one thing the server cannot, because it never receives the second box: that
 * the two agree. It exists to catch a typo in a value nobody can read back.
 *
 * **Two eyes, one per field.** Each `AuthField` with `revealable` holds its
 * own reveal state, so showing the confirmation does not show the password.
 * This deliberately differs from `(recovery)/new-password.tsx`, which shares
 * one toggle: that screen argued a confirmation you can read while the
 * original is hidden is not a confirmation, and the product decided the
 * opposite for this one — each field answers for itself.
 */
export default function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const passwordField = useRef<TextInput>(null);
  const confirmField = useRef<TextInput>(null);

  async function onSubmit() {
    const missing = missingFields({ email, password });
    setIncomplete(missing.length > 0);
    // `empty` is already covered by `missingFields`; what is left for this one
    // to say is that the two boxes disagree.
    const problem = missing.length > 0 ? null : passwordProblem(password, confirmation);
    setMismatch(problem === 'mismatch');
    if (missing.length > 0 || problem !== null) return;

    clearError();
    const result = await submit(() => signUp({ email, password }));
    if (result?.ok === true) setSentTo(normaliseEmail(email));
  }

  if (sentTo !== null) {
    return (
      <AuthScreen>
        <View style={styles.heading}>
          <ThemedText variant="display">{t('auth.checkEmailTitle')}</ThemedText>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.checkEmailBody', { email: sentTo })}
          </ThemedText>
        </View>

        <Section title={t('auth.checkEmailTitle')}>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.checkEmailStep')}
          </ThemedText>
        </Section>

        <ActionButton
          label={t('auth.checkEmailBack')}
          tone="primary"
          onPress={() => {
            router.replace('/(auth)/sign-in');
          }}
        />
      </AuthScreen>
    );
  }

  const error =
    state.status === 'failed'
      ? t(state.messageKey)
      : incomplete
        ? t('auth.missingFields')
        : mismatch
          ? t('authError.passwordMismatch')
          : undefined;

  return (
    <AuthScreen>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('auth.signUpTitle')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('auth.signUpSubtitle')}
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
          revealable
          autoCapitalize="none"
          // `new-password` so the OS offers to generate and store one rather
          // than autofilling the current one.
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmField.current?.focus()}
          submitBehavior="submit"
        />
        <AuthField
          ref={confirmField}
          label={t('auth.passwordConfirm')}
          placeholder={t('auth.passwordPlaceholder')}
          value={confirmation}
          onChangeText={setConfirmation}
          editable={!running}
          revealable
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
        />
      </View>

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
        label={running ? t('auth.working') : t('auth.signUpAction')}
        onPress={() => void onSubmit()}
        tone="primary"
        disabled={running}
        busy={running}
      />

      <Link href="/(auth)/sign-in" asChild>
        <ThemedText
          variant="bodySmall"
          themeColor="accent"
          accessibilityRole="link"
          style={styles.switch}>
          {t('auth.toSignIn')}
        </ThemedText>
      </Link>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
  switch: { textAlign: 'center', paddingVertical: Spacing.sm },
});
