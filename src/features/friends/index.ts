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
 * Since then it also carries the friendship link with its QR, its arrival
 * and its answer (E.C), the recipient picker of Transfers (E.E) and, from
 * E.D, the social state of a group's participants: asking someone for their
 * friendship from inside a group, without ever learning their `@username`.
 *
 * **The group is composed in `app/`, not imported here.** `features/groups`
 * and `features/friends` never reach for each other —the dependency rule
 * forbids feature → feature— so the group screen reads this map and hands
 * `GroupBalanceRow` menu entries it already knew how to take.
 *
 * Nothing in here goes through the F7 queue, and nothing in here is
 * persisted.
 */
export { CandidateField } from './candidate-field';
export { FriendPicker } from './friend-picker';
export { FRIEND_PATH, friendLink, readFriendLink } from './friend-link';
export {
  arriveFriendLink,
  peekFriendLink,
  resetFriendLinkArrival,
  subscribeFriendLink,
  takeFriendLink,
} from './friend-link-arrival';
export { FRIEND_ACTION_SIZE, FriendLinkActions } from './friend-link-actions';
export { FriendLinkRequestWindow } from './friend-link-request-window';
export {
  FRIEND_LINK_RELATIONS,
  type FriendLinkPreview,
  type FriendLinkRelation,
  type FriendLinkResponse,
  isAnswerable,
  type MyFriendLink,
  PREVIEW_NOTICE,
} from './friend-link-state';
export { FriendLinkWindow } from './friend-link-window';
export { useOpenPendingFriendLink } from './use-open-friend-link';
export {
  type FriendLinkResponder,
  type FriendLinkView,
  useFriendLinkResponse,
} from './use-friend-link-response';
export {
  friendLinkHere,
  type MyFriendLinkControl,
  type MyFriendLinkState,
  useMyFriendLink,
} from './use-my-friend-link';
export {
  FRIEND_ROW_HEIGHT,
  friendListHeight,
  MAX_VISIBLE_FRIENDS,
  visibleFriendRows,
} from './friend-picker-layout';
export {
  filterFriendChoices,
  type FriendChoice,
  friendChoices,
  matchesFriendQuery,
  normalizeFriendQuery,
} from './friend-search';
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
export {
  GROUP_FRIEND_STATES,
  type GroupFriendState,
  type GroupFriendStatus,
  hasFriendAction,
  parseGroupFriendRow,
} from './group-friend';
export {
  FRIEND_MENU_ACTION,
  type FriendMenuActionId,
  type FriendMenuEntry,
  friendMenuEntries,
} from './group-friend-actions';
export {
  type AddParticipantFriend,
  type AddParticipantFriendOutcome,
  type ParticipantFriendAnswer,
  useAddParticipantFriend,
} from './use-add-participant-friend';
export { type GroupFriendMap, useGroupFriendStatus } from './use-group-friend-status';
