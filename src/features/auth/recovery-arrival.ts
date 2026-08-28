import { readRecoveryLink } from './recovery-link';

/**
 * What to do when a recovery link ARRIVES.
 *
 * The distinction this module exists to enforce: recovery reacts to a **new
 * delivery of a URL**, never to a URL that happens to still be held in state.
 *
 * The earlier version derived from `Linking.useURL()`, which retains the last
 * URL, inside an effect that depended on `signedIn`. Measured consequence:
 * account A signed in, B's link arrives and is correctly refused - and then A
 * signs out for any reason at all, the effect re-runs against the URL still
 * being held, and the link is redeemed on its own. Nobody re-opened anything.
 * The token was spent and the phone walked into a password reset for a
 * different account.
 *
 * So there is no retained value here and no dependency list. There is a
 * function that gets called once per arrival, and it asks about the session at
 * that moment. A session change cannot invoke it, because nothing is
 * subscribed to a session change - which makes "signing out does nothing on
 * its own" a property of the shape rather than a rule someone has to keep.
 *
 * Pure and injected, with no React and no `expo-linking`, so the behaviour can
 * be executed by tests instead of read.
 */
export type RecoveryArrivalPorts = {
  /** Whether an ordinary session is open, asked at the moment of arrival. */
  isSignedIn(): boolean;
  /** Whether a recovery transaction is already running. */
  isRecovering(): boolean;
  /** Redeem the proof. Called at most once per hash. */
  redeem(tokenHash: string): void;
  /** Tell the person to sign out first. Never names the account. */
  warn(): void;
};

export function createRecoveryArrivalHandler(
  ports: RecoveryArrivalPorts,
): (url: string | null) => void {
  /**
   * Hashes already handed to the server.
   *
   * A hash is single-use: redeeming twice turns a working recovery into a
   * dead-link error. This covers a cold start where the launch URL could reach
   * both `getInitialURL` and the `url` event.
   */
  const spent = new Set<string>();

  /**
   * Links already refused because a session was open.
   *
   * Only ever consulted while signed in, which is what makes it safe: after
   * signing out that branch is not reached at all, so a genuine re-open of the
   * same link is redeemed rather than swallowed. **Nothing clears this on a
   * session change** - a line doing that is precisely what caused the
   * auto-redeem.
   */
  const warned = new Set<string>();

  return function handle(url: string | null): void {
    const proof = readRecoveryLink(url);
    if (proof === null) return;

    // A transaction is already running: do not start a second one, and do not
    // burn the second link finding that out.
    if (ports.isRecovering()) return;

    if (spent.has(proof.tokenHash)) return;

    if (ports.isSignedIn()) {
      // The token is NOT marked spent: it stays valid for after signing out.
      if (warned.has(proof.tokenHash)) return;
      warned.add(proof.tokenHash);
      ports.warn();
      return;
    }

    spent.add(proof.tokenHash);
    ports.redeem(proof.tokenHash);
  };
}
