import { validateHandle } from '@/domain';

/**
 * SOMEONE LOOKED UP BY EXACT @username, and what the server said about them.
 *
 * `api.lookup_friend_candidate` answers in ONE call with the public identity
 * AND the relation the actor already has with that account (F12/ADR-005 §5).
 * That is why this feature never calls `api.resolve_username`: two calls
 * would spend two of the twenty lookups the resolver allows in ten minutes,
 * and the second one would only re-derive what the first already knows.
 *
 * What is decided WITHOUT the server is only whether the text is a handle
 * worth asking about — the same rule sign-up applies, from `domain/username`
 * — so an impossible handle never costs a lookup.
 *
 * The relation words are exactly the server's: `none`, `outgoing_pending`,
 * `incoming_pending`, `friends`, `cooldown`. `self`, `not_found` and
 * `throttled` are separate kinds because the server sends them with no
 * identity attached.
 */

export type CandidateRelation =
  'none' | 'outgoing_pending' | 'incoming_pending' | 'friends' | 'cooldown';

export const CANDIDATE_RELATIONS: readonly CandidateRelation[] = [
  'none',
  'outgoing_pending',
  'incoming_pending',
  'friends',
  'cooldown',
];

export type CandidateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'invalid'; readonly problem: 'invalid' | 'reserved' }
  | { readonly kind: 'searching'; readonly handle: string }
  | {
      readonly kind: 'found';
      readonly relation: CandidateRelation;
      readonly handle: string;
      readonly publicName: string | null;
      /**
       * The pending request between the two, published only for
       * `outgoing_pending` and `incoming_pending`. It is what lets the result
       * carry [Cancelar] or [Aceptar] / [Rechazar] without a second read.
       */
      readonly requestId: string | null;
    }
  | { readonly kind: 'not_found'; readonly handle: string }
  | { readonly kind: 'self'; readonly handle: string }
  | { readonly kind: 'throttled'; readonly handle: string }
  | { readonly kind: 'offline'; readonly handle: string }
  | { readonly kind: 'failed'; readonly handle: string };

export const CANDIDATE_IDLE: CandidateState = { kind: 'idle' };

/** The normalised handle to ask about, or the reason there is nothing to ask. */
export function handleToLookup(
  raw: string,
): { readonly handle: string } | { readonly problem: 'invalid' | 'reserved' } | null {
  if (raw.trim() === '' || raw.trim() === '@') return null;
  const validation = validateHandle(raw);
  if (validation.ok) return { handle: validation.handle };
  return { problem: validation.problem };
}

/** The shapes `api.lookup_friend_candidate` returns, and nothing else. */
export type CandidateAnswer =
  | { readonly state: 'not_found' }
  | { readonly state: 'self' }
  | { readonly state: 'throttled' }
  | {
      readonly state: CandidateRelation;
      readonly handle: string;
      readonly publicName: string | null;
      readonly requestId: string | null;
    };

export function candidateFromAnswer(handle: string, answer: CandidateAnswer): CandidateState {
  switch (answer.state) {
    case 'not_found':
      return { kind: 'not_found', handle };
    case 'self':
      return { kind: 'self', handle };
    case 'throttled':
      return { kind: 'throttled', handle };
    default:
      return {
        kind: 'found',
        relation: answer.state,
        handle: answer.handle,
        publicName: answer.publicName,
        requestId: answer.requestId,
      };
  }
}

/** Typing again invalidates whatever the server said about the old text. */
export function candidateStale(state: CandidateState, raw: string): boolean {
  if (state.kind === 'idle' || state.kind === 'invalid') return false;
  const next = handleToLookup(raw);
  return next === null || !('handle' in next) || next.handle !== state.handle;
}

/**
 * WHAT «ENVIAR» ACTUALLY PRODUCED, according to the server.
 *
 * `api.create_friend_request` answers with a STATE and not only with
 * «created», because several things can be true by the time the pair is
 * locked (F12/ADR-005 §4). The result is applied literally:
 *
 * - `pending` → the request exists and can be cancelled;
 * - `incoming_pending` → **crossed**: the other side had already asked, and
 *   NO second row was inserted. The screen must stop claiming an outgoing
 *   request was sent and offer Aceptar / Rechazar instead;
 * - `friends` → they were already friends;
 * - `cooldown` → refused for now, and the reason is deliberately not told;
 * - `not_found` → the handle stopped resolving between the search and the
 *   send.
 *
 * A replay of the same key can also answer with a terminal state
 * (`accepted`, `declined`, `cancelled`, `expired`). Those mean the request
 * this device created is over: the field goes back to `none` so the person
 * can decide again with what the lists show, and nothing is invented.
 */
export type CreateAnswer =
  | { readonly state: 'pending'; readonly requestId: string }
  | { readonly state: 'incoming_pending'; readonly requestId: string | null }
  | { readonly state: 'friends' }
  | { readonly state: 'cooldown' }
  | { readonly state: 'not_found' }
  | { readonly state: 'accepted' }
  | { readonly state: 'declined' }
  | { readonly state: 'cancelled' }
  | { readonly state: 'expired' };

export function candidateAfterCreate(state: CandidateState, answer: CreateAnswer): CandidateState {
  if (state.kind !== 'found') return state;
  switch (answer.state) {
    case 'pending':
      return { ...state, relation: 'outgoing_pending', requestId: answer.requestId };
    case 'incoming_pending':
      return { ...state, relation: 'incoming_pending', requestId: answer.requestId };
    case 'friends':
      return { ...state, relation: 'friends', requestId: null };
    case 'cooldown':
      return { ...state, relation: 'cooldown', requestId: null };
    case 'accepted':
      return { ...state, relation: 'friends', requestId: null };
    case 'not_found':
      return { kind: 'not_found', handle: state.handle };
    default:
      return { ...state, relation: 'none', requestId: null };
  }
}

/**
 * The request between the two is over — answered, cancelled or gone — so the
 * result goes back to a state with no request behind it. Accepting makes
 * them friends; declining and cancelling do not, and declining one's own
 * incoming request does NOT open a cooldown against oneself (the cooldown of
 * §7 is the DECLINER's, towards the requester).
 */
export function candidateAfterSettle(
  state: CandidateState,
  settled: 'accepted' | 'declined' | 'cancelled' | 'gone',
): CandidateState {
  if (state.kind !== 'found') return state;
  if (settled === 'accepted') return { ...state, relation: 'friends', requestId: null };
  return { ...state, relation: 'none', requestId: null };
}
