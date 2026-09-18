import { isReservedHandle } from './reserved';

/**
 * The username's syntax and normalization (F12/ADR-001 §3), client half.
 *
 * The same pipeline lives in `sec.normalize_handle` / `sec.assert_handle_valid`
 * in PostgreSQL, and neither implementation imports the other: parity is
 * guaranteed by `tests/vectors/username.json`, as F01/ADR-001 §7 does for the
 * split. The server is the authority on uniqueness and the one that refuses;
 * this only lets a form say «no vale» before the round trip, so the two must
 * never disagree on what a handle looks like.
 *
 * Pipeline, in this order:
 *
 *   1. NFKC — folds compatibility forms only (`ａ` → `a`, `①` → `1`, `ﬁ` → `fi`);
 *      never transliterates (`á` stays `á`, and is refused).
 *   2. Trim the ASCII blanks PostgreSQL's `\s` knows (space, tab, LF, CR, FF, VT).
 *      NFKC already turned NBSP and the ideographic space into plain spaces.
 *   3. Drop ONE leading `@`: presentation, never stored.
 *   4. Require ASCII `[A-Za-z0-9_]` BEFORE lowercasing, so `İ` or `ß` never
 *      depend on a locale's idea of case folding.
 *   5. Lowercase, then the shape `^[a-z](_?[a-z0-9])*$` and the length 3–20.
 */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;
export const HANDLE_SHAPE = /^[a-z](_?[a-z0-9])*$/;

const ASCII_ALPHABET = /^[A-Za-z0-9_]+$/;
const OUTER_BLANKS = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/** Why a raw handle names nothing. `reserved` carries the normalized form. */
export type UsernameProblem = 'invalid' | 'reserved';

export type HandleValidation =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly problem: 'invalid' }
  | { readonly ok: false; readonly problem: 'reserved'; readonly handle: string };

/**
 * The stored form of what someone typed, or `null` if it does not satisfy §3.
 * Says nothing about reservation or availability: see `validateHandle`.
 */
export function normalizeHandle(raw: string): string | null {
  let value = raw.normalize('NFKC').replace(OUTER_BLANKS, '');
  if (value.startsWith('@')) value = value.slice(1);
  if (!ASCII_ALPHABET.test(value)) return null;
  value = value.toLowerCase();
  if (value.length < HANDLE_MIN_LENGTH || value.length > HANDLE_MAX_LENGTH) return null;
  if (!HANDLE_SHAPE.test(value)) return null;
  return value;
}

/**
 * Syntax and reservation together, in the server's order: a handle that does
 * not satisfy §3 is `invalid` before anyone asks whether it is reserved.
 * Availability (`USERNAME_TAKEN`) is the server's alone.
 */
export function validateHandle(raw: string): HandleValidation {
  const handle = normalizeHandle(raw);
  if (handle === null) return { ok: false, problem: 'invalid' };
  if (isReservedHandle(handle)) return { ok: false, problem: 'reserved', handle };
  return { ok: true, handle };
}
