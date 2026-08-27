import { describe, expect, it } from 'vitest';

import { EnvError, readSupabaseEnv } from '../../src/lib/env/supabase-env';

/**
 * Validación del entorno público de Supabase.
 *
 * Dos de estas comprobaciones son de comodidad —falta la URL, falta la clave— y
 * las otras dos son de seguridad. `EXPO_PUBLIC_*` se inlinea en el bundle, así
 * que una clave secreta pegada en la variable del cliente funcionaría
 * perfectamente en desarrollo y publicaría credenciales de backend a todo el
 * que descargue el binario. Es el invariante de `AGENTS.md` §7, y aquí se
 * comprueba en vez de confiarse.
 */

const VALID = {
  url: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_abcdef0123456789',
};

describe('readSupabaseEnv', () => {
  it('acepta una URL y una clave publicable válidas', () => {
    expect(readSupabaseEnv(VALID)).toEqual(VALID);
  });

  it('recorta los espacios, que es lo que deja un .env copiado a mano', () => {
    expect(
      readSupabaseEnv({ url: `  ${VALID.url}  `, publishableKey: ` ${VALID.publishableKey}\n` }),
    ).toEqual(VALID);
  });

  it('acepta https, que es lo que habrá fuera de local', () => {
    const url = 'https://abcdefgh.supabase.co';
    expect(readSupabaseEnv({ ...VALID, url }).url).toBe(url);
  });

  describe('la URL', () => {
    it('falla si no está', () => {
      expect(() => readSupabaseEnv({ ...VALID, url: undefined })).toThrow(EnvError);
    });

    it('falla si está vacía o es solo espacios', () => {
      expect(() => readSupabaseEnv({ ...VALID, url: '   ' })).toThrow(/missing or empty/);
    });

    it('falla si no es http(s)', () => {
      expect(() => readSupabaseEnv({ ...VALID, url: 'ftp://127.0.0.1' })).toThrow(
        /not an http\(s\) URL/,
      );
    });

    it('falla si no lleva host', () => {
      expect(() => readSupabaseEnv({ ...VALID, url: 'https://' })).toThrow(/not an http\(s\) URL/);
    });

    it('nombra la variable en el mensaje, que es lo único que ayuda a arreglarlo', () => {
      expect(() => readSupabaseEnv({ ...VALID, url: '' })).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
    });
  });

  describe('la clave', () => {
    it('falla si no está', () => {
      expect(() => readSupabaseEnv({ ...VALID, publishableKey: undefined })).toThrow(EnvError);
    });

    it('falla si está vacía', () => {
      expect(() => readSupabaseEnv({ ...VALID, publishableKey: '' })).toThrow(/missing or empty/);
    });

    it('RECHAZA una clave secreta, y lo dice por su nombre', () => {
      expect(() =>
        readSupabaseEnv({ ...VALID, publishableKey: 'sb_secret_deadbeefdeadbeef' }),
      ).toThrow(/SECRET key/);
    });

    it('RECHAZA una clave JWT heredada, que es como se cuela un service_role', () => {
      const legacy = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x';
      expect(() => readSupabaseEnv({ ...VALID, publishableKey: legacy })).toThrow(/legacy JWT/);
    });

    it('falla si simplemente no tiene forma de clave publicable', () => {
      expect(() => readSupabaseEnv({ ...VALID, publishableKey: 'no-es-una-clave' })).toThrow(
        /sb_publishable_/,
      );
    });
  });
});
