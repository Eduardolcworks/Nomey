import { describe, expect, it } from 'vitest';

import {
  canPickCategoryOffline,
  CATEGORY_CACHE_KEY,
  parseCategories,
  rememberCategories,
  serializeCategories,
  type CachedCategory,
} from '../../src/features/personal/category-cache';

/**
 * La forma del catálogo guardado, que es lo que la feature sabe y `lib/` no.
 *
 * La pregunta que responde este fichero es una sola: **¿se puede registrar un
 * gasto sin conexión con lo que hay guardado?** Un `category_id` es obligatorio
 * y no se inventa, así que un catálogo dudoso tiene que decir «no» en vez de
 * dejar elegir entre menos categorías de las que hay.
 */

const ROWS: CachedCategory[] = [
  { id: '1', message_key: 'category.food', label: null, icon: 'fork', is_active: true },
  { id: '2', message_key: null, label: 'Mis plantas', icon: 'leaf', is_active: true },
  { id: '3', message_key: 'category.utilities', label: null, icon: 'bolt', is_active: false },
];

describe('ida y vuelta', () => {
  it('conserva las filas tal cual, incluidas las dadas de baja', () => {
    /*
     * Las retiradas se guardan a propósito: un gasto de hace un año usó
     * Suministros y hay que saber nombrarlo (ADR-021 §7). Quien pinta el
     * selector es quien las filtra, no quien las guarda.
     */
    expect(parseCategories(serializeCategories(ROWS))).toEqual(ROWS);
  });

  it('un catálogo vacío es un documento válido y no un error', () => {
    expect(parseCategories(serializeCategories([]))).toEqual([]);
  });

  it('la clave del documento es estable', () => {
    expect(CATEGORY_CACHE_KEY).toBe('categories');
  });
});

describe('un documento en el que no se puede confiar devuelve null', () => {
  it('si no es JSON', () => {
    expect(parseCategories('{no json')).toBeNull();
  });

  it('si viene de una versión posterior de la app', () => {
    expect(parseCategories(JSON.stringify({ v: 2, rows: ROWS }))).toBeNull();
  });

  it('si le falta la lista', () => {
    expect(parseCategories(JSON.stringify({ v: 1 }))).toBeNull();
  });

  it('SI UNA SOLA FILA ESTÁ MAL, se descarta el documento entero', () => {
    /*
     * No se devuelve la lista parcial: un catálogo incompleto que parece
     * completo dejaría a alguien pensando que su categoría ya no existe.
     */
    const document = JSON.stringify({ v: 1, rows: [ROWS[0], { id: '2', icon: 'leaf' }] });
    expect(parseCategories(document)).toBeNull();
  });

  it('si una fila trae un tipo equivocado', () => {
    const document = JSON.stringify({
      v: 1,
      rows: [{ ...ROWS[0], is_active: 'sí' }],
    });
    expect(parseCategories(document)).toBeNull();
  });
});

describe('qué se guarda, y qué no', () => {
  const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const NOW = '2026-09-03T21:00:00.000Z';

  /** Un catálogo de mentira, con memoria, para poder afirmar qué se escribió. */
  function fakeCache() {
    const written = new Map<string, { document: string; cachedAt: string }>();
    return {
      written,
      cache: {
        read: async (actorId: string, key: string) => written.get(`${actorId}/${key}`) ?? null,
        write: async (actorId: string, key: string, document: string, cachedAt: string) => {
          written.set(`${actorId}/${key}`, { document, cachedAt });
        },
        clear: async (actorId: string, key: string) => {
          written.delete(`${actorId}/${key}`);
        },
      },
    };
  }

  it('una carga completa se guarda entera, con su fecha', async () => {
    const { cache, written } = fakeCache();

    await expect(
      rememberCategories(cache, ACTOR_A, { rows: ROWS, total: ROWS.length }, NOW),
    ).resolves.toBe('stored');

    const stored = written.get(`${ACTOR_A}/${CATEGORY_CACHE_KEY}`);
    expect(parseCategories(stored?.document ?? '')).toEqual(ROWS);
    expect(stored?.cachedAt).toBe(NOW);
  });

  it('UNA RESPUESTA PARCIAL NO SUSTITUYE UN CATÁLOGO VÁLIDO', async () => {
    /*
     * El caso silencioso: PostgREST trunca por `max_rows` **sin error**, así
     * que una respuesta a la que le faltan filas llega con la misma pinta que
     * una buena. Guardarla dejaría un catálogo incompleto que parece completo.
     */
    const { cache, written } = fakeCache();
    await rememberCategories(cache, ACTOR_A, { rows: ROWS, total: ROWS.length }, NOW);

    await expect(
      rememberCategories(cache, ACTOR_A, { rows: ROWS.slice(0, 1), total: 14 }, '2026-09-04'),
    ).resolves.toBe('skippedIncomplete');

    const stored = written.get(`${ACTOR_A}/${CATEGORY_CACHE_KEY}`);
    expect(parseCategories(stored?.document ?? '')).toEqual(ROWS);
    expect(stored?.cachedAt).toBe(NOW);
  });

  it('un catálogo vacío tampoco sustituye nada', async () => {
    // Las de sistema están siempre ahí: cero describe un fallo, no un estado.
    const { cache, written } = fakeCache();
    await rememberCategories(cache, ACTOR_A, { rows: ROWS, total: ROWS.length }, NOW);

    await expect(rememberCategories(cache, ACTOR_A, { rows: [], total: 0 }, NOW)).resolves.toBe(
      'skippedIncomplete',
    );
    expect(written.size).toBe(1);
  });

  it('sin actor no se escribe nada', async () => {
    const { cache, written } = fakeCache();

    await expect(
      rememberCategories(cache, '', { rows: ROWS, total: ROWS.length }, NOW),
    ).resolves.toBe('skippedNoActor');
    expect(written.size).toBe(0);
  });

  it('el documento queda aislado por actor', async () => {
    const { cache } = fakeCache();
    await rememberCategories(cache, ACTOR_A, { rows: ROWS, total: ROWS.length }, NOW);

    // Cambiar de cuenta no expone el catálogo anterior.
    expect(await cache.read(ACTOR_B, CATEGORY_CACHE_KEY)).toBeNull();
  });

  it('UN FALLO DE SQLITE NO ROMPE LA CARGA ONLINE', async () => {
    /*
     * La caché es auxiliar y el servidor manda. Si guardar falla, se devuelve un
     * veredicto y no se lanza: quien está mirando sus gastos no se entera, que
     * es exactamente lo que tiene que pasar.
     */
    const exploding = {
      read: async () => null,
      write: async () => {
        throw new Error('database is locked');
      },
      clear: async () => undefined,
    };

    await expect(
      rememberCategories(exploding, ACTOR_A, { rows: ROWS, total: ROWS.length }, NOW),
    ).resolves.toBe('failed');
  });
});

describe('si se puede registrar un gasto sin conexión', () => {
  it('con al menos una categoría vigente, sí', () => {
    expect(canPickCategoryOffline(ROWS)).toBe(true);
  });

  it('sin haber cargado nunca el catálogo, no', () => {
    expect(canPickCategoryOffline(null)).toBe(false);
  });

  it('con el catálogo vacío, no', () => {
    expect(canPickCategoryOffline([])).toBe(false);
  });

  it('CON TODAS DADAS DE BAJA, TAMPOCO', () => {
    // El documento existe, así que un `!== null` diría que sí. Y el selector no
    // tendría ninguna que ofrecer.
    expect(canPickCategoryOffline(ROWS.map((row) => ({ ...row, is_active: false })))).toBe(false);
  });
});
