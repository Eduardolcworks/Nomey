import { useCallback, useEffect, useState } from 'react';

import {
  incomingRequests,
  newestRequestsFirst,
  outgoingRequests,
  type FriendRequest,
} from './friend';
import {
  onFriendsWake,
  subscribeFriendRequestSettled,
  subscribeFriendsChanged,
} from './friend-events';
import { fetchMyFriendRequests } from './friend-service';

export type MyFriendRequests = {
  /** Directed at this account and waiting for an answer. */
  readonly incoming: readonly FriendRequest[];
  /** Sent by this account and not answered yet. */
  readonly outgoing: readonly FriendRequest[];
  readonly loading: boolean;
  /** The last load failed; whatever was loaded before stays on screen. */
  readonly failed: boolean;
  readonly refresh: () => void;
};

/**
 * WHAT THE SERVER SAYS, KEPT IN MEMORY FOR THE SESSION.
 *
 * Three triggers reload, and none of them is a timer: the actor changes, a
 * transition was made from this device (`friendsChanged`), or the app came
 * back to the foreground (`wake`). Screens add a fourth by calling `refresh`
 * when they regain focus. **Nothing is persisted**: a friend request is a
 * live negotiation with another account, and the last answer the server gave
 * is the only honest thing to show while a new one is being asked for.
 *
 * NO CLIENT-SIDE TERMINAL FILTER. `api.my_friend_requests` publishes only
 * rows whose derived state is `pending`, in both directions, so there is
 * nothing here dropping accepted, declined, cancelled or expired ones —
 * writing that filter would be a second copy of a rule the view holds, and a
 * copy that goes stale silently. What a reload brings back IS what is live,
 * and that is also what makes a remote cancellation disappear (§19 of this
 * block): the row simply stops being published.
 *
 * A request settled from this device leaves the list at once
 * (`friendRequestSettled`), before the authoritative reload lands, and stays
 * out because the reload does not bring it back.
 */
export function useMyFriendRequests(actorId: string, enabled: boolean): MyFriendRequests {
  /*
   * Keyed by actor: rows loaded for one account are never shown for another,
   * and switching accounts needs no effect that clears state — the key does
   * it at read time.
   */
  const [held, setHeld] = useState<{
    readonly actorId: string;
    readonly rows: readonly FriendRequest[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  /* Settled from this device and not yet confirmed by a reload. */
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());

  const active = actorId !== '' && enabled;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const loaded = await fetchMyFriendRequests();
        if (live) {
          setHeld({ actorId, rows: newestRequestsFirst(loaded) });
          setFailed(false);
          // The reload is the authority: whatever it lists is pending there.
          setSettled(new Set());
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [actorId, active, tick]);

  useEffect(
    () =>
      subscribeFriendsChanged(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(
    () =>
      onFriendsWake(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(
    () =>
      subscribeFriendRequestSettled((requestId) => {
        setSettled((current) => new Set([...current, requestId]));
      }),
    [],
  );

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const rows = (active && held !== null && held.actorId === actorId ? held.rows : []).filter(
    (one) => !settled.has(one.requestId),
  );

  return {
    incoming: incomingRequests(rows),
    outgoing: outgoingRequests(rows),
    loading: active && loading,
    failed: active && failed,
    refresh,
  };
}
