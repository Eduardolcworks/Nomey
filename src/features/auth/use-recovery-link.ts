import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';

import { redeemRecovery } from './auth-service';
import { readRecoveryLink } from './recovery-link';

/**
 * The single owner of the recovery deep link.
 *
 * One hook, mounted once at the composition root. Everything else in the app
 * learns that a recovery is happening the same way it learns anything else
 * about the session: from `useSession()`, because redeeming the proof emits
 * `PASSWORD_RECOVERY` and the lifecycle turns that into `recovering`.
 *
 * **The token hash never becomes state, a param or a prop.** It is read out of
 * the URL, handed to `verifyOtp`, and forgotten - there is no `useState`
 * holding it, nothing is passed to a screen, and the router never sees it.
 * That matters because expo-router keeps params for the life of a route: a
 * hash parked in navigation state would outlive its single use and end up in
 * whatever inspects navigation - which on a bad day is a crash reporter.
 *
 * It is also never logged. The one thing this reports is that a link failed,
 * and it reports that through the session state and the screen, not through
 * the console.
 *
 * `Linking.useURL()` covers both arrivals with one subscription: the URL that
 * launched a cold app, and the one delivered to a running one. Handling them
 * separately - `getInitialURL` plus a listener - is the shape that
 * double-redeems, because both fire for the same launch.
 */
export function useRecoveryLink(): void {
  const url = Linking.useURL();

  /**
   * Hashes already handed to the server, so a re-render cannot spend one
   * twice.
   *
   * `useURL` re-emits the same value across re-renders, and a hash is
   * single-use: the first redemption succeeds and a second answers `403`,
   * which would replace a working recovery with a dead-link error. A ref
   * rather than state, because remembering this must not cause a render.
   */
  const spent = useRef<string | null>(null);

  useEffect(() => {
    const proof = readRecoveryLink(url);
    if (proof === null) return;
    if (spent.current === proof.tokenHash) return;

    spent.current = proof.tokenHash;

    // Nothing is done with the result here. Success emits PASSWORD_RECOVERY
    // and the tree moves; failure leaves the session as it was, and the
    // public branch is where an unusable link should land.
    void redeemRecovery(proof.tokenHash);
  }, [url]);
}
