import type { TextStyle } from 'react-native';

import { Fonts } from './fonts';

/**
 * Type roles.
 *
 * Roles, not sizes: a component asks for `amountHero`, never for "32px bold".
 * That is what lets the scale move without touching screens.
 *
 * Two rules specific to a finance app:
 *
 * 1. **Numeric roles use tabular figures.** With proportional digits a column
 *    of amounts does not align and the decimal point wanders, which makes a
 *    list of movements measurably harder to scan. `tabular-nums` fixes the
 *    advance width of every digit.
 * 2. **An amount is never rendered with a body role.** Amounts are the
 *    information design-direction.md section 2 singles out as needing the most
 *    legibility, so they have their own roles and their own weights.
 */
export type TypographyRole =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'bodySmall'
  | 'label'
  | 'caption'
  | 'amountHero'
  | 'amountLarge'
  | 'amountRow'
  | 'mono';

export const Typography: Record<TypographyRole, TextStyle> = {
  /** Screen-level hero. One per screen at most. */
  display: {
    fontFamily: Fonts.sans,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  /** Screen title. */
  title: {
    fontFamily: Fonts.sans,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  /** Section heading inside a screen. */
  heading: {
    fontFamily: Fonts.sans,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  /** Sub-heading, list group header. */
  subheading: {
    fontFamily: Fonts.sans,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  /** Default running text. */
  body: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
  },
  /** Running text that carries weight: a row's primary line. */
  bodyStrong: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  /** Secondary line: a date, a payer, a category. */
  bodySmall: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '400',
  },
  /** Buttons, tabs, chips, segmented controls. */
  label: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  /** The smallest role that may carry meaning. */
  caption: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  /** The headline balance of a screen. Tabular. */
  amountHero: {
    fontFamily: Fonts.sans,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  /** An amount inside a card or a summary. Tabular. */
  amountLarge: {
    fontFamily: Fonts.sans,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  /** An amount in a list row. Tabular, and the reason tabular exists here. */
  amountRow: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  /** Identifiers, codes, debug. Never an amount. */
  mono: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
};
