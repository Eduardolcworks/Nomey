import { describe, expect, it } from 'vitest';

import type { GroupOperation, GroupPayment } from '../../src/features/groups';
import { mergeTimeline } from '../../src/features/groups/group-timeline';

/**
 * MOVIMIENTOS ES UNA SOLA CRONOLOGIA: «Saldado» (pagos registrados) se ordena
 * junto a los gastos por la fecha y la hora reales, nunca agrupado por tipo,
 * y el desempate es el estable de siempre.
 */
function expense(
  id: string,
  date: string,
  time: string | null,
  minor: string,
  createdAt = '2026-09-01T00:00:00Z',
): GroupOperation {
  return {
    operationId: id,
    versionId: `${id}-v`,
    concept: id,
    categoryId: null,
    originalCurrencyId: null,
    effectiveDate: date,
    effectiveTime: time,
    totalMinor: minor,
    yourShareMinor: null,
    payerParticipantId: null,
    splitMethod: null,
    previousMinor: null,
    versionNo: 1,
    createdAt,
  };
}

function payment(
  id: string,
  date: string,
  time: string | null,
  minor: string,
  createdAt = '2026-09-01T00:00:00Z',
): GroupPayment {
  return {
    operationId: id,
    versionId: `${id}-v`,
    scopeId: 'g',
    payerParticipantId: 'a',
    receiverParticipantId: 'b',
    amountMinor: minor,
    effectiveDate: date,
    effectiveTime: time,
    recordedByMe: false,
    declaredByReceiver: false,
    annulled: false,
    createdAt,
  };
}

const ids = (entries: ReturnType<typeof mergeTimeline>) =>
  entries.map((one) =>
    one.kind === 'expense' ? one.operation.operationId : one.payment.operationId,
  );

describe('mergeTimeline', () => {
  const g10 = expense('gasto-10', '2026-09-10', '12:00:00', '1000');
  const s11 = payment('saldado-11', '2026-09-11', '09:00:00', '500');
  const g12 = expense('gasto-12', '2026-09-12', '20:00:00', '2000');

  it('10 sep gasto · 11 sep Saldado · 12 sep gasto: el pago va ENTRE los gastos, no aparte', () => {
    expect(ids(mergeTimeline([g12, g10], [s11], 'dateDesc'))).toEqual([
      'gasto-12',
      'saldado-11',
      'gasto-10',
    ]);
    expect(ids(mergeTimeline([g12, g10], [s11], 'dateAsc'))).toEqual([
      'gasto-10',
      'saldado-11',
      'gasto-12',
    ]);
  });

  it('dentro del dia ordena la hora, y los sin hora van al final en los dos sentidos', () => {
    const morning = expense('manana', '2026-09-11', '08:00:00', '100');
    const noHour = payment('sin-hora', '2026-09-11', null, '100');
    const evening = payment('tarde', '2026-09-11', '21:00:00', '100');
    expect(ids(mergeTimeline([morning], [noHour, evening], 'dateDesc'))).toEqual([
      'tarde',
      'manana',
      'sin-hora',
    ]);
    expect(ids(mergeTimeline([morning], [noHour, evening], 'dateAsc'))).toEqual([
      'manana',
      'tarde',
      'sin-hora',
    ]);
  });

  it('a igual fecha y hora desempata por alta mas reciente y despues por identidad, en cualquier orden', () => {
    const a = expense('b-op', '2026-09-11', '10:00:00', '100', '2026-09-11T10:00:00Z');
    const b = payment('a-op', '2026-09-11', '10:00:00', '100', '2026-09-11T10:00:00Z');
    const later = payment('c-op', '2026-09-11', '10:00:00', '100', '2026-09-11T10:00:05Z');
    for (const order of ['dateDesc', 'dateAsc', 'amountDesc', 'amountAsc'] as const) {
      expect(ids(mergeTimeline([a], [b, later], order))).toEqual(['c-op', 'a-op', 'b-op']);
    }
  });

  it('por importe mezcla gastos y pagos por su importe entero, como bigint', () => {
    const big = expense('grande', '2026-09-01', null, '10000000000000000000');
    const small = payment('pequeno', '2026-09-02', null, '999');
    const mid = payment('medio', '2026-09-03', null, '1000');
    expect(ids(mergeTimeline([big], [small, mid], 'amountDesc'))).toEqual([
      'grande',
      'medio',
      'pequeno',
    ]);
    expect(ids(mergeTimeline([big], [small, mid], 'amountAsc'))).toEqual([
      'pequeno',
      'medio',
      'grande',
    ]);
  });

  it('sin pagos es la lista de gastos tal cual; sin gastos, los pagos', () => {
    expect(ids(mergeTimeline([g12, g10], [], 'dateDesc'))).toEqual(['gasto-12', 'gasto-10']);
    expect(ids(mergeTimeline([], [s11], 'dateDesc'))).toEqual(['saldado-11']);
  });
});
