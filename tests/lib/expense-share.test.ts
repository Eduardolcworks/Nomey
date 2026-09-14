import { describe, expect, it } from 'vitest';

import {
  type ExpenseShare,
  expenseLines,
  shareKey,
} from '../../src/features/personal/expense-share';
import type { PersonalOperation } from '../../src/features/personal/movement';
import { movementKind } from '../../src/features/personal/movement';

/**
 * EL DESGLOSE DE GASTOS, COMO FUNCIÓN PURA: gastos personales y cuotas
 * compartidas mezclados en el orden de la lista, y la suma de las líneas
 * explicando el total. Lo que sólo la base puede demostrar —que las cuotas
 * son exactamente las que suma `personal_statistics`— lo mide
 * `supabase/checks/personal-expense-breakdown.sql`.
 */

function operation(overrides: Partial<PersonalOperation> = {}): PersonalOperation {
  return {
    operation_id: 'op-1',
    operation_class: 'personal_expense',
    scope_id: 'scope-1',
    currency_definition_id: 'eur',
    balance_amount: '-2500',
    original_amount: '2500',
    effective_date: '2026-09-11',
    effective_time: '09:00',
    concept: 'Personal',
    category_id: 'cat-dining',
    target_balance: null,
    current_version_id: 'v1',
    previous_version_id: null,
    version_no: 1,
    operation_created_at: '2026-09-11T09:00:00Z',
    group_scope_id: null,
    group_display_name: null,
    your_share: null,
    payment_counterpart: null,
    ...overrides,
  };
}

function share(overrides: Partial<ExpenseShare> = {}): ExpenseShare {
  return {
    operation_id: 'gx-1',
    current_version_id: 'gv-1',
    scope_id: 'group-1',
    group_display_name: 'Brasil',
    group_emoji: '🫠',
    concept: 'Taxi',
    category_id: 'cat-travel',
    effective_date: '2026-09-11',
    effective_time: '10:00',
    payer_display_name: 'Aitor',
    total_amount: '2000',
    share_amount: '1000',
    currency_definition_id: 'eur',
    currency_code: 'EUR',
    currency_scale: 2,
    operation_created_at: '2026-09-11T10:00:00Z',
    ...overrides,
  };
}

describe('las líneas del desglose', () => {
  it('cuatro de 25 y una cuota de 10 pagada por otro: cinco líneas que suman 110', () => {
    const personal = [1, 2, 3, 4].map((i) =>
      operation({ operation_id: `op-${i}`, effective_time: `09:0${i}` }),
    );
    const lines = expenseLines(personal, [share()]);
    expect(lines).toHaveLength(5);
    const total = lines.reduce(
      (acc, line) =>
        acc +
        (line.kind === 'personal'
          ? BigInt(line.operation.original_amount)
          : BigInt(line.share.share_amount)),
      0n,
    );
    expect(total).toBe(11000n);
  });

  it('la cifra de una cuota es la cuota, no lo que adelantó el pagador', () => {
    const [line] = expenseLines([], [share({ total_amount: '2000', share_amount: '1000' })]);
    expect(line?.kind).toBe('share');
    if (line?.kind === 'share') expect(line.share.share_amount).toBe('1000');
  });

  it('se mezclan en el orden de la lista: fecha, hora con nulos al final, alta, identidad', () => {
    const lines = expenseLines(
      [
        operation({ operation_id: 'a', effective_date: '2026-09-10', effective_time: '23:00' }),
        operation({ operation_id: 'b', effective_date: '2026-09-11', effective_time: null }),
        operation({ operation_id: 'c', effective_date: '2026-09-11', effective_time: '09:00' }),
      ],
      [
        share({ operation_id: 'x', effective_date: '2026-09-11', effective_time: '12:00' }),
        share({ operation_id: 'y', effective_date: '2026-09-11', effective_time: '09:00' }),
      ],
    );
    const ids = lines.map((line) =>
      line.kind === 'personal' ? line.operation.operation_id : line.share.operation_id,
    );
    // x (11, 12:00) · c/y (11, 09:00: misma hora → alta desc, id desc: y > c) · b (11, sin hora) · a (10)
    expect(ids).toEqual(['x', 'y', 'c', 'b', 'a']);
  });

  it('es determinista ante el orden de llegada', () => {
    const personal = [operation({ operation_id: 'a' }), operation({ operation_id: 'b' })];
    const shares = [share({ operation_id: 'x' }), share({ operation_id: 'y' })];
    const forward = expenseLines(personal, shares);
    const backward = expenseLines([...personal].reverse(), [...shares].reverse());
    expect(backward).toEqual(forward);
  });

  it('la clave de una cuota no puede chocar con la de una operación', () => {
    expect(shareKey(share({ operation_id: 'op-1' }))).toBe('share:op-1');
    expect(shareKey(share({ operation_id: 'op-1' }))).not.toBe('op-1');
  });

  it('la fila de CAJA de un gasto compartido pagado por mí no es una línea de gasto', () => {
    // Lo que el desglose filtra antes de mezclar: sólo `expense`; `shared` es caja.
    expect(movementKind('group_expense')).toBe('shared');
    expect(movementKind('personal_expense')).toBe('expense');
  });
});
