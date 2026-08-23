declare const brandTag: unique symbol;

/**
 * Marca nominal sobre un tipo primitivo.
 *
 * Existe solo en tiempo de compilación: en runtime el valor sigue siendo el
 * primitivo. Sirve para que dos identidades distintas no sean intercambiables
 * por accidente aunque ambas sean `string`.
 */
export type Brand<T, B extends string> = T & { readonly [brandTag]: B };
