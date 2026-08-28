import { describe, expect, it } from 'vitest';

import {
  adjustmentForm,
  type BalanceObservation,
  compareOperations,
  displayMinor,
  indexObservations,
  indexVersions,
  isEdited,
  movementKind,
  OPERATION_ORDER,
  operationsOfKind,
  type PersonalOperation,
  type PersonalOperationVersion,
  previousVersionIds,
} from '../../src/features/personal/movement';
import { toMinor } from '../../src/features/personal/statistics';

function operation(overrides: Partial<PersonalOperation> = {}): PersonalOperation {
  return {
    operation_id: 'op-1',
    operation_class: 'personal_expense',
    scope_id: 'scope-1',
    currency_definition_id: 'eur',
    balance_amount: '-2500',
    original_amount: '2500',
    effective_date: '2026-08-29',
    effective_time: '19:30',
    concept: 'Compra',
    category_id: 'cat-1',
    target_balance: null,
    current_version_id: 'v2',
    previous_version_id: 'v1',
    version_no: 2,
    operation_created_at: '2026-08-29T10:00:00Z',
    ...overrides,
  };
}

describe('movementKind', () => {
  it('traduce las tres clases que el Modo Personal representa', () => {
    expect(movementKind('personal_income')).toBe('income');
    expect(movementKind('personal_expense')).toBe('expense');
    expect(movementKind('adjustment')).toBe('adjustment');
  });

  /**
   * Una clase que esta versión no sabe representar devuelve `null` en vez de
   * caer en un caso por defecto. Hoy no llega ninguna —la lista blanca de F6.D
   * lo impide— y cuando F9 amplíe el contrato, quien lo haga tendrá que pasar
   * por aquí en vez de que aparezca pintada como si fuera un gasto.
   */
  it('una clase futura no se disfraza de otra cosa', () => {
    expect(movementKind('internal_transfer')).toBeNull();
    expect(movementKind('group_expense')).toBeNull();
  });
});

describe('displayMinor', () => {
  /**
   * **La invariante que hace segura toda la línea del «Editado».**
   *
   * El historial no puede publicar un importe firmado: los efectos de una
   * versión superada están en `core.effect`, que ninguna vista puede leer
   * (ADR-013 §9). Así que la línea tachada se pinta aplicando el signo por
   * clase a `original_amount`.
   *
   * Que eso sea correcto se comprueba contra la versión VIGENTE, donde sí
   * tenemos las dos cosas: aplicar el signo al importe declarado tiene que dar
   * exactamente el `balance_amount` que el servidor firmó. Si dejaran de
   * coincidir, la línea tachada estaría mintiendo.
   */
  it.each([
    [
      'gasto',
      operation({
        operation_class: 'personal_expense',
        original_amount: '2500',
        balance_amount: '-2500',
      }),
    ],
    [
      'ingreso',
      operation({
        operation_class: 'personal_income',
        original_amount: '10000',
        balance_amount: '10000',
      }),
    ],
    [
      'ajuste positivo',
      operation({ operation_class: 'adjustment', original_amount: '2500', balance_amount: '2500' }),
    ],
    [
      'ajuste negativo',
      operation({ operation_class: 'adjustment', original_amount: '-700', balance_amount: '-700' }),
    ],
  ])('para un %s coincide con el saldo firmado del servidor', (_name, row) => {
    const kind = movementKind(row.operation_class);
    expect(kind).not.toBeNull();
    expect(displayMinor(kind!, row.original_amount)).toBe(toMinor(row.balance_amount));
  });

  it('un gasto se declara en positivo y se muestra en negativo', () => {
    expect(displayMinor('expense', '2500')).toBe(-2500n);
  });
});

describe('isEdited y adjustmentForm', () => {
  /**
   * El discriminante es `previous_version_id`, no `version_no - 1`: ADR-011 §11
   * no hizo estructural que el predecesor sea la versión anterior, así que
   * restar uno sería una suposición.
   */
  it('editado es tener predecesor publicado', () => {
    expect(isEdited(operation({ previous_version_id: 'v1', version_no: 2 }))).toBe(true);
    expect(isEdited(operation({ previous_version_id: null, version_no: 1 }))).toBe(false);
  });

  it('las dos formas del ajuste se distinguen por el objetivo declarado', () => {
    const target = operation({ operation_class: 'adjustment', target_balance: '10000' });
    const delta = operation({ operation_class: 'adjustment', target_balance: null });

    expect(adjustmentForm(target)).toBe('target');
    expect(adjustmentForm(delta)).toBe('delta');
  });

  it('lo que no es un ajuste no tiene forma de ajuste', () => {
    expect(adjustmentForm(operation({ operation_class: 'personal_expense' }))).toBeNull();
    expect(adjustmentForm(operation({ operation_class: 'personal_income' }))).toBeNull();
  });
});

describe('el orden de la lista', () => {
  it('el contrato que se manda al servidor es el canónico de F6.D', () => {
    expect(OPERATION_ORDER).toBe(
      'effective_date.desc,effective_time.desc.nullslast,operation_created_at.desc,operation_id.desc',
    );
  });

  it('ordena por fecha efectiva descendente', () => {
    const older = operation({ operation_id: 'a', effective_date: '2026-08-01' });
    const newer = operation({ operation_id: 'b', effective_date: '2026-08-29' });
    expect([older, newer].sort(compareOperations).map((o) => o.operation_id)).toEqual(['b', 'a']);
  });

  /**
   * Nulo va al final, igual que `nulls last` en el servidor. **No se sustituye
   * por `00:00`**: nulo significa «sin hora registrada» y nunca medianoche
   * (ADR-020 §3), y rellenarlo pondría esos movimientos los primeros del día
   * por accidente.
   */
  it('un movimiento sin hora va después de los que la tienen, no antes', () => {
    const withTime = operation({ operation_id: 'a', effective_time: '09:00' });
    const without = operation({ operation_id: 'b', effective_time: null });
    expect([without, withTime].sort(compareOperations).map((o) => o.operation_id)).toEqual([
      'a',
      'b',
    ]);
  });

  /**
   * El desempate es el instante de registro de la OPERACIÓN, no el de la
   * versión: así corregir un movimiento no lo reordena entre sus pares.
   */
  it('desempata por el registro de la operación y luego por identificador', () => {
    const a = operation({
      operation_id: 'aaa',
      effective_time: '09:00',
      operation_created_at: '2026-08-29T08:00:00Z',
    });
    const b = operation({
      operation_id: 'bbb',
      effective_time: '09:00',
      operation_created_at: '2026-08-29T09:00:00Z',
    });
    expect([a, b].sort(compareOperations).map((o) => o.operation_id)).toEqual(['bbb', 'aaa']);

    const same = { ...a, operation_created_at: b.operation_created_at };
    expect([same, b].sort(compareOperations).map((o) => o.operation_id)).toEqual(['bbb', 'aaa']);
  });
});

describe('operationsOfKind', () => {
  it('separa ingresos y gastos conservando el orden', () => {
    const rows = [
      operation({ operation_id: '1', operation_class: 'personal_expense' }),
      operation({ operation_id: '2', operation_class: 'personal_income' }),
      operation({ operation_id: '3', operation_class: 'adjustment' }),
      operation({ operation_id: '4', operation_class: 'personal_expense' }),
    ];

    expect(operationsOfKind(rows, 'expense').map((o) => o.operation_id)).toEqual(['1', '4']);
    expect(operationsOfKind(rows, 'income').map((o) => o.operation_id)).toEqual(['2']);
    expect(operationsOfKind(rows, 'adjustment').map((o) => o.operation_id)).toEqual(['3']);
  });
});

describe('previousVersionIds', () => {
  /**
   * Una consulta por página, nunca una por fila. Y sin repetidos: dos filas que
   * apuntaran a la misma versión no deben pedirla dos veces.
   */
  it('recoge los predecesores de la página, sin nulos ni repetidos', () => {
    const rows = [
      operation({ operation_id: '1', previous_version_id: 'v1' }),
      operation({ operation_id: '2', previous_version_id: null }),
      operation({ operation_id: '3', previous_version_id: 'v1' }),
      operation({ operation_id: '4', previous_version_id: 'v9' }),
    ];

    expect(previousVersionIds(rows)).toEqual(['v1', 'v9']);
  });

  it('una página sin correcciones no pide nada', () => {
    expect(previousVersionIds([operation({ previous_version_id: null })])).toEqual([]);
  });
});

describe('indexObservations', () => {
  const observation = (
    operationId: string,
    versionId: string,
    isCurrent: boolean,
  ): BalanceObservation => ({
    operation_id: operationId,
    operation_version_id: versionId,
    is_current: isCurrent,
    scope_id: 'scope-1',
    observed_balance_before: '100',
    observed_balance_after: '200',
  });

  /**
   * La función devuelve TODAS las versiones y `is_current` las separa. La
   * expansión muestra la de la versión vigente: es la fotografía que
   * corresponde a lo que la fila está enseñando.
   */
  it('se queda con la observación de la versión vigente', () => {
    const index = indexObservations([
      observation('op-1', 'v1', false),
      observation('op-1', 'v2', true),
    ]);

    expect(index.get('op-1')?.operation_version_id).toBe('v2');
  });

  it('una operación sin observación vigente no aparece', () => {
    expect(indexObservations([observation('op-1', 'v1', false)].map((o) => o)).size).toBe(0);
  });
});

describe('indexVersions', () => {
  it('indexa por identificador de versión', () => {
    const version: PersonalOperationVersion = {
      operation_id: 'op-1',
      operation_version_id: 'v1',
      operation_class: 'personal_expense',
      version_no: 1,
      is_current: false,
      original_amount: '2000',
      currency_definition_id: 'eur',
      effective_date: '2026-08-01',
      effective_time: '09:00',
      concept: 'Antes',
      category_id: 'cat-0',
      target_balance: null,
    };

    expect(indexVersions([version]).get('v1')?.concept).toBe('Antes');
  });
});
