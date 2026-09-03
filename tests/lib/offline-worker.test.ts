import { describe, expect, it } from 'vitest';

import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';
import { migrate } from '../../src/lib/offline/migrations';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { TransportOutcome } from '../../src/lib/offline/response';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';
import { createSyncWorker, retryNow } from '../../src/lib/offline/sync-worker';
import type { Connectivity, SessionPort, WorkerPorts } from '../../src/lib/offline/worker-ports';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * EL WORKER, sobre SQLite real y con todo lo demás inyectado.
 *
 * Ni una espera arbitraria: el reloj, el RNG, la conectividad, la sesión y el
 * transporte son puertos, así que cada escenario se afirma por lo que quedó en
 * la base y no por lo que pasó mientras tanto.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

let seq = 0;
const nextKey = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

function expense(actorId: string, over: { createdAt?: string; amount?: string } = {}): QueueEntry {
  const clientOperationId = nextKey();
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
      amount: over.amount ?? '1230',
      effective_date: '2026-09-03',
      effective_time: '21:40',
      concept: 'Cena',
      category_id: CATEGORY,
    },
    currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
    createdAt: over.createdAt ?? '2026-09-03T21:40:00.000Z',
  });
}

/** Un servidor de mentira que anota cada clave que recibe. */
function fakeServer(script: TransportOutcome[] | ((n: number) => TransportOutcome)) {
  const seen: string[] = [];
  const written = new Set<string>();
  let calls = 0;

  return {
    seen,
    written,
    get calls() {
      return calls;
    },
    transport: {
      async send(_type: string, payload: Record<string, unknown>) {
        const key = String(payload.client_operation_id);
        seen.push(key);
        const outcome =
          typeof script === 'function' ? script(calls) : (script[calls] ?? script.at(-1)!);
        calls += 1;
        if (outcome.kind === 'ok') written.add(key);
        return outcome;
      },
    },
  };
}

function harness(options: {
  db: TestDatabase;
  transport: { send: (t: string, p: Record<string, unknown>) => Promise<TransportOutcome> };
  actor?: string | null;
  session?: SessionPort['status'] extends () => infer S ? S : never;
  connected?: boolean;
  now?: number;
  random?: number;
}) {
  const store: QueueStore = createSqliteQueueStore(options.db as SqlDatabase);
  const state = {
    actor: options.actor === undefined ? ACTOR_A : options.actor,
    session: options.session ?? ('signed-in' as const),
    connected: options.connected ?? true,
    now: options.now ?? Date.parse('2026-09-03T21:40:00.000Z'),
  };

  const connectivity: Connectivity = {
    isConnected: () => state.connected,
    subscribe: () => () => undefined,
  };
  const session: SessionPort = {
    status: () => state.session,
    actorId: () => state.actor,
    subscribe: () => () => undefined,
  };

  const ports: WorkerPorts = {
    store,
    transport: options.transport as WorkerPorts['transport'],
    clock: { now: () => state.now },
    random: () => options.random ?? 0,
    connectivity,
    session,
    timeoutMs: 50,
  };

  return { store, state, worker: createSyncWorker(ports), ports };
}

async function openStore() {
  const db = openTestDatabase();
  await migrate(db);
  return db;
}

const OK = (id = 'op-1', already = false): TransportOutcome => ({
  kind: 'ok',
  operationId: id,
  alreadyProcessed: already,
});

describe('la misma clave mientras el resultado sea desconocido', () => {
  it('RESPUESTA PERDIDA DESPUÉS DE ESCRIBIR → misma clave, una sola operación', async () => {
    /*
     * El caso que motiva ADR-010 entero: el servidor guarda, la respuesta se
     * pierde, el cliente no puede distinguir «no llegó» de «no me enteré».
     * Reintenta con la MISMA clave y recibe `already_processed`.
     */
    const db = await openStore();
    const server = fakeServer([{ kind: 'unreachable', reason: 'transport' }, OK('op-1', true)]);
    const { store, worker } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.runOnce(); // se pierde
    await store.markProgress(ACTOR_A, entry.clientOperationId, { nextAttemptAt: null });
    await worker.runOnce(); // reintento

    expect(server.seen).toEqual([entry.clientOperationId, entry.clientOperationId]);
    expect(new Set(server.seen).size).toBe(1);
    const done = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(done?.state).toBe('confirmed');
    expect(done?.resultOperationId).toBe('op-1');
    db.close();
  });

  it('cierre durante `sending` → se reenvía con su misma clave', async () => {
    const db = await openStore();
    const server = fakeServer([OK('op-2', true)]);
    const { store, worker } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);
    // Como si el proceso hubiera muerto en pleno envío.
    await store.markProgress(ACTOR_A, entry.clientOperationId, { state: 'sending' });

    await store.recoverSending(ACTOR_A);
    await worker.runOnce();

    expect(server.seen).toEqual([entry.clientOperationId]);
    expect((await store.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('confirmed');
    db.close();
  });

  it('DOS ENTRADAS CON PAYLOAD IDÉNTICO → dos claves y dos envíos', async () => {
    // Dos cafés iguales son dos gastos reales. Prohibido deduplicar por payload.
    const db = await openStore();
    const server = fakeServer([OK('op-a'), OK('op-b')]);
    const { store, worker } = harness({ db, transport: server.transport });

    const uno = expense(ACTOR_A, { createdAt: '2026-09-03T21:00:00.000Z' });
    const dos = expense(ACTOR_A, { createdAt: '2026-09-03T21:00:01.000Z' });
    await store.enqueue(uno);
    await store.enqueue(dos);

    await worker.drain();

    expect(server.seen).toEqual([uno.clientOperationId, dos.clientOperationId]);
    expect(new Set(server.seen).size).toBe(2);
    db.close();
  });
});

describe('orden y concurrencia', () => {
  it('FIFO por fecha de creación', async () => {
    const db = await openStore();
    const server = fakeServer(() => OK());
    const { store, worker } = harness({ db, transport: server.transport });

    const tercera = expense(ACTOR_A, { createdAt: '2026-09-03T23:00:00.000Z' });
    const primera = expense(ACTOR_A, { createdAt: '2026-09-03T21:00:00.000Z' });
    const segunda = expense(ACTOR_A, { createdAt: '2026-09-03T22:00:00.000Z' });
    await store.enqueue(tercera);
    await store.enqueue(primera);
    await store.enqueue(segunda);

    await worker.drain();

    expect(server.seen).toEqual([
      primera.clientOperationId,
      segunda.clientOperationId,
      tercera.clientOperationId,
    ]);
    db.close();
  });

  it('UNA SOLA PETICIÓN EN VUELO, aunque se despierte muchas veces', async () => {
    const db = await openStore();
    let concurrentes = 0;
    let maximo = 0;
    const transport = {
      async send(_t: string, payload: Record<string, unknown>) {
        concurrentes += 1;
        maximo = Math.max(maximo, concurrentes);
        await Promise.resolve();
        concurrentes -= 1;
        return OK(`op-${String(payload.client_operation_id)}`);
      },
    };
    const { store, worker } = harness({ db, transport });

    for (let i = 0; i < 5; i += 1) {
      await store.enqueue(expense(ACTOR_A, { createdAt: `2026-09-03T21:0${i}:00.000Z` }));
    }

    worker.wake();
    worker.wake();
    worker.wake();
    // Deja correr el bucle hasta que se vacíe.
    for (let i = 0; i < 50 && worker.isRunning(); i += 1) await Promise.resolve();
    await worker.drain();

    expect(maximo).toBe(1);
    expect((await store.pending(ACTOR_A)).filter((e) => e.state !== 'confirmed')).toEqual([]);
    db.close();
  });
});

describe('lo transitorio se reintenta, con su backoff', () => {
  it.each([
    ['sin red', { kind: 'unreachable', reason: 'offline' } as TransportOutcome],
    ['plazo agotado', { kind: 'unreachable', reason: 'timeout' } as TransportOutcome],
    ['408', { kind: 'http', status: 408, code: null } as TransportOutcome],
    ['429', { kind: 'http', status: 429, code: null } as TransportOutcome],
    ['503', { kind: 'http', status: 503, code: null } as TransportOutcome],
  ])('%s deja la entrada en retryable, con su clave', async (_name, outcome) => {
    const db = await openStore();
    const server = fakeServer([outcome]);
    const { store, worker } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.runOnce();

    const after = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(after?.state).toBe('retryable');
    expect(after?.attempts).toBe(1);
    expect(after?.nextAttemptAt).not.toBeNull();
    expect(after?.clientOperationId).toBe(entry.clientOperationId);
    expect(after?.payload).toEqual(entry.payload);
    db.close();
  });

  it('no se reintenta antes de tiempo, y sí después', async () => {
    const db = await openStore();
    const server = fakeServer([{ kind: 'unreachable', reason: 'transport' }, OK()]);
    const { store, worker, state } = harness({ db, transport: server.transport });
    await store.enqueue(expense(ACTOR_A));

    await worker.runOnce();
    expect((await worker.runOnce()).kind).toBe('idle');
    expect(server.calls).toBe(1);

    state.now += 2_000;
    expect((await worker.runOnce()).kind).toBe('attempted');
    expect(server.calls).toBe(2);
    db.close();
  });

  it('UN TIMEOUT REAL ABORTA LA PETICIÓN Y CONSERVA LA ENTRADA', async () => {
    const db = await openStore();
    let abortada = false;
    const transport = {
      send: (_t: string, _p: Record<string, unknown>, signal: AbortSignal) =>
        new Promise<TransportOutcome>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            abortada = true;
            reject(new Error('aborted'));
          });
        }),
    };
    const { store, worker } = harness({ db, transport: transport as never });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.runOnce();

    expect(abortada).toBe(true);
    const after = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(after?.state).toBe('retryable');
    expect(after?.lastErrorCode).toBe('timeout');
    // Y la clave sigue siendo la misma: el plazo no inventa una intención nueva.
    expect(after?.clientOperationId).toBe(entry.clientOperationId);
    db.close();
  });
});

describe('los terminales, y que no hay bucle', () => {
  it.each([
    [
      'permanente',
      { kind: 'http', status: 400, code: 'PAYLOAD_INVALID' } as TransportOutcome,
      'rejected',
    ],
    [
      'autorización',
      { kind: 'http', status: 403, code: 'NOT_AUTHORIZED' } as TransportOutcome,
      'rejected',
    ],
    [
      'dominio',
      { kind: 'http', status: 422, code: 'CATEGORY_NOT_USABLE' } as TransportOutcome,
      'rejected',
    ],
    [
      'moneda',
      { kind: 'http', status: 422, code: 'CURRENCY_CONVERSION_UNSUPPORTED' } as TransportOutcome,
      'conflict',
    ],
    [
      'indemostrable',
      { kind: 'http', status: 409, code: 'IDEMPOTENCY_KEY_REUSED' } as TransportOutcome,
      'review',
    ],
  ])('%s → %s, y NO se vuelve a intentar', async (_n, outcome, esperado) => {
    const db = await openStore();
    const server = fakeServer([outcome]);
    const { store, worker } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.runOnce();
    expect((await store.byId(ACTOR_A, entry.clientOperationId))?.state).toBe(esperado);

    // Diez pasadas más: ni una llamada. Es la ausencia de bucle, comprobada.
    for (let i = 0; i < 10; i += 1) await worker.runOnce();
    expect(server.calls).toBe(1);
    db.close();
  });

  it('un terminal no bloquea a las siguientes', async () => {
    const db = await openStore();
    const server = fakeServer([{ kind: 'http', status: 400, code: 'PAYLOAD_INVALID' }, OK()]);
    const { store, worker } = harness({ db, transport: server.transport });
    const mala = expense(ACTOR_A, { createdAt: '2026-09-03T21:00:00.000Z' });
    const buena = expense(ACTOR_A, { createdAt: '2026-09-03T21:01:00.000Z' });
    await store.enqueue(mala);
    await store.enqueue(buena);

    await worker.drain();

    expect((await store.byId(ACTOR_A, mala.clientOperationId))?.state).toBe('rejected');
    expect((await store.byId(ACTOR_A, buena.clientOperationId))?.state).toBe('confirmed');
    db.close();
  });

  it('NINGÚN FALLO BORRA LA ENTRADA: el dinero declarado sigue ahí', async () => {
    const db = await openStore();
    const server = fakeServer(() => ({ kind: 'http', status: 400, code: 'PAYLOAD_INVALID' }));
    const { store, worker } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.drain();

    const after = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(after).not.toBeNull();
    expect(after?.payload).toEqual(entry.payload);
    expect(after?.lastErrorCode).toBe('PAYLOAD_INVALID');
    db.close();
  });
});

describe('conectividad: dispara y suprime, nunca demuestra', () => {
  it('sin enlace no se intenta Y NO SE MARCA NADA COMO FALLIDO', async () => {
    const db = await openStore();
    const server = fakeServer(() => OK());
    const { store, worker } = harness({ db, transport: server.transport, connected: false });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    expect(await worker.runOnce()).toEqual({ kind: 'idle', reason: 'offline' });
    expect(server.calls).toBe(0);
    const after = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(after?.state).toBe('queued');
    expect(after?.attempts).toBe(0);
    db.close();
  });

  it('al recuperar el enlace, sale', async () => {
    const db = await openStore();
    const server = fakeServer([OK()]);
    const { store, worker, state } = harness({
      db,
      transport: server.transport,
      connected: false,
    });
    await store.enqueue(expense(ACTOR_A));

    await worker.runOnce();
    state.connected = true;
    expect((await worker.runOnce()).kind).toBe('attempted');
    db.close();
  });
});

describe('sesión y aislamiento', () => {
  it('sin sesión no se envía nada', async () => {
    const db = await openStore();
    const server = fakeServer(() => OK());
    const { store, worker } = harness({
      db,
      transport: server.transport,
      session: 'signed-out',
    });
    await store.enqueue(expense(ACTOR_A));

    expect(await worker.runOnce()).toEqual({ kind: 'idle', reason: 'noSession' });
    expect(server.calls).toBe(0);
    db.close();
  });

  it('un 401 bloquea por sesión, y al volver la misma cuenta se reanuda', async () => {
    const db = await openStore();
    const server = fakeServer([{ kind: 'http', status: 401, code: '42501' }, OK()]);
    const { store, worker } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.runOnce();
    expect((await store.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('blocked_session');

    await worker.runOnce();
    const after = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(after?.state).toBe('confirmed');
    // Misma clave en los dos envíos: un 401 no inventa una intención nueva.
    expect(server.seen).toEqual([entry.clientOperationId, entry.clientOperationId]);
    db.close();
  });

  it('CON OTRA CUENTA DENTRO, NADA DE LA PRIMERA SE LEE NI SE ENVÍA', async () => {
    const db = await openStore();
    const server = fakeServer(() => OK());
    const { store, worker, state } = harness({ db, transport: server.transport });
    const deA = expense(ACTOR_A);
    await store.enqueue(deA);

    state.actor = ACTOR_B;
    expect(await worker.runOnce()).toEqual({ kind: 'idle', reason: 'empty' });
    expect(server.calls).toBe(0);

    // Y la de A sigue intacta, esperando a su dueña.
    const after = await store.byId(ACTOR_A, deA.clientOperationId);
    expect(after?.state).toBe('queued');
    expect(after?.attempts).toBe(0);
    db.close();
  });

  it('cerrar sesión conserva las entradas de su actor', async () => {
    const db = await openStore();
    const server = fakeServer(() => OK());
    const { store, worker, state } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    state.session = 'signed-out';
    state.actor = null;
    await worker.runOnce();

    // Nunca se descartan automáticamente (ADR-028 §13).
    const after = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(after).not.toBeNull();
    expect(after?.payload).toEqual(entry.payload);
    db.close();
  });
});

describe('el reintento manual', () => {
  it('SÓLO ADELANTA EL PLAZO: ni entrada nueva ni clave nueva', async () => {
    const db = await openStore();
    const server = fakeServer([{ kind: 'unreachable', reason: 'transport' }, OK()]);
    const { store, worker, ports } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);

    await worker.runOnce();
    const esperando = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(esperando?.nextAttemptAt).not.toBeNull();

    expect(await retryNow(ports, ACTOR_A, entry.clientOperationId)).toBe(true);

    expect(await store.all(ACTOR_A)).toHaveLength(1);
    expect((await store.byId(ACTOR_A, entry.clientOperationId))?.nextAttemptAt).toBeNull();
    await worker.runOnce();
    expect(server.seen).toEqual([entry.clientOperationId, entry.clientOperationId]);
    db.close();
  });

  it('sobre una terminal no hace nada', async () => {
    const db = await openStore();
    const server = fakeServer([{ kind: 'http', status: 400, code: 'PAYLOAD_INVALID' }]);
    const { store, worker, ports } = harness({ db, transport: server.transport });
    const entry = expense(ACTOR_A);
    await store.enqueue(entry);
    await worker.runOnce();

    expect(await retryNow(ports, ACTOR_A, entry.clientOperationId)).toBe(false);
    expect(await store.all(ACTOR_A)).toHaveLength(1);
    db.close();
  });

  it('no toca la entrada de otro actor', async () => {
    const db = await openStore();
    const server = fakeServer(() => OK());
    const { store, ports } = harness({ db, transport: server.transport });
    const deA = expense(ACTOR_A);
    await store.enqueue(deA);

    expect(await retryNow(ports, ACTOR_B, deA.clientOperationId)).toBe(false);
    db.close();
  });
});
