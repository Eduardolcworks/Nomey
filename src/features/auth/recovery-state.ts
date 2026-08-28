import type { AuthErrorKey, RecoveryErrorTitleKey } from './auth-errors';

/**
 * The states one password recovery can be in.
 *
 * Split from the provider for the same reason `session-state.ts` is split from
 * `session-provider.tsx`: this is the part with rules in it, and a module that
 * imports React or Supabase cannot be executed by Vitest. Here it can be.
 *
 * **This is a transaction, not an identity.** There is no user, no token, no
 * `restoring` and no way to resume - deliberately. The session behind a
 * recovery lives only in an ephemeral, memory-only auth client, so an
 * interrupted recovery is simply gone and the next launch starts at sign-in.
 * That fail-closed is the design: a recovery link must never survive a restart
 * as an ordinary session.
 */
export type RecoveryState =
  /** No recovery in progress. The app is whatever `SessionProvider` says. */
  | { readonly status: 'idle' }
  /** A link arrived and its proof is being redeemed. */
  | { readonly status: 'redeeming' }
  /** Redeemed. The set-a-password surface is showing, and only that. */
  | { readonly status: 'recovering' }
  /**
   * The redemption did not open the surface, and the title says WHY.
   *
   * Two different claims live here and they must not share a sentence. Only a
   * server that answered `otp_expired` earns "Enlace no válido"; a request that
   * never arrived earns "No se pudo comprobar el enlace", because the link may
   * well be perfectly good - measured, it was.
   */
  | {
      readonly status: 'error';
      readonly titleKey: RecoveryErrorTitleKey;
      readonly messageKey: AuthErrorKey;
    }
  /** The password was changed and the ephemeral session closed. */
  | { readonly status: 'completed' };

export const RECOVERY_IDLE: RecoveryState = { status: 'idle' };

/**
 * Whether the recovery surface owns the screen.
 *
 * `error` is included: a refused link has something to say, and saying it on
 * the sign-in screen would either be lost or need a second channel to get
 * there. `completed` is included too, for the frame that confirms the change
 * before the flow dismisses itself.
 */
export function isRecoveryActive(state: RecoveryState): boolean {
  return state.status !== 'idle';
}

/**
 * What one attempt at redeeming a proof established about the proof itself.
 *
 * This is the vocabulary the arrival handler needs, and it is deliberately
 * about the TOKEN rather than about the screen. The controller owns what the
 * person sees; this says whether the single-use proof was actually spent.
 *
 * The third case is the one that was missing, and its absence was a defect:
 * marking a hash spent because a request failed is claiming the server
 * consumed something it never received. Measured on device - the app declared
 * a link dead while GoTrue still held that exact one-time token, unused.
 *
 * `unresolved` is deliberately wider than "no network": a rate limit, a 500,
 * an unexpected throw. None of them are the server's word about the proof, so
 * none of them may burn it.
 */
export type RedeemOutcome =
  /** `verifyOtp` succeeded. The proof is spent and the surface is open. */
  | 'consumed'
  /** The server said it is no longer a proof. Spent, for our purposes. */
  | 'dead'
  /** Nothing was established. The proof may still be perfectly good. */
  | 'unresolved';
