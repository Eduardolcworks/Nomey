import { useCallback, useRef, useState } from 'react';

import { clockTimeOf } from '@/lib/format';
import { newClientOperationId } from '@/lib/id/client-operation-id';

import type { GroupBalanceRow } from './group-service';
import { type ExpectedPosition, sendGroupPayment } from './payment-service';

/**
 * REGISTRAR UN PAGO SUGERIDO COMO HECHO (F09/ADR-007 C1–C3), una vez aunque se
 * pulse dos veces.
 *
 * Misma disciplina que `useAnnulExpense`: **la clave se acuña antes del primer
 * intento y se conserva por intención** —quién paga a quién, cuánto y sobre
 * qué foto de netos—; un reintento tras un fallo de red lleva la misma clave y
 * la frontera responde `already_processed` en vez de escribir un segundo pago.
 * Cambiar la foto (los saldos se releyeron) es otra intención y otra clave.
 *
 * **La foto viaja literal.** `expected_positions` son los netos que la
 * pantalla enseñaba al confirmar; si bajo el cerrojo son otros, el servidor
 * responde `SETTLEMENT_STALE` y quien compone la pantalla relee y vuelve a
 * proponer. Nada se calcula aquí: ni la descomposición ni la caja.
 */
export type PaymentFailure =
  /** Los netos cambiaron entre enseñar y confirmar: releer y volver a proponer. */
  | 'stale'
  /** El pago no se sostiene sobre las obligaciones vigentes (tras releer). */
  | 'notApplicable'
  /** Sin red o sin respuesta: la clave se conserva para reintentar. */
  | 'offline'
  | 'rejected';

/**
 * Lo que `record` resuelve: escrito, o el fallo de ESTE intento. Quien
 * confirma decide el mensaje con esto y no con `failure`, que es estado de la
 * pantalla y en la clausura del `Alert` vale lo de ANTES de pulsar: con él,
 * el primer intento salía siempre como fallo genérico y los siguientes con el
 * motivo del anterior. `failure` sigue publicado para quien lo lea al
 * renderizar.
 */
export type PaymentOutcome = 'recorded' | PaymentFailure;

export type RecordPayment = {
  readonly record: (args: {
    readonly scopeId: string;
    readonly currencyDefinitionId: string;
    readonly payerParticipantId: string;
    readonly receiverParticipantId: string;
    readonly amountMinor: bigint;
    readonly balances: readonly GroupBalanceRow[];
  }) => Promise<PaymentOutcome>;
  readonly recording: boolean;
  readonly failure: PaymentFailure | null;
  readonly code: string | null;
};

export function useRecordPayment(): RecordPayment {
  const [recording, setRecording] = useState(false);
  const [failure, setFailure] = useState<PaymentFailure | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const inFlight = useRef(false);
  /*
   * Por intención: la clave y la HORA con la que salió el primer intento. Un
   * reintento repite las dos: la hora entra en la intención canónica del
   * servidor, y mandar otra con la misma clave sería IDEMPOTENCY_KEY_REUSED.
   */
  const keys = useRef(new Map<string, { readonly key: string; readonly time: string }>());

  const record = useCallback<RecordPayment['record']>(async (args) => {
    // Síncrono y antes de todo lo demás: aquí muere la segunda pulsación.
    if (inFlight.current) return 'rejected';
    inFlight.current = true;

    const positions: ExpectedPosition[] = args.balances.map((one) => ({
      participant_id: one.participantId,
      net: one.netMinor,
    }));
    const intent = JSON.stringify([
      args.scopeId,
      args.payerParticipantId,
      args.receiverParticipantId,
      args.amountMinor.toString(),
      positions,
    ]);
    let attempt = keys.current.get(intent);
    if (attempt === undefined) {
      attempt = { key: newClientOperationId(), time: clockTimeOf(new Date()) };
      keys.current.set(intent, attempt);
    }

    setRecording(true);
    setFailure(null);
    setCode(null);
    try {
      const response = await sendGroupPayment({
        client_operation_id: attempt.key,
        command_contract_version: 1,
        scope_id: args.scopeId,
        currency_definition_id: args.currencyDefinitionId,
        amount: args.amountMinor.toString(),
        effective_date: today(),
        /*
         * La hora del hecho, del reloj local (F06/ADR-002 §3): sin ella la fila
         * iría al final del día —«sin hora» ordena después— aunque el pago
         * fuera lo último que pasó.
         */
        effective_time: attempt.time,
        payer_participant_id: args.payerParticipantId,
        receiver_participant_id: args.receiverParticipantId,
        expected_positions: positions,
      });
      if (response.ok) {
        keys.current.delete(intent);
        return 'recorded';
      }
      setCode(response.code);
      const outcome: PaymentFailure =
        response.status === 0
          ? 'offline'
          : response.code === 'SETTLEMENT_STALE'
            ? 'stale'
            : response.code === 'PAYMENT_NOT_APPLICABLE'
              ? 'notApplicable'
              : 'rejected';
      setFailure(outcome);
      /* Un rechazo del servidor cierra la intención: reintentar con la misma
       * clave sería insistir en un comando que ya se rehusó. */
      if (response.status !== 0) keys.current.delete(intent);
      return outcome;
    } catch {
      /* Sin respuesta NO se descarta la clave: puede que el servidor lo haya
       * escrito y sea la respuesta la que se perdió. */
      setFailure('offline');
      return 'offline';
    } finally {
      inFlight.current = false;
      setRecording(false);
    }
  }, []);

  return { record, recording, failure, code };
}

/** La fecha del hecho: hoy, local, `YYYY-MM-DD`. Un pago declarado se fecha al declararlo. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
