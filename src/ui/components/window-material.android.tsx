import { StyleSheet, View } from 'react-native';

import { WindowAndroid } from '@/ui/theme';

import type { WindowMaterialProps } from './window-material';

/**
 * EL MATERIAL DE UNA VENTANA EN ANDROID.
 *
 * Dos capas y nada más:
 *
 *   · **material** — un gris plano, el mismo en toda la superficie;
 *   · **rim** — un hilo de un píxel, uniforme, alrededor de los 360 grados.
 *
 * ==================== QUÉ PRODUCÍA LA FRANJA NEGRA ========================
 *
 * Dos capas, y las dos venían del token de profundidad del estado `selected`:
 *
 * - **la mitad INTERIOR** —`offsetY: −6, blur 11, negro 0,20`— oscurecía el
 *   interior de arriba abajo. Medido sobre la ventana anterior: 29 en el canto
 *   superior, 25 en el centro, 22 en el inferior. Eso era la franja;
 * - **la mitad EXTERIOR** —`offsetY: 1, blur 26, negro 0,16`— ponía además una
 *   sombra alrededor del panel.
 *
 * Aquí no queda ninguna de las dos: sin `boxShadow`, sin `inset`, sin
 * `elevation`, sin degradado, sin textura y sin desenfoque en el propio panel.
 * El velo de detrás no lo toca esta capa y sigue como estaba.
 *
 * **El rim es uniforme y completo, sin acento superior.** Los controles llevan
 * uno direccional porque tienen una dirección de luz que contar; una ventana
 * sólo tiene un límite que declarar, y un color por lado volvería a producir los
 * cortes que Android deja en las uniones.
 *
 * Las dos capas van en `absoluteFill` con el radio de la ventana: no ocupan
 * sitio, no cambian el reparto, no reciben toques y van antes del contenido.
 */
export function WindowMaterial({ radius }: WindowMaterialProps) {
  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.capa, { borderRadius: radius, backgroundColor: WindowAndroid.fill }]}
      />
      <View pointerEvents="none" style={[styles.capa, styles.rim, { borderRadius: radius }]} />
    </>
  );
}

const styles = StyleSheet.create({
  capa: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WindowAndroid.rim,
  },
});
