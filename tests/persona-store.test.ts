import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONA_SCHEMA_VERSION,
  type Experience,
  type Fact,
  type PersonaProfile,
  type Plan,
  type Preference,
  type Provenance,
} from '../src/shared/persona.ts';
import { PersonaStore, setDefaultPersonaStorage } from '../src/background/persona-store.ts';
import { createInMemoryStorage, type InMemoryStorage } from '../src/background/persona-storage-mock.ts';

function prov(overrides: Partial<Provenance> = {}): Provenance {
  return {
    source: { kind: 'user-explicit', recordedAt: '2026-08-26T10:00:00.000Z' },
    confidence: 'high',
    ...overrides,
  };
}

function makeStore(): { store: PersonaStore; storage: InMemoryStorage } {
  setDefaultPersonaStorage(null);
  const storage = createInMemoryStorage();
  const store = new PersonaStore({ storage, clock: { now: () => '2026-08-26T10:00:00.000Z' } });
  return { store, storage };
}

const SMARTPHONE_FACT: Fact = {
  id: 'fact.electronics.smartphone.last2mo',
  category: 'electronics',
  subject: 'smartphone',
  predicate: 'purchased',
  status: 'true',
  value: { since: '2026-06-26' },
  provenance: prov(),
  tags: ['phone', 'mobile'],
};

const PC_PLAN: Plan = {
  id: 'plan.computing.pc.buy',
  category: 'computing',
  subject: 'PC',
  predicate: 'planning-to-purchase',
  status: 'active',
  horizon: 'medium-term',
  value: { budget: { amount: 1500, currency: 'USD' } },
  provenance: prov(),
  tags: ['desktop', 'windows', 'linux'],
};

const UNKNOWN_FACT: Fact = {
  id: 'fact.travel.international.last12mo',
  category: 'travel',
  subject: 'international-trip',
  predicate: 'taken',
  status: 'unknown',
  provenance: prov(),
};

// ---------- create / load / save ----------

test('persona-store: ensureProfile creates a fresh profile when none exists', async () => {
  const { store, storage } = makeStore();
  const profile = await store.ensureProfile();
  assert.equal(profile.schemaVersion, PERSONA_SCHEMA_VERSION);
  assert.equal(profile.facts.length, 0);
  assert.equal(profile.plans.length, 0);
  assert.equal(profile.preferences.length, 0);
  assert.equal(profile.experiences.length, 0);
  assert.equal(profile.createdAt, '2026-08-26T10:00:00.000Z');
  assert.equal(profile.updatedAt, '2026-08-26T10:00:00.000Z');
  // And it must have been written to the storage area.
  const snap = storage.snapshot();
  assert.ok(snap['persona.profile.v1'], 'profile must be persisted');
});

test('persona-store: load returns the persisted profile', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  const reloaded = await new PersonaStore({
    storage: (store as unknown as { storage: InMemoryStorage }).storage,
    clock: { now: () => '2026-08-26T11:00:00.000Z' },
  }).load();
  assert.ok(reloaded, 'load should return the profile');
  assert.equal(reloaded!.facts.length, 1);
  assert.equal(reloaded!.facts[0].id, SMARTPHONE_FACT.id);
});

test('persona-store: saveProfile updates updatedAt and persists', async () => {
  const { store, storage } = makeStore();
  const p = await store.ensureProfile();
  p.identity = { preferredName: 'Alex' };
  p.updatedAt = '2026-08-26T11:30:00.000Z';
  const saved = await store.saveProfile(p);
  assert.equal(saved.updatedAt, '2026-08-26T10:00:00.000Z');
  // saveProfile overwrites updatedAt with the clock value.
  const snap = storage.snapshot();
  const persisted = snap['persona.profile.v1'] as PersonaProfile;
  assert.equal(persisted.identity.preferredName, 'Alex');
  assert.equal(persisted.updatedAt, '2026-08-26T10:00:00.000Z');
});

// ---------- identity ----------

test('persona-store: updateIdentity merges and audits', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.updateIdentity({ preferredName: 'Alex', locale: 'en-US' });
  await store.updateIdentity({ country: 'US' });
  const reloaded = await new PersonaStore({
    storage: (store as unknown as { storage: InMemoryStorage }).storage,
  }).load();
  assert.equal(reloaded!.identity.preferredName, 'Alex');
  assert.equal(reloaded!.identity.locale, 'en-US');
  assert.equal(reloaded!.identity.country, 'US');
  const identityEntries = reloaded!.auditLog!.filter((e) => e.claimId === 'identity');
  assert.equal(identityEntries.length, 2);
  assert.equal(identityEntries[0].action, 'update');
  assert.equal(identityEntries[1].action, 'update');
});

// ---------- facts: smartphone, unknown, audit, update, remove ----------

test('persona-store: addFact stores the smartphone purchase fact and audits it', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  const after = await store.addFact(SMARTPHONE_FACT);
  assert.equal(after.facts.length, 1);
  assert.equal(after.facts[0].id, 'fact.electronics.smartphone.last2mo');
  assert.equal(after.facts[0].status, 'true');
  assert.equal(after.auditLog?.[0].action, 'add');
  assert.equal(after.auditLog?.[0].claimId, SMARTPHONE_FACT.id);
});

test('persona-store: addFact rejects duplicate ids', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await assert.rejects(() => store.addFact(SMARTPHONE_FACT), /already exists/);
});

test('persona-store: updateFact patches fields and audits before/after', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  const after = await store.updateFact(SMARTPHONE_FACT.id, {
    notes: 'Pixel 9 from carrier store',
  });
  const updated = after.facts[0];
  assert.equal(updated.notes, 'Pixel 9 from carrier store');
  // id and provenance must not be silently lost.
  assert.equal(updated.id, SMARTPHONE_FACT.id);
  assert.equal(updated.provenance.source.kind, 'user-explicit');
  // Audit log has add then update, with before/after on the update.
  const updates = after.auditLog!.filter((e) => e.action === 'update');
  assert.equal(updates.length, 1);
  assert.deepEqual((updates[0].before as Fact).value, SMARTPHONE_FACT.value);
  assert.equal((updates[0].after as Fact).notes, 'Pixel 9 from carrier store');
});

test('persona-store: removeFact removes and audits', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  const after = await store.removeFact(SMARTPHONE_FACT.id);
  assert.equal(after.facts.length, 0);
  const removeEntries = after.auditLog!.filter((e) => e.action === 'remove');
  assert.equal(removeEntries.length, 1);
  assert.equal(removeEntries[0].claimId, SMARTPHONE_FACT.id);
});

test('persona-store: unknown fact remains distinct from false in storage and query', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(UNKNOWN_FACT);
  const reloaded = await new PersonaStore({
    storage: (store as unknown as { storage: InMemoryStorage }).storage,
  }).load();
  assert.equal(reloaded!.facts[0].status, 'unknown');
  const proj = await store.queryPersona({ include: { facts: true } });
  assert.equal(proj.facts[0].status, 'unknown');
  assert.equal(proj.meta.hadUnknown, true);
});

// ---------- plans ----------

test('persona-store: addPlan stores the active PC plan', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  const after = await store.addPlan(PC_PLAN);
  assert.equal(after.plans.length, 1);
  assert.equal(after.plans[0].status, 'active');
  assert.equal(after.plans[0].horizon, 'medium-term');
  assert.equal(after.plans[0].value?.budget?.amount, 1500);
  const adds = after.auditLog!.filter((e) => e.action === 'add' && e.claimId === PC_PLAN.id);
  assert.equal(adds.length, 1);
});

test('persona-store: updatePlan marks a plan completed and audits', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addPlan(PC_PLAN);
  const after = await store.updatePlan(PC_PLAN.id, { status: 'completed' });
  assert.equal(after.plans[0].status, 'completed');
  const updates = after.auditLog!.filter((e) => e.action === 'update' && e.claimId === PC_PLAN.id);
  assert.equal(updates.length, 1);
  assert.equal((updates[0].before as Plan).status, 'active');
  assert.equal((updates[0].after as Plan).status, 'completed');
});

test('persona-store: removePlan removes and audits', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addPlan(PC_PLAN);
  const after = await store.removePlan(PC_PLAN.id);
  assert.equal(after.plans.length, 0);
  assert.ok(after.auditLog!.some((e) => e.action === 'remove' && e.claimId === PC_PLAN.id));
});

// ---------- preferences / experiences ----------

test('persona-store: addPreference and removePreference round-trip', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  const pref: Preference = {
    id: 'pref.os.work',
    category: 'operating-system',
    subject: 'work-laptop-os',
    value: 'Linux',
    strength: 'strong',
    provenance: prov(),
    tags: ['ubuntu'],
  };
  const after = await store.addPreference(pref);
  assert.equal(after.preferences.length, 1);
  assert.equal(after.preferences[0].strength, 'strong');
  const afterRemove = await store.removePreference(pref.id);
  assert.equal(afterRemove.preferences.length, 0);
});

test('persona-store: addExperience and updateExperience round-trip', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  const exp: Experience = {
    id: 'exp.purchase.smartphone.2026-07',
    category: 'purchases',
    subject: 'smartphone',
    description: 'Bought a Pixel 9 in July 2026',
    occurredAt: '2026-07-12',
    provenance: prov(),
    tags: ['pixel'],
  };
  const after = await store.addExperience(exp);
  assert.equal(after.experiences.length, 1);
  const updated = await store.updateExperience(exp.id, { description: 'Bought a Pixel 9 Pro' });
  assert.equal(updated.experiences[0].description, 'Bought a Pixel 9 Pro');
});

// ---------- query: filters ----------

test('persona-store: query filters by subject', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await store.addFact(UNKNOWN_FACT);
  await store.addPlan(PC_PLAN);
  const proj = await store.queryPersona({
    include: { facts: true, plans: true },
    filter: { subjects: ['smartphone'] },
  });
  assert.equal(proj.facts.length, 1);
  assert.equal(proj.facts[0].id, SMARTPHONE_FACT.id);
  // The PC plan is filtered out by subject.
  assert.equal(proj.plans.length, 0);
});

test('persona-store: query filters by tagsAny (any-of)', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await store.addFact(UNKNOWN_FACT);
  const proj = await store.queryPersona({
    include: { facts: true },
    filter: { tagsAny: ['phone'] },
  });
  assert.equal(proj.facts.length, 1);
  assert.equal(proj.facts[0].id, SMARTPHONE_FACT.id);
});

test('persona-store: query filters by category and predicate', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await store.addFact(UNKNOWN_FACT);
  const electronics = await store.queryPersona({
    include: { facts: true },
    filter: { categories: ['electronics'] },
  });
  assert.equal(electronics.facts.length, 1);
  const purchased = await store.queryPersona({
    include: { facts: true },
    filter: { predicates: ['purchased'] },
  });
  assert.equal(purchased.facts.length, 1);
  assert.equal(purchased.facts[0].id, SMARTPHONE_FACT.id);
});

test('persona-store: query filters facts by status', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await store.addFact(UNKNOWN_FACT);
  const onlyTrue = await store.queryPersona({
    include: { facts: true },
    filter: { requireStatus: ['true'] },
  });
  assert.equal(onlyTrue.facts.length, 1);
  assert.equal(onlyTrue.facts[0].id, SMARTPHONE_FACT.id);
  const onlyUnknown = await store.queryPersona({
    include: { facts: true },
    filter: { requireStatus: ['unknown'] },
  });
  assert.equal(onlyUnknown.facts.length, 1);
  assert.equal(onlyUnknown.facts[0].id, UNKNOWN_FACT.id);
  assert.equal(onlyUnknown.meta.hadUnknown, true);
});

// ---------- sourcesOnly and minConfidence ----------

test('persona-store: query sourcesOnly excludes AI-inferred claims', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await store.addFact({
    ...SMARTPHONE_FACT,
    id: 'fact.ai.derived.smartphone',
    status: 'true',
    provenance: {
      source: {
        kind: 'ai-inferred',
        recordedAt: '2026-08-26T10:00:00.000Z',
        reasoning: 'guessed from past behavior',
        modelVersion: 'test-model',
      },
      confidence: 'low',
    },
  });
  const userOnly = await store.queryPersona({
    include: { facts: true },
    filter: { sourcesOnly: ['user-explicit'] },
  });
  assert.equal(userOnly.facts.length, 1);
  assert.equal(userOnly.facts[0].provenance.source.kind, 'user-explicit');
  const all = await store.queryPersona({
    include: { facts: true },
  });
  assert.equal(all.facts.length, 2);
});

test('persona-store: query minConfidence filters by confidence ordering', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT); // high
  await store.addFact({
    ...SMARTPHONE_FACT,
    id: 'fact.ai.derived.smartphone',
    status: 'true',
    provenance: {
      source: {
        kind: 'ai-inferred',
        recordedAt: '2026-08-26T10:00:00.000Z',
        reasoning: 'r',
        modelVersion: 'm',
      },
      confidence: 'low',
    },
  });
  const onlyHigh = await store.queryPersona({
    include: { facts: true },
    filter: { minConfidence: 'high' },
  });
  assert.equal(onlyHigh.facts.length, 1);
  assert.equal(onlyHigh.facts[0].provenance.confidence, 'high');
  const mediumAndAbove = await store.queryPersona({
    include: { facts: true },
    filter: { minConfidence: 'medium' },
  });
  assert.equal(mediumAndAbove.facts.length, 1);
});

// ---------- limit ----------

test('persona-store: query enforces the 25 hard cap', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  for (let i = 0; i < 30; i++) {
    await store.addFact({
      id: `fact.test.${i}`,
      category: 'test',
      subject: `s${i}`,
      predicate: 'is',
      status: 'true',
      provenance: prov(),
    });
  }
  const proj = await store.queryPersona({ include: { facts: true }, limit: 1000 });
  assert.equal(proj.facts.length, 25, 'hard cap is 25');
});

test('persona-store: query default limit is 25', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  for (let i = 0; i < 30; i++) {
    await store.addFact({
      id: `fact.test.${i}`,
      category: 'test',
      subject: `s${i}`,
      predicate: 'is',
      status: 'true',
      provenance: prov(),
    });
  }
  const proj = await store.queryPersona({ include: { facts: true } });
  assert.equal(proj.facts.length, 25);
});

test('persona-store: query limit below cap is respected', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  for (let i = 0; i < 10; i++) {
    await store.addFact({
      id: `fact.test.${i}`,
      category: 'test',
      subject: `s${i}`,
      predicate: 'is',
      status: 'true',
      provenance: prov(),
    });
  }
  const proj = await store.queryPersona({ include: { facts: true }, limit: 3 });
  assert.equal(proj.facts.length, 3);
});

// ---------- identity inclusion in projection ----------

test('persona-store: query includes identity only when requested', async () => {
  const { store } = makeStore();
  await store.ensureProfile();
  await store.updateIdentity({ preferredName: 'Alex' });
  const without = await store.queryPersona({ include: { facts: true } });
  assert.equal(without.identity, undefined);
  const withIdentity = await store.queryPersona({ include: { identity: true, facts: true } });
  assert.ok(withIdentity.identity);
  assert.equal(withIdentity.identity!.preferredName, 'Alex');
});

// ---------- persistence between store instances ----------

test('persona-store: data persists between store instances on the same storage', async () => {
  const storage = createInMemoryStorage();
  setDefaultPersonaStorage(null);
  const a = new PersonaStore({ storage, clock: { now: () => '2026-08-26T10:00:00.000Z' } });
  await a.ensureProfile();
  await a.addFact(SMARTPHONE_FACT);
  await a.addPlan(PC_PLAN);

  // Construct a fresh store against the same storage area.
  const b = new PersonaStore({ storage, clock: { now: () => '2026-08-26T12:00:00.000Z' } });
  const loaded = await b.load();
  assert.ok(loaded);
  assert.equal(loaded!.facts.length, 1);
  assert.equal(loaded!.facts[0].id, SMARTPHONE_FACT.id);
  assert.equal(loaded!.plans.length, 1);
  assert.equal(loaded!.plans[0].id, PC_PLAN.id);
  // Audit log survives the round trip.
  assert.ok(loaded!.auditLog && loaded!.auditLog.length >= 2);
});

test('persona-store: clear removes the profile', async () => {
  const { store, storage } = makeStore();
  await store.ensureProfile();
  await store.addFact(SMARTPHONE_FACT);
  await store.clear();
  const snap = storage.snapshot();
  assert.equal(snap['persona.profile.v1'], undefined);
  const reloaded = await new PersonaStore({
    storage: (store as unknown as { storage: InMemoryStorage }).storage,
  }).load();
  assert.equal(reloaded, null);
});
