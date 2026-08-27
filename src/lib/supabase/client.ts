/**
 * The Supabase client. One per app, created at import time.
 *
 * Creating it eagerly means a misconfigured build fails at startup with the
 * message from `lib/env` rather than at the first call, somewhere far from the
 * cause.
 *
 * What this file deliberately does NOT do: manage a session. No
 * `onAuthStateChange`, no `AppState` wiring, no restore-on-launch. Those are
 * the session provider's job in F5.B. Here there is a client and the storage
 * it writes to, and nothing that has an opinion about when.
 */
// First, and it must stay an import of this module rather than a copy of its
// contents: React Native's `URL` has no `protocol` setter and the Supabase
// constructor assigns to one. See `bootstrap.ts` for the measurement.
import './bootstrap';

import { createClient } from '@supabase/supabase-js';

import { supabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

import { buildClientOptions } from './client-options';
import { sessionStorage } from './session-storage';

export const supabase = createClient<Database>(
  supabaseEnv.url,
  supabaseEnv.publishableKey,
  buildClientOptions(sessionStorage),
);
