import type { ViewStyle } from 'react-native';

/**
 * El borde de un `GlassPressable`, decidido en un sitio puro.
 *
 * `edge` es la única marca visual que un control de cristal añade a su borde:
 * `'accent'` lo pinta con EL amarillo de la app —el token `accent`, el mismo
 * de los CTA— para decir «esta es la opción elegida» de un grupo excluyente.
 * Sin `edge`, el borde es el del material (`token.border`, hairline) y nada
 * cambia. Un píxel entero, y no el hairline: a 3× el hairline amarillo no se
 * ve; el fondo, el texto, el tamaño y el relleno no se tocan.
 *
 * El estado accesible no depende de esto: `selected` sigue anunciándose por
 * `accessibilityState`, y el borde sólo lo acompaña.
 */
export type GlassEdge = 'accent';

export function glassEdgeStyle(edge: GlassEdge | undefined, accent: string): ViewStyle | null {
  if (edge !== 'accent') return null;
  return { borderWidth: 1, borderColor: accent };
}
