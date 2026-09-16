import { describe, expect, it } from 'vitest';

import {
  convertGuestErrorKey,
  signInAnonymouslyErrorKey,
  signInErrorKey,
  signUpErrorKey,
} from '../../src/features/auth/auth-errors';
import { esES } from '../../src/lib/i18n/messages/es-ES';

/**
 * Qué se le cuenta al usuario cuando la autenticación falla.
 *
 * Dos de estas comprobaciones son de traducción y las demás son de
 * **privacidad**. GoTrue evita a propósito revelar si una dirección tiene
 * cuenta; un mapeo que «ayuda» distinguiendo «no existe» de «contraseña
 * incorrecta» rompe esa propiedad desde nuestro lado y convierte el
 * formulario en un oráculo de cuentas.
 *
 * Por eso hay dos aserciones que parecen raras y son las importantes:
 * credenciales inválidas y usuario inexistente comparten mensaje, y un email
 * ya registrado en el alta responde lo mismo que el camino feliz.
 */

const codes = (code: string) => ({ code, status: 400 });

describe('errores de inicio de sesión', () => {
  it('credenciales incorrectas dan un mensaje genérico', () => {
    expect(signInErrorKey(codes('invalid_credentials'))).toBe('authError.invalidCredentials');
  });

  it('un usuario que no existe da EXACTAMENTE el mismo mensaje', () => {
    // Si estas dos divergen, el formulario dice si una dirección tiene cuenta.
    expect(signInErrorKey(codes('user_not_found'))).toBe(
      signInErrorKey(codes('invalid_credentials')),
    );
  });

  it('un email sin confirmar sí tiene su propio mensaje', () => {
    // Aquí no hay fuga: quien lo ve acaba de acertar la contraseña.
    expect(signInErrorKey(codes('email_not_confirmed'))).toBe('authError.emailNotConfirmed');
  });

  it('el rate limit se distingue, porque el usuario puede actuar', () => {
    expect(signInErrorKey(codes('over_request_rate_limit'))).toBe('authError.rateLimited');
  });

  it('una cuenta bloqueada no dice por qué', () => {
    expect(signInErrorKey(codes('user_banned'))).toBe('authError.accountUnavailable');
  });
});

describe('errores de registro', () => {
  it('una contraseña débil lo dice', () => {
    expect(signUpErrorKey(codes('weak_password'))).toBe('authError.weakPassword');
  });

  it('un email inválido lo dice', () => {
    expect(signUpErrorKey(codes('email_address_invalid'))).toBe('authError.invalidEmail');
  });

  it('el registro cerrado lo dice', () => {
    expect(signUpErrorKey(codes('signup_disabled'))).toBe('authError.signUpDisabled');
  });

  it('un email YA REGISTRADO responde «revisa tu correo», no «ya existe»', () => {
    // GoTrue oculta este hecho a propósito cuando hay confirmación. Decirlo
    // aquí lo destaparía justo en el formulario que más se prueba a mano.
    expect(signUpErrorKey(codes('user_already_exists'))).toBe('authError.checkYourEmail');
    expect(signUpErrorKey(codes('email_exists'))).toBe('authError.checkYourEmail');
  });
});

describe('invitado: entrar como invitado y convertirse en cuenta (F05/ADR-003)', () => {
  it('un proyecto sin anonymous sign-ins responde su propia frase, no la generica', () => {
    expect(signInAnonymouslyErrorKey(codes('anonymous_provider_disabled'))).toBe(
      'authError.guestUnavailable',
    );
    expect(signInAnonymouslyErrorKey(codes('over_request_rate_limit'))).toBe(
      'authError.rateLimited',
    );
  });

  it('la conversion dice tal cual que el email ya tiene cuenta: PUT /user no lo ofusca', () => {
    expect(convertGuestErrorKey(codes('email_exists'))).toBe('authError.guestEmailTaken');
    expect(convertGuestErrorKey(codes('user_already_exists'))).toBe('authError.guestEmailTaken');
    expect(convertGuestErrorKey(codes('weak_password'))).toBe('authError.weakPassword');
  });

  it('F · el segundo intento tras una conversion ya confirmada (same_password, medido) tiene su frase', () => {
    // MEDIDO contra GoTrue: el servidor ya convirtio al usuario; el cliente,
    // con la copia anonima, reenvia el mismo email y la misma contraseña, y
    // GoTrue responde 422 same_password. El servicio pregunta antes y
    // refresca; si aun asi llega, no es «Algo ha ido mal».
    expect(convertGuestErrorKey(codes('same_password'))).toBe('authError.guestAlreadyConverted');
    expect(esES['authError.guestAlreadyConverted']).toContain('ya es una cuenta');
  });
});

describe('fallos sin respuesta del servidor', () => {
  it('un fallo de red se reconoce por el nombre del error', () => {
    expect(signInErrorKey({ name: 'AuthRetryableFetchError' })).toBe('authError.network');
    expect(signUpErrorKey({ name: 'AuthRetryableFetchError' })).toBe('authError.network');
  });

  it('sin código ni estado tampoco hubo respuesta', () => {
    expect(signInErrorKey({})).toBe('authError.network');
  });

  it('un código desconocido cae en el genérico, nunca en el texto crudo', () => {
    expect(signInErrorKey(codes('algo_que_no_conocemos'))).toBe('authError.generic');
    expect(signUpErrorKey(codes('algo_que_no_conocemos'))).toBe('authError.generic');
  });
});

describe('todo lo que se mapea existe en el catálogo', () => {
  const CODES = [
    'invalid_credentials',
    'user_not_found',
    'email_not_confirmed',
    'user_banned',
    'weak_password',
    'email_address_invalid',
    'email_address_not_authorized',
    'signup_disabled',
    'email_provider_disabled',
    'user_already_exists',
    'email_exists',
    'anonymous_provider_disabled',
    'same_password',
    'over_request_rate_limit',
    'over_email_send_rate_limit',
    'validation_failed',
    'request_timeout',
    'desconocido',
  ];

  it.each(CODES)('«%s» resuelve a una clave traducida', (code) => {
    for (const key of [
      signInErrorKey(codes(code)),
      signUpErrorKey(codes(code)),
      signInAnonymouslyErrorKey(codes(code)),
      convertGuestErrorKey(codes(code)),
    ]) {
      expect(Object.keys(esES)).toContain(key);
    }
  });

  it('ninguna clave de error devuelve texto del servidor', () => {
    // El mapeo solo puede devolver claves `authError.*`; el mensaje original
    // no tiene forma de salir de aquí.
    for (const code of CODES) {
      expect(signInErrorKey(codes(code))).toMatch(/^authError\./);
      expect(signUpErrorKey(codes(code))).toMatch(/^authError\./);
    }
  });
});
