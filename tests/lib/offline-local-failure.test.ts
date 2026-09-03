import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persistEntry } from '../../src/features/personal/entry-enqueue';
import type { EntryDraft } from '../../src/features/personal/movement-entry';
import { BACKOFF_CEILING_MS } from '../../src/lib/offline/backoff';
import type { InfrastructureFailure } from '../../src/lib/offline/local-failure';
import { migrate } from '../../src/lib/offline/migrations';
import {
  newQueueEntry,
  type QueueEntry,
  type QueueProgress,
} from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { TransportOutcome } from '../../src/lib/offline/response';
import type { Scheduler } from '../../src/lib/offline/retry-scheduler';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';
import { createSyncCoordinator } from '../../src/lib/offline/sync-coordinator';
import type { Connectivity, SessionPort } from '../../src/lib/offline/worker-ports';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * CUANDO LO QUE FALLA ES SQLITE, Y NO EL SERVIDOR.
 *
 * Un fallo de la base es infraestructura del cliente: no es una respuesta, no
 * pasa por la clasificación de ADR-028 §11, y por tanto **no puede** mover una
 * entrada a `rejected`, `review` o `conflict`, ni borrarla, ni crearle otra
 * clave, ni abrir la puerta directa para «salvar» el gasto. Lo que hace es
 * interrumpir la pasada, dejar las filas como estaban, y volver a intentar la
 * base con el mismo backoff y **el mismo temporizador** que la cola.
 *
 * Aquí se rompe el store en cada uno de los puntos donde el worker o el
 * planificador lo tocan, y se afirma lo que quedó en disco y para cuándo quedó
 * puesto el reintento. Y se vigila que **ninguna promesa quede rechazada sin
 * manejar**: `wake()` es fire-and-forget, y una excepción ahí sería exactamente
 * eso.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

const T0 = Date.parse('2026-09-03T21:00:00.000Z');

let seq = 0;
function expense(actorId: string, createdAt = new Date(T0).toISOString()): QueueEntry {
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
    createdAt,
  });
}

const OK = (id: string, already = false): TransportOutcome => ({
  kind: 'ok',
  operationId: id,
  alreadyProcessed: already,
});

/** Lo que lanza el módulo nativo cuando la base no puede: nombre y código, y un mensaje que NO debe salir. */
function sqliteBusy(): Error {
  return Object.assign(new Error('database is locked: insert into queue_entry …'), {
    name: 'SQLiteError',
    code: 'SQLITE_BUSY',
  });
}

/** Vacía la cola de microtareas: el `pump` es asíncrono y no se espera. */
async function settle(rounds = 400) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/** Deja pasar UNA vuelta del bucle de eventos, que es cuando Node emite `unhandledRejection`. */
const macrotask = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

type Method = 'pending' | 'markProgress' | 'enqueue';
type Call = { readonly n: number; readonly progress?: Partial<QueueProgress> };

/**
 * El store real, con una avería programable delante de cada método.
 *
 * La avería se decide POR LLAMADA —número de orden y, en `markProgress`, qué
 * progreso se estaba escribiendo—, así que cada prueba rompe exactamente la
 * operación que quiere y ninguna otra. `heal()` la quita.
 */
function faultyStore(real: QueueStore) {
  const rules: { method: Method; when: (call: Call) => boolean }[] = [];
  const calls: Record<Method, number> = { pending: 0, markProgress: 0, enqueue: 0 };

  function guard(method: Method, call: Call) {
    calls[method] += 1;
    const hit = rules.some(
      (rule) => rule.method === method && rule.when({ ...call, n: calls[method] }),
    );
    if (hit) throw sqliteBusy();
  }

  const store: QueueStore = {
    ...real,
    async pending(actorId) {
      guard('pending', { n: 0 });
      return real.pending(actorId);
    },
    async markProgress(actorId, id, progress) {
      guard('markProgress', { n: 0, progress });
      return real.markProgress(actorId, id, progress);
    },
    async enqueue(entry) {
      guard('enqueue', { n: 0 });
      return real.enqueue(entry);
    },
  };

  return {
    store,
    calls,
    fail(method: Method, when: (call: Call) => boolean = () => true) {
      rules.push({ method, when });
    },
    heal() {
      rules.length = 0;
    },
  };
}

function fakeClockAndScheduler() {
  let now = T0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;

  const scheduler: Scheduler = {
    set(fn, ms) {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clear(handle) {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
  };

  return {
    scheduler,
    clock: { now: () => now },
    get pending() {
      return timers.length;
    },
    async advanceTo(ms: number) {
      now = ms;
      for (const timer of timers.filter((candidate) => candidate.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
      await settle();
    },
  };
}

type Harness = Awaited<ReturnType<typeof setup>>;

async function setup(script: (n: number) => TransportOutcome = (n) => OK(`op-${n}`), random = 0) {
  const db: TestDatabase = openTestDatabase();
  await migrate(db);
  const real: QueueStore = createSqliteQueueStore(db as SqlDatabase);
  const faults = faultyStore(real);
  const env = fakeClockAndScheduler();

  const state = {
    actor: ACTOR_A as string | null,
    session: 'signed-in' as ReturnType<SessionPort['status']>,
    connected: true,
  };

  const seen: string[] = [];
  const observed: { failure: InfrastructureFailure; consecutive: number }[] = [];
  let calls = 0;

  const connectivity: Connectivity = {
    isConnected: () => state.connected,
    subscribe: () => () => undefined,
  };
  const session: SessionPort = {
    status: () => state.session,
    actorId: () => state.actor,
    subscribe: () => () => undefined,
  };

  const coordinator = createSyncCoordinator({
    store: faults.store,
    transport: {
      async send(_type, payload) {
        seen.push(String(payload.client_operation_id));
        const outcome = script(calls);
        calls += 1;
        return outcome;
      },
    },
    clock: env.clock,
    random: () => random,
    connectivity,
    session,
    scheduler: env.scheduler,
    timeoutMs: 5_000,
    onLocalFailure: (failure, consecutive) => {
      observed.push({ failure, consecutive });
    },
  });

  return {
    db,
    real,
    faults,
    env,
    state,
    seen,
    observed,
    coordinator,
    get calls() {
      return calls;
    },
  };
}

/** El estado TAL CUAL está en disco, sin la relectura de §6 que hace el store. */
async function enDisco(t: Harness, clientOperationId: string): Promise<string | null> {
  const row = await t.db.getFirstAsync<{ state: string }>(
    'select state from queue_entry where actor_id = ? and client_operation_id = ?',
    [ACTOR_A, clientOperationId],
  );
  return row?.state ?? null;
}

/** Ninguna entrada cambió a un estado que sólo el servidor puede demostrar. */
async function expectNoTerminal(t: Harness, actor = ACTOR_A) {
  for (const row of await t.real.all(actor)) {
    expect(['queued', 'sending', 'retryable', 'blocked_session', 'confirmed']).toContain(row.state);
  }
}

const cerrar = (t: Harness) => {
  t.coordinator.stop();
  t.db.close();
};

// -------------------------------------------------- ningún rechazo sin manejar
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  // `setImmediate` se deja real: es lo que deja a Node emitir `unhandledRejection`.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  await macrotask();
  process.off('unhandledRejection', onUnhandled);
  vi.useRealTimers();
  expect(unhandled).toEqual([]);
});

describe('1 · la LECTURA inicial falla', () => {
  it('la pasada se interrumpe, la fila no cambia, y la base se reintenta sola', async () => {
    const t = await setup();
    const entry = expense(ACTOR_A);
    await t.real.enqueue(entry);
    t.faults.fail('pending');

    t.coordinator.wake();
    await settle();
    await macrotask();

    // Nada salió y nada cambió de estado.
    expect(t.calls).toBe(0);
    expect((await t.real.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('queued');
    await expectNoTerminal(t);

    // Observable y tipado, sin contenido.
    expect(t.coordinator.localStatus()).toMatchObject({
      kind: 'unavailable',
      failures: 1,
      retryAt: T0 + 1_000,
    });
    expect(t.observed).toHaveLength(1);
    expect(t.observed[0].failure).toEqual({
      stage: 'read',
      clientOperationId: null,
      afterSend: false,
      errorName: 'SQLiteError',
      errorCode: 'SQLITE_BUSY',
    });

    // El reintento de la BASE va por el mismo y único temporizador.
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    expect(t.env.pending).toBe(1);
    expect(t.coordinator.worker.isRunning()).toBe(false);

    // La base vuelve: el plazo vence, la pasada sale y el contador se reinicia.
    t.faults.heal();
    await t.env.advanceTo(T0 + 1_000);

    expect(t.seen).toEqual([entry.clientOperationId]);
    expect((await t.real.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('confirmed');
    expect(t.coordinator.localStatus()).toEqual({ kind: 'available' });
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    cerrar(t);
  });
});

describe('2 · la transición a `sending` falla', () => {
  it('NADA sale: la fila sigue `queued`, y sale en el reintento con su clave', async () => {
    const t = await setup();
    const entry = expense(ACTOR_A);
    await t.real.enqueue(entry);
    t.faults.fail('markProgress', ({ progress }) => progress?.state === 'sending');

    t.coordinator.wake();
    await settle();

    expect(t.calls).toBe(0);
    const fila = await t.real.byId(ACTOR_A, entry.clientOperationId);
    expect(fila?.state).toBe('queued');
    expect(fila?.attempts).toBe(0);
    expect(t.observed[0].failure).toMatchObject({
      stage: 'markSending',
      clientOperationId: entry.clientOperationId,
      afterSend: false,
    });
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);

    t.faults.heal();
    await t.env.advanceTo(T0 + 1_000);

    expect(t.seen).toEqual([entry.clientOperationId]);
    expect((await t.real.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('confirmed');
    expect(await t.real.all(ACTOR_A)).toHaveLength(1);
    cerrar(t);
  });
});

describe('3 · EL SERVIDOR ESCRIBIÓ Y SQLITE FALLÓ DESPUÉS', () => {
  it('la fila queda `sending` con su misma clave, y el reintento recibe `already_processed`', async () => {
    // El servidor escribe a la primera; la segunda vez contesta que ya lo tenía.
    const t = await setup((n) => (n === 0 ? OK('op-1') : OK('op-1', true)));
    const entry = expense(ACTOR_A);
    await t.real.enqueue(entry);
    // Falla la anotación de la CONFIRMACIÓN, no la de `sending`.
    t.faults.fail('markProgress', ({ progress }) => progress?.state === 'confirmed');

    t.coordinator.wake();
    await settle();

    // La petición salió UNA vez y el servidor la ejecutó…
    expect(t.calls).toBe(1);
    // …y la respuesta no pudo guardarse: EN DISCO la fila queda `sending`, con
    // su clave, y el store la relee como `queued` (ADR-028 §6), que es lo que
    // hace que la siguiente pasada la reenvíe sin reparación aparte.
    expect(await enDisco(t, entry.clientOperationId)).toBe('sending');
    const enVuelo = await t.real.byId(ACTOR_A, entry.clientOperationId);
    expect(enVuelo?.state).toBe('queued');
    expect(enVuelo?.clientOperationId).toBe(entry.clientOperationId);
    expect(enVuelo?.payload).toEqual(entry.payload);
    expect(enVuelo?.resultOperationId).toBeNull();
    await expectNoTerminal(t);

    expect(t.observed[0].failure).toMatchObject({
      stage: 'record',
      clientOperationId: entry.clientOperationId,
      afterSend: true,
    });
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);

    // La base vuelve. La `sending` se relee como `queued` (ADR-028 §6) y se
    // reenvía CON LA MISMA CLAVE: el servidor dice que ya lo tenía.
    t.faults.heal();
    await t.env.advanceTo(T0 + 1_000);

    expect(t.seen).toEqual([entry.clientOperationId, entry.clientOperationId]);
    expect(new Set(t.seen).size).toBe(1);
    const final = await t.real.byId(ACTOR_A, entry.clientOperationId);
    expect(final?.state).toBe('confirmed');
    expect(final?.resultOperationId).toBe('op-1');
    // Una sola entrada: ni perdida ni duplicada.
    expect(await t.real.all(ACTOR_A)).toHaveLength(1);
    expect(t.coordinator.localStatus()).toEqual({ kind: 'available' });
    cerrar(t);
  });

  it('si también falla la anotación de un transitorio, la fila sigue `sending` y no se inventa nada', async () => {
    const t = await setup((n) =>
      n === 0 ? { kind: 'http', status: 503, code: null } : OK('op-2'),
    );
    const entry = expense(ACTOR_A);
    await t.real.enqueue(entry);
    t.faults.fail('markProgress', ({ progress }) => progress?.state === 'retryable');

    t.coordinator.wake();
    await settle();

    expect(await enDisco(t, entry.clientOperationId)).toBe('sending');
    const fila = await t.real.byId(ACTOR_A, entry.clientOperationId);
    expect(fila?.attempts).toBe(0); // la anotación no llegó; no se cuenta a medias
    expect(fila?.nextAttemptAt).toBeNull();
    expect(t.observed[0].failure.stage).toBe('record');

    t.faults.heal();
    await t.env.advanceTo(T0 + 1_000);

    expect(t.seen).toEqual([entry.clientOperationId, entry.clientOperationId]);
    expect((await t.real.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('confirmed');
    cerrar(t);
  });
});

describe('4 · la PROGRAMACIÓN del siguiente reintento falla', () => {
  it('la pasada fue buena, la lectura del planificador no: se cuenta y se arma igual', async () => {
    const t = await setup();
    const entry = expense(ACTOR_A);
    await t.real.enqueue(entry);
    // Lecturas: 1ª del worker (envía) · 2ª del worker (vacía) · 3ª DEL PLANIFICADOR.
    t.faults.fail('pending', ({ n }) => n === 3);

    t.coordinator.wake();
    await settle();

    // La pasada terminó bien: confirmada.
    expect((await t.real.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('confirmed');
    // Y el fallo del planificador se contó como local, con su etapa.
    expect(t.observed).toHaveLength(1);
    expect(t.observed[0].failure).toMatchObject({ stage: 'schedule', clientOperationId: null });
    expect(t.coordinator.localStatus()).toMatchObject({ kind: 'unavailable', failures: 1 });
    // Armado SIN leer otra vez —es lo que acaba de fallar— y un solo temporizador.
    expect(t.faults.calls.pending).toBe(3);
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    expect(t.env.pending).toBe(1);

    t.faults.heal();
    await t.env.advanceTo(T0 + 1_000);

    expect(t.coordinator.localStatus()).toEqual({ kind: 'available' });
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.calls).toBe(1);
    cerrar(t);
  });
});

describe('5 · el ENCOLADO inicial falla', () => {
  const draft: EntryDraft = {
    kind: 'expense',
    amount: '12,30',
    concept: 'Cena',
    categoryId: CATEGORY,
    date: '2026-09-03' as EntryDraft['date'],
    time: '21:40',
  };
  const scope = {
    scopeId: SCOPE,
    currencyDefinitionId: CURRENCY,
    currencyCode: 'EUR',
    currencyScale: 2,
  };
  const KEY = '99999999-9999-4999-8999-999999999999';

  it('devuelve fallo, no deja fila, y no envía nada por ningún lado', async () => {
    const t = await setup();
    t.faults.fail('enqueue');

    const result = await persistEntry(t.faults.store, {
      actorId: ACTOR_A,
      draft,
      scope,
      key: KEY,
      createdAt: new Date(T0).toISOString(),
    });

    expect(result).toEqual({ ok: false, reason: 'storeUnavailable' });
    // Nada en disco: la hoja no podrá cerrarse, porque no hay nada demostrado.
    expect(await t.real.all(ACTOR_A)).toEqual([]);
    // Y nada salió: ni por la cola ni por la puerta directa.
    expect(t.calls).toBe(0);
    cerrar(t);
  });

  it('con la base sana, la misma llamada deja clave y payload en disco', async () => {
    const t = await setup();

    const result = await persistEntry(t.faults.store, {
      actorId: ACTOR_A,
      draft,
      scope,
      key: KEY,
      createdAt: new Date(T0).toISOString(),
    });

    expect(result).toEqual({ ok: true, clientOperationId: KEY });
    const fila = await t.real.byId(ACTOR_A, KEY);
    expect(fila?.state).toBe('queued');
    expect(fila?.payload).toMatchObject({
      client_operation_id: KEY,
      amount: '1230',
      concept: 'Cena',
    });
    cerrar(t);
  });

  it('un borrador inválido se distingue de una base rota', async () => {
    const t = await setup();
    const result = await persistEntry(t.faults.store, {
      actorId: ACTOR_A,
      draft: { ...draft, amount: '' },
      scope,
      key: KEY,
      createdAt: new Date(T0).toISOString(),
    });
    expect(result).toEqual({ ok: false, reason: 'invalidDraft' });
    expect(await t.real.all(ACTOR_A)).toEqual([]);
    cerrar(t);
  });
});

describe('el reintento de la infraestructura', () => {
  it('LOS RETRASOS CRECEN Y RESPETAN EL TECHO, y una base rota no genera un bucle inmediato', async () => {
    // `random ~ 1` da el techo de cada intento, que es la serie del ADR.
    const t = await setup(() => OK('op'), 0.999999);
    await t.real.enqueue(expense(ACTOR_A));
    t.faults.fail('pending');

    t.coordinator.wake();
    await settle();

    const esperados = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000];
    let reloj = T0;
    let lecturas = t.faults.calls.pending;

    for (const [index, delta] of esperados.entries()) {
      expect(t.coordinator.localStatus()).toMatchObject({
        kind: 'unavailable',
        failures: index + 1,
      });
      expect(t.coordinator.armedAt()).toBe(reloj + delta);
      // UN temporizador, y ninguno de los reales.
      expect(t.env.pending).toBe(1);
      expect(vi.getTimerCount()).toBe(0);

      reloj += delta;
      await t.env.advanceTo(reloj);

      // Un intento por plazo: una lectura del worker y una del planificador. Nada más.
      expect(t.faults.calls.pending - lecturas).toBe(2);
      lecturas = t.faults.calls.pending;
    }

    // Y a partir de aquí, el tope: 2^9 s ya lo supera.
    expect(t.coordinator.armedAt()).toBe(reloj + BACKOFF_CEILING_MS);
    reloj += BACKOFF_CEILING_MS;
    await t.env.advanceTo(reloj);
    expect(t.coordinator.armedAt()).toBe(reloj + BACKOFF_CEILING_MS);

    // En todo ese tiempo, ninguna petición y ninguna fila tocada.
    expect(t.calls).toBe(0);
    await expectNoTerminal(t);
    expect((await t.real.all(ACTOR_A))[0].state).toBe('queued');
    cerrar(t);
  });

  it('UNA PASADA CORRECTA REINICIA EL CONTADOR', async () => {
    const t = await setup(() => OK('op'), 0.999999);
    await t.real.enqueue(expense(ACTOR_A));
    t.faults.fail('pending');

    t.coordinator.wake();
    await settle();
    await t.env.advanceTo(T0 + 1_000);
    await t.env.advanceTo(T0 + 3_000);
    expect(t.coordinator.localStatus()).toMatchObject({ failures: 3 });

    // La base vuelve en el siguiente plazo.
    t.faults.heal();
    await t.env.advanceTo(T0 + 7_000);
    expect(t.coordinator.localStatus()).toEqual({ kind: 'available' });
    expect(t.calls).toBe(1);

    // Y si vuelve a romperse, la cuenta empieza otra vez desde el suelo.
    await t.real.enqueue(expense(ACTOR_A, new Date(T0 + 8_000).toISOString()));
    t.faults.fail('pending');
    t.coordinator.wake();
    await settle();
    expect(t.coordinator.localStatus()).toMatchObject({ failures: 1 });
    expect(t.coordinator.armedAt()).toBe(T0 + 7_000 + 1_000);
    cerrar(t);
  });

  it('lo que se observa NO lleva payload, importe, concepto ni mensaje', async () => {
    const t = await setup();
    await t.real.enqueue(expense(ACTOR_A));
    t.faults.fail('markProgress', ({ progress }) => progress?.state === 'sending');

    t.coordinator.wake();
    await settle();

    const { failure } = t.observed[0];
    expect(Object.keys(failure).sort()).toEqual(
      ['afterSend', 'clientOperationId', 'errorCode', 'errorName', 'stage'].sort(),
    );
    const texto = JSON.stringify([failure, t.coordinator.localStatus()]);
    expect(texto).not.toContain('1230');
    expect(texto).not.toContain('Cena');
    expect(texto).not.toContain('database is locked');
    expect(texto).not.toContain('insert into');
    cerrar(t);
  });

  it('un observador que lanza no convierte el fallo en un rechazo sin manejar', async () => {
    const db: TestDatabase = openTestDatabase();
    await migrate(db);
    const faults = faultyStore(createSqliteQueueStore(db as SqlDatabase));
    const env = fakeClockAndScheduler();
    const coordinator = createSyncCoordinator({
      store: faults.store,
      transport: { send: async () => OK('op') },
      clock: env.clock,
      random: () => 0,
      connectivity: { isConnected: () => true, subscribe: () => () => undefined },
      session: {
        status: () => 'signed-in',
        actorId: () => ACTOR_A,
        subscribe: () => () => undefined,
      },
      scheduler: env.scheduler,
      onLocalFailure: () => {
        throw new Error('observador roto');
      },
    });
    faults.fail('pending');

    coordinator.wake();
    await settle();
    await macrotask();

    expect(coordinator.localStatus()).toMatchObject({ kind: 'unavailable', failures: 1 });
    expect(coordinator.armedAt()).toBe(T0 + 1_000);
    coordinator.stop();
    db.close();
  });
});

describe('lo que cancela el reintento local', () => {
  async function conBaseRota() {
    const t = await setup(() => OK('op'), 0.999999);
    await t.real.enqueue(expense(ACTOR_A));
    t.faults.fail('pending');
    t.coordinator.wake();
    await settle();
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    return t;
  }

  it('`stop()`: desarma, no resucita, conserva la fila y no olvida cuántos fallos llevaba', async () => {
    const t = await conBaseRota();

    t.coordinator.stop();

    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    expect(t.coordinator.localStatus()).toMatchObject({
      kind: 'unavailable',
      failures: 1,
      retryAt: null,
    });

    // Nada se despierta solo mientras está parado.
    const lecturas = t.faults.calls.pending;
    await t.env.advanceTo(T0 + 3_600_000);
    expect(t.faults.calls.pending).toBe(lecturas);
    expect((await t.real.all(ACTOR_A))[0].state).toBe('queued');

    // Al reanudar sobre la misma base rota, el backoff sigue desde donde iba: 2 s, no 1 s.
    t.coordinator.wake();
    await settle();
    expect(t.coordinator.localStatus()).toMatchObject({ failures: 2 });
    expect(t.coordinator.armedAt()).toBe(T0 + 3_600_000 + 2_000);
    cerrar(t);
  });

  it('cambio de actor: el reintento era del anterior y se cancela; sus filas quedan intactas', async () => {
    const t = await conBaseRota();
    const deA = (await t.real.all(ACTOR_A))[0];

    // La base vuelve justo cuando entra otra cuenta.
    t.faults.heal();
    t.state.actor = ACTOR_B;
    await t.coordinator.reschedule();

    expect(t.coordinator.localStatus()).toEqual({ kind: 'available' });
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    expect((await t.real.byId(ACTOR_A, deA.clientOperationId))?.state).toBe('queued');
    expect(await t.real.all(ACTOR_B)).toEqual([]);

    // Y si la base vuelve a romperse bajo B, la cuenta es de B y empieza en uno.
    t.faults.fail('pending');
    t.coordinator.wake();
    await settle();
    expect(t.coordinator.localStatus()).toMatchObject({ kind: 'unavailable', failures: 1 });
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    cerrar(t);
  });

  it('con la base aún rota, otra cuenta hereda la avería pero no la cuenta de la anterior', async () => {
    const t = await conBaseRota();

    t.state.actor = ACTOR_B;
    await t.coordinator.reschedule();

    // La lectura bajo B falló también: es un fallo nuevo, de B, y el primero.
    expect(t.coordinator.localStatus()).toMatchObject({ kind: 'unavailable', failures: 1 });
    expect(t.observed.at(-1)?.failure.stage).toBe('schedule');
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    expect(t.env.pending).toBe(1);
    cerrar(t);
  });

  it('cierre de sesión: se cancela, y nada queda armado', async () => {
    const t = await conBaseRota();

    t.state.session = 'signed-out';
    t.state.actor = null;
    await t.coordinator.reschedule();

    expect(t.coordinator.localStatus()).toEqual({ kind: 'available' });
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    expect(await t.real.all(ACTOR_A)).toHaveLength(1);
    cerrar(t);
  });

  it('un disparador externo con el MISMO actor conserva el reintento local', async () => {
    const t = await conBaseRota();

    // Reconexión o primer plano: reprograma, pero el plazo de la base sigue.
    await t.coordinator.reschedule();

    expect(t.coordinator.localStatus()).toMatchObject({ kind: 'unavailable', failures: 1 });
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    expect(t.env.pending).toBe(1);
    cerrar(t);
  });

  it('un `wake()` retenido durante una pasada que falló no repite en caliente', async () => {
    const t = await setup();
    await t.real.enqueue(expense(ACTOR_A));
    let retenido = false;
    // La lectura falla, y durante esa misma lectura alguien despierta al worker.
    t.faults.fail('pending', () => {
      if (!retenido) {
        retenido = true;
        t.coordinator.wake();
      }
      return true;
    });

    t.coordinator.wake();
    await settle();

    // Una sola lectura del worker (más ninguna del planificador, que también falló).
    expect(t.faults.calls.pending).toBe(2);
    expect(t.coordinator.worker.hasRetainedWake()).toBe(false);
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    cerrar(t);
  });
});
