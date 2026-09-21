import type { MessageKey } from '@/lib/i18n';

/**
 * BACKEND CODE → WHAT THE PERSON SEES. Never the code itself.
 *
 * Every refusal of F12.B1 (`20260926120000`) is listed, plus the two
 * idempotency answers any command can give and the transport class. A code
 * this map does not know is `rejected`: a generic line and the code goes to
 * the log by id, never to the screen. The map is exhaustive by type so a
 * new failure cannot ship without a message.
 */
export type TransferFailure =
  | 'offline'
  | 'usernameRequired'
  | 'lookupThrottled'
  | 'rateLimited'
  | 'pairLimit'
  | 'alreadyAccepted'
  | 'alreadyDeclined'
  | 'alreadyCancelled'
  | 'expired'
  | 'recipientNotReady'
  | 'notAuthorized'
  | 'currency'
  | 'keyReused'
  | 'inFlight'
  | 'rejected';

const BY_CODE: Readonly<Record<string, TransferFailure>> = {
  USERNAME_REQUIRED: 'usernameRequired',
  RECIPIENT_LOOKUP_THROTTLED: 'lookupThrottled',
  PROPOSAL_RATE_LIMITED: 'rateLimited',
  PROPOSAL_LIMIT_PER_TARGET: 'pairLimit',
  PROPOSAL_ACCEPTED: 'alreadyAccepted',
  PROPOSAL_DECLINED: 'alreadyDeclined',
  PROPOSAL_CANCELLED: 'alreadyCancelled',
  PROPOSAL_EXPIRED: 'expired',
  RECIPIENT_WITHOUT_PERSONAL_SCOPE: 'recipientNotReady',
  NOT_AUTHORIZED: 'notAuthorized',
  CURRENCY_CONVERSION_UNSUPPORTED: 'currency',
  IDEMPOTENCY_KEY_REUSED: 'keyReused',
  COMMAND_IN_FLIGHT: 'inFlight',
};

/**
 * `status === 0` is the transport: nothing reached the server, or nothing
 * came back. The same rule `useRecordPayment` applies — a request that never
 * completed is not a refusal, and the person is told to retry, not that
 * something was wrong with what they asked.
 */
export function failureFrom(status: number, code: string | null): TransferFailure {
  if (status === 0) return 'offline';
  if (code !== null && code in BY_CODE) return BY_CODE[code];
  return 'rejected';
}

export const FAILURE_KEY: Readonly<Record<TransferFailure, MessageKey>> = {
  offline: 'transfer.errorOffline',
  usernameRequired: 'transfer.errorUsernameRequired',
  lookupThrottled: 'transfer.errorLookupThrottled',
  rateLimited: 'transfer.errorRateLimited',
  pairLimit: 'transfer.errorPairLimit',
  alreadyAccepted: 'transfer.errorAlreadyAccepted',
  alreadyDeclined: 'transfer.errorAlreadyDeclined',
  alreadyCancelled: 'transfer.errorAlreadyCancelled',
  expired: 'transfer.errorExpired',
  recipientNotReady: 'transfer.errorRecipientNotReady',
  notAuthorized: 'transfer.errorNotAuthorized',
  currency: 'transfer.errorCurrency',
  keyReused: 'transfer.errorRejected',
  inFlight: 'transfer.errorInFlight',
  rejected: 'transfer.errorRejected',
};

/**
 * A terminal-state refusal on a proposal is not an error to the person: the
 * other side moved first. The list repaints to the state the server has, and
 * the line says what happened. These are the ones that carry a state.
 */
export function stateAfterRefusal(
  failure: TransferFailure,
): 'accepted' | 'declined' | 'cancelled' | 'expired' | null {
  switch (failure) {
    case 'alreadyAccepted':
      return 'accepted';
    case 'alreadyDeclined':
      return 'declined';
    case 'alreadyCancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}
