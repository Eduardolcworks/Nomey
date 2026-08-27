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

/**
 * The two operations with nothing of their own to map.
 *
 * Both end here rather than sharing a name, because they are the same
 * decision reached for different reasons and a single misnamed export would
 * hide that. What they have in common is that the interesting codes never
 * arrive: `SHARED` still applies, everything else is generic.
 */
function unremarkableErrorKey(failure: AuthFailure): AuthErrorKey {
  if (isNetworkFailure(failure)) return NETWORK;
  return SHARED[failure.code ?? ''] ?? GENERIC;
}

/**
 * Why signing out has almost nothing to map.
 *
 * `@supabase/auth-js@2.112.4` swallows the codes that would be interesting -
 * 401, 403, 404 and a missing session are all treated as "already signed
 * out" and never surface as an error. What is left is a transport failure or
 * something genuinely unexpected, and neither has a sentence of its own worth
 * writing. The rate limit is shared and does, so `SHARED` still applies.
 */
export function signOutErrorKey(failure: AuthFailure): AuthErrorKey {
  return unremarkableErrorKey(failure);
}

/**
 * Why changing the display name has almost nothing to map either.
 *
 * A different reason from sign-out's. `PUT /user` carrying only
 * `user_metadata` has no policy to violate - no password rules, no address
 * validation, no confirmation flow - so GoTrue has nothing specific to
 * refuse. The one local rule, "a name cannot be empty", is checked before the
 * request is made and never becomes a round trip.
 *
 * If the session has expired underneath, the answer is not a sentence on this
 * screen: the provider receives it and the tree changes branch.
 */
export function updateUserErrorKey(failure: AuthFailure): AuthErrorKey {
  return unremarkableErrorKey(failure);
}

/**
 * What recovery is allowed to say.
 *
 * The mapping is short because most of what could be said would be an answer
 * to a question we refuse to answer. In particular there is NO branch for "no
 * account with that address": GoTrue answers `200` either way - measured - so
 * there is nothing to map, and inventing a message would reintroduce the
 * account enumeration the sign-in and sign-up screens already avoid.
 *
 * `otp_expired` is the one code worth its own sentence, and it covers three
 * situations that are deliberately indistinguishable: a link already used, a
 * link past its hour, and a hash that was never real. All three answer `403
 * otp_expired`, and telling them apart would be telling someone holding a
 * stolen link which kind of failure they hit.
 */
export function recoveryErrorKey(failure: AuthFailure): AuthErrorKey {
  if (isNetworkFailure(failure)) return NETWORK;
  const code = failure.code ?? '';
  if (code === 'otp_expired' || code === 'otp_disabled') return 'authError.recoveryLinkDead';
  return SHARED[code] ?? GENERIC;
}
