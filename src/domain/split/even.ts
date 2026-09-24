import { allocateByLargestRemainder } from './largest-remainder';

/**
 * REPARTO A PARTES IGUALES, en unidades menores exactas.
 *
 * **No es un algoritmo nuevo.** Es `allocateByLargestRemainder` —el de
 * F01/ADR-001 §5, el que reparte las cuotas de un gasto y el que los 22
 * vectores compartidos ya comprueban contra el servidor— con todos los pesos
 * a uno. Escribir una división aparte habría sido tener dos reglas de restos
 * en el mismo producto, y la segunda sin vectores.
 *
 * Lo que eso significa en la práctica:
 *
 *   · **la suma es EXACTAMENTE el total**, siempre, por construcción;
 *   · **ninguna cuota es negativa**, porque la magnitud no lo es;
 *   · con pesos iguales todos los restos empatan, así que el céntimo que
 *     sobra lo decide el desempate: **el primero de la lista**, y de ahí
 *     hacia adelante.
 *
 * Y por eso `10,00 / 3` da `3,34 · 3,33 · 3,33` y no `3,33 · 3,33 · 3,34`.
 *
 * **El orden que entra es el que manda**, así que quien llama tiene que
 * pasarlo estable —el de la lista que la persona ve, no el orden en que fue
 * tocando—. Si dependiera del orden de selección, repartir 10,01 entre dos
 * daría un céntimo distinto según a quién se hubiera marcado primero, y eso
 * no es una decisión que nadie haya tomado.
 *
 * @param total    magnitud a repartir, no negativa, en unidades menores
 * @param count    entre cuántos, al menos uno
 */
export function splitEvenly(total: bigint, count: number): bigint[] {
  return allocateByLargestRemainder(
    total,
    Array.from({ length: count }, () => 1n),
    Array.from({ length: count }, (_, index) => index),
  );
}

/**
 * ¿Hay menos unidades menores que destinatarios?
 *
 * Repartir 2 céntimos entre tres deja a alguien con cero, y **una
 * transferencia de cero no es una transferencia**: el servidor la rehúsa
 * (`amount > 0`) y proponerla sería crear una fila que no significa nada.
 *
 * Quien llama lo usa para impedir el envío y decirlo, en vez de mandar dos
 * propuestas y callarse la tercera.
 */
export function tooSmallToSplit(total: bigint, count: number): boolean {
  return count > 0 && total < BigInt(count);
}
