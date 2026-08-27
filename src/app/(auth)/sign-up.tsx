import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthField, missingFields, normaliseEmail, signUp, useAuthSubmit } from '@/features/auth';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, Section, ThemedText, ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * Creating an account.
 *
 * With confirmations mandatory this never produces a session, so unlike
 * sign-in there IS a screen change to make - but it stays inside the public
 * branch: the form gives way to "check your email". The branch swap is still
 * the session provider's job, and it happens later, when the confirmed user
 * signs in.
 *
 * The name is collected here and goes to Auth as `display_name` metadata.
 * Presentation only: it is not an identity, it never appears in RLS, and it
 * never resolves a membership or a scope.
 */
export default function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit() {
    const missing = missingFields({ displayName, email, password });
    setIncomplete(missing.length > 0);
    if (missing.length > 0) return;

    clearError();
    const result = await submit(() => signUp({ displayName, email, password }));
    if (result?.ok === true) setSentTo(normaliseEmail(email));
  }

  if (sentTo !== null) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.content}>
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
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const error =
    state.status === 'failed'
      ? t(state.messageKey)
      : incomplete
        ? t('auth.missingFields')
        : undefined;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
            <View style={styles.heading}>
              <ThemedText variant="display">{t('auth.signUpTitle')}</ThemedText>
              <ThemedText variant="body" themeColor="textSecondary">
                {t('auth.signUpSubtitle')}
              </ThemedText>
            </View>

            <View style={styles.form}>
              <AuthField
                label={t('auth.name')}
                placeholder={t('auth.namePlaceholder')}
                value={displayName}
                onChangeText={setDisplayName}
                editable={!running}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
              />
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
              />
              <AuthField
                label={t('auth.password')}
                placeholder={t('auth.passwordPlaceholder')}
                value={password}
                onChangeText={setPassword}
                editable={!running}
                secureTextEntry
                autoCapitalize="none"
                // `new-password` so the OS offers to generate and store one
                // rather than autofilling the current one.
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
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
    gap: Spacing.lg,
  },
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
  switch: { textAlign: 'center', paddingVertical: Spacing.sm },
});
