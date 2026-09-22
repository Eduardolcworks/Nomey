/**
 * `features/friends` — friendships between accounts (F12.E).
 *
 * The client of [F12/ADR-005](../../../docs/adr/F12/ADR-005-friendship-model.md):
 * a SYMMETRIC relation born from two wills, which grants no financial
 * access, touches no group and moves no money. This block (E.B) is the base
 * UI: Perfil → Amigos, the list with its two request sections, adding by
 * exact `@username`, and the incoming requests in Notificaciones with their
 * share of the bell.
 *
 * **What is deliberately NOT here**: the friendship link, its QR and its
 * arrival (E.C), anything about groups or participants (E.D), and the
 * recipient picker of Transfers (E.E). `api.my_friend_link`,
 * `api.rotate_friend_link`, `api.preview_friend_link` and
 * `api.respond_friend_link` exist in the backend since E.A and are not
 * called from anywhere yet.
 *
 * Nothing in here goes through the F7 queue, and nothing in here is
 * persisted.
 */
export { CandidateField } from './candidate-field';
export { CandidateResult } from './candidate-result';
export {
  byDisplayName,
  type Friend,
  type FriendRequest,
  type FriendRequestDirection,
  friendSortKey,
  incomingRequests,
  newestRequestsFirst,
  outgoingRequests,
  parseFriendRequestRow,
  parseFriendRow,
} from './friend';
export {
  CANDIDATE_IDLE,
  CANDIDATE_RELATIONS,
  type CandidateAnswer,
  candidateAfterCreate,
  candidateAfterSettle,
  candidateFromAnswer,
  type CandidateRelation,
  type CandidateState,
  candidateStale,
  type CreateAnswer,
  handleToLookup,
} from './friend-candidate';
export {
  failureFrom,
  FRIEND_FAILURE_KEY,
  type FriendFailure,
  settledAfterRefusal,
} from './friend-errors';
export {
  onFriendsWake,
  publishFriendRequestSettled,
  publishFriendsChanged,
  resetFriendEvents,
  subscribeFriendRequestSettled,
  subscribeFriendsChanged,
  wakeFriends,
} from './friend-events';
export { FriendRequestRow } from './friend-request-row';
export { FriendRow, REMOVE_FRIEND_ACTION } from './friend-row';
export {
  type CreateFriendRequest,
  type CreateFriendRequestOutcome,
  useCreateFriendRequest,
} from './use-create-friend-request';
export {
  type FriendActionOutcome,
  type FriendActions,
  useFriendActions,
} from './use-friend-actions';
export { type CandidateLookup, useLookupCandidate } from './use-lookup-candidate';
export { type MyFriendRequests, useMyFriendRequests } from './use-my-friend-requests';
export { type MyFriends, useMyFriends } from './use-my-friends';
