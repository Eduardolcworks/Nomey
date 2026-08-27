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

const ScopeContext = createContext<{ scope: Scope; setScope: (next: Scope) => void } | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>('personal');
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
