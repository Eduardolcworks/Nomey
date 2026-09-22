import { useCallback, useRef, useState } from 'react';

import { publishFriendRequestSettled, publishFriendsChanged } from './friend-events';
import { failureFrom, type FriendFailure, settledAfterRefusal } from './friend-errors';
import {
  sendAcceptFriendRequest,
  sendCancelFriendRequest,
  sendDeclineFriendRequest,
  sendRemoveFriend,
} from './friend-service';

export type FriendActionOutcome =
  { readonly kind: 'done' } | { readonly kind: 'failed'; readonly failure: FriendFailure };

export type FriendActions = {
  readonly accept: (requestId: string) => Promise<FriendActionOutcome>;
  readonly decline: (requestId: string) => Promise<FriendActionOutcome>;
  readonly cancel: (requestId: string) => Promise<FriendActionOutcome>;
  readonly remove: (friendshipId: string) => Promise<FriendActionOutcome>;
  /** The row an action is running on, or `null`. One at a time. */
  readonly busy: string | null;
  readonly lastFailure: FriendFailure | null;
};

/**
 * ACCEPT, DECLINE, CANCEL, REMOVE — four transitions, one at a time, and all
 * four SERVER-AUTHORITATIVE.
 *
 * None of them carries an idempotency key, and none needs one: the four
 * commands are idempotent BY STATE on the server (F12/ADR-005 §3, §7, §8) —
 * repeating the same transition answers `already_processed`, and the expiry
 * comes back as a STATE rather than as an exception, because the
 * terminalisation the command wrote has to persist. So a lost answer is
 * simply retried by the person, and nothing can be written twice.
 *
 * **Two devices accepting the same request is not an error to show as one.**
 * The second one gets `already_processed: true` with `state: 'accepted'` and
 * the same `friendship_id`: `ok`, `done`, no alert. A refusal that carries a
 * terminal state (`FRIEND_REQUEST_ACCEPTED` on cancel, and so on) is
 * reported as a failure so the caller can say what happened, and the row is
 * dropped from the pending lists either way — the server state is what
 * should be on screen, whichever side got there first.
 *
 * Offline (`status === 0`) is the one case where NOTHING is published: no
 * settle, no reload. The request was not answered, and pretending otherwise
 * would hide a row that is still pending on the server.
 */
export function useFriendActions(): FriendActions {
  const [busy, setBusy] = useState<string | null>(null);
  const [lastFailure, setLastFailure] = useState<FriendFailure | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (
      id: string,
      send: () => Promise<{ ok: boolean; status: number; code?: string | null }>,
      /** Requests leave the pending lists at once; a friendship has no such list. */
      settles: boolean,
    ): Promise<FriendActionOutcome> => {
      if (inFlight.current) return { kind: 'failed', failure: 'rejected' };
      inFlight.current = true;
      setBusy(id);
      setLastFailure(null);
      try {
        const result = await send();
        if (result.ok) {
          if (settles) publishFriendRequestSettled(id);
          publishFriendsChanged();
          return { kind: 'done' };
        }
        const reason = failureFrom(result.status, result.code ?? null);
        setLastFailure(reason);
        /*
         * The state moved on the server (the other side got there first), or
         * nothing moved: either way the screen should show what the server
         * has now, and a request that is terminal there is not pending here.
         */
        if (settles && settledAfterRefusal(reason)) publishFriendRequestSettled(id);
        if (reason !== 'offline') publishFriendsChanged();
        return { kind: 'failed', failure: reason };
      } finally {
        setBusy(null);
        inFlight.current = false;
      }
    },
    [],
  );

  const accept = useCallback<FriendActions['accept']>(
    (requestId) => run(requestId, () => sendAcceptFriendRequest(requestId), true),
    [run],
  );

  const decline = useCallback<FriendActions['decline']>(
    (requestId) => run(requestId, () => sendDeclineFriendRequest(requestId), true),
    [run],
  );

  const cancel = useCallback<FriendActions['cancel']>(
    (requestId) => run(requestId, () => sendCancelFriendRequest(requestId), true),
    [run],
  );

  const remove = useCallback<FriendActions['remove']>(
    (friendshipId) => run(friendshipId, () => sendRemoveFriend(friendshipId), false),
    [run],
  );

  return { accept, decline, cancel, remove, busy, lastFailure };
}
