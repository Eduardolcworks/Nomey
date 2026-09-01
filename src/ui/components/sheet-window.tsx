import { useEffect, useState } from 'react';
import {
  Keyboard,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassSurface } from './glass-surface';
import { IconButton } from './icon-button';
import { ThemedText } from './themed-text';
import { SLIDE_IN, timing } from '@/ui/theme/motion-runtime';
import { Motion, Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * La ventana flotante que usan las acciones de Nomey.
 *
 * **Una sola implementación.** La abrió «Añadir movimiento» y la usan también
 * «Editar movimiento» y «Editar disponible»; lo único que cambia entre ellas es
 * el título y lo que va dentro. Duplicar este armazón habría duplicado su
 * geometría, su animación y su desplazamiento por teclado, que están aprobados
 * y medidos — y las copias se separan al primer retoque.
 *
 * **Se presenta transparente y se recorta ella misma.** La ruta que la aloja
 * declara `transparentModal`, así que lo que ocupa la pantalla no es la ventana
 * sino un lienzo vacío: el fondo desenfocado pinta lo que queda detrás y la
 * ventana se separa de los bordes por un margen. Con la presentación `modal`
 * normal no sería posible — la tarjeta del sistema llega hasta los cantos.
 *
 * **El velo es táctil y cierra.** Tocar fuera de una ventana modal la cierra en
 * las dos plataformas; no hacerlo obligaría a apuntar a la `X` para salir de
 * una pantalla que no ha hecho nada todavía.
 *
 * **Los hijos reciben `close`.** Cerrar no es deshacer la ruta: primero baja la
 * hoja y luego se deshace, así que quien termina su trabajo dentro tiene que
 * poder pedir esa salida completa en vez de navegar por su cuenta.
 */
export type SheetWindowProps = {
  readonly title: string;
  readonly closeLabel: string;
  /** Se llama cuando la hoja ya ha bajado del todo. Normalmente `router.back`. */
  readonly onClosed: () => void;
  readonly children: (close: () => void) => React.ReactNode;
};

export function SheetWindow({ title, closeLabel, onClosed, children }: SheetWindowProps) {
  const theme = useTheme();

  /*
   * EL TAMAÑO DE LA VENTANA, calculado y no dejado a los contenedores.
   *
   * **La altura la pone el CONTENIDO; el ancho no se mueve.** `referenceHeight`
   * es el hueco entre las áreas seguras menos un 5 % de la pantalla por arriba y
   * por abajo, y se conserva por DOS razones, ninguna decorativa: de ella sale
   * el ancho —que está aprobado y no debe moverse ni un punto— y sirve de tope
   * para que la ventana no se pase del área segura en una pantalla pequeña.
   *
   * **Y se centra en el VIEWPORT, no dentro de una pila de contenedores.** Las
   * áreas seguras de un iPhone no son simétricas —la del notch casi dobla a la
   * del indicador—, así que una caja con `flex` y márgenes acababa descentrada
   * respecto a la pantalla aunque estuviera centrada respecto a su caja.
   *
   * El tope del ancho es una salvaguarda para proporciones que no son de
   * teléfono: en una pantalla ancha, la altura por la proporción daría un ancho
   * mayor que la propia pantalla.
   */
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const referenceHeight = height - insets.top - insets.bottom - height * 0.1;
  const panelWidth = Math.min(referenceHeight * (width / height), width - width * 0.06);
  const size = { width: panelWidth, maxHeight: referenceHeight };

  /*
   * El alto REAL de la ventana, medido. No se calcula: desde que la altura la
   * pone el contenido, este componente no la sabe — y el desplazamiento por
   * teclado necesita saber dónde cae su borde inferior.
   */
  const [panelHeight, setPanelHeight] = useState(0);
  const onPanelLayout = (event: LayoutChangeEvent) => {
    setPanelHeight(event.nativeEvent.layout.height);
  };

  const { panel, close } = usePanelMotion({
    screenHeight: height,
    panelHeight,
    safeTop: insets.top,
    done: onClosed,
  });

  return (
    <View style={styles.canvas}>
      {/*
       * SIN FONDO PROPIO, y a propósito. Aquí hubo un velo con desenfoque y no
       * servía: iOS monta un `transparentModal` en un controlador aparte, de
       * modo que un `BlurView` puesto en esta capa no tiene la pantalla de
       * debajo en su jerarquía y emborrona un fondo vacío — se veía negro. El
       * fondo se dibuja en el árbol de las pestañas, que sí la tiene.
       */}
      {/*
       * EL VELO QUE CIERRA AL TOCAR FUERA, y el contrato de capas entero.
       *
       * Ocupa la pantalla ENTERA, panel incluido, así que quién se queda cada
       * toque lo decide el orden de capas y nada más:
       *
       *   velo    — cubre todo, capa de fondo
       *   `centre` — `zIndex: 1`, y por dentro `box-none`
       *
       * De ahí salen las dos mitades de la regla. El panel y todo lo que lleve
       * dentro se prueban ANTES que el velo, así que un toque dentro de la
       * ventana nunca lo ve el velo; y `box-none` hace que la capa de arriba no
       * se quede con lo que cae fuera del panel, que sigue bajando hasta el velo
       * y cierra.
       *
       * **El `zIndex` está DECLARADO a propósito.** El orden de escritura ya
       * daba el mismo resultado, pero dejaba el contrato dependiendo de qué
       * hermano se escribe primero: reordenarlos en un retoque habría puesto el
       * velo por encima del panel sin cambiar una sola línea de aspecto y sin
       * que ninguna prueba lo notara.
       *
       * **Lo que se ve NO cambia**: el velo no pinta nada —el desenfoque lo pone
       * el árbol de las pestañas—, así que esta capa es puramente táctil.
       */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={close}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.centre} pointerEvents="box-none">
        <Animated.View
          entering={SLIDE_IN}
          onLayout={onPanelLayout}
          /*
           * **Sin manejador de respondedor.** Quién se queda cada toque lo
           * decide el `zIndex` de la capa de arriba, no una guarda aquí: un
           * manejador de respondedor en un ANTECESOR de un `TextInput` puede
           * quedarse con el toque antes de que el campo llegue a enfocarse.
           */
          style={[styles.window, size, panel]}>
          <GlassSurface
            level="heavy"
            depth="selected"
            rim="soft"
            radius={Radius.xl}
            style={styles.pane}>
            {/*
             * TRES CELDAS, y la de la izquierda está vacía a propósito.
             *
             * El título tiene que quedar centrado en la ventana, no en el hueco
             * que sobra a la izquierda del icono — que es donde lo dejaría una
             * fila de dos con el texto centrado, medio botón a la izquierda del
             * centro real: lo bastante poco para no verse mal y lo bastante
             * para no verse bien.
             */}
            <View style={styles.header}>
              <View style={styles.gutter} />
              <ThemedText variant="label" themeColor="textSecondary" style={styles.title}>
                {title}
              </ThemedText>
              <IconButton
                name="xmark"
                label={closeLabel}
                size={17}
                colour={theme.textSecondary}
                onPress={close}
              />
            </View>

            {/*
             * UN `Pressable`, NO UN `ScrollView`, y no es lo mismo que quitarle el
             * scroll a uno.
             *
             * El `ScrollView` que hubo aquí venía de cuando la ventana no tenía
             * altura propia y el contenido podía no caber. Ahora el panel mide
             * lo que mide, así que la superficie desplazable no protegía de
             * nada: sólo dejaba arrastrar una pantalla fija, que se lee como
             * que algo se ha roto.
             *
             * Lo que sí hacía falta conservar es lo que aportaba su
             * `keyboardShouldPersistTaps="handled"`: tocar fuera de un campo
             * cierra el teclado. Sin eso la pantalla se queda encallada — el
             * campo de importe usa teclado numérico, que no trae tecla de
             * retorno. Este `Pressable` sólo se dispara cuando el toque no lo
             * consume un hijo, que es exactamente la misma regla.
             */}
            <Pressable style={styles.body} onPress={Keyboard.dismiss} accessible={false}>
              {children(close)}
            </Pressable>
          </GlassSurface>
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * EL MOVIMIENTO DE LA VENTANA, que son dos cosas distintas sumadas.
 *
 * **La ruta se anima con un `fade` y la ventana se mueve por su cuenta**, y
 * separarlo es lo que hace que se vea bien: con `slide_from_bottom` en la ruta
 * subiría también el velo, y durante la transición se vería su canto cruzando
 * la pantalla con media pantalla de Inicio sin atenuar.
 *
 * **Dos desplazamientos, dos valores, y por eso se suman en vez de pisarse.**
 * `fall` es el cierre —baja la hoja antes de deshacer la ruta—; `lift` es el
 * teclado. Con un solo valor, abrir el teclado y cerrar a la vez dejaría uno de
 * los dos a medias; separados, la posición es siempre la suma de ambos y
 * **volver a cero es volver exactamente a la base**, sin acumular nada por
 * muchas veces que se abra y se cierre.
 *
 * **La entrada es declarativa y la salida imperativa.** Entrar no necesita
 * saber nada: `SLIDE_IN` lo resuelve al montar. Salir sí, porque hay que
 * esperar a que la hoja llegue abajo antes de deshacer la ruta — al revés no
 * habría nada que animar, la pantalla ya estaría desmontada.
 *
 * Cada valor tiene **un solo punto de escritura**, declarado antes del hook que
 * lo lee. No es estilo: es lo único que `react-hooks/immutability` admite.
 */
function usePanelMotion({
  screenHeight,
  panelHeight,
  safeTop,
  done,
}: {
  screenHeight: number;
  panelHeight: number;
  safeTop: number;
  done: () => void;
}) {
  const fall = useSharedValue(0);
  const lift = useSharedValue(0);

  const close = () => {
    fall.value = withTiming(screenHeight, timing(Motion.screen.duration), (finished) => {
      if (finished) runOnJS(done)();
    });
  };

  useEffect(() => {
    /*
     * `WillShow` en iOS y `DidShow` en Android, que es donde cada sistema entrega
     * la geometría: iOS avisa antes de animar —así la ventana sube A LA VEZ que
     * el teclado en vez de detrás— y Android sólo la tiene ya abierto.
     */
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      /*
       * CUÁNTO SUBIR, de la geometría real y de nada más.
       *
       * El teclado dice su altura; la ventana, la suya, medida. De ahí sale
       * dónde cae su borde inferior y cuánto lo tapa el teclado. No hay tablas
       * por modelo ni márgenes inventados: si el teclado cambia de tamaño
       * —emoji, predictivo, un idioma con otra fila—, el número cambia solo.
       *
       * Y se limita a lo que hay por arriba: subir más metería el encabezado
       * bajo el notch, que es peor que dejar tapado un botón que no hace falta
       * mientras se escribe.
       */
      const keyboardTop = screenHeight - event.endCoordinates.height;
      const panelTop = (screenHeight - panelHeight) / 2;
      const needed = panelTop + panelHeight + Spacing.md - keyboardTop;
      const room = panelTop - safeTop;

      lift.value = withTiming(-Math.max(0, Math.min(needed, room)), timing(Motion.screen.duration));
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      // Exactamente cero, no una resta: es lo que garantiza que la base sea la
      // base por muchas veces que se abra y se cierre.
      lift.value = withTiming(0, timing(Motion.screen.duration));
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift, screenHeight, panelHeight, safeTop]);

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: fall.value + lift.value }],
  }));

  return { panel, close };
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
  },
  /** Centra la ventana en el lienzo, que ocupa la pantalla entera. */
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // POR ENCIMA DEL VELO, declarado. No pinta nada ni desplaza nada: sólo fija
    // que el panel se pruebe antes que el velo pase lo que pase con el orden en
    // que se escriban los hermanos.
    zIndex: 1,
  },
  window: {
    // Ancho y alto los pone `size`: se calculan sobre la pantalla, y ninguno
    // sale de un `flex` — que es lo que hacía que la posición dependiera de los
    // insets de los contenedores de encima.
  },
  pane: {
    // Sin `flex: 1`: la pieza mide lo que mide su contenido, que es lo que la
    // deja compacta y lo que sube `Guardar` en vez de empujarlo al canto.
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  /** El mismo ancho que el icono de cerrar, para que el título quede centrado. */
  gutter: {
    width: 44,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  body: {
    // Menos que el `lg` anterior: con la ventana ya estrecha, 24 puntos por lado
    // dejaban el contenido en una columna dentro de la pieza.
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.lg,
  },
});
