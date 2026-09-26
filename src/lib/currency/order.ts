/**
 * EL ORDEN DE PRODUCTO DEL CATÁLOGO DE DIVISAS, y nada más.
 *
 * Un módulo aparte y **sin una sola dependencia**: es un dato de producto, no
 * infraestructura. `catalogue.ts` lee de Supabase, así que nada de lo que hay
 * aquí podría comprobarse sin arrastrar el cliente entero — y lo que hay aquí
 * es justo lo que conviene comprobar por su comportamiento.
 */

/**
 * ═══════════ EL ORDEN EN QUE SE OFRECEN LAS DIVISAS ═══════════
 *
 * **F11/ADR-004.** Un orden de producto, congelado, y no el alfabético del
 * código ISO que había antes.
 *
 * El alfabético ponía `ARS` la primera y `EUR` la décima: las tres monedas sin
 * cobertura de la fuente encabezaban la lista y la que usa casi todo el mundo
 * quedaba a media pantalla. Ordenar por un código no es una decisión neutra
 * —parece que no elige, y elige—, así que aquí se elige a propósito: primero la
 * base de Nomey, después las de mayor uso, y el resto por regiones.
 *
 * **No es un orden de importancia monetaria ni de cobertura.** El catálogo se
 * publica entero, con cobertura de cambio o sin ella, y qué puede convertirse
 * un día dado lo decide la frontera (F11/ADR-001 §6). Esto sólo ordena lo que
 * se ofrece.
 *
 * **Una divisa que no esté aquí no desaparece**: cae detrás de todas, y entre
 * ellas por código. Añadir una al catálogo sin tocar esta lista degrada el
 * orden, nunca la lista.
 */
export const CURRENCY_ORDER: readonly string[] = [
  // La base de Nomey y las cuatro de mayor uso.
  'EUR',
  'USD',
  'GBP',
  'JPY',
  'CHF',
  // El resto de divisas mayores.
  'CAD',
  'AUD',
  'NZD',
  // Nordicas.
  'SEK',
  'NOK',
  'DKK',
  // Europa central y del este.
  'PLN',
  // America Latina, por uso.
  'MXN',
  'BRL',
  // Europa central y del este (resto).
  'CZK',
  'HUF',
  'RON',
  // America Latina sin cobertura de la fuente, que se ofrecen igual.
  'ARS',
  'COP',
  'CLP',
];

/** Dónde cae cada código. Fuera de la lista, detrás de todos. */
const CURRENCY_RANK: ReadonlyMap<string, number> = new Map(
  CURRENCY_ORDER.map((code, index) => [code, index]),
);

/**
 * Compara dos divisas por el orden de producto.
 *
 * Entre dos conocidas no hay empate posible —cada una tiene su índice— y entre
 * dos desconocidas desempata el código, para que el orden siga siendo total y
 * estable de un render a otro.
 */
export function compareCurrencies(
  a: { readonly code: string },
  b: { readonly code: string },
): number {
  const left = CURRENCY_RANK.get(a.code) ?? CURRENCY_ORDER.length;
  const right = CURRENCY_RANK.get(b.code) ?? CURRENCY_ORDER.length;
  return left !== right ? left - right : a.code.localeCompare(b.code);
}
