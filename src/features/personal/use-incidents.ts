import { useCallback, useEffect, useRef, useState } from 'react';

import { type Incident, incidentsOf, replacementFor } from './incidents';
import { publishQueueChange, subscribeQueueChanges } from './queue-events';
import { queueStore, wakeEntryQueue } from './queue-runtime';
import { newClientOperationId } from '@/lib/id';

/**
 * THE INCIDENTS OF ONE ACCOUNT, AND THE TWO THINGS THAT CAN BE DONE TO THEM.
 *
 * Reads the queue, keeps nothing of its own, and never crosses accounts: every
 * read and every write carries `actorId` (ADR-028 §13). Signing out or changing
 * account empties the list on the spot without touching the other account's
 * rows, because the list IS the query and the query is bounded.
 *
 * ═══ WHAT `SÍ` ACTUALLY DOES ═══
 *
 * For the person it means repeating that movement. Inside it is not a resend:
 * ADR-028 §15 requires a **new intention**, and the three steps in **one
 * transaction** so there is never an instant with both entries nor with none.
 * `QueueStore.replace` is that transaction — it inserts the replacement and
 * deletes the rejected row inside `withTransactionAsync` — so this hook does
 * not compose one of its own.
 *
 * The new entry carries **the same frozen payload**: amount, concept, kind,
 * effective date and time, category and monetary definition. Only the command's
 * identity changes, plus the state a freshly created entry has anyway — queued,
 * zero attempts, no marks. That is why the key inside the payload is rewritten
 * too: the payload is what the boundary reads, and it must agree with the row.
 *
 * **A new key is safe here and only here.** The ordinary form covers `rejected`,
 * where the server proved it wrote nothing. Over an operation that might exist
 * a new key would be duplicated money, which is why `review` never reaches this
 * path (ADR-029 §2).
 *
 * **And there is no automatic loop.** If the new intention is rejected in turn,
 * a new incident appears and waits: every further attempt is born from a press.
 */

export type IncidentActions = {
  readonly incidents: readonly Incident[];
  /** Whether the bell should say something is waiting. */
  readonly unresolved: number;
  /**
   * `Sí`: replace this incident with an identical movement, one transaction.
   * Resolves to the new key, or `null` if there was nothing left to replace.
   */
  readonly retry: (clientOperationId: string) => Promise<string | null>;
  /** `No` and `Descartar`: resolve locally. Never calls the server. */
  readonly dismiss: (clientOperationId: string) => Promise<void>;
  /** Whether an action on this incident is already running. Kills the second tap. */
  readonly busy: (clientOperationId: string) => boolean;
};

const NONE: readonly Incident[] = [];

export function useIncidents(actorId: string): IncidentActions {
  const [incidents, setIncidents] = useState<readonly Incident[]>(NONE);
  /** Actions in flight, so a double tap cannot run the transaction twice. */
  const running = useRef(new Set<string>());

  const reload = useCallback(
    (alive: () => boolean) => {
      if (actorId === '') return;
      void (async () => {
        try {
          const entries = await (await queueStore()).all(actorId);
          if (!alive()) return;
          setIncidents(incidentsOf(entries));
        } catch {
          // With no database there is nothing to show. The queue's own local
          // failure path already reports the infrastructure (ADR-028 §11).
        }
      })();
    },
    [actorId],
  );

  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;
    reload(isAlive);

    /*
     * Every queue change reloads, and reloading is what keeps this at one
     * incident per movement: the list is derived from the rows, so a repeated
     * event, a refresh or a retry recomputes the same single row rather than
     * appending anything.
     */
    const unsubscribe = subscribeQueueChanges((change) => {
      if (change.actorId !== actorId) return;
      reload(isAlive);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [actorId, reload]);

  const retry = useCallback(
    async (clientOperationId: string): Promise<string | null> => {
      if (actorId === '' || running.current.has(clientOperationId)) return null;
      running.current.add(clientOperationId);
      try {
        const store = await queueStore();
        /*
         * Read first. A second tap that got past the in-memory guard — another
         * screen, a reopened app — finds nothing here and creates nothing,
         * which is what makes this idempotent rather than merely guarded.
         */
        const entry = await store.byId(actorId, clientOperationId);
        if (entry === null) return null;

        const key = newClientOperationId();
        await store.replace(
          actorId,
          clientOperationId,
          replacementFor(entry, key, new Date().toISOString()),
        );

        // One announcement, one wake. The projection picks the movement up
        // again through the queue it just re-read.
        publishQueueChange({
          kind: 'enqueued',
          actorId,
          clientOperationId: key,
          state: 'queued',
        });
        wakeEntryQueue();
        return key;
      } catch {
        // The transaction is all or nothing, so nothing was lost and nothing
        // was duplicated. The incident is still there to press again.
        return null;
      } finally {
        running.current.delete(clientOperationId);
      }
    },
    [actorId],
  );

  const dismiss = useCallback(
    async (clientOperationId: string): Promise<void> => {
      if (actorId === '' || running.current.has(clientOperationId)) return;
      running.current.add(clientOperationId);
      try {
        await (await queueStore()).remove(actorId, clientOperationId);
        publishQueueChange({
          kind: 'pruned',
          actorId,
          clientOperationId,
          state: 'rejected',
        });
      } catch {
        // Still there, still resolvable. Nothing was sent either way.
      } finally {
        running.current.delete(clientOperationId);
      }
    },
    [actorId],
  );

  const busy = useCallback(
    (clientOperationId: string) => running.current.has(clientOperationId),
    [],
  );

  /*
   * DERIVED, NOT WRITTEN. With no account there is nothing to show, and what
   * was in memory belonged to somebody else: signing out or switching empties
   * the list on the spot without deleting a single row of the other account.
   */
  const visible = actorId === '' ? NONE : incidents;

  return { incidents: visible, unresolved: visible.length, retry, dismiss, busy };
}
