import type { GroupOperation, GroupOrder } from './group-service';
import type { GroupPayment } from './payment-service';

/**
 * MOVIMIENTOS ES UNA SOLA CRONOLOGÍA. Gastos y pagos registrados («Saldado»)
 * se listan juntos, en el orden que la persona eligió, y NUNCA agrupados por
 * tipo: un pago del día 11 va entre el gasto del 10 y el del 12.
 *
 * El criterio es el que `fetchGroupOperations` ya pide al servidor para los
 * gastos, aplicado aquí a la unión porque son dos vistas distintas:
 *
 *   por fecha    `effective_date`, y dentro del día la hora en el mismo
 *                sentido con los que no tienen hora AL FINAL en los dos
 *                sentidos (F06/ADR-002 §3: sin hora no es medianoche, es «no
 *                se sabe»);
 *   por importe  el importe entero del gasto o del pago, en unidades menores.
 *
 * **Desempate estable, siempre**: el instante de alta descendente y, en
 * última instancia, la identidad de la operación. Dos movimientos del mismo
 * instante no cambian de sitio entre dos lecturas.
 *
 * Hoja PURA —sin React ni Supabase— para que se pruebe con datos de mesa.
 */
export type TimelineEntry =
  | { readonly kind: 'expense'; readonly operation: GroupOperation }
  | { readonly kind: 'payment'; readonly payment: GroupPayment };

type SortKey = {
  readonly date: string;
  readonly time: string | null;
  readonly minor: bigint;
  readonly createdAt: string;
  readonly id: string;
};

function keyOf(entry: TimelineEntry): SortKey {
  return entry.kind === 'expense'
    ? {
        date: entry.operation.effectiveDate,
        time: entry.operation.effectiveTime,
        minor: BigInt(entry.operation.totalMinor),
        createdAt: entry.operation.createdAt,
        id: entry.operation.operationId,
      }
    : {
        date: entry.payment.effectiveDate,
        time: entry.payment.effectiveTime,
        minor: BigInt(entry.payment.amountMinor),
        createdAt: entry.payment.createdAt,
        id: entry.payment.operationId,
      };
}

/** `a` antes que `b` en orden ascendente por fecha y hora, sin hora al final. */
function byDate(a: SortKey, b: SortKey): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.time === b.time) return 0;
  if (a.time === null) return 1;
  if (b.time === null) return -1;
  return a.time < b.time ? -1 : 1;
}

function byAmount(a: SortKey, b: SortKey): number {
  return a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1;
}

/** El desempate: alta más reciente primero y, a igualdad, la identidad. */
function stable(a: SortKey, b: SortKey): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mergeTimeline(
  operations: readonly GroupOperation[],
  payments: readonly GroupPayment[],
  order: GroupOrder,
): readonly TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...operations.map((operation): TimelineEntry => ({ kind: 'expense', operation })),
    ...payments.map((payment): TimelineEntry => ({ kind: 'payment', payment })),
  ];
  const keyed = entries.map((entry) => ({ entry, key: keyOf(entry) }));
  keyed.sort((left, right) => {
    const primary =
      order === 'dateDesc'
        ? dateDesc(left.key, right.key)
        : order === 'dateAsc'
          ? byDate(left.key, right.key)
          : order === 'amountDesc'
            ? byAmount(right.key, left.key)
            : byAmount(left.key, right.key);
    return primary !== 0 ? primary : stable(left.key, right.key);
  });
  return keyed.map((one) => one.entry);
}

/**
 * Descendente por fecha y hora, pero con los SIN HORA al final del día igual
 * que en ascendente (`nulls last` en los dos sentidos, como pide el servidor).
 */
function dateDesc(a: SortKey, b: SortKey): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.time === b.time) return 0;
  if (a.time === null) return 1;
  if (b.time === null) return -1;
  return a.time < b.time ? 1 : -1;
}
