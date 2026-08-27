import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import type { MessageKey } from '@/lib/i18n';

/**
 * Which set of books Inicio is looking at.
 *
 * Personal and Pareja are two different financial scopes, not two filters over
 * one. That distinction is why this lives in a provider mounted above the tabs
 * rather than in the screen: it has to survive going to Grupos and coming
 * back. A selector that silently resets is how a couple's dinner gets recorded
 * in someone's personal books - a plausible figure in both places, and nothing
 * throws.
 *
 * **Personal on every cold start**, deliberately. There is no persistence in
 * F4.C, and while Pareja is a placeholder, starting there would point the
 * fastest path in the app at a scope that does not exist yet.
 */
export type Scope = 'personal' | 'couple';

/** Whether the scope can actually receive a movement today. */
export const SCOPE_AVAILABLE: Readonly<Record<Scope, boolean>> = {
  personal: true,
  couple: false,
};

export const SCOPE_LABEL: Readonly<Record<Scope, MessageKey>> = {
  personal: 'scope.personal',
  couple: 'scope.couple',
};

export const SCOPES: readonly Scope[] = ['personal', 'couple'];

/**
 * Where every account starts, and where every account returns on the way out.
 *
 * Named rather than written twice, because "the initial value" and "the value
 * to reset to" have to be the same thing by construction. Two literals that
 * happen to agree today are two literals that can stop agreeing.
 */
export const INITIAL_SCOPE: Scope = 'personal';

const ScopeContext = createContext<{ scope: Scope; setScope: (next: Scope) => void } | null>(null);

export function ScopeProvider({
  children,
  identityKey = null,
}: {
  children: ReactNode;
  /**
   * Whatever identifies the current user, or `null` for nobody.
   *
   * The provider does not know what this is and must not: `features/shell`
   * cannot import `features/session` - cross-feature imports are barred by
   * `import/no-restricted-paths` - and it should not want to. Whoever
   * composes the two passes the value down. That is `app/_layout.tsx`, which
   * is the only place that legitimately sees both.
   */
  identityKey?: string | null;
}) {
  const [scope, setScope] = useState<Scope>(INITIAL_SCOPE);
  const [knownIdentity, setKnownIdentity] = useState<string | null>(identityKey);

  /*
   * Reset DURING RENDER, not in an effect, and this is the whole point of the
   * design rather than a style preference.
   *
   * The race being avoided is concrete. Sign-out emits an auth event, the
   * session provider above re-renders as `signed-out`, and `Stack.Protected`
   * drops the entire protected branch in that same commit. Any cleanup owned
   * by a screen inside that branch - a `useEffect` return, a handler
   * continuing after `await` - is running inside something that is being
   * unmounted, and "reset the scope" would be a promise made by a component
   * that no longer exists.
   *
   * This provider sits ABOVE the navigator, so it is never the thing being
   * unmounted, and React's documented "adjust state when a prop changes"
   * pattern applies: the comparison happens on the way down, React re-runs
   * this component immediately with the new state, and children render for
   * the first time already seeing the reset value. There is no frame in which
   * a screen can read the previous account's scope, and no ordering left for
   * anyone to get wrong.
   *
   * It fires in both directions on purpose. Signing out clears the scope, and
   * so does signing in - so an account that somehow arrives with state left
   * over still starts from `INITIAL_SCOPE`.
   */
  if (identityKey !== knownIdentity) {
    setKnownIdentity(identityKey);
    setScope(INITIAL_SCOPE);
  }

  const value = useMemo(() => ({ scope, setScope }), [scope]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const value = useContext(ScopeContext);
  if (value === null) {
    throw new Error('useScope must be used inside a ScopeProvider');
  }
  return value;
}
