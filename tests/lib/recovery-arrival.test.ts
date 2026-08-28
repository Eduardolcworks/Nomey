import { describe, expect, it, vi } from 'vitest';

import { createRecoveryArrivalHandler } from '../../src/features/auth/recovery-arrival';

/**
 * La llegada de un enlace de recuperación, ejecutada de verdad.
 *
 * Es el módulo que existe por un defecto medido: la versión anterior derivaba
 * de `Linking.useURL()`, que **retiene** la última URL, dentro de un efecto que
 * dependía de `signedIn`. Cerrar sesión por cualquier motivo volvía a ejecutar
 * el efecto contra esa URL retenida y canjeaba el enlace **sin que nadie lo
 * hubiera reabierto**.
 *
 * Aquí no hay valor retenido ni lista de dependencias: hay una función que se
 * llama una vez por llegada. Que un cambio de sesión no procese nada deja de
 * ser una regla que alguien deba respetar y pasa a ser una propiedad de la
 * forma — y estas pruebas la ejercitan como comportamiento, no leyendo fuente.
 */

const HASH = 'af45ad58765ec951b302ce027a00180e83d2ee16404fc61eb0b12f28';
const OTHER = 'bb11cc22dd33ee44ff5566778899aabbccddeeff0011223344556677';
const LINK = `nomey-dev://auth/recovery?token_hash=${HASH}&type=recovery`;
const LINK_OTHER = `nomey-dev://auth/recovery?token_hash=${OTHER}&type=recovery`;

/** Un mundo mutable: la sesión y el recovery cambian entre llegadas. */
function world({ signedIn = false, recovering = false } = {}) {
  const situation = { signedIn, recovering };
  const redeem = vi.fn<(hash: string) => void>();
  const warn = vi.fn();

  const handle = createRecoveryArrivalHandler({
    isSignedIn: () => situation.signedIn,
    isRecovering: () => situation.recovering,
    redeem,
    warn,
  });

  return { situation, redeem, warn, handle };
}

describe('sesión abierta cuando llega el enlace', () => {
  it('avisa y NO canjea', () => {
    const w = world({ signedIn: true });
    w.handle(LINK);

    expect(w.warn).toHaveBeenCalledTimes(1);
    expect(w.redeem).not.toHaveBeenCalled();
  });

  it('y el token no queda gastado: sirve después', () => {
    const w = world({ signedIn: true });
    w.handle(LINK);

    // Cierra sesión y REABRE el enlace: llega de nuevo, y ahora sí.
    w.situation.signedIn = false;
    w.handle(LINK);

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });
});

describe('cerrar sesión NO procesa nada por sí solo', () => {
  it('el defecto que motivó este módulo, ejercitado', () => {
    /*
     * Antes: `signedIn` era dependencia del efecto, así que pasar a `false`
     * relanzaba el proceso contra la URL retenida y canjeaba solo.
     *
     * Ahora cambiar la situación no llama al handler. Ésa es toda la
     * corrección: sin llegada, no hay proceso.
     */
    const w = world({ signedIn: true });
    w.handle(LINK);
    expect(w.redeem).not.toHaveBeenCalled();

    w.situation.signedIn = false; // la persona cierra sesión desde Cuenta

    // Nadie reabre el enlace. Nada debe ocurrir.
    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.warn).toHaveBeenCalledTimes(1);
  });

  it('y tampoco lo procesa un cambio del estado de recovery', () => {
    const w = world({ signedIn: true });
    w.handle(LINK);
    w.situation.recovering = true;
    w.situation.recovering = false;
    w.situation.signedIn = false;

    expect(w.redeem).not.toHaveBeenCalled();
  });
});

describe('la misma URL entregada otra vez', () => {
  it('se procesa: son eventos, no igualdad de string', () => {
    const w = world({ signedIn: true });
    w.handle(LINK); // bloqueado
    w.situation.signedIn = false;
    w.handle(LINK); // MISMA url exacta, segunda entrega

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it('pero no se canjea dos veces', () => {
    const w = world();
    w.handle(LINK);
    w.handle(LINK);
    w.handle(LINK);

    expect(w.redeem).toHaveBeenCalledTimes(1);
  });
});

describe('arranque en frío', () => {
  it('una URL inicial válida se procesa', () => {
    const w = world();
    w.handle(LINK);
    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it('doble entrega inicial: un solo canje', () => {
    // `getInitialURL()` y el evento `url` podrían traer la misma URL de
    // lanzamiento. El hash es de un solo uso: un segundo canje convertiría un
    // recovery bueno en un enlace muerto.
    const w = world();
    w.handle(LINK);
    w.handle(LINK);
    expect(w.redeem).toHaveBeenCalledTimes(1);
  });

  it('doble entrega inicial con sesión abierta: un solo aviso', () => {
    const w = world({ signedIn: true });
    w.handle(LINK);
    w.handle(LINK);
    expect(w.warn).toHaveBeenCalledTimes(1);
    expect(w.redeem).not.toHaveBeenCalled();
  });
});

describe('un recovery ya en curso', () => {
  it('ignora un segundo enlace sin gastarlo', () => {
    const w = world();
    w.handle(LINK);
    expect(w.redeem).toHaveBeenCalledTimes(1);

    w.situation.recovering = true;
    w.handle(LINK_OTHER);

    // Ni segunda transacción, ni sustitución silenciosa, ni token quemado.
    expect(w.redeem).toHaveBeenCalledTimes(1);
    expect(w.warn).not.toHaveBeenCalled();
  });

  it('y el segundo enlace sigue sirviendo cuando el primero termina', () => {
    const w = world();
    w.situation.recovering = true;
    w.handle(LINK_OTHER);
    expect(w.redeem).not.toHaveBeenCalled();

    w.situation.recovering = false;
    w.handle(LINK_OTHER); // se reabre

    expect(w.redeem).toHaveBeenCalledExactlyOnceWith(OTHER);
  });
});

describe('lo que no es un enlace de recuperación', () => {
  it('no hace nada, y no cuenta como llegada', () => {
    const w = world();
    w.handle(null);
    w.handle('exp://192.168.8.110:8081');
    w.handle('nomey-dev://auth/recovery');
    w.handle(`nomey-dev://auth/recovery?token_hash=${HASH}&type=signup`);

    expect(w.redeem).not.toHaveBeenCalled();
    expect(w.warn).not.toHaveBeenCalled();
  });
});
