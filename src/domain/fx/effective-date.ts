import { fail } from '../errors';

/**
 * Una fecha de calendario en forma ISO `AAAA-MM-DD`.
 *
 * Con esa forma, el orden lexicográfico es el orden del calendario, y las
 * comparaciones no necesitan ni `Date` ni zona horaria: la fecha efectiva es
 * una fecha local sin zona (F06/ADR-002 §3).
 */
export type IsoDate = string;

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const;
const LAST_DAY: Readonly<Record<string, string>> = {
  '01': '31',
  '02': '28',
  '03': '31',
  '04': '30',
  '05': '31',
  '06': '30',
  '07': '31',
  '08': '31',
  '09': '30',
  '10': '31',
  '11': '30',
  '12': '31',
};

function isLeapYear(year: string): boolean {
  const y = BigInt(year);
  return (y % 4n === 0n && y % 100n !== 0n) || y % 400n === 0n;
}

/** ¿Es una fecha real de calendario en forma `AAAA-MM-DD`? */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match;
  if (!(MONTHS as readonly string[]).includes(month)) return false;
  const last = month === '02' && isLeapYear(year) ? '29' : LAST_DAY[month];
  return day >= '01' && day <= last;
}

export function assertIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) {
    fail('EFFECTIVE_DATE_INVALID', `No es una fecha AAAA-MM-DD válida: "${value}"`);
  }
  return value;
}

/**
 * Qué hace la conversión con una fecha efectiva, antes de mirar ningún tipo.
 *
 * - `payload_invalid`: `infinity` o `-infinity`. Nunca llegan a tener tipo, y
 *   la frontera los rechaza como `PAYLOAD_INVALID` (decisión de F11.B; solo en
 *   el camino con conversión, sin cambiar la validación de fechas de las demás
 *   clases).
 * - `no_reference_publication`: la fecha es igual o anterior a la primera
 *   publicación de la fuente, así que no existe ninguna anterior a ella
 *   (F11/ADR-002 §6): moneda no cubierta.
 * - `resolvable`: cualquier otra fecha finita, **incluidas las futuras**. Si ya
 *   tiene tipo lo decide la fijación del día, no esta función.
 */
export type FxEffectiveDateClass = 'payload_invalid' | 'no_reference_publication' | 'resolvable';

export function classifyFxEffectiveDate(
  effectiveDate: string,
  sourceFirstReferenceDate: IsoDate,
): FxEffectiveDateClass {
  if (effectiveDate === 'infinity' || effectiveDate === '-infinity') return 'payload_invalid';
  const date = assertIsoDate(effectiveDate);
  return date <= assertIsoDate(sourceFirstReferenceDate)
    ? 'no_reference_publication'
    : 'resolvable';
}
