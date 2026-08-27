/**
 * A key/value store that survives values larger than one SecureStore entry.
 *
 * Expo's documentation is explicit that "large payloads can be rejected by the
 * underlying platform" and that iOS historically refused values above roughly
 * 2048 bytes. A Supabase session is an access JWT, a refresh token and a user
 * object; it is not obviously under that, and it grows with user metadata. So
 * the store never bets on a value fitting - every value is chunked, including
 * a short one. One code path, no size branch that can rot.
 *
 * The design is a manifest plus numbered chunks, and its whole safety rests on
 * a single ordering rule:
 *
 *   THE MANIFEST IS WRITTEN LAST AND DELETED FIRST.
 *
 * The manifest is the commit record. Its absence means "there is nothing
 * here", its presence means every chunk it counts was written before it. An
 * interrupted write therefore degrades to no session - the user signs in again
 * - and never to half a session, which would reach the auth library as
 * truncated JSON and fail somewhere unrelated.
 *
 * This is not a database and must not grow into one. There are no
 * transactions, no locking and no recovery: there is one rule about ordering
 * and one rule about what to do when reassembly fails.
 */

/** The three operations this store needs from whatever it sits on. */
export type StorageBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** What `@supabase/auth-js` asks for: `SupportedStorage`. */
export type ChunkedStore = StorageBackend;

/**
 * Chunk size in UTF-16 code units, not bytes.
 *
 * SecureStore stores UTF-8, and a code unit outside ASCII can cost up to three
 * bytes (a surrogate pair costs four bytes for two units, so three per unit is
 * the true worst case). 512 units is therefore at most 1536 bytes even for
 * text that is entirely non-Latin, which stays under the 2048 figure with room
 * to spare, while an ASCII JWT - what this actually stores nearly all of the
 * time - packs the full 512 bytes.
 */
const CHUNK_SIZE = 512;

/**
 * Hard ceiling on chunks per value: 128 x 512 = 65,536 code units.
 *
 * It bounds the cleanup sweeps, and it refuses a value orders of magnitude
 * larger than any session instead of writing 4,000 keychain entries. Refusing
 * loudly is the point - the alternative is a silent truncation.
 */
const MAX_CHUNKS = 128;

const MANIFEST_VERSION = 1;

type Manifest = { v: number; n: number };

function chunkKey(key: string, index: number): string {
  // SecureStore keys accept alphanumerics, '.', '-' and '_'. A dot keeps the
  // chunk keys inside that set and visually attached to their manifest.
  return `${key}.${index}`;
}

function parseManifest(raw: string): Manifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { v, n } = parsed as Record<string, unknown>;
  if (v !== MANIFEST_VERSION) return null;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_CHUNKS) return null;

  return { v, n };
}

/**
 * Split without ever cutting a surrogate pair in half.
 *
 * Slicing between a high and a low surrogate produces two chunks that are each
 * individually invalid; whether the platform then stores a replacement
 * character or rejects the write, the value no longer round-trips. Backing off
 * by one unit costs nothing and removes the whole class.
 */
function split(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < value.length) {
    let end = Math.min(start + CHUNK_SIZE, value.length);
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
      if (isHighSurrogate) end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }

  return chunks;
}

export function createChunkedStore(backend: StorageBackend): ChunkedStore {
  /**
   * Delete chunks from `from` upward until one is missing.
   *
   * Chunks are always written contiguously from zero, so the first gap is the
   * end. In the ordinary case - nothing stale - this costs exactly one extra
   * read. The ceiling is there so a corrupted store cannot spin.
   */
  async function sweep(key: string, from: number): Promise<void> {
    for (let index = from; index < MAX_CHUNKS; index += 1) {
      const chunk = await backend.getItem(chunkKey(key, index));
      if (chunk === null) return;
      await backend.removeItem(chunkKey(key, index));
    }
  }

  /**
   * Remove every trace of a key: manifest first, then every possible chunk.
   *
   * Unconditional to the ceiling, and NOT the cheap sweep above, because purge
   * runs precisely when the layout cannot be trusted. A torn value can have a
   * hole in it - chunk 2 gone, chunk 3 still there - and a sweep that stops at
   * the first gap would walk away leaving the tail behind. Those leftovers are
   * unreachable, so this is not a correctness bug, but "unreachable garbage
   * accumulates in the user's keychain" is not an acceptable resting state
   * either.
   *
   * The cost is up to `MAX_CHUNKS` deletes of keys that mostly do not exist,
   * paid on sign-out and on corruption. Both are rare and neither is on a path
   * anyone is waiting on.
   */
  async function purge(key: string): Promise<void> {
    await backend.removeItem(key);
    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      await backend.removeItem(chunkKey(key, index));
    }
  }

  return {
    async getItem(key) {
      const rawManifest = await backend.getItem(key);
      if (rawManifest === null) return null;

      const manifest = parseManifest(rawManifest);
      if (manifest === null) {
        // Unreadable manifest. There is no honest way to reassemble the value,
        // so the entry is treated as absent and cleared, rather than left to
        // fail the same way on every future read.
        await purge(key);
        return null;
      }

      const chunks: string[] = [];
      for (let index = 0; index < manifest.n; index += 1) {
        const chunk = await backend.getItem(chunkKey(key, index));
        if (chunk === null) {
          // A chunk the manifest counted is gone. Returning what did survive
          // would hand back a truncated value that parses as neither a session
          // nor an error. Absent is the only safe answer.
          await purge(key);
          return null;
        }
        chunks.push(chunk);
      }

      return chunks.join('');
    },

    async setItem(key, value) {
      const chunks = split(value);
      if (chunks.length > MAX_CHUNKS) {
        throw new Error(
          `Nomey secure storage: value for "${key}" needs ${chunks.length} chunks, over the ${MAX_CHUNKS} ceiling. Refusing rather than truncating.`,
        );
      }

      // Uncommit first. From here until the manifest is rewritten the key
      // reads as absent, which is exactly what an interrupted write should
      // leave behind.
      await backend.removeItem(key);

      for (let index = 0; index < chunks.length; index += 1) {
        await backend.setItem(chunkKey(key, index), chunks[index]);
      }

      // The commit.
      await backend.setItem(key, JSON.stringify({ v: MANIFEST_VERSION, n: chunks.length }));

      // Chunks left over from a previous, longer value. They are already
      // unreachable - the manifest bounds every read - so this is hygiene, and
      // failing here does not corrupt anything.
      await sweep(key, chunks.length);
    },

    async removeItem(key) {
      await purge(key);
    },
  };
}

/** Exported for the tests, which need to build values around the boundaries. */
export const CHUNKED_STORAGE_LIMITS = {
  chunkSize: CHUNK_SIZE,
  maxChunks: MAX_CHUNKS,
  manifestVersion: MANIFEST_VERSION,
} as const;
