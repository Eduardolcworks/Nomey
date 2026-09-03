/**
 * La cola de escritura sin conexión — ADR-028.
 *
 * **F7.B entrega la persistencia y nada más.** El worker, la conectividad, el
 * backoff, la taxonomía de respuestas, la proyección optimista y las
 * incidencias son de F7.C en adelante, y **la puerta de escritura de producción
 * sigue siendo la de F6**: conectarla antes de que exista quien envíe dejaría
 * movimientos encolados sin ninguna posibilidad de salir.
 */

export {
  isQueueCommandType,
  payloadDefect,
  QUEUE_COMMAND_TYPES,
  type FrozenPayload,
  type PayloadDefect,
  type QueueCommandType,
} from './command';
export type { CachedDocument, CatalogueCache } from './catalogue-cache';
export {
  LATEST_USER_VERSION,
  migrate,
  pendingSteps,
  SCHEMA_STEPS,
  SchemaAheadError,
  type MigrationStep,
} from './migrations';
export {
  isTerminal,
  newQueueEntry,
  QUEUE_SCHEMA_VERSION,
  rowToEntry,
  TERMINAL_STATES,
  type MoneySnapshot,
  type QueueEntry,
  type QueueEntryState,
  type QueueIntent,
  type QueueProgress,
  type QueueRow,
} from './queue-entry';
export {
  QueueWriteRejected,
  type QueueStore,
  type QueueWriteError,
  type UnsupportedEntry,
} from './queue-store';
export type { SqlDatabase, SqlValue } from './sql-database';
export { createSqliteCatalogueCache } from './sqlite-catalogue-cache';
/**
 * **Lo único de este barrel que arrastra `expo-sqlite`.** Mismo reparto que
 * `lib/supabase`: el barrel lo exporta para la app, y quien sólo necesita las
 * piezas puras —los tests, entre otros— importa su módulo directamente.
 */
export {
  offlineCatalogueCache,
  offlineDatabase,
  OFFLINE_DATABASE_NAME,
  openOfflineDatabase,
} from './sqlite-database';
export { createSqliteQueueStore } from './sqlite-queue-store';
