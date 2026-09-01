import { useCallback, useRef, useState } from 'react';

import { buildPayload, type EntryDraft, type EntryTarget } from './movement-entry';
import { recordPersonalExpense, recordPersonalIncome } from './personal-service';
import { newClientOperationId } from '@/lib/id';

export type RecordStatus = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Guardar un movimiento, una vez, aunque se pulse dos veces.
 *
 * **La clave de idempotencia se genera antes del primer intento y se conserva**
 * (ADR-010): mientras la intención no cambie, un reintento tras un fallo de red
 * lleva la misma clave y la frontera responde con `already_processed` en lugar
 * de escribir un segundo movimiento. Es el caso que este proyecto tiene que
 * resolver bien: el dinero duplicado no lanza ningún error, sólo aparece.
 *
 * **Y se olvida en cuanto la intención cambia.** Si la persona corrige el
 * importe después de un fallo, ya no es el mismo comando: reusar la clave daría
 * `IDEMPOTENCY_KEY_REUSED · 409` y la corrección se perdería. Por eso la clave
 * se indexa por la intención misma.
 *
 * **Lo que este pase NO hace, y conviene no confundirlo con lo anterior:** la
 * clave vive en memoria, así que sobrevive a un reintento pero no a que el
 * sistema mate la app entre el envío y la respuesta. Eso exige almacenamiento
 * duradero, y con él una cola de comandos pendientes que es de otro bloque.
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
    async (draft: EntryDraft, target?: EntryTarget): Promise<boolean> => {
      if (scope === null) return false;
      // Síncrono y antes de nada: aquí muere la segunda pulsación. El estado
      // no sirve para esto —es asíncrono— y dos toques en el mismo fotograma
      // leerían los dos el valor viejo.
      if (inFlight.current) return false;
      inFlight.current = true;

      /*
       * La huella de la INTENCIÓN, no del formulario. La clase entra porque un
       * gasto y un ingreso de los mismos 12 € el mismo día son dos comandos
       * distintos, y la frontera los rechazaría por clase si compartieran clave.
       */
      const intent = [
        // La operación corregida entra en la huella: corregir dos movimientos
        // hasta dejarlos idénticos son dos comandos distintos, y compartir
        // clave daría `IDEMPOTENCY_KEY_REUSED · 409` en el segundo.
        target?.operationId ?? 'new',
        target?.expectedVersionId ?? '',
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
      if (payload === null) {
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
        // de interfaz, y traducirlos uno a uno es trabajo del bloque que traiga
        // la edición. Aquí basta con no dar por guardado lo que no lo está.
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
