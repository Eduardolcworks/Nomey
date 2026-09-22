import { useCallback, useEffect, useState } from 'react';

import { byDisplayName, type Friend } from './friend';
import { onFriendsWake, subscribeFriendsChanged } from './friend-events';
import { fetchMyFriends } from './friend-service';

export type MyFriends = {
  readonly friends: readonly Friend[];
  readonly loading: boolean;
  /** The last load failed; whatever was loaded before stays on screen. */
  readonly failed: boolean;
  readonly refresh: () => void;
};

/**
 * THE ACTIVE FRIENDSHIPS, read from `api.my_friends`.
 *
 * Same three triggers as the requests — the actor, `friendsChanged`, the
 * foreground `wake` — and the same rule about the list: the view publishes
 * only friendships with `ended_at is null`, so there is no client-side
 * filter for ended ones. Removing a friend is NOT hidden optimistically
 * here: `useFriendActions` publishes `friendsChanged` only after the server
 * confirms, and the row disappears because the reload no longer lists it.
 */
export function useMyFriends(actorId: string, enabled: boolean): MyFriends {
  const [held, setHeld] = useState<{
    readonly actorId: string;
    readonly rows: readonly Friend[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const active = actorId !== '' && enabled;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const loaded = await fetchMyFriends();
        if (live) {
          setHeld({ actorId, rows: byDisplayName(loaded) });
          setFailed(false);
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

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  return {
    friends: active && held !== null && held.actorId === actorId ? held.rows : [],
    loading: active && loading,
    failed: active && failed,
    refresh,
  };
}
