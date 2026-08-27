import { SESSION_STORAGE_KEY, sessionStorage, supabase } from '@/lib/supabase';

import { type AuthErrorKey, signInErrorKey, signOutErrorKey, signUpErrorKey } from './auth-errors';
import {
  type Credentials,
  normaliseCredentials,
  normaliseRegistration,
  type Registration,
} from './credentials';

/**
 * Every call Nomey makes to Auth, and nothing else.
 *
 * Screens never touch `supabase.auth` directly: they get a result they can
 * render. That keeps three things out of the UI - the shape of GoTrue's
 * errors, the decision about what a user is allowed to be told, and the
 * knowledge that any of this is Supabase at all.
 *
 * **Nothing here touches session state.** No `setState`, no navigation, no
 * storing of anything. A successful `signIn` produces an event, the provider
 * from F5.B is subscribed to it, and the tree switches branch on its own. That
 * is the whole integration, and adding a `router.replace` next to it would be
 * a second mechanism racing the first.
 */

export type AuthResult =
  | { readonly ok: true }
  /** Sign-up succeeded and the account is waiting on its confirmation email. */
  | { readonly ok: true; readonly pendingConfirmation: true }
  | { readonly ok: false; readonly messageKey: AuthErrorKey };

/**
 * Create an account.
 *
 * The name goes into `options.data`, which becomes the user's
 * `user_metadata` - presentation only. It is NOT an identity: it never
 * appears in RLS, never resolves a membership or a scope, and never stands in
 * for the JWT's `sub`. `AGENTS.md` and ADR-016 are unambiguous that ownership
 * and membership are the authorities, and a display name is neither.
 *
 * With confirmations mandatory this never returns a session, and that is the
 * point rather than a limitation: the caller shows "check your email".
 */
export async function signUp(raw: Registration): Promise<AuthResult> {
  const { email, password, displayName } = normaliseRegistration(raw);

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error !== null) return { ok: false, messageKey: signUpErrorKey(error) };
  return { ok: true, pendingConfirmation: true };
}

/**
 * Sign in with email and password.
 *
 * On success this returns `{ ok: true }` and deliberately returns no session:
 * there is nothing useful the caller could do with one that the provider is
 * not already doing, and handing it out invites a second copy of the token.
 */
export async function signIn(raw: Credentials): Promise<AuthResult> {
  const { email, password } = normaliseCredentials(raw);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error !== null) return { ok: false, messageKey: signInErrorKey(error) };
  return { ok: true };
}

/**
 * Sign out.
 *
 * MEASURED against `@supabase/auth-js@2.112.4`, not recalled. `_signOut`
 * reads the session, POSTs `/logout`, and then removes the stored session
 * through the storage adapter - which here is the chunked store, whose
 * `removeItem` is an unconditional purge of the manifest and every possible
 * chunk. **There is therefore no second purge to write for the ordinary
 * path**, and writing one "just in case" would be a parallel implementation
 * of something ADR-017 already owns.
 *
 * The outcomes, all four of them:
 *
 * 1. **No session stored.** The remote call is skipped, the session is
 *    removed anyway and `SIGNED_OUT` is emitted with no error. An already
 *    invalid local session signs out cleanly rather than failing.
 * 2. **Remote answers 401 / 403 / 404, or says the session is missing.**
 *    Swallowed by the library on purpose - the session is already gone
 *    server-side - and it falls through to the same clean removal.
 * 3. **Remote fails for any other reason, transport included.** The library
 *    removes the local session FIRST and returns the error second. So the
 *    user IS signed out, the event does fire, and the branch does switch.
 * 4. **The session could not be read at all** because its access token had
 *    expired and the refresh was unreachable. This is the ONLY path that
 *    returns an error while leaving the session on disk and emitting nothing.
 *    See `forgetLocalSession` for the way out.
 *
 * `scope: 'local'`, explicitly, and not the library's default.
 * `signOut()` defaults to `'global'`, which ends the session on **every
 * device the person is signed in on** - the installed version's own doc
 * comment calls that out and says `'local'` "is usually what apps want on a
 * 'Sign out' button". A tap on this phone must not sign the user out of their
 * tablet. `'local'` still revokes THIS session's refresh token server-side,
 * so nothing is weakened for the device actually signing out.
 */
export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error !== null) return { ok: false, messageKey: signOutErrorKey(error) };
  return { ok: true };
}

/**
 * Give up on the remote and drop the session from this device only.
 *
 * The escape from outcome 4 above, and **deliberately not automatic**. In that
 * outcome the refresh token was never rejected - it was merely unreachable -
 * so Nomey cannot demonstrate the session is unusable, and silently deleting
 * a credential the server still considers valid is not a decision to take on
 * the user's behalf. They are told what it costs and they choose.
 *
 * What it costs, stated plainly: the refresh token is removed from this
 * device but stays valid on the server until it expires. Nothing is left
 * behind that anyone can reach; nothing is revoked either.
 *
 * Two steps, and the second is not redundant:
 *
 * 1. Purge the stored session through `sessionStorage`, which owns the
 *    chunking. The key is a constant from `lib/supabase`; **no caller ever
 *    names a chunk**, and this feature could not compose one if it tried.
 * 2. Ask the library to sign out again. It now reads an absent session, takes
 *    outcome 1 above, and emits `SIGNED_OUT` - which is the whole point.
 *    Purging storage on its own changes no state anyone is subscribed to, so
 *    the tree would stay on the protected branch until the next launch.
 */
export async function forgetLocalSession(): Promise<AuthResult> {
  await sessionStorage.removeItem(SESSION_STORAGE_KEY);

  // Also clears `<key>-user` and any PKCE verifier, and emits the event.
  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error !== null) return { ok: false, messageKey: signOutErrorKey(error) };
  return { ok: true };
}
