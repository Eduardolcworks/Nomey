import type { TextStyle } from 'react-native';

import { Fonts } from './fonts';

/**
 * Type roles.
 *
 * Roles, not sizes: a component asks for `amountRow`, never for "17px
 * semibold". That is what lets the scale move without touching screens.
 *
 * **The system font, on both platforms.** No role declares a `fontFamily`, so
 * React Native resolves the platform default - SF Pro on iOS, Roboto on
 * Android. Naming a family here would either be a lie on one platform or a
 * value that resolves only by falling back, and no custom face is shipped to
 * imitate either one. Only `mono` names a family, because it needs a specific
 * one. The sizes and leading below follow the native iOS scale - 34/41, 28/34,
 * 22/28, 20/25, 17/22, 15/20, 12/16 - so text lands where the platform puts it.
 *
 * **No role sets `letterSpacing`.** SF Pro carries optical tracking per size
 * and tightens large text on its own; adding negative tracking on top tightens
 * it twice, which is what makes a display line read as styled rather than as
 * typeset. Tracking is not a decoration Nomey applies.
 *
 * **Weight carries meaning, and Bold belongs to money.**
 *
 *     700  the two display amounts, and nothing else
 *     600  structure - titles, headings, labels, the amount in a row
 *     500  emphasis inside prose
 *     400  prose
 *
 * That axis is what keeps a screen from having two heroes. A large title and a
 * headline balance sit six points apart, so if both were Bold the balance
 * would not win; at 600 against 700 it does. It also keeps two Bold blocks off
 * an OLED black, where light text blooms and heavy weights read heavier than
 * they measure.
 *
 * Two rules specific to a finance app:
 *
 * 1. **Numeric roles use tabular figures.** With proportional digits a column
 *    of amounts does not align and the decimal point wanders, which makes a
 *    list of movements measurably harder to scan. `tabular-nums` fixes the
 *    advance width of every digit.
 * 2. **An amount is never rendered with a body role.** Amounts are the
 *    information design-direction.md section 2 singles out as needing the most
 *    legibility, so they have their own roles - and, above, their own weight.
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

/**
 * `color` is deliberately excluded.
 *
 * `ThemedText` applies the theme colour first and the role second, so a role
 * that carried its own `color` would silently win over the caller's
 * `themeColor` - and `TextStyle` would let one be added without a type error.
 * Colour comes from the theme; a role decides shape only.
 */
export const Typography: Record<TypographyRole, Omit<TextStyle, 'color'>> = {
  /** Screen-level hero. One per screen at most. */
  display: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '600',
  },
  /** Screen title. */
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
  },
  /** Section heading inside a screen. */
  heading: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
  },
  /** List group header: a month, a category, a scope. */
  subheading: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
  },
  /** Default running text. */
  body: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
  },
  /** Running text that carries weight: a row's primary line. */
  bodyStrong: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '500',
  },
  /** Secondary line: a date, a payer, a category. */
  bodySmall: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
  },
  /** Buttons, tabs, chips, segmented controls. */
  label: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  /**
   * The smallest role that may carry meaning.
   *
   * A step above the native Caption's regular weight: at twelve points on a
   * black ground, regular goes thin before it goes small.
   */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },

  /** The headline balance of a screen. Tabular, and the only true hero. */
  amountHero: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  /** An amount inside a card or a summary. Tabular. */
  amountLarge: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  /**
   * An amount in a list row. Tabular, and the reason tabular exists here.
   *
   * Deliberately heavier than the `bodyStrong` it sits beside, so the figure
   * leads its row instead of merely joining it.
   */
  amountRow: {
    fontSize: 17,
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
