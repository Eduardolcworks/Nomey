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
 * EL CICLO AUTOMÁTICO, de extremo a extremo.
 *
 * Los otros ficheros prueban las dos mitades por separado: que el worker escribe
 * un `next_attempt_at` tras un fallo, y que el planificador sabe programar una
 * fecha. **Eso no demuestra que estén conectadas**, y no lo estaban: `wake()` es
 * fire-and-forget, así que nadie leía el resultado de la pasada y el
 * temporizador no se armaba. Un 503 dejaba la entrada esperando a un disparador
 * externo que puede no llegar en horas.
 *
 * El punto que lo cierra es **`onSettled`**, en el `finally` de `pump()`:
 *
 * ```
 *   pump() ─finally─► ports.onSettled() ─► scheduler.reschedule(actor)
 *   scheduler ─onDue─► worker.wake()
 * ```
 *
 * Aquí no hay ni una espera arbitraria: reloj, planificador, almacenamiento y
 * transporte son falsos, así que cada paso se afirma por lo que quedó escrito y
 * por para cuándo quedó armado el temporizador.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

const T0 = Date.parse('2026-09-03T21:00:00.000Z');

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
    createdAt: new Date(T0).toISOString(),
  });
}

const UNAVAILABLE_503: TransportOutcome = { kind: 'http', status: 503, code: null };
const OK = (id = 'op-1', already = false): TransportOutcome => ({
  kind: 'ok',
  operationId: id,
  alreadyProcessed: already,
});

/**
 * Un planificador falso que **de verdad dispara** cuando el reloj llega.
 *
 * No basta con anotar plazos: lo que hay que demostrar es que el disparo
 * produce el segundo envío sin que nadie de fuera haya llamado a `wake()`.
 */
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
    /** Avanza el reloj y dispara lo que venza, como haría el sistema. */
    async advanceTo(ms: number) {
      now = ms;
      const due = timers.filter((timer) => timer.at <= now);
      for (const timer of due) {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
        timer.fn();
      }
      // Deja correr el `pump()` que el disparo acaba de lanzar.
      await settle();
    },
    set now(value: number) {
      now = value;
    },
    get now() {
      return now;
    },
  };
}

/** Vacía la cola de microtareas: el `pump` es asíncrono y no se espera. */
async function settle(rounds = 400) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

type Harness = Awaited<ReturnType<typeof setup>>;

async function setup(
  script: (n: number) => TransportOutcome,
  /** `0` da el suelo del backoff; `~1`, su techo. Ver `backoff.ts`. */
  random = 0,
) {
  const db: TestDatabase = openTestDatabase();
  await migrate(db);
  const store: QueueStore = createSqliteQueueStore(db as SqlDatabase);

  const env = fakeClockAndScheduler();
  const state = {
    actor: ACTOR_A as string | null,
    session: 'signed-in' as SessionPort extends never ? never : ReturnType<SessionPort['status']>,
    connected: true,
  };

  const seen: string[] = [];
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
    store,
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
  });

  return {
    db,
    store,
    env,
    state,
    seen,
    coordinator,
    get calls() {
      return calls;
    },
  };
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

describe('EL RECORRIDO COMPLETO: un 503 se reintenta solo', () => {
  it('los ocho pasos, sin ningún disparador externo', async () => {
    // 3 · el primer envío falla con 503; el segundo confirma.
    const t = await setup((n) => (n === 0 ? UNAVAILABLE_503 : OK('op-1')));

    // 1 · existe una entrada `queued`.
    const entry = expense(ACTOR_A);
    await t.store.enqueue(entry);
    expect((await t.store.byId(ACTOR_A, entry.clientOperationId))?.state).toBe('queued');

    // 2 · se despierta el worker UNA sola vez.
    t.coordinator.wake();
    await settle();

    // 4 · queda `retryable`, con `attempts = 1` y su plazo.
    const tras = await t.store.byId(ACTOR_A, entry.clientOperationId);
    expect(tras?.state).toBe('retryable');
    expect(tras?.attempts).toBe(1);
    expect(tras?.nextAttemptAt).toBe(new Date(T0 + 1_000).toISOString());
    expect(tras?.lastErrorClass).toBe('transport');

    // 5 · y el coordinador ya lo ha programado, SOLO. Sin reconexión, sin
    //     primer plano, sin cambio de sesión y sin otro `wake()`.
    expect(t.coordinator.armedAt()).toBe(T0 + 1_000);
    expect(t.env.pending).toBe(1);
    expect(t.calls).toBe(1);

    // 6 · al llegar el plazo, se produce el segundo envío.
    await t.env.advanceTo(T0 + 1_000);
    expect(t.calls).toBe(2);

    // 7 · la MISMA entrada, la MISMA clave y el MISMO payload.
    expect(t.seen).toEqual([entry.clientOperationId, entry.clientOperationId]);
    expect(new Set(t.seen).size).toBe(1);
    const final = await t.store.byId(ACTOR_A, entry.clientOperationId);
    expect(final?.payload).toEqual(entry.payload);
    expect(await t.store.all(ACTOR_A)).toHaveLength(1);

    // 8 · confirmado, y NO queda ningún temporizador de reintento vivo.
    expect(final?.state).toBe('confirmed');
    expect(final?.resultOperationId).toBe('op-1');
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    cerrar(t);
  });
});

describe('fallos transitorios consecutivos', () => {
  it('respetan 1 s, 2 s, 4 s, 8 s…', async () => {
    // Con `random ~ 1` el retardo es el TECHO, que es la serie del ADR.
    const t = await setup(() => UNAVAILABLE_503, 0.999999);
    const entry = expense(ACTOR_A);
    await t.store.enqueue(entry);

    t.coordinator.wake();
    await settle();

    const esperados = [1_000, 2_000, 4_000, 8_000, 16_000];
    let reloj = T0;

    for (const [index, delta] of esperados.entries()) {
      // El plazo programado es el del intento que toca, no el de un tic fijo.
      expect(t.coordinator.armedAt()).toBe(reloj + delta);
      const fila = await t.store.byId(ACTOR_A, entry.clientOperationId);
      expect(fila?.attempts).toBe(index + 1);

      reloj += delta;
      await t.env.advanceTo(reloj);
    }

    // Siempre la misma clave: un fallo transitorio nunca crea otra intención.
    expect(new Set(t.seen).size).toBe(1);
    expect(t.seen).toHaveLength(esperados.length + 1);
    cerrar(t);
  });
});

describe('un estado terminal desarma el temporizador', () => {
  it.each([
    ['confirmed', OK('op-9')],
    ['rejected', { kind: 'http', status: 400, code: 'PAYLOAD_INVALID' } as TransportOutcome],
    ['review', { kind: 'http', status: 409, code: 'IDEMPOTENCY_KEY_REUSED' } as TransportOutcome],
    [
      'conflict',
      { kind: 'http', status: 422, code: 'CURRENCY_CONVERSION_UNSUPPORTED' } as TransportOutcome,
    ],
  ])('%s deja el temporizador desarmado', async (esperado, outcome) => {
    // Primero un 503 para que haya un temporizador puesto, y luego el terminal.
    const t = await setup((n) => (n === 0 ? UNAVAILABLE_503 : outcome));
    const entry = expense(ACTOR_A);
    await t.store.enqueue(entry);

    t.coordinator.wake();
    await settle();
    expect(t.coordinator.armedAt()).not.toBeNull();

    await t.env.advanceTo(T0 + 1_000);

    expect((await t.store.byId(ACTOR_A, entry.clientOperationId))?.state).toBe(esperado);
    // Nada vuelve a programarse: la cola ya no tiene plazos.
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    cerrar(t);
  });

  it('y no se reintenta nunca más', async () => {
    const t = await setup((n) =>
      n === 0 ? UNAVAILABLE_503 : { kind: 'http', status: 400, code: 'PAYLOAD_INVALID' },
    );
    await t.store.enqueue(expense(ACTOR_A));
    t.coordinator.wake();
    await settle();
    await t.env.advanceTo(T0 + 1_000);

    const antes = t.calls;
    await t.env.advanceTo(T0 + 3_600_000);
    t.coordinator.wake();
    await settle();

    expect(t.calls).toBe(antes);
    cerrar(t);
  });
});

describe('lo que cancela el temporizador', () => {
  async function conPlazoPuesto() {
    const t = await setup(() => UNAVAILABLE_503);
    await t.store.enqueue(expense(ACTOR_A));
    t.coordinator.wake();
    await settle();
    expect(t.coordinator.armedAt()).not.toBeNull();
    return t;
  }

  it('cambiar de actor', async () => {
    const t = await conPlazoPuesto();
    t.state.actor = ACTOR_B;

    await t.coordinator.reschedule();

    // El plazo era de A; bajo B no hay nada que programar.
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    cerrar(t);
  });

  it('cerrar sesión', async () => {
    const t = await conPlazoPuesto();
    t.state.actor = null;
    t.state.session = 'signed-out';

    await t.coordinator.reschedule();

    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    cerrar(t);
  });

  it('pasar a segundo plano o desmontar el coordinador', async () => {
    const t = await conPlazoPuesto();

    t.coordinator.stop();

    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    t.db.close();
  });

  it('y tras `stop()` el plazo ya no dispara nada', async () => {
    const t = await conPlazoPuesto();
    const antes = t.calls;

    t.coordinator.stop();
    await t.env.advanceTo(T0 + 60_000);

    expect(t.calls).toBe(antes);
    t.db.close();
  });

  it('sin sesión, la pasada no envía y no deja plazo', async () => {
    const t = await setup(() => OK());
    await t.store.enqueue(expense(ACTOR_A));
    t.state.session = 'signed-out';

    t.coordinator.wake();
    await settle();

    expect(t.calls).toBe(0);
    expect(t.coordinator.armedAt()).toBeNull();
    cerrar(t);
  });
});

describe('el temporizador del `AbortController`', () => {
  it('UNA RESPUESTA RÁPIDA LO LIMPIA: no queda ningún temporizador real', async () => {
    /*
     * `sendWithTimeout` arma un `setTimeout` para abortar y lo limpia en su
     * `finally`. Con temporizadores falsos de Vitest se puede afirmar que
     * después de confirmar **no queda ninguno**, que es lo que un `finally`
     * olvidado dejaría: un abort programado sobre una petición ya resuelta.
     */
    const t = await setup(() => OK('op-rapida'));
    await t.store.enqueue(expense(ACTOR_A));

    t.coordinator.wake();
    await settle();

    expect(vi.getTimerCount()).toBe(0);
    expect(t.env.pending).toBe(0);
    cerrar(t);
  });

  it('tras abortar por plazo tampoco queda ninguno', async () => {
    // El transporte se queda esperando y rechaza al abortarlo, como el `fetch`.
    const db: TestDatabase = openTestDatabase();
    await migrate(db);
    const store = createSqliteQueueStore(db as SqlDatabase);
    const env = fakeClockAndScheduler();

    const coordinator = createSyncCoordinator({
      store,
      transport: {
        send: (_t, _p, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      },
      clock: env.clock,
      random: () => 0,
      connectivity: { isConnected: () => true, subscribe: () => () => undefined },
      session: {
        status: () => 'signed-in',
        actorId: () => ACTOR_A,
        subscribe: () => () => undefined,
      },
      scheduler: env.scheduler,
      timeoutMs: 50,
    });

    const entry = expense(ACTOR_A);
    await store.enqueue(entry);
    coordinator.wake();
    await settle();

    // El plazo del abort es un `setTimeout` real: se avanza con Vitest.
    await vi.advanceTimersByTimeAsync(60);
    await settle();

    const fila = await store.byId(ACTOR_A, entry.clientOperationId);
    expect(fila?.state).toBe('retryable');
    expect(fila?.lastErrorCode).toBe('timeout');
    // Misma clave: abortar en el cliente no demuestra que no se ejecutara.
    expect(fila?.clientOperationId).toBe(entry.clientOperationId);
    // Y el `finally` limpió el temporizador del abort.
    expect(vi.getTimerCount()).toBe(0);

    coordinator.stop();
    db.close();
  });
});

describe('nada pendiente al terminar', () => {
  it('tras confirmar no queda ni temporizador ni pasada en vuelo', async () => {
    const t = await setup(() => OK('op-fin'));
    await t.store.enqueue(expense(ACTOR_A));

    t.coordinator.wake();
    await settle();

    expect(t.coordinator.worker.isRunning()).toBe(false);
    expect(t.coordinator.armedAt()).toBeNull();
    expect(t.env.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    cerrar(t);
  });

  it('varios `wake()` seguidos no dejan pasadas solapadas', async () => {
    const t = await setup(() => OK());
    for (let i = 0; i < 4; i += 1) await t.store.enqueue(expense(ACTOR_A));

    t.coordinator.wake();
    t.coordinator.wake();
    t.coordinator.wake();
    await settle();

    expect(t.coordinator.worker.isRunning()).toBe(false);
    const restantes = (await t.store.pending(ACTOR_A)).filter(
      (entry) => entry.state === 'queued' || entry.state === 'retryable',
    );
    expect(restantes).toEqual([]);
    cerrar(t);
  });
});
