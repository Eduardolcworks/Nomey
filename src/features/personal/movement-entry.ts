import type { CalendarDate } from '@/lib/format';
import { clockTimeOf } from '@/lib/format/date';

import { toMinorUnits } from '@/domain';

/*
 * ═══════════ LO QUE YA NO SE ESCRIBE AQUÍ, Y DÓNDE ESTÁ ═══════════
 *
 * Dos piezas de este archivo se mudaron cuando el gasto compartido necesitó las
 * mismas, y una feature no puede leer de otra:
 *
 *   `toMinorUnits`          → `domain/money/parse.ts`
 *       Traducir lo tecleado a unidades menores es una regla monetaria, no una
 *       decisión de pantalla: si dos formularios la implementaran por su cuenta,
 *       uno podría redondear el tercer decimal y el otro rechazarlo.
 *
 *   el reductor del teclado → `ui/components/amount-entry.ts`
 *       `AmountEntry` y sus reglas son estado de edición, no dinero: no conocen
 *       monedas ni `bigint`. Allí no dependen de nada.
 *
 * **Se reexportan desde aquí a propósito.** Todo el Modo Personal las importa de
 * este módulo, y cambiar quince ficheros para mover dos habría convertido una
 * mudanza en una pasada de riesgo sobre pantallas aprobadas. Lo que se comparte
 * es el código, no una copia; el punto de entrada sigue siendo el de siempre.
 */
export { toMinorUnits };
export {
  type AmountEntry,
  type AmountFieldState,
  type AmountTone,
  amountComplete,
  amountEntryFromMinor,
  amountFieldSelection,
  amountFieldStep,
  amountParts,
  amountTones,
  amountTouched,
  amountValue,
  applyAmountInput,
  backspaceAmount,
  EMPTY_AMOUNT,
  /*
   * Del MÓDULO, no del barril de `ui/components`.
   *
   * El barril arrastra componentes de React Native, y este archivo lo importan
   * pruebas que corren en Node puro: pasar por él las rompía con «Flow is not
   * supported» sobre `react-native/index.js`. `amount-entry.ts` no depende de
   * nada, que es justamente por lo que se pudo bajar a `ui/`.
   */
} from '@/ui/components/amount-entry';

/**
 * Qué se está registrando, y qué contrato le corresponde.
 *
 * `transfer` está en la lista porque el selector la ofrece, **no** porque haya
 * una ruta de escritura para ella. La razón está en `canRecord`, que es donde
 * un futuro contrato tendría que entrar, y no en un comentario suelto.
 */
export type EntryKind = 'expense' | 'income' | 'transfer';

export const ENTRY_KINDS: readonly EntryKind[] = ['expense', 'income', 'transfer'];

/** Lo que abre el `+`: un gasto, que es lo que se registra casi siempre. */
export const INITIAL_ENTRY_KIND: EntryKind = 'expense';

/**
 * Si esta clase tiene hoy una ruta de escritura cerrada.
 *
 * **Transferencia no la tiene, y no es un descuido.** Existen dos funciones en
 * `api` que se llaman transferencia y ninguna sirve para esta pantalla:
 *
 * - `record_internal_transfer` exige `from_scope_id` y `to_scope_id`
 *   **distintos**, y en la Fase 6 una persona tiene exactamente un ámbito. No
 *   hay segundo ámbito al que mover nada hasta que existan Grupos o Pareja.
 * - `record_external_transfer` sí acepta un solo ámbito, pero su payload
 *   admite `scope_id`, `delta`, moneda y fecha, y **nada más**: no lleva
 *   concepto ni hora. Cablearla desde aquí tiraría en silencio el concepto que
 *   la persona acaba de escribir.
 *
 * Inventar una tercera sería inventar una operación económica nueva, que es
 * exactamente lo que no se hace sin decisión.
 */
export function canRecord(kind: EntryKind): boolean {
  return kind === 'expense' || kind === 'income';
}

/** Si la categoría forma parte del contrato de esta clase (F06/ADR-009 §3). */
export function usesCategory(kind: EntryKind): boolean {
  return kind === 'expense';
}

/**
 * Lo que la persona ha escrito, tal cual, antes de validarse.
 *
 * El importe se guarda como **texto**: es lo que se teclea, y convertirlo a
 * número en cada pulsación introduciría un `Number` en el camino de un valor
 * monetario justo donde F02/ADR-001 dice que no.
 */
export type EntryDraft = {
  readonly kind: EntryKind;
  readonly amount: string;
  readonly concept: string;
  readonly categoryId: string | null;
  readonly date: CalendarDate;
  readonly time: string;
};

/** Por qué todavía no se puede guardar. `null` significa que sí se puede. */
export type EntryBlocker =
  | 'noRoute'
  | 'noScope'
  /**
   * Sin conexión y sin catálogo cacheado (F07/ADR-001 §16).
   *
   * Es distinto de `categoryMissing`: allí hay categorías y falta elegir una,
   * aquí **no hay ninguna que ofrecer**. Confundirlos diría «elige una
   * categoría» sobre un selector vacío.
   */
  | 'noCategories'
  | 'amountMissing'
  | 'amountInvalid'
  | 'conceptMissing'
  | 'categoryMissing';

/**
 * Qué impide guardar, en el orden en que la pantalla debería resolverlo.
 *
 * Se devuelve **uno** y no una lista: el botón dice una cosa, y enumerar tres
 * problemas a la vez sobre un formulario de cuatro campos es ruido.
 */
/**
 * @param hasCategories si hay catálogo del que elegir. Por defecto `true`, que
 * es como se comportaba antes de que existiera el respaldo sin conexión: sólo
 * lo pasa quien puede saberlo. **Un ingreso no lo mira**, porque no lleva
 * categoría (F06/ADR-009 §3), así que la falta de catálogo nunca bloquea un ingreso.
 */
export function blockerFor(
  draft: EntryDraft,
  scale: number,
  hasScope: boolean,
  hasCategories = true,
): EntryBlocker | null {
  if (!canRecord(draft.kind)) return 'noRoute';
  if (!hasScope) return 'noScope';
  if (usesCategory(draft.kind) && !hasCategories) return 'noCategories';

  if (draft.amount.trim() === '') return 'amountMissing';
  const minor = toMinorUnits(draft.amount, scale);
  if (minor === null || minor <= 0n) return 'amountInvalid';

  if (draft.concept.trim() === '') return 'conceptMissing';
  if (usesCategory(draft.kind) && draft.categoryId === null) return 'categoryMissing';

  return null;
}

/**
 * El payload de la frontera, ya con la forma que admite cada clase.
 *
 * **La categoría entra sólo en el gasto**, y no por un `if` de presentación:
 * un ingreso que la lleve se rechaza por FORMA del payload —`PAYLOAD_INVALID`,
 * antes de mirar a qué apunta el identificador— porque `category_id` dejó de
 * ser un campo admisible de su contrato (F06/ADR-009 §3).
 *
 * **El importe sale como texto** y el `bigint` no llega a cruzar JSON: F03/ADR-005
 * §1 no admite un número donde hay dinero.
 */
export type EntryPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 2;
  readonly scope_id: string;
  readonly currency_definition_id: string;
  readonly amount: string;
  readonly effective_date: string;
  readonly effective_time: string;
  readonly concept: string;
  readonly category_id?: string;
  /**
   * Los dos campos que convierten un alta en una CORRECCIÓN.
   *
   * **Es la misma función de la frontera**, y no un writer aparte: crear y
   * corregir comparten `api.record_personal_expense` y
   * `api.record_personal_income`, y lo que las distingue es que el payload
   * traiga estos dos. Con ellos, `sec.lock_and_cas` comprueba que la versión
   * que se dice corregir siga siendo la vigente y encadena la nueva detrás.
   *
   * Ausentes, es un alta. Presentes, una corrección de esa misma operación —
   * nunca una operación nueva, y nunca un `UPDATE` sobre la anterior.
   */
  readonly operation_id?: string;
  readonly expected_version_id?: string;
};

/** La versión que se está corrigiendo. Ausente en un alta. */
export type EntryTarget = {
  readonly operationId: string;
  readonly expectedVersionId: string;
};

export function buildPayload(
  draft: EntryDraft,
  scope: { scopeId: string; currencyDefinitionId: string; currencyScale: number },
  clientOperationId: string,
  target?: EntryTarget,
): EntryPayload | null {
  if (blockerFor(draft, scope.currencyScale, true) !== null) return null;

  const minor = toMinorUnits(draft.amount, scope.currencyScale);
  if (minor === null) return null;

  const base = {
    client_operation_id: clientOperationId,
    command_contract_version: 2,
    scope_id: scope.scopeId,
    currency_definition_id: scope.currencyDefinitionId,
    amount: minor.toString(),
    effective_date: draft.date,
    effective_time: draft.time,
    concept: draft.concept.trim(),
  } as const;

  const withCategory =
    usesCategory(draft.kind) && draft.categoryId !== null
      ? { ...base, category_id: draft.categoryId }
      : base;

  /*
   * La corrección se declara AÑADIENDO dos campos, no cambiando de función.
   * Lo demás del payload es idéntico al de un alta, así que no hay dos formas
   * de describir el mismo movimiento que puedan separarse.
   */
  return target === undefined
    ? withCategory
    : {
        ...withCategory,
        operation_id: target.operationId,
        expected_version_id: target.expectedVersionId,
      };
}

/**
 * Si dos borradores describen el MISMO movimiento.
 *
 * Sirve para no escribir una versión que no corrige nada: abrir el editor,
 * mirar y cerrar no debe dejar una v2 idéntica a la v1 en el historial.
 *
 * **Compara la forma canónica, no lo que se ve.** El importe se compara en
 * unidades mínimas —así `5`, `5,0` y `5,00` son el mismo importe— y el concepto
 * recortado, que es exactamente lo que `buildPayload` acaba mandando. Comparar
 * las cadenas del formulario daría por distinto un espacio de más.
 */
export function sameEntry(a: EntryDraft, b: EntryDraft, scale: number): boolean {
  const left = toMinorUnits(a.amount, scale);
  const right = toMinorUnits(b.amount, scale);

  return (
    a.kind === b.kind &&
    left !== null &&
    right !== null &&
    left === right &&
    a.concept.trim() === b.concept.trim() &&
    (a.categoryId ?? '') === (b.categoryId ?? '') &&
    a.date === b.date &&
    a.time === b.time
  );
}

/**
 * La hora efectiva de ahora mismo, `HH:MM`, en el reloj **local**.
 *
 * Local y no UTC por lo mismo que `todayInDeviceCalendar`: el par fecha+hora es
 * un reloj de pared (F06/ADR-002 §3), y tomarla en UTC pondría a media Europa una
 * cena de las 22:30 al día siguiente.
 */
export function currentClockTime(now: Date = new Date()): string {
  // La misma función que usa el gasto compartido: un solo reloj de pared.
  return clockTimeOf(now);
}

/** La fecha de un `Date` del selector nativo, en el calendario del aparato. */
export function calendarDateOf(value: Date): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` as CalendarDate;
}

/** Un `CalendarDate` de vuelta a `Date`, para dárselo al selector nativo. */
export function dateFromCalendar(value: CalendarDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
