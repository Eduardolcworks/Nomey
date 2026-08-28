import type { RedeemOutcome } from './recovery-state';

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
 *
 * **And a third rule, learned the same way as the second.** A proof is spent
 * when the SERVER says so, never when a request fails. The previous version
 * marked the hash spent before calling `redeem`, so a `verifyOtp` that never
 * reached GoTrue burned the link locally: the app announced "Enlace no válido"
 * and then ignored every re-open of it in silence, while that exact one-time
 * token sat alive in the database. Measured on device, and confirmed against
 * `auth.one_time_tokens`. So redemption now reports what it established, and
 * only `consumed` and `dead` close the door.
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
  /**
   * Redeem the proof, and report what that established about it.
   *
   * At most one redemption per hash is ever in flight, and a hash is offered
   * again only while nothing has established that it is gone. Implementations
   * must resolve rather than reject: an outcome is required, and `unresolved`
   * is the honest one when nothing was proven.
   */
  redeem(tokenHash: string): Promise<RedeemOutcome>;
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
   * Hashes the SERVER has finished with: consumed, or declared no longer a
   * proof.
   *
   * A hash is single-use, so redeeming twice turns a working recovery into a
   * dead-link error - which is why this exists. What it deliberately does NOT
   * contain is a hash whose redemption merely failed to arrive: that proves
   * nothing about the token, and closing the door on it left people holding a
   * live link the app refused to look at.
   */
  const spent = new Set<string>();

  /**
   * Hashes with a redemption in flight right now.
   *
   * Separate from `spent` because it answers a different question: not "is
   * this proof gone" but "is one attempt already running". It is what keeps a
   * cold start honest when the launch URL reaches both `getInitialURL` and the
   * `url` event within the same tick, before any answer exists - the job
   * `spent` used to do by being written too early. Entries leave it the moment
   * the attempt resolves, however it resolves.
   */
  const attempted = new Set<string>();

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

    /*
     * The ORDER here is the correction. Nothing is spent up front: the attempt
     * is registered, the server is asked, and only its answer may close the
     * door. A failure that never reached it leaves the proof exactly as it
     * found it, so an explicit re-open of the same link tries again.
     *
     * Registering the attempt first is not the same thing: it lasts until the
     * answer arrives and no longer, and its only job is that two deliveries in
     * one tick do not become two `verifyOtp` calls.
     */
    attempted.add(tokenHash);

    void ports.redeem(tokenHash).then(
      (outcome) => {
        attempted.delete(tokenHash);
        if (outcome !== 'unresolved') spent.add(tokenHash);
      },
      () => {
        // A rejection establishes nothing either, so it must not spend the
        // proof. The port is documented not to reject; this is the belt.
        attempted.delete(tokenHash);
      },
    );
  }

  return {
    arrive(url) {
      const proof = readRecoveryLink(url);
      if (proof === null) return;

      // A transaction is already running: do not start a second one, and do
      // not burn the second link finding that out.
      if (ports.isRecovering()) return;

      if (spent.has(proof.tokenHash) || attempted.has(proof.tokenHash)) return;

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

      if (spent.has(tokenHash) || attempted.has(tokenHash)) return;
      settle(tokenHash, status);
    },

    dispose() {
      pending = null;
    },
  };
}
