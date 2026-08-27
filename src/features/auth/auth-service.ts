import { supabase } from '@/lib/supabase';

import { type AuthErrorKey, signInErrorKey, signUpErrorKey } from './auth-errors';
import {
  type Credentials,
  normaliseCredentials,
  normaliseRegistration,
  type Registration,
} from './credentials';

/**
 * The two calls Nomey makes to Auth, and nothing else.
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
