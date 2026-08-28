import { recoveryClient, SESSION_STORAGE_KEY, sessionStorage, supabase } from '@/lib/supabase';

import {
  type AuthErrorKey,
  recoveryErrorKey,
  signInErrorKey,
  signOutErrorKey,
  signUpErrorKey,
  updateUserErrorKey,
} from './auth-errors';
import {
  type Credentials,
  normaliseCredentials,
  normaliseDisplayName,
  normaliseEmail,
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

/**
 * Change the name the app greets you by.
 *
 * It writes to exactly where sign-up wrote it: `user_metadata.display_name`,
 * through `PUT /user`. **No second identity, no `profiles` table, no store of
 * our own** - the handoff closed that decision and this consumes it rather
 * than reopening it. The name stays what it has always been: presentation,
 * editable by its owner, never an authority. It does not appear in RLS, does
 * not resolve a membership or a scope, and does not stand in for the JWT's
 * `sub`.
 *
 * Nothing here propagates the change, and that is the point. MEASURED in
 * `@supabase/auth-js@2.112.4`: `_updateUser` assigns the fresh user onto the
 * session, calls `_saveSession` - so the new name is persisted to the chunked
 * keychain store - and then emits `USER_UPDATED` with that session. The single
 * subscriber in `SessionProvider` is event-agnostic, so it maps the user
 * through `stateFromUser` exactly as it does for a sign-in, and every screen
 * deriving its name from the session moves on its own. Inicio's greeting is
 * already written that way and needs no change at all.
 *
 * That is why there is no refetch, no cache to invalidate and nothing to keep
 * in sync: one write, one event, one owner of the state.
 *
 * Empty is refused here rather than at the server. It is the only rule Nomey
 * owns about a name - GoTrue has no opinion on metadata contents - and the
 * alternative is a round trip that comes back with nothing useful to say.
 * Beyond "not blank" nothing is judged: a name is trimmed and otherwise left
 * exactly as the person wrote it.
 */
export async function updateDisplayName(raw: string): Promise<AuthResult> {
  const displayName = normaliseDisplayName(raw);
  if (displayName === '') return { ok: false, messageKey: 'authError.nameRequired' };

  const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } });

  if (error !== null) return { ok: false, messageKey: updateUserErrorKey(error) };
  return { ok: true };
}

/**
 * Ask for a recovery email.
 *
 * **The answer is the same whether or not the address has an account.**
 * Measured against this GoTrue: `POST /recover` for an unknown address answers
 * `200 {}`, exactly as it does for a known one. So the neutral message the UI
 * shows is the literal truth rather than a fiction the client maintains - we
 * are not hiding an answer, we genuinely were not given one.
 *
 * That is worth stating because the temptation later is to "improve" this by
 * telling the user their address is not registered. It would turn the form
 * into an account oracle, which is precisely what the sign-in and sign-up
 * screens already refuse to be.
 *
 * No `redirectTo` is passed, and that is deliberate too. The recovery email
 * template writes the app's deep link itself and only interpolates the token
 * hash, so there is no redirect for the server to validate - and a rejected
 * `redirect_to` is silently swapped for `site_url` rather than refused, which
 * is a failure nobody would notice.
 */
export async function requestPasswordReset(rawEmail: string): Promise<AuthResult> {
  const email = normaliseEmail(rawEmail);
  if (email === '') return { ok: false, messageKey: 'authError.emailRequired' };

  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error !== null) return { ok: false, messageKey: recoveryErrorKey(error) };
  return { ok: true };
}

/**
 * Redeem the proof that came in the recovery link.
 *
 * `verifyOtp` with `type: 'recovery'` is the whole mechanism, and its two
 * properties are why this block is shaped the way it is. MEASURED in
 * `@supabase/auth-js@2.112.4` and against the running stack:
 *
 * 1. It POSTs the hash to `/verify` and saves the returned session through the
 *    configured storage - which is Nomey's chunked keychain store. **No
 *    second storage path and no manual persistence**: ADR-017 keeps owning the
 *    session, and this feature never learns a key name.
 * 2. It emits **`PASSWORD_RECOVERY`** rather than `SIGNED_IN`. That event is
 *    what the session lifecycle turns into the `recovering` state, so recovery
 *    is distinguished by something the SERVER said, not by a flag we set
 *    because we recognised a URL.
 *
 * The hash is single-use: replaying it, or inventing one, both answer `403
 * otp_expired` and are deliberately indistinguishable from each other.
 */
export async function redeemRecovery(tokenHash: string): Promise<AuthResult> {
  const { error } = await recoveryClient().auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });

  if (error !== null) return { ok: false, messageKey: recoveryErrorKey(error) };
  return { ok: true };
}

/**
 * Set the new password, then end the session the email link created.
 *
 * The sign-out is the security half, and it is not decoration. MEASURED: after
 * `PUT /user` the recovery session stays fully alive - both the access token
 * and the refresh token still work. So without this, finishing a recovery
 * leaves an ordinary, long-lived session on the device that was obtained by
 * whoever had access to an inbox.
 *
 * It costs nothing to close, because the change is already committed: the old
 * password answers `400` and the new one answers `200` before this returns.
 * Signing out therefore proves the new password rather than trusting it - the
 * only way back in is to type it.
 *
 * The sign-out also produces the event that ends `recovering`: the session
 * goes away, the lifecycle clears the flag, and the tree returns to the public
 * branch on its own. **No `router.replace` anywhere in this flow.**
 *
 * A failed sign-out is not reported as a failed password change, because the
 * password change did succeed. The state that matters is on the server.
 */
export async function completeRecovery(rawPassword: string): Promise<AuthResult> {
  const ephemeral = recoveryClient();

  const { error } = await ephemeral.auth.updateUser({ password: rawPassword });

  if (error !== null) return { ok: false, messageKey: updateUserErrorKey(error) };

  await ephemeral.auth.signOut({ scope: 'local' });
  return { ok: true };
}
