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
 */

export type Credentials = {
  readonly email: string;
  readonly password: string;
};

export type Registration = Credentials & { readonly displayName: string };

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

export function normaliseRegistration(raw: Registration): Registration {
  return { ...normaliseCredentials(raw), displayName: normaliseDisplayName(raw.displayName) };
}

/** Which fields are empty once normalised. Nothing else is judged here. */
export function missingFields(raw: Partial<Registration>): (keyof Registration)[] {
  const missing: (keyof Registration)[] = [];
  if (raw.displayName !== undefined && normaliseDisplayName(raw.displayName) === '') {
    missing.push('displayName');
  }
  if (normaliseEmail(raw.email ?? '') === '') missing.push('email');
  if ((raw.password ?? '') === '') missing.push('password');
  return missing;
}
