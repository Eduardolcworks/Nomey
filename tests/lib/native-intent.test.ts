import { describe, expect, it } from 'vitest';

import { redirectSystemPath } from '../../src/app/+native-intent';
import { RECOVERY_PATH } from '../../src/features/auth/recovery-link';

/**
 * Qué URLs entrantes son pantallas y cuál no.
 *
 * Escrito tras un fallo real en iPhone: el enlace de recuperación llegaba a
 * NUESTRO listener —el aviso «Cierra sesión para continuar» salía bien— y
 * también al de Expo Router, que intentaba navegar a `/auth/recovery`, no
 * encontraba ruta y pintaba «Unmatched Route» encima. Dos suscriptores a la
 * misma URL, uno de ellos sin nada que hacer ahí.
 *
 * Es puro y se ejecuta: recibe una cadena y devuelve otra o `null`.
 */

const HASH = 'af45ad58765ec951b302ce027a00180e83d2ee16404fc61eb0b12f28';
const intent = (initial = false) => ({ initial });

describe('el intent de recuperación no es una pantalla', () => {
  it('la forma de una build propia se detiene aquí', () => {
    expect(
      redirectSystemPath({
        path: `nomey-dev://auth/recovery?token_hash=${HASH}&type=recovery`,
        ...intent(),
      }),
    ).toBeNull();
  });

  it('y la de Expo Go también, que trae otro host y el prefijo `/--/`', () => {
    expect(
      redirectSystemPath({
        path: `exp://192.168.8.110:8081/--/auth/recovery?token_hash=${HASH}&type=recovery`,
        ...intent(),
      }),
    ).toBeNull();
  });

  it('en arranque en frío igual que con la app abierta', () => {
    // `initial` no cambia la respuesta: no es una pantalla en ningún momento.
    const path = `nomey-dev://auth/recovery?token_hash=${HASH}&type=recovery`;
    expect(redirectSystemPath({ path, ...intent(true) })).toBeNull();
    expect(redirectSystemPath({ path, ...intent(false) })).toBeNull();
  });

  it('sin query también, porque la decisión no depende del token', () => {
    expect(redirectSystemPath({ path: 'nomey-dev://auth/recovery', ...intent() })).toBeNull();
    expect(redirectSystemPath({ path: 'nomey-dev://auth/recovery/', ...intent() })).toBeNull();
  });

  it('y el path que compara es el mismo que lee el parser', () => {
    // Una sola fuente de verdad: si cambiara la ruta del intent, cambiarían
    // las dos a la vez.
    expect(RECOVERY_PATH).toBe('auth/recovery');
  });
});

describe('todo lo demás sigue siendo del router', () => {
  it('una URL cualquiera se devuelve intacta', () => {
    for (const path of [
      'nomey-dev://profile',
      'exp://192.168.8.110:8081/--/groups',
      'nomey-dev://auth/recovery-extra',
      'https://nomey.example/algo',
      '/',
    ]) {
      expect(redirectSystemPath({ path, ...intent() })).toBe(path);
    }
  });

  it('un enlace de confirmación de alta NO se bloquea', () => {
    // Sólo la recuperación es un intent. Cualquier otro camino de auth que
    // llegue a existir sigue su curso normal por el router.
    const path = `nomey-dev://auth/confirm?token_hash=${HASH}&type=signup`;
    expect(redirectSystemPath({ path, ...intent() })).toBe(path);
  });
});

describe('no sabe nada de autenticación', () => {
  it('devuelve `null` sea cual sea el token, porque no lo mira', () => {
    // La decisión es del path. El token se descarta antes de comparar.
    expect(
      redirectSystemPath({ path: 'nomey-dev://auth/recovery?token_hash=basura', ...intent() }),
    ).toBeNull();
    expect(
      redirectSystemPath({ path: 'nomey-dev://auth/recovery?type=otro', ...intent() }),
    ).toBeNull();
  });

  it('no revienta con una entrada rara', () => {
    // El propio tipo avisa de que lanzar aquí puede tumbar la app.
    expect(() => redirectSystemPath({ path: '', ...intent() })).not.toThrow();
    expect(() => redirectSystemPath({ path: '?????', ...intent() })).not.toThrow();
  });
});
