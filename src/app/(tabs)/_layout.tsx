import { router, usePathname } from 'expo-router';
import { SceneStyleInterpolators, Tabs } from 'expo-router/tabs';
import { useRef, useState } from 'react';
import { Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGroupNotices, useOpenPendingInvitation } from '@/features/groups';
import { useIncidents } from '@/features/personal';
import { isSignedIn, useSession } from '@/features/session';
import {
  AddBackdrop,
  AppTopBar,
  BlurTarget,
  DESTINATIONS,
  NomeyDock,
  tabRouteFrom,
  useAddBackdrop,
} from '@/features/shell';
import { Motion } from '@/ui/theme';

/**
 * The two root destinations.
 *
 * The bar is entirely Nomey's - the default one cannot hold an action that is
 * not a tab, and the action is the point. Screens are declared from the same
 * array the bar renders from, so the two cannot disagree about what exists.
 *
 * MOTION. The screen moves with the dock, and does so through the navigator's
 * own options rather than around them.
 *
 * `animation: 'shift'` is a supported screen option of the bottom tabs
 * navigator: it already knows which way the change went, from the difference
 * in tab index, so the content leaves in the direction you came from with no
 * state of our own tracking it. **Nothing here reimplements navigation**, and
 * that was the condition for animating the screen at all - if it had needed a
 * gesture handler, a pager or a second source of truth about the active tab,
 * it would not have been worth having.
 *
 * The preset's own interpolator travels 50 points, which at this speed reads
 * as a page turn competing with the dock for attention. Passing a
 * `sceneStyleInterpolator` is also a supported option and overrides the
 * preset's, so the travel comes down to 16 and the transition becomes what it
 * should be: a short displacement confirming the change, not the change
 * itself. The opacity still runs to zero, because both scenes are stacked and
 * an outgoing screen that stays partly visible shows through the incoming one.
 */

/**
 * The built-in `shift`, with the travel brought down.
 *
 * Typed off the preset it replaces rather than by hand: the navigator does not
 * re-export the interpolator's type, and a hand-written approximation of an
 * `Animated` signature is a copy that goes stale silently. `progress` is -1,
 * 0 or 1 - which side the scene is on - and the sign is where the direction
 * comes from.
 */
const shiftScene: typeof SceneStyleInterpolators.forShift = ({ current }) => ({
  sceneStyle: {
    opacity: current.progress.interpolate({
      inputRange: [-1, 0, 1],
      outputRange: [0, 1, 0],
    }),
    transform: [
      {
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-Motion.screen.travel, 0, Motion.screen.travel],
        }),
      },
    ],
  },
});

export default function TabsLayout() {
  /*
   * The explicit Reduce Motion path for the screen.
   *
   * The dock's own motion is handled by the tokens - every spring and timing
   * declares `ReduceMotion.System`, so Reanimated lands them instantly. This
   * transition is not Reanimated's, it is the navigator's, so it has to be
   * turned off here. `'none'` still changes the screen; it just stops it
   * travelling to get there.
   */
  const reduceMotion = useReducedMotion();

  /*
   * LA PESTAÑA ACTIVA, Y POR QUÉ NO ES SIN MÁS LA RUTA.
   *
   * `usePathname` da `/` para Inicio y `/groups` para Grupos, pero también da
   * `/add`, `/group-action` o `/create-group` cuando hay una ventana encima:
   * son `transparentModal`, se apilan SOBRE la pestaña y no la cambian.
   * Traducirlas a un destino hacía que el dock se creyera en Inicio nada más
   * abrir una ventana desde Grupos.
   *
   * Así que `tabRouteFrom` devuelve `null` para ellas y aquí se conserva el
   * último destino REAL. **Sigue sin haber un `useState` de pestaña activa**:
   * no es una segunda fuente de verdad, es la misma memorizada, y una ruta de
   * pestaña siempre la reemplaza.
   */
  const pathname = usePathname();
  const tabRoute = tabRouteFrom(pathname);
  const [lastTab, setLastTab] = useState<'index' | 'groups'>('index');
  /*
   * Ajustar el estado DURANTE el render cuando la entrada cambia es el patrón
   * que React documenta para esto, y no un efecto: React reintenta este mismo
   * render con el valor nuevo antes de pintar nada, así que no hay un
   * fotograma con el destino viejo ni un segundo pase visible.
   */
  if (tabRoute !== null && tabRoute !== lastTab) setLastTab(tabRoute);
  const activeRoute = tabRoute ?? lastTab;

  /*
   * EL FONDO VA AQUÍ, Y LA VENTANA NO.
   *
   * Lo que necesita el desenfoque es tener Inicio en su misma jerarquía visual;
   * dentro de la ruta `/add` no lo tiene, porque iOS monta un
   * `transparentModal` en un controlador aparte. Así que se muda el fondo, y
   * SÓLO el fondo.
   *
   * **Con el fondo posicionado en absoluto.** Un intento
   * anterior envolvió esto en un `<View style={{ flex: 1 }}>` y colgó ahí la
   * ventana entera: como hermana con `flex`, competía por el espacio y dejaba
   * las pestañas empujadas y la ventana caída. Un fragmento no introduce caja, y
   * `AddBackdrop` no participa en el reparto: las pestañas miden exactamente lo
   * mismo con el fondo puesto que sin él.
   */
  const blurTarget = useRef<View | null>(null);
  const backdrop = useAddBackdrop();

  /*
   * ═══════════ LA CABECERA VIVE AQUÍ, FUERA DEL NAVEGADOR ═══════════
   *
   * Estaba dentro de cada pestaña —Inicio y Grupos la montaban por su cuenta,
   * la misma pieza dos veces— y por eso **viajaba con la transición**: el
   * navegador anima la escena entera con `shift`, y la barra era parte de la
   * escena. Al cambiar de pestaña, Nomey se deslizaba fuera y volvía a entrar
   * con el contenido de destino, cuando lo único que cambia de verdad es lo que
   * hay debajo.
   *
   * Aquí es hermana del navegador, por encima y en flujo normal: una columna
   * con la barra arriba y las pestañas ocupando el resto. **Ni absoluta ni
   * duplicada**: no es una segunda cabecera puesta encima de la que se anima
   * —las pestañas ya no montan ninguna—, y al ir en flujo la escena empieza
   * donde la barra acaba sin que nadie mida su altura.
   *
   * El área segura superior se consume AQUÍ y no en las pestañas, que pasan a
   * pedir sólo los laterales: si las dos la reservaran, el contenido bajaría
   * un inset entero por debajo de la barra.
   *
   * **La protección de sesión no se relaja.** Este layout sólo se monta bajo
   * `Stack.Protected guard={isSignedIn(state) && !recovering}` y nunca durante
   * la restauración —`RootNavigator` no monta rama alguna sin resolver—, así
   * que la cabecera privada hereda exactamente la misma puerta que tenían las
   * pestañas. La comprobación explícita de abajo es una segunda barrera, no la
   * primera: si esa protección cambiara algún día, esto seguiría sin pintar la
   * campana de una cuenta sobre una pantalla sin sesión.
   *
   * La campana lee las incidencias de la cola con el MISMO hook que usaban las
   * dos pestañas; ahora lo lee una vez en vez de dos.
   */
  const { state } = useSession();
  const actorId = state.status === 'signed-in' ? state.identity.userId : '';
  const incidents = useIncidents(actorId);
  /* Y los avisos de grupo (F09/ADR-003 §7): la campana suma las dos fuentes. */
  const notices = useGroupNotices(actorId);
  /* Una invitación llegada por enlace se retoma aquí, ya con sesión (F09/ADR-004). */
  useOpenPendingInvitation(isSignedIn(state));

  return (
    <>
      {/*
       * LO QUE HAY QUE DESENFOCAR, declarado.
       *
       * El metodo de Android no desenfoca «lo de detras» por composicion como
       * iOS: dibuja a partir de una vista concreta, y sin ella avisa y degrada a
       * `none` — un relleno semitransparente, no un desenfoque.
       *
       * Envuelve las pestañas Y el dock, que es exactamente lo que el fondo
       * cubre cuando se abre. **El fondo se queda fuera**: es hermano de esto,
       * no hijo, porque una vista no puede ser su propio objetivo.
       *
       * Fuera de Android `BlurTargetView` es un `View` corriente, asi que con
       * `flex: 1` la geometria es la misma que sin el.
       */}
      {/*
       * MIENTRAS HAY UNA VENTANA ENCIMA, ESTO NO EXISTE PARA UN LECTOR DE
       * PANTALLA.
       *
       * Un `transparentModal` se monta ENCIMA de este árbol, no en su lugar, así
       * que sin esto TalkBack seguía recorriendo las pestañas y el dock por
       * debajo de la ventana. Se llegaba al `+` trasero, que además anuncia la
       * etiqueta de Personal aunque la ventana abierta sea la de Grupos.
       *
       * La señal es la misma que enciende el desenfoque —ya vive en este árbol—
       * y por eso no hace falta un segundo estado que mantener en sincronía.
       * `accessibilityViewIsModal` cubre iOS desde la propia ventana; esto es
       * su mitad de Android, que no lo tiene.
       *
       * El envoltorio es `flex: 1` y no participa en nada más: la geometría es
       * la misma con él que sin él.
       */}
      <View
        style={styles.tree}
        importantForAccessibility={backdrop.visible ? 'no-hide-descendants' : 'auto'}>
        <BlurTarget target={blurTarget}>
          {isSignedIn(state) ? (
            <SafeAreaView edges={['top', 'left', 'right']}>
              {/*
               * EL PUNTO DICE «HAY ALGO QUE NO HAS VISTO», no «hay algo
               * pendiente»: incidencias no vistas en la campana o avisos de
               * grupo sin leer. Entrar en la campana lo apaga; resolver, no
               * hace falta (`incident-seen.ts`, `api.mark_group_notices_seen`).
               */}
              <AppTopBar alerts={incidents.unseen > 0 || notices.unread > 0} />
            </SafeAreaView>
          ) : null}

          <Tabs
            screenOptions={{
              headerShown: false,
              animation: reduceMotion ? 'none' : 'shift',
              sceneStyleInterpolator: shiftScene,
              transitionSpec: {
                animation: 'timing',
                config: {
                  duration: Motion.screen.duration,
                  easing: Easing.out(Easing.ease),
                },
              },
            }}
            /*
             * **El navegador NO pinta barra**, y por eso tampoco reserva alto para
             * ella: devolviendo `null` la columna se queda con el contenedor de
             * escenas y nada más, así que la escena ocupa la pantalla entera.
             *
             * El dock visible se monta abajo, fuera de `<Tabs>`. Hay UNA sola
             * implementación de sus píldoras y su `+`; lo que cambia es quién la
             * coloca.
             */
            tabBar={() => null}>
            {DESTINATIONS.map((destination) => (
              <Tabs.Screen key={destination.route} name={destination.route} />
            ))}
          </Tabs>

          {/*
           * EL DOCK, COMO SUPERPOSICIÓN ABSOLUTA.
           *
           * Vive aquí y no dentro del navegador, y **eso es lo que da la geometría
           * actual**: el navegador no pinta barra ni reserva alto, así que la escena
           * mide la pantalla entera y el contenido pasa nítido por detrás del dock.
           *
           * Se llegó a esta estructura persiguiendo un desenfoque bajo las píldoras
           * que se ha descartado. Se queda por lo que hace ahora —colocar la pieza
           * donde está— y no por aquello: devolverla al `tabBar` movería el dock.
           *
           * **Absoluto desde el primer momento.** Un intento anterior colgó aquí una
           * ventana con `flex: 1` y, al competir por el espacio, dejó las pestañas
           * empujadas y la pieza caída. El dock ya se posiciona en absoluto en su
           * propio estilo, así que no participa en el reparto y la escena mide lo
           * mismo con él que sin él.
           */}
          <NomeyDock
            activeRoute={activeRoute}
            onSelect={(route) => {
              router.navigate(route === 'index' ? '/' : '/groups');
            }}
          />
        </BlurTarget>
      </View>

      {/*
       * Y el fondo de «Añadir», DESPUÉS del dock: al abrirse lo cubre y lo
       * desenfoca con el resto de la pantalla, en vez de dejarlo nítido encima.
       */}
      <AddBackdrop target={blurTarget} />
    </>
  );
}

const styles = StyleSheet.create({
  /** Neutro a propósito: sólo existe para poder ocultar el árbol entero. */
  tree: { flex: 1 },
});
