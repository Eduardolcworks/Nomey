import { router, usePathname } from 'expo-router';
import { SceneStyleInterpolators, Tabs } from 'expo-router/tabs';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { AddBackdrop, DESTINATIONS, NomeyDock } from '@/features/shell';
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
   * La pestaña activa, derivada de la RUTA y de nada más. `usePathname` da `/`
   * para Inicio y `/groups` para Grupos; se traduce al nombre de fichero que
   * usan las constantes de destino, que es la identidad que ya manejaban.
   *
   * No hay ningún `useState` de pestaña activa: eso sería una segunda fuente de
   * verdad de la navegación, y podría contradecir a la ruta.
   */
  const pathname = usePathname();
  const activeRoute = pathname.startsWith('/groups') ? 'groups' : 'index';

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
  return (
    <>
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

      {/*
       * Y el fondo de «Añadir», DESPUÉS del dock: al abrirse lo cubre y lo
       * desenfoca con el resto de la pantalla, en vez de dejarlo nítido encima.
       */}
      <AddBackdrop />
    </>
  );
}
