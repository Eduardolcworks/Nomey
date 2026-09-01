import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Glass, Motion, Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

import { DESTINATIONS, type Destination, destinationFor } from './destinations';
import { useAddBackdrop } from './add-backdrop';
import { DOCK } from './dock';
import { SCOPE_LABEL, useScope } from './scope-context';
import { SPRING, usePressScale } from './shell-motion';

/**
 * Two independent controls and one action, floating over the content.
 *
 * **There is no bar.** The container positions things and reserves the safe
 * area; it paints nothing. Inicio and Grupos are two separate pills, each with
 * its own surface, radius, depth and states, because they are two separate
 * places - a single capsule split into halves reads as one object with two
 * regions, which is the wrong model for two root destinations.
 *
 * **The action sits fully above them, with a real gap.** With two destinations
 * the space between them falls dead centre, exactly where a centred button
 * wants to be, so any overlap would put the action on the seam and a thumb
 * aiming for it would keep landing on a destination.
 *
 * **The brand yellow appears exactly once on screen, and it is that button.**
 * Selection is carried by the surface instead - a lifted glass pill with a
 * stronger edge against a recessed, quieter one - and reinforced by the
 * content's opacity and the icon's scale. If the accent did both jobs the
 * action would look permanently selected and the selected destination would
 * lose its signal.
 *
 * **Motion is shared with the scope switch, not invented here.** Both take
 * their spring from `Motion` and their touch response from `usePressScale`,
 * which is what makes the dock and the control above it read as one system.
 */
/**
 * El dock, ya sin el navegador de por medio.
 *
 * **Recibe la ruta activa y avisa de la elegida; no guarda ninguna.** La única
 * fuente de verdad de la navegación sigue siendo el router — quien lo aloja lee
 * la ruta y llama a `navigate`—, y este componente no tiene estado propio que
 * pueda contradecirla.
 *
 * Antes recibía `BottomTabBarProps` y lo pintaba el propio navegador. Ahora lo
 * monta `app/(tabs)/_layout.tsx` como superposición, y esa estructura es la que
 * da la geometría actual: el navegador no pinta barra ni reserva alto, la
 * escena ocupa la pantalla entera y el contenido pasa por detrás del dock. Se
 * llegó a ella persiguiendo un desenfoque que se ha descartado, pero **se queda
 * por lo que hace ahora**, que es colocar la pieza donde está.
 */
export function NomeyDock({
  activeRoute,
  onSelect,
}: {
  /** El nombre de la ruta activa, tal cual lo da el router. */
  activeRoute: string;
  onSelect: (route: Destination['route']) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.dock, { paddingBottom: insets.bottom + DOCK.edge }]}
      pointerEvents="box-none">
      <AddButton activeRoute={activeRoute} />

      <View style={styles.destinations} pointerEvents="box-none">
        {DESTINATIONS.map((destination) => (
          <DestinationButton
            key={destination.route}
            destination={destination}
            focused={destination.route === activeRoute}
            onPress={() => {
              onSelect(destination.route);
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One destination, as its own object.
 *
 * Selected and unselected differ by surface, not only by text: the selected
 * pill is lifted and edged brighter, the unselected one is recessed into a
 * well and edged with the quiet rim. Opacity and scale then reinforce what the
 * depth already said - which is the rule that keeps the state readable for
 * anyone who cannot see the depth.
 *
 * MOTION. Four things move off one spring, so they arrive together:
 *
 *   the pill lifts 2pt        the icon grows to 1.06
 *   the content brightens     the selected rim and shading fade in
 *
 * **The selection emphasis is a separate layer, cross-faded.** `boxShadow`
 * arrays cannot be interpolated, so swapping `depth` would snap however slow
 * the rest of the transition was. Stacking a second surface and animating its
 * opacity is the only way the depth change can actually travel.
 *
 * **That layer is a plain view and not a second `GlassSurface`**, for two
 * reasons that both matter. On iOS 26 two stacked `GlassView`s would blur the
 * backdrop twice, and the selected pill would sit permanently double-blurred -
 * a change to the resting design, not to the transition. And a nearly opaque
 * tint fading in would cover the native glass instead of lifting it. So the
 * layer adds light rather than replacing material: a faint white veil, a
 * brighter rim, and the selected shading.
 *
 * **The tint's own alpha is never animated.** The base surface stays fully
 * opaque underneath at all times, so the effective backdrop behind the label
 * can only get more opaque during the cross-fade, never less. Fading a
 * translucent tint directly would dip it below `MinGlassTintAlpha` mid-flight
 * and drop text contrast for about a tenth of a second - invisible in a
 * screenshot, and exactly the kind of thing the accessibility rule is for.
 *
 * The unselected content rests at 0.62 rather than being recoloured, because
 * a colour swap cannot be animated and an opacity can. It still measures well
 * past AA on the pill, and it is never the only signal: depth, scale and
 * `accessibilityState` all carry the same fact.
 */
function DestinationButton({
  destination,
  focused,
  onPress,
}: {
  destination: Destination;
  focused: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const label = t(destination.label);

  const press = usePressScale();
  /** 0 unselected, 1 selected, and every value between is the transition. */
  const active = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    active.value = withSpring(focused ? 1 : 0, SPRING);
  }, [focused, active]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -Motion.destination.lift * active.value },
      { scale: press.scale.value },
    ],
  }));

  const emphasisStyle = useAnimatedStyle(() => ({ opacity: active.value }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: Motion.destination.restOpacity + (1 - Motion.destination.restOpacity) * active.value,
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (Motion.destination.iconScale - 1) * active.value }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      {...press.handlers}
      style={styles.destination}>
      {({ pressed }) => (
        <Animated.View style={[styles.frame, pillStyle]}>
          <GlassSurface
            level="bar"
            depth={pressed ? 'pressed' : 'well'}
            radius={Radius.full}
            /*
             * **La píldora no lleva desenfoque, y es una decisión cerrada.** El
             * cristal de `level="bar"` es lo que la separa del fondo: tinte,
             * borde, brillo superior y profundidad, todo pintado con estilos
             * corrientes y sin depender de nada nativo.
             *
             * Se intentó que emborronara el contenido que pasa por debajo, con
             * el efecto dentro de la superficie y después en una capa aparte
             * medida contra las píldoras. Ninguna de las dos llegó a
             * desenfocar sobre el aparato, y el desenfoque se ha retirado
             * entero en vez de dejar el andamio puesto. El de «Añadir
             * movimiento» es otra cosa y sigue como está.
             */
            /* Acción del dock, no su contenedor: mismo relieve que los demás
             * controles. El fondo del dock es una vista corriente y no pasa
             * por aquí. */
            nativeEffect={false}
            style={styles.pill}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.emphasis,
                {
                  borderColor: Glass.regular.highlight,
                  boxShadow: Tactile.selected,
                },
                emphasisStyle,
              ]}
            />
            <Animated.View style={[styles.content, contentStyle]}>
              <Animated.View style={iconStyle}>
                <Icon name={destination.symbol} size={20} colour={theme.text} />
              </Animated.View>
              <ThemedText variant="label" themeColor="text">
                {label}
              </ThemedText>
            </Animated.View>
          </GlassSurface>
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * The action, in the same material as the controls beside it.
 *
 * Yellow glass rather than a flat yellow disc: `Glass.action` is the brand
 * colour at 0.90, which measured 10:1 for near-black on it against a black
 * backdrop and 13:1 against a white one, so it keeps every bit of its
 * legibility while belonging to the same surface family as the pills. A flat
 * circle looked like an object borrowed from another design system.
 *
 * It carries the meaning "add something to where I am": on Inicio the active
 * scope, on Grupos a group. The sheet it opens restates which, rather than
 * trusting the user to remember the switch at the top of the screen.
 */
function AddButton({ activeRoute }: { activeRoute: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { scope } = useScope();
  const backdrop = useAddBackdrop();

  const destination = destinationFor(activeRoute);
  const label =
    destination === 'groups'
      ? t('action.addToGroups')
      : t('action.addTo', { scope: t(SCOPE_LABEL[scope]) });

  /*
   * The press, and deliberately NOTHING else.
   *
   * It takes the same touch response as the pills beside it, which is what
   * keeps the dock reading as one object rather than as an animated control
   * next to a static one. But it does not react to the destination changing:
   * the action is not part of the selection story, and anything that moved it
   * in sympathy would make it look like a third tab.
   */
  const press = usePressScale();
  const addStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.scale.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      /*
       * El fondo se enciende ANTES de navegar, no después: así el desenfoque ya
       * está puesto cuando la ventana empieza a subir, y no se ve un fotograma
       * de Inicio nítido detrás de ella.
       */
      onPress={() => {
        backdrop.show();
        router.push({ pathname: '/add', params: { from: destination } });
      }}
      {...press.handlers}
      style={styles.add}>
      {({ pressed }) => (
        <Animated.View style={addStyle}>
          <GlassSurface
            level="action"
            depth={pressed ? 'pressed' : 'flat'}
            radius={Radius.full}
            /* La acción principal. Un control, y el más pulsado de la app. */
            nativeEffect={false}
            style={styles.addSurface}>
            {/*
             * The glyph carries the brand colour now that the body does not.
             * It is the brightest thing in the dock, which is what keeps this
             * an action rather than a third destination.
             */}
            <Icon name="plus" size={28} colour={theme.accent} />
          </GlassSurface>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * EL DOCK FLOTA. No ocupa sitio en la columna del navegador.
   *
   * El navegador de pestañas coloca en columna: el contenedor de las escenas
   * con `flex: 1` y, debajo, la barra. Sin sacarla del flujo, la pantalla
   * TERMINA donde empieza el dock. Posicionada en absoluto, sale de la columna,
   * el contenedor de escenas se queda con el alto entero y el contenido pasa
   * POR DETRÁS — nítido, que es la decisión tomada.
   *
   * **Esto separa dos cosas que estaban mezcladas.** El hueco por debajo del
   * contenido —para que la última tarjeta pueda subir por encima del dock y
   * verse entera— lo sigue poniendo cada pantalla con su `paddingBottom` de
   * `DOCK_HEIGHT + insets.bottom`. Eso es CLEARANCE de scroll. Lo que el dock
   * deja de hacer es reservar además el mismo espacio por su cuenta, que era
   * una segunda reserva encima de la primera.
   */
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: DOCK.gap,
  },
  destinations: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  destination: {
    borderRadius: Radius.full,
    minWidth: DOCK.destinationWidth,
  },
  /** Carries the lift and the press. The surface underneath stays put. */
  frame: {
    borderRadius: Radius.full,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: DOCK.bar,
    paddingHorizontal: Spacing.lg,
  },
  /**
   * The selected look, stacked over the resting one.
   *
   * Its own radius because `GlassSurface` does not clip its children, and a
   * white veil at 0.055 rather than a tint: it lifts the surface instead of
   * covering the material underneath it.
   */
  emphasis: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  add: {
    borderRadius: Radius.full,
  },
  addSurface: {
    width: DOCK.add,
    height: DOCK.add,
    // A full point rather than a hairline: on a 56pt disc a half-pixel rim is
    // not a rim, and the rim is most of what says "surface" instead of "fill".
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
