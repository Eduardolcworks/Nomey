import { supabase } from '@/lib/supabase';

import {
  parseProposalRow,
  parseTransferRow,
  type TransferMovement,
  type TransferProposal,
} from './proposal';
import type { ResolverAnswer } from './recipient';

/**
 * THE ONLY FILE OF THIS FEATURE THAT TALKS TO SUPABASE.
 *
 * Nothing here goes through the F7 queue, on purpose (F12/ADR-002 §17): a
 * proposal, an acceptance, a cancellation all need the other party's server
 * state and cannot be honestly "saved for later". Each call returns what the
 * server said — a result with its status and boundary code, or the rows —
 * and the hooks decide what that means for the screen.
 */

type RawResponse = {
  data: unknown;
  error: { code?: string | null; details?: string | null } | null;
  status?: number;
};

export type CommandResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly code: string | null };

function resultOf<T>(response: RawResponse, read: (data: unknown) => T | null): CommandResult<T> {
  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { ok: false, status, code: response.error.code ?? null };
  }
  const data = read(response.data);
  // A 2xx whose body is not the envelope is a contract break, not a success:
  // it is reported as a rejection with no code, never painted as done.
  if (data === null) return { ok: false, status, code: null };
  return { ok: true, status, data };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

// ─── resolver ────────────────────────────────────────────────────────────────

/**
 * Exact resolution, one handle per call (F12/ADR-001 §10). The server
 * answers with a STATE — `not_found`, `throttled` and `self` are rows, not
 * errors — so that the throttle attempt persists (an exception would roll it
 * back and probing would be free).
 */
export async function resolveUsername(handle: string): Promise<CommandResult<ResolverAnswer>> {
  const response = (await supabase.rpc('resolve_username', {
    p_handle: handle,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const rows = Array.isArray(data) ? data : data === null ? [] : [data];
    const row = record(rows[0]);
    const state = row?.state;
    if (state === 'not_found' || state === 'throttled' || state === 'self') return { state };
    if (state === 'found') {
      const found = row?.handle;
      const name = row?.public_name;
      if (typeof found === 'string' && typeof name === 'string') {
        return { state: 'found', handle: found, publicName: name };
      }
    }
    return null;
  });
}

// ─── the proposal ────────────────────────────────────────────────────────────

export type CreateProposalPayload = {
  readonly client_command_id: string;
  readonly command_contract_version: 1;
  readonly handle: string;
  readonly amount: string;
  readonly currency_definition_id: string;
  readonly concept?: string;
};

export type CreateProposalOutcome =
  | { readonly state: 'pending'; readonly proposalId: string; readonly expiresAt: string }
  /** Nobody has that username any more: a state, not an error (F12.B1). */
  | { readonly state: 'not_found' };

export async function sendCreateProposal(
  payload: CreateProposalPayload,
): Promise<CommandResult<CreateProposalOutcome>> {
  const response = (await supabase.rpc('create_transfer_proposal', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const body = record(data);
    if (body?.state === 'not_found') return { state: 'not_found' };
    if (
      body?.state === 'pending' &&
      typeof body.proposal_id === 'string' &&
      typeof body.expires_at === 'string'
    ) {
      return { state: 'pending', proposalId: body.proposal_id, expiresAt: body.expires_at };
    }
    return null;
  });
}

export type ProposalTransition = {
  readonly proposalId: string;
  readonly state: string;
  readonly alreadyProcessed: boolean;
};

function transitionOf(data: unknown): ProposalTransition | null {
  const body = record(data);
  if (typeof body?.proposal_id !== 'string' || typeof body.state !== 'string') return null;
  return {
    proposalId: body.proposal_id,
    state: body.state,
    alreadyProcessed: body.already_processed === true,
  };
}

export async function sendCancelProposal(
  proposalId: string,
): Promise<CommandResult<ProposalTransition>> {
  const response = (await supabase.rpc('cancel_transfer_proposal', {
    payload: { proposal_id: proposalId } as never,
  })) as unknown as RawResponse;
  return resultOf(response, transitionOf);
}

export async function sendDeclineProposal(
  proposalId: string,
): Promise<CommandResult<ProposalTransition>> {
  const response = (await supabase.rpc('decline_transfer_proposal', {
    payload: { proposal_id: proposalId } as never,
  })) as unknown as RawResponse;
  return resultOf(response, transitionOf);
}

export type AcceptPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 1;
  readonly proposal_id: string;
};

export type Accepted = {
  readonly operationId: string;
  readonly alreadyProcessed: boolean;
};

/**
 * Acceptance IS the materialisation (F12/ADR-002 §11): `proposal_id` and
 * nothing else. Amount, currency, sender and receiver come from the locked
 * proposal on the server; the client could not send them if it wanted to.
 */
export async function sendAcceptProposal(payload: AcceptPayload): Promise<CommandResult<Accepted>> {
  const response = (await supabase.rpc('record_internal_transfer', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const body = record(data);
    if (typeof body?.operation_id !== 'string') return null;
    return { operationId: body.operation_id, alreadyProcessed: body.already_processed === true };
  });
}

// ─── reading ─────────────────────────────────────────────────────────────────

export async function fetchMyProposals(): Promise<readonly TransferProposal[]> {
  const { data, error } = await supabase
    .from('my_transfer_proposals')
    .select(
      'proposal_id,direction,counterpart_handle,counterpart_public_name,amount,' +
        'currency_definition_id,concept,created_at,expires_at,state,accepted_operation_id',
    )
    .order('created_at', { ascending: false });
  if (error !== null) throw error;
  return (data ?? [])
    .map((row) => parseProposalRow(row as unknown as Record<string, unknown>))
    .filter((one): one is TransferProposal => one !== null);
}

export type TransferRange = {
  readonly from: string | null;
  readonly to: string | null;
};

/**
 * The transfers of the actor's own Personal in the interval Inicio shows.
 * Same order as `personal_operation`, so the route can interleave them.
 */
export async function fetchMyTransfers(range: TransferRange): Promise<readonly TransferMovement[]> {
  let query = supabase
    .from('my_transfers')
    .select(
      'operation_id,scope_id,currency_definition_id,balance_amount,direction,amount,' +
        'effective_date,effective_time,concept,counterpart_handle,counterpart_public_name,' +
        'proposal_id,operation_created_at,payment_request_id,group_scope_id,group_transfer_proposal_id',
    )
    .order('effective_date', { ascending: false })
    .order('effective_time', { ascending: false, nullsFirst: false })
    .order('operation_created_at', { ascending: false })
    .order('operation_id', { ascending: false });
  if (range.from !== null) query = query.gte('effective_date', range.from);
  if (range.to !== null) query = query.lte('effective_date', range.to);

  const { data, error } = await query;
  if (error !== null) throw error;
  return (data ?? [])
    .map((row) => parseTransferRow(row as unknown as Record<string, unknown>))
    .filter((one): one is TransferMovement => one !== null);
}
