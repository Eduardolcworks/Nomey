import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';
import { QueueWriteRejected, type QueueStore } from '../../src/lib/offline/queue-store';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * El adaptador de la cola, sobre SQLite real.
 *
 * Todo lo de aquí corre el **mismo SQL** que corre en el aparato. Es lo que
 * hace que «filtra por actor» sea una afirmación comprobada y no una intención
 * escrita en un comentario.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

let key = 0;
function nextKey(): string {
  key += 1;
  return `00000000-0000-4000-8000-${String(key).padStart(12, '0')}`;
}

function expense(
  actorId: string,
  overrides: { amount?: string; createdAt?: string; clientOperationId?: string } = {},
): QueueEntry {
  const clientOperationId = overrides.clientOperationId ?? nextKey();
  return newQueueEntry({
    clientOperationId,
    actorId,
    scopeId: SCOPE,
    commandType: 'personal_expense.create',
    payload: {
      client_operation_id: clientOperationId,
      command_contract_version: 2,
      scope_id: SCOPE,
      currency_definition_id: CURRENCY,
      amount: overrides.amount ?? '1230',
      effective_date: '2026-09-03',
      effective_time: '21:40',
      concept: 'Cena',
      category_id: CATEGORY,
    },
    currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
    createdAt: overrides.createdAt ?? '2026-09-03T21:40:00.000Z',
  });
}

const open = async (file?: string): Promise<{ db: TestDatabase; store: QueueStore }> => {
  const db = openTestDatabase(file);
  await migrate(db);
  return { db, store: createSqliteQueueStore(db as SqlDatabase) };
};

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nomey-offline-'));
  temporary.push(dir);
  return join(dir, 'queue.db');
}

describe('encolar antes de enviar', () => {
  it('deja la clave y el payload en disco, y sobrevive a cerrar la base', async () => {
    /*
     * ES EL INVARIANTE 1 DE ADR-028, y el que hoy no se cumple: la clave vive en
     * un `useRef` y muere con la hoja. Cerrar y reabrir la base es la versión
     * comprobable de «matar la app entre el envío y la respuesta».
     */
    const file = scratchFile();
    const first = await open(file);
    const entry = expense(ACTOR_A);
    await first.store.enqueue(entry);
    first.db.close();

    const second = await open(file);
    const found = await second.store.byId(ACTOR_A, entry.clientOperationId);

    expect(found?.clientOperationId).toBe(entry.clientOperationId);
    expect(found?.payload).toEqual(entry.payload);
    expect(found?.state).toBe('queued');
    expect(found?.attempts).toBe(0);
    second.db.close();
  });

  it('conserva el importe como texto exacto, sin pasar por un número', async () => {
    const { db, store } = await open();
    // Por encima de 2^53: si algo lo hubiera convertido a `number`, volvería mal.
    const entry = expense(ACTOR_A, { amount: '9007199254740993' });
    await store.enqueue(entry);

    const found = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(found?.payload.amount).toBe('9007199254740993');
    db.close();
  });

  it('guarda la definición monetaria con su escala, y no la fija a dos', async () => {
    const { db, store } = await open();
    const yen = {
      ...expense(ACTOR_A),
      currency: { definitionId: CURRENCY, code: 'JPY', scale: 0 },
    };
    await store.enqueue(yen);

    const found = await store.byId(ACTOR_A, yen.clientOperationId);
    expect(found?.currency).toEqual({ definitionId: CURRENCY, code: 'JPY', scale: 0 });
    db.close();
  });

  it('se niega a escribir un payload inexacto', async () => {
    const { db, store } = await open();
    const broken = { ...expense(ACTOR_A) };
    const entry = { ...broken, payload: { ...broken.payload, amount: '12.30' } };

    await expect(store.enqueue(entry)).rejects.toBeInstanceOf(QueueWriteRejected);
    expect(await store.all(ACTOR_A)).toEqual([]);
    db.close();
  });

  it('se niega a escribir dos veces la misma clave', async () => {
    const { db, store } = await open();
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await expect(store.enqueue(entry)).rejects.toBeInstanceOf(QueueWriteRejected);
    expect(await store.all(ACTOR_A)).toHaveLength(1);
    db.close();
  });
});

describe('el payload congelado no se puede modificar', () => {
  it('mover el progreso no cambia ni un campo de la intención', async () => {
    const { db, store } = await open();
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await store.markProgress(ACTOR_A, entry.clientOperationId, {
      state: 'retryable',
      attempts: 3,
      nextAttemptAt: '2026-09-03T21:45:00.000Z',
      lastErrorClass: 'transport',
    });

    const found = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(found?.payload).toEqual(entry.payload);
    expect(found?.currency).toEqual(entry.currency);
    expect(found?.createdAt).toBe(entry.createdAt);
    expect(found?.commandType).toBe(entry.commandType);
    // Y el progreso sí se movió.
    expect(found?.state).toBe('retryable');
    expect(found?.attempts).toBe(3);
    db.close();
  });

  it('un progreso vacío no escribe nada', async () => {
    const { db, store } = await open();
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await store.markProgress(ACTOR_A, entry.clientOperationId, {});
    expect(await store.byId(ACTOR_A, entry.clientOperationId)).toEqual(entry);
    db.close();
  });
});

describe('la recuperación de `sending`', () => {
  it('una entrada en vuelo al morir el proceso vuelve como `queued`', async () => {
    const file = scratchFile();
    const first = await open(file);
    const entry = expense(ACTOR_A);
    await first.store.enqueue(entry);
    await first.store.markProgress(ACTOR_A, entry.clientOperationId, { state: 'sending' });
    first.db.close();

    const second = await open(file);
    // Se lee bien AUNQUE la reparación no haya corrido todavía.
    expect((await second.store.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('queued');

    expect(await second.store.recoverSending(ACTOR_A)).toBe(1);
    const raw = await second.db.getFirstAsync<{ state: string }>(
      'select state from queue_entry where client_operation_id = ?',
      [entry.clientOperationId],
    );
    // Y después la reparación deja el disco de acuerdo con la lectura.
    expect(raw?.state).toBe('queued');
    expect(await second.store.recoverSending(ACTOR_A)).toBe(0);
    second.db.close();
  });

  it('la clave y el payload sobreviven intactos a la recuperación', async () => {
    const { db, store } = await open();
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);
    await store.markProgress(ACTOR_A, entry.clientOperationId, { state: 'sending' });
    await store.recoverSending(ACTOR_A);

    const found = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(found?.clientOperationId).toBe(entry.clientOperationId);
    expect(found?.payload).toEqual(entry.payload);
    db.close();
  });

  it('no repara las de otra cuenta', async () => {
    const { db, store } = await open();
    const mine = expense(ACTOR_A);
    const theirs = expense(ACTOR_B);
    await store.enqueue(mine);
    await store.enqueue(theirs);
    await store.markProgress(ACTOR_B, theirs.clientOperationId, { state: 'sending' });

    expect(await store.recoverSending(ACTOR_A)).toBe(0);
    const raw = await db.getFirstAsync<{ state: string }>(
      'select state from queue_entry where client_operation_id = ?',
      [theirs.clientOperationId],
    );
    expect(raw?.state).toBe('sending');
    db.close();
  });
});

describe('aislamiento por actor', () => {
  it('las entradas de A no se listan ni se leen bajo B', async () => {
    const { db, store } = await open();
    const mine = expense(ACTOR_A);
    await store.enqueue(mine);
    await store.enqueue(expense(ACTOR_B));

    expect((await store.pending(ACTOR_A)).map((e) => e.clientOperationId)).toEqual([
      mine.clientOperationId,
    ]);
    expect(await store.byId(ACTOR_B, mine.clientOperationId)).toBeNull();
    db.close();
  });

  it('B no puede mover el progreso de una entrada de A', async () => {
    const { db, store } = await open();
    const mine = expense(ACTOR_A);
    await store.enqueue(mine);

    await store.markProgress(ACTOR_B, mine.clientOperationId, { state: 'rejected' });

    expect((await store.byId(ACTOR_A, mine.clientOperationId))?.state).toBe('queued');
    db.close();
  });

  it('LA COMPROBACIÓN DE CLAVE DUPLICADA NO MIRA LAS FILAS DE OTRO', async () => {
    /*
     * Era el hueco real: la consulta previa preguntaba sólo por
     * `client_operation_id`, así que leía la fila de otra cuenta y respondía
     * sobre ella — rechazar por «duplicada» habría revelado que esa clave
     * existe en la cola de otra persona.
     *
     * Con el predicado puesto, B no la ve y su alta cae en la clave primaria:
     * una anomalía se reporta como anomalía, y nada se sobrescribe.
     */
    const { db, store } = await open();
    const mine = expense(ACTOR_A);
    await store.enqueue(mine);

    const collision = expense(ACTOR_B, { clientOperationId: mine.clientOperationId });
    await expect(store.enqueue(collision)).rejects.toThrow();

    const survivor = await store.byId(ACTOR_A, mine.clientOperationId);
    expect(survivor?.actorId).toBe(ACTOR_A);
    expect(survivor?.payload).toEqual(mine.payload);
    db.close();
  });

  it('`replace` rechaza una sustituta de otro actor', async () => {
    /*
     * El `DELETE` lleva su predicado, pero el `INSERT` lleva el actor DENTRO de
     * la fila: sin esta guarda, una sustitución autorizada como A podría
     * insertar una entrada de B.
     */
    const { db, store } = await open();
    const mine = expense(ACTOR_A);
    await store.enqueue(mine);

    const foreign = expense(ACTOR_B);
    await expect(store.replace(ACTOR_A, mine.clientOperationId, foreign)).rejects.toBeInstanceOf(
      QueueWriteRejected,
    );

    expect(await store.byId(ACTOR_A, mine.clientOperationId)).not.toBeNull();
    expect(await store.all(ACTOR_B)).toEqual([]);
    db.close();
  });

  it('B no puede borrar ni sustituir una entrada de A', async () => {
    const { db, store } = await open();
    const mine = expense(ACTOR_A);
    await store.enqueue(mine);

    await store.remove(ACTOR_B, mine.clientOperationId);
    expect(await store.byId(ACTOR_A, mine.clientOperationId)).not.toBeNull();

    // La sustitución inserta la nueva, pero NO borra la ajena: queda constancia
    // de que el borrado está acotado, y la de A sigue siendo de A.
    const replacement = expense(ACTOR_B);
    await store.replace(ACTOR_B, mine.clientOperationId, replacement);
    expect(await store.byId(ACTOR_A, mine.clientOperationId)).not.toBeNull();
    db.close();
  });
});

describe('la sustitución es todo o nada', () => {
  it('crea la nueva y borra la vieja', async () => {
    const { db, store } = await open();
    const rejected = expense(ACTOR_A);
    await store.enqueue(rejected);
    await store.markProgress(ACTOR_A, rejected.clientOperationId, { state: 'rejected' });

    const replacement = expense(ACTOR_A);
    await store.replace(ACTOR_A, rejected.clientOperationId, replacement);

    const all = await store.all(ACTOR_A);
    expect(all.map((entry) => entry.clientOperationId)).toEqual([replacement.clientOperationId]);
    expect(all[0].state).toBe('queued');
    expect(all[0].attempts).toBe(0);
    // El payload congelado viaja igual; lo que cambia es la clave.
    expect(all[0].payload.amount).toBe(rejected.payload.amount);
    expect(all[0].clientOperationId).not.toBe(rejected.clientOperationId);
    db.close();
  });

  it('si la inserción falla, la vieja NO se borra', async () => {
    /*
     * El caso que la transacción existe para impedir: sin ella quedaría el gasto
     * sin ninguna entrada, es decir, dinero declarado que nadie va a enviar.
     */
    const { db, store } = await open();
    const rejected = expense(ACTOR_A);
    await store.enqueue(rejected);

    // Misma clave: el INSERT viola la primary key dentro de la transacción.
    const clash = expense(ACTOR_A, { clientOperationId: rejected.clientOperationId });
    await expect(store.replace(ACTOR_A, rejected.clientOperationId, clash)).rejects.toThrow();

    expect(await store.byId(ACTOR_A, rejected.clientOperationId)).not.toBeNull();
    expect(await store.all(ACTOR_A)).toHaveLength(1);
    db.close();
  });
});

describe('discriminantes y formas desconocidas', () => {
  const insertRaw = (db: TestDatabase, commandType: string, schemaVersion = 1) =>
    db.runAsync(
      `insert into queue_entry (client_operation_id, schema_version, actor_id, scope_id,
        command_type, payload, currency_definition_id, currency_code, currency_scale,
        created_at, state, attempts)
       values (?, ?, ?, ?, ?, '{}', ?, 'EUR', 2, '2026-09-03T00:00:00.000Z', 'queued', 0)`,
      [nextKey(), schemaVersion, ACTOR_A, SCOPE, commandType, CURRENCY],
    );

  it('una clase que esta versión no conoce NO se envía nunca', async () => {
    const { db, store } = await open();
    await insertRaw(db, 'personal_transfer.create');

    expect(await store.pending(ACTOR_A)).toEqual([]);
    expect(await store.all(ACTOR_A)).toEqual([]);
    db.close();
  });

  it('pero se ve, para poder migrarla o revisarla', async () => {
    const { db, store } = await open();
    await insertRaw(db, 'personal_transfer.create');

    const blocked = await store.unsupported(ACTOR_A);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].commandType).toBe('personal_transfer.create');
    db.close();
  });

  it('una entrada de una forma posterior tampoco se ejecuta', async () => {
    const { db, store } = await open();
    await insertRaw(db, 'personal_expense.create', 99);

    expect(await store.pending(ACTOR_A)).toEqual([]);
    expect((await store.unsupported(ACTOR_A))[0].schemaVersion).toBe(99);
    db.close();
  });

  it('una entrada rota no impide leer las buenas', async () => {
    const { db, store } = await open();
    await insertRaw(db, 'personal_transfer.create');
    const good = expense(ACTOR_A, { createdAt: '2026-09-04T00:00:00.000Z' });
    await store.enqueue(good);

    expect((await store.pending(ACTOR_A)).map((e) => e.clientOperationId)).toEqual([
      good.clientOperationId,
    ]);
    db.close();
  });
});

describe('orden y estados terminales', () => {
  it('`pending` va en FIFO por fecha de creación', async () => {
    const { db, store } = await open();
    const third = expense(ACTOR_A, { createdAt: '2026-09-03T23:00:00.000Z' });
    const first = expense(ACTOR_A, { createdAt: '2026-09-03T21:00:00.000Z' });
    const second = expense(ACTOR_A, { createdAt: '2026-09-03T22:00:00.000Z' });
    await store.enqueue(third);
    await store.enqueue(first);
    await store.enqueue(second);

    expect((await store.pending(ACTOR_A)).map((e) => e.createdAt)).toEqual([
      first.createdAt,
      second.createdAt,
      third.createdAt,
    ]);
    db.close();
  });

  it('las terminales salen de `pending` pero siguen en `all`', async () => {
    const { db, store } = await open();
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    for (const state of ['rejected', 'review', 'conflict'] as const) {
      await store.markProgress(ACTOR_A, entry.clientOperationId, { state });
      expect(await store.pending(ACTOR_A)).toEqual([]);
      expect(await store.all(ACTOR_A)).toHaveLength(1);
    }
    db.close();
  });

  it('resolver una terminal la elimina: no es historial', async () => {
    const { db, store } = await open();
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);
    await store.markProgress(ACTOR_A, entry.clientOperationId, { state: 'rejected' });

    await store.remove(ACTOR_A, entry.clientOperationId);
    expect(await store.all(ACTOR_A)).toEqual([]);
    db.close();
  });
});

describe('lo que la cola no guarda', () => {
  it('el esquema no tiene ninguna columna de token, secreto ni agregado', async () => {
    const { db } = await open();
    const columns = await db.getAllAsync<{ name: string }>('pragma table_info(queue_entry)');
    const names = columns.map((column) => column.name).join(' ');

    for (const forbidden of ['token', 'secret', 'jwt', 'password', 'balance', 'total']) {
      expect(names).not.toContain(forbidden);
    }
    db.close();
  });
});
