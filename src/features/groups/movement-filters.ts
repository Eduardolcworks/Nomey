/**
 * QUÉ MOVIMIENTOS SE ENSEÑAN, Y CÓMO SE DICE ESO EXACTAMENTE.
 *
 * ═══════════ DOS ESTADOS, Y NO UNO ═══════════
 *
 * **Lo aplicado** es lo que la lista está enseñando ahora mismo. **El borrador**
 * es lo que hay tocado dentro del panel y todavía no se ha confirmado. Son dos
 * valores distintos a propósito: mover un extremo de la barra no puede rehacer
 * la consulta en cada fotograma del arrastre, y sobre todo, alguien que abre el
 * panel, toquetea y se arrepiente tiene que poder cerrarlo sin haber cambiado
 * nada. Abrir el panel copia lo aplicado en el borrador; confirmar hace el
 * camino inverso.
 *
 * ═══════════ EL INTERVALO ES DINERO EXACTO ═══════════
 *
 * `minMinor` y `maxMinor` son **unidades menores de la divisa base del grupo**,
 * en `bigint`, y los dos extremos son inclusivos. La barra que los mueve trabaja
 * con índices enteros —arrastrar un dedo es geometría aproximada— y la
 * conversión ocurre aquí, en un solo sitio y acotada: los índices 0 y `steps`
 * dan exactamente `0n` y el máximo, así que «todo» nunca se aproxima.
 */

/** Lo que acota el listado. `null` en categoría o participante = sin acotar. */
export type MovementFilters = {
  /** Mínimo inclusivo, en unidades menores de la divisa del grupo. */
  readonly minMinor: bigint;
  /**
   * Máximo inclusivo, en la misma unidad. `null` es **sin tope**.
   *
   * Y «sin tope» no es «tope en cero»: son dos cosas distintas y hubo que
   * separarlas. Con el máximo del grupo todavía sin leer, un tope de cero
   * decía que el filtro dejaba fuera todos los gastos —el embudo se encendía
   * al entrar, sin que nadie hubiera filtrado nada— y en un grupo cuyo mayor
   * gasto valiera de verdad cero habría dicho lo mismo por otra razón.
   *
   * Arrastrar el extremo derecho hasta el final devuelve aquí `null`, no el
   * máximo: son la misma selección, y la que no depende de haber leído ya el
   * tope es ésta.
   */
  readonly maxMinor: bigint | null;
  readonly categoryId: string | null;
  /**
   * QUIÉN PAGÓ el gasto. `null` = sin acotar.
   *
   * **Y no quién participa en el reparto.** Estuvo siendo lo segundo y se
   * corrigió: un gasto que Marta pagó y que se repartió entre los cuatro
   * salía al filtrar por Sel sólo porque Sel tenía cuota, que no es lo que
   * nadie quiere preguntar. Tampoco es quién lo registró —`created_by`, que
   * ni siquiera se publica—: son tres preguntas distintas sobre el mismo
   * gasto, y ésta es la del pagador.
   */
  readonly payerId: string | null;
};

/**
 * EL RECORRIDO DE LA BARRA: cuántas posiciones tiene.
 *
 * Hasta mil unidades menores, **una posición por unidad**: en un grupo en euros
 * eso es cada céntimo hasta 10,00 €, así que cualquier importe se puede acotar
 * exactamente. Por encima, mil posiciones repartidas — la barra deja de poder
 * señalar cualquier céntimo, que es una limitación de la geometría y no del
 * dato: los dos extremos siguen siendo exactos, y quien quiera un corte
 * concreto tiene la categoría y el participante.
 *
 * Cero cuando no hay recorrido: un grupo sin gastos, o un máximo que no se ha
 * podido leer. La barra se apaga en vez de ofrecer un intervalo inventado.
 */
export const RANGE_STEPS = 1000;

export function stepsFor(maxMinor: bigint | null): number {
  if (maxMinor === null || maxMinor <= 0n) return 0;
  return maxMinor <= BigInt(RANGE_STEPS) ? Number(maxMinor) : RANGE_STEPS;
}

/**
 * De posición de la barra a importe EXACTO.
 *
 * Acotada por los dos lados y sin coma flotante: los extremos se devuelven
 * literalmente —`0n` y el máximo—, y lo de en medio sale de una división entera
 * de `bigint`. Un índice fuera de rango se recorta en vez de extrapolar.
 */
export function minorAt(index: number, maxMinor: bigint, steps: number): bigint {
  if (steps <= 0 || maxMinor <= 0n) return 0n;
  if (index <= 0) return 0n;
  if (index >= steps) return maxMinor;
  return (maxMinor * BigInt(index)) / BigInt(steps);
}

/**
 * Y de importe a posición, sólo para colocar el pulgar al abrir el panel.
 *
 * **Este sentido sí puede redondear**, porque su resultado es geometría: lo que
 * viaja a la consulta es el importe, no el índice. Aun así se ancla en los
 * extremos para que un intervalo completo se dibuje completo.
 */
export function indexOf(minor: bigint, maxMinor: bigint, steps: number): number {
  if (steps <= 0 || maxMinor <= 0n) return 0;
  if (minor <= 0n) return 0;
  if (minor >= maxMinor) return steps;
  return Number((minor * BigInt(steps)) / maxMinor);
}

/**
 * Sin restricción ninguna: el intervalo entero y las dos listas completas.
 *
 * **No necesita saber cuál es el máximo**, y eso es la mitad de la gracia: sin
 * tope se expresa con `null`, así que «enseñarlo todo» se puede afirmar antes
 * de haber leído nada del servidor y no cambia de significado al llegar.
 */
export function allOf(): MovementFilters {
  return { minMinor: 0n, maxMinor: null, categoryId: null, payerId: null };
}

/**
 * ¿ESTA SELECCIÓN EQUIVALE A ENSEÑARLO TODO?
 *
 * Lo que decide si el embudo va en acento o apagado, y por eso se pregunta por
 * el EFECTO y no por si alguien tocó algo: mover un extremo y devolverlo a su
 * sitio no deja ningún gasto fuera, así que el embudo no debe decir que sí.
 *
 * El máximo entra como parámetro porque «hasta el tope» sólo se sabe sabiendo
 * cuál es el tope. Sin máximo leído no hay restricción de importe que afirmar.
 */
export function isUnrestricted(filters: MovementFilters, maxMinor: bigint | null): boolean {
  if (filters.categoryId !== null || filters.payerId !== null) return false;
  if (filters.minMinor > 0n) return false;
  /* Sin tope, nada queda fuera. Con tope, sólo si llega hasta el máximo — y
   * eso exige conocerlo: sin máximo leído no hay restricción que afirmar. */
  if (filters.maxMinor === null) return true;
  return maxMinor !== null && filters.maxMinor >= maxMinor;
}

/** Si dos selecciones son la misma. Para saber si el borrador está tocado. */
export function sameFilters(a: MovementFilters, b: MovementFilters): boolean {
  return (
    a.minMinor === b.minMinor &&
    a.maxMinor === b.maxMinor &&
    a.categoryId === b.categoryId &&
    a.payerId === b.payerId
  );
}
