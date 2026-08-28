import type { AuthErrorKey } from './auth-errors';

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
  /** The link was refused, or the password could not be saved. */
  | { readonly status: 'error'; readonly messageKey: AuthErrorKey }
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
