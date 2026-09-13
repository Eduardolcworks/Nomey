/**
 * EL WORKER EN LA RAÍZ, UNA SOLA VEZ.
 *
 * Es un proceso, no un estado de pantalla: montarlo y desmontarlo con una hoja
 * lo mataría en mitad de un envío, y tener uno por pantalla rompería «una sola
 * petición en vuelo» (ADR-028 §12). Por eso vive en este módulo, se crea
 * perezosamente y lo gobierna un único hook que la raíz monta dentro del
 * proveedor de sesión — `useQueueRuntime`, en `features/shell`.
 *
 * **Vive en `lib/offline` y no en una feature, y eso es lo que lo hace UNO.**
 * Desde F9 lo comparten Personal y Grupos, y las features no pueden importarse
 * entre sí: dejarlo en una de ellas habría obligado a la otra a montar un
 * segundo worker, una segunda persistencia y una segunda barrera, que es
 * exactamente lo que ADR-028 §12 prohíbe.
 *
 * **Y por eso el transporte llega INYECTADO.** `lib/` no puede conocer a
 * ninguna feature, así que quién sabe traducir cada tipo de comando a una
 * llamada concreta lo aporta la composición de arriba. Aquí sólo se despacha.
 *
 * Los disparadores, y de dónde sale cada uno:
 *
 *   encolar              `useEntryQueue`, tras persistir
 *   primer plano         `wakeEntryQueue`, desde el `onForeground` del
 *                        `SessionProvider` — el listener de `AppState` que F5 ya
 *                        tenía. NO hay un segundo listener.
 *   reconexión           NetInfo, suscrito aquí
 *   sesión y actor       este hook, al cambiar `actorId` o `status`
 *   vencer un plazo      el planificador del coordinador
 *
 * **La identidad no se captura**: los puertos la consultan en cada pasada, así
 * que un cambio de cuenta lo ve el worker sin recrearse y sin poder enviar nada
 * de la anterior.
 */

import { createNetInfoConnectivity } from '@/lib/net';

import type { FrozenPayloadOf, QueueCommandType } from './command';
import { offlineDatabase } from './sqlite-database';
import { publishQueueChange } from './queue-events';
import type { QueueBarrier, QueueStore } from './queue-store';
import { createSqliteQueueStore } from './sqlite-queue-store';
import type { SessionStatus, TransportOutcome } from './response';
import {
  createSyncCoordinator,
  type LocalQueueStatus,
  type SyncCoordinator,
} from './sync-coordinator';
import type { Connectivity, QueueTransport, SessionPort } from './worker-ports';

/**
 * QUIÉN SABE MANDAR CADA TIPO DE COMANDO.
 *
 * Un manejador por valor del vocabulario cerrado, aportado por la feature que
 * sabe traducirlo. `lib/` no conoce ninguna, así que el mapa llega entero desde
 * la composición de la raíz.
 *
 * **Sigue siendo un vocabulario cerrado**: el tipo obliga a cubrirlo entero, de
 * modo que añadir un comando no compila hasta que alguien decide qué función le
 * corresponde — que es exactamente la decisión que ADR-028 §3 no quiere que se
 * tome por descuido.
 */
export type CommandHandler<K extends QueueCommandType = QueueCommandType> = (
  payload: FrozenPayloadOf<K>,
  signal: AbortSignal,
) => Promise<TransportOutcome>;

export type CommandHandlers = {
  readonly [K in QueueCommandType]: CommandHandler<K>;
};

/**
 * El transporte, construido a partir de los manejadores.
 *
 * **No construye ni valida nada.** Manda el payload congelado tal cual, porque
 * cualquier reconstrucción cambiaría la intención canónica que el servidor
 * calcula y convertiría un replay en `IDEMPOTENCY_KEY_REUSED`.
 */
export function createDispatchingTransport(handlers: CommandHandlers): QueueTransport {
  return {
    async send(commandType, payload, signal) {
      const handler = handlers[commandType] as CommandHandler | undefined;
      if (handler === undefined) {
        // Una entrada de una version posterior de la app. No se ejecuta nunca.
        throw new Error(`comando no enrutable: ${String(commandType)}`);
      }
      return handler(payload as never, signal);
    },
  };
}

type WorkerHandle = { coordinator: SyncCoordinator; connectivity: Connectivity };

let handle: WorkerHandle | null = null;
let starting: Promise<WorkerHandle> | null = null;

const identity: { actorId: string | null; status: SessionStatus } = {
  actorId: null,
  status: 'restoring',
};

const sessionPort: SessionPort = {
  status: () => identity.status,
  actorId: () => identity.actorId,
  subscribe: () => () => undefined,
};

/** Fija la identidad que consultan los puertos. Se llama desde efectos y manejadores, nunca en el render. */
export function setQueueIdentity(actorId: string, status: SessionStatus): void {
  identity.actorId = actorId === '' ? null : actorId;
  identity.status = status;
}

/** El store sobre la base de la app. Sin estado propio: se puede pedir cada vez. */
export async function queueStore(): Promise<QueueStore> {
  return createSqliteQueueStore(await offlineDatabase());
}

/**
 * @param handlers quién manda cada tipo de comando. Se usa **la primera vez**:
 * el worker es uno solo, y rehacerlo con otro mapa lo mataría en mitad de un
 * envío. Cambiar el reparto exige reiniciar la app, que es lo correcto para
 * algo que se ensambla en la raíz y no cambia en caliente.
 */
export async function ensureWorker(handlers: CommandHandlers): Promise<WorkerHandle> {
  if (handle !== null) return handle;
  starting ??= (async () => {
    const store = await queueStore();
    const connectivity = createNetInfoConnectivity();
    /*
     * EL COORDINADOR, y no un worker y un planificador sueltos: une los dos
     * sentidos —`onSettled → reschedule` y `onDue → wake`— que hacen automático
     * el reintento, con UN temporizador dirigido por el plazo más próximo.
     */
    const coordinator = createSyncCoordinator({
      store,
      transport: createDispatchingTransport(handlers),
      clock: { now: () => Date.now() },
      random: Math.random,
      connectivity,
      session: sessionPort,
      // Lo que la proyección escucha: de quién, cuál y a qué estado. Sin payload.
      onProgress: (change) => {
        publishQueueChange({ kind: 'progress', ...change });
      },
    });
    handle = { coordinator, connectivity };
    return handle;
  })().catch((error: unknown) => {
    starting = null;
    throw error;
  });
  return starting;
}

/**
 * Despierta la cola desde fuera de React.
 *
 * Es el disparador de **vuelta a primer plano**, que llega por el `AppStatePort`
 * que F5.B ya tenía —ADR-028 §12 prohíbe un segundo listener—. Si el worker no
 * está creado, no lo crea: sin sesión no hay nada que enviar.
 */
export function wakeQueue(): void {
  handle?.coordinator.wake();
}

/**
 * THE READ BARRIER of ADR-028 §9, taken at one instant.
 *
 * Read at the START of an authoritative refresh and again when its response
 * arrives; `snapshot-window.ts` decides what that pair allows. `confirmSeq` is
 * the mark the projection keeps; the other two are what make the mark mean
 * anything.
 */
export async function readBarrier(actorId: string): Promise<QueueBarrier> {
  return (await queueStore()).barrier(actorId);
}

/**
 * WHETHER THE SCREEN IS CURRENTLY PAINTING ANY LOCAL ENTRY.
 *
 * Published by whoever projects, per actor, and read only when the barrier
 * cannot be read at all. It is deliberately not a database question: with
 * SQLite broken, "how many local rows are on screen" is still knowable with
 * certainty, and it is the only thing that decides whether an unprovable base
 * could do any harm. Nothing accounting is derived from it.
 */
const projecting = new Map<string, number>();

export function noteProjecting(actorId: string, count: number): void {
  if (actorId === '') return;
  projecting.set(actorId, count);
}

export function isProjecting(actorId: string): boolean {
  return (projecting.get(actorId) ?? 0) > 0;
}

/** Signing out or switching accounts: what the other account painted is not ours. */
export function forgetProjecting(actorId: string): void {
  projecting.delete(actorId);
}

/** Si la infraestructura local está respondiendo. `null` si el worker no existe. Para F7.E. */
export function localQueueStatus(): LocalQueueStatus | null {
  return handle?.coordinator.localStatus() ?? null;
}

/**
 * Cuántas intenciones de este actor están sin sincronizar.
 *
 * Para el aviso previo al cierre de sesión (ADR-028 §13): las entradas **se
 * conservan**, aisladas por cuenta, y sólo podrán salir cuando esa misma cuenta
 * vuelva a entrar **en este aparato**. Devuelve `0` si no hay base o no hay
 * actor: el aviso no se enseña por sospecha.
 */
export async function countUnsyncedEntries(actorId: string): Promise<number> {
  if (actorId === '') return 0;
  try {
    const pending = await (await queueStore()).pending(actorId);
    return pending.filter((entry) => entry.state !== 'confirmed').length;
  } catch {
    return 0;
  }
}
