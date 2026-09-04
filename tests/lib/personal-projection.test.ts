import { describe, expect, it } from 'vitest';

import type { PersonalOperation } from '../../src/features/personal/movement';
import {
  isReconciled,
  projectHome,
  type ProjectionInput,
  type ProjectionSnapshot,
} from '../../src/features/personal/projection';
import type { PersonalStatistics } from '../../src/features/personal/statistics';
import {
  newQueueEntry,
  type QueueEntry,
  type QueueEntryState,
} from '../../src/lib/offline/queue-entry';

/**
 * LA PROYECCIÓN OPTIMISTA, pura y sin pantalla (ADR-028 §8, §9, §10).
 *
 * Todo lo que se afirma aquí es lo que las superficies de Inicio pintan, porque
 * todas leen esta función y ninguna suma por su cuenta. Los importes son
 * `bigint` en unidad mínima de principio a fin: ningún caso pasa por `number`.
 */

const SCOPE = '22222222-2222-4222-8222-222222222222';
const OTHER_SCOPE = '99999999-9999-4999-8999-999999999999';
const CURRENCY = '33333333-3333-4333-8333-333333333333';
const CAT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CAT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const scope = {
  scopeId: SCOPE,
  currencyDefinitionId: CURRENCY,
  currencyCode: 'EUR',
  currencyScale: 2,
};

const TODAY = '2026-09-03';
const YESTERDAY = '2026-09-02';
const MONTH = { from: '2026-09-01', to: '2026-09-30' } as ProjectionInput['range'];
const DAY = { from: TODAY, to: TODAY } as ProjectionInput['range'];
const ALL = { from: null, to: null } as ProjectionInput['range'];

let seq = 0;
function entry(over: {
  kind?: 'expense' | 'income';
  amount?: string;
  date?: string;
  time?: string;
  category?: string | null;
  state?: QueueEntryState;
  confirmSeq?: number | null;
  resultOperationId?: string | null;
  scopeId?: string;
  currencyId?: string;
  createdAt?: string;
  concept?: string;
}): QueueEntry {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const kind = over.kind ?? 'expense';
  const payload: Record<string, string | number> = {
    client_operation_id: id,
    command_contract_version: 2,
    scope_id: over.scopeId ?? SCOPE,
    currency_definition_id: over.currencyId ?? CURRENCY,
    amount: over.amount ?? '1230',
    effective_date: over.date ?? TODAY,
    effective_time: over.time ?? '21:40',
    concept: over.concept ?? 'Cena',
  };
  if (kind === 'expense')
    payload.category_id = over.category === undefined ? CAT_B : (over.category ?? '');
  if (payload.category_id === '') delete payload.category_id;

  const base = newQueueEntry({
    clientOperationId: id,
    actorId: ACTOR,
    scopeId: over.scopeId ?? SCOPE,
    commandType: kind === 'income' ? 'personal_income.create' : 'personal_expense.create',
    payload,
    currency: { definitionId: over.currencyId ?? CURRENCY, code: 'EUR', scale: 2 },
    createdAt: over.createdAt ?? `2026-09-03T21:40:${String(seq % 60).padStart(2, '0')}.000Z`,
  });
  return {
    ...base,
    state: over.state ?? 'queued',
    confirmSeq: over.confirmSeq ?? null,
    resultOperationId: over.resultOperationId ?? null,
  };
}

function serverOp(over: Partial<PersonalOperation> = {}): PersonalOperation {
  return {
    operation_id: 'op-server-1',
    operation_class: 'personal_expense',
    scope_id: SCOPE,
    currency_definition_id: CURRENCY,
    balance_amount: '-2000',
    original_amount: '2000',
    effective_date: TODAY,
    effective_time: '20:00:00',
    concept: 'Súper',
    category_id: CAT_A,
    target_balance: null,
    current_version_id: 'v1',
    previous_version_id: null,
    version_no: 1,
    operation_created_at: '2026-09-03T20:00:00.000Z',
    ...over,
  };
}

const STATS: PersonalStatistics = {
  scope_id: SCOPE,
  currency_definition_id: CURRENCY,
  from: MONTH.from,
  to: MONTH.to,
  income_total: '5000',
  expense_total: '2000',
  categories: [{ category_id: CAT_A, expense_total: '2000', operation_count: 1 }],
};

function snapshot(over: {
  balance?: string | null;
  balanceSeq?: number;
  statistics?: PersonalStatistics | null;
  operations?: PersonalOperation[];
  total?: number;
  intervalSeq?: number;
  noInterval?: boolean;
}): ProjectionSnapshot {
  return {
    balance:
      over.balance === null ? null : { amount: over.balance ?? '10000', seq: over.balanceSeq ?? 0 },
    interval: over.noInterval
      ? null
      : {
          statistics: over.statistics === undefined ? STATS : over.statistics,
          operations: over.operations ?? [serverOp()],
          total: over.total ?? (over.operations ?? [serverOp()]).length,
          seq: over.intervalSeq ?? 0,
        },
  };
}

function project(
  entries: QueueEntry[],
  snap: ProjectionSnapshot,
  range = MONTH,
  aliases = new Map(),
) {
  return projectHome({ scope, range, entries, snapshot: snap, aliases });
}

describe('un gasto sin conexión', () => {
  it('APARECE EN LA LISTA Y MUEVE DISPONIBLE, GASTOS, CATEGORÍA Y REPARTO', () => {
    const local = entry({ amount: '1230', category: CAT_B });
    const home = project([local], snapshot({}));

    // La fila, pintada como una más: clase, importe firmado, hora con segundos.
    const row = home.operations.find((op) => op.render_key === local.clientOperationId);
    expect(row).toMatchObject({
      operation_class: 'personal_expense',
      balance_amount: '-1230',
      original_amount: '1230',
      effective_time: '21:40:00',
      concept: 'Cena',
      category_id: CAT_B,
      current_version_id: '',
      client_operation_id: local.clientOperationId,
    });
    expect(home.operations).toHaveLength(2);
    expect(home.total).toBe(2);

    // Disponible: 100,00 − 12,30. Gastos: 20,00 + 12,30. Ingresos, intactos.
    expect(home.balance).toBe('8770');
    expect(home.statistics?.expense_total).toBe('3230');
    expect(home.statistics?.income_total).toBe('5000');
    // El reparto: la nueva categoría entra, ordenada por total descendente.
    expect(home.statistics?.categories).toEqual([
      { category_id: CAT_A, expense_total: '2000', operation_count: 1 },
      { category_id: CAT_B, expense_total: '1230', operation_count: 1 },
    ]);
    expect(home.unreconciled).toBe(1);
    expect(home.reconciled).toEqual([]);
  });

  it('suma a una categoría que ya tenía gasto y reordena como el servidor', () => {
    const local = entry({ amount: '500', category: CAT_B });
    const bigger = entry({ amount: '1600', category: CAT_B });
    const home = project([local, bigger], snapshot({}));

    expect(home.statistics?.categories).toEqual([
      { category_id: CAT_B, expense_total: '2100', operation_count: 2 },
      { category_id: CAT_A, expense_total: '2000', operation_count: 1 },
    ]);
  });

  it('el desempate del reparto es por identificador ascendente, como en SQL', () => {
    const local = entry({ amount: '2000', category: CAT_B });
    const home = project([local], snapshot({}));
    expect(home.statistics?.categories.map((c) => c.category_id)).toEqual([CAT_A, CAT_B]);
  });
});

describe('un ingreso sin conexión', () => {
  it('aparece, sube el Disponible y los Ingresos, y no toca gastos ni reparto', () => {
    const local = entry({ kind: 'income', amount: '30000' });
    const home = project([local], snapshot({}));

    const row = home.operations.find((op) => op.render_key === local.clientOperationId);
    expect(row).toMatchObject({
      operation_class: 'personal_income',
      balance_amount: '30000',
      category_id: null,
    });
    expect(home.balance).toBe('40000');
    expect(home.statistics?.income_total).toBe('35000');
    expect(home.statistics?.expense_total).toBe('2000');
    expect(home.statistics?.categories).toEqual(STATS.categories);
  });
});

describe('la identidad es la entrada, no el contenido', () => {
  it('DOS PAYLOADS IDÉNTICOS SON DOS MOVIMIENTOS y dos claves', () => {
    const a = entry({ amount: '1230', createdAt: '2026-09-03T21:40:00.000Z' });
    const b = entry({ amount: '1230', createdAt: '2026-09-03T21:40:01.000Z' });
    const home = project([a, b], snapshot({}));

    const locals = home.operations.filter((op) => op.client_operation_id !== null);
    expect(locals).toHaveLength(2);
    expect(new Set(locals.map((op) => op.render_key)).size).toBe(2);
    expect(home.balance).toBe('7540');
    expect(home.statistics?.expense_total).toBe('4460');
  });
});

describe('fecha, hora, intervalo y orden', () => {
  it('UN GASTO DE AYER MUEVE EL DISPONIBLE Y NO APARECE EN «DÍA»', () => {
    const yesterday = entry({ date: YESTERDAY, amount: '1000' });
    const home = project(
      [yesterday],
      snapshot({ statistics: { ...STATS, from: TODAY, to: TODAY } }),
      DAY,
    );

    expect(home.balance).toBe('9000');
    expect(home.operations.map((op) => op.render_key)).toEqual(['op-server-1']);
    expect(home.total).toBe(1);
    // Ni los totales ni el reparto del día lo incluyen: no es de hoy.
    expect(home.statistics?.expense_total).toBe('2000');
    expect(home.statistics?.categories).toEqual(STATS.categories);
    // Pero sigue sin reconciliar: bloquea «Fijar Disponible» igual.
    expect(home.unreconciled).toBe(1);
  });

  it('en «Todo» entra, y respeta el orden canónico entre filas del servidor', () => {
    const older = entry({ date: YESTERDAY, time: '09:00', createdAt: '2026-09-02T09:00:00.000Z' });
    const later = entry({ date: TODAY, time: '23:00', createdAt: '2026-09-03T23:00:00.000Z' });
    const home = project([older, later], snapshot({}), ALL);

    expect(home.operations.map((op) => op.render_key)).toEqual([
      later.clientOperationId,
      'op-server-1',
      older.clientOperationId,
    ]);
  });

  it('VARIAS PENDIENTES CONSERVAN UN ORDEN ESTABLE entre proyecciones', () => {
    const entries = [1, 2, 3].map((i) =>
      entry({ time: `21:4${i}`, createdAt: `2026-09-03T21:4${i}:00.000Z` }),
    );
    const first = project(entries, snapshot({}));
    const second = project([...entries].reverse(), snapshot({}));
    expect(second.operations.map((op) => op.render_key)).toEqual(
      first.operations.map((op) => op.render_key),
    );
    expect(first.operations.map((op) => op.render_key)).toEqual([
      entries[2].clientOperationId,
      entries[1].clientOperationId,
      entries[0].clientOperationId,
      'op-server-1',
    ]);
  });
});

describe('reconciliación: la marca monótona, por superficie', () => {
  const confirmed = () =>
    entry({ amount: '1230', state: 'confirmed', confirmSeq: 3, resultOperationId: 'op-new' });

  it('CONFIRMADA ANTES DE ARRANCAR EL REFRESCO → el snapshot ya la tiene y se retira entera', () => {
    const local = confirmed();
    const home = project([local], snapshot({ balanceSeq: 3, intervalSeq: 3 }));

    // Nada duplicado: el servidor ya la incluye en saldo y totales.
    expect(home.balance).toBe('10000');
    expect(home.statistics?.expense_total).toBe('2000');
    expect(home.operations.map((op) => op.render_key)).toEqual(['op-server-1']);
    expect(home.reconciled).toEqual([local.clientOperationId]);
    expect(home.unreconciled).toBe(0);
  });

  it('CONFIRMADA DURANTE EL REFRESCO → el snapshot arrancó antes y la sigue proyectando', () => {
    const local = confirmed();
    const home = project([local], snapshot({ balanceSeq: 2, intervalSeq: 2 }));

    expect(home.balance).toBe('8770');
    expect(home.statistics?.expense_total).toBe('3230');
    expect(home.operations.some((op) => op.render_key === local.clientOperationId)).toBe(true);
    expect(home.reconciled).toEqual([]);
    expect(home.unreconciled).toBe(1);
  });

  it('REFRESCO PARCIAL: el saldo ya la tiene y el intervalo no → cada uno lo suyo, sin poda', () => {
    const local = confirmed();
    const home = project([local], snapshot({ balanceSeq: 3, intervalSeq: 2 }));

    // El saldo del servidor ya la incluye: no se suma otra vez.
    expect(home.balance).toBe('10000');
    // Los totales y la lista vienen de una consulta anterior: se sigue sumando.
    expect(home.statistics?.expense_total).toBe('3230');
    expect(home.operations.some((op) => op.render_key === local.clientOperationId)).toBe(true);
    // Y NO se poda hasta que las tres superficies la hayan retirado.
    expect(home.reconciled).toEqual([]);
    expect(home.unreconciled).toBe(1);
  });

  it('y al revés: el intervalo la tiene y el saldo no', () => {
    const local = confirmed();
    const home = project([local], snapshot({ balanceSeq: 2, intervalSeq: 3 }));
    expect(home.balance).toBe('8770');
    expect(home.statistics?.expense_total).toBe('2000');
    expect(home.operations.map((op) => op.render_key)).toEqual(['op-server-1']);
    expect(home.reconciled).toEqual([]);
  });

  it('EL ATAJO: la fila del servidor ya está en la página → retira lista y totales, y hereda la clave', () => {
    const local = confirmed();
    const server = serverOp({
      operation_id: 'op-new',
      balance_amount: '-1230',
      original_amount: '1230',
    });
    // El `seq` NO lo prueba —la confirmación llegó después de arrancar— pero la fila sí está.
    const home = project(
      [local],
      snapshot({
        balanceSeq: 2,
        intervalSeq: 2,
        operations: [server, serverOp()],
        statistics: { ...STATS, expense_total: '3230' },
      }),
    );

    // Una sola fila para esa operación, y con la clave de render LOCAL.
    const rows = home.operations.filter((op) => op.operation_id === 'op-new');
    expect(rows).toHaveLength(1);
    expect(rows[0].render_key).toBe(local.clientOperationId);
    expect(rows[0].client_operation_id).toBeNull();
    expect(
      home.operations.some(
        (op) => op.render_key === local.clientOperationId && op.client_operation_id !== null,
      ),
    ).toBe(false);
    // Los totales salen de la MISMA consulta que la lista: tampoco se suma otra vez.
    expect(home.statistics?.expense_total).toBe('3230');
    // El saldo llega por otra consulta que pudo correr antes: se sigue sumando.
    expect(home.balance).toBe('8770');
    expect(home.aliases.get('op-new')).toBe(local.clientOperationId);
    expect(home.reconciled).toEqual([]);
  });

  it('el atajo NO es requisito: fuera de la página, la marca basta para retirar', () => {
    const local = confirmed();
    const home = project(
      [local],
      snapshot({ balanceSeq: 3, intervalSeq: 3, operations: [serverOp()] }),
    );
    expect(home.reconciled).toEqual([local.clientOperationId]);
    expect(home.operations.map((op) => op.render_key)).toEqual(['op-server-1']);
  });

  it('tras podar, la fila del servidor conserva la clave heredada por el alias', () => {
    const aliases = new Map([['op-new', 'clave-local-que-ya-se-podó']]);
    const home = project(
      [],
      snapshot({ operations: [serverOp({ operation_id: 'op-new' })] }),
      MONTH,
      aliases,
    );
    expect(home.operations[0].render_key).toBe('clave-local-que-ya-se-podó');
  });

  it('REINICIO ENTRE CONFIRMACIÓN Y RETIRADA: la entrada durable sigue proyectada hasta la prueba', () => {
    // Tras reabrir, la app arranca sin snapshot: la confirmada se pinta igual.
    const local = confirmed();
    const cold = project([local], { balance: null, interval: null });
    expect(cold.operations.map((op) => op.render_key)).toEqual([local.clientOperationId]);
    expect(cold.balance).toBeNull();
    expect(cold.reconciled).toEqual([]);

    // El primer refresco completo lee el cursor durable (≥ 3) y la retira.
    const warm = project([local], snapshot({ balanceSeq: 3, intervalSeq: 3 }));
    expect(warm.reconciled).toEqual([local.clientOperationId]);
  });
});

describe('terminales, transitorios y aislamiento', () => {
  it('UN RECHAZO TERMINAL REVIERTE LA PROYECCIÓN ENTERA, exactamente', () => {
    const rejected = entry({ state: 'rejected' });
    const reviewed = entry({ state: 'review' });
    const conflicted = entry({ state: 'conflict' });
    const home = project([rejected, reviewed, conflicted], snapshot({}));

    expect(home.balance).toBe('10000');
    expect(home.statistics).toEqual(STATS);
    expect(home.operations.map((op) => op.render_key)).toEqual(['op-server-1']);
    expect(home.unreconciled).toBe(0);
  });

  it('un transitorio prolongado mantiene la proyección, con la misma clave', () => {
    const retrying = entry({ state: 'retryable' });
    const blocked = entry({ state: 'blocked_session' });
    const home = project([retrying, blocked], snapshot({}));
    expect(home.balance).toBe('7540');
    expect(home.operations.filter((op) => op.client_operation_id !== null)).toHaveLength(2);
  });

  it('OTRO ÁMBITO NO SE PROYECTA: ni fila ni efecto', () => {
    const foreign = entry({ scopeId: OTHER_SCOPE });
    const home = project([foreign], snapshot({}));
    expect(home.balance).toBe('10000');
    expect(home.operations).toHaveLength(1);
    expect(home.unreconciled).toBe(0);
  });
});

/**
 * EL CAMBIO DE DEFINICIÓN MONETARIA (ADR-003 §7, ADR-028 §14).
 *
 * La ruta es real y está medida: `api.set_personal_base_currency` sólo se niega
 * —`BASE_CURRENCY_LOCKED · 409`— cuando el ámbito YA tiene efectos, así que un
 * ámbito recién creado puede cambiar de moneda base con una entrada ya
 * capturada bajo la anterior. Y el código ISO no lo delata: `core.currency_definition`
 * no tiene unicidad por `code`, y su propio comentario dice que dos definiciones
 * pueden compartirlo.
 *
 * Lo que §14 exige es exactamente esto: **conserva su importe, su moneda y su
 * fecha efectiva, no produce ningún efecto, y entra en revisión**. Ni se
 * convierte, ni se recalcula, ni se sustituye la definición — ni se borra de la
 * pantalla, que sería descartarla en silencio.
 */
describe('dos definiciones con el mismo código visible', () => {
  const OTHER_EUR = '44444444-4444-4444-8444-444444444444';
  const under = (over: Parameters<typeof entry>[0] = {}) =>
    entry({ currencyId: OTHER_EUR, amount: '4280', concept: 'Cena', ...over });

  it('LA FILA SIGUE APARECIENDO, con su importe y bajo SU definición', () => {
    const stale = under();
    const home = project([stale], snapshot({}));

    const row = home.operations.find((op) => op.client_operation_id === stale.clientOperationId);
    expect(row).toBeDefined();
    // El importe declarado, intacto. Nadie lo ha tocado.
    expect(row?.original_amount).toBe('4280');
    expect(row?.effective_date).toBe(TODAY);
    expect(row?.concept).toBe('Cena');
    // Y bajo la definición con la que se capturó, no bajo la vigente.
    expect(row?.currency_definition_id).toBe(OTHER_EUR);
    expect(row?.counted).toBe(false);
  });

  it('NO SUMA EN NINGÚN AGREGADO: ni Disponible, ni Gastos, ni Ingresos, ni reparto', () => {
    const home = project([under()], snapshot({}));

    expect(home.balance).toBe('10000');
    expect(home.statistics?.expense_total).toBe('2000');
    expect(home.statistics?.income_total).toBe('5000');
    expect(home.statistics?.categories).toEqual(STATS.categories);
  });

  it('un ingreso bajo otra definición tampoco sube el Disponible', () => {
    const home = project([under({ kind: 'income', amount: '2000' })], snapshot({}));
    expect(home.balance).toBe('10000');
    expect(home.statistics?.income_total).toBe('5000');
  });

  it('CONVIVE con una entrada de la definición vigente, que sí suma', () => {
    const good = entry({ amount: '1230', category: CAT_B });
    const home = project([good, under()], snapshot({}));

    // 100,00 − 12,30. Los 42,80 de la otra definición NO entran.
    expect(home.balance).toBe('8770');
    expect(home.statistics?.expense_total).toBe('3230');
    // Pero las dos filas están en pantalla.
    expect(home.operations.filter((op) => op.client_operation_id !== null)).toHaveLength(2);
  });

  it('NO SE PODA NI SE DA POR RECONCILIADA, y mantiene bloqueado «Fijar el Disponible»', () => {
    const home = project([under()], snapshot({ balanceSeq: 9, intervalSeq: 9 }));
    // Aunque las marcas del snapshot sean muy posteriores: sin efectos no hay
    // nada que el snapshot pueda contener, y la intención sigue sin resolver.
    expect(home.reconciled).toEqual([]);
    expect(home.unreconciled).toBe(1);
  });

  it('AL RESOLVERLA LA FRONTERA se retira entera: `conflict` es terminal', () => {
    // `store.pending` ya no la devuelve; la proyección lo vuelve a comprobar.
    const home = project([under({ state: 'conflict' })], snapshot({}));
    expect(home.operations.filter((op) => op.client_operation_id !== null)).toEqual([]);
    expect(home.balance).toBe('10000');
    expect(home.unreconciled).toBe(0);
  });

  it('la definición VIGENTE se compara por identidad, nunca por código', () => {
    // Mismo código y misma escala que el ámbito, identidad distinta.
    const stale = under();
    expect(stale.currency.code).toBe(scope.currencyCode);
    expect(stale.currency.scale).toBe(scope.currencyScale);
    expect(stale.currency.definitionId).not.toBe(scope.currencyDefinitionId);
    expect(project([stale], snapshot({})).balance).toBe('10000');
  });
});

describe('sin base confirmada no se fabrica ninguna cifra', () => {
  it('ARRANQUE EN FRÍO SIN RED: filas visibles, agregados no disponibles', () => {
    const a = entry({ amount: '1230' });
    const b = entry({ kind: 'income', amount: '500' });
    const home = project([a, b], { balance: null, interval: null });

    expect(home.operations).toHaveLength(2);
    expect(home.total).toBe(2);
    expect(home.balance).toBeNull();
    expect(home.statistics).toBeNull();
    expect(home.unreconciled).toBe(2);
  });

  it('con saldo y sin intervalo, sólo el Disponible se proyecta', () => {
    const home = project([entry({ amount: '1230' })], {
      balance: { amount: '10000', seq: 0 },
      interval: null,
    });
    expect(home.balance).toBe('8770');
    expect(home.statistics).toBeNull();
    expect(home.operations).toHaveLength(1);
  });

  it('con intervalo y sin saldo, el Disponible sigue sin fabricarse', () => {
    const home = project([entry({ amount: '1230' })], snapshot({ balance: null }));
    expect(home.balance).toBeNull();
    expect(home.statistics?.expense_total).toBe('3230');
  });

  it('sin estadísticas del servidor no se inventa un total desde lo local', () => {
    const home = project([entry({ amount: '1230' })], snapshot({ statistics: null }));
    expect(home.statistics).toBeNull();
  });
});

describe('la aritmética es exacta y de dominio', () => {
  it('por encima de 2^53 no pierde ni una unidad mínima', () => {
    const local = entry({ kind: 'income', amount: '1' });
    const home = project([local], snapshot({ balance: '9007199254740993', statistics: null }));
    expect(home.balance).toBe('9007199254740994');
  });

  it('las cifras salen como texto entero: nada cruza por `number`', () => {
    const home = project([entry({ amount: '1230' })], snapshot({}));
    expect(typeof home.balance).toBe('string');
    expect(home.balance).toMatch(/^-?\d+$/);
    expect(home.statistics?.expense_total).toMatch(/^\d+$/);
    for (const row of home.operations) expect(row.balance_amount).toMatch(/^-?\d+$/);
  });

  it('una fila del servidor se pinta bajo la moneda base del ámbito', () => {
    const home = project([], snapshot({}));
    expect(home.operations[0]).toMatchObject({
      currency_code: 'EUR',
      currency_scale: 2,
      counted: true,
    });
  });

  it('una fila local no está reconciliada; una del servidor, sí', () => {
    const home = project([entry({})], snapshot({}));
    const local = home.operations.find((op) => op.client_operation_id !== null)!;
    const server = home.operations.find((op) => op.client_operation_id === null)!;
    expect(isReconciled(local)).toBe(false);
    expect(isReconciled(server)).toBe(true);
  });
});
