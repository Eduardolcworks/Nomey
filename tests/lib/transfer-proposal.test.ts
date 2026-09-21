import { describe, expect, it } from 'vitest';

import {
  compareActivity,
  interleaveActivity,
  transferMoment,
  type WallClock,
} from '../../src/features/transfers/activity';
import {
  incomingPending,
  isActionable,
  isCancellable,
  isRecentDecline,
  newestFirst,
  outgoingDeclined,
  outgoingPending,
  parseProposalRow,
  parseTransferRow,
  stillRelevant,
  type TransferProposal as TransferProposalRow,
} from '../../src/features/transfers/proposal';
import {
  parseSeenDeclines,
  seenDeclinesAfterVisit,
  serializeSeenDeclines,
  unseenDeclines,
} from '../../src/features/transfers/declined-seen';
import {
  handleToResolve,
  RECIPIENT_IDLE,
  recipientFromAnswer,
  recipientStale,
} from '../../src/features/transfers/recipient';
import {
  FAILURE_KEY,
  failureFrom,
  stateAfterRefusal,
} from '../../src/features/transfers/transfer-errors';

/**
 * F12.C — the pure part of `features/transfers`: what the two views publish,
 * what can be done about it, how a transfer lands among the movements, and
 * how a refusal is read. Nothing here touches React or Supabase.
 */

const proposalRow = (extra: Record<string, unknown> = {}) => ({
  proposal_id: 'p-1',
  direction: 'incoming',
  counterpart_handle: 'ana',
  counterpart_public_name: 'Ana',
  amount: '2500',
  currency_definition_id: 'eur',
  concept: 'Cena',
  created_at: '2026-09-20T10:00:00Z',
  expires_at: '2026-09-27T10:00:00Z',
  state: 'pending',
  accepted_operation_id: null,
  ...extra,
});

describe('la propuesta, tal como la publica api.my_transfer_proposals', () => {
  it('se lee de la fila con dirección y estado, y nunca con created_by', () => {
    const one = parseProposalRow(proposalRow());
    expect(one).not.toBeNull();
    expect(one?.direction).toBe('incoming');
    expect(one?.state).toBe('pending');
    expect(one?.amountMinor).toBe('2500');
    expect(one?.counterpartHandle).toBe('ana');
    expect(Object.keys(one ?? {})).not.toContain('createdBy');
  });

  it('una fila malformada se descarta en vez de inventarse', () => {
    expect(parseProposalRow(proposalRow({ direction: 'sideways' }))).toBeNull();
    expect(parseProposalRow(proposalRow({ state: 'lost' }))).toBeNull();
    expect(parseProposalRow(proposalRow({ amount: 2500 }))).toBeNull();
    expect(parseProposalRow(proposalRow({ proposal_id: null }))).toBeNull();
  });

  it('el receptor actúa sólo sobre una entrante pendiente; el emisor cancela sólo una saliente pendiente', () => {
    const incoming = parseProposalRow(proposalRow())!;
    const accepted = parseProposalRow(proposalRow({ state: 'accepted' }))!;
    const sent = parseProposalRow(proposalRow({ direction: 'outgoing', proposal_id: 'p-2' }))!;
    const sentDone = parseProposalRow(
      proposalRow({ direction: 'outgoing', state: 'declined', proposal_id: 'p-3' }),
    )!;

    expect(isActionable(incoming)).toBe(true);
    expect(isActionable(accepted)).toBe(false);
    expect(isActionable(sent)).toBe(false);
    expect(isCancellable(sent)).toBe(true);
    expect(isCancellable(sentDone)).toBe(false);
    expect(isCancellable(incoming)).toBe(false);

    expect(incomingPending([incoming, accepted, sent, sentDone])).toEqual([incoming]);
    // La pantalla no es un histórico: de lo enviado sólo queda lo pendiente.
    expect(outgoingPending([incoming, accepted, sent, sentDone])).toEqual([sent]);
    const now = '2026-09-21T10:00:00Z';
    // Y el rechazo reciente de una propia sigue vivo: es la novedad que se enseña.
    expect(stillRelevant([incoming, accepted, sent, sentDone], now)).toEqual([
      incoming,
      sent,
      sentDone,
    ]);
  });

  it('se ordena de la más nueva a la más vieja, con el id como desempate', () => {
    const a = parseProposalRow(
      proposalRow({ proposal_id: 'a', created_at: '2026-09-20T10:00:00Z' }),
    )!;
    const b = parseProposalRow(
      proposalRow({ proposal_id: 'b', created_at: '2026-09-21T10:00:00Z' }),
    )!;
    const c = parseProposalRow(
      proposalRow({ proposal_id: 'c', created_at: '2026-09-20T10:00:00Z' }),
    )!;
    expect(newestFirst([a, b, c]).map((one) => one.proposalId)).toEqual(['b', 'a', 'c']);
  });
});

describe('la transferencia, tal como la publica api.my_transfers', () => {
  const row = {
    operation_id: 'op-1',
    scope_id: 'personal-a',
    currency_definition_id: 'eur',
    balance_amount: '-2500',
    direction: 'outgoing',
    amount: '2500',
    effective_date: '2026-09-20',
    effective_time: '10:15:00',
    concept: 'Cena',
    counterpart_handle: 'bea',
    counterpart_public_name: 'Bea',
    proposal_id: 'p-1',
    operation_created_at: '2026-09-20T10:15:00Z',
    payment_request_id: null,
    group_scope_id: null,
    group_transfer_proposal_id: null,
  };

  it('conserva el signo del balance y la dirección del servidor', () => {
    const one = parseTransferRow(row);
    expect(one?.balanceAmount).toBe('-2500');
    expect(one?.direction).toBe('outgoing');
    expect(one?.groupScopeId).toBeNull();
  });

  it('una fila sin balance o con dirección desconocida se descarta', () => {
    expect(parseTransferRow({ ...row, balance_amount: null })).toBeNull();
    expect(parseTransferRow({ ...row, direction: 'both' })).toBeNull();
  });
});

describe('las transferencias entre los movimientos', () => {
  type Key = {
    effectiveDate: string;
    effectiveTime: string | null;
    createdAt: string;
    id: string;
  };
  const key = (k: Key) => k;

  it('el orden es el de personal_operation: fecha, hora con nulos al final, creación, id; todo descendente', () => {
    const later = { effectiveDate: '2026-09-21', effectiveTime: null, createdAt: 'x', id: '1' };
    const earlier = {
      effectiveDate: '2026-09-20',
      effectiveTime: '23:00',
      createdAt: 'x',
      id: '1',
    };
    expect(compareActivity(later, earlier)).toBeLessThan(0);

    const timed = { effectiveDate: '2026-09-20', effectiveTime: '09:00', createdAt: 'x', id: '1' };
    const untimed = { effectiveDate: '2026-09-20', effectiveTime: null, createdAt: 'x', id: '1' };
    expect(compareActivity(timed, untimed)).toBeLessThan(0);

    const newer = { effectiveDate: '2026-09-20', effectiveTime: null, createdAt: 'b', id: '1' };
    const older = { effectiveDate: '2026-09-20', effectiveTime: null, createdAt: 'a', id: '1' };
    expect(compareActivity(newer, older)).toBeLessThan(0);
    expect(compareActivity(older, older)).toBe(0);
  });

  it('intercala por esa clave cuando todas las páginas están cargadas', () => {
    const ops = [
      { effectiveDate: '2026-09-22', effectiveTime: null, createdAt: 'c', id: 'op-c' },
      { effectiveDate: '2026-09-20', effectiveTime: null, createdAt: 'a', id: 'op-a' },
    ];
    const transfers = [
      { effectiveDate: '2026-09-21', effectiveTime: '12:00', createdAt: 'b', id: 'tr-b' },
      { effectiveDate: '2026-09-19', effectiveTime: null, createdAt: 'z', id: 'tr-z' },
    ];
    const merged = interleaveActivity(ops, transfers, key, key, false);
    expect(
      merged.map((one) => (one.kind === 'operation' ? one.operation.id : one.transfer.id)),
    ).toEqual(['op-c', 'tr-b', 'op-a', 'tr-z']);
  });

  it('con páginas por cargar, una transferencia más vieja que la última fila cargada espera', () => {
    const ops = [
      { effectiveDate: '2026-09-22', effectiveTime: null, createdAt: 'c', id: 'op-c' },
      { effectiveDate: '2026-09-20', effectiveTime: null, createdAt: 'a', id: 'op-a' },
    ];
    const transfers = [
      { effectiveDate: '2026-09-21', effectiveTime: '12:00', createdAt: 'b', id: 'tr-b' },
      { effectiveDate: '2026-09-19', effectiveTime: null, createdAt: 'z', id: 'tr-z' },
    ];
    const merged = interleaveActivity(ops, transfers, key, key, true);
    expect(
      merged.map((one) => (one.kind === 'operation' ? one.operation.id : one.transfer.id)),
    ).toEqual(['op-c', 'tr-b', 'op-a']);
  });

  it('sin operaciones cargadas se enseñan las transferencias tal cual', () => {
    const transfers = [
      { effectiveDate: '2026-09-19', effectiveTime: null, createdAt: 'z', id: 'tr-z' },
    ];
    expect(interleaveActivity([], transfers, key, key, true)).toHaveLength(1);
  });
});

describe('el destinatario, antes y después de preguntar al servidor', () => {
  it('el texto se normaliza con la regla de domain/username, con o sin @', () => {
    expect(handleToResolve('@Ana')).toEqual({ handle: 'ana' });
    expect(handleToResolve('  bea_2 ')).toEqual({ handle: 'bea_2' });
    expect(handleToResolve('')).toBeNull();
    expect(handleToResolve('@')).toBeNull();
    expect(handleToResolve('ab')).toEqual({ problem: 'invalid' });
    expect(handleToResolve('nomey')).toEqual({ problem: 'reserved' });
  });

  it('la respuesta del resolver se guarda como estado, y sólo found trae identidad', () => {
    expect(
      recipientFromAnswer('ana', { state: 'found', handle: 'ana', publicName: 'Ana' }),
    ).toEqual({ kind: 'found', handle: 'ana', publicName: 'Ana' });
    expect(recipientFromAnswer('ana', { state: 'not_found' })).toEqual({
      kind: 'not_found',
      handle: 'ana',
    });
    expect(recipientFromAnswer('ana', { state: 'throttled' })).toEqual({
      kind: 'throttled',
      handle: 'ana',
    });
    expect(recipientFromAnswer('ana', { state: 'self' })).toEqual({ kind: 'self', handle: 'ana' });
  });

  it('escribir otro handle invalida lo que el servidor dijo del anterior', () => {
    const found = recipientFromAnswer('ana', { state: 'found', handle: 'ana', publicName: 'Ana' });
    expect(recipientStale(found, 'ana')).toBe(false);
    expect(recipientStale(found, '@ANA')).toBe(false);
    expect(recipientStale(found, 'anab')).toBe(true);
    expect(recipientStale(found, '')).toBe(true);
    expect(recipientStale(RECIPIENT_IDLE, 'x')).toBe(false);
  });
});

describe('las refusals de la frontera, en palabras', () => {
  it('status 0 es transporte, cada código tiene su frase y lo desconocido es genérico', () => {
    expect(failureFrom(0, null)).toBe('offline');
    expect(failureFrom(409, 'PROPOSAL_ACCEPTED')).toBe('alreadyAccepted');
    expect(failureFrom(409, 'PROPOSAL_LIMIT_PER_TARGET')).toBe('pairLimit');
    expect(failureFrom(429, 'RECIPIENT_LOOKUP_THROTTLED')).toBe('lookupThrottled');
    expect(failureFrom(422, 'CURRENCY_CONVERSION_UNSUPPORTED')).toBe('currency');
    expect(failureFrom(500, 'SOMETHING_NEW')).toBe('rejected');
    expect(failureFrom(400, null)).toBe('rejected');
  });

  it('cada fallo apunta a una clave de mensaje, y ninguna es el código', () => {
    for (const key of Object.values(FAILURE_KEY)) {
      expect(key).toMatch(/^transfer\.error[A-Z]/);
    }
  });

  it('un rechazo por estado terminal dice a qué estado se movió; los demás, a ninguno', () => {
    expect(stateAfterRefusal('alreadyAccepted')).toBe('accepted');
    expect(stateAfterRefusal('alreadyDeclined')).toBe('declined');
    expect(stateAfterRefusal('alreadyCancelled')).toBe('cancelled');
    expect(stateAfterRefusal('expired')).toBe('expired');
    expect(stateAfterRefusal('offline')).toBeNull();
    expect(stateAfterRefusal('rateLimited')).toBeNull();
  });
});

describe('el momento de una transferencia, en el reloj del aparato', () => {
  /** Un aparato dos horas por delante de UTC (Madrid en verano). */
  const madrid: WallClock = (instant) => {
    const shifted = new Date(instant.getTime() + 2 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${String(shifted.getUTCFullYear())}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
      time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    };
  };

  it('sale del instante de aceptación, no de la hora UTC que escribió el servidor', () => {
    const moment = transferMoment(
      {
        operationCreatedAt: '2026-09-20T15:34:51.180Z',
        effectiveDate: '2026-09-20',
        effectiveTime: '15:34:51',
      },
      madrid,
    );
    expect(moment).toEqual({ effectiveDate: '2026-09-20', effectiveTime: '17:34' });
  });

  it('cruza la medianoche local aunque el servidor siga en el día anterior', () => {
    const moment = transferMoment(
      {
        operationCreatedAt: '2026-09-20T22:30:00Z',
        effectiveDate: '2026-09-20',
        effectiveTime: '22:30:00',
      },
      madrid,
    );
    expect(moment).toEqual({ effectiveDate: '2026-09-21', effectiveTime: '00:30' });
  });

  it('con un instante ilegible se queda con lo que publicó la vista', () => {
    expect(
      transferMoment(
        { operationCreatedAt: 'nope', effectiveDate: '2026-09-20', effectiveTime: '15:34:51' },
        madrid,
      ),
    ).toEqual({ effectiveDate: '2026-09-20', effectiveTime: '15:34' });
  });

  it('una transferencia aceptada ahora es el movimiento más reciente, y un movimiento posterior la adelanta', () => {
    type Op = {
      id: string;
      effectiveDate: string;
      effectiveTime: string | null;
      createdAt: string;
    };
    const keyOfOp = (op: Op) => op;
    // Dos movimientos antiguos registrados desde el aparato, con su hora local.
    const oldA: Op = {
      id: 'A',
      effectiveDate: '2026-09-19',
      effectiveTime: '10:00:00',
      createdAt: '2026-09-19T08:00:00Z',
    };
    const oldB: Op = {
      id: 'B',
      effectiveDate: '2026-09-20',
      effectiveTime: '17:25:00',
      createdAt: '2026-09-20T15:25:54Z',
    };
    // La transferencia aceptada a las 17:34 locales: el servidor escribió 15:34 (UTC).
    const transfer = {
      operationId: 'T',
      operationCreatedAt: '2026-09-20T15:34:51Z',
      effectiveDate: '2026-09-20',
      effectiveTime: '15:34:51',
    };
    const keyOfTransfer = (one: typeof transfer) => ({
      ...transferMoment(one, madrid),
      createdAt: one.operationCreatedAt,
      id: one.operationId,
    });

    const order = (ops: Op[]) =>
      interleaveActivity(ops, [transfer], keyOfOp, keyOfTransfer, false).map((entry) =>
        entry.kind === 'operation' ? entry.operation.id : entry.transfer.operationId,
      );

    expect(order([oldB, oldA])).toEqual(['T', 'B', 'A']);

    // Con la hora UTC tal cual, la transferencia habría quedado debajo de B.
    const naive = interleaveActivity(
      [oldB, oldA],
      [transfer],
      keyOfOp,
      (one) => ({
        effectiveDate: one.effectiveDate,
        effectiveTime: one.effectiveTime,
        createdAt: one.operationCreatedAt,
        id: one.operationId,
      }),
      false,
    ).map((entry) =>
      entry.kind === 'operation' ? entry.operation.id : entry.transfer.operationId,
    );
    expect(naive).toEqual(['B', 'T', 'A']);

    // Y un movimiento todavía más nuevo pasa a ser el primero.
    const newer: Op = {
      id: 'C',
      effectiveDate: '2026-09-20',
      effectiveTime: '18:05:00',
      createdAt: '2026-09-20T16:05:00Z',
    };
    expect(order([newer, oldB, oldA])).toEqual(['C', 'T', 'B', 'A']);
  });

  it('las horas se comparan al minuto: «17:25» y «17:25:00» son la misma', () => {
    const a = { effectiveDate: '2026-09-20', effectiveTime: '17:25', createdAt: 'b', id: '1' };
    const b = { effectiveDate: '2026-09-20', effectiveTime: '17:25:00', createdAt: 'a', id: '1' };
    // Igual hora → decide la creación: `a` es más nuevo.
    expect(compareActivity(a, b)).toBeLessThan(0);
  });
});

describe('la campana y las propuestas: sólo una ENTRANTE pendiente la enciende', () => {
  const incomingOf = (id: string) =>
    parseProposalRow(proposalRow({ proposal_id: id, direction: 'incoming', state: 'pending' }))!;
  const hasPending = (rows: readonly TransferProposalRow[], settled: ReadonlySet<string>) =>
    incomingPending(rows.filter((one) => !settled.has(one.proposalId))).length > 0;

  it('sin pendientes no hay punto; una entrante pendiente lo enciende; abrir Notificaciones no lo toca', () => {
    expect(hasPending([], new Set())).toBe(false);
    const one = [incomingOf('a')];
    expect(hasPending(one, new Set())).toBe(true);
    // Nothing in the model represents "opened": the same list gives the same answer.
    expect(hasPending(one, new Set())).toBe(true);
  });

  it('con tres pendientes sigue encendido hasta resolver la última, sea aceptando o rechazando', () => {
    const three = [incomingOf('a'), incomingOf('b'), incomingOf('c')];
    expect(hasPending(three, new Set(['a']))).toBe(true);
    expect(hasPending(three, new Set(['a', 'b']))).toBe(true);
    expect(hasPending(three, new Set(['a', 'b', 'c']))).toBe(false);
    // And the authoritative reload agrees: terminal rows are not pending.
    const reloaded = [
      parseProposalRow(proposalRow({ proposal_id: 'a', state: 'accepted' }))!,
      parseProposalRow(proposalRow({ proposal_id: 'b', state: 'declined' }))!,
    ];
    expect(hasPending(reloaded, new Set())).toBe(false);
  });

  it('una propuesta SALIENTE pendiente no enciende el punto', () => {
    const sent = [parseProposalRow(proposalRow({ proposal_id: 's', direction: 'outgoing' }))!];
    expect(hasPending(sent, new Set())).toBe(false);
    expect(outgoingPending(sent)).toHaveLength(1);
  });
});

describe('el rechazo de una propuesta propia: la única terminal que se cuenta', () => {
  const NOW = '2026-09-21T10:00:00Z';
  const declined = (extra: Record<string, unknown> = {}) =>
    parseProposalRow(proposalRow({ direction: 'outgoing', state: 'declined', ...extra }))!;

  it('A propone, B rechaza: para B desaparece; para A es un aviso reciente, sin acción', () => {
    // B's side: the view does not publish a declined incoming row at all; and
    // even if it did, it is neither actionable nor relevant.
    const forB = parseProposalRow(proposalRow({ direction: 'incoming', state: 'declined' }))!;
    expect(isActionable(forB)).toBe(false);
    expect(stillRelevant([forB], NOW)).toEqual([]);
    expect(isRecentDecline(forB, NOW)).toBe(false);
    // A's side: outgoing + declined, within the window → news; no button.
    const forA = declined({ proposal_id: 'd-1' });
    expect(isRecentDecline(forA, NOW)).toBe(true);
    expect(stillRelevant([forA], NOW)).toEqual([forA]);
    expect(outgoingDeclined([forA], NOW)).toEqual([forA]);
    expect(isActionable(forA)).toBe(false);
    expect(isCancellable(forA)).toBe(false);
    expect(incomingPending([forA])).toEqual([]);
    expect(outgoingPending([forA])).toEqual([]);
  });

  it('se acota con expires_at: pasada la ventana es historia, no novedad', () => {
    const old = declined({ expires_at: '2026-09-21T09:59:59Z' });
    expect(isRecentDecline(old, NOW)).toBe(false);
    expect(stillRelevant([old], NOW)).toEqual([]);
    // Nothing else terminal is news: accepted, cancelled, expired.
    for (const state of ['accepted', 'cancelled', 'expired']) {
      const other = parseProposalRow(proposalRow({ direction: 'outgoing', state }))!;
      expect(isRecentDecline(other, NOW)).toBe(false);
    }
  });

  it('las entrantes pendientes conservan su semántica: pendiente, no «no visto»', () => {
    const pending = parseProposalRow(proposalRow({ proposal_id: 'in-1' }))!;
    // Marking declines seen never touches an incoming pending proposal: the
    // seen-set only knows ids of declined rows, and pending ones are not in it.
    const seen = seenDeclinesAfterVisit(
      new Set(),
      [declined({ proposal_id: 'd-1' })],
      ['d-1', 'in-1'],
    );
    expect([...seen]).toEqual(['d-1']);
    expect(incomingPending([pending])).toEqual([pending]);
    expect(isActionable(pending)).toBe(true);
  });

  it('abrir Notificaciones marca como vista sólo la novedad, y la campana combina las fuentes', () => {
    const d1 = declined({ proposal_id: 'd-1' });
    const d2 = declined({ proposal_id: 'd-2' });
    const incoming = parseProposalRow(proposalRow({ proposal_id: 'in-1' }))!;

    // Before the visit: two unseen declines light the informative dot.
    let seen = parseSeenDeclines(null);
    expect(unseenDeclines([d1, d2], seen)).toEqual([d1, d2]);
    const bell = (incidents: number, notices: number) =>
      incidents > 0 ||
      notices > 0 ||
      incomingPending([incoming]).length > 0 ||
      unseenDeclines([d1, d2], seen).length > 0;
    expect(bell(0, 0)).toBe(true);

    // The visit marks exactly what was shown; the dot for declines goes out.
    seen = seenDeclinesAfterVisit(seen, [d1, d2], ['d-1', 'd-2']);
    expect(unseenDeclines([d1, d2], seen)).toEqual([]);
    // …but the incoming pending one still lights the bell: it was not marked, it cannot be.
    expect(bell(0, 0)).toBe(true);
    expect(incomingPending([incoming])).toHaveLength(1);
    // With nothing pending and nothing new, only incidents/notices remain.
    const quiet = () => unseenDeclines([d1, d2], seen).length > 0 || incomingPending([]).length > 0;
    expect(quiet()).toBe(false);

    // A decline that arrives later is new again.
    const d3 = declined({ proposal_id: 'd-3' });
    expect(unseenDeclines([d1, d2, d3], seen)).toEqual([d3]);
  });

  it('la marca se guarda como ids ordenados, se poda a lo que sigue publicado y sobrevive a un documento roto', () => {
    const seen = seenDeclinesAfterVisit(
      new Set(['gone', 'd-2']),
      [declined({ proposal_id: 'd-2' }), declined({ proposal_id: 'd-1' })],
      ['d-1'],
    );
    expect(serializeSeenDeclines(seen)).toBe('["d-1","d-2"]');
    expect([...parseSeenDeclines('["d-1","d-2"]')]).toEqual(['d-1', 'd-2']);
    expect(parseSeenDeclines('{')).toEqual(new Set());
    expect(parseSeenDeclines('[1, "x"]')).toEqual(new Set(['x']));
    expect(parseSeenDeclines(null).size).toBe(0);
  });
});
