import type { MessageKey } from '@/lib/i18n';

/**
 * BACKEND CODE → WHAT THE PERSON SEES. Never the code itself.
 *
 * Every refusal the six commands of F12.E.A (`20260930120000`) can raise is
 * listed here, plus the transport class. A code this map does not know is
 * `rejected`: a generic line, and the code goes to the log by id and never to
 * the screen. The map is exhaustive by type, so a new failure cannot ship
 * without a message.
 *
 * `FRIEND_LINK_ROTATION_LIMITED` is deliberately absent: the link is F12.E.C
 * and this block sends no command that can raise it.
 */
export type FriendFailure =
  | 'offline'
  | 'usernameRequired'
  | 'notAuthorized'
  | 'lookupThrottled'
  | 'rateLimited'
  | 'pendingLimit'
  | 'alreadyAccepted'
  | 'alreadyDeclined'
  | 'alreadyCancelled'
  | 'rejected';

const BY_CODE: Readonly<Record<string, FriendFailure>> = {
  USERNAME_REQUIRED: 'usernameRequired',
  NOT_AUTHORIZED: 'notAuthorized',
  RECIPIENT_LOOKUP_THROTTLED: 'lookupThrottled',
  FRIEND_REQUEST_RATE_LIMITED: 'rateLimited',
  FRIEND_REQUEST_LIMIT: 'pendingLimit',
  FRIEND_REQUEST_ACCEPTED: 'alreadyAccepted',
  FRIEND_REQUEST_DECLINED: 'alreadyDeclined',
  FRIEND_REQUEST_CANCELLED: 'alreadyCancelled',
};

/**
 * `status === 0` is the transport: nothing reached the server, or nothing
 * came back. The same rule the transfers feature applies — a request that
 * never completed is not a refusal, so the person is told to retry and NOT
 * that something was wrong with what they asked. Nothing is shown as done.
 */
export function failureFrom(status: number, code: string | null): FriendFailure {
  if (status === 0) return 'offline';
  if (code !== null && code in BY_CODE) return BY_CODE[code];
  return 'rejected';
}

export const FRIEND_FAILURE_KEY: Readonly<Record<FriendFailure, MessageKey>> = {
  offline: 'friends.errorOffline',
  usernameRequired: 'friends.errorUsernameRequired',
  notAuthorized: 'friends.errorNotAuthorized',
  lookupThrottled: 'friends.errorLookupThrottled',
  rateLimited: 'friends.errorRateLimited',
  pendingLimit: 'friends.errorPendingLimit',
  alreadyAccepted: 'friends.errorAlreadyAccepted',
  alreadyDeclined: 'friends.errorAlreadyDeclined',
  alreadyCancelled: 'friends.errorAlreadyCancelled',
  rejected: 'friends.errorRejected',
};

/**
 * A terminal-state refusal is not an error to the person: the other side
 * moved first. The row leaves the pending list and the line says what
 * happened; these are the failures that carry a resolved state.
 */
export function settledAfterRefusal(failure: FriendFailure): boolean {
  return (
    failure === 'alreadyAccepted' ||
    failure === 'alreadyDeclined' ||
    failure === 'alreadyCancelled' ||
    /*
     * The row is not the actor's, or it does not exist. Either way it is not
     * something this account has pending: the server said 403 with no
     * distinction between the two, on purpose.
     */
    failure === 'notAuthorized'
  );
}
