/**
 * WHAT THE TWO READ SURFACES PUBLISH, as this feature sees it. Pure: no
 * React, no Supabase.
 *
 * Two facts kept apart, because F12/ADR-005 keeps them apart:
 *
 * - a **friendship** is an active, symmetric relation between two accounts
 *   (`api.my_friends`). It carries no direction: `counterpart_*` is simply
 *   the other side, resolved on the server from the actor's own identity;
 * - a **request** is a directed intention that has not resolved yet
 *   (`api.my_friend_requests`), with `direction` saying which way it goes.
 *
 * **NEITHER VIEW PUBLISHES A TERMINAL ROW.** `sec.my_friend_rows()` filters
 * `ended_at is null`, and `sec.my_friend_request_rows()` filters the derived
 * state to `pending`. So there is no client-side filter here dropping
 * accepted, declined, cancelled or expired rows — inventing one would be a
 * second, weaker copy of a rule the database already holds, and it would go
 * stale the day the view changes. What arrives is what is live.
 *
 * The counterpart's identity is its CURRENT public identity (F12/ADR-001
 * §13), resolved `uid → current` on every read, and never a uid.
 */

export type Friend = {
  readonly friendshipId: string;
  /** The counterpart's current handle; `null` if it has none right now. */
  readonly counterpartHandle: string | null;
  readonly counterpartPublicName: string | null;
  /** When the friendship instance was created. */
  readonly since: string;
};

export type FriendRequestDirection = 'incoming' | 'outgoing';

export type FriendRequest = {
  readonly requestId: string;
  readonly direction: FriendRequestDirection;
  readonly counterpartHandle: string | null;
  readonly counterpartPublicName: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
};

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function required(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One row of `api.my_friends` → a friendship, or `null` when malformed. */
export function parseFriendRow(row: Record<string, unknown>): Friend | null {
  const friendshipId = text(row.friendship_id);
  if (friendshipId === null) return null;
  return {
    friendshipId,
    counterpartHandle: text(row.counterpart_handle),
    counterpartPublicName: text(row.counterpart_public_name),
    since: required(row.since),
  };
}

/** One row of `api.my_friend_requests` → a request, or `null` when malformed. */
export function parseFriendRequestRow(row: Record<string, unknown>): FriendRequest | null {
  const requestId = text(row.request_id);
  const direction = row.direction;
  if (requestId === null) return null;
  if (direction !== 'incoming' && direction !== 'outgoing') return null;
  return {
    requestId,
    direction,
    counterpartHandle: text(row.counterpart_handle),
    counterpartPublicName: text(row.counterpart_public_name),
    createdAt: required(row.created_at),
    expiresAt: required(row.expires_at),
  };
}

/** What wants an answer from this account. */
export function incomingRequests(requests: readonly FriendRequest[]): readonly FriendRequest[] {
  return requests.filter((one) => one.direction === 'incoming');
}

/** What this account asked for and can still withdraw. */
export function outgoingRequests(requests: readonly FriendRequest[]): readonly FriendRequest[] {
  return requests.filter((one) => one.direction === 'outgoing');
}

/** Newest first; the id breaks a tie deterministically. */
export function newestRequestsFirst(requests: readonly FriendRequest[]): readonly FriendRequest[] {
  return [...requests].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0;
  });
}

/**
 * A friends list is read by looking for a person, so it is sorted the way a
 * person is looked for: by the name that is on screen, then by the handle,
 * with the id as the last tie-break. Locale-insensitive on purpose — the
 * comparison has to be stable across devices, and the catalogue holds no
 * collation of its own.
 */
export function friendSortKey(friend: Friend): string {
  return (friend.counterpartPublicName ?? friend.counterpartHandle ?? '').toLowerCase();
}

export function byDisplayName(friends: readonly Friend[]): readonly Friend[] {
  return [...friends].sort((a, b) => {
    const left = friendSortKey(a);
    const right = friendSortKey(b);
    if (left !== right) return left < right ? -1 : 1;
    return a.friendshipId < b.friendshipId ? -1 : a.friendshipId > b.friendshipId ? 1 : 0;
  });
}
