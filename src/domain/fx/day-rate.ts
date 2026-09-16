import { fail } from '../errors';
import type { IsoDate } from './effective-date';
import { assertIsoDate } from './effective-date';

/**
 * Una publicación tal como consta en la observación que fija el día: su fecha
 * de referencia y los códigos de la fuente que trae.
 */
export interface ObservedPublication {
  readonly referenceDate: IsoDate;
  readonly sourceCodes: readonly string[];
}

/** Un intervalo de fechas de referencia cubiertas; `until` es inclusivo. */
export interface CoverageInterval {
  readonly from: IsoDate;
  readonly until: IsoDate | null;
}

/**
 * Cobertura curada de una definición monetaria (F11/ADR-002 §5).
 *
 * - `sourceCode: null` marca el **pivote** de la fuente (EUR en el BCE), que
 *   vale 1 y no aparece en las publicaciones.
 * - Sin cobertura (`null` en lugar de este objeto) la definición no tiene
 *   correspondencia con la fuente.
 */
export interface CurrencyCoverage {
  readonly sourceCode: string | null;
  readonly intervals: readonly CoverageInterval[];
}

export interface DayRateInput {
  readonly effectiveDate: IsoDate;
  /** Las publicaciones de la observación que fija el día, en cualquier orden. */
  readonly publications: readonly ObservedPublication[];
  /** Primera publicación de la historia de la fuente. */
  readonly sourceFirstReferenceDate: IsoDate;
  readonly coverage: CurrencyCoverage | null;
}

export type NotCoveredReason =
  'no_source_mapping' | 'no_reference_publication' | 'outside_coverage' | 'beyond_staleness_limit';

export type InsufficientReason = 'reference_publication_missing' | 'previous_publication_missing';

/**
 * El resultado, sin excepciones: son desenlaces esperados, no errores.
 *
 * - `selected`: la moneda tiene tipo el día X, con la fecha de referencia que
 *   indica. `position` dice si sale de R(X), de P(X) o si es el pivote.
 * - `not_covered`: la moneda no tiene tipo ese día. En la frontera,
 *   `FX_CURRENCY_NOT_COVERED · 422`.
 * - `observation_insufficient`: esta observación no puede fijar el día X
 *   (F11/ADR-002 §2, condición 7). No es un resultado de la moneda: el día
 *   sigue sin fijar y la frontera responde 503 hasta otra observación.
 */
export type DayRateSelection =
  | {
      readonly kind: 'selected';
      readonly referenceDate: IsoDate;
      readonly position: 'R' | 'P' | 'pivot';
    }
  | { readonly kind: 'not_covered'; readonly reason: NotCoveredReason }
  | { readonly kind: 'observation_insufficient'; readonly reason: InsufficientReason };

function latestBefore(dates: readonly IsoDate[], limit: IsoDate): IsoDate | null {
  let best: IsoDate | null = null;
  for (const date of dates) {
    if (date < limit && (best === null || date > best)) best = date;
  }
  return best;
}

function intervalContaining(
  intervals: readonly CoverageInterval[],
  date: IsoDate,
): CoverageInterval | null {
  return (
    intervals.find(
      (interval) => interval.from <= date && (interval.until === null || date <= interval.until),
    ) ?? null
  );
}

/**
 * El tipo de una moneda para la fecha efectiva X (F11/ADR-002 §3, §5 y §6).
 *
 * Orden de evaluación:
 *
 * 1. **Correspondencia con la fuente.** Sin ella, la moneda no está cubierta
 *    nunca, y no hace falta mirar el día (F11/ADR-001 §6, paso 5).
 * 2. **R(X)**, la publicación más reciente estrictamente anterior a X, de
 *    cualquier moneda. Si no hay y X es igual o anterior a la primera
 *    publicación de la fuente, no está cubierta. Si no hay por otro motivo,
 *    esta observación no alcanza a fijar el día.
 * 3. **P(X)**, la publicación inmediatamente anterior a R(X). Es obligatoria en
 *    la observación salvo que R(X) sea la primera de la fuente.
 * 4. **Cobertura curada.** R(X) tiene que estar dentro de un intervalo de la
 *    moneda; si no, no está cubierta, **aunque P(X) la tenga**.
 * 5. **Límite de antigüedad K = 1**, contado en publicaciones: la moneda usa
 *    R(X), o P(X) si falta en R(X) y P(X) no es anterior al inicio de su
 *    intervalo. Si falta en las dos, no está cubierta ese día.
 */
export function selectDayRate(input: DayRateInput): DayRateSelection {
  const x = assertIsoDate(input.effectiveDate);
  const first = assertIsoDate(input.sourceFirstReferenceDate);

  const byDate = new Map<IsoDate, readonly string[]>();
  for (const publication of input.publications) {
    const date = assertIsoDate(publication.referenceDate);
    if (byDate.has(date)) {
      fail('FX_PUBLICATION_DUPLICATED', `La fecha de referencia ${date} aparece dos veces`);
    }
    byDate.set(date, publication.sourceCodes);
  }

  if (input.coverage === null) return { kind: 'not_covered', reason: 'no_source_mapping' };

  const dates = [...byDate.keys()];
  const r = latestBefore(dates, x);
  if (r === null) {
    return x <= first
      ? { kind: 'not_covered', reason: 'no_reference_publication' }
      : { kind: 'observation_insufficient', reason: 'reference_publication_missing' };
  }

  const p = latestBefore(dates, r);
  if (p === null && r !== first) {
    return { kind: 'observation_insufficient', reason: 'previous_publication_missing' };
  }

  const interval = intervalContaining(input.coverage.intervals, r);
  if (interval === null) return { kind: 'not_covered', reason: 'outside_coverage' };

  const code = input.coverage.sourceCode;
  if (code === null) return { kind: 'selected', referenceDate: r, position: 'pivot' };

  if (byDate.get(r)?.includes(code) === true) {
    return { kind: 'selected', referenceDate: r, position: 'R' };
  }

  if (p !== null && p >= interval.from && byDate.get(p)?.includes(code) === true) {
    return { kind: 'selected', referenceDate: p, position: 'P' };
  }

  return { kind: 'not_covered', reason: 'beyond_staleness_limit' };
}
