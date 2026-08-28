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

/**
 * What a failed redemption PROVED, which is not the same as what it said.
 *
 * The distinction this makes is the one the previous version did not: a `403
 * otp_expired` is the server's word that the proof is no longer a proof, and a
 * transport failure is the absence of any word at all. Measured on device: the
 * link was redeemed against an unreachable server, the app announced "Enlace no
 * válido", and the one-time token was still sitting alive in GoTrue - untouched,
 * because the request never arrived.
 *
 * So `outcome` is about the TOKEN and `titleKey` is about what we are entitled
 * to claim. Only `dead` may say the link is invalid; everything else - no
 * response, a rate limit, a 500 - proved nothing about the link and says so.
 *
 * **And `unresolved` says exactly that, once.** It used to carry whatever
 * sentence the failure mapped to, which meant a 429 or a 500 announced "Sin
 * conexión" - a claim about the network that nobody had established either. The
 * class is "we could not check it", so it has one sentence for the whole class:
 * no diagnosis, no distinction between transport, a rate limit and a 500, and
 * nothing technical for anyone to read off the screen.
 *
 * The non-enumeration stays exactly as it was: `dead` still collapses used,
 * superseded, expired and invented into one sentence, because telling them
 * apart would tell whoever holds a stolen link which kind of failure they hit.
 */
export type RecoveryErrorTitleKey =
  /** The server's verdict: this is no longer a proof. */
  | 'auth.recoveryFailedTitle'
  /** No verdict. The link may be perfectly good. */
  | 'auth.recoveryUnresolvedTitle'
  /** The link was fine; the session it opened is provably gone. */
  | 'auth.recoveryExpiredTitle';

export type RecoveryFailure = {
  /** `dead` only when the server said so. Anything else proved nothing. */
  readonly outcome: 'dead' | 'unresolved';
  /** Never the session title: this classifier only ever judges the proof. */
  readonly titleKey: Exclude<RecoveryErrorTitleKey, 'auth.recoveryExpiredTitle'>;
  readonly messageKey: AuthErrorKey;
};

export function recoveryFailure(failure: AuthFailure): RecoveryFailure {
  if (recoveryErrorKey(failure) === 'authError.recoveryLinkDead') {
    return {
      outcome: 'dead',
      titleKey: 'auth.recoveryFailedTitle',
      messageKey: 'authError.recoveryLinkDead',
    };
  }

  return {
    outcome: 'unresolved',
    titleKey: 'auth.recoveryUnresolvedTitle',
    messageKey: 'authError.recoveryLinkUnchecked',
  };
}

/**
 * What the SAVE is allowed to say, which is not what the link is allowed to say.
 *
 * By the time this runs the link has already been redeemed: `verifyOtp`
 * succeeded and the ephemeral session exists. So nothing here may borrow the
 * link's vocabulary - "Enlace no válido" over a rejected password is simply
 * false, and it sends the person to ask for a link that was never the problem.
 * It never returns a link key at all, which is what keeps that structural: the
 * sentence is shown INSIDE the form, next to the field that produced it, and
 * the transaction does not move.
 *
 * That includes an ephemeral session that has stopped being usable. GoTrue
 * answers that authoritatively, but it is a statement about the session, not
 * about the proof, so it lands in the neutral sentence like everything else -
 * never in the dead-link one.
 *
 * One code earns a sentence of its own: `weak_password`, because it is the one
 * failure the person can actually act on and Nomey already has a normalised,
 * safe way to say it. Everything else - a rate limit, a 500, an unexpected
 * throw - answers with the neutral sentence. GoTrue's own text never reaches
 * the screen, here least of all: this is the one form where the value being
 * refused is a password.
 *
 * And one class of failure ends the transaction instead of annotating the
 * form: an ephemeral session the server has told us is unusable. See
 * `SESSION_LOST` for exactly which codes, and why the list is short.
 */
export type RecoverySaveFailure =
  /**
   * Stay on the form. Either the person can fix it, or nothing was proven -
   * and in both cases another tap on Guardar is a sensible thing to do.
   */
  | { readonly outcome: 'retryable'; readonly messageKey: AuthErrorKey }
  /**
   * The ephemeral session is provably unusable, so the transaction is over.
   *
   * This is the one save failure that must NOT keep offering a retry: the
   * proof was already spent by `verifyOtp`, and no number of `updateUser`
   * calls can bring back the session it produced. Leaving the form up would
   * be an invitation to loop forever.
   */
  | {
      readonly outcome: 'session-lost';
      readonly titleKey: 'auth.recoveryExpiredTitle';
      readonly messageKey: 'authError.recoverySessionLost';
    };

/**
 * The codes that DEMONSTRATE the ephemeral session cannot be used again.
 *
 * Read from `@supabase/auth-js@2.112.4`'s own `ErrorCode` union rather than
 * guessed, and kept to the ones whose meaning is unambiguous:
 *
 * - `session_not_found` / `session_expired` - the session behind the token is
 *   gone or past its lifetime.
 * - `bad_jwt` - the token itself is not acceptable.
 * - `refresh_token_not_found` / `refresh_token_already_used` - `updateUser`
 *   loads the session first and will refresh an expired access token even with
 *   `autoRefreshToken: false`, so these do reach this path, and both mean the
 *   session cannot be renewed.
 * - `no_authorization` - the request carried no bearer at all.
 *
 * **Status is deliberately NOT a rule.** A bare `401` would be a blunt
 * instrument: it covers cases that say nothing about our session, and this
 * classification decides whether someone loses their recovery. The local
 * `AuthSessionMissingError` is included by name because auth-js raises it with
 * no code, `status: 400`, and it means exactly this - the client holds no
 * session, which is also what a disposed ephemeral client looks like.
 *
 * Everything else stays retryable, on purpose. `reauthentication_needed` is the
 * interesting near-miss: it demands a nonce, but the session is perfectly
 * valid, so it is not this. If a code cannot be shown to mean "unusable", the
 * conservative answer is to keep the form.
 */
const SESSION_LOST: ReadonlySet<string> = new Set([
  'session_not_found',
  'session_expired',
  'bad_jwt',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'no_authorization',
]);

export function recoverySaveFailure(failure: AuthFailure): RecoverySaveFailure {
  if (failure.name === 'AuthSessionMissingError' || SESSION_LOST.has(failure.code ?? '')) {
    return {
      outcome: 'session-lost',
      titleKey: 'auth.recoveryExpiredTitle',
      messageKey: 'authError.recoverySessionLost',
    };
  }

  if (failure.code === 'weak_password') {
    return { outcome: 'retryable', messageKey: 'authError.weakPassword' };
  }

  return { outcome: 'retryable', messageKey: 'authError.passwordChangeFailed' };
}
