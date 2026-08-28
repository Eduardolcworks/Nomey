import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useTranslation } from '@/lib/i18n';

import {
  createRecoveryArrivalHandler,
  type RecoveryArrivalHandler,
  type RefusalReason,
  type SessionSnapshot,
} from './recovery-arrival';
import { useRecovery } from './recovery-controller';
import { isRecoveryActive } from './recovery-state';

/**
 * The single owner of the recovery deep link: one subscription, one handler.
 *
 * **`Linking.useURL()` is deliberately not used.** It keeps the last URL in
 * state, and reading a retained value is not reacting to an event - an effect
 * depending on the session re-ran on sign-out and redeemed a link nobody had
 * re-opened. What replaces it is the pair `useURL` is built from:
 * `getInitialURL()` once for the launch URL, and an `url` listener for every
 * later delivery. `addEventListener` fires per delivery, so re-opening the very
 * same link fires again.
 *
 * **The session's STATUS is passed, not a boolean.** `isSignedIn(restoring)` is
 * `false`, so a boolean cannot distinguish "nobody is signed in" from "we have
 * not finished looking" - and a cold start launched by a recovery link redeemed
 * during the restore window while a persisted session was still being read.
 * Confirmed on device. The status makes `restoring` a case of its own.
 *
 * The subscription effect has an EMPTY dependency list: it is installed once,
 * so nothing can re-run the processing. The live values are read through a ref
 * at the moment a link arrives, which is when the decision belongs.
 *
 * The one state-driven call is `sessionResolved`, and it is deliberately narrow:
 * it resolves an arrival that was explicitly held, once, and can do nothing at
 * any other time.
 */
export function useRecoveryLink({ sessionStatus }: { sessionStatus: SessionSnapshot }): void {
  const { t } = useTranslation();
  const { state, redeem } = useRecovery();

  /**
   * The current values, for a handler that outlives the render that made them.
   *
   * A ref rather than dependencies precisely so that changing any of them
   * cannot re-trigger the work.
   */
  const live = useRef({ sessionStatus, state, redeem, t });

  // Kept current in an effect rather than during render: a ref written while
  // rendering is a value React is entitled to discard. Declared first so it is
  // already fresh when the effects below run.
  useEffect(() => {
    live.current = { sessionStatus, state, redeem, t };
  });

  const handler = useRef<RecoveryArrivalHandler | null>(null);

  useEffect(() => {
    const arrival = createRecoveryArrivalHandler({
      sessionStatus: () => live.current.sessionStatus,
      isRecovering: () => isRecoveryActive(live.current.state),
      /*
       * The promise is RETURNED, not fired and forgotten. What comes back is
       * the arrival handler's only way to know whether the proof was actually
       * spent, and discarding it is what let a failed request burn a live link.
       */
      redeem: (tokenHash) => live.current.redeem(tokenHash),
      refuse: (reason: RefusalReason) => {
        /*
         * Neutral, and never naming the account the link belongs to: that would
         * answer "does this address have an account here?" to whoever is
         * holding the phone.
         *
         * An Alert rather than a surface because a surface would take over the
         * tree, and the one thing the person needs to do next - Perfil, Cuenta,
         * Cerrar sesión - lives inside the tree it would cover.
         */
        const { t: translate } = live.current;
        const title =
          reason === 'signed-in' ? 'auth.recoveryBlockedTitle' : 'auth.recoveryUndeterminedTitle';
        const body =
          reason === 'signed-in' ? 'auth.recoveryBlockedBody' : 'auth.recoveryUndeterminedBody';

        Alert.alert(translate(title), translate(body), [
          { text: translate('action.understood'), style: 'cancel' },
        ]);
      },
    });

    handler.current = arrival;

    /*
     * `active` covers the gap between an unmount and `getInitialURL` settling.
     * Redeeming after teardown would spend a token for a screen that is gone.
     */
    let active = true;

    void Linking.getInitialURL()
      .then((url) => {
        if (active) arrival.arrive(url);
      })
      .catch(() => {
        // No launch URL, or the platform refused to say. Neither is a recovery,
        // and neither is worth surfacing.
      });

    const subscription = Linking.addEventListener('url', (event) => {
      if (active) arrival.arrive(event.url);
    });

    return () => {
      active = false;
      subscription.remove();
      arrival.dispose();
      handler.current = null;
    };
  }, []);

  /*
   * The ONE place a state change may resolve an arrival, and only an arrival
   * that was explicitly held while the session was still restoring. With
   * nothing held this does nothing, so `signed-in -> signed-out` and every
   * other later transition cannot reprocess anything.
   *
   * Declared after the subscription effect so the handler exists by the time
   * this first runs.
   */
  useEffect(() => {
    if (sessionStatus === 'restoring') return;
    handler.current?.sessionResolved();
  }, [sessionStatus]);
}
