import { useRef, useState } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import {
  AuthField,
  AuthScreen,
  completeRecovery,
  passwordProblem,
  useAuthSubmit,
} from '@/features/auth';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, IconButton, ThemedText } from '@/ui/components';
import { Spacing, useTheme } from '@/ui/theme';

/**
 * Choosing the new password.
 *
 * **This screen cannot be reached without a redeemed recovery.** It is not
 * guarded by a flag it sets itself: it is mounted only while the session state
 * is `recovering`, and that state exists only because `verifyOtp` answered
 * successfully and the server emitted `PASSWORD_RECOVERY`. A signed-out person
 * cannot navigate here, and if they somehow did, `updateUser` would be an
 * unauthenticated call and fail - the routing is convenience, the session is
 * the authority.
 *
 * It shows no name and no email. The recovering state carries no identity on
 * purpose: whoever is holding the phone opened a link from an inbox, and
 * printing the account's address back at them would confirm whose it is.
 *
 * On success the session that the link created is closed, so the ending is the
 * public branch and a normal sign-in. Nothing here navigates: the sign-out
 * emits the event, `recovering` clears, and the tree moves by itself.
 */
export default function NewPasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const confirmField = useRef<TextInput>(null);

  async function onSubmit() {
    const problem = passwordProblem(password, confirmation);
    setLocal(problem);
    if (problem !== null) return;

    clearError();
    const result = await submit(() => completeRecovery(password));
    /*
     * The success frame is shown, and then the sign-out inside
     * `completeRecovery` takes the branch away. Setting it is not pointless:
     * the two happen in the same beat, and without it the screen would blank
     * with no confirmation that anything worked.
     */
    if (result?.ok === true) setDone(true);
  }

  if (done) {
    return (
      <AuthScreen>
        <View style={styles.heading}>
          <ThemedText variant="display">{t('auth.newPasswordDoneTitle')}</ThemedText>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.newPasswordDoneBody')}
          </ThemedText>
        </View>
      </AuthScreen>
    );
  }

  const error =
    state.status === 'failed'
      ? t(state.messageKey)
      : local === 'empty'
        ? t('authError.passwordRequired')
        : local === 'mismatch'
          ? t('authError.passwordMismatch')
          : undefined;

  return (
    <AuthScreen>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('auth.newPasswordTitle')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('auth.newPasswordSubtitle')}
        </ThemedText>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <AuthField
            label={t('auth.newPassword')}
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            editable={!running}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmField.current?.focus()}
            submitBehavior="submit"
          />
          {/*
           * One toggle for both fields. Two would let them disagree, and a
           * confirmation you can read while the original is hidden defeats
           * the point of having a confirmation at all.
           */}
          <IconButton
            name={visible ? 'eye.slash' : 'eye'}
            label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
            size={18}
            colour={theme.textSecondary}
            onPress={() => setVisible((shown) => !shown)}
            style={styles.reveal}
          />
        </View>

        <AuthField
          ref={confirmField}
          label={t('auth.newPasswordConfirm')}
          placeholder={t('auth.passwordPlaceholder')}
          value={confirmation}
          onChangeText={setConfirmation}
          editable={!running}
          secureTextEntry={!visible}
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
        label={running ? t('auth.working') : t('auth.newPasswordAction')}
        onPress={() => void onSubmit()}
        tone="primary"
        disabled={running}
        busy={running}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
  field: { justifyContent: 'center' },
  reveal: { position: 'absolute', right: Spacing.xs, bottom: 4 },
});
