/**
 * ═══════════ LA RUTA DE ALTA, DESDE F7.D ═══════════
 *
 * Dar de alta un gasto o un ingreso pasa **siempre** por aquí, y hace
 * exactamente esto y en este orden (ADR-028 §1):
 *
 *   1  validar el borrador y construir el payload UNA vez   `persistEntry`
 *   2  generar `client_operation_id`                        `newClientOperationId`
 *   3  persistir clave y payload ATÓMICAMENTE               `store.enqueue`
 *   4  publicar el cambio, para que la proyección lo vea   `publishQueueChange`
 *   5  cerrar la hoja                                       quien llama, con `true`
 *   6  despertar al worker                                  en la siguiente macrotarea
 *   7  enviar siempre el payload congelado                  el worker, por su transporte
 *
 * **La hoja sólo se cierra si el paso 3 quedó demostrado.** Si SQLite falla,
 * esto devuelve `false`, la hoja y el borrador se quedan donde estaban, y no se
 * hace ninguna petición directa para salvar el gasto: la puerta directa para
 * altas ya no existe (`personal-service` la refuerza con una guarda).
 *
 * **El worker se despierta DESPUÉS de cerrar.** `wake()` va en `setTimeout(…, 0)`
 * y no en la misma vuelta: la continuación de quien espera este `enqueue` es
 * una microtarea, así que la hoja ya está cerrándose cuando la primera lectura
 * de SQLite del worker arranca. La hoja no depende de la red ni de la cola, y
 * el orden 5 → 6 queda como ADR-028 §1 lo escribe.
 *
 * Lo que este hook NO hace: no monta el worker —lo hace la raíz con
 * `useEntryQueueRuntime`— ni suscribe nada. Sólo encola.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { persistEntry, type EntryScope, type PersistFailure } from './entry-enqueue';
import type { EntryDraft } from './movement-entry';
import { publishQueueChange } from './queue-events';
import { ensureWorker, queueStore, setQueueIdentity } from './queue-runtime';
import { newClientOperationId } from '@/lib/id';
import type { SessionStatus } from '@/lib/offline';

export type { EntryScope } from './entry-enqueue';

/** Por qué no se pudo encolar. `null` es que sí. */
export type EnqueueFailure = 'noScope' | 'noSession' | PersistFailure;

export type EntryQueue = {
  /**
   * `true` si quedó persistida. Sólo entonces puede cerrarse la hoja.
   *
   * `resolving` es la entrada terminal que esta intención sustituye cuando la
   * hoja se abrió desde `Revisar`. Con ella, persistir y resolver la incidencia
   * son la misma transacción (ADR-029 §4).
   */
  readonly enqueue: (
    draft: EntryDraft,
    scope: EntryScope,
    resolving?: string | null,
  ) => Promise<boolean>;
  readonly failure: EnqueueFailure | null;
  readonly saving: boolean;
};

/**
 * @param actorId el `sub` de la sesión, o cadena vacía si no hay. Viene de la
 * ruta por la misma razón que en `usePersonalHome`: `features/` no puede
 * importar `features/`.
 */
export function useEntryQueue(actorId: string, status: SessionStatus): EntryQueue {
  const [failure, setFailure] = useState<EnqueueFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const enqueue = useCallback(
    async (draft: EntryDraft, scope: EntryScope, resolving?: string | null): Promise<boolean> => {
      if (inFlight.current) return false; // el doble toque muere aquí, síncrono
      inFlight.current = true;
      setFailure(null);

      try {
        if (actorId === '' || status !== 'signed-in') {
          setFailure('noSession');
          return false;
        }

        // En un manejador sí: los puertos tienen que ver esta cuenta y no la
        // que hubiera cuando corrió el último efecto de la raíz.
        setQueueIdentity(actorId, status);

        setSaving(true);
        const { coordinator } = await ensureWorker();
        const store = await queueStore();

        // 1 · 2 · 3 — en `persistEntry`, que es puro y está probado con la base
        // fallando: si no puede demostrar que clave y payload quedaron en
        // disco, devuelve fallo y la hoja no se cierra.
        const persisted = await persistEntry(store, {
          actorId,
          draft,
          scope,
          key: newClientOperationId(),
          createdAt: new Date().toISOString(),
          replacing: resolving ?? null,
        });
        if (!persisted.ok) {
          setFailure(persisted.reason);
          return false;
        }

        // 4 · publicar: la proyección relee la cola y pinta la fila.
        publishQueueChange({
          kind: 'enqueued',
          actorId,
          clientOperationId: persisted.clientOperationId,
          state: 'queued',
        });

        // 6 · despertar, en la siguiente macrotarea: después de que quien llama
        // haya cerrado la hoja (5). No se espera nada de la red.
        setTimeout(() => {
          coordinator.wake();
        }, 0);

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
