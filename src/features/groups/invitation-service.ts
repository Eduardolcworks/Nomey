/**
 * PREVISUALIZAR Y CANJEAR UNA INVITACIÓN. F09/ADR-004.
 *
 * Los estados de la invitación —inválida, revocada, caducada, frenada— llegan
 * como ESTADO en la respuesta y no como error HTTP, porque el servidor apunta
 * el intento fallido y una excepción lo revertiría (ver la migración). Aquí
 * se tipan tal cual. Los errores de escritura del canje sí son errores.
 *
 * El token nunca se guarda en este aparato ni viaja a ningún log: vive en el
 * campo mientras la ventana está abierta.
 */
import { supabase } from '@/lib/supabase';

export type InvitationState = 'ok' | 'invalid' | 'revoked' | 'expired' | 'throttled';

export type InvitationPreview =
  | { readonly state: 'invalid' | 'revoked' | 'expired' | 'throttled' }
  | {
      readonly state: 'ok';
      readonly displayName: string;
      readonly emoji: string;
      /**
       * Ya miembro (`member`), salió con vínculo y puede volver con su identidad
       * (`rejoin`, F09/ADR-010; el servidor anterior decía `rejoin_pending` y se
       * lee igual), o puede entrar (`join`).
       */
      readonly membership: 'member' | 'rejoin' | 'join';
      /** Sólo si ya se es miembro: para abrir el grupo. */
      readonly scopeId: string | null;
      /** Sólo al volver: la identidad de entonces, con su nombre actual. */
      readonly previousParticipant: {
        readonly participantId: string;
        readonly displayName: string;
      } | null;
      /** Sin cuenta vinculada, no retirados, presentes. Sólo el nombre. */
      readonly participants: readonly {
        readonly participantId: string;
        readonly displayName: string;
      }[];
    };

type RawResponse = { data: unknown; error: { code?: string | null } | null; status?: number };

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const response = (await supabase.rpc('preview_invitation', {
    p_token: token,
  })) as unknown as RawResponse;
  if (response.error !== null && response.error !== undefined) throw response.error;
  const data = response.data as Record<string, unknown> | null;
  const state = data?.state;
  if (state === 'invalid' || state === 'revoked' || state === 'expired' || state === 'throttled') {
    return { state };
  }
  const raw = data?.state;
  const membership =
    raw === 'rejoin_pending'
      ? 'rejoin'
      : raw === 'member' || raw === 'rejoin' || raw === 'join'
        ? raw
        : null;
  if (membership === null) return { state: 'invalid' };
  const rows = Array.isArray(data?.participants) ? (data.participants as unknown[]) : [];
  const previous = data?.previous_participant as Record<string, unknown> | null | undefined;
  return {
    state: 'ok',
    membership,
    previousParticipant:
      typeof previous?.participant_id === 'string' && typeof previous?.display_name === 'string'
        ? { participantId: previous.participant_id, displayName: previous.display_name }
        : null,
    displayName: typeof data?.display_name === 'string' ? data.display_name : '',
    emoji: typeof data?.emoji === 'string' ? data.emoji : '',
    scopeId: typeof data?.scope_id === 'string' ? data.scope_id : null,
    participants: rows.flatMap((row) => {
      const one = row as Record<string, unknown>;
      return typeof one.participant_id === 'string' && typeof one.display_name === 'string'
        ? [{ participantId: one.participant_id, displayName: one.display_name }]
        : [];
    }),
  };
}

export type RedeemChoice =
  | { readonly kind: 'claim'; readonly participantId: string }
  | { readonly kind: 'new'; readonly displayName: string }
  /** Volver con la identidad de entonces (F09/ADR-010): sin participante ni nombre. */
  | { readonly kind: 'rejoin' };

export type RedeemResult =
  | { readonly state: 'invalid' | 'revoked' | 'expired' | 'throttled' }
  | { readonly state: 'ok'; readonly scopeId: string; readonly alreadyMember: boolean }
  | { readonly state: 'failed'; readonly status: number; readonly code: string | null };

export async function redeemInvitation(payload: {
  readonly client_command_id: string;
  readonly token: string;
  readonly choice: RedeemChoice;
}): Promise<RedeemResult> {
  const body = {
    client_command_id: payload.client_command_id,
    command_contract_version: 1,
    token: payload.token,
    choice: payload.choice.kind,
    ...(payload.choice.kind === 'claim'
      ? { participant_id: payload.choice.participantId }
      : payload.choice.kind === 'new'
        ? { display_name: payload.choice.displayName }
        : {}),
  };
  const response = (await supabase.rpc('redeem_invitation', {
    payload: body as never,
  })) as unknown as RawResponse;
  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { state: 'failed', status, code: response.error.code ?? null };
  }
  const data = response.data as Record<string, unknown> | null;
  const state = data?.state;
  if (state === 'invalid' || state === 'revoked' || state === 'expired' || state === 'throttled') {
    return { state };
  }
  if (state === 'ok' && typeof data?.scope_id === 'string') {
    return { state: 'ok', scopeId: data.scope_id, alreadyMember: data.already_member === true };
  }
  return { state: 'failed', status, code: null };
}
