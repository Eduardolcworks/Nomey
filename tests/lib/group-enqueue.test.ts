import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildGroupPayload,
  GROUP_CREATE_CONTRACT_VERSION,
  type GroupIdentities,
  participantCount,
  payloadParticipants,
  persistGroup,
} from '../../src/features/groups/group-enqueue';
import type { GroupDraft, ParticipantRow } from '../../src/features/groups/group-draft';
import { payloadDefect } from '../../src/lib/offline/command';
import { migrate } from '../../src/lib/offline/migrations';
import type { QueueStore } from '../../src/lib/offline/queue-store';
import { createSqliteQueueStore } from '../../src/lib/offline/sqlite-queue-store';

import { openTestDatabase } from './offline-sqlite';

/**
 * LA ESCRITURA DURABLE DE UNA CREACIÓN DE GRUPO.
 *
 * Contra un SQLite de verdad —el mismo SQL que corre en el aparato— y también
 * con la base rota, que es el único caso donde la respuesta importa: si no se
 * puede demostrar que la clave y el payload quedaron en disco, esto tiene que
 * decir que NO, para que la ventana no se cierre y nada finja que el grupo
 * existe.
 */

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const COMMAND = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';
const CREATOR = '44444444-4444-4444-8444-444444444444';
const ANA = '55555555-5555-4555-8555-555555555555';
const LUIS = '66666666-6666-4666-8666-666666666666';

const IDENTITIES: GroupIdentities = {
  clientCommandId: COMMAND,
  clientGroupId: GROUP,
  creatorParticipantId: CREATOR,
};

const CURRENCY_SNAPSHOT = { definitionId: CURRENCY, code: 'EUR', scale: 2 };
const CREATED_AT = '2026-09-06T18:00:00.000Z';

function rows(...extras: readonly (readonly [string, string])[]): readonly ParticipantRow[] {
  return [
    { id: 'owner', name: 'Eduardo', owner: true },
    ...extras.map(([id, name]) => ({ id, name, owner: false })),
    /* El hueco final, que SIEMPRE está y nunca es nadie. */
    { id: 'p0', name: '', owner: false },
  ];
}

function draft(overrides: Partial<GroupDraft> = {}): GroupDraft {
  return {
    emoji: '🏖️',
    name: 'Viaje',
    currencyId: CURRENCY,
    participants: rows([ANA, 'Ana'], [LUIS, 'Luis']),
    defaultCategoryId: null,
    ...overrides,
  };
}

async function store(): Promise<QueueStore> {
  const db = openTestDatabase();
  await migrate(db);
  return createSqliteQueueStore(db);
}

describe('qué participantes entran en el comando', () => {
  it('el hueco final no entra: es un sitio para escribir, no alguien', () => {
    expect(payloadParticipants(rows([ANA, 'Ana']))).toEqual([
      { client_participant_id: ANA, display_name: 'Ana' },
    ]);
  });

  it('ni el creador, que viaja aparte porque es el único con cuenta detrás', () => {
    expect(payloadParticipants(rows()).map((one) => one.client_participant_id)).not.toContain(
      'owner',
    );
    expect(payloadParticipants(rows())).toEqual([]);
  });

  it('y los nombres salen ya canonicalizados', () => {
    /*
     * NFC, espacios colapsados y extremos recortados. Congelar otra cosa haría
     * que el servidor —que canonicaliza por su cuenta— entendiera una intención
     * distinta de la guardada, y un reintento legítimo se leería como clave
     * reutilizada.
     */
    const sucios = rows([ANA, '  José   Luis  ']);
    expect(payloadParticipants(sucios)).toEqual([
      { client_participant_id: ANA, display_name: 'José Luis' },
    ]);
  });
});

describe('el payload congelado', () => {
  it('lleva las tres identidades, la versión de contrato y nada más', () => {
    const payload = buildGroupPayload(draft(), IDENTITIES, 'Eduardo');
    expect(payload).toEqual({
      client_command_id: COMMAND,
      command_contract_version: GROUP_CREATE_CONTRACT_VERSION,
      client_group_id: GROUP,
      display_name: 'Viaje',
      emoji: '🏖️',
      currency_definition_id: CURRENCY,
      creator_participant_id: CREATOR,
      creator_display_name: 'Eduardo',
      default_category_id: null,
      participants: [
        { client_participant_id: ANA, display_name: 'Ana' },
        { client_participant_id: LUIS, display_name: 'Luis' },
      ],
    });
  });

  it('y la cola lo admite tal cual: ni un defecto de forma', () => {
    expect(payloadDefect('group.create', buildGroupPayload(draft(), IDENTITIES, 'Eduardo'))).toBe(
      null,
    );
  });

  it('sin divisa NO se construye: `null` no es «euros»', () => {
    expect(buildGroupPayload(draft({ currencyId: null }), IDENTITIES, 'Eduardo')).toBe(null);
  });

  it('sin nombre de grupo tampoco, ni con uno que sólo son espacios', () => {
    expect(buildGroupPayload(draft({ name: '   ' }), IDENTITIES, 'Eduardo')).toBe(null);
  });

  it('ni sin nombre de creador: un participante sin nombre no es nadie', () => {
    expect(buildGroupPayload(draft(), IDENTITIES, '')).toBe(null);
  });

  it('un participante repetido lo invalida entero, no se descarta en silencio', () => {
    const repetido = draft({ participants: rows([ANA, 'Ana'], [LUIS, 'ANA']) });
    expect(buildGroupPayload(repetido, IDENTITIES, 'Eduardo')).toBe(null);
  });

  it('la cuenta incluye a quien crea, y nunca el hueco final', () => {
    const payload = buildGroupPayload(draft(), IDENTITIES, 'Eduardo');
    expect(payload).not.toBe(null);
    expect(participantCount(payload!)).toBe(3);
  });
});

describe('persistir, y decir la verdad sobre si quedó persistido', () => {
  let queue: QueueStore;

  beforeEach(async () => {
    queue = await store();
  });

  it('escribe UNA entrada, con la clave del comando como identidad', async () => {
    const outcome = await persistGroup(queue, {
      actorId: ACTOR,
      draft: draft(),
      identities: IDENTITIES,
      creatorName: 'Eduardo',
      currency: CURRENCY_SNAPSHOT,
      createdAt: CREATED_AT,
    });

    expect(outcome.ok).toBe(true);
    const all = await queue.all(ACTOR);
    expect(all).toHaveLength(1);
    expect(all[0].clientOperationId).toBe(COMMAND);
    expect(all[0].commandType).toBe('group.create');
    expect(all[0].state).toBe('queued');
    /* El ámbito de la entrada es el grupo que va a nacer: ya es el definitivo. */
    expect(all[0].scopeId).toBe(GROUP);
    expect(all[0].currency).toEqual(CURRENCY_SNAPSHOT);
  });

  it('DOS pulsaciones con la misma clave no producen dos comandos', async () => {
    const input = {
      actorId: ACTOR,
      draft: draft(),
      identities: IDENTITIES,
      creatorName: 'Eduardo',
      currency: CURRENCY_SNAPSHOT,
      createdAt: CREATED_AT,
    };

    expect((await persistGroup(queue, input)).ok).toBe(true);
    /*
     * La segunda choca con la primera en la propia tienda. Da fallo —no se
     * escribió nada nuevo— y sobre todo NO deja dos filas, que es lo que se
     * convertiría en dos grupos en el servidor.
     */
    const segunda = await persistGroup(queue, input);
    expect(segunda.ok).toBe(false);
    expect(await queue.all(ACTOR)).toHaveLength(1);
  });

  it('un borrador inválido no llega al disco', async () => {
    const outcome = await persistGroup(queue, {
      actorId: ACTOR,
      draft: draft({ name: '  ' }),
      identities: IDENTITIES,
      creatorName: 'Eduardo',
      currency: CURRENCY_SNAPSHOT,
      createdAt: CREATED_AT,
    });

    expect(outcome).toEqual({ ok: false, reason: 'invalidDraft' });
    expect(await queue.all(ACTOR)).toHaveLength(0);
  });

  it('y una identidad que no es un UUID se rechaza por FORMA, no al enviar', async () => {
    /*
     * Un payload que la cola no admite no debe llegar a disco: reaparecería en
     * cada arranque sin poder enviarse nunca, y el fallo llegaría muy lejos del
     * sitio donde todavía se puede corregir.
     */
    const outcome = await persistGroup(queue, {
      actorId: ACTOR,
      draft: draft({ participants: rows(['p1', 'Ana']) }),
      identities: IDENTITIES,
      creatorName: 'Eduardo',
      currency: CURRENCY_SNAPSHOT,
      createdAt: CREATED_AT,
    });

    expect(outcome).toEqual({ ok: false, reason: 'invalidPayload' });
    expect(await queue.all(ACTOR)).toHaveLength(0);
  });

  it('CON LA BASE ROTA devuelve fallo, y no finge que existe', async () => {
    const roto: QueueStore = {
      ...queue,
      enqueue: () => Promise.reject(new Error('database or disk is full')),
    };

    const outcome = await persistGroup(roto, {
      actorId: ACTOR,
      draft: draft(),
      identities: IDENTITIES,
      creatorName: 'Eduardo',
      currency: CURRENCY_SNAPSHOT,
      createdAt: CREATED_AT,
    });

    expect(outcome).toEqual({ ok: false, reason: 'storeUnavailable' });
  });

  it('lo escrito está aislado por cuenta', async () => {
    await persistGroup(queue, {
      actorId: ACTOR,
      draft: draft(),
      identities: IDENTITIES,
      creatorName: 'Eduardo',
      currency: CURRENCY_SNAPSHOT,
      createdAt: CREATED_AT,
    });

    expect(await queue.all('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toHaveLength(0);
  });
});

const CENAS = '11111111-1111-4111-8111-111111111111';

describe('la categoría preestablecida en el comando durable', () => {
  it('viaja en el payload, y «Todas» es null', () => {
    const con = buildGroupPayload(draft({ defaultCategoryId: CENAS }), IDENTITIES, 'Eduardo');
    expect(con?.default_category_id).toBe(CENAS);
    expect(payloadDefect('group.create', con!)).toBeNull();
    const todas = buildGroupPayload(draft(), IDENTITIES, 'Eduardo');
    expect(todas?.default_category_id).toBeNull();
    expect(payloadDefect('group.create', todas!)).toBeNull();
  });

  it('un payload ANTERIOR sin el campo sigue siendo válido por forma', () => {
    const antiguo = buildGroupPayload(draft(), IDENTITIES, 'Eduardo')!;
    const { default_category_id: _omitida, ...sinCampo } = antiguo;
    expect(payloadDefect('group.create', sinCampo)).toBeNull();
  });

  it('pero un identificador que no es UUID se rechaza por forma', () => {
    const roto = {
      ...buildGroupPayload(draft(), IDENTITIES, 'Eduardo')!,
      default_category_id: 'todas',
    };
    expect(payloadDefect('group.create', roto)).toBe('badUuid');
  });
});
