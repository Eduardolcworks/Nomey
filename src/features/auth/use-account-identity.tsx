import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { offlineCatalogueCache } from '@/lib/offline';

import { recallIdentity, rememberIdentity } from './identity-cache';
import { claimUsername } from './identity-service';
import {
  type AccountIdentity,
  IDENTITY_IDLE,
  IDENTITY_REQUIRED,
  IDENTITY_UNAVAILABLE,
  type IdentityState,
  isIdentityPending,
} from './identity-state';
import { onIdentityWake } from './identity-wake';

/**
 * The public identity of the signed-in account, resolved ONCE per session and
 * shared by the gate, the tabs guard and Profile (F12/ADR-001 §7, F12.A3).
 *
 * **The lifecycle is one RPC.** `claim_username` is idempotent by state on the
 * server: a live reservation (the sign-up hook's, or the guest's before
 * converting) becomes definitive, a definitive handle answers itself with no
 * write, and no reservation — a pre-F12 account, or an expired one — answers
 * `USERNAME_REQUIRED`, which is the gate. So the app never reads the view
 * first and claims second: one round trip decides all three cases.
 *
 * **Who is asked:** a normal account only. A guest (`is_anonymous`) never
 * claims and is never gated — its state stays `idle` — and the effect re-runs
 * when the session flips to a normal account (conversion keeps the uid), which
 * is exactly when the guest's reservation should become definitive.
 *
 * **Offline first (F07/ADR-001).** Nomey opens without network, so the
 * identity cannot be a dependency of the start. Two things make that true:
 *
 * - the last identity the server confirmed is kept per account
 *   (`identity-cache.ts`, the shared offline store) and read at the same time
 *   the server is asked: on a cold start without network the account sees
 *   its own `@handle` from the backup, and the server overrides it the moment
 *   it answers;
 * - a transport failure is `unavailable`, which lets the app in exactly like
 *   `ready` does — it is NOT the gate, because nothing said the account lacks
 *   a username, and it is NOT a blocking screen, because the capabilities that
 *   work offline must keep working. Only the server's `USERNAME_REQUIRED`
 *   opens the gate. When the app comes back to the foreground
 *   (`wakeIdentity`, the one `AppState` seam of F07/ADR-001 §12) an
 *   unresolved identity asks again; a resolved one does not.
 *
 * **Why there is no loop:** the effect depends on the actor, the guest flag
 * and a wake counter — nothing that changes per render — so it fires once per
 * real event; a superseded flight (the session flipped while it was out)
 * discards its answer instead of painting a stale one; a failure does not
 * retry by itself, only on the next foreground. And nothing is written in the
 * effect body: the answer is keyed by actor and derived.
 *
 * Lives in `features/auth` next to the sign-up reservation: `features/` may
 * not import `features/`, and the gate reuses this feature's field and submit
 * guard. The composition root (`app/_layout.tsx`) hands it the session, as it
 * does for the scope and the queue.
 */
type IdentityContextValue = {
  readonly state: IdentityState;
  /** A normal account whose lifecycle has not answered yet: hold the splash. */
  readonly pending: boolean;
  /** A screen that changed the identity through a command applies the row it got back. */
  readonly apply: (identity: AccountIdentity) => void;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

/**
 * How long a normal account waits on the splash for the server's word before
 * entering as `unavailable`. Same figure and same reasoning as the session's
 * own watchdog (`DEFAULT_WATCHDOG_MS`): long enough for a slow network not to
 * be called a failure, short enough that nobody stares at a held splash. Not a
 * deadline — the flight stays alive and a later answer still wins.
 */
export const IDENTITY_WATCHDOG_MS = 10_000;

type Answer = {
  readonly for: string;
  readonly state: IdentityState;
  /** `server` answers are final for this actor; a `cache` answer yields to the server. */
  readonly source: 'server' | 'cache';
};

export function AccountIdentityProvider({
  actorId,
  isAnonymous,
  children,
}: {
  /** The session's `sub`, or `''` when nobody is signed in. */
  readonly actorId: string;
  readonly isAnonymous: boolean;
  readonly children: ReactNode;
}) {
  /*
   * The answer is KEYED BY ACTOR and derived, never reset: an answer that
   * belongs to another account — or to nobody — simply does not apply, so a
   * sign-out or a change of account needs no setState in an effect, and a
   * previous account's identity is never shown for a frame.
   */
  const [answer, setAnswer] = useState<Answer>({
    for: '',
    state: IDENTITY_IDLE,
    source: 'server',
  });
  const [wake, setWake] = useState(0);
  const flight = useRef(0);

  const asks = actorId !== '' && !isAnonymous;
  const state: IdentityState = asks && answer.for === actorId ? answer.state : IDENTITY_IDLE;

  useEffect(() => {
    if (!asks) return;
    const mine = ++flight.current;
    const alive = () => mine === flight.current;

    /*
     * THE BACKUP IS READ AT THE SAME TIME, NOT AFTER. Without network `fetch`
     * can take long to give up, and the account would sit on the splash with an
     * identity it already knows. It only paints if the server has not answered
     * for this actor yet; a server answer, when it comes, replaces it.
     */
    void (async () => {
      const cached = await recall(actorId);
      if (!alive() || cached === null) return;
      setAnswer((current) =>
        current.for === actorId && current.source === 'server'
          ? current
          : { for: actorId, state: { status: 'ready', identity: cached }, source: 'cache' },
      );
    })();

    const settle = (next: IdentityState) => {
      if (!alive()) return;
      setAnswer((current) => {
        /*
         * A transport failure never overwrites something better: not the
         * backup already painted, and not a server answer of this actor.
         */
        if (
          next.status === 'unavailable' &&
          current.for === actorId &&
          current.state.status !== 'idle'
        ) {
          return current;
        }
        return { for: actorId, state: next, source: 'server' };
      });
      if (next.status === 'ready') void remember(actorId, next.identity);
    };
    void claimUsername().then(
      (result) => {
        if (result.ok) settle({ status: 'ready', identity: result.identity });
        else if (result.required === true) settle(IDENTITY_REQUIRED);
        else settle(IDENTITY_UNAVAILABLE);
      },
      () => settle(IDENTITY_UNAVAILABLE),
    );
    // Without network `fetch` may take long to give up: the watchdog lets the
    // account in as `unavailable` meanwhile. `settle` never lets that overwrite
    // an answer, and the late answer still lands (the flight is alive).
    const watchdog = setTimeout(() => settle(IDENTITY_UNAVAILABLE), IDENTITY_WATCHDOG_MS);
    return () => {
      clearTimeout(watchdog);
      // A later run owns the answer now; this one must not paint.
      flight.current += 1;
    };
  }, [asks, actorId, wake]);

  /*
   * RECONNECTION. Back in the foreground, an identity the server never
   * confirmed asks again — and only that one: a server-confirmed identity does
   * not fire a request on every foreground. Read through a ref so the
   * subscription is created once.
   */
  const unresolved = useRef(false);
  const stillUnresolved = asks && (state.status === 'unavailable' || answer.source === 'cache');
  useEffect(() => {
    unresolved.current = stillUnresolved;
  }, [stillUnresolved]);
  useEffect(
    () =>
      onIdentityWake(() => {
        if (unresolved.current) setWake((value) => value + 1);
      }),
    [],
  );

  const apply = useCallback(
    (identity: AccountIdentity) => {
      setAnswer({ for: actorId, state: { status: 'ready', identity }, source: 'server' });
      void remember(actorId, identity);
    },
    [actorId],
  );

  const pending = isIdentityPending(state, asks);
  const value = useMemo(() => ({ state, pending, apply }), [state, pending, apply]);
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useAccountIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (value === null) {
    throw new Error('useAccountIdentity must be used inside AccountIdentityProvider');
  }
  return value;
}

/*
 * Opening the store is all that stays here; the document, its isolation per
 * actor and its verdict live in `identity-cache.ts`, where they are tested
 * without a device. Opening can fail too, and that is not the person's problem.
 */
async function remember(actorId: string, identity: AccountIdentity): Promise<void> {
  try {
    await rememberIdentity(
      await offlineCatalogueCache(),
      actorId,
      identity,
      new Date().toISOString(),
    );
  } catch {
    // Sin base no hay respaldo.
  }
}

async function recall(actorId: string): Promise<AccountIdentity | null> {
  try {
    return await recallIdentity(await offlineCatalogueCache(), actorId);
  } catch {
    return null;
  }
}
