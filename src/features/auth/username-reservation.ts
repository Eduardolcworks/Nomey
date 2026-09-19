import { supabase } from '@/lib/supabase';

import { type AuthErrorKey, usernameRpcErrorKey } from './auth-errors';

/**
 * A guest reserves its username BEFORE becoming an account (F12/ADR-001 §8).
 *
 * The sign-up hook cannot help here: a guest is converted with `PUT /user`,
 * not created, so `before_user_created` never runs. The anonymous session
 * calls `api.reserve_username` instead — the ONE command A1 opens to an
 * anonymous actor, and only to reserve: 7 provisional days, `claimed_at`
 * null, the same uid the conversion keeps. The public name travels with it,
 * because the identity row is born here and the server never reads Auth
 * metadata for it.
 *
 * Idempotent by state on the server: the same handle again answers the same
 * reservation; a different one replaces the guest's own live reservation.
 * Claiming is not this feature's job — the authenticated lifecycle does it
 * once the account is confirmed (F12.A3).
 */
export type ReservationResult =
  { readonly ok: true } | { readonly ok: false; readonly messageKey: AuthErrorKey };

type RawResponse = { error: { code?: string | null } | null; status?: number };

export async function reserveUsername(
  handle: string,
  publicName: string,
): Promise<ReservationResult> {
  const response = (await supabase.rpc('reserve_username', {
    payload: { handle, public_name: publicName } as never,
  })) as unknown as RawResponse;
  if (response.error !== null && response.error !== undefined) {
    return { ok: false, messageKey: usernameRpcErrorKey(response.error.code) };
  }
  return { ok: true };
}
