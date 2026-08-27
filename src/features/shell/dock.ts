import { Spacing } from '@/ui/theme';

/**
 * The geometry of the bottom dock, in one place.
 *
 * Screens need it as much as the bar does: the action button floats over the
 * content, so a list that does not reserve its height leaves its last row
 * permanently covered, and no amount of scrolling rescues it. That defect is
 * invisible until a list is long enough, which is late.
 *
 * `add` sits fully above `bar` rather than straddling it - see the comment in
 * `nomey-tab-bar.tsx` for why.
 */
export const DOCK = {
  /** Bar height, before the safe-area inset is added underneath. */
  bar: 56,
  /** Diameter of the action button. */
  add: 56,
  /** Clear space between the button and the bar. */
  gap: Spacing.sm,
} as const;

/** Everything a scrolling screen must reserve at the bottom, safe area aside. */
export const DOCK_HEIGHT = DOCK.bar + DOCK.add + DOCK.gap;
