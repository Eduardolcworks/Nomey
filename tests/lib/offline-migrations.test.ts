import { describe, expect, it } from 'vitest';

import {
  LATEST_USER_VERSION,
  migrate,
  pendingSteps,
  SCHEMA_STEPS,
  SchemaAheadError,
} from '../../src/lib/offline/migrations';

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
    expect(tables.map((row) => row.name)).toEqual(['catalogue_cache', 'queue_entry']);
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
