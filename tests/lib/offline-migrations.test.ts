import { describe, expect, it } from 'vitest';

import {
  LATEST_USER_VERSION,
  migrate,
  pendingSteps,
  SCHEMA_STEPS,
  SchemaAheadError,
} from '../../src/lib/offline/migrations';

import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';

import { openTestDatabase } from './offline-sqlite';

/**
 * El esquema local y su `PRAGMA user_version` (ADR-028 §5).
 *
 * La mitad interesante no es que una base vacía se cree bien —eso pasa siempre
 * la primera vez— sino los dos casos que sólo aparecen meses después: reabrir
 * una base ya migrada, y abrir una escrita por una versión POSTERIOR de la app.
 */
describe('el plan de migración es puro y comprobable sin base de datos', () => {
  it('desde cero corre todos los pasos, en orden', () => {
    const steps = pendingSteps(0);

    expect(steps).toHaveLength(SCHEMA_STEPS.length);
    expect(steps.map((step) => step.version)).toEqual(SCHEMA_STEPS.map((_, index) => index + 1));
  });

  it('desde la última versión no corre ninguno', () => {
    expect(pendingSteps(LATEST_USER_VERSION)).toEqual([]);
  });

  it('desde el futuro FALLA CERRADO en vez de degradarse', () => {
    /*
     * Es el caso que importa: alguien instala una versión nueva, la base se
     * migra, y luego vuelve a la anterior. Sin esto, la app vieja leería
     * columnas cuyo significado cambió y no fallaría nada.
     */
    expect(() => pendingSteps(LATEST_USER_VERSION + 1)).toThrow(SchemaAheadError);
  });

  it('rechaza una versión que no es un entero no negativo', () => {
    expect(() => pendingSteps(-1)).toThrow(RangeError);
    expect(() => pendingSteps(1.5)).toThrow();
  });
});

describe('la migración sobre un SQLite real', () => {
  it('crea el esquema y deja user_version en la última', async () => {
    const db = openTestDatabase();

    await expect(migrate(db)).resolves.toBe(LATEST_USER_VERSION);

    const version = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
    expect(version?.user_version).toBe(LATEST_USER_VERSION);

    const tables = await db.getAllAsync<{ name: string }>(
      "select name from sqlite_master where type = 'table' order by name",
    );
    // El cursor de reconciliación es del paso 2 (F7.D, ADR-028 §9).
    expect(tables.map((row) => row.name)).toEqual([
      'catalogue_cache',
      'queue_entry',
      'reconcile_cursor',
    ]);

    // Y el paso 3 deja puestas las dos columnas de la barrera de lectura.
    const entryColumns = await db.getAllAsync<{ name: string }>('pragma table_info(queue_entry)');
    expect(entryColumns.map((row) => row.name)).toContain('dispatch_seq');
    const cursorColumns = await db.getAllAsync<{ name: string }>(
      'pragma table_info(reconcile_cursor)',
    );
    expect(cursorColumns.map((row) => row.name).sort()).toEqual([
      'actor_id',
      'confirm_seq',
      'dispatch_seq',
    ]);
    db.close();
  });

  it('es idempotente: migrar dos veces no cambia nada ni pierde filas', async () => {
    const db = openTestDatabase();
    await migrate(db);

    await db.runAsync(
      `insert into queue_entry (client_operation_id, schema_version, actor_id, scope_id,
        command_type, payload, currency_definition_id, currency_code, currency_scale,
        created_at, state, attempts)
       values ('k', 1, 'a', 's', 'personal_expense.create', '{}', 'c', 'EUR', 2, 't', 'queued', 0)`,
    );

    await expect(migrate(db)).resolves.toBe(LATEST_USER_VERSION);

    const rows = await db.getAllAsync<{ client_operation_id: string }>(
      'select client_operation_id from queue_entry',
    );
    expect(rows).toHaveLength(1);
    db.close();
  });

  it('no toca una base que viene del futuro', async () => {
    const db = openTestDatabase();
    await db.execAsync(`pragma user_version = ${LATEST_USER_VERSION + 3}`);

    await expect(migrate(db)).rejects.toThrow(SchemaAheadError);

    // Y no ha creado nada por el camino: falla ANTES del primer paso.
    const tables = await db.getAllAsync<{ name: string }>(
      "select name from sqlite_master where type = 'table'",
    );
    expect(tables).toHaveLength(0);
    db.close();
  });
});

/**
 * SUBIR DESDE UNA BASE QUE YA ESTÁ EN UN APARATO.
 *
 * Una instalación limpia siempre sale bien; lo que hay que demostrar es lo
 * otro: que un aparato con F7.B (versión 1) o F7.C (versión 2) y con
 * intenciones de verdad dentro llega a la versión 3 **sin perder ni una fila**,
 * sin cambiarles la clave y sin inventarles una marca de envío que nunca
 * tuvieron.
 */
describe('actualizar una base ya desplegada', () => {
  /** Una fila tal como la escribiría la versión indicada. */
  async function seed(db: Awaited<ReturnType<typeof openTestDatabase>>, key: string) {
    await db.runAsync(
      `insert into queue_entry (client_operation_id, schema_version, actor_id, scope_id,
        command_type, payload, currency_definition_id, currency_code, currency_scale,
        created_at, state, attempts)
       values (?, 1, 'actor-a', 'scope-1', 'personal_expense.create',
               '{"amount":"4280","concept":"Cena"}', 'eur-1', 'EUR', 2,
               '2026-09-03T21:40:00.000Z', 'queued', 0)`,
      [key],
    );
  }

  /** Lleva una base sólo hasta `upTo`, como haría la app de aquella versión. */
  async function atVersion(upTo: number) {
    const db = openTestDatabase();
    for (const step of SCHEMA_STEPS.slice(0, upTo)) await db.execAsync(step);
    await db.execAsync(`pragma user_version = ${upTo}`);
    return db;
  }

  it('DESDE F7.B (versión 1): sube a la última y conserva la intención entera', async () => {
    const db = await atVersion(1);
    await seed(db, 'clave-b');

    await expect(migrate(db)).resolves.toBe(LATEST_USER_VERSION);

    const rows = await db.getAllAsync<{
      client_operation_id: string;
      payload: string;
      dispatch_seq: number | null;
    }>('select client_operation_id, payload, dispatch_seq from queue_entry');
    expect(rows).toEqual([
      {
        client_operation_id: 'clave-b',
        payload: '{"amount":"4280","concept":"Cena"}',
        // Nunca se envió, y así se lee: la única prueba positiva de ausencia.
        dispatch_seq: null,
      },
    ]);
    db.close();
  });

  it('DESDE F7.C (versión 2): conserva también el cursor de reconciliación', async () => {
    const db = await atVersion(2);
    await seed(db, 'clave-c');
    await db.runAsync("insert into reconcile_cursor (actor_id, confirm_seq) values ('actor-a', 7)");

    await expect(migrate(db)).resolves.toBe(LATEST_USER_VERSION);

    const cursor = await db.getFirstAsync<{ confirm_seq: number; dispatch_seq: number }>(
      "select confirm_seq, dispatch_seq from reconcile_cursor where actor_id = 'actor-a'",
    );
    // La reconciliación no retrocede, y el contador de envíos empieza en cero.
    expect(cursor).toEqual({ confirm_seq: 7, dispatch_seq: 0 });

    const rows = await db.getAllAsync<{ client_operation_id: string }>(
      'select client_operation_id from queue_entry',
    );
    expect(rows).toEqual([{ client_operation_id: 'clave-c' }]);
    db.close();
  });

  it('y la base actualizada FUNCIONA: la barrera responde sobre las filas viejas', async () => {
    const db = await atVersion(2);
    await seed(db, 'clave-vieja');
    await migrate(db);

    const store = createSqliteQueueStore(db as SqlDatabase);
    // Una fila heredada no está en vuelo ni pudo escribir: barrera limpia.
    expect(await store.barrier('actor-a')).toEqual({
      confirmSeq: 0,
      dispatchSeq: 0,
      uncertain: 0,
    });

    // Y declarar su envío la marca, con su clave intacta.
    const dispatchSeq = await store.nextDispatchSeq('actor-a');
    await store.markDispatched('actor-a', 'clave-vieja', dispatchSeq);
    expect(await store.barrier('actor-a')).toEqual({
      confirmSeq: 0,
      dispatchSeq: 1,
      uncertain: 1,
    });
    expect((await store.byId('actor-a', 'clave-vieja'))?.clientOperationId).toBe('clave-vieja');
    db.close();
  });
});
