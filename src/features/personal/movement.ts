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
 * Si esta iteración de Inicio ofrece eliminar esta fila.
 *
 * **Se decide por la CLASE de la operación**, que llega en la superficie de
 * lectura, y nunca por el signo, el color o el texto: eso son presentación, y
 * un ajuste negativo se parece a un gasto en las tres cosas.
 *
 * Sólo gasto e ingreso. El ajuste de saldo se deja fuera a propósito: anularlo
 * es una operación válida en el servidor, pero lo que significa para quien lo
 * hizo —«el saldo vuelve a lo que decía antes»— necesita una explicación que
 * esta pantalla todavía no da. Las clases que lleguen en el futuro quedan
 * fuera por omisión, que es la respuesta segura.
 *
 * **No es autorización.** El servidor sigue siendo la autoridad: RLS decide qué
 * operaciones se ven y `api.annul_operation` decide cuáles se pueden anular.
 * Esto sólo evita ofrecer un gesto que no va a ninguna parte.
 */
export function canAnnul(operation: PersonalOperation): boolean {
  const kind = movementKind(operation.operation_class);
  return kind === 'income' || kind === 'expense';
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

/**
 * Si esta iteración de Inicio ofrece editar esta fila.
 *
 * **Las mismas dos clases que se pueden eliminar, y por el mismo motivo**: son
 * las que esta pantalla sabe describir por completo en su formulario. Un ajuste
 * de saldo se corrige declarando otro saldo objetivo, que es una conversación
 * distinta; el resto de clases ni siquiera aparece aquí todavía.
 *
 * Se decide por `operation_class` y nunca por el signo. **Y una operación
 * anulada tampoco llega**: su versión vigente no tiene efectos, así que no sale
 * de la superficie de lectura — la frontera lo remataría igualmente con
 * `OPERATION_ANNULLED · 409`.
 *
 * **No es autorización.** El servidor sigue siendo la autoridad; esto sólo
 * evita ofrecer un control que no lleva a ninguna parte.
 */
export function canEdit(operation: PersonalOperation): boolean {
  const kind = movementKind(operation.operation_class);
  return kind === 'income' || kind === 'expense';
}

/**
 * El saldo que había justo ANTES de este ajuste, en unidades mínimas.
 *
 * **Sale de la propia operación y de nada más:** `target_balance` es el saldo
 * que se declaró y `balance_amount` es el efecto que el servidor asentó para
 * llegar hasta él, así que su diferencia es lo que había. Las dos cifras
 * pertenecen a la MISMA versión canónica, y el delta lo derivó el servidor
 * **bajo lock y después del CAS** (ADR-022) — no de una lectura que pudiera
 * quedarse vieja.
 *
 * Por eso corresponde al instante de ESE ajuste y no al de ahora. El
 * Disponible de Inicio serviría para el último ajuste y mentiría para
 * cualquier otro; una observación tomada después describiría otro momento; y
 * una segunda consulta por fila sería 1+N para un dato que ya está aquí.
 *
 * `null` cuando no procede: si el ajuste se declaró por DELTA no hay saldo
 * objetivo del que restar, y lo honesto es no enseñar ninguno. Hoy la interfaz
 * sólo crea ajustes por objetivo, pero el modelo admite los otros y esta
 * función no puede inventarles un anterior.
 */
export function adjustmentPreviousBalance(operation: PersonalOperation): bigint | null {
  if (adjustmentForm(operation) !== 'target' || operation.target_balance === null) return null;
  return toMinor(operation.target_balance) - toMinor(operation.balance_amount);
}

/**
 * El color del importe de una fila, por CLASE de operación.
 *
 * **Un gasto ordinario ya no va en rojo.** El signo menos y su sitio en la
 * lista ya dicen que es una salida; el rojo, repetido en cada fila, competía
 * con lo que en Nomey sí es rojo —una deuda, un error, una alerta— y acababa
 * significando menos justo donde debería significar más. Se queda en el color
 * de texto principal, el mismo que ya llevan el concepto y la categoría.
 *
 * El ingreso conserva su verde: aparece pocas veces, y ahí el color informa en
 * vez de saturar.
 *
 * **Lo decide `operation_class` y NO el signo del importe.** Misma regla que
 * `canAnnul`: la clase es el dato canónico y el signo es presentación. Un
 * ajuste puede ser negativo sin ser un gasto, y con la regla del signo se
 * habría pintado como uno.
 *
 * **El ajuste y cualquier clase futura conservan el tratamiento por signo.** Es
 * deliberado: esta decisión es sobre el gasto y el ingreso, y no inventa
 * semántica para lo que no se ha mirado.
 *
 * El color no es nunca la única señal —el signo va siempre—, que es lo que
 * `design-direction.md` §8 exige.
 */
export function amountTone(
  operation: PersonalOperation,
): 'text' | 'textSecondary' | 'positive' | 'negative' {
  const kind = movementKind(operation.operation_class);
  if (kind === 'expense') return 'text';
  if (kind === 'income') return 'positive';

  if (kind === 'adjustment') {
    /*
     * **Un ajuste a la baja tampoco va en rojo**, por lo mismo que un gasto: el
     * signo ya dice la dirección, y el rojo de Nomey está reservado a lo que
     * de verdad va mal — una deuda, un error, una acción destructiva. Subir el
     * saldo sí conserva el verde: pasa poco, y ahí el color informa.
     *
     * El cero no es ninguna de las dos cosas. La interfaz no crea ajustes que
     * no cambien nada, pero si el histórico trae uno, decir «positivo» sería
     * afirmar algo que no ocurrió.
     */
    const delta = toMinor(operation.balance_amount);
    if (delta > 0n) return 'positive';
    if (delta < 0n) return 'text';
    return 'textSecondary';
  }

  return toMinor(operation.balance_amount) < 0n ? 'negative' : 'positive';
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
