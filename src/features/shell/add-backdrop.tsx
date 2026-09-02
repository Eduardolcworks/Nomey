import { createContext, type RefObject, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Scrim } from '@/ui/components';

/**
 * EL FONDO DE «AÑADIR MOVIMIENTO», SEPARADO DE LA VENTANA.
 *
 * **Por qué existe.** El desenfoque necesita tener Inicio en su misma jerarquía
 * visual para poder emborronarlo. Dentro de la ruta `/add` no lo tiene: iOS
 * monta un `transparentModal` en un controlador aparte, así que un `BlurView`
 * allí desenfoca un fondo vacío y el resultado es negro. Se comprobó en el
 * dispositivo, y antes se descartó que fuera el servidor de desarrollo
 * caducado reiniciándolo limpio.
 *
 * **Por qué NO se mueve la ventana.** Se intentó, y rompió la composición: el
 * lienzo del panel es `flex: 1`, y como hermano de `<Tabs>` —que ya ocupa todo—
 * quedaba maquetado debajo, con la ventana caída y media pantalla de Inicio a
 * la vista. La ventana se queda donde está.
 *
 * Lo que se muda es **sólo el fondo**, y en absoluto: no participa en el
 * reparto de espacio, así que no puede mover ni encoger nada. Ésa es la
 * diferencia entera con el intento anterior.
 *
 * La señal es un booleano y significa una sola cosa: «hay que dibujar el fondo
 * de Añadir». **No es una copia del estado de navegación** — no sabe qué
 * pestaña está activa ni qué ruta hay encima, y nadie lo usa para decidir
 * ninguna de las dos cosas.
 */

type AddBackdropSignal = {
  readonly visible: boolean;
  readonly show: () => void;
  readonly hide: () => void;
};

const AddBackdropContext = createContext<AddBackdropSignal | null>(null);

export function AddBackdropProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  const show = useCallback(() => {
    setVisible(true);
  }, []);
  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const value = useMemo(() => ({ visible, show, hide }), [visible, show, hide]);

  return <AddBackdropContext.Provider value={value}>{children}</AddBackdropContext.Provider>;
}

/**
 * Fuera del proveedor devuelve un fondo inerte en vez de reventar.
 *
 * Quien lo consume son el botón que abre y la ventana que cierra, y ninguno de
 * los dos debería caerse porque alguien monte una pantalla suelta en un test o
 * en una historia: lo peor que pasa sin proveedor es que no haya desenfoque.
 */
const INERT: AddBackdropSignal = { visible: false, show: () => {}, hide: () => {} };

export function useAddBackdrop(): AddBackdropSignal {
  return useContext(AddBackdropContext) ?? INERT;
}

/**
 * El fondo en sí: desenfoque sobre lo que haya debajo, y nada de layout.
 *
 * **`StyleSheet.absoluteFill` y ni un `flex` a la vista.** Es la condición que
 * el intento anterior incumplió: un hermano de `<Tabs>` con `flex: 1` compite
 * por el espacio y desplaza la pantalla. Posicionado en absoluto se limita a
 * cubrir, y las pestañas miden exactamente lo mismo esté abierto o cerrado.
 *
 * **Captura los toques.** El `Scrim` de dentro no los recibe —es decoración—
 * pero esta vista sí, de modo que con la ventana abierta no se puede pulsar una
 * tarjeta de Inicio ni el dock que quedan debajo. La ventana está por encima,
 * en su propia ruta, así que sigue recibiendo los suyos con normalidad.
 */
/**
 * **APAGADO A PROPÓSITO, y de forma temporal.**
 *
 * Primero hay que comprobar en el aparato que `/add` deja ver Inicio SIN
 * desenfoque. Mientras la ruta se pintara negra ninguna capa de detrás podía
 * verse, y subir la intensidad sólo servía para confundir «oscurece» con
 * «desenfoca». Con la transparencia confirmada esto vuelve a `true`: el resto
 * del cableado —encender antes de navegar, apagar al desmontarse— ya está
 * puesto y no hay que rehacerlo.
 */
const BACKDROP_ENABLED = true;

export function AddBackdrop({ target }: { readonly target?: RefObject<View | null> }) {
  const { visible } = useAddBackdrop();

  if (!BACKDROP_ENABLED || !visible) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Scrim target={target} />
    </View>
  );
}
