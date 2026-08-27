/**
 * The client's configuration, separated from the client itself so it can be
 * asserted on without importing a native module or a validated environment.
 */
import type { SupabaseClientOptions } from '@supabase/supabase-js';

import type { StorageBackend } from './chunked-storage';

/**
 * The storage key, fixed rather than derived.
 *
 * Left alone, supabase-js builds one from the URL's first hostname label
 * (`sb-<label>-auth-token`), which against a local stack on an IP address
 * becomes `sb-192-auth-token`, and which changes the moment the backend URL
 * changes. A fixed key means the stored session is found again after a URL
 * change - and when that URL points at a *different* Supabase project, the
 * refresh simply fails and the user is signed out, which is the correct
 * outcome: a session is not transferable between projects.
 */
export const SESSION_STORAGE_KEY = 'nomey-auth-token';

export function buildClientOptions(storage: StorageBackend): SupabaseClientOptions<'api'> {
  return {
    db: {
      /**
       * ADR-005 and ADR-014: `api` is the only exposed schema. `public`,
       * `core` and `sec` answer 406 PGRST106. Without this the client would
       * ask PostgREST for `public` and every call would fail.
       */
      schema: 'api',
    },
    auth: {
      storage,
      storageKey: SESSION_STORAGE_KEY,
      /** The session outlives the process. That is criterion 2 of the phase. */
      persistSession: true,
      /**
       * The access token expires in an hour (`auth.jwt_expiry`). Without this,
       * an app left open longer than that keeps a dead token and the next call
       * to `api.record_*` fails with 42501.
       *
       * Note that this only starts the timer. Tying refreshes to the app
       * coming back to the foreground belongs to the session provider in F5.B,
       * not here: this file builds a client, it does not run a lifecycle.
       */
      autoRefreshToken: true,
      /**
       * There is no URL to read a session from at launch on native. Leaving it
       * on makes the auth client look for `window.location`, which is a web
       * assumption Nomey never satisfies - web is not a target platform.
       *
       * The email links of F5.C and F5.E arrive through `expo-linking` as deep
       * links and are handed to the auth client explicitly. That is a
       * different mechanism, and it does not need this flag.
       */
      detectSessionInUrl: false,
    },
  };
}
