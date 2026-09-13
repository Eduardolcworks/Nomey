import type { FormatLocale } from '../i18n/locales';

/**
 * Dates, localised.
 *
 * **The input is a calendar date, not an instant.** An operation's effective
 * date is a `date` in the database - a day, with no time and no zone. Turning
 * `'2026-08-27'` into a `Date` and formatting it locally shifts it by a day
 * for anyone west of UTC, which would silently move a movement to the wrong
 * day for a whole timezone of users.
 *
 * So a calendar date is parsed as UTC and formatted as UTC. The pair has to
 * match: parsing as UTC and formatting locally reintroduces the same shift.
 */
export type CalendarDate = `${number}-${number}-${number}`;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateStyle = 'short' | 'medium' | 'long';

const STYLES: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  /** `27/8/26` - dense enough for a list row. */
  short: { day: 'numeric', month: 'numeric', year: '2-digit' },
  /** `27 ago 2026` - unambiguous about which number is the month. */
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  /** `27 de agosto de 2026` - for a detail screen. */
  long: { day: 'numeric', month: 'long', year: 'numeric' },
};

/**
 * Formats a `YYYY-MM-DD` calendar date.
 *
 * Returns the input unchanged if it is not a calendar date, rather than
 * throwing or rendering `Invalid Date`: a malformed date on screen is
 * diagnosable, and a screen that will not render is not.
 */
export function formatDate(
  date: string,
  locale: FormatLocale,
  style: DateStyle = 'medium',
): string {
  const match = CALENDAR_DATE.exec(date);
  if (match === null) return date;

  const [, year, month, day] = match;
  const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(utc.getTime())) return date;

  try {
    return new Intl.DateTimeFormat(locale, { ...STYLES[style], timeZone: 'UTC' }).format(utc);
  } catch {
    // Hermes borrows each platform's date formatter rather than bundling ICU,
    // so an option combination can be rejected on a device and nowhere else.
    // The ISO date is still readable; a screen that will not render is not.
    return date;
  }
}

/** The locale's own month names, for a picker or a chart axis. */
export function monthNames(locale: FormatLocale, width: 'short' | 'long' = 'long'): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: width, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2026, index, 1))),
  );
}

/**
 * LA HORA DE PARED DE UN INSTANTE, como `HH:MM` del calendario del aparato.
 *
 * Es el reloj LOCAL, igual que `effective_date`: el par fecha+hora es un reloj
 * de pared sin zona (F06/ADR-002 §3), y por eso sale de `getHours`/`getMinutes` y
 * no de UTC. Minutos y no segundos: es la precisión que el contrato guarda y
 * la que una persona elige.
 *
 * Vive en `lib/format` porque la usan dos features —el movimiento personal y
 * el gasto compartido— que no pueden importarse entre sí.
 */
export function clockTimeOf(value: Date): `${string}:${string}` {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/** Un `Date` de hoy a la hora `HH:MM` dada, para sembrar un selector de hora. */
export function dateAtClockTime(time: string, base: Date = new Date()): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const out = new Date(base);
  out.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return out;
}
