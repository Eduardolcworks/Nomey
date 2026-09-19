import { supabase } from '@/lib/supabase';

import { type AuthErrorKey, usernameRpcErrorKey } from './auth-errors';
import { normaliseDisplayName, normaliseUsername } from './credentials';
import { type AccountIdentity, type AccountIdentityRow, identityFromRow } from './identity-state';

/**
 * Every call the app makes about its own public identity (F12/ADR-001), and
 * nothing else. Screens never touch `supabase` for this: they get a result
 * they can render, with the server's code already mapped to a sentence.
 *
 * Four commands, all of A1 — A3 adds no SQL:
 *
 * - `claim_username()`        the authenticated lifecycle, once per session
 * - `reserve_username(...)`   the gate (a normal account claims in the act)
 * - `change_username(...)`    Profile
 * - `set_public_name(...)`    Profile, BEFORE the Auth metadata copy
 *
 * `api.my_account_handle` is what the commands return a row of; the lifecycle
 * re-runs `claim_username` to refresh, so nothing here reads the view directly.
 */

type RawRpc = {
  data: unknown;
  error: { code?: string | null; details?: string | null; message?: string | null } | null;
};

export type IdentityResult =
  | { readonly ok: true; readonly identity: AccountIdentity }
  /** `USERNAME_REQUIRED`: no live reservation. The gate, not a sentence. */
  | { readonly ok: false; readonly required: true }
  | {
      readonly ok: false;
      readonly required?: false;
      readonly messageKey: AuthErrorKey;
      /** Only with `USERNAME_CHANGE_COOLDOWN`: the ISO instant the server says. */
      readonly availableAt?: string;
    };

function firstRow(data: unknown): AccountIdentityRow | null {
  if (Array.isArray(data)) return (data[0] as AccountIdentityRow | undefined) ?? null;
  if (data !== null && typeof data === 'object') return data as AccountIdentityRow;
  return null;
}

/** `details` of `sec.raise_boundary(..., jsonb)` travels as a JSON string. */
function detailsOf(error: RawRpc['error']): Record<string, unknown> {
  const raw = error?.details;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function failure(error: NonNullable<RawRpc['error']>): IdentityResult {
  const code = error.code ?? null;
  if (code === 'USERNAME_REQUIRED') return { ok: false, required: true };
  if (code === 'USERNAME_CHANGE_COOLDOWN') {
    const at = detailsOf(error).available_at;
    return {
      ok: false,
      messageKey: 'authError.usernameCooldown',
      availableAt: typeof at === 'string' ? at : undefined,
    };
  }
  return { ok: false, messageKey: usernameRpcErrorKey(code) };
}

async function rpcIdentity(
  fn: 'claim_username' | 'reserve_username' | 'change_username' | 'set_public_name',
  args?: Record<string, unknown>,
): Promise<IdentityResult> {
  const response = (await (args === undefined
    ? supabase.rpc(fn as never)
    : supabase.rpc(fn as never, args as never))) as unknown as RawRpc;
  if (response.error !== null && response.error !== undefined) return failure(response.error);
  return { ok: true, identity: identityFromRow(firstRow(response.data)) };
}

/**
 * The lifecycle's one call (F12/ADR-001 §7). Idempotent by state on the
 * server: a live reservation becomes definitive, a definitive handle answers
 * itself, no reservation or an expired one answers `USERNAME_REQUIRED`.
 */
export function claimUsername(): Promise<IdentityResult> {
  return rpcIdentity('claim_username');
}

/**
 * The gate: a normal account reserves AND claims in one command (A1); if the
 * server ever answered a plain reservation, claim it in the same breath so the
 * gate never lets a provisional handle through. `publicName` seeds
 * `core.account_identity` for an account that has none — a pre-F12 account —
 * from the session's display name, never from the email.
 */
export async function chooseUsername(
  rawHandle: string,
  rawPublicName: string,
): Promise<IdentityResult> {
  const publicName = normaliseDisplayName(rawPublicName);
  if (publicName === '') return { ok: false, messageKey: 'authError.nameRequired' };
  const reserved = await rpcIdentity('reserve_username', {
    payload: { handle: normaliseUsername(rawHandle), public_name: publicName },
  });
  if (!reserved.ok || reserved.identity.state === 'claimed') return reserved;
  return rpcIdentity('claim_username');
}

/** Profile: `change_username` (F12/ADR-001 §9). Recovering a held handle is the same call. */
export function changeUsername(rawHandle: string): Promise<IdentityResult> {
  return rpcIdentity('change_username', { payload: { handle: normaliseUsername(rawHandle) } });
}

export type PublicNameResult =
  | { readonly ok: true; readonly identity: AccountIdentity; readonly metadataStale: boolean }
  | { readonly ok: false; readonly messageKey: AuthErrorKey };

/**
 * Profile: the public name. **`core` first, Auth metadata second** (F12/ADR-001
 * §10): `set_public_name` is the authority for what others see; the metadata
 * copy only keeps Inicio's greeting — which reads the session — in step.
 *
 * If the second write fails, the first is NOT reverted: there is no
 * transaction across Postgres and GoTrue to pretend there is. The result says
 * so (`metadataStale`), the identity shown in Profile is the new core value,
 * and the greeting may lag until the next edit. Honest, and cosmetic.
 */
export async function updatePublicName(raw: string): Promise<PublicNameResult> {
  const publicName = normaliseDisplayName(raw);
  if (publicName === '') return { ok: false, messageKey: 'authError.nameRequired' };
  const result = await rpcIdentity('set_public_name', { payload: { public_name: publicName } });
  if (!result.ok) {
    return {
      ok: false,
      messageKey: result.required === true ? 'authError.generic' : result.messageKey,
    };
  }
  const { error } = await supabase.auth.updateUser({ data: { display_name: publicName } });
  return { ok: true, identity: result.identity, metadataStale: error !== null };
}
