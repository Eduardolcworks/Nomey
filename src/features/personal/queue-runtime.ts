/**
 * EL WORKER EN LA RAÍZ, UNA SOLA VEZ.
 *
 * Es un proceso, no un estado de pantalla: montarlo y desmontarlo con una hoja
 * lo mataría en mitad de un envío, y tener uno por pantalla rompería «una sola
 * petición en vuelo» (ADR-028 §12). Por eso vive en este módulo, se crea
 * perezosamente y lo gobierna un único hook que la raíz monta dentro del
 * proveedor de sesión: `useEntryQueueRuntime`.
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

import { useEffect } from 'react';

import { publishQueueChange } from './queue-events';
import { createQueueTransport } from './queue-transport';
import { sendPersonalEntry } from './personal-service';
import { createNetInfoConnectivity } from '@/lib/net';
import {
  createSqliteQueueStore,
  createSyncCoordinator,
  type Connectivity,
  type LocalQueueStatus,
  offlineDatabase,
  type QueueBarrier,
  type QueueStore,
  type SessionPort,
  type SessionStatus,
  type SyncCoordinator,
} from '@/lib/offline';

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

export async function ensureWorker(): Promise<WorkerHandle> {
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
      transport: createQueueTransport(sendPersonalEntry),
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
 * Gobierna el worker desde la raíz.
 *
 * @param actorId el `sub` de la sesión, o cadena vacía si no hay.
 * @param status el estado de la sesión.
 */
export function useEntryQueueRuntime(actorId: string, status: SessionStatus): void {
  /*
   * En un efecto y no en el render: un render puede descartarse, y la cola
   * habría quedado apuntando a una identidad que nunca se pintó.
   */
  useEffect(() => {
    setQueueIdentity(actorId, status);
  }, [actorId, status]);

  useEffect(() => {
    let alive = true;
    /*
     * La limpieza se guarda AQUÍ y no se devuelve desde dentro del `async`: lo
     * que devuelve un IIFE asíncrono se pierde, y la suscripción quedaría viva
     * para siempre.
     */
    let teardown: (() => void) | null = null;

    void (async () => {
      try {
        const { coordinator, connectivity } = await ensureWorker();
        if (!alive) return;

        const stopConnectivity = connectivity.subscribe((connected) => {
          if (connected) coordinator.wake();
        });
        teardown = () => {
          // Segundo plano, desmontaje, cierre de sesión o cambio de cuenta:
          // se desarma todo y las filas se quedan como están.
          coordinator.stop();
          stopConnectivity();
        };
        if (!alive) {
          teardown();
          return;
        }

        if (identity.status !== 'signed-in' || identity.actorId === null) {
          // Sin sesión no hay nada que enviar: parado, con la cola intacta.
          coordinator.stop();
          return;
        }

        /*
         * Reparar en disco lo que quedó `sending`, y arrancar. Es higiene: el
         * store ya relee toda `sending` como `queued` (ADR-028 §6), así que un
         * fallo aquí no impide despertar — el worker contará esa base como
         * fallo local y la reintentará con backoff.
         */
        try {
          await (await queueStore()).recoverSending(identity.actorId);
        } catch {
          // Se dirá en la pasada, con su etapa y sin contenido.
        }
        coordinator.wake();
      } catch {
        // Sin base no hay cola. No se rompe la pantalla; se dirá al encolar.
      }
    })();

    return () => {
      alive = false;
      teardown?.();
    };
  }, [actorId, status]);
}

/**
 * Despierta la cola desde fuera de React.
 *
 * Es el disparador de **vuelta a primer plano**, que llega por el `AppStatePort`
 * que F5.B ya tenía —ADR-028 §12 prohíbe un segundo listener—. Si el worker no
 * está creado, no lo crea: sin sesión no hay nada que enviar.
 */
export function wakeEntryQueue(): void {
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
