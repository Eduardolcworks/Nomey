import { Spacing } from '@/ui/theme';

/**
 * The geometry of the floating dock, in one place.
 *
 * Screens need it as much as the controls do: the destinations and the action
 * float over the content, so a list that does not reserve their height leaves
 * its last row permanently covered and no amount of scrolling rescues it. The
 * defect only shows up once a list is long enough, which is late.
 *
 * That is also why this file exists rather than the numbers living in the bar:
 * the moment the dock's shape changed from one full-width bar to two floating
 * pills, its height changed too, and a constant computed somewhere else would
 * have silently gone stale.
 */
export const DOCK = {
  /** Height of a destination pill. */
  bar: 56,
  /** Diameter of the action button. */
  add: 56,
  /** Clear space between the action and the destinations. */
  gap: Spacing.sm,
  /** Space below the destinations, above the safe-area inset. */
  edge: Spacing.sm,
  /** Minimum width of a destination, so the two read as a matched pair. */
  destinationWidth: 132,
} as const;

/**
 * Everything a scrolling screen must reserve at the bottom, safe area aside.
 *
 * The caller adds `insets.bottom` and whatever breathing room it wants.
 */
export const DOCK_HEIGHT = DOCK.add + DOCK.gap + DOCK.bar + DOCK.edge;
