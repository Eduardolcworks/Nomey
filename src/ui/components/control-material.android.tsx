import { StyleSheet, View } from 'react-native';

import { ControlAndroid } from '@/ui/theme';

import type { ControlMaterialProps } from './control-material';

/**
 * EL MATERIAL DE UN CONTROL NEUTRO EN ANDROID.
 *
 * Tres capas, cada una con una función y ninguna con dos:
 *
 *   · **material** — el relleno plano, y nada más;
 *   · **rim base** — un hilo de un píxel CONTINUO, de un solo color;
 *   · **acento superior** — la luz, sólo en el canto de arriba.
 *
 * ============= POR QUÉ EL RIM YA NO LLEVA UN COLOR POR LADO ================
 *
 * Un borde con `borderTopColor`, `borderLeftColor`, `borderRightColor` y
 * `borderBottomColor` distintos se ve bien en un rectángulo y mal en una curva:
 * Android tiene que resolver las UNIONES entre lados, y lo hace con cortes
 * visibles. En un oblongo el hilo se partía en el lado derecho, y en un círculo
 * el reparto ni siquiera salía simétrico —cargaba a la izquierda—, porque en una
 * circunferencia no hay cuatro lados que repartir.
 *
 * **Un solo color no tiene uniones que resolver.** El rim base recorre los 360
 * grados sin un salto, en oblongos, círculos y rectángulos redondeados por
 * igual. Y la direccionalidad, que es lo que se quería del borde multicolor,
 * vuelve por otra vía: una segunda capa que sólo pinta arriba.
 *
 * **Las dos se suman en la misma fila.** 0,20 debajo y 0,08 encima dan la
 * intensidad aprobada en el canto superior sin añadir un segundo píxel: es la
 * misma fila pintada dos veces, no dos filas.
 *
 * Las tres capas van en `absoluteFill` con el radio del control, así que **no
 * ocupan sitio, no cambian el reparto y no modifican la hitbox**; ninguna recibe
 * toques, y todas van antes que el contenido.
 *
 * **Un píxel físico.** `StyleSheet.hairlineWidth` es la forma de pedirlo sin
 * suponer la densidad.
 *
 * Aquí no hay degradado, ni ruido, ni desenfoque, ni sombreado interior, ni
 * sombra exterior, ni `elevation`. Todas esas técnicas se probaron en el
 * laboratorio y se descartaron mirándolas.
 */
export function ControlMaterial({ radius, fill = true }: ControlMaterialProps) {
  return (
    <>
      {fill ? (
        <View
          pointerEvents="none"
          style={[styles.capa, { borderRadius: radius, backgroundColor: ControlAndroid.fill }]}
        />
      ) : null}
      <View pointerEvents="none" style={[styles.capa, styles.rimBase, { borderRadius: radius }]} />
      <View pointerEvents="none" style={[styles.capa, styles.acento, { borderRadius: radius }]} />
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
  /** El hilo continuo: un solo color, toda la vuelta. */
  rimBase: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ControlAndroid.rimBase,
  },
  /**
   * La luz de arriba. **Sólo `borderTopWidth`**, sin los otros tres lados: no
   * son transparentes dentro de un `borderWidth` completo, sencillamente no
   * existen, y por eso esta capa no puede introducir uniones.
   */
  acento: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ControlAndroid.rimTopAccent,
  },
});
