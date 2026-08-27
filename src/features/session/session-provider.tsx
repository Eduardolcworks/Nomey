import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

import { type AppStatePort, type AuthPort, startSessionLifecycle } from './session-lifecycle';
import { RESTORING, type SessionState } from './session-state';

/**
 * The single owner of session state.
 *
 * Everything interesting is in `session-lifecycle.ts`; this file is the React
 * shell around it and the adapters that turn the real Supabase client and
 * React Native's `AppState` into the two narrow ports that module asks for.
 *
 * There is exactly one of these, mounted at the root, and it is the only
 * subscriber to `onAuthStateChange` in the app. A second subscription is not a
 * second bug - it is two answers to "who is signed in" that can disagree.
 */

type SessionContextValue = {
  readonly state: SessionState;
  /** Re-runs the whole lifecycle. Only meaningful from `unavailable`. */
  readonly retry: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/** Adapts the auth client to the port: the token never crosses this boundary. */
const authPort: AuthPort = {
  onAuthStateChange: (callback) =>
    supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
    }),
  startAutoRefresh: () => supabase.auth.startAutoRefresh(),
  stopAutoRefresh: () => supabase.auth.stopAutoRefresh(),
};

const appStatePort: AppStatePort = {
  get currentState() {
    return AppState.currentState;
  },
  addEventListener: (type, handler) => AppState.addEventListener(type, handler),
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(RESTORING);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState(RESTORING);
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    const stop = startSessionLifecycle({
      auth: authPort,
      appState: appStatePort,
      emit: setState,
      onRefreshError: (error) => {
        // Never the whole session object: `AGENTS.md` §8. A failed refresh is
        // not fatal - the next foreground tries again - so it is logged and
        // the state is left alone.
        console.warn('[session] auto refresh failed', error instanceof Error ? error.name : error);
      },
    });

    // Unsubscribes, removes the AppState listener, cancels the watchdog and
    // stops emitting. Re-runs only when `retry` bumps the attempt.
    return stop;
  }, [attempt]);

  return <SessionContext.Provider value={{ state, retry }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside <SessionProvider>.');
  }
  return value;
}
