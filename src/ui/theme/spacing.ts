/**
 * Spacing and radius scale.
 *
 * Replaces the template's half/one/two/.../six naming, whose numeric names did
 * not match their values (three = 16, six = 64) and read as a sequence when it
 * was really a t-shirt scale.
 */

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/** Widest comfortable measure for text content. */
export const MaxContentWidth = 800;
