import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import { publishTransfersChanged } from './transfer-events';
import { failureFrom, type TransferFailure } from './transfer-errors';
import { type CreateProposalPayload, sendCreateProposal } from './transfer-service';

export type CreateProposalOutcome =
  | { readonly kind: 'pending'; readonly proposalId: string; readonly expiresAt: string }
  /** The handle stopped resolving between the search and the send: back to the field. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed'; readonly failure: TransferFailure };

export type CreateProposal = {
  readonly create: (args: {
    readonly handle: string;
    readonly amountMinor: bigint;
    readonly currencyDefinitionId: string;
    readonly concept: string;
  }) => Promise<CreateProposalOutcome>;
  readonly creating: boolean;
  readonly failure: TransferFailure | null;
};

/**
 * ONE KEY PER INTENTION, kept until the server answers (F03/ADR-007).
 *
 * Retrying the same handle, amount, currency and concept after a transport
 * failure reuses the same `client_command_id`, so a request that DID reach
 * the server and lost its answer replays instead of proposing twice
 * (`already_processed`). A different intention gets a fresh key. The key is
 * dropped once the server has spoken, success or refusal: a refused
 * intention that is edited and resent is a new command.
 */
export function useCreateProposal(): CreateProposal {
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<TransferFailure | null>(null);
  const inFlight = useRef(false);
  const keys = useRef(new Map<string, string>());

  const create = useCallback<CreateProposal['create']>(async (args) => {
    if (inFlight.current) return { kind: 'failed', failure: 'rejected' };
    inFlight.current = true;

    const concept = args.concept.trim();
    const intent = JSON.stringify([
      args.handle,
      args.amountMinor.toString(),
      args.currencyDefinitionId,
      concept,
    ]);
    let key = keys.current.get(intent);
    if (key === undefined) {
      key = newClientOperationId();
      keys.current.set(intent, key);
    }

    setCreating(true);
    setFailure(null);
    try {
      const payload: CreateProposalPayload = {
        client_command_id: key,
        command_contract_version: 1,
        handle: args.handle,
        amount: args.amountMinor.toString(),
        currency_definition_id: args.currencyDefinitionId,
        ...(concept === '' ? {} : { concept }),
      };
      const result = await sendCreateProposal(payload);
      if (result.ok) {
        keys.current.delete(intent);
        if (result.data.state === 'not_found') return { kind: 'not_found' };
        publishTransfersChanged();
        return {
          kind: 'pending',
          proposalId: result.data.proposalId,
          expiresAt: result.data.expiresAt,
        };
      }
      const reason = failureFrom(result.status, result.code);
      // Only a transport failure keeps the key: the server may have it.
      if (reason !== 'offline') keys.current.delete(intent);
      setFailure(reason);
      return { kind: 'failed', failure: reason };
    } finally {
      setCreating(false);
      inFlight.current = false;
    }
  }, []);

  return { create, creating, failure };
}
