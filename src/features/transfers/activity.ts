/**
 * INTERLEAVING TRANSFERS INTO THE PERSONAL ACTIVITY.
 *
 * `api.personal_operation` does not list `internal_transfer` (measured: its
 * class whitelist stops at `group_payment`), so the transfers reach the
 * screen through `api.my_transfers` and the route merges the two lists. The
 * order is the one `personal_operation` is paged by — effective date, then
 * time with nulls last, then creation, then id, all descending — so a
 * transfer lands exactly where the server would have put it.
 *
 * The list of operations is PAGED and the list of transfers is not. While
 * older pages are still unloaded, a transfer older than the last loaded
 * operation is held back: painting it now would show it above operations
 * that are older than it once they load, and the order would visibly jump.
 * With every page loaded, everything is shown.
 *
 * Pure; the route supplies the keys so this module knows nothing of the
 * Personal feature's types.
 */

export type ActivityKey = {
  readonly effectiveDate: string;
  readonly effectiveTime: string | null;
  readonly createdAt: string;
  readonly id: string;
};

export type ActivityEntry<O, T> =
  | { readonly kind: 'operation'; readonly operation: O }
  | { readonly kind: 'transfer'; readonly transfer: T };

/** Negative when `a` sorts BEFORE `b` in the activity (newest first). */
export function compareActivity(a: ActivityKey, b: ActivityKey): number {
  if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1;
  // Minutes are the grain: the server publishes HH:MM:SS and the app writes
  // HH:MM, and "17:25" must equal "17:25:00", not sort before it.
  const at = a.effectiveTime === null ? null : a.effectiveTime.slice(0, 5);
  const bt = b.effectiveTime === null ? null : b.effectiveTime.slice(0, 5);
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return at < bt ? 1 : -1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export function interleaveActivity<O, T>(
  operations: readonly O[],
  transfers: readonly T[],
  keyOfOperation: (operation: O) => ActivityKey,
  keyOfTransfer: (transfer: T) => ActivityKey,
  hasMoreOperations: boolean,
): readonly ActivityEntry<O, T>[] {
  const last = operations.length === 0 ? null : keyOfOperation(operations[operations.length - 1]);
  const shown =
    hasMoreOperations && last !== null
      ? transfers.filter((one) => compareActivity(keyOfTransfer(one), last) <= 0)
      : transfers;

  const entries: { readonly entry: ActivityEntry<O, T>; readonly key: ActivityKey }[] = [
    ...operations.map((operation) => ({
      entry: { kind: 'operation', operation } as const,
      key: keyOfOperation(operation),
    })),
    ...shown.map((transfer) => ({
      entry: { kind: 'transfer', transfer } as const,
      key: keyOfTransfer(transfer),
    })),
  ];
  entries.sort((a, b) => compareActivity(a.key, b.key));
  return entries.map((one) => one.entry);
}

/**
 * WHEN A TRANSFER HAPPENED, in the device's own calendar and clock.
 *
 * Measured against the local stack: a movement registered from the app
 * carries the DEVICE's wall-clock time as `effective_time` (17:25 in
 * Madrid), while an accepted transfer carries the SERVER's `localtime` —
 * and the server runs in UTC (15:34 for an acceptance made at 17:34). The
 * two are not comparable, and sorting by them puts a transfer accepted a
 * minute ago under an expense from two hours earlier.
 *
 * What the two sources DO share is `operation_created_at`, an absolute
 * instant. For a transfer the effective moment IS the instant of acceptance
 * (F12/ADR-002 §21: server date and time, nothing chosen by anyone), so its
 * calendar date and clock time are derived from that instant in the
 * device's zone — exactly what the app writes for a movement it registers.
 * Then one comparator serves both classes.
 *
 * Wall-clock conversion is injected so the rule can be tested in any zone.
 */
export type WallClock = (instant: Date) => {
  readonly date: string;
  readonly time: string;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const deviceWallClock: WallClock = (instant) => ({
  date: `${String(instant.getFullYear())}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
  time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
});

export type TransferMoment = {
  readonly effectiveDate: string;
  readonly effectiveTime: string;
};

export function transferMoment(
  transfer: {
    readonly operationCreatedAt: string;
    readonly effectiveDate: string;
    readonly effectiveTime: string | null;
  },
  clock: WallClock = deviceWallClock,
): TransferMoment {
  const instant = new Date(transfer.operationCreatedAt);
  if (Number.isNaN(instant.getTime())) {
    // An unreadable instant falls back to what the view published, as is.
    return {
      effectiveDate: transfer.effectiveDate,
      effectiveTime: transfer.effectiveTime === null ? '' : transfer.effectiveTime.slice(0, 5),
    };
  }
  const wall = clock(instant);
  return { effectiveDate: wall.date, effectiveTime: wall.time };
}
