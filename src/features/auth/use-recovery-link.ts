import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useTranslation } from '@/lib/i18n';

import { useRecovery } from './recovery-controller';
import { isRecoveryActive } from './recovery-state';
import { readRecoveryLink } from './recovery-link';

/**
 * The single owner of the recovery deep link, and the gate in front of it.
 *
 * One hook, mounted once at the composition root, above every branch: a link
 * can arrive while the app is cold, while it sits on the sign-in screen, or
 * while it is already open, and a listener living inside a branch would miss
 * whichever arrivals its branch was not mounted for.
 *
 * **The token hash never becomes state, a param or a prop.** It is read out of
 * the URL, handed to the controller, and forgotten. expo-router keeps params
 * for the life of a route, so a hash parked in navigation state would outlive
 * its single use and end up in whatever inspects navigation. It is never
 * logged either.
 *
 * TWO REFUSALS, and neither spends the token.
 *
 * **An ordinary session is already open.** Measured before deciding: nothing
 * stopped this, and the result was two identities at once - account A signed
 * in and persisted, account B's recovery session live in memory - with the
 * recovery surface hiding the product from A. So a link arriving now is not
 * redeemed at all: `verifyOtp` is never called, the token stays valid, and the
 * person is told to sign out and open the link again.
 *
 * That notice is an `Alert` rather than a surface, and the reason is
 * practical rather than aesthetic: a surface would take over the tree, and the
 * one thing the person needs to do next - reach Perfil, then Cuenta, then
 * Cerrar sesión - lives inside the tree it would be covering.
 *
 * **A recovery is already in flight.** A second link does not start a second
 * transaction and does not silently replace the session of the first. It is
 * ignored without being redeemed, so its token survives.
 *
 * WHY THE WARNING IS REMEMBERED, and why the redemption path clears it.
 * `Linking.useURL()` stores the URL with `setLink(event.url)`, and React bails
 * out of an identical string - so re-delivering the same link to a running app
 * does not re-run this effect. The refusal therefore has to be remembered per
 * URL, or signing out would re-trigger the notice; and it has to be forgotten
 * the moment the session goes away, or the very link the person was told to
 * re-open could never be redeemed.
 */
export function useRecoveryLink({ signedIn }: { signedIn: boolean }): void {
  const url = Linking.useURL();
  const { t } = useTranslation();
  const { state, redeem } = useRecovery();

  /**
   * Hashes already handed to the server, so a re-render cannot spend one twice.
   *
   * `useURL` re-emits the same value across re-renders, and a hash is
   * single-use: the first redemption succeeds and a second answers 403, which
   * would replace a working recovery with a dead-link error.
   */
  const spent = useRef<string | null>(null);

  /** Links already refused for an open session. Never marked as spent. */
  const warned = useRef<string | null>(null);

  useEffect(() => {
    const proof = readRecoveryLink(url);
    if (proof === null) return;

    // A transaction is already running. Do not start a second one, and do not
    // burn the second link doing it.
    if (isRecoveryActive(state)) return;

    if (spent.current === proof.tokenHash) return;

    if (signedIn) {
      if (warned.current === proof.tokenHash) return;
      warned.current = proof.tokenHash;
      /*
       * Neutral on purpose. It never names the account the link belongs to,
       * because that would answer "does this address have an account here?"
       * to whoever is holding the phone - the enumeration this whole flow
       * refuses to do anywhere else.
       */
      Alert.alert(t('auth.recoveryBlockedTitle'), t('auth.recoveryBlockedBody'), [
        { text: t('action.understood'), style: 'cancel' },
      ]);
      return;
    }

    // Signed out now. The link the person was told to re-open must work, so
    // the refusal is forgotten before redeeming.
    warned.current = null;
    spent.current = proof.tokenHash;
    void redeem(proof.tokenHash);
  }, [url, signedIn, state, redeem, t]);
}
