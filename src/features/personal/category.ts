import type { MessageKey } from '@/lib/i18n';

/**
 * Cómo se lee una categoría, sea de sistema o propia.
 *
 * **El nombre no se denormaliza en ninguna consulta**, y es una decisión de
 * F6.D que aquí se respeta: la lista publica sólo `category_id` y el nombre se
 * resuelve contra `api.category`. Es lo que hace que renombrar alcance al
 * histórico sin que nadie propague nada, y lo que permite que una categoría
 * dada de baja siga resolviendo su nombre y su icono (ADR-021).
 */
export type CategoryRow = {
  readonly id: string;
  /** Clave i18n si es de sistema. Excluyente con `label`. */
  readonly message_key: string | null;
  /** Texto literal si es propia. Lo escribió su dueño y no se traduce. */
  readonly label: string | null;
  readonly icon: string;
};

/**
 * El puente entre las claves que siembra la migración y el catálogo de i18n.
 *
 * Existe por dos razones, y ninguna es ceremonia:
 *
 * - `message_key` llega de la base como `string`, y `t()` exige una clave
 *   conocida. Sin esta comprobación, una clave nueva en el servidor y ausente
 *   en el catálogo se pintaría como su propio identificador en pantalla.
 * - `tests/lib/i18n-usage.test.ts` exige que **toda** clave del catálogo tenga
 *   un consumidor en el fuente. Resolviéndolas dinámicamente no lo tendrían, y
 *   quince cadenas traducidas quedarían sin revisar por nadie.
 *
 * No es una segunda fuente de verdad: la identidad de la categoría es su UUID
 * en la base. Esto sólo dice qué claves sabe traducir esta versión de la app.
 *
 * **Las cinco retiradas siguen aquí a propósito.** Las tres de ingreso y las de
 * Suministros y Educación ya no se pueden elegir —ADR-027 las dio de baja
 * lógicamente, que no es lo mismo que borrarlas—, pero el gasto que las usó
 * sigue existiendo y hay que saber nombrarlo. Quitarlas de esta lista pintaría
 * ese histórico sin nombre.
 */
const SYSTEM_CATEGORY_KEYS = {
  'category.expense.groceries': 'category.expense.groceries',
  'category.expense.dining': 'category.expense.dining',
  'category.expense.transport': 'category.expense.transport',
  'category.expense.housing': 'category.expense.housing',
  'category.expense.utilities': 'category.expense.utilities',
  'category.expense.health': 'category.expense.health',
  'category.expense.leisure': 'category.expense.leisure',
  'category.expense.shopping': 'category.expense.shopping',
  'category.expense.education': 'category.expense.education',
  'category.expense.subscriptions': 'category.expense.subscriptions',
  'category.expense.travel': 'category.expense.travel',
  'category.expense.other': 'category.expense.other',
  'category.income.salary': 'category.income.salary',
  'category.income.extra': 'category.income.extra',
  'category.income.other': 'category.income.other',
} as const satisfies Record<string, MessageKey>;

export function systemCategoryKey(messageKey: string): MessageKey | null {
  return messageKey in SYSTEM_CATEGORY_KEYS
    ? SYSTEM_CATEGORY_KEYS[messageKey as keyof typeof SYSTEM_CATEGORY_KEYS]
    : null;
}

/** Cuántas claves de categoría conoce esta versión. Para poder afirmarlo. */
export const SYSTEM_CATEGORY_COUNT = Object.keys(SYSTEM_CATEGORY_KEYS).length;

/**
 * El nombre visible de una categoría.
 *
 * `translate` se inyecta para que esto sea puro y comprobable sin montar nada.
 * Una categoría que no está en el catálogo del actor —o una clave que esta
 * versión no conoce— devuelve `null`, y la superficie que la pinte decide qué
 * hacer: **nunca se muestra un identificador ni una clave cruda**.
 */
export function categoryName(
  category: CategoryRow | undefined,
  translate: (key: MessageKey) => string,
): string | null {
  if (category === undefined) return null;

  if (category.label !== null && category.label.length > 0) return category.label;

  if (category.message_key !== null) {
    const key = systemCategoryKey(category.message_key);
    return key === null ? null : translate(key);
  }

  return null;
}

/** El símbolo del sistema con el que se pinta. `null` si no se conoce. */
export function categoryIcon(category: CategoryRow | undefined): string | null {
  return category === undefined || category.icon.length === 0 ? null : category.icon;
}

export function indexCategories(rows: readonly CategoryRow[]): Map<string, CategoryRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Una categoría lista para ser una opción de menú, ya resuelta y ya ordenada. */
export type CategoryOption = {
  readonly id: string;
  readonly title: string;
  /** La clave semántica de ADR-027, sin resolver: quien pinte elige plataforma. */
  readonly icon: string;
  readonly selected: boolean;
};

/**
 * El catálogo convertido en opciones, y nada más que eso.
 *
 * **Lista PLANA y de una sola fuente.** Sale enteramente de las filas que le
 * dan; no hay segunda lista, ni orden propio, ni secciones. Si el catálogo
 * cambia, el menú cambia sin que nadie toque esto — que es justo lo que se
 * pierde en cuanto alguien escribe las categorías a mano en la pantalla.
 *
 * **Las dadas de baja no llegan aquí**, y tampoco se filtran aquí: quien lo
 * hace es `useEntryCategories`, y hacerlo dos veces repartiría la regla en dos
 * sitios. Esta función no añade ni quita filas — así la excepción que conserva
 * la categoría retirada de un gasto que ya la usaba sigue dependiendo de quién
 * arma el catálogo, y no de quién lo pinta.
 *
 * **Una fila sin nombre resoluble NO se ofrece.** ADR-021 es explícito en que
 * nunca se enseña un identificador ni una clave cruda, y en un menú del sistema
 * no hay dónde poner un aviso: la opción sencillamente no está.
 */
export function categoryOptions(
  categories: readonly CategoryRow[],
  selected: string | null,
  translate: (key: MessageKey) => string,
): readonly CategoryOption[] {
  const options: CategoryOption[] = [];

  for (const row of categories) {
    const title = categoryName(row, translate);
    if (title === null) continue;

    options.push({
      id: row.id,
      title,
      icon: categoryIcon(row) ?? 'tag',
      selected: row.id === selected,
    });
  }

  return options;
}
