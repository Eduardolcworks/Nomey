import { describe, expect, it } from 'vitest';

import {
  parseScope,
  type PersonalScopeState,
  recallScope,
  rememberScope,
  SCOPE_CACHE_KEY,
  serializeScope,
} from '../../src/features/personal/personal-scope';
import { projectHome } from '../../src/features/personal/projection';
import type { CatalogueCache } from '../../src/lib/offline/catalogue-cache';
import { migrate } from '../../src/lib/offline/migrations';
import { newQueueEntry } from '../../src/lib/offline/queue-entry';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteCatalogueCache } from '../../src/lib/offline/sqlite-catalogue-cache';

import { openTestDatabase } from './offline-sqlite';

/**
 * EL RESPALDO LOCAL DEL ÁMBITO (F7.D, sobre ADR-028 §13 y §16).
 *
 * Es la ampliación que F7.D añade al almacén de documentos, y se audita como se
 * auditó el catálogo: contra un SQLite de verdad y por comportamiento, no
 * buscando texto en el fuente. Lo que tiene que quedar demostrado:
 *
 *   · toda lectura y toda escritura acotadas por actor;
 *   · una respuesta inválida no destruye un respaldo bueno;
 *   · un cambio de cuenta no enseña el ámbito de la anterior;
 *   · una definición monetaria cacheada que se ha quedado vieja no se trata
 *     como vigente ni permite reinterpretar un importe;
 *   · y no se persiste NINGÚN agregado económico.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE_A = '22222222-2222-4222-8222-222222222222';
const SCOPE_B = '55555555-5555-4555-8555-555555555555';
const EUR_OLD = '33333333-3333-4333-8333-333333333333';
const EUR_NEW = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-03T21:40:00.000Z';

type Ready = Extract<PersonalScopeState, { status: 'ready' }>;

const ready = (over: Partial<Ready> = {}): Ready => ({
  status: 'ready',
  scopeId: SCOPE_A,
  currencyDefinitionId: EUR_OLD,
  currencyCode: 'EUR',
  currencyScale: 2,
  created: false,
  ...over,
});

async function open() {
  const db = openTestDatabase();
  await migrate(db);
  return { db, cache: createSqliteCatalogueCache(db as SqlDatabase) };
}

/** Un almacén que siempre falla, para el camino de la base rota. */
const broken: CatalogueCache = {
  read: async () => {
    throw new Error('base');
  },
  write: async () => {
    throw new Error('base');
  },
  clear: async () => {
    throw new Error('base');
  },
};

describe('el documento del ámbito', () => {
  it('va y vuelve, y NUNCA dice que lo creó esta llamada', () => {
    const recalled = parseScope(serializeScope(ready({ created: true })));
    expect(recalled).toEqual(ready({ created: false }));
    expect(recalled?.created).toBe(false);
  });

  it('NO GUARDA NINGUNA CIFRA ECONÓMICA: ni saldo, ni totales, ni importes', () => {
    const document = serializeScope(ready());
    const shape = JSON.parse(document) as Record<string, unknown>;

    // La lista entera de claves, escrita a mano a propósito: si alguien añade
    // un campo, este test le obliga a mirarlo.
    expect(Object.keys(shape).sort()).toEqual([
      'currencyCode',
      'currencyDefinitionId',
      'currencyScale',
      'scopeId',
      'v',
    ]);
    for (const forbidden of ['balance', 'amount', 'total', 'income', 'expense', 'disponible']) {
      expect(document.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('un documento que no se puede creer devuelve `null`, en los seis casos', () => {
    expect(parseScope('no es json')).toBeNull();
    expect(parseScope('null')).toBeNull();
    expect(parseScope('[]')).toBeNull();
    // Versión posterior: lo escribió una app más nueva.
    expect(parseScope(JSON.stringify({ ...JSON.parse(serializeScope(ready())), v: 2 }))).toBeNull();
    // Campos vacíos o de otro tipo.
    expect(
      parseScope(JSON.stringify({ ...JSON.parse(serializeScope(ready())), scopeId: '' })),
    ).toBeNull();
    expect(
      parseScope(JSON.stringify({ ...JSON.parse(serializeScope(ready())), currencyScale: 2.5 })),
    ).toBeNull();
  });
});

describe('el respaldo, acotado por actor', () => {
  it('el ámbito de A no es visible para B', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);

    expect(await recallScope(cache, A)).toEqual(ready());
    expect(await recallScope(cache, B)).toBeNull();
    db.close();
  });

  it('B guardando el suyo NO toca el de A', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);
    await rememberScope(cache, B, ready({ scopeId: SCOPE_B, currencyCode: 'USD' }), NOW);

    expect((await recallScope(cache, A))?.scopeId).toBe(SCOPE_A);
    expect((await recallScope(cache, B))?.scopeId).toBe(SCOPE_B);
    db.close();
  });

  it('SIN ACTOR no se escribe ni se lee: nadie guarda en una casilla de cualquiera', async () => {
    const { db, cache } = await open();
    expect(await rememberScope(cache, '', ready(), NOW)).toBe('skippedNoActor');
    expect(await recallScope(cache, '')).toBeNull();

    // Y no ha quedado ninguna fila con actor vacío que otro pudiera leer.
    const rows = await db.getAllAsync<{ n: number }>(
      'select count(*) as n from catalogue_cache where actor_id = ?',
      [''],
    );
    expect(rows[0].n).toBe(0);
    db.close();
  });

  it('CERRAR SESIÓN Y ENTRAR CON OTRA CUENTA no enseña el ámbito de la anterior', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);

    // B entra en el mismo aparato, sin haber resuelto nunca su ámbito.
    expect(await recallScope(cache, B)).toBeNull();
    // Y el de A sigue intacto para cuando vuelva (ADR-028 §13: se conserva).
    expect(await recallScope(cache, A)).toEqual(ready());
    db.close();
  });
});

describe('un respaldo bueno no lo destruye una respuesta mala', () => {
  it('una carga posterior SUSTITUYE en una sola sentencia, sin instante sin documento', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);
    await rememberScope(cache, A, ready({ currencyDefinitionId: EUR_NEW }), NOW);

    const rows = await db.getAllAsync<{ n: number }>(
      'select count(*) as n from catalogue_cache where actor_id = ? and key = ?',
      [A, SCOPE_CACHE_KEY],
    );
    // Una fila, siempre: el upsert no borra para volver a insertar.
    expect(rows[0].n).toBe(1);
    expect((await recallScope(cache, A))?.currencyDefinitionId).toBe(EUR_NEW);
    db.close();
  });

  it('UN DOCUMENTO CORRUPTO devuelve `null` y NO borra la fila: no se pierde nada al leer', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);
    // Alguien —una versión anterior, un disco— dejó basura ahí.
    await db.runAsync('update catalogue_cache set document = ? where actor_id = ? and key = ?', [
      '{roto',
      A,
      SCOPE_CACHE_KEY,
    ]);

    expect(await recallScope(cache, A)).toBeNull();
    const rows = await db.getAllAsync<{ n: number }>(
      'select count(*) as n from catalogue_cache where actor_id = ?',
      [A],
    );
    expect(rows[0].n).toBe(1);
    db.close();
  });

  it('una base que no contesta no lanza: veredicto y `null`, y quien entra sigue entrando', async () => {
    expect(await rememberScope(broken, A, ready(), NOW)).toBe('failed');
    expect(await recallScope(broken, A)).toBeNull();
  });
});

/**
 * NINGÚN AGREGADO ECONÓMICO SE PERSISTE (ADR-028 §8, límite 2).
 *
 * Lo único duradero que la app guarda de una intención es el **comando
 * inmutable** de la cola. El almacén de documentos guarda dos cosas —el
 * catálogo y el ámbito— y ninguna es una cifra: ni saldo, ni totales, ni
 * sectores. Aquí se comprueba sobre las filas de verdad, con las dos escritas.
 */
describe('el almacén de documentos, con todo escrito', () => {
  it('SÓLO DOS CLAVES, y ningún documento lleva una cifra derivada', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);
    await cache.write(
      A,
      'categories',
      JSON.stringify({
        v: 1,
        rows: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            message_key: 'category.food',
            label: null,
            icon: 'fork',
            is_active: true,
          },
        ],
      }),
      NOW,
    );

    const rows = await db.getAllAsync<{ key: string; document: string }>(
      'select key, document from catalogue_cache where actor_id = ?',
      [A],
    );
    expect(rows.map((row) => row.key).sort()).toEqual(['categories', 'personal-scope']);
    for (const row of rows) {
      for (const forbidden of ['balance', 'total', 'amount', 'income', 'expense']) {
        expect(row.document.toLowerCase()).not.toContain(forbidden);
      }
      // Y ningún dígito suelto que pudiera ser un importe: lo único numérico es
      // la escala y la versión del documento.
      expect(row.document).not.toMatch(/"-?\d{3,}"/);
    }
    db.close();
  });
});

/**
 * LA DEFINICIÓN CACHEADA QUE SE HA QUEDADO VIEJA.
 *
 * El ámbito guardado dice EUR con la definición de ayer; el servidor ya tiene
 * otra, también EUR. Lo que no puede pasar es que el importe capturado bajo la
 * primera se reinterprete bajo la segunda porque el código coincida.
 */
describe('una definición cacheada obsoleta', () => {
  const localExpense = () => {
    const id = '00000000-0000-4000-8000-00000000000a';
    return newQueueEntry({
      clientOperationId: id,
      actorId: A,
      scopeId: SCOPE_A,
      commandType: 'personal_expense.create',
      payload: {
        client_operation_id: id,
        command_contract_version: 2,
        scope_id: SCOPE_A,
        currency_definition_id: EUR_OLD,
        amount: '4280',
        effective_date: '2026-09-03',
        effective_time: '21:40',
        concept: 'Cena',
        category_id: '66666666-6666-4666-8666-666666666666',
      },
      // La fotografía monetaria del momento de capturar: la vieja.
      currency: { definitionId: EUR_OLD, code: 'EUR', scale: 2 },
      createdAt: NOW,
    });
  };

  it('NO SE TRATA COMO VIGENTE: la entrada capturada bajo ella no entra en ningún agregado', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW); // guardado bajo EUR_OLD
    const cached = await recallScope(cache, A);
    expect(cached?.currencyDefinitionId).toBe(EUR_OLD);

    // El servidor ya dice otra cosa, con el MISMO código visible.
    const current = { ...ready(), currencyDefinitionId: EUR_NEW };

    const home = projectHome({
      scope: {
        scopeId: current.scopeId,
        currencyDefinitionId: current.currencyDefinitionId,
        currencyCode: current.currencyCode,
        currencyScale: current.currencyScale,
      },
      range: { from: '2026-09-01', to: '2026-09-30' },
      entries: [localExpense()],
      snapshot: {
        balance: { amount: '10000', seq: 0 },
        interval: {
          statistics: {
            scope_id: SCOPE_A,
            currency_definition_id: EUR_NEW,
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

    // Ni se convierte, ni se recalcula, ni se suma.
    expect(home.balance).toBe('10000');
    expect(home.statistics?.expense_total).toBe('0');
    expect(home.statistics?.categories).toEqual([]);
    // Pero la fila sigue ahí, con su importe y bajo SU definición.
    expect(home.operations).toHaveLength(1);
    expect(home.operations[0]).toMatchObject({
      original_amount: '4280',
      currency_definition_id: EUR_OLD,
      currency_code: 'EUR',
      currency_scale: 2,
      counted: false,
    });
    // Y sigue sin reconciliar, así que «Fijar el Disponible» sigue bloqueado.
    expect(home.unreconciled).toBe(1);
    db.close();
  });

  it('el respaldo NO decide la moneda: cuando el servidor contesta, manda él', async () => {
    const { db, cache } = await open();
    await rememberScope(cache, A, ready(), NOW);
    // Lo que la app guarda tras una respuesta correcta es lo que dijo el servidor.
    await rememberScope(cache, A, ready({ currencyDefinitionId: EUR_NEW }), NOW);
    expect((await recallScope(cache, A))?.currencyDefinitionId).toBe(EUR_NEW);
    db.close();
  });
});
