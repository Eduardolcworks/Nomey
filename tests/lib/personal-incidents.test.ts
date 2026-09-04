import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type Incident,
  incidentOf,
  incidentsOf,
  INCIDENT_MESSAGE,
  incidentMessage,
  replacementFor,
} from '../../src/features/personal/incidents';
import { projectHome } from '../../src/features/personal/projection';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import { en } from '../../src/lib/i18n/messages/en';
import { migrate } from '../../src/lib/offline/migrations';
import {
  newQueueEntry,
  type QueueEntry,
  type QueueEntryState,
} from '../../src/lib/offline/queue-entry';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';

import { openTestDatabase, type TestDatabase } from './offline-sqlite';

/**
 * INCIDENTS: THE ONLY VISIBLE SURFACE OF THE QUEUE.
 *
 * ADR-028 §15 put them in one place and gave them one source: **the queue's own
 * terminal state**, with no second store, no counter and no badge on the list.
 * So everything asserted here is asserted against real rows in a real SQLite —
 * an incident is a row, resolving one is a transaction, and there is nothing
 * else to keep in sync.
 *
 * ADR-029 renamed the affirmative button to `Sí` and settled where `Revisar`
 * goes. The semantics underneath did not move.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';
const TODAY = '2026-09-04';

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

let seq = 0;
function entry(
  over: {
    kind?: 'expense' | 'income';
    amount?: string;
    state?: QueueEntryState;
    actorId?: string;
    concept?: string;
  } = {},
): QueueEntry {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const kind = over.kind ?? 'expense';
  const payload: Record<string, string | number> = {
    client_operation_id: id,
    command_contract_version: 2,
    scope_id: SCOPE,
    currency_definition_id: CURRENCY,
    amount: over.amount ?? '1200',
    effective_date: TODAY,
    effective_time: '21:40',
    concept: over.concept ?? 'Cena',
  };
  if (kind === 'expense') payload.category_id = CATEGORY;

  const base = newQueueEntry({
    clientOperationId: id,
    actorId: over.actorId ?? A,
    scopeId: SCOPE,
    commandType: kind === 'income' ? 'personal_income.create' : 'personal_expense.create',
    payload,
    currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
    createdAt: `2026-09-04T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  });
  return { ...base, state: over.state ?? 'rejected' };
}

async function open(file = ':memory:') {
  const db = openTestDatabase(file);
  await migrate(db);
  const store: QueueStore = createSqliteQueueStore(db as SqlDatabase);
  return { db, store };
}

/** What the projection paints for this actor, with a base of 100,00 €. */
async function paint(store: QueueStore, actorId = A) {
  return projectHome({
    scope,
    range: { from: '2026-09-01', to: '2026-09-30' } as never,
    entries: await store.pending(actorId),
    snapshot: {
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
    },
    aliases: new Map(),
  });
}

/** The incidents an account has right now, read the way the screen reads them. */
async function incidents(store: QueueStore, actorId = A): Promise<Incident[]> {
  return incidentsOf(await store.all(actorId));
}

describe('1 · un rechazo definitivo', () => {
  it('RETIRA LA PROYECCIÓN Y DEJA UNA INCIDENCIA, no dos cosas distintas', async () => {
    const { db, store } = await open();
    const local = entry({ state: 'queued', amount: '1200' });
    await store.enqueue(local);

    // Mientras vive, es un movimiento normal y mueve el Disponible.
    expect((await paint(store)).balance).toBe('8800');
    expect(await incidents(store)).toEqual([]);

    // El servidor demuestra que no escribió nada.
    await store.markProgress(A, local.clientOperationId, {
      state: 'rejected',
      lastErrorClass: 'domain',
      lastErrorCode: 'PAYLOAD_INVALID',
    });

    // La proyección se revierte ENTERA y aparece exactamente una incidencia.
    const painted = await paint(store);
    expect(painted.balance).toBe('10000');
    expect(painted.operations).toEqual([]);
    expect(painted.unreconciled).toBe(0);

    const found = await incidents(store);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      form: 'ordinary',
      kind: 'expense',
      amountMinor: '1200',
      categoryId: CATEGORY,
      reviewDestination: null,
    });
    db.close();
  });
});

describe('2 · eventos repetidos', () => {
  it('SIGUE HABIENDO UNA SOLA: la incidencia ES la fila, y la fila es única', async () => {
    const { db, store } = await open();
    const local = entry({ state: 'rejected' });
    await store.enqueue(local);

    // Diez relecturas, como diez eventos o diez refrescos.
    for (let i = 0; i < 10; i += 1) expect(await incidents(store)).toHaveLength(1);

    // Y una segunda anotación del mismo estado tampoco duplica.
    await store.markProgress(A, local.clientOperationId, { state: 'rejected' });
    expect(await incidents(store)).toHaveLength(1);
    db.close();
  });
});

describe('3 · reiniciar la app', () => {
  it('LA INCIDENCIA SOBREVIVE, porque es una fila y no un aviso en memoria', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomey-incident-'));
    dirs.push(dir);
    const file = join(dir, 'queue.db');

    const first = await open(file);
    const local = entry({ state: 'rejected', amount: '4280' });
    await first.store.enqueue(local);
    expect(await incidents(first.store)).toHaveLength(1);
    first.db.close();

    const second = await open(file);
    const found = await incidents(second.store);
    expect(found).toHaveLength(1);
    expect(found[0].amountMinor).toBe('4280');
    expect(found[0].clientOperationId).toBe(local.clientOperationId);
    second.db.close();
  });
});

describe('4 · «Sí»', () => {
  it('CLAVE NUEVA, PAYLOAD IDÉNTICO, la anterior eliminada y la proyección de vuelta', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected', amount: '1200', concept: 'Cena' });
    await store.enqueue(rejected);
    expect((await paint(store)).operations).toEqual([]);

    const key = '99999999-9999-4999-8999-999999999999';
    const replacement = replacementFor(rejected, key, '2026-09-04T11:00:00.000Z');
    await store.replace(A, rejected.clientOperationId, replacement);

    // La anterior ya no está, y la nueva es una entrada recién nacida.
    expect(await store.byId(A, rejected.clientOperationId)).toBeNull();
    const fresh = await store.byId(A, key);
    expect(fresh).toMatchObject({
      state: 'queued',
      attempts: 0,
      confirmSeq: null,
      dispatchSeq: null,
      resultOperationId: null,
      lastErrorClass: null,
      lastErrorCode: null,
    });

    // Y el payload es EL MISMO salvo la identidad del comando.
    expect(fresh?.payload).toEqual({ ...rejected.payload, client_operation_id: key });
    expect(fresh?.currency).toEqual(rejected.currency);
    expect(fresh?.scopeId).toBe(rejected.scopeId);
    expect(fresh?.commandType).toBe(rejected.commandType);
    // La fecha efectiva NO se toca; la de creación sí, que es el orden FIFO.
    expect(fresh?.payload.effective_date).toBe(TODAY);
    expect(fresh?.createdAt).not.toBe(rejected.createdAt);

    // El movimiento vuelve a verse como uno normal, y la incidencia se fue.
    expect((await paint(store)).balance).toBe('8800');
    expect(await incidents(store)).toEqual([]);
    db.close();
  });
});

describe('5 · fallo a mitad de la sustitución', () => {
  it('ATOMICIDAD: ni se pierde la anterior ni aparece la nueva', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    await store.enqueue(rejected);

    // Una sustituta que el store se NIEGA a escribir: otro actor. La guarda
    // salta antes del `INSERT`, así que la transacción no llega a empezar.
    const foreign = replacementFor(
      { ...rejected, actorId: B },
      'aaaa1111-1111-4111-8111-111111111111',
      '2026-09-04T11:00:00.000Z',
    );
    await expect(store.replace(A, rejected.clientOperationId, foreign)).rejects.toThrow();

    expect(await store.byId(A, rejected.clientOperationId)).not.toBeNull();
    expect(await store.all(A)).toHaveLength(1);
    expect(await incidents(store)).toHaveLength(1);
    db.close();
  });

  it('y un payload que no se puede almacenar tampoco deja media sustitución', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    await store.enqueue(rejected);

    const broken = {
      ...replacementFor(
        rejected,
        'bbbb2222-2222-4222-8222-222222222222',
        '2026-09-04T11:00:00.000Z',
      ),
      payload: { ...rejected.payload, amount: 1200 as unknown as string },
    };
    await expect(store.replace(A, rejected.clientOperationId, broken)).rejects.toThrow();

    expect(await store.all(A)).toHaveLength(1);
    expect((await store.byId(A, rejected.clientOperationId))?.state).toBe('rejected');
    db.close();
  });
});

describe('6 · doble toque en «Sí»', () => {
  it('UNA SOLA ENTRADA NUEVA: la segunda no encuentra qué sustituir', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    await store.enqueue(rejected);

    /*
     * La comprobación que hace el hook antes de sustituir: si la fila ya no
     * está, no se crea nada. Es lo que hace la acción idempotente en vez de
     * simplemente protegida por un guard en memoria.
     */
    const press = async (key: string) => {
      const found = await store.byId(A, rejected.clientOperationId);
      if (found === null) return null;
      await store.replace(
        A,
        rejected.clientOperationId,
        replacementFor(found, key, '2026-09-04T11:00:00.000Z'),
      );
      return key;
    };

    const first = await press('cccc3333-3333-4333-8333-333333333333');
    const second = await press('dddd4444-4444-4444-8444-444444444444');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await store.all(A)).toHaveLength(1);
    expect((await store.all(A))[0].clientOperationId).toBe(first);
    db.close();
  });
});

describe('7 · la intención nueva vuelve a ser rechazada', () => {
  it('OTRA INCIDENCIA, y ningún bucle automático', async () => {
    const { db, store } = await open();
    const first = entry({ state: 'rejected' });
    await store.enqueue(first);

    const key = 'eeee5555-5555-4555-8555-555555555555';
    await store.replace(
      A,
      first.clientOperationId,
      replacementFor(first, key, '2026-09-04T11:00:00.000Z'),
    );
    await store.markProgress(A, key, { state: 'rejected', lastErrorCode: 'PAYLOAD_INVALID' });

    const found = await incidents(store);
    expect(found).toHaveLength(1);
    expect(found[0].clientOperationId).toBe(key);
    // Nadie ha creado una tercera: el siguiente intento nace de una pulsación.
    expect(await store.all(A)).toHaveLength(1);
    db.close();
  });
});

describe('8 y 11 · «No» y «Descartar»', () => {
  it('ELIMINAN LOCALMENTE Y NO LLAMAN AL SERVIDOR', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    const conflicted = entry({ state: 'conflict' });
    await store.enqueue(rejected);
    await store.enqueue(conflicted);
    expect(await incidents(store)).toHaveLength(2);

    await store.remove(A, rejected.clientOperationId);
    await store.remove(A, conflicted.clientOperationId);

    expect(await incidents(store)).toEqual([]);
    expect(await store.all(A)).toEqual([]);
    // No hay transporte por ninguna parte: resolver es una escritura local y
    // nada más. Lo demuestra la ausencia de cualquier envío en esta prueba —
    // el store no tiene forma de hablar con el servidor.
    db.close();
  });

  it('no dejan historial local de la incidencia', async () => {
    const { db, store } = await open();
    const rejected = entry({ state: 'rejected' });
    await store.enqueue(rejected);
    await store.remove(A, rejected.clientOperationId);

    const rows = await db.getAllAsync<{ n: number }>(
      'select count(*) as n from queue_entry where client_operation_id = ?',
      [rejected.clientOperationId],
    );
    expect(rows[0].n).toBe(0);
    db.close();
  });
});

describe('9 · transitorios y respuestas ambiguas', () => {
  const transient: QueueEntryState[] = [
    'queued',
    'sending',
    'retryable',
    'blocked_session',
    'confirmed',
  ];

  it('CERO INCIDENCIAS, y el movimiento se sigue viendo', async () => {
    const { db, store } = await open();
    for (const state of transient) await store.enqueue(entry({ state }));

    expect(await incidents(store)).toEqual([]);
    // Y los cinco se siguen pintando con normalidad: `confirmed` incluida,
    // que sigue proyectada hasta que un refresco demuestre que ya está.
    const painted = await paint(store);
    expect(painted.operations.filter((op) => op.client_operation_id !== null)).toHaveLength(5);
    db.close();
  });

  it('ni uno solo produce forma visible', () => {
    for (const state of transient) {
      expect(incidentOf(entry({ state }))).toBeNull();
    }
  });
});

describe('10 · `review` y `conflict`', () => {
  it('FORMA EXCEPCIONAL, y nunca «Sí»', async () => {
    const { db, store } = await open();
    await store.enqueue(entry({ state: 'review' }));
    await store.enqueue(entry({ state: 'conflict' }));

    const found = await incidents(store);
    expect(found).toHaveLength(2);
    for (const incident of found) expect(incident.form).toBe('exceptional');
    db.close();
  });

  it('el destino de «Revisar» depende de lo que se pueda demostrar (ADR-029 §2)', () => {
    // Conflicto monetario: la frontera se negó ANTES de escribir → la hoja.
    expect(incidentOf(entry({ state: 'conflict' }))?.reviewDestination).toBe('sheet');
    // Resultado desconocido: podría existir → mirar primero, sin clave nueva.
    expect(incidentOf(entry({ state: 'review' }))?.reviewDestination).toBe('movements');
    // La ordinaria no ofrece revisión.
    expect(incidentOf(entry({ state: 'rejected' }))?.reviewDestination).toBeNull();
  });

  it('su frase NO es la de la forma ordinaria, y no pregunta si repetir', () => {
    for (const group of [INCIDENT_MESSAGE.currencyMoved, INCIDENT_MESSAGE.unconfirmed]) {
      for (const key of [group.expense, group.income]) {
        expect(key).not.toBe(INCIDENT_MESSAGE.ordinary.expense);
        expect(esES[key]).not.toContain('volver a intentarlo');
      }
    }
  });

  /*
   * UNA FORMA, DOS FRASES. Los botones son los mismos porque las dos piden lo
   * mismo; el texto no, porque lo que se sabe es distinto. Medido en el
   * aparato: con la frase única, un conflicto monetario decía «no hemos podido
   * confirmar», que es justo lo que en ese caso SÍ se sabe.
   */
  it('el conflicto monetario NO dice que el resultado sea desconocido', () => {
    const moved = incidentMessage(incidentOf(entry({ state: 'conflict' }))!);
    const unknown = incidentMessage(incidentOf(entry({ state: 'review' }))!);
    expect(moved).not.toBe(unknown);
    expect(esES[moved]).toContain('no se registró');
    expect(esES[moved]).toContain('moneda');
    expect(esES[unknown]).toContain('No hemos podido confirmar');
    // Y la ordinaria sigue siendo la suya.
    expect(incidentMessage(incidentOf(entry({ state: 'rejected' }))!)).toBe(
      INCIDENT_MESSAGE.ordinary.expense,
    );
  });
});

describe('12 · cambio de actor y cierre de sesión', () => {
  it('CADA CUENTA VE LA SUYA, y ninguna puede resolver la de la otra', async () => {
    const { db, store } = await open();
    const mine = entry({ state: 'rejected', actorId: A });
    const theirs = entry({ state: 'rejected', actorId: B });
    await store.enqueue(mine);
    await store.enqueue(theirs);

    expect((await incidents(store, A)).map((one) => one.clientOperationId)).toEqual([
      mine.clientOperationId,
    ]);
    expect((await incidents(store, B)).map((one) => one.clientOperationId)).toEqual([
      theirs.clientOperationId,
    ]);

    // A intenta resolver la de B: el predicado de actor no lo permite.
    await store.remove(A, theirs.clientOperationId);
    expect(await incidents(store, B)).toHaveLength(1);

    // Y sustituirla tampoco.
    await expect(
      store.replace(
        A,
        theirs.clientOperationId,
        replacementFor(theirs, 'ffff6666-6666-4666-8666-666666666666', '2026-09-04T11:00:00.000Z'),
      ),
    ).rejects.toThrow();
    expect(await store.all(B)).toHaveLength(1);
    db.close();
  });

  it('resolver la propia no toca la ajena, y reabrir devuelve lo que quedaba', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomey-incident-b-'));
    dirs.push(dir);
    const file = join(dir, 'queue.db');

    const first = await open(file);
    const mine = entry({ state: 'rejected', actorId: A });
    const theirs = entry({ state: 'rejected', actorId: B });
    await first.store.enqueue(mine);
    await first.store.enqueue(theirs);
    await first.store.remove(A, mine.clientOperationId);
    first.db.close();

    const second = await open(file);
    expect(await incidents(second.store, A)).toEqual([]);
    expect(await incidents(second.store, B)).toHaveLength(1);
    second.db.close();
  });
});

describe('13 · la base local no deja persistir', () => {
  it('NO CREA NINGUNA INCIDENCIA: sin fila no hay nada que resolver', async () => {
    const { db, store } = await open();

    /*
     * Es el caso de ADR-028 §1 y no el de §15: si SQLite no admite la entrada,
     * la hoja se queda abierta con su borrador y NADA queda escrito. Una
     * incidencia de rechazo describiría una respuesta del servidor que aquí no
     * ha ocurrido, porque no ha salido ninguna petición.
     */
    const broken = { ...entry({ state: 'queued' }), payload: { roto: true } as never };
    await expect(store.enqueue(broken)).rejects.toThrow();

    expect(await store.all(A)).toEqual([]);
    expect(await incidents(store)).toEqual([]);
    db.close();
  });
});

describe('14 · lo que se lee en pantalla', () => {
  const VISIBLE = [
    'incident.expenseNotMade',
    'incident.incomeNotMade',
    'incident.expenseUnconfirmed',
    'incident.expenseCurrencyMoved',
    'incident.incomeCurrencyMoved',
    'incident.incomeUnconfirmed',
    'incident.yes',
    'incident.no',
    'incident.review',
    'incident.discard',
    'incident.title',
    'incident.pending',
    'incident.unknownCategory',
  ] as const;

  /**
   * El vocabulario que ADR-028 §15 prohíbe en pantalla, más los códigos y la
   * palabra que ADR-029 retiró.
   */
  const FORBIDDEN = [
    'cola',
    'queue',
    'clave',
    'key',
    'intención',
    'intention',
    'entrada',
    'entry',
    'terminal',
    'client_operation_id',
    'idempot',
    'sqlite',
    'sql',
    'payload',
    'worker',
    'reintent',
    'retry',
    'http',
    '409',
    '422',
    '400',
    'PAYLOAD_INVALID',
    'CURRENCY_',
  ];

  for (const catalogue of [
    { name: 'es-ES', messages: esES as Record<string, string> },
    { name: 'en', messages: en as Record<string, string> },
  ]) {
    it(`${catalogue.name}: ninguna cadena visible lleva vocabulario interno ni códigos`, () => {
      for (const key of VISIBLE) {
        const value = catalogue.messages[key].toLowerCase();
        for (const word of FORBIDDEN) {
          expect(value).not.toContain(word.toLowerCase());
        }
      }
    });
  }

  it('la forma ordinaria PREGUNTA, y los botones son Sí y No (ADR-029 §1)', () => {
    expect(esES['incident.expenseNotMade']).toBe(
      'Gasto de {amount} en {category} no realizado. ¿Quieres volver a intentarlo?',
    );
    expect(esES['incident.yes']).toBe('Sí');
    expect(esES['incident.no']).toBe('No');
    // Y ninguna cadena de incidencia es «Reintentar», que es lo que ADR-029
    // retiró. La palabra sigue existiendo para el reintento de una CARGA, que
    // es otra cosa y no toca dinero.
    for (const key of VISIBLE) expect(esES[key]).not.toBe('Reintentar');
  });

  it('el ingreso usa la misma estructura y NO inventa una categoría', () => {
    expect(esES['incident.incomeNotMade']).toContain('{amount}');
    expect(esES['incident.incomeNotMade']).not.toContain('{category}');
    expect(incidentOf(entry({ kind: 'income', state: 'rejected' }))?.categoryId).toBeNull();
  });
});

describe('15 · un movimiento pendiente y uno confirmado', () => {
  it('SE VEN IGUAL, y ningún terminal vuelve a la proyección', async () => {
    const { db, store } = await open();
    const pending = entry({ state: 'queued', amount: '1200' });
    const dead = entry({ state: 'rejected', amount: '5000' });
    await store.enqueue(pending);
    await store.enqueue(dead);

    const painted = await paint(store);
    const row = painted.operations.find(
      (op) => op.client_operation_id === pending.clientOperationId,
    );
    // La fila local trae exactamente los campos de una del servidor. Lo único
    // que la distingue es que no tiene versión vigente, y eso no se pinta.
    expect(row).toMatchObject({
      operation_class: 'personal_expense',
      original_amount: '1200',
      concept: 'Cena',
      category_id: CATEGORY,
      counted: true,
      currency_code: 'EUR',
    });
    // El rechazado no aparece por ningún lado ni mueve una cifra.
    expect(painted.operations).toHaveLength(1);
    expect(painted.balance).toBe('8800');
    db.close();
  });
});

describe('16 · la campana', () => {
  it('REFLEJA LO SIN RESOLVER Y SE LIMPIA CON LA ÚLTIMA', async () => {
    const { db, store } = await open();
    const one = entry({ state: 'rejected' });
    const two = entry({ state: 'conflict' });
    await store.enqueue(one);
    await store.enqueue(two);
    expect((await incidents(store)).length).toBe(2);

    await store.remove(A, one.clientOperationId);
    expect((await incidents(store)).length).toBe(1);

    await store.remove(A, two.clientOperationId);
    expect((await incidents(store)).length).toBe(0);
    db.close();
  });

  it('un transitorio no la enciende', async () => {
    const { db, store } = await open();
    await store.enqueue(entry({ state: 'retryable' }));
    await store.enqueue(entry({ state: 'queued' }));
    expect((await incidents(store)).length).toBe(0);
    db.close();
  });
});
