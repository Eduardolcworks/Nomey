/**
 * CUÁNTO MIDE LA LISTA DEL SELECTOR DE AMIGOS. Aritmética pura, aquí porque
 * es lo único de la hoja que se puede comprobar sin renderizar nada.
 *
 * La regla entera cabe en una frase: **la lista mide lo que ocupan las filas
 * que hay, hasta seis**. Con un amigo mide una fila, no seis con cinco
 * huecos; con veinte mide seis y el resto se desplaza. El mismo número
 * gobierna la lista completa y la filtrada, así que buscar encoge la hoja en
 * vez de dejar una caja alta medio vacía.
 */

/** Cuántas filas se ven antes de que la lista empiece a desplazarse. */
export const MAX_VISIBLE_FRIENDS = 6;

/**
 * Lo que mide una fila, y **es el mismo número que el estilo de la fila**:
 * 56 de alto, con el filete de separación incluido —React Native mide las
 * cajas con el borde dentro—, que es lo que hace que esta cuenta sea exacta
 * y no una aproximación.
 *
 * Cabe de sobra lo que la fila lleva: `bodyStrong` (22) + 1 de separación +
 * `caption` (16) son 39. Ese margen es el que permite que la fila declare
 * `minHeight` y no `height`: con el texto del sistema agrandado la fila
 * CRECE en vez de recortar el nombre, y lo que se acota entonces es cuántas
 * caben —la lista se desplaza antes—, nunca la legibilidad.
 */
export const FRIEND_ROW_HEIGHT = 56;

/** Cuántas filas se ven de verdad. Cero es cero: sin filas no hay lista. */
export function visibleFriendRows(count: number): number {
  if (count <= 0) return 0;
  return Math.min(count, MAX_VISIBLE_FRIENDS);
}

/**
 * El alto máximo de la zona desplazable, en puntos.
 *
 * Se aplica como `maxHeight` y no como `height`, y la diferencia importa: con
 * menos de seis filas la lista mide lo que mide su contenido y no reserva un
 * hueco que no va a usar; a partir de seis, el tope la acota y aparece el
 * desplazamiento.
 */
export function friendListHeight(count: number): number {
  return visibleFriendRows(count) * FRIEND_ROW_HEIGHT;
}
