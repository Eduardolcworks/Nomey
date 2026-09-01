import { useCallback, useRef, useState } from 'react';

import type { PersonalOperation } from './movement';
import { annulOperation } from './personal-service';
import { newClientOperationId } from '@/lib/id';

/**
 * Anular un movimiento, una vez, aunque se pulse dos veces.
 *
 * Misma disciplina que `useRecordMovement`, porque el riesgo es el mismo con el
 * signo cambiado: **la clave de idempotencia se genera antes del primer intento
 * y se conserva** (ADR-010), así que un reintento tras un fallo de red lleva la
 * misma clave y la frontera responde `already_processed` en vez de escribir una
 * segunda versión.
 *
 * **La intención es «anular ESTA versión de ESTA operación»**, y por eso la
 * clave se indexa por el par. Si entre el fallo y el reintento la operación
 * cambiara de versión, ya no es el mismo comando: reusar la clave daría
 * `IDEMPOTENCY_KEY_REUSED · 409`, y una clave nueva es lo correcto — aunque el
 * `expected_version_id` viejo fallaría igualmente el CAS, que es lo que debe
 * pasar.
 *
 * **El doble envío se corta con una referencia, no con el estado.** `useState`
 * es asíncrono: dos pulsaciones en el mismo fotograma leerían las dos el valor
 * antiguo y saldrían las dos. El conjunto de vuelo se comprueba y se marca de
 * forma síncrona, antes de cualquier `await`. Y por debajo quedan las otras dos
 * redes: la clave de idempotencia y la terminalidad de la anulación
 * (`OPERATION_ANNULLED · 409`) — pero ninguna de las dos debería llegar a
 * hacer falta.
 *
 * **Lo que este hook NO hace, a propósito:** no refresca nada ni decide qué
 * enseñar. Devuelve si la anulación ocurrió, y quien compone la pantalla decide
 * qué hacer con eso. Es lo que mantiene la escritura separada de la
 * invalidación.
 */
export function useAnnulMovement() {
  /** El movimiento en vuelo, para que su fila pueda bloquear su acción. */
  const [pending, setPending] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const keys = useRef(new Map<string, string>());

  const annul = useCallback(async (operation: PersonalOperation): Promise<boolean> => {
    const intent = `${operation.operation_id} ${operation.current_version_id}`;

    // Síncrono y antes de todo lo demás: aquí es donde muere la segunda pulsación.
    if (inFlight.current.has(operation.operation_id)) return false;
    inFlight.current.add(operation.operation_id);

    let key = keys.current.get(intent);
    if (key === undefined) {
      key = newClientOperationId();
      keys.current.set(intent, key);
    }

    setPending(operation.operation_id);
    try {
      await annulOperation({
        client_operation_id: key,
        command_contract_version: 2,
        operation_id: operation.operation_id,
        expected_version_id: operation.current_version_id,
      });
      return true;
    } catch {
      /*
       * El motivo no se pinta. Los códigos de la frontera —`PAYLOAD_INVALID`,
       * `VERSION_CONFLICT`, `OPERATION_ANNULLED`— son contrato, no interfaz, y
       * enseñárselos a alguien que quería borrar una cena no le dice nada.
       * Quien compone la pantalla da el mensaje; aquí basta con no dar por
       * eliminado lo que sigue estando.
       */
      return false;
    } finally {
      inFlight.current.delete(operation.operation_id);
      setPending((current) => (current === operation.operation_id ? null : current));
    }
  }, []);

  return { pending, annul };
}
