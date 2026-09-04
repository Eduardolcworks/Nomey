import { describe, expect, it } from 'vitest';

import { migrate, SCHEMA_STEPS } from '../../src/lib/offline/migrations';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { TransportOutcome } from '../../src/lib/offline/response';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';
import { createSyncWorker } from '../../src/lib/offline/sync-worker';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * WHAT AN INHERITED ROW MEANT, AND WHAT IT HAS TO KEEP MEANING.
 *
 * Schema 2 could hold a durable `sending` row: F7.C's worker wrote that state
 * BEFORE the transport, so the row means "the request may already have reached
 * the server". Migrating it with `dispatch_seq = null` would restate it as
 * "provably never sent", which is precisely the claim that allows a base
 * carrying its effect to be accepted while the entry is still projected — the
 * movement counted twice.
 *
 * The same reading covers `retryable` and `blocked_session`: both are written
 * from a transport OUTCOME, so both imply the request left. `queued` is the
 * only projected state schema 2 could reach without sending, and it keeps NULL.
 *
 * Everything here runs against a database built by the real schema-2 steps and
 * migrated by the real `migrate`.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

/** A database exactly as schema 2 left it: the first two steps, and nothing else. */
async function legacyDatabase(): Promise<TestDatabase> {
  const db = openTestDatabase();
  for (const step of SCHEMA_STEPS.slice(0, 2)) await db.execAsync(step);
  await db.execAsync('pragma user_version = 2');
  return db;
}

/** A row written the way F7.C wrote it — no `dispatch_seq` column existed. */
async function legacyRow(
  db: TestDatabase,
  over: {
    key: string;
    actorId?: string;
    state?: string;
    createdAt?: string;
    attempts?: number;
    confirmSeq?: number | null;
  },
) {
  const payload = JSON.stringify({
    client_operation_id: over.key,
    command_contract_version: 2,
    scope_id: SCOPE,
    currency_definition_id: CURRENCY,
    amount: '1230',
    effective_date: '2026-09-03',
    effective_time: '21:40',
    concept: 'Cena',
    category_id: CATEGORY,
  });

  await db.runAsync(
    `insert into queue_entry (client_operation_id, schema_version, actor_id, scope_id,
       command_type, payload, currency_definition_id, currency_code, currency_scale,
       created_at, state, attempts, confirm_seq)
     values (?, 1, ?, ?, 'personal_expense.create', ?, ?, 'EUR', 2, ?, ?, ?, ?)`,
    [
      over.key,
      over.actorId ?? A,
      SCOPE,
      payload,
      CURRENCY,
      over.createdAt ?? '2026-09-03T21:40:00.000Z',
      over.state ?? 'queued',
      over.attempts ?? 0,
      over.confirmSeq ?? null,
    ],
  );
  return { key: over.key, payload };
}

function storeOf(db: TestDatabase): QueueStore {
  return createSqliteQueueStore(db as SqlDatabase);
}

/** A worker whose transport answers whatever the test says, one request at a time. */
function workerOn(store: QueueStore, actorId: string, outcome: () => TransportOutcome) {
  const sent: string[] = [];
  return {
    sent,
    worker: createSyncWorker({
      store,
      transport: {
        async send(_type, payload) {
          sent.push(String(payload.client_operation_id));
          return outcome();
        },
      },
      clock: { now: () => Date.parse('2026-09-04T10:00:00.000Z') },
      random: () => 0,
      connectivity: { isConnected: () => true, subscribe: () => () => undefined },
      session: {
        status: () => 'signed-in',
        actorId: () => actorId,
        subscribe: () => () => undefined,
      },
      timeoutMs: 50_000,
    }),
  };
}

describe('una fila heredada en `sending`', () => {
  it('QUEDA MARCADA COMO INCIERTA, y una `queued` heredada no', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'nunca-salio', state: 'queued', createdAt: '…T21:40:01.000Z' });
    await legacyRow(db, { key: 'pudo-salir', state: 'sending', createdAt: '…T21:40:02.000Z' });

    await migrate(db);
    const store = storeOf(db);

    expect((await store.byId(A, 'nunca-salio'))?.dispatchSeq).toBeNull();
    expect((await store.byId(A, 'pudo-salir'))?.dispatchSeq).toBe(1);
    // Y la barrera lo ve: una sola incierta, y el contador la acompaña.
    expect(await store.barrier(A)).toEqual({ confirmSeq: 0, dispatchSeq: 1, uncertain: 1 });
    db.close();
  });

  it('`retryable` y `blocked_session` también salieron, y también se marcan', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'q', state: 'queued', createdAt: '…T21:40:01.000Z' });
    await legacyRow(db, {
      key: 'r',
      state: 'retryable',
      createdAt: '…T21:40:02.000Z',
      attempts: 2,
    });
    await legacyRow(db, { key: 'b', state: 'blocked_session', createdAt: '…T21:40:03.000Z' });
    await legacyRow(db, { key: 's', state: 'sending', createdAt: '…T21:40:04.000Z' });

    await migrate(db);
    const store = storeOf(db);

    expect((await store.byId(A, 'q'))?.dispatchSeq).toBeNull();
    // FIFO, y determinista: el orden de la cola es el orden de los números.
    expect((await store.byId(A, 'r'))?.dispatchSeq).toBe(1);
    expect((await store.byId(A, 'b'))?.dispatchSeq).toBe(2);
    expect((await store.byId(A, 's'))?.dispatchSeq).toBe(3);
    expect(await store.barrier(A)).toEqual({ confirmSeq: 0, dispatchSeq: 3, uncertain: 3 });
    db.close();
  });

  it('un terminal heredado no se marca: su proyección ya está retirada', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'rechazada', state: 'rejected' });
    await legacyRow(db, { key: 'revisar', state: 'review' });
    await legacyRow(db, { key: 'moneda', state: 'conflict' });

    await migrate(db);
    const store = storeOf(db);

    for (const key of ['rechazada', 'revisar', 'moneda']) {
      expect((await store.byId(A, key))?.dispatchSeq).toBeNull();
    }
    expect(await store.barrier(A)).toEqual({ confirmSeq: 0, dispatchSeq: 0, uncertain: 0 });
    db.close();
  });

  it('EL CONTADOR AVANZA DE FORMA COHERENTE: el siguiente envío real toma el siguiente número', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 's1', state: 'sending', createdAt: '…T21:40:01.000Z' });
    await legacyRow(db, { key: 's2', state: 'sending', createdAt: '…T21:40:02.000Z' });

    await migrate(db);
    const store = storeOf(db);

    expect((await store.barrier(A)).dispatchSeq).toBe(2);
    expect(await store.nextDispatchSeq(A)).toBe(3);
    db.close();
  });

  it('NO CAMBIA claves, payloads, orden, intentos ni el contador de confirmación', async () => {
    const db = await legacyDatabase();
    const one = await legacyRow(db, {
      key: 'k1',
      state: 'sending',
      createdAt: '…T21:40:01.000Z',
      attempts: 3,
    });
    const two = await legacyRow(db, {
      key: 'k2',
      state: 'queued',
      createdAt: '…T21:40:02.000Z',
      attempts: 0,
    });
    // Un actor que ya venía reconciliando.
    await db.runAsync('insert into reconcile_cursor (actor_id, confirm_seq) values (?, 9)', [A]);

    await migrate(db);
    const store = storeOf(db);

    const rows = await store.all(A);
    expect(rows.map((row) => row.clientOperationId)).toEqual([one.key, two.key]);
    expect(JSON.stringify(rows[0].payload)).toBe(one.payload);
    expect(JSON.stringify(rows[1].payload)).toBe(two.payload);
    expect(rows[0].attempts).toBe(3);
    expect(rows[1].attempts).toBe(0);
    // La reconciliación no retrocede ni se toca.
    expect((await store.barrier(A)).confirmSeq).toBe(9);
    db.close();
  });

  it('`recoverSending` cambia el estado y NO borra la incertidumbre', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'pudo-salir', state: 'sending' });

    await migrate(db);
    const store = storeOf(db);
    expect(await store.recoverSending(A)).toBe(1);

    const row = await store.byId(A, 'pudo-salir');
    expect(row?.state).toBe('queued');
    expect(row?.dispatchSeq).toBe(1);
    expect(await store.barrier(A)).toEqual({ confirmSeq: 0, dispatchSeq: 1, uncertain: 1 });
    db.close();
  });
});

describe('los tres caminos de una base heredada, hasta el final', () => {
  it('SERVIDOR QUE NO ESCRIBIÓ: se reenvía con la misma clave y confirma', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'no-escribio', state: 'sending' });
    await migrate(db);
    const store = storeOf(db);
    await store.recoverSending(A);

    // Incierta antes de reenviar: ninguna base sería aceptable.
    expect((await store.barrier(A)).uncertain).toBe(1);

    const { worker, sent } = workerOn(store, A, () => ({
      kind: 'ok',
      operationId: 'op-nuevo',
      alreadyProcessed: false,
    }));
    await worker.runOnce();

    expect(sent).toEqual(['no-escribio']);
    const row = await store.byId(A, 'no-escribio');
    expect(row).toMatchObject({ state: 'confirmed', resultOperationId: 'op-nuevo', confirmSeq: 1 });
    // Resuelta: la barrera vuelve a dejar pasar una base.
    expect(await store.barrier(A)).toEqual({ confirmSeq: 1, dispatchSeq: 2, uncertain: 0 });
    db.close();
  });

  it('SERVIDOR QUE SÍ ESCRIBIÓ: `already_processed` y UNA sola operación remota', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'si-escribio', state: 'sending' });
    await migrate(db);
    const store = storeOf(db);

    // El servidor, con memoria por clave: lo que hace la idempotencia real.
    const escritas = new Map<string, string>([['si-escribio', 'op-de-antes']]);

    await store.recoverSending(A);
    const { worker, sent } = workerOn(store, A, () => {
      const key = sent[sent.length - 1];
      const known = escritas.get(key);
      if (known !== undefined) return { kind: 'ok', operationId: known, alreadyProcessed: true };
      const minted = `op-${String(escritas.size + 1)}`;
      escritas.set(key, minted);
      return { kind: 'ok', operationId: minted, alreadyProcessed: false };
    });
    await worker.runOnce();

    // Misma clave, así que el servidor NO escribió una segunda vez.
    expect(sent).toEqual(['si-escribio']);
    expect(escritas.size).toBe(1);
    expect(await store.byId(A, 'si-escribio')).toMatchObject({
      state: 'confirmed',
      resultOperationId: 'op-de-antes',
      confirmSeq: 1,
    });
    expect((await store.barrier(A)).uncertain).toBe(0);
    db.close();
  });

  it('AISLAMIENTO: dos actores con `sending` heredadas no se mezclan', async () => {
    const db = await legacyDatabase();
    await legacyRow(db, { key: 'a1', actorId: A, state: 'sending', createdAt: '…T21:40:01.000Z' });
    await legacyRow(db, { key: 'a2', actorId: A, state: 'sending', createdAt: '…T21:40:02.000Z' });
    await legacyRow(db, { key: 'b1', actorId: B, state: 'sending', createdAt: '…T21:40:03.000Z' });
    await legacyRow(db, { key: 'b2', actorId: B, state: 'queued', createdAt: '…T21:40:04.000Z' });

    await migrate(db);
    const store = storeOf(db);

    // Cada cuenta numera desde 1: el contador es suyo, no del aparato.
    expect((await store.byId(A, 'a1'))?.dispatchSeq).toBe(1);
    expect((await store.byId(A, 'a2'))?.dispatchSeq).toBe(2);
    expect((await store.byId(B, 'b1'))?.dispatchSeq).toBe(1);
    expect((await store.byId(B, 'b2'))?.dispatchSeq).toBeNull();

    expect(await store.barrier(A)).toEqual({ confirmSeq: 0, dispatchSeq: 2, uncertain: 2 });
    expect(await store.barrier(B)).toEqual({ confirmSeq: 0, dispatchSeq: 1, uncertain: 1 });

    // Y reparar y resolver a A no toca a B.
    await store.recoverSending(A);
    const { worker } = workerOn(store, A, () => ({
      kind: 'ok',
      operationId: 'op-a',
      alreadyProcessed: true,
    }));
    await worker.drain();

    expect((await store.barrier(A)).uncertain).toBe(0);
    expect(await store.barrier(B)).toEqual({ confirmSeq: 0, dispatchSeq: 1, uncertain: 1 });
    /*
     * En disco la fila de B sigue literalmente `sending` — nadie la reparó, y
     * `recoverSending` lleva su predicado de actor. Se lee la columna cruda a
     * propósito: `byId` la devolvería como `queued`, que es la relectura de
     * ADR-028 §6 y no dice nada de lo que hay escrito.
     */
    const crudas = await db.getAllAsync<{ client_operation_id: string; state: string }>(
      'select client_operation_id, state from queue_entry where actor_id = ? order by created_at',
      [B],
    );
    expect(crudas).toEqual([
      { client_operation_id: 'b1', state: 'sending' },
      { client_operation_id: 'b2', state: 'queued' },
    ]);
    db.close();
  });
});
