/**
 * ═══════════ INFRAESTRUCTURA PREPARADA. SIN CONSUMIDOR TODAVÍA. ═══════════
 *
 * **Nada monta este hook en F7.C**, y es deliberado: activar la cola sin la
 * proyección optimista de F7.D cerraría la hoja y dejaría el movimiento
 * invisible hasta sincronizar, que es una regresión que no debe entrar en
 * `main`. La ruta de alta sigue enviando directamente, como en F6.
 *
 * **F7.D hará la sustitución en un solo cambio**, no con un conmutador: monta
 * este hook, retira `useRecordMovement` del alta y devuelve la guarda de
 * `personal-service`. Mientras tanto esto es una pieza inerte —el worker se
 * crea perezosamente **la primera vez que alguien encola**, así que sin
 * consumidor no existe y no puede procesar nada por accidente—.
 *
 * Cuando se active, dar de alta hará exactamente esto y en este orden
 * (ADR-028 §1):
 *
 *   1  construir y validar el payload UNA vez        `buildPayload`
 *   2  generar la clave                              `newClientOperationId`
 *   3  persistir clave y payload ATÓMICAMENTE        `store.enqueue`
 *   4  sólo entonces, cerrar la hoja                 lo hace quien llama
 *   5  despertar al worker                           `worker.wake()`
 *   6  enviar siempre el payload congelado           el worker, por su transporte
 *
 * **El orden 3 → 4 no es negociable.** Cerrar antes de persistir dejaría un
 * hueco en el que un cierre forzado pierde la intención sin que nadie lo sepa.
 *
 * **Y entonces no habrá segunda ruta:** F7.D devuelve a `personal-service` la
 * guarda que impide enviar un alta por el RPC directo. Hoy esa guarda no está,
 * porque la ruta directa es la única activa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { persistEntry, type EntryScope, type PersistFailure } from './entry-enqueue';
import type { EntryDraft } from './movement-entry';
import { sendPersonalEntry } from './personal-service';
import { createQueueTransport } from './queue-transport';
import { newClientOperationId } from '@/lib/id';
import { createNetInfoConnectivity } from '@/lib/net';
import {
  createSqliteQueueStore,
  createSyncCoordinator,
  offlineDatabase,
  type Connectivity,
  type SessionPort,
  type SessionStatus,
  type SyncCoordinator,
} from '@/lib/offline';

export type { EntryScope } from './entry-enqueue';

/** Por qué no se pudo encolar. `null` es que sí. */
export type EnqueueFailure = 'noScope' | 'noSession' | PersistFailure;

export type EntryQueue = {
  /** `true` si quedó persistida. Sólo entonces puede cerrarse la hoja. */
  readonly enqueue: (draft: EntryDraft, scope: EntryScope) => Promise<boolean>;
  readonly failure: EnqueueFailure | null;
  readonly saving: boolean;
};

/**
 * El worker vive fuera de React, y es a propósito.
 *
 * Es un proceso, no un estado de pantalla: montarlo y desmontarlo con una hoja
 * lo mataría en mitad de un envío, y tener uno por pantalla rompería «una sola
 * petición en vuelo». Se crea perezosamente y se comparte.
 *
 * La identidad **no se captura**: los puertos la consultan en cada pasada, así
 * que un cambio de cuenta lo ve el worker sin recrearse y sin poder enviar nada
 * de la anterior.
 */
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

async function ensureWorker(): Promise<WorkerHandle> {
  if (handle !== null) return handle;
  starting ??= (async () => {
    const store = createSqliteQueueStore(await offlineDatabase());
    const connectivity = createNetInfoConnectivity();
    /*
     * EL COORDINADOR, y no un worker y un planificador sueltos.
     *
     * Une los dos sentidos —`onSettled → reschedule` y `onDue → wake`— que son
     * lo que hace automático el reintento. Montarlos por separado dejaba el
     * ciclo abierto: un fallo transitorio escribía su `next_attempt_at` y nadie
     * armaba el temporizador.
     *
     * UN solo temporizador, dirigido por el plazo más próximo. Nunca un tic
     * fijo: con uno de 30 s, un backoff de 1, 2, 4, 8 y 16 segundos no se
     * cumpliría, porque la entrada esperaría al siguiente tic.
     */
    const coordinator = createSyncCoordinator({
      store,
      transport: createQueueTransport(sendPersonalEntry),
      clock: { now: () => Date.now() },
      random: Math.random,
      connectivity,
      session: sessionPort,
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
 * @param actorId el `sub` de la sesión, o cadena vacía si no hay. Viene de la
 * ruta por la misma razón que en `usePersonalHome`: `features/` no puede
 * importar `features/`.
 */
export function useEntryQueue(actorId: string, status: SessionStatus): EntryQueue {
  const [failure, setFailure] = useState<EnqueueFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  /*
   * La identidad que consultan los puertos.
   *
   * **En un efecto y no en el render.** Mutar un valor de módulo mientras se
   * renderiza es lo que prohíbe `react-hooks/immutability`, y con razón: un
   * render puede descartarse, y la cola habría quedado apuntando a una
   * identidad que nunca se pintó. `enqueue` la vuelve a fijar antes de escribir,
   * así que no hay ventana en la que el worker vea una cuenta vieja.
   */
  useEffect(() => {
    identity.actorId = actorId === '' ? null : actorId;
    identity.status = status;
  }, [actorId, status]);

  useEffect(() => {
    let alive = true;
    /*
     * La limpieza se guarda AQUÍ y no se devuelve desde dentro del `async`.
     *
     * Lo que devuelve un IIFE asíncrono se pierde: React no lo ve, así que la
     * suscripción y el temporizador quedarían vivos para siempre. Con la
     * referencia fuera, la limpieza real las alcanza aunque el arranque termine
     * después de desmontarse.
     */
    let teardown: (() => void) | null = null;

    void (async () => {
      try {
        const { coordinator, connectivity } = await ensureWorker();
        if (!alive) return;

        /*
         * Los disparadores. El de primer plano NO se registra aquí: lo tiene el
         * `AppStatePort` de F5.B, y un segundo listener sería exactamente el
         * segundo mecanismo que ADR-028 §12 prohíbe. Lo conecta la raíz.
         */
        const stopConnectivity = connectivity.subscribe((connected) => {
          if (connected) coordinator.wake();
        });

        teardown = () => {
          coordinator.stop();
          stopConnectivity();
        };
        if (!alive) {
          teardown();
          return;
        }

        /*
         * Reparar en disco lo que quedó `sending`, y arrancar.
         *
         * Es higiene, no lo que hace que se reenvíe: el store ya relee toda
         * `sending` como `queued` (ADR-028 §6), así que el worker la enviaría
         * igual con su misma clave. Por eso un fallo aquí no impide despertar:
         * la base que no pudo reparar es la misma que el worker va a encontrar,
         * y él sabe contarlo como fallo local y reintentarla con backoff.
         */
        if (identity.actorId !== null) {
          try {
            const store = createSqliteQueueStore(await offlineDatabase());
            await store.recoverSending(identity.actorId);
          } catch {
            // Se dirá en la pasada, con su etapa y sin contenido.
          }
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

  const enqueue = useCallback(
    async (draft: EntryDraft, scope: EntryScope): Promise<boolean> => {
      if (inFlight.current) return false; // el doble toque muere aquí, síncrono
      inFlight.current = true;
      setFailure(null);

      try {
        if (actorId === '' || status !== 'signed-in') {
          setFailure('noSession');
          return false;
        }

        // Aquí sí, que es un manejador: los puertos tienen que ver esta cuenta
        // y no la que hubiera cuando corrió el último efecto.
        identity.actorId = actorId;
        identity.status = status;

        setSaving(true);
        const { coordinator } = await ensureWorker();
        const store = createSqliteQueueStore(await offlineDatabase());

        /*
         * 1 · el payload, UNA vez. 2 · la clave. 3 · persistir, atómicamente y
         * ANTES de cualquier petición. Los tres en `persistEntry`, que es puro y
         * está probado con la base fallando: si no puede demostrar que clave y
         * payload quedaron en disco, devuelve fallo, aquí se devuelve `false` y
         * **la hoja no se cierra**. No se reintenta con otra clave —nada salió—
         * y no se envía por la puerta directa para salvarlo.
         */
        const persisted = await persistEntry(store, {
          actorId,
          draft,
          scope,
          key: newClientOperationId(),
          createdAt: new Date().toISOString(),
        });
        if (!persisted.ok) {
          setFailure(persisted.reason);
          return false;
        }

        /*
         * 5 · despertar al worker. No se espera: la hoja no depende de la red.
         *
         * Y no hace falta reprogramar a mano: al terminar la pasada, el
         * `onSettled` del coordinador reprograma con lo que haya quedado en la
         * cola. Llamar a `reschedule` aquí sería hacerlo **antes** del envío,
         * cuando todavía no hay ningún plazo que programar — que es
         * exactamente el error que dejaba el ciclo abierto.
         */
        coordinator.wake();
        return true;
      } catch {
        setFailure('storeUnavailable');
        return false;
      } finally {
        setSaving(false);
        inFlight.current = false;
      }
    },
    [actorId, status],
  );

  return useMemo(() => ({ enqueue, failure, saving }), [enqueue, failure, saving]);
}

/**
 * Despierta la cola desde fuera de React.
 *
 * Existe para el disparador de **vuelta a primer plano**, que llega por el
 * `AppStatePort` que F5.B ya tenía —ADR-028 §12 prohíbe un segundo listener— y
 * al que sólo puede engancharse el árbol raíz. Si el worker no está creado,
 * esto no lo crea: no hay nada que enviar hasta que alguien encole.
 */
export function wakeEntryQueue(): void {
  handle?.coordinator.wake();
}

/**
 * Cuántas intenciones de este actor están sin sincronizar.
 *
 * Para el aviso previo al cierre de sesión (ADR-028 §13): las entradas **se
 * conservan**, aisladas por cuenta, y sólo podrán salir cuando esa misma cuenta
 * vuelva a entrar **en este aparato** —`signOut({ scope: 'local' })` revoca su
 * refresh token—. Decirlo antes es lo único honesto; **nunca se descartan
 * automáticamente**.
 *
 * Devuelve `0` si no hay base o no hay actor: el aviso no se enseña por
 * sospecha, sólo cuando de verdad hay algo pendiente.
 */
export async function countUnsyncedEntries(actorId: string): Promise<number> {
  if (actorId === '') return 0;
  try {
    const store = createSqliteQueueStore(await offlineDatabase());
    const pending = await store.pending(actorId);
    return pending.filter((entry) => entry.state !== 'confirmed').length;
  } catch {
    return 0;
  }
}
