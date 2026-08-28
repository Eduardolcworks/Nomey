import { describe, expect, it, vi } from 'vitest';

import {
  type AppStatePort,
  type AuthPort,
  startSessionLifecycle,
} from '../../src/features/session/session-lifecycle';
import type { AuthenticatedUser, SessionState } from '../../src/features/session/session-state';

/**
 * El ciclo de vida de la sesión.
 *
 * Se prueba la función, no el `useEffect`, que es justamente por lo que la
 * función existe: sin renderer de React no hay forma de preguntarle a un
 * efecto si desuscribió, si dejó de emitir o si paró el refresco. Aquí sí se
 * puede.
 *
 * Nada de esto prueba internals de Supabase ni de React Native: los dos
 * puertos son falsos y lo que se comprueba es **qué les pide Nomey y cuándo**.
 */

function fakeAuth() {
  const listeners: ((user: AuthenticatedUser | null) => void)[] = [];
  const calls: string[] = [];
  let unsubscribes = 0;

  const auth: AuthPort = {
    onAuthStateChange: (callback) => {
      listeners.push(callback);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              unsubscribes += 1;
            },
          },
        },
      };
    },
    startAutoRefresh: async () => {
      calls.push('start');
    },
    stopAutoRefresh: async () => {
      calls.push('stop');
    },
  };

  return {
    auth,
    calls,
    listenerCount: () => listeners.length,
    unsubscribeCount: () => unsubscribes,
    emit: (user: AuthenticatedUser | null) => {
      for (const listener of listeners) listener(user);
    },
  };
}

function fakeAppState(initial: string | null = 'active') {
  const handlers: ((status: string) => void)[] = [];
  let removals = 0;

  const appState: AppStatePort = {
    currentState: initial,
    addEventListener: (_type, handler) => {
      handlers.push(handler);
      return {
        remove: () => {
          removals += 1;
        },
      };
    },
  };

  return {
    appState,
    handlerCount: () => handlers.length,
    removalCount: () => removals,
    change: (status: string) => {
      for (const handler of handlers) handler(status);
    },
  };
}

/** Relojes explícitos: sin timers reales, y sin esperar diez segundos. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;

  return {
    setTimer: (fn: () => void) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    pendingCount: () => pending.size,
    fire: () => {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
  };
}

function harness(appStateInitial: string | null = 'active') {
  const a = fakeAuth();
  const s = fakeAppState(appStateInitial);
  const timers = fakeTimers();
  const emitted: SessionState[] = [];

  const stop = startSessionLifecycle({
    auth: a.auth,
    appState: s.appState,
    emit: (state) => emitted.push(state),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  return { ...a, ...s, timers, emitted, stop };
}

const ALICE: AuthenticatedUser = { id: 'alice', email: 'alice@example.com' };

describe('ciclo de vida de la sesión', () => {
  describe('resolución inicial', () => {
    it('no emite nada hasta que llega la primera respuesta', () => {
      const h = harness();
      expect(h.emitted).toEqual([]);
      h.stop();
    });

    it('sin sesión guardada resuelve a `signed-out`', () => {
      const h = harness();
      h.emit(null);

      expect(h.emitted).toEqual([{ status: 'signed-out' }]);
      h.stop();
    });

    it('con sesión guardada resuelve a `signed-in`', () => {
      const h = harness();
      h.emit(ALICE);

      expect(h.emitted).toHaveLength(1);
      expect(h.emitted[0].status).toBe('signed-in');
      h.stop();
    });

    it('se suscribe UNA sola vez', () => {
      const h = harness();
      h.emit(null);
      h.emit(ALICE);

      expect(h.listenerCount()).toBe(1);
      h.stop();
    });
  });

  describe('la restauración no puede colgar la app', () => {
    it('si no llega respuesta, el watchdog resuelve a `unavailable`', () => {
      const h = harness();
      h.timers.fire();

      expect(h.emitted).toEqual([{ status: 'unavailable' }]);
      h.stop();
    });

    it('una respuesta a tiempo cancela el watchdog', () => {
      const h = harness();
      h.emit(null);

      expect(h.timers.pendingCount()).toBe(0);
      h.timers.fire(); // ya no hay nada que disparar
      expect(h.emitted).toEqual([{ status: 'signed-out' }]);
      h.stop();
    });

    it('`unavailable` NO es terminal: una respuesta tardía sigue mandando', () => {
      const h = harness();
      h.timers.fire();
      expect(h.emitted).toEqual([{ status: 'unavailable' }]);

      h.emit(ALICE);

      expect(h.emitted).toHaveLength(2);
      expect(h.emitted[1].status).toBe('signed-in');
      h.stop();
    });
  });

  describe('orden: una respuesta vieja no puede pisar a una nueva', () => {
    it('el estado final es el del último evento, siempre', () => {
      const h = harness();

      h.emit(null); // restauración: no había sesión
      h.emit(ALICE); // alguien entra
      h.emit(null); // y sale

      expect(h.emitted.map((state) => state.status)).toEqual([
        'signed-out',
        'signed-in',
        'signed-out',
      ]);
      h.stop();
    });

    it('no hay una segunda fuente que pueda llegar tarde', () => {
      // La garantía es estructural: un único suscriptor, y ninguna promesa de
      // restauración aparte que pueda resolverse después. Si alguien añadiera
      // un `getSession()` en paralelo, habría dos.
      const h = harness();
      h.emit(ALICE);

      expect(h.listenerCount()).toBe(1);
      h.stop();
    });
  });

  describe('refresco atado al AppState', () => {
    it('arranca el refresco si la app ya está activa', () => {
      const h = harness('active');
      expect(h.calls).toEqual(['start']);
      h.stop();
    });

    it('un estado desconocido se trata como activo', () => {
      // Android puede dar `currentState` null antes del primer cambio. Perder
      // el refresco cuesta la sesión; sobrarlo cuesta un timer.
      const h = harness(null);
      expect(h.calls).toEqual(['start']);
      h.stop();
    });

    it('no arranca si la app entra en segundo plano', () => {
      const h = harness('background');
      expect(h.calls).toEqual(['stop']);
      h.stop();
    });

    it('background lo para y active lo vuelve a arrancar', () => {
      const h = harness('active');
      h.change('background');
      h.change('active');

      expect(h.calls).toEqual(['start', 'stop', 'start']);
      h.stop();
    });

    it('`inactive` también lo para', () => {
      const h = harness('active');
      h.change('inactive');

      expect(h.calls).toEqual(['start', 'stop']);
      h.stop();
    });

    it('eventos repetidos del mismo tipo no repiten la llamada', () => {
      const h = harness('active');
      h.change('active');
      h.change('active');
      h.change('background');
      h.change('background');
      h.change('inactive');

      expect(h.calls).toEqual(['start', 'stop']);
      h.stop();
    });

    it('registra UN solo listener de AppState', () => {
      const h = harness();
      h.change('background');
      h.change('active');

      expect(h.handlerCount()).toBe(1);
      h.stop();
    });
  });

  describe('teardown', () => {
    it('desuscribe del auth y quita el listener de AppState', () => {
      const h = harness();
      h.stop();

      expect(h.unsubscribeCount()).toBe(1);
      expect(h.removalCount()).toBe(1);
    });

    it('deja el refresco parado', () => {
      const h = harness('active');
      h.stop();

      expect(h.calls).toEqual(['start', 'stop']);
    });

    it('no para el refresco si nunca lo arrancó', () => {
      const h = harness('background');
      h.stop();

      expect(h.calls).toEqual(['stop']);
    });

    it('NO emite después de desmontar', () => {
      const h = harness();
      h.stop();

      h.emit(ALICE);
      h.timers.fire();

      expect(h.emitted).toEqual([]);
    });

    it('cancela el watchdog, que si no emitiría tras el desmontaje', () => {
      const h = harness();
      h.stop();

      expect(h.timers.pendingCount()).toBe(0);
    });

    it('es idempotente: llamarlo dos veces no desuscribe dos veces', () => {
      const h = harness();
      h.stop();
      h.stop();

      expect(h.unsubscribeCount()).toBe(1);
      expect(h.removalCount()).toBe(1);
    });
  });

  describe('errores del refresco', () => {
    it('un `startAutoRefresh` que falla se comunica y no rompe el arranque', async () => {
      const onRefreshError = vi.fn();
      const boom = new Error('sin red');

      const stop = startSessionLifecycle({
        auth: {
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
          startAutoRefresh: () => Promise.reject(boom),
          stopAutoRefresh: async () => {},
        },
        appState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        emit: () => {},
        setTimer: () => 0,
        clearTimer: () => {},
        onRefreshError,
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(onRefreshError).toHaveBeenCalledWith(boom);
      stop();
    });
  });
});
