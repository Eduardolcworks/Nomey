import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme';

export type FadeEdgeProps = {
  /** Alto del desvanecido. */
  readonly height: number;
  /** Dónde empieza a pintarse, para dejar libre la zona segura. */
  readonly bottom?: number;
};

/**
 * El contenido se desvanece bajo el dock en vez de cortarse en seco.
 *
 * **Sin dependencia nueva.** No hay biblioteca de gradientes en el proyecto, y
 * añadir una para un degradado es peso de bundle y superficie de actualización
 * a cambio de un efecto. Se consigue con bandas apiladas del color del fondo,
 * con la opacidad subiendo en curva: a partir de una docena de bandas el salto
 * entre dos es imperceptible en pantalla, y el coste es una docena de `View`
 * sin estado.
 *
 * **La curva es cuadrática y no lineal**, y no es un capricho: un degradado
 * lineal de opacidad se percibe como un corte a media altura, porque la
 * percepción de luminancia no es lineal. Empezando suave y cerrando deprisa, lo
 * que se ve es lo que se quería — que el último elemento *se va*, no que hay una
 * banda encima.
 *
 * **No tapa nada accionable.** `pointerEvents="none"` deja pasar el gesto, así
 * que una fila bajo el desvanecido sigue siendo pulsable, y la pantalla que lo
 * usa reserva el alto del dock en su `contentContainerStyle` para que el último
 * elemento pueda llegar a verse entero. El efecto es un remate visual, nunca la
 * razón por la que algo no se lee: es la regla obligatoria de
 * `design-direction.md` §8.
 */
const BANDS = 12;

export function FadeEdge({ height, bottom = 0 }: FadeEdgeProps) {
  const theme = useTheme();
  const band = height / BANDS;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { height, bottom }]}>
      {Array.from({ length: BANDS }, (_, index) => {
        // 0 arriba, 1 abajo. Al cuadrado: casi transparente durante la primera
        // mitad y opaco al final.
        const progress = (index + 1) / BANDS;
        return (
          <View
            key={index}
            style={{
              height: band,
              backgroundColor: theme.background,
              opacity: progress * progress,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
