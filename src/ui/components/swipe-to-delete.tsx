import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { Icon } from './icon';
import { DELETE_ACTION_SIZE, DELETE_ACTION_WIDTH, deleteActionOffset } from './swipe-geometry';
import { type PlatformSymbol, Radius, Symbols, useTheme } from '@/ui/theme';

/**
 * Una fila que descubre una acción destructiva al deslizarla hacia la
 * izquierda.
 *
 * **La lista se queda limpia mientras nadie interactúa.** Es la razón de que
 * esto sea un gesto y no un botón permanente: eliminar es poco frecuente, y un
 * icono rojo en cada fila lo anuncia todo el rato.
 *
 * **`ReanimatedSwipeable` de `react-native-gesture-handler`**, que ya está en
 * las dependencias — lo usa la navegación— y es la primitiva pensada
 * exactamente para esto. No se añade ninguna dependencia. La versión antigua
 * `Swipeable` también existe en el paquete y está desaconsejada por sus propios
 * autores; ésta corre en el hilo de UI a través de Reanimated, que es lo que la
 * hace fluida durante el scroll.
 *
 * **El gesto no compite con el scroll vertical.** El reconocedor sólo se activa
 * con desplazamiento horizontal, así que la lista sigue desplazándose igual y
 * un toque sigue siendo un toque. Tampoco alcanza a los gestos del sistema: no
 * se abre desde el borde ni sobrepasa su posición abierta.
 *
 * **El gesto NO elimina.** Descubre el control; eliminar exige pulsarlo, y
 * después confirmar. Un deslizamiento largo que borrara solo sería un accidente
 * esperando a ocurrir con dinero de por medio.
 *
 * **LA ACCIÓN VIAJA CON EL GESTO, y hay que moverla a mano.**
 * `ReanimatedSwipeable` coloca sus acciones en una capa `absoluteFill` con
 * `row-reverse` —pegadas al borde derecho de la fila y DEBAJO del contenido— y
 * no las traslada: entrega el desplazamiento a `renderRightActions` para que lo
 * haga quien la usa. Sin eso, el control está siempre ahí a ancho completo y el
 * primer milímetro de gesto lo descubre entero por detrás del texto.
 *
 * Trasladándolo por `drag + su ancho`, la tira se comporta como lo que es:
 * en reposo queda fuera del borde derecho —el contenedor de la librería ya
 * recorta—, entra en proporción a lo que se arrastra y en la posición abierta
 * queda pegado al canto del contenido. La aritmética vive en
 * `swipe-geometry.ts`, aparte y comprobable.
 *
 * **Y no es la única vía.** El gesto es invisible para un lector de pantalla,
 * así que quien lo use recibe la misma acción por otro camino: esta pieza no lo
 * resuelve —no sabe qué envuelve— pero lo exige de quien la usa, con
 * `accessibilityActions` sobre la fila.
 *
 * **SÓLO UNA FILA QUEDA ABIERTA A LA VEZ.** Abrir una cierra la anterior, esté
 * en la lista que esté: dos controles rojos descubiertos a la vez son dos
 * formas de tocar el que no era. La coordinación es un registro de módulo
 * —la abierta, y nada más— y no un contexto, porque no hay nada que
 * proveer: la fila que se abre avisa, y la que estaba abierta se cierra.
 *
 * **La acción no siempre es una papelera.** El icono llega como prop, con la
 * papelera por defecto; salir de un grupo descubre el mismo control rojo con
 * el símbolo de salida. El tratamiento —rojo, cuadrado, con confirmación
 * después— es el mismo, porque lo que lo justifica es el mismo: una acción
 * destructiva que no se ejecuta por deslizar.
 */
export type SwipeToDeleteProps = {
  /** El texto de la acción. Llega como prop: `ui/` no lee el catálogo. */
  readonly label: string;
  readonly onDelete: () => void;
  /**
   * Sin esto, la fila se comporta como si esta pieza no existiera.
   *
   * Es lo que deja fuera a las filas que no se pueden eliminar: no se envuelve
   * en un gesto que no lleva a ninguna parte.
   */
  readonly enabled: boolean;
  /** Mientras se está eliminando, el control no vuelve a dispararse. */
  readonly busy?: boolean;
  /** El símbolo del control. La papelera si no se dice otra cosa. */
  readonly icon?: PlatformSymbol;
  readonly children: React.ReactNode;
};

/**
 * LA FILA ABIERTA, si hay alguna. Un registro de módulo: la que se abre se
 * anota y cierra a la anterior; la que se cierra o se desmonta se borra si
 * era ella. Nunca hay dos.
 */
let openSwipeable: SwipeableMethods | null = null;

function noteOpen(next: SwipeableMethods): void {
  if (openSwipeable !== null && openSwipeable !== next) openSwipeable.close();
  openSwipeable = next;
}

function noteClosed(one: SwipeableMethods): void {
  if (openSwipeable === one) openSwipeable = null;
}

export function SwipeToDelete({
  label,
  onDelete,
  enabled,
  busy,
  icon = Symbols.delete,
  children,
}: SwipeToDeleteProps) {
  const swipeable = useRef<SwipeableMethods>(null);

  // Al desmontarse abierta —la fila desaparece tras eliminarla, o la lista se
  // rehace— deja de ser «la abierta»: si no, cerraría a un fantasma.
  useEffect(
    () => () => {
      if (swipeable.current !== null) noteClosed(swipeable.current);
    },
    [],
  );

  if (!enabled) return <>{children}</>;

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      // Un poco de resistencia y un umbral corto: se descubre con intención,
      // y no por rozar la pantalla al desplazarse.
      friction={2}
      rightThreshold={40}
      // Sin rebasar la posición abierta: el control queda del tamaño que es, y
      // el gesto no se acerca al borde de la pantalla.
      overshootRight={false}
      onSwipeableWillOpen={() => {
        if (swipeable.current !== null) noteOpen(swipeable.current);
      }}
      onSwipeableClose={() => {
        if (swipeable.current !== null) noteClosed(swipeable.current);
      }}
      renderRightActions={(_progress, drag) => (
        <DeleteAction
          drag={drag}
          label={label}
          icon={icon}
          busy={busy}
          onPress={() => {
            // Se cierra ANTES de avisar. Si no, la fila se queda abierta
            // detrás del diálogo y sigue abierta al cancelar.
            swipeable.current?.close();
            onDelete();
          }}
        />
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

/**
 * El control, colocado por el desplazamiento del gesto.
 *
 * Es un componente y no JSX suelto porque `useAnimatedStyle` es un hook: dentro
 * de `renderRightActions` no podría llamarse.
 */
function DeleteAction({
  drag,
  label,
  icon,
  busy,
  onPress,
}: {
  readonly drag: SharedValue<number>;
  readonly label: string;
  readonly icon: PlatformSymbol;
  readonly busy?: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();

  const slot = useAnimatedStyle(() => ({
    transform: [{ translateX: deleteActionOffset(drag.value, DELETE_ACTION_WIDTH) }],
  }));

  return (
    /*
     * CADA CAPA DECLARA SU TAMAÑO, y ninguna lo deduce de la de abajo.
     *
     * Aquí la superficie roja se dimensionaba con `flex: 1` dentro de un
     * `Pressable` de alto automático, y eso NO ocupa el alto: `flex: 1` fija
     * `flexBasis: 0`, así que sin un alto definido arriba resuelve a cero y no
     * se pinta nada — ni el rojo ni la papelera. El hueco seguía apareciendo
     * porque el recorrido no depende de esto.
     *
     * El alto viene de la capa de acciones de la librería, que es `absoluteFill`
     * sobre la fila y por tanto sí lo tiene definido. De ahí baja por `'100%'`
     * hasta el `Pressable`, que es lo que se puede tocar; el botón lleva su
     * propio lado y se centra dentro.
     */
    <Animated.View style={[styles.wrapper, slot]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={busy === true}
        onPress={onPress}
        style={styles.slot}>
        {({ pressed }) => (
          /*
           * LO PULSABLE ES EL HUECO ENTERO; LO PINTADO, un escalón menos.
           *
           * El `Pressable` mide el hueco entero y el alto de la fila, así que
           * se puede tocar hasta el canto. El botón es cuadrado y de tamaño
           * fijo, centrado en ese hueco: al desplegar la operación la fila
           * crece con su detalle, y un botón que se estirara con ella se
           * volvería una columna roja.
           */
          <View
            style={[
              styles.surface,
              { backgroundColor: theme.negative, opacity: pressed || busy === true ? 0.7 : 1 },
            ]}>
            <Icon name={icon} size={20} colour={theme.background} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * EL ENVOLTORIO QUE SE TRASLADA, con su tamaño declarado.
   *
   * Sin el alto, la cadena se rompe aquí: la capa de acciones de la librería sí
   * lo tiene —es `absoluteFill` sobre la fila—, pero no baja solo a lo que hay
   * dentro de un hijo sin medida.
   */
  wrapper: {
    width: DELETE_ACTION_WIDTH,
    height: '100%',
  },
  /**
   * EL HUECO PULSABLE. El mismo número que decide dónde ancla la acción, así
   * que lo que se recorre y lo que se puede tocar miden igual.
   *
   * Sin márgenes: un margen a un solo lado es la franja vacía que hubo aquí.
   */
  slot: {
    width: DELETE_ACTION_WIDTH,
    height: '100%',
    // Centra el botón en el hueco: dos puntos de aire a cada lado, y en medio
    // de lo alto que sea la fila — desplegada incluida.
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * EL BOTÓN ROJO, cuadrado y de tamaño declarado.
   *
   * **Ni `flex` ni anclajes.** Lo primero fija `flexBasis: 0` y en un padre de
   * alto automático resuelve a cero —por eso no se pintaba nada—; lo segundo lo
   * ataba al alto de la fila y lo estiraba al desplegarla. Un lado explícito no
   * depende de nadie y no cambia con lo que tenga alrededor.
   */
  surface: {
    width: DELETE_ACTION_SIZE,
    height: DELETE_ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
});
