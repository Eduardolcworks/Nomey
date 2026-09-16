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
  onAuthStateChange(callback: (user: AuthenticatedUser | null) => void): {
    data: { subscription: AuthSubscription };
  };
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
  /**
   * The AUTHORITATIVE user, from the server (`GET /user`), not the copy the
   * stored session carries. Optional: only the guest conversion below needs
   * it, and the fakes in the tests need not know it exists.
   */
  fetchUser?(): Promise<AuthenticatedUser | null>;
  /**
   * Ask the server for a fresh session NOW, outside the refresh loop's own
   * schedule: new tokens AND the fresh user, persisted, and announced through
   * `onAuthStateChange` like everything else. Optional, as above.
   */
  refreshSession?(): Promise<void>;
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
  /**
   * How often to ask the server whether a PENDING guest conversion has been
   * confirmed, while the app is active. Only while pending: never a permanent
   * poll. The link is followed outside the app, often on another device, so
   * no AppState transition can be relied on to notice.
   */
  readonly conversionPollMs?: number;
  /**
   * Called when the app comes back to the foreground.
   *
   * **This exists so nobody adds a second `AppState` listener.** F7's sync
   * worker needs the same signal this lifecycle already listens for, and
   * F07/ADR-001 §12 is explicit that it must reuse this port rather than register
   * its own — two listeners for one event is how two mechanisms start
   * competing. Called only on the transition into `active`, never on every
   * change, and never after the returned teardown.
   */
  readonly onForeground?: () => void;
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
/** A pending conversion is checked this often while the app is active. */
export const DEFAULT_CONVERSION_POLL_MS = 15_000;

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
    onForeground,
    conversionPollMs = DEFAULT_CONVERSION_POLL_MS,
  } = options;

  let stopped = false;
  let answered = false;
  /**
   * The GUEST CONVERSION, as the last auth event described it: a guest
   * (anonymous) who asked to become an account (`new_email` waiting for its
   * confirmation). Presentation state on the stored user, never the
   * authority: the authority is what `fetchUser` answers.
   */
  let pendingConversion = false;
  let active = true;
  let probing = false;
  let poll: unknown = null;
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
    pendingConversion =
      user?.is_anonymous === true && typeof user.new_email === 'string' && user.new_email !== '';
    publish(stateFromUser(user));
    /*
     * A RESTORED session is a COPY: the stored user and JWT say what they said
     * when they were saved, and a guest who confirmed the email on another
     * device (or after killing the app) is already an account on the server
     * while this copy still says anonymous. So every event that describes a
     * pending conversion asks the server, now — cold start included — and
     * keeps asking while it stays pending. Once the server says the user is
     * no longer anonymous, the refresh replaces the copy and this stops.
     */
    if (pendingConversion) {
      void probeConversion();
      schedulePoll();
    } else {
      cancelPoll();
    }
  });

  // ------------------------------------------------------ guest conversion --
  /*
   * WHY `getUser` + `refreshSession`, and not one of them alone. MEASURED
   * against GoTrue after following the confirmation link: the stored JWT
   * still carries `is_anonymous: true` (a token is not re-issued by a change
   * elsewhere), `GET /user` with that very token already answers
   * `is_anonymous: false` with the email set (authoritative, read-only, no
   * token rotation), and `POST /token?grant_type=refresh_token` then returns
   * a session whose user AND JWT are the account, same `sub`. So the cheap,
   * side-effect-free question is asked first, and the session is replaced
   * only once the answer is yes — through the library, which persists it and
   * emits `TOKEN_REFRESHED` to the single subscriber above. Nothing here
   * touches state directly.
   */
  async function probeConversion(): Promise<void> {
    if (stopped || probing || auth.fetchUser === undefined || auth.refreshSession === undefined)
      return;
    probing = true;
    try {
      const fresh = await auth.fetchUser();
      if (stopped || fresh === null || fresh.is_anonymous !== false) return;
      await auth.refreshSession();
    } catch (error: unknown) {
      onRefreshError?.(error);
    } finally {
      probing = false;
    }
  }

  function cancelPoll(): void {
    if (poll !== null) {
      clearTimer(poll);
      poll = null;
    }
  }

  function schedulePoll(): void {
    cancelPoll();
    if (stopped || !pendingConversion || !active) return;
    poll = setTimer(() => {
      poll = null;
      void probeConversion();
      schedulePoll();
    }, conversionPollMs);
  }

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
    /*
     * The transition, not the state. `refreshing` still holds the previous
     * value at this point, so comparing before `applyRefresh` is what tells a
     * genuine return to the foreground from a repeated `active` event - and the
     * offline queue must not be woken on every notification the OS sends.
     */
    const returning = status === 'active' && !refreshing;
    applyRefresh(status === 'active');
    active = status === 'active';
    if (!active) cancelPoll();
    if (returning && !stopped) {
      onForeground?.();
      // Back in the foreground with a conversion pending: ask now, and resume
      // asking while it stays pending.
      if (pendingConversion) {
        void probeConversion();
        schedulePoll();
      }
    }
  });

  // ------------------------------------------------------------- teardown ---
  return function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelWatchdog();
    cancelPoll();
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
