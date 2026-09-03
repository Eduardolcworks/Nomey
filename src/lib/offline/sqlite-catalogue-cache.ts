/**
 * El adaptador SQLite del catálogo cacheado.
 *
 * `insert ... on conflict do update` en vez de borrar y volver a insertar: una
 * carga correcta **sustituye** la anterior en una sola sentencia, así que no
 * existe el instante en que la persona se queda sin catálogo por haber abierto
 * la app justo mientras se refrescaba.
 */

import type { CachedDocument, CatalogueCache } from './catalogue-cache';
import type { SqlDatabase } from './sql-database';

type CacheRow = { document: string; cached_at: string };

export function createSqliteCatalogueCache(db: SqlDatabase): CatalogueCache {
  return {
    async read(actorId, key): Promise<CachedDocument | null> {
      const row = await db.getFirstAsync<CacheRow>(
        'select document, cached_at from catalogue_cache where actor_id = ? and key = ?',
        [actorId, key],
      );
      return row === null ? null : { document: row.document, cachedAt: row.cached_at };
    },

    async write(actorId, key, document, cachedAt) {
      await db.runAsync(
        `insert into catalogue_cache (actor_id, key, document, cached_at)
         values (?, ?, ?, ?)
         on conflict (actor_id, key) do update set document = excluded.document,
                                                   cached_at = excluded.cached_at`,
        [actorId, key, document, cachedAt],
      );
    },

    async clear(actorId, key) {
      await db.runAsync('delete from catalogue_cache where actor_id = ? and key = ?', [
        actorId,
        key,
      ]);
    },
  };
}
