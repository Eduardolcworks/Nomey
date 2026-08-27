import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect } from 'react';

import {
  identityKey,
  isPublic,
  isResolved,
  isSignedIn,
  SessionProvider,
  useSession,
} from '@/features/session';
import { ScopeProvider } from '@/features/shell';
import { Colors } from '@/ui/theme';
import { ThemedView } from '@/ui/components';

/**
 * Root layout.
 *
 * Two branches that are never both available, and a moment at the start when
 * neither is. `SessionProvider` sits above everything because the choice of
 * branch is the first thing the app has to know.
 *
 * `ScopeProvider` stays exactly where it was, wrapping the navigator. Personal
 * and Pareja are two different sets of books, not two filters, so the choice
 * has to survive going to Grupos and coming back - but NOT survive a change of
 * account, which is what `ScopeBinding` below is for.
 */

/*
 * Hold the splash before the first render, so nothing decides to paint while
 * the session is still being resolved. It is a promise, and a rejected one
 * here would be an unhandled rejection at startup for no gain: if holding the
 * splash fails, the React gate below still prevents the wrong branch from
 * mounting.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SessionProvider>
      <ScopeBinding>
        {/*
         * Fixed light, not "auto". The app is dark-only, so the status bar
         * content is always light-on-dark; "auto" would resolve from the
         * scheme and add a branch that can only go one way.
         */}
        <StatusBar style="light" />
        <RootNavigator />
      </ScopeBinding>
    </SessionProvider>
  );
}

/**
 * Ties the scope's lifetime to whoever is signed in.
 *
 * The smallest thing that can do this, and it has to live here. `features/`
 * modules may not import each other, so `ScopeProvider` cannot ask who the
 * user is and `SessionProvider` has no business knowing a scope exists. This
 * file is the composition root - the one place that already imports both - so
 * the single value that connects them is passed here and nowhere else.
 *
 * A component rather than an inline call because `useSession` can only be
 * read from INSIDE `SessionProvider`, and `RootLayout` is the thing rendering
 * it.
 *
 * Note what this deliberately is not: it is not a `key` on `ScopeProvider`.
 * Keying it would remount the navigator on every sign-in and sign-out, which
 * throws away far more than the scope and does it as a side effect of a
 * reconciliation detail. The reset is explicit instead.
 */
function ScopeBinding({ children }: { children: ReactNode }) {
  const { state } = useSession();
  return <ScopeProvider identityKey={identityKey(state)}>{children}</ScopeProvider>;
}

function RootNavigator() {
  const { state } = useSession();
  const resolved = isResolved(state);

  useEffect(() => {
    if (!resolved) return;
    /*
     * Hidden on ANY resolution, `unavailable` included. A splash that only
     * lifts on success is a splash that can stay up forever, which is the one
     * startup failure with no way out.
     */
    void SplashScreen.hideAsync().catch(() => {});
  }, [resolved]);

  /*
   * The product rule, and the reason this is an early return rather than two
   * false guards: while restoring, NEITHER branch may mount. Not the sign-in
   * surface, not Inicio - a provisional glimpse of either is a lie about
   * whether the user is signed in.
   *
   * The ground colour underneath is Nomey's black, so even where the native
   * splash cannot be verified - Expo Go substitutes its own - what shows is
   * the app's own ground and never a screen.
   */
  if (!resolved) {
    return <ThemedView style={{ flex: 1 }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark.background },
      }}>
      {/*
       * `Stack.Protected` is NAVIGATION, not security. It decides what can be
       * reached from inside the app; it does not decide what the server will
       * answer. Without a session PostgREST refuses with 42501 whatever the
       * client renders, and RLS remains the only authorisation boundary.
       */}
      <Stack.Protected guard={isPublic(state)}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn(state)}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="account" />
      </Stack.Protected>

      {/*
       * The development surfaces, behind BOTH the session and `__DEV__`.
       *
       * They were previously registered unconditionally, with only the links
       * to them in Profile behind `__DEV__` - which left the routes reachable
       * by URL in a release build. Guarding them here closes that, and keeps
       * them from becoming a public door around the sign-in branch.
       */}
      <Stack.Protected guard={isSignedIn(state) && __DEV__}>
        <Stack.Screen name="diagnostics" />
        <Stack.Screen name="states" />
        <Stack.Screen name="session-probe" />
      </Stack.Protected>
    </Stack>
  );
}
