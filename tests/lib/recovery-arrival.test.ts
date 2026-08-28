import { describe, expect, it, vi } from 'vitest';

import {
  createRecoveryArrivalHandler,
  type RefusalReason,
  type SessionSnapshot,
} from '../../src/features/auth/recovery-arrival';
import type { RedeemOutcome } from '../../src/features/auth/recovery-state';

/**
 * La llegada de un enlace de recuperación, ejecutada de verdad.
 *
 * Este módulo existe por dos defectos medidos, en este orden:
 *
 * 1. Derivar de `Linking.useURL()` —que RETIENE la última URL— dentro de un
 *    efecto que dependía de la sesión: cerrar sesión reprocesaba esa URL y
 *    canjeaba un enlace que nadie había reabierto.
 * 2. Preguntar `signedIn: boolean`: `isSignedIn(restoring)` es `false`, así que
 *    un arranque en frío lanzado por el enlace canjeaba **durante la ventana de
 *    restauración**, con una sesión persistida a medio leer del llavero.
 *    Confirmado en iPhone: la app abría directamente en «Nueva contraseña»
 *    para alguien que estaba dentro.
 *
 * 3. Marcar el hash como gastado ANTES de saber si el servidor lo recibió: un
 *    `verifyOtp` que nunca llegó a GoTrue quemaba el enlace en local. La app
 *    decía «Enlace no válido» y luego ignoraba en silencio cada reapertura,
 *    mientras ese mismo one-time token seguía vivo en la base de datos.
 *    Medido en iPhone y comprobado contra `auth.one_time_tokens`.
 *
 * De ahí la forma: se pregunta el ESTADO, no un booleano, `restoring` tiene
 * salida propia — retener esa llegada y decidirla cuando haya respuesta— y el
 * canje informa de lo que quedó ESTABLECIDO, no de si falló.
 */

const HASH = 'af45ad58765ec951b302ce027a00180e83d2ee16404fc61eb0b12f28';
const OTHER = 'bb11cc22dd33ee44ff5566778899aabbccddeeff0011223344556677';
const LINK = `nomey-dev://auth/recovery?token_hash=${HASH}&type=recovery`;
const LINK_OTHER = `nomey-dev://auth/recovery?token_hash=${OTHER}&type=recovery`;

/**
 * Deja correr la promesa del canje y su continuación.
 *
 * El canje ya no es una llamada a ciegas: lo que decide si el hash queda
 * gastado es su RESULTADO, que llega en un microtask. Los tests que miran esa
 * decisión tienen que esperarlo; los que sólo miran si se llamó, no.
 */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function world(status: SessionSnapshot = 'signed-out', outcome: RedeemOutcome = 'consumed') {
  const situation = { status, recovering: false, outcome };
  const redeem = vi.fn<(hash: string) => Promise<RedeemOutcome>>(() =>
    Promise.resolve(situation.outcome),
  );
  const refuse = vi.fn<(reason: RefusalReason) => void>();

  const handler = createRecoveryArrivalHandler({
    sessionStatus: () => situation.status,
    isRecovering: () => situation.recovering,
    redeem,
    refuse,
  });

  return { situation, redeem, refuse, handler };
}

describe('arranque en frío con sesión persistida', () => {
  it('durante `restoring` NO se canjea nada', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);

    // El defecto exacto que se corrige: antes esto canjeaba.
    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.refuse).not.toHaveBeenCalled();
  });

  it('y al resolver a `signed-in` se bloquea, sin gastar el token', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);

    w.situation.status = 'signed-in';
    w.handler.sessionResolved();

    expect(w.refuse).toHaveBeenCalledExactlyOnceWith('signed-in');
    expect(w.redeem).not.toHaveBeenCalled();
  });

  it('un logout POSTERIOR no autocanjea esa llegada', () => {
    /*
     * La llegada pendiente se borra ANTES de decidir, así que no queda nada
     * que un cambio de estado pueda reprocesar. Es la misma garantía que se
     * perdió la primera vez, ahora estructural.
     */
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.situation.status = 'signed-in';
    w.handler.sessionResolved();

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();
    w.handler.sessionResolved();

    expect(w.redeem).not.toHaveBeenCalled();
  });

  it('pero reabrir explícitamente el mismo enlace sí lo canjea', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.situation.status = 'signed-in';
    w.handler.sessionResolved();

    w.situation.status = 'signed-out';
    w.handler.arrive(LINK); // segunda entrega real, no un cambio de estado

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });
});

describe('arranque en frío sin sesión', () => {
  it('espera a la restauración y luego canjea UNA vez', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    expect(w.redeem).not.toHaveBeenCalled();

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
    expect(w.refuse).not.toHaveBeenCalled();
  });

  it('y resolver otra vez no vuelve a canjear', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.situation.status = 'signed-out';
    w.handler.sessionResolved();
    w.handler.sessionResolved();

    expect(w.redeem).toHaveBeenCalledTimes(1);
  });
});

describe('`unavailable` falla cerrado', () => {
  it('no se canjea si no se puede determinar la sesión', () => {
    // `unavailable` NO es un `signed-out` silencioso: canjear sobre una
    // suposición gastaría un token de un solo uso de alguien que quizá está
    // dentro.
    const w = world('unavailable');
    w.handler.arrive(LINK);

    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.refuse).toHaveBeenCalledExactlyOnceWith('undetermined');
  });

  it('tampoco al resolver desde `restoring` a `unavailable`', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.situation.status = 'unavailable';
    w.handler.sessionResolved();

    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.refuse).toHaveBeenCalledExactlyOnceWith('undetermined');
  });

  it('y el token sigue sirviendo cuando la sesión se pueda determinar', () => {
    const w = world('unavailable');
    w.handler.arrive(LINK);

    w.situation.status = 'signed-out';
    w.handler.arrive(LINK); // reapertura explícita

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });
});

describe('duplicados durante la restauración', () => {
  it('`getInitialURL` y un evento idéntico producen UNA sola decisión', () => {
    const w = world('restoring');
    w.handler.arrive(LINK); // getInitialURL
    w.handler.arrive(LINK); // evento url con la misma URL

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();

    expect(w.redeem).toHaveBeenCalledTimes(1);
  });

  it('y un solo aviso si acaba en `signed-in`', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.handler.arrive(LINK);

    w.situation.status = 'signed-in';
    w.handler.sessionResolved();

    expect(w.refuse).toHaveBeenCalledTimes(1);
  });

  it('un segundo enlace DISTINTO no sustituye al pendiente ni se gasta', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.handler.arrive(LINK_OTHER);

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();

    // Sólo el primero, y el segundo sigue intacto para reabrirlo.
    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it('el pendiente se descarta al desmontar', () => {
    const w = world('restoring');
    w.handler.arrive(LINK);
    w.handler.dispose();

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();

    expect(w.redeem).not.toHaveBeenCalled();
  });
});

describe('con la sesión ya resuelta, como hasta ahora', () => {
  it('`signed-in` bloquea sin gastar', () => {
    const w = world('signed-in');
    w.handler.arrive(LINK);

    expect(w.refuse).toHaveBeenCalledExactlyOnceWith('signed-in');
    expect(w.redeem).not.toHaveBeenCalled();
  });

  it('`signed-out` canjea', () => {
    const w = world('signed-out');
    w.handler.arrive(LINK);

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it('un cambio de estado por sí solo nunca procesa una llegada ya atendida', () => {
    const w = world('signed-in');
    w.handler.arrive(LINK); // bloqueada
    w.situation.status = 'signed-out';
    w.handler.sessionResolved();

    expect(w.redeem).not.toHaveBeenCalled();
  });

  it('no se canjea dos veces la misma', () => {
    const w = world('signed-out');
    w.handler.arrive(LINK);
    w.handler.arrive(LINK);

    expect(w.redeem).toHaveBeenCalledTimes(1);
  });

  it('con un recovery en curso se ignora sin gastar', () => {
    const w = world('signed-out');
    w.situation.recovering = true;
    w.handler.arrive(LINK_OTHER);

    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.refuse).not.toHaveBeenCalled();
  });

  it('y lo que no es un enlace de recuperación no es una llegada', () => {
    const w = world('restoring');
    w.handler.arrive(null);
    w.handler.arrive('exp://192.168.8.110:8081');
    w.handler.arrive(`nomey-dev://auth/recovery?token_hash=${HASH}&type=signup`);

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();

    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.refuse).not.toHaveBeenCalled();
  });
});

describe('gastar la prueba es cosa del servidor, no del intento', () => {
  it('canje con éxito: una segunda llegada idéntica NO vuelve a canjear', async () => {
    const w = world('signed-out', 'consumed');
    w.handler.arrive(LINK);
    await settled();

    w.handler.arrive(LINK); // el mismo enlace, reabierto

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it('el servidor dice que ya no sirve: tampoco se reintenta', async () => {
    /*
     * `403 otp_expired` SÍ es palabra del servidor sobre la prueba: usado,
     * sustituido, caducado o inventado. Ahí la puerta se cierra, y sigue sin
     * distinguirse cuál de los cuatro fue.
     */
    const w = world('signed-out', 'dead');
    w.handler.arrive(LINK);
    await settled();

    w.handler.arrive(LINK);

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it('fallo de transporte: la prueba NO queda gastada', async () => {
    /*
     * El defecto medido. Sin respuesta HTTP no hay nada demostrado sobre el
     * token: en el intento real seguía vivo en `auth.one_time_tokens` mientras
     * la app lo daba por muerto.
     */
    const w = world('signed-out', 'unresolved');
    w.handler.arrive(LINK);
    await settled();

    w.handler.arrive(LINK); // reapertura explícita, con red otra vez

    expect(w.redeem).toHaveBeenCalledTimes(2);
    expect(w.redeem).toHaveBeenLastCalledWith(HASH);
  });

  it('y el reintento es la reapertura, nunca un cambio de sesión', async () => {
    /*
     * Nada de reintento automático en bucle: el enlace vuelve a llegar porque
     * alguien lo abre. Ningún cambio de estado puede canjear por su cuenta —es
     * exactamente el auto-canje que este módulo ya tuvo que corregir una vez.
     */
    const w = world('signed-out', 'unresolved');
    w.handler.arrive(LINK);
    await settled();

    w.situation.status = 'signed-in';
    w.handler.sessionResolved();
    w.situation.status = 'signed-out';
    w.handler.sessionResolved();
    w.handler.sessionResolved();
    await settled();

    expect(w.redeem).toHaveBeenCalledTimes(1);
  });

  it('mientras el canje está en vuelo, una entrega duplicada no lo repite', async () => {
    // Lo que antes hacía `spent` escribiéndose demasiado pronto: dos entregas
    // en el mismo tick no pueden ser dos `verifyOtp`.
    const w = world('signed-out', 'unresolved');
    w.handler.arrive(LINK);
    w.handler.arrive(LINK);

    expect(w.redeem).toHaveBeenCalledTimes(1);

    await settled();
    w.handler.arrive(LINK); // ya resuelto, y sin nada demostrado: se reintenta

    expect(w.redeem).toHaveBeenCalledTimes(2);
  });

  it('un canje que revienta tampoco gasta la prueba', async () => {
    // El puerto está documentado como que no rechaza; esto es el cinturón.
    const w = world('signed-out');
    w.redeem.mockRejectedValueOnce(new Error('boom'));
    w.handler.arrive(LINK);
    await settled();

    w.handler.arrive(LINK);

    expect(w.redeem).toHaveBeenCalledTimes(2);
  });

  it('y todo esto NO toca lo pendiente durante `restoring`', async () => {
    /*
     * La llegada retenida se resuelve una sola vez y se borra antes de decidir.
     * Que el canje falle por transporte no la resucita: lo que vuelve a
     * intentarlo es una entrega nueva.
     */
    const w = world('restoring', 'unresolved');
    w.handler.arrive(LINK);
    expect(w.redeem).not.toHaveBeenCalled();

    w.situation.status = 'signed-out';
    w.handler.sessionResolved();
    await settled();

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);

    w.handler.sessionResolved();
    await settled();

    expect(w.redeem).toHaveBeenCalledTimes(1);
  });
});
