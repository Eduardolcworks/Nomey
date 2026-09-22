import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import type { CreateAnswer } from './friend-candidate';
import { publishFriendsChanged } from './friend-events';
import { failureFrom, type FriendFailure } from './friend-errors';
import { sendCreateFriendRequest } from './friend-service';

export type CreateFriendRequestOutcome =
  | { readonly kind: 'answered'; readonly answer: CreateAnswer }
  | { readonly kind: 'failed'; readonly failure: FriendFailure };

export type CreateFriendRequest = {
  readonly create: (handle: string) => Promise<CreateFriendRequestOutcome>;
  readonly creating: boolean;
  readonly failure: FriendFailure | null;
};

/**
 * ONE KEY PER INTENTION, kept until the server answers (F03/ADR-007).
 *
 * Retrying the same handle after a transport failure reuses the same
 * `client_command_id`, so a request that DID reach the server and lost its
 * answer replays — the server returns what it persisted with that key,
 * `already_processed: true` — instead of sending a second one. A different
 * handle gets a fresh key. The key is dropped once the server has spoken,
 * success or refusal.
 *
 * **Nothing is interpreted here.** The answer is handed back literally so
 * the screen can apply it: `pending`, `incoming_pending` (the crossed race —
 * the other side had already asked and no second row was inserted),
 * `friends`, `cooldown`, `not_found`, or a terminal state from a replay. A
 * reload is asked for whenever the server DID answer, because any of those
 * states can change what the lists show.
 */
export function useCreateFriendRequest(): CreateFriendRequest {
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<FriendFailure | null>(null);
  const inFlight = useRef(false);
  const keys = useRef(new Map<string, string>());

  const create = useCallback<CreateFriendRequest['create']>(async (handle) => {
    if (inFlight.current) return { kind: 'failed', failure: 'rejected' };
    inFlight.current = true;

    let key = keys.current.get(handle);
    if (key === undefined) {
      key = newClientOperationId();
      keys.current.set(handle, key);
    }

    setCreating(true);
    setFailure(null);
    try {
      const result = await sendCreateFriendRequest({
        client_command_id: key,
        command_contract_version: 1,
        handle,
      });
      if (result.ok) {
        keys.current.delete(handle);
        publishFriendsChanged();
        return { kind: 'answered', answer: result.data };
      }
      const reason = failureFrom(result.status, result.code);
      // Only a transport failure keeps the key: the server may have it.
      if (reason !== 'offline') keys.current.delete(handle);
      setFailure(reason);
      return { kind: 'failed', failure: reason };
    } finally {
      setCreating(false);
      inFlight.current = false;
    }
  }, []);

  return { create, creating, failure };
}
