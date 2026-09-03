import { describe, expect, it } from 'vitest';

import { migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import {
  createRetryScheduler,
  IMMEDIATE_FLOOR_MS,
  type Scheduler,
} from '../../src/lib/offline/retry-scheduler';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';

import { openTestDatabase } from './offline-sqlite';

/**
 * EL TEMPORIZADOR, ALINEADO CON `next_attempt_at`.
 *
 * Lo que este fichero demuestra es la diferencia entre un tic fijo y esto: con
 * un tic de 30 s, un backoff de 1, 2, 4, 8 y 16 segundos **no se cumple** —la
 * entrada espera al siguiente tic—. Aquí se afirma **para cuándo** se programa,
 * no sólo que algo se programa, porque el planificador está inyectado.
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

/** Un planificador de mentira: anota los plazos y deja dispararlos a mano. */
function fakeScheduler() {
  const armed: { ms: number; fn: () => void }[] = [];
  let cleared = 0;

  const scheduler: Scheduler = {
    set(fn, ms) {
      armed.push({ ms, fn });
      return armed.length - 1;
    },
    clear() {
      cleared += 1;
    },
  };

  return {
    scheduler,
    armed,
    get cleared() {
      return cleared;
    },
    /** Dispara el último programado, como haría el reloj real. */
    fire() {
      armed.at(-1)?.fn();
    },
  };
}

async function setup(now = T0) {
  const db = openTestDatabase();
  await migrate(db);
  const store: QueueStore = createSqliteQueueStore(db as SqlDatabase);
  const clock = { now: () => now };
  const fake = fakeScheduler();
  let despertares = 0;

  const sched = createRetryScheduler({
    store,
    clock,
    scheduler: fake.scheduler,
    onDue: () => {
      despertares += 1;
    },
  });

  return {
    db,
    store,
    fake,
    sched,
    setNow: (value: number) => {
      now = value;
    },
    get despertares() {
      return despertares;
    },
  };
}

/** Deja una entrada en `retryable` con su plazo. */
async function retryable(store: QueueStore, entry: QueueEntry, atMs: number) {
  await store.enqueue(entry);
  await store.markProgress(ACTOR_A, entry.clientOperationId, {
    state: 'retryable',
    attempts: 1,
    nextAttemptAt: new Date(atMs).toISOString(),
  });
}

describe('se programa para el `next_attempt_at` más próximo', () => {
  it.each([1_000, 2_000, 4_000, 8_000, 16_000])(
    'un backoff de %i ms se respeta al milisegundo',
    async (delay) => {
      /*
       * Ésta es la prueba que un tic fijo de 30 s no pasa: el plazo se cumple
       * cuando toca y no cuando pasa por allí el temporizador.
       */
      const t = await setup();
      await retryable(t.store, expense(ACTOR_A), T0 + delay);

      await t.sched.reschedule(ACTOR_A);

      expect(t.fake.armed).toHaveLength(1);
      expect(t.fake.armed[0].ms).toBe(delay);
      expect(t.sched.armedAt()).toBe(T0 + delay);
      t.db.close();
    },
  );

  it('con varias, manda LA MÁS PRÓXIMA', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 + 60_000);
    await retryable(t.store, expense(ACTOR_A), T0 + 5_000);
    await retryable(t.store, expense(ACTOR_A), T0 + 30_000);

    await t.sched.reschedule(ACTOR_A);

    expect(t.fake.armed).toHaveLength(1);
    expect(t.fake.armed[0].ms).toBe(5_000);
    t.db.close();
  });

  it('UN SOLO TEMPORIZADOR: reprogramar sustituye, no acumula', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 + 10_000);

    await t.sched.reschedule(ACTOR_A);
    await t.sched.reschedule(ACTOR_A);
    await t.sched.reschedule(ACTOR_A);

    /*
     * Tres programados y DOS cancelados: la primera reprogramación no cancela
     * nada porque todavía no había temporizador. Lo que importa es que nunca
     * queden dos vivos a la vez, y eso es lo que dice la resta.
     */
    expect(t.fake.armed).toHaveLength(3);
    expect(t.fake.armed.length - t.fake.cleared).toBe(1);
    t.db.close();
  });

  it('la tolerancia entre lo calculado y el disparo es exacta con reloj inyectado', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 + 4_000);
    await t.sched.reschedule(ACTOR_A);

    const previsto = t.sched.armedAt();
    expect(previsto).not.toBeNull();
    // |previsto − (ahora + espera)| = 0. Con un tic fijo de 30 s, el desvío
    // habría sido de hasta 29 s.
    expect((previsto as number) - (T0 + t.fake.armed[0].ms)).toBe(0);
    t.db.close();
  });
});

describe('lo ya vencido despierta sin bucle inmediato', () => {
  it('un plazo pasado se programa al SUELO, no a cero', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 - 60_000);

    await t.sched.reschedule(ACTOR_A);

    expect(t.fake.armed[0].ms).toBe(IMMEDIATE_FLOOR_MS);
    expect(IMMEDIATE_FLOOR_MS).toBeGreaterThan(0);
    t.db.close();
  });

  it('al disparar despierta al worker UNA vez y se desarma', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 - 1);
    await t.sched.reschedule(ACTOR_A);

    t.fake.fire();

    expect(t.despertares).toBe(1);
    // Desarmado: no queda nada puesto que pueda volver a disparar solo.
    expect(t.sched.armedAt()).toBeNull();
    t.db.close();
  });
});

describe('qué NO programa', () => {
  it('nada, si no hay `retryable`', async () => {
    const t = await setup();
    await t.store.enqueue(expense(ACTOR_A)); // se queda `queued`

    await t.sched.reschedule(ACTOR_A);

    // Una `queued` no espera a nada: la coge el worker en cuanto lo despiertan.
    expect(t.fake.armed).toHaveLength(0);
    expect(t.sched.armedAt()).toBeNull();
    t.db.close();
  });

  it('nada, sin actor', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 + 1_000);

    await t.sched.reschedule(null);
    await t.sched.reschedule('');

    expect(t.fake.armed).toHaveLength(0);
    t.db.close();
  });

  it('NADA DE OTRA CUENTA', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 + 1_000);

    await t.sched.reschedule(ACTOR_B);

    expect(t.fake.armed).toHaveLength(0);
    t.db.close();
  });

  it('ignora un `next_attempt_at` ilegible en vez de programar para NaN', async () => {
    const t = await setup();
    const entry = expense(ACTOR_A);
    await t.store.enqueue(entry);
    await t.store.markProgress(ACTOR_A, entry.clientOperationId, {
      state: 'retryable',
      nextAttemptAt: 'no es una fecha',
    });

    await t.sched.reschedule(ACTOR_A);

    expect(t.fake.armed).toHaveLength(0);
    t.db.close();
  });

  it('`stop()` no deja nada armado — nada sobrevive al segundo plano', async () => {
    const t = await setup();
    await retryable(t.store, expense(ACTOR_A), T0 + 10_000);
    await t.sched.reschedule(ACTOR_A);

    t.sched.stop();

    expect(t.sched.armedAt()).toBeNull();
    expect(t.fake.cleared).toBeGreaterThanOrEqual(1);
    t.db.close();
  });
});

/**
 * `reschedule` lee la cola con un `await`, y en ese hueco puede llegar otra
 * reprogramación o un `stop()`. Sin la generación, la que despertara segunda
 * armaba su temporizador SIN quitar el de la primera —el `disarm()` de ambas
 * ya había pasado— y quedaban dos vivos, uno de ellos sin asa.
 */
describe('reprogramaciones que se cruzan', () => {
  /** El store real, con cada `pending()` retenido hasta que la prueba lo suelte. */
  function retenido(real: QueueStore) {
    const sueltas: (() => void)[] = [];
    const store: QueueStore = {
      ...real,
      async pending(actorId) {
        const rows = await real.pending(actorId);
        await new Promise<void>((resolve) => {
          sueltas.push(resolve);
        });
        return rows;
      },
    };
    return {
      store,
      /** Suelta la lectura número `n` y deja correr su continuación. */
      async soltar(n: number) {
        // La lectura real es asíncrona: hay que dejar que llegue a retenerse.
        for (let i = 0; i < 20 && sueltas[n] === undefined; i += 1) await Promise.resolve();
        sueltas[n]();
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      },
    };
  }

  async function cruzado() {
    const db = openTestDatabase();
    await migrate(db);
    const real: QueueStore = createSqliteQueueStore(db as SqlDatabase);
    const gate = retenido(real);
    const fake = fakeScheduler();
    const sched = createRetryScheduler({
      store: gate.store,
      clock: { now: () => T0 },
      scheduler: fake.scheduler,
      onDue: () => undefined,
    });
    await retryable(real, expense(ACTOR_A), T0 + 10_000);
    return { db, gate, fake, sched };
  }

  it('dos `reschedule` solapados dejan UN temporizador, el del último', async () => {
    const t = await cruzado();

    const primera = t.sched.reschedule(ACTOR_A);
    const segunda = t.sched.reschedule(ACTOR_A);

    // La primera despierta cuando la segunda ya la ha sustituido: no arma nada.
    await t.gate.soltar(0);
    expect(t.fake.armed).toHaveLength(0);

    await t.gate.soltar(1);
    await Promise.all([primera, segunda]);

    expect(t.fake.armed).toHaveLength(1);
    expect(t.fake.armed.length - t.fake.cleared).toBe(1);
    expect(t.sched.armedAt()).toBe(T0 + 10_000);
    t.db.close();
  });

  it('un `stop()` durante la lectura gana: al despertar, la reprogramación no arma nada', async () => {
    const t = await cruzado();

    const enVuelo = t.sched.reschedule(ACTOR_A);
    t.sched.stop();
    await t.gate.soltar(0);
    await enVuelo;

    expect(t.fake.armed).toHaveLength(0);
    expect(t.sched.armedAt()).toBeNull();
    t.db.close();
  });
});
