import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useTranslation } from '@/lib/i18n';

import { createRecoveryArrivalHandler } from './recovery-arrival';
import { useRecovery } from './recovery-controller';
import { isRecoveryActive } from './recovery-state';

/**
 * The single owner of the recovery deep link: one subscription, one handler.
 *
 * **`Linking.useURL()` is deliberately not used.** It keeps the last URL in
 * state, and anything that reads it is reading a value rather than an event -
 * so an effect depending on `signedIn` re-ran on sign-out and redeemed a link
 * nobody had re-opened. Measured, and the reason this file is shaped the way
 * it is.
 *
 * What replaces it is the pair `useURL` is built from, used directly:
 * `getInitialURL()` once for the URL that launched the app, and an `url`
 * listener for every later delivery. `addEventListener` is a pass-through to
 * React Native's emitter, so it fires **per delivery** - re-opening the very
 * same link fires again, which is exactly the case the retained value could
 * not represent.
 *
 * The effect has an EMPTY dependency list, and that is the guarantee rather
 * than an optimisation: the subscription is installed once, so no change of
 * session, controller state or locale can re-run the processing. The live
 * values the handler needs are read through a ref at the moment a link
 * arrives, which is when the decision belongs.
 *
 * The token hash never becomes state, a param or a prop, and is never logged.
 */
export function useRecoveryLink({ signedIn }: { signedIn: boolean }): void {
  const { t } = useTranslation();
  const { state, redeem } = useRecovery();

  /**
   * The current values, for a handler that outlives the render that made them.
   *
   * Written on every render and read only inside the handler. A ref rather
   * than dependencies precisely so that changing any of them cannot re-trigger
   * the work.
   */
  const live = useRef({ signedIn, state, redeem, t });

  // Kept current in an effect rather than during render: a ref written while
  // rendering is a value React is entitled to discard, and the lint rule that
  // forbids it is right. This runs after every render, so the handler always
  // reads the latest values without any of them becoming a dependency.
  useEffect(() => {
    live.current = { signedIn, state, redeem, t };
  });

  useEffect(() => {
    const handle = createRecoveryArrivalHandler({
      isSignedIn: () => live.current.signedIn,
      isRecovering: () => isRecoveryActive(live.current.state),
      redeem: (tokenHash) => {
        void live.current.redeem(tokenHash);
      },
      warn: () => {
        /*
         * Neutral, and never naming the account the link belongs to: that
         * would answer "does this address have an account here?" to whoever is
         * holding the phone.
         *
         * An Alert rather than a surface because a surface would take over the
         * tree, and the one thing the person needs to do next - Perfil,
         * Cuenta, Cerrar sesión - lives inside the tree it would cover.
         */
        const { t: translate } = live.current;
        Alert.alert(translate('auth.recoveryBlockedTitle'), translate('auth.recoveryBlockedBody'), [
          { text: translate('action.understood'), style: 'cancel' },
        ]);
      },
    });

    /*
     * `active` covers the gap between an unmount and `getInitialURL` settling.
     * Redeeming after teardown would spend a token for a screen that is gone.
     */
    let active = true;

    void Linking.getInitialURL()
      .then((url) => {
        if (active) handle(url);
      })
      .catch(() => {
        // No launch URL, or the platform refused to say. Neither is a
        // recovery, and neither is worth surfacing.
      });

    const subscription = Linking.addEventListener('url', (event) => {
      if (active) handle(event.url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
}
