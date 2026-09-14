import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id/client-operation-id';

import type { GroupOperation } from './group-service';
import { sendGroupAnnul } from './group-service';

/**
 * LO QUE UNA ANULACIÓN NECESITA: la operación y su versión VIGENTE. Un gasto
 * (`api.group_operation`) y un pago registrado (`api.group_payment`, F09/ADR-007)
 * lo traen los dos; la frontera es la misma, `api.annul_operation`.
 */
export type Annullable = Pick<GroupOperation, 'operationId' | 'versionId'>;

/**
 * ANULAR UN GASTO COMPARTIDO —o un pago registrado—, una vez aunque se pulse
 * dos veces.
 *
 * Misma disciplina que `useRecordExpense`, y por el mismo riesgo con el signo
 * cambiado.
 *
 * **La clave de idempotencia se acuña antes del primer intento y se conserva**
 * (F03/ADR-007): un reintento tras un fallo de red lleva la misma clave y la
 * frontera responde `already_processed` en vez de escribir una segunda versión.
 *
 * **Y se indexa por (operación, versión)**, porque la intención es «anular ESTA
 * versión de ESTA operación». Si entre el fallo y el reintento la operación
 * cambiara de versión ya no es el mismo comando: reusar la clave daría
 * `IDEMPOTENCY_KEY_REUSED · 409`, y una clave nueva es lo correcto — aunque el
 * `expected_version_id` viejo fallaría igualmente el CAS, que es lo que debe
 * pasar.
 *
 * **El doble envío se corta con una referencia, no con el estado.** `useState`
 * es asíncrono: dos pulsaciones en el mismo fotograma leerían las dos el valor
 * antiguo y saldrían las dos.
 *
 * **No refresca nada ni decide qué enseñar.** Devuelve si la anulación ocurrió;
 * quien compone la pantalla decide qué invalidar. Es lo que mantiene la
 * escritura separada de la invalidación.
 */
export type AnnulExpense = {
  readonly annul: (operation: Annullable) => Promise<boolean>;
  /** La operación en vuelo, para que su fila bloquee sus acciones. */
  readonly pending: string | null;
  /** El código de la frontera del último fallo, para poder decir POR QUÉ. */
  readonly code: string | null;
  readonly clear: () => void;
};

export function useAnnulExpense(): AnnulExpense {
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const inFlight = useRef(new Set<string>());
  const keys = useRef(new Map<string, string>());

  const clear = useCallback(() => {
    setCode(null);
  }, []);

  const annul = useCallback(async (operation: Annullable): Promise<boolean> => {
    const intent = `${operation.operationId} ${operation.versionId}`;

    // Síncrono y antes de todo lo demás: aquí muere la segunda pulsación.
    if (inFlight.current.has(operation.operationId)) return false;
    inFlight.current.add(operation.operationId);

    let key = keys.current.get(intent);
    if (key === undefined) {
      key = newClientOperationId();
      keys.current.set(intent, key);
    }

    setPending(operation.operationId);
    setCode(null);
    try {
      const response = await sendGroupAnnul({
        client_operation_id: key,
        command_contract_version: 2,
        operation_id: operation.operationId,
        expected_version_id: operation.versionId,
      });

      if (response.ok) {
        /*
         * Escrito. La clave se retira: la operación ya no tiene esa versión
         * vigente, así que cualquier intento futuro es otro comando.
         */
        keys.current.delete(intent);
        return true;
      }
      setCode(response.code);
      return false;
    } catch {
      /*
       * Sin respuesta NO se descarta la clave: puede que el servidor lo haya
       * escrito y sea la respuesta la que se perdió. Reintentar con la misma
       * clave convierte esa duda en un replay en vez de un segundo comando.
       */
      setCode(null);
      return false;
    } finally {
      inFlight.current.delete(operation.operationId);
      setPending(null);
    }
  }, []);

  return { annul, pending, code, clear };
}
