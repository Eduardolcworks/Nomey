import { describe, expect, it } from 'vitest';

import type {
  GroupOperation,
  GroupPayment,
  GroupTransferOperation,
} from '../../src/features/groups';
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

/**
 * UNA TRANSFERENCIA DE GRUPO, con tantos destinatarios como se le pasen.
 *
 * `shares` existe para poder fijar lo que más importa del multi-destinatario:
 * que tres cuotas NO son tres filas ni tres posiciones de orden.
 */
function transfer(
  id: string,
  date: string,
  time: string | null,
  minor: string,
  createdAt = '2026-09-01T00:00:00Z',
  receivers: readonly string[] = ['uno'],
): GroupTransferOperation {
  return {
    operationId: id,
    versionId: `${id}-v`,
    scopeId: 'g',
    senderParticipantId: 'a',
    senderDisplayName: 'Edu',
    isSender: true,
    totalMinor: minor,
    currencyDefinitionId: 'eur',
    effectiveDate: date,
    effectiveTime: time,
    concept: null,
    createdAt,
    shares: receivers.map((who, index) => ({
      ordinal: index + 1,
      receiverParticipantId: `p-${who}`,
      receiverDisplayName: who,
      isReceiver: false,
      amountMinor: String(BigInt(minor) / BigInt(receivers.length)),
    })),
  };
}

const ids = (entries: ReturnType<typeof mergeTimeline>) =>
  entries.map((one) =>
    one.kind === 'expense'
      ? one.operation.operationId
      : one.kind === 'payment'
        ? one.payment.operationId
        : one.transfer.operationId,
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

/**
 * ═══════════ EL ORDEN DE UNA TRANSFERENCIA REGISTRADA ═══════════
 *
 * Bloque nacido de un fallo real en iPhone: una transferencia recién
 * registrada aparecía POR DEBAJO de gastos anteriores.
 *
 * **La causa no era este comparador.** Era que el writer tomaba la fecha y la
 * hora del reloj del SERVIDOR, que corre en UTC: una transferencia hecha a las
 * 21:30 en Madrid se guardaba como las 19:30 y caía por debajo de lo que se
 * había registrado esa misma tarde. El gasto compartido y el pago declarado
 * siempre tomaron las del aparato. Corregido eso, los tres comparten reloj.
 *
 * Lo que se fija aquí es lo que el comparador tiene que garantizar una vez los
 * tres hablan de lo mismo.
 */
describe('la transferencia, en la misma cronología', () => {
  /** Lo reciente arriba, sin importar de qué clase sea cada cosa. */
  it('una transferencia de hoy va por encima de lo de ayer', () => {
    const ayer = expense('gasto-ayer', '2026-09-23', '22:00', '5000');
    const pago = payment('pago-ayer', '2026-09-23', '23:30', '2500');
    const hoy = transfer('transfer-hoy', '2026-09-24', '19:30', '1000');
    expect(ids(mergeTimeline([ayer], [pago], 'dateDesc', [hoy]))).toEqual([
      'transfer-hoy',
      'pago-ayer',
      'gasto-ayer',
    ]);
  });

  /**
   * EL CASO DEL FALLO, con los números reales que quedaron en la base: un
   * gasto registrado a las 18:24 y dos transferencias a las 19:39 y 19:40.
   * Con el mismo reloj, las transferencias quedan arriba.
   */
  it('tres registradas la misma tarde salen en orden de reloj', () => {
    const gasto = expense('gasto-1824', '2026-09-24', '18:24', '1200');
    const t1 = transfer('transfer-1939', '2026-09-24', '19:39', '2500');
    const t2 = transfer('transfer-1940', '2026-09-24', '19:40', '2500');
    expect(ids(mergeTimeline([gasto], [], 'dateDesc', [t1, t2]))).toEqual([
      'transfer-1940',
      'transfer-1939',
      'gasto-1824',
    ]);
  });

  /**
   * ═══ UNA OPERACIÓN MULTI-DESTINO ES UNA SOLA POSICIÓN ═══
   *
   * Tres cuotas no son tres filas. El reparto vive DENTRO de la entrada y no
   * puede influir en dónde va: la posición es de la operación padre.
   */
  it('una transferencia a tres produce UNA entrada y UNA posición', () => {
    const gasto = expense('gasto', '2026-09-24', '18:00', '1200');
    const tres = transfer('transfer-tres', '2026-09-24', '19:00', '3000', undefined, [
      'Aitor',
      'Ana',
      'Gus',
    ]);
    const merged = mergeTimeline([gasto], [], 'dateDesc', [tres]);
    expect(merged).toHaveLength(2);
    expect(ids(merged)).toEqual(['transfer-tres', 'gasto']);
    // Y sus tres cuotas siguen ahí, dentro de la única entrada.
    const entry = merged[0];
    expect(entry?.kind).toBe('transfer');
    expect(entry?.kind === 'transfer' ? entry.transfer.shares.length : 0).toBe(3);
  });

  /**
   * EL DESEMPATE NO BAILA. A igual fecha y hora manda el alta más reciente, y
   * a igual alta, la identidad. Dos lecturas dan el mismo orden.
   */
  it('mismo instante: desempata el alta y después la identidad', () => {
    const a = transfer('aaa', '2026-09-24', '19:00', '1000', '2026-09-24T19:00:00Z');
    const b = transfer('bbb', '2026-09-24', '19:00', '1000', '2026-09-24T19:05:00Z');
    expect(ids(mergeTimeline([], [], 'dateDesc', [a, b]))).toEqual(['bbb', 'aaa']);
    expect(ids(mergeTimeline([], [], 'dateDesc', [b, a]))).toEqual(['bbb', 'aaa']);

    const x = transfer('xxx', '2026-09-24', '19:00', '1000', '2026-09-24T19:00:00Z');
    const y = transfer('yyy', '2026-09-24', '19:00', '1000', '2026-09-24T19:00:00Z');
    expect(ids(mergeTimeline([], [], 'dateDesc', [y, x]))).toEqual(['xxx', 'yyy']);
    expect(ids(mergeTimeline([], [], 'dateDesc', [x, y]))).toEqual(['xxx', 'yyy']);
  });

  /**
   * Y EL ORDEN NO DEPENDE DE LA CLASE: el comparador normaliza las tres
   * fuentes a una misma clave y ordena UNA vez. Meter una transferencia entre
   * dos gastos del mismo día la coloca donde le toca, no al principio ni al
   * final de su grupo.
   */
  it('se intercala entre gastos del mismo día, no se agrupa por tipo', () => {
    const antes = expense('gasto-17', '2026-09-24', '17:00', '1000');
    const despues = expense('gasto-21', '2026-09-24', '21:00', '1000');
    const medio = transfer('transfer-19', '2026-09-24', '19:00', '1000');
    expect(ids(mergeTimeline([antes, despues], [], 'dateDesc', [medio]))).toEqual([
      'gasto-21',
      'transfer-19',
      'gasto-17',
    ]);
  });

  /** Y con el orden invertido, lo mismo al revés. */
  it('en ascendente también se intercala', () => {
    const antes = expense('gasto-17', '2026-09-24', '17:00', '1000');
    const despues = expense('gasto-21', '2026-09-24', '21:00', '1000');
    const medio = transfer('transfer-19', '2026-09-24', '19:00', '1000');
    expect(ids(mergeTimeline([antes, despues], [], 'dateAsc', [medio]))).toEqual([
      'gasto-17',
      'transfer-19',
      'gasto-21',
    ]);
  });
});
