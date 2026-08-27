/**
 * The one place the Supabase boundary is bootstrapped. Imported by `client.ts`
 * and by nothing else - the fix belongs to the boundary, not to routes or
 * features, and scattering it would make "is it applied?" unanswerable.
 *
 * WHY IT EXISTS, measured rather than assumed:
 *
 * `SupabaseClient`'s constructor does, unconditionally, before it looks at any
 * option (`@supabase/supabase-js@2.112.4`, `dist/index.cjs:626`):
 *
 *     this.realtimeUrl = new URL('realtime/v1', baseUrl);
 *     this.realtimeUrl.protocol = this.realtimeUrl.protocol.replace('http', 'ws');
 *
 * React Native 0.86 installs its own `URL` as a global - unconditionally, in
 * `Libraries/Core/setUpXHR.js` via `polyfillGlobal` - and that class
 * (`Libraries/Blob/URL.js`) declares exactly one setter in the whole file,
 * `set search`. `protocol` is a getter with no setter. A class body is always
 * strict mode, so that assignment throws:
 *
 *     TypeError: Cannot set property protocol of [object Object]
 *                which has only a getter
 *
 * It is not about realtime, which Nomey does not use: the line runs before the
 * options are read, so it takes the client down whatever else is configured.
 *
 * ORDERING. `createClient()` is called in `client.ts`'s module body, and a
 * module body runs only after every one of its imports has been evaluated - so
 * importing this file anywhere in `client.ts` is enough, and the guarantee does
 * not rest on the order of the import statements. It holds under Metro's
 * CommonJS output too, where the imports become requires that all run before
 * the body. Belt and braces, it is still written first in `client.ts`.
 *
 * It also does not rest on `supabase-js` resolving `URL` late: it was checked
 * that neither `supabase-js` nor `auth-js` captures `URL` at module scope. The
 * constructor reads the global when it runs.
 *
 * A local shim - defining a `protocol` setter on React Native's `URL.prototype`
 * - was considered and rejected in ADR-017: it would depend on that class's
 * private `_url` field, and it would patch the single member we happened to
 * trip over while leaving the rest of an approximate `URL` underneath a library
 * that keeps using it.
 */
import 'react-native-url-polyfill/auto';
