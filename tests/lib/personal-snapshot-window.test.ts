import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DateRange } from '../../src/features/personal/interval';
import type { PersonalOperation } from '../../src/features/personal/movement';
import { projectHome, type ProjectionSnapshot } from '../../src/features/personal/projection';
import { inQuietWindow, type QuietWindowPorts } from '../../src/features/personal/snapshot-window';
import type { PersonalStatistics } from '../../src/features/personal/statistics';
import { migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry } from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { TransportOutcome } from '../../src/lib/offline/response';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';
import { createSyncWorker, type SyncWorker } from '../../src/lib/offline/sync-worker';
import type { WorkerPorts } from '../../src/lib/offline/worker-ports';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * THE RACE BETWEEN A SEND AND A READ, with explicit gates and no timers.
 *
 * ADR-028 §9 proves retirement with a monotonic mark: `confirm_seq <=
 * snapshot.seq`. That direction is sound. The converse is not, and it fails in
 * two different places — the second one is the reason this file exists.
 *
 *   HOLE 1  a confirmation lands while the response is in flight
 *   HOLE 2  THE SERVER WRITES BEFORE THE CLIENT LEARNS ANYTHING: the request is
 *           still in the air, so `confirm_seq` has not moved, the window looks
 *           perfectly quiet, the base already carries the effect, and the entry
 *           is still projected — the movement is counted twice
 *
 * Nothing here is argued. A fake server whose WRITE and whose RESPONSE are two
 * separate steps, the real `createSyncWorker`, a real SQLite queue, and gates
 * that fix the exact order of every step. Every case asserts the painted figure
 * against the server's truth, and the ones that matter also assert the
 * counterfactual: what the old rule would have painted.
 */

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';
const TODAY = '2026-09-03';
const MONTH = { from: '2026-09-01', to: '2026-09-30' } as DateRange;

const scope = {
  scopeId: SCOPE,
  currencyDefinitionId: CURRENCY,
  currencyCode: 'EUR',
  currencyScale: 2,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A gate: whoever waits stops until somebody opens it. */
function gate() {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/**
 * THE SERVER, with the write and the read told apart.
 *
 * `write` is the instant the movement enters the accounts; the read functions
 * are what a query running NOW would return. Separating them is all it takes to
 * reproduce both holes, because a query that leaves before the write can read
 * after it.
 */
function server(startingBalance: bigint) {
  const state = {
    balance: startingBalance,
    expense: 0n,
    income: 0n,
    operations: [] as PersonalOperation[],
    /** Which client keys were already written. This is the idempotency. */
    keys: new Map<string, string>(),
  };

  return {
    /** Returns the server operation id, minting one only the first time. */
    write(clientKey: string, minor: bigint, kind: 'expense' | 'income' = 'expense') {
      const known = state.keys.get(clientKey);
      if (known !== undefined) return known;
      const operationId = `op-${String(state.keys.size + 1)}`;
      state.keys.set(clientKey, operationId);

      if (kind === 'expense') {
        state.balance -= minor;
        state.expense += minor;
      } else {
        state.balance += minor;
        state.income += minor;
      }
      state.operations = [
        {
          operation_id: operationId,
          operation_class: kind === 'expense' ? 'personal_expense' : 'personal_income',
          scope_id: SCOPE,
          currency_definition_id: CURRENCY,
          balance_amount: String(kind === 'expense' ? -minor : minor),
          original_amount: String(minor),
          effective_date: TODAY,
          effective_time: '21:40:00',
          concept: 'Cena',
          category_id: kind === 'expense' ? CATEGORY : null,
          target_balance: null,
          current_version_id: `v-${operationId}`,
          previous_version_id: null,
          version_no: 1,
          operation_created_at: '2026-09-03T21:40:00.000Z',
        },
        ...state.operations,
      ];
      return operationId;
    },
    /** How many operations exist. One per key, never one per attempt. */
    written: () => state.keys.size,
    balance: () => String(state.balance),
    operations: () => [...state.operations],
    statistics: (): PersonalStatistics => ({
      scope_id: SCOPE,
      currency_definition_id: CURRENCY,
      from: MONTH.from,
      to: MONTH.to,
      income_total: String(state.income),
      expense_total: String(state.expense),
      categories:
        state.expense === 0n
          ? []
          : [
              {
                category_id: CATEGORY,
                expense_total: String(state.expense),
                operation_count: state.operations.filter(
                  (op) => op.operation_class === 'personal_expense',
                ).length,
              },
            ],
    }),
    /** The accounting truth, to compare against what gets painted. */
    truth: () => String(state.balance),
  };
}

type Api = ReturnType<typeof server>;

let seq = 0;
function entry(over: { kind?: 'expense' | 'income'; amount?: string; actorId?: string } = {}) {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const kind = over.kind ?? 'expense';
  const payload: Record<string, string | number> = {
    client_operation_id: id,
    command_contract_version: 2,
    scope_id: SCOPE,
    currency_definition_id: CURRENCY,
    amount: over.amount ?? '1230',
    effective_date: TODAY,
    effective_time: '21:40',
    concept: 'Cena',
  };
  if (kind === 'expense') payload.category_id = CATEGORY;

  return newQueueEntry({
    clientOperationId: id,
    actorId: over.actorId ?? ACTOR,
    scopeId: SCOPE,
    commandType: kind === 'income' ? 'personal_income.create' : 'personal_expense.create',
    payload,
    currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
    createdAt: `2026-09-03T21:40:${String(seq % 60).padStart(2, '0')}.000Z`,
  });
}

/**
 * A transport that never answers on its own.
 *
 * Every `send` parks. The test decides when the server writes and, separately,
 * when the response comes back — which is exactly the gap hole 2 lives in.
 */
function gatedTransport() {
  const parked: {
    payload: Record<string, unknown>;
    resolve: (outcome: TransportOutcome) => void;
  }[] = [];
  const waiting: (() => void)[] = [];

  return {
    transport: {
      async send(_type: string, payload: Record<string, unknown>): Promise<TransportOutcome> {
        return new Promise<TransportOutcome>((resolve) => {
          parked.push({ payload, resolve });
          waiting.shift()?.();
        });
      },
    },
    key: (at = 0) => String(parked[at].payload.client_operation_id),
    /** Waits until a request is actually parked in the transport. */
    async next(): Promise<void> {
      if (parked.length > 0) return;
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    settle(outcome: TransportOutcome) {
      const one = parked.shift();
      if (one === undefined) throw new Error('no request in flight');
      one.resolve(outcome);
    },
  };
}

type Harness = {
  db: TestDatabase;
  store: QueueStore;
  worker: SyncWorker;
  net: ReturnType<typeof gatedTransport>;
  ports: QuietWindowPorts;
};

async function open(file = ':memory:', over: Partial<WorkerPorts> = {}): Promise<Harness> {
  const db = openTestDatabase(file);
  await migrate(db);
  const store: QueueStore = createSqliteQueueStore(db as SqlDatabase);
  const net = gatedTransport();

  const worker = createSyncWorker({
    store,
    transport: net.transport,
    clock: { now: () => Date.parse('2026-09-03T21:40:00.000Z') },
    random: () => 0,
    connectivity: { isConnected: () => true, subscribe: () => () => undefined },
    session: { status: () => 'signed-in', actorId: () => ACTOR, subscribe: () => () => undefined },
    timeoutMs: 50_000,
    ...over,
  });

  const ports: QuietWindowPorts = {
    barrier: () => store.barrier(ACTOR),
    projecting: () => true,
  };

  return { db, store, worker, net, ports };
}

type Base = {
  balance: { amount: string; seq: number } | null;
  interval: {
    statistics: PersonalStatistics;
    operations: PersonalOperation[];
    total: number;
    seq: number;
  } | null;
};

/** The whole interval block, as one refresh brings it. */
const fetchAll = (api: Api) => async () => ({
  balance: api.balance(),
  statistics: api.statistics(),
  operations: api.operations(),
});

const asBase = (
  value: { balance: string; statistics: PersonalStatistics; operations: PersonalOperation[] },
  seq: number | null,
): Base => ({
  balance: { amount: value.balance, seq: seq ?? 0 },
  interval: {
    statistics: value.statistics,
    operations: value.operations,
    total: value.operations.length,
    seq: seq ?? 0,
  },
});

/** What the screen would paint with this base and this queue. */
async function paint(store: QueueStore, base: Base, actorId = ACTOR) {
  const snapshot: ProjectionSnapshot = { balance: base.balance, interval: base.interval };
  return projectHome({
    scope,
    range: MONTH,
    entries: await store.pending(actorId),
    snapshot,
    aliases: new Map(),
  });
}

/** The base a refresh produces right now, or `null` if it is refused. */
async function refresh(h: Harness, api: Api): Promise<Base | null> {
  const window = await inQuietWindow(h.ports, fetchAll(api));
  return window.kind === 'base' ? asBase(window.value, window.seq) : null;
}

describe('1 · el envío empieza ANTES del refresco y termina DESPUÉS', () => {
  it('la ventana no es quieta desde el primer instante: no hay base nueva, y la vieja sigue valiendo', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    // Base fiable ANTES de nada: 100,00 y ningún movimiento.
    const good = await refresh(h, api);
    expect(good).not.toBeNull();
    expect((await paint(h.store, good!)).balance).toBe('8770');

    // El envío arranca y se queda en vuelo.
    const pass = h.worker.runOnce();
    await h.net.next();
    expect((await h.store.barrier(ACTOR)).uncertain).toBe(1);

    // Un refresco entero mientras tanto: el servidor ya ha escrito.
    api.write(local.clientOperationId, 1230n);
    expect(await refresh(h, api)).toBeNull();

    // Se sigue pintando sobre la base buena, y la cifra es la verdad.
    const painted = await paint(h.store, good!);
    expect(painted.balance).toBe(api.truth());
    expect(painted.operations).toHaveLength(1);
    expect(painted.reconciled).toEqual([]);

    h.net.settle({ kind: 'ok', operationId: 'op-1', alreadyProcessed: false });
    await pass;
    h.db.close();
  });
});

describe('2 · el envío empieza DURANTE el refresco', () => {
  it('el contador de envíos se mueve, y la respuesta no puede ser base', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    expect(await h.store.barrier(ACTOR)).toEqual({ confirmSeq: 0, dispatchSeq: 0, uncertain: 0 });

    const held = gate();
    const running = inQuietWindow(h.ports, async () => {
      await held.waited;
      return { balance: api.balance(), statistics: api.statistics(), operations: api.operations() };
    });

    // En plena ventana: el envío arranca y el servidor escribe.
    const pass = h.worker.runOnce();
    await h.net.next();
    api.write(local.clientOperationId, 1230n);
    held.open();

    expect((await running).kind).toBe('superseded');
    expect((await h.store.barrier(ACTOR)).dispatchSeq).toBe(1);

    h.net.settle({ kind: 'ok', operationId: 'op-1', alreadyProcessed: false });
    await pass;
    h.db.close();
  });
});

describe('3 · el envío empieza y termina ENTERO dentro del refresco', () => {
  it('aunque al final no quede nada incierto, los contadores lo delatan', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    const held = gate();
    const running = inQuietWindow(h.ports, async () => {
      await held.waited;
      return { balance: api.balance(), statistics: api.statistics(), operations: api.operations() };
    });

    const pass = h.worker.runOnce();
    await h.net.next();
    const opId = api.write(local.clientOperationId, 1230n);
    h.net.settle({ kind: 'ok', operationId: opId, alreadyProcessed: false });
    await pass;
    held.open();

    // Al cerrar la ventana no queda nada incierto —ya está confirmada— pero los
    // dos contadores se movieron dentro. Sin ellos habría pasado por quieta.
    expect(await h.store.barrier(ACTOR)).toEqual({
      confirmSeq: 1,
      dispatchSeq: 1,
      uncertain: 0,
    });
    expect((await running).kind).toBe('superseded');
    h.db.close();
  });
});

describe('4 · el servidor escribe, la respuesta del transporte queda RETENIDA', () => {
  it('EL BLOQUEADOR: `confirm_seq` no se mueve, y aun así la base se rechaza', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    const pass = h.worker.runOnce();
    await h.net.next();
    // El servidor escribe. El cliente no se ha enterado de nada.
    api.write(local.clientOperationId, 1230n);

    const before = await h.store.barrier(ACTOR);
    const window = await inQuietWindow(h.ports, fetchAll(api));
    const after = await h.store.barrier(ACTOR);

    // La prueba de que el agujero es exactamente éste: los DOS contadores están
    // quietos durante toda la ventana, y sólo `uncertain` lo ve.
    expect(before.confirmSeq).toBe(0);
    expect(after.confirmSeq).toBe(0);
    expect(before.dispatchSeq).toBe(after.dispatchSeq);
    expect(before.uncertain).toBe(1);
    expect(window.kind).toBe('superseded');
    // Y la respuesta retenida traía ya el efecto.
    expect(window.value.balance).toBe('8770');

    // EL CONTRAFACTUAL: aceptarla habría restado dos veces.
    const wrong = await paint(h.store, asBase(window.value, before.confirmSeq));
    expect(wrong.balance).toBe('7540');
    expect(wrong.balance).not.toBe(api.truth());

    h.net.settle({ kind: 'ok', operationId: 'op-1', alreadyProcessed: false });
    await pass;

    // Resuelta la incertidumbre, el siguiente refresco sí es base y retira.
    const base = await refresh(h, api);
    expect(base).not.toBeNull();
    const painted = await paint(h.store, base!);
    expect(painted.balance).toBe(api.truth());
    expect(painted.operations).toHaveLength(1);
    expect(painted.reconciled).toEqual([local.clientOperationId]);
    h.db.close();
  });
});

describe('5 · caída y reapertura DESPUÉS de escribir en el servidor', () => {
  it('LA MARCA SOBREVIVE AL FICHERO: al reabrir la entrada sigue siendo incierta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomey-barrier-'));
    dirs.push(dir);
    const file = join(dir, 'queue.db');

    const first = await open(file);
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await first.store.enqueue(local);

    // Envío declarado, el servidor escribe… y el proceso muere aquí.
    void first.worker.runOnce();
    await first.net.next();
    api.write(local.clientOperationId, 1230n);
    expect((await first.store.barrier(ACTOR)).uncertain).toBe(1);
    first.db.close();

    // Reapertura.
    const second = await open(file);
    const row = await second.store.byId(ACTOR, local.clientOperationId);
    // El estado se relee como `queued` (ADR-028 §6) y la marca sigue puesta.
    expect(row?.state).toBe('queued');
    expect(row?.dispatchSeq).toBe(1);
    expect(row?.confirmSeq).toBeNull();
    expect((await second.store.barrier(ACTOR)).uncertain).toBe(1);

    // Reparar lo que quedó `sending` tampoco la borra: es lo único que sostiene
    // la incertidumbre.
    await second.store.recoverSending(ACTOR);
    expect((await second.store.barrier(ACTOR)).uncertain).toBe(1);

    // Así que ninguna base nueva se acepta, aunque ya traiga el movimiento.
    const window = await inQuietWindow(second.ports, fetchAll(api));
    expect(window.value.balance).toBe('8770');
    expect(window.kind).toBe('superseded');

    // El reenvío con LA MISMA CLAVE lo resuelve, y no duplica en el servidor.
    const pass = second.worker.runOnce();
    await second.net.next();
    const opId = api.write(second.net.key(), 1230n);
    second.net.settle({ kind: 'ok', operationId: opId, alreadyProcessed: true });
    await pass;
    expect(api.written()).toBe(1);

    const base = await refresh(second, api);
    expect(base).not.toBeNull();
    const painted = await paint(second.store, base!);
    expect(painted.balance).toBe(api.truth());
    expect(painted.operations).toHaveLength(1);
    second.db.close();
  });
});

describe('6 · `markProgress` falla DESPUÉS del 200', () => {
  it('la respuesta se pierde y la entrada sigue incierta, no confirmada', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    // Se rompe la anotación de la confirmación, y sólo ésa.
    let broken = true;
    const real = h.store.markProgress.bind(h.store);
    h.store.markProgress = async (actorId, id, progress) => {
      if (broken && progress.state === 'confirmed') throw new Error('sqlite busy');
      return real(actorId, id, progress);
    };

    const pass = h.worker.runOnce();
    await h.net.next();
    const opId = api.write(local.clientOperationId, 1230n);
    h.net.settle({ kind: 'ok', operationId: opId, alreadyProcessed: false });
    expect((await pass).kind).toBe('infrastructure');

    // La fila no llegó a `confirmed`, pero la marca de envío está puesta.
    const row = await h.store.byId(ACTOR, local.clientOperationId);
    expect(row?.state).toBe('queued');
    expect(row?.dispatchSeq).toBe(1);
    expect(row?.confirmSeq).toBeNull();
    expect((await h.store.barrier(ACTOR)).uncertain).toBe(1);
    expect(await refresh(h, api)).toBeNull();

    // Al sanar, el reenvío con la misma clave la resuelve.
    broken = false;
    const retry = h.worker.runOnce();
    await h.net.next();
    h.net.settle({
      kind: 'ok',
      operationId: api.write(h.net.key(), 1230n),
      alreadyProcessed: true,
    });
    await retry;
    expect(api.written()).toBe(1);

    const base = await refresh(h, api);
    expect(base).not.toBeNull();
    expect((await paint(h.store, base!)).balance).toBe(api.truth());
    h.db.close();
  });
});

describe('7 · reintento con LA MISMA CLAVE', () => {
  it('`already_processed` confirma, y el servidor tiene UNA operación por clave', async () => {
    // Un reloj que se puede mover: tras un fallo transitorio el backoff pone un
    // plazo, y sin avanzarlo el worker —con razón— no reintenta.
    let now = Date.parse('2026-09-03T21:40:00.000Z');
    const h = await open(':memory:', { clock: { now: () => now } });
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    // Primer intento: el servidor escribe, la respuesta se pierde.
    const first = h.worker.runOnce();
    await h.net.next();
    const key = h.net.key();
    api.write(key, 1230n);
    h.net.settle({ kind: 'unreachable', reason: 'timeout' });
    await first;

    const row = await h.store.byId(ACTOR, local.clientOperationId);
    expect(row?.state).toBe('retryable');
    expect(row?.dispatchSeq).toBe(1);
    expect((await h.store.barrier(ACTOR)).uncertain).toBe(1);

    // Segundo intento: misma clave, y por eso el servidor no escribe otra vez.
    now += 60 * 60 * 1000;
    const second = h.worker.runOnce();
    await h.net.next();
    expect(h.net.key()).toBe(key);
    h.net.settle({ kind: 'ok', operationId: api.write(key, 1230n), alreadyProcessed: true });
    await second;

    expect(api.written()).toBe(1);
    expect((await h.store.byId(ACTOR, local.clientOperationId))?.confirmSeq).toBe(1);
    expect((await h.store.barrier(ACTOR)).uncertain).toBe(0);

    const base = await refresh(h, api);
    const painted = await paint(h.store, base!);
    expect(painted.balance).toBe(api.truth());
    expect(painted.operations).toHaveLength(1);
    expect(painted.reconciled).toEqual([local.clientOperationId]);
    h.db.close();
  });
});

describe('8 · respuesta ambigua', () => {
  it('MANTIENE LA INCERTIDUMBRE mientras la entrada siga viva, y no habilita base nueva', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    const good = await refresh(h, api);
    expect(good).not.toBeNull();

    const pass = h.worker.runOnce();
    await h.net.next();
    api.write(local.clientOperationId, 1230n); // pudo ejecutarse: eso es la ambigüedad
    h.net.settle({ kind: 'http', status: 503, code: null });
    await pass;

    expect((await h.store.byId(ACTOR, local.clientOperationId))?.state).toBe('retryable');
    // Ni una base más, por muchos refrescos que se pidan.
    expect(await refresh(h, api)).toBeNull();
    expect(await refresh(h, api)).toBeNull();

    // Y lo que se sigue pintando es la base vieja más lo local: la verdad.
    const painted = await paint(h.store, good!);
    expect(painted.balance).toBe(api.truth());
    expect(painted.operations).toHaveLength(1);
    expect(painted.unreconciled).toBe(1);
    h.db.close();
  });
});

describe('9 · rechazo definitivo y demostrable, sin efectos', () => {
  it('LIBERA LA BARRERA: la proyección se retira entera y vuelve a haber base', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    const pass = h.worker.runOnce();
    await h.net.next();
    h.net.settle({ kind: 'http', status: 400, code: 'PAYLOAD_INVALID' });
    await pass;

    const row = await h.store.byId(ACTOR, local.clientOperationId);
    expect(row?.state).toBe('rejected');
    // La marca sigue en la fila: no se borra nada. Lo que la saca de la cuenta
    // es que un terminal NO se proyecta, así que no puede contarse dos veces.
    expect(row?.dispatchSeq).toBe(1);
    expect((await h.store.barrier(ACTOR)).uncertain).toBe(0);

    const base = await refresh(h, api);
    expect(base).not.toBeNull();
    const painted = await paint(h.store, base!);
    expect(painted.balance).toBe('10000');
    expect(painted.operations).toEqual([]);
    expect(painted.unreconciled).toBe(0);
    h.db.close();
  });
});

describe('10 · dos respuestas remotas FUERA DE ORDEN', () => {
  it('la vieja no puede pisar a la nueva: su ventana no fue quieta', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    // R1 arranca y tardará mucho.
    const slow = gate();
    const r1 = inQuietWindow(h.ports, async () => {
      await slow.waited;
      return { balance: api.balance(), statistics: api.statistics(), operations: api.operations() };
    });

    // Envío completo mientras R1 vuela.
    const pass = h.worker.runOnce();
    await h.net.next();
    const opId = api.write(local.clientOperationId, 1230n);
    h.net.settle({ kind: 'ok', operationId: opId, alreadyProcessed: false });
    await pass;

    // R2 arranca después y contesta enseguida: ventana quieta.
    const r2 = await inQuietWindow(h.ports, fetchAll(api));
    expect(r2).toMatchObject({ kind: 'base', seq: 1 });

    // Y AHORA llega R1.
    slow.open();
    expect((await r1).kind).toBe('superseded');

    if (r2.kind !== 'base') throw new Error('base');
    const painted = await paint(h.store, asBase(r2.value, r2.seq));
    expect(painted.balance).toBe(api.truth());
    expect(painted.operations).toHaveLength(1);
    h.db.close();
  });
});

describe('11 · el saldo y las estadísticas llegan POR SEPARADO', () => {
  it('cada superficie retira con su marca, y no se poda hasta que las dos han retirado', async () => {
    const h = await open();
    const api = server(10_000n);
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    // El bloque del intervalo, quieto y ANTES de nada.
    const interval = await inQuietWindow(h.ports, async () => ({
      statistics: api.statistics(),
      operations: api.operations(),
    }));
    expect(interval).toMatchObject({ kind: 'base', seq: 0 });
    if (interval.kind !== 'base') throw new Error('base');

    // Envío completo.
    const pass = h.worker.runOnce();
    await h.net.next();
    const opId = api.write(local.clientOperationId, 1230n);
    h.net.settle({ kind: 'ok', operationId: opId, alreadyProcessed: false });
    await pass;

    // El saldo, quieto y DESPUÉS.
    const balance = await inQuietWindow(h.ports, async () => api.balance());
    expect(balance).toMatchObject({ kind: 'base', seq: 1 });
    if (balance.kind !== 'base') throw new Error('base');

    const painted = await paint(h.store, {
      balance: { amount: balance.value, seq: balance.seq ?? 0 },
      interval: {
        statistics: interval.value.statistics,
        operations: interval.value.operations,
        total: 0,
        seq: interval.seq ?? 0,
      },
    });

    // El Disponible del servidor ya la trae: no se resta otra vez.
    expect(painted.balance).toBe(api.truth());
    expect(painted.balance).toBe('8770');
    // Los totales vienen de la consulta anterior: la siguen sumando. Una vez.
    expect(painted.statistics?.expense_total).toBe('1230');
    expect(painted.operations).toHaveLength(1);
    expect(painted.operations[0].client_operation_id).toBe(local.clientOperationId);
    // NADA de poda.
    expect(painted.reconciled).toEqual([]);
    expect(painted.unreconciled).toBe(1);
    expect(await h.store.byId(ACTOR, local.clientOperationId)).not.toBeNull();
    h.db.close();
  });
});

describe('12 · cambio de actor y cierre de sesión', () => {
  it('LA BARRERA ES POR CUENTA: la incertidumbre de una no bloquea a la otra', async () => {
    const h = await open();
    const api = server(10_000n);
    const mine = entry({ amount: '1230' });
    const theirs = entry({ amount: '5000', actorId: OTHER });
    await h.store.enqueue(mine);
    await h.store.enqueue(theirs);

    const pass = h.worker.runOnce();
    await h.net.next();

    expect(await h.store.barrier(ACTOR)).toMatchObject({ uncertain: 1, dispatchSeq: 1 });
    // La otra cuenta no ha enviado nada, y su barrera está intacta.
    expect(await h.store.barrier(OTHER)).toEqual({
      confirmSeq: 0,
      dispatchSeq: 0,
      uncertain: 0,
    });

    // Un refresco de la otra cuenta sí puede tener base.
    const theirPorts: QuietWindowPorts = {
      barrier: () => h.store.barrier(OTHER),
      projecting: () => true,
    };
    expect((await inQuietWindow(theirPorts, fetchAll(api))).kind).toBe('base');

    h.net.settle({ kind: 'ok', operationId: 'op-1', alreadyProcessed: false });
    await pass;

    // Y confirmar la mía no ha tocado el contador de la suya.
    expect(await h.store.barrier(OTHER)).toEqual({
      confirmSeq: 0,
      dispatchSeq: 0,
      uncertain: 0,
    });
    // La entrada de la otra cuenta no se ha enviado.
    expect(await h.store.byId(OTHER, theirs.clientOperationId)).toMatchObject({
      state: 'queued',
      dispatchSeq: null,
    });
    h.db.close();
  });

  it('cerrar sesión CONSERVA la entrada y su marca, y no la envía con otra sesión', async () => {
    const h = await open();
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    const pass = h.worker.runOnce();
    await h.net.next();
    h.net.settle({ kind: 'http', status: 401, code: null });
    await pass;

    const row = await h.store.byId(ACTOR, local.clientOperationId);
    expect(row?.state).toBe('blocked_session');
    /*
     * Un 401 demuestra que ESTE intento no escribió, pero no dice nada de un
     * intento anterior, y la marca es de la entrada, no del intento. Se queda:
     * borrarla dejaría pasar una base sobre una entrada que sí pudo escribir.
     */
    expect(row?.dispatchSeq).toBe(1);
    expect((await h.store.barrier(ACTOR)).uncertain).toBe(1);
    h.db.close();
  });
});

describe('13 · la barrera no se puede leer', () => {
  const dead: QuietWindowPorts['barrier'] = async () => null;

  it('CON entradas locales en pantalla, no se acepta ninguna base', async () => {
    const window = await inQuietWindow({ barrier: dead, projecting: () => true }, async () => 'x');
    expect(window).toEqual({ kind: 'superseded', value: 'x' });
  });

  it('SIN nada local que proyectar, una lectura remota válida sí pasa', async () => {
    const window = await inQuietWindow({ barrier: dead, projecting: () => false }, async () => 'x');
    // `seq = null`: no retira nada, que es lo único que no se puede demostrar.
    expect(window).toEqual({ kind: 'base', value: 'x', seq: null });
  });

  it('una barrera que se rompe A MITAD tampoco vale', async () => {
    const readings = [{ confirmSeq: 0, dispatchSeq: 0, uncertain: 0 }, null];
    const window = await inQuietWindow(
      { barrier: async () => readings.shift() ?? null, projecting: () => true },
      async () => 'x',
    );
    expect(window.kind).toBe('superseded');
  });

  it('el fallo es LOCAL: ninguna entrada cambia de estado por él', async () => {
    const h = await open();
    const local = entry({ amount: '1230' });
    await h.store.enqueue(local);

    await inQuietWindow({ barrier: dead, projecting: () => true }, async () => 'lo que sea');

    expect(await h.store.byId(ACTOR, local.clientOperationId)).toMatchObject({
      state: 'queued',
      dispatchSeq: null,
      confirmSeq: null,
    });
    h.db.close();
  });
});

describe('una entrada que nunca se envió', () => {
  it('ES LA ÚNICA PRUEBA POSITIVA DE AUSENCIA, y por eso se proyecta sin dudar', async () => {
    const h = await open();
    const api = server(10_000n);
    await h.store.enqueue(entry({ amount: '1230' }));
    await h.store.enqueue(entry({ kind: 'income', amount: '2000' }));

    // Sin conexión no se intenta nada, así que nada lleva marca.
    expect(await h.store.barrier(ACTOR)).toEqual({
      confirmSeq: 0,
      dispatchSeq: 0,
      uncertain: 0,
    });

    const base = await refresh(h, api);
    expect(base).not.toBeNull();
    const painted = await paint(h.store, base!);
    // 100,00 − 12,30 + 20,00
    expect(painted.balance).toBe('10770');
    expect(painted.operations).toHaveLength(2);
    expect(painted.unreconciled).toBe(2);
    h.db.close();
  });
});
