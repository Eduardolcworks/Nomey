/**
 * WHEN A SERVER RESPONSE MAY BECOME THE BASE OF A PROJECTION.
 *
 * ADR-028 §9 states the retirement proof:
 *
 *     retired  ⇔  confirm_seq <= snapshot.seq
 *
 * and argues it one way round: a refresh that STARTED after a confirmation is
 * looking at a server that already held the row. That direction is sound, and
 * it is what lets an entry be retired without hesitating.
 *
 * What it does not establish is the converse, and the converse is what the
 * projection actually leans on when it keeps painting an entry. Two distinct
 * holes sit there, and only the first is about confirmation at all.
 *
 * ═══ HOLE 1 · a confirmation lands while the response is in flight ═══
 *
 * ```
 *   t_a  refresh starts, captures seq = N
 *   t_1  the server writes                    ← the query may see it
 *   t_2  the worker's response arrives: confirm_seq = N+1
 *   t_b  the refresh's response arrives, ALREADY carrying the effect
 *        confirm_seq (N+1) > snapshot.seq (N)  →  still projected
 *        ───────────────────────────────────────────────────────────
 *        Disponible = server (already charged) + local charge = DOUBLE
 * ```
 *
 * ═══ HOLE 2 · the server writes BEFORE the client learns anything ═══
 *
 * The deeper one, and `confirm_seq` cannot see it even in principle:
 *
 * ```
 *   t_0  the worker sends the command
 *   t_a  refresh starts, captures seq = N
 *   t_1  the server writes                    ← the query may see it
 *   t_b  the refresh's response arrives, ALREADY carrying the effect
 *   t_2  the worker's response arrives LATER: only now confirm_seq = N+1
 *        ───────────────────────────────────────────────────────────
 *        Between t_b and t_2 the counter never moved. The window looks
 *        perfectly quiet, the base is accepted, the entry stays projected,
 *        and the movement is counted TWICE.
 * ```
 *
 * A counter of confirmations cannot close this: the confirmation is exactly the
 * event that has not happened yet. What has happened is the SEND, so that is
 * what has to be measured.
 *
 * ═══ THE BARRIER ═══
 *
 * `QueueStore.barrier` reads three numbers at one instant:
 *
 *   confirmSeq   the reconciliation counter, unchanged in meaning
 *   dispatchSeq  a per-actor counter that grows whenever a send is declared
 *   uncertain    how many entries are still PROJECTED and may already exist on
 *                the server: dispatched, not yet confirmed, not terminal
 *
 * A response becomes a base only when all four conditions hold:
 *
 *   1  confirmSeq did not move while it was in flight
 *   2  dispatchSeq did not move while it was in flight
 *   3  uncertain was 0 when it started
 *   4  uncertain was 0 when it arrived
 *
 * And the mark that feeds `uncertain` is written to SQLite BEFORE the transport,
 * in the same statement as `state = 'sending'`, so it survives the app dying
 * mid-request, a lost response, a `markProgress` that fails after a 200, and a
 * reopen. It is never cleared while the entry lives: an entry whose request may
 * have reached the server stays uncertain until idempotency settles it — a
 * confirmation, or a terminal rejection which, because the key is the same, is
 * itself proof that nothing was ever written (an earlier write would have come
 * back as `already_processed`).
 *
 * ═══ WHY THAT COVERS EVERY ORDER ═══
 *
 * Take any entry E still projected when the response arrives, and any moment at
 * which the server could have written it.
 *
 *   E was dispatched before the window     → uncertain ≥ 1 at the start (3)
 *   E is dispatched during the window      → dispatchSeq moved (2)
 *   E is dispatched and settles inside it  → dispatchSeq moved (2)
 *   E is confirmed during the window       → confirmSeq moved (1)
 *   E is dispatched and still unsettled    → uncertain ≥ 1 at the end (4)
 *   E was never dispatched at all          → the server CANNOT hold it, so the
 *                                            base does not contain it and
 *                                            projecting it is right
 *
 * The last line is the whole point: `dispatch_seq is null` is the only positive
 * proof of absence a client can have, and it is the one the projection needs.
 * For every base that passes, the bicondicional the projection assumes is true:
 *
 *     the snapshot contains the entry  ⇔  confirm_seq <= snapshot.seq
 *
 * ═══ WHY THE MARK IS NOT RE-READ AS A DATE ═══
 *
 * The second barrier read does not re-stamp the snapshot. Assigning the closing
 * counter to it would describe the snapshot retrospectively with a value the
 * query could not have seen — "this snapshot includes everything confirmed so
 * far", which is precisely what is unknown. The second read answers one yes/no
 * question — did anything happen meanwhile — and the base always keeps the mark
 * taken at the START.
 *
 * ═══ WHY THIS DOES NOT STALL ═══
 *
 * Both counters only move because the worker moved them, and the worker settles
 * every entry it dispatches: confirmed, retried with the same key, or terminal.
 * A drain is finite, so a quiet window arrives. Meanwhile the previous base —
 * itself taken in a quiet window, and therefore older than everything now in
 * doubt — stays valid and keeps being projected on. Refusing a new base costs a
 * round trip; accepting a dubious one costs a wrong balance.
 *
 * ═══ AN UNREADABLE BARRIER ═══
 *
 * If SQLite does not answer, nothing can be proven, so nothing is trusted —
 * with one exception that needs no proof: when the projection is holding no
 * local entries at all, there is nothing that could be counted twice, and a
 * valid remote read is accepted with `seq = null` (which retires nothing). That
 * is a fact about what is on screen, not about the database, so a broken
 * database cannot make it wrong.
 *
 * A failure here is local infrastructure and stays local: it never turns an
 * entry into `rejected`, `review` or `conflict`.
 */

import type { QueueBarrier } from '@/lib/offline';

/** Reads the barrier, or `null` when the local database will not answer. */
export type BarrierReader = () => Promise<QueueBarrier | null>;

export type SnapshotWindow<T> =
  /** Usable as a base. `seq` is the mark taken at the START, never at the end. */
  | { readonly kind: 'base'; readonly value: T; readonly seq: number | null }
  /**
   * Not usable as a base: something that could have written on the server
   * overlapped this read, or is still unsettled. The value is handed back
   * anyway so the caller can still use what is NOT accounting — the category
   * catalogue, say — which no send can alter.
   */
  | { readonly kind: 'superseded'; readonly value: T };

export type QuietWindowPorts = {
  readonly barrier: BarrierReader;
  /**
   * Whether the projection is currently painting any local entry.
   *
   * Only consulted when the barrier cannot be read, and it is deliberately NOT
   * asked of the database: it is what the screen is showing right now, which
   * stays knowable while SQLite is broken.
   */
  readonly projecting: () => boolean;
};

export async function inQuietWindow<T>(
  ports: QuietWindowPorts,
  run: () => Promise<T>,
): Promise<SnapshotWindow<T>> {
  const before = await ports.barrier();
  const value = await run();
  const after = await ports.barrier();

  if (before === null || after === null) {
    // Nothing to count twice, so nothing to prove. Otherwise: no.
    return ports.projecting() ? { kind: 'superseded', value } : { kind: 'base', value, seq: null };
  }

  const quiet =
    before.confirmSeq === after.confirmSeq &&
    before.dispatchSeq === after.dispatchSeq &&
    before.uncertain === 0 &&
    after.uncertain === 0;

  return quiet ? { kind: 'base', value, seq: before.confirmSeq } : { kind: 'superseded', value };
}
