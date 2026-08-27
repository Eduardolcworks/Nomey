/**
 * Reading a recovery deep link, and refusing everything else.
 *
 * Pure and with no React Native import, so it can be executed by tests rather
 * than only read as source. It parses a string and returns a proof or
 * `null`; it never calls anything, never stores anything, and never logs.
 *
 * WHAT ARRIVES, measured against this stack rather than assumed:
 *
 *   nomey-dev://auth/recovery?token_hash=<56 hex>&type=recovery
 *
 * **No access token and no refresh token, by construction.** The email
 * template writes this link itself and only interpolates `{{ .TokenHash }}`,
 * so there is no credential in the URL to leak, log or persist - the hash is a
 * one-time proof that is spent the moment it is redeemed. The alternative
 * shape, GoTrue's own verify endpoint redirecting with `#access_token=...`,
 * would have put real tokens in a URL and made this module a fragment parser.
 *
 * The `type` is checked and must be exactly `recovery`. A link is not trusted
 * to say what it is: this only decides *whether we are willing to try*, and
 * the server decides whether the proof is real. Redeeming a hash of the wrong
 * type would fail at `verifyOtp` anyway, but refusing here means a
 * confirmation or an email-change link can never be mistaken for a recovery
 * and never opens the set-a-new-password surface.
 */

/** The recovery destination, matched on path so any host form is accepted. */
const RECOVERY_PATH = 'auth/recovery';

/** GoTrue's hashes are lowercase hex. Anything else is not one. */
const TOKEN_HASH = /^[a-f0-9]{16,128}$/;

export type RecoveryProof = {
  /** Single-use, server-verified. Never persisted by us, never logged. */
  readonly tokenHash: string;
};

/**
 * A recovery proof, or `null` for every URL that is not one.
 *
 * `null` covers a great deal on purpose: a different path, a missing or wrong
 * `type`, a missing hash, a malformed hash, a URL that does not parse. None of
 * them are distinguished, because the caller does the same thing in every case
 * and telling them apart would only invite someone to report which.
 */
export function readRecoveryLink(url: string | null | undefined): RecoveryProof | null {
  if (typeof url !== 'string' || url === '') return null;

  const query = url.indexOf('?');
  if (query === -1) return null;

  // The path is whatever sits between the scheme and the query. Compared by
  // suffix because the authority differs between runtimes - a standalone build
  // gives `nomey://auth/recovery`, Expo Go `exp://<host>/--/auth/recovery` -
  // and the destination is the same one either way.
  const path = url.slice(0, query).replace(/\/+$/, '');
  if (!path.endsWith(RECOVERY_PATH)) return null;

  const params = new URLSearchParams(url.slice(query + 1));
  if (params.get('type') !== 'recovery') return null;

  const tokenHash = params.get('token_hash') ?? '';
  if (!TOKEN_HASH.test(tokenHash)) return null;

  return { tokenHash };
}
