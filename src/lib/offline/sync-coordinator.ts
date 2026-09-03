/**
 * EL COORDINADOR: lo que hace que el bucle sea automático.
 *
 * El worker sabe enviar y el planificador sabe programar, pero **por separado
 * no forman un ciclo**. Un fallo transitorio escribe su `next_attempt_at` y ahí
 * se queda: si nadie lee el resultado de la pasada, el temporizador no se arma y
 * la entrada espera a un disparador externo que puede no llegar en horas.
 *
 * Esta pieza los une en los dos sentidos, y son exactamente dos flechas:
 *
 * ```
 *   worker  ──onSettled──►  scheduler.reschedule(actor)      cierra el ciclo
 *   worker  ◄────onDue────  scheduler                        lo reabre
 * ```
 *
 * `wake()` es fire-and-forget a propósito —la pantalla no espera a la red— así
 * que quien quiera reaccionar al **resultado** de una pasada no puede esperarla
 * desde fuera. Tiene que enterarse por `onSettled`, y por eso ese puerto existe.
 *
 * **Nada queda armado cuando no toca.** `stop()` desarma, y el planificador sólo
 * programa si hay algo `retryable` de ese actor: confirmar, rechazar, revisar o
 * entrar en conflicto dejan la cola sin plazos y el temporizador desarmado sin
 * que nadie lo desarme explícitamente.
 *
 * **Y `stop()` para las dos mitades, no una.** Desarmar sólo el planificador
 * dejaba dos resurrecciones posibles: un `wake()` retenido en el worker
 * repetía la pasada después de `stop()`, y el `onSettled` de una pasada que
 * seguía en vuelo volvía a armar el temporizador que `stop()` acababa de
 * quitar. Por eso `stop()` corta también el worker, y `onSettled` pregunta
 * antes de reprogramar.
 *
 * ═══ CUANDO LO QUE FALLA ES LA BASE, Y NO EL SERVIDOR ═══
 *
 * Un fallo de SQLite no es una respuesta y no pasa por ADR-028 §11: no mueve
 * ninguna entrada, no crea claves y no abre la puerta directa. Lo que hace el
 * coordinador es tratarlo como lo que es —la infraestructura del cliente no
 * está disponible ahora— y volver a intentarla con el **mismo** backoff, el
 * mismo reloj, el mismo RNG y **el mismo temporizador** que los reintentos de la
 * cola: el plazo de la base se le pasa al planificador como un candidato más, y
 * gana el más próximo. Un segundo temporizador para la base sería el mecanismo
 * paralelo que §12 prohíbe.
 *
 * El contador de fallos vive en memoria: una pasada que termina bien lo pone a
 * cero, y reabrir la app empieza de cero. Cambiar de actor o cerrar sesión
 * cancela el reintento local —era del anterior— y `stop()` lo desarma sin
 * olvidar cuántos fallos llevaba, para que reanudar sobre una base que sigue
 * rota no vuelva al primer segundo. `localStatus()` lo expone; F7.E decidirá si
 * lo enseña. F7.C no diseña ninguna incidencia visible para esto.
 */

import { backoffDelayMs } from './backoff';
import type { InfrastructureFailure, PassResult } from './local-failure';
import { createRetryScheduler, type RetryScheduler, type Scheduler } from './retry-scheduler';
import { createSyncWorker, type SyncWorker } from './sync-worker';
import type { WorkerPorts } from './worker-ports';

/**
 * Si la cola local está respondiendo. **Estado, no incidencia**: F7.C lo
 * expone para que F7.E pueda decir «la cola local no está disponible» si
 * decide hacerlo, y nada más.
 */
export type LocalQueueStatus =
  | { readonly kind: 'available' }
  | {
      readonly kind: 'unavailable';
      /** Fallos consecutivos bajo el mismo actor, en esta ejecución de la app. */
      readonly failures: number;
      readonly last: InfrastructureFailure;
      /** Para cuándo está el reintento de la base, en ms de reloj. `null` si está parado. */
      readonly retryAt: number | null;
    };

export type SyncCoordinator = {
  /** Despierta al worker. Al terminar la pasada, reprograma solo. */
  wake(): void;
  /**
   * Reprograma sin enviar.
   *
   * Para los disparadores que cambian **qué se puede enviar** en vez de la cola:
   * reconexión, primer plano, sesión y cambio de actor. Si el actor no es el
   * que tenía la base fallando, el reintento local se cancela.
   */
  reschedule(): Promise<void>;
  /**
   * Desarma y corta. Nada sobrevive al segundo plano ni al desmontaje: ni el
   * temporizador, ni un `wake()` retenido, ni la reprogramación de una pasada
   * que estuviera en vuelo, ni el reintento de la base. La cola en disco queda
   * como esté; `wake()` reanuda.
   */
  stop(): void;
  /** Para poder afirmar en una prueba que no queda nada puesto. */
  armedAt(): number | null;
  /** Si la infraestructura local está respondiendo. */
  localStatus(): LocalQueueStatus;
  readonly worker: SyncWorker;
  readonly scheduler: RetryScheduler;
};

type LocalState = {
  readonly failures: number;
  readonly actor: string | null;
  readonly last: InfrastructureFailure;
  readonly retryAt: number | null;
};

export function createSyncCoordinator(
  ports: Omit<WorkerPorts, 'onSettled'> & {
    readonly scheduler?: Scheduler;
    /**
     * La salida observable del fallo local. Recibe el fallo —etapa, clave,
     * nombre del error— y cuántos consecutivos van. Nunca el payload, nunca el
     * mensaje. Es un observador: si lanza, se ignora, porque un observador
     * roto no puede convertir un fallo controlado en un rechazo sin manejar.
     */
    readonly onLocalFailure?: (failure: InfrastructureFailure, consecutive: number) => void;
  },
): SyncCoordinator {
  /*
   * El planificador se declara antes del worker porque el worker lo necesita en
   * `onSettled`, y el planificador necesita al worker en `onDue`. La referencia
   * mutable rompe el círculo sin que ninguno de los dos conozca al otro: los dos
   * hablan con el coordinador.
   */
  let worker: SyncWorker | null = null;

  const scheduler = createRetryScheduler({
    store: ports.store,
    clock: ports.clock,
    scheduler: ports.scheduler,
    onDue: () => {
      worker?.wake();
    },
  });

  const currentActor = () => ports.session.actorId();
  const stopped = () => worker?.isStopped() ?? true;

  let local: LocalState | null = null;

  /**
   * Cuenta un fallo local y devuelve para cuándo reintentar la base.
   *
   * El mismo `backoffDelayMs` que los reintentos de la cola: 1 s de suelo,
   * techo que dobla con cada fallo, 5 min de tope. `failures - 1` por la misma
   * razón que en el worker: el retardo se calcula con los que YA habían
   * fallado, para que el primero caiga en el suelo.
   */
  function noteFailure(failure: InfrastructureFailure): number {
    const actor = currentActor();
    const failures = local !== null && local.actor === actor ? local.failures + 1 : 1;
    const retryAt = ports.clock.now() + backoffDelayMs(failures - 1, ports.random);
    local = { failures, actor, last: failure, retryAt };
    try {
      ports.onLocalFailure?.(failure, failures);
    } catch {
      // Un observador que lanza no cambia nada de lo que pasa aquí.
    }
    return retryAt;
  }

  /**
   * Arma el único temporizador con lo que haya: los plazos de la cola y, si lo
   * hay, el de la base. **Nunca rechaza**: el planificador no lanza, y esto se
   * llama desde un `finally` con `void`.
   */
  async function arm(actor: string | null, external: number | null): Promise<void> {
    const result = await scheduler.reschedule(actor, external);
    if (result.readFailure === null || external !== null) return;
    /*
     * La pasada terminó bien pero la LECTURA del planificador falló: también es
     * un fallo local, y también se reintenta. Sin leer esta vez —es lo que
     * acaba de fallar—, y sólo si nadie ha parado mientras se leía.
     */
    if (stopped()) return;
    const retryAt = noteFailure(result.readFailure);
    await scheduler.reschedule(null, retryAt);
  }

  worker = createSyncWorker({
    ...ports,
    // ↓ LA FLECHA QUE CIERRA EL CICLO. Sin ella no hay reintento automático.
    onSettled: (pass: PassResult) => {
      /*
       * Una pasada que termina DESPUÉS de `stop()` no rearma nada: estamos en
       * segundo plano o desmontados, y el siguiente `wake()` —al volver— ya
       * reprograma con lo que haya. Sin esta pregunta, el temporizador que
       * `stop()` quitó volvía a aparecer unos milisegundos después.
       */
      if (stopped()) return;

      let external: number | null = null;
      if (pass.infrastructure !== null) {
        external = noteFailure(pass.infrastructure);
      } else {
        // Una pasada correcta reinicia el contador: la base ha vuelto.
        local = null;
      }
      void arm(currentActor(), external);
    },
  });

  const live = worker;

  return {
    wake: () => {
      live.wake();
    },
    reschedule: async () => {
      const actor = currentActor();
      // Otro actor, o ninguno: el reintento local era del anterior y se cancela.
      if (local !== null && local.actor !== actor) local = null;
      await arm(actor, local?.retryAt ?? null);
    },
    stop: () => {
      // Los dos, y ninguno hace nada asíncrono: al volver no queda nada vivo.
      live.stop();
      scheduler.stop();
      // El reintento de la base se desarma; cuántos fallos llevaba, se recuerda.
      if (local !== null) local = { ...local, retryAt: null };
    },
    armedAt: () => scheduler.armedAt(),
    localStatus: () =>
      local === null
        ? { kind: 'available' }
        : {
            kind: 'unavailable',
            failures: local.failures,
            last: local.last,
            retryAt: local.retryAt,
          },
    worker: live,
    scheduler,
  };
}
