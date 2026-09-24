import { useCallback, useRef, useState } from 'react';

import { buildPayload, type EntryDraft, type EntryTarget } from './movement-entry';
import { isCorrection, recordPersonalExpense, recordPersonalIncome } from './personal-service';
import { newClientOperationId } from '@/lib/id';

export type RecordStatus = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * El código de frontera del último fallo, cuando lo hubo.
 *
 * **Se conserva, y desde F11 hace falta.** Antes bastaba con «no se guardó»
 * porque todos los rechazos de esta pantalla se leían igual; ahora no: sin
 * cobertura de cambio para esa moneda y esa fecha
 * (`FX_CURRENCY_NOT_COVERED`) o con un convertido fuera de rango
 * (`FX_CONVERSION_OUT_OF_RANGE`) lo que hay que hacer es distinto, y decir
 * «no se pudo guardar» dejaba a la persona reintentando lo mismo.
 *
 * Sigue sin pintarse el código: lo que viaja es el contrato, y quien lo
 * traduce es la pantalla.
 */
function boundaryCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/**
 * CORREGIR un movimiento, una vez, aunque se pulse dos veces.
 *
 * **Desde F7.D esto ya no da de alta.** El alta sale por la cola
 * (`useEntryQueue`), con su clave persistida antes de la primera petición y su
 * proyección optimista; lo que queda aquí es la corrección, que F07/ADR-001 §4 deja
 * fuera de la cola a propósito —tiene CAS propio y una corrección encolada
 * podría quedar obsoleta antes de drenar—. Por eso `target` es obligatorio, y
 * por eso `personal-service` rechaza en compilación y en ejecución un payload
 * sin él.
 *
 * **La clave de idempotencia se genera antes del primer intento y se conserva**
 * (F03/ADR-007): mientras la intención no cambie, un reintento tras un fallo de red
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
    baseCurrencyDefinitionId?: string;
  } | null,
) {
  const [status, setStatus] = useState<RecordStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
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
        /*
         * **LA MONEDA ENTRA EN LA HUELLA** (F11). Corregir 20 EUR a 20 USD es
         * otro comando aunque la cifra no se mueva: si un primer intento llegó
         * a escribirse y la respuesta se perdió, reutilizar su clave para una
         * moneda distinta devolvería `IDEMPOTENCY_KEY_REUSED · 409` y la
         * corrección se habría perdido. La base asumida no entra porque se
         * deriva de ésta y del ámbito: no hay dos intenciones que compartan
         * moneda y difieran en ella.
         */
        scope.currencyDefinitionId,
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
      setCode(null);
      try {
        await (draft.kind === 'income'
          ? recordPersonalIncome(payload)
          : recordPersonalExpense(payload));
        setStatus('saved');
        return true;
      } catch (error) {
        // El código NO se pinta: es contrato, no interfaz. Se conserva para que
        // la pantalla pueda decir POR QUÉ y no sólo que no se guardó.
        setStatus('failed');
        setCode(boundaryCode(error));
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [scope],
  );

  return { status, code, save };
}
