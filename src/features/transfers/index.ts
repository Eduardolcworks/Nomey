/**
 * `features/transfers` — transfers between accounts (F12.C).
 *
 * The client of F12/ADR-002: a proposal from one Personal to another that
 * only the receiver's acceptance turns into an `internal_transfer`. It
 * touches the Personal feature at exactly three seams, all composed by the
 * routes: the «Transferencia» segment of the add sheet, the activity list
 * of Inicio, and the pending centre of Notifications with its bell. Nothing
 * in here goes through the F7 queue (ADR-002 §17), and nothing in here is
 * persisted.
 */
export {
  type ActivityEntry,
  type ActivityKey,
  compareActivity,
  deviceWallClock,
  interleaveActivity,
  type TransferMoment,
  transferMoment,
  type WallClock,
} from './activity';
export {
  DECLINED_SEEN_KEY,
  NO_SEEN_DECLINES,
  parseSeenDeclines,
  publishDeclinesSeen,
  readSeenDeclines,
  resetDeclinesSeenListeners,
  type SeenDeclines,
  seenDeclinesAfterVisit,
  serializeSeenDeclines,
  subscribeDeclinesSeen,
  unseenDeclines,
  writeSeenDeclines,
} from './declined-seen';
export {
  incomingPending,
  isActionable,
  isCancellable,
  isRecentDecline,
  newestFirst,
  outgoingDeclined,
  outgoingPending,
  parseProposalRow,
  parseTransferRow,
  type ProposalDirection,
  type ProposalState,
  stillRelevant,
  type TransferDirection,
  type TransferMovement,
  type TransferProposal,
} from './proposal';
export { ProposalCard } from './proposal-card';
export {
  handleToResolve,
  RECIPIENT_IDLE,
  recipientFromAnswer,
  recipientFromChoice,
  type RecipientState,
  recipientStale,
  type ResolverAnswer,
} from './recipient';
export { RecipientField } from './recipient-field';
export {
  FAILURE_KEY,
  failureFrom,
  stateAfterRefusal,
  type TransferFailure,
} from './transfer-errors';
export {
  onTransfersWake,
  publishProposalSettled,
  publishTransfersChanged,
  resetTransferEvents,
  subscribeProposalSettled,
  subscribeTransfersChanged,
  wakeTransfers,
} from './transfer-events';
export { TransferForm, type TransferScope } from './transfer-form';
export { TransferRow } from './transfer-row';
export {
  type CreateProposal,
  type CreateProposalOutcome,
  useCreateProposal,
} from './use-create-proposal';
export { type DeclinedNotices, useDeclinedNotices } from './use-declined-notices';
export { type MyProposals, useMyProposals } from './use-my-proposals';
export { type MyTransfers, useMyTransfers } from './use-my-transfers';
export {
  type ProposalActionOutcome,
  type ProposalActions,
  useProposalActions,
} from './use-proposal-actions';
export { type RecipientLookup, useResolveRecipient } from './use-resolve-recipient';
