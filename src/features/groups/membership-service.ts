/**
 * SALIR DE UN GRUPO, DAR POR SALDADO A QUIEN SALIÓ, Y LOS AVISOS. F09/ADR-003.
 *
 * Tres comandos y dos lecturas, en el mismo patrón que `group-service.ts`:
 * se devuelve lo que llegó —estado, código, sobre— y quien conoce el flujo
 * decide qué significa. Ninguno pasa por la cola durable (F07/ADR-001 no cubre
 * estas escrituras): sin red fallan, y se dice.
 *
 * **Las claves las conserva quien reintenta.** `leave_group` es idempotente
 * por `core.provisioning_command` (F09/ADR-002) y `settle_participant` por la
 * retirada y por `core.client_command` (F03/ADR-007): el servidor responde
 * `already_processed` y no escribe dos veces.
 */
import { supabase } from '@/lib/supabase';

type RawResponse = {
  data: unknown;
  error: { code?: string | null; details?: string | null } | null;
  status?: number;
};

export type CommandResult = {
  readonly status: number;
  readonly code: string | null;
  /**
   * Los detalles del error de frontera, tal cual llegan (`error.details`): un
   * JSON serializado cuando el servidor los manda (`LEAVE_BLOCKED_DEBT` trae
   * `net` y `pairs`), `null` si no. Quien conoce el código lo interpreta.
   */
  readonly details: string | null;
  readonly ok: boolean;
};

function resultOf(response: RawResponse): CommandResult {
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

export async function sendLeaveGroup(payload: {
  readonly client_command_id: string;
  readonly command_contract_version: 1;
  readonly scope_id: string;
}): Promise<CommandResult> {
  const response = (await supabase.rpc('leave_group', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response);
}

/**
 * UN PAR PENDIENTE, tal como lo publica `api.group_pending_pair`: neteado en
 * las dos direcciones, y siempre `> 0`. Es lo que la confirmación enseña y lo
 * que se manda de vuelta, literal, como `expected_pairs`.
 */
export type PendingPair = {
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  /** Unidad mínima, en texto: nunca cruza como número (F03/ADR-005). */
  readonly amountMinor: string;
};

/**
 * MI NETO en un grupo, por la lectura real (`api.group_balance`, fila
 * `is_self`): lo que decide, ANTES de pedir confirmación, si salir es
 * posible (F09/ADR-007 C8: se sale a neto cero; los pares que queden se
 * reasignan sin dinero). El servidor lo vuelve a comprobar bajo el cerrojo
 * (`LEAVE_BLOCKED_DEBT`). Sin identidad propia —no debería ocurrir siendo
 * miembro— se responde cero. En unidades menores, exacto.
 */
export async function fetchMyNetPosition(scopeId: string): Promise<bigint> {
  const { data, error } = await supabase
    .from('group_balance')
    .select('net_position,is_self')
    .eq('scope_id', scopeId)
    .eq('is_self', true)
    .maybeSingle();
  if (error !== null) throw error;
  return data?.net_position == null ? 0n : BigInt(data.net_position);
}

export async function fetchPendingPairs(
  scopeId: string,
  participantId: string,
): Promise<readonly PendingPair[]> {
  const { data, error } = await supabase
    .from('group_pending_pair')
    .select('debtor_participant_id,creditor_participant_id,amount')
    .eq('scope_id', scopeId)
    .or(`debtor_participant_id.eq.${participantId},creditor_participant_id.eq.${participantId}`);
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

export async function sendSettleParticipant(payload: {
  readonly client_operation_id: string;
  readonly command_contract_version: 1;
  readonly scope_id: string;
  readonly participant_id: string;
  readonly expected_pairs: readonly {
    readonly debtor_participant_id: string;
    readonly creditor_participant_id: string;
    readonly amount: string;
  }[];
}): Promise<CommandResult> {
  const response = (await supabase.rpc('settle_participant', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response);
}

/** Lo que un «Saldado» o una retirada mandan: el mismo payload. */
export type RetirementPayload = Parameters<typeof sendSettleParticipant>[0];

/**
 * RETIRAR A UN PARTICIPANTE SIN CUENTA (ampliación explícita de F09/ADR-003 §6):
 * la misma retirada que «Saldado» —pares CAS, un efecto por par, sin caja—,
 * sobre un participante ACTIVO declarado por su nombre. El servidor comprueba
 * bajo bloqueo que sigue sin cuenta (`PARTICIPANT_LINKED` si no) y que los
 * pares son los que se enseñaron (`SETTLEMENT_STALE`).
 */
export async function sendRetireParticipant(payload: RetirementPayload): Promise<CommandResult> {
  const response = (await supabase.rpc('retire_participant', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response);
}

/**
 * ASOCIAR UN PARTICIPANTE SIN CUENTA A LA PROPIA (F09/ADR-009): mi identidad del
 * grupo asume la suya. Fusión de lectura —los hechos siguen nombrando a quien
 * figuraba— y caja histórica incorporada una sola vez, en el mismo comando.
 * El servidor decide bajo el cerrojo: `PARTICIPANT_LINKED` (ya tiene cuenta),
 * `PARTICIPANT_MERGED` (ya asociado), `PARTICIPANT_RETIRED`. Idempotente por
 * `core.provisioning_command`: un reintento responde el resultado original.
 */
export async function sendAssociateParticipant(payload: {
  readonly client_command_id: string;
  readonly command_contract_version: 1;
  readonly scope_id: string;
  readonly participant_id: string;
}): Promise<CommandResult> {
  const response = (await supabase.rpc('associate_participant', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response);
}

/** Lo que publica `api.group_notice`: sin `user_id` de nadie, con `byMe`. */
export type GroupNotice = {
  readonly id: string;
  readonly scopeId: string;
  readonly groupDisplayName: string;
  /** Los dos de pago (F09/ADR-007 C6) llegan al destinatario aunque ya no sea miembro. */
  readonly kind: 'edit' | 'profile' | 'departure' | 'settlement' | 'payment' | 'payment_annulled';
  readonly byMe: boolean;
  readonly occurredAt: string;
  readonly readAt: string | null;
  readonly operationId: string | null;
  readonly participantDisplayName: string | null;
};

export async function fetchGroupNotices(): Promise<readonly GroupNotice[]> {
  const { data, error } = await supabase
    .from('group_notice')
    .select(
      'id,scope_id,group_display_name,kind,by_me,occurred_at,read_at,operation_id,participant_display_name',
    )
    .order('occurred_at', { ascending: false })
    .limit(100);
  if (error !== null) throw error;
  return (data ?? []).flatMap((row) =>
    row.id === null ||
    row.scope_id === null ||
    row.kind === null ||
    row.occurred_at === null ||
    row.group_display_name === null
      ? []
      : [
          {
            id: row.id,
            scopeId: row.scope_id,
            groupDisplayName: row.group_display_name,
            kind: row.kind as GroupNotice['kind'],
            byMe: row.by_me ?? false,
            occurredAt: row.occurred_at,
            readAt: row.read_at ?? null,
            operationId: row.operation_id ?? null,
            participantDisplayName: row.participant_display_name ?? null,
          },
        ],
  );
}

/**
 * Dar por vistos los pendientes al entrar en la campana, hasta una frontera:
 * el aviso más reciente que ESTA lista tenía cargado. El servidor marca los
 * del actor con `occurred_at` menor o igual que el de ese aviso —los antiguos
 * fuera de la página incluidos— y deja fuera cualquiera posterior, aunque la
 * llamada llegue tarde. Devuelve cuántos marcó.
 */
export async function markGroupNoticesSeen(newestId: string): Promise<CommandResult> {
  const response = (await supabase.rpc('mark_group_notices_seen', {
    p_newest: newestId,
  })) as unknown as RawResponse;
  return resultOf(response);
}

export async function markGroupNoticeRead(id: string): Promise<CommandResult> {
  const response = (await supabase.rpc('mark_group_notice_read', {
    p_id: id,
  })) as unknown as RawResponse;
  return resultOf(response);
}
