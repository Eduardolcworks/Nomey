/**
 * Handles nobody may take (F12/ADR-001 §4).
 *
 * Two lists, both frozen by the shared vectors (`tests/vectors/username.json`)
 * and seeded into `core.reserved_handle` by migration: 25 exact names and 4
 * prefixes. Adding one means changing the vector and the migration, not this
 * file alone — the test asserts these arrays equal the vector's.
 *
 * Exact names are matched whole (`help` blocks `help`, not `helper`); a
 * prefix blocks everything that starts with it (`admin` blocks
 * `administrador`). Both are compared against the NORMALIZED handle, so the
 * caller runs `normalizeHandle` first.
 */

export const RESERVED_HANDLES: readonly string[] = [
  // support and security
  'help',
  'ayuda',
  'security',
  'seguridad',
  // roles that invite trust
  'staff',
  'team',
  'equipo',
  'official',
  'oficial',
  'verified',
  'verificado',
  'root',
  'system',
  'sistema',
  // routes and technical intents
  'join',
  'pay',
  'auth',
  'recovery',
  'api',
  'app',
  // states and values
  'null',
  'anonymous',
  'anonimo',
  'invitado',
  'guest',
];

export const RESERVED_HANDLE_PREFIXES: readonly string[] = ['nomey', 'admin', 'support', 'soporte'];

const exact = new Set(RESERVED_HANDLES);

/** Whether an already-normalized handle is reserved, whole or by prefix. */
export function isReservedHandle(handle: string): boolean {
  if (exact.has(handle)) return true;
  return RESERVED_HANDLE_PREFIXES.some((prefix) => handle.startsWith(prefix));
}
