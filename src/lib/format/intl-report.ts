import { currencyDefinition, moneyFromMinorString } from '@/domain';

import { formatMoney } from './money';

/**
 * What `Intl` actually does on the device this is running on.
 *
 * Not a test - a measurement. Vitest runs on Node's V8, which bundles full ICU
 * and proves nothing about Hermes, which bundles none and borrows whatever the
 * platform provides. That gap is not theoretical: it is how F4.B shipped a
 * screen that crashed on the first iPhone that opened it.
 *
 * **Nothing here may throw.** A diagnostic that dies when a capability is
 * missing reports nothing about the capability that is missing, which is the
 * one moment it exists for. Every probe is wrapped, and a missing optional
 * capability is a distinct outcome from a broken required one.
 */

export type IntlStatus =
  /** Present and behaving. */
  | 'ok'
  /** Absent, and Nomey does not need it. Not a failure. */
  | 'optional-absent'
  /** Absent or wrong, and something depends on it. */
  | 'failed';

export interface IntlCheck {
  readonly id: string;
  readonly status: IntlStatus;
  readonly detail: string;
}

const EUR = currencyDefinition({ id: 'probe-eur', code: 'EUR', scale: 2 });

/** 21 digits. Any trip through `number` mangles the tail. */
const HUGE_MINOR = '123456789012345678901';

function probe(
  id: string,
  optional: boolean,
  run: () => { ok: boolean; detail: string },
): IntlCheck {
  try {
    const { ok, detail } = run();
    if (ok) return { id, status: 'ok', detail };
    return { id, status: optional ? 'optional-absent' : 'failed', detail };
  } catch (error) {
    return {
      id,
      status: optional ? 'optional-absent' : 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function intlReport(): IntlCheck[] {
  return [
    probe('Intl.NumberFormat', false, () => ({
      ok: typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function',
      detail: typeof Intl === 'undefined' ? 'no Intl' : typeof Intl.NumberFormat,
    })),

    // The single method the formatter is built on.
    probe('.format', false, () => {
      const out = new Intl.NumberFormat('en').format(1234.5);
      return { ok: out.length > 0, detail: out };
    }),

    // Absent on iOS by Hermes' own documentation - "supported on Android
    // only". Optional on purpose: nothing in Nomey calls it, and this row
    // exists so its absence reads as expected rather than as damage.
    probe('.formatToParts', true, () => {
      const method = (Intl.NumberFormat.prototype as { formatToParts?: unknown }).formatToParts;
      if (typeof method !== 'function') return { ok: false, detail: 'undefined' };
      const parts = new Intl.NumberFormat('en').formatToParts(1234.5);
      return { ok: parts.length > 0, detail: `${String(parts.length)} parts` };
    }),

    probe('Intl.DateTimeFormat', false, () => {
      const out = new Intl.DateTimeFormat('es-ES', {
        month: 'long',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 7, 27)));
      return { ok: out.length > 0, detail: out };
    }),

    // A runtime with one locale answers every request with it. If these two
    // agree, Spanish formatting is not happening whatever the catalogue says.
    probe('locale es-ES', false, () => {
      const formatted = new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
      }).format(1234567.89);
      return { ok: formatted.includes('.') && formatted.includes(','), detail: formatted };
    }),

    probe('locale en', false, () => {
      const formatted = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: 'EUR',
      }).format(1234567.89);
      return { ok: formatted.includes(','), detail: formatted };
    }),

    // Nomey's own route, end to end, on this runtime.
    probe('ruta Nomey', false, () => {
      const out = formatMoney(moneyFromMinorString('123456', EUR), 'es-ES');
      return { ok: out.includes('1234'), detail: out };
    }),

    // The measurement that decides whether Nomey is safe here. It does not ask
    // whether a feature exists; it runs 21 digits through the real formatter
    // and compares what comes back.
    probe('exactitud > 2^53', false, () => {
      const formatted = formatMoney(moneyFromMinorString(HUGE_MINOR, EUR), 'en');
      return { ok: formatted.replace(/\D/g, '') === HUGE_MINOR, detail: formatted };
    }),
  ];
}
