/**
 * EL WORKER: toma una entrada, la envía, y anota lo que pasó.
 *
 * ADR-028 §12. Serie a propósito —**una petición en vuelo** y FIFO por actor—
 * porque el servidor ya serializa los ámbitos bajo un orden ascendente de locks
 * (ADR-022): el paralelismo sobre el mismo ámbito no compra nada, y un worker
 * serie hace deterministas las afirmaciones de orden.
 *
 * **Lo que nunca hace, y es lo que impide duplicar dinero:**
 *
 * - no genera jamás una clave nueva. Ni al agotarse el plazo, ni al perderse la
 *   respuesta, ni al reiniciarse. La entrada y su `client_operation_id` son los
 *   mismos mientras el resultado sea desconocido;
 * - no reintenta una entrada terminal;
 * - no envía nada de otro actor, ni con la sesión de otra persona;
 * - no toca el payload congelado.
 */

import { isDue, nextAttemptAt } from './backoff';
import {
  describeFailure,
  type InfrastructureFailure,
  type InfrastructureStage,
} from './local-failure';
import { classifyResponse, type Classification, type TransportOutcome } from './response';
import { isTerminal, type QueueEntry } from './queue-entry';
import type { WorkerPorts } from './worker-ports';

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Por qué una pasada no envió nada. Útil en pruebas y para no adivinar. */
export type IdleReason = 'noActor' | 'noSession' | 'offline' | 'empty' | 'notDue' | 'stopped';

export type WorkerRun =
  | { readonly kind: 'idle'; readonly reason: IdleReason }
  | {
      readonly kind: 'attempted';
      readonly clientOperationId: string;
      readonly classification: Classification;
    }
  /**
   * La infraestructura local falló y la pasada se interrumpió. **No es una
   * respuesta del servidor**: ninguna entrada cambia de estado por esto, y el
   * coordinador decide cuándo volver a intentar la base (`local-failure.ts`).
   */
  | { readonly kind: 'infrastructure'; readonly failure: InfrastructureFailure };

export type SyncWorker = {
  /**
   * Pide una pasada. **Idempotente y colapsante**: si ya hay una en curso, no
   * arranca otra; **retiene** el aviso y repite al terminar. Diez `wake()`
   * durante una pasada son UNA repetición, no diez.
   *
   * Después de `stop()`, vuelve a arrancar: es la reanudación.
   */
  wake(): void;
  /**
   * Corta. Descarta el aviso retenido y no arranca ninguna pasada más hasta el
   * próximo `wake()`; la petición en vuelo, si la hay, termina y se anota — un
   * envío no se abandona a medias, porque su resultado es lo que hay que
   * guardar.
   *
   * Segundo plano, desmontaje y cierre de sesión pasan por aquí: sin esto, un
   * `wake()` retenido resucitaría el ciclo cuando ya nadie lo quiere.
   */
  stop(): void;
  /** Una pasada, para poder afirmar el resultado sin esperas. */
  runOnce(): Promise<WorkerRun>;
  /** Drena hasta que no quede nada que hacer. `limit` corta un bucle infinito. */
  drain(limit?: number): Promise<WorkerRun[]>;
  /** Si hay una pasada en vuelo. */
  isRunning(): boolean;
  /** Si `stop()` fue lo último. Para que quien reprograma sepa no hacerlo. */
  isStopped(): boolean;
  /** Si hay un `wake()` retenido esperando a que acabe la pasada. Para las pruebas. */
  hasRetainedWake(): boolean;
};

/**
 * Envía con plazo y **cancelación real**.
 *
 * `Promise.race` a secas dejaría la petición viva, que es la objeción histórica
 * del proyecto al timeout. Aquí se aborta de verdad — y aun así, si la petición
 * abandonada llegó a escribir, el reintento con la misma clave recibe
 * `already_processed` y no duplica nada. Es la garantía que hace seguro el
 * plazo, y por eso el plazo llega ahora y no antes.
 */
async function sendWithTimeout(
  ports: WorkerPorts,
  entry: QueueEntry,
  timeoutMs: number,
): Promise<TransportOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await ports.transport.send(entry.commandType, entry.payload, controller.signal);
  } catch {
    // Un lanzamiento del transporte es indistinguible de no haber llegado.
    // Conservador: resultado desconocido.
    return { kind: 'unreachable', reason: controller.signal.aborted ? 'timeout' : 'transport' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Un fallo del store, con la etapa en la que ocurrió y nada del contenido.
 *
 * Es interno: `runOnce` lo convierte en un `WorkerRun` de clase
 * `infrastructure` y **jamás sale del worker como excepción**, porque `wake()`
 * es fire-and-forget y una excepción ahí sería un rechazo sin manejar.
 */
class LocalFailure extends Error {
  constructor(readonly failure: InfrastructureFailure) {
    super(`la infraestructura local falló en «${failure.stage}»`);
    this.name = 'LocalFailure';
  }
}

/**
 * Ejecuta UNA operación del store y, si falla, la etiqueta con su etapa.
 *
 * Todo lo que toca la base pasa por aquí, y sólo lo que toca la base: el
 * transporte tiene su propia red de seguridad en `sendWithTimeout`, y la
 * clasificación es pura. Así, cualquier `LocalFailure` que llegue a `runOnce`
 * es de SQLite o del puerto local, y de nada más.
 */
async function local<T>(
  stage: InfrastructureStage,
  context: { readonly clientOperationId: string | null; readonly afterSend: boolean },
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (cause) {
    throw new LocalFailure(describeFailure(stage, cause, context));
  }
}

const NO_ENTRY = { clientOperationId: null, afterSend: false } as const;

export function createSyncWorker(ports: WorkerPorts): SyncWorker {
  const timeoutMs = ports.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let running = false;
  /**
   * EL AVISO RETENIDO. Una señal booleana, no un contador, a propósito: lo que
   * hay que recordar es «alguien pidió otra pasada», y varias peticiones se
   * funden en una, porque una pasada lee TODA la cola.
   *
   * La carrera que cierra: el worker ya hizo su última lectura de filas
   * enviables y todavía no ha soltado `running`; en esa ventana alguien encola
   * y llama a `wake()`. Sin esto, ese `wake()` se perdía —`running` era
   * `true`— y la fila nueva quedaba `queued` sin `next_attempt_at`, que es
   * justo lo que el planificador NO programa. Esperaba a un disparador externo
   * que puede no llegar en horas.
   */
  let again = false;
  let stopped = false;

  /**
   * La primera ENVIABLE de este actor, en orden FIFO.
   *
   * **`confirmed` no es enviable, aunque tampoco sea terminal.** La distinción
   * importa y confundirla reenvía en bucle una operación ya escrita: `pending`
   * devuelve todo lo no terminal porque la proyección de F7.D necesita seguir
   * pintando lo confirmado hasta reconciliar (ADR-028 §9), pero para el worker
   * eso ya está hecho.
   *
   * `sending` tampoco aparece aquí: el store la relee como `queued` (ADR-028
   * §6), y dentro de una pasada no puede haber otra en vuelo.
   */
  function nextEntry(pending: readonly QueueEntry[]): QueueEntry | 'empty' | 'notDue' {
    const sendable = pending.filter(
      (entry) => entry.state === 'queued' || entry.state === 'retryable',
    );
    if (sendable.length === 0) return 'empty';

    const due = sendable.find((entry) => isDue(entry.nextAttemptAt, ports.clock));
    return due ?? 'notDue';
  }

  async function apply(
    actorId: string,
    entry: QueueEntry,
    outcome: TransportOutcome,
  ): Promise<Classification> {
    const classification = classifyResponse(outcome, ports.session.status());

    const announce = (resultOperationId: string | null) => {
      try {
        ports.onProgress?.({
          actorId,
          clientOperationId: entry.clientOperationId,
          state: classification.state,
          resultOperationId,
        });
      } catch {
        // Un observador que lanza no cambia lo que acaba de quedar escrito.
      }
    };

    if (classification.state === 'confirmed' && outcome.kind === 'ok') {
      /*
       * EL `confirm_seq` SE TOMA DEL CURSOR DURABLE y se escribe junto al
       * `result_operation_id`, en la misma sentencia (ADR-028 §9). Si el
       * proceso muere entre avanzar el cursor y anotar, la fila queda
       * `sending`, se reenvía con su clave, recibe `already_processed` y toma
       * un número nuevo: el cursor sólo crece, que es lo único que importa.
       */
      const confirmSeq = await ports.store.nextConfirmSeq(actorId);
      await ports.store.markProgress(actorId, entry.clientOperationId, {
        state: 'confirmed',
        resultOperationId: outcome.operationId,
        confirmSeq,
        lastErrorClass: null,
        lastErrorCode: null,
        nextAttemptAt: null,
      });
      announce(outcome.operationId);
      return classification;
    }

    if (classification.state === 'retryable') {
      const attempts = entry.attempts + 1;
      await ports.store.markProgress(actorId, entry.clientOperationId, {
        state: 'retryable',
        attempts,
        /*
         * El retardo se calcula con los intentos que YA habían fallado
         * —`entry.attempts`— y no con el recién contado.
         *
         * Con el post-incremento, el primer reintento salía con techo de 2 s en
         * vez de 1 s y la serie quedaba corrida: 2, 4, 8, 16 en lugar de
         * 1, 2, 4, 8, que es lo que fija ADR-028 §12. Y el primer reintento
         * dejaba de ser determinista, porque su techo ya no coincidía con el
         * suelo.
         *
         * La MISMA entrada y la MISMA clave. Sólo se mueve cuándo se reintenta.
         */
        nextAttemptAt: nextAttemptAt(entry.attempts, ports.clock, ports.random),
        lastErrorClass: classification.responseClass,
        lastErrorCode: classification.code,
      });
      announce(null);
      return classification;
    }

    /*
     * `blocked_session`, `rejected`, `review` y `conflict`. Ninguno se reintenta
     * solo: los tres últimos son terminales y esperan a la persona (F7.E), y el
     * primero espera a que vuelva su misma cuenta.
     *
     * `attempts` NO se incrementa aquí: no fue un intento fallido de transporte,
     * fue una respuesta. Contarlo alargaría el backoff de algo que no lo usa.
     */
    await ports.store.markProgress(actorId, entry.clientOperationId, {
      state: classification.state,
      lastErrorClass: classification.responseClass,
      lastErrorCode: classification.code,
      nextAttemptAt: null,
    });
    announce(null);
    return classification;
  }

  /**
   * La pasada, sin la red de seguridad: cualquier fallo del store sube como
   * `LocalFailure` y lo recoge `runOnce`.
   */
  async function attempt(): Promise<WorkerRun> {
    const actorId = ports.session.actorId();
    if (actorId === null || actorId === '') return { kind: 'idle', reason: 'noActor' };

    if (ports.session.status() !== 'signed-in') return { kind: 'idle', reason: 'noSession' };

    /*
     * UNA lectura por pasada, y de ella sale todo lo demás.
     *
     * Las bloqueadas por sesión vuelven a la cola en cuanto hay una válida DEL
     * MISMO ACTOR — que es lo único que `actorId` puede ser aquí, porque el
     * store filtra por él — y se tratan como `queued` en esta misma pasada, sin
     * releer. Que la lectura sea una sola es también lo que hace exacta la
     * prueba de la carrera del aviso retenido: «la última lectura» es una fila
     * concreta, no la segunda de dos.
     *
     * **Aquí no llega ninguna `sending`.** El store la relee siempre como
     * `queued` (ADR-028 §6, en `rowToEntry`), así que una fila que quedó en
     * disco a medias —por un proceso que murió en pleno envío, o por una
     * anotación que SQLite no pudo escribir después de la respuesta— entra en
     * esta pasada como `queued`, con su misma clave, y se reenvía. Es seguro
     * porque el worker es serie: al empezar una pasada no hay ninguna petición
     * de este worker en vuelo, así que esa fila no puede ser la de nadie. El
     * servidor pudo haber escrito, y si fue así contesta `already_processed`.
     */
    const rows = await local('read', NO_ENTRY, () => ports.store.pending(actorId));
    const pending: QueueEntry[] = [];
    for (const entry of rows) {
      if (entry.state === 'blocked_session') {
        await local(
          'revive',
          { clientOperationId: entry.clientOperationId, afterSend: false },
          () => ports.store.markProgress(actorId, entry.clientOperationId, { state: 'queued' }),
        );
        pending.push({ ...entry, state: 'queued' });
      } else {
        pending.push(entry);
      }
    }

    // El supresor, después de revivir y antes de intentar: sin enlace no se
    // intenta, y **no se marca nada como fallido**.
    if (!ports.connectivity.isConnected()) return { kind: 'idle', reason: 'offline' };

    const next = nextEntry(pending);
    if (next === 'empty' || next === 'notDue') return { kind: 'idle', reason: next };

    /*
     * Un `stop()` que llegó mientras se leía: la fila ya está en la mano, pero
     * la petición no ha empezado, y después de `stop()` no empieza ninguna. Se
     * comprueba aquí y no sólo en el bucle de `pump()` porque el bucle sólo ve
     * el resultado de la pasada, cuando ya sería tarde para no enviar.
     */
    if (stopped) return { kind: 'idle', reason: 'stopped' };

    /*
     * THE SEND IS DECLARED BEFORE IT HAPPENS, and it is declared durably.
     *
     * Two writes, and every order in which they can be interrupted is safe:
     *
     *   counter taken, then death   nothing left, nothing sent. The counter
     *                               skipped a number, and it only has to grow.
     *   mark written, then death    nothing sent, yet the row says the entry
     *                               MAY exist on the server. Conservative: a
     *                               refresh will refuse to trust a new base
     *                               until the retry settles it, which it does
     *                               with the same key.
     *   mark written, sent, death   the case this exists for. The mark is on
     *                               disk, so nobody accepts a server read that
     *                               may already contain this movement while it
     *                               is still being projected.
     *
     * If either write fails the row stays `queued` and NOTHING has left, so the
     * pass is retried. The mark itself is one statement (`markDispatched`), so
     * the state and the mark can never come apart.
     */
    const dispatchSeq = await local(
      'markSending',
      { clientOperationId: next.clientOperationId, afterSend: false },
      () => ports.store.nextDispatchSeq(actorId),
    );
    await local(
      'markSending',
      { clientOperationId: next.clientOperationId, afterSend: false },
      () => ports.store.markDispatched(actorId, next.clientOperationId, dispatchSeq),
    );
    const outcome = await sendWithTimeout(ports, next, timeoutMs);
    /*
     * Y si falla ESTO, la petición ya salió: la fila queda `sending` en disco,
     * con su clave, y la siguiente pasada la relee como `queued` (§6). El
     * servidor dirá si aquello llegó. Lo único que no puede pasar es que la
     * respuesta que no pudo guardarse se traduzca en otra clave o en un estado
     * terminal: `apply` es la única que escribe estados, y no llegó a escribir.
     */
    const classification = await local(
      'record',
      { clientOperationId: next.clientOperationId, afterSend: true },
      () => apply(actorId, next, outcome),
    );

    return { kind: 'attempted', clientOperationId: next.clientOperationId, classification };
  }

  async function runOnce(): Promise<WorkerRun> {
    try {
      return await attempt();
    } catch (error) {
      // Lo local se devuelve; cualquier otra cosa es un defecto y sí debe verse.
      if (error instanceof LocalFailure) return { kind: 'infrastructure', failure: error.failure };
      throw error;
    }
  }

  async function pump(): Promise<void> {
    if (running) {
      // Retenido, no perdido. Se fundirá con cualquier otro que llegue.
      again = true;
      return;
    }
    running = true;
    let infrastructure: InfrastructureFailure | null = null;
    try {
      do {
        /*
         * Se baja ANTES de leer, no después: un `wake()` que llegue durante la
         * lectura tiene que sobrevivir a esta vuelta, porque la lectura ya no
         * lo va a ver. Bajarlo después lo borraría, y eso es la carrera.
         */
        again = false;
        let guard = 0;
        let run = await runOnce();
        while (run.kind === 'attempted' && !stopped && guard < 100) {
          guard += 1;
          run = await runOnce();
        }
        if (run.kind === 'infrastructure') infrastructure = run.failure;
        /*
         * La repetición vuelve a preguntar por actor, sesión y enlace desde
         * cero —lo hace `runOnce`—, así que una cuenta que cambió entre medias
         * no ve una fila de la anterior. Y una repetición que no encuentra
         * nada termina aquí: nadie sube `again` salvo un `wake()` nuevo.
         *
         * Con la base rota no se repite aunque haya aviso retenido: insistir
         * ahora mismo sobre lo que acaba de fallar es el bucle inmediato que
         * el backoff existe para evitar. El coordinador pondrá el plazo.
         */
      } while (again && !stopped && infrastructure === null);
    } finally {
      running = false;
      again = false;
      /*
       * AQUÍ SE CIERRA EL CICLO, y es el único sitio donde puede cerrarse.
       *
       * La pasada acaba de dejar en la base lo que haya dejado —un
       * `next_attempt_at` nuevo, un terminal, una confirmación— y éste es el
       * primer instante en que alguien puede leerlo y decidir para cuándo
       * programar. Antes de aquí no había nada que programar; después de aquí,
       * si nadie mira, nadie lo hará.
       *
       * Se avisa también tras `stop()`: quien escucha decide, con `isStopped()`,
       * si toca reprogramar. El worker no sabe qué hay al otro lado.
       */
      ports.onSettled?.({ infrastructure });
    }
  }

  return {
    wake() {
      stopped = false;
      void pump();
    },
    stop() {
      stopped = true;
      again = false;
    },
    runOnce,
    async drain(limit = 50) {
      const runs: WorkerRun[] = [];
      for (let i = 0; i < limit; i += 1) {
        const run = await runOnce();
        runs.push(run);
        if (run.kind === 'idle') break;
      }
      return runs;
    },
    isRunning: () => running,
    isStopped: () => stopped,
    hasRetainedWake: () => again,
  };
}

/**
 * Un reintento manual, y lo único que hace es **adelantar el plazo**.
 *
 * ADR-028 §12: sobre una entrada cuyo resultado es desconocido, nunca se crea
 * otra entrada ni otra clave, porque el servidor pudo haberla ejecutado. Sobre
 * una terminal no hay reintento de ninguna clase — eso es §15 y es F7.E.
 */
export async function retryNow(
  ports: Pick<WorkerPorts, 'store'>,
  actorId: string,
  clientOperationId: string,
): Promise<boolean> {
  const entry = await ports.store.byId(actorId, clientOperationId);
  if (entry === null || isTerminal(entry.state)) return false;

  await ports.store.markProgress(actorId, clientOperationId, { nextAttemptAt: null });
  return true;
}
