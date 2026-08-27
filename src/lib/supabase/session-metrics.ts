import { CHUNKED_STORAGE_LIMITS, type StorageBackend } from './chunked-storage';

/**
 * How big the stored session actually is.
 *
 * [ADR-017](../../../docs/adr/ADR-017-secure-session-storage.md) requires this
 * measured on a real device before Phase 5 closes. It could not be taken in
 * F5.A because no authentic session existed yet; F5.C is the first block that
 * produces one.
 *
 * **It cannot change the design, and the ADR says so.** The store chunks every
 * value by decision, because Expo documents the size limit as
 * platform- and version-dependent and because a session grows with user
 * metadata. If the number turns out to fit in one chunk, the decision stands.
 * The number is a validation, not an input.
 *
 * **Nothing here can return content.** The result is four numbers and a
 * boolean, so there is no shape in which an access token, a refresh token or
 * a user object could reach a caller - which matters because the only caller
 * is a screen. That is a structural guarantee rather than a careful one.
 */

export type SessionMetrics = {
  readonly present: boolean;
  /** What SecureStore actually stores, which is UTF-8. */
  readonly utf8Bytes: number;
  /** What the chunk size is expressed in. */
  readonly codeUnits: number;
  readonly chunks: number;
  readonly largestChunkBytes: number;
};

export const NO_SESSION_STORED: SessionMetrics = {
  present: false,
  utf8Bytes: 0,
  codeUnits: 0,
  chunks: 0,
  largestChunkBytes: 0,
};

/**
 * UTF-8 length, counted rather than encoded.
 *
 * `TextEncoder` exists in this runtime, but counting is the whole job and this
 * way the figure does not depend on a global that Hermes could shape
 * differently from Node - the same lesson `Intl` already taught this project.
 */
export function utf8Length(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        // A surrogate pair is one code point of four bytes, and consumes two
        // units. An unpaired surrogate falls through to three, which is what
        // the replacement character costs.
        bytes += 4;
        index += 1;
        continue;
      }
      bytes += 3;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/**
 * Read the stored value's shape straight from the backend.
 *
 * Deliberately not through `createChunkedStore`: the manifest and the
 * individual chunks are exactly what is being measured, and the store's job is
 * to hide them.
 */
export async function measureStoredSession(
  backend: StorageBackend,
  key: string,
): Promise<SessionMetrics> {
  const rawManifest = await backend.getItem(key);
  if (rawManifest === null) return NO_SESSION_STORED;

  let count: number;
  try {
    const parsed = JSON.parse(rawManifest) as { n?: unknown };
    if (typeof parsed.n !== 'number' || !Number.isInteger(parsed.n) || parsed.n < 0) {
      return NO_SESSION_STORED;
    }
    count = Math.min(parsed.n, CHUNKED_STORAGE_LIMITS.maxChunks);
  } catch {
    return NO_SESSION_STORED;
  }

  let utf8Bytes = 0;
  let codeUnits = 0;
  let largestChunkBytes = 0;
  let chunks = 0;

  for (let index = 0; index < count; index += 1) {
    const chunk = await backend.getItem(`${key}.${index}`);
    if (chunk === null) continue;
    const bytes = utf8Length(chunk);
    utf8Bytes += bytes;
    codeUnits += chunk.length;
    largestChunkBytes = Math.max(largestChunkBytes, bytes);
    chunks += 1;
  }

  return { present: true, utf8Bytes, codeUnits, chunks, largestChunkBytes };
}
