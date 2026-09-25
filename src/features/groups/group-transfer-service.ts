/**
 * TRANSFERENCIAS DE GRUPO (F12/ADR-007, F12.C3): dos lecturas y UN comando.
 *
 * **No pasa por la cola de F7**, y es la misma razón que en las transferencias
 * Personal (F12/ADR-002 §17): el comando necesita estado del servidor —el
 * cerrojo del grupo, la elegibilidad de cada receptor, el reparto
 * autoritativo— y no puede guardarse honestamente «para luego». Lo que
 * devuelve la llamada es lo que el servidor dijo, y **nada se pinta como hecho
 * que él no haya confirmado**.
 *
 * **Un solo comando, porque hay una sola voluntad.** Ya no hay proponer,
 * aceptar, rechazar ni cancelar: eso era B3, que sigue en el servidor y sin
 * superficie cliente, igual que las solicitudes de pago de B2.
 *
 * **El reparto NO viaja.** Se manda el TOTAL y la lista de receptores, y el
 * servidor reparte con la regla canónica. Lo que el cliente calcula es sólo la
 * vista previa.
 */
import { supabase } from '@/lib/supabase';

import type {
  GroupTransferOperation,
  GroupTransferShare,
  TransferCandidate,
  TransferState,
} from './group-transfer';
import { TRANSFER_STATES } from './group-transfer';
import type { CommandResult } from './membership-service';

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function row(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

// ─── lecturas ────────────────────────────────────────────────────────────────

/**
 * A QUIÉN SE LE PUEDE TRANSFERIR EN ESTE GRUPO.
 *
 * Una fila por participante con su veredicto —el MISMO que aplica el writer—,
 * su nombre visible y el neto del par, que viaja con la fila para que la vista
 * previa no cueste una consulta por persona marcada.
 *
 * **En el ORDEN CANÓNICO DE REPARTO**, y ese orden se conserva: es lo que hace
 * que la unidad menor que sobra se muestre en la misma persona que la
 * recibirá. Reordenar esta lista rompería esa correspondencia.
 *
 * Cero filas para un ámbito ajeno o inexistente: las dos respuestas son la
 * misma a propósito.
 */
export async function fetchGroupTransferCandidates(
  scopeId: string,
): Promise<readonly TransferCandidate[]> {
  const { data, error } = await supabase.rpc('group_transfer_candidates', { p_group: scopeId });
  if (error !== null) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((value): TransferCandidate | null => {
      const one = row(value);
      const participantId = text(one?.participant_id);
      const displayName = text(one?.display_name);
      const state = one?.state;
      const netMinor = text(one?.net_debt);
      if (
        participantId === null ||
        displayName === null ||
        typeof state !== 'string' ||
        !(TRANSFER_STATES as readonly string[]).includes(state) ||
        netMinor === null
      ) {
        return null;
      }
      return { participantId, displayName, state: state as TransferState, netMinor };
    })
    .filter((one): one is TransferCandidate => one !== null);
}

/**
 * LAS TRANSFERENCIAS VIGENTES DEL GRUPO, con su reparto.
 *
 * **Dos consultas y no 1+N**: una trae las operaciones y otra todos sus
 * repartos de una vez, y se cosen aquí por `operation_id`. Las anuladas no
 * salen de ninguna de las dos —su versión vigente no tiene reparto—, así que
 * no hay que filtrarlas.
 */
export async function fetchGroupTransfers(
  scopeId: string,
): Promise<readonly GroupTransferOperation[]> {
  const [heads, parts] = await Promise.all([
    supabase.from('group_transfer_operation').select('*').eq('group_scope_id', scopeId),
    supabase.from('group_transfer_allocation').select('*').eq('group_scope_id', scopeId),
  ]);
  if (heads.error !== null) throw heads.error;
  if (parts.error !== null) throw parts.error;

  const byOperation = new Map<string, GroupTransferShare[]>();
  for (const value of parts.data ?? []) {
    const one = row(value);
    const operationId = text(one?.operation_id);
    const receiverParticipantId = text(one?.receiver_participant_id);
    const receiverDisplayName = text(one?.receiver_display_name);
    const amountMinor = text(one?.amount);
    const ordinal = number(one?.ordinal);
    if (
      operationId === null ||
      receiverParticipantId === null ||
      receiverDisplayName === null ||
      amountMinor === null ||
      ordinal === null
    ) {
      continue;
    }
    const list = byOperation.get(operationId) ?? [];
    list.push({
      ordinal,
      receiverParticipantId,
      receiverDisplayName,
      isReceiver: one?.is_receiver === true,
      amountMinor,
    });
    byOperation.set(operationId, list);
  }

  return (heads.data ?? [])
    .map((value): GroupTransferOperation | null => {
      const one = row(value);
      const operationId = text(one?.operation_id);
      const versionId = text(one?.version_id);
      const scope = text(one?.group_scope_id);
      const senderParticipantId = text(one?.sender_participant_id);
      const senderDisplayName = text(one?.sender_display_name);
      const totalMinor = text(one?.total_amount);
      const currencyDefinitionId = text(one?.currency_definition_id);
      const effectiveDate = text(one?.effective_date);
      const createdAt = text(one?.operation_created_at);
      if (
        operationId === null ||
        versionId === null ||
        scope === null ||
        senderParticipantId === null ||
        senderDisplayName === null ||
        totalMinor === null ||
        currencyDefinitionId === null ||
        effectiveDate === null ||
        createdAt === null
      ) {
        return null;
      }
      return {
        operationId,
        versionId,
        scopeId: scope,
        senderParticipantId,
        senderDisplayName,
        isSender: one?.is_sender === true,
        totalMinor,
        currencyDefinitionId,
        effectiveDate,
        effectiveTime: text(one?.effective_time),
        concept: text(one?.concept),
        createdAt,
        // El ordinal ES el orden del reparto: se ordena por él, no por nombre.
        shares: (byOperation.get(operationId) ?? []).sort((a, b) => a.ordinal - b.ordinal),
      };
    })
    .filter((one): one is GroupTransferOperation => one !== null);
}

// ─── el comando ──────────────────────────────────────────────────────────────

function resultOf(response: {
  data: unknown;
  error: { code?: string | null; details?: string | null } | null;
  status?: number;
}): CommandResult {
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

export type RecordGroupTransferPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 1;
  readonly group_scope_id: string;
  /** El TOTAL en unidades menores, como texto. Nunca un número (F02/ADR-001). */
  readonly total_amount: string;
  /**
   * CUÁNDO, según el aparato de quien registra — igual que un gasto
   * compartido y que un pago declarado.
   *
   * **No lo pone el servidor**: corre en UTC, y una transferencia hecha a las
   * 21:30 en Madrid se guardaba como las 19:30, lo que la colocaba en
   * Movimientos por debajo de lo registrado antes esa misma tarde.
   */
  readonly effective_date: string;
  readonly effective_time: string;
  /**
   * A quién. El servidor los ordena canónicamente y reparte: el orden de esta
   * lista NO decide nada, y mandar cuotas calculadas aquí tampoco es una
   * opción — el reparto autoritativo es suyo.
   */
  readonly receiver_participant_ids: readonly string[];
  /** Opcional; el servidor lo canonicaliza y rechaza el vacío. */
  readonly concept?: string;
};

/**
 * REGISTRAR. UNA llamada, UNA operación, todo o nada.
 *
 * Con varios destinatarios no hay envío parcial que contar: si un receptor no
 * es elegible o el importe no reparte, la transacción entera se deshace y no
 * queda ni una fila.
 */
export async function sendRecordGroupTransfer(
  payload: RecordGroupTransferPayload,
): Promise<CommandResult> {
  return resultOf(
    (await supabase.rpc('record_group_transfer', { payload: payload as never })) as never,
  );
}
