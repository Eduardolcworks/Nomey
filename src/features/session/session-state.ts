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
  /**
   * The name the person gave at sign-up, for showing back to them.
   *
   * **Presentation, and only presentation.** It never appears in RLS, never
   * resolves a membership or a scope, and never stands in for `userId`. It is
   * `user_metadata`, which the account holder can change at will - treating it
   * as identity would be treating a user-editable string as an authority.
   *
   * `null` when there is none. Not a placeholder, not a guess from the email:
   * the caller decides what to show, because only the caller knows where.
   */
  readonly displayName: string | null;
};

export type SessionState =
  /** Looking. Neither branch of the app may be mounted. */
  | { readonly status: 'restoring' }
  /** Looked, and there is no session. */
  | { readonly status: 'signed-out' }
  /**
   * A recovery link was redeemed and the password has not been set yet.
   *
   * There IS a real Supabase session behind this - `verifyOtp` returns a full
   * one - and that is exactly why the state exists. Without it the app would
   * see an ordinary session and mount the product, dropping someone on Inicio
   * mid-recovery holding credentials that arrived in an email.
   *
   * It carries no identity on purpose. The only thing anyone is allowed to do
   * here is set a password, and a name or an address on that surface would
   * invite showing them - which is a small confirmation, to whoever is holding
   * the phone, of who the account belongs to.
   */
  | { readonly status: 'recovering' }
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
export const RECOVERING: SessionState = { status: 'recovering' };
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
  /**
   * Supabase's `user_metadata`, typed as unknown values on purpose: it is
   * free-form JSON the account holder controls, so nothing in it may be
   * trusted to have the shape we expect.
   */
  readonly user_metadata?: Readonly<Record<string, unknown>> | null;
};

/**
 * Pull the display name out of metadata, or decide there isn't one.
 *
 * Everything that is not a non-empty string becomes `null` - a number, an
 * object, whitespace, an absence. `user_metadata` is written by the client at
 * sign-up and editable by the account holder afterwards, so this is the one
 * place its shape gets checked rather than assumed.
 */
function readDisplayName(metadata: Readonly<Record<string, unknown>> | null | undefined): string {
  const raw = metadata?.display_name;
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

export function stateFromUser(user: AuthenticatedUser | null | undefined): SessionState {
  if (user === null || user === undefined || user.id === '') return SIGNED_OUT;

  const displayName = readDisplayName(user.user_metadata);

  return {
    status: 'signed-in',
    identity: {
      userId: user.id,
      email: user.email ?? null,
      displayName: displayName === '' ? null : displayName,
    },
  };
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

/**
 * A value that changes exactly when the person using the app changes.
 *
 * `null` whenever nobody is signed in - which deliberately makes `restoring`,
 * `signed-out` and `unavailable` indistinguishable, because for the purpose
 * this serves they are the same thing: there is no user, so no user state
 * should be held.
 *
 * It exists so that state living OUTSIDE the protected branch can be tied to
 * an identity without that state having to know anything about sessions. The
 * scope selector is the first consumer: Personal and Pareja are two different
 * sets of books, and inheriting the previous account's choice would point the
 * fastest path in the app at someone else's books.
 *
 * Not an identity check and not authorisation - it is a cache key. The
 * authority is still the JWT's `sub` on the server, and RLS.
 */
export function identityKey(state: SessionState): string | null {
  return state.status === 'signed-in' ? state.identity.userId : null;
}

/**
 * Whether the app must show the set-a-new-password surface and nothing else.
 *
 * Its own predicate rather than a comparison at the call site, for the same
 * reason `isPublic` exists: the routing rule is one fact, and one fact should
 * have one place to be wrong in.
 */
export function isRecovering(state: SessionState): boolean {
  return state.status === 'recovering';
}
