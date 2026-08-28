import { toMinor } from './statistics';

/**
 * Una operación tal como la entrega `api.personal_operation`.
 *
 * Los dos importes NO son el mismo dato, y confundirlos es el error que la
 * obligación de F6.D avisa expresamente:
 *
 *   `balance_amount`   FIRMADO. Lo que la operación mueve en el saldo
 *   `original_amount`  El importe DECLARADO de la versión (ADR-013 §3)
 */
export type PersonalOperation = {
  readonly operation_id: string;
  readonly operation_class: string;
  readonly scope_id: string;
  readonly currency_definition_id: string;
  readonly balance_amount: string;
  readonly original_amount: string;
  readonly effective_date: string;
  readonly effective_time: string | null;
  readonly concept: string | null;
  readonly category_id: string | null;
  readonly target_balance: string | null;
  readonly current_version_id: string;
  readonly previous_version_id: string | null;
  readonly version_no: number;
  readonly operation_created_at: string;
};

/** Una versión, de `api.personal_operation_version`. */
export type PersonalOperationVersion = {
  readonly operation_id: string;
  readonly operation_version_id: string;
  readonly operation_class: string;
  readonly version_no: number;
  readonly is_current: boolean;
  readonly original_amount: string;
  readonly currency_definition_id: string;
  readonly effective_date: string;
  readonly effective_time: string | null;
  readonly concept: string | null;
  readonly category_id: string | null;
  readonly target_balance: string | null;
};

/** Una observación, de `api.observed_balance`. */
export type BalanceObservation = {
  readonly operation_id: string;
  readonly operation_version_id: string;
  readonly is_current: boolean;
  readonly scope_id: string;
  readonly observed_balance_before: string;
  readonly observed_balance_after: string;
};

/**
 * Lo que el producto distingue en una fila.
 *
 * Sale de `operation_class` —el TIPO de operación— y no de `accounting_class`,
 * que es la clase contable y vive en el efecto. Son dos vocabularios distintos
 * en dos columnas distintas, y `AGENTS.md` ya registra que confundirlos costó
 * corregir fixtures.
 */
export type MovementKind = 'income' | 'expense' | 'adjustment';

export function movementKind(operationClass: string): MovementKind | null {
  if (operationClass === 'personal_income') return 'income';
  if (operationClass === 'personal_expense') return 'expense';
  if (operationClass === 'adjustment') return 'adjustment';
  return null;
}

/**
 * El signo que la presentación pone a un importe **declarado**.
 *
 * Existe porque el historial no puede publicar un importe firmado: los efectos
 * de una versión superada están en `core.effect`, que ninguna vista puede leer
 * (ADR-013 §9). Así que la línea tachada del «Editado» sólo tiene
 * `original_amount`, y el signo lo pone aquí.
 *
 * **Es seguro hacerlo por clase** porque todas las versiones de una operación
 * son de la misma clase: lo garantiza la guarda `OPERATION_CLASS_MISMATCH` de
 * ADR-020. Y es comprobable: para la versión vigente el resultado tiene que
 * coincidir EXACTAMENTE con `balance_amount`, que sí viene firmado del
 * servidor. Si algún día dejaran de coincidir, esta función miente.
 */
export function displayMinor(kind: MovementKind, originalAmount: string): bigint {
  const minor = toMinor(originalAmount);
  // Un gasto se declara en positivo y se muestra en negativo. Un ingreso y un
  // ajuste ya vienen con el signo que se muestra —el delta de un ajuste puede
  // ser negativo, y `core.operation_version` no lo restringe.
  return kind === 'expense' ? -minor : minor;
}

/** `true` si la operación tiene una versión anterior que enseñar. */
export function isEdited(operation: PersonalOperation): boolean {
  return operation.previous_version_id !== null;
}

/**
 * Las dos formas del ajuste, y `null` para lo que no es un ajuste.
 *
 * El discriminante es `target_balance`, tal como ADR-022 §1 las define. No se
 * inventa concepto ni categoría para ninguna de las dos.
 */
export function adjustmentForm(operation: PersonalOperation): 'target' | 'delta' | null {
  if (movementKind(operation.operation_class) !== 'adjustment') return null;
  return operation.target_balance === null ? 'delta' : 'target';
}

/**
 * El orden canónico de la lista, que es **contrato del cliente**: una vista no
 * puede imponérselo a PostgREST.
 *
 *   effective_date desc, effective_time desc nulls last,
 *   operation_created_at desc, operation_id desc
 *
 * El desempate es el de la OPERACIÓN y no el de la versión, para que corregir
 * un movimiento no lo reordene entre sus pares del mismo día y hora.
 */
export const OPERATION_ORDER =
  'effective_date.desc,effective_time.desc.nullslast,operation_created_at.desc,operation_id.desc';

/**
 * Reordena en cliente con el mismo criterio, para una lista ya cargada.
 *
 * No sustituye al `order` de la petición: existe para que filtrar por ingresos
 * o por gastos conserve el orden sin volver al servidor.
 */
export function compareOperations(a: PersonalOperation, b: PersonalOperation): number {
  if (a.effective_date !== b.effective_date) return a.effective_date < b.effective_date ? 1 : -1;

  // Nulo va al final, que es lo que `nulls last` hace en el servidor. Un nulo
  // significa «sin hora registrada» y NUNCA medianoche (ADR-020 §3), así que no
  // se sustituye por `00:00` para poder compararlo.
  if (a.effective_time !== b.effective_time) {
    if (a.effective_time === null) return 1;
    if (b.effective_time === null) return -1;
    return a.effective_time < b.effective_time ? 1 : -1;
  }

  if (a.operation_created_at !== b.operation_created_at) {
    return a.operation_created_at < b.operation_created_at ? 1 : -1;
  }

  return a.operation_id < b.operation_id ? 1 : -1;
}

/** Las de una clase, conservando el orden. Para los desplegables de la home. */
export function operationsOfKind(
  operations: readonly PersonalOperation[],
  kind: MovementKind,
): PersonalOperation[] {
  return operations.filter((operation) => movementKind(operation.operation_class) === kind);
}

/**
 * Los `operation_version_id` que hay que pedir para pintar los «Editado» de una
 * página.
 *
 * **Una consulta por página, nunca una por fila.** Es la obligación que F6.D
 * dejó escrita, y la razón por la que la lista publica `previous_version_id` en
 * vez de dejar que el cliente reste uno a `version_no` — ADR-011 §11 nunca hizo
 * estructural que el predecesor sea la versión anterior.
 */
export function previousVersionIds(operations: readonly PersonalOperation[]): string[] {
  const ids = operations
    .map((operation) => operation.previous_version_id)
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/** Índice por identificador de versión, para resolver la línea tachada. */
export function indexVersions(
  versions: readonly PersonalOperationVersion[],
): Map<string, PersonalOperationVersion> {
  return new Map(versions.map((version) => [version.operation_version_id, version]));
}

/**
 * Índice de observaciones por operación, quedándose con **la de la versión
 * vigente**.
 *
 * La función devuelve todas las versiones y `is_current` las separa. La
 * expansión de un movimiento muestra la de su versión vigente: es la
 * fotografía que corresponde a lo que la fila está enseñando.
 */
export function indexObservations(
  observations: readonly BalanceObservation[],
): Map<string, BalanceObservation> {
  const byOperation = new Map<string, BalanceObservation>();
  for (const observation of observations) {
    if (observation.is_current) byOperation.set(observation.operation_id, observation);
  }
  return byOperation;
}
