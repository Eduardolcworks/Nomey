import type { MessageKey } from '@/lib/i18n';

/**
 * What GoTrue said, translated into something we are willing to show.
 *
 * `error.message` never reaches the screen. Three reasons, and the third is
 * the one that matters:
 *
 * 1. It arrives in English, from a catalogue nobody here translates.
 * 2. Its wording is not a contract and changes between versions.
 * 3. **It says more than we want to say.** On a failed sign-in GoTrue is
 *    careful not to reveal whether the address exists; a message pasted
 *    straight through can leak that, and so can a mapping that helpfully
 *    distinguishes "no such user" from "wrong password". Nomey answers both
 *    with one sentence, on purpose.
 *
 * Anything unrecognised falls to a generic key rather than to the raw text.
 * A user who sees "Algo ha ido mal" learns nothing; a user who sees a stack
 * of internal vocabulary learns something we did not choose to tell them.
 */

/** The shape of an auth-js error, without importing its class. */
export type AuthFailure = {
  readonly code?: string;
  readonly status?: number;
  readonly name?: string;
};

export type AuthErrorKey = Extract<MessageKey, `authError.${string}`>;

/**
 * The one message both failure modes of sign-in share.
 *
 * Wrong password and unknown address are deliberately indistinguishable:
 * telling them apart turns the sign-in form into a test for whether an
 * address has an account here.
 */
const SIGN_IN_REJECTED: AuthErrorKey = 'authError.invalidCredentials';

const GENERIC: AuthErrorKey = 'authError.generic';
const NETWORK: AuthErrorKey = 'authError.network';

/** Codes that mean the same thing whichever form produced them. */
const SHARED: Readonly<Record<string, AuthErrorKey>> = {
  over_request_rate_limit: 'authError.rateLimited',
  over_email_send_rate_limit: 'authError.rateLimited',
  validation_failed: 'authError.invalidEmail',
  email_address_invalid: 'authError.invalidEmail',
  request_timeout: NETWORK,
};

const SIGN_IN: Readonly<Record<string, AuthErrorKey>> = {
  invalid_credentials: SIGN_IN_REJECTED,
  user_not_found: SIGN_IN_REJECTED,
  // Signing in before confirming is the expected middle of the flow, not a
  // mistake, so it gets its own sentence pointing back at the inbox.
  email_not_confirmed: 'authError.emailNotConfirmed',
  user_banned: 'authError.accountUnavailable',
};

const SIGN_UP: Readonly<Record<string, AuthErrorKey>> = {
  weak_password: 'authError.weakPassword',
  email_address_not_authorized: 'authError.invalidEmail',
  signup_disabled: 'authError.signUpDisabled',
  email_provider_disabled: 'authError.signUpDisabled',
  /*
   * `user_already_exists` / `email_exists` are mapped to the SAME sentence the
   * happy path shows, not to "that address is taken".
   *
   * GoTrue deliberately hides whether an address is registered when
   * confirmations are on - a repeat sign-up returns an obfuscated user rather
   * than an error. Answering "already registered" here would break that
   * property from our side, and turn the sign-up form into the account
   * oracle the sign-in form refuses to be.
   */
  user_already_exists: 'authError.checkYourEmail',
  email_exists: 'authError.checkYourEmail',
};

/** A transport failure, which has no code because no response arrived. */
function isNetworkFailure(failure: AuthFailure): boolean {
  if (failure.name === 'AuthRetryableFetchError') return true;
  return failure.code === undefined && failure.status === undefined;
}

export function signInErrorKey(failure: AuthFailure): AuthErrorKey {
  if (isNetworkFailure(failure)) return NETWORK;
  const code = failure.code ?? '';
  return SIGN_IN[code] ?? SHARED[code] ?? GENERIC;
}

export function signUpErrorKey(failure: AuthFailure): AuthErrorKey {
  if (isNetworkFailure(failure)) return NETWORK;
  const code = failure.code ?? '';
  return SIGN_UP[code] ?? SHARED[code] ?? GENERIC;
}
