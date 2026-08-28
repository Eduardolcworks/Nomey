import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { disposeRecoveryClient } from '@/lib/supabase';

import type { AuthErrorKey } from './auth-errors';
import { completeRecovery, redeemRecovery } from './auth-service';
import { RECOVERY_IDLE, type RecoveryState, type RedeemOutcome } from './recovery-state';

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
  /**
   * Redeem a proof read out of a deep link. Called by the link owner.
   *
   * It answers with what the attempt ESTABLISHED, because the caller has to
   * decide whether that proof is gone - and only the server can tell it. It
   * never rejects: every path returns an outcome.
   */
  readonly redeem: (tokenHash: string) => Promise<RedeemOutcome>;
  /**
   * Set the new password, then end the ephemeral session.
   *
   * Answers with the sentence to show IN THE FORM, or `null` when the form has
   * nothing left to say - because it succeeded, or because the transaction
   * ended underneath it.
   *
   * Almost every failure keeps the form: the proof was already redeemed and
   * the ephemeral session is still there, so the person corrects and saves
   * again, and nothing sends them back for a new link. The exception is a
   * session the server has told us is unusable, which ends the transaction
   * rather than offering a retry that cannot work.
   */
  readonly setPassword: (password: string) => Promise<AuthErrorKey | null>;
  /** Leave the flow: after an error, or after finishing. */
  readonly dismiss: () => void;
};

const RecoveryContext = createContext<RecoveryContextValue | null>(null);

export function RecoveryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RecoveryState>(RECOVERY_IDLE);

  const redeem = useCallback(async (tokenHash: string): Promise<RedeemOutcome> => {
    setState({ status: 'redeeming' });

    /*
     * An outcome is owed to the caller on every path, and a throw would owe it
     * nothing - which would leave the surface stuck on "Comprobando el enlace…"
     * and the proof in limbo. Same belt as `setPassword` below.
     */
    let result: Awaited<ReturnType<typeof redeemRecovery>>;
    try {
      result = await redeemRecovery(tokenHash);
    } catch {
      result = {
        ok: false,
        outcome: 'unresolved',
        titleKey: 'auth.recoveryUnresolvedTitle',
        messageKey: 'authError.generic',
      };
    }

    if (!result.ok) {
      /*
       * A refused link never becomes a surface. Used, expired and invented all
       * answer the same way - measured - so there is one message and no branch
       * that could tell someone holding a stolen link which kind of failure
       * they found.
       *
       * What DOES branch is whether we may call the link invalid at all. A
       * redemption that never reached the server proved nothing about it, so
       * it gets its own title and the proof stays redeemable: the person opens
       * the same link again and this runs again.
       */
      disposeRecoveryClient();
      setState({ status: 'error', titleKey: result.titleKey, messageKey: result.messageKey });
      return result.outcome;
    }

    setState({ status: 'recovering' });
    return 'consumed';
  }, []);

  const setPassword = useCallback(async (password: string): Promise<AuthErrorKey | null> => {
    /*
     * `completeRecovery` already swallows what it can, and this is the
     * belt behind that: an unexpected throw must not escape into the screen,
     * where the awaited call would leave the button busy forever.
     */
    let result: Awaited<ReturnType<typeof completeRecovery>>;
    try {
      result = await completeRecovery(password);
    } catch {
      result = { ok: false, outcome: 'retryable', messageKey: 'authError.passwordChangeFailed' };
    }

    if (!result.ok && result.outcome === 'session-lost') {
      /*
       * THE ONE SAVE FAILURE THAT ENDS THE TRANSACTION.
       *
       * The proof was already spent by `verifyOtp`, so no number of
       * `updateUser` calls can bring back the session it produced. Keeping the
       * form up here would be an invitation to retry something that cannot
       * succeed, which is why this is a terminal state of its own rather than
       * another sentence in the form.
       *
       * It says nothing new about the LINK - it never was the problem - and
       * the ephemeral client goes with it, so nothing is left to call.
       */
      disposeRecoveryClient();
      setState({ status: 'error', titleKey: result.titleKey, messageKey: result.messageKey });
      return null;
    }

    if (!result.ok) {
      /*
       * A FAILED SAVE IS NOT A VERDICT ON THE LINK, AND IT ENDS NOTHING.
       *
       * By the time this runs the proof has already been redeemed: `verifyOtp`
       * succeeded and the ephemeral session exists. Moving to `error` here sent
       * the person to a terminal screen whose only exit discarded that session,
       * so a rejected password - or a lost packet - cost them the recovery and
       * a fresh link they never needed.
       *
       * So the state does not move at all. The transaction stays `recovering`,
       * the form stays up with what they typed, and the sentence goes back to
       * the caller to show in place. The retry is another explicit tap on
       * Guardar; nothing here retries on its own.
       */
      return result.messageKey;
    }

    // `completeRecovery` has already signed the ephemeral session out.
    disposeRecoveryClient();
    setState({ status: 'completed' });
    return null;
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
