import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthField, AuthScreen, requestPasswordReset, useAuthSubmit } from '@/features/auth';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * Asking for a recovery link.
 *
 * **The answer is neutral, and it is neutral because it is true.** Measured
 * against this GoTrue: `POST /recover` answers `200` for an address with no
 * account exactly as it does for one with an account. So the confirmation
 * below is not a polite fiction covering a result we know - we were not told
 * anything to cover. Nothing on this screen can distinguish the two cases, and
 * nothing should ever be added that could.
 *
 * That is also why success is a state of this screen rather than a push to
 * another one: there is nothing to navigate to, and a route named something
 * like `/recovery-sent` would be a URL asserting an outcome we do not know.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    clearError();
    const result = await submit(() => requestPasswordReset(email));
    if (result?.ok === true) setSent(true);
  }

  if (sent) {
    return (
      <AuthScreen>
        <View style={styles.heading}>
          <ThemedText variant="display">{t('auth.recoverSentTitle')}</ThemedText>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.recoverSentBody')}
          </ThemedText>
          <ThemedText variant="bodySmall" themeColor="textTertiary">
            {t('auth.recoverSentHint')}
          </ThemedText>
        </View>

        <Link href="/(auth)/sign-in" asChild>
          <ThemedText
            variant="bodySmall"
            themeColor="accent"
            accessibilityRole="link"
            style={styles.switch}>
            {t('auth.checkEmailBack')}
          </ThemedText>
        </Link>
      </AuthScreen>
    );
  }

  const error = state.status === 'failed' ? t(state.messageKey) : undefined;

  return (
    <AuthScreen>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('auth.recoverTitle')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('auth.recoverSubtitle')}
        </ThemedText>
      </View>

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
        returnKeyType="go"
        onSubmitEditing={() => void onSubmit()}
      />

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
        label={running ? t('auth.working') : t('auth.recoverSend')}
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
          {t('auth.checkEmailBack')}
        </ThemedText>
      </Link>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.xs },
  switch: { textAlign: 'center', paddingVertical: Spacing.sm },
});
