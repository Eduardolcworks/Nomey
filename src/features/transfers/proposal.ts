/**
 * THE PROPOSAL AND THE MATERIALISED TRANSFER, as the two `api` views publish
 * them (F12/ADR-002, F12.B1). Pure: no React, no Supabase.
 *
 * Two facts kept apart on purpose, because the ADR keeps them apart:
 *
 * - a **proposal** is an intention with a state and no accounting effect
 *   (`api.my_transfer_proposals`). It is never a movement and sums in nothing;
 * - a **transfer** is the operation that acceptance created
 *   (`api.my_transfers`), with a signed `balance_amount` in the actor's own
 *   Personal. That is what moves the Disponible.
 *
 * Direction and counterpart come from the views — derived on the server from
 * the persisted parts — and never from `created_by`, which the views do not
 * even publish (F12/ADR-002 §12).
 */

export type ProposalState = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export type ProposalDirection = 'outgoing' | 'incoming';

export type TransferProposal = {
  readonly proposalId: string;
  readonly direction: ProposalDirection;
  /** The counterpart's CURRENT public identity (F12/ADR-001 §13); `null` if it has none right now. */
  readonly counterpartHandle: string | null;
  readonly counterpartPublicName: string | null;
  /** Integer minor units, as text (F02/ADR-001). */
  readonly amountMinor: string;
  readonly currencyDefinitionId: string;
  readonly concept: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: ProposalState;
  readonly acceptedOperationId: string | null;
};

export type TransferDirection = 'outgoing' | 'incoming';

export type TransferMovement = {
  readonly operationId: string;
  readonly scopeId: string;
  readonly currencyDefinitionId: string;
  /** Signed: negative when it left this Personal, positive when it entered. */
  readonly balanceAmount: string;
  readonly direction: TransferDirection;
  /** Unsigned, the amount both parties agreed on. */
  readonly amountMinor: string;
  readonly effectiveDate: string;
  readonly effectiveTime: string | null;
  readonly concept: string | null;
  readonly counterpartHandle: string | null;
  readonly counterpartPublicName: string | null;
  readonly proposalId: string | null;
  readonly paymentRequestId: string | null;
  /** Set when the transfer settled a group debt (F12/ADR-003); `null` for a Personal one. */
  readonly groupScopeId: string | null;
  readonly groupTransferProposalId: string | null;
  readonly operationCreatedAt: string;
};

const STATES: readonly ProposalState[] = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
];

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function required(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * One row of `api.my_transfer_proposals` → a proposal, or `null` when the row
 * does not carry the shape (a view that changed underneath the client). A
 * malformed row is dropped rather than painted with invented fields.
 */
export function parseProposalRow(row: Record<string, unknown>): TransferProposal | null {
  const proposalId = text(row.proposal_id);
  const direction = row.direction;
  const state = row.state;
  const amount = text(row.amount);
  if (proposalId === null || amount === null) return null;
  if (direction !== 'outgoing' && direction !== 'incoming') return null;
  if (!STATES.includes(state as ProposalState)) return null;
  return {
    proposalId,
    direction,
    counterpartHandle: text(row.counterpart_handle),
    counterpartPublicName: text(row.counterpart_public_name),
    amountMinor: amount,
    currencyDefinitionId: required(row.currency_definition_id),
    concept: text(row.concept),
    createdAt: required(row.created_at),
    expiresAt: required(row.expires_at),
    state: state as ProposalState,
    acceptedOperationId: text(row.accepted_operation_id),
  };
}

/** One row of `api.my_transfers` → a movement, or `null` when malformed. */
export function parseTransferRow(row: Record<string, unknown>): TransferMovement | null {
  const operationId = text(row.operation_id);
  const balance = text(row.balance_amount);
  const amount = text(row.amount);
  const direction = row.direction;
  if (operationId === null || balance === null || amount === null) return null;
  if (direction !== 'outgoing' && direction !== 'incoming') return null;
  return {
    operationId,
    scopeId: required(row.scope_id),
    currencyDefinitionId: required(row.currency_definition_id),
    balanceAmount: balance,
    direction,
    amountMinor: amount,
    effectiveDate: required(row.effective_date),
    effectiveTime: text(row.effective_time),
    concept: text(row.concept),
    counterpartHandle: text(row.counterpart_handle),
    counterpartPublicName: text(row.counterpart_public_name),
    proposalId: text(row.proposal_id),
    paymentRequestId: text(row.payment_request_id),
    groupScopeId: text(row.group_scope_id),
    groupTransferProposalId: text(row.group_transfer_proposal_id),
    operationCreatedAt: required(row.operation_created_at),
  };
}

/** What the receiver can act on: only a pending proposal addressed to them. */
export function isActionable(proposal: TransferProposal): boolean {
  return proposal.direction === 'incoming' && proposal.state === 'pending';
}

/** What the creator can still withdraw. */
export function isCancellable(proposal: TransferProposal): boolean {
  return proposal.direction === 'outgoing' && proposal.state === 'pending';
}

export function incomingPending(
  proposals: readonly TransferProposal[],
): readonly TransferProposal[] {
  return proposals.filter(isActionable);
}

/**
 * What the creator still has in play. The view publishes every state of an
 * outgoing proposal, but the screen is not a history: an accepted one is a
 * movement now, and a declined, cancelled or expired one is over.
 */
export function outgoingPending(
  proposals: readonly TransferProposal[],
): readonly TransferProposal[] {
  return proposals.filter(isCancellable);
}

/** Everything still relevant: pending, in either direction. */
export function stillRelevant(proposals: readonly TransferProposal[]): readonly TransferProposal[] {
  return proposals.filter((one) => one.state === 'pending');
}

/**
 * Newest first. `created_at` is server time, so two proposals never tie in
 * practice; the id breaks a tie deterministically anyway.
 */
export function newestFirst(proposals: readonly TransferProposal[]): readonly TransferProposal[] {
  return [...proposals].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.proposalId < b.proposalId ? -1 : a.proposalId > b.proposalId ? 1 : 0;
  });
}
