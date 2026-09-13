import { describe, expect, it } from 'vitest';

import {
  isQueueCommandType,
  payloadDefect,
  QUEUE_COMMAND_TYPES,
} from '../../src/lib/offline/command';

/**
 * El discriminante cerrado y la forma del payload (F07/ADR-001 §3, y §4 para el
 * alcance).
 *
 * Lo que se comprueba aquí no es «que valide», sino las tres cosas que, mal
 * hechas, no lanzan nada: que la cola no admita una clase que F7 no enruta, que
 * un importe no pueda entrar como número, y que un ingreso no pueda llevar
 * categoría.
 */

const EXPENSE = {
  client_operation_id: '11111111-1111-4111-8111-111111111111',
  command_contract_version: 2,
  scope_id: '22222222-2222-4222-8222-222222222222',
  currency_definition_id: '33333333-3333-4333-8333-333333333333',
  amount: '1230',
  effective_date: '2026-09-03',
  effective_time: '21:40',
  concept: 'Cena',
  category_id: '44444444-4444-4444-8444-444444444444',
};

const INCOME = (() => {
  const { category_id, ...rest } = EXPENSE;
  void category_id;
  return rest;
})();

describe('el vocabulario cerrado', () => {
  it('son TRES, y ninguna de las que llevan CAS', () => {
    /*
     * F7 tuvo dos; F9 añade `group.create` con la enmienda de F07/ADR-001 §3 y §4 en
     * el mismo cambio. Cabe donde correcciones, anulaciones y ajustes no caben,
     * y por la misma razón que los separaba: **no lleva CAS y no puede quedar
     * obsoleta**. No corrige nada anterior, no tiene versión previa que comparar
     * y su idempotencia es una clave, no un estado, así que un reintento es un
     * replay y nunca un `VERSION_CONFLICT`.
     */
    expect([...QUEUE_COMMAND_TYPES]).toEqual([
      'personal_expense.create',
      'personal_income.create',
      'group.create',
    ]);
  });

  it.each([
    'personal_expense.correct',
    'annulment.create',
    'adjustment.create',
    'group_expense.create',
    'record_personal_expense',
    '',
  ])('«%s» no es ejecutable', (candidate) => {
    expect(isQueueCommandType(candidate)).toBe(false);
  });
});

describe('la forma del payload congelado', () => {
  it('acepta un gasto completo y un ingreso completo', () => {
    expect(payloadDefect('personal_expense.create', EXPENSE)).toBeNull();
    expect(payloadDefect('personal_income.create', INCOME)).toBeNull();
  });

  it('EL IMPORTE NO PUEDE SER UN NÚMERO, ni siquiera uno entero', () => {
    /*
     * Es la regla que F02/ADR-001 §1 y F03/ADR-005 §1 existen para sostener. Un `1230`
     * numérico aquí sobreviviría a SQLite sin romperse, pero admitirlo abre la
     * puerta al `12.30` de la línea siguiente, que ya no es 12,30.
     */
    expect(payloadDefect('personal_expense.create', { ...EXPENSE, amount: 1230 })).toBe(
      'amountNotExact',
    );
  });

  it('rechaza una cifra con coma en cualquier campo, sea monetario o no', () => {
    expect(payloadDefect('personal_expense.create', { ...EXPENSE, amount: '12.30' })).toBe(
      'amountNotExact',
    );
    // La versión de contrato se comprueba antes que nada: es lo que decide qué
    // forma se está validando, así que un 2,5 no llega ni a mirarse el resto.
    expect(
      payloadDefect('personal_expense.create', { ...EXPENSE, command_contract_version: 2.5 }),
    ).toBe('badVersion');
  });

  it('rechaza importes que no son unidades mínimas positivas', () => {
    for (const amount of ['0', '-500', '', '1 230', '01', '1e3']) {
      expect(payloadDefect('personal_expense.create', { ...EXPENSE, amount })).toBe(
        'amountNotExact',
      );
    }
  });

  it('UN INGRESO CON CATEGORÍA SE RECHAZA AL ENCOLAR', () => {
    /*
     * `category_id` no es un campo admisible del contrato de ingreso
     * (F06/ADR-009 §3): el servidor lo rechaza por FORMA. Detectarlo aquí convierte
     * un fallo que llegaría al sincronizar, sin nadie mirando, en uno inmediato.
     */
    expect(
      payloadDefect('personal_income.create', { ...INCOME, category_id: EXPENSE.category_id }),
    ).toBe('forbiddenField');
  });

  it('un gasto sin categoría no se puede encolar', () => {
    expect(payloadDefect('personal_expense.create', INCOME)).toBe('missingField');
  });

  it('rechaza un campo que el contrato no admite', () => {
    expect(payloadDefect('personal_expense.create', { ...EXPENSE, target_balance: '10' })).toBe(
      'unknownField',
    );
  });

  it('valida la definición monetaria, la fecha, la hora y el concepto', () => {
    expect(
      payloadDefect('personal_expense.create', { ...EXPENSE, currency_definition_id: 'EUR' }),
    ).toBe('badUuid');
    expect(payloadDefect('personal_expense.create', { ...EXPENSE, category_id: 'comida' })).toBe(
      'badUuid',
    );
    expect(
      payloadDefect('personal_expense.create', { ...EXPENSE, effective_date: '3/9/2026' }),
    ).toBe('badDate');
    expect(
      payloadDefect('personal_expense.create', { ...EXPENSE, effective_time: '21:40:00' }),
    ).toBe('badTime');
    expect(payloadDefect('personal_expense.create', { ...EXPENSE, concept: '   ' })).toBe(
      'emptyConcept',
    );
  });

  it('rechaza lo que no es un objeto', () => {
    for (const value of [null, 'x', 3, [], undefined]) {
      expect(payloadDefect('personal_expense.create', value)).toBe('notAnObject');
    }
  });
});
