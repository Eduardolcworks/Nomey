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
  /*
   * PASO 2 · el contador durable de la reconciliacion (ADR-028 §9).
   *
   * `confirm_seq` se asigna al confirmar desde un contador monotono de cliente,
   * y `snapshot.seq` es el valor de ese contador al arrancar un refresco. Los
   * dos se comparan, asi que el contador tiene que sobrevivir a la app: uno en
   * memoria que vuelva a cero tras reabrir haria que la primera confirmacion
   * (seq 1) pareciera anterior a cualquier snapshot viejo (seq 7) y se retirara
   * SIN prueba. Y no puede ser el reloj de pared, que retrocede.
   *
   * Por actor, como todo lo demas: la proyeccion y el snapshot son de una
   * cuenta, y asi ninguna sentencia se queda sin su `actor_id`.
   */
  `
  create table if not exists reconcile_cursor (
    actor_id     text    primary key not null,
    confirm_seq  integer not null default 0
  );
  `,
  /*
   * STEP 3 · the dispatch barrier (ADR-028 §9, read side).
   *
   * `confirm_seq` answers "was this entry already confirmed when the query
   * started". It CANNOT answer "could the server already hold this entry", and
   * those are different questions: a request that is in flight — or one whose
   * response was lost — may have written on the server long before the client
   * learns about it, and until then `confirm_seq` has not moved at all.
   *
   * So the send itself gets a durable mark:
   *
   *   queue_entry.dispatch_seq       the counter value when THIS entry's send
   *                                  was declared. NULL means never dispatched,
   *                                  which is the only proof the server cannot
   *                                  hold it.
   *   reconcile_cursor.dispatch_seq  the per-actor monotonic counter it comes
   *                                  from, so a whole send that begins and ends
   *                                  inside a read window is still visible.
   *
   * Written BEFORE the transport and in the same statement as `state =
   * 'sending'`, so a process that dies mid-request leaves the mark behind. It
   * is never cleared: an entry whose request may have reached the server stays
   * uncertain until idempotency settles it — a confirmation, or a terminal
   * rejection that proves no effects (same key, so an earlier write would have
   * come back as `already_processed` instead).
   *
   * `alter table` and not a rebuild: a device already running F7.B/F7.C has
   * real intentions in that table, and they keep their rows, their keys, their
   * payloads, their order and their confirmation counter.
   *
   * **AND THE INHERITED STATE HAS TO KEEP MEANING WHAT IT MEANT.** A NULL column
   * reads as "never dispatched", which is the strongest claim this schema can
   * make, so it may only be left NULL where it is true. Schema 2's contract —
   * read off F7.C's own worker, not assumed — says a row reaches disk in a state
   * other than `queued` ONLY after `sendWithTimeout` has run:
   *
   *   sending          written before the transport. The request MAY have left
   *   retryable        written from a transport outcome. It DID leave
   *   blocked_session  written from a transport outcome (401). It DID leave
   *
   * Migrating any of those with NULL would turn "may already be on the server"
   * into "provably never sent", which is exactly the claim that lets a base
   * carrying its effect be accepted and the entry be projected on top: the
   * movement counted twice. So they are marked, per actor and in FIFO order, and
   * each actor's counter is advanced to match.
   *
   * `queued` keeps NULL. **With one honest gap, stated rather than papered
   * over:** F7.C revives a `blocked_session` row to `queued` before retrying it,
   * so a process that died in that window leaves a `queued` row that HAD been
   * sent, and no column of schema 2 tells it apart — `attempts` only counts
   * transport failures, and a 401 does not bump it. Marking every inherited
   * `queued` row would refuse every new base on any migrating device with a
   * pending entry, which is a real cost for a row that needs a crash inside a
   * two-statement window after a 401. The gap is bounded — a transient double
   * count that the next confirmation resolves — and F7.C never shipped, so no
   * such row exists anywhere.
   */
  `
  alter table queue_entry add column dispatch_seq integer;
  alter table reconcile_cursor add column dispatch_seq integer not null default 0;

  -- The barrier read is per actor and runs on every authoritative refresh.
  create index if not exists queue_entry_actor_dispatch
    on queue_entry (actor_id, dispatch_seq);

  -- An actor with an inherited dispatched row needs a cursor row to advance.
  -- confirm_seq defaults to 0 here and is never touched for an actor that
  -- already had one: reconciliation must not move backwards.
  insert into reconcile_cursor (actor_id, confirm_seq, dispatch_seq)
  select distinct actor_id, 0, 0 from queue_entry
   where state in ('sending', 'retryable', 'blocked_session')
  on conflict (actor_id) do nothing;

  -- One number each, per actor, in the same FIFO order the queue reads by, so
  -- the marks are deterministic and a re-run would produce them again.
  update queue_entry
     set dispatch_seq = (
       select count(*) from queue_entry o
        where o.actor_id = queue_entry.actor_id
          and o.state in ('sending', 'retryable', 'blocked_session')
          and (o.created_at < queue_entry.created_at
               or (o.created_at = queue_entry.created_at
                   and o.client_operation_id <= queue_entry.client_operation_id)))
   where state in ('sending', 'retryable', 'blocked_session');

  -- And the counter lands exactly on the highest number handed out, so the next
  -- real dispatch takes the one after it.
  update reconcile_cursor
     set dispatch_seq = dispatch_seq + (
       select count(*) from queue_entry e
        where e.actor_id = reconcile_cursor.actor_id
          and e.state in ('sending', 'retryable', 'blocked_session'));
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
