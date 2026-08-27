/**
 * What the app knows about who is using it.
 *
 * A discriminated union, not a boolean. `isAuthenticated: false` cannot tell
 * "we have looked and there is nobody" apart from "we have not looked yet",
 * and those two must render completely different things at startup - the
 * second must render neither branch.
 */

/** The identity the rest of the app is allowed to see. */
export type SessionIdentity = {
  /**
   * `auth.users.id`, which is the JWT's `sub` and therefore the same value
   * `sec.request_actor_id()` reads on the server. There is no second Nomey
   * identity to map it to.
   */
  readonly userId: string;
  readonly email: string | null;
};

export type SessionState =
  /** Looking. Neither branch of the app may be mounted. */
  | { readonly status: 'restoring' }
  /** Looked, and there is no session. */
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly identity: SessionIdentity }
  /**
   * The answer did not arrive. Recoverable and NOT terminal: the subscription
   * stays live, so a late answer still resolves it, and the user can retry.
   *
   * It exists so a client that never finishes initialising cannot leave the
   * app on a held splash forever, which is the one failure that has no exit.
   */
  | { readonly status: 'unavailable' };

export const RESTORING: SessionState = { status: 'restoring' };
export const SIGNED_OUT: SessionState = { status: 'signed-out' };
export const UNAVAILABLE: SessionState = { status: 'unavailable' };

/**
 * The shape this feature needs out of a Supabase session, and nothing more.
 *
 * Deliberately not `Session`: the access token is not copied out of the client
 * into React state. Anything that needs to call the API uses `supabase`, which
 * attaches the token itself and refreshes it. One owner of the token, one
 * place it can go stale.
 */
export type AuthenticatedUser = {
  readonly id: string;
  readonly email?: string | null;
};

export function stateFromUser(user: AuthenticatedUser | null | undefined): SessionState {
  if (user === null || user === undefined || user.id === '') return SIGNED_OUT;
  return { status: 'signed-in', identity: { userId: user.id, email: user.email ?? null } };
}

/** True once the app may mount a branch: any answer at all, including a bad one. */
export function isResolved(state: SessionState): boolean {
  return state.status !== 'restoring';
}

/**
 * Whether the public branch is the one to show.
 *
 * `unavailable` lands here rather than in the protected branch. It is the safe
 * direction: showing the sign-in surface to someone who turns out to be signed
 * in is a small annoyance, and the reverse would mount product screens for
 * someone we could not identify.
 */
export function isPublic(state: SessionState): boolean {
  return state.status === 'signed-out' || state.status === 'unavailable';
}

export function isSignedIn(state: SessionState): boolean {
  return state.status === 'signed-in';
}
