import { describe, expect, it } from 'vitest';

import {
  buildPayload,
  type EntryDraft,
  EMPTY_AMOUNT,
  scopeInCurrency,
} from '../../src/features/personal/movement-entry';
import {
  buildGroupExpensePayload,
  type SharedExpenseDraft,
} from '../../src/features/groups/shared-expense';
import { projectHome } from '../../src/features/personal/projection';
import { classifyResponse } from '../../src/lib/offline/response';
import { payloadDefect } from '../../src/lib/offline/command';
import type { CalendarDate } from '../../src/lib/format';

/**
 * ELEGIR LA MONEDA DE UNA OPERACIÓN, DESDE LA INTERFAZ (F11 UI).
 *
 * Lo que aquí se comprueba es **el transporte, no la conversión**: el cliente
 * lleva la moneda original, el importe original y la base asumida, y quien
 * resuelve el tipo es la frontera (F11/ADR-001 §7, §12). Que cambiar la moneda
 * obligue a resolver de nuevo es una propiedad del servidor y se mide en
 * `supabase/checks/fx-group-conversion-read.sql` F y en los checks de F11.B;
 * aquí se comprueba lo que el cliente MANDA para que eso pueda ocurrir.
 */

const EUR = { id: 'eur-1', code: 'EUR', scale: 2 };
const JPY = { id: 'jpy-1', code: 'JPY', scale: 0 };

const PERSONAL = {
  scopeId: 's-1',
  currencyDefinitionId: 'eur-1',
  currencyCode: 'EUR',
  currencyScale: 2,
};

function draft(over: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: 'expense',
    amount: '12.34',
    concept: 'Cena',
    categoryId: 'cat-1',
    date: '2026-09-23' as CalendarDate,
    time: '10:00',
    ...over,
  };
}

// ═══════════════════ A · el alta personal, en las dos monedas ════════════════
describe('A · alta personal con moneda elegida', () => {
  it('sin elegir nada, el ámbito es el que llega: la base, sin base asumida', () => {
    const scope = scopeInCurrency(PERSONAL, null);
    expect(scope).toEqual(PERSONAL);

    const payload = buildPayload(draft(), scope, 'k-1');
    expect(payload?.currency_definition_id).toBe('eur-1');
    expect(payload).not.toHaveProperty('expected_base_currency_definition_id');
  });

  /*
   * ELEGIR LA BASE NO ES ELEGIR MONEDA EXTRANJERA. El payload tiene que quedar
   * BYTE A BYTE como el de antes de F11: su intención canónica es la que el
   * servidor usa para la idempotencia, y añadirle un campo la cambiaría.
   */
  it('elegir la propia base no añade base asumida', () => {
    const scope = scopeInCurrency(PERSONAL, EUR);
    const payload = buildPayload(draft(), scope, 'k-1');
    expect(payload).toEqual(buildPayload(draft(), PERSONAL, 'k-1'));
  });

  it('elegir otra moneda manda la declarada y la base asumida', () => {
    const scope = scopeInCurrency(PERSONAL, JPY);
    const payload = buildPayload(draft({ amount: '150000' }), scope, 'k-1');

    expect(payload?.currency_definition_id).toBe('jpy-1');
    expect(payload?.expected_base_currency_definition_id).toBe('eur-1');
  });

  /*
   * **LA ESCALA ES LA DE LA MONEDA ELEGIDA**, y aquí es donde un fallo sería
   * silencioso: 150000 yenes con escala 2 son 1.500,00 y el servidor lo
   * aceptaría sin quejarse.
   */
  it('el importe se escala con la moneda elegida, no con la del ámbito', () => {
    const enYenes = buildPayload(
      draft({ amount: '150000' }),
      scopeInCurrency(PERSONAL, JPY),
      'k-1',
    );
    const enEuros = buildPayload(draft({ amount: '150000' }), PERSONAL, 'k-1');

    expect(enYenes?.amount).toBe('150000');
    expect(enEuros?.amount).toBe('15000000');
  });

  it('una cantidad con decimales no es válida en una moneda sin ellos', () => {
    // No se trunca ni se redondea en silencio: no hay payload.
    expect(buildPayload(draft({ amount: '12.34' }), scopeInCurrency(PERSONAL, JPY), 'k-1')).toBe(
      null,
    );
  });

  it('un ingreso en otra moneda tampoco lleva categoría, y sí base asumida', () => {
    const payload = buildPayload(
      draft({ kind: 'income', amount: '150000', categoryId: null }),
      scopeInCurrency(PERSONAL, JPY),
      'k-1',
    );
    expect(payload).not.toHaveProperty('category_id');
    expect(payload?.expected_base_currency_definition_id).toBe('eur-1');
  });
});

// ═══════════ A bis · la cola durable admite el payload extranjero ════════════
//
// Sin esto el alta entera se rechazaba al ENCOLAR, antes de ninguna petición:
// la forma congelada tiene lista blanca de campos y `expected_base_…` no
// estaba en ella. Es el defecto que hacía inútil todo lo demás.
describe('A bis · la forma congelada admite la base asumida', () => {
  const base = {
    client_operation_id: '00000000-0000-4000-8000-000000000001',
    command_contract_version: 2,
    scope_id: '00000000-0000-4000-8000-000000000002',
    currency_definition_id: '00000000-0000-4000-8000-000000000003',
    amount: '150000',
    effective_date: '2026-09-23',
    effective_time: '10:00',
    concept: 'Cena',
    category_id: '00000000-0000-4000-8000-000000000004',
  };

  it('un gasto en moneda extranjera se puede encolar', () => {
    expect(
      payloadDefect('personal_expense.create', {
        ...base,
        expected_base_currency_definition_id: '00000000-0000-4000-8000-000000000005',
      }),
    ).toBe(null);
  });

  it('un ingreso en moneda extranjera también', () => {
    const { category_id: _omitida, ...income } = base;
    expect(
      payloadDefect('personal_income.create', {
        ...income,
        expected_base_currency_definition_id: '00000000-0000-4000-8000-000000000005',
      }),
    ).toBe(null);
  });

  it('y sigue siendo un uuid: una base asumida inventada no se encola', () => {
    expect(
      payloadDefect('personal_expense.create', {
        ...base,
        expected_base_currency_definition_id: 'EUR',
      }),
    ).toBe('badUuid');
  });
});

// ═════════════════════ B · el gasto de grupo en otra moneda ══════════════════
describe('B · alta de gasto de grupo con moneda elegida', () => {
  const GRUPO = { scopeId: 'g-1', currencyDefinitionId: 'eur-1', scale: 2 };

  function gasto(over: Partial<SharedExpenseDraft> = {}): SharedExpenseDraft {
    return {
      amount: '100',
      concept: 'Cena',
      categoryId: 'cat-1',
      date: '2026-09-23' as CalendarDate,
      time: '10:00',
      payerId: 'p-1',
      selected: ['p-1', 'p-2'],
      mode: 'equal',
      weights: {},
      amounts: {},
      ...over,
    };
  }

  it('en la moneda del grupo el payload es el de siempre', () => {
    const payload = buildGroupExpensePayload(gasto(), GRUPO, 'k-1');
    expect(payload?.currency_definition_id).toBe('eur-1');
    expect(payload).not.toHaveProperty('expected_base_currency_definition_id');
  });

  it('en otra moneda manda la declarada y la base del grupo como asumida', () => {
    const payload = buildGroupExpensePayload(
      gasto({ amount: '150000' }),
      {
        scopeId: 'g-1',
        currencyDefinitionId: 'jpy-1',
        scale: 0,
        baseCurrencyDefinitionId: 'eur-1',
      },
      'k-1',
    );
    expect(payload?.currency_definition_id).toBe('jpy-1');
    expect(payload?.expected_base_currency_definition_id).toBe('eur-1');
    expect(payload?.total).toBe('150000');
  });

  it('una base igual a la moneda declarada no añade nada', () => {
    const conBase = buildGroupExpensePayload(
      gasto(),
      { ...GRUPO, baseCurrencyDefinitionId: 'eur-1' },
      'k-1',
    );
    expect(conBase).toEqual(buildGroupExpensePayload(gasto(), GRUPO, 'k-1'));
  });

  /*
   * ═══ `exact_amounts` SE VALIDA EN LA MONEDA DECLARADA (F11/ADR-003) ═══
   *
   * Lo declarado se comprueba donde la persona lo escribió, y el reparto del
   * total CONVERTIDO lo hace el servidor usando esos declarados como pesos.
   * Aquí no se convierte nada.
   */
  it('los importes exactos cuadran en la moneda declarada, con SU escala', () => {
    const payload = buildGroupExpensePayload(
      gasto({
        amount: '150000',
        mode: 'amounts',
        amounts: { 'p-1': '100000', 'p-2': '50000' },
      }),
      {
        scopeId: 'g-1',
        currencyDefinitionId: 'jpy-1',
        scale: 0,
        baseCurrencyDefinitionId: 'eur-1',
      },
      'k-1',
    );

    expect(payload?.split_method).toEqual({
      kind: 'exact_amounts',
      amounts: ['100000', '50000'],
    });
  });

  it('y si no cuadran en esa moneda, no hay payload', () => {
    expect(
      buildGroupExpensePayload(
        gasto({
          amount: '150000',
          mode: 'amounts',
          amounts: { 'p-1': '100000', 'p-2': '40000' },
        }),
        {
          scopeId: 'g-1',
          currencyDefinitionId: 'jpy-1',
          scale: 0,
          baseCurrencyDefinitionId: 'eur-1',
        },
        'k-1',
      ),
    ).toBe(null);
  });
});

// ═══════════ E · la entrada que espera conversión: se pinta, no suma ═════════
describe('E · pendiente de conversión en la proyección', () => {
  const scope = {
    scopeId: 's-1',
    currencyDefinitionId: 'eur-1',
    currencyCode: 'EUR',
    currencyScale: 2,
  };

  function entrada(over: Record<string, unknown> = {}) {
    return {
      clientOperationId: 'c-1',
      actorId: 'u-1',
      scopeId: 's-1',
      commandType: 'personal_expense.create' as const,
      payload: {
        client_operation_id: 'c-1',
        command_contract_version: 2,
        scope_id: 's-1',
        currency_definition_id: 'jpy-1',
        amount: '150000',
        effective_date: '2026-09-23',
        effective_time: '10:00',
        concept: 'Cena',
        category_id: 'cat-1',
        expected_base_currency_definition_id: 'eur-1',
        ...over,
      },
      currency: { definitionId: 'jpy-1', code: 'JPY', scale: 0 },
      createdAt: '2026-09-23T10:00:00.000Z',
      state: 'queued' as const,
      attempts: 0,
      nextAttemptAt: null,
      lastCode: null,
      confirmSeq: null,
      resultOperationId: null,
    };
  }

  function proyectar(entry: ReturnType<typeof entrada>) {
    return projectHome({
      scope,
      range: { from: '2026-09-01' as CalendarDate, to: '2026-09-30' as CalendarDate },
      entries: [entry as never],
      /* El servidor ya respondió: un saldo y un intervalo vacíos. Lo que se
       * mide aquí es lo LOCAL, así que no hay nada del servidor que mezclar. */
      snapshot: {
        balance: { amount: '10000', seq: 0 },
        interval: { statistics: null, operations: [], total: 0, seq: 0 },
      },
      aliases: new Map(),
    } as never);
  }

  it('la fila existe, dice que espera conversión y NO entra en los agregados', () => {
    const home = proyectar(entrada());
    const row = home.operations.find((one) => one.client_operation_id === 'c-1');

    expect(row).toBeDefined();
    expect(row?.conversion_pending).toBe(true);
    expect(row?.counted).toBe(false);
    // Y se pinta con SU moneda, nunca con la del ámbito.
    expect(row?.currency_code).toBe('JPY');
    expect(row?.currency_scale).toBe(0);
  });

  /*
   * LOS DOS MOTIVOS DE NO SUMAR NO SON EL MISMO. Sin base asumida, esta
   * entrada es la de F07/ADR-001 §14 —la base se movió bajo ella— y la
   * frontera la va a rechazar: no espera ninguna conversión.
   */
  it('sin base asumida NO es una conversión pendiente: sigue sin sumar, pero es un conflicto', () => {
    const conflicto = entrada();
    const payload = { ...conflicto.payload } as Record<string, unknown>;
    delete payload.expected_base_currency_definition_id;
    const home = proyectar({ ...conflicto, payload } as never);
    const row = home.operations.find((one) => one.client_operation_id === 'c-1');

    expect(row?.conversion_pending).toBe(false);
    expect(row?.counted).toBe(false);
  });

  it('una entrada en la base ni espera conversión ni deja de sumar', () => {
    const home = proyectar({
      ...entrada({ currency_definition_id: 'eur-1', amount: '1234' }),
      currency: { definitionId: 'eur-1', code: 'EUR', scale: 2 },
    } as never);
    const row = home.operations.find((one) => one.client_operation_id === 'c-1');

    expect(row?.conversion_pending).toBe(false);
    expect(row?.counted).toBe(true);
  });
});

// ═════════════════ F · los códigos FX llegan enteros al cliente ══════════════
describe('F · los rechazos de cambio conservan su código', () => {
  const sesion = 'signed-in' as const;

  it('FX_RATE_NOT_YET_AVAILABLE es un 503 que se reintenta, no un servidor caído', () => {
    const out = classifyResponse(
      { kind: 'http', status: 503, code: 'FX_RATE_NOT_YET_AVAILABLE' },
      sesion,
    );
    expect(out.responseClass).toBe('fxPending');
    expect(out.state).toBe('retryable');
    expect(out.code).toBe('FX_RATE_NOT_YET_AVAILABLE');
  });

  it('FX_CURRENCY_NOT_COVERED es un rechazo terminal CON su código', () => {
    const out = classifyResponse(
      { kind: 'http', status: 422, code: 'FX_CURRENCY_NOT_COVERED' },
      sesion,
    );
    expect(out.responseClass).toBe('domainRejection');
    expect(out.state).toBe('rejected');
    expect(out.code).toBe('FX_CURRENCY_NOT_COVERED');
  });

  it('FX_CONVERSION_OUT_OF_RANGE, lo mismo: no se convierte en genérico', () => {
    const out = classifyResponse(
      { kind: 'http', status: 422, code: 'FX_CONVERSION_OUT_OF_RANGE' },
      sesion,
    );
    expect(out.responseClass).toBe('domainRejection');
    expect(out.code).toBe('FX_CONVERSION_OUT_OF_RANGE');
  });

  /* Y el conflicto monetario de F7 sigue siendo lo que era, no un caso FX. */
  it('CURRENCY_CONVERSION_UNSUPPORTED conserva su trato de siempre', () => {
    const out = classifyResponse(
      { kind: 'http', status: 422, code: 'CURRENCY_CONVERSION_UNSUPPORTED' },
      sesion,
    );
    expect(out.responseClass).toBe('currencyConflict');
    expect(out.state).toBe('conflict');
  });
});

// Un uso deliberado para que el importe vacío no quede sin comprobar: un alta
// sin cifra no produce payload, elija la moneda que elija.
describe('el importe vacío no produce payload en ninguna moneda', () => {
  it('ni en la base ni en otra', () => {
    const vacio = draft({ amount: '' });
    expect(buildPayload(vacio, PERSONAL, 'k-1')).toBe(null);
    expect(buildPayload(vacio, scopeInCurrency(PERSONAL, JPY), 'k-1')).toBe(null);
    expect(EMPTY_AMOUNT.whole).toBe('');
  });
});
