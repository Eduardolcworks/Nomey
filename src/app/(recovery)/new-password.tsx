import { useRef, useState } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import {
  type AuthErrorKey,
  AuthField,
  AuthScreen,
  createExclusiveRunner,
  passwordProblem,
  SKIPPED,
  useRecovery,
} from '@/features/auth';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, IconButton, LoadingState, ThemedText } from '@/ui/components';
import { Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * The whole recovery transaction, as one surface.
 *
 * It renders every state the controller can be in - redeeming, recovering,
 * error, completed - rather than pushing between routes, because a recovery is
 * one transaction and its steps are not places. Nothing here navigates.
 *
 * **This screen cannot be reached without a redeemed link.** It is mounted
 * only while the recovery controller is active, and the controller becomes
 * active only because `verifyOtp` succeeded against the ephemeral client. The
 * session behind it lives in that client's memory and nowhere else; the main
 * `SessionProvider` stays `signed-out` throughout, truthfully, because the main
 * client holds nothing.
 *
 * It shows no name and no email. Whoever holds the phone opened a link from an
 * inbox, and printing the account's address back at them confirms whose it is.
 *
 * **Killing the app here loses the recovery, deliberately.** The ephemeral
 * session is never written down, so there is nothing to resume and no
 * "continue where you left off". The next launch is the sign-in screen and the
 * person asks for a new link - which is the correct outcome for a password
 * change nobody finished.
 */
export default function RecoveryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state, setPassword, dismiss } = useRecovery();

  const [password, setPasswordText] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  /**
   * What the last save answered, shown in the SAME slot as the local checks.
   *
   * A failed save is not the end of the recovery: the link was already
   * redeemed and the ephemeral session is still usable, so the form stays,
   * what was typed stays, and saving again is the retry. Sending someone to a
   * terminal screen for a rejected password cost them a link they had not
   * spent wrongly.
   */
  const [saveError, setSaveError] = useState<AuthErrorKey | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmField = useRef<TextInput>(null);

  /*
   * One submission at a time, for the same reason every other form in this
   * feature has one: disabling the button is the visible half, and between the
   * tap and the re-render there is a window. Two saves of the same password
   * would be two `PUT /user` calls on a session meant to be spent once.
   */
  const run = useRef(createExclusiveRunner()).current;

  async function onSubmit() {
    const problem = passwordProblem(password, confirmation);
    setLocal(problem);
    // Whatever the last attempt said is about the last attempt, not this one.
    setSaveError(null);
    if (problem !== null) return;

    /*
     * `busy` is released in a `finally`, and that is the whole point of the
     * shape. A spinner that never clears is exactly what an unhandled
     * rejection looks like from the outside - the failure this flow already
     * chased once - so nothing between here and the release is allowed to
     * skip it.
     *
     * The one case that must NOT release it is a skipped submission: the first
     * one is still running and owns the state.
     */
    let skipped = false;
    setBusy(true);
    try {
      const answer = await run(async () => setPassword(password));
      if (answer === SKIPPED) {
        skipped = true;
      } else {
        // On success this is `null` and the controller has already moved to
        // `completed`, so the slot is cleared for a screen that is going away.
        setSaveError(answer);
      }
    } finally {
      if (!skipped) setBusy(false);
    }
  }

  if (state.status === 'redeeming') {
    return (
      <AuthScreen>
        <LoadingState label={t('auth.recoveryChecking')} />
      </AuthScreen>
    );
  }

  if (state.status === 'completed') {
    return (
      <AuthScreen>
        <View style={styles.heading}>
          <ThemedText variant="display">{t('auth.newPasswordDoneTitle')}</ThemedText>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.newPasswordDoneBody')}
          </ThemedText>
        </View>
        <ActionButton label={t('auth.checkEmailBack')} onPress={dismiss} tone="primary" />
      </AuthScreen>
    );
  }

  /*
   * A refused link is terminal for THIS link and nothing else: the way forward
   * is a new one, so the only action is back to sign-in. It never offers a
   * retry, because used, expired and invented are the same answer and none of
   * them gets better by asking again.
   *
   * **The title comes from the state, and that is the point.** Only a server
   * that said the proof is gone gets "Enlace no válido"; a redemption that
   * never reached it gets a title that claims nothing about the link, because
   * the link may still be good - measured, it was. There is still no retry
   * button: re-opening the link is the retry, and it works again now.
   */
  if (state.status === 'error') {
    return (
      <AuthScreen>
        <View style={styles.heading}>
          <ThemedText variant="display">{t(state.titleKey)}</ThemedText>
          <ThemedText
            variant="body"
            themeColor="textSecondary"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert">
            {t(state.messageKey)}
          </ThemedText>
        </View>
        <ActionButton label={t('auth.checkEmailBack')} onPress={dismiss} tone="primary" />
      </AuthScreen>
    );
  }

  const error =
    local === 'empty'
      ? t('authError.passwordRequired')
      : local === 'mismatch'
        ? t('authError.passwordMismatch')
        : saveError !== null
          ? t(saveError)
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
            onChangeText={setPasswordText}
            editable={!busy}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmField.current?.focus()}
            submitBehavior="submit"
          />
          {/*
           * One toggle for both fields. Two could disagree, and a confirmation
           * you can read while the original is hidden is not a confirmation.
           */}
          <IconButton
            name={visible ? Symbols.conceal : Symbols.reveal}
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
          editable={!busy}
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
        label={busy ? t('auth.working') : t('auth.newPasswordAction')}
        onPress={() => void onSubmit()}
        tone="primary"
        disabled={busy}
        busy={busy}
      />

      {/*
       * The explicit way out, and the ONLY one now that a failed save keeps
       * the form. Without it, a save that cannot succeed - an ephemeral
       * session that stopped being usable, say - would leave the recovery
       * branch owning the screen with nothing to press. `dismiss` discards the
       * ephemeral client, so leaving costs the link: it is deliberately the
       * quiet option next to Guardar, not a second offer.
       */}
      <ActionButton
        label={t('auth.checkEmailBack')}
        onPress={dismiss}
        tone="secondary"
        disabled={busy}
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
