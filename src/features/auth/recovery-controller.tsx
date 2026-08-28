import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { disposeRecoveryClient } from '@/lib/supabase';

import { completeRecovery, redeemRecovery } from './auth-service';
import { RECOVERY_IDLE, type RecoveryState } from './recovery-state';

/**
 * One password recovery, from the moment a link is redeemed until it ends.
 *
 * **Not a second session provider.** It models a transaction, not an identity:
 * it has no user, no token, no restore, no refresh and no persistence, and it
 * cannot outlive the process. `SessionProvider` remains the only thing in
 * Nomey that answers "who is signed in", and during a recovery its answer is
 * `signed-out` - truthfully, because the main client genuinely holds no
 * session.
 *
 * There is deliberately no `restoring` state and no way to resume. A recovery
 * that was interrupted is simply gone: the ephemeral session died with the
 * process, so the next launch starts at the sign-in screen and the person asks
 * for a new link. **That fail-closed is the design**, and the reason the
 * ephemeral client exists at all.
 */
type RecoveryContextValue = {
  readonly state: RecoveryState;
  /** Redeem a proof read out of a deep link. Called by the link owner. */
  readonly redeem: (tokenHash: string) => Promise<void>;
  /** Set the new password, then end the ephemeral session. */
  readonly setPassword: (password: string) => Promise<boolean>;
  /** Leave the flow: after an error, or after finishing. */
  readonly dismiss: () => void;
};

const RecoveryContext = createContext<RecoveryContextValue | null>(null);

export function RecoveryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RecoveryState>(RECOVERY_IDLE);

  const redeem = useCallback(async (tokenHash: string) => {
    setState({ status: 'redeeming' });

    const result = await redeemRecovery(tokenHash);

    if (!result.ok) {
      /*
       * A refused link never becomes a surface. Used, expired and invented all
       * answer the same way - measured - so there is one message and no branch
       * that could tell someone holding a stolen link which kind of failure
       * they found.
       */
      disposeRecoveryClient();
      setState({ status: 'error', messageKey: result.messageKey });
      return;
    }

    setState({ status: 'recovering' });
  }, []);

  const setPassword = useCallback(async (password: string) => {
    const result = await completeRecovery(password);

    if (!result.ok) {
      /*
       * The recovery stays open. The ephemeral session is still valid, so a
       * failed save is retryable on the spot - dropping the person out here
       * would cost them the link for a network blip.
       */
      setState({ status: 'error', messageKey: result.messageKey });
      return false;
    }

    // `completeRecovery` has already signed the ephemeral session out.
    disposeRecoveryClient();
    setState({ status: 'completed' });
    return true;
  }, []);

  const dismiss = useCallback(() => {
    disposeRecoveryClient();
    setState(RECOVERY_IDLE);
  }, []);

  const value = useMemo(
    () => ({ state, redeem, setPassword, dismiss }),
    [state, redeem, setPassword, dismiss],
  );

  return <RecoveryContext.Provider value={value}>{children}</RecoveryContext.Provider>;
}

export function useRecovery(): RecoveryContextValue {
  const value = useContext(RecoveryContext);
  if (value === null) {
    throw new Error('useRecovery must be used inside <RecoveryProvider>.');
  }
  return value;
}
