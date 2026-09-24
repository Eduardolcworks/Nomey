import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import { sendRecordGroupTransfer } from './group-transfer-service';
import { publishGroupRecorded } from './group-events';
import type { CommandResult } from './membership-service';

/**
 * REGISTRAR UNA TRANSFERENCIA DE GRUPO — una vez aunque se pulse dos veces.
 *
 * **UNA intención, UNA llamada, UNA clave.** Con el contrato de propuestas
 * había una clave por receptor porque cada propuesta era una intención
 * distinta que podía fallar por separado; ahora la operación es atómica, así
 * que la clave es una sola y se conserva entre reintentos: un fallo de red
 * seguido de un reintento lleva la misma clave y el servidor responde
 * `already_processed` en vez de escribir una segunda vez (F03/ADR-007).
 *
 * **El doble envío se corta con una referencia, no con el estado.** `useState`
 * es asíncrono: dos pulsaciones en el mismo fotograma leerían las dos el valor
 * antiguo y saldrían las dos.
 *
 * **No refresca nada.** Devuelve lo que el servidor dijo; quien compone la
 * pantalla decide qué invalidar — salvo lo económico, que sí se anuncia aquí
 * porque una transferencia registrada SÍ mueve saldos, deuda y pagos
 * sugeridos, al revés que una propuesta.
 */
export type RecordGroupTransfer = {
  readonly record: (
    scopeId: string,
    totalMinor: string,
    receiverParticipantIds: readonly string[],
    concept: string | null,
    when: { readonly date: string; readonly time: string },
  ) => Promise<CommandResult>;
  readonly sending: boolean;
  /** El código de la frontera del último fallo, para poder decir POR QUÉ. */
  readonly code: string | null;
  readonly clear: () => void;
};

export function useRecordGroupTransfer(): RecordGroupTransfer {
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const inFlight = useRef(false);
  const key = useRef<string | null>(null);

  const clear = useCallback(() => {
    setCode(null);
  }, []);

  const record = useCallback(
    async (
      scopeId: string,
      totalMinor: string,
      receiverParticipantIds: readonly string[],
      concept: string | null,
      when: { readonly date: string; readonly time: string },
    ): Promise<CommandResult> => {
      if (inFlight.current) return { status: 0, code: null, details: null, ok: false };
      inFlight.current = true;
      setSending(true);
      setCode(null);
      key.current ??= newClientOperationId();
      try {
        const result = await sendRecordGroupTransfer({
          client_operation_id: key.current,
          command_contract_version: 1,
          group_scope_id: scopeId,
          total_amount: totalMinor,
          effective_date: when.date,
          effective_time: when.time,
          receiver_participant_ids: receiverParticipantIds,
          ...(concept === null ? {} : { concept }),
        });
        if (result.ok) {
          /*
           * Esto SÍ movió dinero: saldos, deuda, histórico y pagos sugeridos.
           * La clave se suelta, porque volver a enviar ya es otra intención.
           */
          key.current = null;
          publishGroupRecorded(scopeId);
        } else {
          setCode(result.code);
        }
        return result;
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    },
    [],
  );

  return { record, sending, code, clear };
}
