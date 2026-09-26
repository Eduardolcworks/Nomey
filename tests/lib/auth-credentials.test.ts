import { describe, expect, it } from 'vitest';

import {
  missingFields,
  normaliseCredentials,
  normaliseDisplayName,
  normaliseEmail,
  normaliseRegistration,
  normaliseUsername,
  PASSWORD_MIN_LENGTH,
  passwordMeetsMinimum,
  registrationReady,
  usernameProblem,
} from '../../src/features/auth/credentials';
import { createExclusiveRunner, SKIPPED } from '../../src/features/auth/submit-guard';
import CONFIG from '../../supabase/config.toml?raw';

describe('el minimo de contraseña que se dice de antemano', () => {
  it('es EL DEL SERVIDOR: [auth] minimum_password_length del toml, y no puede divergir', () => {
    // La unica regla de contraseña que el cliente afirma. Si el toml cambia sin
    // cambiar la constante (o al reves), este test lo dice antes que un usuario.
    const auth = CONFIG.slice(CONFIG.indexOf('\n[auth]\n'), CONFIG.indexOf('\n[auth.rate_limit]'));
    const match = /\nminimum_password_length = (\d+)\n/.exec(auth);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(PASSWORD_MIN_LENGTH);
    // Y no se afirman clases de caracteres que el servidor no exige.
    expect(auth).toContain('\npassword_requirements = ""\n');
  });

  it('cuenta caracteres sin recortar, como el servidor', () => {
    expect(passwordMeetsMinimum('12345')).toBe(false);
    expect(passwordMeetsMinimum('123456')).toBe(true);
    expect(passwordMeetsMinimum('     6')).toBe(true);
  });

  it('un alta esta lista con nombre, username valido, email y contraseña al minimo; nada mas se juzga', () => {
    const base = {
      displayName: 'Edu',
      username: 'Edu_1',
      email: 'edu@nomey.test',
      password: 'secreto',
    };
    expect(registrationReady(base)).toBe(true);
    expect(registrationReady({ ...base, password: 'corta' })).toBe(false);
    expect(registrationReady({ ...base, displayName: '  ' })).toBe(false);
    expect(registrationReady({ ...base, email: '' })).toBe(false);
    // El username si se juzga en su SINTAXIS (F12/ADR-001 §3-§4, dominio compartido):
    expect(registrationReady({ ...base, username: '' })).toBe(false);
    expect(registrationReady({ ...base, username: 'ed' })).toBe(false);
    expect(registrationReady({ ...base, username: 'admin_edu' })).toBe(false);
    // Y con @ delante tampoco: el formulario no lo acepta aunque el dominio
    // sepa quitarlo (ver el caso 'at' de abajo).
    expect(registrationReady({ ...base, username: '@Edu_1' })).toBe(false);
    // Lo que es un email lo decide el servidor: aqui basta con que haya algo.
    expect(registrationReady({ ...base, email: 'sin-arroba' })).toBe(true);
  });
});

describe('el username, antes del viaje (F12/ADR-001 §3)', () => {
  it('dice vacio, invalido o reservado; nunca «en uso», que solo sabe el servidor', () => {
    expect(usernameProblem('   ')).toBe('empty');
    expect(usernameProblem('ab')).toBe('invalid');
    expect(usernameProblem('ana__lopez')).toBe('invalid');
    expect(usernameProblem('eduardo_álvarez')).toBe('invalid');
    expect(usernameProblem('nomey_pay')).toBe('reserved');
    expect(usernameProblem('help')).toBe('reserved');
    expect(usernameProblem('aitor')).toBeNull();
  });

  /*
   * EL @ ES DEL FORMULARIO, NO DEL DOMINIO.
   *
   * `normalizeHandle` sigue quitando un `@` inicial —es el contrato compartido
   * con `sec.assert_handle_valid` y con `tests/vectors/username.json`, y no se
   * toca—, pero el formulario ya no lo acepta: el campo no lo enseña en
   * ninguna parte, así que escribirlo es un error de quien escribe. Lo que NO
   * se hace es quitarlo en silencio.
   */
  it('un @ al principio es un problema del formulario, y se dice antes de enviar', () => {
    expect(usernameProblem('@aitor')).toBe('at');
    expect(usernameProblem(' @Eduardo ')).toBe('at');
    expect(usernameProblem('@usuario123')).toBe('at');
    // Incluso si lo que sigue al @ tampoco valdría: el mensaje es el del @,
    // que es lo que sobra, y no «solo letras minusculas…».
    expect(usernameProblem('@ab')).toBe('at');
    // Y un @ que no va al principio sigue siendo sintaxis invalida de siempre.
    expect(usernameProblem('ait@r')).toBe('invalid');
  });

  it('se envia en su forma almacenada —sin @, en minusculas— y, si no la tiene, tal cual recortado', () => {
    expect(normaliseUsername(' @Eduardo ')).toBe('eduardo');
    expect(normaliseUsername('Ana_Lopez')).toBe('ana_lopez');
    // Invalido: se manda lo tecleado (recortado) y el servidor lo rehusa con su codigo.
    expect(normaliseUsername(' ab ')).toBe('ab');
  });
});

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

  it('el registro normaliza los cuatro campos a la vez', () => {
    expect(
      normaliseRegistration({
        displayName: '  Ana  ',
        username: ' @Ana_Lopez ',
        email: '  ANA@Example.com ',
        password: ' secreta ',
      }),
    ).toEqual({
      displayName: 'Ana',
      username: 'ana_lopez',
      email: 'ana@example.com',
      password: ' secreta ',
    });
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

  it('detecta el username vacío solo donde se pide', () => {
    expect(
      missingFields({ displayName: 'Ana', username: ' ', email: 'a@b.c', password: 'x' }),
    ).toEqual(['username']);
    // Y solo juzga que haya algo: la sintaxis es de usernameProblem, la unicidad del servidor.
    expect(
      missingFields({ displayName: 'Ana', username: 'ab', email: 'a@b.c', password: 'x' }),
    ).toEqual([]);
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
