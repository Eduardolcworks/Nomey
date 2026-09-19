import type { CatalogueCache } from '@/lib/offline';

import type { AccountIdentity } from './identity-state';

/**
 * The last identity the server confirmed, kept per account so a cold start
 * without network still knows what this account is called (F12/ADR-001 §7,
 * F07/ADR-001: Nomey opens offline).
 *
 * Same store and same discipline as the Personal scope's backup
 * (`features/personal/personal-scope.ts`): the shared `CatalogueCache`, one
 * document per `(actor, key)`, written only from a SERVER answer, read only
 * while the server has not answered for this actor, and never trusted to
 * decide anything the server decides. In particular it can never open the
 * gate — only `USERNAME_REQUIRED` does — and it stores only the five public
 * columns' worth of a definitive identity: handle, public name, cooldown. No
 * history, no reservation, no uid beyond the cache's own actor key.
 */
export const IDENTITY_CACHE_KEY = 'account-identity';

const IDENTITY_DOCUMENT_VERSION = 1;

/** Only a definitive identity is worth remembering; a reservation is not. */
export function serializeIdentity(identity: AccountIdentity): string | null {
  if (identity.state !== 'claimed' || identity.handle === null) return null;
  return JSON.stringify({
    v: IDENTITY_DOCUMENT_VERSION,
    handle: identity.handle,
    publicName: identity.publicName,
    canChangeAt: identity.canChangeAt,
  });
}

export function parseIdentity(document: string): AccountIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const shape = parsed as Record<string, unknown>;
  if (shape.v !== IDENTITY_DOCUMENT_VERSION) return null;
  if (typeof shape.handle !== 'string' || shape.handle === '') return null;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' ? value : null;
  return {
    handle: shape.handle,
    publicName: text(shape.publicName),
    state: 'claimed',
    reservedUntil: null,
    canChangeAt: text(shape.canChangeAt),
  };
}

/** Never throws: the backup is auxiliary. Without an actor nothing is written. */
export async function rememberIdentity(
  cache: CatalogueCache,
  actorId: string,
  identity: AccountIdentity,
  now: string,
): Promise<'stored' | 'skipped' | 'failed'> {
  if (actorId === '') return 'skipped';
  const document = serializeIdentity(identity);
  if (document === null) return 'skipped';
  try {
    await cache.write(actorId, IDENTITY_CACHE_KEY, document, now);
    return 'stored';
  } catch {
    return 'failed';
  }
}

export async function recallIdentity(
  cache: CatalogueCache,
  actorId: string,
): Promise<AccountIdentity | null> {
  if (actorId === '') return null;
  try {
    const document = await cache.read(actorId, IDENTITY_CACHE_KEY);
    return document === null ? null : parseIdentity(document.document);
  } catch {
    return null;
  }
}
