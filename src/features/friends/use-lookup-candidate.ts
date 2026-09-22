import { useCallback, useRef, useState } from 'react';

import {
  CANDIDATE_IDLE,
  candidateAfterCreate,
  candidateAfterSettle,
  candidateFromAnswer,
  candidateStale,
  type CandidateState,
  type CreateAnswer,
  handleToLookup,
} from './friend-candidate';
import { lookupCandidate } from './friend-service';

export type CandidateLookup = {
  readonly text: string;
  readonly setText: (next: string) => void;
  readonly state: CandidateState;
  /** Whether the current text can be sent to the server right now. */
  readonly canSearch: boolean;
  readonly search: () => void;
  readonly reset: () => void;
  /** Apply what `create_friend_request` actually produced (crossed races included). */
  readonly applyCreate: (answer: CreateAnswer) => void;
  /** The pending request between the two was answered or withdrawn. */
  readonly applySettled: (settled: 'accepted' | 'declined' | 'cancelled' | 'gone') => void;
};

/**
 * ONE LOOKUP PER EXPLICIT SEARCH, never per keystroke, and never two calls.
 *
 * `api.lookup_friend_candidate` shares the resolver's budget — 20 lookups
 * per 10 minutes per actor (F12/ADR-001 §12) — and books exactly ONE attempt
 * per call. Asking on every character would burn that budget on the way to
 * typing `@eduardo`, and would also be the global autocomplete the backend
 * deliberately does not offer. The person types the whole handle and asks;
 * the text is validated locally first, so an impossible handle costs
 * nothing.
 *
 * And it is ONE call: the answer already carries the public identity AND the
 * relation, so this hook never calls `api.resolve_username` alongside it.
 */
export function useLookupCandidate(): CandidateLookup {
  const [text, setTextRaw] = useState('');
  const [state, setState] = useState<CandidateState>(CANDIDATE_IDLE);
  const request = useRef(0);

  const setText = useCallback((next: string) => {
    setTextRaw(next);
    setState((current) => {
      if (!candidateStale(current, next)) return current;
      request.current += 1;
      return CANDIDATE_IDLE;
    });
  }, []);

  const target = handleToLookup(text);
  const canSearch =
    target !== null &&
    'handle' in target &&
    state.kind !== 'searching' &&
    !(state.kind === 'found' && state.handle === target.handle);

  const search = useCallback(() => {
    const next = handleToLookup(text);
    if (next === null) return;
    if (!('handle' in next)) {
      setState({ kind: 'invalid', problem: next.problem });
      return;
    }
    const handle = next.handle;
    const id = ++request.current;
    setState({ kind: 'searching', handle });
    void lookupCandidate(handle).then((result) => {
      if (id !== request.current) return;
      if (result.ok) {
        setState(candidateFromAnswer(handle, result.data));
        return;
      }
      setState({ kind: result.status === 0 ? 'offline' : 'failed', handle });
    });
  }, [text]);

  const reset = useCallback(() => {
    request.current += 1;
    setTextRaw('');
    setState(CANDIDATE_IDLE);
  }, []);

  const applyCreate = useCallback((answer: CreateAnswer) => {
    setState((current) => candidateAfterCreate(current, answer));
  }, []);

  const applySettled = useCallback((settled: 'accepted' | 'declined' | 'cancelled' | 'gone') => {
    setState((current) => candidateAfterSettle(current, settled));
  }, []);

  return { text, setText, state, canSearch, search, reset, applyCreate, applySettled };
}
