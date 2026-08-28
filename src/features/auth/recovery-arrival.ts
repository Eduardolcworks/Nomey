import { readRecoveryLink } from './recovery-link';

/**
 * What to do when a recovery link ARRIVES, and when it is too early to say.
 *
 * Two rules shape this file, and the second was learned the hard way.
 *
 * **Recovery reacts to a new delivery, never to a retained value.** An earlier
 * version derived from `Linking.useURL()` inside an effect that depended on the
 * session, so signing out re-processed a URL nobody had re-opened and redeemed
 * it. That is why arrivals are function calls here and there is no dependency
 * list anywhere near them.
 *
 * **But a boolean cannot say "we do not know yet".** The next version asked
 * `signedIn: boolean`, and `isSignedIn(restoring)` is `false` - so a cold start
 * launched by a recovery link redeemed during the restore window, while a
 * perfectly good persisted session was still being read out of the keychain.
 * Confirmed on device: the app opened straight into "Nueva contraseña" for
 * someone who was signed in. A link must not be decided against an answer that
 * has not arrived.
 *
 * So the question asked is the session's actual status, and `restoring` gets
 * its own outcome: hold this one arrival, decide when the session resolves.
 *
 * The single exception to "never re-process": an arrival received during
 * `restoring` is explicitly pending, and the transition out of `restoring`
 * resolves it exactly once. It is cleared before the decision is taken, so
 * nothing later - a sign-out, another render, a second transition - can reach
 * it again.
 */

/** The session states this needs to tell apart. Mirrors `SessionState['status']`. */
export type SessionSnapshot = 'restoring' | 'signed-out' | 'signed-in' | 'unavailable';

/** Why a link was refused, so the caller can say the right thing. */
export type RefusalReason =
  /** Somebody is signed in. Sign out and open the link again. */
  | 'signed-in'
  /** The session could not be determined. Fail closed rather than guess. */
  | 'undetermined';

export type RecoveryArrivalPorts = {
  /** The session's status, asked at the moment a decision is actually taken. */
  sessionStatus(): SessionSnapshot;
  /** Whether a recovery transaction is already running. */
  isRecovering(): boolean;
  /** Redeem the proof. Called at most once per hash. */
  redeem(tokenHash: string): void;
  /** Refuse, without spending anything. Never names the account. */
  refuse(reason: RefusalReason): void;
};

export type RecoveryArrivalHandler = {
  /** A link was delivered. The only entry point driven by an event. */
  arrive(url: string | null): void;
  /**
   * The session stopped restoring. Resolves a held arrival, once.
   *
   * Safe to call whenever the session is not `restoring`: with nothing held it
   * does nothing, which is why the caller does not have to detect the edge.
   */
  sessionResolved(): void;
  /** Teardown. Drops anything held. */
  dispose(): void;
};

export function createRecoveryArrivalHandler(ports: RecoveryArrivalPorts): RecoveryArrivalHandler {
  /**
   * Hashes already handed to the server.
   *
   * A hash is single-use: redeeming twice turns a working recovery into a
   * dead-link error. Covers a cold start where the launch URL could reach both
   * `getInitialURL` and the `url` event.
   */
  const spent = new Set<string>();

  /**
   * Links already refused.
   *
   * Only consulted on the refusal paths, which is what makes it safe: once the
   * session is resolved and empty, a genuine re-open is redeemed rather than
   * swallowed. **Nothing clears this on a session change** - a line doing that
   * is what caused an auto-redeem once already.
   */
  const refused = new Set<string>();

  /**
   * The one arrival being held because the session had not answered yet.
   *
   * IN MEMORY, for the length of one restore, and nowhere else: not the
   * keychain, not the auth client's storage, not a route param, not a log. It
   * is not "the token saved for later" - it is the payload of an event whose
   * decision is still pending, and it is dropped the instant that decision is
   * taken or the hook unmounts.
   *
   * Exactly one. A second link arriving mid-restore does not replace it and is
   * not spent either; the person opens whichever one they meant, again.
   */
  let pending: string | null = null;

  function settle(tokenHash: string, status: Exclude<SessionSnapshot, 'restoring'>): void {
    if (status === 'signed-in' || status === 'unavailable') {
      /*
       * `unavailable` FAILS CLOSED. It is not a quiet `signed-out`: it means
       * the session could not be determined, and redeeming on a guess would
       * spend a single-use token for someone who may well be signed in.
       */
      const reason: RefusalReason = status === 'signed-in' ? 'signed-in' : 'undetermined';
      if (!refused.has(tokenHash)) {
        refused.add(tokenHash);
        ports.refuse(reason);
      }
      // The token is NOT marked spent. It stays valid for a later, explicit
      // re-open of the same link.
      return;
    }

    spent.add(tokenHash);
    ports.redeem(tokenHash);
  }

  return {
    arrive(url) {
      const proof = readRecoveryLink(url);
      if (proof === null) return;

      // A transaction is already running: do not start a second one, and do
      // not burn the second link finding that out.
      if (ports.isRecovering()) return;

      if (spent.has(proof.tokenHash)) return;

      const status = ports.sessionStatus();

      if (status === 'restoring') {
        // Too early to decide anything. Hold exactly one.
        if (pending === null) pending = proof.tokenHash;
        return;
      }

      settle(proof.tokenHash, status);
    },

    sessionResolved() {
      if (pending === null) return;

      const status = ports.sessionStatus();
      if (status === 'restoring') return;

      /*
       * Cleared BEFORE deciding, and that ordering is the whole guarantee: the
       * held arrival can be resolved exactly once. A later sign-out finds
       * nothing to act on, which is what stops the auto-redeem this file
       * already had to fix once.
       */
      const tokenHash = pending;
      pending = null;

      if (spent.has(tokenHash)) return;
      settle(tokenHash, status);
    },

    dispose() {
      pending = null;
    },
  };
}
