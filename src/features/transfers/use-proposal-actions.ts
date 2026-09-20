import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import { publishProposalSettled, publishTransfersChanged } from './transfer-events';
import { failureFrom, stateAfterRefusal, type TransferFailure } from './transfer-errors';
import { sendAcceptProposal, sendCancelProposal, sendDeclineProposal } from './transfer-service';

export type ProposalActionOutcome =
  { readonly kind: 'done' } | { readonly kind: 'failed'; readonly failure: TransferFailure };

export type ProposalActions = {
  readonly accept: (proposalId: string) => Promise<ProposalActionOutcome>;
  readonly decline: (proposalId: string) => Promise<ProposalActionOutcome>;
  readonly cancel: (proposalId: string) => Promise<ProposalActionOutcome>;
  /** The proposal an action is running on, or `null`. One at a time. */
  readonly busy: string | null;
  readonly lastFailure: TransferFailure | null;
};

/**
 * ACCEPT, DECLINE, CANCEL — three transitions, one at a time.
 *
 * Acceptance is the only one that writes money, and it carries a
 * `client_operation_id` kept per proposal until the server answers: a lost
 * answer replays (`already_processed`) instead of trying to create a second
 * transfer, which `sec.persist_version` would refuse anyway (F12/ADR-002
 * §16). Decline and cancel are idempotent by state on the server and carry
 * no key.
 *
 * A terminal-state refusal (`PROPOSAL_ACCEPTED` on cancel, and so on) is
 * reported as a failure so the caller can say what happened, and the lists
 * are asked to reload either way: the server state is what should be on
 * screen, whichever side got there first.
 */
export function useProposalActions(): ProposalActions {
  const [busy, setBusy] = useState<string | null>(null);
  const [lastFailure, setLastFailure] = useState<TransferFailure | null>(null);
  const inFlight = useRef(false);
  const acceptKeys = useRef(new Map<string, string>());

  const run = useCallback(
    async (
      proposalId: string,
      send: () => Promise<{ ok: boolean; status: number; code?: string | null }>,
      onSettled?: (reason: TransferFailure | null) => void,
    ): Promise<ProposalActionOutcome> => {
      if (inFlight.current) return { kind: 'failed', failure: 'rejected' };
      inFlight.current = true;
      setBusy(proposalId);
      setLastFailure(null);
      try {
        const result = await send();
        if (result.ok) {
          onSettled?.(null);
          // Gone from the pending lists right now; the reload confirms it.
          publishProposalSettled(proposalId);
          publishTransfersChanged();
          return { kind: 'done' };
        }
        const reason = failureFrom(result.status, result.code ?? null);
        onSettled?.(reason);
        setLastFailure(reason);
        // The state moved on the server (the other side got there first), or
        // nothing moved: either way the screen should show what the server
        // has now, and a proposal that is terminal there is not pending here.
        if (stateAfterRefusal(reason) !== null) publishProposalSettled(proposalId);
        if (reason !== 'offline') publishTransfersChanged();
        return { kind: 'failed', failure: reason };
      } finally {
        setBusy(null);
        inFlight.current = false;
      }
    },
    [],
  );

  const accept = useCallback<ProposalActions['accept']>(
    (proposalId) => {
      let key = acceptKeys.current.get(proposalId);
      if (key === undefined) {
        key = newClientOperationId();
        acceptKeys.current.set(proposalId, key);
      }
      const chosen = key;
      return run(
        proposalId,
        () =>
          sendAcceptProposal({
            client_operation_id: chosen,
            command_contract_version: 1,
            proposal_id: proposalId,
          }),
        (reason) => {
          if (reason !== 'offline') acceptKeys.current.delete(proposalId);
        },
      );
    },
    [run],
  );

  const decline = useCallback<ProposalActions['decline']>(
    (proposalId) => run(proposalId, () => sendDeclineProposal(proposalId)),
    [run],
  );

  const cancel = useCallback<ProposalActions['cancel']>(
    (proposalId) => run(proposalId, () => sendCancelProposal(proposalId)),
    [run],
  );

  return { accept, decline, cancel, busy, lastFailure };
}
