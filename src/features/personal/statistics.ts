/**
 * Lo que la tarjeta de categorías necesita, derivado de lo que da el servidor.
 *
 * **Los importes exactos llegan del servidor y no se recalculan aquí.**
 * `api.personal_statistics` agrega en SQL, en unidad mínima y sin techo — la
 * alternativa, sumar en el cliente, quedó descartada porque `max_rows = 1000`
 * habría devuelto una cifra incompleta que no falla (ADR-026).
 *
 * Este módulo hace **una sola cosa** con esas cifras: el reparto. Y el reparto
 * es una razón de presentación, no un valor de registro, así que puede vivir en
 * coma flotante — es exactamente la excepción que `AGENTS.md` §1 permite
 * («ratios de consumo… pueden usar coma flotante, pero nunca realimentan un
 * valor de registro»). Ningún importe se deriva del porcentaje.
 */

/** Una categoría tal como la entrega la frontera: importes como texto. */
export type StatisticsCategory = {
  readonly category_id: string;
  readonly expense_total: string;
  readonly operation_count: number;
};

/** La respuesta entera. `null` significa que el actor no tiene Modo Personal. */
export type PersonalStatistics = {
  readonly scope_id: string;
  readonly currency_definition_id: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly income_total: string;
  readonly expense_total: string;
  readonly categories: readonly StatisticsCategory[];
};

export type CategorySlice = {
  readonly categoryId: string;
  /** Exacto, en unidad mínima. */
  readonly expenseMinor: bigint;
  readonly operationCount: number;
  /** Entre 0 y 1. Sólo para pintar; nunca vuelve a un importe. */
  readonly share: number;
};

/**
 * Cuántas categorías se ven sin desplegar.
 *
 * Cuatro es decisión de producto, no una constante técnica, y por eso vive
 * nombrada en vez de escrita en el JSX de la tarjeta.
 */
export const TOP_CATEGORIES = 4;

/**
 * Convierte el reparto del servidor en porciones con su cuota.
 *
 * **El orden llega ya resuelto** —la frontera devuelve de mayor a menor, con
 * desempate por identificador— así que aquí no se reordena: hacerlo sería una
 * segunda opinión sobre el mismo dato, y dos opiniones divergen.
 *
 * **`total = 0` no produce ningún porcentaje.** No es un caso defensivo
 * abstracto: es el estado normal de un intervalo sin gastos, y dividir ahí daría
 * `NaN` que React pinta como texto vacío o como `NaN%` según dónde caiga. Se
 * devuelve la lista vacía y la tarjeta pinta su estado vacío.
 */
export function categorySlices(
  categories: readonly StatisticsCategory[],
  expenseTotal: string,
): CategorySlice[] {
  const total = toMinor(expenseTotal);
  if (total <= 0n) return [];

  const divisor = Number(total);

  return categories.map((category) => {
    const expenseMinor = toMinor(category.expense_total);
    return {
      categoryId: category.category_id,
      expenseMinor,
      operationCount: category.operation_count,
      share: Number(expenseMinor) / divisor,
    };
  });
}

/**
 * Las que se ven y las que quedan detrás del desplegable.
 *
 * Partir aquí y no en el componente es lo que permite comprobarlo sin
 * renderizar nada.
 */
export function splitTop(slices: readonly CategorySlice[]): {
  top: CategorySlice[];
  rest: CategorySlice[];
} {
  return { top: slices.slice(0, TOP_CATEGORIES), rest: slices.slice(TOP_CATEGORIES) };
}

/**
 * Texto exacto de la frontera a unidad mínima.
 *
 * `BigInt` y no `Number`: ADR-008 §1 hace que los importes crucen como texto
 * precisamente para que nadie los pase por un `double`, y deshacerlo aquí
 * anularía la medición de E11. Un texto ilegible vale `0n` en vez de reventar
 * la pantalla — un cero visible es diagnosticable, una pantalla en blanco no.
 */
export function toMinor(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Las porciones del anillo, en grados.
 *
 * Acumula sobre las cuotas ya calculadas para que el último sector cierre el
 * círculo exactamente: sumar 360 × cuota una a una deja una rendija visible
 * cuando los redondeos no cuadran.
 */
export function sliceAngles(slices: readonly CategorySlice[]): { start: number; sweep: number }[] {
  const angles: { start: number; sweep: number }[] = [];
  let cursor = 0;

  slices.forEach((slice, index) => {
    const end = index === slices.length - 1 ? 360 : cursor + slice.share * 360;
    angles.push({ start: cursor, sweep: Math.max(0, end - cursor) });
    cursor = end;
  });

  return angles;
}
