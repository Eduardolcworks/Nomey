import { describe, expect, it } from 'vitest';

import {
  missingFields,
  normaliseCredentials,
  normaliseDisplayName,
  normaliseEmail,
  normaliseRegistration,
} from '../../src/features/auth/credentials';
import { createExclusiveRunner, SKIPPED } from '../../src/features/auth/submit-guard';

/**
 * Normalización de lo que se teclea, y el guardia del doble envío.
 *
 * La validación local es deliberadamente mínima: **el backend es la
 * autoridad**. GoTrue tiene la política de contraseña y la definición de
 * dirección válida, y una segunda copia aquí acabaría divergiendo — con la
 * local siendo la que nadie actualiza.
 */

describe('normalización', () => {
  describe('email', () => {
    it('recorta, que es lo que deja el autocompletado de iOS', () => {
      expect(normaliseEmail('  ana@example.com  ')).toBe('ana@example.com');
    });

    it('pasa a minúsculas: quien se registra como Ana@ y entra como ana@ es la misma persona', () => {
      expect(normaliseEmail('Ana@Example.COM')).toBe('ana@example.com');
    });
  });

  describe('nombre', () => {
    it('solo recorta', () => {
      expect(normaliseDisplayName('  Ana María  ')).toBe('Ana María');
    });

    it('NO toca mayúsculas ni acentos ni partículas', () => {
      // Cualquier regla más allá del recorte se equivoca con algún nombre.
      expect(normaliseDisplayName('van der BERG')).toBe('van der BERG');
      expect(normaliseDisplayName('Ñuño')).toBe('Ñuño');
    });

    it('conserva los espacios interiores', () => {
      expect(normaliseDisplayName(' José  Luis ')).toBe('José  Luis');
    });
  });

  describe('contraseña', () => {
    it('NO se recorta: recortarla la cambia', () => {
      const spaced = '  con espacios  ';
      expect(normaliseCredentials({ email: 'a@b.c', password: spaced }).password).toBe(spaced);
    });
  });

  it('el registro normaliza los tres campos a la vez', () => {
    expect(
      normaliseRegistration({
        displayName: '  Ana  ',
        email: '  ANA@Example.com ',
        password: ' secreta ',
      }),
    ).toEqual({ displayName: 'Ana', email: 'ana@example.com', password: ' secreta ' });
  });
});

describe('campos que faltan', () => {
  it('no protesta cuando están los tres', () => {
    expect(missingFields({ displayName: 'Ana', email: 'a@b.c', password: 'x' })).toEqual([]);
  });

  it('detecta un nombre que era solo espacios', () => {
    expect(missingFields({ displayName: '   ', email: 'a@b.c', password: 'x' })).toEqual([
      'displayName',
    ]);
  });

  it('detecta el email y la contraseña vacíos', () => {
    expect(missingFields({ email: '  ', password: '' })).toEqual(['email', 'password']);
  });

  it('no exige nombre donde no se pide, que es el inicio de sesión', () => {
    expect(missingFields({ email: 'a@b.c', password: 'x' })).toEqual([]);
  });

  it('NO juzga la fuerza de la contraseña: eso lo decide GoTrue', () => {
    expect(missingFields({ email: 'a@b.c', password: '1' })).toEqual([]);
  });

  it('NO juzga la forma del email: también lo decide GoTrue', () => {
    expect(missingFields({ email: 'esto-no-es-un-email', password: 'x' })).toEqual([]);
  });
});

describe('guardia del doble envío', () => {
  function deferred() {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('deja pasar el primero', async () => {
    const run = createExclusiveRunner();
    await expect(run(async () => 'hecho')).resolves.toBe('hecho');
  });

  it('descarta el segundo mientras el primero sigue en vuelo', async () => {
    const run = createExclusiveRunner();
    const first = deferred();

    const a = run(() => first.promise);
    const b = await run(async () => 'segundo');

    expect(b).toBe(SKIPPED);

    first.resolve('primero');
    await expect(a).resolves.toBe('primero');
  });

  it('vuelve a admitir envíos cuando el primero termina', async () => {
    const run = createExclusiveRunner();
    await run(async () => 'uno');
    await expect(run(async () => 'dos')).resolves.toBe('dos');
  });

  it('un fallo NO deja el formulario bloqueado para siempre', async () => {
    // Es el punto entero: un error recuperable tiene que poder reintentarse.
    const run = createExclusiveRunner();
    await expect(run(() => Promise.reject(new Error('sin red')))).rejects.toThrow('sin red');

    await expect(run(async () => 'reintento')).resolves.toBe('reintento');
  });

  it('varios toques seguidos solo ejecutan una vez', async () => {
    const run = createExclusiveRunner();
    const held = deferred();
    let ejecuciones = 0;

    const inFlight = run(() => {
      ejecuciones += 1;
      return held.promise;
    });
    await run(async () => {
      ejecuciones += 1;
      return 'x';
    });
    await run(async () => {
      ejecuciones += 1;
      return 'x';
    });

    expect(ejecuciones).toBe(1);
    held.resolve('fin');
    await inFlight;
  });
});
