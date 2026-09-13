import { useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id/client-operation-id';

import { sendGroupExpense } from './group-service';
import type { GroupExpensePayload } from './shared-expense';

/**
 * REGISTRAR UN GASTO COMPARTIDO CONTRA LA FRONTERA REAL.
 *
 * **La clave del comando se acuña UNA vez y sobrevive a los reintentos.** Es lo
 * que hace idempotente el alta (F03/ADR-007): abortar en el cliente no demuestra que
 * PostgreSQL no lo haya ejecutado, así que un reintento tiene que llevar la
 * MISMA clave — el servidor la reclama antes del CAS y responde `replay` sin
 * crear una segunda operación. Se guarda en una `ref` y sólo se renueva cuando
 * un intento termina bien.
 *
 * **Dos envíos a la vez no pueden pasar.** El cerrojo es la misma `ref`, no un
 * estado: un `useState` se lee del render anterior y dos toques rápidos entrarían
 * los dos antes de que React repinte. Aunque entraran, la clave compartida haría
 * que el segundo fuese un replay — pero el botón no debe dejar intentarlo.
 *
 * **Ante error no se cierra nada y no se pierde nada.** El borrador se queda
 * donde está y el motivo se enseña; la ventana sólo se cierra con la garantía de
 * que el servidor lo escribió, que es lo que devuelve `ok`.
 */
export type RecordExpenseFailure =
  /** La frontera rechazó la intención. Su código viaja aparte para poder decirlo. */
  | 'rejected'
  /** No hubo respuesta: sin red, o el viaje se cortó. La intención sigue viva. */
  | 'unreachable';

export type RecordExpense = {
  readonly record: (
    build: (clientOperationId: string) => GroupExpensePayload | null,
  ) => Promise<boolean>;
  readonly saving: boolean;
  readonly failure: RecordExpenseFailure | null;
  /** El código de la frontera, para poder decir POR QUÉ y no sólo que falló. */
  readonly code: string | null;
};

export function useRecordExpense(): RecordExpense {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<RecordExpenseFailure | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);

  const record = async (
    build: (clientOperationId: string) => GroupExpensePayload | null,
  ): Promise<boolean> => {
    if (inFlight.current) return false;

    // La clave del intento ANTERIOR si lo hubo: un reintento es el mismo comando.
    const key = (commandId.current ??= newClientOperationId());
    const payload = build(key);
    if (payload === null) return false;

    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    setCode(null);

    try {
      const response = await sendGroupExpense(payload);
      if (response.ok) {
        // Escrito. La siguiente alta es otro comando y merece otra clave.
        commandId.current = null;
        return true;
      }
      setFailure(response.status === 0 ? 'unreachable' : 'rejected');
      setCode(response.code);
      return false;
    } catch {
      /*
       * Sin respuesta NO se descarta la clave: puede que el servidor lo haya
       * escrito y sea la respuesta la que se perdió. Reintentar con la misma
       * clave es lo que convierte esa duda en un `replay` en vez de un duplicado.
       */
      setFailure('unreachable');
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return { record, saving, failure, code };
}
