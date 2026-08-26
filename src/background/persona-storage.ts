/**
 * Minimal subset of the chrome.storage API the persona-store needs.
 *
 * Keeping the surface this small lets tests inject an in-memory
 * implementation without depending on a real Chrome runtime.
 *
 * Mirrors the promise-based shape of `chrome.storage.LocalStorageArea`:
 *   - get(keys)         -> Promise<{ [key]: T }>
 *   - set(items)        -> Promise<void>
 *   - remove(keys)      -> Promise<void>
 */

export type StorageKey = string;
export type StorageItems = Record<StorageKey, unknown>;

export interface StorageAreaLike {
  get(keys: StorageKey | StorageKey[] | null): Promise<StorageItems>;
  set(items: StorageItems): Promise<void>;
  remove(keys: StorageKey | StorageKey[]): Promise<void>;
}

/**
 * Default storage: `chrome.storage.local`. The persona-store imports this
 * lazily so test code can replace the default by calling
 * `setDefaultPersonaStorage(mock)` before constructing the store.
 */
export function getDefaultPersonaStorage(): StorageAreaLike {
  const g = globalThis as { chrome?: { storage?: { local?: StorageAreaLike } } };
  const local = g.chrome?.storage?.local;
  if (!local) {
    throw new Error(
      'No default persona storage available. ' +
        'In a Chrome extension this is chrome.storage.local; in tests, ' +
        'call setDefaultPersonaStorage() with an in-memory mock.',
    );
  }
  return local;
}
