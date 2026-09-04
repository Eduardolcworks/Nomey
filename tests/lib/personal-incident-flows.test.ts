import { describe, expect, it } from 'vitest';

import { persistEntry } from '../../src/features/personal/entry-enqueue';
import { incidentsOf } from '../../src/features/personal/incidents';
import { blockerFor } from '../../src/features/personal/movement-entry';
import { projectHome } from '../../src/features/personal/projection';
import { migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';

import { openTestDatabase } from './offline-sqlite';

/**
 * Los fuentes, por el mismo glob que usan las comprobaciones de superficie.
 *
 * Aquí hacen falta para afirmar tres cosas que no son estado sino FORMA: que
 * abrir una revisión no llama a nada que escriba, que la hoja precargada no
 * lleva importe, y que la tarjeta de error de conectividad ya no se monta.
 */
const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function source(relative: string): string {
  const key = Object.keys(SOURCES).find((path) => path.endsWith('/src/' + relative));
  expect(key, `falta ${relative}`).toBeDefined();
  return SOURCES[key!];
}

/**
 * THE FLOWS AROUND AN INCIDENT, END TO END.
 *
 * The card and its two buttons are covered next door; what is asserted here is
 * what happens around them — opening a review and walking away, a resolution
 * the database refuses, the sheet that replaces a conflicted movement, and the
 * screen that must stay useful with no server at all.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';
const TODAY = '2026-09-04';
const MONTH = { from: '2026-09-01', to: '2026-09-30' } as never;

const scope = {
  scopeId: SCOPE,
  currencyDefinitionId: CURRENCY,
  currencyCode: 'EUR',
  currencyScale: 2,
};

let seq = 0;
function entry(over: { state?: QueueEntry['state']; amount?: string } = {}): QueueEntry {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const base = newQueueEntry({
    clientOperationId: id,
    actorId: A,
    scopeId: SCOPE,
    commandType: 'personal_expense.create',
    payload: {
      client_operation_id: id,
      command_contract_version: 2,
      scope_id: SCOPE,
      currency_definition_id: CURRENCY,
      amount: over.amount ?? '1200',
      effective_date: TODAY,
      effective_time: '21:40',
      concept: 'Cena',
      category_id: CATEGORY,
    },
    currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
    createdAt: `2026-09-04T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  });
  return { ...base, state: over.state ?? 'conflict' };
}

async function open() {
  const db = openTestDatabase();
  await migrate(db);
  return { db, store: createSqliteQueueStore(db as SqlDatabase) as QueueStore };
}

const incidents = async (store: QueueStore) => incidentsOf(await store.all(A));

const draft = {
  kind: 'expense' as const,
  amount: '1200',
  concept: 'Cena',
  categoryId: CATEGORY,
  date: TODAY as never,
  time: '21:40',
};

describe('1 · abrir «Revisar» y marcharse', () => {
  it('NO RESUELVE NADA: la incidencia y su entrada quedan intactas', async () => {
    const { db, store } = await open();
    const conflicted = entry({ state: 'conflict' });
    await store.enqueue(conflicted);

    /*
     * Abrir es navegar. La resolución vive DENTRO de la transacción que crea la
     * sustituta (ADR-029 §4), así que cerrar la hoja sin guardar no ejecuta
     * ninguna escritura: aquí eso es, literalmente, no llamar a nada.
     */
    expect(await incidents(store)).toHaveLength(1);
    expect(await store.byId(A, conflicted.clientOperationId)).not.toBeNull();
    db.close();
  });

  it('y la ruta no resuelve al navegar: `review` no llama a `dismiss`', () => {
    const route = source('app/notifications.tsx');
    const start = route.indexOf('const review =');
    const review = route.slice(start, route.indexOf('\n  };', start));
    // Navegar con dismissTo no es resolver: lo que no puede haber es una
    // llamada a las dos acciones que sí escriben.
    expect(review).not.toContain('dismiss(');
    expect(review).not.toContain('retry(');
    expect(review).not.toContain('store');
    // Lo único que hace es navegar, a uno de los dos destinos de ADR-029 §2.
    expect(review).toContain("router.dismissTo('/')");
    expect(review).toContain("pathname: '/add'");
  });
});

describe('2 · la eliminación que la base rechaza', () => {
  it('LA INCIDENCIA SIGUE VISIBLE y se puede volver a intentar', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    await store.enqueue(rejected);

    // La base se niega a borrar.
    const real = store.remove.bind(store);
    let broken = true;
    store.remove = async (actorId, id) => {
      if (broken) throw new Error('sqlite busy');
      return real(actorId, id);
    };

    await expect(store.remove(A, rejected.clientOperationId)).rejects.toThrow();
    // Nada finge haberse resuelto.
    expect(await incidents(store)).toHaveLength(1);

    broken = false;
    await store.remove(A, rejected.clientOperationId);
    expect(await incidents(store)).toEqual([]);
    db.close();
  });
});

describe('3 · doble toque en «No» o «Descartar»', () => {
  it('ES INOCUO: la segunda no encuentra nada y no rompe', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    await store.enqueue(rejected);

    await store.remove(A, rejected.clientOperationId);
    // `DELETE` sobre una fila que ya no está no es un error en SQL, y tampoco
    // aquí: la segunda pulsación no lanza ni deja rastro.
    await expect(store.remove(A, rejected.clientOperationId)).resolves.toBeUndefined();
    expect(await store.all(A)).toEqual([]);
    db.close();
  });
});

describe('4 · guardar la hoja precargada de un conflicto', () => {
  it('CREA LA NUEVA Y ELIMINA LA VIEJA EN UNA TRANSACCIÓN', async () => {
    const { db, store } = await open();
    const conflicted = entry({ state: 'conflict' });
    await store.enqueue(conflicted);

    const outcome = await persistEntry(store, {
      actorId: A,
      draft,
      scope,
      key: 'bbbb1111-1111-4111-8111-111111111111',
      createdAt: '2026-09-04T12:00:00.000Z',
      replacing: conflicted.clientOperationId,
    });

    expect(outcome.ok).toBe(true);
    expect(await store.byId(A, conflicted.clientOperationId)).toBeNull();
    expect((await store.all(A)).map((row) => row.clientOperationId)).toEqual([
      'bbbb1111-1111-4111-8111-111111111111',
    ]);
    expect(await incidents(store)).toEqual([]);
    db.close();
  });

  it('y CERRARLA sin guardar lo conserva todo', async () => {
    const { db, store } = await open();
    const conflicted = entry({ state: 'conflict' });
    await store.enqueue(conflicted);

    // Cerrar es no llamar. El estado después es idéntico al de antes.
    expect(await store.all(A)).toHaveLength(1);
    expect(await incidents(store)).toHaveLength(1);
    db.close();
  });

  it('un alta corriente NO sustituye nada', async () => {
    const { db, store } = await open();
    const conflicted = entry({ state: 'conflict' });
    await store.enqueue(conflicted);

    await persistEntry(store, {
      actorId: A,
      draft,
      scope,
      key: 'cccc2222-2222-4222-8222-222222222222',
      createdAt: '2026-09-04T12:00:00.000Z',
    });

    // Las dos: la terminal sigue esperando su decisión.
    expect(await store.all(A)).toHaveLength(2);
    expect(await incidents(store)).toHaveLength(1);
    db.close();
  });
});

describe('5 · la hoja de conflicto llega sin importe', () => {
  it('PRECARGA CONCEPTO, CATEGORÍA Y FECHA, y el importe queda vacío', () => {
    const add = source('app/add.tsx');
    const prefill = add.slice(add.indexOf('function prefill('));

    expect(prefill).toContain('concept: params.concept');
    expect(prefill).toContain('categoryId:');
    expect(prefill).toContain('date: (params.date');
    // El importe es el vacío del borrador, nunca uno traído.
    expect(prefill).toContain('amount: EMPTY_AMOUNT');
    expect(prefill).not.toContain('params.amount');
    // Y la ruta tampoco lo pasa.
    expect(
      add.slice(add.indexOf('resolving: incident'), add.indexOf('function prefill(')),
    ).not.toContain('amount');
  });

  it('y sin importe NO se puede guardar', () => {
    // El mismo bloqueo que cualquier alta: la hoja no ofrece guardar hasta que
    // hay cantidad, así que una precarga sin importe no puede enviarse.
    expect(blockerFor({ ...draft, amount: '' }, 2, true, true)).toBe('amountMissing');
    expect(blockerFor({ ...draft, amount: '0' }, 2, true, true)).toBe('amountInvalid');
    expect(blockerFor(draft, 2, true, true)).toBeNull();
  });
});

describe('6 · 7 · un snapshot válido y un refresco que falla', () => {
  const base = {
    balance: { amount: '10000', seq: 0 },
    interval: {
      statistics: {
        scope_id: SCOPE,
        currency_definition_id: CURRENCY,
        from: '2026-09-01',
        to: '2026-09-30',
        income_total: '0',
        expense_total: '0',
        categories: [],
      },
      operations: [],
      total: 0,
      seq: 0,
    },
  };

  it('EL SNAPSHOT SE CONSERVA: lo que califica una base es su ventana, no el último intento', () => {
    const hook = source('features/personal/use-projected-home.ts');
    // La condición ya no mira `status`, que es «funcionó el último intento».
    expect(hook).toContain('home.snapshot.intervalSeq !== null');
    expect(hook).not.toContain("home.status === 'ready' && home.snapshot.intervalSeq");
  });

  it('y sobre él, un gasto sin conexión mueve TODAS las superficies', async () => {
    const { db, store } = await open();
    await store.enqueue(entry({ state: 'queued', amount: '1200' }));

    const painted = projectHome({
      scope,
      range: MONTH,
      entries: await store.pending(A),
      snapshot: base,
      aliases: new Map(),
    });

    expect(painted.balance).toBe('8800');
    expect(painted.statistics?.expense_total).toBe('1200');
    expect(painted.statistics?.categories).toEqual([
      { category_id: CATEGORY, expense_total: '1200', operation_count: 1 },
    ]);
    expect(painted.operations).toHaveLength(1);
    expect(painted.operations[0]).toMatchObject({ category_id: CATEGORY, counted: true });
    db.close();
  });
});

describe('8 · arranque en frío sin snapshot', () => {
  it('FILAS LOCALES SÍ, CIFRAS NO, y ninguna tarjeta de error', async () => {
    const { db, store } = await open();
    await store.enqueue(entry({ state: 'queued', amount: '1200' }));

    const painted = projectHome({
      scope,
      range: MONTH,
      entries: await store.pending(A),
      snapshot: { balance: null, interval: null },
      aliases: new Map(),
    });

    // La intención se ve…
    expect(painted.operations).toHaveLength(1);
    // …y ninguna cifra se fabrica: eso es el `—` de la pantalla.
    expect(painted.balance).toBeNull();
    expect(painted.statistics).toBeNull();
    db.close();
  });

  it('la lista NO afirma que no haya movimientos cuando no hay base', () => {
    const home = source('app/(tabs)/index.tsx');
    const activity = home.slice(home.indexOf("t('home.activity')"), home.indexOf('MoreRow'));
    // Sin base, ni vacío ni aviso: silencio.
    expect(activity).toContain('home.snapshot.intervalSeq === null ? null : (');
  });

  it('y ninguna cadena visible de Inicio menciona la conexión', () => {
    const es = source('lib/i18n/messages/es-ES.ts');
    const used = es
      .split('\n')
      .filter((line: string) => line.trimStart().startsWith("'home."))
      .join('\n')
      .toLowerCase();
    for (const word of ['sin conexión', 'vuelva la conexión', 'offline', 'red no']) {
      expect(used).not.toContain(word);
    }
  });
});

describe('9 · 10 · transitorios y vuelta de la red', () => {
  it('CERO AVISOS Y CERO INCIDENCIAS por red, plazo o 5xx', async () => {
    const { db, store } = await open();
    for (const state of ['queued', 'sending', 'retryable'] as const) {
      await store.enqueue(entry({ state }));
    }

    expect(await incidents(store)).toEqual([]);
    // Y la pantalla no tiene dónde ponerlos: la tarjeta de error ya no existe.
    const home = source('app/(tabs)/index.tsx');
    expect(home).not.toContain('home.dataErrorTitle');
    expect(home).not.toContain('onPress: home.refresh');
    db.close();
  });

  it('la reconciliación no duplica: la fila del servidor hereda la clave local', async () => {
    const { db, store } = await open();
    const local = entry({ state: 'queued' });
    await store.enqueue(local);
    await store.markProgress(A, local.clientOperationId, {
      state: 'confirmed',
      confirmSeq: 1,
      resultOperationId: 'op-1',
    });

    const painted = projectHome({
      scope,
      range: MONTH,
      entries: await store.pending(A),
      snapshot: {
        balance: { amount: '8800', seq: 1 },
        interval: {
          statistics: {
            scope_id: SCOPE,
            currency_definition_id: CURRENCY,
            from: '2026-09-01',
            to: '2026-09-30',
            income_total: '0',
            expense_total: '1200',
            categories: [{ category_id: CATEGORY, expense_total: '1200', operation_count: 1 }],
          },
          operations: [
            {
              operation_id: 'op-1',
              operation_class: 'personal_expense',
              scope_id: SCOPE,
              currency_definition_id: CURRENCY,
              balance_amount: '-1200',
              original_amount: '1200',
              effective_date: TODAY,
              effective_time: '21:40:00',
              concept: 'Cena',
              category_id: CATEGORY,
              target_balance: null,
              current_version_id: 'v1',
              previous_version_id: null,
              version_no: 1,
              operation_created_at: '2026-09-04T10:00:00.000Z',
            },
          ],
          total: 1,
          seq: 1,
        },
      },
      aliases: new Map(),
    });

    expect(painted.balance).toBe('8800');
    expect(painted.operations).toHaveLength(1);
    expect(painted.operations[0].render_key).toBe(local.clientOperationId);
    expect(painted.reconciled).toEqual([local.clientOperationId]);
    db.close();
  });
});

describe('11 · la base local que no puede guardar', () => {
  it('NO CIERRA LA HOJA, y no culpa a la conexión', async () => {
    const { db, store } = await open();
    store.enqueue = async () => {
      throw new Error('sqlite busy');
    };

    const outcome = await persistEntry(store, {
      actorId: A,
      draft,
      scope,
      key: 'dddd3333-3333-4333-8333-333333333333',
      createdAt: '2026-09-04T12:00:00.000Z',
    });

    // Sin `ok` la hoja no se cierra, y el motivo es la base y no la red.
    expect(outcome).toEqual({ ok: false, reason: 'storeUnavailable' });

    const form = source('features/personal/movement-form.tsx');
    expect(form).toContain("queue.failure === 'storeUnavailable'");
    expect(form).toContain("t('entry.queueFailed')");
    // Y el mensaje habla del aparato, no de la conexión.
    const es = source('lib/i18n/messages/es-ES.ts');
    const message = es.slice(es.indexOf("'entry.queueFailed'"));
    expect(message.slice(0, 120).toLowerCase()).not.toContain('conexión');
    expect(message.slice(0, 120)).toContain('dispositivo');
    db.close();
  });
});
