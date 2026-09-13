import { describe, expect, it } from 'vitest';

import {
  INCIDENT_SEEN_KEY,
  NO_SEEN,
  parseSeen,
  readSeen,
  seenAfterVisit,
  serializeSeen,
  unseenIncidents,
  writeSeen,
} from '../../src/features/personal/incident-seen';
import type { Incident } from '../../src/features/personal/incidents';
import { migrate } from '../../src/lib/offline/migrations';
import type { SqlDatabase } from '../../src/lib/offline/sql-database';
import { createSqliteCatalogueCache } from '../../src/lib/offline/sqlite-catalogue-cache';

import { openTestDatabase } from './offline-sqlite';

/**
 * «VISTO» NO ES «RESUELTO»: el punto de la campana se apaga al entrar, y la
 * incidencia sigue ahí hasta reintentar, revisar o descartar. Lo visto es un
 * conjunto de claves por actor, guardado en el documento opaco del catálogo.
 */

const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function incident(key: string, actorId = ACTOR_A): Incident {
  return {
    clientOperationId: key,
    actorId,
    form: 'ordinary',
    reviewDestination: null,
    kind: 'expense',
    amountMinor: '1250',
    currencyCode: 'EUR',
    currencyScale: 2,
    categoryId: null,
    concept: null,
    effectiveDate: '2026-09-10',
    createdAt: '2026-09-10T10:00:00.000Z',
  };
}

async function open() {
  const db = openTestDatabase();
  await migrate(db);
  return createSqliteCatalogueCache(db as SqlDatabase);
}

describe('el documento', () => {
  it('va y vuelve, ordenado, y lo roto o ausente es «nada visto»', () => {
    const seen = new Set(['k2', 'k1']);
    expect(serializeSeen(seen)).toBe('["k1","k2"]');
    expect([...parseSeen(serializeSeen(seen))].sort()).toEqual(['k1', 'k2']);
    expect(parseSeen(null)).toBe(NO_SEEN);
    expect(parseSeen('{')).toBe(NO_SEEN);
    expect(parseSeen('{"a":1}')).toBe(NO_SEEN);
    expect([...parseSeen('["k1", 7, null]')]).toEqual(['k1']);
  });
});

describe('lo no visto', () => {
  it('es lo que enciende el punto: una incidencia sin ver, aunque siga sin resolver', () => {
    const list = [incident('k1'), incident('k2')];
    expect(unseenIncidents(list, NO_SEEN)).toHaveLength(2);
    expect(unseenIncidents(list, new Set(['k1']))).toEqual([incident('k2')]);
    // Vista no es resuelta: la lista sigue entera.
    expect(list).toHaveLength(2);
    expect(unseenIncidents(list, new Set(['k1', 'k2']))).toHaveLength(0);
  });

  it('una posterior a la visita sigue sin ver: reintentar crea otra clave', () => {
    const before = [incident('k1')];
    const seen = seenAfterVisit(NO_SEEN, before, ['k1']);
    // El reintento fallido vuelve como k1b: otra incidencia, no vista.
    const after = [incident('k1b')];
    expect(unseenIncidents(after, seen)).toEqual([incident('k1b')]);
  });
});

describe('tras la visita', () => {
  it('se marca exactamente lo enseñado, se conserva lo ya visto y se poda lo que ya no existe', () => {
    const existing = [incident('k1'), incident('k2'), incident('k3')];
    const seen = seenAfterVisit(new Set(['k0', 'k1']), existing, ['k2']);
    expect([...seen].sort()).toEqual(['k1', 'k2']);
    // k0 ya no existe: fuera. k3 no se enseñó: no se ve.
    expect(seen.has('k0')).toBe(false);
    expect(seen.has('k3')).toBe(false);
  });

  it('lo enseñado que ya no existe al guardar tampoco entra', () => {
    const seen = seenAfterVisit(NO_SEEN, [incident('k1')], ['k1', 'gone']);
    expect([...seen]).toEqual(['k1']);
  });
});

describe('el almacén, por actor', () => {
  it('escribe y lee bajo su clave, y un actor no ve lo del otro', async () => {
    const cache = await open();
    await writeSeen(cache, ACTOR_A, new Set(['k1']), '2026-09-10T10:00:00.000Z');
    expect([...(await readSeen(cache, ACTOR_A))]).toEqual(['k1']);
    expect(await readSeen(cache, ACTOR_B)).toBe(NO_SEEN);
    expect((await cache.read(ACTOR_A, INCIDENT_SEEN_KEY))?.document).toBe('["k1"]');
    // Y la clave no pisa la del catálogo de categorías.
    expect(await cache.read(ACTOR_A, 'categories')).toBeNull();
  });

  it('sobrescribe en vez de acumular: la segunda visita sustituye a la primera', async () => {
    const cache = await open();
    await writeSeen(cache, ACTOR_A, new Set(['k1', 'k2']), '2026-09-10T10:00:00.000Z');
    await writeSeen(cache, ACTOR_A, new Set(['k2']), '2026-09-10T11:00:00.000Z');
    expect([...(await readSeen(cache, ACTOR_A))]).toEqual(['k2']);
  });
});
