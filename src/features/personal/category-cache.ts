/**
 * EL CATÁLOGO DE CATEGORÍAS, GUARDADO PARA CUANDO NO HAYA RED.
 *
 * ADR-028 §16. Un gasto exige `category_id` y el catálogo viene de
 * `api.category`, así que sin red y sin haberlo cargado nunca **no hay nada que
 * encolar**: no se inventa una categoría ni se manda un gasto sin ella, que la
 * frontera rechazaría por forma.
 *
 * **La forma vive aquí y el almacenamiento en `lib/offline`.** La capa de
 * infraestructura guarda una cadena opaca por actor; qué hay dentro lo sabe
 * quien la escribe, que es esta feature. Así `lib/` no acaba conociendo el
 * modelo de categorías, y esto no acaba conociendo SQLite.
 *
 * **Y esto no es una caché económica.** Nombres, iconos y estado de alta o baja
 * son presentación y selección; ninguna cifra pasa por aquí, así que la tercera
 * capa de ADR-013 §1 sigue vacía.
 */

import type { CatalogueCache } from '@/lib/offline';

/** La clave del documento dentro del catálogo cacheado. */
export const CATEGORY_CACHE_KEY = 'categories';

/**
 * Lo que se guarda de cada categoría.
 *
 * Es la fila de `api.category` tal cual, **incluida `is_active`**: las retiradas
 * se conservan porque el histórico necesita saber nombrarlas (ADR-021 §7), y
 * quien pinta un selector es quien las filtra. Guardar sólo las vigentes dejaría
 * un gasto de hace un año sin nombre de categoría.
 */
export type CachedCategory = {
  readonly id: string;
  readonly message_key: string | null;
  readonly label: string | null;
  readonly icon: string;
  readonly is_active: boolean;
};

/** El documento, con su versión propia. */
type CategoryDocument = {
  readonly v: number;
  readonly rows: readonly CachedCategory[];
};

/**
 * La versión del documento, aparte del `schema_version` de la cola.
 *
 * Son cosas distintas: aquélla versiona el payload de un comando monetario,
 * ésta un catálogo de presentación. Mezclarlas obligaría a migrar dinero para
 * cambiar un icono.
 */
export const CATEGORY_DOCUMENT_VERSION = 1;

export function serializeCategories(rows: readonly CachedCategory[]): string {
  const document: CategoryDocument = { v: CATEGORY_DOCUMENT_VERSION, rows };
  return JSON.stringify(document);
}

function isCachedCategory(value: unknown): value is CachedCategory {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;

  return (
    typeof row.id === 'string' &&
    row.id !== '' &&
    (row.message_key === null || typeof row.message_key === 'string') &&
    (row.label === null || typeof row.label === 'string') &&
    typeof row.icon === 'string' &&
    typeof row.is_active === 'boolean'
  );
}

/**
 * El documento de vuelta, o `null` si no se puede confiar en él.
 *
 * **`null` en vez de una lista parcial, y ésa es la decisión.** Un catálogo al
 * que le falten filas dejaría elegir entre menos categorías de las que hay sin
 * que nada fallara, y quien registre un gasto pensaría que su categoría ya no
 * existe. Preferimos decir «todavía no puedo» a enseñar un catálogo incompleto
 * que parece completo.
 *
 * Un documento de una versión posterior también devuelve `null`: lo escribió una
 * app más nueva y sus filas pueden significar otra cosa.
 */
export function parseCategories(document: string): CachedCategory[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const shape = parsed as Record<string, unknown>;

  if (shape.v !== CATEGORY_DOCUMENT_VERSION) return null;
  if (!Array.isArray(shape.rows)) return null;
  if (!shape.rows.every(isCachedCategory)) return null;

  return shape.rows as CachedCategory[];
}

/**
 * QUÉ PASÓ AL INTENTAR GUARDAR EL CATÁLOGO.
 *
 * Se devuelve un veredicto y **no se lanza nunca**: la caché es auxiliar y el
 * servidor sigue mandando, así que un fallo aquí no puede tumbar la carga
 * online, que es lo que la persona vino a ver.
 */
export type CacheVerdict = 'stored' | 'skippedIncomplete' | 'skippedNoActor' | 'failed';

/**
 * Guarda el catálogo **entero**, o no guarda nada.
 *
 * Tres negativas, y las tres protegen lo mismo —que una respuesta mala no
 * sustituya un catálogo bueno—:
 *
 * - **Sin actor no se escribe.** El documento está aislado por cuenta, y un
 *   actor vacío escribiría en una casilla que luego podría leer cualquiera.
 * - **Incompleto no se escribe.** Si el servidor dijo que hay 14 y llegaron 10,
 *   guardar las 10 dejaría un catálogo al que le faltan cuatro y que parece
 *   entero. PostgREST trunca por `max_rows` **sin error**, así que este es un
 *   caso real y silencioso, no una hipótesis.
 * - **Cero no se escribe.** Las categorías de sistema están siempre ahí, así
 *   que un catálogo vacío describe un fallo, no un estado.
 *
 * La escritura es **una sola sentencia** (`on conflict do update`), así que
 * sustituye el documento anterior de forma atómica: no existe el instante en
 * que la persona se queda sin catálogo.
 */
export async function rememberCategories(
  cache: CatalogueCache,
  actorId: string,
  page: { readonly rows: readonly CachedCategory[]; readonly total: number },
  now: string,
): Promise<CacheVerdict> {
  if (actorId === '') return 'skippedNoActor';
  if (page.total <= 0 || page.rows.length !== page.total) return 'skippedIncomplete';

  try {
    await cache.write(actorId, CATEGORY_CACHE_KEY, serializeCategories(page.rows), now);
    return 'stored';
  } catch {
    /*
     * SQLite puede fallar —disco lleno, base bloqueada, un aparato raro— y eso
     * **no es asunto de quien está mirando sus gastos**. No se registra el
     * error: `AGENTS.md` §8 prohíbe volcar cuerpos que puedan llevar datos, y
     * aquí el único efecto útil sería ruido.
     */
    return 'failed';
  }
}

/**
 * Si con este catálogo se puede registrar un gasto sin conexión.
 *
 * Hace falta **al menos una categoría vigente**: con cero, el selector no tendría
 * qué ofrecer y el gasto no podría llevar la suya. Un catálogo entero de
 * categorías dadas de baja cuenta como no tenerlo, aunque el documento exista.
 */
export function canPickCategoryOffline(rows: readonly CachedCategory[] | null): boolean {
  return rows !== null && rows.some((row) => row.is_active);
}
