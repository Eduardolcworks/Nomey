import { describe, expect, it, vi } from 'vitest';

import { createScopeFlight } from '../../src/features/personal/scope-flight';

/**
 * EL VUELO COMPARTIDO DEL ÁMBITO PERSONAL.
 *
 * React invoca dos veces cada efecto en desarrollo: monta, limpia, vuelve a
 * montar. La implementación anterior guardaba el vuelo en un booleano, así que
 * la SEGUNDA invocación —la que sigue viva— encontraba el guardián puesto y se
 * iba sin suscribirse, mientras la PRIMERA —ya cancelada— se quedaba con la
 * respuesta y la descartaba. El resultado era una pantalla en `idle` con un 200
 * en el servidor.
 *
 * Se prueba el comportamiento, no el hook: quién se suscribe, quién aplica y
 * quién descarta. `usePersonalScope` queda como envoltura fina.
 */

/** Una promesa que se resuelve cuando la prueba lo diga. */
function diferida<T>() {
  let resolver!: (value: T) => void;
  let rechazar!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promise, resolver, rechazar };
}

/** Un suscriptor, con la traza de lo que se le ha aplicado. */
function suscriptor() {
  const estados: string[] = [];
  return {
    estados,
    value: (v: string) => estados.push(`ready:${v}`),
    error: () => estados.push('unavailable'),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * EL ALGORITMO QUE HABÍA, replicado para poder ejecutarlo.
 *
 * No es una caricatura: es el guardián booleano de `usePersonalScope` con su
 * `cancelled` por invocación. Existe para que la reproducción del fallo sea una
 * prueba que corre, y no una explicación.
 */
function vueloAntiguo() {
  let inFlight = false;
  return {
    join(arranca: () => Promise<string>, sink: ReturnType<typeof suscriptor>) {
      if (inFlight) return { cancel: () => undefined };
      inFlight = true;
      let cancelled = false;
      void arranca()
        .then((v) => {
          if (!cancelled) sink.value(v);
        })
        .catch(() => {
          if (!cancelled) sink.error();
        })
        .finally(() => {
          inFlight = false;
        });
      return {
        cancel: () => {
          cancelled = true;
        },
      };
    },
  };
}

describe('la reproducción del fallo', () => {
  /**
   * **LA SECUENCIA EXACTA DE LO OBSERVADO:** primer efecto crea el vuelo, la
   * limpieza lo cancela, el segundo encuentra el guardián puesto, llega el 200
   * — y nadie lo aplica.
   */
  it('el algoritmo anterior se queda en idle con una respuesta válida', async () => {
    const { promise, resolver } = diferida<string>();
    const backend = vi.fn(() => promise);
    const vuelo = vueloAntiguo();
    const inicio = suscriptor();

    vuelo.join(backend, inicio).cancel();
    vuelo.join(backend, inicio);

    resolver('scope-1');
    await tick();

    expect(inicio.estados).toEqual([]);
    expect(backend).toHaveBeenCalledTimes(1);
  });
});

describe('el vuelo compartido', () => {
  it('la segunda invocación se suscribe al mismo vuelo y lo aplica', async () => {
    const { promise, resolver } = diferida<string>();
    const backend = vi.fn(() => promise);
    const vuelo = createScopeFlight<string>();
    const inicio = suscriptor();

    vuelo.join(backend, inicio).cancel();
    vuelo.join(backend, inicio);

    resolver('scope-1');
    await tick();

    expect(inicio.estados).toEqual(['ready:scope-1']);
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it('dos suscripciones vivas reciben las dos el resultado', async () => {
    const { promise, resolver } = diferida<string>();
    const backend = vi.fn(() => promise);
    const vuelo = createScopeFlight<string>();
    const a = suscriptor();
    const b = suscriptor();

    vuelo.join(backend, a);
    vuelo.join(backend, b);
    resolver('scope-1');
    await tick();

    expect(a.estados).toEqual(['ready:scope-1']);
    expect(b.estados).toEqual(['ready:scope-1']);
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it('la cancelada descarta y la viva aplica', async () => {
    const { promise, resolver } = diferida<string>();
    const vuelo = createScopeFlight<string>();
    const muerta = suscriptor();
    const viva = suscriptor();

    vuelo.join(() => promise, muerta).cancel();
    vuelo.join(() => promise, viva);
    resolver('scope-1');
    await tick();

    expect(muerta.estados).toEqual([]);
    expect(viva.estados).toEqual(['ready:scope-1']);
  });

  /** Un componente realmente desmontado nunca escribe. */
  it('si se cancelan todas, nadie aplica nada', async () => {
    const { promise, resolver } = diferida<string>();
    const vuelo = createScopeFlight<string>();
    const a = suscriptor();
    const b = suscriptor();

    vuelo.join(() => promise, a).cancel();
    vuelo.join(() => promise, b).cancel();
    resolver('scope-1');
    await tick();

    expect(a.estados).toEqual([]);
    expect(b.estados).toEqual([]);
  });

  /** Montar, limpiar y montar: la forma literal del modo estricto. */
  it('sobrevive al ciclo montar · limpiar · montar', async () => {
    const { promise, resolver } = diferida<string>();
    const backend = vi.fn(() => promise);
    const vuelo = createScopeFlight<string>();
    const inicio = suscriptor();

    vuelo.join(backend, inicio).cancel();
    const segunda = vuelo.join(backend, inicio);

    resolver('scope-1');
    await tick();
    segunda.cancel();

    expect(inicio.estados).toEqual(['ready:scope-1']);
    expect(backend).toHaveBeenCalledTimes(1);
  });

  /** Quien llega tarde, con el vuelo ya resuelto, arranca el suyo. */
  it('una suscripción tardía recibe su propio resultado', async () => {
    const { promise, resolver } = diferida<string>();
    const vuelo = createScopeFlight<string>();
    const pronto = suscriptor();
    const tarde = suscriptor();

    vuelo.join(() => promise, pronto);
    resolver('scope-1');
    await tick();

    vuelo.join(() => Promise.resolve('scope-2'), tarde);
    await tick();

    expect(pronto.estados).toEqual(['ready:scope-1']);
    expect(tarde.estados).toEqual(['ready:scope-2']);
  });

  it('reintentar tras resolver lanza un vuelo nuevo', async () => {
    const backend = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('scope-1')
      .mockResolvedValueOnce('scope-2');
    const vuelo = createScopeFlight<string>();
    const inicio = suscriptor();

    vuelo.join(backend, inicio);
    await tick();
    vuelo.join(backend, inicio);
    await tick();

    expect(inicio.estados).toEqual(['ready:scope-1', 'ready:scope-2']);
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it('reintentar con un vuelo en curso no duplica la llamada', async () => {
    const { promise, resolver } = diferida<string>();
    const backend = vi.fn(() => promise);
    const vuelo = createScopeFlight<string>();
    const inicio = suscriptor();

    vuelo.join(backend, inicio);
    vuelo.join(backend, inicio);
    resolver('scope-1');
    await tick();

    expect(backend).toHaveBeenCalledTimes(1);
  });

  /**
   * **Una promesa antigua no puede limpiar un intento nuevo.** Si el `finally`
   * borrara el vuelo sin comprobar cuál es, una respuesta lenta del primero
   * dejaría al segundo sin dueño.
   */
  it('una promesa antigua no limpia el vuelo de otra', async () => {
    const primera = diferida<string>();
    const backend = vi.fn(() => primera.promise);
    const vuelo = createScopeFlight<string>();
    const inicio = suscriptor();

    vuelo.join(backend, inicio).cancel();
    vuelo.join(backend, inicio);

    primera.resolver('scope-1');
    await tick();

    expect(inicio.estados).toEqual(['ready:scope-1']);
    expect(backend).toHaveBeenCalledTimes(1);
    // Y tras resolver, el vuelo queda libre para un intento posterior.
    expect(vuelo.pending()).toBe(false);
  });

  it('el error sólo alcanza a las suscripciones vivas', async () => {
    const { promise, rechazar } = diferida<string>();
    const vuelo = createScopeFlight<string>();
    const muerta = suscriptor();
    const viva = suscriptor();

    vuelo.join(() => promise, muerta).cancel();
    vuelo.join(() => promise, viva);
    rechazar(new Error('boom'));
    await tick();

    expect(muerta.estados).toEqual([]);
    expect(viva.estados).toEqual(['unavailable']);
  });
});
