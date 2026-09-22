/**
 * TWO IN-PROCESS SIGNALS, and no polling — the same shape
 * `features/transfers` uses, and for the same reasons.
 *
 * - `friendsChanged`: something of this actor's friendships moved from THIS
 *   device — a request was created, accepted, declined or cancelled, or a
 *   friendship ended. Every surface that shows friends or requests reloads:
 *   `/friends`, `/friends/add`, Notificaciones, Perfil and the bell.
 * - `wake`: the app came back to the foreground. Fired by the composition
 *   root from the ONE `AppState` seam the queue, the identity and the
 *   transfers already share (F07/ADR-001 §12); this module owns no listener
 *   of its own. Back in the foreground is when the other party is most
 *   likely to have answered — or to have cancelled what was on screen.
 *
 * Neither carries data: a signal means "ask the server again", never "here
 * is the new state". There is no realtime channel in this block, and none is
 * needed: a remote cancellation disappears on the next refresh.
 */
type Listener = () => void;
type SettledListener = (requestId: string) => void;

const changed = new Set<Listener>();
const wake = new Set<Listener>();
const settled = new Set<SettledListener>();

export function subscribeFriendsChanged(listener: Listener): () => void {
  changed.add(listener);
  return () => {
    changed.delete(listener);
  };
}

export function publishFriendsChanged(): void {
  for (const listener of [...changed]) {
    try {
      listener();
    } catch {
      // One listener failing must not silence the others.
    }
  }
}

export function onFriendsWake(listener: Listener): () => void {
  wake.add(listener);
  return () => {
    wake.delete(listener);
  };
}

export function wakeFriends(): void {
  for (const listener of [...wake]) {
    try {
      listener();
    } catch {
      // Same reason as above.
    }
  }
}

/**
 * A request left the pending state FROM THIS DEVICE — accepted, declined,
 * cancelled — or the server said it already had. The lists drop it at once,
 * before the reload that `friendsChanged` asks for lands: what the person
 * just did should not stay on screen waiting for a round trip. The reload is
 * still the authority, and it brings back nothing terminal.
 */
export function subscribeFriendRequestSettled(listener: SettledListener): () => void {
  settled.add(listener);
  return () => {
    settled.delete(listener);
  };
}

export function publishFriendRequestSettled(requestId: string): void {
  for (const listener of [...settled]) {
    try {
      listener(requestId);
    } catch {
      // Same reason as above.
    }
  }
}

export function resetFriendEvents(): void {
  changed.clear();
  wake.clear();
  settled.clear();
}
