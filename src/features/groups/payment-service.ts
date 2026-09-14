/**
 * PAGOS REGISTRADOS EN EL GRUPO (F09/ADR-007): la lectura y el comando.
 *
 * Un pago es una transferencia hecha FUERA de la app que uno de sus dos
 * participantes declara; el servidor la descompone sobre las obligaciones
 * vigentes (par directo, caminos, novación) y mueve la caja de los dos
 * Personales. **No se edita**: se anula y se registra otro.
 */
import { supabase } from '@/lib/supabase';

import type { CommandResult } from './membership-service';
import type { ReopenedPair } from './suggested-payments';

/** Una fila de `api.group_payment`: la versión de alta, y si está anulada. */
export type GroupPayment = {
  readonly operationId: string;
  /** La versión VIGENTE: el `expected_version_id` de una anulación. */
  readonly versionId: string;
  readonly scopeId: string;
  readonly payerParticipantId: string;
  readonly receiverParticipantId: string;
  /** Unidades menores de la divisa base del grupo, sin signo. */
  readonly amountMinor: string;
  readonly effectiveDate: string;
  readonly recordedByMe: boolean;
  readonly declaredByReceiver: boolean;
  /**
   * Anulado: su versión vigente no tiene efectos. Se lista igual, marcado,
   * porque lo que cerró sigue contándose (`payment_allocation`) y porque
   * distinguir un pago vigente de uno anulado es parte del contrato.
   */
  readonly annulled: boolean;
  readonly createdAt: string;
};

/**
 * Los pagos de un grupo, vigentes y anulados, del más reciente al más
 * antiguo. A diferencia de un gasto anulado, el pago anulado sigue en la
 * lista del grupo con su marca: lo que declaró cerrar es un hecho suyo y la
 * deuda que reabrió se explica desde él.
 */
export async function fetchGroupPayments(scopeId: string): Promise<readonly GroupPayment[]> {
  const { data, error } = await supabase
    .from('group_payment')
    .select(
      'operation_id,version_id,scope_id,payer_participant_id,receiver_participant_id,amount,effective_date,recorded_by_me,declared_by_receiver,annulled,operation_created_at',
    )
    .eq('scope_id', scopeId)
    .order('effective_date', { ascending: false })
    .order('operation_created_at', { ascending: false });
  if (error !== null) throw error;

  return (data ?? []).flatMap((row) =>
    row.operation_id === null ||
    row.version_id === null ||
    row.scope_id === null ||
    row.payer_participant_id === null ||
    row.receiver_participant_id === null ||
    row.amount === null ||
    row.effective_date === null ||
    row.operation_created_at === null
      ? []
      : [
          {
            operationId: row.operation_id,
            versionId: row.version_id,
            scopeId: row.scope_id,
            payerParticipantId: row.payer_participant_id,
            receiverParticipantId: row.receiver_participant_id,
            amountMinor: row.amount,
            effectiveDate: row.effective_date,
            recordedByMe: row.recorded_by_me ?? false,
            declaredByReceiver: row.declared_by_receiver ?? false,
            annulled: row.annulled ?? false,
            createdAt: row.operation_created_at,
          },
        ],
  );
}

/**
 * LOS PARES REABIERTOS de un grupo que la parte activa puede saldar
 * (`api.group_reopened_pair`, 20260913120000): con quien salió, sólo lo que
 * un pago anulado entre ambos volvió a dejar pendiente. Sólo para miembros;
 * el servidor lo vuelve a decidir al registrar.
 */
export async function fetchReopenedPairs(scopeId: string): Promise<readonly ReopenedPair[]> {
  const { data, error } = await supabase.rpc('group_reopened_pair', { p_scope: scopeId });
  if (error !== null) throw error;
  return (data ?? []).flatMap((row) =>
    row.debtor_participant_id === null ||
    row.creditor_participant_id === null ||
    row.amount === null
      ? []
      : [
          {
            debtorParticipantId: row.debtor_participant_id,
            creditorParticipantId: row.creditor_participant_id,
            amountMinor: row.amount,
          },
        ],
  );
}

/**
 * LA DEUDA REABIERTA ACOTADA (F09/ADR-007 C6), por divisa: lo que mis pagos
 * anulados en grupos de los que ya no soy miembro volvieron a dejar
 * pendiente, y sólo eso. Con signo, como una posición: negativo debo. Es lo
 * que Deudas de Inicio suma a las posiciones por membresía —quien salió no
 * tiene fila en `api.group_summary`— y no nombra el grupo.
 */
export type ReopenedDebt = {
  readonly currencyDefinitionId: string;
  readonly amountMinor: string;
};

export async function fetchReopenedDebt(): Promise<readonly ReopenedDebt[]> {
  const { data, error } = await supabase.rpc('my_reopened_debt');
  if (error !== null) throw error;
  return (data ?? []).flatMap((row) =>
    row.currency_definition_id === null || row.amount === null
      ? []
      : [{ currencyDefinitionId: row.currency_definition_id, amountMinor: row.amount }],
  );
}

/**
 * LA FOTO DE NETOS que viaja con el pago. Es lo que la pantalla enseñaba
 * cuando se confirmó, literal: si bajo el cerrojo los netos son otros, el
 * servidor responde `SETTLEMENT_STALE` y se vuelve a leer (F09/ADR-007 C3).
 */
export type ExpectedPosition = {
  readonly participant_id: string;
  readonly net: string;
};

export type GroupPaymentPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 1;
  readonly scope_id: string;
  readonly currency_definition_id: string;
  readonly amount: string;
  readonly effective_date: string;
  /** `HH:MM` local del momento de declararlo: ordena con la fecha entre los movimientos del día. */
  readonly effective_time: string;
  readonly payer_participant_id: string;
  readonly receiver_participant_id: string;
  readonly expected_positions: readonly ExpectedPosition[];
};

export async function sendGroupPayment(payload: GroupPaymentPayload): Promise<CommandResult> {
  const response = (await supabase.rpc('record_group_payment', {
    payload: payload as never,
  })) as unknown as {
    data: unknown;
    error: { code?: string | null; details?: string | null } | null;
    status?: number;
  };
  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return {
      status,
      code: response.error.code ?? null,
      details: response.error.details ?? null,
      ok: false,
    };
  }
  return { status, code: null, details: null, ok: true };
}
