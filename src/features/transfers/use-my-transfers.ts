import { useCallback, useEffect, useState } from 'react';

import type { TransferMovement } from './proposal';
import { onTransfersWake, subscribeTransfersChanged } from './transfer-events';
import { fetchMyTransfers, type TransferRange } from './transfer-service';

export type MyTransfers = {
  readonly transfers: readonly TransferMovement[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly refresh: () => void;
};

/**
 * THE MATERIALISED TRANSFERS OF THE INTERVAL INICIO SHOWS.
 *
 * Read from `api.my_transfers` — the only surface that lists the class — and
 * kept in memory for the session, like the proposals. Not persisted: the
 * Disponible that these rows explain comes from `personal_balance` through
 * the Personal feature's own path, and a list of confirmed financial rows
 * has no offline store of its own in this repository (the catalogue cache
 * is presentation, explicitly never economic). Without network the list
 * shows what it last loaded, or nothing, and reloads when the network is
 * back and the app is foregrounded.
 */
export function useMyTransfers(
  actorId: string,
  enabled: boolean,
  range: TransferRange,
): MyTransfers {
  /* Keyed by actor, like the proposals: never another account's rows. */
  const [held, setHeld] = useState<{
    readonly actorId: string;
    readonly rows: readonly TransferMovement[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const from = range.from;
  const to = range.to;
  const active = actorId !== '' && enabled;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const loaded = await fetchMyTransfers({ from, to });
        if (live) {
          setHeld({ actorId, rows: loaded });
          setFailed(false);
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
  }, [actorId, active, from, to, tick]);

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

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const transfers = active && held !== null && held.actorId === actorId ? held.rows : [];

  return { transfers, loading: active && loading, failed: active && failed, refresh };
}
