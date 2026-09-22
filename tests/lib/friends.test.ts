import { describe, expect, it } from 'vitest';

import {
  byDisplayName,
  incomingRequests,
  newestRequestsFirst,
  outgoingRequests,
  parseFriendRequestRow,
  parseFriendRow,
} from '../../src/features/friends/friend';
import {
  CANDIDATE_IDLE,
  CANDIDATE_RELATIONS,
  type CandidateAnswer,
  candidateAfterCreate,
  candidateAfterSettle,
  candidateFromAnswer,
  type CandidateState,
  candidateStale,
  type CreateAnswer,
  handleToLookup,
} from '../../src/features/friends/friend-candidate';
import {
  failureFrom,
  FRIEND_FAILURE_KEY,
  type FriendFailure,
  settledAfterRefusal,
} from '../../src/features/friends/friend-errors';
import { esES } from '../../src/lib/i18n/messages/es-ES';

/**
 * LA LÓGICA DE AMIGOS, sin React y sin servidor.
 *
 * Lo que se fija aquí es la traducción entre **lo que el servidor dice** y
 * **lo que la pantalla ofrece**: qué fila es una solicitud entrante, qué
 * estado del buscador admite qué botón, y qué pasa cuando la respuesta
 * autoritativa no es la que se pedía —la solicitud cruzada, sobre todo—.
 *
 * Lo que NO se prueba aquí, a propósito: que las vistas publiquen sólo lo
 * vivo. Eso lo garantiza `20260930120000` (`ended_at is null` y el estado
 * derivado `pending`) y lo mide `supabase/checks/friends.sql`; escribir un
 * filtro de cliente para «demostrarlo» sería una segunda copia más débil de
 * una regla que ya tiene dueño.
 */

const ROW = {
  request_id: 'r1',
  direction: 'incoming',
  counterpart_handle: 'edu13',
  counterpart_public_name: 'Eduardo',
  created_at: '2026-09-20T10:00:00Z',
  expires_at: '2026-09-27T10:00:00Z',
};

describe('las filas de las dos vistas', () => {
  it('una amistad se lee entera, y una fila rota se descarta en vez de pintarse a medias', () => {
    expect(
      parseFriendRow({
        friendship_id: 'f1',
        counterpart_handle: 'ana',
        counterpart_public_name: 'Ana',
        since: '2026-09-01T00:00:00Z',
      }),
    ).toEqual({
      friendshipId: 'f1',
      counterpartHandle: 'ana',
      counterpartPublicName: 'Ana',
      since: '2026-09-01T00:00:00Z',
    });
    expect(parseFriendRow({ counterpart_handle: 'ana' })).toBeNull();
  });

  it('la contraparte puede no tener identidad pública ahora mismo, y eso no rompe la fila', () => {
    const friend = parseFriendRow({
      friendship_id: 'f2',
      counterpart_handle: null,
      counterpart_public_name: null,
      since: '2026-09-01T00:00:00Z',
    });
    expect(friend?.counterpartHandle).toBeNull();
    expect(friend?.counterpartPublicName).toBeNull();
  });

  it('una solicitud sin dirección conocida no es una solicitud', () => {
    expect(parseFriendRequestRow(ROW)?.direction).toBe('incoming');
    expect(parseFriendRequestRow({ ...ROW, direction: 'sideways' })).toBeNull();
    expect(parseFriendRequestRow({ ...ROW, request_id: null })).toBeNull();
  });
});

describe('qué va en cada sección', () => {
  const incoming = parseFriendRequestRow(ROW)!;
  const outgoing = parseFriendRequestRow({
    ...ROW,
    request_id: 'r2',
    direction: 'outgoing',
    created_at: '2026-09-21T10:00:00Z',
  })!;

  it('la entrante va a Recibidas y la saliente a Enviadas, y nunca al revés', () => {
    const rows = [incoming, outgoing];
    expect(incomingRequests(rows).map((one) => one.requestId)).toEqual(['r1']);
    expect(outgoingRequests(rows).map((one) => one.requestId)).toEqual(['r2']);
  });

  it('las solicitudes se enseñan de la más nueva a la más vieja', () => {
    expect(newestRequestsFirst([incoming, outgoing]).map((one) => one.requestId)).toEqual([
      'r2',
      'r1',
    ]);
  });

  it('los amigos se ordenan por el nombre que se ve, y el handle manda cuando no hay nombre', () => {
    const rows = [
      { friendshipId: 'c', counterpartHandle: 'zoe', counterpartPublicName: null, since: '' },
      { friendshipId: 'a', counterpartHandle: 'ana', counterpartPublicName: 'Ana', since: '' },
      { friendshipId: 'b', counterpartHandle: 'edu', counterpartPublicName: 'Eduardo', since: '' },
    ];
    expect(byDisplayName(rows).map((one) => one.friendshipId)).toEqual(['a', 'b', 'c']);
  });
});

describe('el buscador: un @username exacto y una sola llamada', () => {
  it('sólo se pregunta por lo que puede ser un handle', () => {
    expect(handleToLookup('')).toBeNull();
    expect(handleToLookup('@')).toBeNull();
    expect(handleToLookup('@edu13')).toEqual({ handle: 'edu13' });
    expect(handleToLookup('Edu 13')).toEqual({ problem: 'invalid' });
    expect(handleToLookup('admin')).toEqual({ problem: 'reserved' });
  });

  it('escribir otra cosa invalida lo que el servidor dijo de la anterior', () => {
    const found: CandidateState = {
      kind: 'found',
      relation: 'none',
      handle: 'edu13',
      publicName: 'Eduardo',
      requestId: null,
    };
    expect(candidateStale(found, '@edu13')).toBe(false);
    expect(candidateStale(found, '@edu14')).toBe(true);
    expect(candidateStale(CANDIDATE_IDLE, '@edu13')).toBe(false);
  });

  /**
   * Los OCHO estados de `api.lookup_friend_candidate`, uno por uno. Son
   * exactamente los que la función devuelve, ni uno más: nada aquí inventa
   * un estado que el servidor no publique.
   */
  it('cada estado del servidor tiene su lectura, y las cinco relaciones traen identidad', () => {
    const plain: CandidateAnswer['state'][] = ['not_found', 'self', 'throttled'];
    for (const state of plain) {
      const read = candidateFromAnswer('edu13', { state } as CandidateAnswer);
      expect(read).toEqual({ kind: state, handle: 'edu13' });
    }
    for (const relation of CANDIDATE_RELATIONS) {
      const read = candidateFromAnswer('edu13', {
        state: relation,
        handle: 'edu13',
        publicName: 'Eduardo',
        requestId: relation.endsWith('_pending') ? 'r1' : null,
      });
      expect(read).toEqual({
        kind: 'found',
        relation,
        handle: 'edu13',
        publicName: 'Eduardo',
        requestId: relation.endsWith('_pending') ? 'r1' : null,
      });
    }
  });

  it('las cinco relaciones son las del servidor y no una lista paralela', () => {
    expect([...CANDIDATE_RELATIONS]).toEqual([
      'none',
      'outgoing_pending',
      'incoming_pending',
      'friends',
      'cooldown',
    ]);
  });
});

describe('enviar una solicitud: se aplica lo que el servidor contestó', () => {
  const found: CandidateState = {
    kind: 'found',
    relation: 'none',
    handle: 'edu13',
    publicName: 'Eduardo',
    requestId: null,
  };

  it('`pending` deja una saliente cancelable, con su id', () => {
    expect(candidateAfterCreate(found, { state: 'pending', requestId: 'r9' })).toEqual({
      ...found,
      relation: 'outgoing_pending',
      requestId: 'r9',
    });
  });

  /**
   * LA CRUZADA. El servidor no insertó nada —la otra parte ya había pedido—
   * y contesta `incoming_pending` con SU id. La pantalla tiene que ofrecer
   * Aceptar y Rechazar, nunca «solicitud enviada»: fingir una saliente que
   * no existe deja un botón de cancelar que no cancela nada.
   */
  it('`incoming_pending` NO es una saliente: es la suya, y se contesta', () => {
    const crossed = candidateAfterCreate(found, { state: 'incoming_pending', requestId: 'r7' });
    expect(crossed).toEqual({ ...found, relation: 'incoming_pending', requestId: 'r7' });
    expect(crossed.kind === 'found' && crossed.relation).not.toBe('outgoing_pending');
  });

  it('`friends`, `cooldown` y `not_found` se dicen tal cual', () => {
    expect(candidateAfterCreate(found, { state: 'friends' })).toMatchObject({
      relation: 'friends',
      requestId: null,
    });
    expect(candidateAfterCreate(found, { state: 'cooldown' })).toMatchObject({
      relation: 'cooldown',
      requestId: null,
    });
    expect(candidateAfterCreate(found, { state: 'not_found' })).toEqual({
      kind: 'not_found',
      handle: 'edu13',
    });
  });

  it('un replay terminal no deja una solicitud viva en pantalla', () => {
    for (const state of ['declined', 'cancelled', 'expired'] as CreateAnswer['state'][]) {
      expect(candidateAfterCreate(found, { state } as CreateAnswer)).toMatchObject({
        relation: 'none',
        requestId: null,
      });
    }
    expect(candidateAfterCreate(found, { state: 'accepted' })).toMatchObject({
      relation: 'friends',
    });
  });
});

describe('contestar desde el buscador', () => {
  const pending: CandidateState = {
    kind: 'found',
    relation: 'incoming_pending',
    handle: 'edu13',
    publicName: 'Eduardo',
    requestId: 'r1',
  };

  it('aceptar deja amistad; rechazar y cancelar dejan «none», nunca un cooldown propio', () => {
    expect(candidateAfterSettle(pending, 'accepted')).toMatchObject({ relation: 'friends' });
    // El cooldown de §7 es del que RECHAZA hacia el que pidió; rechazar lo que
    // a uno le mandan no cierra ninguna puerta propia.
    expect(candidateAfterSettle(pending, 'declined')).toMatchObject({ relation: 'none' });
    expect(candidateAfterSettle(pending, 'cancelled')).toMatchObject({ relation: 'none' });
    expect(candidateAfterSettle(pending, 'gone')).toMatchObject({
      relation: 'none',
      requestId: null,
    });
  });

  it('sin nadie encontrado no hay nada que mover', () => {
    expect(candidateAfterSettle(CANDIDATE_IDLE, 'accepted')).toBe(CANDIDATE_IDLE);
  });
});

describe('los fallos del servidor', () => {
  it('cada código de F12.E.A tiene su frase, y un código desconocido no se enseña', () => {
    const codes: Readonly<Record<string, FriendFailure>> = {
      USERNAME_REQUIRED: 'usernameRequired',
      NOT_AUTHORIZED: 'notAuthorized',
      RECIPIENT_LOOKUP_THROTTLED: 'lookupThrottled',
      FRIEND_REQUEST_RATE_LIMITED: 'rateLimited',
      FRIEND_REQUEST_LIMIT: 'pendingLimit',
      FRIEND_REQUEST_ACCEPTED: 'alreadyAccepted',
      FRIEND_REQUEST_DECLINED: 'alreadyDeclined',
      FRIEND_REQUEST_CANCELLED: 'alreadyCancelled',
    };
    for (const [code, failure] of Object.entries(codes)) {
      expect(failureFrom(409, code), code).toBe(failure);
    }
    expect(failureFrom(500, 'SOMETHING_NEW')).toBe('rejected');
    expect(failureFrom(500, null)).toBe('rejected');
  });

  /** Nada llegó al servidor: no es una negativa, y nada puede darse por hecho. */
  it('el transporte es su propia clase, y gana a cualquier código', () => {
    expect(failureFrom(0, null)).toBe('offline');
    expect(failureFrom(0, 'NOT_AUTHORIZED')).toBe('offline');
  });

  it('un fallo con estado terminal saca la fila de lo pendiente; uno de transporte, no', () => {
    expect(settledAfterRefusal('alreadyAccepted')).toBe(true);
    expect(settledAfterRefusal('alreadyDeclined')).toBe(true);
    expect(settledAfterRefusal('alreadyCancelled')).toBe(true);
    expect(settledAfterRefusal('notAuthorized')).toBe(true);
    expect(settledAfterRefusal('offline')).toBe(false);
    expect(settledAfterRefusal('rejected')).toBe(false);
    expect(settledAfterRefusal('pendingLimit')).toBe(false);
  });

  it('toda clase de fallo tiene una clave que existe en el catálogo', () => {
    for (const key of Object.values(FRIEND_FAILURE_KEY)) {
      expect(Object.keys(esES), key).toContain(key);
    }
  });
});
