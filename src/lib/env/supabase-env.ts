/**
 * The two public Supabase values, validated before anything uses them.
 *
 * Both are `EXPO_PUBLIC_`, so both are inlined into the bundle and readable by
 * anyone who downloads the binary. That is correct for a publishable key and
 * catastrophic for a secret one, which is why the validation here is not only
 * "is it present" - it is also "is it the right *kind* of key". A secret key
 * pasted into this variable would work perfectly in development and hand every
 * user full backend privileges in production. `AGENTS.md` §7.
 *
 * The reading of `process.env` lives in `index.ts`, not here, so this module
 * stays a pure function of its inputs and can be tested without a bundler.
 */

/** What a validated environment looks like once past this module. */
export type SupabaseEnv = {
  readonly url: string;
  readonly publishableKey: string;
};

/**
 * Thrown at startup, never caught. It is a developer error in the build's
 * configuration, not a runtime condition a user can be in, so it does not go
 * through i18n: nobody but us is ever meant to read it.
 */
export class EnvError extends Error {
  constructor(message: string) {
    super(`Nomey environment: ${message}\nSee .env.example and AGENTS.md §7.`);
    this.name = 'EnvError';
  }
}

const URL_VARIABLE = 'EXPO_PUBLIC_SUPABASE_URL';
const KEY_VARIABLE = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

/**
 * The prefix of Supabase's current client key. The legacy `anon` key was a JWT
 * and is documented by Supabase as deprecated, so Nomey does not accept one:
 * silently working with a legacy key is how a project ends up depending on it.
 */
const PUBLISHABLE_PREFIX = 'sb_publishable_';
const SECRET_PREFIX = 'sb_secret_';
const JWT_PREFIX = 'eyJ';

export function readSupabaseEnv(raw: {
  url: string | undefined;
  publishableKey: string | undefined;
}): SupabaseEnv {
  const url = (raw.url ?? '').trim();
  const publishableKey = (raw.publishableKey ?? '').trim();

  if (url === '') {
    throw new EnvError(`${URL_VARIABLE} is missing or empty.`);
  }
  if (!/^https?:\/\/[^/\s]+/.test(url)) {
    throw new EnvError(
      `${URL_VARIABLE} is not an http(s) URL with a host: ${JSON.stringify(url)}.`,
    );
  }

  if (publishableKey === '') {
    throw new EnvError(`${KEY_VARIABLE} is missing or empty.`);
  }

  // Checked before the positive rule so the message names the actual mistake.
  // "It must start with sb_publishable_" is unhelpful feedback for someone who
  // has just pasted a secret key into a variable that ships in the bundle.
  if (publishableKey.startsWith(SECRET_PREFIX)) {
    throw new EnvError(
      `${KEY_VARIABLE} holds a SECRET key. EXPO_PUBLIC_ variables are inlined into the app bundle: this would publish backend credentials to every user. Secret keys belong in GitHub Secrets and Supabase secrets, never here.`,
    );
  }
  if (publishableKey.startsWith(JWT_PREFIX)) {
    throw new EnvError(
      `${KEY_VARIABLE} looks like a legacy JWT key (anon or service_role). Nomey uses the current key system; a service_role JWT here would publish backend credentials to every user.`,
    );
  }
  if (!publishableKey.startsWith(PUBLISHABLE_PREFIX)) {
    throw new EnvError(
      `${KEY_VARIABLE} does not look like a publishable key: it should start with "${PUBLISHABLE_PREFIX}".`,
    );
  }

  return { url, publishableKey };
}
