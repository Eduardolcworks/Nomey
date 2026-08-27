import { describe, expect, it } from 'vitest';

import { buildClientOptions, SESSION_STORAGE_KEY } from '../../src/lib/supabase/client-options';
import type { StorageBackend } from '../../src/lib/supabase/chunked-storage';

/**
 * La configuración del cliente, comprobada sobre el objeto real y no sobre el
 * texto del fuente.
 *
 * Por eso `buildClientOptions` recibe el almacén en vez de importarlo: así este
 * test no arrastra `expo-secure-store` —un módulo nativo que no existe en
 * Vitest— ni el entorno validado, y aun así comprueba exactamente lo que se le
 * pasa a `createClient`.
 *
 * Ninguna de estas cuatro es una preferencia de estilo:
 *
 * - `schema: 'api'` — sin él el cliente pide `public`, que ADR-014 retiró de
 *   los schemas expuestos, y **todas** las llamadas responden 406 PGRST106.
 * - `storage` — sin él la sesión se guarda donde decida la librería.
 * - `persistSession` — es el criterio 2 del cierre de la fase.
 * - `autoRefreshToken` — sin él el token muere a la hora y la app se queda
 *   autenticada de mentira.
 */

const fakeStorage: StorageBackend = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

describe('opciones del cliente Supabase', () => {
  const options = buildClientOptions(fakeStorage);

  it('apunta al schema `api`, la única superficie expuesta', () => {
    expect(options.db?.schema).toBe('api');
  });

  it('usa el almacén que se le da, y no el de la librería', () => {
    expect(options.auth?.storage).toBe(fakeStorage);
  });

  it('fija la clave de almacenamiento en vez de derivarla de la URL', () => {
    expect(options.auth?.storageKey).toBe(SESSION_STORAGE_KEY);
    expect(SESSION_STORAGE_KEY).not.toMatch(/^sb-/);
  });

  it('persiste la sesión', () => {
    expect(options.auth?.persistSession).toBe(true);
  });

  it('renueva el token solo', () => {
    expect(options.auth?.autoRefreshToken).toBe(true);
  });

  it('no busca la sesión en una URL, que es una suposición de web', () => {
    expect(options.auth?.detectSessionInUrl).toBe(false);
  });

  it('no pasa `lock`, que esta versión marca como deprecado', () => {
    // Las guías de React Native más antiguas mandan añadir `processLock`.
    // supabase-js 2.112 lo deprecó y lo retira en v3.
    expect(options.auth).not.toHaveProperty('lock');
  });

  it('no fija `flowType`: lo decide F5.C/E con los enlaces de correo', () => {
    expect(options.auth).not.toHaveProperty('flowType');
  });
});
