import { describe, expect, it } from 'vitest';

import {
  adjustmentForm,
  adjustmentPreviousBalance,
  amountTone,
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

/**
 * EL COLOR DEL IMPORTE, y de dónde sale.
 *
 * Sale de la CLASE, no del signo. Es lo que separa «este número es negativo»
 * de «esto es un gasto», que son dos cosas distintas y sólo la segunda decide
 * el tratamiento.
 */
describe('amountTone', () => {
  /**
   * **Un gasto ordinario ya no va en rojo.** Repetido en cada fila competía
   * con lo que en Nomey sí es rojo —deuda, error, alerta— y acababa
   * significando menos justo donde debería significar más.
   */
  it('un gasto va en el color de texto principal', () => {
    expect(amountTone(operation({ operation_class: 'personal_expense' }))).toBe('text');
  });

  /** El ingreso conserva su verde: aparece poco, y ahí el color informa. */
  it('un ingreso conserva el verde', () => {
    expect(
      amountTone(operation({ operation_class: 'personal_income', balance_amount: '215000' })),
    ).toBe('positive');
  });

  /**
   * **La clase manda sobre el signo, y esto es la prueba.** Un gasto se guarda
   * con `balance_amount` negativo; si el color saliera del signo, saldría rojo.
   */
  it('un gasto con importe negativo NO se pinta de rojo', () => {
    const gasto = operation({ operation_class: 'personal_expense', balance_amount: '-4280' });
    expect(toMinor(gasto.balance_amount) < 0n).toBe(true);
    expect(amountTone(gasto)).toBe('text');
  });

  /**
   * **Un ajuste a la baja tampoco va en rojo**, por lo mismo que un gasto: el
   * signo ya dice la dirección, y el rojo está reservado a lo que de verdad va
   * mal. Subir el saldo sí conserva el verde — pasa poco, y ahí informa.
   */
  it('un ajuste que sube el saldo va en verde y uno que lo baja en blanco', () => {
    expect(amountTone(operation({ operation_class: 'adjustment', balance_amount: '5000' }))).toBe(
      'positive',
    );
    expect(amountTone(operation({ operation_class: 'adjustment', balance_amount: '-10000' }))).toBe(
      'text',
    );
  });

  /**
   * El cero no es ninguna de las dos cosas. La interfaz no crea ajustes que no
   * cambien nada, pero si el histórico trae uno, decir «positivo» sería
   * afirmar algo que no ocurrió.
   */
  it('un ajuste de cero no se pinta como positivo ni como negativo', () => {
    expect(amountTone(operation({ operation_class: 'adjustment', balance_amount: '0' }))).toBe(
      'textSecondary',
    );
  });

  /**
   * **Las clases que no se han mirado conservan el tratamiento por signo**, a
   * propósito: esta decisión es sobre el gasto, el ingreso y el ajuste, y no
   * inventa semántica para lo que llegue después.
   */
  it('las clases desconocidas siguen el signo', () => {
    expect(
      amountTone(operation({ operation_class: 'internal_transfer', balance_amount: '-100' })),
    ).toBe('negative');
    expect(
      amountTone(operation({ operation_class: 'internal_transfer', balance_amount: '100' })),
    ).toBe('positive');
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

/**
 * EL SALDO ANTERIOR DE UN AJUSTE, y de dónde sale.
 *
 * De la propia operación: el objetivo declarado menos el efecto que el
 * servidor asentó para llegar a él. Las dos cifras son de la MISMA versión
 * canónica y el delta se derivó **bajo lock y después del CAS** (ADR-022), así
 * que la resta describe el instante de ESE ajuste — no el de ahora, ni el que
 * enseñe Inicio, ni una observación tomada después.
 */
describe('adjustmentPreviousBalance', () => {
  const ajuste = (target: string | null, delta: string) =>
    operation({
      operation_class: 'adjustment',
      target_balance: target,
      balance_amount: delta,
      concept: null,
      category_id: null,
    });

  /** 150 → 200: el efecto fue +50, así que antes había 150. */
  it('reconstruye el saldo previo de un ajuste al alza', () => {
    expect(adjustmentPreviousBalance(ajuste('20000', '5000'))).toBe(15000n);
  });

  /** 300 → 200: el efecto fue −100, así que antes había 300. */
  it('y el de uno a la baja', () => {
    expect(adjustmentPreviousBalance(ajuste('20000', '-10000'))).toBe(30000n);
  });

  /**
   * **Todo en `bigint`.** Un importe por encima de 2^53 se resta exacto, que es
   * lo que un `number` por medio habría perdido en silencio.
   */
  it('no degrada importes por encima del rango exacto de un double', () => {
    expect(adjustmentPreviousBalance(ajuste('9007199254740993', '1'))).toBe(9007199254740992n);
  });

  /**
   * **Un ajuste por DELTA no tiene saldo objetivo del que restar**, y lo
   * honesto es no enseñar ninguno en vez de inventarlo. Hoy la interfaz sólo
   * crea ajustes por objetivo, pero el modelo admite los otros.
   */
  it('no inventa un anterior cuando el ajuste se declaró por delta', () => {
    expect(adjustmentPreviousBalance(ajuste(null, '-10000'))).toBeNull();
  });

  /** Y no aplica a nada que no sea un ajuste. */
  it('no aplica a gastos ni ingresos', () => {
    expect(
      adjustmentPreviousBalance(operation({ operation_class: 'personal_expense' })),
    ).toBeNull();
    expect(adjustmentPreviousBalance(operation({ operation_class: 'personal_income' }))).toBeNull();
  });
});
