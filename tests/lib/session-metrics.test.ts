import { describe, expect, it } from 'vitest';

import { CHUNKED_STORAGE_LIMITS, createChunkedStore } from '../../src/lib/supabase/chunked-storage';
import type { StorageBackend } from '../../src/lib/supabase/chunked-storage';
import {
  measureStoredSession,
  NO_SESSION_STORED,
  utf8Length,
} from '../../src/lib/supabase/session-metrics';

/**
 * La medición del payload real de sesión, que ADR-017 exige documentada antes
 * de cerrar la Fase 5.
 *
 * Aquí se comprueba **que la medición es correcta**; la cifra de verdad sale
 * del dispositivo, con una sesión auténtica, en la sonda DEV.
 *
 * Y se comprueba lo otro, que importa igual: **que no puede devolver
 * contenido**. El tipo de retorno son cuatro enteros y un booleano, así que no
 * hay forma de que un token salga por ahí. El test lo fija por si alguien
 * decide «añadir el JSON para depurar».
 */

const KEY = 'nomey-auth-token';

function memoryBackend() {
  const entries = new Map<string, string>();
  const backend: StorageBackend = {
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => {
      entries.set(key, value);
    },
    removeItem: async (key) => {
      entries.delete(key);
    },
  };
  return { backend, entries };
}

describe('longitud UTF-8', () => {
  it('ASCII es un byte por carácter', () => {
    expect(utf8Length('abc123')).toBe(6);
  });

  it('una vocal acentuada son dos', () => {
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('José')).toBe(5);
  });

  it('un carácter CJK son tres', () => {
    expect(utf8Length('円')).toBe(3);
  });

  it('un emoji —par suplente— son cuatro, no seis', () => {
    // Contarlo como dos unidades de tres bytes es el error clásico y
    // sobreestimaría el tamaño del payload.
    const purse = String.fromCodePoint(0x1f45b);
    expect(purse.length).toBe(2);
    expect(utf8Length(purse)).toBe(4);
  });

  it('la cadena vacía son cero', () => {
    expect(utf8Length('')).toBe(0);
  });

  it('coincide con lo que mediría un encoder real', () => {
    const samples = ['', 'abc', 'José Luis', '円 y €', `a${String.fromCodePoint(0x1f4b0)}b`];
    for (const sample of samples) {
      expect(utf8Length(sample)).toBe(new TextEncoder().encode(sample).length);
    }
  });
});

describe('medición de lo almacenado', () => {
  it('sin nada guardado dice que no hay sesión', async () => {
    const { backend } = memoryBackend();
    await expect(measureStoredSession(backend, KEY)).resolves.toEqual(NO_SESSION_STORED);
  });

  it('mide un valor real escrito por el propio almacén', async () => {
    const { backend } = memoryBackend();
    const store = createChunkedStore(backend);
    const value = 'a'.repeat(CHUNKED_STORAGE_LIMITS.chunkSize * 3 + 10);

    await store.setItem(KEY, value);
    const metrics = await measureStoredSession(backend, KEY);

    expect(metrics.present).toBe(true);
    expect(metrics.codeUnits).toBe(value.length);
    expect(metrics.utf8Bytes).toBe(value.length); // ASCII
    expect(metrics.chunks).toBe(4);
    expect(metrics.largestChunkBytes).toBe(CHUNKED_STORAGE_LIMITS.chunkSize);
  });

  it('un valor corto es un solo chunk', async () => {
    const { backend } = memoryBackend();
    await createChunkedStore(backend).setItem(KEY, 'sesión breve');

    const metrics = await measureStoredSession(backend, KEY);

    expect(metrics.chunks).toBe(1);
    expect(metrics.utf8Bytes).toBe(utf8Length('sesión breve'));
  });

  it('ningún chunk supera el límite: es lo que hace segura la escritura', async () => {
    const { backend } = memoryBackend();
    const store = createChunkedStore(backend);
    // Texto no ASCII, que es el peor caso en bytes por unidad.
    await store.setItem(KEY, 'ó'.repeat(CHUNKED_STORAGE_LIMITS.chunkSize * 2));

    const metrics = await measureStoredSession(backend, KEY);

    expect(metrics.largestChunkBytes).toBeLessThanOrEqual(2048);
  });

  it('un manifiesto ilegible se reporta como ausencia, no revienta', async () => {
    const { backend, entries } = memoryBackend();
    await createChunkedStore(backend).setItem(KEY, 'algo');
    entries.set(KEY, 'esto no es JSON');

    await expect(measureStoredSession(backend, KEY)).resolves.toEqual(NO_SESSION_STORED);
  });

  it('un chunk ausente no se inventa', async () => {
    const { backend, entries } = memoryBackend();
    await createChunkedStore(backend).setItem(
      KEY,
      'b'.repeat(CHUNKED_STORAGE_LIMITS.chunkSize * 3),
    );
    entries.delete(`${KEY}.1`);

    const metrics = await measureStoredSession(backend, KEY);

    expect(metrics.chunks).toBe(2);
  });

  it('NO devuelve contenido: solo números y un booleano', async () => {
    const { backend } = memoryBackend();
    await createChunkedStore(backend).setItem(KEY, 'un-token-que-no-debe-salir-de-aqui');

    const metrics = await measureStoredSession(backend, KEY);

    expect(Object.keys(metrics).sort()).toEqual([
      'chunks',
      'codeUnits',
      'largestChunkBytes',
      'present',
      'utf8Bytes',
    ]);
    for (const [key, value] of Object.entries(metrics)) {
      expect(typeof value).toBe(key === 'present' ? 'boolean' : 'number');
    }
    expect(JSON.stringify(metrics)).not.toContain('token');
  });
});
