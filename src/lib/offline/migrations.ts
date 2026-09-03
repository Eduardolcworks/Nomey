/**
 * EL ESQUEMA LOCAL, VERSIONADO CON `PRAGMA user_version`.
 *
 * ADR-028 §5. Una lista de pasos, cada uno con el número de versión al que
 * lleva, y una función pura que dice cuáles faltan. Que el plan sea puro es lo
 * que permite probarlo sin base de datos y, sobre todo, probar el caso que
 * nunca se prueba: **abrir una base escrita por una versión posterior**.
 *
 * Tres reglas, y ninguna es decoración:
 *
 * - **Los pasos no se editan.** Un paso publicado ya corrió en el aparato de
 *   alguien; cambiarlo deja dos esquemas distintos con el mismo número. Se
 *   añade uno nuevo al final.
 * - **Sólo hacia delante.** No hay `down`: revertir un esquema local con datos
 *   dentro es cómo se pierde dinero declarado, y desinstalar es la salida real.
 * - **Una base más nueva que la app se rechaza en vez de degradarse.** Si
 *   `user_version` es mayor que el último paso conocido, la app anterior podría
 *   leer columnas que ya no significan lo mismo. Falla cerrado.
 */

import type { SqlDatabase } from './sql-database';

/** Los pasos, en orden. El índice 0 lleva a `user_version = 1`. */
export const SCHEMA_STEPS: readonly string[] = [
  `
  create table if not exists queue_entry (
    client_operation_id    text    primary key not null,
    schema_version         integer not null,
    actor_id               text    not null,
    scope_id               text    not null,
    command_type           text    not null,
    payload                text    not null,
    currency_definition_id text    not null,
    currency_code          text    not null,
    currency_scale         integer not null,
    created_at             text    not null,
    state                  text    not null,
    attempts               integer not null default 0,
    next_attempt_at        text,
    last_error_class       text,
    last_error_code        text,
    confirm_seq            integer,
    result_operation_id    text
  );

  -- El indice del worker: por actor, y en orden de creacion. El aislamiento de
  -- ADR-028 §13 no es un filtro que se recuerde poner, es la primera columna.
  create index if not exists queue_entry_actor_created
    on queue_entry (actor_id, created_at, client_operation_id);

  -- El catalogo cacheado de ADR-028 §16. Un documento opaco por actor y clave:
  -- que sean categorias lo sabe la feature, no esta capa. Es informacion de
  -- presentacion y seleccion, NUNCA una cache economica.
  create table if not exists catalogue_cache (
    actor_id   text not null,
    key        text not null,
    document   text not null,
    cached_at  text not null,
    primary key (actor_id, key)
  );
  `,
];

export const LATEST_USER_VERSION = SCHEMA_STEPS.length;

export type MigrationStep = {
  /** El `user_version` al que lleva este paso. */
  readonly version: number;
  readonly sql: string;
};

/** La base está escrita por una versión posterior de la app. */
export class SchemaAheadError extends Error {
  constructor(readonly found: number) {
    super(
      `la base local está en la versión ${found} y esta app conoce hasta ${LATEST_USER_VERSION}`,
    );
    this.name = 'SchemaAheadError';
  }
}

/**
 * Qué pasos faltan para llegar a la última versión.
 *
 * Vacío si ya está al día. Lanza `SchemaAheadError` si la base viene del
 * futuro: degradar en silencio sería leer columnas cuyo significado cambió.
 */
export function pendingSteps(currentVersion: number): MigrationStep[] {
  if (currentVersion > LATEST_USER_VERSION) throw new SchemaAheadError(currentVersion);
  if (currentVersion < 0 || !Number.isInteger(currentVersion)) {
    throw new RangeError(`user_version inválido: ${currentVersion}`);
  }

  return SCHEMA_STEPS.slice(currentVersion).map((sql, index) => ({
    version: currentVersion + index + 1,
    sql,
  }));
}

/**
 * Lleva una base al día, o falla cerrado.
 *
 * **Vive aquí y no junto a `expo-sqlite`** porque no lo necesita: habla con el
 * puerto, así que la migración —lo que de verdad hay que probar— se ejecuta en
 * un test contra un SQLite real sin arrastrar el módulo nativo.
 *
 * `PRAGMA user_version` no admite parámetro enlazado, así que el número se
 * interpola. Es seguro porque sale de `pendingSteps`, que sólo produce enteros
 * derivados de la longitud de `SCHEMA_STEPS`; nada de esto viene de fuera.
 */
export async function migrate(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;

  for (const step of pendingSteps(current)) {
    await db.execAsync(step.sql);
    await db.execAsync(`pragma user_version = ${step.version}`);
  }

  return LATEST_USER_VERSION;
}
