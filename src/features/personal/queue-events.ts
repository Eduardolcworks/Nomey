/**
 * LOS CAMBIOS DE LA COLA, ANUNCIADOS.
 *
 * La proyección de Inicio vive en React y la cola no: el worker escribe en
 * SQLite desde fuera de cualquier componente. Esto es el hilo que los une —
 * quien cambia una entrada lo dice aquí, y quien proyecta vuelve a leer la
 * cola—. **No transporta datos**: sólo de quién, cuál y a qué estado, para que
 * el oyente sepa si le toca releer o pedir un refresco autoritativo. El
 * contenido sigue viviendo únicamente en la entrada durable (ADR-028 §8).
 *
 * Un oyente que lanza no rompe al que anuncia: el anuncio sale del worker en
 * plena anotación, y una excepción ahí se contaría como fallo de la base.
 */

import type { QueueEntryState } from '@/lib/offline/queue-entry';

export type QueueChange = {
  readonly kind: 'enqueued' | 'progress' | 'pruned';
  readonly actorId: string;
  readonly clientOperationId: string;
  readonly state: QueueEntryState;
};

type Listener = (change: QueueChange) => void;

const listeners = new Set<Listener>();

export function subscribeQueueChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishQueueChange(change: QueueChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // Un oyente roto no puede convertir una anotación correcta en un fallo.
    }
  }
}

/** Para poder afirmar en una prueba que no queda nadie escuchando. */
export function queueListenerCount(): number {
  return listeners.size;
}
