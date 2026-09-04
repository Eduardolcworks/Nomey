/**
 * LA PROYECCIÓN OPTIMISTA: una sola, pura y compartida.
 *
 * ADR-028 §8. Inicio enseña `snapshot confirmado del servidor + comandos
 * locales todavía no reconciliados`, y todas sus superficies —Disponible,
 * Ingresos, Gastos, donut, leyenda y la lista— leen ESTA función. Ninguna
 * tarjeta suma nada por su cuenta.
 *
 * **No es una segunda aritmética.** Los efectos de una entrada local salen de
 * `derivePersonalExpense` y `derivePersonalIncome`, y los agregados de
 * `deriveBalance` y `deriveEconomicTotal`: la misma implementación de
 * referencia que la frontera del servidor reproduce exactamente (ADR-002 §7,
 * ADR-009 §1) y cuya paridad afirman los vectores compartidos. Todo es `bigint`
 * en unidad mínima bajo una definición monetaria; `sumMoney` rechaza mezclar
 * definiciones. Lo único que se añade aquí es el agrupamiento por
 * `category_id`, que no es una regla económica sino una suma exacta agrupada.
 *
 * **La entrada durable es la única fuente local.** Esto no guarda saldos,
 * totales ni filas; se recalcula en cada render a partir de la cola y del
 * snapshot que hay en memoria.
 *
 * ═══ RETIRADA POR SUPERFICIE ═══
 *
 * §9 dice: `retirada ⇔ confirm_seq <= snapshot.seq`, con `snapshot.seq` el
 * valor del contador durable **en el instante en que arrancó el refresco**. En
 * Inicio el snapshot lo traen DOS consultas independientes —el saldo por un
 * lado, y estadísticas más lista por otro, que además se repite al cambiar de
 * intervalo— así que cada una lleva su propio `seq`, y la regla se aplica a
 * cada agregado con el `seq` de la consulta que lo produjo:
 *
 *   Disponible          retira si confirm_seq <= balance.seq
 *   totales y reparto   retira si confirm_seq <= interval.seq
 *   lista               retira si confirm_seq <= interval.seq
 *                       o si la fila del servidor con su `result_operation_id`
 *                       ya está en la página (el atajo de §9, que sólo prueba
 *                       la lista)
 *   PODA de la entrada  cuando las tres han retirado
 *
 * Es la misma regla, no otra: aplicarla con un único `seq` a un snapshot que
 * llega por partes produciría exactamente los dos fallos que §9 prohíbe. Con
 * el `seq` del saldo viejo y el de la lista nuevo, retirar todo duplicaría el
 * gasto en los totales; retirar nada lo duplicaría en la lista. Y como el
 * saldo del servidor y el efecto local se suman en la misma expresión, nunca
 * hay un fotograma sin uno de los dos.
 *
 * **And the rule only holds because the base arrives clean.** `confirm_seq >
 * snapshot.seq` means "not in the snapshot" ONLY if nothing that could write on
 * the server overlapped that query — no confirmation, and no send in flight or
 * left unsettled. Otherwise the response may already carry the effect, and
 * adding it again here counts it twice. Whoever brings the snapshot refuses
 * those responses (`snapshot-window.ts`, where the whole argument lives), so
 * here the mark can be read as a bicondicional and not as half an implication.
 *
 * ═══ AN ENTRY UNDER A DIFFERENT MONETARY DEFINITION ═══
 *
 * Painted, never summed. ADR-028 §14: it keeps its amount, its currency and its
 * effective date, and produces no effect at all until somebody resolves it. The
 * ISO code does not make it aggregable — the definition's identity is compared.
 *
 * **La clave de render es estable.** Una fila local se pinta con su
 * `client_operation_id`; cuando aparece la del servidor con ese
 * `result_operation_id`, hereda esa misma clave. Quien llama conserva el alias
 * después de podar, para que la fila no remonte nunca.
 *
 * ═══ SIN BASE CONFIRMADA NO SE FABRICA NINGUNA CIFRA ═══
 *
 * Sin saldo del servidor, el Disponible es `null`; sin estadísticas, los
 * totales y el reparto son `null`. Las filas locales SÍ se enseñan: son
 * intenciones declaradas, no cifras derivadas. Antes que una cifra dudosa,
 * ninguna cifra.
 */

import {
  currencyDefinition,
  deriveBalance,
  deriveEconomicTotal,
  derivePersonalExpense,
  derivePersonalIncome,
  type Effect,
  type Money,
  moneyFromMinorString,
  moneyToMinorString,
  scopeId,
  sumMoney,
} from '@/domain';
import type { QueueEntry } from '@/lib/offline/queue-entry';

import type { EntryScope } from './entry-enqueue';
import type { DateRange } from './interval';
import { compareOperations, type PersonalOperation } from './movement';
import type { PersonalStatistics, StatisticsCategory } from './statistics';

/**
 * Una fila tal como la pinta Inicio, venga del servidor o de la cola.
 *
 * `client_operation_id` no es una etiqueta: la interfaz no lo enseña ni lo
 * distingue con color, contador ni acción propia (ADR-028, invariante 13). Está
 * para que la ruta sepa que esa fila **todavía no tiene versión vigente** y
 * bloquee corregir y anular con su explicación (§10).
 */
export type ProjectedOperation = PersonalOperation & {
  /** Estable a través de la sustitución local → servidor. */
  readonly render_key: string;
  /** La entrada local que la pinta, o `null` si ya es una fila del servidor. */
  readonly client_operation_id: string | null;
  /**
   * WHICH DEFINITION THIS AMOUNT IS WRITTEN UNDER, not which one it aggregates
   * under.
   *
   * Almost always the scope's. It stops being so when the base currency moved
   * underneath an already captured entry (ADR-003 §7, ADR-028 §14): that row
   * keeps its amount and ITS currency, so whoever paints it has to format it
   * with the scale and code it carried, never with the current ones. Formatting
   * it with the new scale would silently reinterpret the amount.
   */
  readonly currency_code: string;
  readonly currency_scale: number;
  /**
   * Whether this row enters the Disponible, the totals and the breakdown.
   *
   * `false` only in the case above: the entry is painted, but there is no
   * common definition to sum it under (ADR-028 §14 — "produces no effect").
   */
  readonly counted: boolean;
};

/**
 * What the server has confirmed, in memory, with the `seq` of each part.
 *
 * Every block is a response taken inside a **quiet window**: nothing that could
 * have written on the server overlapped the query that produced it
 * (`snapshot-window.ts`). Without that condition `seq` could not decide whether
 * the snapshot already contains an entry.
 */
export type ProjectionSnapshot = {
  readonly balance: { readonly amount: string; readonly seq: number } | null;
  readonly interval: {
    readonly statistics: PersonalStatistics | null;
    readonly operations: readonly PersonalOperation[];
    readonly total: number;
    readonly seq: number;
  } | null;
};

export type ProjectionInput = {
  readonly scope: EntryScope;
  readonly range: DateRange;
  /** Las entradas NO terminales del actor: lo que devuelve `store.pending`. */
  readonly entries: readonly QueueEntry[];
  readonly snapshot: ProjectionSnapshot;
  /** `operation_id` del servidor → clave local que hereda. De proyecciones anteriores. */
  readonly aliases: ReadonlyMap<string, string>;
};

export type ProjectedHome = {
  readonly operations: readonly ProjectedOperation[];
  readonly total: number;
  /** En unidad mínima. `null` cuando el servidor no ha dado saldo: no se fabrica. */
  readonly balance: string | null;
  /** `null` cuando no hay estadísticas confirmadas: no se fabrican. */
  readonly statistics: PersonalStatistics | null;
  /** Entradas que las TRES superficies ya han retirado. Se pueden podar. */
  readonly reconciled: readonly string[];
  /** Alias descubiertos en esta proyección, para conservarlos tras la poda. */
  readonly aliases: ReadonlyMap<string, string>;
  /** Cuántas entradas locales siguen proyectadas en alguna superficie. */
  readonly unreconciled: number;
};

const PROJECTED_STATES = new Set<QueueEntry['state']>([
  'queued',
  'retryable',
  'blocked_session',
  'confirmed',
]);

type LocalEffects = {
  readonly entry: QueueEntry;
  readonly effects: readonly Effect[];
  readonly row: ProjectedOperation;
  readonly inRange: boolean;
};

function inRange(date: string, range: DateRange): boolean {
  if (range.from !== null && date < range.from) return false;
  if (range.to !== null && date > range.to) return false;
  return true;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Which entries get PAINTED, and why the rest do not.
 *
 * - Only this scope's: the queue is per actor, and an actor will have more than
 *   one scope once Groups arrive.
 * - Only non-terminal states: `rejected`, `review` and `conflict` withdraw the
 *   whole projection (§8, limit 7) — `store.pending` no longer returns them,
 *   and it is checked again here so this does not depend on the caller.
 *
 * **The monetary snapshot does NOT decide whether a row is painted**, only
 * whether it is summed; that is `contributes`.
 */
function shown(entries: readonly QueueEntry[], scope: EntryScope): QueueEntry[] {
  return entries.filter(
    (entry) =>
      entry.scopeId === scope.scopeId &&
      PROJECTED_STATES.has(entry.state) &&
      (entry.commandType === 'personal_expense.create' ||
        entry.commandType === 'personal_income.create'),
  );
}

/**
 * Whether this entry may be SUMMED into the scope's aggregates.
 *
 * Only if its monetary snapshot is the definition in force. If it is not, there
 * is no common definition to aggregate under (ADR-003 §3) and converting is
 * F11's job: the boundary will settle it with
 * `CURRENCY_CONVERSION_UNSUPPORTED`, and ADR-028 §14 fixes the treatment — **it
 * keeps its amount, its currency and its effective date, and produces no
 * effect**.
 *
 * Not summing **does not make it disappear**. Its row is still painted, with
 * its amount and under ITS definition, because it is an intention a person
 * declared and taking it off the screen would be discarding it silently, which
 * is exactly what §14 forbids. What it does not do is enter the Disponible,
 * Ingresos, Gastos or the breakdown: there it would be a figure under a
 * currency that is not those aggregates'.
 *
 * **The ISO code plays no part.** Two different definitions can both show
 * "EUR" and are not aggregable (ADR-003 §3, `AGENTS.md` §1): identity is
 * compared, never the code.
 */
function contributes(entry: QueueEntry, scope: EntryScope): boolean {
  return entry.currency.definitionId === scope.currencyDefinitionId;
}

export function projectHome(input: ProjectionInput): ProjectedHome {
  const { scope, range, snapshot } = input;
  const currency = currencyDefinition({
    id: scope.currencyDefinitionId,
    code: scope.currencyCode,
    scale: scope.currencyScale,
  });
  const sid = scopeId(scope.scopeId);

  const locals: LocalEffects[] = shown(input.entries, scope).map((entry) => {
    /*
     * Effects are derived under the ENTRY's definition — the one it declared —
     * and not under the scope's current one. They always coincide except when
     * the base moved underneath (§14), and there deriving with the current one
     * would reinterpret the amount. What decides whether those effects are
     * AGGREGATED is `counted`; `sumMoney` backstops it by refusing any mix.
     */
    const own = currencyDefinition({
      id: entry.currency.definitionId,
      code: entry.currency.code,
      scale: entry.currency.scale,
    });
    const amount = moneyFromMinorString(String(entry.payload.amount), own);
    const effects =
      entry.commandType === 'personal_income.create'
        ? derivePersonalIncome({ scope: sid, amount })
        : derivePersonalExpense({ scope: sid, amount });
    const balance = effects[0].balance as Money;
    const time = text(entry.payload.effective_time);
    const date = String(entry.payload.effective_date);

    const row: ProjectedOperation = {
      operation_id: entry.clientOperationId,
      operation_class:
        entry.commandType === 'personal_income.create' ? 'personal_income' : 'personal_expense',
      scope_id: entry.scopeId,
      currency_definition_id: entry.currency.definitionId,
      balance_amount: moneyToMinorString(balance),
      original_amount: String(entry.payload.amount),
      effective_date: date,
      // El servidor publica `time` como HH:MM:SS; el payload lleva HH:MM.
      effective_time: time === null ? null : `${time}:00`,
      concept: text(entry.payload.concept),
      category_id: text(entry.payload.category_id),
      target_balance: null,
      // Sin versión vigente: no hay CAS que enviar, y por eso no se corrige ni se anula.
      current_version_id: '',
      previous_version_id: null,
      version_no: 1,
      operation_created_at: entry.createdAt,
      render_key: entry.clientOperationId,
      client_operation_id: entry.clientOperationId,
      currency_code: entry.currency.code,
      currency_scale: entry.currency.scale,
      counted: contributes(entry, scope),
    };

    return { entry, effects, row, inRange: inRange(date, range) };
  });

  /** The ones that do share a definition with the scope: the only summable. */
  const counted = locals.filter((local) => local.row.counted);

  // ---- retirada, superficie a superficie ----------------------------------
  const provenBy = (entry: QueueEntry, seq: number | undefined) =>
    entry.state === 'confirmed' &&
    entry.confirmSeq !== null &&
    seq !== undefined &&
    entry.confirmSeq <= seq;

  const balanceSeq = snapshot.balance?.seq;
  const intervalSeq = snapshot.interval?.seq;
  const serverIds = new Set(snapshot.interval?.operations.map((op) => op.operation_id) ?? []);

  /*
   * El atajo de §9: si la fila del servidor con ese `result_operation_id` ya
   * está en la página, la consulta corrió después de la escritura. Prueba el
   * bloque del intervalo ENTERO —lista y estadísticas salen de la misma
   * consulta— y nada más: el saldo llega por otra, que pudo correr antes.
   */
  const shownByServer = (entry: QueueEntry) =>
    entry.resultOperationId !== null && serverIds.has(entry.resultOperationId);

  const intervalHas = (entry: QueueEntry) => provenBy(entry, intervalSeq) || shownByServer(entry);

  const inBalance = counted.filter((local) => !provenBy(local.entry, balanceSeq));
  const inInterval = counted.filter((local) => !intervalHas(local.entry));
  /*
   * The list DOES show the ones that do not sum: an entry under another
   * definition is still a declared intention, and hiding it would be discarding
   * it silently (§14). It is never retired by the mark — it cannot be confirmed
   * — and it disappears when the boundary settles it as `conflict`, terminal.
   */
  const inList = locals.filter(
    (local) => local.inRange && (!local.row.counted || !intervalHas(local.entry)),
  );

  const reconciled = counted
    .filter((local) => provenBy(local.entry, balanceSeq) && intervalHas(local.entry))
    .map((local) => local.entry.clientOperationId);

  // ---- alias: la fila del servidor hereda la clave local ------------------
  const aliases = new Map<string, string>();
  for (const local of locals) {
    if (local.entry.resultOperationId !== null) {
      aliases.set(local.entry.resultOperationId, local.entry.clientOperationId);
    }
  }

  // ---- la lista ------------------------------------------------------------
  const serverRows: ProjectedOperation[] = (snapshot.interval?.operations ?? []).map((op) => ({
    ...op,
    render_key:
      aliases.get(op.operation_id) ?? input.aliases.get(op.operation_id) ?? op.operation_id,
    client_operation_id: null,
    // A server row is always under the scope's base currency: the effect's
    // composite FK makes that structural (ADR-013, invariant 12).
    currency_code: scope.currencyCode,
    currency_scale: scope.currencyScale,
    counted: true,
  }));
  const operations = [...serverRows, ...inList.map((local) => local.row)].sort(compareOperations);
  const total = (snapshot.interval?.total ?? 0) + inList.length;

  // ---- el Disponible -------------------------------------------------------
  const balance =
    snapshot.balance === null
      ? null
      : moneyToMinorString(
          sumMoney(
            [
              moneyFromMinorString(snapshot.balance.amount, currency),
              ...inBalance.map((local) => deriveBalance(local.effects, sid, currency)),
            ],
            currency,
          ),
        );

  // ---- totales y reparto ---------------------------------------------------
  const statistics = projectStatistics(
    snapshot.interval?.statistics ?? null,
    inInterval.filter((local) => local.inRange),
    sid,
    currency,
  );

  /*
   * Unreconciled means EVERY local intention still alive, including the one
   * that does not sum. It is what blocks "Fijar el Disponible" (§10), and with
   * an unresolved entry under another currency the declared balance is still
   * ambiguous: the person is looking at a row their Disponible does not carry.
   * The block lifts when that entry is resolved, not before.
   */
  const unreconciledIds = new Set<string>();
  for (const local of inBalance) unreconciledIds.add(local.entry.clientOperationId);
  for (const local of inInterval) unreconciledIds.add(local.entry.clientOperationId);
  for (const local of locals) {
    if (!local.row.counted) unreconciledIds.add(local.entry.clientOperationId);
  }

  return {
    operations,
    total,
    balance,
    statistics,
    reconciled,
    aliases,
    unreconciled: unreconciledIds.size,
  };
}

/**
 * Los totales del intervalo y el reparto, con las entradas locales del
 * intervalo sumadas encima. Sin estadísticas del servidor no hay nada sobre lo
 * que sumar, y se devuelve `null`: no se fabrica un total a partir de lo local.
 */
function projectStatistics(
  server: PersonalStatistics | null,
  locals: readonly LocalEffects[],
  sid: ReturnType<typeof scopeId>,
  currency: ReturnType<typeof currencyDefinition>,
): PersonalStatistics | null {
  if (server === null) return null;
  if (locals.length === 0) return server;

  const effects = locals.flatMap((local) => local.effects);
  const income = sumMoney(
    [
      moneyFromMinorString(server.income_total, currency),
      deriveEconomicTotal(effects, sid, 'income', currency),
    ],
    currency,
  );
  const expense = sumMoney(
    [
      moneyFromMinorString(server.expense_total, currency),
      deriveEconomicTotal(effects, sid, 'expense', currency),
    ],
    currency,
  );

  /*
   * El agrupamiento por categoría, que es lo único que la proyección añade por
   * su cuenta: cada gasto local suma su efecto económico a su categoría, exacto
   * y en unidad mínima. El orden es el de la frontera —total descendente,
   * identificador ascendente— para que un gasto local no reordene distinto de
   * como lo hará el servidor al confirmarlo.
   */
  const byCategory = new Map<string, { total: Money; count: number }>();
  for (const category of server.categories) {
    byCategory.set(category.category_id, {
      total: moneyFromMinorString(category.expense_total, currency),
      count: category.operation_count,
    });
  }
  for (const local of locals) {
    const category = local.row.category_id;
    if (category === null) continue;
    const economic = deriveEconomicTotal(local.effects, sid, 'expense', currency);
    if (economic.minor === 0n) continue;
    const current = byCategory.get(category);
    byCategory.set(category, {
      total: current === undefined ? economic : sumMoney([current.total, economic], currency),
      count: (current?.count ?? 0) + 1,
    });
  }

  const categories: StatisticsCategory[] = [...byCategory.entries()]
    .map(([category_id, value]) => ({
      category_id,
      expense_total: moneyToMinorString(value.total),
      operation_count: value.count,
    }))
    .sort((a, b) => {
      const left = BigInt(a.expense_total);
      const right = BigInt(b.expense_total);
      if (left !== right) return left > right ? -1 : 1;
      return a.category_id < b.category_id ? -1 : a.category_id > b.category_id ? 1 : 0;
    });

  return {
    ...server,
    income_total: moneyToMinorString(income),
    expense_total: moneyToMinorString(expense),
    categories,
  };
}

/** Si esa fila ya es una operación del servidor con versión vigente. */
export function isReconciled(operation: ProjectedOperation): boolean {
  return operation.client_operation_id === null;
}
