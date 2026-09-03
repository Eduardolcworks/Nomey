import { describe, expect, it } from 'vitest';

import {
  classifyResponse,
  type SessionStatus,
  type TransportOutcome,
} from '../../src/lib/offline/response';

/**
 * LA CLASIFICACIÓN, CONTRA LO MEDIDO.
 *
 * Cada caso de aquí reproduce una fila de `scripts/offline-taxonomy-probe.sh`,
 * medida contra el stack real. No hay ninguna tripleta inventada: si una fila
 * cambia en el servidor, la sonda lo enseña y este fichero se actualiza con
 * ella.
 */

const DENTRO: SessionStatus = 'signed-in';

const clasificar = (outcome: TransportOutcome, session: SessionStatus = DENTRO) =>
  classifyResponse(outcome, session);

describe('éxito y replay', () => {
  it('200 con already_processed false confirma', () => {
    const c = clasificar({ kind: 'ok', operationId: 'op-1', alreadyProcessed: false });
    expect(c.responseClass).toBe('success');
    expect(c.state).toBe('confirmed');
  });

  it('200 con already_processed true TAMBIÉN confirma', () => {
    // Es el caso que ADR-010 existe para producir: el reintento de algo que ya
    // se escribió no es un error ni un duplicado, es la confirmación.
    const c = clasificar({ kind: 'ok', operationId: 'op-1', alreadyProcessed: true });
    expect(c.state).toBe('confirmed');
  });
});

describe('resultado desconocido — nunca terminal', () => {
  it.each(['offline', 'timeout', 'transport'] as const)('sin respuesta (%s) es retryable', (r) => {
    const c = clasificar({ kind: 'unreachable', reason: r });
    expect(c.responseClass).toBe('transport');
    expect(c.state).toBe('retryable');
  });

  it.each([408, 429, 500, 502, 503, 504])('%i es retryable', (status) => {
    expect(clasificar({ kind: 'http', status, code: null }).state).toBe('retryable');
  });

  it('un 5xx con código de frontera sigue siendo transporte', () => {
    // El estado manda: un 500 no demuestra que no se escribiera nada.
    expect(clasificar({ kind: 'http', status: 500, code: 'PAYLOAD_INVALID' }).state).toBe(
      'retryable',
    );
  });
});

describe('`42501` no es «sesión caducada», y se decide por estado', () => {
  it('MEDIDO: sin JWT llega 401 con código 42501 → autenticación', () => {
    const c = clasificar({ kind: 'http', status: 401, code: '42501' });
    expect(c.responseClass).toBe('authRecoverable');
    expect(c.state).toBe('blocked_session');
  });

  it('MEDIDO: un JWT inválido llega 401 con PGRST301 → autenticación', () => {
    expect(clasificar({ kind: 'http', status: 401, code: 'PGRST301' }).state).toBe(
      'blocked_session',
    );
  });

  it('MEDIDO: el ámbito ajeno llega 403 NOT_AUTHORIZED → autorización PERMANENTE', () => {
    const c = clasificar({ kind: 'http', status: 403, code: 'NOT_AUTHORIZED' });
    expect(c.responseClass).toBe('authorizationPermanent');
    expect(c.state).toBe('rejected');
  });

  it('UN 403 CON 42501 CRUDO TAMBIÉN ES PERMANENTE, no sesión', () => {
    /*
     * No se pudo producir contra el stack —la frontera autoriza antes y
     * responde `NOT_AUTHORIZED`— así que se trata por el estado, que es la
     * lectura conservadora: reintentarlo sería un bucle.
     */
    expect(clasificar({ kind: 'http', status: 403, code: '42501' }).state).toBe('rejected');
  });

  it('sin sesión local, cualquier respuesta es de sesión', () => {
    for (const session of ['signed-out', 'restoring', 'unavailable'] as const) {
      expect(
        clasificar({ kind: 'http', status: 400, code: 'PAYLOAD_INVALID' }, session).state,
      ).toBe('blocked_session');
    }
  });
});

describe('terminales con ausencia de efectos demostrable', () => {
  it('MEDIDO: 400 PAYLOAD_INVALID', () => {
    const c = clasificar({ kind: 'http', status: 400, code: 'PAYLOAD_INVALID' });
    expect(c.responseClass).toBe('payloadInvalid');
    expect(c.state).toBe('rejected');
  });

  it('MEDIDO: 422 CATEGORY_NOT_USABLE', () => {
    const c = clasificar({ kind: 'http', status: 422, code: 'CATEGORY_NOT_USABLE' });
    expect(c.responseClass).toBe('domainRejection');
    expect(c.state).toBe('rejected');
  });

  it('MEDIDO: 422 CURRENCY_CONVERSION_UNSUPPORTED es conflicto, no rechazo', () => {
    const c = clasificar({ kind: 'http', status: 422, code: 'CURRENCY_CONVERSION_UNSUPPORTED' });
    expect(c.responseClass).toBe('currencyConflict');
    expect(c.state).toBe('conflict');
  });

  it('las otras dos monedas caen igual', () => {
    for (const code of ['CURRENCY_NOT_SUPPORTED', 'CURRENCY_CODE_AMBIGUOUS']) {
      expect(clasificar({ kind: 'http', status: 422, code }).state).toBe('conflict');
    }
  });
});

describe('lo indemostrable va a revisión, nunca a rechazo', () => {
  it('MEDIDO: 409 IDEMPOTENCY_KEY_REUSED', () => {
    /*
     * Esa clave la usó otra intención, así que **no se puede demostrar** que no
     * haya efectos. Proponer repetir el gasto crearía otra clave sobre una
     * operación que podría existir: duplicaría dinero.
     */
    const c = clasificar({ kind: 'http', status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(c.responseClass).toBe('idempotencyConflict');
    expect(c.state).toBe('review');
  });

  it('un 4xx sin código no se da por rechazado', () => {
    expect(clasificar({ kind: 'http', status: 418, code: null }).state).toBe('review');
    expect(clasificar({ kind: 'http', status: 400, code: null }).state).toBe('review');
  });

  it('ninguna respuesta acaba jamás en un estado que no exista', () => {
    const admisibles = [
      'confirmed',
      'retryable',
      'blocked_session',
      'rejected',
      'review',
      'conflict',
    ];
    for (const status of [200, 400, 401, 403, 404, 409, 418, 422, 429, 500, 599]) {
      for (const code of [null, 'PAYLOAD_INVALID', 'X', '42501']) {
        expect(admisibles).toContain(clasificar({ kind: 'http', status, code }).state);
      }
    }
  });
});
