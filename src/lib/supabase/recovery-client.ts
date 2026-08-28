/**
 * A second auth client, for one transaction, that forgets everything.
 *
 * **A session born from a recovery email is not an ordinary Nomey session and
 * must never become one.** That is the boundary this file exists to draw, and
 * it is drawn in the only place it can hold: at the client, not at a flag.
 *
 * WHY IT IS A SEPARATE CLIENT.
 *
 * `verifyOtp` returns a full session and persists it through whatever storage
 * its client was given. On the main client that means the keychain - so
 * redeeming a link, then killing the app before setting the password, left a
 * perfectly ordinary persisted session behind. On the next launch `auth-js`
 * restores it and emits `INITIAL_SESSION`; the `PASSWORD_RECOVERY` that made it
 * special existed only in the dead process. **Measured**: the app came back as
 * `signed-in`, on Inicio, with the password never changed - the email link had
 * quietly become a permanent login.
 *
 * A sticky flag in the session state could not fix that, because the flag died
 * with the process too. Persisting a flag alongside the session would have
 * tracked the danger rather than removing it: two artefacts that can
 * desynchronise, and a "you are mid-recovery" marker that outlives a crash.
 *
 * So the recovery session is never written down. It lives in this client's
 * memory for the length of one screen, and the process dying takes it with it.
 * The failure mode is now "you are signed out", which is the correct outcome
 * for a recovery nobody finished.
 *
 * WHAT MAKES THAT TRUE, read from `@supabase/auth-js@2.112.4` rather than
 * assumed - both are structural, not conventions we are trusting:
 *
 * - With `persistSession: false` the constructor takes a branch that sets
 *   `this.storage = memoryLocalStorageAdapter({})`, and **`settings.storage` is
 *   only consulted inside the `persistSession` branch**. Passing a storage
 *   adapter here would not merely be wrong, it would be ignored. There is no
 *   configuration of this client that can reach the keychain.
 * - The `BroadcastChannel` that shares auth events between instances is created
 *   only `if (isBrowser() && globalThis.BroadcastChannel && this.persistSession
 *   && this.storageKey)`. Two of those are false here. And subscribers live in
 *   each instance's own `stateChangeEmitters`, so this client's
 *   `PASSWORD_RECOVERY`, `USER_UPDATED` and `SIGNED_OUT` cannot reach the
 *   session provider at all.
 *
 * ADR-017 is untouched and still governs the ordinary session. This is not an
 * exception to it: nothing here is persisted, so there is nothing for a
 * persistence policy to have an opinion about.
 */
// Same reason as the main client, and it must stay an import rather than a
// copy: React Native's `URL` has no `protocol` setter.
import './bootstrap';

import { createClient } from '@supabase/supabase-js';

import { supabaseEnv } from '@/lib/env';

/**
 * A key this client will never write to, kept distinct anyway.
 *
 * With `persistSession: false` the storage is an in-memory object, so this
 * names nothing on disk. It is set so that the two clients can never be
 * confused for one another by anything that reads a key - a future
 * `BroadcastChannel`, a debugging tool, or a later version of the library that
 * finds another use for it. Defence in depth behind a structural guarantee,
 * not the guarantee itself.
 */
export const RECOVERY_STORAGE_KEY = 'nomey-recovery-ephemeral';

/**
 * Created lazily, and torn down by the flow that asked for it.
 *
 * Eager creation would keep an idle auth client alive for every launch that
 * never recovers anything, which is nearly all of them. Lazy also means the
 * instance's lifetime matches the transaction's.
 */
let client: ReturnType<typeof createRecoveryClient> | null = null;

function createRecoveryClient() {
  return createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    auth: {
      /** The whole point. See above. */
      persistSession: false,
      /**
       * No refresh loop. This session exists for one screen and one call; a
       * ticker on it would be a second client competing for tokens that are
       * meant to be thrown away.
       */
      autoRefreshToken: false,
      /** There is no URL to read a session from, and reading one is the shape we rejected. */
      detectSessionInUrl: false,
      storageKey: RECOVERY_STORAGE_KEY,
    },
  });
}

/** The ephemeral client, creating it on first use. */
export function recoveryClient() {
  client ??= createRecoveryClient();
  return client;
}

/**
 * Drop the client and the session inside it.
 *
 * Called when a recovery ends, however it ends. It is belt and braces: the
 * session is in memory either way, so a process that dies without reaching
 * this loses it regardless. What this adds is that a recovery finished *within*
 * a running app does not leave the session sitting in memory until the app is
 * closed.
 */
export function disposeRecoveryClient(): void {
  client = null;
}
