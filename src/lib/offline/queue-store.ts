/**
 * EL PUERTO DE LA COLA.
 *
 * **El aislamiento por actor está en los PREDICADOS DEL SQL, no en el índice.**
 * Un índice sólo acelera una consulta: no impide leer ni modificar la fila de
 * otra cuenta, y describirlo como si lo impidiera sería describir una garantía
 * que no existe. Lo que la sostiene son dos cosas, y hacen falta las dos:
 *
 * 1. **Cada `SELECT`, `UPDATE` y `DELETE` lleva `actor_id = ?`**, sin
 *    excepción, incluida la comprobación de clave duplicada y la reparación de
 *    `sending`. Una guarda de `tests/infra/` lee el fuente del adaptador y
 *    falla si alguna sentencia futura pierde el predicado.
 * 2. **Ningún método deja pasar la mutación sin el actor.** Todos lo reciben
 *    como primer parámetro, salvo `enqueue`, donde viaja dentro de la propia
 *    entrada — y `replace`, que recibe los dos, comprueba que coincidan.
 *
 * ADR-028 §13 exige que las entradas de una cuenta no sean visibles ni
 * enviables bajo otra. Un puerto con un «dame todo» dejaría esa garantía a que
 * cada llamante se acuerde; aquí no hay forma de escribir la llamada insegura.
 *
 * Lo que este puerto **no** tiene, a propósito: ninguna operación que modifique
 * la mitad de intención de una entrada. El payload congelado no se edita
 * (ADR-028 §1); lo que existe es crear otra entrada.
 */

import type { QueueEntry, QueueProgress } from './queue-entry';

/** Una fila que esta versión de la app no sabe ejecutar. Se ve, no se envía. */
export type UnsupportedEntry = {
  readonly clientOperationId: string;
  readonly commandType: string;
  readonly schemaVersion: number;
};

/** Por qué el store se negó a escribir. */
export type QueueWriteError = 'duplicateKey' | 'payloadRejected' | 'actorMismatch';

export class QueueWriteRejected extends Error {
  constructor(readonly reason: QueueWriteError) {
    super(`la cola rechazó la escritura: ${reason}`);
    this.name = 'QueueWriteRejected';
  }
}

export type QueueStore = {
  /**
   * Escribe la entrada. **Una sola sentencia, y antes de cualquier petición.**
   *
   * Es la operación que cumple ADR-010 §1: cuando esto vuelve, el
   * `client_operation_id` y el payload están en disco, así que un cierre
   * forzado a partir de aquí no puede producir una intención nueva.
   */
  enqueue(entry: QueueEntry): Promise<void>;

  /** Las enviables de ese actor, en orden FIFO. Nunca las terminales. */
  pending(actorId: string): Promise<QueueEntry[]>;

  /** Todas las de ese actor, incluidas las terminales, en orden FIFO. */
  all(actorId: string): Promise<QueueEntry[]>;

  byId(actorId: string, clientOperationId: string): Promise<QueueEntry | null>;

  /** Mueve **sólo** la mitad de progreso. La intención no se toca. */
  markProgress(
    actorId: string,
    clientOperationId: string,
    progress: Partial<QueueProgress>,
  ): Promise<void>;

  /**
   * Sustituye una entrada por otra, **todo o nada**.
   *
   * Es la única operación de varias filas de toda la cola (ADR-028 §5), y la
   * usa el `Reintentar` de §15: crear la intención nueva y borrar la rechazada
   * tienen que ocurrir juntas, o quedarían dos entradas del mismo gasto o
   * ninguna.
   *
   * **La política de cuándo se llama no vive aquí.** Esto es persistencia; qué
   * respuesta del servidor da derecho a sustituir es de F7.C.
   */
  replace(actorId: string, rejectedId: string, replacement: QueueEntry): Promise<void>;

  remove(actorId: string, clientOperationId: string): Promise<void>;

  /**
   * Repara las que quedaron en vuelo, y devuelve cuántas.
   *
   * Un `sending` en disco significa que el proceso murió entre el envío y la
   * respuesta. Vuelve a `queued` **con su misma clave**, y el servidor
   * resolverá si aquello se escribió o no. Acotado al actor por la misma razón
   * que todo lo demás.
   */
  recoverSending(actorId: string): Promise<number>;

  /** Las filas que esta versión no sabe ejecutar. Visibles, nunca enviables. */
  unsupported(actorId: string): Promise<UnsupportedEntry[]>;
};
