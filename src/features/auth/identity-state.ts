/**
 * The account's public identity, as the app holds it (F12/ADR-001, F12.A3).
 *
 * `core` is the authority: `api.my_account_handle` publishes exactly five
 * columns — handle, public_name, state, reserved_until, can_change_at — and
 * this module knows no more than that. No history, no held handles, no uid,
 * no journal: none of it is published, and none of it is modelled here.
 *
 * Pure: decisions about the gate and the cooldown live here so they can be
 * tested without a screen, and the hook that fetches rows only applies them.
 */

/** One row of `api.my_account_handle`, as PostgREST and the RPCs return it. */
export type AccountIdentityRow = {
  readonly handle: string | null;
  readonly public_name: string | null;
  readonly state: string | null;
  readonly reserved_until: string | null;
  readonly can_change_at: string | null;
};

export type AccountIdentity = {
  /** The username without `@`, or `null` while the account has none live. */
  readonly handle: string | null;
  readonly publicName: string | null;
  /** `claimed` is definitive; `reserved` is provisional (7 days); `null` is no handle. */
  readonly state: 'claimed' | 'reserved' | null;
  /** ISO instant; only while `state === 'reserved'`. */
  readonly reservedUntil: string | null;
  /** ISO instant from which `change_username` is allowed; only while claimed. */
  readonly canChangeAt: string | null;
};

export type IdentityState =
  /**
   * Not answered yet. For a guest or a signed-out session this is the resting
   * state; for a normal account it means the lifecycle is still asking, and
   * neither the app nor the gate may mount (`isIdentityPending`).
   */
  | { readonly status: 'idle' }
  /** The account has a definitive username. */
  | { readonly status: 'ready'; readonly identity: AccountIdentity }
  /**
   * The server said `USERNAME_REQUIRED`: no live reservation to claim. The
   * gate is mandatory; it seeds the public name from the session's display
   * name, which is what the account already shows itself.
   */
  | { readonly status: 'required' }
  /**
   * The server did not answer (transport, or the watchdog). NOT the gate —
   * nothing said the account lacks a username — and NOT a blocking state:
   * Nomey opens offline (F07/ADR-001), so the account enters the app with what
   * it knows (the cached identity, if any) and the lifecycle asks again on the
   * next foreground. Only `USERNAME_REQUIRED` from the server gates.
   */
  | { readonly status: 'unavailable' };

export const IDENTITY_IDLE: IdentityState = { status: 'idle' };
export const IDENTITY_REQUIRED: IdentityState = { status: 'required' };
export const IDENTITY_UNAVAILABLE: IdentityState = { status: 'unavailable' };

/** Shape-check a row: anything not a string becomes `null`, states outside the two known become `null`. */
export function identityFromRow(row: AccountIdentityRow | null | undefined): AccountIdentity {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' ? value : null;
  const state = row?.state === 'claimed' || row?.state === 'reserved' ? row.state : null;
  return {
    handle: text(row?.handle),
    publicName: text(row?.public_name),
    state,
    reservedUntil: state === 'reserved' ? text(row?.reserved_until) : null,
    canChangeAt: state === 'claimed' ? text(row?.can_change_at) : null,
  };
}

/**
 * Whether the tabs must give way to the gate. Only a server verdict gates:
 * `required`. Ready lets the app through, and so does idle for a guest,
 * because the lifecycle never asks for one.
 */
export function needsUsernameGate(state: IdentityState): boolean {
  return state.status === 'required';
}

/**
 * Whether the account may mount the tabs. A guest always; a normal account
 * with a definitive username (`ready`) or with no answer from the server
 * (`unavailable`: offline first, F07/ADR-001). Not while pending — nothing
 * mounts until the first answer or the watchdog — and not when the server said
 * `required`, which is the gate.
 */
export function canEnterApp(state: IdentityState, asks: boolean): boolean {
  return !asks || state.status === 'ready' || state.status === 'unavailable';
}

/**
 * Whether the identity is still being decided, so nothing may mount yet: a
 * normal account (`asks`) whose lifecycle has not answered — neither the
 * server, nor the backup, nor the watchdog. A guest never asks and is never
 * pending; a re-ask after `unavailable` is not pending either: the app is in.
 */
export function isIdentityPending(state: IdentityState, asks: boolean): boolean {
  return asks && state.status === 'idle';
}

/**
 * Whether `change_username` would be allowed now (F12/ADR-001 §9): a
 * definitive handle whose cooldown, if any, has elapsed. The server decides
 * anyway; this only drives the affordance.
 */
export function canChangeUsername(identity: AccountIdentity, now: Date): boolean {
  if (identity.state !== 'claimed') return false;
  if (identity.canChangeAt === null) return true;
  const at = new Date(identity.canChangeAt);
  return Number.isNaN(at.getTime()) || at.getTime() <= now.getTime();
}

/**
 * The calendar day of an ISO instant, in the DEVICE's zone, as `YYYY-MM-DD`
 * for `formatDate`. A cooldown that ends at 23:30 local is shown as that day,
 * not as the next one UTC would give west of Greenwich. `null` if unparsable.
 */
export function calendarDayOf(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
