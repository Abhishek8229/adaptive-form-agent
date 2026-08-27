/**
 * ProfileStore: persists JSON profiles in chrome.storage.local.
 *
 * Storage layout:
 *   profiles.v1              -> { [id]: ProfileEntry }
 *   profiles.selected.v1     -> string | null
 *
 * The store is dependency-injectable: tests pass an in-memory storage
 * area; production uses chrome.storage.local. The store owns a clock
 * (default: Date.now ISO) for the same reason.
 *
 * A small example profile is seeded on first use so the popup has
 * something to populate its dropdown with.
 */

import type { JsonProfile, ProfileEntry, ProfileListEntry } from '../shared/profile';

export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const PROFILES_KEY = 'profiles.v1';
const SEED_DONE_KEY = 'profiles.seeded.v1';

export interface ProfileClock {
  now(): string;
}

const defaultClock: ProfileClock = { now: () => new Date().toISOString() };

let _defaultStorage: StorageAreaLike | null = null;

export function setDefaultProfileStorage(storage: StorageAreaLike | null): void {
  _defaultStorage = storage;
}

function resolveStorage(passed: StorageAreaLike | null | undefined): StorageAreaLike {
  if (passed) return passed;
  if (_defaultStorage) return _defaultStorage;
  return getDefaultProfileStorage();
}

/**
 * Default storage: `chrome.storage.local`. The profile-store imports this
 * lazily so test code can replace the default by calling
 * `setDefaultProfileStorage(mock)` before constructing the store.
 */
export function getDefaultProfileStorage(): StorageAreaLike {
  const g = globalThis as { chrome?: { storage?: { local?: StorageAreaLike } } };
  const local = g.chrome?.storage?.local;
  if (!local) {
    throw new Error(
      'No default profile storage available. ' +
        'In a Chrome extension this is chrome.storage.local; in tests, ' +
        'call setDefaultProfileStorage() with an in-memory mock.',
    );
  }
  return local;
}

export function generateProfileId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `profile_${Date.now().toString(36)}_${rand}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPlainProfile(v: unknown): v is JsonProfile {
  if (!isObject(v)) return false;
  for (const value of Object.values(v)) {
    if (value === null) continue;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') return false;
      }
      continue;
    }
    if (isObject(value)) {
      const label = value.label;
      const val = value.value;
      if (typeof label !== 'string' || typeof val !== 'string') return false;
      continue;
    }
    return false;
  }
  return true;
}

const EXAMPLE_PROFILE: JsonProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  fullName: 'Jane Doe',
  email: 'jane.doe@example.com',
  phone: '555-123-4567',
  address: '123 Main St',
  addressLine2: 'Apt 4B',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'United States',
  username: 'jane_doe',
  url: 'https://example.com',
  dateOfBirth: '1990-01-15',
};

export class ProfileStore {
  private readonly storage: StorageAreaLike;
  private readonly clock: ProfileClock;

  constructor(opts: { storage?: StorageAreaLike; clock?: ProfileClock } = {}) {
    this.storage = resolveStorage(opts.storage);
    this.clock = opts.clock ?? defaultClock;
  }

  private async readAll(): Promise<Record<string, ProfileEntry>> {
    const out = await this.storage.get(PROFILES_KEY);
    const v = out[PROFILES_KEY];
    if (!isObject(v)) return {};
    const result: Record<string, ProfileEntry> = {};
    for (const [id, raw] of Object.entries(v)) {
      if (!isObject(raw)) continue;
      const name = typeof raw.name === 'string' ? raw.name : id;
      const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';
      const profile = isObject(raw.profile) && isPlainProfile(raw.profile) ? raw.profile : {};
      result[id] = { id, name, profile, updatedAt };
    }
    return result;
  }

  private async writeAll(all: Record<string, ProfileEntry>): Promise<void> {
    await this.storage.set({ [PROFILES_KEY]: all });
  }

  async ensureSeeded(): Promise<void> {
    const seeded = await this.storage.get(SEED_DONE_KEY);
    if (seeded[SEED_DONE_KEY] === true) return;
    const existing = await this.readAll();
    if (Object.keys(existing).length === 0) {
      const id = generateProfileId();
      const entry: ProfileEntry = {
        id,
        name: 'Example profile',
        profile: EXAMPLE_PROFILE,
        updatedAt: this.clock.now(),
      };
      existing[id] = entry;
      await this.writeAll(existing);
    }
    await this.storage.set({ [SEED_DONE_KEY]: true });
  }

  async list(): Promise<ProfileListEntry[]> {
    await this.ensureSeeded();
    const all = await this.readAll();
    return Object.values(all)
      .map((e) => ({ id: e.id, name: e.name, updatedAt: e.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<ProfileEntry | null> {
    await this.ensureSeeded();
    const all = await this.readAll();
    return all[id] ?? null;
  }

  async save(input: { id?: string; name: string; profile: JsonProfile }): Promise<ProfileEntry> {
    if (!isPlainProfile(input.profile)) {
      throw new Error('profile must be a JSON object with string/number/boolean/array/{label,value} values');
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('profile name is required');
    }
    await this.ensureSeeded();
    const all = await this.readAll();
    const id = input.id ?? generateProfileId();
    const entry: ProfileEntry = {
      id,
      name: input.name.trim(),
      profile: input.profile,
      updatedAt: this.clock.now(),
    };
    all[id] = entry;
    await this.writeAll(all);
    return entry;
  }

  async delete(id: string): Promise<void> {
    const all = await this.readAll();
    if (id in all) {
      delete all[id];
      await this.writeAll(all);
    }
  }
}
