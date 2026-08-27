/**
 * Validated environment, read once at import time.
 *
 * The two `process.env` accesses below are written out in full on purpose.
 * Metro substitutes `EXPO_PUBLIC_*` by replacing the exact member expression
 * with a string literal at build time - it does not populate an object. So
 * `process.env[name]` or destructuring `process.env` produces `undefined` in a
 * real build while working fine in Node, which is the worst possible failure
 * shape: green tests, broken app.
 */
import { readSupabaseEnv } from './supabase-env';

export { EnvError, readSupabaseEnv, type SupabaseEnv } from './supabase-env';

export const supabaseEnv = readSupabaseEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
