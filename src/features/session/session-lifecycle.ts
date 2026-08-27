import {
  type AuthenticatedUser,
  type SessionState,
  stateFromUser,
  UNAVAILABLE,
} from './session-state';

/**
 * The whole session lifecycle, as one function with its dependencies injected.
 *
 * It lives outside React so every rule below can be tested for what it does
 * rather than for how it is wired: subscribe once, never emit after teardown,
 * start and stop the refresh with the app, and never strand the caller in
 * `restoring`. A `useEffect` cannot be asked those questions without a React
 * renderer, and none is installed.
 *
 * ORDERING, and why there is no race to manage.
 *
 * The obvious shape - call `getSession()`, and separately subscribe to
 * `onAuthStateChange` - has a real race: a slow restore can resolve after a
 * newer event and overwrite it with a stale answer. This does not use that
 * shape.
 *
 * `@supabase/auth-js@2.112.4` emits `INITIAL_SESSION` to every new subscriber
 * on its own, after its initialisation settles (`GoTrueClient._emitInitialSession`),
 * and it emits it **even when restoring failed** - a missing session, a dead
 * refresh token or an aborted fetch all arrive as `INITIAL_SESSION` with a null
 * session rather than as a hang. Read from the installed package, not from
 * memory.
 *
 * So the restore result and every later event come from ONE ordered source.
 * There is no second promise that can land late, because there is no second
 * promise. That is a structural answer rather than a defensive one - there is
 * no sequence number to compare and nothing to discard.
 */

/** Only what a subscription needs to be cancellable. */
export type AuthSubscription = { unsubscribe(): void };

/** The slice of the Supabase auth client this needs. */
export type AuthPort = {
  onAuthStateChange(
    callback: (user: AuthenticatedUser | null) => void,
  ): { data: { subscription: AuthSubscription } };
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
};

/** The slice of React Native's AppState this needs. */
export type AppStatePort = {
  readonly currentState: string | null;
  addEventListener(type: 'change', handler: (status: string) => void): { remove(): void };
};

export type LifecycleOptions = {
  readonly auth: AuthPort;
  readonly appState: AppStatePort;
  /** Called with every new state. Never called after the returned teardown. */
  readonly emit: (state: SessionState) => void;
  /** How long to wait for the first auth event before admitting we do not know. */
  readonly watchdogMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Surfaces a rejected start/stopAutoRefresh instead of an unhandled rejection. */
  readonly onRefreshError?: (error: unknown) => void;
};

/**
 * Ten seconds.
 *
 * Long enough that a slow network resolving a stored session is not called a
 * failure, short enough that nobody stares at a held splash wondering. And it
 * is not a deadline: a later answer still wins, because the subscription is
 * still live when it fires.
 */
export const DEFAULT_WATCHDOG_MS = 10_000;

/**
 * Start the lifecycle. Returns the teardown, which is safe to call at any time
 * and more than once.
 */
export function startSessionLifecycle(options: LifecycleOptions): () => void {
  const {
    auth,
    appState,
    emit,
    watchdogMs = DEFAULT_WATCHDOG_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    onRefreshError,
  } = options;

  let stopped = false;
  let answered = false;
  let watchdog: unknown = null;
  /** What the refresh loop was last told, so a repeat is not re-sent. */
  let refreshing: boolean | null = null;

  function cancelWatchdog(): void {
    if (watchdog !== null) {
      clearTimer(watchdog);
      watchdog = null;
    }
  }

  /** The only way state leaves this module, and the only place `stopped` is honoured. */
  function publish(state: SessionState): void {
    if (stopped) return;
    emit(state);
  }

  // ------------------------------------------------------------------ auth --
  const { data } = auth.onAuthStateChange((user) => {
    // Any real answer retires the watchdog, including the one that arrives
    // after it already fired: `unavailable` is a holding state, not a verdict.
    answered = true;
    cancelWatchdog();
    publish(stateFromUser(user));
  });

  watchdog = setTimer(() => {
    watchdog = null;
    if (answered) return;
    publish(UNAVAILABLE);
  }, watchdogMs);

  // -------------------------------------------------------------- refresh ---
  /*
   * The library owns the timer. `startAutoRefresh` internally stops any
   * running ticker before starting a new one, so it is already idempotent -
   * this guard is about not making pointless native round trips on repeated
   * events of the same kind, not about correctness. Nomey writes no timer of
   * its own; a second refresh loop is how two clients end up racing for the
   * same rotating refresh token.
   */
  function applyRefresh(active: boolean): void {
    if (stopped) return;
    if (refreshing === active) return;
    refreshing = active;
    const pending = active ? auth.startAutoRefresh() : auth.stopAutoRefresh();
    void pending.catch((error: unknown) => {
      onRefreshError?.(error);
    });
  }

  /*
   * `AppState.currentState` can be null before the first change on Android.
   * Treating an unknown state as active is the right default: the app is
   * running this code, and a refresh loop that is on when it could be off
   * costs a timer, while one that is off when it should be on costs the user
   * their session.
   */
  applyRefresh(appState.currentState === null || appState.currentState === 'active');

  const appStateSubscription = appState.addEventListener('change', (status) => {
    applyRefresh(status === 'active');
  });

  // ------------------------------------------------------------- teardown ---
  return function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelWatchdog();
    data.subscription.unsubscribe();
    appStateSubscription.remove();
    // Leave the refresh loop stopped rather than running against a client
    // nothing is listening to any more.
    if (refreshing === true) {
      refreshing = false;
      void auth.stopAutoRefresh().catch((error: unknown) => {
        onRefreshError?.(error);
      });
    }
  };
}
