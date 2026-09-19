/**
 * Tidying up what someone typed, and the smallest possible check that it is
 * worth sending.
 *
 * **The backend is the authority.** GoTrue owns the password policy
 * (`minimum_password_length`, `password_requirements`), owns what counts as a
 * valid address, and owns whether sign-up is open at all. Reimplementing any
 * of that here would produce two rules that drift, and the local copy would be
 * the one nobody updates.
 *
 * So this refuses exactly one thing: an empty field. Everything else is a
 * round trip, and the answer comes back mapped through `auth-errors`.
 *
 * The username is the one exception, and a bounded one (F12/ADR-001 §3): its
 * SYNTAX is a shared contract, mirrored in `src/domain/username` over the same
 * vectors the server reproduces, so a form can say «no vale» before the round
 * trip. Whether it is taken stays the server's alone.
 */

import { normalizeHandle, validateHandle, type UsernameProblem } from '@/domain';

export type Credentials = {
  readonly email: string;
  readonly password: string;
};

export type Registration = Credentials & {
  readonly displayName: string;
  /** What was typed, `@` and case included; the server stores the normalized form. */
  readonly username: string;
};

/**
 * Addresses are trimmed and lowercased.
 *
 * Trimming matters because iOS keyboards add a trailing space after
 * autocomplete. Lowercasing matters because someone who signs up as
 * `Ana@example.com` and signs in as `ana@example.com` is the same person and
 * would otherwise get "wrong credentials" with no way to work out why. The
 * local part of an address is technically case-sensitive; in practice no mail
 * provider treats it that way, and GoTrue itself stores addresses lowercased.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Names are only trimmed. Not lowercased, not capitalised, not stripped of
 * anything: it is a person's name, it is shown back to them, and every rule
 * beyond "no surrounding whitespace" gets some name wrong.
 */
export function normaliseDisplayName(raw: string): string {
  return raw.trim();
}

/** The password is passed through untouched - trimming it changes it. */
export function normaliseCredentials(raw: Credentials): Credentials {
  return { email: normaliseEmail(raw.email), password: raw.password };
}

/**
 * The stored form of the username when it has one (`@Eduardo` → `eduardo`),
 * or the trimmed input when it does not: the server refuses that one with its
 * own code, and sending the original keeps that refusal honest.
 */
export function normaliseUsername(raw: string): string {
  return normalizeHandle(raw) ?? raw.trim();
}

export function normaliseRegistration(raw: Registration): Registration {
  return {
    ...normaliseCredentials(raw),
    displayName: normaliseDisplayName(raw.displayName),
    username: normaliseUsername(raw.username),
  };
}

/**
 * What is wrong with a username as typed, or nothing. `empty` is the form's
 * own «rellena el campo»; `invalid` and `reserved` are the shared syntax of
 * F12/ADR-001 §3–§4, said before the round trip. «Taken» is never known here.
 */
export function usernameProblem(raw: string): UsernameProblem | 'empty' | null {
  if (raw.trim() === '') return 'empty';
  const v = validateHandle(raw);
  return v.ok ? null : v.problem;
}

/**
 * THE ONE password rule Nomey states up front, and where it comes from.
 *
 * GoTrue owns the password policy; this is not a second policy but the
 * server's OWN minimum, said before the round trip so a form can grey its
 * button and a field can say «Mínimo 6 caracteres» instead of failing with
 * `weak_password` afterwards. The value is `[auth] minimum_password_length`
 * in `supabase/config.toml` (6, which is also GoTrue's default), and a test
 * reads the toml and fails if the two ever drift. A hosted project keeps the
 * same minimum in its Dashboard (Authentication → Passwords); `weak_password`
 * from the server is still mapped, so a stricter server never gets past this
 * silently — it just answers.
 *
 * `password_requirements = ""`: no character classes are required, so none
 * are claimed here.
 */
export const PASSWORD_MIN_LENGTH = 6;

/** Whether a password satisfies the server's minimum length. Not trimmed, like the server. */
export function passwordMeetsMinimum(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

/**
 * Whether a registration can be SENT: every field present and the password at
 * the server's minimum. What an email is, and whether it is taken, stays the
 * server's call (`missingFields` and this both refuse to guess at more).
 */
export function registrationReady(raw: Registration): boolean {
  return (
    missingFields(raw).length === 0 &&
    passwordMeetsMinimum(raw.password) &&
    usernameProblem(raw.username) === null
  );
}

/** Which fields are empty once normalised. Nothing else is judged here. */
export function missingFields(raw: Partial<Registration>): (keyof Registration)[] {
  const missing: (keyof Registration)[] = [];
  if (raw.displayName !== undefined && normaliseDisplayName(raw.displayName) === '') {
    missing.push('displayName');
  }
  if (raw.username !== undefined && raw.username.trim() === '') missing.push('username');
  if (normaliseEmail(raw.email ?? '') === '') missing.push('email');
  if ((raw.password ?? '') === '') missing.push('password');
  return missing;
}

/**
 * What is wrong with a new password and its confirmation, or nothing.
 *
 * Two rules and no more, for the same reason `missingFields` refuses to do
 * more: **GoTrue owns the password policy** - length, character classes,
 * whether it has been leaked - and a second copy here would be the one nobody
 * updates when the server's changes. So this checks only what the server
 * cannot: that something was typed, and that the two boxes agree. Everything
 * else is a round trip whose answer arrives mapped.
 *
 * The confirmation is checked here rather than at the server because the
 * server never sees it. It exists to catch a typo in a value the user cannot
 * read back, which is the one thing a password field guarantees.
 */
export type PasswordProblem = 'empty' | 'mismatch';

export function passwordProblem(password: string, confirmation: string): PasswordProblem | null {
  // Not trimmed: whitespace is a legitimate part of a password, and trimming
  // it would silently change what the user chose.
  if (password === '') return 'empty';
  if (password !== confirmation) return 'mismatch';
  return null;
}
