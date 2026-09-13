/**
 * LOS EMOJIS USADOS RECIENTEMENTE. Lista pura y su formato en disco.
 *
 * **Es preferencia de presentación, no un dato del dominio.** Vive en el mismo
 * almacén por actor que el catálogo de categorías —`CatalogueCache`, F07/ADR-001
 * §16—, que guarda una cadena por `(actor, clave)` y no sabe qué contiene. Así
 * los recientes de una cuenta no se ven desde otra en el mismo aparato, que es
 * el mismo aislamiento que ya tiene la cola.
 */

export const EMOJI_RECENTS_KEY = 'emoji-recents';

/**
 * Cuántos se recuerdan.
 *
 * Los que caben en una fila y media de la cuadrícula: bastantes para que la
 * fila sirva de atajo, pocos para que siga siendo «los últimos» y no una
 * segunda categoría.
 */
export const RECENTS_LIMIT = 24;

/**
 * El emoji elegido, delante y una sola vez.
 *
 * Repetirlo no lo duplica: lo sube. Sin esto, elegir dos veces el mismo llenaría
 * la fila con una sola cara.
 */
export function pushRecent(list: readonly string[], emoji: string): readonly string[] {
  return [emoji, ...list.filter((one) => one !== emoji)].slice(0, RECENTS_LIMIT);
}

/**
 * Lo que había guardado, o nada.
 *
 * **Todo lo que no sea una lista de cadenas se descarta entera.** El documento
 * lo escribió una versión anterior de la app y puede tener cualquier forma; una
 * lista medio válida metería `undefined` en la cuadrícula.
 */
export function parseRecents(document: string | null): readonly string[] {
  if (document === null) return [];

  try {
    const parsed: unknown = JSON.parse(document);
    if (!Array.isArray(parsed)) return [];
    if (!parsed.every((item) => typeof item === 'string' && item !== '')) return [];
    return (parsed as string[]).slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

export function serialiseRecents(list: readonly string[]): string {
  return JSON.stringify(list);
}
