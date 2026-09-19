/**
 * Límites de un entero con signo de 64 bits.
 *
 * Son los de `bigint` en PostgreSQL, donde viven los importes y los
 * coeficientes de los tipos congelados (F02/ADR-001, F03/ADR-012). `bigint` de
 * JavaScript no tiene límite, así que el dominio los comprueba de forma
 * explícita allí donde un resultado tiene que caber en la base de datos.
 */
export const INT64_MIN = -9223372036854775808n;
export const INT64_MAX = 9223372036854775807n;

export function isInt64(value: bigint): boolean {
  return value >= INT64_MIN && value <= INT64_MAX;
}
