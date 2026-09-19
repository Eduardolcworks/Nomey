/**
 * The one signal that makes an unresolved identity ask the server again.
 *
 * Nomey has exactly one `AppState` listener (F07/ADR-001 §12: the session
 * provider's, whose `onForeground` seam the offline queue already reuses as
 * `wakeQueue`). This is the identity's end of that same seam: the composition
 * root calls `wakeIdentity()` from `onForeground`, and the identity provider
 * — if, and only if, its last answer was a transport failure — re-runs its
 * one RPC. No polling, no timer, no second listener: coming back to the
 * foreground is when connectivity is most likely to have returned, and it is
 * the moment the queue itself syncs.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onIdentityWake(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function wakeIdentity(): void {
  for (const listener of listeners) listener();
}
