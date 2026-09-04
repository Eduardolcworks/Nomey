import { useCallback, useRef, useState } from 'react';

import { buildPayload, type EntryDraft, type EntryTarget } from './movement-entry';
import { isCorrection, recordPersonalExpense, recordPersonalIncome } from './personal-service';
import { newClientOperationId } from '@/lib/id';

export type RecordStatus = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * CORREGIR un movimiento, una vez, aunque se pulse dos veces.
 *
 * **Desde F7.D esto ya no da de alta.** El alta sale por la cola
 * (`useEntryQueue`), con su clave persistida antes de la primera petición y su
 * proyección optimista; lo que queda aquí es la corrección, que ADR-028 §4 deja
 * fuera de la cola a propósito —tiene CAS propio y una corrección encolada
 * podría quedar obsoleta antes de drenar—. Por eso `target` es obligatorio, y
 * por eso `personal-service` rechaza en compilación y en ejecución un payload
 * sin él.
 *
 * **La clave de idempotencia se genera antes del primer intento y se conserva**
 * (ADR-010): mientras la intención no cambie, un reintento tras un fallo de red
 * lleva la misma clave y la frontera responde con `already_processed` en lugar
 * de escribir una segunda versión.
 *
 * **Y se olvida en cuanto la intención cambia.** Si la persona corrige el
 * importe después de un fallo, ya no es el mismo comando: reusar la clave daría
 * `IDEMPOTENCY_KEY_REUSED · 409` y la corrección se perdería. Por eso la clave
 * se indexa por la intención misma.
 *
 * **La clave vive en memoria**, y para una corrección basta: sobrevive a un
 * reintento dentro de la misma ventana. Si el sistema mata la app entre el
 * envío y la respuesta, la persona vuelve a abrir la fila y ve lo que el
 * servidor tiene — que es la autoridad.
 */
export function useRecordMovement(
  scope: {
    scopeId: string;
    currencyDefinitionId: string;
    currencyScale: number;
  } | null,
) {
  const [status, setStatus] = useState<RecordStatus>('idle');
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(false);

  const save = useCallback(
    async (draft: EntryDraft, target: EntryTarget): Promise<boolean> => {
      if (scope === null) return false;
      // Síncrono y antes de nada: aquí muere la segunda pulsación. El estado
      // no sirve para esto —es asíncrono— y dos toques en el mismo fotograma
      // leerían los dos el valor viejo.
      if (inFlight.current) return false;
      inFlight.current = true;

      /*
       * La huella de la INTENCIÓN, no del formulario. La operación corregida
       * entra en la huella: corregir dos movimientos hasta dejarlos idénticos
       * son dos comandos distintos, y compartir clave daría
       * `IDEMPOTENCY_KEY_REUSED · 409` en el segundo.
       */
      const intent = [
        target.operationId,
        target.expectedVersionId,
        draft.kind,
        draft.amount.trim(),
        draft.concept.trim(),
        draft.categoryId ?? '',
        draft.date,
        draft.time,
      ].join(' ');

      let key = keys.current.get(intent);
      if (key === undefined) {
        key = newClientOperationId();
        keys.current.set(intent, key);
      }

      const payload = buildPayload(draft, scope, key, target);
      if (payload === null || !isCorrection(payload)) {
        inFlight.current = false;
        return false;
      }

      setStatus('saving');
      try {
        await (draft.kind === 'income'
          ? recordPersonalIncome(payload)
          : recordPersonalExpense(payload));
        setStatus('saved');
        return true;
      } catch {
        // El motivo no se pinta: los códigos de la frontera son de contrato, no
        // de interfaz. Aquí basta con no dar por guardado lo que no lo está.
        setStatus('failed');
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [scope],
  );

  return { status, save };
}
