import { currencyDefinition, moneyFromMinorString } from '@/domain';

import { formatMoney } from './money';

/**
 * What `Intl` actually does on the device this is running on.
 *
 * Not a test - a measurement. Vitest runs on Node's V8, which has full ICU and
 * proves nothing about Hermes, whose `Intl` is a separate implementation
 * backed by the platform's own formatters. AGENTS.md is explicit that an
 * external behaviour is verified against reality rather than recalled, and
 * Hermes has historically shipped with `Intl` absent, partial, or with every
 * locale collapsed to one.
 *
 * The last check is the one that matters. It does not ask whether a feature
 * exists; it formats an amount larger than 2^53 through the real formatter and
 * compares the digits that come back. That is the property Nomey needs, and it
 * either holds on this device or it does not.
 */

export interface IntlCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const EUR = currencyDefinition({ id: 'probe-eur', code: 'EUR', scale: 2 });

/** 21 digits. Any conversion through `number` mangles the tail. */
const HUGE_MINOR = '123456789012345678901';

function check(id: string, run: () => { ok: boolean; detail: string }): IntlCheck {
  try {
    const { ok, detail } = run();
    return { id, ok, detail };
  } catch (error) {
    return { id, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function intlReport(): IntlCheck[] {
  return [
    check('Intl', () => ({
      ok: typeof Intl !== 'undefined',
      detail: typeof Intl,
    })),

    check('NumberFormat', () => ({
      ok: typeof Intl.NumberFormat === 'function',
      detail: new Intl.NumberFormat('en').format(1234.5),
    })),

    // The formatter's only hard dependency: without parts there is no pattern
    // to read, and money cannot be rendered exactly.
    check('formatToParts', () => {
      const parts = new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
      }).formatToParts(-12345678.9);
      return { ok: parts.length > 1, detail: `${String(parts.length)} parts` };
    }),

    check('DateTimeFormat', () => ({
      ok: typeof Intl.DateTimeFormat === 'function',
      detail: new Intl.DateTimeFormat('es-ES', {
        month: 'long',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 7, 27))),
    })),

    // A runtime with one locale reports every request as that locale. If this
    // says en-US, Spanish formatting is not happening whatever the catalogue
    // says.
    check('locale es-ES', () => {
      const resolved = new Intl.NumberFormat('es-ES').resolvedOptions().locale;
      return { ok: resolved.startsWith('es'), detail: resolved };
    }),

    check('locale en', () => {
      const resolved = new Intl.NumberFormat('en').resolvedOptions().locale;
      return { ok: resolved.startsWith('en'), detail: resolved };
    }),

    // Real locale data, not a stub: these two disagree about the separators
    // and about which side the symbol goes on.
    check('es-ES vs en', () => {
      const es = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
        1234567.89,
      );
      const en = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(
        1234567.89,
      );
      return { ok: es !== en, detail: `${es} | ${en}` };
    }),

    // Informational. Nomey does not rely on it, but if it holds everywhere the
    // pattern machinery could be retired one day.
    check('format(string)', () => {
      const formatter = new Intl.NumberFormat('en', { useGrouping: false });
      // ES2023 allows a string; the types do not, and Hermes may coerce it.
      const out = (formatter.format as (value: unknown) => string)(HUGE_MINOR);
      return { ok: out.replace(/\D/g, '') === HUGE_MINOR, detail: out };
    }),

    check('format(bigint)', () => {
      const out = new Intl.NumberFormat('en', { useGrouping: false }).format(BigInt(HUGE_MINOR));
      return { ok: out.replace(/\D/g, '') === HUGE_MINOR, detail: out };
    }),

    // The measurement that decides whether Nomey is safe here.
    check('exact > 2^53', () => {
      const formatted = formatMoney(moneyFromMinorString(HUGE_MINOR, EUR), 'en');
      return { ok: formatted.replace(/\D/g, '') === HUGE_MINOR, detail: formatted };
    }),
  ];
}
