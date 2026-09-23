import { supabase } from '@/lib/supabase';

import {
  CANDIDATE_RELATIONS,
  type CandidateAnswer,
  type CandidateRelation,
  type CreateAnswer,
} from './friend-candidate';
import { type Friend, type FriendRequest, parseFriendRequestRow, parseFriendRow } from './friend';
import { type GroupFriendStatus, parseGroupFriendRow } from './group-friend';
import {
  FRIEND_LINK_RELATIONS,
  type FriendLinkPreview,
  type FriendLinkRelation,
  type FriendLinkResponse,
  type MyFriendLink,
} from './friend-link-state';

/**
 * THE ONLY FILE OF THIS FEATURE THAT TALKS TO SUPABASE.
 *
 * Nothing here goes through the F7 queue, on purpose and for the same reason
 * the transfers do not (F12/ADR-002 §17): every one of these commands needs
 * the other party's server state — a pair lock, a derived expiry, a budget
 * counted under a lock — and cannot honestly be "saved for later". Each call
 * returns what the server said, and the hooks decide what that means for the
 * screen. **Nothing is ever reported as done that the server did not
 * confirm.**
 */

type RawResponse = {
  data: unknown;
  error: { code?: string | null; details?: string | null } | null;
  status?: number;
};

export type CommandResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly code: string | null };

function resultOf<T>(response: RawResponse, read: (data: unknown) => T | null): CommandResult<T> {
  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { ok: false, status, code: response.error.code ?? null };
  }
  const data = read(response.data);
  // A 2xx whose body is not the envelope is a contract break, not a success:
  // it is reported as a rejection with no code, never painted as done.
  if (data === null) return { ok: false, status, code: null };
  return { ok: true, status, data };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ─── the lookup ──────────────────────────────────────────────────────────────

/**
 * ONE call, one throttle attempt, identity AND relation (F12/ADR-005 §5).
 * `not_found`, `self` and `throttled` come back as ROWS and not as errors,
 * so the attempt the server booked persists — an exception would roll it
 * back and probing would be free (measured in F12.B1).
 */
export async function lookupCandidate(handle: string): Promise<CommandResult<CandidateAnswer>> {
  const response = (await supabase.rpc('lookup_friend_candidate', {
    p_handle: handle,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const rows = Array.isArray(data) ? data : data === null ? [] : [data];
    const row = record(rows[0]);
    const state = row?.state;
    if (state === 'not_found' || state === 'self' || state === 'throttled') return { state };
    if (typeof state === 'string' && CANDIDATE_RELATIONS.includes(state as CandidateRelation)) {
      const found = text(row?.handle);
      if (found === null) return null;
      return {
        state: state as CandidateRelation,
        handle: found,
        publicName: text(row?.public_name),
        requestId: text(row?.request_id),
      };
    }
    return null;
  });
}

// ─── the commands ────────────────────────────────────────────────────────────

export type CreateRequestPayload = {
  readonly client_command_id: string;
  readonly command_contract_version: 1;
  readonly handle: string;
};

const CREATE_STATES: readonly CreateAnswer['state'][] = [
  'pending',
  'incoming_pending',
  'friends',
  'cooldown',
  'not_found',
  'accepted',
  'declined',
  'cancelled',
  'expired',
];

/**
 * THE ANSWER OF A CREATION, whichever door it came through.
 *
 * Extracted because F12.E.D added a second entry —by group participant— and
 * the server answers it with the SAME states from the SAME core: copying
 * this would have been a second reading of one contract.
 */
function createAnswerOf(data: unknown): CreateAnswer | null {
  const body = record(data);
  const state = body?.state;
  if (typeof state !== 'string') return null;
  if (!CREATE_STATES.includes(state as CreateAnswer['state'])) return null;
  if (state === 'pending') {
    const requestId = text(body?.request_id);
    // `pending` without its id is not something a screen can act on.
    return requestId === null ? null : { state: 'pending', requestId };
  }
  if (state === 'incoming_pending') {
    return { state: 'incoming_pending', requestId: text(body?.request_id) };
  }
  return { state } as CreateAnswer;
}

export async function sendCreateFriendRequest(
  payload: CreateRequestPayload,
): Promise<CommandResult<CreateAnswer>> {
  const response = (await supabase.rpc('create_friend_request', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response, createAnswerOf);
}

export type RequestTransition = {
  readonly requestId: string;
  readonly state: string;
  readonly alreadyProcessed: boolean;
};

function transitionOf(data: unknown): RequestTransition | null {
  const body = record(data);
  if (typeof body?.request_id !== 'string' || typeof body.state !== 'string') return null;
  return {
    requestId: body.request_id,
    state: body.state,
    alreadyProcessed: body.already_processed === true,
  };
}

export async function sendAcceptFriendRequest(
  requestId: string,
): Promise<CommandResult<RequestTransition>> {
  const response = (await supabase.rpc('accept_friend_request', {
    payload: { request_id: requestId } as never,
  })) as unknown as RawResponse;
  return resultOf(response, transitionOf);
}

export async function sendDeclineFriendRequest(
  requestId: string,
): Promise<CommandResult<RequestTransition>> {
  const response = (await supabase.rpc('decline_friend_request', {
    payload: { request_id: requestId } as never,
  })) as unknown as RawResponse;
  return resultOf(response, transitionOf);
}

export async function sendCancelFriendRequest(
  requestId: string,
): Promise<CommandResult<RequestTransition>> {
  const response = (await supabase.rpc('cancel_friend_request', {
    payload: { request_id: requestId } as never,
  })) as unknown as RawResponse;
  return resultOf(response, transitionOf);
}

export type FriendshipTransition = {
  readonly friendshipId: string;
  readonly state: string;
  readonly alreadyProcessed: boolean;
};

export async function sendRemoveFriend(
  friendshipId: string,
): Promise<CommandResult<FriendshipTransition>> {
  const response = (await supabase.rpc('remove_friend', {
    payload: { friendship_id: friendshipId } as never,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const body = record(data);
    if (typeof body?.friendship_id !== 'string' || typeof body.state !== 'string') return null;
    return {
      friendshipId: body.friendship_id,
      state: body.state,
      alreadyProcessed: body.already_processed === true,
    };
  });
}

// ─── reading ─────────────────────────────────────────────────────────────────

export async function fetchMyFriends(): Promise<readonly Friend[]> {
  const { data, error } = await supabase
    .from('my_friends')
    .select('friendship_id,counterpart_handle,counterpart_public_name,since')
    .order('since', { ascending: false });
  if (error !== null) throw error;
  return (data ?? [])
    .map((row) => parseFriendRow(row as unknown as Record<string, unknown>))
    .filter((one): one is Friend => one !== null);
}

export async function fetchMyFriendRequests(): Promise<readonly FriendRequest[]> {
  const { data, error } = await supabase
    .from('my_friend_requests')
    .select('request_id,direction,counterpart_handle,counterpart_public_name,created_at,expires_at')
    .order('created_at', { ascending: false });
  if (error !== null) throw error;
  return (data ?? [])
    .map((row) => parseFriendRequestRow(row as unknown as Record<string, unknown>))
    .filter((one): one is FriendRequest => one !== null);
}

// ─── el enlace de amistad (F12/ADR-006) ──────────────────────────────────────

/**
 * EL ENLACE PROPIO. `api.my_friend_link` lo CREA la primera vez que se pide,
 * así que no hay que provisionarlo en ningún sitio: pedirlo es tenerlo.
 */
export async function fetchMyFriendLink(): Promise<CommandResult<MyFriendLink>> {
  const response = (await supabase.rpc('my_friend_link')) as unknown as RawResponse;
  return resultOf(response, readLink);
}

/**
 * Regenerar: token nuevo, versión + 1, y **el anterior deja de existir en el
 * mismo instante**. Cinco en 24 h (`FRIEND_LINK_ROTATION_LIMITED · 429`).
 */
export async function sendRotateFriendLink(): Promise<CommandResult<MyFriendLink>> {
  const response = (await supabase.rpc('rotate_friend_link')) as unknown as RawResponse;
  return resultOf(response, readLink);
}

function readLink(data: unknown): MyFriendLink | null {
  const body = record(data);
  const token = text(body?.token);
  if (token === null) return null;
  const version = body?.version;
  return {
    token,
    version: typeof version === 'number' ? version : 0,
    rotatedAt: text(body?.rotated_at),
  };
}

/**
 * QUÉ DICE EL ENLACE DE OTRA CUENTA. Estados con 200 y nunca excepciones para
 * lo del token, para que el apunte del inválido persista (20 / 10 min).
 * Exige cuenta normal con handle definitivo: sin eso el servidor responde
 * ANTES de mirar el token, que es lo que impide usar el enlace como API
 * pública de resolución de identidad.
 */
export async function previewFriendLink(token: string): Promise<CommandResult<FriendLinkPreview>> {
  const response = (await supabase.rpc('preview_friend_link', {
    p_token: token,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const rows = Array.isArray(data) ? data : data === null ? [] : [data];
    const row = record(rows[0]);
    const state = row?.state;
    if (state === 'own' || state === 'invalid' || state === 'throttled') return { state };
    if (state === 'friends') {
      return { state, handle: text(row?.handle), publicName: text(row?.public_name) };
    }
    if (typeof state === 'string' && FRIEND_LINK_RELATIONS.includes(state as FriendLinkRelation)) {
      return {
        state: state as FriendLinkRelation,
        handle: text(row?.handle),
        publicName: text(row?.public_name),
        requestId: text(row?.request_id),
      };
    }
    return null;
  });
}

/**
 * RESPONDER. `accept` reutiliza la solicitud pendiente que hubiera en
 * cualquiera de las dos direcciones y **nunca duplica**; `decline` rechaza la
 * suya si existía (`declined`) y, si no había ninguna, no persiste nada
 * (`dismissed`). El token se reverifica bajo el cerrojo del dueño, así que
 * una rotación simultánea lo invalida en vez de colarse.
 */
export async function sendRespondFriendLink(
  token: string,
  action: 'accept' | 'decline',
): Promise<CommandResult<FriendLinkResponse>> {
  const response = (await supabase.rpc('respond_friend_link', {
    payload: { token, action } as never,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const body = record(data);
    const state = body?.state;
    if (state === 'own' || state === 'invalid' || state === 'throttled' || state === 'dismissed') {
      return { state };
    }
    if (state === 'declined') return { state, requestId: text(body?.request_id) };
    if (state === 'friends') {
      return {
        state,
        friendshipId: text(body?.friendship_id),
        requestId: text(body?.request_id),
        alreadyProcessed: body?.already_processed === true,
      };
    }
    return null;
  });
}

// ─── desde un participante de grupo (F12.E.D) ────────────────────────────────

/**
 * EL MAPA SOCIAL DEL GRUPO, en UNA llamada.
 *
 * Una función por participante habría sido N viajes para pintar una lista, y
 * la barrera —ser miembro de ese grupo— es la misma para todos. Devuelve fila
 * para TODOS, incluido uno mismo y los que no tienen cuenta, así que la
 * pantalla tiene un mapa total y no deduce nada.
 *
 * Un ámbito del que el actor no es miembro contesta CERO filas, no un error:
 * es una lectura, y un ámbito ajeno y uno inexistente se contestan igual.
 */
export async function fetchGroupFriendStatus(
  scopeId: string,
): Promise<readonly GroupFriendStatus[]> {
  const { data, error } = await supabase.rpc('group_friend_status', { p_scope: scopeId });
  if (error !== null) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => parseGroupFriendRow(row))
    .filter((row): row is GroupFriendStatus => row !== null);
}

export type CreateToParticipantPayload = {
  readonly client_command_id: string;
  readonly command_contract_version: 1;
  readonly participant_id: string;
};

/**
 * PEDIR AMISTAD A UN PARTICIPANTE, sin conocer su `@username`.
 *
 * El servidor resuelve el participante a una cuenta y aplica EXACTAMENTE lo
 * de `create_friend_request`: mismo cerrojo de pareja, misma caducidad,
 * mismas cruzadas, mismo cooldown, mismos topes, misma idempotencia por
 * clave. Por eso la respuesta se lee con el MISMO parser: son los mismos
 * estados, menos `not_found` —que aquí no puede darse— y más `unavailable`,
 * que es el participante vinculado a una cuenta que todavía no puede ser
 * amiga de nadie.
 */
export async function sendCreateFriendRequestToParticipant(
  payload: CreateToParticipantPayload,
): Promise<CommandResult<CreateAnswer | { readonly state: 'unavailable' }>> {
  const response = (await supabase.rpc('create_friend_request_to_participant', {
    payload: payload as never,
  })) as unknown as RawResponse;
  return resultOf(response, (data) => {
    const body = record(data);
    if (body?.state === 'unavailable') return { state: 'unavailable' } as const;
    return createAnswerOf(data);
  });
}
