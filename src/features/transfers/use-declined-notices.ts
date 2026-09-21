import { useCallback, useEffect, useState } from 'react';

import { offlineCatalogueCache } from '@/lib/offline';

import {
  NO_SEEN_DECLINES,
  publishDeclinesSeen,
  readSeenDeclines,
  type SeenDeclines,
  seenDeclinesAfterVisit,
  subscribeDeclinesSeen,
  unseenDeclines,
  writeSeenDeclines,
} from './declined-seen';
import type { TransferProposal } from './proposal';

export type DeclinedNotices = {
  /** The recent declines the actor has not been shown yet: what lights the informative dot. */
  readonly unseen: readonly TransferProposal[];
  /** The seen-mark has been read for this actor; before that, nothing is unseen. */
  readonly ready: boolean;
  /** Mark exactly these as seen. Nothing that appears later is included. */
  readonly markSeen: (proposalIds: readonly string[]) => Promise<boolean>;
};

/**
 * THE INFORMATIVE DOT OF A DECLINE, kept apart from the list it is about.
 *
 * `useMyProposals` says WHAT the server has — the recent declines among
 * them — and this hook says only WHETHER the actor has already been shown
 * each one. The two are combined by the routes: the bell is `incoming
 * pending` (an action, never marked seen) OR `unseen declines` (news, marked
 * seen on entering Notifications), and neither reads the other's state.
 *
 * The mark is the actor's, read from the opaque per-actor document and
 * re-read when any screen writes it (`declinesSeen`), so the dot in every
 * bar goes out together. Before the first read nothing counts as unseen:
 * a dot that flickers on and off at start-up would be a lie twice.
 */
export function useDeclinedNotices(
  actorId: string,
  declined: readonly TransferProposal[],
  enabled: boolean,
): DeclinedNotices {
  const [held, setHeld] = useState<{
    readonly actorId: string;
    readonly seen: SeenDeclines;
  } | null>(null);
  const [tick, setTick] = useState(0);

  const active = actorId !== '' && enabled;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const seen = await readSeenDeclines(await offlineCatalogueCache(), actorId);
        if (live) setHeld({ actorId, seen });
      } catch {
        // No store: nothing is marked, and nothing is claimed unseen either.
      }
    })();
    return () => {
      live = false;
    };
  }, [actorId, active, tick]);

  useEffect(
    () =>
      subscribeDeclinesSeen((seenActor) => {
        if (seenActor === actorId) setTick((n) => n + 1);
      }),
    [actorId],
  );

  const ready = active && held !== null && held.actorId === actorId;
  const seen = ready ? held.seen : NO_SEEN_DECLINES;

  const markSeen = useCallback(
    async (proposalIds: readonly string[]): Promise<boolean> => {
      if (!ready || proposalIds.length === 0) return true;
      try {
        const next = seenDeclinesAfterVisit(seen, declined, proposalIds);
        await writeSeenDeclines(
          await offlineCatalogueCache(),
          actorId,
          next,
          new Date().toISOString(),
        );
        publishDeclinesSeen(actorId);
        return true;
      } catch {
        // Nothing written: the dot stays on, and the next visit tries again.
        return false;
      }
    },
    [actorId, declined, ready, seen],
  );

  return {
    unseen: ready ? unseenDeclines(declined, seen) : [],
    ready,
    markSeen,
  };
}
