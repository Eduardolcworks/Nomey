import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LATEST_USER_VERSION, migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { TransportOutcome } from '../../src/lib/offline/response';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';
import { createSyncWorker } from '../../src/lib/offline/sync-worker';
import type { ProgressChange, WorkerPorts } from '../../src/lib/offline/worker-ports';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * LA SECUENCIA DE RECONCILIACIÓN ES DURABLE Y MONÓTONA (ADR-028 §9).
 *
 * `confirm_seq` se compara con `snapshot.seq`, así que el contador tiene que
 * sobrevivir a la app y no puede venir del reloj ni deducirse de las entradas,
 * que se podan. Aquí se demuestra sobre SQLite real: avanza de uno en uno, es
 * por actor, sobrevive a cerrar y reabrir el fichero, y no retrocede aunque se
 * borren todas las entradas que lo hicieron avanzar.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

let seq = 0;
function expense(actorId: string): QueueEntry {
  seq += 1;
  const clientOperationId = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
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
      amount: '1230',
      effective_date: '2026-09-03',
      effective_time: '21:40',
      concept: 'Cena',
      category_id: CATEGORY,
    },
    currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
    createdAt: `2026-09-03T21:40:${String(seq % 60).padStart(2, '0')}.000Z`,
  });
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore(file = ':memory:') {
  const db = openTestDatabase(file);
  await migrate(db);
  return { db, store: createSqliteQueueStore(db as SqlDatabase) };
}

describe('el cursor durable', () => {
  it('la migración lo crea, y el esquema queda en la versión 3', async () => {
    const { db } = await openStore();
    expect(LATEST_USER_VERSION).toBe(3);
    const tables = await db.getAllAsync<{ name: string }>(
      "select name from sqlite_master where type = 'table' and name = 'reconcile_cursor'",
    );
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('empieza en 0 y avanza de uno en uno', async () => {
    const { db, store } = await openStore();
    expect(await store.confirmSequence(ACTOR_A)).toBe(0);
    expect(await store.nextConfirmSeq(ACTOR_A)).toBe(1);
    expect(await store.nextConfirmSeq(ACTOR_A)).toBe(2);
    expect(await store.nextConfirmSeq(ACTOR_A)).toBe(3);
    // Leerlo no lo mueve.
    expect(await store.confirmSequence(ACTOR_A)).toBe(3);
    expect(await store.confirmSequence(ACTOR_A)).toBe(3);
    db.close();
  });

  it('ES POR ACTOR: la cuenta de uno no ve ni mueve la del otro', async () => {
    const { db, store } = await openStore();
    await store.nextConfirmSeq(ACTOR_A);
    await store.nextConfirmSeq(ACTOR_A);
    expect(await store.confirmSequence(ACTOR_B)).toBe(0);
    expect(await store.nextConfirmSeq(ACTOR_B)).toBe(1);
    expect(await store.confirmSequence(ACTOR_A)).toBe(2);
    db.close();
  });

  it('SOBREVIVE A CERRAR Y REABRIR, y no depende del reloj', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomey-seq-'));
    dirs.push(dir);
    const file = join(dir, 'queue.db');

    const first = await openStore(file);
    await first.store.nextConfirmSeq(ACTOR_A);
    await first.store.nextConfirmSeq(ACTOR_A);
    await first.store.nextConfirmSeq(ACTOR_A);
    first.db.close();

    const second = await openStore(file);
    expect(await second.store.confirmSequence(ACTOR_A)).toBe(3);
    expect(await second.store.nextConfirmSeq(ACTOR_A)).toBe(4);
    second.db.close();
  });

  it('NO RETROCEDE AL PODAR: borrar todas las entradas confirmadas lo deja donde estaba', async () => {
    const { db, store } = await openStore();
    const a = expense(ACTOR_A);
    const b = expense(ACTOR_A);
    await store.enqueue(a);
    await store.enqueue(b);
    for (const entry of [a, b]) {
      const confirmSeq = await store.nextConfirmSeq(ACTOR_A);
      await store.markProgress(ACTOR_A, entry.clientOperationId, {
        state: 'confirmed',
        confirmSeq,
        resultOperationId: `op-${confirmSeq}`,
      });
    }
    await store.remove(ACTOR_A, a.clientOperationId);
    await store.remove(ACTOR_A, b.clientOperationId);
    expect(await store.all(ACTOR_A)).toEqual([]);

    // Un contador derivado de las entradas volvería aquí a 0 y la siguiente
    // confirmación (1) parecería anterior a un snapshot viejo (2): se retiraría
    // sin prueba. El cursor sigue en 2, y la siguiente es 3.
    expect(await store.confirmSequence(ACTOR_A)).toBe(2);
    expect(await store.nextConfirmSeq(ACTOR_A)).toBe(3);
    db.close();
  });
});

describe('el worker al confirmar', () => {
  function harness(
    db: TestDatabase,
    outcome: TransportOutcome,
    onProgress?: WorkerPorts['onProgress'],
  ) {
    const store: QueueStore = createSqliteQueueStore(db as SqlDatabase);
    const changes: ProgressChange[] = [];
    const ports: WorkerPorts = {
      store,
      transport: { send: async () => outcome },
      clock: { now: () => Date.parse('2026-09-03T21:40:00.000Z') },
      random: () => 0,
      connectivity: { isConnected: () => true, subscribe: () => () => undefined },
      session: {
        status: () => 'signed-in',
        actorId: () => ACTOR_A,
        subscribe: () => () => undefined,
      },
      timeoutMs: 50,
      onProgress:
        onProgress ??
        ((change) => {
          changes.push(change);
        }),
    };
    return { store, changes, worker: createSyncWorker(ports) };
  }

  it('ESCRIBE `confirm_seq` Y `result_operation_id` JUNTOS, desde el cursor', async () => {
    const { db } = await openStore();
    const { store, worker, changes } = harness(db, {
      kind: 'ok',
      operationId: 'op-9',
      alreadyProcessed: false,
    });
    const a = expense(ACTOR_A);
    const b = expense(ACTOR_A);
    await store.enqueue(a);
    await store.enqueue(b);

    await worker.drain();

    const rowA = await store.byId(ACTOR_A, a.clientOperationId);
    const rowB = await store.byId(ACTOR_A, b.clientOperationId);
    expect(rowA).toMatchObject({ state: 'confirmed', confirmSeq: 1, resultOperationId: 'op-9' });
    expect(rowB).toMatchObject({ state: 'confirmed', confirmSeq: 2, resultOperationId: 'op-9' });
    expect(await store.confirmSequence(ACTOR_A)).toBe(2);

    // Y lo anuncia, sin payload: de quién, cuál, a qué estado, con qué resultado.
    expect(changes).toEqual([
      {
        actorId: ACTOR_A,
        clientOperationId: a.clientOperationId,
        state: 'confirmed',
        resultOperationId: 'op-9',
      },
      {
        actorId: ACTOR_A,
        clientOperationId: b.clientOperationId,
        state: 'confirmed',
        resultOperationId: 'op-9',
      },
    ]);
    for (const change of changes)
      expect(Object.keys(change).sort()).toEqual([
        'actorId',
        'clientOperationId',
        'resultOperationId',
        'state',
      ]);
    db.close();
  });

  it('un replay (`already_processed`) también confirma y toma su propio número', async () => {
    const { db } = await openStore();
    const { store, worker } = harness(db, {
      kind: 'ok',
      operationId: 'op-1',
      alreadyProcessed: true,
    });
    const a = expense(ACTOR_A);
    await store.enqueue(a);
    await worker.runOnce();
    expect(await store.byId(ACTOR_A, a.clientOperationId)).toMatchObject({
      state: 'confirmed',
      confirmSeq: 1,
      resultOperationId: 'op-1',
    });
    db.close();
  });

  it('anuncia también los transitorios y los terminales, sin tocar el cursor', async () => {
    const { db } = await openStore();
    const { store, worker, changes } = harness(db, {
      kind: 'http',
      status: 400,
      code: 'PAYLOAD_INVALID',
    });
    const a = expense(ACTOR_A);
    await store.enqueue(a);
    await worker.runOnce();
    expect(changes).toEqual([
      {
        actorId: ACTOR_A,
        clientOperationId: a.clientOperationId,
        state: 'rejected',
        resultOperationId: null,
      },
    ]);
    expect(await store.confirmSequence(ACTOR_A)).toBe(0);
    db.close();
  });

  /**
   * LO QUE HACE QUE DESCARTAR UNA RESPUESTA NO ATASQUE LA PANTALLA.
   *
   * `snapshot-window.ts` descarta toda respuesta cuya ventana no fue quieta, y
   * eso sólo es sostenible si **cada avance del contador trae consigo un
   * aviso**: sin él, quien proyecta no sabría que tiene que volver a pedir la
   * base y se quedaría esperando una que nadie va a traer.
   *
   * Las dos mitades de esa garantía se comprueban aquí, sobre el worker de
   * verdad: el contador **sólo** se mueve al confirmar, y confirmar **siempre**
   * se anuncia.
   */
  const quiet: { label: string; outcome: TransportOutcome }[] = [
    { label: 'un 5xx', outcome: { kind: 'http', status: 503, code: null } },
    {
      label: 'un payload inválido',
      outcome: { kind: 'http', status: 400, code: 'PAYLOAD_INVALID' },
    },
    {
      label: 'un conflicto monetario',
      outcome: { kind: 'http', status: 422, code: 'CURRENCY_CONVERSION_UNSUPPORTED' },
    },
  ];

  for (const { label, outcome } of quiet) {
    it(`${label} NO mueve el contador, y aun así se anuncia`, async () => {
      const { db } = await openStore();
      const { store, worker, changes } = harness(db, outcome);
      await store.enqueue(expense(ACTOR_A));

      await worker.runOnce();

      expect(await store.confirmSequence(ACTOR_A)).toBe(0);
      expect(changes).toHaveLength(1);
      expect(changes[0].state).not.toBe('confirmed');
      db.close();
    });
  }

  it('CADA AVANCE TIENE SU AVISO: tantas confirmaciones como pasos del contador', async () => {
    const { db } = await openStore();
    const { store, worker, changes } = harness(db, {
      kind: 'ok',
      operationId: 'op-7',
      alreadyProcessed: false,
    });
    for (let i = 0; i < 4; i += 1) await store.enqueue(expense(ACTOR_A));

    await worker.drain();

    const advanced = await store.confirmSequence(ACTOR_A);
    expect(advanced).toBe(4);
    expect(changes.filter((change) => change.state === 'confirmed')).toHaveLength(advanced);
    db.close();
  });

  it('un observador que lanza no rompe la anotación', async () => {
    const { db } = await openStore();
    const { store, worker } = harness(
      db,
      { kind: 'ok', operationId: 'op-2', alreadyProcessed: false },
      () => {
        throw new Error('observador roto');
      },
    );
    const a = expense(ACTOR_A);
    await store.enqueue(a);
    const run = await worker.runOnce();
    expect(run.kind).toBe('attempted');
    expect((await store.byId(ACTOR_A, a.clientOperationId))?.state).toBe('confirmed');
    db.close();
  });
});
