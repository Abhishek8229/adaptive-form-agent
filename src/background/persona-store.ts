/**
 * PersonaStore: the only module that reads and writes the full
 * PersonaProfile. It lives in /background because the persona is
 * sensitive user data and must remain inside the extension's trusted
 * side (service worker). Content scripts and web pages never see the
 * raw profile; they receive a filtered PersonaProjection.
 *
 * The store is dependency-injectable: tests pass an in-memory storage
 * area; production uses chrome.storage.local.
 */

import {
  PERSONA_SCHEMA_VERSION,
  type ConfidenceLevel,
  type Experience,
  type Fact,
  type FactStatus,
  type IdentityFacts,
  type PersonaAuditEntry,
  type PersonaProfile,
  type PersonaProjection,
  type PersonaQuery,
  type PersonaSource,
  type Plan,
  type Preference,
  type Provenance,
} from '../shared/persona';
import { getDefaultPersonaStorage, type StorageAreaLike } from './persona-storage';

const PROFILE_KEY = 'persona.profile.v1';
const DEFAULT_LIMIT = 25;
const HARD_LIMIT_CAP = 25;
const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

// ---------- Clock injection ----------

export interface PersonaClock {
  now(): string;
}

const defaultClock: PersonaClock = { now: () => new Date().toISOString() };

// ---------- Storage key swapping (for tests) ----------

let _defaultStorage: StorageAreaLike | null = null;

export function setDefaultPersonaStorage(storage: StorageAreaLike | null): void {
  _defaultStorage = storage;
}

function resolveStorage(passed: StorageAreaLike | null | undefined): StorageAreaLike {
  if (passed) return passed;
  if (_defaultStorage) return _defaultStorage;
  return getDefaultPersonaStorage();
}

// ---------- Constructor / factory ----------

export interface PersonaStoreOptions {
  storage?: StorageAreaLike;
  clock?: PersonaClock;
  /** Owner id. Defaults to a stable, locally-generated id. */
  ownerId?: string;
}

export class PersonaStore {
  private readonly storage: StorageAreaLike;
  private readonly clock: PersonaClock;
  private readonly ownerId: string;
  private cached: PersonaProfile | null = null;

  constructor(opts: PersonaStoreOptions = {}) {
    this.storage = resolveStorage(opts.storage);
    this.clock = opts.clock ?? defaultClock;
    this.ownerId = opts.ownerId ?? generateLocalOwnerId();
  }

  // ---------- load / save ----------

  async load(): Promise<PersonaProfile | null> {
    const items = await this.storage.get([PROFILE_KEY]);
    const raw = items[PROFILE_KEY] as PersonaProfile | undefined;
    if (!raw) return null;
    this.cached = deepFreezeOnLoad(raw);
    return this.cached;
  }

  async ensureProfile(): Promise<PersonaProfile> {
    const existing = await this.load();
    if (existing) return existing;
    const now = this.clock.now();
    const fresh: PersonaProfile = {
      schemaVersion: PERSONA_SCHEMA_VERSION,
      ownerId: this.ownerId,
      createdAt: now,
      updatedAt: now,
      identity: {},
      facts: [],
      plans: [],
      preferences: [],
      experiences: [],
      auditLog: [],
    };
    await this.persist(fresh, []);
    this.cached = fresh;
    return fresh;
  }

  async saveProfile(profile: PersonaProfile): Promise<PersonaProfile> {
    if (profile.schemaVersion !== PERSONA_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported persona schema version ${profile.schemaVersion}; expected ${PERSONA_SCHEMA_VERSION}`,
      );
    }
    const next: PersonaProfile = {
      ...profile,
      ownerId: profile.ownerId || this.ownerId,
      updatedAt: this.clock.now(),
      auditLog: profile.auditLog ?? [],
    };
    await this.persist(next, []);
    this.cached = next;
    return next;
  }

  async clear(): Promise<void> {
    await this.storage.remove([PROFILE_KEY]);
    this.cached = null;
  }

  // ---------- Identity ----------

  async updateIdentity(patch: Partial<IdentityFacts>): Promise<PersonaProfile> {
    const profile = await this.ensureProfile();
    const before: IdentityFacts = { ...profile.identity };
    const after: IdentityFacts = { ...before, ...stripUndefined(patch) };
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'update',
      claimId: 'identity',
      before,
      after,
    });
    next.identity = after;
    return this.saveProfile(next);
  }

  // ---------- Facts ----------

  async addFact(fact: Fact): Promise<PersonaProfile> {
    assertFactShape(fact);
    const profile = await this.ensureProfile();
    if (profile.facts.some((f) => f.id === fact.id)) {
      throw new Error(`Fact with id "${fact.id}" already exists`);
    }
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'add',
      claimId: fact.id,
      after: fact,
    });
    next.facts = [...profile.facts, fact];
    return this.saveProfile(next);
  }

  async updateFact(id: string, patch: Partial<Omit<Fact, 'id'>>): Promise<PersonaProfile> {
    const profile = await this.ensureProfile();
    const idx = profile.facts.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error(`Fact "${id}" not found`);
    const before = profile.facts[idx];
    const after: Fact = { ...before, ...stripUndefined(patch), id: before.id, provenance: patch.provenance ?? before.provenance };
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'update',
      claimId: id,
      before,
      after,
    });
    next.facts = [...profile.facts];
    next.facts[idx] = after;
    return this.saveProfile(next);
  }

  async removeFact(id: string): Promise<PersonaProfile> {
    return this.removeClaim('fact', id);
  }

  // ---------- Plans ----------

  async addPlan(plan: Plan): Promise<PersonaProfile> {
    assertPlanShape(plan);
    const profile = await this.ensureProfile();
    if (profile.plans.some((p) => p.id === plan.id)) {
      throw new Error(`Plan with id "${plan.id}" already exists`);
    }
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'add',
      claimId: plan.id,
      after: plan,
    });
    next.plans = [...profile.plans, plan];
    return this.saveProfile(next);
  }

  async updatePlan(id: string, patch: Partial<Omit<Plan, 'id'>>): Promise<PersonaProfile> {
    const profile = await this.ensureProfile();
    const idx = profile.plans.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Plan "${id}" not found`);
    const before = profile.plans[idx];
    const after: Plan = { ...before, ...stripUndefined(patch), id: before.id, provenance: patch.provenance ?? before.provenance };
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'update',
      claimId: id,
      before,
      after,
    });
    next.plans = [...profile.plans];
    next.plans[idx] = after;
    return this.saveProfile(next);
  }

  async removePlan(id: string): Promise<PersonaProfile> {
    return this.removeClaim('plan', id);
  }

  // ---------- Preferences ----------

  async addPreference(pref: Preference): Promise<PersonaProfile> {
    assertPreferenceShape(pref);
    const profile = await this.ensureProfile();
    if (profile.preferences.some((p) => p.id === pref.id)) {
      throw new Error(`Preference with id "${pref.id}" already exists`);
    }
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'add',
      claimId: pref.id,
      after: pref,
    });
    next.preferences = [...profile.preferences, pref];
    return this.saveProfile(next);
  }

  async updatePreference(id: string, patch: Partial<Omit<Preference, 'id'>>): Promise<PersonaProfile> {
    const profile = await this.ensureProfile();
    const idx = profile.preferences.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Preference "${id}" not found`);
    const before = profile.preferences[idx];
    const after: Preference = { ...before, ...stripUndefined(patch), id: before.id, provenance: patch.provenance ?? before.provenance };
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'update',
      claimId: id,
      before,
      after,
    });
    next.preferences = [...profile.preferences];
    next.preferences[idx] = after;
    return this.saveProfile(next);
  }

  async removePreference(id: string): Promise<PersonaProfile> {
    return this.removeClaim('preference', id);
  }

  // ---------- Experiences ----------

  async addExperience(exp: Experience): Promise<PersonaProfile> {
    assertExperienceShape(exp);
    const profile = await this.ensureProfile();
    if (profile.experiences.some((e) => e.id === exp.id)) {
      throw new Error(`Experience with id "${exp.id}" already exists`);
    }
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'add',
      claimId: exp.id,
      after: exp,
    });
    next.experiences = [...profile.experiences, exp];
    return this.saveProfile(next);
  }

  async updateExperience(id: string, patch: Partial<Omit<Experience, 'id'>>): Promise<PersonaProfile> {
    const profile = await this.ensureProfile();
    const idx = profile.experiences.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Experience "${id}" not found`);
    const before = profile.experiences[idx];
    const after: Experience = { ...before, ...stripUndefined(patch), id: before.id, provenance: patch.provenance ?? before.provenance };
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'update',
      claimId: id,
      before,
      after,
    });
    next.experiences = [...profile.experiences];
    next.experiences[idx] = after;
    return this.saveProfile(next);
  }

  async removeExperience(id: string): Promise<PersonaProfile> {
    return this.removeClaim('experience', id);
  }

  // ---------- Query ----------

  async queryPersona(query: PersonaQuery = {}): Promise<PersonaProjection> {
    const profile = await this.ensureProfile();
    const include = query.include ?? {};
    const filter = query.filter ?? {};
    const limit = clampLimit(query.limit);

    const totalClaims =
      profile.facts.length +
      profile.plans.length +
      profile.preferences.length +
      profile.experiences.length;

    const allFacts = profile.facts.filter((f) => matchesFactFilter(f, filter));
    const allPlans = profile.plans.filter((p) => matchesClaimBase(p, filter));
    const allPrefs = profile.preferences.filter((p) => matchesClaimBase(p, filter));
    const allExps = profile.experiences.filter((e) => matchesClaimBase(e, filter));

    const facts = include.facts ? allFacts.slice(0, limit) : [];
    const plans = include.plans ? allPlans.slice(0, limit) : [];
    const preferences = include.preferences ? allPrefs.slice(0, limit) : [];
    const experiences = include.experiences ? allExps.slice(0, limit) : [];

    const matchedBeforeSlice = allFacts.length + allPlans.length + allPrefs.length + allExps.length;
    const returnedClaims = facts.length + plans.length + preferences.length + experiences.length;

    const hadUnknown = allFacts.some((f) => f.status === 'unknown');

    return {
      identity: include.identity ? { ...profile.identity } : undefined,
      facts: redactFacts(facts),
      plans: redactClaims(plans),
      preferences: redactClaims(preferences),
      experiences: redactClaims(experiences),
      meta: {
        matchedAt: this.clock.now(),
        totalClaims,
        returnedClaims: Math.min(returnedClaims, matchedBeforeSlice),
        hadUnknown,
      },
    };
  }

  // ---------- Internals ----------

  private async removeClaim(
    kind: 'fact' | 'plan' | 'preference' | 'experience',
    id: string,
  ): Promise<PersonaProfile> {
    const profile = await this.ensureProfile();
    const list = collectionFor(profile, kind);
    const idx = list.findIndex((c: { id: string }) => c.id === id);
    if (idx < 0) throw new Error(`${kind[0].toUpperCase()}${kind.slice(1)} "${id}" not found`);
    const before = list[idx];
    const next: PersonaProfile = withAudit(profile, {
      at: this.clock.now(),
      action: 'remove',
      claimId: id,
      before,
    });
    const nextList = [...list];
    nextList.splice(idx, 1);
    setCollection(next, kind, nextList);
    return this.saveProfile(next);
  }

  private async persist(profile: PersonaProfile, _hints: unknown[]): Promise<void> {
    await this.storage.set({ [PROFILE_KEY]: profile });
  }
}

// ---------- Helpers ----------

function clampLimit(req: number | undefined): number {
  if (typeof req !== 'number' || !Number.isFinite(req) || req <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(req), HARD_LIMIT_CAP);
}

function matchesClaimBase(
  claim: { category: string; subject: string; predicate?: string; tags?: string[]; provenance: Provenance },
  filter: PersonaQuery['filter'],
): boolean {
  if (!filter) return true;
  if (filter.categories && !lcIncludes(filter.categories, claim.category)) return false;
  if (filter.subjects && !lcIncludes(filter.subjects, claim.subject)) return false;
  if (filter.predicates && filter.predicates.length > 0) {
    if (!claim.predicate || !lcIncludes(filter.predicates, claim.predicate)) return false;
  }
  if (filter.tagsAny && filter.tagsAny.length > 0) {
    const claimTags = claim.tags ?? [];
    const hit = filter.tagsAny.some((t) => claimTags.some((ct) => eqCI(ct, t)));
    if (!hit) return false;
  }
  if (filter.sourcesOnly && filter.sourcesOnly.length > 0) {
    if (!filter.sourcesOnly.includes(claim.provenance.source.kind)) return false;
  }
  if (filter.minConfidence) {
    if (CONFIDENCE_ORDER[claim.provenance.confidence] < CONFIDENCE_ORDER[filter.minConfidence]) {
      return false;
    }
  }
  return true;
}

function matchesFactFilter(fact: Fact, filter: PersonaQuery['filter']): boolean {
  if (!matchesClaimBase(fact, filter)) return false;
  if (filter?.requireStatus && filter.requireStatus.length > 0) {
    if (!filter.requireStatus.includes(fact.status as FactStatus)) return false;
  }
  return true;
}

function lcIncludes(haystack: string[], needle: string): boolean {
  return haystack.some((h) => eqCI(h, needle));
}

function eqCI(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function withAudit(profile: PersonaProfile, entry: PersonaAuditEntry): PersonaProfile {
  const log = profile.auditLog ?? [];
  return {
    ...profile,
    auditLog: [...log, entry],
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function collectionFor(
  profile: PersonaProfile,
  kind: 'fact' | 'plan' | 'preference' | 'experience',
): { id: string }[] {
  switch (kind) {
    case 'fact': return profile.facts;
    case 'plan': return profile.plans;
    case 'preference': return profile.preferences;
    case 'experience': return profile.experiences;
  }
}

function setCollection(
  profile: PersonaProfile,
  kind: 'fact' | 'plan' | 'preference' | 'experience',
  list: { id: string }[],
): void {
  switch (kind) {
    case 'fact': profile.facts = list as Fact[]; break;
    case 'plan': profile.plans = list as Plan[]; break;
    case 'preference': profile.preferences = list as Preference[]; break;
    case 'experience': profile.experiences = list as Experience[]; break;
  }
}

function redactFacts(facts: Fact[]): Fact[] {
  return facts.map((f) => {
    const copy: Fact = { ...f };
    delete copy.notes;
    return copy;
  });
}

function redactClaims<T extends { tags?: string[] }>(items: T[]): T[] {
  return items.map((c) => ({ ...c }));
}

function deepFreezeOnLoad(profile: PersonaProfile): PersonaProfile {
  return profile;
}

function assertFactShape(f: Fact): void {
  if (!f.id) throw new Error('Fact.id is required');
  if (!f.category) throw new Error('Fact.category is required');
  if (!f.subject) throw new Error('Fact.subject is required');
  if (!f.predicate) throw new Error('Fact.predicate is required');
  if (!f.provenance) throw new Error('Fact.provenance is required');
}

function assertPlanShape(p: Plan): void {
  if (!p.id) throw new Error('Plan.id is required');
  if (!p.category) throw new Error('Plan.category is required');
  if (!p.subject) throw new Error('Plan.subject is required');
  if (!p.predicate) throw new Error('Plan.predicate is required');
  if (!p.provenance) throw new Error('Plan.provenance is required');
}

function assertPreferenceShape(p: Preference): void {
  if (!p.id) throw new Error('Preference.id is required');
  if (!p.category) throw new Error('Preference.category is required');
  if (!p.subject) throw new Error('Preference.subject is required');
  if (typeof p.value !== 'string') throw new Error('Preference.value is required');
  if (!p.provenance) throw new Error('Preference.provenance is required');
}

function assertExperienceShape(e: Experience): void {
  if (!e.id) throw new Error('Experience.id is required');
  if (!e.category) throw new Error('Experience.category is required');
  if (!e.subject) throw new Error('Experience.subject is required');
  if (!e.description) throw new Error('Experience.description is required');
  if (!e.provenance) throw new Error('Experience.provenance is required');
}

function generateLocalOwnerId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `local-${g.crypto.randomUUID()}`;
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Re-export PersonaSource so callers can build typed values without
// also importing the shared module.
export type { PersonaSource };
