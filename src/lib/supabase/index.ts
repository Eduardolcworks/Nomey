export { supabase } from './client';
export { buildClientOptions, SESSION_STORAGE_KEY } from './client-options';
export { CHUNKED_STORAGE_LIMITS, createChunkedStore } from './chunked-storage';
export type { ChunkedStore, StorageBackend } from './chunked-storage';
export { secureStoreBackend, sessionStorage } from './session-storage';
