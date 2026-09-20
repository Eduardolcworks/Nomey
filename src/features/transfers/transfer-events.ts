/**
 * TWO IN-PROCESS SIGNALS, and no polling.
 *
 * - `transfersChanged`: something of this actor's moved — a proposal was
 *   created, accepted, declined or cancelled from THIS device. Every list
 *   that shows proposals or transfers reloads. Same pattern as
 *   `publishGroupRecorded` in the groups feature.
 * - `wake`: the app came back to the foreground. Fired by the composition
 *   root from the ONE `AppState` seam the queue and the identity already
 *   share (F07/ADR-001 §12); this module owns no listener of its own. Back in
 *   the foreground is when the other party is most likely to have answered.
 *
 * Neither carries data: a signal means "ask the server again", never "here is
 * the new state".
 */
type Listener = () => void;
type SettledListener = (proposalId: string) => void;

const changed = new Set<Listener>();
const wake = new Set<Listener>();
const settled = new Set<SettledListener>();

export function subscribeTransfersChanged(listener: Listener): () => void {
  changed.add(listener);
  return () => {
    changed.delete(listener);
  };
}

export function publishTransfersChanged(): void {
  for (const listener of [...changed]) {
    try {
      listener();
    } catch {
      // One listener failing must not silence the others.
    }
  }
}

export function onTransfersWake(listener: Listener): () => void {
  wake.add(listener);
  return () => {
    wake.delete(listener);
  };
}

export function wakeTransfers(): void {
  for (const listener of [...wake]) {
    try {
      listener();
    } catch {
      // Same reason as above.
    }
  }
}

/**
 * A proposal left the pending state FROM THIS DEVICE — accepted, declined,
 * cancelled — or the server said it already had. The lists drop it at once,
 * before the reload that `transfersChanged` asks for lands: what the person
 * just did should not stay on screen waiting for a round trip.
 */
export function subscribeProposalSettled(listener: SettledListener): () => void {
  settled.add(listener);
  return () => {
    settled.delete(listener);
  };
}

export function publishProposalSettled(proposalId: string): void {
  for (const listener of [...settled]) {
    try {
      listener(proposalId);
    } catch {
      // Same reason as above.
    }
  }
}

export function resetTransferEvents(): void {
  changed.clear();
  wake.clear();
  settled.clear();
}
