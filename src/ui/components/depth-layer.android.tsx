import { StyleSheet, View } from 'react-native';

import { castShadow } from '@/ui/theme';

import type { DepthLayerProps } from './depth-layer';

/**
 * LA PROYECCION EXTERIOR DE UN CONTROL, SOLA EN SU VISTA.
 *
 * **Que problema resuelve.** Android no funde las capas de un `boxShadow`:
 * dibuja cada entrada como una silueta propia. Con la proyeccion en la misma
 * vista que el fondo, el borde, el radio y el rim, lo que se ve no es una caida
 * sino un contorno de canto duro — que es exactamente el defecto observado en
 * todos los controles oblongos y circulares.
 *
 * Aqui hay **una capa y una funcion**: la mitad exterior del token, el mismo
 * radio del control, y nada mas. Sin fondo, sin borde, sin contenido.
 *
 * **No recorta ni se recorta.** No lleva `overflow`, y va en `absoluteFill`, asi
 * que tampoco entra en el reparto: no mueve ni una medida del control.
 *
 * Queda bajo el contenido por ORDEN —es el primer hijo— y no por `zIndex`: en
 * Android un hijo con z negativo puede no pintarse dentro de un padre sin fondo
 * propio, y ahi la capa desaparece entera.
 *
 * **Nada de `elevation`.** Es otra sombra —la de Material, con su propia curva
 * y su propio recorte— y mezclarla con `boxShadow` da dos halos.
 */
export function DepthLayer({ state, radius }: DepthLayerProps) {
  return (
    <View
      pointerEvents="none"
      style={[styles.layer, { borderRadius: radius, boxShadow: [...castShadow(state)] }]}
    />
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
