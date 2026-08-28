import type { CalendarDate } from '@/lib/format';

/**
 * El intervalo que gobierna Inicio, traducido a fechas de calendario.
 *
 * **La semántica no se inventa aquí: la fija ADR-020 §3.** `effective_date` es
 * «el eje de agrupación por día, mes y año», con esas palabras, y
 * `effective_time` es un reloj de pared local que sólo ordena *dentro* del día.
 * De ahí se siguen las dos reglas de este módulo:
 *
 * - **el filtro es sobre fechas de calendario, nunca sobre instantes**, y por
 *   eso todo lo que sale de aquí es `YYYY-MM-DD`;
 * - **el intervalo es cerrado por los dos extremos**, que es lo que
 *   `api.personal_statistics` espera y lo que «agosto» significa: del 1 al 31.
 *
 * **Ningún concepto de interfaz cruza a SQL.** `day | month | year | all` vive
 * en este lado; la frontera recibe dos fechas ya resueltas.
 */
export type IntervalKind = 'day' | 'month' | 'year' | 'all';

export const INTERVALS: readonly IntervalKind[] = ['day', 'month', 'year', 'all'];

/** El que abre la pantalla. El mes es el horizonte natural de una economía doméstica. */
export const INITIAL_INTERVAL: IntervalKind = 'month';

/**
 * Los dos extremos, cualquiera de ellos ausente.
 *
 * `null` es «sin límite por ese lado», y los dos nulos son `Todo`. Es la misma
 * representación que acepta la frontera, así que no hay traducción intermedia
 * donde equivocarse.
 */
export type DateRange = {
  readonly from: CalendarDate | null;
  readonly to: CalendarDate | null;
};

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function calendarDate(year: number, month: number, day: number): CalendarDate {
  return `${year}-${pad(month)}-${pad(day)}` as CalendarDate;
}

/**
 * El último día de un mes, sin bibliotecas y sin desplazamientos.
 *
 * `Date.UTC(y, m, 0)` es el día 0 del mes siguiente, es decir el último del
 * pedido. **En UTC a propósito**: la aritmética de calendario no puede depender
 * de la zona del dispositivo, o febrero duraría un día distinto según dónde se
 * abra la app.
 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Hoy, en el calendario **del dispositivo**.
 *
 * Y esto es una decisión con consecuencia, así que se dice: `effective_date` no
 * tiene zona horaria y el par fecha+hora es un reloj de pared local
 * (ADR-020 §3). Comparar esa fecha contra el calendario **UTC** movería el día
 * para media Europa después de las 22:00, y el movimiento que alguien acaba de
 * registrar «hoy» dejaría de aparecer en `Día`. No fallaría nada: simplemente
 * faltaría.
 *
 * Por eso se leen los componentes **locales** del reloj, y por eso `now` se
 * inyecta: sin inyección esto no sería comprobable.
 */
export function todayInDeviceCalendar(now: Date = new Date()): CalendarDate {
  return calendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Traduce el selector a los dos extremos.
 *
 * `today` entra como dato, no se lee del reloj: el mismo intervalo tiene que
 * poder reproducirse en un test y en una captura sin depender de cuándo se
 * ejecute.
 */
export function resolveInterval(kind: IntervalKind, today: CalendarDate): DateRange {
  if (kind === 'all') return { from: null, to: null };

  const match = PARTS.exec(today);
  if (match === null) {
    // Una fecha ilegible no puede convertirse en un intervalo inventado: se
    // degrada a `Todo`, que muestra de más y nunca de menos.
    return { from: null, to: null };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (kind === 'day') {
    const date = calendarDate(year, month, day);
    return { from: date, to: date };
  }

  if (kind === 'month') {
    return {
      from: calendarDate(year, month, 1),
      to: calendarDate(year, month, lastDayOfMonth(year, month)),
    };
  }

  return { from: calendarDate(year, 1, 1), to: calendarDate(year, 12, 31) };
}

/** Clave estable de un intervalo, para no refetchear cuando no ha cambiado nada. */
export function rangeKey(range: DateRange): string {
  return `${range.from ?? '*'}..${range.to ?? '*'}`;
}
