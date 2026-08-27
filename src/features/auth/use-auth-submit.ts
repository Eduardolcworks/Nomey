import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AuthErrorKey } from './auth-errors';
import type { AuthResult } from './auth-service';
import { createExclusiveRunner, SKIPPED } from './submit-guard';

/**
 * The bit of state every auth form needs: is it running, and did it fail.
 *
 * What it does NOT do is hold the form fields. Those stay in the screen,
 * which is what keeps a recoverable error recoverable: the request failed,
 * the state here goes back to idle with a message, and what the user typed
 * was never this module's to throw away.
 */

export type SubmitState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'failed'; readonly messageKey: AuthErrorKey };

export function useAuthSubmit() {
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  // One runner for the lifetime of the screen; a new one per render would
  // guard nothing.
  const run = useMemo(() => createExclusiveRunner(), []);

  /*
   * The guard below was checked but never lowered - nothing ever set this to
   * false, so `if (!mounted.current)` could not fire and the protection it
   * claimed did not exist. Found while auditing this layer for the hang; it is
   * NOT what caused it.
   *
   * React 18 makes a setState after unmount a silent no-op, so the symptom was
   * nothing at all, which is exactly why a guard that does not guard is worse
   * than no guard: it reads as handled.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    async (task: () => Promise<AuthResult>): Promise<AuthResult | undefined> => {
      setState({ status: 'running' });

      const result = await run(async () => {
        try {
          return await task();
        } catch {
          // The service maps everything it can reach. Anything that still
          // throws is ours, and the user gets the generic sentence rather
          // than whatever the exception happened to say.
          return { ok: false, messageKey: 'authError.generic' } as const;
        }
      });

      if (result === SKIPPED) return undefined;
      if (!mounted.current) return result;

      setState(
        result.ok ? { status: 'idle' } : { status: 'failed', messageKey: result.messageKey },
      );
      return result;
    },
    [run],
  );

  const clearError = useCallback(() => {
    setState((previous) => (previous.status === 'failed' ? { status: 'idle' } : previous));
  }, []);

  return { state, submit, clearError, running: state.status === 'running' };
}
