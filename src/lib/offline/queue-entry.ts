/**
 * LA ENTRADA DE COLA: dos mitades, y sólo una muta.
 *
 * ADR-028 §1. La mitad de **intención** es inmutable desde que se escribe —es
 * el comando que la persona declaró— y la de **progreso** es lo único que el
 * worker toca. Separarlas en el tipo es lo que hace que «modificar el payload»
 * no sea una operación que exista.
 */

import { isQueueCommandType, type FrozenPayload, type QueueCommandType } from './command';

/**
 * La versión de la FORMA de la entrada, distinta de `PRAGMA user_version`.
 *
 * `user_version` versiona el esquema físico —qué tablas y columnas hay—;
 * esto versiona qué se guarda dentro de `payload`. Una app posterior puede
 * cambiar la segunda sin tocar la primera, y quien lee una entrada de una forma
 * que no conoce **no la ejecuta**.
 */
export const QUEUE_SCHEMA_VERSION = 1;

/**
 * Los ocho estados de ADR-028 §6.
 *
 * **`sending` no se lee nunca del disco.** Al abrir la base se repara a
 * `queued`, y la lectura vuelve a mapearlo por si acaso: el cliente no puede
 * distinguir «no llegó» de «llegó y no me enteré», y **no lo intenta**. Es
 * seguro sólo porque el servidor es idempotente.
 *
 * Los tres terminales son **internos**: la interfaz no los nombra ni los
 * distingue entre sí (ADR-028 §15).
 */
export type QueueEntryState =
  | 'queued'
  | 'sending'
  | 'confirmed'
  | 'retryable'
  | 'blocked_session'
  | 'rejected'
  | 'review'
  | 'conflict';

/** Estados cuyo resultado ya no puede cambiar sin que intervenga la persona. */
export const TERMINAL_STATES: readonly QueueEntryState[] = ['rejected', 'review', 'conflict'];

export function isTerminal(state: QueueEntryState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * La definición monetaria del ámbito **en el momento de capturar**.
 *
 * No es redundante con `payload.currency_definition_id`: aquélla es la
 * identidad que viaja a la frontera, y ésta añade el código y la escala, que
 * son lo que permite **pintar** el importe sin red. Y las dos juntas son la
 * prueba documental del conflicto de ADR-003 §7 cuando la moneda base se mueve
 * bajo una operación ya capturada.
 */
export type MoneySnapshot = {
  readonly definitionId: string;
  readonly code: string;
  /** Decimales de la moneda. `EUR` 2, `JPY` 0. Nunca fijado a dos. */
  readonly scale: number;
};

/** Lo que declaró la persona. No se modifica jamás. */
export type QueueIntent = {
  readonly clientOperationId: string;
  readonly schemaVersion: number;
  /** El `sub` del JWT al encolar. Toda lectura y toda mutación filtran por él. */
  readonly actorId: string;
  readonly scopeId: string;
  readonly commandType: QueueCommandType;
  readonly payload: FrozenPayload;
  readonly currency: MoneySnapshot;
  /** ISO 8601 con zona, sólo para ordenar FIFO. No es la fecha efectiva. */
  readonly createdAt: string;
};

/**
 * Lo que el worker mueve.
 *
 * Las cuatro últimas columnas son de F7.C —taxonomía, backoff y reconciliación—
 * y en F7.B **nunca se escriben con otra cosa que su valor inicial**. Existen
 * ya para que F7.C no necesite una migración por algo que ADR-028 §1 ya había
 * enumerado.
 */
export type QueueProgress = {
  readonly state: QueueEntryState;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastErrorClass: string | null;
  readonly lastErrorCode: string | null;
  readonly confirmSeq: number | null;
  readonly resultOperationId: string | null;
};

export type QueueEntry = QueueIntent & QueueProgress;

/**
 * Una entrada nueva, siempre `queued` y siempre con cero intentos.
 *
 * No valida el payload: eso lo hace `payloadDefect`, y quien encola tiene que
 * haberlo pasado antes. Separarlos deja que el store pueda **negarse** a
 * escribir sin que este constructor tenga que lanzar.
 */
export function newQueueEntry(intent: {
  readonly clientOperationId: string;
  readonly actorId: string;
  readonly scopeId: string;
  readonly commandType: QueueCommandType;
  readonly payload: FrozenPayload;
  readonly currency: MoneySnapshot;
  readonly createdAt: string;
}): QueueEntry {
  return {
    ...intent,
    schemaVersion: QUEUE_SCHEMA_VERSION,
    state: 'queued',
    attempts: 0,
    nextAttemptAt: null,
    lastErrorClass: null,
    lastErrorCode: null,
    confirmSeq: null,
    resultOperationId: null,
  };
}

/** La fila tal como vive en SQLite. Snake case, y el payload como texto. */
export type QueueRow = {
  client_operation_id: string;
  schema_version: number;
  actor_id: string;
  scope_id: string;
  command_type: string;
  payload: string;
  currency_definition_id: string;
  currency_code: string;
  currency_scale: number;
  created_at: string;
  state: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error_class: string | null;
  last_error_code: string | null;
  confirm_seq: number | null;
  result_operation_id: string | null;
};

const STATES: readonly string[] = [
  'queued',
  'sending',
  'confirmed',
  'retryable',
  'blocked_session',
  'rejected',
  'review',
  'conflict',
];

/**
 * De fila a entrada, o `null` si la fila no es ejecutable por esta versión.
 *
 * Devuelve `null` —en vez de lanzar— para **tres** casos, y los tres son la
 * misma decisión: una fila que esta versión no entiende no se ejecuta y no
 * tumba la cola entera.
 *
 * 1. `command_type` fuera del vocabulario cerrado (ADR-028 §3);
 * 2. `schema_version` posterior a la que conoce esta app;
 * 3. `payload` que no es JSON, o un `state` que no existe.
 *
 * **`sending` se mapea a `queued` aquí también**, además de repararse al abrir:
 * una fila que quedó a medias por un cierre forzado se lee de la única forma
 * segura, aunque la reparación no haya llegado a correr.
 */
export function rowToEntry(row: QueueRow): QueueEntry | null {
  if (!isQueueCommandType(row.command_type)) return null;
  if (row.schema_version > QUEUE_SCHEMA_VERSION) return null;
  if (!STATES.includes(row.state)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  const stored = row.state as QueueEntryState;

  return {
    clientOperationId: row.client_operation_id,
    schemaVersion: row.schema_version,
    actorId: row.actor_id,
    scopeId: row.scope_id,
    commandType: row.command_type,
    payload: payload as FrozenPayload,
    currency: {
      definitionId: row.currency_definition_id,
      code: row.currency_code,
      scale: row.currency_scale,
    },
    createdAt: row.created_at,
    state: stored === 'sending' ? 'queued' : stored,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorClass: row.last_error_class,
    lastErrorCode: row.last_error_code,
    confirmSeq: row.confirm_seq,
    resultOperationId: row.result_operation_id,
  };
}
