/**
 * UN SOLO TEMPORIZADOR, PUESTO DONDE TOCA.
 *
 * **Por qué no vale un tic fijo.** Con un tic de 30 s, un backoff de 1, 2, 4, 8
 * y 16 segundos no se cumple: la entrada espera hasta el siguiente tic, así que
 * el primer reintento llega hasta 29 s tarde y el backoff deja de describir lo
 * que pasa. Y al revés: un tic corto despierta al worker constantemente para
 * decirle que todavía no toca.
 *
 * Así que el temporizador **lo dirige la cola**: se mira cuál es el
 * `next_attempt_at` más próximo del actor y se programa **una** activación para
 * ese instante. Ni una más.
 *
 * Reloj y planificador se inyectan, de modo que las pruebas pueden afirmar
 * **para cuándo** se programó, y no sólo que algo se programó.
 *
 * **Nada queda vivo en segundo plano.** `stop()` cancela, y quien vuelve a
 * primer plano reprograma. Un temporizador que sobrevive a la app dormida es
 * batería a cambio de nada: al despertar hay que consultar la cola de todos
 * modos.
 */

import type { Clock } from './backoff';
import { describeFailure, type InfrastructureFailure } from './local-failure';
import type { QueueStore } from './queue-store';

/** Lo mínimo de un planificador, para poder detener el tiempo en una prueba. */
export type Scheduler = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export const REAL_SCHEDULER: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Un margen mínimo, y no es un tic disfrazado.
 *
 * `setTimeout(fn, 0)` dentro del propio manejador puede encadenar activaciones
 * sin dejar respirar al resto; un suelo de unos milisegundos rompe ese bucle
 * inmediato sin retrasar nada perceptible. Sólo se aplica a lo **ya vencido**:
 * un plazo futuro se programa exactamente para su instante.
 */
export const IMMEDIATE_FLOOR_MS = 25;

/** Qué dejó una reprogramación. `readFailure` es de la base, no de la cola. */
export type RescheduleResult = {
  readonly armedAt: number | null;
  /**
   * La cola no se pudo leer. **No lanza**: `reschedule` se llama desde sitios
   * que no esperan —el `finally` de una pasada— y una promesa rechazada ahí
   * sería un rechazo sin manejar. Quien llama decide qué hacer con el fallo;
   * el planificador sólo lo cuenta.
   */
  readonly readFailure: InfrastructureFailure | null;
};

export type RetryScheduler = {
  /**
   * Recalcula y reprograma. Idempotente: llamarlo de más sólo sustituye el
   * temporizador por otro equivalente.
   *
   * Se llama al cambiar la cola, la sesión, la conectividad o el primer plano —
   * los cuatro momentos en que el «más próximo» puede haber cambiado.
   *
   * @param external un plazo que no está en la cola, en ms de reloj. Es el
   * reintento de la INFRAESTRUCTURA local: cuando la base falla, no hay fila
   * que lleve el `next_attempt_at`, así que el coordinador lo pasa aquí para
   * que compita con los de la cola por **el mismo y único temporizador**. Un
   * segundo temporizador para la base sería exactamente el mecanismo paralelo
   * que ADR-028 §12 prohíbe.
   */
  reschedule(actorId: string | null, external?: number | null): Promise<RescheduleResult>;
  /** Cancela. Nada queda armado. */
  stop(): void;
  /** Para cuándo está puesto, en ms de reloj. `null` si no hay nada. */
  armedAt(): number | null;
};

export function createRetryScheduler(deps: {
  readonly store: QueueStore;
  readonly clock: Clock;
  readonly scheduler?: Scheduler;
  /** Qué hacer cuando vence. En producción, despertar al worker. */
  readonly onDue: () => void;
}): RetryScheduler {
  const scheduler = deps.scheduler ?? REAL_SCHEDULER;
  let handle: unknown = null;
  let armed: number | null = null;
  /**
   * Qué reprogramación es la vigente. `reschedule` lee la cola con un `await`,
   * y en ese hueco puede llegar otra —o un `stop()`—. Sin esto, la que
   * despertara segunda armaría su temporizador **sin quitar el de la
   * primera**, porque el `disarm()` de las dos ya había pasado: dos
   * temporizadores vivos, y uno sin asa para cancelarlo. Una reprogramación
   * que ya no es la última no arma nada.
   */
  let generation = 0;

  function disarm(): void {
    generation += 1;
    if (handle !== null) {
      scheduler.clear(handle);
      handle = null;
    }
    armed = null;
  }

  return {
    async reschedule(actorId, external = null) {
      disarm();
      const mine = generation;

      let plazos: number[] = [];
      let readFailure: InfrastructureFailure | null = null;

      if (actorId !== null && actorId !== '') {
        /*
         * Sólo `retryable` con plazo. Una `queued` no espera a nada —el worker
         * la coge en cuanto lo despiertan— y una terminal no vuelve por su
         * cuenta.
         */
        try {
          plazos = (await deps.store.pending(actorId))
            .filter((entry) => entry.state === 'retryable' && entry.nextAttemptAt !== null)
            .map((entry) => Date.parse(entry.nextAttemptAt as string))
            .filter((ms) => !Number.isNaN(ms));
        } catch (cause) {
          // La base no contesta. Se dice, no se lanza: quien llama lo cuenta.
          readFailure = describeFailure('schedule', cause, {
            clientOperationId: null,
            afterSend: false,
          });
        }
      }

      // Alguien reprogramó o detuvo mientras se leía: manda quien llegó después.
      if (mine !== generation) return { armedAt: null, readFailure };

      // El plazo externo compite con los de la cola por el único temporizador.
      if (external !== null) plazos.push(external);
      if (plazos.length === 0) return { armedAt: null, readFailure };

      const proximo = Math.min(...plazos);
      const ahora = deps.clock.now();
      const espera = Math.max(proximo - ahora, IMMEDIATE_FLOOR_MS);

      armed = ahora + espera;
      handle = scheduler.set(() => {
        handle = null;
        armed = null;
        deps.onDue();
      }, espera);
      return { armedAt: armed, readFailure };
    },

    stop: disarm,
    armedAt: () => armed,
  };
}
