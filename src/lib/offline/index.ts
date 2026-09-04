/**
 * La cola de escritura sin conexión — ADR-028.
 *
 * **F7.B entregó la persistencia; F7.C, el worker, la clasificación medida, el
 * backoff, el planificador y el coordinador.** La proyección optimista es de
 * F7.D y las incidencias de F7.E, y **la puerta de escritura de producción
 * sigue siendo la de F6**: nada monta todavía la cola, porque activarla sin la
 * proyección dejaría el movimiento invisible hasta sincronizar.
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
  type QueueBarrier,
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
export {
  backoffDelayMs,
  BACKOFF_BASE_MS,
  BACKOFF_CEILING_MS,
  BACKOFF_MINIMUM_MS,
  isDue,
  nextAttemptAt,
  type Clock,
  type Random,
} from './backoff';
export {
  classifyResponse,
  type Classification,
  type ResponseClass,
  type SessionStatus,
  type TransportOutcome,
} from './response';
export {
  describeFailure,
  type InfrastructureFailure,
  type InfrastructureStage,
  type PassResult,
} from './local-failure';
export {
  createSyncCoordinator,
  type LocalQueueStatus,
  type SyncCoordinator,
} from './sync-coordinator';
export {
  createRetryScheduler,
  IMMEDIATE_FLOOR_MS,
  REAL_SCHEDULER,
  type RescheduleResult,
  type RetryScheduler,
  type Scheduler,
} from './retry-scheduler';
export {
  createSyncWorker,
  DEFAULT_TIMEOUT_MS,
  retryNow,
  type IdleReason,
  type SyncWorker,
  type WorkerRun,
} from './sync-worker';
export type {
  Connectivity,
  ForegroundPort,
  ProgressChange,
  QueueTransport,
  SessionPort,
  WorkerPorts,
} from './worker-ports';
