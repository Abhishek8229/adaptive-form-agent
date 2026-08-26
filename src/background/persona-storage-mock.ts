/**
 * In-memory StorageAreaLike for tests. Simulates chrome.storage.local
 * (promise-based get/set/remove) and supports per-test isolation.
 */

import type { StorageAreaLike, StorageItems, StorageKey } from './persona-storage';

export interface InMemoryStorage extends StorageAreaLike {
  snapshot(): Record<StorageKey, unknown>;
  clearAll(): Promise<void>;
}

export function createInMemoryStorage(seed: StorageItems = {}): InMemoryStorage {
  const data: Record<StorageKey, unknown> = { ...seed };

  function pickKeys(keys: StorageKey | StorageKey[] | null): StorageKey[] | null {
    if (keys === null || keys === undefined) return null;
    return Array.isArray(keys) ? keys : [keys];
  }

  const storage: InMemoryStorage = {
    async get(keys) {
      const wanted = pickKeys(keys);
      if (wanted === null) {
        return { ...(data as StorageItems) };
      }
      const out: StorageItems = {};
      for (const k of wanted) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          out[k] = data[k];
        }
      }
      return out;
    },
    async set(items) {
      for (const k of Object.keys(items)) {
        data[k] = items[k];
      }
    },
    async remove(keys) {
      const wanted = pickKeys(keys);
      if (wanted === null) {
        for (const k of Object.keys(data)) delete data[k];
        return;
      }
      for (const k of wanted) delete data[k];
    },
    snapshot() {
      return { ...(data as StorageItems) };
    },
    async clearAll() {
      for (const k of Object.keys(data)) delete data[k];
    },
  };

  return storage;
}
