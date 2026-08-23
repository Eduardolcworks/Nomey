import { fail } from '../errors';

/**
 * Reparto por mayor resto, en enteros exactos.
 *
 * ADR-002 §5 fija el algoritmo:
 *
 *   1. cuotas matemáticas
 *   2. truncar a unidades mínimas completas
 *   3. repartir las restantes por mayor fracción descartada
 *   4. empate → prioridad al pagador
 *   5. si persiste → orden estable guardado con la operación
 *
 * ADR-003 T11 añade que **opera sobre una magnitud no negativa**: el signo
 * financiero pertenece al efecto que usa el reparto, no a la asignación. Por
 * eso aquí no hay ningún operando negativo y no se depende del comportamiento
 * del módulo con negativos, que E6 midió que trunca hacia cero.
 *
 * La «fracción descartada» no se calcula dividiendo: **es el resto entero**
 * `(total × peso) mod Σpesos`, así que compararlas ordena por mayor fracción
 * sin salir de los enteros (E5).
 *
 * @param total     magnitud a repartir, no negativa
 * @param weights   pesos estrictamente positivos, alineados con los participantes
 * @param priority  desempate: valor menor gana. El pagador va con la prioridad
 *                  más baja y el resto sigue el orden estable de la operación
 */
export function allocateByLargestRemainder(
  total: bigint,
  weights: readonly bigint[],
  priority: readonly number[],
): bigint[] {
  if (total < 0n) {
    fail(
      'ALLOCATION_NEGATIVE_TOTAL',
      `El reparto opera sobre magnitud no negativa, recibido: ${total.toString()}`,
    );
  }

  if (weights.length === 0) {
    fail('ALLOCATION_NO_WEIGHTS', 'No hay pesos que repartir');
  }

  if (priority.length !== weights.length) {
    fail(
      'ALLOCATION_PRIORITY_LENGTH_MISMATCH',
      `Los pesos y las prioridades deben tener la misma longitud: ${weights.length} y ${priority.length}`,
    );
  }

  let sumOfWeights = 0n;
  for (const weight of weights) {
    if (weight <= 0n) {
      fail(
        'ALLOCATION_WEIGHT_NOT_POSITIVE',
        `Los pesos deben ser estrictamente positivos, recibido: ${weight.toString()}`,
      );
    }
    sumOfWeights += weight;
  }

  // Pasos 1 y 2: cuota truncada, y el resto entero como fracción descartada.
  const allocation: bigint[] = [];
  const remainders: bigint[] = [];
  let assigned = 0n;

  for (const weight of weights) {
    const scaled = total * weight;
    const base = scaled / sumOfWeights;
    allocation.push(base);
    remainders.push(scaled - base * sumOfWeights);
    assigned += base;
  }

  // Paso 3: las unidades que faltan van por mayor fracción descartada.
  // Pasos 4 y 5: al empatar, gana la prioridad más baja.
  let remaining = total - assigned;
  if (remaining === 0n) return allocation;

  const order = allocation
    .map((_, index) => index)
    .sort((a, b) => {
      if (remainders[a] !== remainders[b]) {
        return remainders[a] > remainders[b] ? -1 : 1;
      }
      return priority[a] - priority[b];
    });

  for (const index of order) {
    if (remaining === 0n) break;
    allocation[index] += 1n;
    remaining -= 1n;
  }

  return allocation;
}
