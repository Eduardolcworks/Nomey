/**
 * UN CATÁLOGO CACHEADO, POR ACTOR Y POR CLAVE.
 *
 * ADR-028 §16: el catálogo visible se guarda tras cada carga correcta, porque
 * un gasto exige `category_id` y sin él no hay nada que encolar. **Es
 * información de presentación y selección, no una caché económica**, y por eso
 * no toca la tercera capa de ADR-013 §1, que sigue vacía.
 *
 * **Aquí el documento es opaco.** `lib/` no puede importar de `features/` y
 * tampoco debe saber qué es una categoría: guarda una cadena por
 * `(actor, clave)` y quien la escribe es quien sabe leerla. Lo que sí es de
 * esta capa es el aislamiento por actor, idéntico al de la cola.
 */

export type CachedDocument = {
  readonly document: string;
  /** ISO 8601. Para poder decir «esto es de hace mucho», no para caducarlo. */
  readonly cachedAt: string;
};

export type CatalogueCache = {
  read(actorId: string, key: string): Promise<CachedDocument | null>;
  write(actorId: string, key: string, document: string, cachedAt: string): Promise<void>;
  clear(actorId: string, key: string): Promise<void>;
};
