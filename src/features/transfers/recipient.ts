import { validateHandle } from '@/domain';

/**
 * THE RECIPIENT OF A PROPOSAL, before and after the server has been asked.
 *
 * Nothing is resolved locally: the only authority on who `@ana` is today is
 * `api.resolve_username`, and it is asked EXACTLY once per handle, on demand
 * (F12/ADR-001 §10, F12/ADR-002 §4). What this module decides without the
 * server is whether the text is even a handle worth asking about — the same
 * rule the sign-up field applies, from `domain/username`, so the two never
 * disagree — and how the answer is kept.
 *
 * `found` carries the identity the server published at that moment; the
 * proposal is still bound on the server, once more, at creation (§4).
 */
export type RecipientState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'invalid'; readonly problem: 'invalid' | 'reserved' }
  | { readonly kind: 'searching'; readonly handle: string }
  | {
      readonly kind: 'found';
      readonly handle: string;
      readonly publicName: string;
    }
  | { readonly kind: 'not_found'; readonly handle: string }
  | { readonly kind: 'throttled'; readonly handle: string }
  | { readonly kind: 'self'; readonly handle: string }
  | { readonly kind: 'offline'; readonly handle: string }
  | { readonly kind: 'failed'; readonly handle: string };

export const RECIPIENT_IDLE: RecipientState = { kind: 'idle' };

/** The normalised handle to ask about, or the reason there is nothing to ask. */
export function handleToResolve(
  raw: string,
): { readonly handle: string } | { readonly problem: 'invalid' | 'reserved' } | null {
  if (raw.trim() === '' || raw.trim() === '@') return null;
  const validation = validateHandle(raw);
  if (validation.ok) return { handle: validation.handle };
  return { problem: validation.problem };
}

export type ResolverAnswer =
  | { readonly state: 'found'; readonly handle: string; readonly publicName: string }
  | { readonly state: 'not_found' }
  | { readonly state: 'throttled' }
  | { readonly state: 'self' };

export function recipientFromAnswer(handle: string, answer: ResolverAnswer): RecipientState {
  switch (answer.state) {
    case 'found':
      return { kind: 'found', handle: answer.handle, publicName: answer.publicName };
    case 'not_found':
      return { kind: 'not_found', handle };
    case 'throttled':
      return { kind: 'throttled', handle };
    case 'self':
      return { kind: 'self', handle };
  }
}

/** Typing again invalidates whatever the server said about the old text. */
export function recipientStale(state: RecipientState, raw: string): boolean {
  if (state.kind === 'idle' || state.kind === 'invalid') return false;
  const next = handleToResolve(raw);
  return next === null || !('handle' in next) || next.handle !== state.handle;
}
