import { describe, expect, it } from 'vitest';

import {
  CHUNKED_STORAGE_LIMITS,
  createChunkedStore,
  type StorageBackend,
} from '../../src/lib/supabase/chunked-storage';

/**
 * El almacén troceado sobre el que vive la sesión.
 *
 * Lo que se comprueba aquí no es «guarda y recupera», que es la parte fácil.
 * Es el conjunto de estados que deja una escritura que no terminó: manifiesto
 * sin sus chunks, chunks sin su manifiesto, restos de un valor anterior más
 * largo, y un manifiesto ilegible. En todos ellos la única respuesta admisible
 * es **ausente**: devolver un valor a medias entregaría a la librería de auth
 * un JSON truncado, que no falla aquí sino tres capas más allá.
 *
 * La regla de la que depende todo: **el manifiesto se escribe el último y se
 * borra el primero.**
 */

const { chunkSize, maxChunks, manifestVersion } = CHUNKED_STORAGE_LIMITS;

const KEY = 'nomey-auth-token';

/** Backend en memoria, con lo justo para inspeccionarlo e interrumpirlo. */
function fakeBackend() {
  const entries = new Map<string, string>();
  /** Cuando es un número, la enésima escritura (1-indexada) revienta. */
  let failWriteAt: number | null = null;
  let writes = 0;

  const backend: StorageBackend = {
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => {
      writes += 1;
      if (failWriteAt !== null && writes === failWriteAt) {
        throw new Error('escritura interrumpida');
      }
      entries.set(key, value);
    },
    removeItem: async (key) => {
      entries.delete(key);
    },
  };

  return {
    backend,
    entries,
    keys: () => [...entries.keys()].sort(),
    interruptOnWrite: (n: number) => {
      failWriteAt = n;
    },
  };
}

/** Un valor de `n` unidades, con contenido distinto en cada posición. */
function payload(length: number): string {
  let out = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i += 1) out += alphabet[i % alphabet.length];
  return out;
}

describe('almacén troceado', () => {
  describe('ida y vuelta', () => {
    it('devuelve null para una clave que nunca se escribió', async () => {
      const { backend } = fakeBackend();
      await expect(createChunkedStore(backend).getItem(KEY)).resolves.toBeNull();
    });

    it('conserva un valor corto', async () => {
      const { backend } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, 'sesión corta');
      await expect(store.getItem(KEY)).resolves.toBe('sesión corta');
    });

    it('conserva un valor grande, de varios chunks', async () => {
      const { backend, keys } = fakeBackend();
      const store = createChunkedStore(backend);
      const value = payload(chunkSize * 7 + 13);

      await store.setItem(KEY, value);

      expect(keys()).toHaveLength(8 + 1); // ocho chunks y el manifiesto
      await expect(store.getItem(KEY)).resolves.toBe(value);
    });

    it('conserva la cadena vacía, que no es lo mismo que la ausencia', async () => {
      const { backend } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, '');
      await expect(store.getItem(KEY)).resolves.toBe('');
    });

    it('no parte un par suplente por la mitad', async () => {
      const { backend } = fakeBackend();
      const store = createChunkedStore(backend);
      // Un emoji ocupa dos unidades UTF-16. Con este relleno el corte cae
      // exactamente entre las dos, que es el caso que hay que evitar.
      const purse = String.fromCodePoint(0x1f45b);
      const value = `${payload(chunkSize - 1)}${purse}${payload(chunkSize)}`;

      await store.setItem(KEY, value);

      const roundTripped = await store.getItem(KEY);
      expect(roundTripped).toBe(value);
      expect([...(roundTripped ?? '')].includes(purse)).toBe(true);
    });

    it('nunca escribe el valor entero en una sola entrada', async () => {
      const { backend, entries } = fakeBackend();
      const store = createChunkedStore(backend);
      const value = payload(chunkSize * 3);

      await store.setItem(KEY, value);

      for (const stored of entries.values()) {
        expect(stored.length).toBeLessThanOrEqual(chunkSize);
      }
    });
  });

  describe('sobrescritura', () => {
    it('de grande a pequeño no deja chunks sobrantes', async () => {
      const { backend, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, payload(chunkSize * 6));
      await store.setItem(KEY, 'corto');

      expect(keys()).toEqual([KEY, `${KEY}.0`]);
      await expect(store.getItem(KEY)).resolves.toBe('corto');
    });

    it('de pequeño a grande sustituye el valor entero', async () => {
      const { backend } = fakeBackend();
      const store = createChunkedStore(backend);
      const grande = payload(chunkSize * 4 + 1);

      await store.setItem(KEY, 'corto');
      await store.setItem(KEY, grande);

      await expect(store.getItem(KEY)).resolves.toBe(grande);
    });

    it('limpia restos de un valor anterior aunque los deje otro escritor', async () => {
      const { backend, entries, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, payload(chunkSize * 2));
      // Un chunk huérfano justo detrás del último legítimo.
      entries.set(`${KEY}.2`, 'basura');

      await store.setItem(KEY, payload(chunkSize * 2));

      expect(keys()).toEqual([KEY, `${KEY}.0`, `${KEY}.1`]);
    });
  });

  describe('borrado', () => {
    it('deja el almacén completamente vacío', async () => {
      const { backend, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, payload(chunkSize * 5));
      await store.removeItem(KEY);

      expect(keys()).toEqual([]);
      await expect(store.getItem(KEY)).resolves.toBeNull();
    });

    it('sobre una clave inexistente no protesta', async () => {
      const { backend } = fakeBackend();
      await expect(createChunkedStore(backend).removeItem(KEY)).resolves.toBeUndefined();
    });
  });

  describe('estados rotos: la respuesta siempre es ausente, nunca a medias', () => {
    it('manifiesto ilegible', async () => {
      const { backend, entries, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, payload(chunkSize * 3));
      entries.set(KEY, 'esto no es JSON');

      await expect(store.getItem(KEY)).resolves.toBeNull();
      expect(keys()).toEqual([]); // y además se limpia
    });

    it('manifiesto de una versión que no conocemos', async () => {
      const { backend, entries } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, payload(chunkSize * 2));
      entries.set(KEY, JSON.stringify({ v: manifestVersion + 1, n: 2 }));

      await expect(store.getItem(KEY)).resolves.toBeNull();
    });

    it('manifiesto con un recuento absurdo', async () => {
      const { backend, entries } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, 'corto');
      entries.set(KEY, JSON.stringify({ v: manifestVersion, n: -1 }));

      await expect(store.getItem(KEY)).resolves.toBeNull();
    });

    it('falta un chunk que el manifiesto contaba', async () => {
      const { backend, entries, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, payload(chunkSize * 4));
      entries.delete(`${KEY}.2`);

      await expect(store.getItem(KEY)).resolves.toBeNull();
      expect(keys()).toEqual([]);
    });

    it('NO devuelve el prefijo que sí sobrevivió', async () => {
      const { backend, entries } = fakeBackend();
      const store = createChunkedStore(backend);
      const value = payload(chunkSize * 3);

      await store.setItem(KEY, value);
      entries.delete(`${KEY}.1`);

      const recovered = await store.getItem(KEY);
      expect(recovered).toBeNull();
      expect(recovered).not.toBe(value.slice(0, chunkSize));
    });
  });

  describe('escritura interrumpida', () => {
    it('a mitad de los chunks deja la clave ausente, no a medias', async () => {
      const { backend, interruptOnWrite } = fakeBackend();
      const store = createChunkedStore(backend);

      await store.setItem(KEY, 'una sesión anterior perfectamente válida');
      interruptOnWrite(4); // ya van dos escrituras; revienta el segundo chunk nuevo

      await expect(store.setItem(KEY, payload(chunkSize * 3))).rejects.toThrow(
        'escritura interrumpida',
      );

      // El manifiesto se borró antes de empezar, así que no hay commit.
      await expect(store.getItem(KEY)).resolves.toBeNull();
    });

    it('justo antes del manifiesto tampoco deja nada legible', async () => {
      const { backend, interruptOnWrite } = fakeBackend();
      const store = createChunkedStore(backend);
      const chunks = 3;

      interruptOnWrite(chunks + 1); // los chunks entran; el commit no

      await expect(store.setItem(KEY, payload(chunkSize * chunks))).rejects.toThrow();
      await expect(store.getItem(KEY)).resolves.toBeNull();
    });

    it('y la escritura siguiente se recupera sola', async () => {
      const { backend, interruptOnWrite, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      interruptOnWrite(2);
      await expect(store.setItem(KEY, payload(chunkSize * 4))).rejects.toThrow();

      await store.setItem(KEY, 'sesión nueva');

      await expect(store.getItem(KEY)).resolves.toBe('sesión nueva');
      expect(keys()).toEqual([KEY, `${KEY}.0`]);
    });
  });

  describe('el techo', () => {
    it('rechaza un valor imposible en vez de truncarlo', async () => {
      const { backend, keys } = fakeBackend();
      const store = createChunkedStore(backend);

      await expect(store.setItem(KEY, payload(chunkSize * (maxChunks + 1)))).rejects.toThrow(
        /Refusing rather than truncating/,
      );
      expect(keys()).toEqual([]);
    });

    it('admite un valor justo en el límite', async () => {
      const { backend } = fakeBackend();
      const store = createChunkedStore(backend);
      const value = payload(chunkSize * maxChunks);

      await store.setItem(KEY, value);
      await expect(store.getItem(KEY)).resolves.toBe(value);
    });
  });
});
