import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { TransportOutcome } from '../../src/lib/offline/response';
import type { Scheduler } from '../../src/lib/offline/retry-scheduler';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';
import { createSyncCoordinator } from '../../src/lib/offline/sync-coordinator';
import type { Connectivity, SessionPort } from '../../src/lib/offline/worker-ports';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * EL `wake()` QUE SE PERDÍA, forzado en su ventana exacta.
 *
 * La carrera, paso a paso:
 *
 *   1  el worker está dentro de `pump()`, con `running = true`;
 *   2  hace su ÚLTIMA lectura de filas enviables, y no hay ninguna;
 *   3  antes de que suelte `running`, alguien encola otra entrada `queued`;
 *   4  `enqueue` llama a `wake()`;
 *   5  `wake()` ve `running = true` y no arranca otra pasada;
 *   6  después no llega ningún otro disparador;
 *   7  la entrada nueva tiene que salir igualmente.
 *
 * Sin retener el aviso, esa entrada quedaba `queued` sin `next_attempt_at`, que
 * es exactamente lo que el planificador NO programa: esperaba a la vuelta a
 * primer plano o a una reconexión que pueden no llegar en horas.
 *
 * **Cómo se fuerza la ventana, sin aproximaciones temporales.** El store que ve
 * el worker es el real envuelto: su `pending()` hace la lectura de verdad y,
 * antes de devolverla, ejecuta un gancho. Ese gancho corre con el `SELECT` ya
 * hecho y `running` todavía en `true` — es la ventana, y no un `setTimeout`
 * que a veces cae dentro. El worker hace UNA lectura por pasada a propósito,
 * para que «la última» sea una fila concreta.
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

const UNAVAILABLE_503: TransportOutcome = { kind: 'http', status: 503, code: null };
const OK = (id: string): TransportOutcome => ({
  kind: 'ok',
  operationId: id,
  alreadyProcessed: false,
});

const sendable = (rows: readonly QueueEntry[]) =>
  rows.filter((row) => row.state === 'queued' || row.state === 'retryable');

/** Vacía la cola de microtareas: el `pump` es asíncrono y no se espera. */
async function settle(rounds = 400) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

type Hook = (rows: readonly QueueEntry[]) => Promise<void> | void;

/**
 * El store real, con un gancho DETRÁS de cada lectura.
 *
 * La lectura ocurre; el gancho corre con el resultado en la mano y antes de que
 * el worker lo vea. Es la ventana entre «ya leí» y «ya terminé», y el gancho la
 * ocupa con lo que cada prueba necesite: encolar, despertar, cambiar de cuenta,
 * cerrar sesión, parar.
 */
function withReadHook(real: QueueStore) {
  let hook: Hook | null = null;
  let reads = 0;
  let isWorkerRead: () => boolean = () => true;

  const store: QueueStore = {
    ...real,
    async pending(actorId) {
      const rows = await real.pending(actorId);
      /*
       * Sólo las lecturas de la PASADA. El planificador lee por este mismo
       * store al cerrar el ciclo, con `running` ya en `false`; contarla aquí
       * mezclaría las dos mitades y el «cuatro lecturas exactas» dejaría de
       * decir lo que dice.
       */
      if (isWorkerRead()) reads += 1;
      if (hook !== null) await hook(rows);
      return rows;
    },
  };

  return {
    store,
    /** Lecturas hechas con la pasada en vuelo. */
    get reads() {
      return reads;
    },
    attribute(predicate: () => boolean) {
      isWorkerRead = predicate;
    },
    /** Se ejecuta UNA vez, en la primera lectura que cumpla la condición. */
    once(when: (rows: readonly QueueEntry[]) => boolean, run: Hook) {
      hook = async (rows) => {
        if (!when(rows)) return;
        hook = null;
        await run(rows);
      };
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

async function setup(script: (n: number) => TransportOutcome = (n) => OK(`op-${n}`)) {
  const db: TestDatabase = openTestDatabase();
  await migrate(db);
  const real: QueueStore = createSqliteQueueStore(db as SqlDatabase);
  const reads = withReadHook(real);
  const env = fakeClockAndScheduler();

  const state = {
    actor: ACTOR_A as string | null,
    session: 'signed-in' as ReturnType<SessionPort['status']>,
    connected: true,
  };

  const seen: string[] = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let subscriptions = 0;

  const connectivity: Connectivity = {
    isConnected: () => state.connected,
    subscribe: () => {
      subscriptions += 1;
      return () => undefined;
    },
  };
  const session: SessionPort = {
    status: () => state.session,
    actorId: () => state.actor,
    subscribe: () => {
      subscriptions += 1;
      return () => undefined;
    },
  };

  const coordinator = createSyncCoordinator({
    store: reads.store,
    transport: {
      async send(_type, payload) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Un envío real tarda: sin esto, la concurrencia máxima sería 1 por
        // construcción y la afirmación no diría nada.
        await settle(3);
        seen.push(String(payload.client_operation_id));
        const outcome = script(calls);
        calls += 1;
        inFlight -= 1;
        return outcome;
      },
    },
    clock: env.clock,
    random: () => 0,
    connectivity,
    session,
    scheduler: env.scheduler,
    timeoutMs: 5_000,
  });
  reads.attribute(() => coordinator.worker.isRunning());

  return {
    db,
    real,
    reads,
    env,
    state,
    seen,
    coordinator,
    get calls() {
      return calls;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    get subscriptions() {
      return subscriptions;
    },
  };
}

/** Lo que tiene que quedar cuando la cola se vacía: NADA. */
function expectNothingLeft(t: Harness) {
  expect(t.coordinator.worker.isRunning()).toBe(false);
  expect(t.coordinator.worker.hasRetainedWake()).toBe(false);
  expect(t.coordinator.armedAt()).toBeNull();
  expect(t.env.pending).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
}

const cerrar = (t: Harness) => {
  t.coordinator.stop();
  t.db.close();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('la ventana entre la última lectura y el `finally`', () => {
  it('UNA ENTRADA ENCOLADA AHÍ SALE SIN NINGÚN OTRO DISPARADOR', async () => {
    const t = await setup();
    const primera = expense(ACTOR_A);
    await t.real.enqueue(primera);

    const segunda = expense(ACTOR_A, new Date(T0 + 1).toISOString());
    let ventana: { running: boolean; retenido: boolean; enviadas: number } | null = null;

    // El gancho ocupa la última lectura: la que no encuentra nada enviable.
    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        await t.real.enqueue(segunda);
        t.coordinator.wake(); // paso 4 · y `running` sigue en `true`
        ventana = {
          running: t.coordinator.worker.isRunning(),
          retenido: t.coordinator.worker.hasRetainedWake(),
          enviadas: t.seen.length,
        };
      },
    );

    t.coordinator.wake();
    await settle();

    // Se comprobó DENTRO de la ventana: pasada en vuelo, aviso retenido, y la
    // segunda todavía sin enviar.
    expect(ventana).toEqual({ running: true, retenido: true, enviadas: 1 });

    // Y salió sola: sin reconexión, sin primer plano, sin plazo, sin otro wake.
    expect(t.seen).toEqual([primera.clientOperationId, segunda.clientOperationId]);
    const fila = await t.real.byId(ACTOR_A, segunda.clientOperationId);
    expect(fila?.state).toBe('confirmed');
    // Misma clave y mismo payload que se encolaron: nada se reconstruyó.
    expect(fila?.clientOperationId).toBe(segunda.clientOperationId);
    expect(fila?.payload).toEqual(segunda.payload);

    // Cuatro lecturas exactas: primera · vacía (la ventana) · segunda · vacía.
    expect(t.reads.reads).toBe(4);
    expectNothingLeft(t);
    cerrar(t);
  });

  it('DIEZ `wake()` EN LA VENTANA SON UNA SOLA REPETICIÓN', async () => {
    const t = await setup();
    await t.real.enqueue(expense(ACTOR_A));
    const segunda = expense(ACTOR_A, new Date(T0 + 1).toISOString());

    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        await t.real.enqueue(segunda);
        for (let i = 0; i < 10; i += 1) t.coordinator.wake();
        expect(t.coordinator.worker.hasRetainedWake()).toBe(true);
      },
    );

    t.coordinator.wake();
    await settle();

    // Las mismas cuatro lecturas que con un solo `wake()`: se fundieron.
    expect(t.reads.reads).toBe(4);
    expect(t.calls).toBe(2);
    expect(t.maxInFlight).toBe(1);
    expectNothingLeft(t);
    cerrar(t);
  });

  it('con varias encoladas en la ventana, siguen saliendo de una en una y en orden', async () => {
    const t = await setup();
    const antes = [expense(ACTOR_A), expense(ACTOR_A, new Date(T0 + 1).toISOString())];
    for (const entry of antes) await t.real.enqueue(entry);

    const durante = [2, 3, 4].map((i) => expense(ACTOR_A, new Date(T0 + i).toISOString()));

    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        for (const entry of durante) {
          await t.real.enqueue(entry);
          t.coordinator.wake(); // como haría cada `enqueue` real
        }
      },
    );

    t.coordinator.wake();
    await settle();

    expect(t.maxInFlight).toBe(1);
    expect(t.seen).toEqual([...antes, ...durante].map((entry) => entry.clientOperationId));
    expect(new Set(t.seen).size).toBe(5);
    expectNothingLeft(t);
    cerrar(t);
  });

  it('un transitorio en la repetición conserva la clave y programa su plazo', async () => {
    // La segunda falla con 503 la primera vez y confirma en su reintento.
    const t = await setup((n) => (n === 1 ? UNAVAILABLE_503 : OK(`op-${n}`)));
    await t.real.enqueue(expense(ACTOR_A));
    const segunda = expense(ACTOR_A, new Date(T0 + 1).toISOString());

    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        await t.real.enqueue(segunda);
        t.coordinator.wake();
      },
    );

    t.coordinator.wake();
    await settle();

    // El ciclo se cerró con lo que dejó la REPETICIÓN, no la pasada original.
    expect((await t.real.byId(ACTOR_A, segunda.clientOperationId))?.state).toBe('retryable');
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);

    await t.env.advanceTo(T0 + 1_000);

    expect(t.seen.filter((key) => key === segunda.clientOperationId)).toHaveLength(2);
    expect((await t.real.byId(ACTOR_A, segunda.clientOperationId))?.state).toBe('confirmed');
    expectNothingLeft(t);
    cerrar(t);
  });
});

describe('la repetición vuelve a preguntar quién está dentro', () => {
  it('CAMBIO DE ACTOR antes de repetir: la fila de A no sale bajo B', async () => {
    const t = await setup();
    const primera = expense(ACTOR_A);
    await t.real.enqueue(primera);
    const deA = expense(ACTOR_A, new Date(T0 + 1).toISOString());

    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        await t.real.enqueue(deA);
        t.coordinator.wake();
        t.state.actor = ACTOR_B; // entra otra cuenta antes de la repetición
      },
    );

    t.coordinator.wake();
    await settle();

    // La repetición ocurrió —hubo una lectura más— pero bajo B, y B no ve a A.
    expect(t.reads.reads).toBe(3);
    expect(t.seen).toEqual([primera.clientOperationId]);
    const intacta = await t.real.byId(ACTOR_A, deA.clientOperationId);
    expect(intacta?.state).toBe('queued');
    expect(intacta?.attempts).toBe(0);
    expectNothingLeft(t);

    // Y cuando A vuelve, su entrada sale con su misma clave.
    t.state.actor = ACTOR_A;
    t.coordinator.wake();
    await settle();
    expect(t.seen).toEqual([primera.clientOperationId, deA.clientOperationId]);
    cerrar(t);
  });

  it('CIERRE DE SESIÓN antes de repetir: nada sale, nada se pierde, nada queda armado', async () => {
    const t = await setup();
    const primera = expense(ACTOR_A);
    await t.real.enqueue(primera);
    const segunda = expense(ACTOR_A, new Date(T0 + 1).toISOString());

    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        await t.real.enqueue(segunda);
        t.coordinator.wake();
        t.state.session = 'signed-out';
        t.state.actor = null;
      },
    );

    t.coordinator.wake();
    await settle();

    expect(t.seen).toEqual([primera.clientOperationId]);
    // Conservada, aislada por actor, esperando a su misma cuenta (ADR-028 §13).
    const conservada = await t.real.byId(ACTOR_A, segunda.clientOperationId);
    expect(conservada?.state).toBe('queued');
    expect(conservada?.payload).toEqual(segunda.payload);
    expectNothingLeft(t);
    cerrar(t);
  });
});

describe('`stop()` elimina el aviso retenido', () => {
  it('segundo plano o desmontaje en la ventana: no hay repetición, y `wake()` la reanuda', async () => {
    const t = await setup();
    const primera = expense(ACTOR_A);
    await t.real.enqueue(primera);
    const segunda = expense(ACTOR_A, new Date(T0 + 1).toISOString());
    let retenidoAntes: boolean | null = null;
    let retenidoDespues: boolean | null = null;

    t.reads.once(
      (rows) => sendable(rows).length === 0,
      async () => {
        await t.real.enqueue(segunda);
        t.coordinator.wake();
        retenidoAntes = t.coordinator.worker.hasRetainedWake();
        t.coordinator.stop(); // la app se va al fondo con el aviso retenido
        retenidoDespues = t.coordinator.worker.hasRetainedWake();
      },
    );

    t.coordinator.wake();
    await settle();

    expect(retenidoAntes).toBe(true);
    expect(retenidoDespues).toBe(false);
    // Dos lecturas y no tres: no hubo repetición. La segunda sigue en disco.
    expect(t.reads.reads).toBe(2);
    expect(t.seen).toEqual([primera.clientOperationId]);
    expect((await t.real.byId(ACTOR_A, segunda.clientOperationId))?.state).toBe('queued');
    expect(t.coordinator.worker.isRunning()).toBe(false);
    expect(t.coordinator.worker.isStopped()).toBe(true);
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);

    // Volver a primer plano es un `wake()`, y entonces sí.
    t.coordinator.wake();
    await settle();
    expect(t.seen).toEqual([primera.clientOperationId, segunda.clientOperationId]);
    expectNothingLeft(t);
    cerrar(t);
  });

  it('`stop()` con una pasada en vuelo: su `onSettled` NO rearma el temporizador', async () => {
    const t = await setup(() => UNAVAILABLE_503);
    const entry = expense(ACTOR_A);
    await t.real.enqueue(entry);

    // La lectura que encuentra la entrada ya `retryable` es la última de la
    // pasada: ahí se para, con el `finally` todavía por ejecutar.
    t.reads.once(
      (rows) => rows.some((row) => row.state === 'retryable'),
      () => {
        t.coordinator.stop();
      },
    );

    t.coordinator.wake();
    await settle();

    // La entrada dejó su plazo escrito, pero nadie lo armó: estamos parados.
    expect((await t.real.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('retryable');
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    expect(t.coordinator.worker.isRunning()).toBe(false);

    // Al reanudar, la pasada no envía —no toca— y el ciclo se cierra solo.
    t.coordinator.wake();
    await settle();
    expect(t.calls).toBe(1);
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    cerrar(t);
  });

  it('`stop()` corta el drenaje tras la petición en vuelo, sin abandonarla', async () => {
    const t = await setup();
    const entries = [0, 1, 2].map((i) => expense(ACTOR_A, new Date(T0 + i).toISOString()));
    for (const entry of entries) await t.real.enqueue(entry);

    // Se para durante la lectura que precede al SEGUNDO envío: la fila ya está
    // leída y la petición todavía no ha empezado.
    t.reads.once(
      (rows) => sendable(rows).length === 2,
      () => {
        t.coordinator.stop();
      },
    );

    t.coordinator.wake();
    await settle();

    // La primera se envió y se anotó; la segunda no salió aunque ya se leyó:
    // después de `stop()` no empieza ninguna petición.
    expect(t.seen).toEqual([entries[0].clientOperationId]);
    expect((await t.real.byId(ACTOR_A, entries[0].clientOperationId))?.state).toBe('confirmed');
    expect((await t.real.byId(ACTOR_A, entries[1].clientOperationId))?.state).toBe('queued');
    expect(t.coordinator.worker.isRunning()).toBe(false);
    expect(t.coordinator.armedAt()).toBeNull();
    cerrar(t);
  });
});

describe('al vaciar la cola no queda nada', () => {
  it('ni flags, ni temporizadores, ni listeners, ni pasadas en vuelo', async () => {
    const t = await setup();
    for (let i = 0; i < 3; i += 1) {
      await t.real.enqueue(expense(ACTOR_A, new Date(T0 + i).toISOString()));
    }

    t.coordinator.wake();
    t.coordinator.wake();
    await settle();

    expectNothingLeft(t);
    expect(t.coordinator.worker.isStopped()).toBe(false);
    // El coordinador no registra listeners por su cuenta: quien dispara es
    // `features/`, y los quita con su propio teardown.
    expect(t.subscriptions).toBe(0);

    // Y no hay ninguna promesa viva que vaya a hacer algo más tarde: dejar
    // correr el tiempo y las microtareas no cambia nada.
    const lecturas = t.reads.reads;
    await t.env.advanceTo(T0 + 3_600_000);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(t.reads.reads).toBe(lecturas);
    expect(t.calls).toBe(3);
    cerrar(t);
  });
});
