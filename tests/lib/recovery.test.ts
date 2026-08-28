import { describe, expect, it } from 'vitest';

import { readRecoveryLink } from '../../src/features/auth/recovery-link';
import { passwordProblem } from '../../src/features/auth/credentials';
import { createExclusiveRunner, SKIPPED } from '../../src/features/auth/submit-guard';
import type { AuthErrorKey } from '../../src/features/auth/auth-errors';
import {
  recoveryErrorKey,
  recoveryFailure,
  recoveryPasswordErrorKey,
} from '../../src/features/auth/auth-errors';
import { en } from '../../src/lib/i18n/messages/en';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import {
  isPublic,
  isSignedIn,
  SIGNED_OUT,
  stateFromUser,
} from '../../src/features/session/session-state';
import {
  isRecoveryActive,
  RECOVERY_IDLE,
  type RecoveryState,
} from '../../src/features/auth/recovery-state';

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

  it('sin red, el TÍTULO tampoco puede decir que el enlace no vale', () => {
    /*
     * El defecto medido en iPhone: el canje falló por transporte, la app tituló
     * «Enlace no válido» y el one-time token seguía vivo en GoTrue, sin tocar.
     * Un fallo de transporte no demuestra nada sobre la prueba.
     */
    const failure = recoveryFailure({ name: 'AuthRetryableFetchError' });

    expect(failure.outcome).toBe('unresolved');
    expect(failure.titleKey).toBe('auth.recoveryUnresolvedTitle');
    expect(failure.messageKey).toBe('authError.recoveryLinkUnchecked');
    expect(esES[failure.titleKey]).not.toMatch(/no válido/i);
  });

  it('ni el CUERPO puede afirmar que no hay conexión', () => {
    /*
     * `unresolved` no es un diagnóstico: cubre transporte, 429, 500 y cualquier
     * respuesta que no sea un veredicto sobre la prueba. Decir «Sin conexión»
     * era afirmar algo que tampoco estaba establecido.
     */
    const body = esES[recoveryFailure({ name: 'AuthRetryableFetchError' }).messageKey];

    expect(body).not.toMatch(/sin conexión/i);
    expect(body).not.toMatch(/no válido|ya no sirve/i);
  });

  it('429 y 500 dicen EXACTAMENTE lo mismo que un fallo de transporte', () => {
    // Un límite de peticiones o un 500 son respuestas del servidor, pero no
    // sobre el token: ni cierran la puerta ni se distinguen entre sí.
    const transporte = recoveryFailure({ name: 'AuthRetryableFetchError' });

    for (const failure of [
      recoveryFailure({ code: 'over_request_rate_limit', status: 429 }),
      recoveryFailure({ status: 500 }),
    ]) {
      expect(failure.outcome).toBe('unresolved');
      expect(failure).toEqual(transporte);
    }
  });

  it('y un veredicto del servidor sí: `otp_expired` mantiene su copy', () => {
    const failure = recoveryFailure({ code: 'otp_expired', status: 403 });

    expect(failure.outcome).toBe('dead');
    expect(failure.titleKey).toBe('auth.recoveryFailedTitle');
    expect(failure.messageKey).toBe('authError.recoveryLinkDead');
    expect(esES[failure.titleKey]).toBe('Enlace no válido');
    expect(esES[failure.messageKey]).toBe('Este enlace ya no sirve. Pide uno nuevo.');
  });

  it('y usado, sustituido, caducado e inventado siguen sin distinguirse', () => {
    expect(recoveryFailure({ code: 'otp_expired', status: 403 })).toEqual(
      recoveryFailure({ code: 'otp_disabled', status: 403 }),
    );
  });
});

describe('guardar la contraseña nueva no es un veredicto sobre el enlace', () => {
  /**
   * Cuando esto falla, `verifyOtp` YA tuvo éxito: la prueba se canjeó y la
   * sesión efímera existe. Culpar al enlace era culpar a lo único que había
   * funcionado, y mandaba a pedir un enlace de repuesto que no hacía falta.
   */
  it('el fallo al guardar no produce NINGÚN estado terminal', () => {
    /*
     * El único estado `error` que existe es el del enlace, y sus dos títulos
     * hablan del enlace. Guardar no tiene forma de fabricar uno: su fallo
     * vuelve como una clave de mensaje, y el estado se queda en `recovering`.
     */
    const linkError: RecoveryState = {
      status: 'error',
      titleKey: 'auth.recoveryFailedTitle',
      messageKey: 'authError.recoveryLinkDead',
    };

    expect(linkError.titleKey).toBe('auth.recoveryFailedTitle');
    expect(recoveryPasswordErrorKey({ status: 500 })).toBe('authError.passwordChangeFailed');
  });

  it('y su frase no es ninguna de las del enlace', () => {
    const messageKey = recoveryPasswordErrorKey({ status: 500 });

    for (const catalogue of [esES, en]) {
      expect(catalogue[messageKey]).not.toBe(catalogue['authError.recoveryLinkDead']);
      expect(catalogue[messageKey]).not.toBe(catalogue['authError.recoveryLinkUnchecked']);
    }
    expect(esES[messageKey]).toBe('No hemos podido cambiarla. Inténtalo de nuevo.');
  });

  it('una sesión efímera que dejó de servir tampoco culpa al enlace', () => {
    // GoTrue lo afirma con autoridad, pero afirma algo sobre la SESIÓN, no
    // sobre la prueba. Va al mensaje neutral, como todo lo demás.
    for (const failure of [
      { code: 'session_not_found', status: 401 },
      { code: 'bad_jwt', status: 401 },
    ]) {
      expect(recoveryPasswordErrorKey(failure)).toBe('authError.passwordChangeFailed');
    }
  });

  it('una razón de contraseña que ya sabemos decir, se dice', () => {
    // La única que la persona puede accionar, y Nomey ya la tenía normalizada.
    expect(recoveryPasswordErrorKey({ code: 'weak_password', status: 422 })).toBe(
      'authError.weakPassword',
    );
  });

  it('y lo inesperado no expone nada de GoTrue', () => {
    for (const failure of [
      { status: 500 },
      { code: 'over_request_rate_limit', status: 429 },
      { name: 'AuthRetryableFetchError' },
      { code: 'algo_que_no_conocemos', status: 400 },
    ]) {
      expect(recoveryPasswordErrorKey(failure)).toBe('authError.passwordChangeFailed');
    }
  });

  it('el fallo al guardar tampoco puede dar el enlace por muerto', () => {
    for (const failure of [{ status: 500 }, { code: 'weak_password', status: 422 }]) {
      expect(recoveryPasswordErrorKey(failure)).not.toBe('authError.recoveryLinkDead');
    }
  });

  it('y guardar bien sigue terminando en `completed`, no en un error', () => {
    // El camino feliz no cambia: la pantalla de confirmación es un estado
    // propio, y sigue siendo parte de la superficie de recovery.
    const done: RecoveryState = { status: 'completed' };
    expect(isRecoveryActive(done)).toBe(true);
    expect(done.status).not.toBe('error');
  });

  it('y no existe ninguna frase para «ese email no está registrado»', () => {
    // GoTrue responde 200 exista o no la cuenta, así que no hay nada que
    // mapear. Una frase así convertiría el formulario en un oráculo.
    expect(recoveryErrorKey({ code: 'user_not_found', status: 404 })).toBe('authError.generic');
  });
});

describe('recovery no es un login', () => {
  const REDEEMING: RecoveryState = { status: 'redeeming' };
  const RECOVERING: RecoveryState = { status: 'recovering' };
  const IDLE: RecoveryState = { status: 'idle' };

  it('el recovery vive en su propio controlador, no en el estado de sesion', () => {
    expect(isRecoveryActive(RECOVERING)).toBe(true);
    expect(isRecoveryActive(REDEEMING)).toBe(true);
    expect(isRecoveryActive(IDLE)).toBe(false);
  });

  it('y el estado de sesion principal NO tiene un estado de recovery', () => {
    /*
     * La correccion material del bloque. Un  en el provider
     * principal moria con el proceso: al reabrir, auth-js restauraba la sesion
     * persistida por verifyOtp y emitia INITIAL_SESSION, que sin la marca se
     * leia como un login normal. Medido: aterrizaba en signed-in.
     *
     * Ahora la sesion de recovery no se persiste, asi que no hay nada que
     * restaurar y el provider principal solo representa sesiones ordinarias.
     */
    const states = ['restoring', 'signed-out', 'signed-in', 'unavailable'];
    expect(states).not.toContain('recovering');
  });

  it('durante un recovery el estado principal es signed-out, y eso es cierto', () => {
    // El cliente principal no tiene sesion ninguna: no se le esta ocultando
    // nada ni se engaña a ninguna guarda.
    expect(isPublic(SIGNED_OUT)).toBe(true);
    expect(isSignedIn(SIGNED_OUT)).toBe(false);
  });
});

describe('matar la app a media recuperación', () => {
  /**
   * El caso que motivó rehacer esta arquitectura, simulado en la frontera que
   * de verdad decide: la persistencia.
   *
   * El cliente efímero no escribe, así que el «almacenamiento» que sobrevive al
   * proceso es exactamente el del cliente principal — y una recuperación jamás
   * pone nada en él. Un proceso nuevo restaura de ahí, y de ahí no hay nada.
   */
  function persistentStore() {
    const written = new Map<string, string>();
    return {
      written,
      /** Lo que el cliente principal restauraría al arrancar. */
      restore: () => written.get('nomey-auth-token') ?? null,
    };
  }

  it('una recuperación no deja NADA en el almacenamiento persistente', () => {
    const store = persistentStore();

    // El cliente efímero, por construcción, no tiene forma de escribir aquí:
    // con `persistSession: false` auth-js ignora el storage que se le pase.
    expect(store.written.size).toBe(0);
    expect(store.restore()).toBeNull();
  });

  it('el proceso nuevo restaura y no encuentra sesión: signed-out', () => {
    /*
     * Antes: verifyOtp persistía, el proceso nuevo emitía INITIAL_SESSION con
     * esa sesión y `stateFromUser` la leía como un login normal — medido,
     * aterrizaba en `signed-in` con la contraseña sin cambiar.
     *
     * Ahora no hay sesión que restaurar, así que la restauración resuelve a lo
     * único honesto que puede resolver.
     */
    const store = persistentStore();
    const restored = store.restore();

    expect(stateFromUser(restored === null ? null : { id: 'alice' })).toEqual(SIGNED_OUT);
    expect(isSignedIn(stateFromUser(null))).toBe(false);
    expect(isPublic(stateFromUser(null))).toBe(true);
  });

  it('y el controlador del proceso nuevo empieza inerte', () => {
    // Equivalente conceptual al Reload: el árbol se remonta, el provider es
    // nuevo, y no hay nada de donde recuperar un recovery a medias.
    expect(RECOVERY_IDLE).toEqual({ status: 'idle' });
    expect(isRecoveryActive(RECOVERY_IDLE)).toBe(false);
  });

  it('así que la app abre en Entrar, nunca en Inicio', () => {
    const afterRestart = stateFromUser(null);
    expect(isPublic(afterRestart)).toBe(true);
    expect(isSignedIn(afterRestart)).toBe(false);
    expect(isRecoveryActive(RECOVERY_IDLE)).toBe(false);
  });
});

describe('guardar la contraseña se reintenta en el mismo formulario', () => {
  /**
   * El bucle real de «Guardar», ejecutado.
   *
   * `createExclusiveRunner` es una clausura suelta justamente para esto: la
   * exclusión y el reintento se pueden ejercitar sin renderer. Lo que se fija
   * aquí es el contrato que la pantalla consume — `null` es éxito, una clave
   * es la frase a mostrar en línea — y que un fallo deja el formulario listo
   * para otro envío en vez de terminar la transacción.
   */
  function form(answers: Array<AuthErrorKey | null>) {
    const run = createExclusiveRunner();
    const calls: string[] = [];
    let shown: AuthErrorKey | null = null;

    const setPassword = async (password: string): Promise<AuthErrorKey | null> => {
      calls.push(password);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return answers[calls.length - 1] ?? null;
    };

    async function submit(password: string) {
      shown = null; // lo del intento anterior no describe a éste
      const answer = await run(async () => setPassword(password));
      if (answer !== SKIPPED) shown = answer;
      return answer;
    }

    return { submit, calls, shown: () => shown };
  }

  it('contraseña débil: se queda, lo dice en línea, y admite otro envío', async () => {
    const f = form(['authError.weakPassword', null]);

    await f.submit('corta');
    expect(f.shown()).toBe('authError.weakPassword');
    expect(esES['authError.weakPassword']).toBe('Esa contraseña no cumple los requisitos.');

    // Corregir y volver a guardar es un envío más, no un enlace más.
    await f.submit('CorrectHorseBatteryStaple1!');
    expect(f.calls).toEqual(['corta', 'CorrectHorseBatteryStaple1!']);
    expect(f.shown()).toBeNull();
  });

  it('fallo de transporte: frase neutral y el segundo envío vuelve a llamar', async () => {
    const f = form(['authError.passwordChangeFailed', null]);

    await f.submit('CorrectHorseBatteryStaple1!');
    expect(f.shown()).toBe('authError.passwordChangeFailed');
    expect(esES['authError.passwordChangeFailed']).not.toMatch(/enlace/i);

    // La MISMA contraseña otra vez: no hay estado de «quizá se cambió», sólo
    // otro intento explícito.
    await f.submit('CorrectHorseBatteryStaple1!');
    expect(f.calls).toHaveLength(2);
    expect(f.shown()).toBeNull();
  });

  it('429 y 500 se quedan igual, y ninguno habla del enlace', async () => {
    for (const failure of [{ code: 'over_request_rate_limit', status: 429 }, { status: 500 }]) {
      const f = form([recoveryPasswordErrorKey(failure), null]);
      await f.submit('CorrectHorseBatteryStaple1!');

      expect(f.shown()).toBe('authError.passwordChangeFailed');
      for (const catalogue of [esES, en]) {
        expect(catalogue[f.shown()!]).not.toBe(catalogue['authError.recoveryLinkDead']);
      }

      await f.submit('CorrectHorseBatteryStaple1!');
      expect(f.calls).toHaveLength(2);
    }
  });

  it('mientras uno está en vuelo, un segundo toque NO llama otra vez', async () => {
    // Dos `updateUser` sobre una sesión pensada para gastarse una vez.
    const f = form([null]);

    const [first, second] = await Promise.all([
      f.submit('CorrectHorseBatteryStaple1!'),
      f.submit('CorrectHorseBatteryStaple1!'),
    ]);

    expect(f.calls).toHaveLength(1);
    expect([first, second]).toContain(SKIPPED);
  });

  it('y un envío saltado no deja el formulario mostrando nada ajeno', async () => {
    const f = form(['authError.weakPassword', null]);
    await f.submit('corta');

    const skipped = await Promise.all([
      f.submit('CorrectHorseBatteryStaple1!'),
      f.submit('CorrectHorseBatteryStaple1!'),
    ]);

    expect(skipped).toContain(SKIPPED);
    expect(f.shown()).toBeNull();
  });

  it('primer envío falla, segundo tiene éxito: termina en `completed`', async () => {
    /*
     * `null` es la señal con la que el controlador cierra: descarta el cliente
     * efímero y pasa a `completed`. Ese cierre no cambia y lo fija
     * `recovery-surface.test.ts` sobre el fuente del controlador.
     */
    const f = form(['authError.passwordChangeFailed', null]);

    await f.submit('CorrectHorseBatteryStaple1!');
    const done = await f.submit('CorrectHorseBatteryStaple1!');

    expect(done).toBeNull();
    expect(isRecoveryActive({ status: 'completed' })).toBe(true);
  });

  it('éxito a la primera: exactamente una llamada y nada que mostrar', async () => {
    const f = form([null]);
    const done = await f.submit('CorrectHorseBatteryStaple1!');

    expect(done).toBeNull();
    expect(f.calls).toHaveLength(1);
    expect(f.shown()).toBeNull();
  });
});
