import { describe, expect, it } from 'vitest';

import { migrate } from '../../src/lib/offline/migrations';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteCatalogueCache } from '../../src/lib/offline/sqlite-catalogue-cache';

import { openTestDatabase } from './offline-sqlite';

/**
 * El catálogo cacheado (ADR-028 §16).
 *
 * Aquí sólo se comprueba el almacén: guarda una cadena por `(actor, clave)` y
 * no sabe qué hay dentro. Qué es una categoría, y qué pasa si el documento está
 * roto, es de `personal-category-cache.test.ts`.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function open() {
  const db = openTestDatabase();
  await migrate(db);
  return { db, cache: createSqliteCatalogueCache(db as SqlDatabase) };
}

describe('el catálogo cacheado', () => {
  it('guarda y devuelve el documento con su fecha', async () => {
    const { db, cache } = await open();
    await cache.write(ACTOR_A, 'categories', '{"v":1}', '2026-09-03T21:00:00.000Z');

    expect(await cache.read(ACTOR_A, 'categories')).toEqual({
      document: '{"v":1}',
      cachedAt: '2026-09-03T21:00:00.000Z',
    });
    db.close();
  });

  it('no hay documento antes de la primera carga', async () => {
    const { db, cache } = await open();
    expect(await cache.read(ACTOR_A, 'categories')).toBeNull();
    db.close();
  });

  it('una carga nueva SUSTITUYE la anterior en una sola sentencia', async () => {
    /*
     * Sin `on conflict` habría que borrar y volver a insertar, y entre las dos
     * sentencias la persona se quedaría sin catálogo. Es improbable y es
     * gratuito evitarlo.
     */
    const { db, cache } = await open();
    await cache.write(ACTOR_A, 'categories', 'viejo', '2026-09-01T00:00:00.000Z');
    await cache.write(ACTOR_A, 'categories', 'nuevo', '2026-09-03T00:00:00.000Z');

    expect((await cache.read(ACTOR_A, 'categories'))?.document).toBe('nuevo');
    const rows = await db.getAllAsync<{ n: number }>('select count(*) as n from catalogue_cache');
    expect(rows[0].n).toBe(1);
    db.close();
  });

  it('el catálogo de A no es visible para B', async () => {
    const { db, cache } = await open();
    await cache.write(ACTOR_A, 'categories', 'de A', '2026-09-03T00:00:00.000Z');

    expect(await cache.read(ACTOR_B, 'categories')).toBeNull();
    db.close();
  });

  it('B no puede borrar el catálogo de A', async () => {
    const { db, cache } = await open();
    await cache.write(ACTOR_A, 'categories', 'de A', '2026-09-03T00:00:00.000Z');

    await cache.clear(ACTOR_B, 'categories');
    expect((await cache.read(ACTOR_A, 'categories'))?.document).toBe('de A');
    db.close();
  });

  it('dos claves distintas del mismo actor no se pisan', async () => {
    const { db, cache } = await open();
    await cache.write(ACTOR_A, 'categories', 'cat', '2026-09-03T00:00:00.000Z');
    await cache.write(ACTOR_A, 'otra', 'otra cosa', '2026-09-03T00:00:00.000Z');

    expect((await cache.read(ACTOR_A, 'categories'))?.document).toBe('cat');
    db.close();
  });
});
