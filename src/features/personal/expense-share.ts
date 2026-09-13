import type { PersonalOperation } from './movement';
import { compareOperations } from './movement';

/**
 * MI CUOTA DE UN GASTO COMPARTIDO, tal como la publica
 * `api.personal_expense_share`: una fila por operación vigente en la que
 * participo, con su contexto, y con la cifra que es MÍA —la cuota económica—,
 * nunca lo que adelantó quien pagó.
 *
 * Es lo que le faltaba al desplegable de Gastos. Movimientos recientes explica
 * la CAJA (`api.personal_operation`) y sigue haciéndolo; el total de Gastos y
 * el diagrama son la cuota económica (`api.personal_statistics`), y estas
 * filas son exactamente las que ese total suma: la misma función reducida del
 * servidor por debajo, el mismo intervalo.
 *
 * `null` en nombre, emoji o pagador significa «no disponible», no «nadie»:
 * la pantalla lo dice y conserva la cuota.
 */
export type ExpenseShare = {
  readonly operation_id: string;
  readonly current_version_id: string;
  readonly scope_id: string;
  readonly group_display_name: string | null;
  readonly group_emoji: string | null;
  readonly concept: string | null;
  readonly category_id: string | null;
  readonly effective_date: string;
  readonly effective_time: string | null;
  readonly payer_display_name: string | null;
  /** Unidades menores, texto: el total del gasto que adelantó el pagador. */
  readonly total_amount: string;
  /** Unidades menores, texto: lo que es mío. */
  readonly share_amount: string;
  /** La divisa del GRUPO, que es la de la cuota; no se convierte. */
  readonly currency_definition_id: string;
  readonly currency_code: string;
  readonly currency_scale: number;
  readonly operation_created_at: string;
};

/**
 * Una línea del desglose de Gastos: un gasto personal —proyectado, con su
 * clave de render, que es lo que la pantalla ya pinta— o una cuota compartida.
 */
export type ExpenseLine<T extends PersonalOperation = PersonalOperation> =
  | { readonly kind: 'personal'; readonly operation: T }
  | { readonly kind: 'share'; readonly share: ExpenseShare };

/**
 * LAS DOS FUENTES, MEZCLADAS EN EL ORDEN CANÓNICO de la lista: fecha efectiva
 * desc, hora desc con nulos al final, alta desc, identidad desc — el mismo
 * `compareOperations` de Movimientos recientes, sobre las mismas cuatro claves.
 * Una cuota no lleva `render_key`: su identidad es la operación, que no se
 * proyecta en local (un gasto compartido no pasa por la cola de Personal).
 */
export function expenseLines<T extends PersonalOperation>(
  personal: readonly T[],
  shares: readonly ExpenseShare[],
): ExpenseLine<T>[] {
  const lines: ExpenseLine<T>[] = [
    ...personal.map((operation) => ({ kind: 'personal' as const, operation })),
    ...shares.map((share) => ({ kind: 'share' as const, share })),
  ];
  return lines.sort((a, b) => compareOperations(orderKeys(a), orderKeys(b)));
}

/** Las cuatro claves del orden, sacadas de una línea cualquiera. */
function orderKeys(line: ExpenseLine<PersonalOperation>): PersonalOperation {
  if (line.kind === 'personal') return line.operation;
  return {
    effective_date: line.share.effective_date,
    effective_time: line.share.effective_time,
    operation_created_at: line.share.operation_created_at,
    operation_id: line.share.operation_id,
  } as PersonalOperation;
}

/** La clave estable de una cuota para el estado de despliegue, distinta de cualquier operación. */
export function shareKey(share: ExpenseShare): string {
  return `share:${share.operation_id}`;
}
