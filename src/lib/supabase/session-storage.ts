/**
 * Where the session actually lives: the iOS keychain and the Android keystore,
 * through `expo-secure-store`, behind the chunking store.
 *
 * This file is the only place that names `expo-secure-store`. The auth library
 * above it sees three methods and knows nothing about chunks, manifests or
 * keychain accessibility - ADR-017.
 */
import * as SecureStore from 'expo-secure-store';

import { createChunkedStore, type StorageBackend } from './chunked-storage';

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, verified against the installed API
 * (expo-secure-store 57.0.2), whose own documentation for this constant reads:
 * "Similar to WHEN_UNLOCKED, except the entry is not migrated to a new device
 * when restoring from a backup."
 *
 * Two halves of one decision:
 *
 * - WHEN_UNLOCKED - the session is readable only while the device is unlocked.
 *   Nomey does not read it in the background, and does not design for widgets
 *   that would.
 * - THIS_DEVICE_ONLY - the refresh token does not travel in an encrypted
 *   backup to another device.
 *
 * `keychainAccessible` is iOS-only. The Android half of "this device only" is
 * not a constant at all: it is the backup exclusion the `expo-secure-store`
 * config plugin writes into the manifest. Both are needed; neither covers the
 * other platform. See app.config.ts.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * No `keychainService`. The dev and production variants already carry
 * different bundle identifiers - app.config.ts - and SecureStore is scoped by
 * the app on both platforms, so the two builds cannot see each other's
 * entries. Adding a service name would be a second, weaker copy of a
 * separation that already exists, and one that has to be passed identically on
 * every later read or the value becomes unreachable.
 */
export const secureStoreBackend: StorageBackend = {
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

export const sessionStorage = createChunkedStore(secureStoreBackend);
