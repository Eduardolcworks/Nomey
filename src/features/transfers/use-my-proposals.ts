import { useCallback, useEffect, useState } from 'react';

import {
  incomingPending,
  newestFirst,
  outgoingPending,
  stillRelevant,
  type TransferProposal,
} from './proposal';
import {
  onTransfersWake,
  subscribeProposalSettled,
  subscribeTransfersChanged,
} from './transfer-events';
import { fetchMyProposals } from './transfer-service';

export type MyProposals = {
  /** Incoming AND pending: the only incoming rows the view publishes, and the ones that want an answer. */
  readonly incoming: readonly TransferProposal[];
  /** Outgoing AND pending: what the actor proposed and can still cancel. */
  readonly sent: readonly TransferProposal[];
  readonly loading: boolean;
  /** The last load failed; whatever was loaded before stays on screen. */
  readonly failed: boolean;
  readonly refresh: () => void;
};

/**
 * WHAT THE SERVER SAYS, KEPT IN MEMORY FOR THE SESSION.
 *
 * Three triggers reload, and none of them is a timer: the actor changes, a
 * transition was made from this device (`transfersChanged`), or the app came
 * back to the foreground (`wake`). Screens add a fourth by calling `refresh`
 * when they regain focus. Nothing is persisted: a proposal is a live
 * negotiation with another account, and the last answer the server gave is
 * the only honest thing to show while a new one is being asked for.
 *
 * The receiver's list is EXACTLY what `api.my_transfer_proposals` returns
 * for `incoming`: pending ones. A declined or accepted incoming proposal is
 * not published back, and this hook does not remember it locally — the
 * accepted one becomes a transfer in `my_transfers`, and the declined one is
 * simply gone.
 *
 * THE SCREEN IS NOT A HISTORY. The view does publish the creator's terminal
 * proposals (accepted, declined, cancelled, expired), and this hook drops
 * them: only what is still pending is relevant, in either direction. A
 * proposal settled from this device leaves the list at once
 * (`proposalSettled`), before the authoritative reload; it stays out because
 * the reload brings it back terminal, and terminal rows are filtered — so
 * creating a new proposal afterwards cannot make a cancelled one reappear.
 */
export function useMyProposals(actorId: string, enabled: boolean): MyProposals {
  /*
   * Keyed by actor: rows loaded for one account are never shown for another,
   * and switching accounts needs no effect that clears state — the key does
   * it at read time.
   */
  const [held, setHeld] = useState<{
    readonly actorId: string;
    readonly rows: readonly TransferProposal[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  /* Settled from this device and not yet confirmed by a reload. */
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());

  const active = actorId !== '' && enabled;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const loaded = await fetchMyProposals();
        if (live) {
          setHeld({ actorId, rows: newestFirst(stillRelevant(loaded)) });
          setFailed(false);
          // The reload is the authority: whatever it lists is pending there.
          setSettled(new Set());
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [actorId, active, tick]);

  useEffect(
    () =>
      subscribeTransfersChanged(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(
    () =>
      onTransfersWake(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(
    () =>
      subscribeProposalSettled((proposalId) => {
        setSettled((current) => new Set([...current, proposalId]));
      }),
    [],
  );

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const rows = (active && held !== null && held.actorId === actorId ? held.rows : []).filter(
    (one) => !settled.has(one.proposalId),
  );

  return {
    incoming: incomingPending(rows),
    sent: outgoingPending(rows),
    loading: active && loading,
    failed: active && failed,
    refresh,
  };
}
