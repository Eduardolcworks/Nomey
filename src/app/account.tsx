import { Alert, StyleSheet, View } from 'react-native';

import {
  buildSignOutConfirmation,
  forgetLocalSession,
  signOut,
  useAuthSubmit,
} from '@/features/auth';
import { PlaceholderScreen } from '@/features/shell';
import { useSession } from '@/features/session';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, Section, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * The account, and the way out of it.
 *
 * Everything shown here comes from the session that is already in memory.
 * There is no query: `SessionIdentity` carries the name and the address, they
 * were resolved when the session was, and asking the backend again for two
 * strings it already handed us would be a second source that can disagree
 * with the first. It would also be a request that can fail, on a screen whose
 * entire job is to work when things are going badly.
 *
 * What is deliberately NOT here: the token, the refresh token, and
 * `user_metadata` at large. The provider exposes three fields and this screen
 * reads two of them. A screen that rendered the whole metadata object would
 * be showing free-form JSON the account holder controls, on a surface that
 * reads as authoritative.
 *
 * Editing anything - the address, the password, the name - is not this block,
 * and neither is deleting the account.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const { state: session } = useSession();
  const { state: submit, submit: run, clearError, running } = useAuthSubmit();

  /*
   * Only a signed-in session has anything to show, and reaching this screen
   * any other way is not possible: it is registered inside the protected
   * branch, so `Stack.Protected` has already unmounted it by the time the
   * state is anything else. The guard exists to make that a type fact rather
   * than an assumption about navigation - and to render nothing, rather than
   * an empty shell, during the frame in which sign-out is being committed.
   */
  if (session.status !== 'signed-in') return null;

  const { displayName, email } = session.identity;

  function confirmSignOut() {
    const confirmation = buildSignOutConfirmation(
      {
        title: t('account.signOutConfirmTitle'),
        body: t('account.signOutConfirmBody'),
        cancel: t('action.cancel'),
        confirm: t('account.signOut'),
      },
      () => {
        clearError();
        /*
         * No navigation on success, exactly as on the way in. The event
         * reaches the single subscriber in `SessionProvider`, the state
         * becomes `signed-out` and `Stack.Protected` swaps the branch -
         * which also means the user cannot go "back" to Perfil, because
         * the protected branch no longer exists rather than being covered
         * over. A `router.replace('/sign-in')` here would be a second
         * mechanism racing the first, and it would leave history behind.
         */
        void run(signOut);
      },
    );

    Alert.alert(
      confirmation.title,
      confirmation.body,
      confirmation.buttons.map((button) => ({
        text: button.label,
        style: button.role,
        onPress: button.onPress,
      })),
      // Dismissing by tapping outside resolves to cancel, which is the
      // reading that costs nothing if it is wrong.
      { cancelable: true },
    );
  }

  /*
   * Reaching this render at all means sign-out failed AND left us signed in.
   * Every other failure has already removed the session and emitted the
   * event, so the branch is gone and nobody is here to read a message.
   *
   * That is why the local escape sits next to the error rather than being
   * taken automatically: the one surviving failure is the one where the
   * refresh token was unreachable rather than rejected, so the session may
   * well still be valid. Deleting a working credential without telling the
   * server is a trade the user makes, not one made for them - and the hint
   * says plainly what it costs.
   */
  const failed = submit.status === 'failed' ? t(submit.messageKey) : undefined;

  return (
    <PlaceholderScreen title="profile.account">
      <Section title={t('account.details')}>
        <View style={styles.rows}>
          <Detail label={t('account.name')} value={displayName ?? t('account.noName')} />
          <Detail label={t('account.email')} value={email ?? t('account.noEmail')} />
        </View>
      </Section>

      <Section title={t('account.session')}>
        <View style={styles.rows}>
          <ActionButton
            label={running ? t('account.signOutBusy') : t('account.signOut')}
            onPress={confirmSignOut}
            // Disabled AND busy. Disabled alone reads to a screen reader as a
            // broken control; `busy` is what says "working". The exclusive
            // runner behind `run` is the half that actually holds, since a
            // second tap can land before this re-renders.
            disabled={running}
            busy={running}
          />
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('account.signOutHint')}
          </ThemedText>

          {failed === undefined ? null : (
            <View style={styles.failure}>
              <ThemedText
                variant="bodySmall"
                themeColor="negative"
                accessibilityLiveRegion="polite"
                accessibilityRole="alert">
                {failed}
              </ThemedText>
              <ActionButton
                label={t('account.forgetLocal')}
                onPress={() => {
                  clearError();
                  void run(forgetLocalSession);
                }}
                disabled={running}
                busy={running}
              />
              <ThemedText variant="caption" themeColor="textTertiary">
                {t('account.forgetLocalHint')}
              </ThemedText>
            </View>
          )}
        </View>
      </Section>
    </PlaceholderScreen>
  );
}

/**
 * One fact about the account, label above value.
 *
 * Local to this screen. It has one consumer, and lifting it into the design
 * system would be a guess about a second one.
 */
function Detail({ label, value }: { label: string; value: string }) {
  const theme = useTheme();

  return (
    <View
      style={[styles.detail, { borderColor: theme.border, backgroundColor: theme.surface }]}
      // The pair reads as one thing to a screen reader instead of two
      // stranded fragments.
      accessible
      accessibilityLabel={`${label}: ${value}`}>
      <ThemedText variant="caption" themeColor="textTertiary">
        {label}
      </ThemedText>
      <ThemedText variant="body">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: Spacing.sm,
  },
  detail: {
    gap: Spacing.xxs,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
  failure: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
});
