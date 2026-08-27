/**
 * Turning a display name into the things the interface shows.
 *
 * Pure, and in its own module rather than beside the avatar that renders it,
 * for a reason worth stating: anything importing `react-native` cannot be
 * executed by Vitest, which has no React Native transform. A rule that lives
 * in a component can only ever be asserted by reading its source; the same
 * rule here gets run against real input. `credentials.ts` is pure for exactly
 * the same reason.
 */

/**
 * Up to two initials, or `null` when there is no name to take them from.
 *
 * `null` is a real answer, not a failure: it is what tells the avatar to draw
 * a silhouette instead of a letter. The alternative - a placeholder initial,
 * or two characters taken from the email address - would put an invented
 * identity on the largest element of the screen. The local part of an address
 * is not a name, and this module is deliberately given no way to see one.
 *
 * First word and last word, so "Ana María Pérez" reads AP rather than AM: a
 * surname identifies more than a second forename. A single word gives a single
 * letter, because padding it to two would mean making one up.
 *
 * Split by code point rather than by UTF-16 unit. Slicing a name that starts
 * outside the basic plane - an emoji, some scripts - at one unit would cut a
 * surrogate pair in half and produce a character that is not valid on its own.
 */
export function initialsFrom(name: string | null): string | null {
  if (name === null) return null;

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';

  const initials = `${first}${last}`.toLocaleUpperCase();
  return initials === '' ? null : initials;
}
