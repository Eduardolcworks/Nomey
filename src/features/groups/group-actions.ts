import type { MessageKey } from '@/lib/i18n';

/**
 * LO QUE OFRECE EL `+` DE GRUPOS, Y EN QUÉ ORDEN.
 *
 * **Fuera del componente para poder interrogarlo.** El proyecto no tiene
 * renderer de React y no se añade uno por esto, así que una lista escrita dentro
 * del JSX sólo se podría comprobar leyendo el fuente. Aquí el orden, las claves
 * y el reparto de manejadores son datos, y se prueban por lo que valen.
 *
 * **Dos acciones, no dos filas de un formulario.** Crear algo tuyo y entrar en
 * algo de otro no se parecen, y por eso la hoja las pinta como dos superficies
 * separadas. Esta lista fija cuáles son y su orden; la hoja decide cómo se ven.
 */
export type GroupActionKey = 'create' | 'join';

export type GroupAction = {
  readonly key: GroupActionKey;
  readonly labelKey: MessageKey;
  /**
   * La línea de debajo del título, y la indicación accesible.
   *
   * **Son el mismo texto porque dicen lo mismo.** La tarjeta entera es un solo
   * botón: su nombre es el título y esto es lo que añade, así que duplicarlo en
   * una cadena aparte para el lector de pantalla sólo abriría la puerta a que
   * una de las dos se quedara vieja.
   */
  readonly descriptionKey: MessageKey;
  /** La clave del vocabulario de iconos. El par por plataforma lo pone `Symbols`. */
  readonly symbol: 'add' | 'qr';
};

/** El orden es parte del contrato: crear primero, unirse después. */
export const GROUP_ACTIONS: readonly GroupAction[] = [
  {
    key: 'create',
    labelKey: 'groups.createGroup',
    descriptionKey: 'groups.createGroupDescription',
    symbol: 'add',
  },
  {
    key: 'join',
    labelKey: 'groups.joinGroup',
    descriptionKey: 'groups.joinGroupDescription',
    symbol: 'qr',
  },
];

/**
 * CUÁNTAS LÍNEAS SE LE RESERVAN A LA DESCRIPCIÓN.
 *
 * **No es un máximo: es un alto fijo, y ésa es la razón de que exista.** Las
 * dos frases no miden lo mismo, así que a anchos normales una cabe en una
 * línea y la otra en dos. Con cada bloque ajustado a su contenido y centrado en
 * su tarjeta, los dos títulos quedan a alturas distintas —27 px medidos a 1080—
 * y las dos tarjetas dejan de leerse como una pareja.
 *
 * Reservando el mismo alto en las dos, los bloques miden igual: los títulos se
 * alinean entre sí, las descripciones también, el bloque sigue centrado y el
 * disco sigue a su mitad. Y, de paso, **la composición deja de depender del
 * ancho**: cuando en una pantalla estrecha la frase corta también salte a dos
 * líneas, no se mueve nada, porque el hueco ya estaba.
 *
 * Dos y no tres: es lo que ocupa la más larga de las cadenas actuales. Si una
 * futura necesitara una tercera, esto se sube aquí y no en el componente.
 */
export const DESCRIPTION_LINES = 2;

/**
 * A qué manejador va cada acción.
 *
 * **Existe para que no se puedan cruzar.** Con dos `onPress` escritos a mano en
 * el JSX, intercambiarlos es un error de una línea que nada detecta: las dos
 * tarjetas seguirían pulsándose y cada una haría lo de la otra. Aquí el reparto
 * es una función y se comprueba.
 */
export function groupActionHandler(
  key: GroupActionKey,
  handlers: { readonly create: () => void; readonly join: () => void },
): () => void {
  return key === 'create' ? handlers.create : handlers.join;
}

/**
 * EL ALTO DE LA HOJA, EN FUNCIÓN DE LA PANTALLA.
 *
 * Alrededor del 30 % de lo visible, acotado a la banda acordada. Se calcula en
 * vez de fijarse en puntos porque una hoja de alto fijo ocupa media pantalla en
 * un teléfono pequeño y una franja en una tableta; y se acota porque un
 * porcentaje suelto, en una pantalla muy alargada, dejaría las tarjetas o
 * apretadas o nadando.
 */
export const SHEET_RATIO = 0.3;
const SHEET_MIN_RATIO = 0.28;
const SHEET_MAX_RATIO = 0.32;

export function sheetHeight(screenHeight: number): number {
  const wanted = screenHeight * SHEET_RATIO;
  const floor = screenHeight * SHEET_MIN_RATIO;
  const ceiling = screenHeight * SHEET_MAX_RATIO;
  return Math.round(Math.min(Math.max(wanted, floor), ceiling));
}
