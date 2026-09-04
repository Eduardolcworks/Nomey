import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { isRecoveryActive, RecoveryProvider, useRecovery, useRecoveryLink } from '@/features/auth';
import { useEntryQueueRuntime, wakeEntryQueue } from '@/features/personal';
import {
  identityKey,
  isPublic,
  isResolved,
  isSignedIn,
  SessionProvider,
  useSession,
} from '@/features/session';
import { AddBackdropProvider, ScopeProvider } from '@/features/shell';
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
    /*
     * LA RAÍZ DE LOS GESTOS, y hace falta de verdad.
     *
     * `react-native-gesture-handler` necesita esta vista por encima de todo
     * para instalar su reconocedor; sin ella, un gesto declarado con la
     * biblioteca **no se dispara nunca en Android y es frágil en iOS**, sin que
     * nada falle ni avise. Lo pide su propia documentación de instalación.
     *
     * Estaba ausente porque hasta ahora ningún gesto de la biblioteca se usaba
     * directamente. Lo introduce el deslizamiento para eliminar de
     * «Movimientos recientes».
     *
     * **No cambia la composición**: es una vista con `flex: 1` en la raíz, del
     * tamaño de la pantalla, sin fondo propio ni margen. Nada de lo que hay
     * debajo mide distinto con ella.
     */
    <GestureHandlerRootView style={styles.root}>
      {/*
       * The offline queue reuses THIS provider's `AppState` listener for its
       * foreground trigger (ADR-028 §12): `onForeground` is the seam F7.C left
       * for it, and there is no second listener anywhere.
       */}
      <SessionProvider onForeground={wakeEntryQueue}>
        {/*
         * `RecoveryProvider` sits INSIDE the session provider and owns nothing it
         * owns. It models one transaction - a password recovery - over a separate,
         * memory-only auth client, and it is deliberately not a second session
         * provider: it has no user, no token, no restore and no persistence.
         *
         * During a recovery the main client genuinely holds no session, so
         * `SessionProvider` reports `signed-out` truthfully rather than being
         * worked around.
         */}
        <RecoveryProvider>
          <ScopeBinding>
            <QueueBinding>
              {/*
               * Fixed light, not "auto". The app is dark-only, so the status bar
               * content is always light-on-dark; "auto" would resolve from the
               * scheme and add a branch that can only go one way.
               */}
              <StatusBar style="light" />
              <RootNavigator />
            </QueueBinding>
          </ScopeBinding>
        </RecoveryProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

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

/**
 * Mounts the offline queue's worker ONCE, tied to whoever is signed in.
 *
 * Same reasoning as `ScopeBinding`: the queue lives in `features/personal` and
 * may not ask the session who the actor is, so the composition root hands it
 * the identity. The worker is a process, not screen state - mounting it inside
 * the add sheet would kill it mid-request every time the sheet closed - which
 * is why it sits here, above the navigator, and nowhere else (ADR-028 §12).
 *
 * Renders nothing of its own; it exists to run one hook inside the provider.
 */
function QueueBinding({ children }: { children: ReactNode }) {
  const { state } = useSession();
  useEntryQueueRuntime(state.status === 'signed-in' ? state.identity.userId : '', state.status);
  return <>{children}</>;
}

function RootNavigator() {
  const { state } = useSession();
  const { state: recovery } = useRecovery();
  const resolved = isResolved(state);

  /*
   * The recovery deep link has exactly one owner, and it is here.
   *
   * Above the branches on purpose: a link can arrive while the app is cold,
   * while it sits on the sign-in screen, or while it is already open, and a
   * listener living inside a branch would miss whichever arrivals its branch
   * was not mounted for. This runs for all of them.
   *
   * It returns nothing and renders nothing. Redeeming the proof moves the
   * recovery controller, and the guard below does the rest - so the deep link
   * never touches navigation and the token hash never reaches a route param.
   *
   * Whether a session is already open has to be passed in: `features/` may not
   * import `features/`, so the hook cannot ask the session provider itself.
   * This file is the composition root, and it already sees both. A link
   * arriving while somebody is signed in is refused rather than redeemed, so
   * an ordinary session and a recovery transaction never coexist.
   */
  useRecoveryLink({ sessionStatus: state.status });

  /*
   * The recovery surface wins over both ordinary branches while it is active.
   *
   * That is a priority, not a session: the main state underneath is
   * `signed-out` the whole time, and stays that way. Nothing is faked to get
   * past a guard - there is simply a transaction in progress that owns the
   * screen until it ends.
   */
  const recovering = isRecoveryActive(recovery);

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

  /*
   * El fondo de «Añadir» se anuncia desde aquí porque sus dos extremos viven en
   * ramas distintas del Stack: el `+` está en las pestañas y la ventana es su
   * propia ruta. Es lo único que este proveedor comparte, y no sabe nada de
   * navegación.
   */
  return (
    <AddBackdropProvider>
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
        <Stack.Protected guard={isPublic(state) && !recovering}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        {/*
         * The recovery branch, governed by the transaction rather than by the
         * session.
         *
         * It is NOT part of `(auth)` and NOT part of the product. The session it
         * runs on lives in the ephemeral client's memory and is never persisted,
         * so it cannot be restored, cannot be refreshed, and cannot survive the
         * process - which is exactly what stops a recovery link from becoming an
         * ordinary login by killing the app halfway through.
         *
         * Nothing navigates into or out of it. Redeeming the link opens it and
         * the controller closes it; the tree follows both by itself.
         */}
        <Stack.Protected guard={recovering}>
          <Stack.Screen name="(recovery)" />
        </Stack.Protected>

        <Stack.Protected guard={isSignedIn(state) && !recovering}>
          <Stack.Screen name="(tabs)" />
          {/*
           * **`transparentModal` NO basta, y aquí está la prueba.**
           *
           * Las `screenOptions` de arriba dan a TODA pantalla un `contentStyle`
           * con el negro del tema. Es correcto para las demás —una pantalla
           * opaca sobre un fondo opaco—, pero una ventana modal que debe dejar
           * ver lo de detrás se estaba pintando encima un rectángulo negro
           * completo: la presentación era transparente y el CONTENIDO no.
           *
           * Es la causa de que el fondo se viera negro, y explica también por
           * qué ninguna intensidad de desenfoque cambiaba nada: no había nada
           * que desenfocar, había un panel negro por delante.
           *
           * La excepción es sólo de esta pantalla; las demás conservan su fondo.
           */}
          <Stack.Screen
            name="add"
            options={{
              presentation: 'transparentModal',
              animation: 'fade',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
          {/*
           * **La misma presentación que «Añadir movimiento», y por lo mismo.**
           * Sin `contentStyle` transparente, las `screenOptions` de arriba le
           * darían el negro del tema: la presentación sería transparente y el
           * CONTENIDO no, y detrás de la ventana se vería un rectángulo negro
           * en vez de Inicio desenfocado.
           */}
          {/*
           * **Las tres ventanas se presentan igual**, y no por casualidad: sin
           * `contentStyle` transparente, las `screenOptions` de arriba les darían
           * el negro del tema, y detrás de la ventana se vería un rectángulo
           * negro en vez de Inicio desenfocado.
           */}
          <Stack.Screen
            name="edit-movement"
            options={{
              presentation: 'transparentModal',
              animation: 'fade',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
          <Stack.Screen
            name="edit-balance"
            options={{
              presentation: 'transparentModal',
              animation: 'fade',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
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
        <Stack.Protected guard={isSignedIn(state) && !recovering && __DEV__}>
          <Stack.Screen name="diagnostics" />
          <Stack.Screen name="states" />
          <Stack.Screen name="session-probe" />
        </Stack.Protected>
      </Stack>
    </AddBackdropProvider>
  );
}
