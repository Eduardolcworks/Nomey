import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  AccountIdentityProvider,
  isRecoveryActive,
  needsUsernameGate,
  RecoveryProvider,
  useAccountIdentity,
  useRecovery,
  useRecoveryLink,
  wakeIdentity,
} from '@/features/auth';
import { groupCommandHandlers, sendGroupCreate, useInvitationLink } from '@/features/groups';
import { personalCommandHandlers, sendPersonalEntry } from '@/features/personal';
import { wakeTransfers } from '@/features/transfers';
import { useQueueRuntime, AddBackdropProvider, ScopeProvider } from '@/features/shell';
import { type CommandHandlers, wakeQueue } from '@/lib/offline';
import {
  identityKey,
  isPublic,
  isResolved,
  isSignedIn,
  SessionProvider,
  useSession,
} from '@/features/session';
import { Colors, Motion } from '@/ui/theme';
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
       * foreground trigger (F07/ADR-001 §12): `onForeground` is the seam F7.C left
       * for it, and there is no second listener anywhere.
       */}
      <SessionProvider onForeground={wakeOnForeground}>
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
              <IdentityBinding>
                {/*
                 * Fixed light, not "auto". The app is dark-only, so the status bar
                 * content is always light-on-dark; "auto" would resolve from the
                 * scheme and add a branch that can only go one way.
                 */}
                <StatusBar style="light" />
                <RootNavigator />
              </IdentityBinding>
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
 * THE ONE FOREGROUND SIGNAL, shared (F07/ADR-001 §12). The session provider
 * owns the only `AppState` listener; the offline queue wakes from it, and so
 * does an account identity the server never confirmed (F12.A3, offline
 * first): back in the foreground is when connectivity is most likely back.
 * The transfers of F12.C ask the server again for the same reason: the
 * other party may have answered while the app was away, and there is no
 * push to say so. Neither knows about the others; the composition root fans
 * the signal out.
 */
function wakeOnForeground(): void {
  wakeQueue();
  wakeIdentity();
  wakeTransfers();
}

/**
 * EL TEMA DE NAVEGACIÓN, Y POR QUÉ HAY QUE DECLARARLO.
 *
 * ═══════════ QUÉ SE MIDIÓ, Y CÓMO ═══════════
 *
 * Al pasar de Inicio a Grupos aparecía **un fotograma gris claro a pantalla
 * completa**. Medido en el emulador, con la transición ralentizada sólo para
 * poder muestrearla: de 16 capturas consecutivas, una —y sólo una— tenía el
 * **80,06 % de los píxeles por encima de L>60**, con luminancia media 64,4
 * frente a 19,6 en Inicio y 7,4 en Grupos.
 *
 * La causa se aisló con dos sondas de color, cada una con una sola variable:
 *
 * - pintando de magenta la vista que envuelve las pestañas, el lavado salió
 *   **morado** y aparecieron franjas magenta en los bordes laterales: durante el
 *   desplazamiento de 16 pt las escenas dejan ver lo que hay detrás;
 * - fijando `colors.background` del tema de navegación en verde, el lavado salió
 *   **verde entero**, incluida la franja de la barra de estado.
 *
 * La segunda es la concluyente: **el color del destello es exactamente
 * `colors.background` del tema de navegación**.
 *
 * ═══════════ POR QUÉ ERA CLARO ═══════════
 *
 * Sin `ThemeProvider`, react-navigation usa su tema por omisión, cuyo
 * `background` es `rgb(242, 242, 242)` — gris claro. Y ese color no es
 * decorativo: `elements/Screen` envuelve cada escena en un `<Background>` que lo
 * pinta, y el navegador de pestañas aplica a ESA MISMA vista el estilo animado
 * de la transición. Con las dos escenas cruzándose a media opacidad, el gris
 * deja de estar tapado y se ve entero.
 *
 * `contentStyle` del `Stack` ya era negro, y no bastaba: gobierna el contenido
 * de una pantalla del Stack, no el fondo que el navegador de pestañas pinta
 * bajo sus escenas. Son dos capas distintas.
 *
 * ═══════════ POR QUÉ ESTA CORRECCIÓN Y NO OTRA ═══════════
 *
 * No se tapa con un retraso, ni con una capa negra provisional, ni apagando la
 * animación: eso escondería el fotograma sin quitarlo, y seguiría ahí en cuanto
 * cambiara la duración o alguien reactivara el movimiento. Se corrige **en la
 * capa propietaria del color**, que es el tema de navegación, y desde la raíz de
 * composición, que es el único sitio que ya conoce a la vez la navegación y los
 * tokens.
 *
 * Parte de `DarkTheme` y **sólo sustituye `background`** por el negro real de
 * Nomey: `DarkTheme` trae `rgb(1, 1, 1)`, que no es el mismo color que el fondo
 * de la aplicación, y una diferencia de un punto es un borde visible en un
 * degradado. Lo demás del tema se hereda en vez de inventarse.
 */
const NAVIGATION_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Colors.dark.background },
};

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
 * QUIÉN MANDA CADA TIPO DE COMANDO.
 *
 * **Esta es la única capa que puede conocerlos a todos a la vez.** El runtime
 * vive en `lib/offline` y no puede importar una feature; `features/shell` no
 * importa a ninguna otra feature; y Personal y Grupos no se importan entre sí.
 * La raíz ensambla, y nada más: aquí no hay ninguna regla de negocio ni ninguna
 * interpretación de respuesta, que siguen viviendo en el módulo de cada
 * dominio.
 *
 * Fuera del componente porque es una constante: reconstruirlo en cada render
 * no cambiaría nada —el worker se crea una sola vez— pero invitaría a pensar
 * que sí.
 */
const COMMAND_HANDLERS: CommandHandlers = {
  ...personalCommandHandlers(sendPersonalEntry),
  ...groupCommandHandlers(sendGroupCreate),
};

/**
 * Mounts the offline queue's worker ONCE, tied to whoever is signed in.
 *
 * Same reasoning as `ScopeBinding`: the queue may not ask the session who the
 * actor is, so the composition root hands it the identity — and now also the
 * handler map. The worker is a process, not screen state: mounting it inside
 * the add sheet would kill it mid-request every time the sheet closed, which
 * is why it sits here, above the navigator, and nowhere else (F07/ADR-001 §12).
 *
 * Renders nothing of its own; it exists to run one hook inside the provider.
 */
function QueueBinding({ children }: { children: ReactNode }) {
  const { state } = useSession();
  useQueueRuntime(
    state.status === 'signed-in' ? state.identity.userId : '',
    state.status,
    COMMAND_HANDLERS,
  );
  return <>{children}</>;
}

/**
 * La identidad pública de la cuenta, resuelta una vez por sesión (F12/ADR-001
 * §7). Mismo motivo que `ScopeBinding` y `QueueBinding`: el proveedor no puede
 * preguntar a la sesión quién es el actor ni si es un invitado, así que la raíz
 * se lo pasa. Un invitado no pregunta y nunca ve el gate; una cuenta normal
 * reclama su reserva o cae en `required`, y `RootNavigator` decide la rama.
 */
function IdentityBinding({ children }: { children: ReactNode }) {
  const { state } = useSession();
  return (
    <AccountIdentityProvider
      actorId={state.status === 'signed-in' ? state.identity.userId : ''}
      isAnonymous={state.status === 'signed-in' && state.identity.isAnonymous}>
      {children}
    </AccountIdentityProvider>
  );
}

function RootNavigator() {
  const { state } = useSession();
  const { state: recovery } = useRecovery();
  const { state: identity, pending: identityPending } = useAccountIdentity();
  /*
   * Resuelto = la sesión contestó Y, si es una cuenta normal, su identidad
   * también. Mientras el ciclo pregunta al servidor si hay username, ni las
   * pestañas ni el gate se montan: enseñar uno y cambiarlo al otro sería
   * mentir sobre lo que esta cuenta es. Un invitado no espera nada.
   */
  const resolved = isResolved(state) && !identityPending;
  /*
   * Con la sesión resuelta, una cuenta normal está en las pestañas o en el
   * gate, y SOLO el servidor la manda al gate (USERNAME_REQUIRED). Sin red la
   * identidad queda `unavailable` y la cuenta entra igual: Nomey abre sin
   * conexión (F07/ADR-001), y el ciclo vuelve a preguntar al volver al primer
   * plano. Un invitado está siempre en las pestañas: el ciclo no le pregunta.
   */
  const gate = needsUsernameGate(identity);

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
   * Y el enlace de invitación (F09/ADR-004), con el mismo criterio: un solo
   * oyente, por encima de las ramas, que sólo deja el token esperando. Quién
   * lo usa —la hoja de «Únete»— y cuándo —con sesión— lo deciden las pestañas.
   */
  useInvitationLink();

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
      <ThemeProvider value={NAVIGATION_THEME}>
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

          {/*
           * EL GATE DE USERNAME (F12/ADR-001 §7): una cuenta normal sin username
           * definitivo no llega a las pestañas. Navegación, no seguridad —el
           * servidor rehúsa por su cuenta lo que exige un username—, y sin
           * «Saltar»: la única salida es elegir uno, y entonces la guarda de
           * abajo se abre sola. Un invitado nunca entra aquí.
           */}
          <Stack.Protected guard={isSignedIn(state) && !recovering && gate}>
            <Stack.Screen name="username-gate" />
          </Stack.Protected>

          <Stack.Protected guard={isSignedIn(state) && !recovering && !gate}>
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
            {/*
             * El selector del `+` de Grupos, con la MISMA presentación que las
             * otras tres: sin `contentStyle` transparente se vería un rectángulo
             * negro detrás en vez de Grupos desenfocado.
             */}
            <Stack.Screen
              name="group-action"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
             * La ventana de crear grupo, apilada SOBRE el selector.
             *
             * Misma presentación que las demás: transparente, con fundido y sin
             * fondo propio. Se apila en vez de reemplazar porque cerrarla tiene
             * que devolver al selector para poder escoger la otra opción.
             */}
            <Stack.Screen
              name="create-group"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
             * Modificar un grupo: la MISMA ventana que crearlo, en modo edición,
             * apilada sobre el interior del grupo o sobre la lista.
             */}
            <Stack.Screen
              name="edit-group"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/* Compartir un grupo: la misma ventana, con el QR y la hoja del sistema. */}
            <Stack.Screen
              name="share-group"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
             * Dentro de un grupo. Una pantalla apilada corriente, con la identidad
             * definitiva del ámbito en la ruta: la misma antes y después de que el
             * servidor lo confirme, así que el enlace nunca se rompe.
             *
             * **Con fundido, y por la cabecera.** Entre Inicio y Grupos la barra
             * principal no se mueve, porque vive por encima de las pestañas; el
             * grupo es otra pantalla del Stack y pinta la MISMA barra, en el mismo
             * sitio y con el mismo punto (los dos leen el mismo estado de avisos).
             * Con el deslizamiento por defecto la barra entraba y salía con la
             * pantalla; con el fundido, dos barras idénticas se cruzan píxel a
             * píxel y lo que se ve es una barra quieta mientras el contenido se
             * funde —la misma familia de transición que las ventanas de la app—.
             *
             * **Al volver, igual, también con el gesto.** `animation` decide la
             * entrada y la vuelta por la flecha (react-native-screens anima el
             * pop con la animación de la pantalla que se va), pero en iOS el
             * DESLIZAMIENTO de retroceso usa la transición nativa del sistema
             * —el deslizamiento— salvo que se le diga que use la misma
             * (`animationMatchesGesture`, el `customAnimationOnSwipe` de
             * react-native-screens). Medido en el iPhone (2026-09-14): la barra
             * se quedaba quieta al entrar y se desplazaba al volver. Con esto
             * el gesto funde igual que la flecha; el gesto sigue existiendo.
             */}
            <Stack.Screen
              name="group/[id]"
              options={{
                animation: 'fade',
                animationDuration: Motion.screen.duration,
                animationMatchesGesture: true,
              }}
            />
            {/*
             * Añadir un gasto compartido. La MISMA presentación que el alta de
             * Personal —transparente, con fundido y sin fondo propio—, porque es
             * la misma ventana: lo que cambia es lo que lleva dentro.
             */}
            <Stack.Screen
              name="group-expense"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="notifications" />
            {/* Las propuestas de transferencia (F12/ADR-002 §9): una pantalla plana, como la campana. */}
            <Stack.Screen name="transfers" />
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
      </ThemeProvider>
    </AddBackdropProvider>
  );
}
