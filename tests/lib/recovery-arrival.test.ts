import { describe, expect, it, vi } from 'vitest';

import {
  createRecoveryArrivalHandler,
  type RefusalReason,
  type SessionSnapshot,
} from '../../src/features/auth/recovery-arrival';

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
 * De ahí la forma: se pregunta el ESTADO, no un booleano, y `restoring` tiene
 * salida propia — retener esa llegada y decidirla cuando haya respuesta.
 */

const HASH = 'af45ad58765ec951b302ce027a00180e83d2ee16404fc61eb0b12f28';
const OTHER = 'bb11cc22dd33ee44ff5566778899aabbccddeeff0011223344556677';
const LINK = `nomey-dev://auth/recovery?token_hash=${HASH}&type=recovery`;
const LINK_OTHER = `nomey-dev://auth/recovery?token_hash=${OTHER}&type=recovery`;

function world(status: SessionSnapshot = 'signed-out') {
  const situation = { status, recovering: false };
  const redeem = vi.fn<(hash: string) => void>();
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
