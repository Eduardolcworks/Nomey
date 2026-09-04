/**
 * El adaptador SQLite de la cola.
 *
 * Habla con `SqlDatabase`, no con `expo-sqlite`, así que **este SQL se prueba
 * de verdad** contra un SQLite real en Vitest en vez de contra una maqueta.
 *
 * Dos cosas que conviene ver en el SQL y no deducir del nombre de la función:
 *
 * - **`actor_id = ?` está en TODAS las cláusulas**, incluidas las de escritura
 *   y la de reparación. No hay ningún camino que lea o mueva la entrada de otra
 *   cuenta (ADR-028 §13).
 * - **Ningún `UPDATE` toca la mitad de intención.** `markProgress` enumera sus
 *   columnas una a una; no hay un `set` genérico al que se le pueda colar
 *   `payload`.
 */

import { payloadDefect } from './command';
import {
  isTerminal,
  type QueueEntry,
  type QueueProgress,
  type QueueRow,
  rowToEntry,
} from './queue-entry';
import { QueueWriteRejected, type QueueStore, type UnsupportedEntry } from './queue-store';
import type { SqlDatabase, SqlValue } from './sql-database';

const COLUMNS = `client_operation_id, schema_version, actor_id, scope_id, command_type, payload,
  currency_definition_id, currency_code, currency_scale, created_at, state, attempts,
  next_attempt_at, last_error_class, last_error_code, confirm_seq, result_operation_id,
  dispatch_seq`;

/** FIFO estable: la fecha de creación, y la clave para desempatar. */
const ORDER = 'order by created_at asc, client_operation_id asc';

function bind(entry: QueueEntry): SqlValue[] {
  return [
    entry.clientOperationId,
    entry.schemaVersion,
    entry.actorId,
    entry.scopeId,
    entry.commandType,
    JSON.stringify(entry.payload),
    entry.currency.definitionId,
    entry.currency.code,
    entry.currency.scale,
    entry.createdAt,
    entry.state,
    entry.attempts,
    entry.nextAttemptAt,
    entry.lastErrorClass,
    entry.lastErrorCode,
    entry.confirmSeq,
    entry.resultOperationId,
    entry.dispatchSeq,
  ];
}

const INSERT = `insert into queue_entry (${COLUMNS})
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The states a projection still paints (ADR-028 §6). A terminal entry is NOT
 * here on purpose: its projection is withdrawn, so it cannot be counted twice
 * and it is not a read hazard however uncertain its result may be.
 */
const PROJECTED = `('queued', 'sending', 'retryable', 'blocked_session')`;

/**
 * Lo que se comprueba **antes** de escribir, y por qué aquí.
 *
 * Un payload inexacto guardado es un fallo que aparece horas después, sin red
 * de por medio y sin nadie mirando. Rechazarlo en el `enqueue` lo convierte en
 * un fallo inmediato, en la pantalla donde todavía se puede corregir.
 */
function assertStorable(entry: QueueEntry): void {
  if (payloadDefect(entry.commandType, entry.payload) !== null) {
    throw new QueueWriteRejected('payloadRejected');
  }
}

export function createSqliteQueueStore(db: SqlDatabase): QueueStore {
  async function rows(sql: string, params: readonly SqlValue[]): Promise<QueueEntry[]> {
    const found = await db.getAllAsync<QueueRow>(sql, params);
    return found.map(rowToEntry).filter((entry): entry is QueueEntry => entry !== null);
  }

  async function insert(entry: QueueEntry): Promise<void> {
    assertStorable(entry);
    /*
     * La comprobación previa lleva el actor, igual que todo lo demás.
     *
     * **Sin él sería una lectura de la fila de otra cuenta**, y además una que
     * responde: rechazar por «clave duplicada» revelaría que esa clave existe
     * en la cola de otra persona. Con el predicado, esta consulta sólo ve lo
     * que el actor ya tiene.
     *
     * Una colisión ENTRE actores —imposible en la práctica con un UUIDv4, y aun
     * así contemplada— cae en la clave primaria del `INSERT` y sale como error
     * de restricción. Es lo correcto: no es un reintento, es una anomalía, y
     * fallar fuerte es preferible a inventarle un significado.
     */
    const existing = await db.getFirstAsync<{ one: number }>(
      'select 1 as one from queue_entry where actor_id = ? and client_operation_id = ?',
      [entry.actorId, entry.clientOperationId],
    );
    if (existing !== null) throw new QueueWriteRejected('duplicateKey');
    await db.runAsync(INSERT, bind(entry));
  }

  return {
    enqueue: insert,

    async pending(actorId) {
      const found = await rows(`select ${COLUMNS} from queue_entry where actor_id = ? ${ORDER}`, [
        actorId,
      ]);
      return found.filter((entry) => !isTerminal(entry.state));
    },

    all(actorId) {
      return rows(`select ${COLUMNS} from queue_entry where actor_id = ? ${ORDER}`, [actorId]);
    },

    async byId(actorId, clientOperationId) {
      const row = await db.getFirstAsync<QueueRow>(
        `select ${COLUMNS} from queue_entry where actor_id = ? and client_operation_id = ?`,
        [actorId, clientOperationId],
      );
      return row === null ? null : rowToEntry(row);
    },

    async markProgress(actorId, clientOperationId, progress) {
      /*
       * Columna a columna, y sólo las siete de progreso. `coalesce(?, columna)`
       * no valdría: `null` es un valor legítimo de cinco de ellas —limpiar el
       * último error es escribir `null`— así que lo que decide es si la clave
       * viene en el objeto, no si su valor es nulo.
       */
      const sets: string[] = [];
      const params: SqlValue[] = [];
      const put = (column: string, value: SqlValue) => {
        sets.push(`${column} = ?`);
        params.push(value);
      };

      const has = (key: keyof QueueProgress) => Object.hasOwn(progress, key);

      if (has('state')) put('state', progress.state as string);
      if (has('attempts')) put('attempts', progress.attempts as number);
      if (has('nextAttemptAt')) put('next_attempt_at', progress.nextAttemptAt ?? null);
      if (has('lastErrorClass')) put('last_error_class', progress.lastErrorClass ?? null);
      if (has('lastErrorCode')) put('last_error_code', progress.lastErrorCode ?? null);
      if (has('confirmSeq')) put('confirm_seq', progress.confirmSeq ?? null);
      if (has('resultOperationId')) put('result_operation_id', progress.resultOperationId ?? null);

      if (sets.length === 0) return;
      params.push(actorId, clientOperationId);

      await db.runAsync(
        `update queue_entry set ${sets.join(', ')} where actor_id = ? and client_operation_id = ?`,
        params,
      );
    },

    async replace(actorId, rejectedId, replacement) {
      /*
       * La sustituta tiene que ser DEL MISMO ACTOR.
       *
       * Sin esta guarda, `replace(A, …, entradaDeB)` insertaría una entrada de
       * B en una operación autorizada como A: el `DELETE` lleva su predicado,
       * pero el `INSERT` lleva el actor **dentro de la fila**, así que el
       * predicado no lo cubre. Es el único sitio donde el actor de la operación
       * y el del dato podían separarse.
       */
      if (replacement.actorId !== actorId) throw new QueueWriteRejected('actorMismatch');
      assertStorable(replacement);
      await db.withTransactionAsync(async () => {
        await db.runAsync(INSERT, bind(replacement));
        await db.runAsync(
          'delete from queue_entry where actor_id = ? and client_operation_id = ?',
          [actorId, rejectedId],
        );
      });
    },

    async remove(actorId, clientOperationId) {
      await db.runAsync('delete from queue_entry where actor_id = ? and client_operation_id = ?', [
        actorId,
        clientOperationId,
      ]);
    },

    async recoverSending(actorId) {
      /*
       * ONLY the state. The dispatch mark is deliberately left alone: repairing
       * a row that was caught mid-request is not evidence that the request never
       * left, and clearing it here would turn every crash into a licence to
       * accept a base that may already carry the effect.
       */
      const stuck = await db.getAllAsync<{ client_operation_id: string }>(
        `select client_operation_id from queue_entry where actor_id = ? and state = 'sending'`,
        [actorId],
      );
      if (stuck.length === 0) return 0;

      await db.runAsync(
        `update queue_entry set state = 'queued' where actor_id = ? and state = 'sending'`,
        [actorId],
      );
      return stuck.length;
    },

    async markDispatched(actorId, clientOperationId, dispatchSeq) {
      /*
       * ONE statement. The state and the mark cannot come apart, and the mark
       * outlives the process: whatever happens after this line — the request
       * leaves, the app dies, the response is lost — the row already says that
       * this entry may exist on the server.
       */
      await db.runAsync(
        `update queue_entry set state = 'sending', dispatch_seq = ?
          where actor_id = ? and client_operation_id = ?`,
        [dispatchSeq, actorId, clientOperationId],
      );
    },

    async nextDispatchSeq(actorId) {
      const row = await db.getFirstAsync<{ dispatch_seq: number }>(
        `insert into reconcile_cursor (actor_id, dispatch_seq) values (?, 1)
         on conflict (actor_id) do update set dispatch_seq = reconcile_cursor.dispatch_seq + 1
         returning dispatch_seq`,
        [actorId],
      );
      if (row === null) throw new Error('the dispatch cursor returned no value');
      return row.dispatch_seq;
    },

    async barrier(actorId) {
      /*
       * One read, so the three numbers describe the same instant. Reading them
       * apart would leave a gap in which a send could start between the counter
       * and the count, which is the very thing this measures.
       */
      const row = await db.getFirstAsync<{
        confirm_seq: number;
        dispatch_seq: number;
        uncertain: number;
      }>(
        `select coalesce(c.confirm_seq, 0)  as confirm_seq,
                coalesce(c.dispatch_seq, 0) as dispatch_seq,
                (select count(*) from queue_entry e
                  where e.actor_id = ?
                    and e.dispatch_seq is not null
                    and e.confirm_seq is null
                    and e.state in ${PROJECTED}) as uncertain
           from (select 1) one
           left join reconcile_cursor c on c.actor_id = ?`,
        [actorId, actorId],
      );
      if (row === null) throw new Error('the barrier returned no value');
      return {
        confirmSeq: row.confirm_seq,
        dispatchSeq: row.dispatch_seq,
        uncertain: row.uncertain,
      };
    },

    async nextConfirmSeq(actorId) {
      /*
       * Una sola sentencia: crea el cursor del actor en 1 o lo avanza en uno, y
       * devuelve el valor. Atomica por construccion, asi que dos confirmaciones
       * nunca reciben el mismo numero.
       */
      const row = await db.getFirstAsync<{ confirm_seq: number }>(
        `insert into reconcile_cursor (actor_id, confirm_seq) values (?, 1)
         on conflict (actor_id) do update set confirm_seq = reconcile_cursor.confirm_seq + 1
         returning confirm_seq`,
        [actorId],
      );
      if (row === null) throw new Error('el cursor de reconciliación no devolvió valor');
      return row.confirm_seq;
    },

    async confirmSequence(actorId) {
      const row = await db.getFirstAsync<{ confirm_seq: number }>(
        'select confirm_seq from reconcile_cursor where actor_id = ?',
        [actorId],
      );
      return row?.confirm_seq ?? 0;
    },

    async unsupported(actorId): Promise<UnsupportedEntry[]> {
      const found = await db.getAllAsync<QueueRow>(
        `select ${COLUMNS} from queue_entry where actor_id = ? ${ORDER}`,
        [actorId],
      );
      return found
        .filter((row) => rowToEntry(row) === null)
        .map((row) => ({
          clientOperationId: row.client_operation_id,
          commandType: row.command_type,
          schemaVersion: row.schema_version,
        }));
    },
  };
}
