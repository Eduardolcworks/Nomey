import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';

import { readRecoveryLink } from './recovery-link';
import { useRecovery } from './recovery-controller';

/**
 * The single owner of the recovery deep link.
 *
 * One hook, mounted once at the composition root, above every branch: a link
 * can arrive while the app is cold, while it sits on the sign-in screen, or
 * while it is already open, and a listener living inside a branch would miss
 * whichever arrivals its branch was not mounted for.
 *
 * **The token hash never becomes state, a param or a prop.** It is read out of
 * the URL, handed to the controller, and forgotten - nothing is passed to a
 * screen and the router never sees it. That matters because expo-router keeps
 * params for the life of a route: a hash parked in navigation state would
 * outlive its single use and end up in whatever inspects navigation, which on
 * a bad day is a crash reporter. It is never logged either.
 *
 * `Linking.useURL()` covers both arrivals with one subscription: the URL that
 * launched a cold app, and the one delivered to a running one. Handling them
 * separately - `getInitialURL` plus a listener - is the shape that
 * double-redeems, because both fire for the same launch.
 */
export function useRecoveryLink(): void {
  const url = Linking.useURL();
  const { redeem } = useRecovery();

  /**
   * Hashes already handed to the server, so a re-render cannot spend one twice.
   *
   * `useURL` re-emits the same value across re-renders, and a hash is
   * single-use: the first redemption succeeds and a second answers 403, which
   * would replace a working recovery with a dead-link error. A ref rather than
   * state, because remembering this must not cause a render.
   */
  const spent = useRef<string | null>(null);

  useEffect(() => {
    const proof = readRecoveryLink(url);
    if (proof === null) return;
    if (spent.current === proof.tokenHash) return;

    spent.current = proof.tokenHash;
    void redeem(proof.tokenHash);
  }, [url, redeem]);
}
