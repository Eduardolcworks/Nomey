import { describe, expect, it } from 'vitest';

import {
  activityOf,
  localGroup,
  positionAcross,
  projectGroups,
} from '../../src/features/groups/group-projection';
import type { RemoteGroup } from '../../src/features/groups/group-service';
import type { GroupCreatePayload } from '../../src/lib/offline/command';
import { newQueueEntry, type QueueEntry } from '../../src/lib/offline/queue-entry';

/**
 * LA PROYECCIÓN DE GRUPOS: snapshot + cola, y una sola lista.
 *
 * Lo que se afirma aquí, y por qué cada cosa importa:
 *
 * - **la identidad no cambia al confirmarse**, así que un grupo nunca sale dos
 *   veces ni la tarjeta se remonta;
 * - **la creación local incierta prevalece** sobre un snapshot que no la vio;
 * - **retirada ⇔ `confirm_seq <= snapshot.seq`** (F07/ADR-001 §9), y sin snapshot
 *   no se retira nada;
 * - **el orden es estable**: el más nuevo arriba, con desempate por identidad.
 */

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CREATOR = '44444444-4444-4444-8444-444444444444';

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

function payload(groupId: string, name: string, people = 1): GroupCreatePayload {
  return {
    client_command_id: id('11111111'),
    command_contract_version: 1,
    client_group_id: groupId,
    display_name: name,
    emoji: '🏖️',
    currency_definition_id: CURRENCY,
    creator_participant_id: CREATOR,
    creator_display_name: 'Eduardo',
    participants: Array.from({ length: people - 1 }, () => ({
      client_participant_id: id('55555555'),
      display_name: 'Ana',
    })),
  };
}

function entry(
  groupId: string,
  name: string,
  overrides: Partial<QueueEntry> = {},
  people = 1,
): QueueEntry {
  const frozen = payload(groupId, name, people);
  return {
    ...newQueueEntry({
      clientOperationId: frozen.client_command_id,
      actorId: ACTOR,
      scopeId: groupId,
      commandType: 'group.create',
      payload: frozen,
      currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
      createdAt: '2026-09-06T18:00:00.000Z',
    }),
    ...overrides,
  };
}

function remote(groupId: string, name: string, overrides: Partial<RemoteGroup> = {}): RemoteGroup {
  return {
    scopeId: groupId,
    displayName: name,
    emoji: '🏖️',
    currencyDefinitionId: CURRENCY,
    currencyCode: 'EUR',
    currencyScale: 2,
    participantCount: 1,
    createdAt: '2026-09-06T18:00:00.000Z',
    updatedAt: '2026-09-06T18:00:00.000Z',
    defaultCategoryId: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('una entrada local convertida en grupo', () => {
  it('lleva la identidad definitiva, no una provisional', () => {
    const group = 'gggggggg-0000-4000-8000-000000000001';
    expect(localGroup(entry(group, 'Viaje'))?.scopeId).toBe(group);
  });

  it('la divisa sale de la instantánea de la ENTRADA, no del catálogo de ahora', () => {
    /*
     * Es la que estaba vigente cuando se congeló la intención, y la que el
     * servidor va a resolver. Releerla del catálogo podría formatear un importe
     * futuro con una escala que nadie eligió (F02/ADR-001 §3).
     */
    const local = localGroup(
      entry('gggggggg-0000-4000-8000-000000000002', 'Piso', {
        currency: { definitionId: CURRENCY, code: 'JPY', scale: 0 },
      }),
    );
    expect(local?.currencyCode).toBe('JPY');
    expect(local?.currencyScale).toBe(0);
  });

  it('cuenta a quien crea, y nunca el hueco final del formulario', () => {
    const local = localGroup(entry('gggggggg-0000-4000-8000-000000000003', 'Cena', {}, 3));
    expect(local?.participantCount).toBe(3);
  });

  it('una entrada de OTRO comando no es un grupo', () => {
    const movimiento = newQueueEntry({
      clientOperationId: id('99999999'),
      actorId: ACTOR,
      scopeId: 'ssssssss-0000-4000-8000-000000000001',
      commandType: 'personal_expense.create',
      payload: {
        client_operation_id: id('99999999'),
        command_contract_version: 2,
        scope_id: 'ssssssss-0000-4000-8000-000000000001',
        currency_definition_id: CURRENCY,
        amount: '1230',
        effective_date: '2026-09-06',
        effective_time: '20:00',
        concept: 'Cena',
        category_id: '44444444-4444-4444-8444-444444444444',
      },
      currency: { definitionId: CURRENCY, code: 'EUR', scale: 2 },
      createdAt: '2026-09-06T18:00:00.000Z',
    });
    expect(localGroup(movimiento)).toBe(null);
  });

  it('y las terminales de fallo NO se pintan: el grupo no existe', () => {
    for (const state of ['rejected', 'review', 'conflict'] as const) {
      expect(localGroup(entry('gggggggg-0000-4000-8000-000000000004', 'X', { state }))).toBe(null);
    }
    for (const state of ['queued', 'sending', 'retryable', 'blocked_session'] as const) {
      expect(localGroup(entry('gggggggg-0000-4000-8000-000000000005', 'X', { state }))).not.toBe(
        null,
      );
    }
  });
});

describe('unir las dos fuentes', () => {
  const GROUP = 'gggggggg-0000-4000-8000-0000000000aa';

  it('el mismo grupo en las dos sale UNA vez: la identidad es la misma', () => {
    const projected = projectGroups({
      snapshot: [remote(GROUP, 'Viaje')],
      snapshotSeq: 5,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje')],
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].scopeId).toBe(GROUP);
  });

  it('la creación local incierta PREVALECE sobre un snapshot que no la vio', () => {
    const projected = projectGroups({
      snapshot: [],
      snapshotSeq: 5,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje')],
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].pending).toBe(true);
  });

  it('retirada cuando el servidor ya la tenía: manda su fila', () => {
    const projected = projectGroups({
      snapshot: [remote(GROUP, 'Viaje', { participantCount: 3 })],
      snapshotSeq: 7,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje', { state: 'confirmed', confirmSeq: 7 })],
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].pending).toBe(false);
    expect(projected[0].participantCount).toBe(3);
  });

  it('confirmada DESPUÉS del snapshot todavía no está retirada', () => {
    const projected = projectGroups({
      snapshot: [],
      snapshotSeq: 7,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje', { state: 'confirmed', confirmSeq: 8 })],
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].pending).toBe(true);
  });

  it('SIN snapshot no se retira nada: no hay con qué comparar', () => {
    /*
     * La consulta falló —sin red, por ejemplo—. La lista es exactamente lo
     * local, que es la verdad disponible. Nunca una lista vacía que afirmara
     * que esta persona no tiene grupos.
     */
    const projected = projectGroups({
      snapshot: null,
      snapshotSeq: 99,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje', { state: 'confirmed', confirmSeq: 1 })],
    });
    expect(projected).toHaveLength(1);
  });

  it('confirmarse no cambia la identidad ni la cuenta que se enseñaba', () => {
    const antes = projectGroups({
      snapshot: [],
      snapshotSeq: 0,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje', {}, 3)],
    });
    const despues = projectGroups({
      snapshot: [remote(GROUP, 'Viaje', { participantCount: 3 })],
      snapshotSeq: 4,
      /* Lectura de posiciones que llegó y no trajo ninguna fila: cero conocido. */
      positions: [],
      entries: [entry(GROUP, 'Viaje', { state: 'confirmed', confirmSeq: 4 }, 3)],
    });

    expect(despues[0].scopeId).toBe(antes[0].scopeId);
    expect(despues[0].participantCount).toBe(antes[0].participantCount);
    expect(despues[0].displayName).toBe(antes[0].displayName);
  });
});

describe('el orden', () => {
  it('el más nuevo arriba', () => {
    const viejo = remote('gggggggg-0000-4000-8000-0000000000b1', 'Viejo', {
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    const nuevo = remote('gggggggg-0000-4000-8000-0000000000b2', 'Nuevo', {
      createdAt: '2026-09-06T10:00:00.000Z',
    });

    expect(
      projectGroups({ snapshot: [viejo, nuevo], snapshotSeq: 0, entries: [], positions: [] }).map(
        (one) => one.displayName,
      ),
    ).toEqual(['Nuevo', 'Viejo']);
  });

  it('y con el mismo instante, desempate ESTABLE por identidad', () => {
    /*
     * `Array.sort` no promete estabilidad para elementos que compara iguales, y
     * dos grupos creados en el mismo instante son normales en una prueba y
     * posibles en cuanto haya dos aparatos: sin desempate cambiarían de sitio
     * entre renders.
     */
    const a = remote('gggggggg-0000-4000-8000-0000000000c1', 'A');
    const b = remote('gggggggg-0000-4000-8000-0000000000c2', 'B');

    const uno = projectGroups({ snapshot: [a, b], snapshotSeq: 0, entries: [], positions: [] });
    const otro = projectGroups({ snapshot: [b, a], snapshotSeq: 0, entries: [], positions: [] });
    expect(uno.map((one) => one.scopeId)).toEqual(otro.map((one) => one.scopeId));
  });
});

/**
 * LA POSICIÓN DE CADA TARJETA, que es lo que decía «Saldado · 0,00» siempre.
 *
 * **El defecto que fija.** `fromRemote` resolvía la posición con una constante
 * vacía, así que toda tarjeta afirmaba un cero conocido tuviera el grupo la
 * deuda que tuviera. No era un valor por defecto olvidado: estaba argumentado —
 * nada producía deudas cuando se escribió— y siguió siendo verde cuando dejó de
 * ser cierto, porque se comprobaba a sí mismo.
 *
 * Lo que se comprueba ahora son las tres respuestas, que sí son propiedades:
 * sin lectura no se afirma nada, con lectura y sin fila se afirma cero, y con
 * fila se afirma su importe.
 */
describe('la posición de un grupo confirmado', () => {
  const GRUPO = 'gggggggg-0000-4000-8000-0000000000d1';
  const OTRA_DIVISA = 'cccccccc-0000-4000-8000-0000000000ff';

  const proyectar = (positions: Parameters<typeof projectGroups>[0]['positions']) =>
    projectGroups({ snapshot: [remote(GRUPO, 'Viaje')], snapshotSeq: 0, entries: [], positions });

  it('sin lectura de posiciones NO se afirma un cero: es no disponible', () => {
    expect(proyectar(null)[0].position).toEqual({ kind: 'unavailable' });
  });

  it('con lectura y sin fila para ese grupo, cero CONOCIDO', () => {
    // `api.group_summary` agrega sobre efectos vigentes: un grupo sin ningún
    // gasto no produce fila, y no tener deudas es la respuesta, no su ausencia.
    expect(proyectar([])[0].position).toEqual({ kind: 'net', minor: 0n });
  });

  it('con fila, su posición con signo — que es lo que la tarjeta enseña', () => {
    const positiva = proyectar([
      { scopeId: GRUPO, currencyDefinitionId: CURRENCY, netMinor: '1000' },
    ]);
    expect(positiva[0].position).toEqual({ kind: 'net', minor: 1000n });

    const negativa = proyectar([
      { scopeId: GRUPO, currencyDefinitionId: CURRENCY, netMinor: '-2500' },
    ]);
    expect(negativa[0].position).toEqual({ kind: 'net', minor: -2500n });
  });

  it('una posición en OTRA definición monetaria no se pinta bajo la del grupo', () => {
    /*
     * Hoy no puede pasar —el efecto lleva la divisa base de su ámbito por clave
     * ajena compuesta— pero esto es una frontera de red y el invariante es del
     * esquema. Pintar un importe en otra divisa junto al código del grupo sería
     * enseñar euros que no son euros.
     */
    const otra = proyectar([
      { scopeId: GRUPO, currencyDefinitionId: OTRA_DIVISA, netMinor: '1000' },
    ]);
    expect(otra[0].position).toEqual({ kind: 'unavailable' });
  });

  it('un grupo local todavía sin confirmar sigue en cero conocido', () => {
    // No hay operación posible sobre un ámbito que el servidor aún no conoce.
    const local = projectGroups({
      snapshot: [],
      snapshotSeq: 0,
      entries: [entry(GRUPO, 'Viaje')],
      positions: null,
    });
    expect(local[0].position).toEqual({ kind: 'net', minor: 0n });
    expect(local[0].pending).toBe(true);
  });
});

/**
 * EL AGREGADO DE INICIO: varias posiciones, una cifra, y ningún invento.
 */
describe('la posición del actor en todos sus grupos', () => {
  const A = 'gggggggg-0000-4000-8000-0000000000e1';
  const B = 'gggggggg-0000-4000-8000-0000000000e2';
  const C = 'gggggggg-0000-4000-8000-0000000000e3';
  const OTRA_DIVISA = 'cccccccc-0000-4000-8000-0000000000ff';

  const conPosiciones = (filas: readonly { id: string; net: string; divisa?: string }[]) =>
    projectGroups({
      snapshot: filas.map((fila) =>
        remote(fila.id, fila.id, { currencyDefinitionId: fila.divisa ?? CURRENCY }),
      ),
      snapshotSeq: 0,
      entries: [],
      positions: filas.map((fila) => ({
        scopeId: fila.id,
        currencyDefinitionId: fila.divisa ?? CURRENCY,
        netMinor: fila.net,
      })),
    });

  it('positivas y negativas se COMPENSAN en el total', () => {
    const groups = conPosiciones([
      { id: A, net: '3000' },
      { id: B, net: '-3000' },
    ]);
    expect(positionAcross(groups, CURRENCY)).toEqual({ kind: 'net', minor: 0n });
  });

  it('y las individuales sobreviven a la compensación', () => {
    const groups = conPosiciones([
      { id: A, net: '3000' },
      { id: B, net: '-3000' },
    ]);
    const porGrupo = Object.fromEntries(groups.map((one) => [one.scopeId, one.position]));
    expect(porGrupo[A]).toEqual({ kind: 'net', minor: 3000n });
    expect(porGrupo[B]).toEqual({ kind: 'net', minor: -3000n });
  });

  it('suma con signo cuando no se compensan', () => {
    const groups = conPosiciones([
      { id: A, net: '1000' },
      { id: B, net: '2500' },
      { id: C, net: '-400' },
    ]);
    expect(positionAcross(groups, CURRENCY)).toEqual({ kind: 'net', minor: 3100n });
  });

  it('una sola posición sin leer deja el total sin afirmar', () => {
    const groups = projectGroups({
      snapshot: [remote(A, 'A'), remote(B, 'B')],
      snapshotSeq: 0,
      entries: [],
      positions: null,
    });
    expect(positionAcross(groups, CURRENCY)).toEqual({ kind: 'unavailable' });
  });

  it('un grupo en otra divisa CON saldo vivo impide afirmar el agregado', () => {
    const groups = conPosiciones([
      { id: A, net: '1000' },
      { id: B, net: '5000', divisa: OTRA_DIVISA },
    ]);
    expect(positionAcross(groups, CURRENCY)).toEqual({ kind: 'unavailable' });
  });

  it('pero uno en otra divisa SALDADO no estorba: cero es cero en cualquiera', () => {
    const groups = conPosiciones([
      { id: A, net: '1000' },
      { id: B, net: '0', divisa: OTRA_DIVISA },
    ]);
    expect(positionAcross(groups, CURRENCY)).toEqual({ kind: 'net', minor: 1000n });
  });

  it('sin grupos, cero CONOCIDO y no desconocido', () => {
    expect(positionAcross([], CURRENCY)).toEqual({ kind: 'net', minor: 0n });
  });
});

/**
 * LA CATEGORÍA PREESTABLECIDA EN LA PROYECCIÓN, y los comandos antiguos.
 */
describe('la categoría preestablecida', () => {
  const G = 'gggggggg-0000-4000-8000-0000000000f1';

  it('un grupo confirmado la trae del perfil; null es «Todas»', () => {
    const con = projectGroups({
      snapshot: [remote(G, 'Cenas', { defaultCategoryId: 'cat-dining' })],
      snapshotSeq: 0,
      entries: [],
      positions: [],
    });
    expect(con[0].defaultCategoryId).toBe('cat-dining');
    const todas = projectGroups({
      snapshot: [remote(G, 'Cenas')],
      snapshotSeq: 0,
      entries: [],
      positions: [],
    });
    expect(todas[0].defaultCategoryId).toBeNull();
  });

  it('un comando durable ANTERIOR, sin el campo, se interpreta como «Todas»', () => {
    // El payload congelado de entonces no lleva `default_category_id`. No se
    // reescribe: se proyecta como sin preselección, y sigue siendo válido.
    const local = localGroup(entry(G, 'Viaje'));
    expect(local?.defaultCategoryId).toBeNull();
  });

  it('un comando nuevo la lleva y la proyección la enseña antes de confirmar', () => {
    const frozen = { ...payload(G, 'Cenas', 1), default_category_id: 'cat-dining' };
    const local = localGroup({
      ...entry(G, 'Cenas'),
      payload: frozen,
    });
    expect(local?.defaultCategoryId).toBe('cat-dining');
  });
});

/**
 * EL ORDEN DE GRUPOS ES POR ACTIVIDAD: el registro real del último movimiento.
 */
describe('el orden por actividad', () => {
  const A = 'gggggggg-0000-4000-8000-0000000000a1';
  const B = 'gggggggg-0000-4000-8000-0000000000a2';
  const C = 'gggggggg-0000-4000-8000-0000000000a3';
  const lista = (rows: readonly RemoteGroup[]) =>
    projectGroups({ snapshot: rows, snapshotSeq: 0, entries: [], positions: [] }).map(
      (one) => one.scopeId,
    );

  it('dos grupos con altas sucesivas: sube el del último registro, y un gasto con fecha anterior también', () => {
    const viejo = remote(A, 'A', {
      createdAt: '2026-09-01T10:00:00.000Z',
      lastActivityAt: '2026-09-10T12:00:00.000Z', // registrado hoy, aunque con fecha de ayer
    });
    const nuevo = remote(B, 'B', {
      createdAt: '2026-09-09T10:00:00.000Z',
      lastActivityAt: '2026-09-10T11:00:00.000Z',
    });
    expect(lista([nuevo, viejo])).toEqual([A, B]);
    // Un alta nueva en B lo pone primero: la clave es el registro, no la creación.
    const nuevoOtraVez = { ...nuevo, lastActivityAt: '2026-09-10T12:30:00.000Z' };
    expect(lista([nuevoOtraVez, viejo])).toEqual([B, A]);
  });

  it('un grupo sin movimientos usa su creación como referencia', () => {
    const sinMov = remote(C, 'C', { createdAt: '2026-09-10T11:30:00.000Z', lastActivityAt: null });
    const conMov = remote(A, 'A', {
      createdAt: '2026-09-01T10:00:00.000Z',
      lastActivityAt: '2026-09-10T11:00:00.000Z',
    });
    expect(lista([conMov, sinMov])).toEqual([C, A]);
    expect(
      activityOf(
        projectGroups({ snapshot: [sinMov], snapshotSeq: 0, entries: [], positions: [] })[0],
      ),
    ).toBe('2026-09-10T11:30:00.000Z');
  });

  it('el desempate es estable por identidad, en los dos sentidos', () => {
    const x = remote(A, 'A', { lastActivityAt: '2026-09-10T11:00:00.000Z' });
    const y = remote(B, 'B', { lastActivityAt: '2026-09-10T11:00:00.000Z' });
    expect(lista([x, y])).toEqual(lista([y, x]));
    expect(lista([y, x])).toEqual([A, B]);
  });

  it('un reintento idempotente no mueve nada: la misma actividad da la misma lista', () => {
    // Replay = misma operación, mismo `created_at` en el servidor: el snapshot
    // siguiente trae exactamente la misma clave.
    const antes = [
      remote(A, 'A', { lastActivityAt: '2026-09-10T11:00:00.000Z' }),
      remote(B, 'B', { lastActivityAt: '2026-09-10T10:00:00.000Z' }),
    ];
    expect(lista(antes)).toEqual(lista(antes.map((one) => ({ ...one }))));
  });

  it('un grupo creado en este aparato y aún sin viajar se ordena por su creación', () => {
    const local = localGroup(entry(C, 'Local'));
    expect(local?.lastActivityAt).toBeNull();
    expect(activityOf(local!)).toBe(local!.createdAt);
  });
});
