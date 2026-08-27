import { describe, expect, it } from 'vitest';

import { readRecoveryLink } from '../../src/features/auth/recovery-link';
import { passwordProblem } from '../../src/features/auth/credentials';
import { recoveryErrorKey } from '../../src/features/auth/auth-errors';
import {
  isPublic,
  isRecovering,
  isSignedIn,
  RECOVERING,
} from '../../src/features/session/session-state';

/**
 * Recuperación de acceso: lo puro, ejecutado de verdad.
 *
 * El enlace es la única entrada no autenticada del bloque, así que su lectura
 * es lo que más merece ejecutarse en vez de leerse. Todo lo de aquí es puro:
 * ni React Native, ni red, ni Supabase.
 */

const HASH = 'af45ad58765ec951b302ce027a00180e83d2ee16404fc61eb0b12f28';
const LINK = `nomey-dev://auth/recovery?token_hash=${HASH}&type=recovery`;

describe('leer el enlace de recuperación', () => {
  it('un enlace válido da la prueba', () => {
    expect(readRecoveryLink(LINK)).toEqual({ tokenHash: HASH });
  });

  it('acepta también la forma de Expo Go, que trae otro host', () => {
    // El destino es el mismo; sólo cambia por dónde entra.
    expect(
      readRecoveryLink(`exp://192.168.1.50:8081/--/auth/recovery?token_hash=${HASH}&type=recovery`),
    ).toEqual({ tokenHash: HASH });
  });

  it('sin `type=recovery` NO es un recovery', () => {
    /*
     * Impide que un enlace de confirmación o de cambio de email abra la
     * superficie de contraseña nueva. No es que confiemos en el `type` —lo
     * verifica el servidor— sino que sin él ni siquiera lo intentamos.
     */
    expect(readRecoveryLink(`nomey-dev://auth/recovery?token_hash=${HASH}`)).toBeNull();
    expect(readRecoveryLink(`nomey-dev://auth/recovery?token_hash=${HASH}&type=signup`)).toBeNull();
    expect(
      readRecoveryLink(`nomey-dev://auth/recovery?token_hash=${HASH}&type=email_change`),
    ).toBeNull();
  });

  it('otra ruta no es un recovery aunque traiga el hash', () => {
    expect(readRecoveryLink(`nomey-dev://auth/otra?token_hash=${HASH}&type=recovery`)).toBeNull();
    expect(readRecoveryLink(`nomey-dev://?token_hash=${HASH}&type=recovery`)).toBeNull();
  });

  it('un hash ausente o malformado no es una prueba', () => {
    expect(readRecoveryLink('nomey-dev://auth/recovery?type=recovery')).toBeNull();
    expect(readRecoveryLink('nomey-dev://auth/recovery?token_hash=&type=recovery')).toBeNull();
    expect(readRecoveryLink('nomey-dev://auth/recovery?token_hash=corto&type=recovery')).toBeNull();
    // Mayúsculas y no-hex: los hashes de GoTrue son hex en minúscula.
    expect(
      readRecoveryLink(`nomey-dev://auth/recovery?token_hash=${HASH.toUpperCase()}&type=recovery`),
    ).toBeNull();
  });

  it('lo que no es un enlace tampoco lo es', () => {
    expect(readRecoveryLink(null)).toBeNull();
    expect(readRecoveryLink(undefined)).toBeNull();
    expect(readRecoveryLink('')).toBeNull();
    expect(readRecoveryLink('nomey-dev://auth/recovery')).toBeNull();
  });

  it('NUNCA acepta una sesión venida en la URL', () => {
    /*
     * La forma que se rechazó al elegir la arquitectura: el rebote por
     * navegador dejaba access y refresh token en el fragmento. Si alguien
     * reintrodujera ese camino, esto no lo leería como recovery.
     */
    const fragment = 'nomey-dev://auth/recovery#access_token=aaa&refresh_token=bbb&type=recovery';
    expect(readRecoveryLink(fragment)).toBeNull();
  });
});

describe('la contraseña nueva', () => {
  it('vacía se rechaza antes de salir del dispositivo', () => {
    expect(passwordProblem('', '')).toBe('empty');
  });

  it('si las dos no coinciden, se dice', () => {
    expect(passwordProblem('CorrectHorse1!', 'CorrectHorse1')).toBe('mismatch');
  });

  it('coincidiendo, no hay nada que objetar aquí', () => {
    expect(passwordProblem('CorrectHorse1!', 'CorrectHorse1!')).toBeNull();
  });

  it('no recorta espacios: forman parte de la contraseña', () => {
    // Recortar cambiaría en silencio lo que la persona eligió.
    expect(passwordProblem(' pass ', ' pass ')).toBeNull();
    expect(passwordProblem(' pass ', 'pass')).toBe('mismatch');
  });

  it('y no reimplementa la política del servidor', () => {
    // Corta, sin dígitos y sin símbolos: aquí pasa, y la rechaza GoTrue si
    // procede. Dos copias de la política es tener una que nadie actualiza.
    expect(passwordProblem('abc', 'abc')).toBeNull();
  });
});

describe('qué se le cuenta al usuario cuando falla', () => {
  it('un enlace muerto tiene su propia frase', () => {
    expect(recoveryErrorKey({ code: 'otp_expired', status: 403 })).toBe(
      'authError.recoveryLinkDead',
    );
  });

  it('usado, caducado e inventado son EL MISMO mensaje', () => {
    /*
     * Medido: los tres responden 403 `otp_expired`. Distinguirlos sería
     * decirle a quien tenga un enlace robado qué clase de fallo ha encontrado.
     */
    expect(recoveryErrorKey({ code: 'otp_expired', status: 403 })).toBe(
      recoveryErrorKey({ code: 'otp_disabled', status: 403 }),
    );
  });

  it('sin red se dice que no hay red', () => {
    expect(recoveryErrorKey({ name: 'AuthRetryableFetchError' })).toBe('authError.network');
  });

  it('y no existe ninguna frase para «ese email no está registrado»', () => {
    // GoTrue responde 200 exista o no la cuenta, así que no hay nada que
    // mapear. Una frase así convertiría el formulario en un oráculo.
    expect(recoveryErrorKey({ code: 'user_not_found', status: 404 })).toBe('authError.generic');
  });
});

describe('recovery no es un login', () => {
  it('`recovering` es su propio estado', () => {
    expect(isRecovering(RECOVERING)).toBe(true);
  });

  it('y NO cuenta como sesión iniciada', () => {
    // La trampa entera del bloque: `verifyOtp` devuelve una sesión real, así
    // que sin este estado la persona aterrizaría en Inicio a medio recuperar.
    expect(isSignedIn(RECOVERING)).toBe(false);
  });

  it('ni como pública: llegar aquí exigió una prueba que el servidor validó', () => {
    expect(isPublic(RECOVERING)).toBe(false);
  });

  it('los tres predicados de ruta son mutuamente excluyentes', () => {
    const states = [
      { status: 'restoring' },
      { status: 'signed-out' },
      { status: 'recovering' },
      { status: 'signed-in', identity: { userId: 'u', email: null, displayName: null } },
      { status: 'unavailable' },
    ] as const;

    for (const state of states) {
      const branches = [isPublic(state), isRecovering(state), isSignedIn(state)].filter(Boolean);
      expect(branches.length).toBeLessThanOrEqual(1);
    }
  });
});
